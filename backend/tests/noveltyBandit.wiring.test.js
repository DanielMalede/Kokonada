'use strict';

/**
 * W4-013 (B5) · the write lane — from a served playlist to the bucket's novelty posterior.
 *
 * The bandit is only a bandit if its posterior actually moves, and moving it needs ONE fact that
 * W4-011's feedback loop deliberately never captured: was the track that just ended something the
 * listener already owned, or something the system chose to gamble a slot on. This suite pins that
 * fact travelling end to end, and — more importantly — pins the two places it must NOT be
 * invented when nobody actually reported it.
 */

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';

const playWindow = require('../app/agents/runtime/learning/playWindow');
const novelty = require('../app/agents/runtime/knowledge/noveltyController');

const T0 = 1_700_000_000_000;

const targets = { tempoBand: 'resting', hourOfDay: 14, stateId: 'acute-stress', trajectory: { archetype: 'meet-then-lower' } };

describe('W4-013 · the served playlist tells the window which tracks were a gamble', () => {
  test('discoveryKeysOf collects exactly the discovery tracks, by canonical key', () => {
    const keys = playWindow.discoveryKeysOf([
      { canonicalKey: 'spotify:aaa', isDiscovery: false },
      { canonicalKey: 'mbid:bbb', isDiscovery: true },
      { canonicalKey: 'spotify:ccc', isDiscovery: true },
      { canonicalKey: 'spotify:ddd' },
    ]);
    expect(keys).toEqual(new Set(['mbid:bbb', 'spotify:ccc']));
  });

  test('falls back to the recording key when a track carries no canonical key', () => {
    const keys = playWindow.discoveryKeysOf([{ id: 'zzz', provider: 'spotify', isDiscovery: true }]);
    expect(keys.has('spotify:zzz')).toBe(true);
  });

  test('an empty or unusable playlist yields an empty set, never null', () => {
    for (const input of [[], null, undefined, 'nope', [null, {}]]) {
      expect(playWindow.discoveryKeysOf(input)).toEqual(new Set());
    }
  });

  test('the set is bounded by the playlist, so a socket cannot grow one without limit', () => {
    const huge = Array.from({ length: 5000 }, (_, i) => ({ canonicalKey: `spotify:${i}`, isDiscovery: true }));
    expect(playWindow.discoveryKeysOf(huge).size).toBeLessThanOrEqual(playWindow.MAX_DISCOVERY_KEYS);
  });
});

