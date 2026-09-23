'use strict';

const featureRepo = require('../repositories/audioFeatureRepo');
const vectorIndex = require('../services/vector/vectorIndex');
const { buildVector, buildVectorV2, MODEL_V2 } = require('../services/vector/embedding');
const embeddingSpace = require('../services/vector/embeddingSpace');
const llmClient = require('../services/llmClient');
const { isSpotifyKey } = require('../utils/spotifyContent');
const { isYoutubeKey } = require('../utils/youtubeContent');

// Enrichment worker (embedding-build queue): builds deterministic v1 vectors
// from stored features and, when an LLM is configured, adds sanitized vibe
// tags. Everything here is an ENHANCEMENT — serving never waits on it, and a
// job never re-enqueues itself (no retry loops by construction).

const MAX_TAGS = 5;
const MAX_TAG_LEN = 24;
const TAG_TIMEOUT_MS = () => parseInt(process.env.VIBE_ENRICH_TIMEOUT_MS || '8000', 10);

function _sanitizeTags(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter(t => typeof t === 'string' && t.trim())
    .map(t => t.trim().toLowerCase().slice(0, MAX_TAG_LEN))
    .slice(0, MAX_TAGS);
}

async function _enrichTags(keys, features) {
  const entries = keys.map(k => ({ key: k, doc: features.get(k) })).filter(e => e.doc);
  if (!entries.length) return 0;

  const list = entries
    .map((e, i) => `${i}. bpm=${e.doc.bpm ?? '?'} energy=${e.doc.energy ?? '?'} valence=${e.doc.valence ?? '?'} acousticness=${e.doc.acousticness ?? '?'}`)
    .join('\n');
  const prompt = `For each numbered track profile below, give up to ${MAX_TAGS} short lowercase vibe tags (single words or two-word phrases like "late night").

${list}

Respond ONLY with: {"tags":[{"i":0,"vibeTags":["warm","driving"]}]}`;

  let parsed;
  try {
    const raw = await llmClient.generateJson(prompt, { timeoutMs: TAG_TIMEOUT_MS(), temperature: 0.3 });
    parsed = JSON.parse(String(raw).replace(/```(?:json)?/gi, '').trim());
  } catch {
    return 0; // enrichment is optional — any failure skips tagging entirely
  }

  let tagged = 0;
  for (const entry of parsed?.tags ?? []) {
    const i = Number(entry?.i);
    if (!Number.isInteger(i) || i < 0 || i >= entries.length) continue;
    const tags = _sanitizeTags(entry.vibeTags);
    if (!tags.length) continue;
    try {
      await featureRepo.setVibeTags(entries[i].key, tags);
      tagged++;
    } catch { /* best-effort per key */ }
  }
  return tagged;
}

// v2 side-inputs (W4-014), resolved ONCE per job and only when the dual-write flag is on.
//
// Both are fail-soft, and they degrade to DIFFERENT-but-correct vectors rather than to no vector:
// no IDF table → every genre weight is 0 → the genre block is exactly zero → an audio-only v2
// vector, which is a correct point in the space; no catalog → no genres, same outcome. The job
// must never die because an ENHANCEMENT's side-input was unreachable.
//
// Lazily required so the dark path (flag off) does not even load the catalog repo or register
// its mongoose model — `idfStats` uses the same lazy-require posture for the same reason.
async function _v2Inputs(keys) {
  let idf = null;
  let genresByKey = new Map();
  try {
    idf = await require('../services/vector/idfStats').peek();
  } catch (e) {
    console.warn(`[embedding] v2 genre IDF unavailable — audio-only v2 vectors this batch: ${e?.message ?? e}`);
  }
  try {
    genresByKey = await require('../repositories/trackCatalogRepo').getMany(keys);
  } catch (e) {
    console.warn(`[embedding] v2 genre lookup failed — audio-only v2 vectors this batch: ${e?.message ?? e}`);
  }
  return { idf, genresByKey };
}

// Named processJob: a function literally named `process` shadows the Node
// global inside its own body, turning process.env into undefined.
async function processJob(job) {
  const recordingKeys = job?.data?.recordingKeys ?? [];
  if (!recordingKeys.length) return { embedded: 0, tagged: 0 };

  const features = await featureRepo.getMany(recordingKeys);
  const docs = [];
  for (const key of recordingKeys) {
    // Third-party-ToS containment (belt-and-suspenders): never build/store a Spotify- OR
    // YouTube-keyed vector even if a spotify:/youtube: key slips past the upstream hydration
    // gate — the embedding index is a persistent, cross-user cache of derived third-party
    // Content otherwise (Spotify Developer Terms + YouTube API Services Terms). Only mbid:
    // (CC0) vectors reach the index.
    if (isSpotifyKey(key) || isYoutubeKey(key)) continue;
    const doc = features.get(key);
    if (!doc) continue;
    docs.push({
      recordingKey: key,
      canonicalKey: doc.canonicalKey ?? null,
      // ALWAYS genre-free: buildVector's genre-bag mass dilutes the feature dims' L2-normalized
      // magnitude, and unevenly so — a genre-rich track's feature signal shrinks relative to a
      // genre-less one, corrupting feature-only cosine comparisons across the corpus. Genre
      // relevance is a separate, explicit, dormant Jaccard signal (discoveryVectorService.js),
      // never mixed into the stored/searched vector.
      vector: buildVector(doc, []),
    });
  }

  // ── v2 dual-write (EMBEDDING_V2_WRITE, default OFF) ──────────────────────────────────────
  // Runs AFTER the ToS gate, over `docs` rather than `recordingKeys`, so a spotify:/youtube: key
  // is not even LOOKED UP for genres — the containment boundary is the same one line for both
  // spaces, and v2 cannot widen it by accident. One catalog read for the whole batch.
  //
  // Unlike v1, v2 is built WITH genres. That is the point of the task: v1 writes
  // `buildVector(doc, [])` because its joint L2 norm let tag count crush the audio dims (PR #139),
  // and v2's separately-normalised blocks make that structurally impossible, so the genre signal
  // can finally be carried instead of deleted. v1's call is untouched here — the dilution fix is
  // not quietly undone by the v2 work.
  if (docs.length && embeddingSpace.writeV2Enabled()) {
    const { idf, genresByKey } = await _v2Inputs(docs.map(d => d.recordingKey));
    for (const d of docs) {
      const v2 = buildVectorV2(features.get(d.recordingKey), genresByKey.get(d.recordingKey)?.genres ?? [], { idf });
      // null = the track had no measurable audio AND no weighted genre: v2 ABSTAINS rather than
      // embedding to a confident direction. Never store it — v1 still writes its neutral-filled
      // vector, so the row is not lost, it simply has no v2 representation yet.
      if (v2) { d.vectorV2 = v2; d.modelV2 = MODEL_V2; }
    }
  }

  if (docs.length) await vectorIndex.upsertMany(docs);

  let tagged = 0;
  if (docs.length && llmClient.isConfigured() && process.env.VIBE_ENRICH !== 'false') {
    tagged = await _enrichTags(docs.map(d => d.recordingKey), features);
  }
  return { embedded: docs.length, tagged };
}

module.exports = { process: processJob };
