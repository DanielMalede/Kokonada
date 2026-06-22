const axios      = require('axios');
const crypto     = require('crypto');
const BiometricLog = require('../../models/BiometricLog');
const { normalize } = require('./adapter');

const BASE = 'https://cloudapi.suunto.com/v2';

// Verify Suunto webhook HMAC signature to reject forged payloads.
// Fail-closed: an unconfigured secret must never accept payloads in production
// (a missing env var is a misconfiguration, not a reason to trust the world).
// The dev-only skip is gated strictly on a non-production NODE_ENV. (audit F5)
function verifyWebhookSignature(rawBody, signatureHeader) {
  const secret = process.env.SUUNTO_WEBHOOK_SECRET;
  if (!secret) {
    return process.env.NODE_ENV !== 'production'; // dev convenience only
  }

  let expected;
  let provided;
  try {
    expected = Buffer.from(
      crypto.createHmac('sha256', secret).update(rawBody).digest('hex'),
      'hex'
    );
    provided = Buffer.from(signatureHeader || '', 'hex');
  } catch {
    return false; // non-hex signature header
  }

  // timingSafeEqual throws on length mismatch — guard it explicitly. (audit F13)
  if (provided.length !== expected.length) return false;

  return crypto.timingSafeEqual(provided, expected);
}

// Handle an incoming Suunto webhook event
async function handleWebhook(userId, rawBody, signatureHeader) {
  if (!verifyWebhookSignature(rawBody, signatureHeader)) {
    throw Object.assign(new Error('Invalid webhook signature'), { statusCode: 403 });
  }

  const payload = JSON.parse(rawBody);
  const samples = Array.isArray(payload) ? payload : [payload];

  const docs = samples
    .filter(s => s.hr != null)
    .map(raw => ({ userId, ...normalize('suunto', raw) }));

  if (docs.length > 0) {
    await BiometricLog.insertMany(docs, { ordered: false });
  }

  return { ingested: docs.length };
}

// Fetch historical workout data using Suunto API access token
async function getWorkouts(accessToken, limit = 20) {
  const { data } = await axios.get(`${BASE}/workouts`, {
    headers: { 'Ocp-Apim-Subscription-Key': accessToken },
    params:  { limit },
    timeout: 8000,
  });
  return data.payload || [];
}

module.exports = { verifyWebhookSignature, handleWebhook, getWorkouts };