/**
 * Feature 3: Live Address Re-Writer & Normalization Brain
 * TRD Section 3.3 & 3.4
 * Converts spoken Hindi/Hinglish speech into structured English courier labels.
 * Enforces Indian Courier Limits (Line 1 <= 35 chars for Delhivery/Bluedart label printers).
 * Auto-synchronizes with Shopify Admin and Shiprocket Logistics APIs.
 */

const { db } = require('../db');
const { recordUsageDebit } = require('./walletLedger');
const { updateShopifyOrderAddress, cancelShopifyOrder } = require('./shopifyClient');
const { updateShiprocketCustomAddress } = require('./shiprocketClient');

/**
 * Intelligent NLP & Entity Extractor for Indian Spoken Hindi/English
 */
/**
 * Extracts a cleaned courier address from spoken text.
 *
 * This is a rule-based extractor, NOT the PRD LLM extraction step.
 * Until an LLM extraction provider is configured, it must never claim
 * high confidence or invent details it did not actually hear.
 *
 * Rules:
 * - No hardcoded landmark / house / city / pincode defaults.
 * - If no house/landmark detail was actually extracted from the spoken
 *   text, the result is needs_review with a low confidence score and
 *   null cleaned lines, not a fabricated address.
 * - Confidence is computed from what was extracted, never fixed at 96.
 * - If LLM extraction is configured (LLM_API_KEY + LLM_MODEL), callers
 *   should use extractAndRewriteAddressWithLLM (see REALITY_CHECKLIST.md);
 *   this rule-based path is explicitly marked as such in its result.
 */
