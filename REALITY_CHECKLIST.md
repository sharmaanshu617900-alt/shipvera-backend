# TrustOrder by Shipvera — Reality & Production Readiness Checklist

This document tracks the **Real vs Blocked** status of every integration and feature in **TrustOrder by Shipvera**.
All mock data, demo fallbacks, hardcoded coordinates, fabricated transcripts, and sandbox-success paths have been completely removed.
TrustOrder strictly **fails closed** whenever live credentials are not provided.

---

## 1. CRITICAL SECURITY NOTICE — READ BEFORE PRODUCTION

- **Revoked Bolna Credential**: A hardcoded Bolna key fallback was previously committed to git history on main. Credentials are now **STRICTLY ENV-ONLY**. That old credential must be treated as **permanently compromised and revoked**.
- **Action Required by Owner**:
  1. Revoke the old Bolna credential immediately in the [Bolna Dashboard](https://bolna.ai).
  2. Generate a new Bolna API Key and create an agent configured for the 25-second Landmark Interrogator prompt.
  3. Store the new `BOLNA_API_KEY` and `BOLNA_AGENT_ID` in your production secret store or `.env`.
  4. Never commit `.env` or paste secrets into chat.

---

## 2. REAL / NEEDS KEY / BLOCKED STATUS MATRIX

| Integration / Feature | Status in Code | Missing Environment Variable(s) | Operational Blocker / Owner Action Needed |
|---|---|---|---|
| **Supabase Cloud Database (8 Canonical Tables)** | **Real** (Zero seed data, fails closed, append-only ledgers) | `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Owner must create Supabase project and execute `migrations/001_initial_schema.sql` in the Supabase SQL Editor. |
| **Shopify Order Ingestion & Webhook Sync** | **Real** (HMAC verified, 401/404/400 fail-closed, admin address overwrite) | `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_WEBHOOK_SECRET`, `SHOPIFY_ADMIN_ACCESS_TOKEN` | Owner must configure a Shopify Partner development store and configure the webhook secret. |
| **Bolna Hinglish Voice AI (25s Landmark Interrogator)** | **Real** (Live call dispatch, 12 INR credit check, zero fake transcripts) | `BOLNA_API_KEY`, `BOLNA_AGENT_ID`, `BOLNA_FROM_PHONE_NUMBER` | Owner must rotate Bolna API key and configure an approved outbound phone number. |
| **Meta WhatsApp Cloud API (Trust Lock & Recovery)** | **Real** (Fallback within same credit, fail-closed) | `WHATSAPP_ACCESS_TOKEN` (or `WHATSAPP_CLOUD_API_TOKEN`), `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_NAME` | Owner must register Meta WhatsApp Business Account (WABA) and get template pre-approved. |
| **Razorpay Payment Gateway (ONLY Gateway)** | **Real** (Payment Links for ₹19 Trust Lock, Prepaid Recovery, Wallet recharges, Subscriptions, HMAC webhooks) | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | **CRITICAL BLOCKER**: Merchant account KYC, Video KYC, bank account verification, and live mode activation required. Live keys (`rzp_live_*`) cannot function until Razorpay finishes merchant review. |
| **Google Maps Geocoding & Deliverability** | **Real** (No centroid fallback, null score & coords when key missing) | `GOOGLE_MAPS_API_KEY` | Owner must link a billing account on Google Cloud Console and enable Geocoding API. |
| **LLM Landmark Address Extraction** | **Real** (Rule-based caps confidence at 85; LLM structured parsing when key present) | `LLM_API_KEY`, `LLM_MODEL` | Optional: Configure OpenAI/Anthropic/Gemini key for >85 confidence extraction. |
| **Shiprocket Logistics Sync** | **Real** (Fail-closed on unconfigured credentials) | `SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD` | Shiprocket account credentials if syncing AWB labels. |
| **RTO Recovery Engine** | **Real** (Worth-It formula, Return QC gate, Prepaid ONLY, COD forbidden, 10% commission on recovery_paid) | Dependent on `RAZORPAY_*` & `BOLNA_*` / `WHATSAPP_*` | Cannot create live prepaid links without Razorpay key. |
| **Wallet & Pricing Ledger** | **Real** (Append-only `wallet_ledger`, 18% GST at checkout, 1-time ₹99 trial, bulk ₹19 weekly settlement) | Operational locally; cloud persistence needs Supabase migration | Execute `migrations/001_initial_schema.sql`. |

---

## 3. CORE ARCHITECTURE & HARD RULES AUDIT

1. **Zero Mock / Fake Policy**:
   - Absolutely no fake transcripts, recordings, landmarks, or buyer confirmations.
   - If a provider key is absent, TrustOrder returns `{ success: false, mode: "not_configured", missing: "EXACT_ENV_VAR" }`.
   - Google Maps absent = coordinates `null`, score `null`. No `452001` or `Bikaner Sweets` fallback.
2. **Prepaid-Only RTO Recovery**:
   - COD recovery is **STRICTLY FORBIDDEN**. Any code path attempting to reship an RTO order on COD throws `COD_RESHIPMENT_FORBIDDEN` and logs `reship_status: 'blocked_cod'`.
   - Buyer must pay the discounted price in full via a Razorpay Payment Link before reshipment.
3. **Return QC Gate**:
   - Returned item must be inspected and marked by seller as `undamaged` or `damaged`.
   - If QC status is `unknown`, recovery is blocked (`recovery_blocked_qc_pending`).
4. **Worth-It Formula**:
   - `P > F + PK + C + CALL + NEW`
   - If false, recovery is marked `recovery_not_worth_it`, and the buyer is **NEVER** contacted.
5. **Double-Entry Financial Ledger**:
   - `wallet_ledger` is strictly append-only.
   - ₹19 Trust Lock is **seller's money** (not platform revenue). Held in seller's trust balance and settled in bulk weekly (minimum ₹500). Payout fee borne by seller.
   - 10% recovery commission is deducted **ONLY** when Razorpay confirms the recovery payment was paid (`recovery_paid`).
   - Free dispositions: `unanswered`, `busy`, `dnd`, `carrier_failed`, `ai_error`, hangup under 10 seconds.
   - Billable dispositions: `confirmed`, `corrected`, `cancelled`.

---

## 4. HOW TO RUN PRODUCTION ACCEPTANCE TESTS

Run the full automated test suite containing 13/13 acceptance tests and live connection audits:

```bash
# Run all tests
npm test

# Run specifically the RTO Recovery & Pricing acceptance test suite
npm run test:recovery
```

### All 13 Acceptance Tests:
1. `Empty DB shows zeros, no seed sellers, no seed orders`
2. `Google Maps without key returns success:false and null score/coords`
3. `Voice call without Bolna keys throws NOT_CONFIGURED without fakes`
4. `Trust Lock without Razorpay/WhatsApp keys returns success:false`
5. `Wallet tests: GST (+18%), trial one-time, non-billable zero charge, overage`
6. `Trust Lock: Seller money held in trust balance, bulk weekly settlement min ₹500`
7. `Recovery Test 1, undamaged: Product ₹800, total cost ₹187, worth-it = true`
8. `Recovery Test 2, damaged: Product ₹800, new product ₹400, total cost ₹587, worth-it = true`
9. `Recovery Test 3, low price: Product ₹300, damaged = ₹537, worth-it = false, buyer NOT contacted`
10. `Recovery Test 4, COD reship blocked: Code path attempting COD fails closed with COD_RESHIPMENT_FORBIDDEN`
11. `Recovery Test 5, unpaid: Payment link unpaid, order must NOT ship, commission must be ₹0`
12. `Recovery Test 6, paid: Webhook verifies paid, commission deducted, seller approves, reshipment created`
13. `Recovery Test 7, missing keys: Returns success:false with exact missing env name`

---

## 5. MANUAL TEST WORKFLOW (OWNER TEST NUMBER ONLY)

> [!WARNING]
> Never run live tests against real customers. Use the store owner's personal verified test number only.

1. **Configure Environment**:
   - Populate `.env` with real credentials (`BOLNA_API_KEY`, `BOLNA_AGENT_ID`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`).
