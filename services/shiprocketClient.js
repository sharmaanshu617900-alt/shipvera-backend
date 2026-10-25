/**
 * Shipvera Shiprocket & Delhivery Logistics Connector
 * Auto-syncs cleaned courier delivery addresses before AWB generation
 */

const https = require('https');

function isLiveShiprocketToken(token) {
  if (!token) return false;
  const t = token.toLowerCase();
  if (t.includes('demo') || t.startsWith('sr_token_') || t.includes('test') || t.includes('placeholder') || t.includes('sr_live_123')) {
    return false;
  }
  return token.startsWith('eyJ') || token.length > 50;
}

async function updateShiprocketCustomAddress({ token, externalOrderId, deliveryAddress, deliveryAddress2, landmark, city, pincode }) {
  if (!isLiveShiprocketToken(token)) {
    console.warn(`[SHIPROCKET SYNC - NOT CONFIGURED] Order ${externalOrderId} was NOT synced to Shiprocket; no live token.`);
    return {
      success: false,
      mode: 'not_configured',
      reason: 'Shiprocket token is required. No Shiprocket update was made.',
      updated: { deliveryAddress, deliveryAddress2, landmark, city, pincode }
    };
  }

  const payload = {
    order_id: [externalOrderId],
    delivery_address: deliveryAddress,
    delivery_address_2: deliveryAddress2 || '',
    landmark: landmark || '',
    city: city,
    pincode: pincode
  };

  const postData = JSON.stringify(payload);

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'apiv2.shiprocket.in',
      path: '/v1/external/orders/address/update',
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
        resolve({
          success: res.statusCode >= 200 && res.statusCode < 300,
          statusCode: res.statusCode,
          response: body
        });
      });
    });

    req.on('error', err => resolve({ success: false, error: err.message }));
    req.write(postData);
    req.end();
  });
}

/**
 * Real Shiprocket Login API: Authenticate with merchant email and password to receive JWT token
 */
async function shiprocketLogin({ email, password }) {
  if (!email || !password || email.includes('demo')) {
    return {
      success: false,
      mode: 'not_configured',
      reason: 'Shiprocket email and password are required. No token was issued.'
    };
  }

  const postData = JSON.stringify({ email, password });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'apiv2.shiprocket.in',
      path: '/v2/console/auth/login',
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
          if (res.statusCode >= 200 && res.statusCode < 300 && parsed.token) {
            resolve({ success: true, token: parsed.token });
          } else {
            resolve({ success: false, error: parsed.message || body });
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
 * Fetch real orders/shipments from Shiprocket
 */
async function fetchShiprocketOrders({ token, limit = 10 }) {
  if (!token || token.includes('demo')) {
    return { success: false, mode: 'not_configured', reason: 'Shiprocket token is required. No orders were fetched.', orders: [] };
  }

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'apiv2.shiprocket.in',
      path: `/v1/external/orders?per_page=${limit}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({
            success: res.statusCode >= 200 && res.statusCode < 300,
            data: parsed.data || []
          });
        } catch (e) {
          resolve({ success: false, error: body });
        }
      });
    });

    req.on('error', err => resolve({ success: false, error: err.message }));
    req.end();
  });
}

module.exports = {
  updateShiprocketCustomAddress,
  shiprocketLogin,
  fetchShiprocketOrders
};