function extractAndRewriteAddress({ rawAddress, spokenText, city, pincode, buyerIntent }) {
  if (buyerIntent !== 'VERIFIED_GENUINE') {
    return {
      success: false,
      buyerIntent,
      confidenceScore: 0,
      cleanedAddressLine1: null,
      cleanedAddressLine2: null,
      cleanedLandmark: null,
      summaryHinglish: 'Buyer did not confirm address or requested cancellation.'
    };
  }

  const spoken = (spokenText || '').toLowerCase().trim();
  const raw = (rawAddress || '').trim();

  let houseDetail = '';
  const houseMatch = spoken.match(/\b(plot\s*(?:no\.?)?\s*\d+[a-z]?|h(?:ouse)?\.?\s*(?:no\.?)?\s*\d+[a-z]?|flat\s*(?:no\.?)?\s*\d+[a-z]?|room\s*\d+|kothi\s*\d+)\b/i);
  if (houseMatch) {
    houseDetail = houseMatch[0].replace(/\b\w/g, l => l.toUpperCase());
  }

  let floorDetail = '';
  if (/(\d+(?:st|nd|rd|th)?\s*floor|ground\s*floor|first\s*floor|second\s*floor|pehla\s*mala|doosra\s*mala)/i.test(spoken)) {
    const fMatch = spoken.match(/(\d+(?:st|nd|rd|th)?\s*floor|ground\s*floor|first\s*floor|second\s*floor|pehla\s*mala|doosra\s*mala)/i);
    floorDetail = fMatch[0].replace(/pehla\s*mala/i, '1st Floor').replace(/doosra\s*mala/i, '2nd Floor');
    floorDetail = floorDetail.replace(/\b\w/g, l => l.toUpperCase());
  }

  let gateDetail = '';
  if (/(safed|white)\s*gate/i.test(spoken)) gateDetail = 'White Gate';
  else if (/(laal|red)\s*gate/i.test(spoken)) gateDetail = 'Red Gate';
  else if (/(peela|yellow)\s*(?:gate|makan|house)/i.test(spoken)) gateDetail = 'Yellow House';
  else if (/(kala|black)\s*gate/i.test(spoken)) gateDetail = 'Black Gate';
  else if (/(hara|green)\s*gate/i.test(spoken)) gateDetail = 'Green Gate';

  let landmark = '';
  const spatialPrepositionMatch = spoken.match(/(?:opposite|opp\.?|behind|piche|samne|near|paas|pass|ke\s*upar|above|baju\s*me)\s+([a-z0-9\s]+?)(?:ke|par|hai|safed|laal|peela|wahi|,|\.|$)/i);
  if (spatialPrepositionMatch && spatialPrepositionMatch[1]) {
    const landmarkEntity = spatialPrepositionMatch[1].trim();
    if (landmarkEntity.length > 2) {
      if (/opposite|opp|samne/i.test(spoken)) {
        landmark = `Opp. ${capitalizeWords(landmarkEntity)}`;
      } else if (/behind|piche/i.test(spoken)) {
        landmark = `Behind ${capitalizeWords(landmarkEntity)}`;
      } else if (/above|upar/i.test(spoken)) {
        landmark = `Above ${capitalizeWords(landmarkEntity)}`;
      } else {
        landmark = `Near ${capitalizeWords(landmarkEntity)}`;
      }
    }
  }

  // Support Indian Hindi/Hinglish postfix spatial phrases: "<Entity> ke piche / ke samne / ke paas / se left"
  if (!landmark) {
    const postfixMatch = spoken.match(/([a-z0-9\s]{3,30}?)\s+(?:ke\s*(?:piche|samne|paas|pass|upar|baju|side)|se\s*(?:left|right)(?:\s*leke)?)/i);
    if (postfixMatch && postfixMatch[1]) {
      const entity = postfixMatch[1].replace(/^(?:(?:haan|arre|ji|sir|madam|mera|humara|yahan|bhaiya|bhai)\s+)+/i, '').trim();
      if (entity.length > 2) {
        if (/ke\s*piche/i.test(spoken)) {
          landmark = `Behind ${capitalizeWords(entity)}`;
        } else if (/ke\s*samne/i.test(spoken)) {
          landmark = `Opp. ${capitalizeWords(entity)}`;
        } else if (/ke\s*upar/i.test(spoken)) {
          landmark = `Above ${capitalizeWords(entity)}`;
        } else if (/se\s*left/i.test(spoken)) {
          landmark = `Left of ${capitalizeWords(entity)}`;
        } else if (/se\s*right/i.test(spoken)) {
          landmark = `Right of ${capitalizeWords(entity)}`;
        } else {
          landmark = `Near ${capitalizeWords(entity)}`;
        }
      }
    }
  }

  // No hardcoded landmark, house, city, or pincode defaults.
  // If nothing concrete was extracted, this is a review case, not a
  // cleaned address.
  const hasConcreteDetail = Boolean(houseDetail || floorDetail || gateDetail || landmark);
  if (!hasConcreteDetail) {
    return {
      success: false,
      buyerIntent: 'VERIFIED_GENUINE',
      confidenceScore: 20,
      needsReview: true,
      reviewReason: 'No house, floor, gate, or landmark detail was extracted from the spoken text. Do not dispatch on a fabricated address.',
      extractionMethod: 'rule_based_no_llm',
      cleanedAddressLine1: null,
      cleanedAddressLine2: null,
      cleanedLandmark: null,
      summaryHinglish: 'Buyer confirmed the order, but no concrete landmark/house detail was extracted; manual review is required.'
    };
  }

  let line1Parts = [houseDetail, floorDetail, gateDetail].filter(Boolean);
  let line1 = line1Parts.join(', ');
  if (line1.length > 35) {
    line1 = line1.slice(0, 35).trim();
  }
  if (!line1) {
    line1 = landmark;
  }

  let line2 = `${raw ? raw + ', ' : ''}${landmark}`;

  // Confidence from evidence only: house + landmark is stronger than
  // landmark alone. Never a fixed 96.
  let confidenceScore = 40;
  if (houseDetail) confidenceScore += 20;
  if (landmark) confidenceScore += 20;
  if (floorDetail || gateDetail) confidenceScore += 10;
  confidenceScore = Math.min(85, confidenceScore); // Rule-based cap: LLM review can score higher.

  const summaryHinglish = `Buyer confirmed: ${landmark || line1} (${line1})`;

  return {
    success: true,
    buyerIntent: 'VERIFIED_GENUINE',
    confidenceScore,
    extractionMethod: 'rule_based_no_llm',
    needsReview: confidenceScore < 60,
    cleanedAddressLine1: line1,
    cleanedAddressLine2: line2,
    cleanedLandmark: landmark || null,
    summaryHinglish,
    shopifyPayload: {
      shipping_address: {
        address1: line1,
        address2: line2,
        city: city || null,
        zip: pincode || null
      },
      tags: ['RTO-Shield-Verified', 'Address-Cleaned']
    },
    shiprocketPayload: {
      delivery_address: line1,
      delivery_address_2: line2,
      landmark: landmark || null
    }
  };
}

function capitalizeWords(str) {
  return str.replace(/\b\w/g, l => l.toUpperCase()).trim();
}

/**
 * Executes the full post-call resolution logic as specified in TRD Section 3.4
 */
