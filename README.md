# TrustOrder by Shipvera

> **Autonomous COD Dispatch & RTO Recovery Engine**  
> Built for Indian D2C Shopify brands & social commerce sellers to eliminate Cash on Delivery (COD) Return-to-Origin (RTO) losses and recover sunk logistics costs.

---

## 1. WHAT IS TRUSTORDER?

TrustOrder by Shipvera combines an address sanitization engine, a 25-second Hinglish Voice AI landmark interrogator, an automated courier label rewriter, and an autonomous **RTO Recovery Engine**.

### Core Modules:
1. **Address Geo-Sanitizer**: Validates house numbers, landmarks, and pincodes using Google Maps Platform.
2. **25-Second Landmark Interrogator**: Autonomous outbound Hinglish phone call via Bolna to capture rooftop delivery landmarks (opp. sweets shop, behind temple, gate color, floor).
3. **Courier Label Rewriter**: Rewrites colloquial audio into standardized courier shipping labels (Line 1 $\le$ 35 characters) and syncs directly to Shopify Admin and Shiprocket AWBs.
4. **₹19 UPI Trust Lock**: Sends Razorpay UPI payment links via Meta WhatsApp Cloud API for borderline high-risk COD orders. The ₹19 is the seller's money and is settled in bulk weekly.
5. **RTO Recovery Engine (Prepaid Only)**: Identifies returned RTO parcels, evaluates the **Worth-It Gate** ($P > F + PK + C + CALL + NEW$), contacts the buyer for an upfront prepaid discounted purchase via Razorpay, and allows 1-click reshipment upon payment verification.

---

## 2. QUICK START & SETUP

### Step 1: Install Dependencies
```bash
git clone https://github.com/sharmaanshu617900-alt/shipvera-backend.git
cd shipvera-backend
npm install
```

### Step 2: Database Initialization (Supabase)
TrustOrder uses Supabase PostgreSQL cloud storage with zero seed data.
1. Create a new project in your [Supabase Dashboard](https://supabase.com).
2. Open the **SQL Editor**.
3. Copy and run the complete DDL script located at:
   ```
   migrations/001_initial_schema.sql
   ```
4. Note your Project URL, anon key, and service role key.

### Step 3: Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Fill in your credentials:
```env
PORT=3000
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Bolna Voice AI (Rotate your key; old key revoked)
BOLNA_API_KEY=your-new-bolna-key
BOLNA_AGENT_ID=your-agent-id
BOLNA_FROM_PHONE_NUMBER=+91XXXXXXXXXX

# Razorpay (ONLY Supported Payment Gateway)
RAZORPAY_KEY_ID=rzp_live_or_test_key
RAZORPAY_KEY_SECRET=your-razorpay-secret
RAZORPAY_WEBHOOK_SECRET=your-webhook-secret

# Google Maps Platform
GOOGLE_MAPS_API_KEY=your-google-maps-key

# Meta WhatsApp Cloud API
WHATSAPP_ACCESS_TOKEN=your-meta-access-token
WHATSAPP_PHONE_NUMBER_ID=your-phone-number-id
WHATSAPP_TEMPLATE_NAME=your-approved-template
```

### Step 4: Run Acceptance Tests
Verify that all 13 production acceptance tests pass:
```bash
npm test
```

### Step 5: Start the Server
```bash
# Production mode
npm start

# Development mode (with file watcher)
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the landing page and [http://localhost:3000/dashboard.html](http://localhost:3000/dashboard.html) for the merchant dashboard.

---

## 3. ACCEPTANCE TEST SUITE

The automated test suite (`npm test`) verifies all critical production constraints:
- **Empty DB**: Zero seed sellers, zero seed orders.
- **Fail-Closed Integrations**: Without keys, Google Maps returns `null` coords, Voice AI throws `NOT_CONFIGURED` without fakes, and Trust Lock returns `success: false`.
- **Double-Entry Wallet**: Trial one-time enforcement, +18% GST calculation, rollover caps, and zero deduction on failed or short (<10s) calls.
- **₹19 Trust Lock**: Seller funds held in balance, settled in bulk weekly (minimum ₹500).
- **RTO Recovery 7 Tests**:
  - Test 1 (Undamaged): Worth-it evaluated correctly ($800 > $187).
  - Test 2 (Damaged): Sunk and new product costs evaluated ($800 > $587).
  - Test 3 (Low Price): Net loss blocked ($300 < $537) — buyer NOT contacted.
  - Test 4 (COD Reship Blocked): Reshipping RTO on COD is strictly rejected (`COD_RESHIPMENT_FORBIDDEN`).
  - Test 5 (Unpaid): Unpaid Razorpay link halts reshipment and charges ₹0 commission.
  - Test 6 (Paid): Webhook signature verification confirms payment, deducts 10% commission, and allows 1-click reshipment.
  - Test 7 (Missing Keys): Fails closed with exact missing environment variable.

---

## 4. ARCHITECTURE & SPECIFICATION DOCS

- [PRICING.md](PRICING.md): Exact pricing tiers, billable call dispositions, rollover rules, GST, and settlement rules.
- [RECOVERY.md](RECOVERY.md): RTO Recovery engine, mathematical Worth-It gate, QC gate, and reshipment release criteria.
- [REALITY_CHECKLIST.md](REALITY_CHECKLIST.md): Per-integration Real vs Blocked matrix and safe manual testing steps.
- [migrations/001_initial_schema.sql](migrations/001_initial_schema.sql): PostgreSQL schema for all 8 canonical tables.

---

## 5. REVENUE & LEGAL IDENTIFIER

- Product Name: **TrustOrder**
- Legal Entity / Billing Descriptor: **TrustOrder by Shipvera**
