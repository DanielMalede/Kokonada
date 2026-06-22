const { verifyToken, COOKIE_NAME } = require('../utils/jwt');
const { isRevoked, revoke } = require('../utils/tokenDenylist');
const User = require('../models/User');

// Supports HTTP-only cookie (web/PWA) AND Authorization: Bearer header (native mobile).
// Top-level OAuth "connect" navigations, which can send neither, authenticate with a
// short-lived single-use ?ct= connect token instead of the long-lived session JWT. (audit F1)
module.exports = async function authMiddleware(req, res, next) {
  try {
    let token = req.cookies[COOKIE_NAME];

    if (!token) {
      const header = req.headers.authorization;
      if (header?.startsWith('Bearer ')) token = header.slice(7);
    }

    let payload;
    let singleUse = false;

    if (token) {
      payload = verifyToken(token);
    } else if (typeof req.query?.ct === 'string') {
      payload = verifyToken(req.query.ct);
      if (payload.purpose !== 'oauth-connect') {
        return res.status(401).json({ error: 'Invalid token purpose' });
      }
      singleUse = true;
    }

    if (!payload) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Reject revoked tokens (logged out, or a connect token already spent). (audit F7)
    if (payload.jti && (await isRevoked(payload.jti))) {
      return res.status(401).json({ error: 'Token revoked' });
    }

    // Exclude encrypted token blobs from the request user object
    const user = await User.findById(payload.userId).select(
      '-spotifyToken -youtubeMusicToken -wearableToken'
    );

    if (!user || user.deletedAt) {
      return res.status(401).json({ error: 'User not found or deactivated' });
    }

    // Burn the single-use connect token so it can't be replayed from logs/history. (audit F1)
    if (singleUse && payload.jti) {
      const ttl = payload.exp ? payload.exp - Math.floor(Date.now() / 1000) : 120;
      await revoke(payload.jti, Math.max(ttl, 1));
    }

    req.user = user;
    req.auth = { jti: payload.jti, exp: payload.exp }; // enables logout revocation
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};
