'use strict';

/**
 * W4-013 (B7) · the write lane — from a served playlist to the listener's own scoring overlay.
 *
 * The read lane landed in session 51 and has no writer, so no row is ever created and the overlay
 * is dormant by construction as well as by flag. This suite pins the missing half, and it is the
 * B5 lane step for step because it carries the same shaped fact: something only the SERVE knows.
 *
 * B5 had to remember whether a track was a gamble. B7 has to remember what the ranking THOUGHT of
 * it — §M.15's `∂`, which is a residual of the scorer's own terms against the weights that were in
 * force, and neither of those survives the request. By the time a `playback_event` names a track,
 * the terms are gone and the table may already have been re-resolved.
 *
 * The tri-state lesson carries over verbatim: a play whose gradient is UNKNOWN must not read as a
 * zero gradient. Zero is a real answer ("this dimension did not distinguish the track"), unknown
 * is not an answer at all, and letting silence vote is how a learner converges on evidence nobody
 * ever produced.
 */

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';

const playWindow = require('../app/agents/runtime/learning/playWindow');
const personalization = require('../app/agents/runtime/learning/personalization');

const T0 = 1_700_000_000_000;

const targets = { tempoBand: 'resting', hourOfDay: 14, stateId: 'acute-stress', trajectory: { archetype: 'meet-then-lower' } };

/** A well-formed §M.15 gradient: four finite terms, one per personal weight. */
const g = (o = {}) => ({ taste: 0, feature: 0, genre: 0, rotation: 0, ...o });

describe('W4-013 · the served playlist tells the window what the ranking thought of each track', () => {
  test('gradientsOf indexes the pipeline capture by the key the client will use', () => {
    const table = playWindow.gradientsOf([
      { key: 'spotify:aaa', g: g({ taste: 0.4, feature: -0.2 }) },
      { key: 'mbid:bbb', g: g({ genre: 0.1 }) },
    ]);
    expect(table.get('spotify:aaa')).toEqual(g({ taste: 0.4, feature: -0.2 }));
    expect(table.get('mbid:bbb')).toEqual(g({ genre: 0.1 }));
    expect(table.size).toBe(2);
  });

  test('an absent, empty or unusable capture yields an empty Map, never null', () => {
    for (const input of [null, undefined, [], 'nope', 42, [null, {}, { key: '' }, { key: 'x' }]]) {
      const table = playWindow.gradientsOf(input);
      expect(table).toBeInstanceOf(Map);
      expect(table.size).toBe(0);
    }
  });

  test('an entry whose gradient is not four finite numbers is DROPPED, not repaired', () => {
    // Fail-closed at the boundary: a malformed gradient is an upstream bug, and admitting a
    // half-filled one would let a defaulted zero pose as a measurement — exactly the coercion
    // W4-D15/W4-D21 keep finding. Dropping it makes the track read as UNKNOWN, which is honest.
    const table = playWindow.gradientsOf([
      { key: 'a', g: { taste: 0.1, feature: 0.1, genre: 0.1 } },
      { key: 'b', g: { taste: 0.1, feature: Number.NaN, genre: 0, rotation: 0 } },
      { key: 'c', g: { taste: 0.1, feature: Infinity, genre: 0, rotation: 0 } },
      { key: 'd', g: 'gradient' },
      { key: 'e', g: null },
      { key: 'ok', g: g({ taste: 0.2 }) },
    ]);
    expect([...table.keys()]).toEqual(['ok']);
  });

  test('the table is bounded, so a socket cannot grow one without limit', () => {
    const huge = Array.from({ length: 5000 }, (_, i) => ({ key: `spotify:${i}`, g: g({ taste: 0.1 }) }));
    expect(playWindow.gradientsOf(huge).size).toBeLessThanOrEqual(playWindow.MAX_GRADIENT_KEYS);
  });
});

