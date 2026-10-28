/**
 * TrustOrder Merchant Notification & Daily Digest Engine (Resend API)
 * Sends automated daily ROI summary, critical low-balance alerts,
 * and RTO recovery notifications to D2C store founders.
 * 
 * Fail-Closed: If RESEND_API_KEY is missing, returns { success: false, mode: 'not_configured' }.
 * Never invents mock email delivery.
 */

const https = require('https');

/**
 * Helper to dispatch an email via Resend REST API
 */
function dispatchResendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.warn('[RESEND - NOT CONFIGURED] No RESEND_API_KEY set in environment; email was NOT sent.');
    return Promise.resolve({
      success: false,
      mode: 'not_configured',
      missing: 'RESEND_API_KEY',
      reason: 'RESEND_API_KEY is required in .env. No email was sent.'
    });
  }

  // Resend requires verified domain in production (e.g. notifications@trustorder.in).
  // For unverified domains or free testing, Resend only permits "onboarding@resend.dev".
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'TrustOrder Dispatch <onboarding@resend.dev>';
  const toList = Array.isArray(to) ? to : [to];

  const payload = {
    from: fromEmail,
    to: toList,
    subject,
    html
  };

  const postData = JSON.stringify(payload);

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(body);
        } catch (_) {
          parsed = { raw: body };
        }

        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`[RESEND SUCCESS] Email sent to ${toList.join(', ')} | ID: ${parsed.id || 'ok'}`);
          resolve({ success: true, id: parsed.id, from: fromEmail, to: toList });
        } else {
          console.error(`[RESEND ERROR ${res.statusCode}] Failed to send email:`, parsed);
          resolve({
            success: false,
            statusCode: res.statusCode,
            error: parsed.message || parsed.error || 'Resend API returned error',
            details: parsed
          });
        }
      });
    });

    req.on('error', (err) => {
      console.error('[RESEND NETWORK ERROR]', err.message);
      resolve({ success: false, error: err.message });
    });

    req.write(postData);
    req.end();
  });
}

/**
 * 1. Daily Savings & ROI Digest
 */
async function sendDailySavingsDigest({ toEmail, sellerBrand, totalOrders = 0, fakeBlocked = 0, moneySavedInr = 0, cleanAddressCount = 0 }) {
  const htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #E8DDD6; border-radius: 12px; background: #FAF7F2;">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 20px;">
        <span style="font-size: 1.2rem; font-weight: 700; color: #17130F; letter-spacing: -0.5px;">TRUSTORDER</span>
        <span style="font-size: 0.75rem; background: #FBE9EC; color: #6B1228; padding: 2px 8px; border-radius: 4px; font-weight: 600;">DAILY DISPATCH DIGEST</span>
      </div>
      <h2 style="font-size: 1.15rem; color: #17130F; margin: 0 0 12px 0;">Daily RTO Protection Summary for ${sellerBrand || 'Your Store'}</h2>
      <p style="color: #5C534D; font-size: 0.9rem; line-height: 1.5; margin: 0 0 20px 0;">
        Aaj TrustOrder Voice AI dispatch desk ne aapke COD orders ko verify kiya aur courier reverse freight loss ko block kiya:
      </p>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px;">
        <div style="background: #FFFFFF; padding: 14px; border-radius: 8px; border: 1px solid #E8DDD6;">
          <div style="font-size: 0.75rem; color: #5C534D; font-weight: 600;">COURIER FREIGHT SAVED</div>
          <div style="font-size: 1.4rem; font-weight: 800; color: #6B1228; margin-top: 4px;">₹${Number(moneySavedInr).toLocaleString('en-IN')}</div>
        </div>
        <div style="background: #FFFFFF; padding: 14px; border-radius: 8px; border: 1px solid #E8DDD6;">
          <div style="font-size: 0.75rem; color: #5C534D; font-weight: 600;">FAKE ORDERS BLOCKED</div>
          <div style="font-size: 1.4rem; font-weight: 800; color: #DC2626; margin-top: 4px;">${fakeBlocked} Orders</div>
        </div>
      </div>

      <div style="background: #FBE9EC; border: 1px solid #E8DDD6; border-radius: 8px; padding: 12px 16px; margin-bottom: 24px; font-size: 0.85rem; color: #6B1228;">
        ✔ <strong>${cleanAddressCount} addresses</strong> were rewritten with verified landmarks and synchronized directly into Shopify & Shiprocket. Total orders audited: ${totalOrders}.
      </div>

      <div style="text-align: center;">
        <a href="https://trustorder.in/dashboard" style="display: inline-block; background: #6B1228; color: #FFFFFF; text-decoration: none; padding: 10px 24px; border-radius: 6px; font-weight: 600; font-size: 0.88rem;">Open Live Operations Console</a>
      </div>
    </div>
  `;

  return dispatchResendEmail({
    to: toEmail,
    subject: `Daily RTO Shield: ₹${Number(moneySavedInr).toLocaleString('en-IN')} Saved Today for ${sellerBrand || 'Your Store'}`,
    html: htmlContent
  });
}

/**
 * 2. Low Balance Warning Alert (when wallet drops below ₹100 or ₹0)
 */
async function sendLowBalanceAlert({ toEmail, sellerBrand, currentBalanceInr }) {
  const htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #E8DDD6; border-radius: 12px; background: #FAF7F2;">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 20px;">
        <span style="font-size: 1.2rem; font-weight: 700; color: #17130F;">TRUSTORDER</span>
        <span style="font-size: 0.75rem; background: #FEF3C7; color: #B45309; padding: 2px 8px; border-radius: 4px; font-weight: 600;">WALLET ALERT</span>
      </div>
      <h2 style="font-size: 1.15rem; color: #17130F; margin: 0 0 12px 0;">Low Wallet Balance: ₹${Number(currentBalanceInr).toFixed(2)} Remaining</h2>
      <p style="color: #5C534D; font-size: 0.9rem; line-height: 1.5; margin: 0 0 20px 0;">
        Aapka TrustOrder dispatch wallet balance kam ho gaya hai. Balance khatam hone par naye COD orders ke automated voice verification calls pause ho jayenge.
      </p>
      <div style="background: #FFFFFF; padding: 16px; border-radius: 8px; border: 1px solid #E8DDD6; margin-bottom: 24px; text-align: center;">
        <div style="font-size: 0.8rem; color: #5C534D;">CURRENT BALANCE</div>
        <div style="font-size: 1.8rem; font-weight: 800; color: ${currentBalanceInr <= 0 ? '#DC2626' : '#B45309'}; margin-top: 4px;">
          ₹${Number(currentBalanceInr).toFixed(2)}
        </div>
      </div>
      <div style="text-align: center;">
        <a href="https://trustorder.in/dashboard#recharge" style="display: inline-block; background: #6B1228; color: #FFFFFF; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: 600; font-size: 0.9rem;">
          Recharge Wallet (Min ₹500 + GST)
        </a>
      </div>
    </div>
  `;

  return dispatchResendEmail({
    to: toEmail,
    subject: `⚠️ Action Required: TrustOrder Wallet Balance Low (₹${Number(currentBalanceInr).toFixed(2)}) for ${sellerBrand}`,
    html: htmlContent
  });
}

