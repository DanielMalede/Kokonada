'use strict';

// W4-011 (wiring half) — the lane from a finished play to the two learned artifacts.
//
// ── THE LOAD-BEARING DECISION THIS SUITE GUARDS ─────────────────────────────────────────────
//
// The judgement is computed on the SOCKET side and only its RESULT crosses the queue. The obvious
// alternative — enqueue the play window and let the worker do the maths — puts raw heart-rate
// samples into a BullMQ job payload, which is an unencrypted Redis blob, and §0.2.2 bars numeric
// vitals from Redis in as many words. So the split is not a performance choice: `evaluatePlay`
// runs where the vitals already legitimately are, and what travels is a bucket address, a bounded
// scalar and (for CC0 only) a Beta delta.
//
// The payload key set is therefore pinned closed. A future field added carelessly is exactly how
// a vital would reach Redis.

process.env.NODE_ENV = 'test';

jest.mock('../app/queues/queue', () => ({ enqueue: jest.fn(async () => ({ queued: true })) }));
jest.mock('../app/repositories/rewardRepo', () => ({
  recordBucketReward: jest.fn(async () => true),
  recordTrackOutcome: jest.fn(async () => true),
}));

const { enqueue } = require('../app/queues/queue');
const rewardRepo = require('../app/repositories/rewardRepo');
const { QUEUES } = require('../app/queues/definitions');
const { DEFAULT_PROCESSORS } = require('../app/workers/index');
const { dispatchReward, FEEDBACK_FLAG, REWARD_JOB_KEYS } = require('../app/services/learning/rewardDispatch');
const rewardIngestWorker = require('../app/workers/rewardIngest.worker');

const AT = 1_700_000_000_000;

/** A play that earns a real reward: a stress arc, a completed track, and a body that settled. */
const goodPlay = (over = {}) => ({
  samples: Array.from({ length: 40 }, (_, i) => ({ atMs: AT - 240_000 + i * 6_000, value: 90 - i * 0.5 })),
  expectedSlope: 0,
  archetype: 'meet-then-lower',
  events: [{ type: 'complete', positionMs: 240_000 }],
  stateId: 'acute-stress',
  targetBand: 'resting',
  hourOfDay: 21,
  recordingKey: 'mbid:9f4a',
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env[FEEDBACK_FLAG];
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); });

describe('rewardDispatch — the queue lane', () => {
  test('the reward queue exists and is registered in the in-process worker index (§0.4 S11)', () => {
    expect(QUEUES.REWARD_INGEST).toBe('reward-ingest');
    expect(typeof DEFAULT_PROCESSORS[QUEUES.REWARD_INGEST]).toBe('function');
  });

  test('a play that teaches something is enqueued on that queue', async () => {
    const out = await dispatchReward({ userId: 'u1', play: goodPlay(), atMs: AT });

    expect(out.dispatched).toBe(true);
    expect(enqueue).toHaveBeenCalledTimes(1);
    const [queueName, payload] = enqueue.mock.calls[0];
    expect(queueName).toBe(QUEUES.REWARD_INGEST);
    expect(payload.bucket).toEqual({ stateDomain: 'stress', targetBand: 'resting', hourBin: 3 });
    expect(payload.reward).toBeGreaterThan(0);
  });

  test('the job payload key set is CLOSED — nothing physiological may reach Redis (§0.2.2)', async () => {
    await dispatchReward({ userId: 'u1', play: goodPlay(), atMs: AT });
    const [, payload] = enqueue.mock.calls[0];

    expect(Object.keys(payload).sort()).toEqual([...REWARD_JOB_KEYS].sort());
    const serialized = JSON.stringify(payload);
    for (const forbidden of ['samples', 'heartRate', 'value', 'expectedSlope', 'observedSlope', 'sigma', 'trend']) {
      expect(serialized).not.toContain(forbidden);
    }
    // The one number that IS physiological in origin is the reward, and it is a bounded
    // judgement, not a measurement — pinned in range so it can never become a rate again.
    expect(payload.reward).toBeGreaterThanOrEqual(-1);
    expect(payload.reward).toBeLessThanOrEqual(1);
  });

  test('a Track-B-only play (no bucket) still dispatches — the two stores are independent', async () => {
    const out = await dispatchReward({ userId: 'u1', play: goodPlay({ stateId: null }), atMs: AT });

    expect(out.dispatched).toBe(true);
    const [, payload] = enqueue.mock.calls[0];
    expect(payload.bucket).toBeNull();
    expect(payload.posterior).toMatchObject({ recordingKey: 'mbid:9f4a' });
  });

  test('a play that teaches NOTHING is not enqueued — a no-op never becomes a write', async () => {
    const out = await dispatchReward({ userId: 'u1', play: goodPlay({ events: [], samples: [] }), atMs: AT });

    expect(out.dispatched).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
  });

  test('a non-CC0 recording carries no posterior across the queue', async () => {
    await dispatchReward({ userId: 'u1', play: goodPlay({ recordingKey: 'spotify:track:abc' }), atMs: AT });
    const [, payload] = enqueue.mock.calls[0];

    expect(payload.posterior).toBeNull();
    expect(JSON.stringify(payload)).not.toContain('spotify');
  });

  test('missing a user or a play is refused rather than enqueued as a partial', async () => {
    expect((await dispatchReward({ play: goodPlay(), atMs: AT })).dispatched).toBe(false);
    expect((await dispatchReward({ userId: 'u1', play: null, atMs: AT })).dispatched).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
  });

  test('NEVER throws — a learning failure must not take down the socket it hangs off', async () => {
    enqueue.mockRejectedValueOnce(new Error('redis exploded'));
    await expect(dispatchReward({ userId: 'u1', play: goodPlay(), atMs: AT })).resolves.toMatchObject({ dispatched: false });
  });

  test('the S15 telemetry line is emitted and carries no vital, no state label and no track identity', async () => {
    await dispatchReward({ userId: 'u1', play: goodPlay(), atMs: AT });

    const line = console.warn.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith('[feedback]'));
    expect(line).toBeDefined();
    for (const forbidden of ['acute-stress', 'mbid:9f4a', 'u1', '90', '89.5']) expect(line).not.toContain(forbidden);
  });
});

