/**
 * TrustOrder RTO Recovery API Routes
 * Production-ready Prepaid Recovery Management
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { db } = require('../db');
const {
  calculateWorthIt,
  evaluateQcGate,
  triggerRecoveryAttempt,
  handleRecoveryPaymentPaid,
  approveReshipment,
  DEFAULTS
} = require('../services/recoveryEngine');

function verifyRazorpayWebhookSignature(req, res, next) {
  const signature = req.headers['x-razorpay-signature'];
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    return res.status(500).json({ error: 'RAZORPAY_WEBHOOK_SECRET is not configured. Webhook rejected.' });
  }
  if (!signature || !req.rawBody) {
    return res.status(401).json({ error: 'Razorpay signature or raw body missing.' });
  }
  const expected = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  let ok = false;
  try {
    ok = expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch (e) {
    ok = false;
  }
  if (!ok) {
    return res.status(401).json({ error: 'Razorpay webhook signature mismatch' });
  }
  next();
}

/**
 * GET /api/recovery/orders
 * Lists RTO returned orders with QC status, sunk cost, and worth-it readiness
 */
router.get('/orders', (req, res) => {
  try {
    const sellerId = req.headers['x-seller-id'] || req.query.seller_id;
    const orders = db.getOrders();
    const sellerOrders = orders.filter(o => {
      const matchSeller = sellerId ? o.seller_id === sellerId : true;
      const isRto = o.verification_status === 'rto_returned' || 
                    o.verification_status === 'rto_recovered_reshipped' ||
                    (o.tags && o.tags.some(t => /rto/i.test(t)));
      return matchSeller && isRto;
    });

    const enriched = sellerOrders.map(o => {
      const productPrice = Number(o.cod_amount || 0);
      let worthItCalc = null;
      if (productPrice > 0) {
        try {
          worthItCalc = calculateWorthIt({
            productPrice,
            qcStatus: o.return_qc_status || 'undamaged'
          });
        } catch (e) {}
      }
      return {
        ...o,
        sunk_rto_cost: o.sunk_rto_cost || 120.00,
        return_qc_status: o.return_qc_status || 'pending',
        worth_it_preview: worthItCalc
      };
    });

    return res.status(200).json({
      success: true,
      count: enriched.length,
      orders: enriched
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/recovery/attempts
 * Returns append-only recovery attempt log
 */
router.get('/attempts', (req, res) => {
  try {
    const sellerId = req.headers['x-seller-id'] || req.query.seller_id;
    const attempts = db.getRecoveryAttempts(sellerId);
    return res.status(200).json({
      success: true,
      count: attempts.length,
      attempts
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/recovery/stats
 * Aggregates recovered revenue, commissions, and RTO loss avoided
 */
router.get('/stats', (req, res) => {
  try {
    const sellerId = req.headers['x-seller-id'] || req.query.seller_id;
    const stats = db.getRecoveryStats(sellerId);
    return res.status(200).json({
      success: true,
      stats
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/recovery/calculate
 * Computes the Worth-It formula on-the-fly for preview
 */
router.post('/calculate', (req, res) => {
  try {
    const {
      product_price,
      discount_percent,
      forward_shipping,
      packaging,
      call_cost,
      qc_status,
      new_product_cost
    } = req.body;

    const result = calculateWorthIt({
      productPrice: product_price,
      discountPercent: discount_percent,
      forwardShipping: forward_shipping,
      packaging,
      callCost: call_cost,
      qcStatus: qc_status,
      newProductCost: new_product_cost
    });

    return res.status(200).json({ success: true, calculation: result });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/recovery/mark-qc
 * Seller marks return QC as undamaged or damaged
 */
router.post('/mark-qc', (req, res) => {
  try {
    const { order_id, qc_status } = req.body;
    if (!order_id || !qc_status) {
      return res.status(400).json({ error: 'order_id and qc_status ("undamaged" | "damaged") are required' });
    }

    const order = db.getOrderById(order_id);
    if (!order) {
      return res.status(404).json({ error: `Order ${order_id} not found` });
    }

    const qcEvaluation = evaluateQcGate(qc_status);
    if (!qcEvaluation.passed) {
      return res.status(400).json({ error: 'qc_status must be either "undamaged" or "damaged"' });
    }

    order.return_qc_status = qc_status;
    db.save();

    return res.status(200).json({
      success: true,
      message: `Return QC marked as ${qc_status}`,
      order
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/recovery/trigger
 * Initiates prepaid recovery attempt (Checks QC gate, Worth-It gate, live keys)
 */
router.post('/trigger', async (req, res) => {
  try {
    const {
      order_id,
      qc_status,
      discount_percent,
      new_product_cost,
      forward_shipping,
      packaging,
      call_cost
    } = req.body;

    const sellerId = req.headers['x-seller-id'] || req.body.seller_id;
    if (!order_id) {
      return res.status(400).json({ error: 'order_id is required' });
    }

    const result = await triggerRecoveryAttempt({
      orderId: order_id,
      sellerId,
      qcStatus: qc_status,
      discountPercent: discount_percent,
      newProductCost: new_product_cost,
      forwardShipping: forward_shipping,
      packaging,
      callCost: call_cost
    });

    const statusCode = result.success ? 200 : (result.mode === 'not_configured' ? 503 : 422);
    return res.status(statusCode).json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/recovery/approve-reship
 * 1-Click Seller Reshipment Approval (Strict COD Prevention)
 */
router.post('/approve-reship', (req, res) => {
  try {
    const { recovery_attempt_id, payment_mode, updated_address } = req.body;
    const sellerId = req.headers['x-seller-id'] || req.body.seller_id;

    if (!recovery_attempt_id) {
      return res.status(400).json({ error: 'recovery_attempt_id is required' });
    }

    const result = approveReshipment({
      recoveryAttemptId: recovery_attempt_id,
      sellerId,
      paymentMode: payment_mode || 'PREPAID',
      updatedAddress: updated_address
    });

    return res.status(200).json(result);
  } catch (err) {
    const status = err.code === 'COD_RESHIPMENT_FORBIDDEN' ? 403 :
                   err.code === 'RECOVERY_NOT_PAID' ? 402 : 400;
    return res.status(status).json({ error: err.message, code: err.code });
  }
});

/**
 * POST /api/recovery/settings
 * Updates seller settings for recovery
 */
router.post('/settings', (req, res) => {
  try {
    const sellerId = req.headers['x-seller-id'] || req.body.seller_id;
    if (!sellerId) return res.status(400).json({ error: 'seller_id is required' });

    const seller = db.getSeller(sellerId);
    if (!seller) return res.status(404).json({ error: 'Seller not found' });

    const { discount_max, min_product_price, auto_approve } = req.body;
    if (discount_max !== undefined) seller.recovery_discount_max = Number(discount_max);
    if (min_product_price !== undefined) seller.recovery_min_product_price = Number(min_product_price);
    if (auto_approve !== undefined) seller.recovery_auto_approve = Boolean(auto_approve);
    db.save();

    return res.status(200).json({
      success: true,
      settings: {
        recovery_discount_max: seller.recovery_discount_max || DEFAULTS.MAX_DISCOUNT_PERCENT,
        recovery_min_product_price: seller.recovery_min_product_price || 300,
        recovery_auto_approve: Boolean(seller.recovery_auto_approve)
      }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/recovery/webhook/razorpay
 * Webhook confirmation for recovery payments
 */
router.post('/webhook/razorpay', verifyRazorpayWebhookSignature, (req, res) => {
  try {
    const payload = req.body || {};
    const payment = payload.payload?.payment?.entity || {};
    const paymentLinkId = payload.payload?.payment_link?.entity?.id || payment.payment_link_id;
    const paymentId = payment.id;

    if (!paymentLinkId) {
      return res.status(400).json({ error: 'payment_link_id missing from webhook payload' });
    }

    const result = handleRecoveryPaymentPaid({
      paymentLinkId,
      razorpayPaymentId: paymentId
    });

    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
