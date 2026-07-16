'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// READ-ONLY prod diagnostic: the #135-style empirical before/after proof for
// ACTIVATING the dormant genre-Jaccard discovery seam (DISCOVERY_GENRE_RELEVANCE).
//
// Run against prod by a human, env injected by Railway:
//   railway run -p <proj> -e production -s kokonada-backend -- \
//     node app/scripts/measureDiscoveryComposition.js [--runs 3] [--weights 0.1,0.15,0.25,0.35]
//
// ZERO WRITES — non-negotiable. Every DB/cache touchpoint is a read:
//   • vectorIndex.queryNear         → $vectorSearch aggregate (read).
//   • discoveryVectorService.find   → queryNear + trackCatalogRepo.getMany (.find().lean(), no cache).
//                                     Its band-aware branch (the only path that calls
//                                     audioFeatureRepo.getMany, which write-through-backfills Redis)
//                                     is NEVER taken here: we pass no `targets` and never set
//                                     DISCOVERY_BAND_AWARE, so hasUsableBand()===false → no getMany.
//   • band-proximity hydration      → the AudioFeature MODEL directly (.find(projection).lean()),
//                                     DELIBERATELY bypassing audioFeatureRepo.getMany because that repo
//                                     backfills Redis (redis.set … 'NX') on Mongo misses. Model reads
//                                     never touch the cache → zero cache writes.
//   • preflight coverage            → TrackCatalog.aggregate (read).
//   • weight sweep                  → sets process.env.DISCOVERY_GENRE_WEIGHT IN-PROCESS around the ON
//                                     runs, then restores it — process env only, no persistence.
//   • mmr.select                    → temporarily monkey-patched IN-PROCESS to capture the pre-MMR
//                                     candidate pool, delegating to the original, restored in finally.
// No model.save/create/updateOne/bulkWrite, no queue enqueue, no reembed/backfill worker is invoked.
//
// The heavy lifting lives in small pure functions (below) so the unit tests need no live Mongo.
// ─────────────────────────────────────────────────────────────────────────────

const vectorIndex = require('../services/vector/vectorIndex');
const discoveryVectorService = require('../services/discovery/discoveryVectorService');
const mmr = require('../services/selection/mmr');
const { buildTargetVector } = require('../services/discovery/targetVector');
const { MOOD_DESCRIPTORS } = require('../services/moodDescriptors');
const AudioFeature = require('../models/AudioFeature');
const TrackCatalog = require('../models/TrackCatalog');

const MBID_PREFIX = 'mbid:';
// Mirrors discoveryVectorService's GENRE_WEIGHT_DEFAULT / GENRE_WEIGHT_MAX (not exported there).
const GENRE_WEIGHT_DEFAULT = 0.15;
const GENRE_WEIGHT_MAX = 0.5;

// ── pure helpers ──────────────────────────────────────────────────────────────

// _descriptorTargets-style conversion (moodDescriptors.js :132-140): bpm = round(70 + energy*90),
// acousticness = clamp(1 - energy). danceability/loudness are left to buildVector's neutral fill.
function descriptorFeatures(desc) {
  const energy = desc.energy_floor;
  return {
    bpm: Math.round(70 + energy * 90),
    energy,
    valence: desc.valence_hint,
    acousticness: Math.max(0, Math.min(1, 1 - energy)),
  };
}

// Fixed archetype sweep. Features derive from the mood descriptors (or the neutral buildVector fill
// for `moderate`); seedGenres are the explicit on-vibe query genres for the Jaccard seam.
const ARCHETYPES = [
  { name: 'energetic',    seedGenres: ['electronic', 'house'],            targetFeatures: descriptorFeatures(MOOD_DESCRIPTORS.energize) },
  { name: 'calm',         seedGenres: ['ambient', 'lo-fi'],               targetFeatures: descriptorFeatures(MOOD_DESCRIPTORS.calm) },
  { name: 'moderate',     seedGenres: ['pop', 'indie pop'],              targetFeatures: { bpm: 130, energy: 0.5, valence: 0.5, acousticness: 0.5, danceability: 0.5, loudness: -27.5 } },
  { name: 'happy-dance',  seedGenres: ['pop', 'disco'],                  targetFeatures: descriptorFeatures(MOOD_DESCRIPTORS.uplift) },
  { name: 'sad-acoustic', seedGenres: ['acoustic', 'singer-songwriter'], targetFeatures: descriptorFeatures(MOOD_DESCRIPTORS.unwind) },
];

// Bucket recordingKeys into mbid: vs legacy and compute the mbid share (0 when empty).
function bucketShare(keys, prefix = MBID_PREFIX) {
  const list = keys || [];
  const total = list.length;
  let mbid = 0;
  for (const k of list) if (typeof k === 'string' && k.startsWith(prefix)) mbid++;
  return { mbid, legacy: total - mbid, total, share: total ? mbid / total : 0 };
}