describe('rewardDispatch — S11 kill switch', () => {
  test.each(['true', '1', 'yes'])('%s disables the whole lane with no revert', async (value) => {
    process.env[FEEDBACK_FLAG] = value;
    const out = await dispatchReward({ userId: 'u1', play: goodPlay(), atMs: AT });

    expect(out).toMatchObject({ dispatched: false, reason: 'disabled' });
    expect(enqueue).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  test.each(['', 'false', '0'])('%s leaves it ON — the flag is opt-OUT', async (value) => {
    process.env[FEEDBACK_FLAG] = value;
    expect((await dispatchReward({ userId: 'u1', play: goodPlay(), atMs: AT })).dispatched).toBe(true);
  });
});

describe('rewardIngest.worker — the write side', () => {
  const job = (data) => ({ data });

  test('writes both tracks from one job', async () => {
    const out = await rewardIngestWorker.process(job({
      v: 1,
      userId: 'u1',
      bucket: { stateDomain: 'stress', targetBand: 'resting', hourBin: 3 },
      reward: 0.42,
      posterior: { recordingKey: 'mbid:9f4a', alpha: 1, beta: 0 },
      at: AT,
    }));

    // W4-013 re-pin: the worker now reports a THIRD independent write (the novelty posterior).
    // Additive — the bucket/posterior guarantees below are unchanged, and a job that carries no
    // novelty observation reports `false` exactly the way a job with no posterior always has.
    // DELIBERATE ADDITIVE RE-PIN (W4-013 B7): the worker reports a FOURTH independent write.
    expect(out).toEqual({ bucket: true, posterior: true, novelty: false, weights: false });
    expect(rewardRepo.recordBucketReward).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', reward: 0.42, at: new Date(AT) }),
    );
    expect(rewardRepo.recordTrackOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ recordingKey: 'mbid:9f4a', delta: { alpha: 1, beta: 0 }, at: new Date(AT) }),
    );
  });

  test('a job with only a posterior writes only the posterior', async () => {
    const out = await rewardIngestWorker.process(job({
      v: 1, userId: 'u1', bucket: null, reward: 0, posterior: { recordingKey: 'mbid:9f4a', alpha: 0, beta: 1 }, at: AT,
    }));

    expect(out).toEqual({ bucket: false, posterior: true, novelty: false, weights: false });
    expect(rewardRepo.recordBucketReward).not.toHaveBeenCalled();
  });

  test('an empty or malformed job writes nothing rather than throwing', async () => {
    const nothing = { bucket: false, posterior: false, novelty: false, weights: false };
    await expect(rewardIngestWorker.process(undefined)).resolves.toEqual(nothing);
    await expect(rewardIngestWorker.process(job({}))).resolves.toEqual(nothing);
    await expect(rewardIngestWorker.process(job({ userId: 'u1', at: 'not-a-time' }))).resolves.toEqual(nothing);
    expect(rewardRepo.recordBucketReward).not.toHaveBeenCalled();
    expect(rewardRepo.recordTrackOutcome).not.toHaveBeenCalled();
  });
});
