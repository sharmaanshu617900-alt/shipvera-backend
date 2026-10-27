/**
 * Feature 2: "The Landmark Interrogator" (25-Second Hinglish Voice AI)
 * Orchestrates calls via Bolna with the TrustOrder Dispatch AI persona.
 *
 * REAL-ONLY RULES (enforced in this file):
 * - Bolna credentials come ONLY from environment variables.
 *   There is no hardcoded fallback credential or agent ID in this file.
 *   If BOLNA_API_KEY or BOLNA_AGENT_ID is missing, dispatch fails with
 *   a NOT_CONFIGURED error instead of pretending a call happened.
 * - The automated path is LIVE by default. triggerOutboundCall treats a
 *   missing `live` argument as live=true. An explicit live=false is
 *   only honoured when TRUSTORDER_ALLOW_SIMULATED_CALLS or SHIPVERA_ALLOW_SIMULATED_CALLS is exactly "true"
 *   (local testing only). A simulated result never invents a transcript,
 *   a recording URL, a landmark, or buyer intent, and it is never
 *   recorded as a real call log.
 * - Wallet cost is NOT charged at dispatch time. Cost is settled only
 *   after a real call outcome is confirmed via webhook / post-call
 *   decision, per the PRD rule: charge only when a call connects or a
 *   Trust Lock triggers.
 */

const https = require('https');
const { db } = require('../db');

function buildTrustOrderSystemPrompt({ brandName = '{{brand_name}}', buyerName = '{{buyer_name}}', itemName = '{{item_name}}', codAmount = '{{cod_amount}}', rawAddress = '{{raw_address}}', city = '{{city}}', pincode = '{{pincode}}', missingFields = '{{missing_fields}}' } = {}) {
  return `# Role & Persona\nYou are TrustOrder AI, an efficient, polite, street-smart dispatch assistant calling directly on behalf of ${brandName}'s warehouse dispatch desk in India. You speak natural conversational Hinglish (70% Hindi, 30% English words written in Roman script). You NEVER sound like a robotic call center agent. Keep every response under 2 short sentences.\n\n# Context of Current Order\n- Buyer Name: ${buyerName}\n- Brand / Store: ${brandName}\n- Item Ordered: ${itemName}\n- COD Amount: \u20B9${codAmount}\n- Raw Address Provided: "${rawAddress}, ${city} - ${pincode}"\n- Missing Details Detected: ${missingFields}\n\n# Your Exact Objective\n1. Greet ${buyerName} quickly and mention their \u20B9${codAmount} parcel from ${brandName} is ready for dispatch.\n   Example: "Namaste ${buyerName} ji! Main ${brandName} ke dispatch desk se TrustOrder AI bol raha hoon. Aapka \u20B9${codAmount} ka order pack ho gaya hai."\n2. Point out the specific missing detail in "${rawAddress}" (for example, missing house/flat number or missing nearby landmark).\n3. Ask them casually: "Wahan aas-paas konsi mashhoor dukaan, mandir ya makan ka number/gate ka rang padta hai bata dijiye, taaki courier boy bina bhatke seedha deliver kar de?"\n4. Listen carefully:\n   - If they give a real landmark/house detail: Repeat the key landmark once to confirm ("Acha, note kar liya!"), thank them warmly, and end the call.\n   - If they say they ordered by mistake, don't want it, or sound like they are pranking: Say "Koi baat nahi ji, main system mein abhi cancel kar deta hoon. Dhanyawad!" and end the call.\n\n# Strict Guardrails\n- Never speak long paragraphs.\n- Never ask them to "Press 1 or 2".\n- Never give human fake names. Always identify as TrustOrder AI on behalf of ${brandName}.\n- If interrupted, stop talking immediately and listen.`;
}
const buildShipveraSystemPrompt = buildTrustOrderSystemPrompt;

/**
 * Dispatches a REAL live voice AI phone call using the Bolna.ai Calling API.
 * Throws a NOT_CONFIGURED error when credentials are missing.
 */
