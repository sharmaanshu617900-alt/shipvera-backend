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

    // Trigger Outbound Voice AI Call
    let callResult = null;
    if (windowCheck.isAllowedNow && seller.wallet_balance_inr >= 6.00) {
      callResult = await triggerOutboundCall({ order, seller });
      // Apply immediate resolution based on simulated result
      if (callResult.intent === 'VERIFIED_GENUINE') {
        applyPostCallDecision({
          orderId: order.id,
          buyerIntent: 'VERIFIED_GENUINE',
          spokenText: 'Haan 56 dukan ke piche Bikaner sweets ke samne red gate hai',
          sellerId: seller.id
        });
      } else if (callResult.intent === 'CANCEL_REQUESTED') {
        applyPostCallDecision({
          orderId: order.id,
          buyerIntent: 'CANCEL_REQUESTED',
          sellerId: seller.id
        });
      } else {
        generateTrustLock({ order, seller });
      }
    }

    const freshOrder = db.getOrderById(order.id);

    return res.status(201).json({
      success: true,
      message: 'Quick-paste order successfully parsed and verified',
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
    const windowCheck = checkCallingWindow();

    if (!windowCheck.isAllowedNow && !req.body.override_night_window) {
      return res.status(403).json({
        error: 'Night Window Policy Active (9:30 PM - 8:30 AM IST). Call queued for 9:00 AM morning batch.',
        windowCheck
      });
    }

    const callResult = await triggerOutboundCall({
      order,
      seller,
      forcedIntent: forced_intent,
      live: Boolean(live),
      recipientPhone: recipient_phone
    });

    // If live call was dispatched, it will be completed asynchronously via webhook
    if (callResult.live) {
      const updatedOrder = db.getOrderById(order.id);
      return res.status(200).json({
        success: true,
        message: 'Live voice call initiated via Bolna AI',
        live: true,
        executionId: callResult.executionId,
        order: updatedOrder,
        callResult
      });
    }

    // Apply outcome resolution for simulated calls
    if (callResult.intent === 'VERIFIED_GENUINE') {
      await applyPostCallDecision({
        orderId: order.id,
        buyerIntent: 'VERIFIED_GENUINE',
        spokenText: 'Sharma dairy ke left yellow house plot 42',
        sellerId: seller.id
      });
    } else if (callResult.intent === 'CANCEL_REQUESTED') {
      await applyPostCallDecision({
        orderId: order.id,
        buyerIntent: 'CANCEL_REQUESTED',
        sellerId: seller.id
      });
    } else {
      generateTrustLock({ order, seller });
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
