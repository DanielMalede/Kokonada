const { verifyToken } = require('../utils/jwt');
const { isRevoked, revoke } = require('../utils/tokenDenylist');
const User = require('../models/User');

// Accepts `Authorization: Bearer` ONLY (BE-009). The HTTP-only session cookie used to be
// read here first, and outranked the header when both were present — which meant an ambient
// credential a browser attaches by itself beat the one a client deliberately sent. Nothing
// issues that cookie any more and nothing reads it.
// Top-level OAuth "connect" navigations, which can send neither a header nor a body,
// authenticate with a short-lived single-use ?ct= connect token instead. (audit F1)
module.exports = async function authMiddleware(req, res, next) {
  try {
    let payload;
    let singleUse = false;

    // An explicit ?ct= connect token is AUTHORITATIVE and checked BEFORE the session
    // cookie/Bearer. A top-level OAuth "connect" navigation must authenticate as the
    // token's owner — never as whatever account a stale ambient browser cookie holds.
    // (On mobile the system browser often carries a leftover kokonada_token cookie from
    // prior web use; honoring it would fail on a deleted account, or worse, silently
    // link the WRONG user's Spotify.) (audit F1)
    if (typeof req.query?.ct === 'string') {
      // A connect token is scoped to the OAuth "connect" navigation it was minted
      // for. It must NEVER authenticate an arbitrary protected route — a ct leaked
      // to logs/history/Referer could otherwise drive any authenticated action, so
      // this HARD-FAILS (401) by design on every non-connect route. The match is
      // case-insensitive and tolerates a trailing slash because Express routes
      // /Spotify/Connect and .../connect/ to the same handler. (audit T2.4 / F6)
      const path = (req.path || req.originalUrl || '').split('?')[0];
      if (!/\/(spotify|youtube|garmin)\/connect\/?$/i.test(path)) {
        return res.status(401).json({ error: 'Invalid token scope' });
      }
      payload = verifyToken(req.query.ct);
      if (payload.purpose !== 'oauth-connect') {
        return res.status(401).json({ error: 'Invalid token purpose' });
      }
      singleUse = true;
    } else {
      // BE-009 — BEARER ONLY. This used to read `req.cookies[COOKIE_NAME]` FIRST and fall
      // back to the header, so an ambient cookie the browser attaches by itself outranked
      // the credential the client deliberately sent. That made every state-changing route
      // reachable with nothing but a cookie, which is what a cross-site simple-request
      // write exploits. An explicit header is an act by a real client; a cookie is not.
      // The `?ct=` connect-token path above is untouched — a top-level OAuth navigation
      // can send neither header nor body and genuinely needs it.
      const header = req.headers.authorization;
      const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
      if (token) payload = verifyToken(token);
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
