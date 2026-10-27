# TrustOrder by Shipvera — Backend

Sarvam-only voice backend (RTO Shield / TrustOrder). No mock, seed, or
sandbox-success behaviour: missing configuration fails closed.

## TrustOrder rules enforced in code

- Zero free credits. Trial: Rs.99 / 10 credits / 14 days / 1 per store.
- PAYG voice: Rs.12 ex-GST. OTP: Rs.3 ex-GST. Minimum recharge: Rs.500.
- OTP-first: voice only after OTP failed / no reply / mismatch, or for
  high-value (default COD >= Rs.2000) or repeat-RTO orders.
- Hard 60-second call cap. Credit only on a connected call.
- Rs.19 Trust Lock is the seller's money (Razorpay only), weekly bulk
  settlement, minimum Rs.500, payout fee borne by the seller.
- Hinglish landmark script with read-back. Address rewrite only on high
  confidence, with before/after logging.

## Run locally

```bash
cp .env.example .env   # fill in YOUR values; never commit .env
npm install
npm start              # or: npm run dev
```

Health (per-provider, never fake healthy):

```bash
curl http://localhost:3000/api/health
```

Tests (no network, no live calls):

```bash
node --test tests/sarvamVoice.test.js
for f in services/sarvamVoice.js services/sarvamClient.js services/verificationRouter.js services/voiceAI.js server.js routes/orders.js routes/webhooks.js services/queueEngine.js; do node --check "$f" || exit 1; done
```

## Sarvam setup (required before any live call)

1. In the Sarvam dashboard, create a Voice Agents agent with the
   TrustOrder Hinglish landmark script (see `buildTrustOrderSystemPrompt`
   in `services/sarvamVoice.js`) and rent/attach a phone number.
2. Set in env only (never in code or chat):
   `SARVAM_API_KEY`, `SARVAM_AGENT_ID`, `SARVAM_PHONE_NUMBER_ID`.
3. Confirm the Sarvam Voice Agents outbound-dial endpoint in Sarvam's
   official docs/dashboard and only then set
   `SARVAM_VOICE_AGENT_DISPATCH_URL`. It is intentionally not hardcoded
   in this repo because it was not verified during migration.
4. Test ONLY on your own phone number first, then check the transcript
   and the real Sarvam bill (pulse rates must be re-checked against it).

## BLOCKED — still missing before any live seller traffic

| Item | Why it blocks |
|---|---|
| Sarvam agent + phone number + confirmed outbound endpoint | Voice dispatch returns NOT_CONFIGURED / VOICE_AGENT_OUTBOUND_UNVERIFIED until all are set |
| Supabase project (URL + key) | `db.js` still uses a local JSON file; full migration not done in this branch |
| Shopify test store (domain + Admin token + webhook secret) | Real address rewrite/sync cannot be verified |
| Shiprocket account (email + password/token) | Real courier sync cannot be verified |
| Razorpay activation (key id/secret + webhook secret) | Rs.19 Trust Lock and wallet top-ups return not_configured until approved |
| WhatsApp template approval (token + phone number id + template) | Trust Lock messages cannot be sent |
| Google Maps key | Geocoding returns not_configured, null coordinates/score |
| Old-provider credential in git history | Repo is public: revoke it in that provider's dashboard and clean history or make the repo private AND rotate everything ever committed. Deleting files from this branch alone does not erase history. |

## What this branch does NOT claim

Live calls, payments, or syncs are not claimed to work yet. They need
the accounts/keys above. No live test call to a real customer was made
for this branch.
