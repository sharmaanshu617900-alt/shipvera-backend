/**
 * Feature 2: "The Landmark Interrogator" (Hinglish Voice AI) — SARVAM ONLY.
 *
 * This file replaces the old voice provider integration. There is NO
 * old-provider SDK call, endpoint, agent id, or fallback anywhere
 * in this file. Any old-provider credential that was ever committed
 * to this public repo must still be revoked in that provider dashboard
 * and cleaned from git history by the owner — deleting code does not
 * erase history.
 *
 * How Sarvam fits here:
 * - Saaras STT + Bulbul TTS are real building blocks in
 *   services/sarvamClient.js (verified Sarvam REST endpoints).
 * - A live PHONE call additionally needs a Sarvam Voice Agents agent
 *   and a phone number created in the Sarvam dashboard. Code alone
 *   CANNOT create them. That is why dispatch checks for
 *   SARVAM_AGENT_ID and SARVAM_PHONE_NUMBER_ID from env only and
 *   fails closed (NOT_CONFIGURED) when either is missing.
 * - The Sarvam Voice Agents outbound-dial API endpoint was NOT
 *   verified from Sarvam's public docs during this migration, so it
 *   is NOT hardcoded here. If SARVAM_VOICE_AGENT_DISPATCH_URL is not
 *   set by the operator after confirming it in the Sarvam dashboard /
 *   docs, dispatch fails closed with VOICE_AGENT_OUTBOUND_UNVERIFIED
 *   and NO call is placed. Never invent an outbound endpoint.
 *
 * REAL-ONLY RULES (enforced in this file):
 * - OTP-first: voice is dispatched only when verificationRouter
 *   allows it (OTP failed / no reply / mismatch, high-value, or
 *   repeat-RTO). Otherwise triggerOutboundCall throws OTP_REQUIRED
 *   and no call is placed.
 * - Hard 60-second cap: dispatch payload carries
 *   max_duration_seconds: 60, and settleCallCost caps billed duration
 *   at 60 and flags CAP_EXCEEDED instead of charging beyond it.
 * - Credit is deducted ONLY on a connected call. Unanswered / busy /
 *   failed calls cost nothing (see settleCallCost).
 * - Wallet cost is NOT charged at dispatch time. Cost is settled only
 *   after a real call outcome is confirmed via webhook / post-call
 *   decision. PAYG voice price is Rs.12 ex-GST (TrustOrder rule);
 *   the wallet-balance gate below uses Rs.12 so a seller cannot
 *   dispatch a call they cannot pay for.
 * - Simulation is only honoured when SHIPVERA_ALLOW_SIMULATED_CALLS
 *   is exactly "true" (local testing only) and never invents a
 *   transcript, recording URL, landmark, or buyer intent.
 */

const https = require('https');
const { db } = require('../db');
const { voiceAllowed } = require('./verificationRouter');

const MAX_CALL_SECONDS = 60;
const VOICE_PAYG_EX_GST_INR = 12;
// Pulse rates used for cost logging. These are the rates recorded in
// the project's Sarvam research (agent per 60s pulse, telephony per
// 30s pulse). They MUST be re-checked against the first real Sarvam
// bill before any seller is charged on them — see UNVERIFIED in README.
const SARVAM_AGENT_RATE_PER_60S_PULSE_INR = 3.50;
const SARVAM_TELEPHONY_RATE_PER_30S_PULSE_INR = 0.20;

function buildTrustOrderSystemPrompt({ brandName = '{{brand_name}}', buyerName = '{{buyer_name}}', itemName = '{{item_name}}', codAmount = '{{cod_amount}}', rawAddress = '{{raw_address}}', city = '{{city}}', pincode = '{{pincode}}', missingFields = '{{missing_fields}}' } = {}) {
  return `# Role & Persona\nYou are TrustOrder AI, an efficient, polite, street-smart dispatch assistant calling directly on behalf of ${brandName}'s warehouse dispatch desk in India. You speak natural conversational Hinglish (70% Hindi, 30% English words written in Roman script). You NEVER sound like a robotic call center agent. Keep every response under 2 short sentences.\n\n# Context of Current Order\n- Buyer Name: ${buyerName}\n- Brand / Store: ${brandName}\n- Item Ordered: ${itemName}\n- COD Amount: \u20B9${codAmount}\n- Raw Address Provided: "${rawAddress}, ${city} - ${pincode}"\n- Missing Details Detected: ${missingFields}\n\n# Your Exact Objective\n1. Greet ${buyerName} quickly and mention their \u20B9${codAmount} parcel from ${brandName} is ready for dispatch.\n   Example: "Namaste ${buyerName} ji! Main ${brandName} ke dispatch desk se TrustOrder AI bol raha hoon. Aapka \u20B9${codAmount} ka order pack ho gaya hai."\n2. Point out the specific missing detail in "${rawAddress}" (for example, missing house/flat number or missing nearby landmark).\n3. Ask them casually: "Wahan aas-paas konsi mashhoor dukaan, mandir ya makan ka number/gate ka rang padta hai bata dijiye, taaki courier boy bina bhatke seedha deliver kar de?"\n4. Listen carefully:\n   - If they give a real landmark/house detail: Repeat the key landmark once to confirm ("Acha, note kar liya!"), thank them warmly, and end the call.\n   - If they say they ordered by mistake, don't want it, or sound like they are pranking: Say "Koi baat nahi ji, main system mein abhi cancel kar deta hoon. Dhanyawad!" and end the call.\n\n# Strict Guardrails\n- Never speak long paragraphs.\n- Never ask them to "Press 1 or 2".\n- Never give human fake names. Always identify as TrustOrder AI on behalf of ${brandName}.\n- If interrupted, stop talking immediately and listen.\n- Hard stop at 60 seconds. Do not extend the call.`;
}
const buildShipveraSystemPrompt = buildTrustOrderSystemPrompt;

