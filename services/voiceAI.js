/**
 * Feature 2: "The Landmark Interrogator" (25-Second Hinglish Voice AI)
 * Orchestrates calls via Bolna / Vapi / Retell with Shipvera Dispatch AI persona.
 * Fully multi-tenant: dynamically supports any brand_name, buyer_name, cod_amount.
 */

const { db } = require('../db');

/**
 * Builds the dynamic Shipvera system prompt
 * Uses dynamic variables compatible with Bolna's {{variable_name}} syntax
 */
function buildShipveraSystemPrompt({ brandName = '{{brand_name}}', buyerName = '{{buyer_name}}', itemName = '{{item_name}}', codAmount = '{{cod_amount}}', rawAddress = '{{raw_address}}', city = '{{city}}', pincode = '{{pincode}}', missingFields = '{{missing_fields}}' } = {}) {
  return `# Role & Persona
You are Shipvera AI, an efficient, polite, street-smart dispatch assistant calling directly on behalf of ${brandName}'s warehouse dispatch desk in India. You speak natural conversational Hinglish (70% Hindi, 30% English words written in Roman script). You NEVER sound like a robotic call center agent. Keep every response under 2 short sentences.

# Context of Current Order
- Buyer Name: ${buyerName}
- Brand / Store: ${brandName}
- Item Ordered: ${itemName}
- COD Amount: ₹${codAmount}
- Raw Address Provided: "${rawAddress}, ${city} - ${pincode}"
- Missing Details Detected: ${missingFields}

# Your Exact Objective
1. Greet ${buyerName} quickly and mention their ₹${codAmount} parcel from ${brandName} is ready for dispatch.
   Example: "Namaste ${buyerName} ji! Main ${brandName} ke dispatch desk se Shipvera AI bol raha hoon. Aapka ₹${codAmount} ka order pack ho gaya hai."
2. Point out the specific missing detail in "${rawAddress}" (for example, missing house/flat number or missing nearby landmark).
3. Ask them casually: "Wahan aas-paas konsi mashhoor dukaan, mandir ya makan ka number/gate ka rang padta hai bata dijiye, taaki courier boy bina bhatke seedha deliver kar de?"
4. Listen carefully:
   - If they give a real landmark/house detail: Repeat the key landmark once to confirm ("Acha, note kar liya!"), thank them warmly, and end the call.
   - If they say they ordered by mistake, don't want it, or sound like they are pranking: Say "Koi baat nahi ji, main system mein abhi cancel kar deta hoon. Dhanyawad!" and end the call.

# Strict Guardrails
- Never speak long paragraphs.
- Never ask them to "Press 1 or 2".
- Never give human fake names. Always identify as Shipvera AI on behalf of ${brandName}.
- If interrupted, stop talking immediately and listen.`;
}
const https = require('https');
/**
 * Dispatches a REAL live voice AI phone call using Bolna.ai Calling API
 */
