/**
 * TrustOrder Double-Entry Financial Ledger
 * Strict Production Standards:
 * - Pricing: Voice ₹12 ex-GST per verified order, OTP/WhatsApp ₹3 ex-GST
 * - Voice floor: Never price voice below ₹8 ex-GST
 * - Charge only on real disposition: confirmed, corrected, cancelled
 * - Free: unanswered, busy, DND, carrier-failed, AI error, voicemail under 10s
 * - Zero free credits. One-time trial ₹99 for 10 credits (14-day validity)
 * - +18% GST at checkout, minimum recharge ₹500 ex-GST
 * - Subscriptions rollover max 50 credits
 * - ₹19 Trust Lock: Seller's money, held in trust balance, bulk weekly settlement (min ₹500)
 */

const crypto = require('crypto');
const { db } = require('../db');

const PRICING = {
  VOICE_RATE_EX_GST: 12.00,
  OTP_RATE_EX_GST: 3.00,
  VOICE_FLOOR_EX_GST: 8.00,
  GST_RATE_PERCENT: 18,
  MINIMUM_RECHARGE_EX_GST: 500.00,
  TRIAL: {
    PRICE_EX_GST: 99.00,
    CREDITS: 10,
    VALIDITY_DAYS: 14
  },
  PACKS: [
    { id: 'trial', name: 'One-Time Store Trial', price_ex_gst: 99, credits: 10, channel: 'voice', validity_days: 14, trial: true },
    { id: 'voice_100', name: '100 Voice Credits Pack', price_ex_gst: 999, credits: 100, channel: 'voice' },
    { id: 'voice_500', name: '500 Voice Credits Pack', price_ex_gst: 4499, credits: 500, channel: 'voice' },
    { id: 'voice_1000', name: '1,000 Voice Credits Pack', price_ex_gst: 7999, credits: 1000, channel: 'voice' },
    { id: 'otp_500', name: '500 OTP Pack', price_ex_gst: 1000, credits: 500, channel: 'otp' }
  ],
  SUBSCRIPTIONS: [
    { id: 'sub_starter', name: 'Starter Monthly', price_ex_gst: 999, voice_credits: 100, otp_credits: 0, rollover_max: 50 },
    { id: 'sub_growth', name: 'Growth Monthly', price_ex_gst: 2999, voice_credits: 350, otp_credits: 0, rollover_max: 50 },
    { id: 'sub_scale', name: 'Scale Monthly', price_ex_gst: 7999, voice_credits: 1000, otp_credits: 0, rollover_max: 50 },
    { id: 'sub_reseller', name: 'Reseller Tier', price_ex_gst: 299, voice_credits: 10, otp_credits: 100, rollover_max: 50 }
  ]
};

/**
 * Calculates GST (+18%) and total checkout amount for Razorpay
 */
function calculateGstCheckout(amountExGst) {
  const base = Number(amountExGst);
  if (!Number.isFinite(base) || base <= 0) {
    throw new Error('Valid base amount in INR required for checkout calculation');
  }
  const gstAmount = Number((base * (PRICING.GST_RATE_PERCENT / 100)).toFixed(2));
  const totalAmount = Number((base + gstAmount).toFixed(2));
  return {
    base_amount_ex_gst: base,
    gst_percent: PRICING.GST_RATE_PERCENT,
    gst_amount: gstAmount,
    total_amount_inr: totalAmount,
    total_paise: Math.round(totalAmount * 100)
  };
}

/**
 * Checks whether call disposition is billable.
 * Only confirmed, corrected, or cancelled are billable.
 * Unanswered, busy, DND, carrier-failed, AI error, voicemail hangup under 10s are ₹0 FREE.
 */
function isBillableDisposition(disposition) {
  if (!disposition) return false;
  const d = String(disposition).toLowerCase().trim();
  const billable = [
    'confirmed',
    'verified_genuine',
    'corrected',
    'address_cleaned',
    'cancelled',
    'cancel_requested'
  ];
  return billable.includes(d);
}

/**
 * Deducts usage fee strictly on billable dispositions
 */
