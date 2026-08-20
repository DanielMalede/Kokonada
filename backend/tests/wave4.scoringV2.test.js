'use strict';

// Wave-4 W4-007 — the B2 scoring & similarity rebuild (D18).
//
// What this suite pins, in the order the data flows:
//   1. `featuresOf` — the ONE feature projection — now carries measurement PROVENANCE
//      (`source` + `confidence`) alongside the values, so every consumer can weigh a
//      measured value differently from an LLM guess instead of treating them as equals.
//   2. `translate` marks a CADENCE-locked target additively, so the scorer can tell a step
//      cadence (never freely folded) from an ordinary tempo centre (folded).
//   3. `score.js` v2 — normalised weights, all-Gaussian kernels with explicit sigma, and the
//      confidence-mass mechanism that kills "one measured dim scores 1.0" and subsumes the
//      old flat unknown-feature penalty.
//   4. `mmr._featureSim` v2 — all five dims, folded tempo, coefficients summing to 1.
//   5. `WAVE4_SCORING_V2_DISABLED` — the S11 escape hatch back to v1, verified LOAD-BEARING
//      (v1 and v2 must actually disagree, or the flag is decoration).

process.env.NODE_ENV       = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET     = 'test-jwt-secret-for-tests-only';

const { featuresOf }            = require('../app/services/features/featureProvider');
const { translate }             = require('../app/services/biosonic/translate');
const { scoreTrack, _resetWeights, SOURCE_CONFIDENCE, MISSING_MASS } = require('../app/services/selection/score');
const { defaultSimilarity, _featureSim } = require('../app/services/selection/mmr');
const { withinBand }            = require('../app/services/selection/biosonicBand');
const { buildVector }           = require('../app/services/vector/embedding');

const DISABLE = 'WAVE4_SCORING_V2_DISABLED';
const withV1 = (fn) => {
  process.env[DISABLE] = '1';
  try { return fn(); } finally { delete process.env[DISABLE]; }
};

afterEach(() => { delete process.env[DISABLE]; _resetWeights(); });

// ── 1 · the ONE projection now carries provenance ────────────────────────────────────────

describe('W4-007 · featureProvider.featuresOf carries measurement provenance', () => {
  const doc = {
    recordingKey: 'mbid:abc', bpm: 122, energy: 0.6, valence: 0.55,
    acousticness: 0.2, danceability: 0.7, loudness: -8,
    source: 'acousticbrainz', confidence: 0.85, vibeTags: ['warm'], canonicalKey: 'k',
  };

  it('projects source + confidence alongside the five judged dims', () => {
    const f = featuresOf(doc);
    expect(f).toEqual({
      bpm: 122, energy: 0.6, valence: 0.55, acousticness: 0.2, danceability: 0.7,
      source: 'acousticbrainz', confidence: 0.85,
    });
  });

  it('still returns null for an absent doc — withinBand\'s featureless-passes contract is unchanged', () => {
    expect(featuresOf(null)).toBeNull();
    expect(featuresOf(undefined)).toBeNull();
  });

  it('leaks nothing else from the doc — the projection stays the narrow contract it is', () => {
    const f = featuresOf(doc);
    expect(f).not.toHaveProperty('vibeTags');
    expect(f).not.toHaveProperty('recordingKey');
    expect(f).not.toHaveProperty('loudness'); // never judged by the band or the scorer
    expect(Object.keys(f).sort()).toEqual(
      ['acousticness', 'bpm', 'confidence', 'danceability', 'energy', 'source', 'valence'],
    );
  });

  it('tolerates a doc with no provenance at all (legacy rows, hand-built fixtures)', () => {
    const f = featuresOf({ bpm: 100, energy: 0.5 });
    expect(f.source).toBeUndefined();
    expect(f.confidence).toBeUndefined();
    expect(f.bpm).toBe(100);
  });

  // The mission requires every consumer of the projection to be swept in the same change.
  // These are the four that read `track.features`, each pinned against the ENRICHED shape.
  it('CONSUMER SWEEP · withinBand judges the enriched projection exactly as it judged the slim one', () => {
    const targets = { bpmCenter: 122, bpmWidth: 20, energyFloor: 0.4, energyCeiling: 0.8, confidence: 0.9 };
    const slim = { bpm: 122, energy: 0.6, valence: 0.55, acousticness: 0.2, danceability: 0.7 };
    expect(withinBand({ features: featuresOf(doc) }, targets)).toBe(withinBand({ features: slim }, targets));
    expect(withinBand({ features: featuresOf(doc) }, targets)).toBe(true);
  });

  it('CONSUMER SWEEP · buildVector ignores the provenance keys — the embedding is unchanged', () => {
    // Compared against the SAME dims with loudness absent, because `featuresOf` does not
    // project loudness. Deliberately not `loudness: null`: that is a different input to
    // buildVector today (W4-D21 — its `fin()` coerces null to 0 dB instead of abstaining to
    // the neutral midpoint), and pinning the two as equal here would quietly bless the bug.
    const slim = { bpm: 122, energy: 0.6, valence: 0.55, acousticness: 0.2, danceability: 0.7 };
    expect(buildVector(featuresOf(doc), [])).toEqual(buildVector(slim, []));
  });

  it('CONSUMER SWEEP · MMR similarity is unchanged by the provenance keys alone', () => {
    const a = { artist: 'A', features: featuresOf(doc) };
    const b = { artist: 'B', features: featuresOf({ ...doc, bpm: 130, source: 'llm', confidence: 0.4 }) };
    const aSlim = { artist: 'A', features: { bpm: 122, energy: 0.6, valence: 0.55, acousticness: 0.2, danceability: 0.7 } };
    const bSlim = { artist: 'B', features: { bpm: 130, energy: 0.6, valence: 0.55, acousticness: 0.2, danceability: 0.7 } };
    expect(defaultSimilarity(a, b)).toBeCloseTo(defaultSimilarity(aSlim, bSlim), 12);
  });
});

