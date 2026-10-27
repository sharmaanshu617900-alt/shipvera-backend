/**
 * TrustOrder WhatsApp Business Service
 * Integrates with Meta WhatsApp Cloud API & Indian BSPs (AiSensy / Interakt / Gupshup)
 * Used for Feature 4: ₹19 Trust Lock & Address Confirmation Messages
 */

const https = require('https');

/**
 * Sends a WhatsApp template message to the buyer
 */
async function sendWhatsAppTrustLock({ buyerPhone, buyerName, codAmount, tokenAmount = 19, paymentUrl }) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_CLOUD_API_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  // Format phone to international format without + (e.g., 919876543210)
  let phone = (buyerPhone || '').replace(/[^\d]/g, '');
  if (phone.length === 10) phone = '91' + phone;

  // If no live WhatsApp API credentials are set, fail visibly.
  // Never return success:true when no message was actually sent.
  if (!token || !phoneNumberId || token.includes('demo')) {
    console.warn('[WHATSAPP DISPATCH - NOT CONFIGURED] No live WhatsApp credentials; message was NOT sent.');
    return {
      success: false,
      mode: 'not_configured',
      reason: 'WHATSAPP_ACCESS_TOKEN (or WHATSAPP_CLOUD_API_TOKEN) and WHATSAPP_PHONE_NUMBER_ID must be set. No WhatsApp message was sent.',
      recipient: phone,
      paymentUrl
    };
  }

  const payload = {
    messaging_product: 'whatsapp',
    to: phone,
    type: 'template',
    template: {
      name: process.env.WHATSAPP_TEMPLATE_NAME || 'trustorder_trust_lock',
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
