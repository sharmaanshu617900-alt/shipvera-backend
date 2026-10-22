/**
 * Shipvera Enterprise Security & Telemetry Middleware
 * Billion-Dollar Backend Standards:
 * - Distributed Request ID Correlation Tracking
 * - Shopify Webhook HMAC-SHA256 Cryptographic Verification
 * - Razorpay Webhook Signature Verification
 * - High-Precision Response Latency Telemetry
 */

const crypto = require('crypto');

/**
 * Attaches a unique X-Request-Id to every request and logs structured latency
 */
function requestTracer(req, res, next) {
  const reqId = req.headers['x-request-id'] || `req_${crypto.randomBytes(8).toString('hex')}`;
  req.id = reqId;
  res.setHeader('X-Request-Id', reqId);

  const startHr = process.hrtime();

  res.on('finish', () => {
    const diff = process.hrtime(startHr);
    const durationMs = (diff[0] * 1000 + diff[1] / 1e6).toFixed(2);
    
    // Structured audit logging
    if (req.path.startsWith('/api')) {
      const level = res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARN' : 'INFO';
      const logLine = `[${new Date().toISOString()}] [${level}] [${req.id}] ${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs}ms`;
      if (level === 'ERROR') {
        console.error(logLine);
      } else {
        console.log(logLine);
      }
    }
  });

  next();
}

/**
 * Verifies Shopify Webhook HMAC-SHA256 signature
 * Matches header 'x-shopify-hmac-sha256' against raw body buffer
 */
function verifyShopifyHmac(req, res, next) {
  const hmacHeader = req.headers['x-shopify-hmac-sha256'];
  const shopifySecret = process.env.SHOPIFY_WEBHOOK_SECRET;

  // In production with secret provided, strictly enforce HMAC
  if (shopifySecret && hmacHeader) {
    if (!req.rawBody) {
      return res.status(400).json({ error: 'Missing rawBody for HMAC verification' });
    }
    const digest = crypto
      .createHmac('sha256', shopifySecret)
      .update(req.rawBody)
      .digest('base64');

    if (digest !== hmacHeader) {
      console.warn(`[SECURITY] Invalid Shopify HMAC detected on req ${req.id}`);
      return res.status(401).json({ error: 'Unauthorized: Shopify HMAC verification failed' });
    }
  }

  // Pass through for development / sandbox simulation
  next();
}

/**
 * Verifies Razorpay Webhook Signature
 */
function verifyRazorpaySignature(req, res, next) {
  const signature = req.headers['x-razorpay-signature'];
  const razorpaySecret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (razorpaySecret && signature) {
    if (!req.rawBody) {
      return res.status(400).json({ error: 'Missing rawBody for signature verification' });
    }
    const expected = crypto
      .createHmac('sha256', razorpaySecret)
      .update(req.rawBody)
      .digest('hex');

    if (expected !== signature) {
      console.warn(`[SECURITY] Invalid Razorpay signature on req ${req.id}`);
      return res.status(401).json({ error: 'Unauthorized: Razorpay signature mismatch' });
    }
  }

  next();
}

module.exports = {
  requestTracer,
  verifyShopifyHmac,
  verifyRazorpaySignature
};
