/**
 * Shipvera Wallet & Billing API
 * PRD Section 1.4 Pricing & Wallet Architecture
 */

const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { recordRechargeCredit } = require('../services/walletLedger');

/**
 * GET /api/wallet
 * Returns current wallet balance, credit value, and plan tier
 */
router.get('/', (req, res) => {
  try {
    const sellerId = req.headers['x-seller-id'] || req.query.seller_id || null;
    const seller = db.getSeller(sellerId) || {
      id: sellerId || 'sel_guest',
      brand_name: 'My Store',
      wallet_balance_inr: 0.00,
      plan_tier: 'pay_as_you_go',
      upi_trust_lock_amount: 19
    };
    const availableVerifications = Math.floor((seller.wallet_balance_inr || 0) / 6);

    return res.status(200).json({
      success: true,
      wallet: {
        seller_id: seller.id,
        balance_inr: seller.wallet_balance_inr || 0.00,
        available_verifications: availableVerifications,
        cost_per_order_inr: 6.00,
        plan_tier: seller.plan_tier || 'pay_as_you_go',
        upi_trust_lock_amount: seller.upi_trust_lock_amount || 19,
        brand_name: seller.brand_name || 'My Store'
      },
      recharge_packs: [
        { id: 'starter', name: 'Starter Pack', price_inr: 999, credits: 180, per_order_effective: '₹5.50' },
        { id: 'growth', name: 'Growth Pack (Popular)', price_inr: 2999, credits: 600, per_order_effective: '₹5.00' },
        { id: 'scale', name: 'Scale Enterprise', price_inr: 8999, credits: 2000, per_order_effective: '₹4.50' }
      ]
    });
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
 * Adds credits via recharge pack with double-entry ledger entry
 */
router.post('/recharge', (req, res) => {
  try {
    const { pack_id, custom_amount, payment_id } = req.body;
    let amountToAdd = 0;
    let packName = 'Custom';

    if (pack_id === 'starter') {
      amountToAdd = 999;
      packName = 'Starter';
    } else if (pack_id === 'growth') {
      amountToAdd = 2999;
      packName = 'Growth';
    } else if (pack_id === 'scale') {
      amountToAdd = 8999;
      packName = 'Scale';
    } else if (custom_amount && Number(custom_amount) >= 100) {
      amountToAdd = Number(custom_amount);
      packName = 'Custom Amount';
    } else {
      return res.status(400).json({ error: 'Valid pack_id ("starter" | "growth" | "scale") or custom_amount >= ₹100 required' });
    }

    const seller = db.getSeller();
    const txn = recordRechargeCredit({
      sellerId: seller.id,
      amount: amountToAdd,
      packName,
      paymentId: payment_id || `razorpay_${Date.now()}`
    });

    const updatedSeller = db.getSeller(seller.id);

    return res.status(200).json({
      success: true,
      message: `Successfully recharged ₹${amountToAdd}. New balance: ₹${updatedSeller.wallet_balance_inr}`,
      wallet_balance_inr: updatedSeller.wallet_balance_inr,
      available_verifications: Math.floor(updatedSeller.wallet_balance_inr / 6),
      transaction: txn
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
