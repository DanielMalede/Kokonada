'use strict';

// Wave-4 W4-007 (evidence half) — THE GOLDEN-SET HARNESS.
//
// The unit suite (`wave4.scoringV2.test.js`) proves each mechanism on a constructed case. It
// cannot answer the question a reviewer of a scoring rewrite actually has: *what does this do
// to the playlists?* This harness answers it. Fixed personas × a fixed candidate corpus, both
// scorings run END TO END through the real pipeline, and the resulting playlists committed to
// `tests/golden/score.v2.golden.json` so every future change to scoring, similarity, the band
// or the ladder shows up as a reviewable diff instead of as a shrug.
//
// WHAT IS FIXED, AND WHY EACH THING IS FIXED
//   · The corpus is generated from ONE seed through `sim/rng` (§0.4 S9 — no Math.random in a
//     harness whose whole value is reproducibility). Eight feature classes, chosen to be the
//     populations this rebuild is about: fully measured at each provenance tier, PRESENT-BUT-
//     NULL dims (the shape AudioFeature actually stores), single-dim tracks (v1's fabricated
//     perfect fit), and featureless ones.
//   · The personas are LITERAL target objects, not `translate()` output. A golden set that
//     called the bio engine would churn every time the bio engine changed, and would stop
//     isolating the thing under test.
//   · `now` is fixed and the serve ledger is re-seeded per run, so exposure — the one term
//     whose weight normalisation moved — is identical in both conditions.
//
// HOW TO REBASELINE. `GOLDEN_UPDATE=1 npx jest tests/score.v2.golden.test.js` rewrites the
// golden file. Per mission §3 W4-007 every deliberate rebaseline ships the before/after diff
// of that file in the PR body — the diff IS the evidence, so a silent `-u` is not available
// here by design (this is also why the harness uses a committed JSON file rather than a jest
// snapshot: `-u` is one keystroke and rewrites everything at once).
//
// RELATIONSHIP TO S12. The `SCORING_V2_SHADOW` telemetry compares the two SCORERS over the
// candidates that were served — it runs after the band, so it cannot see tracks the band
// dropped. This harness runs the whole pipeline twice, so it sees both: the divergence rows
// come from S12 (its second, realistic exercise), the `banded` counts come from the pipeline
// itself, and the gap between them is precisely the band's null-handling fix.

process.env.NODE_ENV = 'test';

jest.mock('../app/config/redis', () => ({ getRedis: jest.fn(() => null), createConnection: jest.fn() }));
jest.mock('../app/models/ServeEvent', () => {
  const rows = [];
  return {
    __rows: rows,
    insertMany: jest.fn(async (docs) => { docs.forEach(d => rows.push(d)); return docs; }),
    find: jest.fn((query = {}) => ({
      lean: async () => rows.filter(r =>
        (!query.userId || String(r.userId) === String(query.userId)) &&
        (!query.moodKey || r.moodKey === query.moodKey) &&
        (!query.canonicalKey || query.canonicalKey.$in.includes(r.canonicalKey)) &&
        (!query.servedAt || new Date(r.servedAt).getTime() >= new Date(query.servedAt.$gte).getTime())
      ),
    })),
  };
});
jest.mock('../app/services/vector/vectorIndex', () => ({
  getMany: jest.fn().mockResolvedValue(new Map()),
  upsertMany: jest.fn().mockResolvedValue({ upserted: 0 }),
  queryNear: jest.fn().mockResolvedValue([]),
  use: jest.fn(),
}));
jest.mock('../app/repositories/audioFeatureRepo', () => ({
  getMany: jest.fn().mockResolvedValue(new Map()),
  upsertMany: jest.fn(),
  missingKeys: jest.fn(),
}));

const fs = require('fs');
const path = require('path');

const ServeEvent = require('../app/models/ServeEvent');
const featureRepo = require('../app/repositories/audioFeatureRepo');
const { selectPlaylist } = require('../app/services/selection/pipeline');
const { _resetWeights, _featureFitV2 } = require('../app/services/selection/score');
const { withinBand } = require('../app/services/selection/biosonicBand');
const { canonicalKey } = require('../app/services/identity/trackIdentity');
const { createRng } = require('../sim/rng');
const perf = require('../jest/perfBudget');

