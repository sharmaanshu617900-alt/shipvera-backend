/**
 * Shipvera Orders & Quick-Paste API
 */

const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { parseQuickPaste } = require('../services/quickPaste');
const { geocodeAddressGoogleMaps } = require('../services/geoSanitizer');
const { triggerOutboundCall } = require('../services/voiceAI');
const { applyPostCallDecision } = require('../services/addressRewriter');
const { generateTrustLock } = require('../services/trustLock');
const { checkCallingWindow } = require('../services/nightWindow');

/**
 * GET /api/orders
 * Returns all orders with optional status filtering
 */
router.get('/', (req, res) => {
  try {
    const sellerId = req.headers['x-seller-id'] || req.query.seller_id || null;
    const { status, limit = 50 } = req.query;
    let orders = db.getOrders(sellerId);

    if (status) {
      orders = orders.filter(o => o.verification_status === status);
    }

    return res.status(200).json({
      success: true,
      count: orders.length,
      orders: orders.slice(0, Number(limit))
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/orders/:id
 * Returns single order details, including its call logs and address magic diff
 */
router.get('/:id', (req, res) => {
  try {
    const order = db.getOrderById(req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const callLogs = db.getCallLogs(order.id);
    const buyerTrust = db.getBuyerTrust(order.buyer_phone);

    return res.status(200).json({
      success: true,
      order,
      callLogs,
      buyerTrust,
      addressDiff: {
        raw: order.raw_address,
        missingFields: order.missing_fields,
        cleaned: {
          line1: order.cleaned_address_line1,
          line2: order.cleaned_address_line2,
          landmark: order.cleaned_landmark
        }
      }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/orders/quick-paste
 * Feature 5: Quick-Paste Mode for WhatsApp / Instagram sellers
 */
router.post('/quick-paste', async (req, res) => {
  try {
    const { raw_text } = req.body;
    if (!raw_text) {
      return res.status(400).json({ error: 'raw_text parameter is required' });
    }

    const parsed = parseQuickPaste(raw_text);
    const sellerId = req.headers['x-seller-id'] || req.body.seller_id || null;
    const seller = db.getSeller(sellerId);
    if (!seller) {
      return res.status(404).json({ error: 'Seller not found. Provide a valid seller_id; quick-paste orders are never attributed to a fallback seller.' });
    }
    const quickPasteMissing = [];
    if (!parsed.buyerPhone) quickPasteMissing.push('buyer_phone');
    if (!parsed.rawAddress) quickPasteMissing.push('raw_address');
    if (!parsed.pincode) quickPasteMissing.push('pincode');
    if (!parsed.codAmount || Number(parsed.codAmount) <= 0) quickPasteMissing.push('cod_amount');
    if (quickPasteMissing.length) {
      return res.status(400).json({ error: 'Quick-paste text is missing required fields; no order was created.', missingFields: quickPasteMissing, parsed });
    }

    // Run Google Maps geocoding deliverability check
    const geo = await geocodeAddressGoogleMaps({
      address: parsed.rawAddress,
      city: parsed.city,
      pincode: parsed.pincode
    });

    // Create Order in DB
    const order = db.createOrder({
      seller_id: seller.id,
      external_order_id: `WA-${Date.now().toString().slice(-4)}`,
      source: 'whatsapp_paste',
      buyer_name: parsed.buyerName,
      buyer_phone: parsed.buyerPhone,
      cod_amount: parsed.codAmount,
      raw_address: parsed.rawAddress,
      pincode: parsed.pincode,
      city: parsed.city,
      missing_fields: parsed.sanitation.missingFields,
      risk_score: parsed.sanitation.riskScore,
      geo_coordinates: geo.coordinates,
      geo_location_type: geo.locationType,
      geo_deliverability_score: geo.deliverabilityScore,
      geo_accuracy_label: geo.accuracyLabel,
      verification_status: 'queued',
      tags: ['WhatsApp-Quick-Paste', ...(parsed.sanitation.flags || [])]
    });

    // Check calling window
    const windowCheck = checkCallingWindow();

    // Trigger a LIVE outbound voice call only. The outcome is applied
    // later via the real voice webhook, never from a simulated result
    // or an invented spoken text in this route.
    let callResult = null;
    let callError = null;
    if (windowCheck.isAllowedNow && seller.wallet_balance_inr >= 12.00) {
      try {
        callResult = await triggerOutboundCall({ order, seller, live: true });
      } catch (e) {
        callError = e.message;
      }
    }

    const freshOrder = db.getOrderById(order.id);

    return res.status(201).json({
      success: true,
      message: callResult && callResult.live ? 'Quick-paste order created; live verification call initiated. Outcome will arrive via the voice webhook.' : 'Quick-paste order created and queued; verification call was not placed yet (night window, low wallet, or call error).',
      callError,
      parsed,
      order: freshOrder,
      callResult,
      windowCheck
    });
  } catch (err) {
    console.error('Error in quick-paste:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/calls/trigger
 * Triggers or retries an outbound call for any order
 */
router.post('/trigger', async (req, res) => {
  try {
    const { order_id, forced_intent, live, recipient_phone } = req.body;
    const order = db.getOrderById(order_id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const seller = db.getSeller(order.seller_id);
    if (!seller) {
      return res.status(404).json({ error: 'Seller not found for this order.' });
    }
    const windowCheck = checkCallingWindow();

    if (!windowCheck.isAllowedNow && !req.body.override_night_window) {
      return res.status(403).json({
        error: 'Night Window Policy Active (9:30 PM - 8:30 AM IST). Call queued for 9:00 AM morning batch.',
        windowCheck
      });
    }

    // live defaults to true. An explicit live=false is only honoured
    // by triggerOutboundCall when SHIPVERA_ALLOW_SIMULATED_CALLS=true;
    // otherwise it throws and no simulated outcome is applied.
    const callResult = await triggerOutboundCall({
      order,
      seller,
      forcedIntent: forced_intent,
      live: live === undefined ? true : Boolean(live),
      recipientPhone: recipient_phone
    });

    // If live call was dispatched, it will be completed asynchronously via webhook
    if (callResult.live) {
      const updatedOrder = db.getOrderById(order.id);
      return res.status(200).json({
        success: true,
        message: 'Live voice call initiated via Sarvam Voice Agents',
        live: true,
        executionId: callResult.executionId,
        order: updatedOrder,
        callResult
      });
    }

    // No simulated outcome is ever applied here. If this was an
    // opt-in simulation, report it as such without changing the order
    // outcome; a real outcome arrives via the voice webhook.
    if (callResult.simulated) {
      return res.status(200).json({
        success: true,
        simulated: true,
        warning: 'SIMULATION ONLY - no real call was placed and no buyer outcome was applied.',
        order: db.getOrderById(order.id),
        callResult
      });
    }

    const updatedOrder = db.getOrderById(order.id);

    return res.status(200).json({
      success: true,
      order: updatedOrder,
      callResult
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/orders/queue
 * Returns real-time status of the autonomous background job queue
 */
router.get('/queue/jobs', (req, res) => {
  try {
    const jobs = db.getQueueJobs(50);
    const windowCheck = checkCallingWindow();
    return res.status(200).json({
      success: true,
      count: jobs.length,
      windowCheck,
      jobs
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
