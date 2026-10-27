/**
 * TrustOrder RTO Recovery Engine
 * Billionaire Backend Architecture:
 * - PREPAID RECOVERY ONLY. COD RECOVERY NEVER.
 * - Return QC Gate: Seller must mark product as 'undamaged' (reshippable) or 'damaged' (new product needed).
 * - Worth-It Gate: P > F + PK + C + CALL + NEW. If not, do NOT contact buyer.
 * - Buyer Contact: Voice call first, WhatsApp fallback within same credit.
 *   Ask only: why returned, is address correct, pay prepaid with discount?
 *   NEVER ask for card, UPI PIN, OTP, or bank details on call.
 * - Razorpay Prepaid Payment Link for discounted prepaid amount.
 * - Webhook confirmation: wait for paid webhook. Unpaid = no shipment, ₹0 commission.
 * - 10% commission charged ONLY on recovery_paid.
 * - Reshipment: Requires recovery_paid AND seller approval (default auto-approve OFF).
 * - Append-only logging to recovery_attempts.
 */

const crypto = require('crypto');
const https = require('https');
const { db } = require('../db');
const { recordUsageDebit } = require('./walletLedger');
const { triggerOutboundCall } = require('./voiceAI');
const { sendWhatsAppTrustLock } = require('./whatsappService');
const { createRazorpayPaymentLink } = require('./trustLock');

const DEFAULTS = {
  MAX_DISCOUNT_PERCENT: 10,
  DEFAULT_FORWARD_SHIPPING_INR: 80,
  DEFAULT_PACKAGING_INR: 20,
  DEFAULT_CALL_COST_INR: 7,
  COMMISSION_PERCENT: 10,
  AUTO_APPROVE_DEFAULT: false
};

/**
 * Calculates the exact Worth-It formula:
 * P = product selling price after discount
 * F = forward shipping for reshipment
 * PK = packaging cost
 * C = recovery commission (10% of P)
 * CALL = recovery call/WhatsApp cost
 * NEW = new product cost (only if returned product is damaged, else 0)
 *
 * Recover ONLY if: P > F + PK + C + CALL + NEW
 */
function calculateWorthIt({
  productPrice,
  discountPercent = 0,
  forwardShipping = DEFAULTS.DEFAULT_FORWARD_SHIPPING_INR,
  packaging = DEFAULTS.DEFAULT_PACKAGING_INR,
  callCost = DEFAULTS.DEFAULT_CALL_COST_INR,
  qcStatus = 'undamaged',
  newProductCost = 0
}) {
  const price = Number(productPrice);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error('Valid product price in INR required for worth-it calculation');
  }

  const discount = Math.max(0, Math.min(DEFAULTS.MAX_DISCOUNT_PERCENT, Number(discountPercent) || 0));
  const P = Number((price * (1 - discount / 100)).toFixed(2));
  const C = Number((P * (DEFAULTS.COMMISSION_PERCENT / 100)).toFixed(2));
  const F = Number(forwardShipping);
  const PK = Number(packaging);
  const CALL = Number(callCost);
  const NEW = qcStatus === 'damaged' ? Number(newProductCost || 0) : 0;

  const totalCost = Number((F + PK + C + CALL + NEW).toFixed(2));
  const netMargin = Number((P - totalCost).toFixed(2));
  const isWorthIt = P > totalCost;

  return {
    is_worth_it: isWorthIt,
    product_price_original: price,
    discount_percent: discount,
    prepaid_price_P: P,
    forward_shipping_F: F,
    packaging_PK: PK,
    commission_C: C,
    call_cost_CALL: CALL,
    new_product_cost_NEW: NEW,
    qc_status: qcStatus,
    total_cost: totalCost,
    net_margin: netMargin,
    formula: `P (${P}) > F (${F}) + PK (${PK}) + C (${C}) + CALL (${CALL}) + NEW (${NEW}) = ${totalCost}`,
    recommendation: isWorthIt ? 'PROCEED_WITH_RECOVERY' : 'DO_NOT_CONTACT_BUYER_NOT_WORTH_IT'
  };
}

/**
 * Evaluates Return QC Gate
 */
