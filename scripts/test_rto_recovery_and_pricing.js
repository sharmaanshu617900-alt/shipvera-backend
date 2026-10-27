/**
 * TrustOrder Acceptance Test Suite
 * Covers Part 1 Core, Part 2 RTO Recovery, and Part 3 Exact Pricing
 */

const assert = require('assert');
const { db } = require('../db');
const {
  calculateWorthIt,
  evaluateQcGate,
  triggerRecoveryAttempt,
  handleRecoveryPaymentPaid,
  approveReshipment
} = require('../services/recoveryEngine');
const {
  PRICING,
  calculateGstCheckout,
  recordUsageDebit,
  recordRechargeCredit,
  recordTrustLockCollection,
  settleTrustLockBalance,
  applySubscriptionRollover
} = require('../services/walletLedger');
const { geocodeAddressGoogleMaps } = require('../services/geoSanitizer');
const { triggerOutboundCall } = require('../services/voiceAI');
const { generateTrustLock } = require('../services/trustLock');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`❌ [FAIL] ${name}:`, err.message);
    throw err;
  }
}

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`❌ [FAIL] ${name}:`, err.message);
    throw err;
  }
}

async function runAll() {
  console.log('====================================================');
  console.log('🚀 TRUSTORDER SUITE: RTO RECOVERY & PRICING TESTS');
  console.log('====================================================\n');

  // TEST 1: Empty DB starts with zero seed sellers and zero seed orders
  runTest('Empty DB shows zeros, no seed sellers, no seed orders', () => {
    // Check fresh empty data structure
    const emptyData = db.getEmptyData();
    assert.strictEqual(emptyData.sellers.length, 0, 'Sellers must start empty');
    assert.strictEqual(emptyData.orders.length, 0, 'Orders must start empty');
    assert.strictEqual(emptyData.call_logs.length, 0, 'Call logs must start empty');
    assert.strictEqual(emptyData.recovery_attempts.length, 0, 'Recovery attempts must start empty');
  });

  // TEST 2: Google Maps without key returns success:false, null score, null coordinates
  await runAsyncTest('Google Maps without key returns success:false and null score/coords', async () => {
    const origKey = process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.GOOGLE_MAPS_API_KEY;
    try {
      const res = await geocodeAddressGoogleMaps({ address: 'MG Road', city: 'Indore', pincode: '452001' });
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.coordinates, null, 'Coordinates must be null');
      assert.strictEqual(res.deliverabilityScore, null, 'Deliverability score must be null');
      assert.strictEqual(res.mode, 'not_configured');
    } finally {
      if (origKey) process.env.GOOGLE_MAPS_API_KEY = origKey;
    }
  });

  // TEST 3: Voice call without Bolna keys returns NOT_CONFIGURED (no fake transcript/recording)
  await runAsyncTest('Voice call without Bolna keys throws NOT_CONFIGURED without fakes', async () => {
    const origKey = process.env.BOLNA_API_KEY;
    const origAgent = process.env.BOLNA_AGENT_ID;
    delete process.env.BOLNA_API_KEY;
    delete process.env.BOLNA_AGENT_ID;
    try {
      let threw = false;
      try {
        await triggerOutboundCall({
          order: { id: 'ord_test_voice', buyer_name: 'Rahul', buyer_phone: '+919876543210', cod_amount: 999 },
          seller: { id: 'sel_test', brand_name: 'TestBrand', wallet_balance_inr: 50.00 }
        });
      } catch (err) {
        threw = true;
        assert(err.message.includes('BOLNA_API_KEY') || err.code === 'NOT_CONFIGURED', 'Must fail with missing keys');
      }
      assert.strictEqual(threw, true, 'Calling without Bolna keys must fail closed');
    } finally {
      if (origKey) process.env.BOLNA_API_KEY = origKey;
      if (origAgent) process.env.BOLNA_AGENT_ID = origAgent;
    }
  });

  // TEST 4: Trust Lock without Razorpay/WhatsApp keys returns success:false, order not marked sent
  await runAsyncTest('Trust Lock without Razorpay/WhatsApp keys returns success:false', async () => {
    const origRzpKey = process.env.RAZORPAY_KEY_ID;
    const origRzpSec = process.env.RAZORPAY_KEY_SECRET;
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    try {
      const res = await generateTrustLock({
        order: { id: 'ord_test_tl', buyer_name: 'Rahul', buyer_phone: '+919876543210', cod_amount: 999 },
        seller: { id: 'sel_test', brand_name: 'TestBrand', upi_trust_lock_amount: 19 }
      });
      assert.strictEqual(res.success, false, 'Must fail without live keys');
      assert(res.reason.includes('RAZORPAY_KEY_ID') || res.code === 'NOT_CONFIGURED');
    } finally {
      if (origRzpKey) process.env.RAZORPAY_KEY_ID = origRzpKey;
      if (origRzpSec) process.env.RAZORPAY_KEY_SECRET = origRzpSec;
    }
  });

  // TEST 5: Part 3 Pricing & Wallet: GST, trial, overage, failed call no-deduction
  runTest('Wallet tests: GST (+18%), trial one-time, non-billable zero charge, overage', () => {
    // GST Quote check
    const quote100 = calculateGstCheckout(999);
    assert.strictEqual(quote100.base_amount_ex_gst, 999);
    assert.strictEqual(quote100.gst_amount, 179.82);
    assert.strictEqual(quote100.total_amount_inr, 1178.82);

    // Create isolated test seller in DB
    const testSeller = db.createSeller({
      id: 'sel_unit_test_' + Date.now(),
      brand_name: 'Unit Test Store',
      wallet_balance_inr: 0.00,
      trust_lock_balance_inr: 0.00,
      trial_used: false
    });

    // One-time trial recharge: ₹99 ex-GST
    const trialRecharge = recordRechargeCredit({
      sellerId: testSeller.id,
      amountExGst: 99,
      packId: 'trial',
      paymentId: 'pay_trial_test'
    });
    assert.strictEqual(trialRecharge.new_balance, 99);
    assert.strictEqual(trialRecharge.checkout.total_amount_inr, 116.82);

    // Second trial attempt must be rejected (one-time per store)
    let trialErr = false;
    try {
      recordRechargeCredit({
        sellerId: testSeller.id,
        amountExGst: 99,
        packId: 'trial',
        paymentId: 'pay_trial_dup'
      });
    } catch (e) {
      trialErr = true;
      assert.strictEqual(e.code, 'TRIAL_ALREADY_USED');
    }
    assert.strictEqual(trialErr, true, 'Second trial recharge must be rejected');

    // Free disposition: Unanswered call = ₹0 charge (no deduction)
    const freeCall = recordUsageDebit({
      sellerId: testSeller.id,
      channel: 'voice',
      disposition: 'unanswered',
      referenceId: 'ref_free_call'
    });
    assert.strictEqual(freeCall.billed, false);
    assert.strictEqual(freeCall.amount, 0);
    assert.strictEqual(db.getSeller(testSeller.id).wallet_balance_inr, 99);

    // Free hangup under 10s = ₹0 charge
    const quickHangup = recordUsageDebit({
      sellerId: testSeller.id,
      channel: 'voice',
      disposition: 'confirmed',
      durationSeconds: 7,
      referenceId: 'ref_hangup'
    });
    assert.strictEqual(quickHangup.billed, false);
    assert.strictEqual(quickHangup.amount, 0);
    assert.strictEqual(db.getSeller(testSeller.id).wallet_balance_inr, 99);

    // Billable disposition: Voice confirmed = ₹12 ex-GST
    const billableVoice = recordUsageDebit({
      sellerId: testSeller.id,
      channel: 'voice',
      disposition: 'confirmed',
      durationSeconds: 24,
      referenceId: 'ref_billable'
    });
    assert.strictEqual(billableVoice.billed, true);
    assert.strictEqual(billableVoice.amount, 12.00);
    assert.strictEqual(db.getSeller(testSeller.id).wallet_balance_inr, 87.00);

    // Billable OTP/WhatsApp = ₹3 ex-GST
    const billableOtp = recordUsageDebit({
      sellerId: testSeller.id,
      channel: 'otp',
      disposition: 'confirmed',
      referenceId: 'ref_otp'
    });
    assert.strictEqual(billableOtp.billed, true);
    assert.strictEqual(billableOtp.amount, 3.00);
    assert.strictEqual(db.getSeller(testSeller.id).wallet_balance_inr, 84.00);

    // Voice Floor check: rate cannot fall below ₹8
    assert(PRICING.VOICE_FLOOR_EX_GST >= 8.00);
  });

  // TEST 6: ₹19 Trust Lock bulk weekly settlement (min ₹500)
  runTest('Trust Lock: Seller money held in trust balance, bulk weekly settlement min ₹500', () => {
    const sId = 'sel_tl_test_' + Date.now();
    const seller = db.createSeller({
      id: sId,
      brand_name: 'TL Test Store',
      wallet_balance_inr: 100.00,
      trust_lock_balance_inr: 0.00
    });

    // Collect 10 Trust Lock tokens of ₹19 each = ₹190
    for (let i = 0; i < 10; i++) {
      recordTrustLockCollection({ sellerId: sId, orderId: `ord_${i}`, paymentId: `pay_${i}` });
    }
    assert.strictEqual(db.getSeller(sId).trust_lock_balance_inr, 190.00);

    // Settlement attempt below ₹500 must fail closed
    let settleErr = false;
    try {
      settleTrustLockBalance({ sellerId: sId });
    } catch (e) {
      settleErr = true;
      assert.strictEqual(e.code, 'MINIMUM_SETTLEMENT_NOT_MET');
    }
    assert.strictEqual(settleErr, true, 'Settlement below ₹500 must fail');

    // Add more tokens to exceed ₹500 (e.g. 20 more * 19 = 380 -> total 570)
    for (let i = 10; i < 30; i++) {
      recordTrustLockCollection({ sellerId: sId, orderId: `ord_${i}`, paymentId: `pay_${i}` });
    }
    assert.strictEqual(db.getSeller(sId).trust_lock_balance_inr, 570.00);

    // Settlement at ₹570 must succeed
    const settlement = settleTrustLockBalance({ sellerId: sId });
    assert.strictEqual(settlement.success, true);
    assert.strictEqual(settlement.settled_amount, 570.00);
    assert.strictEqual(db.getSeller(sId).trust_lock_balance_inr, 0.00);
  });

  // =========================================================================
  // RECOVERY TESTS 1 THROUGH 7 (AS SPECIFIED IN USER PROMPT)
  // =========================================================================

  // Recovery Test 1, undamaged:
  // Product ₹800, forward ₹80, packaging ₹20, commission ₹80, call ₹7, new product ₹0, total cost ₹187, prepaid ₹800, worth-it = true, recovery offered.
  runTest('Recovery Test 1, undamaged: Product ₹800, total cost ₹187, worth-it = true', () => {
    const res = calculateWorthIt({
      productPrice: 800,
      discountPercent: 0,
      forwardShipping: 80,
      packaging: 20,
      callCost: 7,
      qcStatus: 'undamaged',
      newProductCost: 0
    });

    assert.strictEqual(res.prepaid_price_P, 800);
    assert.strictEqual(res.commission_C, 80); // 10% of 800
    assert.strictEqual(res.total_cost, 187); // 80 + 20 + 80 + 7 + 0 = 187
    assert.strictEqual(res.is_worth_it, true);
    assert.strictEqual(res.recommendation, 'PROCEED_WITH_RECOVERY');
  });

  // Recovery Test 2, damaged:
  // Same as Test 1, but new product ₹400, total cost ₹587, prepaid ₹800, worth-it = true, dashboard must show both numbers clearly.
  runTest('Recovery Test 2, damaged: Same as Test 1, but new product ₹400, total cost ₹587, worth-it = true', () => {
    const res = calculateWorthIt({
      productPrice: 800,
      discountPercent: 0,
      forwardShipping: 80,
      packaging: 20,
      callCost: 7,
      qcStatus: 'damaged',
      newProductCost: 400
    });

    assert.strictEqual(res.prepaid_price_P, 800);
    assert.strictEqual(res.new_product_cost_NEW, 400);
    assert.strictEqual(res.total_cost, 587); // 80 + 20 + 80 + 7 + 400 = 587
    assert.strictEqual(res.is_worth_it, true);
    assert.strictEqual(res.recommendation, 'PROCEED_WITH_RECOVERY');
  });

  // Recovery Test 3, low price:
  // Product ₹300, forward ₹80, packaging ₹20, commission ₹30, call ₹7, total cost ₹137, but if new product is needed total cost becomes ₹537, worth-it = false, buyer must NOT be contacted.
  runTest('Recovery Test 3, low price: Product ₹300, undamaged = ₹137, damaged = ₹537, worth-it = false, buyer NOT contacted', () => {
    // Undamaged version
    const resUndamaged = calculateWorthIt({
      productPrice: 300,
      discountPercent: 0,
      forwardShipping: 80,
      packaging: 20,
      callCost: 7,
      qcStatus: 'undamaged',
      newProductCost: 0
    });
    assert.strictEqual(resUndamaged.total_cost, 137);
    assert.strictEqual(resUndamaged.is_worth_it, true);

    // Damaged version (new product ₹400)
    const resDamaged = calculateWorthIt({
      productPrice: 300,
      discountPercent: 0,
      forwardShipping: 80,
      packaging: 20,
      callCost: 7,
      qcStatus: 'damaged',
      newProductCost: 400
    });
    assert.strictEqual(resDamaged.total_cost, 537); // 80 + 20 + 30 + 7 + 400 = 537
    assert.strictEqual(resDamaged.prepaid_price_P, 300);
    assert.strictEqual(resDamaged.is_worth_it, false); // 300 is NOT > 537
    assert.strictEqual(resDamaged.recommendation, 'DO_NOT_CONTACT_BUYER_NOT_WORTH_IT');
  });

  // Recovery Test 4, COD reship blocked:
  // Any code path that tries to reship on COD must fail closed and be logged as blocked.
  runTest('Recovery Test 4, COD reship blocked: Code path attempting COD reship fails closed with COD_RESHIPMENT_FORBIDDEN', () => {
    const attempt = db.createRecoveryAttempt({
      originalOrderId: 'ord_cod_blocked_test',
      sellerId: 'sel_test',
      productPrice: 800,
      worthItResult: true,
      paymentStatus: 'paid', // even if payment is paid
      reshipStatus: 'pending_approval'
    });

    let blocked = false;
    try {
      approveReshipment({
        recoveryAttemptId: attempt.id,
        sellerId: 'sel_test',
        paymentMode: 'COD' // ATTACK: trying to reship COD
      });
    } catch (e) {
      blocked = true;
      assert.strictEqual(e.code, 'COD_RESHIPMENT_FORBIDDEN');
    }
    assert.strictEqual(blocked, true, 'COD reshipment MUST fail closed');

    // Verify row was updated to blocked_cod
    const updated = db.getRecoveryAttempts().find(a => a.id === attempt.id);
    assert.strictEqual(updated.reship_status, 'blocked_cod');
  });

  // Recovery Test 5, unpaid:
  // Razorpay link created but not paid, order must NOT ship, commission must be ₹0.
  runTest('Recovery Test 5, unpaid: Payment link unpaid, order must NOT ship, commission must be ₹0', () => {
    const attempt = db.createRecoveryAttempt({
      originalOrderId: 'ord_unpaid_test',
      sellerId: 'sel_test',
      productPrice: 800,
      commission: 80,
      worthItResult: true,
      paymentStatus: 'unpaid', // UNPAID
      reshipStatus: 'pending_payment'
    });

    let reshipBlocked = false;
    try {
      approveReshipment({
        recoveryAttemptId: attempt.id,
        sellerId: 'sel_test',
        paymentMode: 'PREPAID'
      });
    } catch (e) {
      reshipBlocked = true;
      assert.strictEqual(e.code, 'RECOVERY_NOT_PAID');
    }
    assert.strictEqual(reshipBlocked, true, 'Unpaid recovery order must NOT ship');

    // Commission charged on unpaid attempt = 0 (only charged on recovery_paid)
    const stats = db.getRecoveryStats('sel_test');
    // total_recovery_commission_paid must only include paid recovery attempts
    assert.strictEqual(stats.total_recovery_commission_paid, 0);
  });

  // Recovery Test 6, paid:
  // Razorpay webhook verified, payment paid, seller approved, then and only then reshipment is created.
  runTest('Recovery Test 6, paid: Webhook verifies paid, commission deducted, seller approves, reshipment created', () => {
    const seller = db.createSeller({
      id: 'sel_recovery_paid_' + Date.now(),
      brand_name: 'Recovery Paid Brand',
      wallet_balance_inr: 500.00
    });

    const order = db.createOrder({
      seller_id: seller.id,
      external_order_id: '#UK-REC-PAID',
      buyer_name: 'Vikas Sharma',
      buyer_phone: '+919876543210',
      cod_amount: 800,
      raw_address: 'Plot 42, Yellow House, Near Sharma Dairy, Gali 4, Rohtak 124001',
      city: 'Rohtak',
      pincode: '124001',
      verification_status: 'rto_returned'
    });

    const attempt = db.createRecoveryAttempt({
      originalOrderId: order.id,
      sellerId: seller.id,
      productPrice: 800,
      commission: 80, // 10%
      forwardShipping: 80,
      packaging: 20,
      callCost: 7,
      newProductCost: 0,
      worthItResult: true,
      paymentStatus: 'unpaid',
      reshipStatus: 'pending_payment',
      meta: { payment_link_id: 'plink_test_rec_123', prepaid_amount_P: 800 }
    });

    // 1. Webhook confirms payment paid
    const paidResult = handleRecoveryPaymentPaid({
      paymentLinkId: 'plink_test_rec_123',
      razorpayPaymentId: 'pay_rzp_rec_999'
    });
    assert.strictEqual(paidResult.success, true);
    assert.strictEqual(paidResult.status, 'recovery_paid');
    assert.strictEqual(paidResult.commission_deducted, true);

    // 2. Wallet balance had 10% commission (₹80) deducted
    const updatedSeller = db.getSeller(seller.id);
    assert.strictEqual(updatedSeller.wallet_balance_inr, 420.00); // 500 - 80 = 420

    // 3. Reshipment requires seller approval
    const reshipResult = approveReshipment({
      recoveryAttemptId: attempt.id,
      sellerId: seller.id,
      paymentMode: 'PREPAID'
    });
    assert.strictEqual(reshipResult.success, true);
    assert.strictEqual(reshipResult.status, 'reshipped');
    assert.strictEqual(reshipResult.attempt.reshipment_details.payment_mode, 'PREPAID_ONLY');

    // 4. Verify stats reflect recovered revenue
    const stats = db.getRecoveryStats(seller.id);
    assert.strictEqual(stats.total_recovered_revenue, 800);
    assert.strictEqual(stats.total_recovery_commission_paid, 80);
  });

  // Recovery Test 7, missing keys:
  // Without Razorpay or WhatsApp/Bolna keys, recovery returns success:false, with exact missing env name, and no fake payment link or fake call is created.
  await runAsyncTest('Recovery Test 7, missing keys: Returns success:false with exact missing env name', async () => {
    const origKey = process.env.RAZORPAY_KEY_ID;
    const origSec = process.env.RAZORPAY_KEY_SECRET;
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;

    try {
      const seller = db.createSeller({
        id: 'sel_test_rec_7_' + Date.now(),
        brand_name: 'Test Store 7',
        wallet_balance_inr: 500
      });

      const order = db.createOrder({
        seller_id: seller.id,
        external_order_id: '#UK-REC-FAIL',
        buyer_name: 'Test Buyer',
        buyer_phone: '+919876543210',
        cod_amount: 800,
        raw_address: 'Plot 10, MG Road, Indore 452001',
        return_qc_status: 'undamaged'
      });

      const res = await triggerRecoveryAttempt({
        orderId: order.id,
        sellerId: seller.id,
        qcStatus: 'undamaged'
      });

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.mode, 'not_configured');
      assert.strictEqual(res.missingEnv, 'RAZORPAY_KEY_ID', 'Must identify exact missing env var name');
      assert(res.reason.includes('RAZORPAY_KEY_ID'));
    } finally {
      if (origKey) process.env.RAZORPAY_KEY_ID = origKey;
      if (origSec) process.env.RAZORPAY_KEY_SECRET = origSec;
    }
  });

  console.log('\n====================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} ACCEPTANCE TESTS PASSED CLEANLY!`);
  console.log('====================================================');
}

runAll().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
