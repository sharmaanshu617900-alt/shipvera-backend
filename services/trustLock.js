/**
 * Feature 4: The "₹19 Trust Lock" (WhatsApp Audio + Micro-UPI Fallback)
 * PRD Goal: Save orders where buyer didn't pick up without risking blind COD dispatch.
 */

const { db } = require('../db');
const { sendWhatsAppTrustLock } = require('./whatsappService');

/**
 * Generates dynamic ₹19 micro-UPI payment link and WhatsApp dispatch template
 */
function generateTrustLock({ order, seller }) {
  const tokenAmount = seller.upi_trust_lock_amount || 19;
  const remainingCod = Math.max(0, order.cod_amount - tokenAmount);
  const brandName = seller.brand_name || 'Dispatch Warehouse';
  const buyerName = order.buyer_name;

  // Dynamic Razorpay payment link simulation
  const paymentLinkId = `plink_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const paymentUrl = `https://rzp.io/l/shipvera-${paymentLinkId}`;

  // WhatsApp Message Copy as specified in PRD Section 1.3 Feature 4
  const whatsappMessage = `Hi ${buyerName}, humne aapka ₹${order.cod_amount} ka parcel dispatch karne ke liye call kiya tha par connect nahi hua. Parcel hold na ho isliye bas ₹${tokenAmount} ka chota token UPI karke apna address lock kar dein. Baaki ₹${remainingCod} delivery pe hi dena hai!\n\nLock Address Now: ${paymentUrl}`;

  // Trigger live or sandbox WhatsApp dispatch
  sendWhatsAppTrustLock({
    buyerPhone: order.buyer_phone,
    buyerName,
    codAmount: order.cod_amount,
    tokenAmount,
    paymentUrl
  }).catch(e => console.warn('[WHATSAPP DISPATCH WARN]', e.message));

  // Update order status
  db.updateOrder(order.id, {
    verification_status: 'trust_lock_sent',
    tags: [...(order.tags || []), 'RTO-Shield-Trust-Lock-Pending']
  });

  return {
    success: true,
    orderId: order.id,
    tokenAmount,
    remainingCod,
    paymentLinkId,
    paymentUrl,
    whatsappMessage,
    voiceNoteUrl: `https://cdn.shipvera.com/voice-notes/trust_lock_${order.id}.ogg`
  };
}

/**
 * Handles payment verification when ₹19 UPI token is captured
 */
function handleTrustLockPaid({ orderId, paymentId, sellerId }) {
  const order = db.getOrderById(orderId);
  if (!order) throw new Error(`Order ${orderId} not found`);

  const tokenAmount = 19;
  const remainingCod = Math.max(0, order.cod_amount - tokenAmount);

  // Update order to verified via trust lock
  const updated = db.updateOrder(orderId, {
    verification_status: 'trust_lock_paid',
    risk_score: 10,
    rto_money_saved: 180.00,
    tags: ['RTO-Shield-Verified', 'Trust-Lock-Paid-₹19']
  });

  // Deduct ₹6 verification charge
  db.updateSellerWallet(sellerId || order.seller_id, -6.00);

  // Record in trust graph
  db.recordBuyerOutcome(order.buyer_phone, 'TRUST_LOCK_PAID');

  return {
    status: 'trust_lock_paid',
    order: updated,
    tokenAmount,
    remainingCod,
    shopifyNoteUpdate: `Prepaid Token: ₹${tokenAmount} | Remaining COD: ₹${remainingCod} | Payment ID: ${paymentId}`
  };
}

module.exports = {
  generateTrustLock,
  handleTrustLockPaid
};