function evaluateQcGate(qcStatus) {
  if (qcStatus === 'undamaged') {
    return { passed: true, qc_status: 'undamaged', note: 'Product is undamaged and reshippable.' };
  }
  if (qcStatus === 'damaged') {
    return { passed: true, qc_status: 'damaged', note: 'Product is damaged; replacement unit required.' };
  }
  return {
    passed: false,
    qc_status: qcStatus || 'pending',
    reason: 'recovery_blocked_qc_pending',
    note: 'QC status unknown. Seller must inspect return and mark as undamaged or damaged before recovery can be initiated.'
  };
}

/**
 * Verifies live credentials fail-closed without mocking
 */
function checkRequiredCredentials({ requirePayment = true, requireCalling = false, requireWhatsApp = false }) {
  if (requirePayment) {
    if (!process.env.RAZORPAY_KEY_ID) {
      return { ok: false, missingEnv: 'RAZORPAY_KEY_ID', reason: 'RAZORPAY_KEY_ID is missing in environment.' };
    }
    if (!process.env.RAZORPAY_KEY_SECRET) {
      return { ok: false, missingEnv: 'RAZORPAY_KEY_SECRET', reason: 'RAZORPAY_KEY_SECRET is missing in environment.' };
    }
  }

  if (requireCalling) {
    if (!process.env.BOLNA_API_KEY) {
      return { ok: false, missingEnv: 'BOLNA_API_KEY', reason: 'BOLNA_API_KEY is missing in environment.' };
    }
    if (!process.env.BOLNA_AGENT_ID) {
      return { ok: false, missingEnv: 'BOLNA_AGENT_ID', reason: 'BOLNA_AGENT_ID is missing in environment.' };
    }
  }

  if (requireWhatsApp) {
    if (!process.env.WHATSAPP_CLOUD_API_TOKEN) {
      return { ok: false, missingEnv: 'WHATSAPP_CLOUD_API_TOKEN', reason: 'WHATSAPP_CLOUD_API_TOKEN is missing in environment.' };
    }
    if (!process.env.WHATSAPP_PHONE_NUMBER_ID) {
      return { ok: false, missingEnv: 'WHATSAPP_PHONE_NUMBER_ID', reason: 'WHATSAPP_PHONE_NUMBER_ID is missing in environment.' };
    }
  }

  return { ok: true };
}

/**
 * Triggers an RTO Recovery Attempt
 * Enforces Return QC Gate, Worth-It Gate, and Credential Gate.
 */
