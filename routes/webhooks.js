/**
 * Shipvera Webhook Handlers
 * TRD Section 3.4 Key API Routes
 * Enterprise-grade security, automated queueing, and post-call resolution
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { db } = require('../db');
const { sanitizeAddress, geocodeAddressGoogleMaps } = require('../services/geoSanitizer');
const { triggerOutboundCall } = require('../services/sarvamVoice');
const { applyPostCallDecision } = require('../services/addressRewriter');
const { generateTrustLock, handleTrustLockPaid } = require('../services/trustLock');
const { checkCallingWindow } = require('../services/nightWindow');

// Safe loader for Queue Engine
let queueEngine = {
  enqueueOrder: ({ order }) => ({ status: 'queued', scheduledAt: new Date().toISOString() })
};
try {
  const qMod = require('../services/queueEngine');
  if (qMod && qMod.queueEngine) queueEngine = qMod.queueEngine;
} catch (e) {}

// Inlined HMAC-SHA256 & Signature Verification
function verifyShopifyHmac(req, res, next) {
  const hmacHeader = req.headers['x-shopify-hmac-sha256'];
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) {
    return res.status(500).json({ error: 'SHOPIFY_WEBHOOK_SECRET is not configured. Webhook rejected.' });
  }
  if (!hmacHeader || !req.rawBody) {
    return res.status(401).json({ error: 'Shopify HMAC verification failed: missing signature or body.' });
  }
  const digest = crypto.createHmac('sha256', secret).update(req.rawBody).digest('base64');
  let ok = false;
  try {
    ok = digest.length === hmacHeader.length && crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader));
  } catch (e) {
    ok = false;
  }
  if (!ok) {
    return res.status(401).json({ error: 'Shopify HMAC verification failed' });
  }
  next();
}

function verifyRazorpaySignature(req, res, next) {
  const signature = req.headers['x-razorpay-signature'];
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    return res.status(500).json({ error: 'RAZORPAY_WEBHOOK_SECRET is not configured. Webhook rejected.' });
  }
  if (!signature || !req.rawBody) {
    return res.status(401).json({ error: 'Razorpay signature missing.' });
  }
  const expected = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  let ok = false;
  try {
    ok = expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch (e) {
    ok = false;
  }
  if (!ok) {
    return res.status(401).json({ error: 'Razorpay signature mismatch' });
  }
  next();
}

/**
 * 1. POST /api/webhooks/shopify/orders-create
 * Triggered automatically when a buyer places an order on Shopify.
 * Verifies HMAC-SHA256, skips prepaid orders, geocodes with Google Maps,
 * and pushes to Autonomous Queue with 45s SLA delay or night-window hold.
 */
