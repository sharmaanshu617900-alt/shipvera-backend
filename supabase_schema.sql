-- ====================================================================
-- SHIPVERA AUTONOMOUS VOICE AI DISPATCH ENGINE
-- Production Database Schema for Supabase (PostgreSQL)
-- TRD Section 3.2 & Enterprise Financial Ledger
-- ====================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. SELLERS TABLE
CREATE TABLE IF NOT EXISTS sellers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  brand_name TEXT NOT NULL,
  phone TEXT,
  shopify_domain TEXT UNIQUE,
  shopify_access_token TEXT,
  shiprocket_token TEXT,
  wallet_balance_inr NUMERIC(10, 2) DEFAULT 0.00, -- Strictly ₹0.00 (Zero Free Credits, Pure Pay-As-You-Go)
  plan_tier TEXT DEFAULT 'pay_as_you_go', -- 'pay_as_you_go', 'starter', 'growth', 'scale'
  upi_trust_lock_amount INT DEFAULT 19,
  total_orders_processed INT DEFAULT 0,
  rto_cut_percentage INT DEFAULT 70,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. ORDERS & VERIFICATION PIPELINE TABLE
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  seller_id UUID REFERENCES sellers(id) ON DELETE CASCADE,
  external_order_id TEXT NOT NULL, -- Shopify Order ID (e.g. #UK-9402) or 'WA-9402'
  source TEXT NOT NULL, -- 'shopify', 'shiprocket', 'whatsapp_paste'
  buyer_name TEXT NOT NULL,
  buyer_phone TEXT NOT NULL,
  cod_amount NUMERIC(10, 2) NOT NULL,
  
  -- Raw Address Information
  raw_address TEXT NOT NULL,
  pincode TEXT,
  city TEXT,
  missing_fields JSONB DEFAULT '[]'::jsonb, -- e.g. ["house_number", "landmark"]
  
  -- Cleaned & Standardized Courier Shipping Address
  cleaned_address_line1 TEXT, -- Max 35 chars for courier label standard
  cleaned_address_line2 TEXT,
  cleaned_landmark TEXT,
  
  -- Google Maps Geocoding Coordinates & Deliverability
  geo_coordinates JSONB, -- {"lat": 22.7196, "lng": 75.8577}
  geo_location_type TEXT DEFAULT 'APPROXIMATE', -- 'ROOFTOP', 'RANGE_INTERPOLATED', 'APPROXIMATE'
  geo_deliverability_score INT DEFAULT 70,
  geo_accuracy_label TEXT DEFAULT 'Pincode Centroid',
  
  -- Verification Status & Risk Scoring
  verification_status TEXT DEFAULT 'queued', 
  -- Statuses: 'queued', 'night_hold_scheduled', 'calling', 'verified_cleaned', 'trust_lock_sent', 'trust_lock_paid', 'cancelled_fake', 'payment_required'
  risk_score INT DEFAULT 50, -- 0 to 100
  rto_money_saved NUMERIC(10, 2) DEFAULT 0.00, -- e.g. Rs 180 logged when fake order blocked or address cleaned
  tags TEXT[] DEFAULT ARRAY['COD-Order']::TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. AI CALL LOGS TABLE
CREATE TABLE IF NOT EXISTS call_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  seller_id UUID REFERENCES sellers(id) ON DELETE CASCADE,
  provider_call_id TEXT UNIQUE, -- Voice provider execution/call ID (Sarvam)
  duration_seconds INT DEFAULT 0,
  recording_url TEXT,
  transcript JSONB DEFAULT '[]'::jsonb, -- Array of {role: 'ai'|'user', speaker: '...', text: '...'}
  extracted_landmark TEXT,
  buyer_intent TEXT DEFAULT 'VERIFIED_GENUINE', -- 'VERIFIED_GENUINE', 'CANCEL_REQUESTED', 'DICEY_NO_ANSWER'
  call_cost_inr NUMERIC(6, 2) DEFAULT 6.00,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. GLOBAL NETWORK MOAT: BUYER TRUST GRAPH
CREATE TABLE IF NOT EXISTS buyer_trust_graph (
  phone_hash TEXT PRIMARY KEY, -- SHA-256 of normalized +91 phone number
  total_cod_orders INT DEFAULT 1,
  verified_count INT DEFAULT 0,
  fake_cancel_count INT DEFAULT 0,
  upi_trust_paid_count INT DEFAULT 0,
  global_risk_level TEXT DEFAULT 'neutral', -- 'trusted', 'neutral', 'habitual_timepasser'
  last_seen_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. DOUBLE-ENTRY FINANCIAL LEDGER (WALLET TRANSACTIONS)
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  seller_id UUID REFERENCES sellers(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- 'DEBIT', 'CREDIT'
  amount NUMERIC(10, 2) NOT NULL, -- Negative for debits (-6.00), positive for recharges (+999.00)
  balance_before NUMERIC(10, 2) NOT NULL,
  balance_after NUMERIC(10, 2) NOT NULL,
  purpose TEXT NOT NULL, -- 'VOICE_AI_VERIFICATION', 'TRUST_LOCK_TRIGGER', 'WALLET_RECHARGE_STARTER'
  reference_id TEXT, -- external_order_id or razorpay_payment_id
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. AUTONOMOUS BACKGROUND QUEUE JOBS
CREATE TABLE IF NOT EXISTS queue_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  seller_id UUID REFERENCES sellers(id) ON DELETE CASCADE,
  action TEXT DEFAULT 'DISPATCH_VOICE_CALL',
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed', 'retrying'
  attempts INT DEFAULT 0,
  max_attempts INT DEFAULT 3,
  delay_reason TEXT DEFAULT 'SLA_45S_DELAY', -- 'SLA_45S_DELAY', 'TRAI_NIGHT_WINDOW_BATCH', 'UNANSWERED_RETRY_1'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ====================================================================
-- PERFORMANCE INDEXES (Sub-millisecond query optimization)
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_orders_seller_status ON orders(seller_id, verification_status);
CREATE INDEX IF NOT EXISTS idx_orders_buyer_phone ON orders(buyer_phone);
CREATE INDEX IF NOT EXISTS idx_orders_external_id ON orders(external_order_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_order ON call_logs(order_id);
CREATE INDEX IF NOT EXISTS idx_queue_pending ON queue_jobs(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_wallet_seller ON wallet_transactions(seller_id, created_at DESC);

-- ====================================================================
-- ROW LEVEL SECURITY (RLS) CONFIGURATION FOR BACKEND DAEMON
-- ====================================================================
ALTER TABLE sellers DISABLE ROW LEVEL SECURITY;
ALTER TABLE orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE call_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE buyer_trust_graph DISABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE queue_jobs DISABLE ROW LEVEL SECURITY;

-- ====================================================================
-- SEED INITIAL ENTERPRISE WORKSPACE
-- ====================================================================
INSERT INTO sellers (
  id,
  email,
  brand_name,
  phone,
  shopify_domain,
  shopify_access_token,
  shiprocket_token,
  wallet_balance_inr,
  plan_tier,
  upi_trust_lock_amount
) VALUES (
  'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  'founder@snitchcloth.in',
  'Snitch Apparel & Streetwear',
  '+919876500001',
  'snitch-streetwear.myshopify.com',
  'shpat_live_encrypted_access_token_demo',
  'sr_token_live_encrypted_demo',
  0.00, -- Zero free credits
  'pay_as_you_go',
  19
) ON CONFLICT (email) DO NOTHING;

