'use strict';

const { canonicalKey } = require('../identity/trackIdentity');
const { recordingKeyOf, spotifyIdOf } = require('./featureProvider');
const reccoBeats = require('./reccoBeatsAdapter');
const llmEstimator = require('./llmEstimatorAdapter');
const repo = require('../../repositories/audioFeatureRepo');
const { enqueue } = require('../../queues/queue');
const { QUEUES } = require('../../queues/definitions');
const { isSpotifyKey, isSpotifyContent } = require('../../utils/spotifyContent');

// Spotify-ToS containment choke: Spotify Content must never land in the AudioFeature
// store or the embedding queue (which self-enqueues off the store). Both hydrate() and
// enqueueHydration() drop Spotify recordings here, so no measured-feature fetch, store
// write, or EMBEDDING_BUILD job can ever be keyed to Spotify Content.
//
// The predicate is provider- AND spotifyId-aware (not just recordingKey-scheme) to match the
// other four gates and the leak monitor: ReccoBeats.supports() keys off spotifyId, so a
// malformed/mislabeled track (mbid recordingKey + provider:'spotify', or youtube recordingKey +
// a bare spotifyId) MUST be dropped BEFORE the measured fetch — otherwise it would be measured
// and stored with a live spotifyId that the leak monitor's own selector would then flag.
function _isSpotify(p) {
  return isSpotifyContent(p.track) || isSpotifyKey(p.recordingKey) || spotifyIdOf(p.track) != null;
}
function _dropSpotify(prepped, tag) {
  const kept = prepped.filter(p => !_isSpotify(p));
  const excluded = prepped.length - kept.length;
  if (excluded > 0) console.info(`[featureService] ${tag} excluded ${excluded} spotify recording(s) (ToS containment)`);
  return kept;
}

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
  const prepped = _dropSpotify(_prep(tracks), 'hydrate');
  const summary = { requested: prepped.length, targeted: 0, hydrated: 0, api: 0, llm: 0, upgraded: 0, failed: 0 };
  if (!prepped.length) return summary;

  // One store read decides both cohorts: MISSING recordings hydrate normally;
  // stored LLM estimates whose track now has a Spotify id are UPGRADE targets —
  // the measured API refetches them ('api' overwrites 'llm', never the reverse).
  const stored = await repo.getMany(prepped.map(p => p.recordingKey));
  const targets = prepped.filter((p) => {
    const doc = stored.get(p.recordingKey);
    if (!doc) return true;
    const upgradable = doc.source === 'llm' && reccoBeats.supports(p.track);
    if (upgradable) summary.upgraded++;
    return upgradable;
  });
  summary.targeted = targets.length;
  if (!targets.length) return summary;

  const prepByKey = new Map(targets.map(p => [p.recordingKey, p]));
  const docs = [];
  const fed = new Set();

  const apiResults = await reccoBeats.getFeatures(targets.map(p => p.track));
  const apiMissed = new Set(); // Spotify tracks ReccoBeats CONFIRMED it lacks (200, absent)
  for (const r of apiResults) {
    if (r.features) {
      docs.push(_doc(r, prepByKey));
      fed.add(r.recordingKey);
      summary.api++;
    } else if (r.apiStatus === 'miss') {
      apiMissed.add(r.recordingKey);
    }
  }

  // LLM estimation covers tracks the measured API cannot serve: YouTube-only recordings AND
  // Spotify tracks ReccoBeats CONFIRMED it lacks (apiStatus 'miss' — a permanent catalog gap,
  // so a bounded guess CLOSES the data gap rather than poisoning). A batch that merely ERRORED
  // stays missing and is retried next hydration — never estimated (the never-clobber rule).
  // Upgrade targets already HAVE an llm doc, so !stored.has keeps them out of this path.
  const leftovers = targets.filter(p =>
    !fed.has(p.recordingKey) &&
    !stored.has(p.recordingKey) &&
    (!reccoBeats.supports(p.track) || apiMissed.has(p.recordingKey)));
  if (leftovers.length) {
    const llmResults = await llmEstimator.getFeatures(leftovers.map(p => p.track));
    for (const r of llmResults) {
      if (!r.features) continue;
      docs.push(_doc(r, prepByKey));
      fed.add(r.recordingKey);
      summary.llm++;
    }
  }

  // Belt (Spotify-ToS): prepped is already spotify-free, but never let a mislabeled adapter
  // result persist a spotify: key OR a doc carrying a live spotifyId, nor seed a spotify-keyed
  // EMBEDDING_BUILD job. Mirrors the leak monitor's row selector (recordingKey scheme + spotifyId).
  const storable = docs.filter(d => !isSpotifyKey(d.recordingKey) && d.spotifyId == null);
  if (storable.length) {
    await repo.upsertMany(storable);
    // Enrichment (vectors + vibe tags) rides the embedding-build queue —
    // fire-and-forget, hydration never waits on it. genresByKey is spotify-free by
    // construction (storable is gated), so no Spotify-derived genres reach the LLM enricher.
    const genresByKey = {};
    for (const doc of storable) {
      const prep = prepByKey.get(doc.recordingKey);
      if (prep?.track?.genres?.length) genresByKey[doc.recordingKey] = prep.track.genres;
    }
    enqueue(QUEUES.EMBEDDING_BUILD, { recordingKeys: storable.map(d => d.recordingKey), genresByKey })
      .catch(() => {});
  }
  summary.hydrated = storable.length;
  summary.failed = targets.length - storable.length;
  return summary;
}

// Fire-and-forget: diff against the store, queue only the gap. Never throws —
// hydration is an enhancement, not a request dependency.
async function enqueueHydration(tracks = []) {
  try {
    const prepped = _dropSpotify(_prep(tracks), 'enqueueHydration');
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
