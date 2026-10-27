-- ====================================================================
-- TRUSTORDER BY SHIPVERA - AUTONOMOUS DISPATCH & RTO RECOVERY ENGINE
-- Production Database Schema for Supabase (PostgreSQL)
-- TRD Section 3.2 & Enterprise Financial Ledger & Recovery Moat
-- ZERO SEED DATA. Fresh install starts completely empty.
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
  shopify_webhook_secret TEXT,
  shiprocket_token TEXT,
  shiprocket_email TEXT,
  
  -- Wallet & Pricing Ledger
  wallet_balance_inr NUMERIC(10, 2) DEFAULT 0.00, -- Strictly ₹0.00 (Zero Free Credits, Pure Pay-As-You-Go)
  trust_lock_balance_inr NUMERIC(10, 2) DEFAULT 0.00, -- Seller funds collected via ₹19 Trust Lock (held for weekly payout)
  plan_tier TEXT DEFAULT 'pay_as_you_go', -- 'trial', 'pay_as_you_go', 'starter', 'growth', 'scale', 'reseller'
  plan_billing_cycle TEXT DEFAULT 'monthly', -- 'monthly' or 'annual'
  credits_remaining INT DEFAULT 0,
  rollover_credits INT DEFAULT 0, -- Max 50 credits rollover on subscriptions
  trial_used BOOLEAN DEFAULT FALSE, -- One-time trial per store strictly enforced
  trial_expires_at TIMESTAMPTZ,
  upi_trust_lock_amount INT DEFAULT 19,
  total_orders_processed INT DEFAULT 0,
  
  -- RTO Recovery Configuration
  recovery_enabled BOOLEAN DEFAULT TRUE,
  recovery_discount_max_pct NUMERIC(5, 2) DEFAULT 10.00, -- Maximum 10% discount default
  recovery_min_product_price NUMERIC(10, 2) DEFAULT 400.00,
  recovery_auto_approve BOOLEAN DEFAULT FALSE, -- Default auto-approve is OFF
  recovery_default_forward_shipping NUMERIC(10, 2) DEFAULT 80.00,
  recovery_default_packaging NUMERIC(10, 2) DEFAULT 20.00,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. ORDERS & VERIFICATION PIPELINE TABLE
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  seller_id UUID REFERENCES sellers(id) ON DELETE CASCADE,
  external_order_id TEXT NOT NULL, -- Shopify Order ID (e.g. #UK-9402) or 'WA-9402'
  shopify_order_id TEXT, -- Numerical Shopify Order ID (e.g. 5928471928401)
  source TEXT NOT NULL, -- 'shopify', 'shiprocket', 'whatsapp_paste', 'quick_paste'
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
  geo_location_type TEXT DEFAULT NULL, -- 'ROOFTOP', 'RANGE_INTERPOLATED', 'APPROXIMATE', null if no key
  geo_deliverability_score INT DEFAULT NULL,
  geo_accuracy_label TEXT DEFAULT NULL,
  
  -- Verification Status & Risk Scoring
  verification_status TEXT DEFAULT 'queued', 
  -- Statuses: 'queued', 'night_hold_scheduled', 'calling', 'verified_cleaned', 'trust_lock_sent', 'trust_lock_paid', 'cancelled_fake', 'sync_failed', 'rto_returned'
  risk_score INT DEFAULT 50, -- 0 to 100
  rto_money_saved NUMERIC(10, 2) DEFAULT 0.00,
  rto_money_saved_reason TEXT,
  sync_error TEXT,
  tags TEXT[] DEFAULT ARRAY['COD-Order']::TEXT[],
  
  -- RTO Return & Recovery State
  rto_returned_at TIMESTAMPTZ,
  rto_sunk_cost NUMERIC(10, 2) DEFAULT 0.00,
  return_qc_status TEXT DEFAULT 'unknown', -- 'unknown', 'undamaged', 'damaged'
  new_product_cost NUMERIC(10, 2) DEFAULT 0.00,
  recovery_status TEXT DEFAULT 'none',
  -- Statuses: 'none', 'blocked_qc_pending', 'not_worth_it', 'recovery_offered', 'recovery_paid', 'recovery_unpaid', 'recovery_declined', 'pending_approval', 'reshipped', 'blocked_address', 'blocked_cod'
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. AI CALL LOGS TABLE
CREATE TABLE IF NOT EXISTS call_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  seller_id UUID REFERENCES sellers(id) ON DELETE CASCADE,
  provider_call_id TEXT UNIQUE, -- Real Bolna execution ID
  duration_seconds INT DEFAULT 0,
  recording_url TEXT, -- Real audio URL only, null if missing
  transcript JSONB DEFAULT '[]'::jsonb, -- Array of {role, speaker, text}
  extracted_landmark TEXT,
  buyer_intent TEXT DEFAULT 'VERIFIED_GENUINE', -- 'VERIFIED_GENUINE', 'CANCEL_REQUESTED', 'DICEY_NO_ANSWER', 'RECOVERY_AGREED', 'RECOVERY_DECLINED'
  call_cost_inr NUMERIC(6, 2) DEFAULT 0.00,
  call_disposition TEXT DEFAULT 'unconfirmed', -- 'confirmed', 'corrected', 'cancelled', 'unanswered', 'busy', 'dnd', 'carrier_failed'
  is_simulated BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. GLOBAL NETWORK MOAT: BUYER TRUST GRAPH
-- Phone is NEVER stored in plain text as the primary key; strictly hashed with SHA-256
CREATE TABLE IF NOT EXISTS buyer_trust_graph (
  phone_hash TEXT PRIMARY KEY, -- SHA-256 of normalized +91 phone number
  total_cod_orders INT DEFAULT 1,
  verified_count INT DEFAULT 0,
  fake_cancel_count INT DEFAULT 0,
  upi_trust_paid_count INT DEFAULT 0,
  prepaid_recovery_count INT DEFAULT 0,
  global_risk_level TEXT DEFAULT 'neutral', -- 'trusted', 'neutral', 'habitual_timepasser'
  last_seen_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. DOUBLE-ENTRY FINANCIAL LEDGER (WALLET TRANSACTIONS / WALLET LEDGER)
-- Strictly append-only. Never modify old records.
CREATE TABLE IF NOT EXISTS wallet_ledger (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  seller_id UUID REFERENCES sellers(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- 'DEBIT', 'CREDIT'
  amount NUMERIC(10, 2) NOT NULL, -- Negative for debits (-12.00), positive for recharges (+999.00)
  balance_before NUMERIC(10, 2) NOT NULL,
  balance_after NUMERIC(10, 2) NOT NULL,
  purpose TEXT NOT NULL, -- 'VOICE_AI_VERIFICATION', 'TRUST_LOCK_TRIGGER', 'WALLET_RECHARGE', 'RECOVERY_COMMISSION'
  reference_id TEXT, -- external_order_id, razorpay_payment_id, etc.
  gst_amount NUMERIC(10, 2) DEFAULT 0.00,
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- View for backward compatibility with wallet_transactions
CREATE OR REPLACE VIEW wallet_transactions AS SELECT * FROM wallet_ledger;

-- 6. TRUST LOCK PAYMENTS TABLE (₹19 Token Payments)
-- Sits in seller's trust lock account; settled in bulk weekly (minimum ₹500).
CREATE TABLE IF NOT EXISTS trust_lock_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  seller_id UUID REFERENCES sellers(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  amount_inr NUMERIC(10, 2) DEFAULT 19.00,
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  razorpay_payment_link_id TEXT,
  status TEXT DEFAULT 'created', -- 'created', 'paid', 'expired', 'settled'
  settlement_batch_id TEXT,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. SUBSCRIPTIONS TABLE (Monthly & Annual Recurring Plans)
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  seller_id UUID REFERENCES sellers(id) ON DELETE CASCADE,
  plan_tier TEXT NOT NULL, -- 'starter', 'growth', 'scale', 'reseller'
  billing_cycle TEXT DEFAULT 'monthly', -- 'monthly' or 'annual'
  razorpay_subscription_id TEXT,
  status TEXT DEFAULT 'active', -- 'active', 'past_due', 'cancelled', 'completed'
  credits_allocated INT NOT NULL,
  credits_used INT DEFAULT 0,
  rollover_credits_brought_forward INT DEFAULT 0, -- Max 50
  current_period_start TIMESTAMPTZ NOT NULL,
  current_period_end TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. RTO RECOVERY ATTEMPTS TABLE (PREPAID RECOVERY ONLY - APPEND ONLY)
-- Strictly append-only. Never modify old rows.
CREATE TABLE IF NOT EXISTS recovery_attempts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  seller_id UUID REFERENCES sellers(id) ON DELETE CASCADE,
  original_order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  
  -- Sunk cost on the original failed COD order
  rto_cost_sunk NUMERIC(10, 2) NOT NULL,
  
  -- Worth-It Gate Components: P > F + PK + C + CALL + NEW
  product_price NUMERIC(10, 2) NOT NULL, -- P: prepaid price after discount
  discount_percent NUMERIC(5, 2) DEFAULT 0.00,
  forward_shipping NUMERIC(10, 2) NOT NULL, -- F: reshipment freight
  packaging NUMERIC(10, 2) NOT NULL, -- PK: packaging cost
  commission NUMERIC(10, 2) NOT NULL, -- C: 10% of recovered prepaid price (charged ONLY on recovery_paid)
  call_cost NUMERIC(10, 2) NOT NULL, -- CALL: recovery call cost
  new_product_cost NUMERIC(10, 2) DEFAULT 0.00, -- NEW: product cost if returned product is damaged
  
  -- Gate Results
  qc_status TEXT NOT NULL, -- 'undamaged' | 'damaged' | 'unknown'
  worth_it_result BOOLEAN NOT NULL,
  total_cost NUMERIC(10, 2) NOT NULL, -- F + PK + C + CALL + NEW
  net_margin NUMERIC(10, 2) NOT NULL, -- P - total_cost
  
  -- Buyer Contact & Response
  buyer_contacted BOOLEAN DEFAULT FALSE,
  contact_channel TEXT, -- 'voice', 'whatsapp', null
  buyer_response TEXT DEFAULT 'not_contacted', -- 'agreed_prepaid', 'declined', 'unreachable', 'not_contacted'
  
  -- Razorpay Prepaid Payment Link (PREPAID ONLY, NEVER COD)
  razorpay_payment_link_id TEXT,
  razorpay_payment_link_url TEXT,
  payment_status TEXT DEFAULT 'unpaid', -- 'unpaid', 'paid', 'declined', 'expired'
  payment_id TEXT,
  
  -- Reshipment Gate (Requires recovery_paid + seller_approval; COD NEVER)
  seller_approval BOOLEAN DEFAULT FALSE,
  reship_status TEXT DEFAULT 'pending_payment',
  -- Statuses: 'blocked_qc_pending', 'blocked_not_worth_it', 'pending_payment', 'recovery_declined', 'recovery_unpaid', 'pending_approval', 'reshipped', 'blocked_address', 'blocked_cod'
  reship_tracking_number TEXT,
  corrected_address JSONB,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. AUTONOMOUS BACKGROUND QUEUE JOBS
CREATE TABLE IF NOT EXISTS queue_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  seller_id UUID REFERENCES sellers(id) ON DELETE CASCADE,
  action TEXT DEFAULT 'DISPATCH_VOICE_CALL',
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed', 'retrying'
  attempts INT DEFAULT 0,
  max_attempts INT DEFAULT 3,
  delay_reason TEXT DEFAULT 'SLA_45S_DELAY',
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
CREATE INDEX IF NOT EXISTS idx_wallet_seller ON wallet_ledger(seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recovery_seller ON recovery_attempts(seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recovery_order ON recovery_attempts(original_order_id);
CREATE INDEX IF NOT EXISTS idx_trust_lock_seller ON trust_lock_payments(seller_id, status);

-- ====================================================================
-- ROW LEVEL SECURITY (RLS) CONFIGURATION FOR BACKEND DAEMON
-- ====================================================================
ALTER TABLE sellers DISABLE ROW LEVEL SECURITY;
ALTER TABLE orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE call_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE buyer_trust_graph DISABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_ledger DISABLE ROW LEVEL SECURITY;
ALTER TABLE trust_lock_payments DISABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions DISABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_attempts DISABLE ROW LEVEL SECURITY;
ALTER TABLE queue_jobs DISABLE ROW LEVEL SECURITY;
