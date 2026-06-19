const { verifyToken, COOKIE_NAME } = require('../utils/jwt');
const User = require('../models/User');

// Supports HTTP-only cookie (web/PWA) AND Authorization: Bearer header (native mobile)
module.exports = async function authMiddleware(req, res, next) {
  try {
    let token = req.cookies[COOKIE_NAME];

    if (!token) {
      const header = req.headers.authorization;
      if (header?.startsWith('Bearer ')) token = header.slice(7);
    }

    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const payload = verifyToken(token);

    // Exclude encrypted token blobs from the request user object
    const user = await User.findById(payload.userId).select(
      '-spotifyToken -youtubeMusicToken -wearableToken'
    );

    if (!user || user.deletedAt) {
      return res.status(401).json({ error: 'User not found or deactivated' });
    }

    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};
