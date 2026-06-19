const { OAuth2Client } = require('google-auth-library');
const appleSignin = require('apple-signin-auth');
const axios = require('axios');
const User = require('../models/User');
const { signToken, setAuthCookie, clearAuthCookie } = require('../utils/jwt');

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

async function verifyFacebookToken(accessToken) {
  const { data } = await axios.get('https://graph.facebook.com/me', {
    params: { fields: 'id,name,email,picture.type(large)', access_token: accessToken },
    timeout: 5000,
  });
  return {
    ssoId: data.id,
    email: data.email || '',
    displayName: data.name || '',
    avatarUrl: data.picture?.data?.url || '',
  };
}

// ── Shared SSO handler ────────────────────────────────────────────────────────

async function handleSso(provider, profile, deviceToken, platform, res) {
  let user = await User.findOne({ ssoProvider: provider, ssoId: profile.ssoId });

  if (!user) {
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

  const jwt = signToken({ userId: user._id });

  // HTTP-only cookie for web/PWA clients
  setAuthCookie(res, jwt);

  // Also return token in body so native mobile can store it in secure storage
  return res.status(200).json({
    token: jwt,
    user: {
      id: user._id,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      email: user.email,
      wearableProvider: user.wearableProvider,
    },
  });
}

// ── Route handlers ────────────────────────────────────────────────────────────

exports.googleAuth = async (req, res, next) => {
  try {
    const { idToken, deviceToken, platform } = req.body;
    if (!idToken) return res.status(400).json({ error: 'idToken is required' });
    const profile = await verifyGoogleToken(idToken);
    await handleSso('google', profile, deviceToken, platform, res);
  } catch (err) { next(err); }
};

exports.appleAuth = async (req, res, next) => {
  try {
    const { identityToken, deviceToken, platform } = req.body;
    if (!identityToken) return res.status(400).json({ error: 'identityToken is required' });
    const profile = await verifyAppleToken(identityToken);
    await handleSso('apple', profile, deviceToken, platform, res);
  } catch (err) { next(err); }
};

exports.facebookAuth = async (req, res, next) => {
  try {
    const { accessToken, deviceToken, platform } = req.body;
    if (!accessToken) return res.status(400).json({ error: 'accessToken is required' });
    const profile = await verifyFacebookToken(accessToken);
    await handleSso('facebook', profile, deviceToken, platform, res);
  } catch (err) { next(err); }
};

exports.logout = (req, res) => {
  clearAuthCookie(res);
  res.json({ message: 'Logged out successfully' });
};
