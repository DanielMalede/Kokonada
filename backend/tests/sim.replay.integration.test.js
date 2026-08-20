'use strict';

// W4-002 — the replay harness, against a REAL Mongo (mongodb-memory-server).
//
// The generator's own suite proves the fixture is honest. This one proves the fixture
// actually drives PRODUCTION code: the real `wearable/adapter`, the real Art.9 consent
// gate, the real `isValidReading`, the real debounce/band trigger, and the real
// `healthStore.ingestBatch → metricStore.persistMetrics → BiometricLog/MedicalProfile`.
//
// Only the outbound generation boundary is mocked (Groq / Spotify / YouTube / the shadow
// buffer / the serve ledger) — a network this harness cannot reach. Everything between the
// sensor and the trigger decision is the shipped code. In particular the wearable adapter
// is NOT mocked here: W4-D07 records what happens when it is, and W4-003 is about to wire
// the anomaly filter into exactly that seam.
//
// Several pins below assert what the system does TODAY rather than what it should do.
// That is deliberate: D10 ("live socket samples are never persisted") and the S6 future-
// timestamp gap are both scheduled fixes, and a pin on the current behaviour is what makes
// the fix visible as a deliberate change instead of an unnoticed drift. Each is labelled.

process.env.NODE_ENV       = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET     = 'test-jwt-secret-for-tests-only';
// The W4-000/S1a lesson, applied preventively: `backend/.env` carries a REDIS_URL, and a
// shell that exported it would make `enqueue` construct a real BullMQ Queue against a host
// that is not there — an open handle the W4-D06 teardown guard would (correctly) fail the
// whole run on. Without it, enqueue is a documented graceful no-op.
delete process.env.REDIS_URL;

// ── Outbound generation boundary only ────────────────────────────────────────
jest.mock('../app/services/spotify', () => ({
  getValidToken: jest.fn(), getRecommendations: jest.fn(), fetchVibeDiscovery: jest.fn(),
  getArtistsGenres: jest.fn(), artistGenresAvailable: jest.fn(() => true),
  markDiscoveryUnavailable: jest.fn(),
}));
jest.mock('../app/services/youtube', () => ({
  getValidToken: jest.fn(), searchRecommendations: jest.fn(),
}));
jest.mock('../app/services/geminiEngine', () => ({
  buildEmotionPlaylist: jest.fn(), adjustBiometricPlaylist: jest.fn(), critiqueTrackVibe: jest.fn(),
}));
jest.mock('../app/services/generation/orchestrator', () => ({
  generateV2: jest.fn(async () => ({
    familiar: [], discovery: [], merged: [],
    telemetry: { poolSize: 0, afterFilters: 0, relaxLevel: 0, stageMs: { total: 1 } },
    targets: { bpmCenter: 120 },
  })),
  buildTargets: jest.fn(async () => ({ bpmCenter: 120 })),
}));
jest.mock('../app/services/discovery/discoveryFetch', () => ({ vectorDiscoveryFetch: jest.fn(async () => []) }));
jest.mock('../app/services/discovery/captionService', () => ({ captionDiscovery: jest.fn(async () => new Map()) }));
jest.mock('../app/services/playlistMixer', () => ({
  personalizeWhitelist: jest.fn(), generateFallbackPlaylist: jest.fn().mockReturnValue([]),
}));
jest.mock('../app/services/features/featureService', () => ({
  hydrate: jest.fn(), enqueueHydration: jest.fn().mockResolvedValue({ queued: true }),
}));
jest.mock('../app/repositories/trackCatalogRepo', () => ({
  updateResolvedUris: jest.fn(async () => ({ updated: 0 })),
  invalidateResolvedUri: jest.fn(async () => ({ invalidated: false })),
  upsertMany: jest.fn(async () => ({ upserted: 0 })),
  getMany: jest.fn(async () => new Map()),
}));
jest.mock('../app/config/sentry', () => ({
  initSentry: jest.fn(), getSentry: jest.fn(() => null),
  captureException: jest.fn(), scrubEvent: jest.fn((e) => e),
}));

