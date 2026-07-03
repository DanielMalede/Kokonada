const { OAuth2Client } = require('google-auth-library');
const appleSignin = require('apple-signin-auth');
const User = require('../models/User');
const Identity = require('../models/Identity');
const { signToken, setAuthCookie, clearAuthCookie } = require('../utils/jwt');
const { revoke } = require('../utils/tokenDenylist');
const passwordAuth = require('../services/auth/passwordAuth');
const tokenService = require('../services/auth/tokenService');
const { resolveEntitlements } = require('../services/entitlements/entitlements');
const { eraseUserChildData } = require('../services/privacy/erasure');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ── Provider token verifiers ──────────────────────────────────────────────────

async function verifyGoogleToken(idToken) {
  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const p = ticket.getPayload();
  return { ssoId: p.sub, email: p.email, displayName: p.name, avatarUrl: p.picture };
}

async function verifyAppleToken(identityToken) {
  const p = await appleSignin.verifyIdToken(identityToken, {
    audience: process.env.APPLE_CLIENT_ID,
    ignoreExpiration: false,
  });
  // Apple only sends name on first sign-in; email may be a relay address
  return { ssoId: p.sub, email: p.email || '', displayName: '', avatarUrl: '' };
}

function publicUser(user) {
  return {
    id: user._id,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    email: user.email,
    wearableProvider: user.wearableProvider,
  };
}

// ── Shared SSO handler ────────────────────────────────────────────────────────

async function handleSso(provider, profile, { deviceToken, platform, client } = {}, res) {
  // Deliberate: accounts are keyed by (provider, ssoId) and are NOT auto-linked by
  // email across providers. Auto-linking on email is an account-takeover footgun
  // here — Apple may return a private relay address, so a matching email is not
  // proof of the same human. The cost is a possible duplicate account per provider;
  // the benefit is no silent cross-provider takeover. (audit F15)
  let user = await User.findOne({ ssoProvider: provider, ssoId: profile.ssoId });

  if (!user) {
    // A provider that doesn't share an email can't create an account here (email is
    // required). Return a clear 422 instead of letting Mongoose throw a 500. (audit F-FB4)
    if (!profile.email) {
      return res.status(422).json({
        error: 'Your account did not share an email address, which is required to sign up.',
      });
    }
    user = await User.create({
      ssoProvider: provider,
      ssoId: profile.ssoId,
      email: profile.email,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
    });
  }

  // Register device push token if provided (mobile native only)
  if (deviceToken && platform) {
    const already = user.pushTokens.some(t => t.token === deviceToken);
    if (!already) {
      user.pushTokens.push({ token: deviceToken, platform });
      await user.save();
    }
  }

  // Keep the provider-agnostic Identity ledger current (auth source of truth
  // going forward; legacy User.ssoProvider/ssoId fields stay mirrored).
  await Identity.updateOne(
    { provider, providerUserId: profile.ssoId },
    { $set: { userId: user._id, email: user.email, lastLoginAt: new Date() } },
    { upsert: true },
  );

  // New clients opt into the short-lived access + rotating refresh session;
  // everything else keeps the legacy 7d cookie token untouched.
  if (client === 'mobile') {
    const session = await tokenService.issueSession(user._id);
    return res.status(200).json({
      token: session.token,
      refreshToken: session.refreshToken,
      user: publicUser(user),
    });
  }

  const jwt = signToken({ userId: user._id });

  // HTTP-only cookie for web/PWA clients
  setAuthCookie(res, jwt);

  // Also return token in body so native mobile can store it in secure storage
  return res.status(200).json({ token: jwt, user: publicUser(user) });
}

// ── Route handlers ────────────────────────────────────────────────────────────

exports.googleAuth = async (req, res, next) => {
  try {
    const { idToken, deviceToken, platform, client } = req.body;
    if (!idToken) return res.status(400).json({ error: 'idToken is required' });
    const profile = await verifyGoogleToken(idToken);
    await handleSso('google', profile, { deviceToken, platform, client }, res);
  } catch (err) { next(err); }
};

exports.appleAuth = async (req, res, next) => {
  try {
    const { identityToken, deviceToken, platform, client } = req.body;
    if (!identityToken) return res.status(400).json({ error: 'identityToken is required' });
    const profile = await verifyAppleToken(identityToken);
    await handleSso('apple', profile, { deviceToken, platform, client }, res);
  } catch (err) { next(err); }
};

// ── Email/password flow (Identity collection, argon2id) ──────────────────────