describe('W4-013 · wasDiscovery on a finished play', () => {
  const openWith = (discoveryKeys) => playWindow.openWindow(
    playWindow.createPlayWindowState(),
    { ...playWindow.contextFromTargets(targets), discoveryKeys },
    T0,
  );

  test('a play of a track served as DISCOVERY reports true', () => {
    const opened = openWith(new Set(['mbid:new-one']));
    const { play } = playWindow.noteEvent(opened, { type: 'complete', positionMs: 200000, trackKey: 'mbid:new-one' }, T0 + 200000);
    expect(play.wasDiscovery).toBe(true);
  });

  test('a play of a track from the listener own library reports false', () => {
    const opened = openWith(new Set(['mbid:new-one']));
    const { play } = playWindow.noteEvent(opened, { type: 'complete', positionMs: 200000, trackKey: 'spotify:old-favourite' }, T0 + 200000);
    expect(play.wasDiscovery).toBe(false);
  });

  test('a play whose track was never NAMED reports UNKNOWN, not familiar', () => {
    // This is today's shipped client: `track_skipped` forwards with `trackKey: null`. Reading
    // that silence as "a familiar track" would let it vote, forever, on a question it never
    // answered — the bandit would converge on evidence nobody ever produced.
    const opened = openWith(new Set(['mbid:new-one']));
    const { play } = playWindow.noteEvent(opened, { type: 'skip', positionMs: null, trackKey: null }, T0 + 5000);
    expect(play.wasDiscovery).toBeNull();
  });

  test('a window opened with NO discovery set at all reports UNKNOWN, not familiar', () => {
    // A serve that predates this feature (or a socket that reconnected mid-playlist) knows
    // nothing about roles. "I was not told" and "it was familiar" must not be the same answer.
    const opened = playWindow.openWindow(playWindow.createPlayWindowState(), playWindow.contextFromTargets(targets), T0);
    const { play } = playWindow.noteEvent(opened, { type: 'complete', positionMs: 200000, trackKey: 'spotify:x' }, T0 + 200000);
    expect(play.wasDiscovery).toBeNull();
  });

  test('the role survives a track that reports several events before ending', () => {
    let s = openWith(new Set(['mbid:new-one']));
    s = playWindow.noteEvent(s, { type: 'save', positionMs: 60000, trackKey: 'mbid:new-one' }, T0 + 60000).state;
    const { play } = playWindow.noteEvent(s, { type: 'complete', positionMs: 200000, trackKey: 'mbid:new-one' }, T0 + 200000);
    expect(play.wasDiscovery).toBe(true);
    expect(play.events.map((e) => e.type).sort()).toEqual(['complete', 'save']);
  });

  test('the next track inherits the SAME playlist role table — one serve, many plays', () => {
    let s = openWith(new Set(['mbid:new-one']));
    s = playWindow.noteEvent(s, { type: 'complete', positionMs: 200000, trackKey: 'spotify:familiar' }, T0 + 200000).state;
    const { play } = playWindow.noteEvent(s, { type: 'skip', positionMs: 4000, trackKey: 'mbid:new-one' }, T0 + 210000);
    expect(play.wasDiscovery).toBe(true);
  });

  test('W4-011 play contract is otherwise untouched', () => {
    const opened = openWith(new Set(['mbid:new-one']));
    const { play } = playWindow.noteEvent(opened, { type: 'complete', positionMs: 200000, trackKey: 'mbid:new-one' }, T0 + 200000);
    expect(Object.keys(play).sort()).toEqual(
      ['archetype', 'events', 'expectedSlope', 'hourOfDay', 'recordingKey', 'samples', 'stateId', 'targetBand', 'wasDiscovery'],
    );
  });
});

describe('W4-013 · dispatchReward composes the novelty observation', () => {
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

  /** A play with enough behavioural signal to be usable, whose novelty role is the variable. */
  const play = (wasDiscovery) => ({
    samples: [], expectedSlope: null, archetype: 'meet-then-lower',
    events: [{ type: 'skip', positionMs: 4000 }],
    stateId: 'acute-stress', targetBand: 'resting', hourOfDay: 14,
    recordingKey: 'spotify:whatever', wasDiscovery,
  });

  test('an early-skipped DISCOVERY track adds one beta to the job payload', async () => {
    const { mod, seen } = load();
    await mod.dispatchReward({ userId: 'u1', play: play(true), atMs: T0 });
    expect(seen().payload.novelty).toEqual({ alpha: 0, beta: 1 });
  });

  test('a FAMILIAR track carries no novelty observation at all', async () => {
    const { mod, seen } = load();
    await mod.dispatchReward({ userId: 'u1', play: play(false), atMs: T0 });
    expect(seen().payload.novelty).toBeNull();
  });

  test('an UNKNOWN role carries no novelty observation at all', async () => {
    const { mod, seen } = load();
    await mod.dispatchReward({ userId: 'u1', play: play(null), atMs: T0 });
    expect(seen().payload.novelty).toBeNull();
  });

  test('the job payload key set stays CLOSED — no vital can ride in on this change', async () => {
    const { mod, seen } = load();
    await mod.dispatchReward({ userId: 'u1', play: play(true), atMs: T0 });
    expect(Object.keys(seen().payload).sort()).toEqual([...mod.REWARD_JOB_KEYS].sort());
    expect(mod.REWARD_JOB_KEYS).toContain('novelty');
    // The novelty observation is two counts. It must never carry a recording or a sample.
    expect(JSON.stringify(seen().payload.novelty)).toBe('{"alpha":0,"beta":1}');
  });

  test('the S11 kill-switch still stops the whole lane, novelty included', async () => {
    process.env.WAVE4_FEEDBACK_DISABLED = 'true';
    const { mod, seen } = load();
    const r = await mod.dispatchReward({ userId: 'u1', play: play(true), atMs: T0 });
    expect(r.dispatched).toBe(false);
    expect(seen()).toBeNull();
  });

  test('a DISCOVERY play that cannot be filed under a bucket teaches nothing', async () => {
    // The novelty posterior is stored ON the bucket row, so a play with no resolvable context has
    // literally nowhere to put it. The abstention is structural, not a policy choice — and it is
    // pinned here so a later "just store it somewhere" would have to argue with this line.
    const { mod, seen } = load();
    const orphan = { ...play(true), targetBand: null, stateId: null, hourOfDay: null };
    const r = await mod.dispatchReward({ userId: 'u1', play: orphan, atMs: T0 });
    expect(seen()).toBeNull();
    expect(r.dispatched).toBe(false);
  });
});

