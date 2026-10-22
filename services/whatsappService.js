/**
 * Shipvera WhatsApp Business Service
 * Integrates with Meta WhatsApp Cloud API & Indian BSPs (AiSensy / Interakt / Gupshup)
 * Used for Feature 4: ₹19 Trust Lock & Address Confirmation Messages
 */

const https = require('https');

/**
 * Sends a WhatsApp template message to the buyer
 */
async function sendWhatsAppTrustLock({ buyerPhone, buyerName, codAmount, tokenAmount = 19, paymentUrl }) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  // Format phone to international format without + (e.g., 919876543210)
  let phone = (buyerPhone || '').replace(/[^\d]/g, '');
  if (phone.length === 10) phone = '91' + phone;

  // If no live WhatsApp API credentials are set, run in structured Sandbox Log mode
  if (!token || !phoneNumberId || token.includes('demo')) {
    console.log(`[WHATSAPP DISPATCH - SANDBOX MODE]`);
    console.log(`   To: +${phone} (${buyerName})`);
    console.log(`   Message: "Hi ${buyerName}, aapka ₹${codAmount} ka parcel hold na ho isliye bas ₹${tokenAmount} ka chota token UPI karke address lock kar dein. Baaki delivery par dena!"`);
    console.log(`   Payment Link: ${paymentUrl}`);
    return {
      success: true,
      mode: 'sandbox',
      recipient: phone,
      paymentUrl
    };
  }

  const payload = {
    messaging_product: 'whatsapp',
    to: phone,
    type: 'template',
    template: {
      name: process.env.WHATSAPP_TEMPLATE_NAME || 'shipvera_trust_lock',
      language: { code: 'en' },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: buyerName || 'Customer' },
            { type: 'text', text: String(codAmount) },
            { type: 'text', text: String(tokenAmount) },
            { type: 'text', text: paymentUrl }
          ]
        }
      ]
    }
  };

  const postData = JSON.stringify(payload);

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'graph.facebook.com',
      path: `/v20.0/${phoneNumberId}/messages`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
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
            console.log(`[WHATSAPP SENT] Message delivered to +${phone}. Message ID: ${json.messages?.[0]?.id}`);
            resolve({ success: true, live: true, messageId: json.messages?.[0]?.id });
          } else {
            console.warn(`[WHATSAPP WARN] Status ${res.statusCode}:`, body);
            resolve({ success: false, statusCode: res.statusCode, error: json.error?.message || body });
          }
        } catch (e) {
          resolve({ success: false, error: body });
        }
      });
    });

    req.on('error', (err) => {
      console.error('[WHATSAPP ERR]', err.message);
      resolve({ success: false, error: err.message });
    });

    req.write(postData);
    req.end();
  });
}

module.exports = {
  sendWhatsAppTrustLock
};
