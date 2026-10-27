/**
 * TrustOrder Wallet & Billing API
 * Exact Part 3 Pricing Implementation
 * Razorpay Only, +18% GST at checkout, No Free Credits
 */

const express = require('express');
const router = express.Router();
const { db } = require('../db');
const {
  PRICING,
  calculateGstCheckout,
  recordRechargeCredit,
  settleTrustLockBalance
} = require('../services/walletLedger');

/**
 * GET /api/wallet
 * Returns current wallet balance, credit values, trial status, and Trust Lock funds
 */
router.get('/', (req, res) => {
  try {
    const sellerId = req.headers['x-seller-id'] || req.query.seller_id || null;
    const seller = db.getSeller(sellerId) || {
      id: sellerId || 'sel_guest',
      brand_name: 'My Store',
      wallet_balance_inr: 0.00,
      trust_lock_balance_inr: 0.00,
      plan_tier: 'free_rto_audit',
      trial_used: false,
      trial_active: false
    };

    const balance = Number(seller.wallet_balance_inr) || 0.00;
    const voiceVerifications = Math.floor(balance / PRICING.VOICE_RATE_EX_GST);
    const otpVerifications = Math.floor(balance / PRICING.OTP_RATE_EX_GST);

    return res.status(200).json({
      success: true,
      wallet: {
        seller_id: seller.id,
        balance_inr: balance,
        trust_lock_balance_inr: Number(seller.trust_lock_balance_inr) || 0.00,
        voice_rate_ex_gst: PRICING.VOICE_RATE_EX_GST,
        otp_rate_ex_gst: PRICING.OTP_RATE_EX_GST,
        voice_floor_ex_gst: PRICING.VOICE_FLOOR_EX_GST,
        available_voice_verifications: voiceVerifications,
        available_otp_verifications: otpVerifications,
        plan_tier: seller.plan_tier || 'free_rto_audit',
        trial_used: Boolean(seller.trial_used),
        trial_active: Boolean(seller.trial_active),
        trial_expires_at: seller.trial_expires_at || null,
        brand_name: seller.brand_name || 'My Store'
      },
      pricing: {
        free_tier: {
          name: 'Free RTO Audit',
          description: 'Risk score for all orders, no free credits',
          credits: 0
        },
        trial: PRICING.TRIAL,
        pay_as_you_go: {
          voice_rate_ex_gst: PRICING.VOICE_RATE_EX_GST,
          otp_rate_ex_gst: PRICING.OTP_RATE_EX_GST,
          minimum_recharge_ex_gst: PRICING.MINIMUM_RECHARGE_EX_GST,
          gst_percent: PRICING.GST_RATE_PERCENT
        },
        packs: PRICING.PACKS,
        subscriptions: PRICING.SUBSCRIPTIONS,
        annual_discount: 'Pay 10 months, get 12 months (2 months free)',
        rollover_rule: 'Maximum 50 credits on subscriptions, rest expire'
      }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/wallet/quote
 * Calculates checkout price with +18% GST for Razorpay
 */
router.post('/quote', (req, res) => {
  try {
    const { pack_id, custom_amount_ex_gst } = req.body;
    let baseAmount = 0;

    if (pack_id) {
      const pack = PRICING.PACKS.find(p => p.id === pack_id);
      if (pack) {
        baseAmount = pack.price_ex_gst;
      } else {
        const sub = PRICING.SUBSCRIPTIONS.find(s => s.id === pack_id);
        if (sub) {
          baseAmount = sub.price_ex_gst;
        } else {
          return res.status(400).json({ error: `Unknown pack_id: ${pack_id}` });
        }
      }
    } else if (custom_amount_ex_gst) {
      baseAmount = Number(custom_amount_ex_gst);
      if (baseAmount < PRICING.MINIMUM_RECHARGE_EX_GST) {
        return res.status(400).json({
          error: `Minimum PAYG recharge is ₹${PRICING.MINIMUM_RECHARGE_EX_GST} ex-GST (+18% GST).`
        });
      }
    } else {
      return res.status(400).json({ error: 'pack_id or custom_amount_ex_gst is required' });
    }

    const quote = calculateGstCheckout(baseAmount);
    return res.status(200).json({ success: true, quote });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/wallet/transactions
 * Returns immutable audit trail of debits and credits
 */
router.get('/transactions', (req, res) => {
  try {
    const sellerId = req.headers['x-seller-id'] || req.query.seller_id || null;
    const seller = db.getSeller(sellerId) || { id: sellerId || 'sel_guest', wallet_balance_inr: 0.00 };
    const transactions = seller.id ? db.getWalletTransactions(seller.id) : [];
    return res.status(200).json({
      success: true,
      count: transactions.length,
      current_balance_inr: seller.wallet_balance_inr || 0.00,
      transactions
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/wallet/recharge
 * Processes recharge or pack credit addition with double-entry ledger entry
 */
router.post('/recharge', (req, res) => {
  try {
    const { pack_id, custom_amount_ex_gst, payment_id } = req.body;
    let baseAmount = 0;

    if (pack_id === 'trial') {
      baseAmount = PRICING.TRIAL.PRICE_EX_GST;
    } else if (pack_id) {
      const pack = PRICING.PACKS.find(p => p.id === pack_id);
      if (!pack) {
        const sub = PRICING.SUBSCRIPTIONS.find(s => s.id === pack_id);
        if (!sub) return res.status(400).json({ error: `Unknown pack_id: ${pack_id}` });
        baseAmount = sub.price_ex_gst;
      } else {
        baseAmount = pack.price_ex_gst;
      }
    } else if (custom_amount_ex_gst) {
      baseAmount = Number(custom_amount_ex_gst);
      if (baseAmount < PRICING.MINIMUM_RECHARGE_EX_GST) {
        return res.status(400).json({
          error: `Minimum recharge is ₹${PRICING.MINIMUM_RECHARGE_EX_GST} ex-GST (+18% GST).`
        });
      }
    } else {
      return res.status(400).json({ error: 'Valid pack_id or custom_amount_ex_gst is required' });
    }

    const sellerId = req.headers['x-seller-id'] || req.body.seller_id;
    if (!sellerId) {
      return res.status(400).json({ error: 'seller_id is required in body or x-seller-id header' });
    }
    const seller = db.getSeller(sellerId);
    if (!seller) {
      return res.status(404).json({ error: 'Seller workspace not found' });
    }

    const result = recordRechargeCredit({
      sellerId: seller.id,
      amountExGst: baseAmount,
      packId: pack_id || 'custom',
      paymentId: payment_id || null
    });

    const updatedSeller = db.getSeller(seller.id);

    return res.status(200).json({
      success: true,
      message: `Successfully recharged ₹${baseAmount} ex-GST. Paid with GST: ₹${result.checkout.total_amount_inr}. New balance: ₹${updatedSeller.wallet_balance_inr}`,
      wallet_balance_inr: updatedSeller.wallet_balance_inr,
      available_voice_verifications: Math.floor(updatedSeller.wallet_balance_inr / PRICING.VOICE_RATE_EX_GST),
      checkout: result.checkout,
      transaction: result.transaction
    });
  } catch (err) {
    const status = err.code === 'TRIAL_ALREADY_USED' ? 409 : 500;
    return res.status(status).json({ error: err.message, code: err.code });
  }
});

/**
 * POST /api/wallet/settle-trust-lock
 * Bulk weekly settlement of ₹19 Trust Lock payments.
 * Minimum ₹500 required. Payout fee borne by seller.
 */
router.post('/settle-trust-lock', (req, res) => {
  try {
    const sellerId = req.headers['x-seller-id'] || req.body.seller_id;
    if (!sellerId) {
      return res.status(400).json({ error: 'seller_id is required' });
    }
    const result = settleTrustLockBalance({ sellerId });
    return res.status(200).json({ success: true, result });
  } catch (err) {
    const status = err.code === 'MINIMUM_SETTLEMENT_NOT_MET' ? 400 : 500;
    return res.status(status).json({ error: err.message, code: err.code });
  }
});

module.exports = router;
