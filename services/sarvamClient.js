/**
 * Sarvam AI building blocks — Saaras STT + Bulbul TTS.
 *
 * Verified endpoints (Sarvam docs + the project's Sarvam connector test):
 * - POST https://api.sarvam.ai/text-to-speech
 *   body: { inputs: [text], target_language_code, speaker, model }
 *   model default: "bulbul:v3" (verified by connector test, speaker "priya").
 *   Auth: header "api-subscription-key: <SARVAM_API_KEY>".
 * - POST https://api.sarvam.ai/speech-to-text
 *   multipart form: file, model "saaras:v4", language_code, mode "transcribe".
 *   Auth: same header.
 *
 * Rules:
 * - SARVAM_API_KEY comes ONLY from environment variables. No fallback,
 *   no hardcoded key, no key in logs or in returned objects.
 * - If the key is missing, both functions throw NOT_CONFIGURED and
 *   make NO network request. They never return fake audio or a fake
 *   transcript.
 * - This file is NOT a live phone call. A phone call needs a Sarvam
 *   Voice Agents agent + a phone number created in the Sarvam dashboard
 *   (see services/sarvamVoice.js). STT/TTS alone do not dial anyone.
 */

const https = require('https');

const SARVAM_HOST = 'api.sarvam.ai';

function requireApiKey() {
  const key = process.env.SARVAM_API_KEY;
  if (!key) {
    const err = new Error('SARVAM_API_KEY must be set in environment variables. No Sarvam request was made.');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }
  return key;
}

function postJson(path, payload, apiKey) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(payload);
    const req = https.request({
      hostname: SARVAM_HOST,
      path,
      method: 'POST',
      headers: {
        'api-subscription-key': apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (res.statusCode >= 200 && res.statusCode < 300) resolve({ statusCode: res.statusCode, json });
          else resolve({ statusCode: res.statusCode, json, error: json.message || json.detail || body });
        } catch (e) {
          resolve({ statusCode: res.statusCode, json: null, error: body });
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function synthesizeSpeech(text, opts = {}) {
  const apiKey = requireApiKey();
  if (!text || !String(text).trim()) throw new Error('synthesizeSpeech requires non-empty text.');
  const payload = {
    inputs: [String(text)],
    target_language_code: opts.languageCode || process.env.SARVAM_TTS_LANGUAGE || 'hi-IN',
    speaker: opts.speaker || process.env.SARVAM_TTS_SPEAKER || 'priya',
    model: opts.model || process.env.SARVAM_TTS_MODEL || 'bulbul:v3',
  };
  const res = await postJson('/text-to-speech', payload, apiKey);
  if (!res.json || !Array.isArray(res.json.audios) || !res.json.audios[0]) {
    const err = new Error(`Sarvam TTS failed: ${res.error || 'no audio returned'}`);
    err.code = 'SARVAM_TTS_FAILED';
    err.statusCode = res.statusCode;
    throw err;
  }
  return { success: true, audioBase64: res.json.audios[0], model: payload.model, speaker: payload.speaker };
}

async function transcribeAudio(audioBuffer, opts = {}) {
  const apiKey = requireApiKey();
  if (!Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
    throw new Error('transcribeAudio requires a non-empty audio Buffer.');
  }
  const boundary = '----sarvamform' + Date.now().toString(36);
  const filename = opts.filename || 'clip.wav';
  const fields = {
    model: opts.model || process.env.SARVAM_STT_MODEL || 'saaras:v4',
    language_code: opts.languageCode || 'hi-IN',
    mode: opts.mode || 'transcribe',
  };
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: audio/wav\r\n\r\n`
  ));
  parts.push(audioBuffer);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  const body = Buffer.concat(parts);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: SARVAM_HOST,
      path: '/speech-to-text',
      method: 'POST',
      headers: {
        'api-subscription-key': apiKey,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300 && typeof json.transcript === 'string') {
            resolve({ success: true, transcript: json.transcript, model: fields.model });
          } else {
            const err = new Error(`Sarvam STT failed: ${json.message || json.detail || data}`);
            err.code = 'SARVAM_STT_FAILED';
            err.statusCode = res.statusCode;
            reject(err);
          }
        } catch (e) {
          const err = new Error(`Sarvam STT failed: ${data}`);
          err.code = 'SARVAM_STT_FAILED';
          err.statusCode = res.statusCode;
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = { synthesizeSpeech, transcribeAudio, SARVAM_HOST };