const DISABLE = 'WAVE4_SCORING_V2_DISABLED';
const SHADOW = 'SCORING_V2_SHADOW';
const GOLDEN_PATH = path.join(__dirname, 'golden', 'score.v2.golden.json');
const NOW = Date.parse('2026-07-02T12:00:00Z');
const CORPUS_SEED = 0xC0FFEE;
const CORPUS_SIZE = 240;

// ── the corpus ────────────────────────────────────────────────────────────────────────────

const GENRES = ['pop', 'rock', 'ambient', 'techno', 'jazz', 'folk', 'hiphop', 'classical', 'indie', 'soul', 'metal', 'lofi'];
const ARTIST_COUNT = 40; // < corpus size on purpose: MMR's same-artist rule must have work to do

// Eight feature classes. The index is the class id used in the golden summary, so a diff can
// say WHICH population moved rather than only that something did.
const CLASS_NAMES = [
  'api-full', 'api-full', 'acousticbrainz-full', 'llm-full',
  'null-tempo', 'null-mid-dims', 'tempo-only', 'featureless',
];

function buildCorpus(size, seed) {
  const rng = createRng(seed);
  const rTempo = rng.fork('tempo');
  const rDims = rng.fork('dims');
  const rGenre = rng.fork('genre');

  const library = [];
  const docs = new Map();
  const classOf = new Map();

  for (let i = 0; i < size; i++) {
    const id = `t${String(i).padStart(3, '0')}`;
    const track = {
      id,
      provider: 'spotify',
      name: `Song ${id}`,
      artist: `Artist ${String(i % ARTIST_COUNT).padStart(2, '0')}`,
      // Distinct affinities: an exact tie in `total` would make the pick order depend on the
      // sort's tie-breaking rather than on the scoring, and a golden file must not encode that.
      affinity: size - i,
      genres: [GENRES[rGenre.int(GENRES.length)], GENRES[rGenre.int(GENRES.length)]]
        .filter((g, n, arr) => arr.indexOf(g) === n),
      uri: `spotify:track:${id}`,
    };
    library.push(track);

    const cls = i % 8;
    classOf.set(id, cls);
    // Log-uniform tempo over the range the corpus actually spans: tempo is perceived
    // multiplicatively, so a uniform draw would over-sample the fast half.
    const bpm = Math.round(55 * Math.pow(2, rTempo.next() * Math.log2(190 / 55)));
    const d3 = () => Math.round(rDims.next() * 1000) / 1000;
    const key = `spotify:${id}`;

    if (cls === 0 || cls === 1) {
      docs.set(key, { bpm, energy: d3(), valence: d3(), acousticness: d3(), danceability: d3(), source: 'api', confidence: 1 });
    } else if (cls === 2) {
      docs.set(key, { bpm, energy: d3(), valence: d3(), acousticness: d3(), danceability: d3(), source: 'acousticbrainz', confidence: 0.85 });
    } else if (cls === 3) {
      docs.set(key, { bpm, energy: d3(), valence: d3(), acousticness: d3(), danceability: d3(), source: 'llm', confidence: 0.45 });
    } else if (cls === 4) {
      docs.set(key, { bpm: null, energy: d3(), valence: d3(), acousticness: d3(), danceability: d3(), source: 'api', confidence: 1 });
    } else if (cls === 5) {
      docs.set(key, { bpm, energy: null, valence: null, acousticness: d3(), danceability: d3(), source: 'acousticbrainz', confidence: 0.85 });
    } else if (cls === 6) {
      docs.set(key, { bpm, source: 'api', confidence: 1 });
    } else {
      docs.set(key, null); // featureless — no AudioFeature row at all
    }
  }
  return { library, docs, classOf };
}

const CORPUS = buildCorpus(CORPUS_SIZE, CORPUS_SEED);
const PROFILE = { library: CORPUS.library, lastAnalyzed: new Date('2026-06-01') };

