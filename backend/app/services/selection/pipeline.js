'use strict';

const ledger = require('../ledger/serveLedger');
const featureRepo = require('../../repositories/audioFeatureRepo');
const { buildPool } = require('./candidatePool');
const { applyHardFilters } = require('./hardFilters');
const { scoreTrack, activeVersion, resolveWeights } = require('./score');
const { select } = require('./mmr');
// Namespace import, not a destructure: the S12 block below is a DIAGNOSTIC whose failure must
// be provable to be non-fatal, and a test can only stub a throwing compare through the module
// object. Destructuring here would make that path untestable and therefore unexercised.
const shadowCompare = require('./shadowCompare');
const { filterBand } = require('./biosonicBand');
const { planTrajectory, DISABLE_ENV_VAR: TRAJECTORY_DISABLED } = require('../../agents/runtime/delivery/trajectoryPlanner');
const { recordingKeyOf, featuresOf } = require('../features/featureProvider');
const vectorIndex = require('../vector/vectorIndex');
const rewardRepo = require('../../repositories/rewardRepo');
const { bucketOf } = require('../../agents/runtime/learning/feedbackLoop');
// Namespace import for the same reason `shadowCompare` uses one: this is an OPTIONAL layer whose
// failure must be provably non-fatal, and a test can only stub a throwing read through the module.
const novelty = require('../../agents/runtime/knowledge/noveltyController');
// Namespace import for the same reason: W4-013's B7 overlay is an OPTIONAL layer on the serving
// path whose failure must be provably non-fatal, and a test can only stub a throwing read through
// the module object.
const personalization = require('../../agents/runtime/learning/personalization');
const personalWeightsRepo = require('../../repositories/personalWeightsRepo');

