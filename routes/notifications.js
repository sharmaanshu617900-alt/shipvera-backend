/**
 * TrustOrder Notifications & Email Delivery Router (Resend API)
 */

const express = require('express');
const router = express.Router();
const emailService = require('../services/emailService');
const { db } = require('../db');

/**
 * GET /api/notifications/status
 * Check if Resend is configured and inspect sending identity
 */
router.get('/status', (req, res) => {
  const isConfigured = Boolean(process.env.RESEND_API_KEY);
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'TrustOrder Dispatch <onboarding@resend.dev>';

  res.json({
    service: 'Resend API',
    configured: isConfigured,
    from: fromEmail,
    missing: isConfigured ? null : ['RESEND_API_KEY'],
    features: [
      'daily_savings_digest',
      'low_balance_alert',
      'rto_recovery_alert',
      'test_email'
    ]
  });
});

/**
 * POST /api/notifications/test-email
 * Dispatch a live test email via Resend to verify API key
 */
router.post('/test-email', async (req, res) => {
  try {
    const { to } = req.body || {};
    if (!to || !to.includes('@')) {
      return res.status(400).json({
        success: false,
        error: 'Recipient email address ("to") is required.'
      });
    }

    if (!process.env.RESEND_API_KEY) {
      return res.status(503).json({
        success: false,
        mode: 'not_configured',
        missing: 'RESEND_API_KEY',
        message: 'RESEND_API_KEY is not set in environment variables.'
      });
    }

    const result = await emailService.sendTestEmail({ toEmail: to });
    if (!result.success) {
      return res.status(result.statusCode || 500).json(result);
    }

    res.json({
      success: true,
      message: `Test email successfully dispatched to ${to} via Resend.`,
      result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/notifications/daily-digest
 * Manually trigger daily savings digest for a seller
 */
router.post('/daily-digest', async (req, res) => {
  try {
    const { sellerId, toEmail } = req.body || {};
    const seller = sellerId ? db.getSeller(sellerId) : null;
    const recipient = toEmail || (seller && seller.email);

    if (!recipient) {
      return res.status(400).json({
        success: false,
        error: 'Recipient email ("toEmail") or valid sellerId with email is required.'
      });
    }

    // Compute real metrics from database
    const orders = sellerId ? db.getOrders(sellerId) : [];
    const fakeBlocked = orders.filter(o => o.verification_status === 'cancelled_fake').length;
    const cleanAddressCount = orders.filter(o => o.cleaned_address_line1).length;
    const moneySavedInr = orders.reduce((sum, o) => sum + (Number(o.rto_money_saved) || 0), 0);

    const result = await emailService.sendDailySavingsDigest({
      toEmail: recipient,
      sellerBrand: seller ? (seller.brand_name || seller.name) : 'TrustOrder Partner',
      totalOrders: orders.length,
      fakeBlocked,
      moneySavedInr,
      cleanAddressCount
    });

    if (!result.success) {
      return res.status(result.statusCode || 500).json(result);
    }

    res.json({
      success: true,
      message: `Daily savings digest sent to ${recipient}`,
      result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
