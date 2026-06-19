const axios    = require('axios');
const OAuth    = require('oauth-1.0a');
const crypto   = require('crypto');
const { URLSearchParams } = require('url');

const BASE = 'https://connectapi.garmin.com';
const REQUEST_TOKEN_URL = 'https://connectapi.garmin.com/oauth-service/oauth/request_token';
const ACCESS_TOKEN_URL  = 'https://connectapi.garmin.com/oauth-service/oauth/access_token';
const AUTHORIZE_URL     = 'https://connect.garmin.com/oauthConfirm';

function buildOAuth() {
  return new OAuth({
    consumer: {
      key:    process.env.GARMIN_CONSUMER_KEY,
      secret: process.env.GARMIN_CONSUMER_SECRET,
    },
    signature_method: 'HMAC-SHA1',
    hash_function(base, key) {
      return crypto.createHmac('sha1', key).update(base).digest('base64');
    },
  });
}

// Step 1: Get a request token from Garmin (OAuth 1.0a)
async function getRequestToken() {
  const oauth = buildOAuth();
  const requestData = { url: REQUEST_TOKEN_URL, method: 'POST' };
  const headers = oauth.toHeader(oauth.authorize(requestData));

  const { data } = await axios.post(REQUEST_TOKEN_URL, null, {
    headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 8000,
  });

  const params = Object.fromEntries(new URLSearchParams(data));
  return { oauthToken: params.oauth_token, oauthTokenSecret: params.oauth_token_secret };
}

// Step 2: Build the Garmin authorization URL (redirect user here)
function getAuthUrl(oauthToken) {
  return `${AUTHORIZE_URL}?oauth_token=${oauthToken}`;
}

// Step 3: Exchange verifier for access token
async function getAccessToken(oauthToken, oauthTokenSecret, oauthVerifier) {
  const oauth = buildOAuth();
  const requestData = { url: ACCESS_TOKEN_URL, method: 'POST' };
  const token = { key: oauthToken, secret: oauthTokenSecret };
  const headers = oauth.toHeader(oauth.authorize(requestData, token));

  const { data } = await axios.post(
    `${ACCESS_TOKEN_URL}?oauth_verifier=${oauthVerifier}`,
    null,
    {
      headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 8000,
    }
  );

  const params = Object.fromEntries(new URLSearchParams(data));
  return { accessToken: params.oauth_token, accessTokenSecret: params.oauth_token_secret };
}

// Build an authorized Garmin API request header
function buildAuthHeader(method, url, accessToken, accessTokenSecret) {
  const oauth = buildOAuth();
  const requestData = { url, method };
  const token = { key: accessToken, secret: accessTokenSecret };
  return oauth.toHeader(oauth.authorize(requestData, token));
}

// Fetch recent daily heart rate summaries
async function getDailyHeartRate(accessToken, accessTokenSecret, date) {
  const url = `${BASE}/wellness-service/wellness/dailyHeartRate?date=${date}`;
  const headers = buildAuthHeader('GET', url, accessToken, accessTokenSecret);

  const { data } = await axios.get(url, { headers, timeout: 8000 });
  return data;
}

module.exports = { getRequestToken, getAuthUrl, getAccessToken, getDailyHeartRate };