async function triggerRecoveryAttempt({
  orderId,
  sellerId,
  qcStatus,
  newProductCost = 0,
  discountPercent = 0,
  forwardShipping = DEFAULTS.DEFAULT_FORWARD_SHIPPING_INR,
  packaging = DEFAULTS.DEFAULT_PACKAGING_INR,
  callCost = DEFAULTS.DEFAULT_CALL_COST_INR,
  autoContactBuyer = false
}) {
  const order = db.getOrderById(orderId);
  if (!order) {
    return { success: false, reason: `Order ${orderId} not found` };
  }

  const seller = db.getSeller(sellerId || order.seller_id);
  if (!seller) {
    return { success: false, reason: `Seller not found for order ${orderId}` };
  }

  // 1. Return QC Gate
  const effectiveQc = qcStatus || order.return_qc_status;
  const qcGate = evaluateQcGate(effectiveQc);
  if (!qcGate.passed) {
    db.createRecoveryAttempt({
      originalOrderId: order.id,
      sellerId: seller.id,
      rtoCostSunk: order.sunk_rto_cost || 120.00,
      productPrice: Number(order.cod_amount || 0),
      forwardShipping,
      packaging,
      commission: 0,
      callCost: 0,
      newProductCost: 0,
      worthItResult: false,
      buyerResponse: 'QC_PENDING',
      paymentStatus: 'unpaid',
      reshipStatus: 'recovery_blocked_qc_pending',
      sellerApproval: false
    });

    return {
      success: false,
      status: 'recovery_blocked_qc_pending',
      gate: 'RETURN_QC_GATE',
      reason: qcGate.note
    };
  }

  // 2. Worth-It Gate
  const productPrice = Number(order.cod_amount || 0);
  const calculation = calculateWorthIt({
    productPrice,
    discountPercent,
    forwardShipping,
    packaging,
    callCost,
    qcStatus: effectiveQc,
    newProductCost
  });

  if (!calculation.is_worth_it) {
    db.createRecoveryAttempt({
      originalOrderId: order.id,
      sellerId: seller.id,
      rtoCostSunk: order.sunk_rto_cost || 120.00,
      productPrice,
      forwardShipping: calculation.forward_shipping_F,
      packaging: calculation.packaging_PK,
      commission: calculation.commission_C,
      callCost: calculation.call_cost_CALL,
      newProductCost: calculation.new_product_cost_NEW,
      worthItResult: false,
      buyerResponse: 'NOT_CONTACTED',
      paymentStatus: 'unpaid',
      reshipStatus: 'recovery_not_worth_it',
      sellerApproval: false
    });

    return {
      success: false,
      status: 'recovery_not_worth_it',
      gate: 'WORTH_IT_GATE',
      reason: 'Total recovery costs exceed discounted product selling price. Buyer must NOT be contacted.',
      calculation
    };
  }

  // 3. Credential Gate Check (Fail-closed)
  const credCheck = checkRequiredCredentials({ requirePayment: true });
  if (!credCheck.ok) {
    return {
      success: false,
      mode: 'not_configured',
      missingEnv: credCheck.missingEnv,
      reason: credCheck.reason,
      calculation
    };
  }

  // 4. Generate Razorpay Prepaid Payment Link
  let paymentLinkResult;
  try {
    paymentLinkResult = await createRazorpayPaymentLink({
      amountPaise: Math.round(calculation.prepaid_price_P * 100),
      buyerName: order.buyer_name,
      buyerPhone: order.buyer_phone,
      description: `RTO Recovery Prepaid Order #${order.external_order_id} (${calculation.discount_percent}% off applied)`
    });
  } catch (linkErr) {
    return {
      success: false,
      mode: 'razorpay_failed',
      reason: linkErr.message,
      missingEnv: 'RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET',
      calculation
    };
  }

  if (!paymentLinkResult || !paymentLinkResult.success) {
    return {
      success: false,
      mode: 'razorpay_failed',
      reason: paymentLinkResult ? paymentLinkResult.error : 'Failed creating payment link',
      calculation
    };
  }

  // 5. Append-only Log Attempt
  const attempt = db.createRecoveryAttempt({
    originalOrderId: order.id,
    sellerId: seller.id,
    rtoCostSunk: order.sunk_rto_cost || 120.00,
    productPrice,
    forwardShipping: calculation.forward_shipping_F,
    packaging: calculation.packaging_PK,
    commission: calculation.commission_C,
    callCost: calculation.call_cost_CALL,
    newProductCost: calculation.new_product_cost_NEW,
    worthItResult: true,
    buyerResponse: 'CONTACT_QUEUED',
    paymentStatus: 'unpaid',
    reshipStatus: 'pending_payment',
    sellerApproval: false,
    meta: {
      prepaid_amount_P: calculation.prepaid_price_P,
      discount_percent: calculation.discount_percent,
      payment_link_id: paymentLinkResult.paymentLinkId,
      payment_url: paymentLinkResult.paymentUrl,
      qc_status: effectiveQc
    }
  });

  return {
    success: true,
    status: 'recovery_offered',
    attempt_id: attempt.id,
    calculation,
    payment_link_id: paymentLinkResult.paymentLinkId,
    payment_url: paymentLinkResult.paymentUrl,
    message: 'Worth-it gate passed. Prepaid recovery link generated. Awaiting buyer payment before any reshipment.'
  };
}

/**
 * Handles Webhook Confirmation when Buyer Completes Recovery Payment
 * Commission (10% of P) is charged ONLY on recovery_paid!
 */