// Fraction of the candidate genre-lists whose genres intersect the query genres (case-insensitive).
function jaccardHitRate(candidateGenreLists, queryGenres) {
  const qset = new Set((queryGenres || []).map((g) => String(g).toLowerCase()));
  const lists = candidateGenreLists || [];
  if (!qset.size || !lists.length) return 0;
  let hits = 0;
  for (const genres of lists) {
    const cset = new Set((genres || []).map((g) => String(g).toLowerCase()));
    let intersects = false;
    for (const g of cset) if (qset.has(g)) { intersects = true; break; }
    if (intersects) hits++;
  }
  return hits / lists.length;
}

function mean(nums) {
  const arr = (nums || []).filter((n) => Number.isFinite(n));
  if (!arr.length) return 0;
  return arr.reduce((s, n) => s + n, 0) / arr.length;
}

// Mean |feature − target| over the rows that carry finite features (band-proximity evidence).
function absDeltas(featureRows, target) {
  const eDeltas = [];
  const bDeltas = [];
  for (const f of featureRows || []) {
    if (f && Number.isFinite(f.energy) && Number.isFinite(target.energy)) eDeltas.push(Math.abs(f.energy - target.energy));
    if (f && Number.isFinite(f.bpm) && Number.isFinite(target.bpm)) bDeltas.push(Math.abs(f.bpm - target.bpm));
  }
  return { energyDelta: mean(eDeltas), bpmDelta: mean(bDeltas), energyN: eDeltas.length, bpmN: bDeltas.length };
}

// Reduce the read-only aggregate output into structured coverage numbers.
function summarizePreflight(rows) {
  const get = (id) => (rows || []).find((r) => r._id === id) || { total: 0, withGenres: 0 };
  const mbid = get('mbid');
  const legacy = get('legacy');
  return {
    mbidTotal: mbid.total, mbidWithGenres: mbid.withGenres,
    mbidGenreCoverage: mbid.total ? mbid.withGenres / mbid.total : 0,
    legacyTotal: legacy.total, legacyWithGenres: legacy.withGenres,
    legacyGenreCoverage: legacy.total ? legacy.withGenres / legacy.total : 0,
  };
}

function parseArgs(argv) {
  const out = { runs: 3, weights: null };
  const list = argv || [];
  // Drop empty/whitespace tokens BEFORE Number() — otherwise Number('')===0 sneaks a bogus 0 weight in.
  const toWeights = (s) => String(s || '').split(',').map((x) => x.trim()).filter((x) => x !== '').map(Number).filter((n) => Number.isFinite(n));
  // A valid parse (incl. 0 or negative) floors at 1; only a non-numeric arg falls back to the default 3.
  // (parseInt(x,10) || 3 would wrongly turn a legit `--runs 0` into 3 instead of 1.)
  const toRuns = (s) => { const n = parseInt(s, 10); return Number.isFinite(n) ? Math.max(1, n) : 3; };
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a === '--runs') out.runs = toRuns(list[++i]);
    else if (a === '--weights') out.weights = toWeights(list[++i]);
    else if (a.startsWith('--runs=')) out.runs = toRuns(a.slice(7));
    else if (a.startsWith('--weights=')) out.weights = toWeights(a.slice(10));
  }
  if (out.weights && !out.weights.length) out.weights = null;
  return out;
}

// Mirrors discoveryVectorService.genreWeight()'s default/clamp for labeling the default sweep weight.
function currentGenreWeight() {
  const raw = process.env.DISCOVERY_GENRE_WEIGHT;
  if (raw === undefined || String(raw).trim() === '') return GENRE_WEIGHT_DEFAULT;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(GENRE_WEIGHT_MAX, Math.max(0, n)) : GENRE_WEIGHT_DEFAULT;
}

// Set DISCOVERY_GENRE_WEIGHT in-process for the duration of fn (find() reads it at call time via
// genreWeight()), then restore it exactly — including deleting it when it was previously unset.
async function withGenreWeight(weight, fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, 'DISCOVERY_GENRE_WEIGHT');
  const prev = process.env.DISCOVERY_GENRE_WEIGHT;
  process.env.DISCOVERY_GENRE_WEIGHT = String(weight);
  try {
    return await fn();
  } finally {
    if (had) process.env.DISCOVERY_GENRE_WEIGHT = prev;
    else delete process.env.DISCOVERY_GENRE_WEIGHT;
  }
}

// ── read-only DB access ─────────────────────────────────────────────────────────