// ── 2 · the cadence anchor is marked at its source ───────────────────────────────────────

describe('W4-007 · translate marks a CADENCE-LOCKED target (additive key)', () => {
  // translate's real signature: vitals live under `live`, and the clock is an explicit
  // hourOfDay parameter (S9 — no engine reads Date.now() for itself).
  const base = { baselines: { rhrMedian: 60, rhrMAD: 5 }, hourOfDay: 12 };
  const at = (activity) => translate({ ...base, live: { heartRate: 70, activity } });

  it('flags exactly the three locomotion activities translate cadence-locks', () => {
    for (const activity of ['walking', 'running', 'cycling']) {
      expect(at(activity).cadenceLocked).toBe(true);
    }
  });

  it('does NOT flag an exertion whose centre is derived from energy, not footfall', () => {
    // `activityDriven` is TRUE for all of these — which is exactly why it is the wrong
    // predicate for the fold. A workout's bpmCenter is a physiology/intent blend with no
    // footfall in it; 'resting' is activity-driven too and is obviously not a cadence.
    for (const activity of ['workout', 'strength', 'swimming', 'resting', 'winding down']) {
      const t = at(activity);
      expect(t.cadenceLocked).toBe(false);
      expect(t.activityDriven).toBe(true);
    }
  });

  it('is false for a plain mood request with no activity at all', () => {
    expect(at(null).cadenceLocked).toBe(false);
  });

  it('locks the centre to the published cadence when it flags one (the flag is not cosmetic)', () => {
    expect(at('running').bpmCenter).toBe(162);
    expect(at('walking').bpmCenter).toBe(118);
    expect(at('cycling').bpmCenter).toBe(145);
  });
});

// ── 3 · the projection's NULLs must abstain, not read as zero ─────────────────────────────