async function dispatchBolnaLiveCall({ order, seller, recipientPhone = null }) {
  const apiKey = process.env.BOLNA_API_KEY || 'bn-e1fd683a2da247a9b35a35a65d47344b';
  const agentId = process.env.BOLNA_AGENT_ID || '8fda4b1e-0095-47a3-b7a0-9b2092b27ece';

  if (!apiKey) {
    throw new Error('BOLNA_API_KEY is missing in environment variables.');
  }

  // Format phone number to E.164 (+91...)
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

  const brandName = (seller && seller.brand_name) || 'Shipvera Dispatch';
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

/**
 * Simulates or dispatches an outbound call through Voice AI Provider (Bolna/Vapi)
 */
async function triggerOutboundCall({ order, seller, forcedIntent = null, live = false, recipientPhone = null }) {
  const brandName = seller.brand_name || 'Dispatch Warehouse';
  const buyerName = order.buyer_name;
  const rawAddress = order.raw_address;
  const codAmount = order.cod_amount;

  // Check wallet balance (Strictly Pay-As-You-Go)
  if (seller.wallet_balance_inr < 6.00) {
    throw new Error('Insufficient wallet balance. Recharge required before calls can be dispatched.');
  }

  // Update order status to 'calling'
  db.updateOrder(order.id, { verification_status: 'calling' });

  // If live calling is requested, trigger Bolna API
  if (live) {
    const liveRes = await dispatchBolnaLiveCall({ order, seller, recipientPhone });
    if (!liveRes.success) {
      throw new Error(`Bolna Call Dispatch Failed: ${liveRes.error || 'Unknown error'}`);
    }

    const callLog = db.createCallLog({
      order_id: order.id,
      seller_id: seller.id,
      provider_call_id: liveRes.executionId || `bolna_exec_${Date.now()}`,
      duration_seconds: 0,
      recording_url: `https://api.bolna.ai/call/${liveRes.executionId}`,
      transcript: [
        { role: 'system', speaker: 'Bolna AI Gateway', text: `Live call initiated to ${liveRes.recipient}. Execution ID: ${liveRes.executionId}` }
      ],
      extracted_landmark: null,
      buyer_intent: 'IN_PROGRESS',
      call_cost_inr: 6.00
    });

    return {
      orderId: order.id,
      live: true,
      executionId: liveRes.executionId,
      callLog
    };
  }

  let intent = forcedIntent;
  if (!intent) {
    if (order.risk_score >= 80) {
      intent = 'CANCEL_REQUESTED';
    } else if (order.risk_score >= 60) {
      intent = Math.random() > 0.4 ? 'DICEY_NO_ANSWER' : 'CANCEL_REQUESTED';
    } else {
      intent = 'VERIFIED_GENUINE';
    }
  }

  let transcript = [];
  let durationSeconds = 24;
  let extractedLandmark = null;

  if (intent === 'VERIFIED_GENUINE') {
    extractedLandmark = `Opp. Bikaner Sweets, Behind 56 Dukan`;
    transcript = [
      { role: 'ai', speaker: 'Shipvera AI', text: `Namaste ${buyerName} ji! Main ${brandName} ke dispatch desk se Shipvera AI bol raha hoon. Aapka ₹${codAmount} ka order pack ho gaya hai.` },
      { role: 'ai', speaker: 'Shipvera AI', text: `Bhaiya, aapne address mein '${rawAddress}' likha hai par exact landmark nahi hai. Wahan aas-paas konsi dukaan ya building hai bata denge taaki courier boy seedha deliver kare?` },
      { role: 'user', speaker: `Buyer (${buyerName})`, text: `Haan bhaiya, 56 Dukan ke piche Bikaner Sweets ke samne safed gate hai 2nd floor, wahi deliver karwana.` },
      { role: 'ai', speaker: 'Shipvera AI', text: `Acha, Bikaner Sweets ke samne safed gate 2nd floor, note kar liya! 3-4 din mein parcel mil jayega. Dhanyawad!` }
    ];
    durationSeconds = 25;
  } else if (intent === 'CANCEL_REQUESTED') {
    transcript = [
      { role: 'ai', speaker: 'Shipvera AI', text: `Namaste ${buyerName} ji! Main ${brandName} ke dispatch desk se Shipvera AI bol raha hoon. Aapka ₹${codAmount} ka COD parcel pack ho gaya hai.` },
      { role: 'ai', speaker: 'Shipvera AI', text: `Bhaiya aapka address incomplete hai, aas-pass koi landmark bata denge?` },
      { role: 'user', speaker: `Buyer (${buyerName})`, text: `Nahi chahiye bhaiya, galti se order ho gaya tha. Cancel kar do please.` },
      { role: 'ai', speaker: 'Shipvera AI', text: `Koi baat nahi ji, main system mein abhi cancel kar deta hoon. Dhanyawad!` }
    ];
    durationSeconds = 12;
  } else {
    // Dicey / No Answer
    transcript = [
      { role: 'system', speaker: 'Telecom Carrier', text: `Call dialed to +91${order.buyer_phone.slice(-10)}. Ringing for 35 seconds... No answer / User busy.` }
    ];
    durationSeconds = 35;
  }

  // Create Call Log
  const callLog = db.createCallLog({
    order_id: order.id,
    seller_id: seller.id,
    provider_call_id: `bolna_call_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
    duration_seconds: durationSeconds,
    recording_url: `https://cdn.shipvera.com/recordings/call_${order.id}.mp3`,
    transcript,
    extracted_landmark: extractedLandmark,
    buyer_intent: intent,
    call_cost_inr: intent === 'DICEY_NO_ANSWER' ? 0.00 : 6.00
  });

  return {
    orderId: order.id,
    callLog,
    intent,
    transcript,
    extractedLandmark
  };
}

module.exports = {
  buildShipveraSystemPrompt,
  dispatchBolnaLiveCall,
  triggerOutboundCall
};
