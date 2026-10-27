# RTO Shield / Shipvera — Reality Checklist

This branch removes mock, fake, and sandbox-success behaviour from the
backend. It does NOT by itself make live calls, payments, or syncs work:
those need real accounts and keys, which are never committed to this repo.

## CRITICAL SECURITY WARNING — READ FIRST

- A hardcoded Bolna credential fallback was found in
  `services/voiceAI.js` on main. This branch removes that fallback so
  credentials come only from environment variables.
- Removing code does NOT erase the old credential from git history.
  The repository is public, so that credential must be treated as exposed.
  Before deploying this branch, the owner must:
  1. Revoke/rotate that Bolna credential in the Bolna dashboard.
  2. Clean the credential from git history (history rewrite) or make
     the repository private AND rotate every credential that was ever
     committed, including anything in a committed `.env` file.
  3. Store the new credential only in a secure environment / secret
     manager, never in chat, code, or a committed file.
- Do not deploy this branch with the old credential still active.

## What changed in this branch (summary)

- `db.js`: Local JSON store no longer seeds a demo seller, demo orders,
  or demo call logs. A fresh install starts empty. `getSeller()` no
  longer returns the first seller as a fallback. Order/call-log/job
  creation requires a seller id. Fixed geo scores and fixed money-saved
  defaults were removed.
- `services/voiceAI.js`: Bolna credentials are env-only. The automated
  path is live by default. Simulation is only available when
  `SHIPVERA_ALLOW_SIMULATED_CALLS=true` is set explicitly, and a
  simulated result never invents a transcript, recording URL, landmark,
  or buyer intent, and is never recorded as a real call.
- `services/queueEngine.js`: The worker now dispatches live calls
  (previously hardcoded live:false). Call failures and Trust Lock
  failures mark the job as failed instead of completed.
- `routes/webhooks.js`: Shopify and Razorpay HMAC/signature checks now
  fail closed (401 when missing/mismatched, 500 when the server secret
  is not configured). Unknown sellers return 404. Missing phone,
  name, address, pincode, or COD amount returns 400. Duration alone
  never implies a verified buyer.
- `services/trustLock.js`: Trust Lock payment links are created only
  via the real Razorpay Payment Links API. Without Razorpay keys, or
  on API failure, it returns success:false and does not mark the order
  as sent. No fake payment link or fake voice-note URL is generated.
  WhatsApp dispatch is awaited; a failed/not-configured WhatsApp send
  does not mark the order as sent.
- `services/whatsappService.js`, `services/shopifyClient.js`,
  `services/shiprocketClient.js`, `services/emailService.js`: Every
  sandbox/demo path that previously returned success:true now returns
  success:false with mode `not_configured` and a clear reason.
  Shopify HMAC verification in `shopifyClient.js` also now fails
  closed instead of returning true when secret/header are missing.
- `services/geoSanitizer.js`: Without a Google Maps key, geocoding
  returns success:false, mode `not_configured`, null coordinates and
  null score — never success:true with a pincode centroid and a fixed
  score. API errors also return null coordinates/score.
- `services/addressRewriter.js`: The extractor is explicitly
  rule-based, not the PRD LLM extraction. No hardcoded landmark, house,
  city, or pincode defaults remain. If nothing concrete was extracted,
  it returns needs_review with low confidence and null cleaned lines.
  Confidence is computed from extracted evidence and capped at 85 for
  the rule-based path, never fixed at 96. Fixed money-saved amounts
  were removed. Shopify/Shiprocket sync failures are now returned in
  the result (`shopifySync` / `shiprocketSync`, `sync_failed`) instead
  of only being logged.
- `routes/orders.js`, `routes/auth.js`, `services/quickPaste.js`,
  `server.js`: Quick-paste and manual call triggers no longer apply
  outcomes from simulated calls or invented spoken text. The demo
  seller injection in auth was removed. Quick-paste missing phone,
  address, pincode, or amount returns 400. The waitlist lead is now
  actually stored. `/api/health` now reports per-provider configuration
  status instead of claiming every feature is active.
