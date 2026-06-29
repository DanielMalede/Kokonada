const axios  = require('axios');
const crypto = require('crypto');
const { URLSearchParams } = require('url');

// Garmin Health API — OAuth 2.0 + PKCE (OAuth 1.0a was deprecated by Garmin).
const AUTHORIZE_URL = 'https://connect.garmin.com/oauth2Confirm';
const TOKEN_URL     = 'https://diauth.garmin.com/di-oauth2-service/oauth/token';
const API_BASE      = 'https://apis.garmin.com/wellness-api/rest';

const clientId     = () => process.env.GARMIN_CONSUMER_KEY    || '';
const clientSecret = () => process.env.GARMIN_CONSUMER_SECRET || '';
const redirectUri  = () => process.env.GARMIN_REDIRECT_URI    || '';

// True only when the connect flow can succeed — lets the controller fail with a
// clear in-app message instead of bouncing the user to Garmin's error page.
function isConfigured() {
  return Boolean(clientId() && clientSecret() && redirectUri());
}

// PKCE code_verifier (43–128 chars) + S256 code_challenge.
function generatePKCE() {
  const codeVerifier  = crypto.randomBytes(32).toString('base64url'); // 43 chars
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

// Build the Garmin consent URL. Garmin Health API uses no OAuth scopes — data
// access is determined by the data types approved for the app.
function getAuthUrl(state, codeChallenge) {
  const params = new URLSearchParams({
    response_type:         'code',
    client_id:             clientId(),
    redirect_uri:          redirectUri(),
    code_challenge:        codeChallenge,
    code_challenge_method: 'S256',
    state,
  });
  return `${AUTHORIZE_URL}?${params}`;
}

async function exchangeCode(code, codeVerifier) {
  const body = new URLSearchParams({
    grant_type:    'authorization_code',
    client_id:     clientId(),
    client_secret: clientSecret(),
    code,
    code_verifier: codeVerifier,
    redirect_uri:  redirectUri(),
  });
  const { data } = await axios.post(TOKEN_URL, body, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 8000,
  });
  return {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token,
    expiresAt:    Date.now() + data.expires_in * 1000,
  };
}

async function refreshAccessToken(refreshToken) {
  const { data } = await axios.post(TOKEN_URL, new URLSearchParams({
    grant_type:    'refresh_token',
    client_id:     clientId(),
    client_secret: clientSecret(),
    refresh_token: refreshToken,
  }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 8000 });
  return {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token || refreshToken, // Garmin rotates refresh tokens
    expiresAt:    Date.now() + data.expires_in * 1000,
  };
}

// Returns a valid (auto-refreshed) Garmin access token for the user, persisting a
// rotated token if a refresh occurred. Used by backfill + any data pull.
async function getValidToken(user) {
  const stored = user.getToken('wearableToken');
  if (!stored) throw Object.assign(new Error('Garmin not connected'), { statusCode: 400 });

  const bufferMs = 5 * 60 * 1000;
  if (Date.now() < stored.expiresAt - bufferMs) return stored.accessToken;

  const refreshed = await refreshAccessToken(stored.refreshToken);
  user.setToken('wearableToken', { ...refreshed, garminUserId: stored.garminUserId });
  await user.save();
  return refreshed.accessToken;
}

// Fetch the Garmin user id to verify the token works + key webhook routing.
async function getUserId(accessToken) {
  const { data } = await axios.get(`${API_BASE}/user/id`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 8000,
  });
  return { garminUserId: data.userId };
}

// ── Health API Backfill (historical) ───────────────────────────────────────────
//
// Backfill triggers Garmin to (asynchronously) PUSH historical summaries to our
// registered webhook — the response itself is just a 202 ack with no data. Garmin
// caps each request's window, so a 6-month backfill is chunked.

const BACKFILL_TYPES = ['dailies', 'sleeps', 'hrv', 'stressDetails', 'respiration', 'pulseox'];
const BACKFILL_CHUNK_SECONDS = 90 * 24 * 60 * 60; // per-request window cap

async function requestBackfill(accessToken, summaryType, startSec, endSec) {
  const url = `${API_BASE}/backfill/${summaryType}?summaryStartTimeInSeconds=${startSec}&summaryEndTimeInSeconds=${endSec}`;
  await axios.get(url, { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 8000 });
}

/**
 * Trigger a ~6-month historical backfill across all summary types. Garmin delivers
 * the data to the webhook over the following minutes. 409 (window already
 * requested) is benign and ignored.
 */
async function requestSixMonthBackfill(accessToken) {
  const now = Math.floor(Date.now() / 1000);
  const start = now - 182 * 24 * 60 * 60;
  for (const type of BACKFILL_TYPES) {
    for (let from = start; from < now; from += BACKFILL_CHUNK_SECONDS) {
      const to = Math.min(from + BACKFILL_CHUNK_SECONDS, now);
      try {
        await requestBackfill(accessToken, type, from, to);
      } catch (e) {
        if (e?.response?.status !== 409) {
          console.error(`[garmin] backfill ${type} ${from}-${to} failed:`, e.message);
        }
      }
    }
  }
}

module.exports = {
  isConfigured, generatePKCE, getAuthUrl,
  exchangeCode, refreshAccessToken, getValidToken, getUserId,
  requestBackfill, requestSixMonthBackfill,
};
