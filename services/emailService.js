/**
 * Shipvera Merchant Notification & Daily Digest (Resend API)
 * Sends automated daily ROI summary and critical RTO alerts to D2C store founders
 */

const https = require('https');

async function sendDailySavingsDigest({ toEmail, sellerBrand, totalOrders, fakeBlocked, moneySavedInr, cleanAddressCount }) {
  const apiKey = process.env.RESEND_API_KEY;

  const htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #E6E4DD; border-radius: 12px; background: #FFFFFF;">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 20px;">
        <span style="font-size: 1.2rem; font-weight: 700; color: #18181B; letter-spacing: -0.5px;">SHIPVERA</span>
        <span style="font-size: 0.75rem; background: #ECFDF5; color: #047857; padding: 2px 8px; border-radius: 4px; font-weight: 600;">DAILY DISPATCH DIGEST</span>
      </div>
      <h2 style="font-size: 1.15rem; color: #18181B; margin: 0 0 12px 0;">Daily RTO Protection Summary for ${sellerBrand}</h2>
      <p style="color: #64748B; font-size: 0.9rem; line-height: 1.5; margin: 0 0 20px 0;">
        Aaj Shipvera Voice AI dispatch desk ne aapke COD orders ko verify kiya aur courier reverse freight loss ko block kiya:
      </p>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px;">
        <div style="background: #F8FAFC; padding: 14px; border-radius: 8px; border: 1px solid #E2E8F0;">
          <div style="font-size: 0.75rem; color: #64748B; font-weight: 600;">COURIER FREIGHT SAVED</div>
          <div style="font-size: 1.4rem; font-weight: 800; color: #058A5E; margin-top: 4px;">₹${moneySavedInr.toLocaleString('en-IN')}</div>
        </div>
        <div style="background: #F8FAFC; padding: 14px; border-radius: 8px; border: 1px solid #E2E8F0;">
          <div style="font-size: 0.75rem; color: #64748B; font-weight: 600;">FAKE ORDERS BLOCKED</div>
          <div style="font-size: 1.4rem; font-weight: 800; color: #DC2626; margin-top: 4px;">${fakeBlocked} Orders</div>
        </div>
      </div>

      <div style="background: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 8px; padding: 12px 16px; margin-bottom: 24px; font-size: 0.85rem; color: #065F46;">
        ✔ <strong>${cleanAddressCount} addresses</strong> were rewritten with verified landmarks and synchronized directly into Shopify & Shiprocket.
      </div>

      <div style="text-align: center;">
        <a href="https://shipvera.com/dashboard" style="display: inline-block; background: #058A5E; color: #FFFFFF; text-decoration: none; padding: 10px 24px; border-radius: 6px; font-weight: 600; font-size: 0.88rem;">Open Live Operations Console</a>
      </div>
    </div>
  `;

  if (!apiKey) {
    console.warn('[RESEND DIGEST - NOT CONFIGURED] No RESEND_API_KEY; email was NOT sent.');
    return { success: false, mode: 'not_configured', reason: 'RESEND_API_KEY is required. No email was sent.' };
  }

  const payload = {
    from: 'Shipvera Dispatch <notifications@shipvera.com>',
    to: [toEmail],
    subject: `Daily RTO Shield: ₹${moneySavedInr} Saved Today for ${sellerBrand}`,
    html: htmlContent
  };

  const postData = JSON.stringify(payload);

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.resend.com',
      path: '/emails',
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
        resolve({ success: res.statusCode >= 200 && res.statusCode < 300, response: body });
      });
    });

    req.on('error', err => resolve({ success: false, error: err.message }));
    req.write(postData);
    req.end();
  });
}

module.exports = {
  sendDailySavingsDigest
};