/**
 * 3. RTO Recovery Opportunity Alert
 */
async function sendRtoRecoveryAlert({ toEmail, sellerBrand, orderId, productPrice, potentialRecoveryInr }) {
  const htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #E8DDD6; border-radius: 12px; background: #FAF7F2;">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 20px;">
        <span style="font-size: 1.2rem; font-weight: 700; color: #17130F;">TRUSTORDER</span>
        <span style="font-size: 0.75rem; background: #DEF7EC; color: #03543F; padding: 2px 8px; border-radius: 4px; font-weight: 600;">RTO RECOVERY READY</span>
      </div>
      <h2 style="font-size: 1.15rem; color: #17130F; margin: 0 0 12px 0;">New RTO Recovery Opportunity for Order ${orderId}</h2>
      <p style="color: #5C534D; font-size: 0.9rem; line-height: 1.5; margin: 0 0 20px 0;">
        Ek returned RTO order ne <strong>Return QC Gate</strong> aur <strong>Worth-It Gate</strong> pass kiya hai:
      </p>
      <div style="background: #FFFFFF; padding: 14px; border-radius: 8px; border: 1px solid #E8DDD6; margin-bottom: 20px;">
        <div style="font-size: 0.85rem; color: #17130F;"><strong>Order ID:</strong> ${orderId}</div>
        <div style="font-size: 0.85rem; color: #17130F; margin-top: 4px;"><strong>Product Price:</strong> ₹${productPrice}</div>
        <div style="font-size: 0.85rem; color: #03543F; margin-top: 4px;"><strong>Net Revenue Recoverable:</strong> ₹${potentialRecoveryInr}</div>
      </div>
      <div style="text-align: center;">
        <a href="https://trustorder.in/dashboard#recovery" style="display: inline-block; background: #6B1228; color: #FFFFFF; text-decoration: none; padding: 10px 24px; border-radius: 6px; font-weight: 600; font-size: 0.88rem;">
          View RTO Recovery Console
        </a>
      </div>
    </div>
  `;

  return dispatchResendEmail({
    to: toEmail,
    subject: `💰 RTO Recovery Opportunity: ₹${potentialRecoveryInr} Recoverable on ${orderId}`,
    html: htmlContent
  });
}

/**
 * 4. General Live Test Email
 */
async function sendTestEmail({ toEmail }) {
  const htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #E8DDD6; border-radius: 12px; background: #FAF7F2;">
      <h2 style="color: #6B1228; margin: 0 0 12px 0;">TrustOrder by Shipvera — Resend API Verified!</h2>
      <p style="color: #17130F; font-size: 0.95rem; line-height: 1.5;">
        Congratulations! Aapka Resend API key successfully connect ho gaya hai. TrustOrder ab aapke store ko daily ROI digests aur critical RTO alerts bhej sakta hai.
      </p>
      <div style="background: #FFFFFF; padding: 12px 16px; border-radius: 8px; border: 1px solid #E8DDD6; font-size: 0.85rem; color: #5C534D;">
        Timestamp: ${new Date().toISOString()}<br>
        Status: 100% Operational & Verified
      </div>
    </div>
  `;

  return dispatchResendEmail({
    to: toEmail,
    subject: `✅ TrustOrder Resend Email Integration Verified`,
    html: htmlContent
  });
}

module.exports = {
  dispatchResendEmail,
  sendDailySavingsDigest,
  sendLowBalanceAlert,
  sendRtoRecoveryAlert,
  sendTestEmail
};