async function dispatchBolnaLiveCall({ order, seller, recipientPhone = null }) {
  const apiKey = process.env.BOLNA_API_KEY;
  const agentId = process.env.BOLNA_AGENT_ID;

  if (!apiKey || !agentId) {
    const err = new Error('BOLNA_API_KEY and BOLNA_AGENT_ID must be set in environment variables. No live call was placed.');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }
  if (!order || !seller) {
    throw new Error('Order and seller are required to dispatch a live call.');
  }

  let phone = (recipientPhone || order.buyer_phone || '').trim();
  phone = phone.replace(/[^\d+]/g, '');
  if (!phone.startsWith('+')) {
    if (phone.length === 10) {
      phone = '+91' + phone;
    } else if (phone.length === 12 && phone.startsWith('91')) {
      phone = '+' + phone;
    }
  }
  if (phone.length < 12) {
    throw new Error(`Invalid phone number: ${phone}. Needs 10 digits with country code (+91XXXXXXXXXX).`);
  }

  const brandName = seller.brand_name || 'TrustOrder Dispatch';
  const buyerName = order.buyer_name || 'Customer';
  const codAmount = String(order.cod_amount || 0);
  const rawAddress = order.raw_address || '';
  const missingDetails = (order.missing_fields && order.missing_fields.join(', ')) || 'Makan number ya landmark';
  const itemName = (order.items && order.items[0] && order.items[0].title) || 'Parcel';

  const payload = {
    agent_id: agentId,
    recipient_phone_number: phone,
    user_data: {
      buyer_name: buyerName,
      brand_name: brandName,
      item_name: itemName,
      cod_amount: codAmount,
      raw_address: rawAddress,
      missing_details: missingDetails
    }
  };

  if (process.env.BOLNA_FROM_PHONE_NUMBER) {
    payload.from_phone_number = process.env.BOLNA_FROM_PHONE_NUMBER;
  }

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(payload);
    const req = https.request({
      hostname: 'api.bolna.ai',
      path: '/call',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({
              success: true,
              executionId: json.execution_id || json.id,
              recipient: phone,
              raw: json
            });
          } else {
            resolve({
              success: false,
              statusCode: res.statusCode,
              error: json.message || json.detail || body
            });
          }
        } catch (e) {
          resolve({
            success: false,
            statusCode: res.statusCode,
            error: body
          });
        }
      });
    });

    req.on('error', err => reject(err));
    req.write(postData);
    req.end();
  });
}

function simulationAllowed() {
  return process.env.TRUSTORDER_ALLOW_SIMULATED_CALLS === 'true' || process.env.SHIPVERA_ALLOW_SIMULATED_CALLS === 'true';
}

/**
 * Dispatches an outbound call. Live by default.
 *
 * @param {object} opts
 * @param {boolean} [opts.live] - true (default) = real Bolna call.
 *   Explicit false is ONLY honoured when SHIPVERA_ALLOW_SIMULATED_CALLS=true.
 *   In every other case an explicit false throws instead of simulating.
 */
async function triggerOutboundCall({ order, seller, forcedIntent = null, live, recipientPhone = null }) {
  if (!order || !seller) {
    throw new Error('Order and seller are required to trigger a call.');
  }
  if (forcedIntent) {
    throw new Error('forcedIntent is not supported in real mode. Buyer intent must come from a real call outcome, never from a caller-supplied intent.');
  }

  const wantLive = live !== false;

  if (!wantLive) {
    if (!simulationAllowed()) {
      const err = new Error('Simulated calls are disabled. Set TRUSTORDER_ALLOW_SIMULATED_CALLS=true for local testing only, or omit live to place a real Bolna call. No call was placed and no call log was created.');
      err.code = 'SIMULATION_DISABLED';
      throw err;
    }
    // Opt-in local testing only: return an explicit simulation marker.
    // No transcript, recording URL, landmark, intent, or call log is invented.
    return {
      orderId: order.id,
      live: false,
      simulated: true,
      simulationOnly: true,
      intent: null,
      transcript: null,
      recordingUrl: null,
      extractedLandmark: null,
      warning: 'SIMULATION ONLY - no real call was placed and no buyer outcome was recorded.'
    };
  }

  if (seller.wallet_balance_inr < 6.00) {
    throw new Error('Insufficient wallet balance. Recharge required before calls can be dispatched.');
  }

  db.updateOrder(order.id, { verification_status: 'calling' });

  const liveRes = await dispatchBolnaLiveCall({ order, seller, recipientPhone });
  if (!liveRes.success) {
    const err = new Error(`Bolna Call Dispatch Failed: ${liveRes.error || 'Unknown error'}`);
    err.code = 'BOLNA_DISPATCH_FAILED';
    err.statusCode = liveRes.statusCode;
    throw err;
  }

  // Recording URL and transcript are NOT invented here. They arrive later
  // from the real Bolna webhook (routes/webhooks.js voice/call-completed).
  const callLog = db.createCallLog({
    order_id: order.id,
    seller_id: seller.id,
    provider_call_id: liveRes.executionId || null,
    duration_seconds: 0,
    recording_url: null,
    transcript: [
      { role: 'system', speaker: 'Bolna AI Gateway', text: `Live call initiated to ${liveRes.recipient}. Execution ID: ${liveRes.executionId}` }
    ],
    extracted_landmark: null,
    buyer_intent: 'IN_PROGRESS',
    call_cost_inr: 0
  });

  return {
    orderId: order.id,
    live: true,
    executionId: liveRes.executionId,
    callLog
  };
}

module.exports = {
  buildTrustOrderSystemPrompt,
  buildShipveraSystemPrompt,
  dispatchBolnaLiveCall,
  triggerOutboundCall
};
