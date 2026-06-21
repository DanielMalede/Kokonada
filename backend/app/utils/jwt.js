const jwt = require('jsonwebtoken');

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

function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { ...COOKIE_OPTIONS, maxAge: 0 });
}

module.exports = { signToken, verifyToken, setAuthCookie, clearAuthCookie, COOKIE_NAME };