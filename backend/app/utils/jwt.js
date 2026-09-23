const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// The name of the RETIRED auth cookie (BE-009). Nothing issues, reads or clears it any more;
// it is exported only so the regression guards can present one and prove it is ignored.
const COOKIE_NAME = 'kokonada_token';

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
// `clearAuthCookie` went too, once its job was done: it expired cookies already in the wild,
// and the last of those (7-day life, cookie plane retired 2026-08-28) lapsed by 2026-09-04.

module.exports = {
  signToken, signConnectToken, signOauthState, verifyOauthState,
  verifyToken, COOKIE_NAME,
};