function normalizePhone(raw) {
  let phone = String(raw || '').trim().replace(/[^\d+]/g, '');
  if (!phone.startsWith('+')) {
    if (phone.length === 10) phone = '+91' + phone;
    else if (phone.length === 12 && phone.startsWith('91')) phone = '+' + phone;
  }
  return phone;
}

function buildVoiceAgentDispatchPayload({ order, seller, recipientPhone }) {
  const brandName = seller.brand_name || 'TrustOrder Dispatch';
  const buyerName = order.buyer_name || 'Customer';
  return {
    agent_id: process.env.SARVAM_AGENT_ID,
    phone_number_id: process.env.SARVAM_PHONE_NUMBER_ID,
    recipient_phone_number: recipientPhone,
    max_duration_seconds: MAX_CALL_SECONDS,
    system_prompt: buildTrustOrderSystemPrompt({
      brandName,
      buyerName,
      itemName: (order.items && order.items[0] && order.items[0].title) || 'Parcel',
      codAmount: String(order.cod_amount || 0),
      rawAddress: order.raw_address || '',
      city: order.city || '',
      pincode: order.pincode || '',
      missingFields: (order.missing_fields && order.missing_fields.join(', ')) || 'Makan number ya landmark',
    }),
    user_data: {
      buyer_name: buyerName,
      brand_name: brandName,
      item_name: (order.items && order.items[0] && order.items[0].title) || 'Parcel',
      cod_amount: String(order.cod_amount || 0),
      raw_address: order.raw_address || '',
      missing_details: (order.missing_fields && order.missing_fields.join(', ')) || 'Makan number ya landmark',
    },
  };
}

/**
 * Pure pulse math (uncapped): agent ceil(duration/60), telephony
 * ceil(duration/30). capExceeded flags calls over the 60s hard cap.
 * Billing itself is capped in settleCallCost, not here, so the pulse
 * math stays auditable against a real bill.
 */