function recordUsageDebit({ sellerId, amount = null, channel = 'voice', disposition, referenceId, meta = {}, durationSeconds = 0 }) {
  const seller = db.getSeller(sellerId);
  if (!seller) {
    throw new Error(`Seller ${sellerId} not found`);
  }

  // Voicemail or hangup under 10 seconds is strictly free
  if (durationSeconds > 0 && durationSeconds < 10) {
    console.log(`[LEDGER] Call hangup under 10s (${durationSeconds}s) for seller ${seller.brand_name} - FREE (No deduction)`);
    return { billed: false, amount: 0, reason: 'Voicemail or hangup under 10 seconds' };
  }

  // Real disposition check
  if (!isBillableDisposition(disposition)) {
    console.log(`[LEDGER] Non-billable disposition "${disposition}" for seller ${seller.brand_name} - FREE (No deduction)`);
    return { billed: false, amount: 0, reason: `Free disposition: ${disposition}` };
  }

  // Check trial validity expiry if on trial
  if (seller.trial_active && seller.trial_expires_at) {
    if (new Date() > new Date(seller.trial_expires_at)) {
      seller.trial_active = false;
      db.save();
      const err = new Error('Trial period has expired (14-day validity). Please recharge your wallet.');
      err.code = 'TRIAL_EXPIRED';
      throw err;
    }
  }

  // Compute rate with voice floor enforcement or explicit custom fee (e.g. recovery commission)
  let rate;
  if (amount !== null && amount !== undefined && Number(amount) > 0) {
    rate = Number(amount);
  } else if (channel === 'otp' || channel === 'whatsapp') {
    rate = PRICING.OTP_RATE_EX_GST;
  } else {
    rate = Math.max(PRICING.VOICE_FLOOR_EX_GST, PRICING.VOICE_RATE_EX_GST);
  }

  const currentBalance = Number(seller.wallet_balance_inr) || 0;
  if (currentBalance < rate) {
    const err = new Error(`Insufficient wallet balance. Current: ₹${currentBalance}, Required: ₹${rate}`);
    err.code = 'INSUFFICIENT_FUNDS';
    throw err;
  }

  const newBalance = Number((currentBalance - rate).toFixed(2));
  seller.wallet_balance_inr = newBalance;
  db.save();

  const txn = {
    id: crypto.randomUUID(),
    seller_id: sellerId,
    type: 'DEBIT',
    amount: -rate,
    balance_before: currentBalance,
    balance_after: newBalance,
    purpose: channel === 'voice' ? 'VOICE_VERIFICATION_DEBIT' : 'OTP_WHATSAPP_DEBIT',
    reference_id: referenceId || null,
    meta: {
      channel,
      disposition,
      duration_seconds: durationSeconds,
      ...meta
    },
    created_at: new Date().toISOString()
  };

  db.recordWalletTransaction(txn);
  console.log(`[LEDGER] DEBIT ₹${rate} for ${seller.brand_name} (${disposition}) | New Balance: ₹${newBalance}`);
  return { billed: true, amount: rate, transaction: txn };
}

/**
 * Credits wallet on recharge or plan purchase
 */