const SIGNUP_ERRORS = {
  'invalid-email':    [400, 'A valid email address is required'],
  'invalid-password': [400, 'Password must be 10-128 characters'],
  'email-taken':      [409, 'An account with this email already exists'],
};

async function respondWithSession(res, status, user) {
  const session = await tokenService.issueSession(user._id);
  // Cookie carries the access token for web/PWA; native clients use the body.
  setAuthCookie(res, session.token);
  return res.status(status).json({
    token: session.token,
    refreshToken: session.refreshToken,
    user: publicUser(user),
  });
}

exports.signup = async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const result = await passwordAuth.signup({ email, password });
    if (!result.ok) {
      const [status, message] = SIGNUP_ERRORS[result.reason] || [400, 'Invalid signup request'];
      return res.status(status).json({ error: message });
    }
    return respondWithSession(res, 201, result.user);
  } catch (err) { next(err); }
};

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const result = await passwordAuth.login({ email, password });
    if (!result.ok) {
      // One generic body for every failure mode — no account enumeration.
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    return respondWithSession(res, 200, result.user);
  } catch (err) { next(err); }
};

exports.refresh = async (req, res, next) => {
  try {
    const rotated = await tokenService.rotate(req.body?.refreshToken);
    if (!rotated.ok) {
      clearAuthCookie(res);
      return res.status(401).json({ error: 'Invalid refresh token' });
    }
    setAuthCookie(res, rotated.token);
    return res.status(200).json({ token: rotated.token, refreshToken: rotated.refreshToken });
  } catch (err) { next(err); }
};

// GET /api/auth/me  (auth required)
exports.me = async (req, res) => {
  res.json({ ...publicUser(req.user), id: req.user._id, entitlements: resolveEntitlements(req.user) });
};

exports.logout = async (req, res) => {
  // Revoke the presented token server-side so it can't be replayed if it was
  // captured (e.g. from localStorage via XSS) before logout. (audit F7)
  if (req.auth?.jti) {
    const ttl = req.auth.exp ? req.auth.exp - Math.floor(Date.now() / 1000) : 7 * 24 * 3600;
    await revoke(req.auth.jti, Math.max(ttl, 1));

    // The socket handshake checked this jti once, at connect — a live socket
    // would keep serving a logged-out token. Kill exactly that socket (other
    // devices' sockets carry different jtis and stay up). (audit S8-4)
    const io = require('../sockets/index').getIo();
    if (io && req.user?._id) {
      const sockets = await io.in(`user:${req.user._id}`).fetchSockets();
      for (const s of sockets) {
        if (s.data?.jti === req.auth.jti) s.disconnect(true);
      }
    }
  }
  // A presented refresh token takes its whole rotation family down with it.
  if (req.body?.refreshToken) {
    await tokenService.revokePresented(req.body.refreshToken);
  }
  clearAuthCookie(res);
  res.json({ message: 'Logged out successfully' });
};

// DELETE /api/auth/account  (auth required)
// GDPR right-to-erasure: PERMANENTLY hard-deletes the user and every piece of data
// keyed to them. This is a true delete (not the soft-delete `deletedAt` flag) — once
// it completes, nothing about the user remains in the database. All encrypted OAuth
// token blobs (Spotify/YouTube/wearable) live on the User doc, so removing it also
// destroys those. The presented JWT is revoked so it can't be replayed post-deletion.
exports.deleteAccount = async (req, res, next) => {
  try {
    const userId = req.user._id;

    // Purge every user-owned collection + user-scoped Redis state first, then the
    // User doc LAST. If a child delete throws, the account still exists and the
    // request can be safely retried rather than leaving an orphaned, un-loginable
    // User with dangling data. (Cascade shared with scripts/gdpr-delete.js.)
    await eraseUserChildData(userId);
    await User.deleteOne({ _id: userId });

    // Kill any live sockets — the handshake only checks deletedAt once, so an open
    // connection would otherwise keep serving a user who no longer exists. Lazy
    // require: the socket module drags the whole handler chain in. (audit S8-3)
    require('../sockets/index').getIo()?.in(`user:${userId}`).disconnectSockets(true);

    // Revoke the caller's JWT (self-expiring denylist entry) and clear the cookie so
    // the now-deleted account can't keep making authenticated requests.
    if (req.auth?.jti) {
      const ttl = req.auth.exp ? req.auth.exp - Math.floor(Date.now() / 1000) : 7 * 24 * 3600;
      await revoke(req.auth.jti, Math.max(ttl, 1));
    }
    clearAuthCookie(res);
    res.json({ message: 'Account and all associated data permanently deleted' });
  } catch (err) { next(err); }
};
