'use strict';

const mongoose = require('mongoose');
const PlaylistSession = require('../models/PlaylistSession');

// GET /api/sessions — the persistent playlist-history feed (A11). Keyset pagination
// over the existing { userId:1, createdAt:-1 } index. Returns an EXPLICIT whitelist
// DTO: PlaylistSession sets toJSON:{getters:true}, so res.json(doc) would decrypt and
// leak the biometric HR snapshot. We hand-build every field and NEVER touch heartRate.

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function clampLimit(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, n));
}

// The owner-facing shape. contextPrompt is the owner's own words (decrypted by the
// model getter on a real doc) — intended. heartRate / trackKeys / llmCacheKey are not.
function toSessionDTO(doc) {
  return {
    id: String(doc._id),
    createdAt: doc.createdAt,
    moodKey: doc.moodKey ?? null,
    provider: doc.musicProvider,
    activity: (doc.biometricSnapshot && doc.biometricSnapshot.activity) || null,
    contextPrompt: doc.contextPrompt || '',
    isFallback: !!doc.isFallback,
    skipCount: doc.skipCount || 0,
    trackCount: Array.isArray(doc.trackIds) ? doc.trackIds.length : 0,
    tracks: Array.isArray(doc.trackSummary)
      ? doc.trackSummary.map((t) => ({ id: t.id, title: t.title, artist: t.artist }))
      : [],
  };
}

exports.listSessions = async (req, res, next) => {
  try {
    const limit = clampLimit(req.query.limit);

    // Always scoped to the caller — a forged cursor can only narrow within the
    // caller's own rows, never reach another user's history.
    const filter = { userId: req.user._id };

    const { before, beforeId } = req.query;
    const beforeDate = before ? new Date(before) : null;
    const validCursor = beforeDate && !Number.isNaN(beforeDate.getTime())
      && beforeId && mongoose.isValidObjectId(beforeId);
    if (validCursor) {
      // Keyset: strictly older, with _id as the tiebreak on identical timestamps.
      filter.$or = [
        { createdAt: { $lt: beforeDate } },
        { createdAt: beforeDate, _id: { $lt: beforeId } },
      ];
    }

    // Fetch one extra to know whether another page exists. Non-lean so the encrypted
    // contextPrompt getter runs (lean would hand back ciphertext).
    const docs = await PlaylistSession.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1);

    const hasMore = docs.length > limit;
    const page = hasMore ? docs.slice(0, limit) : docs;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last
      ? { before: new Date(last.createdAt).toISOString(), beforeId: String(last._id) }
      : null;

    res.json({ items: page.map(toSessionDTO), nextCursor });
  } catch (err) {
    next(err);
  }
};

exports.toSessionDTO = toSessionDTO; // exported for tests / reuse
