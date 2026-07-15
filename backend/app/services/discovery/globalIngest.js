// backend/app/services/discovery/globalIngest.js
'use strict';

// Global Seed Ingestion orchestrator (Wave 1). Turns a batch of CC0 AcousticBrainz records into
// PROVIDER-AGNOSTIC corpus rows: canonical MBID identity, measured/derived audio features, LLM-inferred
// genres — and NO platform id (no Spotify URI / YouTube video id). Playback resolution is a separate
// runtime concern (Discovery Engine ⊥ Runtime Resolver). Enhancement-contract: NEVER throws into the
// worker. Returns { ok, ingested, embedded }: ok=false ONLY on a caught failure so the worker can HOLD
// the cursor and retry the batch (an empty/unmappable batch is ok=true — a clean, advanceable run).

const { mapRecord } = require('../features/acousticBrainzFeatures');
const audioFeatureRepo = require('../../repositories/audioFeatureRepo');
const corpusIngest = require('./corpusIngest');
const trackIdentity = require('../identity/trackIdentity');
const geminiEngine = require('../geminiEngine');

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : undefined);
const CAP = () => (num(process.env.GLOBAL_SEED_TRACK_CAP) > 0 ? Math.floor(num(process.env.GLOBAL_SEED_TRACK_CAP)) : 500);
// AcousticBrainz confidence: bpm/danceability measured, but energy/valence/acousticness are mood-model
// derivations — measured-but-approximate, so ranked above LLM (≤0.7) and below ReccoBeats 'api' (1.0).
const CONFIDENCE = () => { const n = num(process.env.GLOBAL_AB_CONFIDENCE); return n && n > 0 && n <= 1 ? n : 0.85; };

// CC0-safe genre inference (never MusicBrainz — its genres are CC BY-NC-SA). Contract: names[] → { name: genres[] }.
// geminiEngine.inferArtistGenres already takes an ARRAY and returns the map (one batched LLM call).
async function _inferGenresDefault(names) {
  try {
    if (typeof geminiEngine.inferArtistGenres === 'function') {
      const map = await geminiEngine.inferArtistGenres(names);
      return map && typeof map === 'object' ? map : {};
    }
  } catch { /* genres are an enhancement — never break ingest on inference failure */ }
  return {};
}

async function runOnce({ records = [], inferGenres, cap, confidence, deps = {} } = {}) {
  const _map = deps.mapRecord || mapRecord;
  const _af = deps.audioFeatureRepo || audioFeatureRepo;
  const _ingestGlobal = deps.ingestGlobal || corpusIngest.ingestGlobal;
  const _canon = deps.canonicalKeyOf
    || ((t) => { try { return trackIdentity.canonicalKey({ artist: t.artist, title: t.title, isrc: t.isrc }); } catch { return null; } });
  const _genres = inferGenres || _inferGenresDefault;
  const _cap = Number.isFinite(cap) ? cap : CAP();
  const _conf = Number.isFinite(confidence) ? confidence : CONFIDENCE();

  try {
    // 1. map → require SERVABLE (mbid recordingKey + title + artist) → dedupe → cap. A row lacking
    //    title/artist can never be resolved to a provider at play time, so skip it (no wasted embed).
    const seen = new Set();
    const tracks = [];
    for (const rec of records || []) {
      let t = null;
      try { t = _map(rec); } catch { t = null; }
      if (!t || !t.recordingKey || seen.has(t.recordingKey)) continue;
      if (!t.title || !t.artist) continue;
      t.canonicalKey = _canon(t) ?? null;
      seen.add(t.recordingKey);
      tracks.push(t);
      if (tracks.length >= _cap) break;
    }
    if (!tracks.length) return { ok: true, ingested: 0, embedded: 0 };

    // 2. genres in ONE batched LLM call for all unique artists (CC0-safe path, never MusicBrainz)
    const artists = [...new Set(tracks.map(t => (t.artist || '').trim()).filter(Boolean))];
    let genreMap = {};
    try { genreMap = (await _genres(artists)) || {}; } catch { genreMap = {}; }
    const genresOf = (t) => { const g = genreMap[(t.artist || '').trim()]; return Array.isArray(g) ? g : []; };

    // 3. acousticbrainz feature docs (keyed by MBID)
    await _af.upsertMany(tracks.map(t => ({
      recordingKey: t.recordingKey,
      canonicalKey: t.canonicalKey,
      ...t.features,
      source: 'acousticbrainz',
      confidence: _conf,
    })));

    // 4. provider-agnostic catalog entries (uri:null, source:'global') → catalog + embed
    const res = await _ingestGlobal(tracks.map(t => ({
      recordingKey: t.recordingKey,
      canonicalKey: t.canonicalKey,
      uri: null,
      title: t.title,
      artist: t.artist,
      genres: genresOf(t),
      source: 'global',
    })));

    return { ok: true, ingested: tracks.length, embedded: res?.enqueued ?? 0 };
  } catch (e) {
    try { console.warn(`[globalIngest] run skipped: ${e.message}`); } catch { /* never affect delivery */ }
    return { ok: false, ingested: 0, embedded: 0 };
  }
}

module.exports = { runOnce };