// Exposure history: every 5th track has been served recently, so the exposure penalty — the
// one term whose relative weight moved when v2 normalised the others — is actually engaged.
function seedLedger(userId) {
  ServeEvent.__rows.length = 0;
  CORPUS.library.forEach((track, i) => {
    if (i % 5 !== 0) return;
    const key = canonicalKey(track);
    const serves = (i % 15 === 0) ? 3 : 1;
    for (let s = 0; s < serves; s++) {
      ServeEvent.__rows.push({
        userId, canonicalKey: key, moodKey: 'calm',
        servedAt: new Date(NOW - (2 + s * 3) * 24 * 3600 * 1000), // 2..8 days back: inside the
      });                                                          // exposure window, outside the
    }                                                              // 8h/72h exclusion windows
  });
}

// ── the personas ──────────────────────────────────────────────────────────────────────────

// Full 13-key targets (§0.2.5 superset contract) plus the additive `cadenceLocked`, exactly as
// `translate()` emits them — literal so the golden isolates scoring from the bio engine.
const SCENARIOS = [
  {
    id: 'calm-recovery', k: 20, userId: 'u-golden',
    targets: {
      bpmCenter: 66, bpmWidth: 14, energyFloor: 0.05, energyCeiling: 0.4, valenceTarget: 0.45,
      acousticnessBias: 0.35, instrumentalBias: 0.2, tempoBand: 'slow', confidence: 0.9,
      activityDriven: false, activityIntensity: null, cadenceLocked: false,
      state: { recovery: 0.8, stress: 0.15, exertion: 0.05 },
    },
  },
  {
    id: 'stress-downshift', k: 20, userId: 'u-golden',
    targets: {
      bpmCenter: 78, bpmWidth: 10, energyFloor: 0.1, energyCeiling: 0.45, valenceTarget: 0.5,
      acousticnessBias: 0.45, instrumentalBias: 0.35, tempoBand: 'slow', confidence: 0.45,
      activityDriven: false, activityIntensity: null, cadenceLocked: false,
      state: { recovery: 0.3, stress: 0.75, exertion: 0.1 },
    },
  },
  {
    id: 'run-cadence', k: 20, userId: 'u-golden',
    targets: {
      bpmCenter: 162, bpmWidth: 8, energyFloor: 0.7, energyCeiling: 1, valenceTarget: 0.65,
      acousticnessBias: 0, instrumentalBias: 0, tempoBand: 'fast', confidence: 1,
      activityDriven: true, activityIntensity: 'high', cadenceLocked: true,
      state: { recovery: 0.4, stress: 0.2, exertion: 0.85 },
    },
  },
  {
    id: 'evening-unwind', k: 20, userId: 'u-golden',
    targets: {
      bpmCenter: 92, bpmWidth: 22, energyFloor: 0.15, energyCeiling: 0.6, valenceTarget: 0.55,
      acousticnessBias: 0.2, instrumentalBias: 0.1, tempoBand: 'mid', confidence: 0.7,
      activityDriven: false, activityIntensity: null, cadenceLocked: false,
      state: { recovery: 0.55, stress: 0.35, exertion: 0.1 },
    },
  },
  {
    // Nothing constrained AND no serve history: the control condition. v2's only remaining
    // difference from v1 is that its positive weights are rescaled by a constant, which cannot
    // reorder anything — so this scenario must come back IDENTICAL. A rebuild that churns
    // playlists it has no information to improve would be a bug, and this is what catches it.
    id: 'manual-no-signal-fresh', k: 20, userId: 'u-fresh', freshLedger: true,
    targets: {
      bpmCenter: null, bpmWidth: null, energyFloor: null, energyCeiling: null, valenceTarget: null,
      acousticnessBias: 0, instrumentalBias: 0, tempoBand: null, confidence: 0.3,
      activityDriven: false, activityIntensity: null, cadenceLocked: false,
      state: { recovery: 0.5, stress: 0.5, exertion: 0.5 },
    },
  },
];

// ── running a scenario both ways ──────────────────────────────────────────────────────────

const r4 = (x) => (x == null ? null : Math.round(x * 10000) / 10000);