describe('W4-013 · the reward worker writes the novelty posterior', () => {
  const load = (repo) => {
    jest.resetModules();
    jest.doMock('../app/repositories/rewardRepo', () => repo);
    return require('../app/workers/rewardIngest.worker');
  };
  afterEach(() => { jest.resetModules(); jest.dontMock('../app/repositories/rewardRepo'); });

  const spyRepo = () => {
    const calls = [];
    return {
      calls,
      recordBucketReward: async (a) => { calls.push(['bucket', a]); return true; },
      recordTrackOutcome: async (a) => { calls.push(['posterior', a]); return true; },
      recordNoveltyOutcome: async (a) => { calls.push(['novelty', a]); return true; },
      readNoveltyPosterior: async () => null,
    };
  };

  const bucket = { stateDomain: 'stress', targetBand: 'resting', hourBin: 2 };

  test('writes the novelty observation to the SAME bucket the reward was filed under', async () => {
    const repo = spyRepo();
    const worker = load(repo);
    const out = await worker.process({ data: { userId: 'u1', bucket, reward: -1, novelty: { alpha: 0, beta: 1 }, at: T0 } });
    expect(out.novelty).toBe(true);
    const call = repo.calls.find(([kind]) => kind === 'novelty')[1];
    expect(call.bucket).toEqual(bucket);
    expect(call.delta).toEqual({ alpha: 0, beta: 1 });
    expect(call.at.getTime()).toBe(T0);
  });

  test('a job with no novelty observation writes none', async () => {
    const repo = spyRepo();
    const worker = load(repo);
    const out = await worker.process({ data: { userId: 'u1', bucket, reward: 0.5, novelty: null, at: T0 } });
    expect(out.novelty).toBe(false);
    expect(repo.calls.some(([kind]) => kind === 'novelty')).toBe(false);
  });

  test('a W4-011-shaped job with no novelty key at all still works — old jobs in flight', async () => {
    const repo = spyRepo();
    const worker = load(repo);
    const out = await worker.process({ data: { userId: 'u1', bucket, reward: 0.5, at: T0 } });
    expect(out).toEqual({ bucket: true, posterior: false, novelty: false });
  });

  test('a bad clock writes nothing at all, novelty included', async () => {
    const repo = spyRepo();
    const worker = load(repo);
    const out = await worker.process({ data: { userId: 'u1', bucket, reward: -1, novelty: { alpha: 0, beta: 1 }, at: 'yesterday' } });
    expect(out).toEqual({ bucket: false, posterior: false, novelty: false });
    expect(repo.calls).toHaveLength(0);
  });
});

describe('W4-013 · the outcome rule is the bandit own, not a second copy', () => {
  test('dispatch delegates to noveltyController.outcomeDelta', () => {
    // Guards against the failure mode this wave keeps finding: a rule re-implemented at a second
    // site, which then drifts. If the controller changes its mind about what teaches the bandit,
    // the dispatch lane must change with it.
    const src = require('fs').readFileSync(require.resolve('../app/services/learning/rewardDispatch'), 'utf8');
    expect(src).toMatch(/noveltyController|outcomeDelta/);
    expect(novelty.outcomeDelta({ wasDiscovery: true, reward: -1 })).toEqual({ alpha: 0, beta: 1 });
  });
});
