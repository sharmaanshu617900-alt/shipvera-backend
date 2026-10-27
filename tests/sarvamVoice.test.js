/**
 * Sarvam migration unit tests. No network, no real keys, no live calls.
 * Run: node --test tests/sarvamVoice.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateSarvamCallCost, settleCallCost, buildVoiceAgentDispatchPayload, MAX_CALL_SECONDS, triggerOutboundCall } = require('../services/sarvamVoice');
const { decideVerificationRoute, voiceAllowed } = require('../services/verificationRouter');
const { synthesizeSpeech, transcribeAudio } = require('../services/sarvamClient');

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  return Promise.resolve().then(fn).finally(() => {
    for (const k of Object.keys(vars)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  });
}

test('pulse cost: 60s = 1 agent pulse + 2 telephony pulses', () => {
  assert.deepEqual(calculateSarvamCallCost(60), { billedSeconds: 60, agentPulses: 1, telephonyPulses: 2, costInr: 3.90, capExceeded: false });
});
test('pulse cost: 61s crosses to 2 agent pulses', () => {
  const c = calculateSarvamCallCost(61);
  assert.equal(c.agentPulses, 2);
  assert.equal(c.telephonyPulses, 3);
  assert.equal(c.costInr, 7.60);
});
test('60s cap: 90s is flagged, but settle bills at most 60s', () => {
  const c = calculateSarvamCallCost(90);
  assert.equal(c.capExceeded, true);
  const s = settleCallCost({ durationSeconds: 90, connected: true });
  assert.equal(s.billedSeconds, 60);
  assert.equal(s.costInr, 3.90);
  assert.equal(s.reason, 'billed_capped_at_60s');
});
test('settle: not-connected calls are never charged', () => {
  assert.deepEqual(settleCallCost({ durationSeconds: 45, connected: false }), { charged: false, costInr: 0, reason: 'not_connected_no_charge' });
  assert.equal(settleCallCost({ durationSeconds: 45, connected: true }).charged, true);
});
test('dispatch payload carries the 60s hard cap', () => {
  const p = buildVoiceAgentDispatchPayload({ order: { buyer_name: 'Test', cod_amount: 500, raw_address: 'x' }, seller: { brand_name: 'Shop' }, recipientPhone: '+919999999999' });
  assert.equal(p.max_duration_seconds, MAX_CALL_SECONDS);
  assert.equal(MAX_CALL_SECONDS, 60);
});
test('OTP-first routing: no OTP result => otp, never voice', () => {
  assert.equal(decideVerificationRoute({ cod_amount: 500 }), 'otp');
  assert.equal(voiceAllowed({ cod_amount: 500 }).allowed, false);
});
test('OTP-first routing: otp failed / mismatch / high-value / repeat-RTO => voice', () => {
  assert.equal(decideVerificationRoute({ cod_amount: 500, otp_status: 'failed' }), 'voice');
  assert.equal(decideVerificationRoute({ cod_amount: 500, otp_status: 'mismatch' }), 'voice');
  assert.equal(decideVerificationRoute({ cod_amount: 500, otp_status: 'no_reply' }), 'voice');
  assert.equal(decideVerificationRoute({ cod_amount: 5000 }), 'voice');
  assert.equal(decideVerificationRoute({ cod_amount: 500, flags: { repeat_rto: true } }), 'voice');
  assert.equal(decideVerificationRoute({ cod_amount: 500, otp_status: 'passed' }), 'otp');
});
test('triggerOutboundCall without OTP reason throws OTP_REQUIRED and dials nobody', async () => {
  await assert.rejects(
    () => triggerOutboundCall({ order: { id: 'o1', cod_amount: 500, buyer_phone: '9999999999' }, seller: { id: 's1', wallet_balance_inr: 1000 }, live: true }),
    (e) => e.code === 'OTP_REQUIRED'
  );
});
test('triggerOutboundCall with OTP failure but no Sarvam config throws NOT_CONFIGURED', async () => {
  await withEnv({ SARVAM_API_KEY: undefined, SARVAM_AGENT_ID: undefined, SARVAM_PHONE_NUMBER_ID: undefined, SARVAM_VOICE_AGENT_DISPATCH_URL: undefined }, async () => {
    await assert.rejects(
      () => triggerOutboundCall({ order: { id: 'o1', cod_amount: 500, buyer_phone: '9999999999', otp_status: 'failed' }, seller: { id: 's1', wallet_balance_inr: 1000 }, live: true }),
      (e) => e.code === 'NOT_CONFIGURED'
    );
  });
});
test('Sarvam STT/TTS without a key throw NOT_CONFIGURED without network', async () => {
  await withEnv({ SARVAM_API_KEY: undefined }, async () => {
    await assert.rejects(() => synthesizeSpeech('Namaste'), (e) => e.code === 'NOT_CONFIGURED');
    await assert.rejects(() => transcribeAudio(Buffer.from('x')), (e) => e.code === 'NOT_CONFIGURED');
  });
});