describe('W4-007 · a partially-measured track abstains per-dim instead of scoring as zero', () => {
  // AudioFeature defaults every unmeasured dim to `null` (schema), and the adapters
  // deliberately leave dims they cannot measure null rather than fabricating them. So
  // `{bpm: null, energy: 0.7}` is not an edge case — it is the store's ordinary output.
  const partial = { bpm: null, energy: 0.7, valence: 0.6, acousticness: null, danceability: null };
  const targets = { bpmCenter: 120, bpmWidth: 20, energyFloor: 0.5, energyCeiling: 0.9, valenceTarget: 0.6, confidence: 0.9 };

  it('withinBand KEEPS it: an unmeasured tempo is no evidence, not a tempo of 0 bpm', () => {
    // Before W4-007 this returned false — `Number(null)` is 0, 0 is finite, and 0 is outside
    // every band — so knowing MORE about a track (energy measured, tempo not) got it dropped
    // where a fully featureless track passed. The band is un-relaxable, so the ladder never
    // recovered those tracks. Same coercion class as W4-D15, one module over.
    expect(withinBand({ features: partial }, targets)).toBe(true);
    expect(withinBand({ features: null }, targets)).toBe(true); // unchanged featureless contract
  });

  it('withinBand still judges the dims that ARE measured — abstention is per-dim, not per-track', () => {
    expect(withinBand({ features: { ...partial, energy: 0.05 } }, targets)).toBe(false); // energy out of band
    expect(withinBand({ features: { bpm: 40, energy: null } }, targets)).toBe(false);    // tempo out of band
  });

  it('withinBand treats blank strings and booleans as unmeasured too, never as 0', () => {
    for (const bad of ['', '   ', false, true, null, undefined, NaN]) {
      expect(withinBand({ features: { bpm: bad, energy: 0.7 } }, targets)).toBe(true);
    }
  });

  it('scoreTrack gives the unmeasured tempo the PRIOR, not a catastrophic mismatch', () => {
    const onTarget = { bpm: 120, energy: 0.7, valence: 0.6, acousticness: null, danceability: null };
    const ctx = { targets, maxAffinity: 10, allowGenres: [], exposure: new Map() };
    const p = scoreTrack({ id: 'p', canonicalKey: 'kp', affinity: 5, features: partial }, ctx);
    const o = scoreTrack({ id: 'o', canonicalKey: 'ko', affinity: 5, features: onTarget }, ctx);

    // Measured-and-on-target still wins — abstention is not a free pass.
    expect(o.terms.featureDistance).toBeGreaterThan(p.terms.featureDistance);
    // But the unmeasured track is nowhere near the floor a 0-bpm reading produced (~0.0001
    // on the tempo dim). It sits between the prior and the on-target fit.
    expect(p.terms.featureDistance).toBeGreaterThan(0.5);
    expect(p.terms.featureMass).toBeLessThan(o.terms.featureMass);
  });
});

// ── 4 · score v2: normalised weights, Gaussian kernels, confidence mass ───────────────────

