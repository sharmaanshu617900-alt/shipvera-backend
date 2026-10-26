/**
 * Shipvera Production Database Engine
 * Primary: Supabase PostgreSQL Cloud Database
 * Fallback: Local JSON (strictly for local development without credentials; zero seed data)
 * TRD Section 3.2 & Enterprise Financial Ledger
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getSupabaseClient } = require('./services/supabaseClient');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'shipvera_database.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

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

/**
 * Normalizes phone number and computes SHA-256 hash.
 * Plain-text phone numbers are NEVER used as keys in the global buyer trust graph.
 */
function hashPhone(phone) {
  if (!phone) return crypto.createHash('sha256').update('anonymous').digest('hex');
  const normalized = String(phone).replace(/[^\d+]/g, '');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

class Database {
  constructor() {
    this.data = getEmptyData();
    this.isSupabase = false;
    this.sb = null;
    this.init();
  }

  init() {
    this.sb = getSupabaseClient();
    if (this.sb) {
      this.isSupabase = true;
      console.log('[DATABASE] Primary Storage: Supabase PostgreSQL Cloud');
      this.syncFromSupabase().catch(err => {
        console.warn('[DATABASE] Initial Supabase sync deferred/warning:', err.message);
      });
    } else {
      console.warn('[DATABASE] Running in local-dev JSON fallback mode (Supabase not configured). Never used in production; zero seed data.');
      if (!fs.existsSync(DB_FILE)) {
        const initial = getEmptyData();
        fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf-8');
        this.data = initial;
      } else {
        try {
          const raw = fs.readFileSync(DB_FILE, 'utf-8');
          this.data = JSON.parse(raw);
          if (!Array.isArray(this.data.sellers)) this.data.sellers = [];
          if (!Array.isArray(this.data.orders)) this.data.orders = [];
          if (!Array.isArray(this.data.call_logs)) this.data.call_logs = [];
          if (!this.data.buyer_trust_graph || typeof this.data.buyer_trust_graph !== 'object') this.data.buyer_trust_graph = {};
          if (!Array.isArray(this.data.wallet_transactions)) this.data.wallet_transactions = [];
          if (!Array.isArray(this.data.queue_jobs)) this.data.queue_jobs = [];
          if (!Array.isArray(this.data.leads)) this.data.leads = [];
        } catch (err) {
          console.error('[DATABASE] Error reading local JSON fallback, starting empty:', err.message);
          this.data = getEmptyData();
        }
      }
    }
  }

  /**
   * Syncs latest data from Supabase PostgreSQL tables into fast in-memory cache
   */
  async syncFromSupabase() {
    if (!this.sb) return;
    try {
      const [
        { data: sellers },
        { data: orders },
        { data: callLogs },
        { data: trustGraph },
        { data: walletTxns },
        { data: queueJobs }
      ] = await Promise.all([
        this.sb.from('sellers').select('*'),
        this.sb.from('orders').select('*').order('created_at', { ascending: false }).limit(200),
        this.sb.from('call_logs').select('*').order('created_at', { ascending: false }).limit(200),
        this.sb.from('buyer_trust_graph').select('*').limit(500),
        this.sb.from('wallet_transactions').select('*').order('created_at', { ascending: false }).limit(200),
        this.sb.from('queue_jobs').select('*').order('created_at', { ascending: false }).limit(100)
      ]);

      if (Array.isArray(sellers)) {
        this.data.sellers = sellers;
      }
      if (Array.isArray(orders)) {
        this.data.orders = orders;
      }
      if (Array.isArray(callLogs)) {
        this.data.call_logs = callLogs;
      }
      if (Array.isArray(trustGraph)) {
        const graphMap = {};
        for (const row of trustGraph) {
          if (row.phone_hash) graphMap[row.phone_hash] = row;
        }
        this.data.buyer_trust_graph = graphMap;
      }
      if (Array.isArray(walletTxns)) {
        this.data.wallet_transactions = walletTxns;
      }
      if (Array.isArray(queueJobs)) {
        this.data.queue_jobs = queueJobs;
      }
    } catch (err) {
      console.warn('[DATABASE] Supabase sync error:', err.message);
    }
  }

  save() {
    if (!this.isSupabase) {
      try {
        fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
      } catch (err) {
        console.error('[DATABASE] Failed writing local JSON fallback:', err.message);
      }
    }
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
      wallet_balance_inr: Number(s.wallet_balance_inr) || 0,
      plan_tier: s.plan_tier || 'pay_as_you_go',
      created_at: s.created_at
    }));
  }

  getSellerByEmail(email) {
    if (!email) return null;
    return this.data.sellers.find(s => s.email && s.email.toLowerCase() === email.toLowerCase().trim()) || null;
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
    const id = sellerData.id || crypto.randomUUID();
    const newSeller = {
      id,
      name: sellerData.name || sellerData.brand_name || 'Store Founder',
      email: (sellerData.email || '').toLowerCase().trim(),
      brand_name: (sellerData.brand_name || 'My Store').trim(),
      phone: sellerData.phone || '',
      shopify_domain: sellerData.shopify_domain || null,
      shopify_access_token: sellerData.shopify_access_token || null,
      shiprocket_token: sellerData.shiprocket_token || null,
      wallet_balance_inr: 0.00, // Strictly ₹0.00 (Zero Free Credits, Pure Pay-As-You-Go)
      plan_tier: sellerData.plan_tier || 'pay_as_you_go',
      upi_trust_lock_amount: 19,
      total_orders_processed: 0,
      rto_cut_percentage: 70,
      created_at: sellerData.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    this.data.sellers.unshift(newSeller);
    this.save();

    if (this.sb) {
      const { name, ...sbSeller } = newSeller;
      this.sb.from('sellers').insert(sbSeller).then(({ error }) => {
        if (error) console.error('[SUPABASE] Failed to persist new seller:', error.message);
      }).catch(err => console.error('[SUPABASE] Seller insert exception:', err.message));
    }

    return newSeller;
  }

  updateSeller(sellerId, updates) {
    const seller = this.getSeller(sellerId);
    if (!seller) return null;
    Object.assign(seller, updates, { updated_at: new Date().toISOString() });
    this.save();

    if (this.sb) {
      const dbUpdates = { ...updates, updated_at: new Date().toISOString() };
      delete dbUpdates.name;
      this.sb.from('sellers').update(dbUpdates).eq('id', sellerId).then(({ error }) => {
        if (error) console.error('[SUPABASE] Failed to update seller:', error.message);
      }).catch(err => console.error('[SUPABASE] Seller update exception:', err.message));
    }

    return seller;
  }

  updateSellerWallet(sellerId, amountDelta) {
    const seller = this.getSeller(sellerId);
    if (!seller) return null;
    const current = Number(seller.wallet_balance_inr) || 0;
    seller.wallet_balance_inr = Number((current + amountDelta).toFixed(2));
    seller.updated_at = new Date().toISOString();
    this.save();

    if (this.sb) {
      this.sb.from('sellers').update({
        wallet_balance_inr: seller.wallet_balance_inr,
        updated_at: seller.updated_at
      }).eq('id', sellerId).then(({ error }) => {
        if (error) console.error('[SUPABASE] Failed to update seller wallet:', error.message);
      }).catch(err => console.error('[SUPABASE] Seller wallet update exception:', err.message));
    }

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
    if (!id) return null;
    return this.data.orders.find(o => o.id === id || o.external_order_id === id) || null;
  }

  createOrder(orderData) {
    if (!orderData.seller_id) {
      throw new Error('seller_id is required to create an order. Orders are never attributed to a fallback seller.');
    }
    const id = orderData.id || crypto.randomUUID();
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
      rto_money_saved: Number(orderData.rto_money_saved) || 0.00,
      tags: orderData.tags || ['COD-Order'],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    this.data.orders.unshift(newOrder);
    this.save();

    if (this.sb) {
      // Prepare payload; omit fields that may not be present in legacy remote schema
      const sbPayload = { ...newOrder };
      this.sb.from('orders').insert(sbPayload).then(({ error }) => {
        if (error) {
          // If shopify_order_id failed schema check on legacy remote, retry without it
          if (error.message && error.message.includes('shopify_order_id')) {
            const { shopify_order_id, ...retryPayload } = sbPayload;
            this.sb.from('orders').insert(retryPayload).then(({ error: retryErr }) => {
              if (retryErr) console.error('[SUPABASE] Failed to persist order retry:', retryErr.message);
            });
          } else {
            console.error('[SUPABASE] Failed to persist order:', error.message);
          }
        }
      }).catch(err => console.error('[SUPABASE] Order insert exception:', err.message));
    }

    return newOrder;
  }

  updateOrder(id, updates) {
    const order = this.getOrderById(id);
    if (!order) return null;
    Object.assign(order, updates, { updated_at: new Date().toISOString() });
    this.save();

    if (this.sb) {
      const dbUpdates = { ...updates, updated_at: new Date().toISOString() };
      delete dbUpdates.sync_error;
      delete dbUpdates.rto_money_saved_reason;
      this.sb.from('orders').update(dbUpdates).eq('id', order.id).then(({ error }) => {
        if (error) {
          if (error.message && error.message.includes('shopify_order_id')) {
            const { shopify_order_id, ...retryUpdates } = dbUpdates;
            this.sb.from('orders').update(retryUpdates).eq('id', order.id);
          } else {
            console.error('[SUPABASE] Failed to update order:', error.message);
          }
        }
      }).catch(err => console.error('[SUPABASE] Order update exception:', err.message));
    }

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
    const id = logData.id || crypto.randomUUID();
    const newLog = {
      id,
      order_id: logData.order_id,
      seller_id: logData.seller_id || null,
      provider_call_id: logData.provider_call_id || null,
      duration_seconds: Number(logData.duration_seconds) || 0,
      recording_url: logData.recording_url || null, // Only set from real provider; never invented
      transcript: logData.transcript || [],
      extracted_landmark: logData.extracted_landmark || null,
      buyer_intent: logData.buyer_intent || 'genuine',
      call_cost_inr: Number(logData.call_cost_inr) || 0.00,
      created_at: new Date().toISOString()
    };

    this.data.call_logs.unshift(newLog);
    this.save();

    if (this.sb) {
      this.sb.from('call_logs').insert(newLog).then(({ error }) => {
        if (error) console.error('[SUPABASE] Failed to persist call log:', error.message);
      }).catch(err => console.error('[SUPABASE] Call log insert exception:', err.message));
    }

    return newLog;
  }

  // --- Buyer Trust Graph ---
  // Key is strictly the SHA-256 hash of the normalized phone number
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

    if (record.fake_cancel_count >= 2 && record.fake_cancel_count > record.verified_count) {
      record.global_risk_level = 'habitual_timepasser';
    } else if (record.verified_count >= 3 && record.fake_cancel_count === 0) {
      record.global_risk_level = 'trusted';
    } else {
      record.global_risk_level = 'neutral';
    }

    this.save();

    if (this.sb) {
      this.sb.from('buyer_trust_graph').upsert(record).then(({ error }) => {
        if (error) console.error('[SUPABASE] Failed to upsert buyer trust graph:', error.message);
      }).catch(err => console.error('[SUPABASE] Buyer trust graph upsert exception:', err.message));
    }

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
    const id = txn.id || crypto.randomUUID();
    const cleanTxn = {
      id,
      seller_id: txn.seller_id,
      type: txn.type, // 'DEBIT' | 'CREDIT'
      amount: Number(txn.amount),
      balance_before: Number(txn.balance_before),
      balance_after: Number(txn.balance_after),
      purpose: txn.purpose || 'VOICE_AI_VERIFICATION',
      reference_id: txn.reference_id || null,
      meta: txn.meta || {},
      created_at: txn.created_at || new Date().toISOString()
    };

    this.data.wallet_transactions.unshift(cleanTxn);
    this.save();

    if (this.sb) {
      this.sb.from('wallet_transactions').insert(cleanTxn).then(({ error }) => {
        if (error) console.error('[SUPABASE] Failed to persist wallet transaction:', error.message);
      }).catch(err => console.error('[SUPABASE] Wallet transaction insert exception:', err.message));
    }

    return cleanTxn;
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
    const id = jobData.id || crypto.randomUUID();
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

    if (this.sb) {
      this.sb.from('queue_jobs').insert(job).then(({ error }) => {
        if (error) console.error('[SUPABASE] Failed to persist queue job:', error.message);
      }).catch(err => console.error('[SUPABASE] Queue job insert exception:', err.message));
    }

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

    if (this.sb) {
      const dbUpdates = { ...updates, updated_at: new Date().toISOString() };
      this.sb.from('queue_jobs').update(dbUpdates).eq('id', job.id).then(({ error }) => {
        if (error) console.error('[SUPABASE] Failed to update queue job:', error.message);
      }).catch(err => console.error('[SUPABASE] Queue job update exception:', err.message));
    }

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