function summarize(scenario, result) {
  const picks = result.tracks;
  // Summed in SORTED order, not serve order. Floating-point addition is not associative, and with
  // W4-008 sequencing the playlist the same 20 masses now arrive in a different order — enough to
  // move this mean by one unit in the 4th decimal (0.5102 → 0.5103 on calm-recovery.v1) with an
  // identical pick set. A set statistic that twitches when only the ORDER changed defeats the
  // whole point of separating `pickSet` from `picks`.
  const masses = picks.map(t => _featureFitV2(t.features, scenario.targets).mass).sort((x, y) => x - y);
  const classes = {};
  for (const t of picks) {
    const name = CLASS_NAMES[CORPUS.classOf.get(t.id)];
    classes[name] = (classes[name] ?? 0) + 1;
  }
  return {
    // W4-008 split this in two. `picks` is SERVE ORDER, which the trajectory planner now owns;
    // `pickSet` is the same tracks sorted, which only SELECTION can change. Before the split a
    // re-sequencing and a re-scoring produced the same kind of diff — a churned `picks` array —
    // and a reviewer could not tell which had happened without re-deriving it by hand. Keeping
    // both means a future diff says WHICH stage moved: `pickSet` steady with `picks` churned is a
    // sequencing change; `pickSet` moving is a selection change, and that is the one to argue about.
    picks: picks.map(t => t.id),
    pickSet: picks.map(t => t.id).sort(),
    banded: result.telemetry.banded,
    afterFilters: result.telemetry.afterFilters,
    relaxLevel: result.telemetry.relaxLevel,
    distinctArtists: new Set(picks.map(t => t.artist)).size,
    meanFeatureMass: r4(masses.reduce((a, b) => a + b, 0) / Math.max(1, masses.length)),
    pickedByClass: Object.fromEntries(Object.entries(classes).sort(([a], [b]) => a.localeCompare(b))),
    trajectory: result.telemetry.trajectory,
  };
}

async function runVersion(scenario, version) {
  if (version === 'v1') process.env[DISABLE] = '1'; else delete process.env[DISABLE];
  _resetWeights();
  if (scenario.freshLedger) ServeEvent.__rows.length = 0; else seedLedger(scenario.userId);
  featureRepo.getMany.mockResolvedValue(CORPUS.docs);
  return selectPlaylist({
    userId: scenario.userId,
    musicProfile: PROFILE,
    moodKey: 'calm',
    provider: 'spotify',
    targets: scenario.targets,
    k: scenario.k,
    now: NOW,
  });
}

// The whole harness runs ONCE in beforeAll and every test reads the same result set: running
// the pipeline per assertion would multiply a 10-scenario-run harness by the assertion count
// for no additional information.
const RESULTS = {};

beforeAll(async () => {
  for (const scenario of SCENARIOS) {
    process.env[SHADOW] = '1'; // S12 supplies the divergence row for the golden file
    const v2 = await runVersion(scenario, 'v2');
    delete process.env[SHADOW];
    const v1 = await runVersion(scenario, 'v1');
    const d = v2.telemetry.shadow;
    RESULTS[scenario.id] = {
      scenario: scenario.id,
      k: scenario.k,
      v2: summarize(scenario, v2),
      v1: summarize(scenario, v1),
      divergence: {
        n: d.n,
        spearman: r4(d.spearman),
        topKOverlap: r4(d.topKOverlap),
        topOneSame: d.topOneSame,
        meanAbsDelta: r4(d.meanAbsDelta),
        maxAbsDelta: r4(d.maxAbsDelta),
      },
      // How many of the v2 playlist's tracks v1 also served — the number a product owner
      // would ask for, and NOT the same as the scorer-level overlap above (that one is blind
      // to the tracks v1's band dropped before scoring).
      playlistOverlap: r4(
        v2.tracks.filter(t => v1.tracks.some(u => u.id === t.id)).length / Math.max(1, v2.tracks.length)
      ),
    };
  }
  delete process.env[DISABLE];
  delete process.env[SHADOW];
  _resetWeights();
});

afterAll(() => { delete process.env[DISABLE]; delete process.env[SHADOW]; _resetWeights(); });