function calculateSarvamCallCost(durationSeconds) {
  const seconds = Number(durationSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return { billedSeconds: 0, agentPulses: 0, telephonyPulses: 0, costInr: 0, capExceeded: false };
  const capExceeded = seconds > MAX_CALL_SECONDS;
  const agentPulses = Math.ceil(seconds / 60);
  const telephonyPulses = Math.ceil(seconds / 30);
  const costInr = Math.round((agentPulses * SARVAM_AGENT_RATE_PER_60S_PULSE_INR + telephonyPulses * SARVAM_TELEPHONY_RATE_PER_30S_PULSE_INR) * 100) / 100;
  return { billedSeconds: seconds, agentPulses, telephonyPulses, costInr, capExceeded };
}

function settleCallCost({ durationSeconds, connected }) {
  if (!connected) return { charged: false, costInr: 0, reason: 'not_connected_no_charge' };
  const calc = calculateSarvamCallCost(durationSeconds);
  const billed = calc.capExceeded ? calculateSarvamCallCost(MAX_CALL_SECONDS) : calc;
  return { charged: true, costInr: billed.costInr, billedSeconds: billed.billedSeconds, capExceeded: calc.capExceeded, reason: calc.capExceeded ? 'billed_capped_at_60s' : 'connected_call' };
}

function sarvamConfigStatus() {
  return {
    apiKey: Boolean(process.env.SARVAM_API_KEY),
    agentId: Boolean(process.env.SARVAM_AGENT_ID),
    phoneNumberId: Boolean(process.env.SARVAM_PHONE_NUMBER_ID),
    dispatchUrl: Boolean(process.env.SARVAM_VOICE_AGENT_DISPATCH_URL),
    configured: Boolean(process.env.SARVAM_API_KEY && process.env.SARVAM_AGENT_ID && process.env.SARVAM_PHONE_NUMBER_ID),
  };
}

async function dispatchSarvamLiveCall({ order, seller, recipientPhone = null }) {
  const apiKey = process.env.SARVAM_API_KEY;
  const agentId = process.env.SARVAM_AGENT_ID;
  const phoneNumberId = process.env.SARVAM_PHONE_NUMBER_ID;
  if (!apiKey || !agentId || !phoneNumberId) {
    const err = new Error('SARVAM_API_KEY, SARVAM_AGENT_ID and SARVAM_PHONE_NUMBER_ID must all be set in environment variables. Create the agent and phone number in the Sarvam dashboard first. No live call was placed.');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }
  if (!order || !seller) throw new Error('Order and seller are required to dispatch a live call.');
  const dispatchUrl = process.env.SARVAM_VOICE_AGENT_DISPATCH_URL;
  if (!dispatchUrl) {
    const err = new Error('SARVAM_VOICE_AGENT_DISPATCH_URL is not set. The Sarvam Voice Agents outbound-dial endpoint was not verified from Sarvam docs, so no endpoint is guessed. Confirm it in the Sarvam dashboard/docs, set it in env, then retry. No live call was placed.');
    err.code = 'VOICE_AGENT_OUTBOUND_UNVERIFIED';
    throw err;
  }
  let phone = normalizePhone(recipientPhone || order.buyer_phone || '');
  if (phone.length < 12) throw new Error(`Invalid phone number: ${phone}. Needs 10 digits with country code (+91XXXXXXXXXX).`);
  const payload = buildVoiceAgentDispatchPayload({ order, seller, recipientPhone: phone });
  let url;
  try { url = new URL(dispatchUrl); } catch (e) {
    const err = new Error('SARVAM_VOICE_AGENT_DISPATCH_URL is not a valid URL. No live call was placed.');
    err.code = 'VOICE_AGENT_OUTBOUND_UNVERIFIED';
    throw err;
  }
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(payload);
    const req = https.request({
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + (url.search || ''),
      method: 'POST',
      headers: {
        'api-subscription-key': apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ success: true, executionId: json.execution_id || json.id || json.call_id || null, recipient: phone, raw: json });
          } else {
            resolve({ success: false, statusCode: res.statusCode, error: json.message || json.detail || body });
          }
        } catch (e) {
          resolve({ success: false, statusCode: res.statusCode, error: body });
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function simulationAllowed() {
  return process.env.SHIPVERA_ALLOW_SIMULATED_CALLS === 'true';
}

async function triggerOutboundCall({ order, seller, forcedIntent = null, live, recipientPhone = null, otpStatus = null, flags = null } = {}) {
  if (!order || !seller) throw new Error('Order and seller are required to trigger a call.');
  if (forcedIntent) throw new Error('forcedIntent is not supported in real mode. Buyer intent must come from a real call outcome, never from a caller-supplied intent.');
  const gate = voiceAllowed(order, { otpStatus, flags });
  if (!gate.allowed) {
    const err = new Error(`OTP_FIRST: voice requires a qualifying reason (otp failed/no_reply/mismatch, high-value, or repeat-RTO). Got none. Run OTP first, then retry with its real result. No call was placed.`);
    err.code = 'OTP_REQUIRED';
    throw err;
  }
  const wantLive = live !== false;
  if (!wantLive) {
    if (!simulationAllowed()) {
      const err = new Error('Simulated calls are disabled. Set SHIPVERA_ALLOW_SIMULATED_CALLS=true for local testing only, or omit live to place a real Sarvam call. No call was placed and no call log was created.');
      err.code = 'SIMULATION_DISABLED';
      throw err;
    }
    return { orderId: order.id, live: false, simulated: true, simulationOnly: true, intent: null, transcript: null, recordingUrl: null, extractedLandmark: null, warning: 'SIMULATION ONLY - no real call was placed and no buyer outcome was recorded.' };
  }
  if (seller.wallet_balance_inr < VOICE_PAYG_EX_GST_INR) {
    throw new Error(`Insufficient wallet balance. PAYG voice is Rs.${VOICE_PAYG_EX_GST_INR} ex-GST; recharge required before calls can be dispatched.`);
  }
  db.updateOrder(order.id, { verification_status: 'calling' });
  const liveRes = await dispatchSarvamLiveCall({ order, seller, recipientPhone });
  if (!liveRes.success) {
    const err = new Error(`Sarvam Call Dispatch Failed: ${liveRes.error || 'Unknown error'}`);
    err.code = 'SARVAM_DISPATCH_FAILED';
    err.statusCode = liveRes.statusCode;
    throw err;
  }
  const callLog = db.createCallLog({
    order_id: order.id,
    seller_id: seller.id,
    provider_call_id: liveRes.executionId || null,
    duration_seconds: 0,
    recording_url: null,
    transcript: [
      { role: 'system', speaker: 'Sarvam Voice Agent', text: `Live call initiated to ${liveRes.recipient}. Execution ID: ${liveRes.executionId}` },
    ],
    extracted_landmark: null,
    buyer_intent: 'IN_PROGRESS',
    call_cost_inr: 0,
  });
  return { orderId: order.id, live: true, executionId: liveRes.executionId, callLog };
}

module.exports = {
  buildTrustOrderSystemPrompt,
  buildShipveraSystemPrompt,
  dispatchSarvamLiveCall,
  triggerOutboundCall,
  calculateSarvamCallCost,
  settleCallCost,
  buildVoiceAgentDispatchPayload,
  sarvamConfigStatus,
  MAX_CALL_SECONDS,
  VOICE_PAYG_EX_GST_INR,
  SARVAM_AGENT_RATE_PER_60S_PULSE_INR,
  SARVAM_TELEPHONY_RATE_PER_30S_PULSE_INR,
};
