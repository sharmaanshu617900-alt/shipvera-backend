/**
 * OTP-first verification routing (TrustOrder rule).
 *
 * Voice is EXPENSIVE and intrusive, so it is never the first step.
 * Voice is allowed only when one of these is true:
 *   - otp_status === 'failed' | 'no_reply' | 'mismatch'
 *   - order is high-value (flags.high_value === true, or COD >=
 *     HIGH_VALUE_COD_INR, default 2000, overridable via env)
 *   - flags.repeat_rto === true
 *
 * Everything else routes to 'otp'. No OTP system is faked here:
 * if the caller has no OTP result at all, the answer is 'otp' —
 * the caller must run OTP first and only then re-request voice with
 * a real otp_status. triggerOutboundCall enforces this by throwing
 * OTP_REQUIRED when voice is requested without a qualifying reason.
 */

const HIGH_VALUE_DEFAULT = 2000;

function highValueThreshold() {
  const v = Number(process.env.TRUSTORDER_HIGH_VALUE_COD_INR);
  return Number.isFinite(v) && v > 0 ? v : HIGH_VALUE_DEFAULT;
}

function voiceReasons(order = {}, opts = {}) {
  const otpStatus = opts.otpStatus || order.otp_status || null;
  const flags = opts.flags || order.flags || {};
  const cod = Number(opts.codAmount ?? order.cod_amount ?? 0);
  const reasons = [];
  if (['failed', 'no_reply', 'mismatch'].includes(otpStatus)) reasons.push(`otp_${otpStatus}`);
  if (flags.high_value === true || (Number.isFinite(cod) && cod >= highValueThreshold())) reasons.push('high_value');
  if (flags.repeat_rto === true) reasons.push('repeat_rto');
  return reasons;
}

function decideVerificationRoute(order = {}, opts = {}) {
  return voiceReasons(order, opts).length > 0 ? 'voice' : 'otp';
}

function voiceAllowed(order = {}, opts = {}) {
  const reasons = voiceReasons(order, opts);
  return { allowed: reasons.length > 0, reasons };
}

module.exports = { decideVerificationRoute, voiceAllowed, voiceReasons, highValueThreshold };