// ── 1 · the golden file ───────────────────────────────────────────────────────────────────

describe('W4-007 golden set · fixed personas × a fixed corpus', () => {
  it('matches the committed golden playlists (rebaseline: GOLDEN_UPDATE=1, diff goes in the PR body)', () => {
    const actual = SCENARIOS.map(s => RESULTS[s.id]);
    // One line per scenario, always: the evidence rides along with every CI run instead of
    // needing a special invocation to reproduce.
    for (const row of actual) {
      console.log(
        `[golden] scenario=${row.scenario} k=${row.k} bandedV2=${row.v2.banded} bandedV1=${row.v1.banded} ` +
        `spearman=${row.divergence.spearman} scorerTopK=${row.divergence.topKOverlap} ` +
        `playlistOverlap=${row.playlistOverlap} massV2=${row.v2.meanFeatureMass} massV1=${row.v1.meanFeatureMass}`
      );
    }

    if (process.env.GOLDEN_UPDATE) {
      fs.mkdirSync(path.dirname(GOLDEN_PATH), { recursive: true });
      fs.writeFileSync(GOLDEN_PATH, `${JSON.stringify({ seed: CORPUS_SEED, corpusSize: CORPUS_SIZE, scenarios: actual }, null, 2)}\n`);
      console.log(`[golden] rebaselined ${GOLDEN_PATH}`);
      return;
    }

    expect(fs.existsSync(GOLDEN_PATH)).toBe(true);
    const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8'));
    expect(golden.seed).toBe(CORPUS_SEED);
    expect(golden.corpusSize).toBe(CORPUS_SIZE);
    expect(actual).toEqual(golden.scenarios);
  });
});

// ── 2 · what the golden file is ALLOWED to say ────────────────────────────────────────────
//
// A golden file on its own only proves "unchanged". These are the invariants a rebaseline is
// not allowed to quietly break — the properties that make a change to the golden reviewable
// rather than merely visible.

