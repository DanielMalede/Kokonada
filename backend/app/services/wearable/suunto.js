const axios      = require('axios');
const crypto     = require('crypto');
const BiometricLog = require('../../models/BiometricLog');
const { normalize } = require('./adapter');

const BASE = 'https://cloudapi.suunto.com/v2';

// Verify Suunto webhook HMAC signature to reject forged payloads
function verifyWebhookSignature(rawBody, signatureHeader) {
  const secret = process.env.SUUNTO_WEBHOOK_SECRET;
  if (!secret) return true; // skip in dev if not configured

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signatureHeader || '', 'hex'),
    Buffer.from(expected, 'hex')
  );
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