describe('W4-007 · score v2 — normalised weights (§M.9 Sum w = 1 per mode)', () => {
  const perfect = (extra = {}) => ({
    id: 'x', canonicalKey: 'kx', affinity: 10, genres: ['pop'], isDiscovery: true,
    features: { bpm: 120, energy: 0.6, valence: 0.6, danceability: 1, source: 'api', confidence: 1 },
    ...extra,
  });
  const targets = { bpmCenter: 120, bpmWidth: 20, energyFloor: 0.4, energyCeiling: 0.8, valenceTarget: 0.6, confidence: 0.9 };
  const ctx = { targets, maxAffinity: 10, allowGenres: ['pop'], exposure: new Map() };

  it('a track that maxes EVERY term scores exactly 1 in mood mode — that is Sum w = 1, measured', () => {
    // taste 1 (affinity == maxAffinity) · fit 1 (dead on every constrained dim, full mass)
    // · genre 1 (allow-list hit) · discovery 1. Nothing else can contribute, so the total
    // IS the weight sum. Before v2 this came to 0.95 in mood mode and 1.20 under intent —
    // the same score meant different things in the two modes.
    expect(scoreTrack(perfect(), ctx).total).toBeCloseTo(1, 10);
  });

  it('a track that maxes EVERY term scores exactly 1 in INTENT mode too', () => {
    const intent = { ...targets, activityDriven: true };
    expect(scoreTrack(perfect(), { ...ctx, targets: intent, allowGenres: [] }).total).toBeCloseTo(1, 10);
  });

  it('the total is bounded: never above 1, never below minus (w_exposure x 2)', () => {
    const heavy = new Map([['kx', Array.from({ length: 40 }, () => ({ moodKey: 'uplift', servedAt: new Date() }))]]);
    const worst = scoreTrack(
      { id: 'x', canonicalKey: 'kx', affinity: 0, genres: ['metal'], features: { bpm: 40, energy: 0.01, valence: 0.01, source: 'api', confidence: 1 } },
      { ...ctx, exposure: heavy, targetMoodKey: 'uplift' },
    );
    expect(worst.total).toBeGreaterThanOrEqual(-0.8 - 1e-9);
    expect(worst.total).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('FUZZ · 300 seeded rounds of hostile input stay finite and inside the bounds (S8)', () => {
    let seed = 20260820;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const junk = [null, undefined, NaN, Infinity, -Infinity, '', '  ', false, true, [], {}, '120', -1, 1e9];
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

    for (let i = 0; i < 300; i++) {
      const f = {
        bpm: rnd() < 0.4 ? pick(junk) : rnd() * 300,
        energy: rnd() < 0.4 ? pick(junk) : rnd(),
        valence: rnd() < 0.4 ? pick(junk) : rnd(),
        acousticness: rnd() < 0.4 ? pick(junk) : rnd(),
        danceability: rnd() < 0.4 ? pick(junk) : rnd(),
        source: pick(['api', 'llm', 'acousticbrainz', undefined, 'garbage']),
        confidence: rnd() < 0.5 ? pick(junk) : rnd(),
      };
      const t = {
        bpmCenter: rnd() < 0.3 ? pick(junk) : rnd() * 250,
        bpmWidth: rnd() < 0.3 ? pick(junk) : rnd() * 40,
        energyFloor: rnd() < 0.3 ? pick(junk) : rnd(),
        energyCeiling: rnd() < 0.3 ? pick(junk) : rnd(),
        valenceTarget: rnd() < 0.3 ? pick(junk) : rnd(),
        acousticnessBias: rnd() < 0.3 ? pick(junk) : rnd() * 0.4,
        confidence: rnd(),
        activityDriven: rnd() < 0.5,
        cadenceLocked: rnd() < 0.5,
      };
      const out = scoreTrack(
        { id: 'f' + i, canonicalKey: 'k' + i, affinity: rnd() < 0.3 ? pick(junk) : rnd() * 10, genres: rnd() < 0.3 ? null : ['pop'], features: rnd() < 0.15 ? null : f },
        { targets: t, maxAffinity: rnd() < 0.2 ? 0 : 10, allowGenres: ['pop'], exposure: new Map() },
      );
      expect(Number.isFinite(out.total)).toBe(true);
      expect(out.total).toBeGreaterThanOrEqual(-0.8 - 1e-9);
      expect(out.total).toBeLessThanOrEqual(1 + 1e-9);
      for (const [k, v] of Object.entries(out.terms)) {
        if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
        expect(k).not.toMatch(/heartRate|hrv|bpmActual/i); // zero-knowledge: no vitals in terms
      }
    }
  });

  it('is monotone in featureFit WITHIN an octave: closing on the target never lowers the total', () => {
    // Scoped to one octave on purpose. Across octaves the metric is deliberately NOT
    // monotone in raw bpm — that is the fold doing its job, and the next test pins it.
    let prev = -Infinity;
    for (const bpm of [90, 95, 100, 105, 110, 115, 120]) {
      const out = scoreTrack({ id: 'm', canonicalKey: 'km', affinity: 5, features: { bpm, energy: 0.6, valence: 0.6, source: 'api', confidence: 1 } }, ctx);
      expect(out.total).toBeGreaterThan(prev);
      prev = out.total;
    }
  });

  it('is deliberately NOT monotone in raw bpm across the octave — 60 ties 120 against a 120 centre', () => {
    const at = (bpm) => scoreTrack({ id: 'o', canonicalKey: 'ko', affinity: 5, features: { bpm, energy: 0.6, valence: 0.6, source: 'api', confidence: 1 } }, ctx).total;
    expect(at(60)).toBeCloseTo(at(120), 10);   // the fold: same groove, halved reading
    expect(at(90)).toBeLessThan(at(60));       // and 90 — a genuine mismatch — loses to both
  });
});

describe('W4-007 · score v2 — the confidence-mass mechanism (kills one-measured-dim-scores-1.0)', () => {
  const targets = { bpmCenter: 120, bpmWidth: 20, energyFloor: 0.4, energyCeiling: 0.8, valenceTarget: 0.6, confidence: 0.9 };
  const ctx = { targets, maxAffinity: 10, allowGenres: [], exposure: new Map() };
  const fit = (features) => scoreTrack({ id: 'a', canonicalKey: 'ka', affinity: 5, features }, ctx).terms;

  it('ONE measured dim, dead on target, can no longer claim a perfect fit', () => {
    const oneDim = fit({ bpm: 120, energy: null, valence: null, source: 'api', confidence: 1 });
    expect(oneDim.featureDistance).toBeLessThan(1);
    // The target constrains bpm/energy/valence, so their DIM_WEIGHTS renormalise to
    // .35/.30/.20 over .85. Tempo is measured and perfect (1); the two unmeasured dims sit
    // at the prior. The fit is that weighted mean, and nothing about it is a magic number.
    const wBpm = 0.35 / 0.85;
    expect(oneDim.featureDistance).toBeCloseTo(wBpm * 1 + (1 - wBpm) * 0.5, 10);
    expect(oneDim.featureMass).toBeCloseTo(wBpm * 1 + (1 - wBpm) * 0.3, 10);
    expect(oneDim.featureMass).toBeLessThan(1);
  });

  it('a fully measured on-target track DOES reach a perfect fit at full mass', () => {
    const all = fit({ bpm: 120, energy: 0.6, valence: 0.6, source: 'api', confidence: 1 });
    expect(all.featureDistance).toBeCloseTo(1, 10);
    expect(all.featureMass).toBeCloseTo(1, 10);
  });

  it('a featureless track sits at the prior with MISSING_MASS — the flat penalty is subsumed', () => {
    const none = fit(null);
    expect(none.featureDistance).toBeCloseTo(0.5, 10);
    expect(none.featureMass).toBeCloseTo(MISSING_MASS, 10);
  });

  it('ranks measured-on-target > partially-measured > featureless > measured-and-wrong', () => {
    const onTarget = fit({ bpm: 120, energy: 0.6, valence: 0.6, source: 'api', confidence: 1 }).featureDistance;
    const partial  = fit({ bpm: 120, energy: null, valence: null, source: 'api', confidence: 1 }).featureDistance;
    const none     = fit(null).featureDistance;
    const wrong    = fit({ bpm: 40, energy: 0.05, valence: 0.05, source: 'api', confidence: 1 }).featureDistance;
    expect(onTarget).toBeGreaterThan(partial);
    expect(partial).toBeGreaterThan(none);
    expect(none).toBeGreaterThan(wrong);
  });

  it('an UNKNOWN track outranks a KNOWN-WRONG one — ignorance is a better bet than a bad match', () => {
    const none  = fit(null).featureDistance;
    const wrong = fit({ bpm: 200, energy: 0.05, valence: 0.05, source: 'api', confidence: 1 }).featureDistance;
    expect(none).toBeGreaterThan(wrong);
  });

  it('SOURCE TIER · a measured value outweighs an LLM guess at the same fit', () => {
    const api = fit({ bpm: 120, energy: 0.6, valence: 0.6, source: 'api' });
    const abz = fit({ bpm: 120, energy: 0.6, valence: 0.6, source: 'acousticbrainz' });
    const llm = fit({ bpm: 120, energy: 0.6, valence: 0.6, source: 'llm' });
    expect(api.featureMass).toBeGreaterThan(abz.featureMass);
    expect(abz.featureMass).toBeGreaterThan(llm.featureMass);
    // The mass ordering alone would be a decorative pin — it is reported, not ranked on.
    // What matters is that provenance moves the FIT, which is what the total is built from.
    expect(api.featureDistance).toBeGreaterThan(abz.featureDistance);
    expect(abz.featureDistance).toBeGreaterThan(llm.featureDistance);
    expect(SOURCE_CONFIDENCE).toEqual({ api: 1, acousticbrainz: 0.85, llm: 0.7 });
  });

  it('SOURCE TIER · an explicit per-doc confidence beats the tier default (it is the finer fact)', () => {
    const capped = fit({ bpm: 120, energy: 0.6, valence: 0.6, source: 'llm', confidence: 0.3 });
    const tier   = fit({ bpm: 120, energy: 0.6, valence: 0.6, source: 'llm' });
    expect(capped.featureMass).toBeLessThan(tier.featureMass);
  });

  it('a low-confidence measurement is pulled toward the prior, not toward zero', () => {
    // The whole point of mass: a 0.3-confidence LLM guess that a track is dead wrong should
    // not condemn it as hard as a measured value would. It shrinks toward "no opinion".
    const shaky    = fit({ bpm: 40, energy: 0.05, valence: 0.05, source: 'llm', confidence: 0.3 }).featureDistance;
    const measured = fit({ bpm: 40, energy: 0.05, valence: 0.05, source: 'api', confidence: 1 }).featureDistance;
    expect(shaky).toBeGreaterThan(measured);
    expect(shaky).toBeLessThan(0.5); // still a demerit — it just is not a conviction
  });

  it('a dim the TARGET does not constrain is excluded outright, not counted as missing', () => {
    // acousticnessBias 0 means "no acoustic preference", not "we failed to measure it".
    // A track with no acousticness must therefore be judged identically either way.
    const withA    = fit({ bpm: 120, energy: 0.6, valence: 0.6, acousticness: 0.9, source: 'api', confidence: 1 });
    const withoutA = fit({ bpm: 120, energy: 0.6, valence: 0.6, acousticness: null, source: 'api', confidence: 1 });
    expect(withA.featureDistance).toBeCloseTo(withoutA.featureDistance, 12);
    expect(withA.featureMass).toBeCloseTo(withoutA.featureMass, 12);
  });
});

describe('W4-007 · score v2 — Gaussian kernels with explicit sigma', () => {
  const ctx = (targets) => ({ targets, maxAffinity: 10, allowGenres: [], exposure: new Map() });
  const fitOf = (features, targets) => scoreTrack({ id: 'a', canonicalKey: 'ka', affinity: 5, features }, ctx(targets)).terms.featureDistance;

  it('ENERGY · sigma is the band half-width, so a WIDE band forgives what a NARROW one punishes', () => {
    const off = { energy: 0.75, source: 'api', confidence: 1 };
    const wide   = fitOf(off, { energyFloor: 0.1, energyCeiling: 0.9 });   // half-width 0.40
    const narrow = fitOf(off, { energyFloor: 0.45, energyCeiling: 0.55 }); // half-width 0.05
    expect(wide).toBeGreaterThan(narrow);
    // The old kernel used only the midpoint, so both of these scored identically (0.5 mid,
    // |0.75-0.5| x 2 = 0.5 either way) — the band width simply had no say in the fit.
  });

  it('ENERGY · a track at the band EDGE lands at exp(-1/2), one sigma out, in any band', () => {
    for (const [floor, ceiling] of [[0.4, 0.8], [0.1, 0.9], [0.55, 0.65]]) {
      expect(fitOf({ energy: ceiling, source: 'api', confidence: 1 }, { energyFloor: floor, energyCeiling: ceiling }))
        .toBeCloseTo(Math.exp(-0.5), 10);
    }
  });

  it('ENERGY · a degenerate (zero-width) band cannot divide by zero', () => {
    const v = fitOf({ energy: 0.5, source: 'api', confidence: 1 }, { energyFloor: 0.5, energyCeiling: 0.5 });
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThan(0);
  });

  it('VALENCE · sigma 0.25 (§M.9), so half a scale away is exp(-2), not a linear 0.5', () => {
    expect(fitOf({ valence: 1.0, source: 'api', confidence: 1 }, { valenceTarget: 0.5 })).toBeCloseTo(Math.exp(-2), 10);
  });

  it('TEMPO · folds the octave for an ordinary tempo centre: 87 scores like 174 against 174', () => {
    const t = { bpmCenter: 174, bpmWidth: 20 };
    expect(fitOf({ bpm: 87, source: 'api', confidence: 1 }, t)).toBeCloseTo(fitOf({ bpm: 174, source: 'api', confidence: 1 }, t), 10);
  });

  it('TEMPO · a CADENCE anchor does NOT fold for free: 81 loses to 162 against a 162-spm run', () => {
    const run = { bpmCenter: 162, bpmWidth: 20, activityDriven: true, cadenceLocked: true };
    const onCadence = fitOf({ bpm: 162, source: 'api', confidence: 1 }, run);
    const halfTime  = fitOf({ bpm: 81, source: 'api', confidence: 1 }, run);
    const offBeat   = fitOf({ bpm: 110, source: 'api', confidence: 1 }, run);
    expect(onCadence).toBeGreaterThan(halfTime);
    expect(halfTime).toBeGreaterThan(offBeat); // still a contender — the artefact is real
  });

  it('TEMPO · the SAME 162 centre folds freely when it is not cadence-locked', () => {
    const notLocked = { bpmCenter: 162, bpmWidth: 20 };
    expect(fitOf({ bpm: 81, source: 'api', confidence: 1 }, notLocked))
      .toBeCloseTo(fitOf({ bpm: 162, source: 'api', confidence: 1 }, notLocked), 10);
  });
});

// ── 5 · MMR similarity v2 ────────────────────────────────────────────────────────────────

describe('W4-007 · mmr._featureSim v2 — five dims, folded tempo, coefficients summing to 1', () => {
  const f = (o) => ({ bpm: 120, energy: 0.5, valence: 0.5, acousticness: 0.5, danceability: 0.5, ...o });

  it('two identical tracks are perfectly similar; the coefficients therefore sum to 1', () => {
    expect(_featureSim(f({}), f({}))).toBeCloseTo(1, 12);
  });

  it('judges acousticness and danceability, which v1 ignored entirely', () => {
    // v1 read only bpm/energy/valence, so a solo acoustic ballad and a club edit with the
    // same tempo and energy came back as identical — and MMR then suppressed one of them
    // for being a duplicate of the other.
    expect(_featureSim(f({ acousticness: 0.95 }), f({ acousticness: 0.05 }))).toBeLessThan(1);
    expect(_featureSim(f({ danceability: 0.95 }), f({ danceability: 0.05 }))).toBeLessThan(1);
  });

  it('87 and 174 bpm are NEAR-EQUIVALENT in similarity — the same groove, halved reading', () => {
    // The mission property pin. Similarity has no cadence anchor to protect: it is comparing
    // two tracks with each other, so the beat-tracker artefact is pure noise here.
    expect(_featureSim(f({ bpm: 87 }), f({ bpm: 174 }))).toBeCloseTo(1, 10);
  });

  it('a genuine tempo gap is still a difference — the fold is not a blanket amnesty', () => {
    expect(_featureSim(f({ bpm: 90 }), f({ bpm: 130 }))).toBeLessThan(0.95);
  });

  it('is symmetric, bounded in [0,1], and finite for every hostile input (S8)', () => {
    let seed = 4242;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const junk = [null, undefined, NaN, Infinity, '', false, {}, [], '110', -5];
    const pick = () => junk[Math.floor(rnd() * junk.length)];
    for (let i = 0; i < 200; i++) {
      const a = { bpm: rnd() < 0.4 ? pick() : rnd() * 260, energy: rnd() < 0.4 ? pick() : rnd(), valence: rnd() < 0.4 ? pick() : rnd(), acousticness: rnd() < 0.4 ? pick() : rnd(), danceability: rnd() < 0.4 ? pick() : rnd() };
      const b = { bpm: rnd() < 0.4 ? pick() : rnd() * 260, energy: rnd() < 0.4 ? pick() : rnd(), valence: rnd() < 0.4 ? pick() : rnd(), acousticness: rnd() < 0.4 ? pick() : rnd(), danceability: rnd() < 0.4 ? pick() : rnd() };
      const ab = _featureSim(a, b);
      const ba = _featureSim(b, a);
      if (ab === null) { expect(ba).toBeNull(); continue; }
      expect(Number.isFinite(ab)).toBe(true);
      expect(ab).toBeGreaterThanOrEqual(0);
      expect(ab).toBeLessThanOrEqual(1);
      expect(ab).toBeCloseTo(ba, 12);
    }
  });

  it('abstains (null) when the two share no measured dim — never a fabricated 0 or 1', () => {
    expect(_featureSim({ bpm: 120 }, { energy: 0.5 })).toBeNull();
    expect(_featureSim(null, f({}))).toBeNull();
    expect(_featureSim({}, {})).toBeNull();
  });

  it('renormalises over the dims the pair SHARES, so a partial comparison is still calibrated', () => {
    // Only energy is comparable here, and it matches exactly. That is a perfect similarity
    // ON THE EVIDENCE AVAILABLE — not 1/5 of one.
    expect(_featureSim({ energy: 0.5, bpm: null }, { energy: 0.5, valence: 0.9 })).toBeCloseTo(1, 12);
  });

  it('same-artist stays a HARD 1, ahead of every feature consideration', () => {
    const a = { artist: 'Bonobo', features: f({ bpm: 90 }) };
    const b = { artist: 'bonobo ', features: f({ bpm: 175, energy: 0.05, acousticness: 0.95 }) };
    expect(defaultSimilarity(a, b)).toBe(1);
  });
});

// ── 6 · S11 kill-switch, verified load-bearing ───────────────────────────────────────────

describe('W4-007 · WAVE4_SCORING_V2_DISABLED restores the pre-wave selection behaviour', () => {
  const targets = { bpmCenter: 120, bpmWidth: 20, energyFloor: 0.4, energyCeiling: 0.8, valenceTarget: 0.6, confidence: 0.9 };
  const ctx = { targets, maxAffinity: 10, allowGenres: ['pop'], exposure: new Map() };
  const track = { id: 'a', canonicalKey: 'ka', affinity: 5, genres: ['pop'], features: { bpm: 120, energy: null, valence: null, source: 'llm', confidence: 0.4 } };

  it('reports which scorer produced a result — the shape is self-describing', () => {
    expect(scoreTrack(track, ctx).terms.scoringVersion).toBe('v2');
    expect(withV1(() => scoreTrack(track, ctx).terms.scoringVersion)).toBe('v1');
  });

  it('LOAD-BEARING · v1 and v2 genuinely disagree on the same track (the flag is not decoration)', () => {
    const v2 = scoreTrack(track, ctx);
    const v1 = withV1(() => scoreTrack(track, ctx));
    expect(v1.total).not.toBeCloseTo(v2.total, 6);
    expect(v2.terms.featureDistance).toBeLessThan(1);
  });

  it('LOAD-BEARING · shows BOTH v1 pathologies this task closes, on the two shapes that trigger them', () => {
    // (a) dims ABSENT from the object: v1 averaged over the dims that happened to be there,
    // so a track with nothing but a dead-on tempo claimed a PERFECT fit and outranked a
    // fully measured track that was merely very good.
    const absent = { id: 'a', canonicalKey: 'ka', affinity: 5, features: { bpm: 120 } };
    expect(withV1(() => scoreTrack(absent, ctx).terms.featureDistance)).toBeCloseTo(1, 10);
    expect(scoreTrack(absent, ctx).terms.featureDistance).toBeLessThan(1);

    // (b) dims present but NULL — the shape AudioFeature actually stores. v1's guard read
    // `Number(null)` as a measured 0, so the same track was scored as having zero energy
    // and zero valence: not a perfect fit but a fabricated terrible one. Both readings were
    // wrong in opposite directions, from one line, depending only on object shape.
    const nulls = { id: 'b', canonicalKey: 'kb', affinity: 5, features: { bpm: 120, energy: null, valence: null } };
    const v1Absent = withV1(() => scoreTrack(absent, ctx).terms.featureDistance);
    const v1Nulls  = withV1(() => scoreTrack(nulls, ctx).terms.featureDistance);
    expect(v1Nulls).toBeLessThan(0.5);
    expect(v1Absent).toBeGreaterThan(v1Nulls + 0.5); // same track, two shapes, wildly apart

    // v2 judges them identically, because they ARE the same track.
    expect(scoreTrack(absent, ctx).terms.featureDistance)
      .toBeCloseTo(scoreTrack(nulls, ctx).terms.featureDistance, 12);
  });

  it('restores v1\'s SUBTRACTED unknown penalty, which v2 reports but never subtracts', () => {
    const v1 = withV1(() => scoreTrack({ ...track, features: null }, ctx));
    expect(v1.terms.unknownFeaturePenalty).toBeGreaterThan(0);
    expect(v1.terms.featureMass).toBeNull(); // v1 has no such concept

    const v2 = scoreTrack({ ...track, features: null }, ctx);
    expect(v2.terms.unknownFeaturePenalty).toBeGreaterThan(0); // still reported…
    // …but the total is exactly the weighted sum, with nothing subtracted for it.
    const expected = 0.35 / 0.95 * 0.5 + 0.30 / 0.95 * 0.5 + 0.20 / 0.95 * 1;
    expect(v2.total).toBeCloseTo(expected, 10);
  });

  it('restores v1\'s un-normalised totals: a maxed track scored 0.95 in mood mode, not 1', () => {
    const perfect = { id: 'x', canonicalKey: 'kx', affinity: 10, genres: ['pop'], isDiscovery: true, features: { bpm: 120, energy: 0.6, valence: 0.6, source: 'api', confidence: 1 } };
    expect(withV1(() => scoreTrack(perfect, ctx).total)).toBeCloseTo(0.95, 10);
    expect(scoreTrack(perfect, ctx).total).toBeCloseTo(1, 10);
  });

  it('restores the band\'s 0-bpm coercion too — one flag, one operator-visible behaviour', () => {
    const partial = { features: { bpm: null, energy: 0.7 } };
    expect(withinBand(partial, targets)).toBe(true);
    expect(withV1(() => withinBand(partial, targets))).toBe(false);
  });

  it('restores v1 MMR similarity: the octave fold disappears', () => {
    const a = { bpm: 87, energy: 0.5, valence: 0.5 };
    const b = { bpm: 174, energy: 0.5, valence: 0.5 };
    expect(_featureSim(a, b)).toBeCloseTo(1, 10);            // v2: same groove
    expect(withV1(() => _featureSim(a, b))).toBeLessThan(0.9); // v1: "87 bpm apart"
  });
});
