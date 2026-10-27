/**
 * TrustOrder Autonomous Background Queue Engine
 * Billionaire Backend Architecture:
 * - 45s SLA Intentional Delay (Order placed -> wait 45s so customer puts phone down -> trigger voice call)
 * - TRAI Night Window Compliance Deferral (9:30 PM - 8:30 AM IST -> Auto-schedule 9:00 AM batch)
 * - Exponential Retry Engine (Max 2 retries spaced 10 mins apart for busy/no-answer)
 * - Automatic Fallback to Feature 4 (₹19 UPI Trust Lock on WhatsApp after exhausted call retries)
 */

const { db } = require('../db');
const { checkCallingWindow } = require('./nightWindow');
const { triggerOutboundCall } = require('./voiceAI');
const { applyPostCallDecision } = require('./addressRewriter');
const { generateTrustLock } = require('./trustLock');

class QueueEngine {
  constructor() {
    this.isRunning = false;
    this.intervalId = null;
    this.processingLock = new Set();
  }

  /**
   * Enqueues an order for autonomous verification
   */
  enqueueOrder({ order, seller, delaySeconds = 45 }) {
    const windowCheck = checkCallingWindow();
    let scheduledAt;
    let delayReason;

    if (!windowCheck.isAllowedNow) {
      scheduledAt = windowCheck.scheduledFor;
      delayReason = 'TRAI_NIGHT_WINDOW_BATCH';
      db.updateOrder(order.id, { verification_status: 'night_hold_scheduled' });
      console.log(`[QUEUE] Order ${order.external_order_id} deferred to Night Hold batch: ${scheduledAt}`);
    } else {
      scheduledAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
      delayReason = 'SLA_45S_DELAY';
      db.updateOrder(order.id, { verification_status: 'queued' });
      console.log(`[QUEUE] Order ${order.external_order_id} enqueued with ${delaySeconds}s SLA delay (Exec at ${scheduledAt})`);
    }

    const job = db.enqueueJob({
      order_id: order.id,
      seller_id: seller.id,
      action: 'DISPATCH_VOICE_CALL',
      scheduled_at: scheduledAt,
      status: 'pending',
      attempts: 0,
      delay_reason: delayReason
    });

    return { job, windowCheck };
  }

  /**
   * Starts the background worker loop
   */
  startWorker(pollIntervalMs = 2500) {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`[QUEUE] TrustOrder Autonomous Queue Worker started (polling every ${pollIntervalMs}ms)`);

