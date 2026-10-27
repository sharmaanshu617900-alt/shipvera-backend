# TrustOrder by Shipvera — Commercial Pricing Architecture & Financial Rules

> All prices listed below are **Exclusive of GST (ex-GST)**. An 18% Goods & Services Tax (GST) is added at checkout via **Razorpay**.  
> **ZERO FREE CREDITS**: TrustOrder does not offer signup credits, referral credits, or demo credits.

---

## 1. CORE PRICING TIERS

### A. Free Tier: RTO Audit Only
- **Price**: ₹0
- **Includes**: Real-time risk scoring (0–100) and address hygiene analysis for all ingested Shopify & Quick-Paste orders.
- **Credits**: **0 Credits**. Does not trigger automated voice interrogation calls or WhatsApp messages.

### B. Store Trial (One-Time per Store)
- **Price**: ₹99 ex-GST (+18% GST = ₹116.82)
- **Includes**: 10 voice credits.
- **Validity**: 14 Days from purchase.
- **Rule**: Strictly enforced one-time per store ID. Subsequent attempts are blocked (`TRIAL_ALREADY_USED`).

### C. Pay-As-You-Go (PAYG)
- **Voice Interrogation**: ₹12.00 ex-GST per verified order call.
- **OTP / WhatsApp Fallback**: ₹3.00 ex-GST per order.
- **Minimum Recharge**: ₹500.00 ex-GST (+18% GST = ₹590.00).

### D. Bulk Voice & OTP Credit Packs
Prepaid credit packs for high-volume stores without monthly commitment:

| Pack Name | Credits / Channel | Price (ex-GST) | Price (incl. 18% GST) | Effective Price / Credit |
|---|---|---|---|---|
| **Voice 100** | 100 Voice Credits | ₹999 | ₹1,178.82 | ₹9.99 |
| **Voice 500** | 500 Voice Credits | ₹4,499 | ₹5,308.82 | ₹8.99 |
| **Voice 1,000** | 1,000 Voice Credits | ₹7,999 | ₹9,438.82 | ₹7.999 (Voice floor ₹8 enforced) |
| **OTP 500** | 500 OTP / WhatsApp Credits | ₹1,000 | ₹1,180.00 | ₹2.00 |

### E. Monthly & Annual Subscriptions
Subscriptions renew automatically via Razorpay Subscriptions API.  
*Annual billing*: Pay for 10 months upfront, get 12 months (2 months free).

| Tier | Monthly (ex-GST) | Annual (ex-GST) | Monthly Allocation | Rollover Cap | Overage Rate |
|---|---|---|---|---|---|
| **Reseller Tier** | ₹299 / mo | ₹2,990 / yr | 100 OTP + 10 Voice | Max 50 credits | ₹12 / voice, ₹3 / OTP |
| **Starter** | ₹999 / mo | ₹9,990 / yr | 100 Voice Credits | Max 50 credits | ₹12 / voice |
| **Growth** | ₹2,999 / mo | ₹29,990 / yr | 350 Voice Credits | Max 50 credits | ₹12 / voice |
| **Scale** | ₹7,999 / mo | ₹79,990 / yr | 1,000 Voice Credits | Max 50 credits | ₹12 / voice |

---

## 2. STRICT FINANCIAL & LEDGER RULES

### Rule 1: Billable vs Non-Billable Call Dispositions
Credits are deducted **ONLY** when a genuine, definitive disposition is achieved.

| Disposition | Billable? | Ledger Action |
|---|---|---|
| `confirmed` (Buyer verbally verified address) | **YES** | Debit ₹12.00 |
| `corrected` (Buyer updated landmark/house number) | **YES** | Debit ₹12.00 |
| `cancelled` (Buyer requested order cancellation) | **YES** | Debit ₹12.00 (Saved ₹180 courier loss) |
| `unanswered` / `busy` / `dnd` / `carrier_failed` | **NO** | **₹0.00 (FREE)** |
| `ai_error` | **NO** | **₹0.00 (FREE)** |
| `hangup_under_10s` (Voicemail/hangup < 10 sec) | **NO** | **₹0.00 (FREE)** |

### Rule 2: Voice Pricing Floor
Under no circumstance, discount, or custom pack may voice verification be priced lower than **₹8.00 ex-GST**. This protects gross margins against underlying telephony (SIP trunking) and LLM inference costs.

### Rule 3: Credit Rollover Limits
Unused subscription credits rollover into the next billing cycle up to a hard maximum of **50 credits**. Any surplus beyond 50 expires automatically at cycle renewal.

---

## 3. ₹19 TRUST LOCK SETTLEMENT ARCHITECTURE

The ₹19 UPI Trust Lock is **the seller's money**, NOT TrustOrder platform revenue.

1. **Collection**: Buyer pays ₹19 via a dedicated Razorpay Payment Link.
2. **Custody**: The ₹19 is credited to the seller's `trust_lock_balance_inr`.
3. **Bulk Weekly Settlement**:
   - Settlements are processed in bulk once per week.
   - **Minimum Settlement Threshold**: ₹500.00 accumulated in trust lock balance.
   - Payout fees and gateway processing charges are borne by the seller.
   - **Zero Single-Order Settlements**: We strictly do not settle ₹19 per individual order to prevent micro-transaction gateway fee erosion.

---

## 4. RTO RECOVERY PRICING & COMMISSION RULES

The RTO Recovery engine recovers sunk revenue on orders that were already marked as returned.

1. **Recovery Commission**: **10% of the recovered prepaid price**.
2. **Success-Fee Only**: Commission is charged **ONLY** when Razorpay confirms the payment has been paid (`recovery_paid`).
3. **No Hidden Costs**:
   - If an order is blocked by the **Return QC Gate** (damaged or unknown), **₹0 Commission and ₹0 Call Cost** are charged.
   - If an order is blocked by the **Worth-It Gate** (`P <= F + PK + C + CALL + NEW`), **₹0 Commission and ₹0 Call Cost** are charged because the buyer is never contacted.
4. **Recovery Telephony Cost**: If the Worth-It Gate passes and a recovery call or WhatsApp is dispatched, telephony is charged at the seller's plan rate (e.g. ₹12 voice / ₹3 WhatsApp).

---

## 5. PAYMENT GATEWAY RESTRICTION

- **Razorpay ONLY**: All merchant charges, top-ups, and buyer payment links must originate from Razorpay.
- Cashfree, PhonePe, PayU, Stripe, and Instamojo are intentionally omitted and unsupported.
