# Supabase migration — TrustOrder

Status: DRAFT PR, NOT merged, NOT a live switch-over. Read the limits
at the bottom before running anything.

## 1. What already exists in Supabase (verified 2026-10-27, read-only)

Project: snsgiegvdvwxezltvdrk.supabase.co. Counts are from PostgREST
`count=exact` headers only; no row values are recorded here.

Existing tables, all returning 200:
- sellers — 5 rows, columns: id, email, brand_name, phone,
  shopify_domain, shopify_access_token, shiprocket_token,
  wallet_balance_inr, plan_tier, upi_trust_lock_amount,
  total_orders_processed, rto_cut_percentage, created_at, updated_at.
  Missing vs db.js: `name`, `password_hash`.
- orders — 11 rows, columns match db.js except: missing
  `shopify_order_id`, `otp_status`, `otp_channel`,
  `trust_lock_payment_link_id`, `trust_lock_status`.
- call_logs — 0 rows. Columns could not be listed from an empty
  sample; the old supabase_schema.sql is the only source, so treat
  its call_logs columns as assumed, not verified, until a row exists.
- buyer_trust_graph — 2 rows.
- wallet_transactions — 4 rows, columns match db.js.
- queue_jobs — 0 rows. Code also writes `error` and `result`,
  which the old schema lacked.
- requirements — 0 rows, unrelated to TrustOrder, ignored here.

Missing tables before this migration:
- leads, otp_verifications, trust_locks. OTP and Trust Lock were
  previously represented only by order status and wallet rows.

Column/type mismatches that matter:
- db.js generates TEXT ids (`sel_`, `ord_`, `call_`, `job_`,
  `lead_`). Supabase uses UUID ids. Do not copy local ids to
  Supabase. The adapter uses UUIDs only.
- db.js stores a plaintext `password` on sellers. This migration
  adds `password_hash` only and deliberately ignores plaintext
  passwords. Do not migrate local passwords.
- Old schema defaulted sellers.rto_cut_percentage to 70 and
  call_logs.call_cost_inr to 6.00. Both are unproven defaults.
  Migration 001 sets both defaults to NULL for new rows only;
  existing rows are untouched.
- Old supabase_schema.sql contains a demo seller seed with demo
  tokens. Never run that file. Migration 001 contains no seed.

Old/demo rows: sellers, orders, wallet_transactions and
buyer_trust_graph already contain older rows (counts above).
Do NOT delete them in this PR. Cleaning them needs explicit user
approval, because deleting the wrong rows would destroy the only
record of earlier tests. No beta proof should be claimed from
those rows until they are cleaned or clearly marked as test data.

## 2. What this branch adds

- `supabase/migrations/001_trustorder_core.sql` — idempotent
  migration, no seed. Adds the missing columns and the three new
  tables, plus indexes. New tables have RLS enabled with no
  permissive anon policy; backend access must use the service key
  server-side only. Existing tables are NOT changed for RLS in
  this branch, because that could break routes/auth.js cloud
  lookups until the service-key path is proven.
- `services/supabaseDb.js` — async Supabase adapter with the same
  method names as db.js (sellers, orders, call_logs, trust graph,
  wallet, queue, leads, OTP, Trust Locks, analytics). Analytics
  no longer hardcodes cost_per_verified_order_inr to 6.00; it
  returns the measured average call cost, or null if none exists.
- `services/supabaseClient.js` — canonical env vars are now
  SUPABASE_URL + SUPABASE_SERVICE_KEY, with legacy
  SUPABASE_SERVICE_ROLE_KEY / SUPABASE_KEY as fallbacks.
  Returns null when unconfigured; callers must fail closed.
- `db.js` — production guard only. In production without
  Supabase env vars it throws SUPABASE_NOT_CONFIGURED instead of
  creating local JSON. Local JSON survives only for local dev
  with SUPABASE_ALLOW_LOCAL_JSON=true, and is deprecated.
- `.env.example`, `server.js` health — service-key env names.
- `tests/supabaseDb.test.js` — fail-closed tests, no network.

## 3. Exact dashboard steps (pending user approval)

1. Open Supabase Dashboard -> project snsgiegvdvwxezltvdrk
   -> SQL Editor -> New query.
2. Paste the whole file
   `supabase/migrations/001_trustorder_core.sql` and click Run.
   If any statement fails, stop and report the exact error;
   do not re-run a partial migration blindly, because the file
   is idempotent and a second clean run is safe only after
   reading the error.
3. Verify with PostgREST / Table Editor (no row values needed):
   leads, otp_verifications, trust_locks return 200, and
   sellers now shows `name` and `password_hash` columns.
4. Set server env only (never in chat, never in a committed file):
   SUPABASE_URL and SUPABASE_SERVICE_KEY.
5. Do NOT set SUPABASE_ALLOW_LOCAL_JSON=true in production.
6. Decide separately, with user approval, whether to clean the
   older rows counted in section 1.

## 4. Route conversion — the part this PR does NOT do

db.js is synchronous everywhere (routes, services, queueEngine),
while Supabase is async. A one-line swap would silently break
every route, because a Promise is truthy. Therefore this PR
delivers the SQL and the async adapter, but does NOT flip routes
to it. The next step, in a separate PR, is mechanical but must
be done route by route, with a test per route:

- db.getSeller -> await supabaseDb.getSeller
- db.getSellerByEmail -> await supabaseDb.getSellerByEmail
- db.getSellerByShopifyDomain -> await supabaseDb.getSellerByShopifyDomain
- db.getAllSellers -> await supabaseDb.getAllSellers
- db.createSeller -> await supabaseDb.createSeller (password_hash only)
- db.updateSellerWallet -> await supabaseDb.updateSellerWallet
  (read-modify-write; replace with a Postgres RPC for atomicity
  before high-volume wallet use)
- db.getOrders / getOrderById / createOrder / updateOrder ->
  await supabaseDb equivalents
- db.getCallLogs / createCallLog -> await supabaseDb equivalents
- db.getBuyerTrust / recordBuyerOutcome -> await equivalents
- db.recordWalletTransaction / getWalletTransactions -> equivalents
- db.enqueueJob / getPendingJobs / updateJob / getQueueJobs ->
  equivalents
- db.addLead -> await supabaseDb.addLead
- db.getAnalytics -> await supabaseDb.getAnalytics

Until that conversion PR lands and passes, the app still reads
local JSON in dev and throws in production without Supabase env.
Do not claim "Supabase is now the database" from this PR alone.

## 5. Unverified items

- call_logs and queue_jobs columns are assumed from the old
  schema file, not verified from live rows, because both tables
  are empty.
- No live Supabase write was tested in this task. The adapter
  is code-reviewed and fail-closed tested only; a real write
  test needs the SQL run plus server env, then one test seller
  created through the adapter and read back.
- No live call, payment, or Shopify sync is claimed here.
- The old credential in public git history is a separate
  security issue and is not fixed by this migration.
