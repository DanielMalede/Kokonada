'use strict';

const featureRepo = require('../repositories/audioFeatureRepo');
const vectorIndex = require('../services/vector/vectorIndex');
const { buildVector } = require('../services/vector/embedding');
const llmClient = require('../services/llmClient');

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

// Named processJob: a function literally named `process` shadows the Node
// global inside its own body, turning process.env into undefined.
async function processJob(job) {
  const recordingKeys = job?.data?.recordingKeys ?? [];
  const genresByKey = job?.data?.genresByKey ?? {};
  if (!recordingKeys.length) return { embedded: 0, tagged: 0 };

  const features = await featureRepo.getMany(recordingKeys);
  const docs = [];
  for (const key of recordingKeys) {
    const doc = features.get(key);
    if (!doc) continue;
    docs.push({
      recordingKey: key,
      canonicalKey: doc.canonicalKey ?? null,
      vector: buildVector(doc, genresByKey[key] ?? doc.vibeTags ?? []),
    });
  }
  if (docs.length) await vectorIndex.upsertMany(docs);

  let tagged = 0;
  if (docs.length && llmClient.isConfigured() && process.env.VIBE_ENRICH !== 'false') {
    tagged = await _enrichTags(docs.map(d => d.recordingKey), features);
  }
  return { embedded: docs.length, tagged };
}

module.exports = { process: processJob };