const WARM_TRACKS = [
  { id: 'w1', name: 'Warm One', canonicalKey: 'mbid:warm-one', artists: [{ name: 'A' }], uri: 'youtube:w1' },
  { id: 'w2', name: 'Warm Two', canonicalKey: 'mbid:warm-two', artists: [{ name: 'B' }], uri: 'youtube:w2' },
];
jest.mock('../app/repositories/shadowBufferRepo', () => ({
  getBuffer: jest.fn(async () => ({ tracks: [
    { id: 'w1', name: 'Warm One', canonicalKey: 'mbid:warm-one', artists: [{ name: 'A' }], uri: 'youtube:w1' },
    { id: 'w2', name: 'Warm Two', canonicalKey: 'mbid:warm-two', artists: [{ name: 'B' }], uri: 'youtube:w2' },
  ], familiar: 2, discovery: 0 })),
  setBuffer: jest.fn(async () => true),
}));
jest.mock('../app/services/ledger/serveLedger', () => ({
  recordServes: jest.fn().mockResolvedValue({ recorded: 0 }),
  hardExcluded: jest.fn().mockResolvedValue(new Set()),
  moodExcluded: jest.fn().mockResolvedValue(new Set()),
  getExposure: jest.fn().mockResolvedValue(new Map()),
}));

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { generate } = require('../sim/generator');
const { PERSONAS } = require('../sim/personas');
const {
  createReplaySocket, closeReplaySocket, peekState,
  replaySocketLane, replayBatchLane, replayRun,
} = require('../sim/replay');

const BiometricLog   = require('../app/models/BiometricLog');
const MedicalProfile = require('../app/models/MedicalProfile');
const ConsentRecord  = require('../app/models/ConsentRecord');
const { _debounceMap } = require('../app/sockets/biometricHandler');
const { isPhysiologicalHR } = require('../app/services/wearable/hrRange');
const { CURRENT_CONSENT_VERSION, HEALTH_CONSENT_PURPOSE } = require('../app/services/privacy/consent');

jest.setTimeout(180000);

const T0 = Date.UTC(2026, 6, 6, 0, 0, 0);

let mem;
let userId;

async function grantConsent(uid, status = 'granted') {
  await ConsentRecord.create({
    userId: uid,
    purpose: HEALTH_CONSENT_PURPOSE,
    consentVersion: CURRENT_CONSENT_VERSION,
    dataCategories: ['heart_rate', 'hrv', 'sleep', 'resting_heart_rate'],
    status,
    grantedAt: status === 'granted' ? new Date(T0) : undefined,
    withdrawnAt: status === 'withdrawn' ? new Date(T0) : undefined,
  });
}

beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_wave4_sim_replay' });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});

beforeEach(async () => {
  await Promise.all([
    BiometricLog.deleteMany({}),
    MedicalProfile.deleteMany({}),
    ConsentRecord.deleteMany({}),
  ]);
  userId = new mongoose.Types.ObjectId();
  jest.clearAllMocks();
});

afterEach(() => {
  // Belt and braces on top of every test's own closeReplaySocket: no armed debounce timer
  // may outlive a test (W4-D06 — a leaked 60 s timer fires inside a LATER suite).
  const { _resetDebounceState } = require('../app/sockets/biometricHandler');
  _resetDebounceState();
});

// A short, realistic watch-cadence run: 5-minute pings for one day.
const watchRun = (personaId, extra = {}) => generate({
  persona: personaId, seed: 2026, startAt: T0, days: 1, sampleIntervalSec: 300, ...extra,
});

