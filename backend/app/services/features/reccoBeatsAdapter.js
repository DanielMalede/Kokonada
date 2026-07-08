'use strict';

const axios = require('axios');
const { withRetry } = require('../../utils/retry');
const { clampFeatures, recordingKeyOf, spotifyIdOf } = require('./featureProvider');

// Measured audio features by Spotify track id (ReccoBeats-style API).
// Batch results are matched back by the Spotify id embedded in each item's
// href (falling back to spotifyId/id fields) — never by array position.

// Clamped ≥1: a zero/garbage env value would zero the loop increment and
// spin the process into heap exhaustion (shadow-audit OOM finding).
const BATCH_SIZE = () => {
  const n = parseInt(process.env.RECCOBEATS_BATCH ?? '', 10);
  return Number.isFinite(n) && n >= 1 ? n : 40;
};
const BASE_URL   = () => process.env.RECCOBEATS_URL || 'https://api.reccobeats.com';
const TIMEOUT_MS = () => parseInt(process.env.RECCOBEATS_TIMEOUT_MS || '8000', 10);

function supports(track) {
  return Boolean(spotifyIdOf(track));
}

function _idFromItem(item) {
  const href = String(item?.href ?? '');
  const m = href.match(/track\/([A-Za-z0-9]+)/);
  return m?.[1] ?? item?.spotifyId ?? item?.id ?? null;
}

async function _fetchBatch(ids) {
  const headers = {};
  if (process.env.RECCOBEATS_API_KEY) headers.Authorization = `Bearer ${process.env.RECCOBEATS_API_KEY}`;
  const { data } = await withRetry(
    () => axios.get(`${BASE_URL()}/v1/audio-features`, {
      params: { ids: ids.join(',') },
      headers,
      timeout: TIMEOUT_MS(),
    }),
    2
  );
  const items = data?.content ?? (Array.isArray(data) ? data : []);
  const bySpotifyId = new Map();
  for (const item of items) {
    const id = _idFromItem(item);
    if (!id) continue;
    bySpotifyId.set(id, clampFeatures({
      bpm:          item.tempo,
      energy:       item.energy,
      valence:      item.valence,
      acousticness: item.acousticness,
      danceability: item.danceability,
      loudness:     item.loudness,
    }));
  }
  return bySpotifyId;
}

async function getFeatures(tracks = []) {
  const supported = tracks.filter(supports);
  const results = [];

  for (let i = 0; i < supported.length; i += BATCH_SIZE()) {
    const batch = supported.slice(i, i + BATCH_SIZE());
    let bySpotifyId = new Map();
    let errored = false;
    try {
      bySpotifyId = await _fetchBatch(batch.map(spotifyIdOf));
    } catch (e) {
      console.error('[reccoBeats] batch failed:', e.response?.status ?? e.message);
      errored = true; // transient failure — NOT a catalog gap; the LLM fallback must not estimate it
    }
    for (const track of batch) {
      const features = bySpotifyId.get(spotifyIdOf(track)) ?? null;
      results.push({
        track,
        recordingKey: recordingKeyOf(track),
        features,
        source: 'api',
        confidence: features ? 1 : null,
        // hit = measured; miss = 200 but absent (permanent catalog gap → LLM-estimable);
        // error = the batch threw (transient → retried next hydration, never estimated).
        apiStatus: features ? 'hit' : (errored ? 'error' : 'miss'),
      });
    }
  }
  return results;
}

module.exports = { supports, getFeatures };