- `.env.example`: Lists every required env var with empty placeholder
  values only. No real values are in this file.

## Per-feature status after this branch

| Feature | Now real in code? | Still needs a live account / key | Cannot be tested without |
|---|---|---|---|
| Seller / order storage | Code is real (no seed), but storage is still a local JSON file, not Supabase tables | A Supabase project + tables matching the PRD schema, then a db.js migration | Supabase project and credentials |
| Shopify webhook + address sync | Webhook verification and sync code are real and fail closed | A Shopify test store, Admin API token with read/write orders, webhook secret | Test store + token + webhook secret |
| Shiprocket sync | Sync code is real and fail closed | A Shiprocket account/token | Shiprocket token |
| Bolna voice call | Dispatch code is real and live by default | A Bolna account, agent, phone number, and a rotated (new) API key via env | Bolna account + rotated key + agent ID |
| Post-call address extraction | Rule-based extraction only; PRD LLM extraction is NOT wired | An LLM provider key/model (see LLM_API_KEY / LLM_MODEL) and a prompt + JSON schema implementation | LLM key; otherwise results stay low-confidence / needs-review |
| WhatsApp Trust Lock message | Meta Cloud API code is real and fail closed | A WhatsApp Business account, phone number ID, approved template, access token | WABA + token + template approval |
| Razorpay 19 Trust Lock link + wallet top-up | Payment Links API code is real and fail closed | A Razorpay account that is ACTIVATED/APPROVED, plus key ID/secret and webhook secret | Razorpay activation — the user reports this keeps getting rejected; see below |
| Google Maps deliverability | Geocoding code is real when a key is present | A Google Maps API key with Geocoding enabled | Google Maps key |
| Money saved / ROI dashboard | No longer invented | A verified courier cost per cancelled/verified order, recorded from real outcomes | Real courier cost data |
| Email digest | Resend code is real when a key is present | A Resend API key | Resend key |

## Razorpay approval — blocker, not fixed by code

This branch cannot approve a Razorpay account. Razorpay approval needs
the merchant's own KYC, business documents, bank verification, and, for
live mode, a live website/app review. If approval keeps getting
rejected, the rejection email/dashboard reason must be fixed first
(name mismatch, blurry/incomplete documents, CKYC/Video KYC failure,
wrong business category, etc.), then resubmitted. Until Razorpay is
activated, Trust Lock links and wallet top-ups will correctly return
not_configured / failed instead of fake success.

## How to test this branch safely

1. Deploy to a test environment only, with fresh env vars (no old keys).
2. Start with an empty database and confirm the dashboard shows zero
   orders, zero sellers, and zero money saved.
3. Create a real seller, then send a Shopify webhook with a missing
   secret and confirm it returns 401, and with an unknown seller and
   confirm it returns 404.
4. Trigger a call without Bolna keys and confirm it fails with
   NOT_CONFIGURED and creates no call log transcript.
5. Trigger a Trust Lock without Razorpay/WhatsApp keys and confirm it
   returns success:false and does not mark the order as sent.
6. Only after the Bolna key is rotated and the new key is in env,
   place one test call to your own number and verify the webhook
   outcome before enabling any real seller traffic.

## Files NOT changed in this branch

- Frontend dashboard/landing pages (`dashboard.*`, `index.html`) were
  not audited or changed here; they may still display demo copy or
  assume demo data. Do not present dashboard copy as proof of live
  activity until those pages are audited separately.
- `data/shipvera_database.json` (if present in a deployment) still
  contains old seed data on disk. Delete/replace that deployment data
  file after migrating to Supabase; code changes alone do not clean
  an already-written local database file.
- Any committed `.env` file and git history: see the security warning
  above. This PR does not rewrite history.
