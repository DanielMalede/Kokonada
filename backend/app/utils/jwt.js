const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const COOKIE_NAME = 'kokonada_token';

// In production the frontend (Vercel) and backend (Railway) live on different
// domains, so the auth cookie is cross-site: it MUST be SameSite=None;Secure to
// be stored on the login fetch and sent on subsequent cross-site requests
// (XHR, the Socket.IO handshake, and the integrations connect navigation).
// Locally everything is same-site over http://localhost, where SameSite=Lax
// without Secure is what actually works.
const isProd = process.env.NODE_ENV === 'production';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? 'none' : 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

// Every token carries a unique jti so it can be individually revoked
// (logout / breach response) via the denylist. (audit F7)
function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    jwtid: crypto.randomUUID(),
  });
}

// Short-lived, single-use, purpose-scoped token for the OAuth "connect" top-level
// navigation, which cannot send an Authorization header. It replaces putting the
// long-lived session JWT in the URL (which leaked into logs/Referer/history). (audit F1)
function signConnectToken(userId) {
  return jwt.sign({ userId, purpose: 'oauth-connect' }, process.env.JWT_SECRET, {
    expiresIn: '120s',
    jwtid: crypto.randomUUID(),
  });
}

// Signed OAuth `state` for the OAuth 2.0 connect flow (Spotify, YouTube). The
// provider echoes this verbatim to the public callback, which arrives as a
// top-level navigation carrying no cookie/Bearer/ct. Binding the userId into a
// signed state lets the callback recover identity WITHOUT any cookie — immune to
// third-party-cookie blocking and mobile WebViews. It is also CSRF-safe: an
// attacker cannot forge a state bound to the victim's userId without JWT_SECRET.
// 10-min TTL matches the OAuth flow window; the unique jti makes it single-use. (audit F1)
function signOauthState(userId, provider, extra = {}) {
  return jwt.sign({ uid: userId, provider, purpose: 'oauth-state', ...extra }, process.env.JWT_SECRET, {
    expiresIn: '10m',
    jwtid: crypto.randomUUID(),
  });
}

// Pin the accepted algorithm to HS256 (the only algorithm we sign with). Without
// this, jsonwebtoken accepts any HMAC-family token the secret can validate, opening
// the door to algorithm-substitution attacks. (audit T2.3)
const VERIFY_OPTS = { algorithms: ['HS256'] };

function verifyOauthState(token) {
  return jwt.verify(token, process.env.JWT_SECRET, VERIFY_OPTS);
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET, VERIFY_OPTS);
}

// BE-009 — `setAuthCookie` is GONE, deliberately, rather than merely left uncalled.
//
// The auth cookie is no longer a credential: nothing issues it and `middleware/auth.js` no
// longer reads it. Leaving a ready-made setter in the shared jwt module is precisely how it
// would come back — one `setAuthCookie(res, token)` in a future handler silently restores an
// ambient credential that outranks nothing and is attached by browsers cross-site. There is
// no setter to reach for now, so restoring it has to be a deliberate, reviewable act.
//
// `clearAuthCookie` REMAINS and is called on every successful auth and on logout/delete, so
// cookies already in the wild expire on their holder's next interaction instead of living
// out the remainder of their 7-day span. It can be removed once that window has passed.
function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { ...COOKIE_OPTIONS, maxAge: 0 });
}

module.exports = {
  signToken, signConnectToken, signOauthState, verifyOauthState,
  verifyToken, clearAuthCookie, COOKIE_NAME,
};