// Band-proximity feature hydration that DELIBERATELY bypasses audioFeatureRepo.getMany (which
// backfills Redis on misses). Direct model read, projection + .lean(), zero cache writes.
async function loadFeatures(keys) {
  const map = new Map();
  const uniq = [...new Set(keys || [])].filter((k) => typeof k === 'string' && k);
  if (!uniq.length) return map;
  const rows = await AudioFeature
    .find({ recordingKey: { $in: uniq } }, { recordingKey: 1, energy: 1, bpm: 1, _id: 0 })
    .lean();
  for (const r of rows) map.set(r.recordingKey, { energy: r.energy, bpm: r.bpm });
  return map;
}

// Single read-only aggregate over trackcatalogs: mbid: vs legacy row counts + non-empty-genres counts.
async function genreCoveragePreflight(Model) {
  const rows = await Model.aggregate([
    {
      $group: {
        _id: { $cond: [{ $regexMatch: { input: '$recordingKey', regex: '^mbid:' } }, 'mbid', 'legacy'] },
        total: { $sum: 1 },
        withGenres: { $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ['$genres', []] } }, 0] }, 1, 0] } },
      },
    },
  ]);
  return summarizePreflight(rows);
}

// ── orchestration ───────────────────────────────────────────────────────────────

// Run one discoveryVectorService.find() while temporarily monkey-patching mmr.select (the SAME
// singleton find() calls internally) to capture the pre-MMR candidate pool it receives. Restores
// the original select in a finally so no state leaks — even if find() somehow throws.
async function findCapturingCandidates(discovery, mmrModule, findOpts) {
  const original = mmrModule.select;
  let captured = [];
  mmrModule.select = function patched(candidates, opts) {
    captured = candidates;
    return original.call(this, candidates, opts);
  };
  try {
    const served = await discovery.find(findOpts);
    return { served: served || [], candidates: captured || [] };
  } finally {
    mmrModule.select = original;
  }
}

const DEFAULT_DEPS = { vectorIndex, discoveryVectorService, mmr, buildTargetVector, loadFeatures, TrackCatalog };

// Measure one archetype across `runs` repeats and the `weights` sweep. Read-only.
async function measureArchetype(archetype, deps = DEFAULT_DEPS, opts = {}) {
  const {
    vectorIndex: vidx, discoveryVectorService: discovery, mmr: mmrModule,
    buildTargetVector: buildVec, loadFeatures: loadFeat,
  } = deps;
  const { runs = 3, weights = [currentGenreWeight()], k = 30, retrievalK = 500 } = opts;
  const baseFindOpts = { targetFeatures: archetype.targetFeatures, excludeCanonicalKeys: new Set(), k };

  // M_retrieval — genre-FREE query vector (preserve the genre-free query-vector invariant), k=retrievalK.
  const target500 = buildVec(archetype.targetFeatures, []);
  const hits500 = (await vidx.queryNear(target500, { k: retrievalK })) || [];
  const retrieval = bucketShare(hits500.map((h) => h.recordingKey));

  // M_served OFF — queryGenres [] (weight-independent), `runs` repeats.
  const offRunShares = [];
  const offServedKeys = [];
  for (let r = 0; r < runs; r++) {
    const { served } = await findCapturingCandidates(discovery, mmrModule, { ...baseFindOpts, queryGenres: [] });
    const keys = served.map((t) => t.recordingKey);
    offRunShares.push(bucketShare(keys).share);
    offServedKeys.push(...keys);
  }

  // M_served ON — queryGenres = archetype.seedGenres, per weight, `runs` repeats.
  const onByWeight = [];
  for (const w of weights) {
    const onRunShares = [];
    const jaccardRates = [];
    const preMmrShares = [];
    const onServedKeys = [];
    for (let r = 0; r < runs; r++) {
      const { served, candidates } = await withGenreWeight(w, () =>
        findCapturingCandidates(discovery, mmrModule, { ...baseFindOpts, queryGenres: archetype.seedGenres }));
      const keys = served.map((t) => t.recordingKey);
      onRunShares.push(bucketShare(keys).share);
      onServedKeys.push(...keys);
      jaccardRates.push(jaccardHitRate(candidates.map((c) => c.track && c.track.genres || []), archetype.seedGenres));
      preMmrShares.push(bucketShare(candidates.map((c) => c.track && c.track.recordingKey)).share);
    }
    onByWeight.push({
      weight: w,
      servedOnMbidShare: mean(onRunShares),
      servedOnMbidPerRun: onRunShares,
      jaccardHitRate: mean(jaccardRates),
      jaccardPerRun: jaccardRates,
      preMmrMbidShare: mean(preMmrShares),
      onServedKeys,
    });
  }

  // Band-proximity — hydrate every served key ONCE (OFF + all ON weights) read-only, then delta.
  const allKeys = [...new Set([...offServedKeys, ...onByWeight.flatMap((o) => o.onServedKeys)])];
  const featureMap = await loadFeat(allKeys);
  const offDeltas = absDeltas(offServedKeys.map((key) => featureMap.get(key)), archetype.targetFeatures);
  const weightResults = onByWeight.map((o) => {
    const d = absDeltas(o.onServedKeys.map((key) => featureMap.get(key)), archetype.targetFeatures);
    return {
      weight: o.weight,
      servedOnMbidShare: o.servedOnMbidShare,
      servedOnMbidPerRun: o.servedOnMbidPerRun,
      jaccardHitRate: o.jaccardHitRate,
      jaccardPerRun: o.jaccardPerRun,
      preMmrMbidShare: o.preMmrMbidShare,
      servedOnEnergyDelta: d.energyDelta,
      servedOnBpmDelta: d.bpmDelta,
    };
  });

  return {
    name: archetype.name,
    retrievalK,
    mbidShare500: retrieval.share,
    mbidHits500: retrieval.mbid,
    retrievalTotal: retrieval.total,
    servedOffMbidShare: mean(offRunShares),
    servedOffMbidPerRun: offRunShares,
    servedOffEnergyDelta: offDeltas.energyDelta,
    servedOffBpmDelta: offDeltas.bpmDelta,
    weights: weightResults,
  };
}