describe('W4-007 golden set · invariants a rebaseline must not break', () => {
  it('every scenario fills its playlist with distinct tracks', () => {
    for (const s of SCENARIOS) {
      const ids = RESULTS[s.id].v2.picks;
      expect(ids).toHaveLength(s.k);
      expect(new Set(ids).size).toBe(s.k);
    }
  });

  it('every pick is inside the un-relaxable band it was selected for', () => {
    for (const s of SCENARIOS) {
      for (const id of RESULTS[s.id].v2.picks) {
        const doc = CORPUS.docs.get(`spotify:${id}`);
        const features = doc
          ? { bpm: doc.bpm ?? null, energy: doc.energy ?? null, valence: doc.valence ?? null, acousticness: doc.acousticness ?? null, danceability: doc.danceability ?? null }
          : null;
        expect(withinBand({ features }, s.targets)).toBe(true);
      }
    }
  });

  it('THE PHANTOM TARGET: an unconstrained request made v1 select the tracks it knew nothing about', () => {
    // This scenario was written as a CONTROL — "no information in, no change out" — on the
    // theory that with nothing constrained the two scorers differ only by a constant rescale
    // of the positive weights, which cannot reorder anything. It came back 0.25 playlist
    // overlap, and the reason is a THIRD instance of the coercion W4-007 closed, this time on
    // the TARGET side of the comparison rather than the feature side: `Number(null) === 0`, so
    // an ABSENT `bpmCenter` read as a target of 0 bpm and an absent energy window as [0, 0].
    // v1 then scored the library against that phantom and — worse, because this is the
    // un-relaxable band — kept only 38 of 240 tracks. The survivors are exactly the tracks
    // with nothing to contradict the phantom: a measured value was evidence AGAINST a track.
    const row = RESULTS['manual-no-signal-fresh'];
    expect(row.v2.banded).toBe(CORPUS_SIZE);          // nothing constrained → nothing excluded
    expect(row.v1.banded).toBeLessThan(CORPUS_SIZE / 2);

    const v1Classes = Object.keys(row.v1.pickedByClass).sort();
    expect(v1Classes).toEqual(['featureless', 'null-tempo']);
    expect(row.v2.pickedByClass['api-full']).toBeGreaterThan(0);
    // And with no dim constrained, v2's fit rests on no missing measurement at all: the
    // absence of a preference is not an absence of data (§ score.js _featureFitV2).
    expect(row.v2.meanFeatureMass).toBe(1);
  });

  it('THE BAND FIX: v1 hard-dropped partially-measured tracks that v2 keeps', () => {
    // `Number(null) === 0` put every null-tempo track outside every band. The corpus has one
    // such class (1 in 8), and the un-relaxable band is where they died.
    for (const id of ['calm-recovery', 'stress-downshift', 'evening-unwind']) {
      expect(RESULTS[id].v2.banded).toBeGreaterThan(RESULTS[id].v1.banded);
    }
  });

  it('THE REBUILD IS VISIBLE: constrained personas get a genuinely different playlist', () => {
    for (const id of ['calm-recovery', 'stress-downshift', 'run-cadence', 'evening-unwind']) {
      expect(RESULTS[id].divergence.spearman).toBeLessThan(1);
      expect(RESULTS[id].playlistOverlap).toBeLessThan(1);
    }
  });

  it('THE FABRICATED PERFECT FIT: v1 crowded its playlists with single-dim tracks', () => {
    // D18's "one measured dim could score 1.0" is not an abstraction: a track whose ONLY
    // measurement is a tempo landed dead on the centre scored a perfect feature fit and
    // outranked fully measured tracks that were merely very good. In the worst persona here
    // it took NINE of v1's twenty slots. v2's mass mechanism prices that same track at the
    // prior for every dim it never measured, and it drops to four.
    //
    // Asserted on the SUM across personas rather than per persona, deliberately: this is a
    // distributional claim about a population, and a narrow band (run-cadence sees 55
    // candidates) can legitimately have too few of them to show the effect. The per-persona
    // counts are in the golden file, so a shift in any one of them is still reviewable.
    const constrained = ['calm-recovery', 'stress-downshift', 'run-cadence', 'evening-unwind'];
    const tempoOnly = (v) => constrained.reduce((n, id) => n + (RESULTS[id][v].pickedByClass['tempo-only'] ?? 0), 0);
    expect(tempoOnly('v1')).toBeGreaterThan(tempoOnly('v2'));
    expect(RESULTS['calm-recovery'].v1.pickedByClass['tempo-only'])
      .toBeGreaterThan(2 * RESULTS['calm-recovery'].v2.pickedByClass['tempo-only']);
  });

  it('THE BAND FIX, IN THE PLAYLIST: v1 could never serve a partially-measured track', () => {
    // The pool-level version of this is asserted above; this is the consequence a listener
    // would have experienced. A track with energy, valence, acousticness and danceability all
    // measured but no tempo was unreachable in every persona that ASKED for a tempo, because
    // the one gate that never relaxes read its absent tempo as 0 bpm.
    //
    // Scoped to the constrained personas on purpose, and the exclusion is the other half of
    // the finding: under the phantom 0-bpm target of `manual-no-signal-fresh` the SAME
    // coercion flips sign and v1 serves nothing BUT these tracks (7 of its 20). One line of
    // `Number(null)` both hid them whenever a target existed and made them the entire
    // playlist whenever one did not.
    const constrained = ['calm-recovery', 'stress-downshift', 'run-cadence', 'evening-unwind'];
    const nullTempo = (v) => constrained.reduce((n, id) => n + (RESULTS[id][v].pickedByClass['null-tempo'] ?? 0), 0);
    expect(nullTempo('v1')).toBe(0);
    expect(nullTempo('v2')).toBeGreaterThan(0);
  });

  it('reports the feature MASS of each playlist without claiming a direction for it', () => {
    // Mass is "how much of this fit rests on measurement". v2 moves it in BOTH directions
    // across the personas (calm 0.510->0.536 and run 0.491->0.577, but stress 0.629->0.600
    // and unwind 0.664->0.646) and that is not a regression: v2's pool CONTAINS the
    // partially-measured tracks v1 hard-dropped, so a mean over the survivors is not a
    // like-for-like comparison. The number is committed to the golden file so a future change
    // is visible; it is deliberately NOT asserted directionally, because the direction is not
    // a property of the scorer. Do not "restore" an assertion here — measure the population
    // first (the class counts above are the honest instrument).
    for (const s of SCENARIOS) {
      const mass = RESULTS[s.id].v2.meanFeatureMass;
      expect(mass).toBeGreaterThan(0);
      expect(mass).toBeLessThanOrEqual(1);
    }
  });
});

