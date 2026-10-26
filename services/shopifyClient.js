/**
 * Shipvera Shopify Admin Integration Client
 * Production-ready REST & GraphQL connector
 * Auto-syncs cleaned addresses, tags, and cancellation triggers directly into Shopify.
 */

const https = require('https');

function isLiveShopifyCredentials(domain, token) {
  if (!domain || !token) return false;
  const d = domain.toLowerCase().trim();
  const t = token.toLowerCase().trim();
  // Do not reject a store merely for its name containing 'test'/'demo'.
  // Only placeholder tokens are rejected below; a real dev store is
  // verified by an actual Shopify API call, not by its name.
  void d;
  if (t.includes('demo') || t.includes('token_demo') || t.includes('auto_provisioned') || t.includes('provisioned') || t.includes('sandbox') || t.includes('test') || t.includes('mock')) {
    return false;
  }
  return t.startsWith('shpat_') || t.length >= 30;
}

/**
 * Updates an order's shipping address and tags on Shopify
 */
async function updateShopifyOrderAddress({ shopifyDomain, accessToken, externalOrderId, shopifyOrderId, shippingAddress, tags = [], note = '' }) {
  const targetId = shopifyOrderId || String(externalOrderId).replace(/[^\d]/g, '');
  if (!targetId) {
    throw new Error(`Invalid Shopify Order ID: ${externalOrderId || shopifyOrderId}`);
  }

  if (!isLiveShopifyCredentials(shopifyDomain, accessToken)) {
    console.warn(`[SHOPIFY SYNC - NOT CONFIGURED] Order ${externalOrderId} was NOT synced to Shopify; no live credentials.`);
    return {
      success: false,
      mode: 'not_configured',
      reason: 'Shopify domain and access token are required. No Shopify update was made.',
      updatedFields: { shippingAddress, tags, note }
    };
  }

  const cleanDomain = shopifyDomain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

  const payload = {
    order: {
      id: Number(targetId),
      shipping_address: {
        address1: shippingAddress.address1,
        address2: shippingAddress.address2 || '',
        city: shippingAddress.city,
        zip: shippingAddress.zip
      },
      tags: Array.isArray(tags) ? tags.join(', ') : tags,
      note: note || 'Verified & Cleaned by Shipvera Voice AI'
    }
  };

  const postData = JSON.stringify(payload);

  return new Promise((resolve) => {
    const req = https.request({
      hostname: cleanDomain,
      path: `/admin/api/2024-10/orders/${targetId}.json`,
      method: 'PUT',
      headers: {
        'X-Shopify-Access-Token': accessToken.trim(),
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log(`[SHOPIFY SYNC - SUCCESS] Order ${externalOrderId} (${targetId}) synchronized successfully.`);
            resolve({ success: true, live: true, data: parsed });
          } else if (res.statusCode === 429) {
            const retryAfter = res.headers['retry-after'] || '2';
            console.warn(`[SHOPIFY SYNC - RATE LIMIT] 429 Too Many Requests. Retry-After: ${retryAfter}s`);
            resolve({
              success: false,
              statusCode: 429,
              rateLimited: true,
              retryAfterSeconds: Number(retryAfter),
              error: `Shopify API rate limit exceeded (429). Retry after ${retryAfter} seconds.`
            });
          } else {
            console.warn(`[SHOPIFY SYNC - WARN] Status ${res.statusCode}: ${body}`);
            const errMsg = parsed.errors || parsed.error_description || `Shopify update failed with status ${res.statusCode}`;
            resolve({ success: false, statusCode: res.statusCode, error: typeof errMsg === 'object' ? JSON.stringify(errMsg) : errMsg, details: parsed });
          }
        } catch (e) {
          resolve({ success: false, error: body, statusCode: res.statusCode });
        }
      });
    });

    req.on('error', (err) => {
      console.error('[SHOPIFY SYNC - ERROR]', err.message);
      resolve({ success: false, error: `Shopify connection error: ${err.message}` });
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Automatically cancels fake or impulse buyer order on Shopify
 */
async function cancelShopifyOrder({ shopifyDomain, accessToken, externalOrderId, shopifyOrderId, reason = 'customer' }) {
  const targetId = shopifyOrderId || String(externalOrderId).replace(/[^\d]/g, '');

  if (!isLiveShopifyCredentials(shopifyDomain, accessToken)) {
    console.warn(`[SHOPIFY CANCEL - NOT CONFIGURED] Order ${externalOrderId} was NOT cancelled on Shopify; no live credentials.`);
    return { success: false, mode: 'not_configured', reason: 'Shopify domain and access token are required. No Shopify cancellation was made.', status: 'not_cancelled' };
  }

  const cleanDomain = shopifyDomain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const payload = {
    reason,
    email: false,
    note: 'Cancelled by Shipvera AI: Buyer confirmed cancellation during dispatch phone call.'
  };

  const postData = JSON.stringify(payload);

  return new Promise((resolve) => {
    const req = https.request({
      hostname: cleanDomain,
      path: `/admin/api/2024-10/orders/${targetId}/cancel.json`,
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken.trim(),
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ success: true, live: true, statusCode: res.statusCode, data: parsed });
          } else if (res.statusCode === 429) {
            const retryAfter = res.headers['retry-after'] || '2';
            resolve({ success: false, statusCode: 429, rateLimited: true, error: `Shopify rate limit exceeded (429). Retry after ${retryAfter}s` });
          } else {
            const errMsg = parsed.errors || parsed.error_description || `Shopify cancellation failed with status ${res.statusCode}`;
            resolve({ success: false, statusCode: res.statusCode, error: typeof errMsg === 'object' ? JSON.stringify(errMsg) : errMsg, details: parsed });
          }
        } catch (e) {
          resolve({ success: res.statusCode >= 200 && res.statusCode < 300, statusCode: res.statusCode, error: body });
        }
      });
    });

    req.on('error', err => resolve({ success: false, error: `Shopify cancel connection error: ${err.message}` }));
    req.write(postData);
    req.end();
  });
}

