/**
 * TrustOrder - Fullstack Platform Server
 * India's First Voice AI Dispatch Engine & COD RTO Prevention Platform
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const { db } = require('./db');

// Safe loader for Queue Engine
let queueEngine = { startWorker: () => {}, stopWorker: () => {} };
try {
  const qMod = require('./services/queueEngine');
  if (qMod && qMod.queueEngine) queueEngine = qMod.queueEngine;
} catch (e) {
  console.warn('[SERVER] Running in direct mode:', e.message);
}

const webhooksRouter = require('./routes/webhooks');
const ordersRouter = require('./routes/orders');
const analyticsRouter = require('./routes/analytics');
const walletRouter = require('./routes/wallet');
const authRouter = require('./routes/auth');
const recoveryRouter = require('./routes/recovery');

const app = express();
const PORT = process.env.PORT || 3000;

// Distributed Request ID & Telemetry Middleware (Inlined for zero-dependency deployment)
app.use((req, res, next) => {
  const reqId = req.headers['x-request-id'] || `req_${crypto.randomBytes(6).toString('hex')}`;
  req.id = reqId;
  res.setHeader('X-Request-Id', reqId);

  const startHr = process.hrtime();
  res.on('finish', () => {
    const diff = process.hrtime(startHr);
    const durationMs = (diff[0] * 1000 + diff[1] / 1e6).toFixed(2);
    if (req.path.startsWith('/api')) {
      const level = res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARN' : 'INFO';
      console.log(`[${new Date().toISOString()}] [${level}] [${req.id}] ${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs}ms`);
    }
  });
  next();
});

// Security & Parsing Middleware
app.use(cors());
app.use(express.json({
  verify: (req, res, buf) => {
    // Preserve raw buffer for Shopify & Razorpay cryptographic HMAC verification
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true }));

// Serve Static Frontend Assets (HTML, CSS, JS, Logos)
app.use(express.static(path.join(__dirname)));

// API Routes
app.use('/api/auth', authRouter);
app.use('/api/webhooks', webhooksRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/wallet', walletRouter);
app.use('/api/recovery', recoveryRouter);

// Lead Waitlist Endpoint. The lead is actually stored (db.addLead),
// not just echoed back, and no seller wallet is invented for a lead.
app.post('/api/waitlist', (req, res) => {
  try {
    const { phone, name, email, volume, source } = req.body || {};
    if (!phone && !email) {
      return res.status(400).json({ error: 'phone or email is required to join the waitlist.' });
    }
    const lead = db.addLead({ phone, name, email, volume, source });
    res.status(200).json({
      success: true,
      message: 'Early access reserved.',
      lead
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health & System Information. This reports configuration status only:
// a feature is 'configured' only when its required env vars are present.
// It never claims a feature is active when its provider is not configured.
app.get('/api/health', (req, res) => {
  const configured = {
    supabase: Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)),
    bolna: Boolean(process.env.BOLNA_API_KEY && process.env.BOLNA_AGENT_ID),
    razorpay: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
    whatsapp: Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),
    google_maps: Boolean(process.env.GOOGLE_MAPS_API_KEY),
    shopify_webhook_secret: Boolean(process.env.SHOPIFY_WEBHOOK_SECRET),
    razorpay_webhook_secret: Boolean(process.env.RAZORPAY_WEBHOOK_SECRET),
    llm: Boolean(process.env.LLM_API_KEY)
  };
  res.status(200).json({
    status: 'healthy',
    platform: 'TrustOrder Autonomous Voice AI Dispatch Engine',
    version: '2.0.0-enterprise',
    timestamp: new Date().toISOString(),
    configured,
    features: {
      pre_call_geo_sanitizer: configured.google_maps ? 'configured' : 'not_configured',
      landmark_interrogator_voice_ai: configured.bolna ? 'configured' : 'not_configured',
      live_address_rewriter: 'rule_based_no_llm - LLM extraction requires LLM_API_KEY (see REALITY_CHECKLIST.md)',
      upi_trust_lock: configured.razorpay && configured.whatsapp ? 'configured' : 'not_configured',
      quick_paste_mode: 'available - creates orders only with validated seller, phone, pincode and amount',
      trai_night_window_hold: 'available',
      autonomous_queue_worker: 'available - live calls only; simulation requires TRUSTORDER_ALLOW_SIMULATED_CALLS=true',
      financial_ledger: 'available'
    }
  });
});

// Dashboard Page
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// Signup & Workspace Registration Page
app.get(['/signup', '/login', '/register'], (req, res) => {
  res.sendFile(path.join(__dirname, 'signup.html'));
});

// Single Page Application Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start Server and Autonomous Queue Engine
const server = app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 TRUSTORDER ENTERPRISE BACKEND IS LIVE!`);
  console.log(`📡 URL: http://localhost:${PORT}`);
  console.log(`📊 Health Endpoint: http://localhost:${PORT}/api/health`);
  console.log(`📦 Orders API:      http://localhost:${PORT}/api/orders`);
  console.log(`⚡ Analytics API:   http://localhost:${PORT}/api/analytics`);
  console.log(`💰 Wallet API:      http://localhost:${PORT}/api/wallet`);
  console.log(`⏳ Queue Inspector: http://localhost:${PORT}/api/orders/queue/jobs`);
  console.log(`====================================================`);

  // Start background queue processing loop
  queueEngine.startWorker(2500);
});

// Graceful Shutdown
function handleShutdown(signal) {
  console.log(`\n[SYSTEM] Received ${signal}. Shutting down queue and server gracefully...`);
  queueEngine.stopWorker();
  server.close(() => {
    console.log('[SYSTEM] TrustOrder server terminated cleanly.');
    process.exit(0);
  });
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
