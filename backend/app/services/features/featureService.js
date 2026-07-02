'use strict';

const { canonicalKey } = require('../identity/trackIdentity');
const { recordingKeyOf, spotifyIdOf } = require('./featureProvider');
const reccoBeats = require('./reccoBeatsAdapter');
const llmEstimator = require('./llmEstimatorAdapter');
const repo = require('../../repositories/audioFeatureRepo');
const { enqueue } = require('../../queues/queue');
const { QUEUES } = require('../../queues/definitions');

// Hydration orchestrator: measured features first (ReccoBeats), engineered LLM
// estimation only for what the API can't serve. Tracks that fail both providers
// are NOT persisted — a null-feature record would poison the store permanently.

function _prep(tracks = []) {
  const seen = new Set();
  const prepped = [];
  for (const track of tracks) {
    const key = recordingKeyOf(track);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    prepped.push({ track, recordingKey: key, canonicalKey: track?.canonicalKey ?? canonicalKey(track) });
  }
  return prepped;
}

function _doc(result, prepByKey) {
  const prep = prepByKey.get(result.recordingKey);
  return {
    recordingKey: result.recordingKey,
    canonicalKey: prep?.canonicalKey ?? null,
    spotifyId:    spotifyIdOf(result.track),
    isrc:         result.track?.isrc ?? null,
    ...result.features,
    source:       result.source,
    confidence:   result.confidence,
  };
}

async function hydrate(tracks = []) {
  const prepped = _prep(tracks);
  const summary = { requested: prepped.length, targeted: 0, hydrated: 0, api: 0, llm: 0, failed: 0 };
  if (!prepped.length) return summary;

  const missing = new Set(await repo.missingKeys(prepped.map(p => p.recordingKey)));
  const targets = prepped.filter(p => missing.has(p.recordingKey));
  summary.targeted = targets.length;
  if (!targets.length) return summary;

  const prepByKey = new Map(targets.map(p => [p.recordingKey, p]));
  const docs = [];
  const fed = new Set();

  const apiResults = await reccoBeats.getFeatures(targets.map(p => p.track));
  for (const r of apiResults) {
    if (!r.features) continue;
    docs.push(_doc(r, prepByKey));
    fed.add(r.recordingKey);
    summary.api++;
  }

  const leftovers = targets.filter(p => !fed.has(p.recordingKey));
  if (leftovers.length) {
    const llmResults = await llmEstimator.getFeatures(leftovers.map(p => p.track));
    for (const r of llmResults) {
      if (!r.features) continue;
      docs.push(_doc(r, prepByKey));
      fed.add(r.recordingKey);
      summary.llm++;
    }
  }

  if (docs.length) await repo.upsertMany(docs);
  summary.hydrated = docs.length;
  summary.failed = targets.length - docs.length;
  return summary;
}

// Fire-and-forget: diff against the store, queue only the gap. Never throws —
// hydration is an enhancement, not a request dependency.
async function enqueueHydration(tracks = []) {
  try {
    const prepped = _prep(tracks);
    if (!prepped.length) return { queued: false, reason: 'no-keyable-tracks' };

    const missing = new Set(await repo.missingKeys(prepped.map(p => p.recordingKey)));
    if (!missing.size) return { queued: false, reason: 'all-hydrated' };

    const payload = prepped
      .filter(p => missing.has(p.recordingKey))
      .map(({ track, canonicalKey: ck }) => ({
        id:       track.id ?? null,
        provider: track.provider ?? null,
        uri:      track.uri ?? null,
        title:    track.title ?? track.name ?? null,
        artist:   track.artist ?? null,
        genres:   track.genres ?? [],
        isrc:     track.isrc ?? null,
        canonicalKey: ck,
      }));

    return await enqueue(QUEUES.FEATURE_HYDRATION, { tracks: payload });
  } catch (e) {
    console.error('[featureService] enqueueHydration failed:', e.message);
    return { queued: false, reason: 'error' };
  }
}

module.exports = { hydrate, enqueueHydration };
