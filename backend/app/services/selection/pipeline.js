'use strict';

const ledger = require('../ledger/serveLedger');
const featureRepo = require('../../repositories/audioFeatureRepo');
const { buildPool } = require('./candidatePool');
const { applyHardFilters } = require('./hardFilters');
const { scoreTrack } = require('./score');
const { select } = require('./mmr');
const { filterBand } = require('./biosonicBand');
const { recordingKeyOf, featuresOf } = require('../features/featureProvider');
const vectorIndex = require('../vector/vectorIndex');
const { attachLibraryAnchors } = require('../discovery/libraryAnchor');

// Similarity floor for the discovery mix-receipt library anchor. Read at call time
// (like DISCOVERY_MIN_COSINE) so a Railway env flip needs no redeploy.
const ANCHOR_MIN_COSINE = () => {
  // Require a POSITIVE finite value: an empty env (Number("")===0), a zero, or a negative
  // would collapse the floor to always-pass, so anything non-positive falls back to 0.6.
  const v = Number(process.env.DISCOVERY_ANCHOR_MIN_COSINE);
  return Number.isFinite(v) && v > 0 ? v : 0.6;
};

// The Phase-5 selection pipeline: pool → exclusions → features → score → MMR.
// Zero LLM in the path. When filters would starve the playlist, a relaxation
// ladder loosens the gates one level at a time. The global serve window holds
// through L3; only the L4 LAST RESORT drops it, so a user with a non-empty
// library can never get an empty playlist (a repeat beats a "try again" error).
//
//   L0 full · L1 drop energy ceiling · L2 drop genre excludes · L3 drop mood window
//   L4 LAST RESORT: replay FAMILIAR library, dropping the serve window — never serve empty

const MIN_FILL = (k) => Math.min(k, 10);

