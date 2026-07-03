'use strict';

// Email/password authentication over the Identity collection, argon2id-hashed.
// Both failure modes of login collapse into one generic 'invalid-credentials'
// and the unknown-email path still pays for an argon2 verify, so response text
// and response TIME both refuse to confirm whether an email is registered.

const argon2 = require('argon2');
const Identity = require('../../models/Identity');
const User = require('../../models/User');

// OWASP baseline for argon2id; env-tunable so prod can raise cost without a deploy.
function hashOptions() {
  return {
    type: argon2.argon2id,
    memoryCost: Number(process.env.AUTH_ARGON_MEMORY_KIB) || 19456,
    timeCost: Number(process.env.AUTH_ARGON_TIME) || 2,
    parallelism: 1,
  };
}

const PASSWORD_MIN = 10;
const PASSWORD_MAX = 128; // argon2 on unbounded input is a CPU/memory DoS vector

// Pragmatic shape check; definitive validation is the verification email (later).
// Control chars (incl. NUL) rejected outright; total length per RFC upper bound.
function normalizeEmail(raw) {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (!email || email.length > 254) return null;
  if (/[\0-\x1f\x7f\s]/.test(email)) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function validPassword(password) {
  return typeof password === 'string' && password.length >= PASSWORD_MIN && password.length <= PASSWORD_MAX;
}

// Verified against on unknown-email logins so both paths cost one argon2 call.
let dummyHashPromise = null;
function dummyHash() {
  if (!dummyHashPromise) {
    dummyHashPromise = argon2.hash(require('crypto').randomBytes(24).toString('hex'), hashOptions());
  }
  return dummyHashPromise;
}

async function signup(input) {
  const { email: rawEmail, password } = input || {};
  const email = normalizeEmail(rawEmail);
  if (!email) return { ok: false, reason: 'invalid-email' };
  if (!validPassword(password)) return { ok: false, reason: 'invalid-password' };

  const existing = await Identity.findOne({ provider: 'password', providerUserId: email });
  if (existing) return { ok: false, reason: 'email-taken' };

  const passwordHash = await argon2.hash(password, hashOptions());

  // User first, Identity second; the Identity unique index is the race arbiter.
  // Losing the race rolls the fresh User back so no orphan survives.
  const user = await User.create({ ssoProvider: 'password', ssoId: email, email });
  try {
    await Identity.create({
      userId: user._id,
      provider: 'password',
      providerUserId: email,
      email,
      passwordHash,
    });
  } catch (err) {
    if (err && err.code === 11000) {
      await User.deleteOne({ _id: user._id });
      return { ok: false, reason: 'email-taken' };
    }
    throw err;
  }

  return { ok: true, user };
}

async function login(input) {
  const { email: rawEmail, password } = input || {};
  const email = normalizeEmail(rawEmail);
  const invalid = { ok: false, reason: 'invalid-credentials' };

  if (!email || typeof password !== 'string' || password.length > PASSWORD_MAX) {
    return invalid;
  }

  const identity = await Identity.findOne({ provider: 'password', providerUserId: email });

  if (!identity || !identity.passwordHash) {
    await argon2.verify(await dummyHash(), password).catch(() => false);
    return invalid;
  }

  const match = await argon2.verify(identity.passwordHash, password).catch(() => false);
  if (!match) return invalid;

  const user = await User.findById(identity.userId);
  if (!user || user.deletedAt) return invalid;

  await Identity.updateOne({ _id: identity._id }, { $set: { lastLoginAt: new Date() } });
  return { ok: true, user };
}

module.exports = { signup, login };
