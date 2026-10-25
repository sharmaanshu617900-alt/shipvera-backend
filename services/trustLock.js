/**
 * Feature 4: The "19 UPI Trust Lock" (WhatsApp + Micro-UPI Fallback)
 * PRD Goal: Save orders where the buyer didn't pick up without risking
 * a blind COD dispatch.
 *
 * REAL-ONLY RULES:
 * - Payment links are created ONLY via the real Razorpay Payment Links API
 *   when RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are present.
 *   If they are absent, or the API call fails, this returns
 *   success:false and does NOT mark the order as trust_lock_sent.
 * - No fake payment URL and no fake voice-note URL are ever generated.
 *   A voice note does not exist until a real voice-note generation
 *   service is wired in; voiceNoteUrl is therefore null.
 * - WhatsApp dispatch is awaited. If WhatsApp reports not_configured
 *   or failure, the Trust Lock is NOT reported as sent.
 */

const https = require('https');
const { db } = require('../db');
const { sendWhatsAppTrustLock } = require('./whatsappService');

function razorpayAuthHeader() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) return null;
  return 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
}

async function createRazorpayPaymentLink({ amountPaise, buyerName, buyerPhone, description }) {
  const auth = razorpayAuthHeader();
  if (!auth) {
    const err = new Error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set. No payment link was created.');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }
  const payload = {
    amount: amountPaise,
    currency: 'INR',
    description: description || 'Shipvera Trust Lock',
    customer: {
      name: buyerName || undefined,
      contact: buyerPhone || undefined
    },
    notify: { sms: false, email: false },
    reminder_enable: false
  };
  const postData = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.razorpay.com',
      path: '/v1/payment_links',
      method: 'POST',
      headers: {
        'Authorization': auth,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (res.statusCode >= 200 && res.statusCode < 300 && json.short_url) {
            resolve({ success: true, paymentLinkId: json.id, paymentUrl: json.short_url, raw: json });
          } else {
            resolve({ success: false, statusCode: res.statusCode, error: json.error ? (json.error.description || JSON.stringify(json.error)) : body });
          }
        } catch (e) {
          resolve({ success: false, statusCode: res.statusCode, error: body });
        }
      });
    });
    req.on('error', err => reject(err));
    req.write(postData);
    req.end();
  });
}

/**
 * Generates a real 19 UPI Trust Lock. Async: callers must await it and
 * must NOT mark an order as sent when this returns success:false.
 */
async function generateTrustLock({ order, seller }) {
  if (!order || !seller) {
    return { success: false, mode: 'not_configured', reason: 'Order and seller are required for a Trust Lock.' };
  }
  const tokenAmount = seller.upi_trust_lock_amount || 19;
  const remainingCod = Math.max(0, Number(order.cod_amount || 0) - tokenAmount);
  const brandName = seller.brand_name || 'Dispatch Warehouse';
  const buyerName = order.buyer_name;

  let link;
  try {
    link = await createRazorpayPaymentLink({
      amountPaise: tokenAmount * 100,
      buyerName,
      buyerPhone: order.buyer_phone,
      description: `${brandName} Trust Lock - Rs ${tokenAmount} token for order ${order.external_order_id || order.id}`
    });
  } catch (err) {
    return { success: false, mode: 'not_configured', reason: err.message, code: err.code || 'RAZORPAY_ERROR' };
  }
  if (!link.success) {
    return { success: false, mode: 'razorpay_failed', reason: link.error || 'Razorpay payment link creation failed.', statusCode: link.statusCode };
  }

  const paymentUrl = link.paymentUrl;
  const whatsappMessage = `Hi ${buyerName}, humne aapka Rs ${order.cod_amount} ka parcel dispatch karne ke liye call kiya tha par connect nahi hua. Parcel hold na ho isliye bas Rs ${tokenAmount} ka chota token UPI karke apna address lock kar dein. Baaki Rs ${remainingCod} delivery pe hi dena hai!\n\nLock Address Now: ${paymentUrl}`;

  let whatsappResult;
  try {
    whatsappResult = await sendWhatsAppTrustLock({
      buyerPhone: order.buyer_phone,
      buyerName,
      codAmount: order.cod_amount,
      tokenAmount,
      paymentUrl
    });
  } catch (err) {
    whatsappResult = { success: false, error: err.message };
  }

  if (!whatsappResult || whatsappResult.success !== true) {
    // Do NOT mark the order as trust_lock_sent when the buyer was not
    // actually contacted. The caller can surface this failure.
    db.updateOrder(order.id, {
      verification_status: 'trust_lock_failed',
      tags: [...(order.tags || []), 'RTO-Shield-Trust-Lock-Failed']
    });
    return {
      success: false,
      mode: whatsappResult && whatsappResult.mode ? whatsappResult.mode : 'whatsapp_failed',
      reason: (whatsappResult && (whatsappResult.reason || whatsappResult.error)) || 'WhatsApp Trust Lock message was not sent.',
      paymentLinkId: link.paymentLinkId,
      paymentUrl,
      whatsappResult
    };
  }

  db.updateOrder(order.id, {
    verification_status: 'trust_lock_sent',
    tags: [...(order.tags || []), 'RTO-Shield-Trust-Lock-Pending']
  });

  return {
    success: true,
    orderId: order.id,
    tokenAmount,
    remainingCod,
    paymentLinkId: link.paymentLinkId,
    paymentUrl,
    whatsappMessage,
    voiceNoteUrl: null, // No voice-note generation service is wired in yet; do not invent a URL.
    whatsappResult
  };
}

/**
 * Handles payment verification when a 19 UPI token is captured.
 * Called only after a verified Razorpay webhook signature check.
 * Money saved is NOT hardcoded: courier cost is not confirmed here,
 * so rto_money_saved is left unset (null) with a reason.
 */
function handleTrustLockPaid({ orderId, paymentId, sellerId }) {
  const order = db.getOrderById(orderId);
  if (!order) throw new Error(`Order ${orderId} not found`);

  const tokenAmount = 19;
  const remainingCod = Math.max(0, Number(order.cod_amount || 0) - tokenAmount);

  const updated = db.updateOrder(orderId, {
    verification_status: 'trust_lock_paid',
    risk_score: 10,
    rto_money_saved: null,
    rto_money_saved_reason: 'not_verified - courier reverse-freight cost was not confirmed for this order',
    tags: ['RTO-Shield-Verified', 'Trust-Lock-Paid-19']
  });

  let walletDebitError = null;
  try {
    const { recordUsageDebit } = require('./walletLedger');
    recordUsageDebit({
      sellerId: sellerId || order.seller_id,
      amount: 6.00,
      purpose: 'VOICE_AI_VERIFICATION',
      referenceId: order.external_order_id,
      meta: { orderId: order.id, buyerPhone: order.buyer_phone }
    });
  } catch (e) {
    walletDebitError = e.message;
  }

  db.recordBuyerOutcome(order.buyer_phone, 'TRUST_LOCK_PAID');

  return {
    status: 'trust_lock_paid',
    order: updated,
    tokenAmount,
    remainingCod,
    walletDebitError,
    shopifyNoteUpdate: `Prepaid Token: Rs ${tokenAmount} | Remaining COD: Rs ${remainingCod} | Payment ID: ${paymentId}`
  };
}

module.exports = {
  generateTrustLock,
  handleTrustLockPaid
};