/**
 * Exchange OAuth authorization code for permanent access token
 */
async function exchangeShopifyOAuthToken({ shopifyDomain, code, clientId, clientSecret }) {
  const postData = JSON.stringify({
    client_id: clientId,
    client_secret: clientSecret,
    code: code
  });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: shopifyDomain,
      path: '/admin/oauth/access_token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ success: true, accessToken: parsed.access_token, scope: parsed.scope });
          } else {
            resolve({ success: false, error: parsed.error_description || body });
          }
        } catch (e) {
          resolve({ success: false, error: body });
        }
      });
    });

    req.on('error', err => resolve({ success: false, error: err.message }));
    req.write(postData);
    req.end();
  });
}

/**
 * Verifies live credentials by querying shop.json
 */
async function verifyShopifyCredentials({ shopifyDomain, accessToken }) {
  if (!shopifyDomain) {
    return { success: false, error: 'Shopify domain is required' };
  }

  const cleanDomain = shopifyDomain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

  if (!isLiveShopifyCredentials(shopifyDomain, accessToken)) {
    return {
      success: false,
      mode: 'not_configured',
      reason: 'Shopify domain and access token are required. No shop was verified.'
    };
  }

  return new Promise((resolve) => {
    const req = https.request({
      hostname: cleanDomain,
      path: '/admin/api/2024-10/shop.json',
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': accessToken.trim(),
        'Content-Type': 'application/json'
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (res.statusCode >= 200 && res.statusCode < 300 && parsed.shop) {
            resolve({
              success: true,
              live: true,
              shop: {
                id: parsed.shop.id,
                name: parsed.shop.name,
                email: parsed.shop.email,
                domain: parsed.shop.domain,
                myshopify_domain: parsed.shop.myshopify_domain,
                currency: parsed.shop.currency,
                country_name: parsed.shop.country_name,
                iana_timezone: parsed.shop.iana_timezone
              }
            });
          } else {
            const errMsg = parsed.errors || parsed.error_description || (res.statusCode === 401 ? 'Invalid Shopify Access Token. Check permissions (read_orders, write_orders required).' : `Shopify API returned status ${res.statusCode}`);
            resolve({ success: false, error: typeof errMsg === 'object' ? JSON.stringify(errMsg) : errMsg, statusCode: res.statusCode });
          }
        } catch (e) {
          resolve({ success: false, error: 'Failed to parse Shopify response', raw: body, statusCode: res.statusCode });
        }
      });
    });

    req.on('error', err => resolve({ success: false, error: `Connection failed: ${err.message}` }));
    req.end();
  });
}

/**
 * Automatically register webhook on merchant store (checks existing first)
 */
