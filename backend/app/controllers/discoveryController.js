'use strict';
const trackCatalogRepo = require('../repositories/trackCatalogRepo');

// POST /api/discovery/playback-failed — a client reports a discovery track that failed to play on the
// Spotify SDK. We null that track's CACHED resolved uri (global/anonymous catalog — no user linkage; the
// repo guards native spotify: keys). Idempotent; a missing/native/uncached key is a safe no-op.
exports.reportPlaybackFailure = async (req, res, next) => {
  try {
    const { recordingKey } = req.body || {};
    if (typeof recordingKey !== 'string' || !recordingKey) {
      return res.status(400).json({ error: 'recordingKey is required' });
    }
    await trackCatalogRepo.invalidateResolvedUri(recordingKey);
    return res.status(204).end();
  } catch (err) { next(err); }
};