describe('W4-013 · the gradient on a finished play', () => {
  const openWith = (gradients) => playWindow.openWindow(
    playWindow.createPlayWindowState(),
    { ...playWindow.contextFromTargets(targets), gradients },
    T0,
  );

  const table = () => playWindow.gradientsOf([{ key: 'mbid:known', g: g({ taste: 0.3, feature: -0.3 }) }]);

  test('a play of a track the ranking scored carries that track own gradient', () => {
    const opened = openWith(table());
    const { play } = playWindow.noteEvent(opened, { type: 'complete', positionMs: 200000, trackKey: 'mbid:known' }, T0 + 200000);
    expect(play.gradient).toEqual(g({ taste: 0.3, feature: -0.3 }));
  });

  test('a play of a track the serve never scored reports UNKNOWN, not a zero gradient', () => {
    const opened = openWith(table());
    const { play } = playWindow.noteEvent(opened, { type: 'complete', positionMs: 200000, trackKey: 'spotify:elsewhere' }, T0 + 200000);
    expect(play.gradient).toBeNull();
  });

  test('a play whose track was never NAMED reports UNKNOWN', () => {
    // Today's shipped client: `track_skipped` forwards with `trackKey: null` (W4-D50).
    const opened = openWith(table());
    const { play } = playWindow.noteEvent(opened, { type: 'skip', positionMs: null, trackKey: null }, T0 + 5000);
    expect(play.gradient).toBeNull();
  });

  test('a window opened with NO gradient table at all reports UNKNOWN', () => {
    // The overlay is opt-in (`WAVE4_PERSONAL_WEIGHTS`), so on every deployment that has not
    // switched it on the pipeline captures nothing and this is the ONLY path. It is what makes
    // the write lane dormant by construction rather than only by flag.
    const opened = playWindow.openWindow(playWindow.createPlayWindowState(), playWindow.contextFromTargets(targets), T0);
    const { play } = playWindow.noteEvent(opened, { type: 'complete', positionMs: 200000, trackKey: 'mbid:known' }, T0 + 200000);
    expect(play.gradient).toBeNull();
  });

  test('the gradient survives a track that reports several events before ending', () => {
    let s = openWith(table());
    s = playWindow.noteEvent(s, { type: 'save', positionMs: 60000, trackKey: 'mbid:known' }, T0 + 60000).state;
    const { play } = playWindow.noteEvent(s, { type: 'complete', positionMs: 200000, trackKey: 'mbid:known' }, T0 + 200000);
    expect(play.gradient).toEqual(g({ taste: 0.3, feature: -0.3 }));
  });

  test('the next track reads the SAME serve table — one serve, many plays', () => {
    let s = openWith(table());
    s = playWindow.noteEvent(s, { type: 'complete', positionMs: 200000, trackKey: 'spotify:familiar' }, T0 + 200000).state;
    const { play } = playWindow.noteEvent(s, { type: 'skip', positionMs: 4000, trackKey: 'mbid:known' }, T0 + 210000);
    expect(play.gradient).toEqual(g({ taste: 0.3, feature: -0.3 }));
  });

  test('the play contract gains exactly ONE key — a DELIBERATE additive re-pin', () => {
    const opened = openWith(table());
    const { play } = playWindow.noteEvent(opened, { type: 'complete', positionMs: 200000, trackKey: 'mbid:known' }, T0 + 200000);
    expect(Object.keys(play).sort()).toEqual(
      ['archetype', 'events', 'expectedSlope', 'gradient', 'hourOfDay', 'recordingKey', 'samples', 'stateId', 'targetBand', 'wasDiscovery'],
    );
  });
});