async function applyPostCallDecision({ orderId, buyerIntent, spokenText, sellerId }) {
  const order = db.getOrderById(orderId);
  if (!order) throw new Error(`Order ${orderId} not found`);

  const seller = db.getSeller(sellerId || order.seller_id);
  if (!seller) throw new Error('Seller not found for order. Post-call decision was not applied.');

  if (buyerIntent === 'VERIFIED_GENUINE') {
    const rewritten = extractAndRewriteAddress({
      rawAddress: order.raw_address,
      spokenText,
      city: order.city,
      pincode: order.pincode,
      buyerIntent
    });

    if (!rewritten.success) {
      // Do not mark the order as verified on an unextracted address.
      const needsReviewOrder = db.updateOrder(orderId, {
        verification_status: 'needs_review',
        risk_score: order.risk_score,
        cleaned_address_line1: null,
        cleaned_address_line2: null,
        cleaned_landmark: null,
        rto_money_saved: null,
        rto_money_saved_reason: rewritten.reviewReason || 'Address extraction needs review.',
        tags: ['RTO-Shield-Needs-Review']
      });
      return {
        status: 'needs_review',
        order: needsReviewOrder,
        rewritten
      };
    }

    // Update order in DB. Money saved is NOT set here: courier cost
    // is not confirmed at this step, so no fixed amount is claimed.
    const updated = db.updateOrder(orderId, {
      verification_status: 'verified_cleaned',
      risk_score: 8,
      cleaned_address_line1: rewritten.cleanedAddressLine1,
      cleaned_address_line2: rewritten.cleanedAddressLine2,
      cleaned_landmark: rewritten.cleanedLandmark,
      rto_money_saved: null,
      rto_money_saved_reason: 'not_verified - courier cost not confirmed',
      tags: ['RTO-Shield-Verified', 'Address-Cleaned']
    });

    // Deduct Voice verification fee via Financial Ledger (₹12 ex-GST on confirmed disposition)
    try {
      recordUsageDebit({
        sellerId: seller.id,
        channel: 'voice',
        disposition: 'confirmed',
        purpose: 'VOICE_AI_VERIFICATION',
        referenceId: order.external_order_id,
        meta: { orderId: order.id, buyerPhone: order.buyer_phone }
      });
    } catch (ledgerErr) {
      console.warn(`[LEDGER] Debit notice: ${ledgerErr.message}`);
    }

    // Auto-Sync to live Shopify store. Failures are surfaced in the
    // returned result; a failed sync must never be shown as verified.
    let shopifySync = null;
    try {
      shopifySync = await updateShopifyOrderAddress({
        shopifyDomain: seller.shopify_domain,
        accessToken: seller.shopify_access_token,
        externalOrderId: order.external_order_id,
        shopifyOrderId: order.shopify_order_id,
        shippingAddress: rewritten.shopifyPayload.shipping_address,
        tags: ['RTO-Shield-Verified', 'Address-Cleaned'],
        note: `Shipvera AI: Verified genuine landmark. ${rewritten.summaryHinglish}`
      });
    } catch (e) {
      shopifySync = { success: false, error: e.message };
    }
    if (!shopifySync || shopifySync.success !== true) {
      db.updateOrder(orderId, {
        verification_status: 'sync_failed',
        sync_error: (shopifySync && (shopifySync.reason || shopifySync.error)) || 'Shopify sync failed.'
      });
    }

    // Auto-Sync to Shiprocket (failure surfaced, not only logged)
    let shiprocketSync = null;
    try {
      shiprocketSync = await updateShiprocketCustomAddress({
        token: seller.shiprocket_token,
        externalOrderId: order.external_order_id,
        deliveryAddress: rewritten.cleanedAddressLine1,
        deliveryAddress2: rewritten.cleanedAddressLine2,
        landmark: rewritten.cleanedLandmark,
        city: order.city,
        pincode: order.pincode
      });
    } catch (e) {
      shiprocketSync = { success: false, error: e.message };
    }

    // Record positive buyer trust outcome in global network graph
    db.recordBuyerOutcome(order.buyer_phone, 'VERIFIED_GENUINE');

    return {
      status: shopifySync && shopifySync.success === true ? 'verified_cleaned' : 'sync_failed',
      order: db.getOrderById(orderId),
      rewritten,
      shopifySync,
      shiprocketSync
    };
  } else if (buyerIntent === 'CANCEL_REQUESTED') {
    // Fake / impulse buyer cancelled order
    const updated = db.updateOrder(orderId, {
      verification_status: 'cancelled_fake',
      risk_score: 98,
      rto_money_saved: null,
      rto_money_saved_reason: 'not_verified - courier cost not confirmed',
      tags: ['RTO-Shield-Fake-Cancelled']
    });

    // Deduct Voice verification fee on cancelled disposition (₹12 ex-GST)
    try {
      recordUsageDebit({
        sellerId: seller.id,
        channel: 'voice',
        disposition: 'cancelled',
        purpose: 'VOICE_AI_FAKE_BLOCKED',
        referenceId: order.external_order_id,
        meta: { orderId: order.id, buyerPhone: order.buyer_phone }
      });
    } catch (e) {}

    // Auto-cancel on Shopify to prevent dispatch (failure surfaced)
    let shopifyCancel = null;
    try {
      shopifyCancel = await cancelShopifyOrder({
        shopifyDomain: seller.shopify_domain,
        accessToken: seller.shopify_access_token,
        externalOrderId: order.external_order_id,
        shopifyOrderId: order.shopify_order_id,
        reason: 'customer'
      });
    } catch (e) {
      shopifyCancel = { success: false, error: e.message };
    }

    // Record negative buyer trust
    db.recordBuyerOutcome(order.buyer_phone, 'CANCEL_REQUESTED');

    return {
      status: 'cancelled_fake',
      order: updated,
      moneySaved: null,
      moneySavedReason: 'not_verified - courier cost not confirmed',
      shopifyCancel
    };
  } else {
    // Unanswered / Dicey -> Handled by Trust Lock service
    return {
      status: 'dicey_unanswered',
      order
    };
  }
}

module.exports = {
  extractAndRewriteAddress,
  applyPostCallDecision
};
