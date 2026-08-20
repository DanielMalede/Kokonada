'use strict';

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

jest.mock('../app/services/biosonic/baselines', () => ({
  computeBaselines: jest.fn().mockResolvedValue({ rhrMedian: 60, rhrMAD: 4, sampleCount: 40 }),
  cacheBaselines: jest.fn().mockResolvedValue(undefined),
  // W4-004: the refresh also writes back the derived HRmax + Karvonen zones.
  persistDerivedProfile: jest.fn().mockResolvedValue(true),
  getBaselines: jest.fn(),
}));
jest.mock('../app/services/medicalProfileService', () => ({
  upsertStateVector: jest.fn().mockResolvedValue({}),
  computeStateVector: jest.fn(),
  aggregateProfileMetrics: jest.fn(),
  computeLastNightSleep: jest.fn(),
}));
jest.mock('../app/models/MedicalProfile', () => ({
  findOne: jest.fn().mockResolvedValue({
    hrv: 45, restingHeartRate: 60, bodyBattery: 80, dailyReadiness: 85,
    toObject: function () { return { hrv: 45, restingHeartRate: 60, bodyBattery: 80, dailyReadiness: 85 }; },
  }),
}));
// W4-006 (seam half): the nightly refresh is also where the affect posterior is kept alive for
// users who are not generating playlists, and where the taxonomy label reaches storage.
jest.mock('../app/services/biosonic/affectService', () => ({
  resolveAffect: jest.fn().mockResolvedValue({ label: 'resting-content', confidence: 0.42 }),
  resolveHourContext: jest.requireActual('../app/services/biosonic/affectService').resolveHourContext,
}));

const baselines = require('../app/services/biosonic/baselines');
const { upsertStateVector } = require('../app/services/medicalProfileService');
const { resolveAffect } = require('../app/services/biosonic/affectService');
const worker = require('../app/workers/stateVector.worker');
const { DEFAULT_PROCESSORS } = require('../app/workers');
const { QUEUES } = require('../app/queues/definitions');

describe('stateVector worker', () => {
  it('recomputes baselines fresh, refreshes the encrypted cache, and upserts the state vector', async () => {
    await worker.process({ data: { userId: 'u1' } });

    expect(baselines.computeBaselines).toHaveBeenCalledWith('u1');
    expect(baselines.cacheBaselines).toHaveBeenCalledWith('u1', expect.objectContaining({ rhrMedian: 60 }));
    // W4-006 DELIBERATE RE-PIN: the call gained a third argument (the resolved affect, which is
    // what carries the taxonomy label into storage). Kept as an EXACT three-argument match rather
    // than relaxed to `expect.anything()` — the point of this assertion is that the worker hands
    // the state vector everything it should, and a loosened matcher would stop noticing if it
    // silently stopped passing the affect at all.
    expect(upsertStateVector).toHaveBeenCalledWith('u1', expect.any(Object), { affect: expect.any(Object) });
    // W4-004: the same refresh writes the derived HRmax + Karvonen zones back onto the profile,
    // from the SAME blob it just cached — not a second, divergent computation.
    expect(baselines.persistDerivedProfile)
      .toHaveBeenCalledWith('u1', expect.objectContaining({ rhrMedian: 60 }));
  });

  it('a failed zone write-back never fails the refresh (best-effort decoration)', async () => {
    baselines.persistDerivedProfile.mockRejectedValueOnce(new Error('profile write failed'));

    await expect(worker.process({ data: { userId: 'u1' } })).resolves.toBeTruthy();
    expect(baselines.cacheBaselines).toHaveBeenCalled();
  });

  it('returns a summary that carries NO raw biometric values (zero-knowledge boundary)', async () => {
    const out = await worker.process({ data: { userId: 'u1' } });

    const flat = JSON.stringify(out);
    expect(flat).not.toContain('"rhrMedian"');
    expect(flat).not.toContain('60');
    expect(out).toEqual(expect.objectContaining({ userId: 'u1', recomputed: true }));
  });

  it('is registered as the default processor for state-vector-recompute', () => {
    expect(DEFAULT_PROCESSORS[QUEUES.STATE_VECTOR_RECOMPUTE]).toBe(worker.process);
  });

  it('a missing profile degrades gracefully (baselines still cached)', async () => {
    const MedicalProfile = require('../app/models/MedicalProfile');
    MedicalProfile.findOne.mockResolvedValueOnce(null);

    await expect(worker.process({ data: { userId: 'ghost' } })).resolves.toEqual(
      expect.objectContaining({ recomputed: true })
    );
  });

  // ── W4-006 seam half ──────────────────────────────────────────────────────────────────────

  it('refreshes the affect posterior from the blob it just computed', async () => {
    await worker.process({ data: { userId: 'u1' } });

    expect(resolveAffect).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'u1',
      // The SAME blob it cached — a second, divergent baseline computation here would let the
      // stored state and the served state disagree about the same person.
      baselines: expect.objectContaining({ rhrMedian: 60 }),
      state: expect.objectContaining({ hrv: 45, bodyBattery: 80, dailyReadiness: 85 }),
    }));
    // The nightly lane has no live reading, and must not invent one: every HR-derived axis is
    // supposed to abstain here, which is what keeps this refresh honest rather than a guess.
    expect(resolveAffect.mock.calls[0][0].live).toEqual({});
  });

  it('hands the resolved affect to upsertStateVector so the taxonomy label reaches storage', async () => {
    await worker.process({ data: { userId: 'u1' } });

    expect(upsertStateVector).toHaveBeenCalledWith('u1', expect.any(Object), {
      affect: { label: 'resting-content', confidence: 0.42 },
    });
  });

  it('a failed affect refresh never costs the user their baseline refresh', async () => {
    resolveAffect.mockRejectedValueOnce(new Error('redis down'));

    await expect(worker.process({ data: { userId: 'u1' } })).resolves.toBeTruthy();
    expect(baselines.cacheBaselines).toHaveBeenCalled();
    // …and the state vector is still written, from the classifier alone.
    expect(upsertStateVector).toHaveBeenCalledWith('u1', expect.any(Object), { affect: null });
  });

  it('the job summary still carries no state label (§0.2.2 / R10)', async () => {
    const out = await worker.process({ data: { userId: 'u1' } });
    expect(JSON.stringify(out)).not.toContain('resting-content');
  });
});
