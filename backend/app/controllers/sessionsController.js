'use strict';

const mongoose = require('mongoose');
const PlaylistSession = require('../models/PlaylistSession');
const { sessionLabel, GENERAL_SESSION_TITLE } = require('../services/sessionLabels');
const { providerContentCutoff } = require('../services/privacy/providerContentErasure');
const { ERASED_LIVE_MARK } = require('../services/privacy/sessionHealthPolicy');

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
//
// HX-2 M4: a session past the provider-content window serves no tracks, even when the daily job
// has not stripped it yet. This only HIDES — the job is what deletes (sessionTrim.worker).
//
// BE-016 (DEC-118 H1; the designer's A3): a heart-rate session whose health data a withdrawal erased is
// stored with the mark `bio:`. It reads "A moment" / Live, and all five fields are FORCED, whatever
// else survived in storage, so a watch activity can never sit beside "A moment". This only DISPLAYS:
// the erasure is the stored strip (services/privacy/sessionHealthErasure.js), never this override.
function toSessionDTO(doc, cutoff = providerContentCutoff()) {
  const erasedLive = doc.moodKey === ERASED_LIVE_MARK;
  const activity = erasedLive ? null : ((doc.biometricSnapshot && doc.biometricSnapshot.activity) || null);
  const created = doc.createdAt ? new Date(doc.createdAt) : null;
  const withinWindow = !!created && created >= cutoff;
  // Friendly title + Manual/Live source so History never shows a raw moodKey (D-3).
  const { title, source, activityLabel } = erasedLive
    ? { title: GENERAL_SESSION_TITLE, source: 'live', activityLabel: null }
    : sessionLabel(doc.moodKey, activity);
  return {
    id: String(doc._id),
    createdAt: doc.createdAt,
    moodKey: erasedLive ? null : (doc.moodKey ?? null),
    title,
    source,
    provider: doc.musicProvider,
    activity,
    activityLabel,
    contextPrompt: doc.contextPrompt || '',
    isFallback: !!doc.isFallback,
    skipCount: doc.skipCount || 0,
    trackCount: withinWindow && Array.isArray(doc.trackIds) ? doc.trackIds.length : 0,
    tracks: withinWindow && Array.isArray(doc.trackSummary)
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

    const cutoff = providerContentCutoff();
    res.json({ items: page.map((doc) => toSessionDTO(doc, cutoff)), nextCursor });
  } catch (err) {
    next(err);
  }
};

exports.toSessionDTO = toSessionDTO; // exported for tests / reuse