// The Phase-5 selection pipeline: pool → exclusions → features → score → MMR → trajectory.
// Zero LLM in the path. When filters would starve the playlist, a relaxation
// ladder loosens the gates one level at a time. The global serve window holds
// through L3; only the L4 LAST RESORT drops it, so a user with a non-empty
// library can never get an empty playlist (a repeat beats a "try again" error).
//
//   L0 full · L1 drop genre excludes · L2 drop mood window
//   L4 LAST RESORT: replay FAMILIAR library, dropping the serve window — never serve empty
//
// The ladder has THREE rungs. There is no energy rung: energy and tempo belong to the
// un-relaxable biosonic band, which the ladder never touches. `relaxLevel` stays 0..2 for
// the ladder and jumps to 4 for the last resort — 3 is deliberately unused so the telemetry
// value keeps meaning what it has always meant to anything reading it.

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

  // Stage 3.5: W4-013 (B7) — this listener's scoring overlay, resolved ONCE.
  //
  // It costs a Mongo read, and the alternative — resolving it inside `scoreTrack` — would repeat
  // that read for every candidate in the pool. The table it produces is then in force for the
  // whole generation, which is also what makes the gradients below meaningful: a gradient has to
  // be centred on the weights that actually ranked the track.
  const personal = await _resolveOverlay({ userId, targets, now });

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
      weights: personal.weights,
    }),
  }));
  mark('score', t);

  // Stage 4b: S12 scoring shadow-compare — OFF by default, telemetry only.
  //
  // Scores the SAME survivors with the other scorer and records how far apart the two
  // rankings land. It runs after the served scoring and feeds nothing back into it: `scored`
  // is not read from here, MMR never sees `shadowStats`, and the whole block is wrapped —
  // a diagnostic that can take generation down is a liability, not evidence.
  let shadowStats = null;
  if (shadowCompare.shadowEnabled(process.env)) {
    const tShadow = Date.now();
    try {
      const servedVersion = activeVersion();
      const shadowVersion = servedVersion === 'v2' ? 'v1' : 'v2';
      const entries = scored.map((s, i) => ({
        // canonicalKey is unique post-dedup; the index is the fallback so a track without one
        // still occupies its own slot rather than colliding into a fake tie.
        key: s.track.canonicalKey ?? recordingKeyOf(s.track) ?? `#${i}`,
        served: s.total,
        shadow: scoreTrack(s.track, {
          targets, maxAffinity, allowGenres: aiParams.allow_genres || [],
          exposure, targetMoodKey: moodKey, now, version: shadowVersion,
        }).total,
      }));
      const stats = shadowCompare.compare(entries, { k });
      mark('shadow', tShadow);
      console.log(shadowCompare.summarizeLine(stats, { served: servedVersion, shadow: shadowVersion, ms: stageMs.shadow }));
      shadowStats = { ...stats, servedVersion, shadowVersion };
    } catch (e) {
      mark('shadow', tShadow);
      console.error('[selection.shadow] compare failed, generation unaffected:', e.message);
    }
  }

  // Stage 4c: W4-013 (B5) — the novelty quota.
  //
  // This is the ONE place the pipeline has ever actually SET a discovery ratio. Before it, the
  // discovery share was emergent: candidates were fetched, given a flat `W.discovery` bonus, and
  // whatever survived MMR survived. That is a fine default and it is still what happens whenever
  // the bandit abstains — the quota is a CEILING laid over the existing ranking, never a floor
  // and never a re-ranking.
  //
  // It is applied BEFORE MMR rather than after, because trimming afterwards would leave holes:
  // dropping three discovery picks from a finished playlist of k serves k−3 tracks. Cutting the
  // candidate pool instead lets MMR fill those slots with the next-best familiar tracks, so the
  // listener gets a full playlist either way. Discovery candidates are ranked by the score they
  // just earned, so a quota of 3 keeps the three BEST gambles rather than the first three seen.
  let noveltyStats = null;
  let selectable = scored;
  if (novelty.enabled(process.env)) {
    const tNovelty = Date.now();
    noveltyStats = await _planNoveltyQuota({ userId, targets, k, scored });
    if (noveltyStats.budget != null) {
      const discovery = scored.filter((s) => s.track?.isDiscovery);
      if (discovery.length > noveltyStats.budget) {
        const keep = new Set(
          [...discovery].sort((a, b) => b.total - a.total).slice(0, noveltyStats.budget).map((s) => s.track),
        );
        selectable = scored.filter((s) => !s.track?.isDiscovery || keep.has(s.track));
      }
      noveltyStats.kept = Math.min(discovery.length, noveltyStats.budget);
    }
    mark('novelty', tNovelty);
  }

  // Stage 5: MMR diversity selection.
  t = Date.now();
  const picks = select(selectable, { k });
  mark('mmr', t);

  // Stage 6: trajectory sequencing (W4-008). MMR chose WHICH tracks; this chooses the ORDER,
  // laying them along the arc `wellbeingRegulator` attached to the targets — meet the listener
  // where they are, then guide them. STRICTLY order-only: the planner returns a permutation of
  // `picks` and nothing else, so the band, the ladder and the serve ledger all still decide
  // membership exactly as they did. With no arc in the targets (a Manual request with every band
  // null) it is a no-op and the pick order comes through untouched.
  t = Date.now();
  const { ordered, stats: trajectory } = planTrajectory(picks, {
    targets,
    // S11: one flag for the whole trajectory feature, shared with the regulator that publishes
    // the arc. Read per call so no restart is needed, matching the WAVE4_SCORING_V2_DISABLED seam.
    disabled: Boolean(process.env[TRAJECTORY_DISABLED]),
  });
  mark('trajectory', t);

  stageMs.total = Date.now() - t0;
  return {
    tracks: ordered.map(p => p.track),
    // W4-013 (B7) · the serve-time half of the write lane. NULL unless the overlay is switched
    // on — the same posture as the novelty telemetry, so a deployment that has not opted in sees
    // the pre-W4-013 return shape exactly. See `_gradientsOf` for why it is captured HERE.
    gradients: personal.stats ? _gradientsOf(ordered, personal.table) : null,
    telemetry: {
      poolSize: pool.length,
      afterFilters: filtered.length,
      relaxLevel,
      degraded,
      featured,
      banded: banded.length,
      bandWidened,
      // W4-008: which arc the playlist was laid along, and how well it fits. `planned:false`
      // means there was no arc to follow (or the kill switch is set), not that one failed.
      trajectory: {
        archetype: trajectory.archetype,
        planned: trajectory.planned,
        cost: trajectory.cost,
        folded: trajectory.folded,
      },
      stageMs,
      // W4-013: present ONLY when the bandit is switched on, so the default telemetry object is
      // unchanged for every deployment that has not opted in (the S12 shadow precedent).
      ...(noveltyStats ? { novelty: noveltyStats } : {}),
      // W4-013 (B7): likewise present ONLY when the overlay is switched on.
      ...(personal.stats ? { personal: personal.stats } : {}),
      // Present ONLY under SCORING_V2_SHADOW, so the default telemetry object is unchanged.
      ...(shadowStats ? { shadow: shadowStats } : {}),
    },
  };
}

/**
 * W4-013 · resolve this generation's novelty budget, or abstain.
 *
 * Every abstention is NAMED rather than collapsed into a bare null, because the three reasons are
 * operationally different things: `no-bucket` means this generation has no context to learn about
 * (a Manual request with no band), `no-evidence` means the bandit has never seen this context, and
 * `error` means the store is unwell. A dark-launched feature whose telemetry cannot tell those
 * apart is indistinguishable from one that is silently doing nothing.
 *
 * Wrapped, and deliberately so: this is an optional overlay on the serving path, and a learner
 * that can turn a Mongo hiccup into a failed playlist is a liability, not an improvement (the
 * `shadowCompare` precedent one stage above).
 */