// ── 3 · S10 · the wall-time budget ────────────────────────────────────────────────────────

describe('W4-007 · S10 selection wall-time on a 500-track pool', () => {
  const BIG = buildCorpus(500, 0xBEEF);
  const BIG_PROFILE = { library: BIG.library, lastAnalyzed: new Date('2026-06-01') };
  const BIG_TARGETS = SCENARIOS[3].targets; // evening-unwind: a wide band, so the pool stays big

  const measureVersion = async (version) => {
    if (version === 'v1') process.env[DISABLE] = '1'; else delete process.env[DISABLE];
    _resetWeights();
    featureRepo.getMany.mockResolvedValue(BIG.docs);
    let out = null;
    const m = await perf.measure(async () => {
      out = await selectPlaylist({
        userId: 'u-perf', musicProfile: BIG_PROFILE, moodKey: 'calm', provider: 'spotify',
        targets: BIG_TARGETS, k: 50, now: NOW,
      });
    }, {
      label: `selection-500-${version}`,
      reset: () => { ServeEvent.__rows.length = 0; },
    });
    return { m, out };
  };

  it('v2 selection over 500 candidates stays inside the collapse budget', async () => {
    const { m, out } = await measureVersion('v2');
    expect(out.tracks).toHaveLength(50);
    perf.expectWithinBudget(m, { budgetMs: perf.COLLAPSE_BUDGET_MS, strictMs: perf.SLO_MS });
  }, 30000);

  it('v2 costs no more than 1.6x v1 — the five-dim similarity is not a latency cliff', async () => {
    // WHY A RATIO, AND WHY 1.6 — both measured, not guessed.
    //
    // A ratio, because the two conditions run back to back in the SAME process on the SAME
    // corpus, so ambient load moves both and cancels; an absolute number would drift with the
    // hardware. Both sides use min-of-N for the reason `jest/perfBudget` documents: wall-clock
    // noise is one-sided, so the minimum is the estimator that survives a loaded box.
    //
    // Measured on this box over four isolated runs: v1 min 296..310 ms, v2 min 394..400 ms,
    // ratio 1.28..1.35 — and essentially all of it is the MMR stage (v1 ~320 ms, v2 ~390 ms),
    // not scoring (4 ms vs 9 ms). MMR's pair count is capped by the candidate window, so the
    // larger v2 pool is NOT what costs: the ~20% is the irreducible price of the similarity
    // this task mandates, five judged dims instead of three and an octave fold instead of a
    // raw subtraction, over the same O(k·window·picked) comparisons.
    //
    // 1.6 sits above that range with headroom for a loaded runner, and is demonstrably tight
    // enough to catch the regression class it exists for: recomputing `Math.log2` inside the
    // pair loop — the first cut of this code — measured 1.86..2.18 and also broke the absolute
    // collapse ceiling at 620 ms. That is what this budget bought, and why it is not a formality.
    const v1 = await measureVersion('v1');
    const v2 = await measureVersion('v2');
    const ratio = v2.m.wall.min / Math.max(1, v1.m.wall.min);
    const stages = (o) => ['score', 'mmr'].map(s => `${s}=${o.telemetry.stageMs[s]}`).join(' ');
    console.log(
      `[perf] selection-500 v1min=${v1.m.wall.min} v2min=${v2.m.wall.min} ratio=${Math.round(ratio * 100) / 100} ` +
      `poolV1=${v1.out.telemetry.banded} poolV2=${v2.out.telemetry.banded} ` +
      `v1[${stages(v1.out)}] v2[${stages(v2.out)}]`
    );
    expect(ratio).toBeLessThan(1.6);
  }, 60000);
});