    this.intervalId = setInterval(async () => {
      try {
        await this.processNextBatch();
      } catch (err) {
        console.error('[QUEUE WORKER ERROR]', err);
      }
    }, pollIntervalMs);
  }

  /**
   * Stops worker loop
   */
  stopWorker() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
  }

  /**
   * Processes ready jobs
   */
  async processNextBatch() {
    const pendingJobs = db.getPendingJobs();
    if (pendingJobs.length === 0) return;

    for (const job of pendingJobs) {
      if (this.processingLock.has(job.id)) continue;
      this.processingLock.add(job.id);

      try {
        await this.executeJob(job);
      } catch (e) {
        console.error(`[QUEUE] Failed processing job ${job.id}:`, e.message);
        db.updateJob(job.id, { status: 'failed', error: e.message });
      } finally {
        this.processingLock.delete(job.id);
      }
    }
  }

  /**
   * Executes a single job
   */
  async executeJob(job) {
    const order = db.getOrderById(job.order_id);
    if (!order) {
      db.updateJob(job.id, { status: 'failed', error: 'Order not found' });
      return;
    }

    const seller = db.getSeller(order.seller_id);
    const windowCheck = checkCallingWindow();

    // If suddenly in night window, defer
    if (!windowCheck.isAllowedNow) {
      db.updateJob(job.id, {
        scheduled_at: windowCheck.scheduledFor,
        delay_reason: 'TRAI_NIGHT_WINDOW_BATCH',
        status: 'pending'
      });
      return;
    }

    if (!seller) {
      db.updateJob(job.id, { status: 'failed', error: 'Seller not found for order' });
      return;
    }

    // Part 1 H: Risk-based calling only
    // Low-risk repeat buyer = risk score only, no call, no credit deduction.
    const buyerTrust = db.getBuyerTrust(order.buyer_phone);
    const isLowRiskRepeat = order.risk_score < 30 && buyerTrust && buyerTrust.global_risk_level === 'trusted';
    if (isLowRiskRepeat) {
      console.log(`[QUEUE] Low-risk repeat buyer detected for Order ${order.external_order_id} (Score: ${order.risk_score}). Skipping call, no credit deduction.`);
      db.updateOrder(order.id, {
        verification_status: 'verified_low_risk_auto',
        tags: [...(order.tags || []), 'RTO-Shield-LowRisk-SkippedCall']
      });
      db.updateJob(job.id, { status: 'completed', result: 'LOW_RISK_REPEAT_BUYER_NO_CALL' });
      return;
    }

    // Check wallet balance (Voice fee: ₹12.00 ex-GST)
    if (seller.wallet_balance_inr < 12.00) {
      db.updateOrder(order.id, { verification_status: 'payment_required' });
      db.updateJob(job.id, { status: 'failed', error: 'Wallet balance insufficient (< ₹12.00)' });
      console.warn(`[QUEUE] Order ${order.external_order_id} halted: Wallet balance insufficient.`);
      return;
    }

    // Mark processing
    db.updateJob(job.id, { status: 'processing', attempts: (job.attempts || 0) + 1 });
    console.log(`[QUEUE EXEC] Firing outbound voice interrogation for Order ${order.external_order_id} (Attempt ${job.attempts + 1})`);

    // Automated path is LIVE by default. triggerOutboundCall only
    // simulates when TRUSTORDER_ALLOW_SIMULATED_CALLS=true or SHIPVERA_ALLOW_SIMULATED_CALLS=true is set
    // explicitly for local testing; otherwise a live Bolna call is placed.
    let callResult;
    try {
      callResult = await triggerOutboundCall({ order, seller, live: true });
    } catch (callErr) {
      db.updateOrder(order.id, { verification_status: 'call_failed' });
      db.updateJob(job.id, { status: 'failed', error: callErr.message });
      return;
    }
    if (callResult && callResult.simulated) {
      // A simulated result must never be treated as a buyer outcome.
      db.updateOrder(order.id, { verification_status: 'call_failed' });
      db.updateJob(job.id, { status: 'failed', error: 'Simulated call result received in automated worker; no buyer outcome recorded.' });
      return;
    }

    // Handle outcome
    if (callResult.intent === 'VERIFIED_GENUINE') {
      applyPostCallDecision({
        orderId: order.id,
        buyerIntent: 'VERIFIED_GENUINE',
        spokenText: callResult.extractedLandmark || 'Landmark confirmed during call',
        sellerId: seller.id
      });
      db.updateJob(job.id, { status: 'completed' });
    } else if (callResult.intent === 'CANCEL_REQUESTED') {
      applyPostCallDecision({
        orderId: order.id,
        buyerIntent: 'CANCEL_REQUESTED',
        sellerId: seller.id
      });
      db.updateJob(job.id, { status: 'completed' });
    } else {
      // Unanswered or Dicey: Retry or Fallback to Trust Lock
      const currentAttempts = (job.attempts || 0) + 1;
      if (currentAttempts < 2) {
        // Schedule Retry 1 for +10 minutes
        const retryAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        db.updateJob(job.id, {
          status: 'retrying',
          scheduled_at: retryAt,
          delay_reason: 'UNANSWERED_RETRY_1'
        });
        console.log(`[QUEUE RETRY] Order ${order.external_order_id} unanswered. Retry 1 queued for ${retryAt}`);
      } else {
        // Fallback to Feature 4: 19 UPI Trust Lock on WhatsApp.
        // Await it: if WhatsApp/Razorpay is not configured, the job
        // must fail visibly instead of being marked completed.
        console.log(`[QUEUE FALLBACK] Order ${order.external_order_id} exhausted call retries. Firing 19 WhatsApp Trust Lock.`);
        const trustLockResult = await generateTrustLock({ order, seller });
        if (trustLockResult && trustLockResult.success) {
          db.updateJob(job.id, { status: 'completed', result: 'TRUST_LOCK_TRIGGERED' });
        } else {
          db.updateJob(job.id, { status: 'failed', error: (trustLockResult && trustLockResult.reason) || 'Trust Lock could not be sent.' });
        }
      }
    }
  }
}

const queueEngine = new QueueEngine();

module.exports = {
  queueEngine
};