2. **Execute Database Migration**:
   - Open Supabase SQL Editor and execute `migrations/001_initial_schema.sql`.
3. **Start Server**:
   - `npm start`
4. **Trigger Quick-Paste or Test Order with Owner Phone**:
   - Send order payload with `buyer_phone: "+91<OWNER_NUMBER>"` and COD amount.
5. **Verify Voice Interrogation**:
   - Answer the call on the test phone. Speak house number, landmark, and gate color in Hinglish.
   - Inspect call log in dashboard: ensure transcript and recording URL match real Bolna event.
6. **Verify Address Cleaning**:
   - Check cleaned address on dashboard: Line 1 <= 35 characters, Line 2 contains landmark.
7. **Verify RTO Recovery Workflow**:
   - Mark test order as `rto_returned`.
   - In Dashboard > RTO Recovery Console, click "QC: Undamaged".
   - Verify Worth-It calculation is displayed.
   - Click "Offer Recovery": verify Razorpay Payment Link is generated and sent via WhatsApp.
   - Complete payment on Razorpay test page.
   - Verify webhook marks order `recovery_paid` and deducts 10% commission.
   - Click "Approve Reshipment": verify reshipment created.

---

## 6. ITEMS REQUIRING OWNER ACTION (CANNOT BE AUTOMATED)

1. **Bolna Key Rotation**: Generate new key in Bolna dashboard to replace compromised legacy key.
2. **Razorpay Activation & KYC**: Complete Video KYC and submit business documents in Razorpay dashboard.
3. **Supabase Migration**: Run `migrations/001_initial_schema.sql` in your Supabase project.
4. **Shopify Test Store**: Create a development store in Shopify Partners and create a Custom App with `write_orders` permission.
5. **WhatsApp Template Approval**: Submit template for Trust Lock and Recovery in Meta Business Manager.
6. **Google Maps Billing**: Link credit card in Google Cloud Console to enable Geocoding API.
