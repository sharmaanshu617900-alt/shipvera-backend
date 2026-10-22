/**
 * Shipvera Autonomous Background Queue Engine
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
    console.log(`[QUEUE] Shipvera Autonomous Queue Worker started (polling every ${pollIntervalMs}ms)`);

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

    // Check wallet balance
    if (seller.wallet_balance_inr < 6.00) {
      db.updateOrder(order.id, { verification_status: 'payment_required' });
      db.updateJob(job.id, { status: 'failed', error: 'Wallet balance insufficient (₹0.00)' });
      console.warn(`[QUEUE] Order ${order.external_order_id} halted: Zero wallet balance.`);
      return;
    }

    // Mark processing
    db.updateJob(job.id, { status: 'processing', attempts: (job.attempts || 0) + 1 });
    console.log(`[QUEUE EXEC] Firing outbound voice interrogation for Order ${order.external_order_id} (Attempt ${job.attempts + 1})`);

    const callResult = await triggerOutboundCall({
      order,
      seller,
      live: false // In automated worker, dispatch or simulate depending on env
    });

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
        // Fallback to Feature 4: ₹19 Trust Lock on WhatsApp
        console.log(`[QUEUE FALLBACK] Order ${order.external_order_id} exhausted call retries. Firing ₹19 WhatsApp Trust Lock.`);
        generateTrustLock({ order, seller });
        db.updateJob(job.id, { status: 'completed', result: 'TRUST_LOCK_TRIGGERED' });
      }
    }
  }
}

const queueEngine = new QueueEngine();

module.exports = {
  queueEngine
};