function recordRechargeCredit({ sellerId, amountExGst, packId, paymentId, paymentGateway = 'Razorpay' }) {
  const seller = db.getSeller(sellerId);
  if (!seller) {
    throw new Error(`Seller ${sellerId} not found`);
  }

  const base = Number(amountExGst);
  if (!Number.isFinite(base) || base <= 0) {
    throw new Error('Valid recharge amount required');
  }

  // Handle one-time trial validation
  if (packId === 'trial') {
    if (seller.trial_used) {
      const err = new Error('Trial is available only once per store.');
      err.code = 'TRIAL_ALREADY_USED';
      throw err;
    }
    seller.trial_used = true;
    seller.trial_active = true;
    seller.trial_expires_at = new Date(Date.now() + PRICING.TRIAL.VALIDITY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  }

  const currentBalance = Number(seller.wallet_balance_inr) || 0;
  const newBalance = Number((currentBalance + base).toFixed(2));
  seller.wallet_balance_inr = newBalance;
  db.save();

  const checkout = calculateGstCheckout(base);

  const txn = {
    id: crypto.randomUUID(),
    seller_id: sellerId,
    type: 'CREDIT',
    amount: base,
    balance_before: currentBalance,
    balance_after: newBalance,
    purpose: `WALLET_RECHARGE_${(packId || 'CUSTOM').toUpperCase()}`,
    reference_id: paymentId || `pay_${Date.now()}`,
    meta: {
      pack_id: packId || 'custom',
      base_amount_ex_gst: base,
      gst_amount: checkout.gst_amount,
      total_paid_inr: checkout.total_amount_inr,
      payment_gateway: paymentGateway,
      payment_id: paymentId
    },
    created_at: new Date().toISOString()
  };

  db.recordWalletTransaction(txn);
  console.log(`[LEDGER] CREDIT +₹${base} for ${seller.brand_name} (Total Paid incl GST: ₹${checkout.total_amount_inr})`);
  return { transaction: txn, checkout, new_balance: newBalance };
}

/**
 * Records collection of ₹19 Trust Lock into seller's dedicated trust lock balance.
 * (Seller's money, NOT TrustOrder revenue).
 */
function recordTrustLockCollection({ sellerId, orderId, paymentId, amount = 19 }) {
  const seller = db.getSeller(sellerId);
  if (!seller) throw new Error(`Seller ${sellerId} not found`);

  const currentTrustBalance = Number(seller.trust_lock_balance_inr) || 0;
  const newTrustBalance = Number((currentTrustBalance + amount).toFixed(2));
  seller.trust_lock_balance_inr = newTrustBalance;
  db.save();

  db.createTrustLockPayment({
    sellerId,
    orderId,
    amount,
    razorpayPaymentId: paymentId,
    status: 'collected'
  });

  console.log(`[TRUST_LOCK] ₹${amount} collected for seller ${seller.brand_name} | Trust Balance: ₹${newTrustBalance}`);
  return { new_trust_balance: newTrustBalance };
}

/**
 * Bulk weekly settlement of ₹19 Trust Lock payments.
 * Minimum ₹500 required. Payout fee borne by seller.
 */
function settleTrustLockBalance({ sellerId, payoutMethod = 'UPI/NEFT' }) {
  const seller = db.getSeller(sellerId);
  if (!seller) throw new Error(`Seller ${sellerId} not found`);

  const currentTrustBalance = Number(seller.trust_lock_balance_inr) || 0;
  if (currentTrustBalance < 500) {
    const err = new Error(`Minimum weekly settlement amount is ₹500. Current trust balance: ₹${currentTrustBalance.toFixed(2)}`);
    err.code = 'MINIMUM_SETTLEMENT_NOT_MET';
    throw err;
  }

  const settledAmount = currentTrustBalance;
  seller.trust_lock_balance_inr = 0.00;
  db.save();

  const batch = db.settleTrustLockPayments(sellerId);

  console.log(`[TRUST_LOCK_SETTLEMENT] Settled ₹${settledAmount} for ${seller.brand_name} (Batch ${batch.batchId})`);
  return {
    success: true,
    settled_amount: settledAmount,
    batch_id: batch.batchId,
    count: batch.settledCount,
    payout_note: 'Bulk weekly settlement initiated. Razorpay payout gateway fee borne by seller.'
  };
}

/**
 * Applies subscription monthly rollover rule:
 * Maximum 50 credits roll over, remaining expire.
 */
function applySubscriptionRollover({ sellerId, maxRollover = 50 }) {
  const seller = db.getSeller(sellerId);
  if (!seller) throw new Error(`Seller ${sellerId} not found`);

  const currentBalance = Number(seller.wallet_balance_inr) || 0;
  // Estimate credit equivalent at standard rate
  const creditEquivalent = currentBalance / PRICING.VOICE_RATE_EX_GST;
  if (creditEquivalent > maxRollover) {
    const allowedRolloverInr = Number((maxRollover * PRICING.VOICE_RATE_EX_GST).toFixed(2));
    const expiredInr = Number((currentBalance - allowedRolloverInr).toFixed(2));
    seller.wallet_balance_inr = allowedRolloverInr;
    db.save();

    const txn = {
      id: crypto.randomUUID(),
      seller_id: sellerId,
      type: 'DEBIT',
      amount: -expiredInr,
      balance_before: currentBalance,
      balance_after: allowedRolloverInr,
      purpose: 'SUBSCRIPTION_CREDIT_EXPIRY_ROLLOVER_CAP',
      reference_id: `rollover_${Date.now()}`,
      meta: { max_rollover_credits: maxRollover, expired_inr: expiredInr },
      created_at: new Date().toISOString()
    };
    db.recordWalletTransaction(txn);
    return { rolled_over: allowedRolloverInr, expired: expiredInr };
  }
  return { rolled_over: currentBalance, expired: 0 };
}

module.exports = {
  PRICING,
  calculateGstCheckout,
  isBillableDisposition,
  recordUsageDebit,
  recordRechargeCredit,
  recordTrustLockCollection,
  settleTrustLockBalance,
  applySubscriptionRollover
};
