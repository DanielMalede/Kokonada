// backend/app/services/discovery/globalIngest.js
'use strict';

// Global Seed Ingestion orchestrator (Wave 1). Turns a batch of CC0 AcousticBrainz records into
// PROVIDER-AGNOSTIC corpus rows: canonical MBID identity, measured/derived audio features, LLM-inferred
// genres — and NO platform id (no Spotify URI / YouTube video id). Playback resolution is a separate
// runtime concern (Discovery Engine ⊥ Runtime Resolver). Enhancement-contract: NEVER throws into the
// worker; a failure at any step yields an empty result and leaves delivery untouched.

const { mapRecord } = require('../features/acousticBrainzFeatures');
const audioFeatureRepo = require('../../repositories/audioFeatureRepo');
const corpusIngest = require('./corpusIngest');
const trackIdentity = require('../identity/trackIdentity');

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : undefined);
const CAP = () => num(process.env.GLOBAL_SEED_TRACK_CAP) && num(process.env.GLOBAL_SEED_TRACK_CAP) > 0
  ? Math.floor(num(process.env.GLOBAL_SEED_TRACK_CAP)) : 500;
// AcousticBrainz confidence: bpm/danceability measured, but energy/valence/acousticness are mood-model
// derivations — measured-but-approximate, so ranked above LLM (≤0.7) and below ReccoBeats 'api' (1.0).
const CONFIDENCE = () => { const n = num(process.env.GLOBAL_AB_CONFIDENCE); return n && n > 0 && n <= 1 ? n : 0.85; };

async function _inferGenresDefault(artist) {
  try {
    const svc = require('../musicProfileService');
    if (typeof svc.inferArtistGenres === 'function') {
      const g = await svc.inferArtistGenres(artist);
      return Array.isArray(g) ? g : [];
    }
  } catch { /* genres are an enhancement — never break ingest on inference failure */ }
  return [];
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
    // 1. map → dedupe by canonical recordingKey → cap
    const seen = new Set();
    const tracks = [];
    for (const rec of records || []) {
      let t = null;
      try { t = _map(rec); } catch { t = null; }
      if (!t || !t.recordingKey || seen.has(t.recordingKey)) continue;
      t.canonicalKey = _canon(t) ?? null;
      seen.add(t.recordingKey);
      tracks.push(t);
      if (tracks.length >= _cap) break;
    }
    if (!tracks.length) return { ingested: 0, embedded: 0 };

    // 2. genres once per unique artist (CC0-safe LLM path, never MusicBrainz) — batch-cached
    const genreByArtist = new Map();
    for (const t of tracks) {
      const a = (t.artist || '').trim();
      if (!a || genreByArtist.has(a)) continue;
      let g = [];
      try { g = await _genres(a); } catch { g = []; }
      genreByArtist.set(a, Array.isArray(g) ? g : []);
    }
    const genresOf = (t) => genreByArtist.get((t.artist || '').trim()) || [];

    // 3. AcousticBrainz feature docs (measured/derived, keyed by MBID)
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

    return { ingested: tracks.length, embedded: res?.enqueued ?? 0 };
  } catch (e) {
    try { console.warn(`[globalIngest] run skipped: ${e.message}`); } catch { /* metric must never affect delivery */ }
    return { ingested: 0, embedded: 0 };
  }
}

module.exports = { runOnce };
