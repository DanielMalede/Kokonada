'use strict';

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET = 'test-jwt-secret-for-tests-only';

jest.mock('../app/models/MedicalProfile', () => ({ findOne: jest.fn().mockResolvedValue(null) }));
jest.mock('../app/services/biosonic/baselines', () => ({
  peekBaselines: jest.fn().mockResolvedValue(null),
  getBaselines: jest.fn(),
  computeBaselines: jest.fn(),
  cacheBaselines: jest.fn(),
}));
jest.mock('../app/services/selection/pipeline', () => ({
  selectPlaylist: jest.fn().mockResolvedValue({
    tracks: [
      { id: 'f1', canonicalKey: 'at:a|f1' },
      { id: 'd1', canonicalKey: 'at:a|d1', isDiscovery: true },
    ],
    telemetry: { poolSize: 2, afterFilters: 2, relaxLevel: 0, stageMs: { total: 8 } },
  }),
}));
const MedicalProfile = require('../app/models/MedicalProfile');
const { peekBaselines } = require('../app/services/biosonic/baselines');
const { selectPlaylist } = require('../app/services/selection/pipeline');
const orchestrator = require('../app/services/generation/orchestrator');

beforeEach(() => {
  jest.clearAllMocks();
  MedicalProfile.findOne.mockResolvedValue(null);
  peekBaselines.mockResolvedValue(null);
  delete process.env.SELECTION_V2;
});

describe('orchestrator — sealed (Phase 7)', () => {
  it('the rollback flag is GONE: the v2 engine is unconditional', () => {
    expect(orchestrator.isV2).toBeUndefined();
    expect(typeof orchestrator.generateV2).toBe('function');
  });
});

describe('orchestrator.generateV2', () => {
  it('returns the legacy playlist shape (familiar/discovery/merged) plus telemetry + targets', async () => {
    const out = await orchestrator.generateV2({ userId: 'u1', musicProfile: {}, moodKey: 'calm' });

    expect(out.merged).toHaveLength(2);
    expect(out.familiar.map(t => t.id)).toEqual(['f1']);
    expect(out.discovery.map(t => t.id)).toEqual(['d1']);
    expect(out.telemetry.relaxLevel).toBe(0);
    expect(out.targets.bpmCenter).toBeGreaterThanOrEqual(30);
  });

  it('wires the COMPLETE biosonic inputs: baselines + lastNightSleep + profile scalars + live', async () => {
    peekBaselines.mockResolvedValue({ rhrMedian: 60, rhrMAD: 4, hrvMedian: 45, hrvMAD: 8 });
    MedicalProfile.findOne.mockResolvedValue({
      lastNightSleep: { deep: 45, light: 150, rem: 45, date: new Date('2026-07-01') },
      hrv: 25, bodyBattery: 30, dailyReadiness: 20,
    });

    await orchestrator.generateV2({
      userId: 'u1', musicProfile: {}, moodKey: 'energize',
      live: { heartRate: 105, activity: 'walking' },
    });

    const { targets } = selectPlaylist.mock.calls[0][0];
    expect(targets.confidence).toBe(1);              // every input group present
    expect(targets.bpmCenter).toBe(118);             // walking cadence lock
    expect(targets.energyCeiling).toBeLessThan(0.6); // wrecked body caps energy despite 'energize'
    expect(targets.acousticnessBias).toBeGreaterThan(0); // suppressed HRV biases texture
  });

  it('a cold-start user (no profile, no baselines) still generates with degraded confidence', async () => {
    const out = await orchestrator.generateV2({ userId: 'ghost', musicProfile: {}, moodKey: 'calm' });

    expect(out.merged).toHaveLength(2);
    const { targets } = selectPlaylist.mock.calls[0][0];
    expect(targets.confidence).toBeLessThanOrEqual(0.55);
  });

  it('profile/baseline read failures degrade — generation never dies on biometrics', async () => {
    MedicalProfile.findOne.mockRejectedValue(new Error('mongo down'));
    peekBaselines.mockRejectedValue(new Error('redis down'));

    const out = await orchestrator.generateV2({ userId: 'u1', musicProfile: {}, moodKey: 'calm' });

    expect(out.merged).toHaveLength(2);
  });

  it('passes aiParams (LLM semantics) and discovery through to the selector untouched', async () => {
    const aiParams = { exclude_genres: ['metal'], allow_genres: ['pop'], seed_genres: ['pop'] };
    const discoveryTracks = [{ id: 'd9', provider: 'spotify' }];

    await orchestrator.generateV2({ userId: 'u1', musicProfile: {}, moodKey: 'calm', aiParams, discoveryTracks });

    expect(selectPlaylist).toHaveBeenCalledWith(expect.objectContaining({ aiParams, discoveryTracks }));
  });

  it('uses a precomputed targets verbatim (no recompute) when one is provided', async () => {
    const T = { bpmCenter: 137, bpmWidth: 12, energyFloor: 0.4, energyCeiling: 0.8, confidence: 0.85 };

    const out = await orchestrator.generateV2({ userId: 'u1', musicProfile: {}, moodKey: 'calm', targets: T });

    // The exact object flows into the selector AND back out — the pipeline and discovery
    // must key off ONE identical band (no second translate, no drift).
    expect(selectPlaylist.mock.calls[0][0].targets).toBe(T);
    expect(out.targets).toBe(T);
    // No biometric read happened — the band was not recomputed.
    expect(peekBaselines).not.toHaveBeenCalled();
    expect(MedicalProfile.findOne).not.toHaveBeenCalled();
  });

  it('recomputes the band (reads baselines) when no targets are provided', async () => {
    await orchestrator.generateV2({ userId: 'u1', musicProfile: {}, moodKey: 'calm' });
    expect(peekBaselines).toHaveBeenCalled();
  });
});

describe('orchestrator.buildTargets (extracted biosonic-targets builder)', () => {
  it('is exported and assembles a finite biosonic band from the biometric inputs', async () => {
    expect(typeof orchestrator.buildTargets).toBe('function');
    const targets = await orchestrator.buildTargets({ userId: 'u1', moodKey: 'energize', live: { heartRate: 100, activity: 'walking' } });
    expect(targets.bpmCenter).toBe(118);            // walking cadence lock
    expect(Number.isFinite(targets.energyCeiling)).toBe(true);
    expect(peekBaselines).toHaveBeenCalled();
  });
});
