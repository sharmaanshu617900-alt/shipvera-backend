/**
 * DEPRECATED SHIM — redirects to services/sarvamVoice.js (Sarvam only).
 * All voice verification uses Sarvam Voice Agents with OTP-first routing,
 * 60s hard cap, and Hinglish dialogue script.
 */
module.exports = require('./sarvamVoice');