// ─────────────────────────────────────────────────────────────────────────────
describe('replay — the batch lane round-trips into real collections', () => {
  test('every emitted heart_rate sample lands as a BiometricLog row', async () => {
    const run = watchRun('athlete', { artifacts: false });
    const report = await replayBatchLane({ run, userId: userId.toString() });

    const emittedHr = run.healthStore.batches.flat().filter((s) => s.type === 'heart_rate').length;
    expect(report.errors).toEqual([]);
    expect(report.submitted).toBe(run.healthStore.batches.flat().length);
    expect(report.accepted).toBe(report.submitted);
    expect(report.inserted).toBe(emittedHr);

    const rows = await BiometricLog.countDocuments({ userId });
    expect(rows).toBe(emittedHr);
  });

  test('stored heart rates decrypt back to the values the simulator emitted', async () => {
    const run = watchRun('athlete', { artifacts: false });
    await replayBatchLane({ run, userId: userId.toString() });

    const emitted = run.healthStore.batches.flat()
      .filter((s) => s.type === 'heart_rate')
      .map((s) => s.value)
      .sort((a, b) => a - b);
    // Full documents, not `.lean()`: heartRate is an encrypted field whose getter does the
    // decryption, and a lean read hands back ciphertext that `Number()` turns into NaN —
    // which would have made this pin pass vacuously if it only checked the length.
    const stored = (await BiometricLog.find({ userId }))
      .map((d) => Number(d.heartRate))
      .sort((a, b) => a - b);

    expect(stored).toHaveLength(emitted.length);
    expect(stored.every(isPhysiologicalHR)).toBe(true);
    expect(stored).toEqual(emitted);
  });

  test('batch rows carry activity "unknown" — the D2 pooling this fixture must reproduce', async () => {
    // metricStore hardcodes activity:'unknown' on every batch row, which is why a resting
    // baseline computed off this lane is pooled with workouts. W4-004 decontaminates it;
    // until then this pin states the contamination is really present in the fixture.
    const run = watchRun('athlete', { artifacts: false });
    await replayBatchLane({ run, userId: userId.toString() });
    const activities = new Set((await BiometricLog.find({ userId }).lean()).map((d) => d.activity));
    expect([...activities]).toEqual(['unknown']);
  });

  test('profile scalars (resting HR, HRV, sleep stages) reach MedicalProfile', async () => {
    const run = watchRun('athlete', { artifacts: false });
    const report = await replayBatchLane({ run, userId: userId.toString() });
    expect(report.errors).toEqual([]);

    const profile = await MedicalProfile.findOne({ userId });
    expect(profile).toBeTruthy();
    expect(Number(profile.restingHeartRate)).toBeGreaterThan(30);
    expect(Number(profile.restingHeartRate)).toBeLessThan(120);
    expect(Number(profile.hrv)).toBeGreaterThan(0);
    const stages = profile.sleepStages || {};
    expect(Number(stages.deep) + Number(stages.light) + Number(stages.rem)).toBeGreaterThan(120);
  });

  test('replaying the same batches twice inserts nothing new (source@recordedAt dedupe)', async () => {
    const run = watchRun('athlete', { artifacts: false });
    const first = await replayBatchLane({ run, userId: userId.toString() });
    const second = await replayBatchLane({ run, userId: userId.toString() });

    expect(first.inserted).toBeGreaterThan(0);
    expect(second.inserted).toBe(0);
    expect(await BiometricLog.countDocuments({ userId })).toBe(first.inserted);
  });

  test('a dirty batch never throws out of the harness', async () => {
    const run = watchRun('sedentary', { artifacts: true });
    const report = await replayBatchLane({ run, userId: userId.toString() });
    expect(Array.isArray(report.errors)).toBe(true);
    expect(report.submitted).toBeGreaterThan(0);
    const rows = await BiometricLog.countDocuments({ userId });
    expect(rows).toBeLessThanOrEqual(report.submitted);
  });

  test('W4-D08 FIXED: an out-of-range sample is counted as rejected, not reported as inserted', async () => {
    // Was: "MEASURED: one out-of-range sample is dropped silently and `inserted` over-reports" —
    // a deliberate pin on the DEFECT, written by W4-002 so the fix would flip it loudly. It has.
    // BiometricLog caps heartRate at 300 and a x2 PPG artifact on a workout reading clears that
    // easily; `insertMany({ ordered: false })` still writes the good rows and still does not reject.
    // What changed is the accounting: the count now comes from the driver, and the refused row is
    // surfaced by path + validator kind (never by value — the value is the vital).
    const run = watchRun('athlete', { artifacts: false });
    const batches = run.healthStore.batches.map((b) => b.map((s) => ({ ...s })));
    const poisonedRow = batches[0].find((s) => s.type === 'heart_rate');
    expect(poisonedRow).toBeTruthy();
    poisonedRow.value = 340; // in-band for the adapter, out of range for the model
    const poisoned = { ...run, healthStore: { ...run.healthStore, batches } };

    const report = await replayBatchLane({ run: poisoned, userId: userId.toString() });
    const emittedHr = batches.flat().filter((s) => s.type === 'heart_rate').length;

    expect(report.errors).toEqual([]);                 // still no throw — the write is still partial
    expect(report.inserted).toBe(emittedHr - 1);       // ...and the count finally says so
    expect(await BiometricLog.countDocuments({ userId })).toBe(emittedHr - 1);
    expect(report.inserted).toBe(await BiometricLog.countDocuments({ userId }));

    // The reject is surfaced rather than dropped, and carries no submitted value.
    expect(report.rejected.count).toBe(1);
    expect(report.rejected.reasons).toEqual([{ path: 'heartRate', reason: 'user-defined', count: 1 }]);
    expect(JSON.stringify(report.rejected)).not.toMatch(/340/);
  });

  test(
    'a clean batch reports zero rejects, so a non-zero count always means something was refused',
    async () => {
      const run = watchRun('athlete', { artifacts: false });
      const report = await replayBatchLane({ run, userId: userId.toString() });
      expect(report.rejected).toEqual({ count: 0, reasons: [] });
      expect(report.inserted).toBe(await BiometricLog.countDocuments({ userId }));
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
describe('replay — the socket lane runs the real gates', () => {
  test('with a current grant every clean reading is acked', async () => {
    await grantConsent(userId);
    const run = watchRun('sedentary', { artifacts: false });
    const socket = createReplaySocket({ userId });

    const report = await replaySocketLane({ run, socket, lane: 'stream' });
    closeReplaySocket(socket);

    expect(report.delivered).toBe(run.socket.events.length);
    expect(report.acks).toBe(run.socket.events.length);
    expect(report.rejected).toBe(0);
  });

  test('the Art.9 gate is real: without a grant, nothing is processed at all', async () => {
    // No ConsentRecord at all — fail-closed.
    const run = watchRun('sedentary', { artifacts: false });
    const socket = createReplaySocket({ userId });
    const report = await replaySocketLane({ run, socket, lane: 'stream' });
    closeReplaySocket(socket);

    expect(report.delivered).toBe(run.socket.events.length);
    expect(report.acks).toBe(0);
    expect(report.rejected).toBe(0); // dropped before the handler, not error-acked
    expect(peekState(socket)).toBeNull();
  });

  test('a withdrawn grant is also fail-closed', async () => {
    await grantConsent(userId, 'withdrawn');
    const run = watchRun('sedentary', { artifacts: false });
    const socket = createReplaySocket({ userId });
    const report = await replaySocketLane({ run, socket, lane: 'stream' });
    closeReplaySocket(socket);
    expect(report.acks).toBe(0);
  });

  // Artifacts are rare by design (a stream that is 20% garbage tests only the gate), so
  // these two run at 1-minute cadence over two days — 2880 readings — where every class is
  // reliably present. They use the `direct` lane so 2880 consent lookups do not turn a
  // gate assertion into a database benchmark; the consent gate has its own pins above.
  const denseRun = (personaId) => generate({
    persona: personaId, seed: 2026, startAt: T0, days: 2, sampleIntervalSec: 60, artifacts: true,
  });

  test('out-of-range artifacts are rejected by the real gate, exactly as many as were emitted', async () => {
    const run = denseRun('sedentary');
    const expectedBad = run.socket.events
      .filter((e) => !isPhysiologicalHR(e.payload.raw.heartRate)).length;
    expect(expectedBad).toBeGreaterThan(0); // the fixture must actually contain some

    const socket = createReplaySocket({ userId });
    const report = await replaySocketLane({ run, socket, lane: 'direct' });
    closeReplaySocket(socket);

    expect(report.rejected).toBe(expectedBad);
    expect(report.acks).toBe(run.socket.events.length - expectedBad);
  });

  test('FIXED: a future-dated reading still ACKS (well-formed payload) but never confirms a heart rate (S6, W4-003)', async () => {
    const run = denseRun('sedentary');
    const future = run.artifacts.filter((a) => a.kind === 'futureTimestamp' && a.lane === 'socket');
    expect(future.length).toBeGreaterThan(0);

    const socket = createReplaySocket({ userId });
    await replaySocketLane({ run, socket, lane: 'direct' });
    const acked = socket._events('biometric_ack')
      .map((e) => e.payload.normalized.recordedAt.getTime());
    const state = peekState(socket);
    closeReplaySocket(socket);

    // isValidReading only requires recordedAt to be a PARSEABLE date, so the payload itself
    // still sails through to an ack — that part of "today" is unchanged and correct (the
    // ack means "well-formed", never "trusted"). What W4-003 closes is downstream: the A0
    // anomaly filter's own S6 gate saw and rejected the same future-dated readings, so they
    // never drove a confirmed heart rate or a live BiometricLog row (see the next test).
    expect(acked.some((t) => t > run.meta.endAtMs + 5 * 60 * 1000)).toBe(true);
    expect(state.filterState.rejectedCount).toBeGreaterThan(0);
  });

  test('FIXED: the live socket lane now persists accepted readings (D10, closed by W4-003)', async () => {
    await grantConsent(userId);
    const run = watchRun('athlete', { artifacts: false });
    const socket = createReplaySocket({ userId });
    await replaySocketLane({ run, socket, lane: 'stream' });
    closeReplaySocket(socket);

    // Throttled to <=1 row/min per socket (LIVE_PERSIST_MIN_INTERVAL_MS) — a 5-minute watch
    // cadence never contends with the throttle, so every accepted reading should persist.
    const rows = await BiometricLog.find({ userId }).lean();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(run.socket.events.length);
    // Real device values, real activity/source — not the batch lane's hardcoded 'unknown'.
    const activities = new Set(rows.map((r) => r.activity));
    expect([...activities]).not.toEqual(['unknown']);
    expect(rows.every((r) => r.source === 'garmin')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('replay — the watch (immediate) lane and Live mode', () => {
  // The immediate lane triggers on a band crossing OR an activity change, and the shadow
  // buffer is keyed `bio:<band>:<activity>` — so both are genuine, different serves. To
  // measure the BAND axis (which is what W4-D05's hysteresis governs) these fixtures pin
  // the ambient activity label still; otherwise the count measures the stillness
  // classifier's flicker rate, not the band trigger. The activity axis gets its own
  // measurement below rather than being folded in and confusing both.
  const STILL = Object.freeze({ stillDwellMin: 1e9, movingDwellMin: 1e9 });
  const NO_BUMPS = Object.freeze({
    bumpsPerDay: 0, durationMinRange: [4, 12], amplitudeBpmRange: [8, 20],
  });

  test('Manual is the default: a full day of band crossings serves nothing', async () => {
    // The product gate §0.2.6 pins: a user who never opted into Live is never auto-driven.
    const run = watchRun('athlete', { artifacts: false });
    const socket = createReplaySocket({ userId });
    const report = await replaySocketLane({ run, socket, lane: 'watch', liveMode: false });
    closeReplaySocket(socket);

    expect(report.acks).toBe(run.socket.events.length);
    expect(report.playlists).toBe(0);
    expect(report.coldServes).toBe(0);
  });

  test('Live mode serves the warm buffer on real band transitions, and only on those', async () => {
    const persona = { ...PERSONAS.athlete, id: 'simAthleteSteadyLabel', stillness: STILL, dailyLife: NO_BUMPS };
    const run = generate({
      persona, seed: 2026, startAt: T0, days: 1, sampleIntervalSec: 300, artifacts: false,
    });
    const socket = createReplaySocket({ userId });
    const report = await replaySocketLane({ run, socket, lane: 'watch', liveMode: true });
    closeReplaySocket(socket);

    expect(report.playlists).toBeGreaterThan(0);
    for (const e of socket._events('playlist_ready')) {
      expect(e.payload.trigger).toBe('biometric');
      expect(e.payload.buffered).toBe(true);
      expect(e.payload.tracks).toHaveLength(WARM_TRACKS.length);
    }

    // Bounded by physiology, not by chance: one day with one workout produces a handful of
    // genuine transitions (into the workout's activity, up through the bands, and back).
    // The W4-D05 hysteresis is what keeps this from being one serve per 5-minute ping —
    // there are 288 of those.
    expect(report.playlists).toBeLessThan(12);
  });

  test('MEASURED: an ambient activity-label flip re-serves immediately — no dwell, no latch', async () => {
    // Not a judgement, a measurement. The buffer key really does change when the watch
    // relabels a still body from 'resting' to 'unknown', so the serve is not the
    // identical-key waste D11 was about. What this records is that the ACTIVITY axis has
    // none of the three protections W4-D05 gave the HR axis (noise floor, asymmetric
    // release, served-band latch), so its churn is exactly as fast as the classifier's.
    // W4-009 owns the real fix (state transitions with min-dwell across both axes); until
    // then this pin is the reproduction, and the flip rate below is the FIXTURE's, not a
    // sourced claim about any real watch.
    const flippy = {
      ...PERSONAS.sedentary,
      id: 'simLabelFlipper',
      episodes: [],
      dailyLife: NO_BUMPS,
      stillness: Object.freeze({ stillDwellMin: 20, movingDwellMin: 20 }),
    };
    const run = generate({
      persona: flippy, seed: 99, startAt: T0, days: 1, sampleIntervalSec: 300, artifacts: false,
    });
    let flips = 0;
    for (let i = 1; i < run.truth.samples.length; i++) {
      if (run.truth.samples[i].activity !== run.truth.samples[i - 1].activity) flips++;
    }
    expect(flips).toBeGreaterThan(10);

    const socket = createReplaySocket({ userId });
    const report = await replaySocketLane({ run, socket, lane: 'watch', liveMode: true });
    closeReplaySocket(socket);

    // One serve per label flip (plus the first-reading serve): no suppression whatsoever.
    expect(report.playlists).toBeGreaterThanOrEqual(flips);
  });

  test('the served-band latch holds through a resting oscillation across the 90 cut', async () => {
    // W4-D05's defect in situ: a persona whose quiet HR sits right on a band cut used to
    // re-serve on every ping. Driven through the REAL handler, not the pure predicate.
    const oscillating = {
      ...PERSONAS.sedentary,
      id: 'simOscillator',
      cosinor: { mesor: 90, amplitude: 1.5, acrophaseHours: 15 },
      restingHeartRate: 88.5,
      noise: { family: 'ou', sigmaBpm: 3.0, tauSeconds: 150 },
      episodes: [],
      dailyLife: NO_BUMPS,
      stillness: STILL, // isolate the HR band axis — this test is about W4-D05, not labels
    };
    const run = generate({
      persona: oscillating, seed: 4242, startAt: T0, days: 1,
      sampleIntervalSec: 300, artifacts: false,
    });
    const socket = createReplaySocket({ userId });
    const report = await replaySocketLane({ run, socket, lane: 'watch', liveMode: true });
    closeReplaySocket(socket);

    expect(report.acks).toBe(run.socket.events.length);
    // Without the asymmetric release + served-band latch this is dozens of serves.
    // W4-003 re-pin: the trigger now compares the FILTERED (Kalman) estimate, not the raw
    // ping, and a filtered trajectory is not bit-identical to the raw one — it carries its
    // own level/trend memory. For a signal hugging the cut this can move exactly ONE
    // crossing to a different 5-minute sample than the raw series alone would produce.
    // MEASURED here (seeded, deterministic): 5, not 4 — still bounded, still nowhere near
    // "dozens", so the hysteresis mechanism is doing its job; only the exact boundary count
    // shifted by the filtering this task added.
    expect(report.playlists).toBeLessThanOrEqual(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('replay — virtual time drives the streaming debounce', () => {
  test('advancing the clock matures a pending recalibration, and leaves no armed timer', async () => {
    // `direct` skips the consent listener (and therefore Mongo) so fake timers cannot
    // deadlock a driver round-trip. It is the same entry point server-side pollers use.
    const run = generate({
      persona: 'athlete', seed: 7, startAt: T0, days: 1,
      sampleIntervalSec: 300, artifacts: false,
    });
    const socket = createReplaySocket({ userId });

    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    let report;
    try {
      report = await replaySocketLane({
        run, socket, lane: 'direct', liveMode: true,
        onAdvance: async (ms) => { jest.advanceTimersByTime(ms); },
      });
    } finally {
      jest.useRealTimers();
    }

    expect(report.virtualTimeAdvanced).toBe(true);
    expect(report.acks).toBe(run.socket.events.length);
    // The debounce only exists on the streaming lane, so pendings prove we were on it.
    expect(report.pendings).toBeGreaterThan(0);
    // Every pending resolved one way or the other — nothing is still waiting.
    expect(report.state.timer).toBeNull();

    closeReplaySocket(socket);
    expect(_debounceMap.has(socket.id)).toBe(false);
  });

  test('without a clock the harness says so instead of silently under-reporting', async () => {
    const run = generate({
      persona: 'athlete', seed: 7, startAt: T0, days: 1,
      sampleIntervalSec: 300, artifacts: false,
    });
    const socket = createReplaySocket({ userId });
    const report = await replaySocketLane({ run, socket, lane: 'direct', liveMode: true });
    closeReplaySocket(socket);
    expect(report.virtualTimeAdvanced).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('replay — harness contract', () => {
  test('replayRun drives both lanes and reports each', async () => {
    await grantConsent(userId);
    const run = watchRun('olderAdult', { artifacts: false });
    const socket = createReplaySocket({ userId });
    const report = await replayRun({ run, userId: userId.toString(), socket, lane: 'stream' });
    closeReplaySocket(socket);

    expect(report.personaId).toBe('olderAdult');
    expect(report.socket.acks).toBeGreaterThan(0);
    expect(report.batch.inserted).toBeGreaterThan(0);
  });

  test('two replay sockets never share state', async () => {
    await grantConsent(userId);
    const run = watchRun('athlete', { artifacts: false });
    const a = createReplaySocket({ userId });
    const b = createReplaySocket({ userId });
    expect(a.id).not.toBe(b.id);
    await replaySocketLane({ run, socket: a, lane: 'watch', maxEvents: 5 });
    await replaySocketLane({ run, socket: b, lane: 'watch', maxEvents: 5 });
    expect(peekState(a)).not.toBe(peekState(b));
    closeReplaySocket(a);
    closeReplaySocket(b);
    expect(_debounceMap.has(a.id)).toBe(false);
    expect(_debounceMap.has(b.id)).toBe(false);
  });

  test('the harness validates its own inputs', async () => {
    await expect(replaySocketLane({ run: null, socket: {} })).rejects.toThrow(/run|socket/i);
    await expect(replayBatchLane({ run: {}, userId: null })).rejects.toThrow(/userId|run/i);
    expect(() => createReplaySocket({})).toThrow(/userId/i);
    const run = watchRun('athlete', { artifacts: false });
    const socket = createReplaySocket({ userId });
    await expect(replaySocketLane({ run, socket, lane: 'nope' })).rejects.toThrow(/lane/i);
  });
});