function handleRecoveryPaymentPaid({ recoveryAttemptId, paymentLinkId, razorpayPaymentId }) {
  const attempts = db.getRecoveryAttempts();
  const attempt = attempts.find(a => 
    (recoveryAttemptId && a.id === recoveryAttemptId) ||
    (paymentLinkId && (a.razorpay_payment_link_id === paymentLinkId || (a.meta && a.meta.payment_link_id === paymentLinkId)))
  );

  if (!attempt) {
    throw new Error('Recovery attempt not found for payment confirmation');
  }

  // Update status to paid and pending seller approval
  attempt.payment_status = 'paid';
  attempt.reship_status = 'pending_approval';
  attempt.buyer_response = 'ACCEPTED_PAID_PREPAID';
  attempt.razorpay_payment_id = razorpayPaymentId || `pay_${Date.now()}`;
  attempt.paid_at = new Date().toISOString();
  db.save();

  // Deduct 10% recovery commission from seller wallet
  let commissionDeducted = false;
  let commissionError = null;
  try {
    const commissionAmount = Number(attempt.commission) || 0;
    if (commissionAmount > 0) {
      recordUsageDebit({
        sellerId: attempt.seller_id,
        amount: commissionAmount,
        purpose: 'RTO_RECOVERY_COMMISSION_10PCT',
        disposition: 'confirmed',
        referenceId: attempt.id,
        meta: {
          recovery_attempt_id: attempt.id,
          original_order_id: attempt.original_order_id,
          product_price: attempt.product_price,
          prepaid_amount: attempt.meta ? attempt.meta.prepaid_amount_P : attempt.product_price
        }
      });
      commissionDeducted = true;
    }
  } catch (err) {
    commissionError = err.message;
    console.error('[RECOVERY COMMISSION DEBIT ERROR]', err.message);
  }

  // Check if seller enabled auto-approve
  const seller = db.getSeller(attempt.seller_id);
  if (seller && seller.recovery_auto_approve === true) {
    approveReshipment({ recoveryAttemptId: attempt.id, sellerId: seller.id, paymentMode: 'PREPAID' });
  }

  return {
    success: true,
    status: 'recovery_paid',
    attempt,
    commission_deducted: commissionDeducted,
    commission_error: commissionError,
    next_step: 'Await 1-click seller reshipment approval in dashboard'
  };
}

/**
 * Reshipment Approval Gate (Strict COD Prevention)
 *
 * RULES:
 * 1. COD RESHIPMENT NEVER: paymentMode === 'COD' fails closed immediately.
 * 2. Unpaid recovery orders cannot be reshipped.
 * 3. Address completeness check: incomplete address blocks reshipment.
 */
function approveReshipment({ recoveryAttemptId, sellerId, paymentMode = 'PREPAID', updatedAddress = null }) {
  const attempts = db.getRecoveryAttempts();
  const attempt = attempts.find(a => a.id === recoveryAttemptId);
  if (!attempt) {
    throw new Error(`Recovery attempt ${recoveryAttemptId} not found`);
  }

  // 1. HARD COD BLOCK
  if (paymentMode && String(paymentMode).toUpperCase().includes('COD')) {
    attempt.reship_status = 'blocked_cod';
    db.save();
    const err = new Error('COD RESHIPMENT FORBIDDEN: RTO orders can NEVER be reshipped on COD. Recovery is prepaid only.');
    err.code = 'COD_RESHIPMENT_FORBIDDEN';
    throw err;
  }

  // 2. PAYMENT CONFIRMATION GATE
  if (attempt.payment_status !== 'paid') {
    const err = new Error(`Cannot reship order: Payment status is "${attempt.payment_status}". Order must be paid in full prepaid first.`);
    err.code = 'RECOVERY_NOT_PAID';
    throw err;
  }

  // 3. ADDRESS COMPLETENESS GATE
  const order = db.getOrderById(attempt.original_order_id);
  const addressToVerify = updatedAddress || (order ? order.raw_address : '');
  if (!addressToVerify || addressToVerify.trim().length < 15) {
    attempt.reship_status = 'blocked_address_incomplete';
    db.save();
    const err = new Error('Reshipment blocked: Shipping address is incomplete. Buyer must provide landmark and premise detail.');
    err.code = 'INCOMPLETE_ADDRESS';
    throw err;
  }

  // 4. APPROVE & DISPATCH
  attempt.seller_approval = true;
  attempt.seller_approved_at = new Date().toISOString();
  attempt.reship_status = 'reshipped';
  attempt.reshipment_details = {
    payment_mode: 'PREPAID_ONLY',
    reshipped_product_type: attempt.meta && attempt.meta.qc_status === 'damaged' ? 'NEW_REPLACEMENT_UNIT' : 'SAME_UNDAMAGED_UNIT',
    final_address: addressToVerify
  };
  db.save();

  if (order) {
    db.updateOrder(order.id, {
      verification_status: 'rto_recovered_reshipped',
      tags: [...(order.tags || []), 'RTO-Recovered-Prepaid']
    });
  }

  return {
    success: true,
    status: 'reshipped',
    attempt,
    message: 'Reshipment approved. 100% Prepaid order created for dispatch.'
  };
}

module.exports = {
  DEFAULTS,
  calculateWorthIt,
  evaluateQcGate,
  checkRequiredCredentials,
  triggerRecoveryAttempt,
  handleRecoveryPaymentPaid,
  approveReshipment
};
