'use strict';

// Session issuance: short-lived access JWT + opaque rotating refresh token.
// Rotation follows the OAuth "refresh token rotation" model: every answered use
// of a refresh token retires it and mints a successor in the same family; a use
// the server fails to answer retires nothing. Presenting a retired token means
// it leaked (or the response was lost) — either way the whole family is revoked
// and the user re-authenticates.

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

  // A token is spent only once its rotation answers (RA-8). If signing or storing the successor
  // throws, the route answers 500 and the client presents this same token again; a claim left
  // standing would read that retry as a replay and burn the family. Signing goes first, so its
  // failure stores no successor.
  try {
    const token = signAccessToken(claimed.userId);
    const { plain, expiresAt } = await mintRefresh(claimed.userId, claimed.familyId, now);
    return { ok: true, token, refreshToken: plain, refreshExpiresAt: expiresAt };
  } catch (err) {
    await restoreClaim(tokenHash, now);
    throw err;
  }
}

// Undoes this request's own claim: the filter is exactly what the claim wrote, so a token the
// family's revocation reached meanwhile (a concurrent replay) is 'revoked' and stays revoked.
// Never throws over the caller's error. Its only report is one closed-token line: the error's
// class, never its text (a driver message can quote the filter, the token's hash among it).
async function restoreClaim(tokenHash, rotatedAt) {
  try {
    await RefreshToken.findOneAndUpdate(
      { tokenHash, status: 'rotated', rotatedAt },
      { $set: { status: 'active', rotatedAt: null } },
    );
  } catch (err) {
    console.error(`[tokenService] rotate claim-restore outcome=failed error=${errorType(err)}`);
  }
}

// An error's class name, or 'Error' — never its message.
function errorType(err) {
  const name = err?.name;
  return typeof name === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(name) ? name : 'Error';
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
