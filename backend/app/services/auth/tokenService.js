'use strict';

// Session issuance: short-lived access JWT + opaque rotating refresh token.
// Rotation follows the OAuth "refresh token rotation" model: every use of a
// refresh token retires it and mints a successor in the same family. Presenting
// a retired token means it leaked (or the response was lost) — either way the
// whole family is revoked and the user re-authenticates.

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const RefreshToken = require('../../models/RefreshToken');

const REFRESH_PREFIX = 'krt_';
const MAX_PRESENTED_LENGTH = 512;

function accessTtl() {
  return process.env.AUTH_ACCESS_TTL || '15m';
}

function refreshTtlMs() {
  const days = Number(process.env.AUTH_REFRESH_TTL_DAYS) || 30;
  return days * 24 * 60 * 60 * 1000;
}

function hashToken(plain) {
  return crypto.createHash('sha256').update(plain).digest('hex');
}

function signAccessToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: accessTtl(),
    jwtid: crypto.randomUUID(),
  });
}

async function mintRefresh(userId, familyId, now) {
  const plain = REFRESH_PREFIX + crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + refreshTtlMs());
  await RefreshToken.create({
    userId,
    tokenHash: hashToken(plain),
    familyId,
    status: 'active',
    expiresAt,
  });
  return { plain, expiresAt };
}

async function issueSession(userId, now = new Date()) {
  const familyId = crypto.randomUUID();
  const { plain, expiresAt } = await mintRefresh(userId, familyId, now);
  return { token: signAccessToken(userId), refreshToken: plain, refreshExpiresAt: expiresAt };
}

async function revokeFamily(familyId) {
  await RefreshToken.updateMany({ familyId }, { $set: { status: 'revoked' } });
}

async function revokeAllForUser(userId) {
  await RefreshToken.updateMany({ userId }, { $set: { status: 'revoked' } });
}

async function rotate(presented, now = new Date()) {
  if (
    typeof presented !== 'string' ||
    !presented.startsWith(REFRESH_PREFIX) ||
    presented.length > MAX_PRESENTED_LENGTH
  ) {
    return { ok: false, reason: 'invalid' };
  }

  const tokenHash = hashToken(presented);

  // Atomic claim first — exactly one concurrent caller can retire an active token.
  const claimed = await RefreshToken.findOneAndUpdate(
    { tokenHash, status: 'active' },
    { $set: { status: 'rotated', rotatedAt: now } },
  );

  if (!claimed) {
    const existing = await RefreshToken.findOne({ tokenHash });
    if (!existing) return { ok: false, reason: 'invalid' };
    // Replay of a spent or revoked token: burn the lineage.
    await revokeFamily(existing.familyId);
    return { ok: false, reason: 'reused' };
  }

  if (claimed.expiresAt && claimed.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: 'expired' };
  }

  const { plain, expiresAt } = await mintRefresh(claimed.userId, claimed.familyId, now);
  return {
    ok: true,
    token: signAccessToken(claimed.userId),
    refreshToken: plain,
    refreshExpiresAt: expiresAt,
  };
}

// Logout path: kill the family a presented (still-valid) refresh token belongs to.
async function revokePresented(presented) {
  if (typeof presented !== 'string' || !presented.startsWith(REFRESH_PREFIX) || presented.length > MAX_PRESENTED_LENGTH) {
    return false;
  }
  const existing = await RefreshToken.findOne({ tokenHash: hashToken(presented) });
  if (!existing) return false;
  await revokeFamily(existing.familyId);
  return true;
}

module.exports = { issueSession, rotate, revokeFamily, revokeAllForUser, revokePresented };
