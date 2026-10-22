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

// Initial Database Schema and Seed Data
function getInitialData() {
  const defaultSellerId = 'sel_d2c_enterprise_001';
  
  return {
    sellers: [
      {
        id: defaultSellerId,
        email: 'founder@snitchcloth.in',
        brand_name: 'Snitch Apparel & Streetwear',
        phone: '+919876500001',
        shopify_domain: 'snitch-streetwear.myshopify.com',
        shopify_access_token: 'shpat_live_encrypted_access_token_demo',
        shiprocket_token: 'sr_token_live_encrypted_demo',
        wallet_balance_inr: 0.00, // Strictly ₹0.00 (Pure Pay-As-You-Go, Zero Free Credits)
        plan_tier: 'pay_as_you_go', // 'pay_as_you_go', 'starter', 'pro', 'scale'
        upi_trust_lock_amount: 19,
        total_orders_processed: 12,
        rto_cut_percentage: 70,
        created_at: new Date(Date.now() - 7 * 86400000).toISOString()
      }
    ],
    orders: [
      {
        id: 'ord_9402_indore',
        seller_id: defaultSellerId,
        external_order_id: '#UK-9402',
        source: 'shopify',
        buyer_name: 'Priya Sharma',
        buyer_phone: '+919876543210',
        cod_amount: 1799.00,
        raw_address: 'gali no 2 mg road indore',
        pincode: '452001',
        city: 'Indore',
        missing_fields: ['house_number', 'landmark'],
        cleaned_address_line1: 'Plot No. 14, 2nd Floor, White Gate',
        cleaned_address_line2: 'Behind 56 Dukan, Opp. Bikaner Sweets, MG Road',
        cleaned_landmark: 'Opposite Bikaner Sweets, Behind 56 Dukan',
        verification_status: 'verified_cleaned',
        risk_score: 12,
        rto_money_saved: 180.00,
        tags: ['RTO-Shield-Verified', 'Address-Cleaned'],
        created_at: new Date(Date.now() - 3600000).toISOString(),
        updated_at: new Date(Date.now() - 3400000).toISOString()
      },
      {
        id: 'ord_9403_rohtak',
        seller_id: defaultSellerId,
        external_order_id: '#UK-9403',
        source: 'shopify',
        buyer_name: 'Rohan Sharma',
        buyer_phone: '+919812345678',
        cod_amount: 2499.00,
        raw_address: 'sharma dairy ke piche gali 4 rohtak',
        pincode: '124001',
        city: 'Rohtak',
        missing_fields: ['house_number'],
        cleaned_address_line1: 'Plot No. 42, Yellow House, 1st Left after Sharma Dairy',
        cleaned_address_line2: 'Gali No. 4, Behind Sharma Dairy',
        cleaned_landmark: 'Sharma Dairy',
        verification_status: 'verified_cleaned',
        risk_score: 15,
        rto_money_saved: 180.00,
        tags: ['RTO-Shield-Verified', 'Address-Cleaned'],
        created_at: new Date(Date.now() - 7200000).toISOString(),
        updated_at: new Date(Date.now() - 7000000).toISOString()
      },
      {
        id: 'ord_9404_fake_jaipur',
        seller_id: defaultSellerId,
        external_order_id: '#UK-9404',
        source: 'shopify',
        buyer_name: 'Amit Verma',
        buyer_phone: '+919999999999',
        cod_amount: 1299.00,
        raw_address: 'asdfghjkl jaipur',
        pincode: '302001',
        city: 'Jaipur',
        missing_fields: ['house_number', 'landmark', 'street'],
        cleaned_address_line1: null,
        cleaned_address_line2: null,
        cleaned_landmark: null,
        verification_status: 'cancelled_fake',
        risk_score: 95,
        rto_money_saved: 180.00,
        tags: ['RTO-Shield-Fake-Cancelled'],
        created_at: new Date(Date.now() - 10800000).toISOString(),
        updated_at: new Date(Date.now() - 10600000).toISOString()
      },
      {
        id: 'ord_9405_dicey_lucknow',
        seller_id: defaultSellerId,
        external_order_id: '#UK-9405',
        source: 'shopify',
        buyer_name: 'Kavita Singh',
        buyer_phone: '+919839012345',
        cod_amount: 999.00,
        raw_address: 'Gomti Nagar sector 4',
        pincode: '226010',
        city: 'Lucknow',
        missing_fields: ['house_number'],
        cleaned_address_line1: null,
        cleaned_address_line2: null,
        cleaned_landmark: null,
        verification_status: 'trust_lock_sent',
        risk_score: 65,
        rto_money_saved: 0.00,
        tags: ['RTO-Shield-Trust-Lock-Pending'],
        created_at: new Date(Date.now() - 14400000).toISOString(),
        updated_at: new Date(Date.now() - 14200000).toISOString()
      }
    ],
    call_logs: [
      {
        id: 'call_indore_001',
        order_id: 'ord_9402_indore',
        seller_id: defaultSellerId,
        provider_call_id: 'bolna_call_9482019482',
        duration_seconds: 24,
        recording_url: 'https://cdn.shipvera.com/recordings/call_indore_001.mp3',
        transcript: [
          { role: 'ai', speaker: 'Shipvera AI', text: 'Namaste Priya ji! Main Snitch Apparel ke dispatch desk se bol raha hoon. Aapka ₹1,799 ka order pack ho gaya hai.' },
          { role: 'ai', speaker: 'Shipvera AI', text: 'Bhaiya, aapne address mein Gali no 2 likha hai par makan number ya exact landmark nahi hai. Wahan aas-paas konsi dukaan ya gate ka rang bata denge taaki Delhivery wala bhatke na?' },
          { role: 'user', speaker: 'Buyer (Priya S.)', text: 'Haan bhaiya, 56 Dukan ke piche Bikaner Sweets ke samne safed gate hai 2nd floor, wahi deliver karwana.' },
          { role: 'ai', speaker: 'Shipvera AI', text: 'Acha, Bikaner Sweets ke samne safed gate 2nd floor, note kar liya! 3-4 din mein mil jayega. Dhanyawad!' }
        ],
        extracted_landmark: 'Opposite Bikaner Sweets, Behind 56 Dukan',
        buyer_intent: 'VERIFIED_GENUINE',
        call_cost_inr: 6.00,
        created_at: new Date(Date.now() - 3400000).toISOString()
      },
      {
        id: 'call_fake_002',
        order_id: 'ord_9404_fake_jaipur',
        seller_id: defaultSellerId,
        provider_call_id: 'bolna_call_9999999999',
        duration_seconds: 9,
        recording_url: 'https://cdn.shipvera.com/recordings/call_fake_002.mp3',
        transcript: [
          { role: 'ai', speaker: 'Shipvera AI', text: 'Namaste Amit ji! Main Snitch ke dispatch desk se bol raha hoon. Aapka ₹1,299 ka order dispatch hona hai.' },
          { role: 'ai', speaker: 'Shipvera AI', text: 'Bhaiya aapka address incomplete hai, aas-pass koi landmark bata denge?' },
          { role: 'user', speaker: 'Buyer (Amit V.)', text: 'Nahi chahiye mujhe, cancel kar do galti se place hua tha.' },
          { role: 'ai', speaker: 'Shipvera AI', text: 'Koi baat nahi ji, main abhi cancel kar deta hoon. Dhanyawad!' }
        ],
        extracted_landmark: null,
        buyer_intent: 'CANCEL_REQUESTED',
        call_cost_inr: 6.00,
        created_at: new Date(Date.now() - 10600000).toISOString()
      }
    ],
    buyer_trust_graph: {
      [hashPhone('+919876543210')]: {
        phone_hash: hashPhone('+919876543210'),
        total_cod_orders: 5,
        verified_count: 5,
        fake_cancel_count: 0,
        upi_trust_paid_count: 1,
        global_risk_level: 'trusted', // 'trusted', 'neutral', 'habitual_timepasser'
        last_seen_at: new Date().toISOString()
      },
      [hashPhone('+919999999999')]: {
        phone_hash: hashPhone('+919999999999'),
        total_cod_orders: 14,
        verified_count: 1,
        fake_cancel_count: 12,
        upi_trust_paid_count: 0,
        global_risk_level: 'habitual_timepasser',
        last_seen_at: new Date().toISOString()
      }
    }
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
      const initial = getInitialData();
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
        console.error('Error reading database, restoring default:', err);
        this.data = getInitialData();
        this.save();
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
    if (id) {
      const match = this.data.sellers.find(s => s.id === id);
      if (match) return match;
    }
    return this.data.sellers[0] || null;
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
      rto_cut_percentage: 70,
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
    const targetId = sellerId || this.data.sellers[0]?.id;
    if (targetId) {
      return this.data.orders.filter(o => o.seller_id === targetId).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
    return [...this.data.orders].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  getOrderById(id) {
    return this.data.orders.find(o => o.id === id || o.external_order_id === id);
  }

  createOrder(orderData) {
    const id = orderData.id || `ord_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const newOrder = {
      id,
      seller_id: orderData.seller_id || 'sel_d2c_enterprise_001',
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
      geo_location_type: orderData.geo_location_type || 'APPROXIMATE',
      geo_deliverability_score: orderData.geo_deliverability_score || 70,
      geo_accuracy_label: orderData.geo_accuracy_label || 'Pincode Centroid',
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
      seller_id: logData.seller_id || 'sel_d2c_enterprise_001',
      provider_call_id: logData.provider_call_id || `bolna_${Date.now()}`,
      duration_seconds: logData.duration_seconds || 0,
      recording_url: logData.recording_url || `https://cdn.shipvera.com/recordings/${id}.mp3`,
      transcript: logData.transcript || [],
      extracted_landmark: logData.extracted_landmark || null,
      buyer_intent: logData.buyer_intent || 'genuine',
      call_cost_inr: logData.call_cost_inr || 6.00,
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

  // --- Analytics Overview ---
  getAnalytics(sellerId = null) {
    const seller = this.getSeller(sellerId);
    const orders = this.getOrders(seller ? seller.id : null);

    const totalOrders = orders.length;
    const verifiedOrders = orders.filter(o => o.verification_status === 'verified_cleaned' || o.verification_status === 'trust_lock_paid').length;
    const fakeBlockedOrders = orders.filter(o => o.verification_status === 'cancelled_fake').length;
    const totalMoneySaved = orders.reduce((sum, o) => sum + (Number(o.rto_money_saved) || 0), 0);
    const pendingOrders = orders.filter(o => o.verification_status === 'queued' || o.verification_status === 'calling' || o.verification_status === 'trust_lock_sent').length;

    const rtoReductionRate = totalOrders > 0 ? Math.min(74, Math.round(((verifiedOrders + fakeBlockedOrders) / totalOrders) * 70)) : 0;

    return {
      seller_id: seller ? seller.id : null,
      seller_brand: seller ? seller.brand_name : 'My Store',
      wallet_balance_inr: seller ? (Number(seller.wallet_balance_inr) || 0.00) : 0.00,
      total_orders_protected: totalOrders,
      verified_orders: verifiedOrders,
      fake_blocked_orders: fakeBlockedOrders,
      pending_orders: pendingOrders,
      rto_money_saved_inr: totalMoneySaved,
      rto_reduction_rate_pct: rtoReductionRate,
      avg_call_duration_seconds: totalOrders > 0 ? 24 : 0,
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

  getWalletTransactions(sellerId = 'sel_d2c_enterprise_001') {
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
      seller_id: jobData.seller_id || 'sel_d2c_enterprise_001',
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