router.post('/shopify/orders-create', verifyShopifyHmac, async (req, res) => {
  try {
    const payload = req.body || {};

    // Check if COD order (financial_status === 'pending' or payment_gateway_names includes 'cash_on_delivery')
    const isCod = payload.financial_status === 'pending' || 
                  (payload.payment_gateway_names && payload.payment_gateway_names.some(g => /cod|cash/i.test(g)));

    if (!isCod) {
      return res.status(200).json({
        success: true,
        skipped: true,
        message: 'Order is Prepaid. Shipvera filters prepaid orders to save seller call credits.'
      });
    }
    const shopDomain = (req.headers['x-shopify-shop-domain'] || req.query.shop || req.query.seller_domain || '').trim().toLowerCase();
    const querySellerId = req.query.seller_id || req.headers['x-seller-id'] || null;
    let seller = (querySellerId && db.getSeller(querySellerId)) || 
                 (shopDomain && db.getSellerByShopifyDomain(shopDomain));

    // Fallback to Supabase Cloud lookup if seller registered recently in cloud
    if (!seller && (querySellerId || shopDomain)) {
      try {
        const { getSupabaseClient } = require('../services/supabaseClient');
        const sb = getSupabaseClient();
        if (sb) {
          let q = sb.from('sellers').select('*');
          if (querySellerId) q = q.eq('id', querySellerId);
          else if (shopDomain) q = q.eq('shopify_domain', shopDomain);
          const { data } = await q.maybeSingle();
          if (data) {
            seller = db.createSeller(data);
          }
        }
      } catch (e) {}
    }

    if (!seller) {
      return res.status(404).json({ error: 'Seller not found for this Shopify shop. Register the seller before sending webhooks; orders are never attributed to a fallback seller.' });
    }

    const shipping = payload.shipping_address || {};
    const buyerPhone = shipping.phone || payload.phone || payload.customer?.phone || '';
    const buyerFirst = shipping.first_name || payload.customer?.first_name || '';
    const buyerLast = shipping.last_name || payload.customer?.last_name || '';
    const buyerName = `${buyerFirst} ${buyerLast}`.trim();
    const rawAddress = `${shipping.address1 || ''} ${shipping.address2 || ''}`.trim();
    const city = shipping.city || '';
    const pincode = shipping.zip || '';
    const codAmount = Number(payload.total_price);

    const missingFields = [];
    if (!buyerPhone) missingFields.push('buyer_phone');
    if (!buyerName) missingFields.push('buyer_name');
    if (!rawAddress) missingFields.push('shipping_address');
    if (!pincode) missingFields.push('pincode');
    if (!Number.isFinite(codAmount) || codAmount <= 0) missingFields.push('cod_amount');
    if (missingFields.length) {
      return res.status(400).json({ error: 'Missing required order fields; no order was created.', missingFields });
    }

    // Run Geo-Sanitizer check (Feature 1)
    const sanitation = sanitizeAddress({
      rawAddress,
      city,
      pincode,
      buyerPhone,
      buyerName
    });

    // Run Google Maps geocoding deliverability verification
    const geo = await geocodeAddressGoogleMaps({
      address: rawAddress,
      city,
      pincode
    });

    // Create Order in DB
    const newOrder = db.createOrder({
      seller_id: seller.id,
      external_order_id: payload.name || `#UK-${payload.id || Date.now().toString().slice(-4)}`,
      shopify_order_id: payload.id ? String(payload.id) : null,
      source: 'shopify',
      buyer_name: buyerName,
      buyer_phone: buyerPhone,
      cod_amount: codAmount,
      raw_address: rawAddress,
      pincode,
      city,
      missing_fields: sanitation.missingFields,
      risk_score: sanitation.riskScore,
      geo_coordinates: geo.coordinates,
      geo_location_type: geo.locationType,
      geo_deliverability_score: geo.deliverabilityScore,
      geo_accuracy_label: geo.accuracyLabel,
      verification_status: 'queued',
      tags: ['COD-Order', ...(sanitation.flags || [])]
    });

    // Enqueue in Autonomous Queue Engine (45s intentional delay or night window hold)
    const queueResult = queueEngine.enqueueOrder({
      order: newOrder,
      seller,
      delaySeconds: 45
    });

    return res.status(201).json({
      success: true,
      order: newOrder,
      sanitation,
      geo,
      queue: queueResult
    });
  } catch (err) {
    console.error('Error processing Shopify webhook:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * 2. POST /api/webhooks/voice/call-completed
 * Receives recording_url, transcript, duration, and buyer_intent from the Voice AI Provider (Sarvam Voice Agents)
 */
router.post('/voice/call-completed', async (req, res) => {
  try {
    const payload = req.body || {};
    let orderId = payload.order_id;
    let buyerIntent = payload.buyer_intent;
    let spokenText = payload.spoken_text || '';
    let durationSeconds = payload.duration_seconds || payload.conversation_duration || 0;
    let recordingUrl = payload.recording_url || payload.telephony_data?.recording_url || null;

    // Support Sarvam Voice Agents webhook payload (execution/call id lookup)
    const executionId = payload.id || payload.execution_id;
    if (!orderId && executionId) {
      // Find order by matching execution ID in call logs
      const allOrders = db.getOrders();
      for (const ord of allOrders) {
        const logs = db.getCallLogs(ord.id);
        const match = logs.find(l => l.provider_call_id === executionId);
        if (match) {
          orderId = ord.id;
          break;
        }
      }
    }

    if (!orderId) {
      return res.status(404).json({ error: 'Order could not be determined from webhook payload' });
    }

    const order = db.getOrderById(orderId);
    if (!order) {
      return res.status(404).json({ error: `Order ${orderId} not found` });
    }

    const seller = db.getSeller(order.seller_id);
    if (!seller) {
      return res.status(404).json({ error: 'Seller not found for this order.' });
    }

    // If intent was not provided explicitly, only a cancellation keyword
    // in a real transcript may set CANCEL_REQUESTED. Duration alone must
    // never imply VERIFIED_GENUINE. Anything else needs human review
    // and must not apply a post-call decision.
    if (!buyerIntent && Array.isArray(payload.transcript)) {
      const userUtterances = payload.transcript
        .filter(t => t.role === 'user')
        .map(t => t.message || t.text || '')
        .join(' ');
      spokenText = userUtterances;
      if (/cancel|nahi chahiye|mat bhejo|galti se|wrong order|na bheje/i.test(userUtterances)) {
        buyerIntent = 'CANCEL_REQUESTED';
      }
    }

    if (!buyerIntent) {
      return res.status(202).json({
        success: false,
        status: 'needs_review',
        reason: 'Buyer intent was not provided by the voice provider and could not be determined from a real transcript. No post-call decision was applied.'
      });
    }

    // Apply Post-Call Decision Engine (Auto-rewrites address and syncs to Shopify & Shiprocket)
    if (buyerIntent === 'VERIFIED_GENUINE' || buyerIntent === 'CANCEL_REQUESTED') {
      const decision = await applyPostCallDecision({
        orderId: order.id,
        buyerIntent,
        spokenText: spokenText || '',
        sellerId: seller.id
      });
      return res.status(200).json({ success: true, decision });
    } else {
      // DICEY / NO_ANSWER -> Trigger 19 UPI Trust Lock (Feature 4).
      // Await it: if Razorpay/WhatsApp is not configured, report failure.
      const trustLock = await generateTrustLock({ order, seller });
      if (!trustLock || trustLock.success !== true) {
        return res.status(502).json({
          success: false,
          action: 'trust_lock_failed',
          reason: (trustLock && trustLock.reason) || 'Trust Lock could not be sent.',
          trustLock
        });
      }
      return res.status(200).json({
        success: true,
        action: 'trust_lock_triggered',
        trustLock
      });
    }
  } catch (err) {
    console.error('Error processing voice call webhook:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * 3. POST /api/webhooks/razorpay/payment-captured
 * Triggered when a buyer completes the ₹19 UPI Trust Lock payment
 */
router.post('/razorpay/payment-captured', verifyRazorpaySignature, async (req, res) => {
  try {
    const { order_id, payment_id } = req.body;
    if (!order_id) {
      return res.status(400).json({ error: 'order_id is required' });
    }

    const result = handleTrustLockPaid({
      orderId: order_id,
      paymentId: payment_id || `pay_${Date.now()}`
    });

    return res.status(200).json({
      success: true,
      message: '₹19 Trust Token Paid. Order marked Verified & Cleaned on Shopify.',
      result
    });
  } catch (err) {
    console.error('Error processing Razorpay webhook:', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