describe('W4-013 · dispatchReward composes the weight step', () => {
  const load = () => {
    let captured = null;
    jest.resetModules();
    jest.doMock('../app/queues/queue', () => ({
      enqueue: (name, payload) => { captured = { name, payload }; return Promise.resolve({ queued: true }); },
    }));
    const mod = require('../app/services/learning/rewardDispatch');
    return { mod, seen: () => captured };
  };

  afterEach(() => { jest.resetModules(); jest.dontMock('../app/queues/queue'); delete process.env.WAVE4_FEEDBACK_DISABLED; });

  /** A play with enough behavioural signal to be usable, whose gradient is the variable. */
  const play = (gradient, over = {}) => ({
    samples: [], expectedSlope: null, archetype: 'meet-then-lower',
    events: [{ type: 'skip', positionMs: 4000 }],
    stateId: 'acute-stress', targetBand: 'resting', hourOfDay: 14,
    recordingKey: 'spotify:whatever', wasDiscovery: null, gradient, ...over,
  });

  test('an early-skipped track steps the weights AWAY from what ranked it', async () => {
    const { mod, seen } = load();
    await mod.dispatchReward({ userId: 'u1', play: play(g({ taste: 0.5, feature: -0.5 })), atMs: T0 });
    const step = seen().payload.weightStep;
    // reward is −1 (early skip), so `0.02 · r · ∂` flips the sign of the gradient.
    expect(step.taste).toBeCloseTo(-0.01, 12);
    expect(step.feature).toBeCloseTo(0.01, 12);
    // `Math.abs` because `0.02 · −1 · 0` is IEEE `-0`, which is === 0 everywhere it matters
    // (`_usableStep`'s move check) and serialises as `0` over the queue. Pinned as magnitude so
    // the assertion says "no re-allocation on this term" without asserting a sign bit.
    expect(Math.abs(step.genre)).toBe(0);
  });

  test('a completed track steps the weights TOWARDS what ranked it', async () => {
    const { mod, seen } = load();
    const done = play(g({ taste: 0.5 }), { events: [{ type: 'complete', positionMs: 200000 }] });
    await mod.dispatchReward({ userId: 'u1', play: done, atMs: T0 });
    expect(seen().payload.weightStep.taste).toBeGreaterThan(0);
  });

  test('a play with an UNKNOWN gradient carries no weight step at all', async () => {
    const { mod, seen } = load();
    await mod.dispatchReward({ userId: 'u1', play: play(null), atMs: T0 });
    expect(seen().payload.weightStep).toBeNull();
  });

  test('a play whose gradient is all zeros carries no weight step — nothing to re-allocate', async () => {
    const { mod, seen } = load();
    await mod.dispatchReward({ userId: 'u1', play: play(g()), atMs: T0 });
    expect(seen().payload.weightStep).toBeNull();
  });

  test('a play with a real verdict but NO resolvable bucket still teaches the overlay', async () => {
    // The load-bearing difference from Track A and from B5. The overlay is addressed by the USER
    // and nothing else — it carries no bucket coordinates — so a listener whose taxonomy state
    // could not be resolved has still told the ranking something. `evaluatePlay` forces `reward`
    // to exactly 0 for an unfilable play, which is a TRACK-A rule, so the step is derived from
    // `components.combined` instead: the verdict before Track A's addressability is applied.
    // Reading `verdict.reward` here would silently mean "listeners with degraded signal never
    // learn", which is the population most in need of it.
    const { mod, seen } = load();
    const orphan = play(g({ taste: 0.5 }), { targetBand: null, stateId: null, hourOfDay: null });
    const r = await mod.dispatchReward({ userId: 'u1', play: orphan, atMs: T0 });
    expect(r.dispatched).toBe(true);
    expect(seen().payload.bucket).toBeNull();
    expect(seen().payload.reward).toBe(0);
    expect(seen().payload.weightStep.taste).toBeCloseTo(-0.01, 12);
  });

  test('a play with no verdict at all is still not dispatched', async () => {
    // The guard widened to admit the case above must not become "dispatch everything": a play the
    // feedback loop could not judge has no reward to multiply the gradient by, and `stepFrom`
    // returns null rather than a zero step, so there is nothing to write.
    const { mod, seen } = load();
    const silent = play(g({ taste: 0.5 }), { events: [] });
    const r = await mod.dispatchReward({ userId: 'u1', play: silent, atMs: T0 });
    expect(r.dispatched).toBe(false);
    expect(seen()).toBeNull();
  });

  test('the job payload key set stays CLOSED — no vital can ride in on this change', async () => {
    const { mod, seen } = load();
    await mod.dispatchReward({ userId: 'u1', play: play(g({ taste: 0.5 })), atMs: T0 });
    expect(Object.keys(seen().payload).sort()).toEqual([...mod.REWARD_JOB_KEYS].sort());
    expect(mod.REWARD_JOB_KEYS).toContain('weightStep');
    // Four music-ranking numbers, each bounded by the learning rate. No recording, no provider,
    // no vital — strictly less sensitive than the HR-slope-derived `reward` already on this job.
    expect(Object.keys(seen().payload.weightStep).sort()).toEqual(['feature', 'genre', 'rotation', 'taste']);
    for (const v of Object.values(seen().payload.weightStep)) {
      expect(Math.abs(v)).toBeLessThanOrEqual(personalization.LEARNING_RATE);
    }
  });

  test('the S11 kill-switch still stops the whole lane, the weight step included', async () => {
    process.env.WAVE4_FEEDBACK_DISABLED = 'true';
    const { mod, seen } = load();
    const r = await mod.dispatchReward({ userId: 'u1', play: play(g({ taste: 0.5 })), atMs: T0 });
    expect(r.dispatched).toBe(false);
    expect(seen()).toBeNull();
  });
});