async function selectPlaylist({
  userId,
  musicProfile = {},
  moodKey = null,
  provider = null,
  aiParams = {},
  targets = {},
  discoveryTracks = [],
  k = 50,
  now = Date.now(),
  crossPlatform = false,
  ignoreExclusions = null,
} = {}) {
  const stageMs = {};
  const t0 = Date.now();
  const mark = (stage, since) => { stageMs[stage] = Date.now() - since; };

  // Stage 1: mood-partitioned pool (canonical dedup happens inside).
  let t = Date.now();
  const pool = await buildPool({
    userId, musicProfile, moodKey,
    excludeGenres: aiParams.exclude_genres || [],
    discoveryTracks,
  });
  mark('pool', t);

  // Stage 2: parallel context loads — exclusion windows, features, exposure.
  t = Date.now();
  let hardExcluded = new Set();
  let moodExcluded = new Set();
  let degraded = false;
  try {
    [hardExcluded, moodExcluded] = await Promise.all([
      ledger.hardExcluded(userId, now),
      moodKey ? ledger.moodExcluded(userId, moodKey, now) : Promise.resolve(new Set()),
    ]);
  } catch (e) {
    degraded = true; // total ledger outage: generation must not die with it
    console.error('[selection] ledger outage, exclusions degraded:', e.message);
  }
  if (ignoreExclusions?.size) {
    for (const key of ignoreExclusions) { hardExcluded.delete(key); moodExcluded.delete(key); }
  }

  const canonicalKeys = pool.map(p => p.canonicalKey).filter(Boolean);
  const recordingKeys = pool.map(recordingKeyOf).filter(Boolean);
  let featureMap = new Map();
  let exposure = new Map();
  let embeddings = new Map();
  try {
    [featureMap, exposure, embeddings] = await Promise.all([
      featureRepo.getMany(recordingKeys),
      ledger.getExposure(userId, canonicalKeys, now),
      // Embeddings are an MMR enhancement — a vector-index failure never blocks.
      vectorIndex.getMany(recordingKeys).catch(() => new Map()),
    ]);
  } catch (e) {
    console.error('[selection] feature/exposure load degraded:', e.message);
  }
  for (const track of pool) {
    const rk = recordingKeyOf(track);
    track.features = featuresOf(featureMap.get(rk));
    track.embedding = embeddings.get(rk) ?? null;
  }
  // How many pool tracks actually resolved features — the single serve-path number that
  // reveals whether AudioFeature is populated. If this stays ~0, _featureFit collapses to
  // a constant and mood/HR can't differentiate the playlist (the "same playlist" symptom).
  const featured = pool.reduce((n, tr) => n + (tr.features ? 1 : 0), 0);

  // Un-relaxable biosonic band — mood identity. The ladder below relaxes ONLY
  // anti-repetition/genre; the band is never relaxed. Featureless tracks pass.
  // Only a LITERAL-zero band widens (never trade mood for novelty).
  const banded = filterBand(pool, targets);
  let bandWidened = 0;
  let workingPool = banded;
  if (banded.length === 0) { workingPool = pool; bandWidened = 1; }
  mark('context', t);

  // Stage 3: hard filters with the relaxation ladder.
  t = Date.now();
  // Cross-platform sink: when the playback sink is Spotify with translation available
  // downstream (a YouTube-built profile playing on Spotify), familiar tracks from a
  // DIFFERENT source must NOT be provider-filtered out here — they are resolved to
  // playable Spotify URIs after selection. Discovery is already sink-native, so dropping
  // the provider gate is safe. Without this, a whole cross-provider library is discarded
  // (mixedFamiliar=0 → empty playlist), even at full relaxation (the provider gate never relaxes).
  const filterProvider = crossPlatform ? null : provider;
  const excludeGenres = aiParams.exclude_genres || [];
  const LADDER = [
    { excludeGenres, moodExcluded },                // L0 full
    { excludeGenres: [], moodExcluded },            // L1 drop genre excludes
    { excludeGenres: [], moodExcluded: new Set() }, // L2 drop mood window
  ];
  let filtered = [];
  let relaxLevel = 0;
  for (let level = 0; level < LADDER.length; level++) {
    filtered = applyHardFilters(workingPool, {
      hardExcluded, // held through the ladder (never yields to input manipulation)
      moodExcluded: LADDER[level].moodExcluded,
      provider: filterProvider,
      excludeGenres: LADDER[level].excludeGenres,
      energyCeiling: null, // energy/tempo owned by the un-relaxable biosonic band
      targetConfidence: targets.confidence ?? 0,
    });
    relaxLevel = level;
    if (filtered.length >= MIN_FILL(k)) break;
  }

  // L4 LAST RESORT — never serve an EMPTY playlist to a listener who HAS a library. When
  // every legal relaxation still yields nothing (their whole pool sits inside the serve
  // window — a heavily-served account), replay their OWN familiar tracks, ignoring the
  // window: a repeat beats a "couldn't build a playlist" error. Scoped to FAMILIAR only —
  // a just-served or forged DISCOVERY candidate is never resurrected (the blacklist stays
  // impenetrable to smuggling), and a user with no library still (correctly) gets empty.
  if (filtered.length === 0 && (musicProfile.library || []).length > 0) {
    const familiar = workingPool.filter(tr => !tr.isDiscovery);
    if (familiar.length) {
      filtered = applyHardFilters(familiar, {
        hardExcluded: new Set(),
        moodExcluded: new Set(),
        provider: filterProvider,
        excludeGenres: [],
        energyCeiling: null,
        targetConfidence: targets.confidence ?? 0,
      });
      relaxLevel = 4;
    }
  }
  mark('filters', t);

  // Stage 4: score.
  t = Date.now();
  const maxAffinity = filtered.reduce((m, tr) => Math.max(m, tr.affinity ?? 0), 0);
  const scored = filtered.map(track => ({
    track,
    ...scoreTrack(track, {
      targets,
      maxAffinity,
      allowGenres: aiParams.allow_genres || [],
      exposure,
      targetMoodKey: moodKey,
      now,
    }),
  }));
  mark('score', t);

  // Stage 5: MMR diversity selection.
  t = Date.now();
  const picks = select(scored, { k });
  mark('mmr', t);

  // Enriched mix-receipt: attach the nearest NON-Spotify library anchor ("Because you
  // love <artist>") to each qualifying discovery pick. Pure and in-memory over the pool
  // that Stage 2 ALREADY embedded (the single vectorIndex.getMany batch) — no new I/O,
  // no Atlas round-trip. The anchor is a transient, user-scoped mutation on in-memory
  // track objects only; it is NEVER persisted (ADR-0008 catalog anonymity) and does not
  // touch the pool Redis cache (written back in Stage 1, before embeddings attach).
  const libraryCandidates = pool.filter(tr => !tr.isDiscovery && Array.isArray(tr.embedding) && tr.embedding.length);
  const discoveryPicks = picks.map(p => p.track).filter(tr => tr.isDiscovery && Array.isArray(tr.embedding));
  attachLibraryAnchors(discoveryPicks, libraryCandidates, { minCosine: ANCHOR_MIN_COSINE() });

  stageMs.total = Date.now() - t0;
  return {
    tracks: picks.map(p => p.track),
    telemetry: {
      poolSize: pool.length,
      afterFilters: filtered.length,
      relaxLevel,
      degraded,
      featured,
      banded: banded.length,
      bandWidened,
      stageMs,
    },
  };
}

module.exports = { selectPlaylist };
