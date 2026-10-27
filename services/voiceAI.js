/**
 * DEPRECATED SHIM — kept only so existing imports keep working.
 * All voice logic now lives in services/sarvamVoice.js (Sarvam only).
 * There is no old-provider code path here. New code should import
 * services/sarvamVoice.js directly.
 */
module.exports = require('./sarvamVoice');