async function _planNoveltyQuota({ userId, targets, k, scored }) {
  const considered = scored.reduce((n, s) => n + (s.track?.isDiscovery ? 1 : 0), 0);
  const base = { budget: null, theta: null, reason: null, considered, kept: 0 };

  const bucket = bucketOf({
    stateId: targets.stateId ?? null,
    targetBand: targets.tempoBand ?? null,
    hourOfDay: targets.hourOfDay ?? null,
  });
  if (!bucket || !userId) return { ...base, reason: 'no-bucket' };

  try {
    const posterior = await rewardRepo.readNoveltyPosterior({ userId, bucket });
    const plan = novelty.planNovelty({ posterior, k, rng: Math.random });
    return { ...base, budget: plan.budget, theta: plan.theta, reason: plan.reason };
  } catch (e) {
    console.error('[selection.novelty] posterior read failed, generation unaffected:', e.message);
    return { ...base, reason: 'error' };
  }
}

/**
 * W4-013 (B7) · resolve this listener's scoring overlay, or serve the global table.
 *
 * Returns `{weights, table, stats}`:
 *   · `weights` is what `scoreTrack` should use — NULL means "use your own defaults", which is
 *     the cold-start path and costs the scorer nothing;
 *   · `table` is the weight table actually in force either way, which the gradient capture needs
 *     (a gradient centred on weights that did not rank the track points the wrong direction);
 *   · `stats` is telemetry, and is NULL when the feature is off so the returned telemetry object
 *     stays byte-identical for every deployment that has not opted in.
 *
 * Every abstention is NAMED, for the reason the novelty stage names its own: `cold-start` means
 * this listener has no row, `no-evidence` means they have one that has decayed back into global
 * weights, and `error` means the store is unwell. A dark-launched learner whose telemetry cannot
 * tell those apart is indistinguishable from one that is silently doing nothing.
 *
 * Wrapped, deliberately: an optional overlay that can turn a Mongo hiccup into a failed playlist
 * is a liability, not an improvement (the `shadowCompare` / novelty precedent).
 */
async function _resolveOverlay({ userId, targets, now }) {
  const { weights: table, legacy } = resolveWeights({ targets });
  // The S11 scoring kill-switch restores the pre-W4-007 behaviour WHOLE. An overlay still running
  // on top of the legacy tables would make that promise false, and §M.15's re-allocation is not
  // even defined over them (they do not sum to 1).
  if (legacy || !personalization.enabled(process.env)) return { weights: null, table, stats: null };

  const base = { applied: false, reason: null, updates: 0 };
  if (!userId) return { weights: null, table, stats: { ...base, reason: 'no-user' } };

  try {
    const row = await personalWeightsRepo.readWeights({ userId });
    if (!row) return { weights: null, table, stats: { ...base, reason: 'cold-start' } };

    const deltas = personalization.effectiveDeltas(row, { now });
    const overlaid = personalization.overlay(table, deltas);
    // Identity, not equality: `overlay` hands back the caller's OWN object when there is nothing
    // to apply, which is what makes the dormancy invariant exact rather than approximate.
    if (overlaid === table) {
      return { weights: null, table, stats: { ...base, reason: 'no-evidence', updates: row.updates } };
    }
    const stats = { applied: true, reason: null, updates: row.updates };
    console.warn(personalization.telemetryLine({ deltas, reason: null, updates: row.updates }));
    return { weights: overlaid, table: overlaid, stats };
  } catch (e) {
    console.error('[selection.personal] overlay read failed, generation unaffected:', e.message);
    return { weights: null, table, stats: { ...base, reason: 'error' } };
  }
}

/**
 * W4-013 (B7) · §M.15's `∂` for each track that was actually SERVED.
 *
 * Captured here, at serve time, for the same reason B5 captures the discovery role here: by the
 * time a `playback_event` names a track, nothing remembers what the ranking thought of it. The
 * gradient is a residual of the scorer's own output against the weights in force, and neither of
 * those survives the request.
 *
 * Only the served tracks, so the list is bounded by `k` rather than by the candidate pool — a
 * pool can be thousands of rows and none of the ones nobody heard can ever produce a reward.
 *
 * Keyed the way the client names tracks (`canonicalKey`, else the shared `recordingKeyOf`
 * projection), so `playWindow` can look one up from a `playback_event` without a fourth opinion
 * about what a track is called.
 */
function _gradientsOf(picks, table) {
  const out = [];
  for (const p of picks) {
    const track = p?.track;
    if (!track) continue;
    const key = typeof track.canonicalKey === 'string' && track.canonicalKey
      ? track.canonicalKey
      : recordingKeyOf(track);
    if (typeof key !== 'string' || !key) continue;
    const g = personalization.gradientOf({ terms: p.terms, weights: table });
    if (g) out.push({ key, g });
  }
  return out;
}

module.exports = { selectPlaylist };