describe('W4-013 · the reward worker writes the overlay', () => {
  const load = (repo, weights) => {
    jest.resetModules();
    jest.doMock('../app/repositories/rewardRepo', () => repo);
    jest.doMock('../app/repositories/personalWeightsRepo', () => weights);
    return require('../app/workers/rewardIngest.worker');
  };
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('../app/repositories/rewardRepo');
    jest.dontMock('../app/repositories/personalWeightsRepo');
  });

  const spyRepo = () => ({
    recordBucketReward: async () => true,
    recordTrackOutcome: async () => true,
    recordNoveltyOutcome: async () => true,
    readNoveltyPosterior: async () => null,
  });

  const spyWeights = () => {
    const calls = [];
    return { calls, applyUpdate: async (a) => { calls.push(a); return true; } };
  };

  const bucket = { stateDomain: 'stress', targetBand: 'resting', hourBin: 2 };
  const step = { taste: -0.01, feature: 0.01, genre: 0, rotation: 0 };

  test('a job carrying a weight step applies it to the listener own row', async () => {
    const weights = spyWeights();
    const worker = load(spyRepo(), weights);
    const out = await worker.process({ data: { userId: 'u1', bucket, reward: -1, weightStep: step, at: T0 } });
    expect(out.weights).toBe(true);
    expect(weights.calls).toHaveLength(1);
    expect(weights.calls[0].userId).toBe('u1');
    expect(weights.calls[0].step).toEqual(step);
    expect(weights.calls[0].at.getTime()).toBe(T0);
  });

  test('a job with no weight step writes none', async () => {
    const weights = spyWeights();
    const worker = load(spyRepo(), weights);
    const out = await worker.process({ data: { userId: 'u1', bucket, reward: 0.5, weightStep: null, at: T0 } });
    expect(out.weights).toBe(false);
    expect(weights.calls).toHaveLength(0);
  });

  test('a W4-011-shaped job with no weightStep key at all still works — old jobs in flight', async () => {
    const weights = spyWeights();
    const worker = load(spyRepo(), weights);
    const out = await worker.process({ data: { userId: 'u1', bucket, reward: 0.5, at: T0 } });
    expect(out).toEqual({ bucket: true, posterior: false, novelty: false, weights: false });
  });

  test('a bad clock writes nothing at all, the overlay included', async () => {
    const weights = spyWeights();
    const worker = load(spyRepo(), weights);
    const out = await worker.process({ data: { userId: 'u1', bucket, reward: -1, weightStep: step, at: 'yesterday' } });
    expect(out).toEqual({ bucket: false, posterior: false, novelty: false, weights: false });
    expect(weights.calls).toHaveLength(0);
  });

  test('a job with ONLY a weight step still writes it — the four stores are independent', async () => {
    // The orphan case from the dispatch suite, arriving at the worker: no bucket, no posterior,
    // no novelty. ADR-0012 keeps these stores separate precisely so one can be absent.
    const weights = spyWeights();
    const worker = load(spyRepo(), weights);
    const out = await worker.process({ data: { userId: 'u1', bucket: null, reward: 0, weightStep: step, at: T0 } });
    expect(out).toEqual({ bucket: false, posterior: false, novelty: false, weights: true });
  });
});

describe('W4-013 · the step rule is the engine own, not a second copy', () => {
  test('dispatch delegates to personalization.stepFrom', () => {
    // The W4-D42 / D11 failure mode: a rule re-implemented at a second site, which then drifts.
    const src = require('fs').readFileSync(require.resolve('../app/services/learning/rewardDispatch'), 'utf8');
    expect(src).toMatch(/personalization|stepFrom/);
    expect(personalization.stepFrom({ gradient: g({ taste: 0.5 }), reward: -1 }).taste).toBeCloseTo(-0.01, 12);
  });

  test('the socket hands the window the gradients the ORCHESTRATOR returned', () => {
    // A source-level pin, and named as one: the alternative is booting a socket, a generation and
    // a playlist_ready to observe one property assignment. It is the same seam `discoveryKeys`
    // crosses one line above it, and the two are pinned to the same standard — the honest
    // statement of coverage is that the pipeline->orchestrator hop has a REAL test
    // (`orchestrator.test.js`), the window side has real tests here, and this one line between
    // them is grepped. Kept adjacent so a change to one is visibly a change to both.
    const src = require('fs').readFileSync(require.resolve('../app/sockets/biometricHandler'), 'utf8');
    expect(src).toMatch(/gradients:\s*gradientsOf\(builtPlaylist\.gradients\)/);
    expect(src).toMatch(/discoveryKeys:\s*discoveryKeysOf\(builtPlaylist\.merged\)/);
  });

  test('the serve-time capture and the event-time lookup agree on what a track is called', () => {
    // One projection, not two: `_gradientsOf` in the pipeline keys on `canonicalKey ?? recordingKeyOf`,
    // and so does `discoveryKeysOf` beside it. A drift here would silently make every lookup miss.
    const src = require('fs').readFileSync(require.resolve('../app/services/selection/pipeline'), 'utf8');
    expect(src).toMatch(/recordingKeyOf/);
  });
});
