const axios  = require('axios');
const OAuth  = require('oauth-1.0a');
const crypto = require('crypto');
const { URLSearchParams } = require('url');

const REQUEST_TOKEN_URL = 'https://connectapi.garmin.com/oauth-service/oauth/request_token';
const ACCESS_TOKEN_URL  = 'https://connectapi.garmin.com/oauth-service/oauth/access_token';
const AUTHORIZE_URL     = 'https://connect.garmin.com/oauthConfirm';
const API_BASE          = 'https://apis.garmin.com/wellness-api/rest';

// Build a fresh OAuth 1.0a signer bound to the consumer credentials
function buildOAuth() {
  return new OAuth({
    consumer: {
      key:    process.env.GARMIN_CONSUMER_KEY,
      secret: process.env.GARMIN_CONSUMER_SECRET,
    },
    signature_method: 'HMAC-SHA1',
    hash_function(baseString, key) {
      return crypto.createHmac('sha1', key).update(baseString).digest('base64');
    },
  });
}

// Produce a signed Authorization header for a given request + optional token
function authHeader(method, url, token = null) {
  const oauth = buildOAuth();
  const requestData = { url, method };
  return oauth.toHeader(oauth.authorize(requestData, token));
}

/**
 * Step 1 — Fetch a short-lived request token from Garmin.
 * Returns { oauthToken, oauthTokenSecret }.
 */
async function getRequestToken() {
  const headers = {
    ...authHeader('POST', REQUEST_TOKEN_URL),
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  const { data } = await axios.post(REQUEST_TOKEN_URL, null, {
    headers,
    timeout: 8000,
  });

  const params = Object.fromEntries(new URLSearchParams(data));

  if (!params.oauth_token || !params.oauth_token_secret) {
    throw new Error('Garmin did not return a valid request token');
  }

  return {
    oauthToken:       params.oauth_token,
    oauthTokenSecret: params.oauth_token_secret,
  };
}

/**
 * Step 2 — Build the Garmin consent URL.
 * The user is redirected here to log in and approve access.
 */
function getAuthUrl(oauthToken) {
  return `${AUTHORIZE_URL}?oauth_token=${encodeURIComponent(oauthToken)}`;
}

/**
 * Step 3 — Exchange the verifier for a permanent access token.
 * @param {string} oauthToken        The request token returned in the callback
 * @param {string} oauthTokenSecret  The secret stored during Step 1
 * @param {string} oauthVerifier     The verifier provided by Garmin in the callback
 * Returns { accessToken, accessTokenSecret }
 */
async function getAccessToken(oauthToken, oauthTokenSecret, oauthVerifier) {
  const token = { key: oauthToken, secret: oauthTokenSecret };
  const url   = `${ACCESS_TOKEN_URL}?oauth_verifier=${encodeURIComponent(oauthVerifier)}`;

  const headers = {
    ...authHeader('POST', url, token),
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  const { data } = await axios.post(url, null, { headers, timeout: 8000 });
  const params   = Object.fromEntries(new URLSearchParams(data));

  if (!params.oauth_token || !params.oauth_token_secret) {
    throw new Error('Garmin did not return a valid access token');
  }

  return {
    accessToken:       params.oauth_token,
    accessTokenSecret: params.oauth_token_secret,
  };
}

/**
 * Fetch the authenticated Garmin user's profile to verify the access token works.
 * Used immediately after Step 3 before persisting anything.
 */
async function getUserProfile(accessToken, accessTokenSecret) {
  const url   = `${API_BASE}/user/id`;
  const token = { key: accessToken, secret: accessTokenSecret };

  const { data } = await axios.get(url, {
    headers: { ...authHeader('GET', url, token) },
    timeout: 8000,
  });

  // data.userId is Garmin's stable user identifier
  return { garminUserId: data.userId };
}

/**
 * Fetch daily heart rate summaries for a given date (YYYY-MM-DD).
 * Used by the Medical Baseline builder in Phase 3.
 */
async function getDailyHeartRate(accessToken, accessTokenSecret, date) {
  const url   = `${API_BASE}/dailies?uploadStartTimeInSeconds=0&uploadEndTimeInSeconds=9999999999`;
  const token = { key: accessToken, secret: accessTokenSecret };

  const { data } = await axios.get(url, {
    headers: { ...authHeader('GET', url, token) },
    timeout: 8000,
  });

  return data;
}

module.exports = { getRequestToken, getAuthUrl, getAccessToken, getUserProfile, getDailyHeartRate };