const f4 = (n) => Number(n).toFixed(4);
const f2 = (n) => Number(n).toFixed(2);
const perRun = (arr, d = 3) => `[${(arr || []).map((x) => Number(x).toFixed(d)).join(',')}]`;

// Preflight + the full archetype sweep. Prints one parseable `[measure]` key=value line per fact
// and returns the structured results. `log` is injectable for tests.
async function runMeasurement(deps = DEFAULT_DEPS, options = {}, log = console.log) {
  const { runs = 3, weights, k = 30, retrievalK = 500 } = options;
  const sweepWeights = weights && weights.length ? weights : [currentGenreWeight()];

  const pf = await genreCoveragePreflight(deps.TrackCatalog);
  log(`[measure] preflight mbidTotal=${pf.mbidTotal} mbidWithGenres=${pf.mbidWithGenres} mbidGenreCoverage=${f4(pf.mbidGenreCoverage)} legacyTotal=${pf.legacyTotal} legacyWithGenres=${pf.legacyWithGenres} legacyGenreCoverage=${f4(pf.legacyGenreCoverage)}`);

  const archetypes = [];
  for (const arch of ARCHETYPES) {
    const res = await measureArchetype(arch, deps, { runs, weights: sweepWeights, k, retrievalK });
    archetypes.push(res);

    log(`[measure] archetype=${res.name} retrievalK=${res.retrievalK} mbidShare500=${f4(res.mbidShare500)} mbidHits=${res.mbidHits500} total=${res.retrievalTotal}`);
    log(`[measure] archetype=${res.name} served=OFF k=${k} runs=${runs} servedOffMbidShare=${f4(res.servedOffMbidShare)} perRun=${perRun(res.servedOffMbidPerRun)} servedOffEnergyDelta=${f4(res.servedOffEnergyDelta)} servedOffBpmDelta=${f2(res.servedOffBpmDelta)}`);
    for (const ow of res.weights) {
      log(`[measure] archetype=${res.name} served=ON weight=${ow.weight} k=${k} runs=${runs} servedOnMbidShare=${f4(ow.servedOnMbidShare)} perRun=${perRun(ow.servedOnMbidPerRun)} jaccardHitRate=${f4(ow.jaccardHitRate)} preMmrMbidShare=${f4(ow.preMmrMbidShare)} servedOnEnergyDelta=${f4(ow.servedOnEnergyDelta)} servedOnBpmDelta=${f2(ow.servedOnBpmDelta)}`);
    }
  }
  return { preflight: pf, archetypes };
}

module.exports = {
  ARCHETYPES,
  descriptorFeatures,
  bucketShare,
  jaccardHitRate,
  mean,
  absDeltas,
  summarizePreflight,
  parseArgs,
  currentGenreWeight,
  withGenreWeight,
  loadFeatures,
  genreCoveragePreflight,
  findCapturingCandidates,
  measureArchetype,
  runMeasurement,
};

// CLI — connection only under require.main (module load stays side-effect-free).
if (require.main === module) {
  const mongoose = require('mongoose');
  const { runs, weights } = parseArgs(process.argv.slice(2));
  (async () => {
    await mongoose.connect(process.env.MONGO_URI);
    await runMeasurement(DEFAULT_DEPS, { runs, weights });
    await mongoose.disconnect();
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
}