async function registerShopifyWebhook({ shopifyDomain, accessToken, webhookUrl, topic = 'orders/create' }) {
  if (!isLiveShopifyCredentials(shopifyDomain, accessToken)) {
    return { success: false, mode: 'not_configured', reason: 'Shopify domain and access token are required. No webhook was registered.', topic, webhookUrl };
  }

  const cleanDomain = shopifyDomain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

  // 1. Check existing webhooks first to avoid duplicates
  try {
    const existingWebhooks = await new Promise((resolve) => {
      const getReq = https.request({
        hostname: cleanDomain,
        path: '/admin/api/2024-10/webhooks.json',
        method: 'GET',
        headers: {
          'X-Shopify-Access-Token': accessToken.trim(),
          'Content-Type': 'application/json'
        }
      }, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            resolve(parsed.webhooks || []);
          } catch (e) {
            resolve([]);
          }
        });
      });
      getReq.on('error', () => resolve([]));
      getReq.end();
    });

    const alreadyRegistered = existingWebhooks.find(w => w.topic === topic && w.address === webhookUrl);
    if (alreadyRegistered) {
      console.log(`[SHOPIFY WEBHOOK] Webhook "${topic}" already active on ${cleanDomain}`);
      return { success: true, live: true, alreadyExists: true, webhook: alreadyRegistered };
    }
  } catch (checkErr) {
    console.warn('[SHOPIFY WEBHOOK] Existing webhook check warning:', checkErr.message);
  }

  // 2. Register webhook
  const payload = {
    webhook: {
      topic,
      address: webhookUrl,
      format: 'json'
    }
  };

  const postData = JSON.stringify(payload);

  return new Promise((resolve) => {
    const req = https.request({
      hostname: cleanDomain,
      path: '/admin/api/2024-10/webhooks.json',
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken.trim(),
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log(`[SHOPIFY WEBHOOK] Successfully registered "${topic}" -> ${webhookUrl}`);
            resolve({
              success: true,
              live: true,
              data: parsed.webhook,
              statusCode: res.statusCode
            });
          } else if (res.statusCode === 422 && body.includes('address for this topic has already been taken')) {
            console.log(`[SHOPIFY WEBHOOK] Webhook already registered previously (422 handled)`);
            resolve({ success: true, live: true, alreadyExists: true });
          } else {
            console.warn(`[SHOPIFY WEBHOOK - ERROR] Status ${res.statusCode}: ${body}`);
            resolve({ success: false, error: body, statusCode: res.statusCode });
          }
        } catch (e) {
          resolve({ success: false, error: body });
        }
      });
    });

    req.on('error', err => resolve({ success: false, error: err.message }));
    req.write(postData);
    req.end();
  });
}

/**
 * Fetch live orders from real store
 */
async function fetchShopifyOrders({ shopifyDomain, accessToken, limit = 10, status = 'open' }) {
  if (!isLiveShopifyCredentials(shopifyDomain, accessToken)) {
    return { success: false, mode: 'not_configured', reason: 'Shopify domain and access token are required. No orders were fetched.', orders: [] };
  }

  const cleanDomain = shopifyDomain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

  return new Promise((resolve) => {
    const req = https.request({
      hostname: cleanDomain,
      path: `/admin/api/2024-10/orders.json?status=${status}&limit=${limit}&fields=id,name,financial_status,payment_gateway_names,total_price,shipping_address,customer,created_at,tags`,
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': accessToken.trim(),
        'Content-Type': 'application/json'
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ success: true, live: true, orders: parsed.orders || [] });
          } else {
            resolve({ success: false, error: body, statusCode: res.statusCode });
          }
        } catch (e) {
          resolve({ success: false, error: body });
        }
      });
    });

    req.on('error', err => resolve({ success: false, error: err.message }));
    req.end();
  });
}

/**
 * Cryptographic HMAC verification for real Shopify webhooks
 */
function verifyShopifyHmac(rawBody, hmacHeader, apiSecret) {
  if (!apiSecret || !hmacHeader) return false; // Fail closed: missing secret/header must never verify.
  try {
    const crypto = require('crypto');
    const generatedHash = crypto.createHmac('sha256', apiSecret).update(rawBody).digest('base64');
    return crypto.timingSafeEqual(Buffer.from(generatedHash), Buffer.from(hmacHeader));
  } catch (e) {
    return false;
  }
}

module.exports = {
  updateShopifyOrderAddress,
  cancelShopifyOrder,
  exchangeShopifyOAuthToken,
  verifyShopifyCredentials,
  registerShopifyWebhook,
  fetchShopifyOrders,
  verifyShopifyHmac
};

