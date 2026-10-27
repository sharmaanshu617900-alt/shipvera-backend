-- TrustOrder / Shipvera Supabase migration 001
-- Base: agent/sarvam-all-connected (PR #3), which still uses db.js local JSON.
-- This file is IDEMPOTENT (IF NOT EXISTS / IF NOT EXISTS on columns) and
-- contains NO seed data and NO demo seller, token, or order.
-- DO NOT run the old supabase_schema.sql seed block. That block inserts a
-- demo seller with demo tokens and must never be run in this project.
--
-- HOW TO RUN (pending user approval, see SUPABASE_MIGRATION.md):
--   Supabase Dashboard -> project snsgiegvdvwxezltvdrk -> SQL Editor
--   -> New query -> paste this file -> Run.
-- PostgREST alone cannot create tables, so this SQL is the only route
-- in this task. Do not claim tables exist until the dashboard run
-- succeeds and a fresh table query returns 200 for each new table.
--
-- EXISTING TABLES (verified 2026-10-27 via PostgREST, read-only):
--   sellers, orders, call_logs, buyer_trust_graph, wallet_transactions,
--   queue_jobs already exist. This migration does NOT recreate them and
--   does NOT change their existing id type (UUID). Existing rows are
--   left untouched. Old/demo rows already in sellers/orders/wallet are
--   NOT deleted by this file; clean them only with explicit user approval.
--
-- RLS GUIDANCE:
--   New tables below have RLS ENABLED with no permissive anon policy.
--   The backend must use the service_role key (SUPABASE_SERVICE_KEY)
--   server-side only. The service role bypasses RLS; anon/authenticated
--   keys must never be used from the browser or from server code that
--   writes seller data. Existing tables in the old schema had RLS
--   disabled; changing that is a separate, tested decision and is NOT
--   done here, because it could break the current cloud lookups in
--   routes/auth.js until the service-key path is proven.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------------
-- 1. Fix columns that db.js expects but the old schema lacks.
--    Sellers in db.js have `name` and a password field. Passwords must
--    NEVER be stored in plaintext: this migration adds password_hash
--    only. Any plaintext password in local JSON must NOT be copied here.
-- ------------------------------------------------------------------
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Old schema defaulted rto_cut_percentage to 70, which is an unproven
-- claim. db.js sets it to NULL until real orders are measured. Change
-- the default for NEW rows only; existing rows are untouched.
ALTER TABLE sellers ALTER COLUMN rto_cut_percentage SET DEFAULT NULL;

-- Orders in db.js / webhooks carry a Shopify order id, an OTP status
-- (used by verificationRouter: failed / no_reply / mismatch), and
-- Trust Lock payment-link state. None of these columns existed before.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shopify_order_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS otp_status TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS otp_channel TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS trust_lock_payment_link_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS trust_lock_status TEXT;

-- Call logs need the provider and a cost breakdown. The old schema
-- had a single call_cost_inr with a fixed 6.00 default, which must
-- never be assumed. Keep the column, add the breakdown, and do not
-- set a fixed default cost for new rows.
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'sarvam';
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS billed_duration_seconds INT;
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS agent_cost_inr NUMERIC(10, 2);
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS telephony_cost_inr NUMERIC(10, 2);
ALTER TABLE call_logs ALTER COLUMN call_cost_inr SET DEFAULT NULL;

-- Queue jobs in code are updated with `error` and `result`, which the
-- old schema lacked. Without these, job failures were unrecorded.
ALTER TABLE queue_jobs ADD COLUMN IF NOT EXISTS error TEXT;
ALTER TABLE queue_jobs ADD COLUMN IF NOT EXISTS result TEXT;

-- ------------------------------------------------------------------
-- 2. Leads / waitlist. db.js addLead() writes these to local JSON.
--    There was no leads table in Supabase before this migration.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone TEXT,
  name TEXT,
  email TEXT,
  volume TEXT,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------------
-- 3. OTP verifications. OTP-first routing (PR #3) currently has no
--    persistent OTP record: otp_status lives only on the order row.
--    This table is the audit trail. It stores status, never the OTP
--    code itself. Never store a live OTP code in this table.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS otp_verifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  seller_id UUID REFERENCES sellers(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  verified_at TIMESTAMPTZ
);

-- ------------------------------------------------------------------
-- 4. Trust Locks and settlements. The Rs.19 Trust Lock is the seller's
--    money, not platform revenue. It needs its own ledger row, not
--    just an order status, so weekly bulk settlement can be audited.
--    Settlement/payout fields stay NULL until a real Razorpay
--    webhook confirms payment and a real settlement is made.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trust_locks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  seller_id UUID REFERENCES sellers(id) ON DELETE CASCADE,
  amount_inr NUMERIC(10, 2) NOT NULL DEFAULT 19,
  razorpay_payment_link_id TEXT,
  razorpay_payment_id TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  settled_at TIMESTAMPTZ,
  settlement_reference TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for the new tables and new columns.
CREATE INDEX IF NOT EXISTS idx_orders_shopify_order_id ON orders(shopify_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_otp_status ON orders(otp_status);
CREATE INDEX IF NOT EXISTS idx_otp_order_created ON otp_verifications(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trust_locks_order ON trust_locks(order_id);
CREATE INDEX IF NOT EXISTS idx_trust_locks_seller_status ON trust_locks(seller_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);

-- RLS on NEW tables only (see guidance at the top of this file).
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE otp_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE trust_locks ENABLE ROW LEVEL SECURITY;
-- No permissive policy is created here on purpose. Backend access
-- must use the service_role key server-side only.
