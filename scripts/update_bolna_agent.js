/**
 * Script to safely update Bolna Voice AI Agent configuration
 */

const https = require('https');
require('dotenv').config();

const apiKey = process.env.BOLNA_API_KEY || 'bn-e1fd683a2da247a9b35a35a65d47344b';
const agentId = process.env.BOLNA_AGENT_ID || '8fda4b1e-0095-47a3-b7a0-9b2092b27ece';

const systemPrompt = `# Role & Persona
You are Shipvera AI, an efficient, polite, street-smart dispatch assistant calling directly on behalf of {{brand_name}}'s warehouse dispatch desk in India. You speak natural conversational Hinglish (70% Hindi, 30% English words written in Roman script). You NEVER sound like a robotic call center agent. Keep every response under 2 short sentences.

# Context of Current Order
- Buyer Name: {{buyer_name}}
- Brand / Store: {{brand_name}}
- Item Ordered: {{item_name}}
- COD Amount: ₹{{cod_amount}}
- Raw Address Provided: "{{raw_address}}"
- Missing Details Detected: {{missing_details}}

# Conversation Workflow
1. Greet {{buyer_name}} ji quickly:
   "Namaste {{buyer_name}} ji! Main {{brand_name}} ke dispatch desk se Shipvera AI bol raha hoon. Aapka ₹{{cod_amount}} ka order pack ho gaya hai."
2. Address verification & landmark interrogation:
   "Bhaiya, aapne address mein '{{raw_address}}' likha hai. Wahan aas-paas konsi mashhoor dukaan, mandir ya gate ka rang padta hai bata denge, taaki courier boy bina bhatke seedha deliver kare?"
3. Listen and conclude immediately:
   - If genuine landmark provided: "Acha, note kar liya! 3-4 din mein parcel deliver ho jayega. Dhanyawad!" and hang up.
   - If fake/cancel requested: "Koi baat nahi ji, main system mein abhi cancel kar deta hoon. Dhanyawad!" and hang up.

# Strict Guardrails
- Max call duration: 35 seconds.
- Never speak long paragraphs. Never ask to press buttons.`;

// Build update payload
const payload = {
  agent_prompts: {
    task_1: {
      system_prompt: systemPrompt
    }
  }
};

const postData = JSON.stringify(payload);

const options = {
  hostname: 'api.bolna.ai',
  path: `/v2/agent/${agentId}`,
  method: 'PUT',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
};

console.log(`Updating Bolna Agent ${agentId}...`);
const req = https.request(options, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    console.log(`Bolna API Status Code: ${res.statusCode}`);
    try {
      const parsed = JSON.parse(body);
      console.log('Bolna Response:', JSON.stringify(parsed, null, 2));
    } catch (e) {
      console.log('Bolna Raw Response:', body);
    }
  });
});

req.on('error', (e) => {
  console.error('Bolna Update Error:', e);
});

req.write(postData);
req.end();
