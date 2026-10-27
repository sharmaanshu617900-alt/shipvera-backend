/**
 * Shipvera Database Engine
 * Implements the 4 core tables specified in TRD Section 3.2:
 * 1. sellers
 * 2. orders
 * 3. call_logs
 * 4. buyer_trust_graph
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'shipvera_database.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Empty initial data. A fresh install starts with no sellers, orders,
// call logs, or trust-graph entries. No demo/seed data is created here.
// Previously this function seeded a demo seller, demo orders and demo
// call logs; that seed data has been removed so the dashboard can never
// show activity that did not actually happen.
function getEmptyData() {
  return {
    sellers: [],
    orders: [],
    call_logs: [],
    buyer_trust_graph: {},
    wallet_transactions: [],
    queue_jobs: [],
    leads: []
  };
}

function hashPhone(phone) {
  const normalized = String(phone).replace(/[^\d+]/g, '');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

// Database Read/Write Wrapper
class Database {
  constructor() {
    this.init();
  }

  init() {
    if (!fs.existsSync(DB_FILE)) {
      const initial = getEmptyData();
      fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf-8');
      this.data = initial;
    } else {
      try {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        this.data = JSON.parse(raw);
        if (!Array.isArray(this.data.wallet_transactions)) {
          this.data.wallet_transactions = [];
        }
        if (!Array.isArray(this.data.queue_jobs)) {
          this.data.queue_jobs = [];
        }
      } catch (err) {
        console.error('Error reading database, starting empty (corrupt file was not restored from seed data):', err);
        this.data = getEmptyData();
      }
    }
  }

  save() {
    fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  // --- Seller Operations ---
  getAllSellers() {
    return this.data.sellers.map(s => ({
      id: s.id,
      brand_name: s.brand_name,
      name: s.name || s.brand_name,
      email: s.email,
      phone: s.phone,
      shopify_domain: s.shopify_domain,
      wallet_balance_inr: s.wallet_balance_inr,
      plan_tier: s.plan_tier,
      created_at: s.created_at
    }));
  }

  getSellerByEmail(email) {
    if (!email) return null;
    return this.data.sellers.find(s => s.email && s.email.toLowerCase() === email.toLowerCase().trim());
  }

  getSellerByShopifyDomain(domain) {
    if (!domain) return null;
    const clean = domain.trim().toLowerCase();
    return this.data.sellers.find(s => s.shopify_domain && s.shopify_domain.toLowerCase().includes(clean)) || null;
  }

  getSeller(id = null) {
    if (!id) return null;
    return this.data.sellers.find(s => s.id === id) || null;
  }

  createSeller(sellerData) {
    const id = sellerData.id || `sel_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const newSeller = {
      id,
      name: sellerData.name || sellerData.brand_name || 'Store Founder',
      email: (sellerData.email || '').toLowerCase().trim(),
      password: sellerData.password || '',
      brand_name: (sellerData.brand_name || 'My Store').trim(),
      phone: sellerData.phone || '',
      shopify_domain: sellerData.shopify_domain || '',
      shopify_access_token: null,
      shiprocket_token: null,
      wallet_balance_inr: 0.00, // Strictly ₹0.00 (Pure Pay-As-You-Go, Zero Free Credits)
      plan_tier: 'pay_as_you_go',
      upi_trust_lock_amount: 19,
      total_orders_processed: 0,
      rto_cut_percentage: null, // Not measured until real orders exist
      created_at: sellerData.created_at || new Date().toISOString()
    };

    this.data.sellers.unshift(newSeller);
    this.save();
    return newSeller;
  }

  updateSellerWallet(sellerId, amountDelta) {
    const seller = this.getSeller(sellerId);
    if (!seller) return null;
    seller.wallet_balance_inr = Number((seller.wallet_balance_inr + amountDelta).toFixed(2));
    this.save();
    return seller;
  }

  // --- Order Operations ---
  getOrders(sellerId = null) {
    if (sellerId) {
      return this.data.orders.filter(o => o.seller_id === sellerId).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
    return [...this.data.orders].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  getOrderById(id) {
    return this.data.orders.find(o => o.id === id || o.external_order_id === id);
  }

  createOrder(orderData) {
    if (!orderData.seller_id) {
      throw new Error('seller_id is required to create an order. Orders are never attributed to a fallback seller.');
    }
    const id = orderData.id || `ord_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const newOrder = {
      id,
      seller_id: orderData.seller_id,
      external_order_id: orderData.external_order_id || `MANUAL-${Date.now().toString().slice(-4)}`,
      shopify_order_id: orderData.shopify_order_id ? String(orderData.shopify_order_id) : null,
      source: orderData.source || 'quick_paste',
      buyer_name: orderData.buyer_name || 'Valued Customer',
      buyer_phone: orderData.buyer_phone || '',
      cod_amount: Number(orderData.cod_amount) || 0,
      raw_address: orderData.raw_address || '',
      pincode: orderData.pincode || '',
      city: orderData.city || '',
      missing_fields: orderData.missing_fields || [],
      cleaned_address_line1: orderData.cleaned_address_line1 || null,
      cleaned_address_line2: orderData.cleaned_address_line2 || null,
      cleaned_landmark: orderData.cleaned_landmark || null,
      geo_coordinates: orderData.geo_coordinates || null,
      geo_location_type: orderData.geo_location_type || null,
      geo_deliverability_score: orderData.geo_deliverability_score ?? null,
      geo_accuracy_label: orderData.geo_accuracy_label || null,
      verification_status: orderData.verification_status || 'queued',
      risk_score: orderData.risk_score || 50,
      rto_money_saved: orderData.rto_money_saved || 0.00,
      tags: orderData.tags || [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    this.data.orders.unshift(newOrder);
    this.save();
    return newOrder;
  }

  updateOrder(id, updates) {
    const order = this.getOrderById(id);
    if (!order) return null;
    Object.assign(order, updates, { updated_at: new Date().toISOString() });
    this.save();
    return order;
  }

  // --- Call Logs ---
  getCallLogs(orderId) {
    if (orderId) {
      return this.data.call_logs.filter(c => c.order_id === orderId);
    }
    return this.data.call_logs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  createCallLog(logData) {
    const id = `call_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const newLog = {
      id,
      order_id: logData.order_id,
      seller_id: logData.seller_id || null,
      provider_call_id: logData.provider_call_id || null,
      duration_seconds: logData.duration_seconds || 0,
      recording_url: logData.recording_url || null, // Only set from a real provider webhook; never invented
      transcript: logData.transcript || [],
      extracted_landmark: logData.extracted_landmark || null,
      buyer_intent: logData.buyer_intent || 'genuine',
      call_cost_inr: logData.call_cost_inr ?? 0, // Cost is only known after a real call; do not assume 6.00
      created_at: new Date().toISOString()
    };
    this.data.call_logs.unshift(newLog);
    this.save();
    return newLog;
  }

  // --- Buyer Trust Graph ---
  getBuyerTrust(phone) {
    const hash = hashPhone(phone);
    return this.data.buyer_trust_graph[hash] || {
      phone_hash: hash,
      total_cod_orders: 1,
      verified_count: 0,
      fake_cancel_count: 0,
      upi_trust_paid_count: 0,
      global_risk_level: 'neutral',
      last_seen_at: new Date().toISOString()
    };
  }

  recordBuyerOutcome(phone, outcome) {
    const hash = hashPhone(phone);
    if (!this.data.buyer_trust_graph[hash]) {
      this.data.buyer_trust_graph[hash] = {
        phone_hash: hash,
        total_cod_orders: 0,
        verified_count: 0,
        fake_cancel_count: 0,
        upi_trust_paid_count: 0,
        global_risk_level: 'neutral',
        last_seen_at: new Date().toISOString()
      };
    }

    const record = this.data.buyer_trust_graph[hash];
    record.total_cod_orders += 1;
    record.last_seen_at = new Date().toISOString();

    if (outcome === 'VERIFIED_GENUINE') {
      record.verified_count += 1;
    } else if (outcome === 'CANCEL_REQUESTED') {
      record.fake_cancel_count += 1;
    } else if (outcome === 'TRUST_LOCK_PAID') {
      record.upi_trust_paid_count += 1;
    }

    // Determine risk level
    if (record.fake_cancel_count >= 2 && record.fake_cancel_count > record.verified_count) {
      record.global_risk_level = 'habitual_timepasser';
    } else if (record.verified_count >= 3 && record.fake_cancel_count === 0) {
      record.global_risk_level = 'trusted';
    } else {
      record.global_risk_level = 'neutral';
    }

    this.save();
    return record;
  }

  // --- Leads (waitlist) ---
  addLead(leadData) {
    if (!Array.isArray(this.data.leads)) this.data.leads = [];
    const lead = {
      id: `lead_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      phone: leadData.phone || null,
      name: leadData.name || null,
      email: leadData.email || null,
      volume: leadData.volume || null,
      source: leadData.source || null,
      created_at: new Date().toISOString()
    };
    this.data.leads.unshift(lead);
    this.save();
    return lead;
  }

  // --- Analytics Overview ---
  getAnalytics(sellerId = null) {
    const seller = sellerId ? this.getSeller(sellerId) : null;
    const orders = seller ? this.getOrders(seller.id) : [];

    const totalOrders = orders.length;
    const verifiedOrders = orders.filter(o => o.verification_status === 'verified_cleaned' || o.verification_status === 'trust_lock_paid').length;
    const fakeBlockedOrders = orders.filter(o => o.verification_status === 'cancelled_fake').length;
    const totalMoneySaved = orders.reduce((sum, o) => sum + (Number(o.rto_money_saved) || 0), 0);
    const pendingOrders = orders.filter(o => o.verification_status === 'queued' || o.verification_status === 'calling' || o.verification_status === 'trust_lock_sent').length;

    // This is the share of orders that reached a verified/cancelled outcome.
    // It is NOT a measured RTO reduction rate; that requires a baseline
    // comparison and must not be presented as a proven saving.
    const rtoReductionRate = totalOrders > 0 ? Math.round(((verifiedOrders + fakeBlockedOrders) / totalOrders) * 100) : 0;

    return {
      seller_id: seller ? seller.id : null,
      seller_brand: seller ? seller.brand_name : null,
      wallet_balance_inr: seller ? (Number(seller.wallet_balance_inr) || 0.00) : 0.00,
      total_orders_protected: totalOrders,
      verified_orders: verifiedOrders,
      fake_blocked_orders: fakeBlockedOrders,
      pending_orders: pendingOrders,
      rto_money_saved_inr: totalMoneySaved,
      rto_reduction_rate_pct: rtoReductionRate,
      avg_call_duration_seconds: (() => {
        const logs = this.data.call_logs.filter(c => orders.some(o => o.id === c.order_id) && Number(c.duration_seconds) > 0);
        if (!logs.length) return 0;
        return Math.round(logs.reduce((sum, c) => sum + Number(c.duration_seconds), 0) / logs.length);
      })(),
      cost_per_verified_order_inr: 6.00
    };
  }

  // --- Financial Ledger Operations ---
  recordWalletTransaction(txn) {
    if (!Array.isArray(this.data.wallet_transactions)) {
      this.data.wallet_transactions = [];
    }
    this.data.wallet_transactions.unshift(txn);
    this.save();
    return txn;
  }

  getWalletTransactions(sellerId = null) {
    if (!sellerId) return [];
    if (!Array.isArray(this.data.wallet_transactions)) return [];
    return this.data.wallet_transactions.filter(t => t.seller_id === sellerId);
  }

  // --- Background Autonomous Queue Operations ---
  enqueueJob(jobData) {
    if (!Array.isArray(this.data.queue_jobs)) {
      this.data.queue_jobs = [];
    }
    const id = jobData.id || `job_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const job = {
      id,
      order_id: jobData.order_id,
      seller_id: jobData.seller_id,
      action: jobData.action || 'DISPATCH_VOICE_CALL',
      scheduled_at: jobData.scheduled_at || new Date().toISOString(),
      status: jobData.status || 'pending', // 'pending', 'processing', 'completed', 'failed', 'retrying'
      attempts: jobData.attempts || 0,
      max_attempts: jobData.max_attempts || 3,
      delay_reason: jobData.delay_reason || 'SLA_45S_DELAY',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    this.data.queue_jobs.unshift(job);
    this.save();
    return job;
  }

  getPendingJobs() {
    if (!Array.isArray(this.data.queue_jobs)) return [];
    const now = new Date().toISOString();
    return this.data.queue_jobs.filter(j => 
      (j.status === 'pending' || j.status === 'retrying') && 
      j.scheduled_at <= now
    );
  }

  updateJob(id, updates) {
    if (!Array.isArray(this.data.queue_jobs)) return null;
    const job = this.data.queue_jobs.find(j => j.id === id);
    if (!job) return null;
    Object.assign(job, updates, { updated_at: new Date().toISOString() });
    this.save();
    return job;
  }

  getQueueJobs(limit = 50) {
    if (!Array.isArray(this.data.queue_jobs)) return [];
    return this.data.queue_jobs.slice(0, limit);
  }
}

const db = new Database();

module.exports = {
  db,
  hashPhone
};
