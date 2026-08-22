'use strict';

// W4-015 — the full-stack soak: drives `sim/soak.js`'s injected `replay` hook across every
// real persona + holdout (`sim/personas.js`) through the REAL socket ingest stack
// (`biometricHandler` -> `anomalyFilter` -> `liveStateAdapter` -> `affectEngine` ->
// `stateTaxonomy`), against a REAL Mongo (mongodb-memory-server) and a fake-but-real-semantics
// Redis, and folds each persona's resolved taxonomy-STATE dwell into the soak report.
//
// Why a fake Redis, unlike `sim.replay.integration.test.js`: that suite deliberately leaves
// `config/redis` unmocked, so `getRedis()` returns null and the affect posterior never
// persists — sufficient for what it tests (consent gate, debounce, batch lane). THIS suite
// exists because the affect/taxonomy layer needs a live posterior to observe, so it opts in to
// the exact fake `liveStateAdapter.test.js` already uses. The mock is file-scoped (jest.mock is
// per test file), so the wider replay suite's "no Redis" behaviour is untouched.
//
// Two `sim/replay.js` seams are new here (W4-015): `onEvent` (a per-delivered-event hook — the
// only way to sample state DURING a run rather than only its final counts) and `injectSimTime`
// (passes the event's own `atMs` through as `handleBiometricReading`'s `opts.now`, so the affect
// engine's Δt-based sticky transitions (§M.5) advance in SIMULATED time — without it a
// multi-day replay finishes in milliseconds of real wall-clock time and the temporal layer sees
// a Δt of ~0 on every reading, which would make every dwell/hysteresis assertion meaningless).

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET = 'test-jwt-secret-for-tests-only';
// W4-000/S1a: a shell-exported REDIS_URL would make `enqueue` construct a real BullMQ Queue.
delete process.env.REDIS_URL;

jest.mock('../app/config/redis', () => ({ getRedis: jest.fn(), createConnection: jest.fn() }));

// ── Outbound generation boundary only (same set as sim.replay.integration.test.js) ──────────
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
jest.mock('../app/repositories/shadowBufferRepo', () => ({
  getBuffer: jest.fn(async () => ({ tracks: [], familiar: 0, discovery: 0 })),
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

const { runSoak, soakPersonaScope } = require('../sim/soak');
const { generate } = require('../sim/generator');
const { listPersonaIds, listHoldoutIds } = require('../sim/personas');
const {
  createReplaySocket, closeReplaySocket, replaySocketLane, replayBatchLane, flush,
} = require('../sim/replay');
const { getRedis } = require('../app/config/redis');
const { peekAffectState } = require('../app/services/biosonic/affectCache');
const { getBaselines } = require('../app/services/biosonic/baselines');
const { STATES } = require('../app/agents/runtime/knowledge/stateTaxonomy');

const BiometricLog = require('../app/models/BiometricLog');
const MedicalProfile = require('../app/models/MedicalProfile');
const { _resetDebounceState } = require('../app/sockets/biometricHandler');

jest.setTimeout(180000);

const T0 = Date.UTC(2026, 6, 6, 0, 0, 0);
const DAY_MS = 24 * 3600 * 1000;

function fakeRedis() {
  const store = new Map();
  return {
    store,
    get: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    set: jest.fn(async (k, v) => { store.set(k, v); return 'OK'; }),
    del: jest.fn(async (...ks) => ks.filter((k) => store.delete(k)).length),
  };
}

let mem;

beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_wave4_fullstack_soak' });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});

beforeEach(async () => {
  await Promise.all([BiometricLog.deleteMany({}), MedicalProfile.deleteMany({})]);
  jest.clearAllMocks();
  getRedis.mockReturnValue(fakeRedis());
});

afterEach(() => { _resetDebounceState(); });

// ── replay.js API additions (W4-015) ─────────────────────────────────────────────────────────
describe('replaySocketLane — onEvent + injectSimTime (W4-015 additions)', () => {
  test('onEvent fires once per delivered event, in order, with the event and its index', async () => {
    const run = generate({
      persona: 'athlete', seed: 1, startAt: T0, days: 1, sampleIntervalSec: 300,
    });
    const uid = new mongoose.Types.ObjectId().toString();
    const socket = createReplaySocket({ userId: uid });
    const seen = [];

    await replaySocketLane({
      run, socket, lane: 'direct', maxEvents: 5,
      onEvent: async (ev, index) => { seen.push({ atMs: ev.atMs, index }); },
    });
    closeReplaySocket(socket);

    expect(seen.map((s) => s.index)).toEqual([0, 1, 2, 3, 4]);
    expect(seen.map((s) => s.atMs)).toEqual(run.socket.events.slice(0, 5).map((e) => e.atMs));
  });

  test('injectSimTime stamps the affect posterior with the EVENT timestamp, not wall-clock time', async () => {
    const run = generate({
      persona: 'athlete', seed: 2, startAt: T0, days: 1, sampleIntervalSec: 300,
    });
    const uid = new mongoose.Types.ObjectId().toString();
    const socket = createReplaySocket({ userId: uid });

    await replaySocketLane({
      run, socket, lane: 'direct', liveMode: true, injectSimTime: true, maxEvents: 3,
      onEvent: async () => { await flush(20); },
    });
    closeReplaySocket(socket);

    const lastEv = run.socket.events[2];
    const carried = await peekAffectState(uid, { now: lastEv.atMs });
    expect(carried).not.toBeNull();
    // T0 is 2026-07-06 — decades before the real clock the test executes under. If the posterior
    // had been stamped with `Date.now()` instead of the injected sim time, this delta would be
    // enormous rather than a few minutes.
    expect(Math.abs(carried.lastAtMs - lastEv.atMs)).toBeLessThan(10 * 60 * 1000);
  });

  test('without injectSimTime (default), the affect posterior is stamped with real wall-clock time', async () => {
    const run = generate({
      persona: 'athlete', seed: 3, startAt: T0, days: 1, sampleIntervalSec: 300,
    });
    const uid = new mongoose.Types.ObjectId().toString();
    const socket = createReplaySocket({ userId: uid });

    const before = Date.now();
    await replaySocketLane({
      run, socket, lane: 'direct', liveMode: true, maxEvents: 3,
      onEvent: async () => { await flush(20); },
    });
    const after = Date.now();
    closeReplaySocket(socket);

    const carried = await peekAffectState(uid, { now: after });
    expect(carried).not.toBeNull();
    expect(carried.lastAtMs).toBeGreaterThanOrEqual(before);
    expect(carried.lastAtMs).toBeLessThanOrEqual(after);
  });

  test('rejects an unknown lane exactly as before (contract unchanged by the new options)', async () => {
    const run = generate({ persona: 'athlete', seed: 4, startAt: T0, days: 1 });
    const socket = createReplaySocket({ userId: 'u-x' });
    await expect(replaySocketLane({ run, socket, lane: 'nope', onEvent: () => {} }))
      .rejects.toThrow(RangeError);
  });
});

// ── the full-stack soak itself ────────────────────────────────────────────────────────────────
//
// W4-D60: the sweep is `soakPersonaScope()`, NOT a hardcoded persona list. Ungated that is one
// core persona + one holdout; under `RUN_SOAK=1` it is the whole population, which is what this
// suite always used to run — and what made it the slowest suite in the repo by 2x, inside a
// default budget the mission says the soak never belongs in. The integration coverage is what
// is worth keeping, so the SCALE moved and the coverage did not.
describe('full-stack soak (W4-015)', () => {
  test('the sweep is the RUN_SOAK-gated scope, not a hardcoded persona list', () => {
    // Pins the wiring itself: without this, the scope could be re-widened by a one-line edit
    // here and the gate in sim/soak.js would still pass all of its own tests.
    const scope = soakPersonaScope();
    expect(scope.ids).toEqual([...scope.personas, ...scope.holdouts]);
    if (process.env.RUN_SOAK === '1') {
      expect(scope.full).toBe(true);
      expect(scope.ids).toEqual([...listPersonaIds(), ...listHoldoutIds()]);
    } else {
      expect(scope.full).toBe(false);
      expect(scope.ids).toHaveLength(2);
      expect(listHoldoutIds()).toContain(scope.holdouts[0]);
    }
  });

  test('every persona in scope resolves a taxonomy-state dwell histogram with bounded transitions and memory', async () => {
    const ids = soakPersonaScope().ids;
    const seedDwell = () => Object.fromEntries(STATES.map((s) => [s.id, 0]));
    const totalStateDwell = seedDwell();
    const perPersona = [];

    const report = await runSoak({
      seed: 'w4-015-fullstack',
      startAt: T0,
      days: 1,
      sampleIntervalSec: 300,
      personas: ids,
      logger: (line) => console.log(line), // S15: the soak's own house telemetry line, and the closeout report's evidence
      replay: async (run, personaId) => {
        const uid = new mongoose.Types.ObjectId().toString();

        // Warm this user's personal baseline from 7 days of PRIOR history before replaying
        // "today": real baselines are computed from PAST days, not the day being judged against
        // them, and the whole point of wiring `peekBaselines` into the live posterior (this
        // task's own fix) is to give the affect axes something real to grade today against —
        // a cold, unwarmed baseline would exercise the fallback path, not personalization.
        const historyRun = generate({
          persona: personaId, seed: `${personaId}-history`, startAt: T0 - 7 * DAY_MS, days: 7,
          sampleIntervalSec: 300, batchSampleIntervalSec: 300, artifacts: false,
        });
        await replayBatchLane({ run: historyRun, userId: uid });
        await getBaselines(uid);

        const socket = createReplaySocket({ userId: uid });
        const stateDwell = seedDwell();
        let transitions = 0;
        let lastLabel = null;
        let resolved = 0;

        await replaySocketLane({
          run, socket, lane: 'direct', liveMode: true, injectSimTime: true,
          onEvent: async (ev) => {
            await flush(20);
            const carried = await peekAffectState(uid, { now: ev.atMs });
            const label = carried?.label ?? null;
            if (!label) return;
            resolved += 1;
            stateDwell[label] = (stateDwell[label] || 0) + 1;
            if (lastLabel && label !== lastLabel) transitions += 1;
            lastLabel = label;
          },
        });
        const batch = await replayBatchLane({ run, userId: uid });
        closeReplaySocket(socket);

        for (const [k, v] of Object.entries(stateDwell)) totalStateDwell[k] += v;
        const summary = {
          personaId, stateDwell, transitions, resolved, batchInserted: batch.inserted,
        };
        perPersona.push(summary);
        return summary;
      },
    });

    for (const p of perPersona) {
      const distinct = Object.entries(p.stateDwell).filter(([, n]) => n > 0)
        .map(([id, n]) => `${id}=${n}`).join(',');
      console.log(`[w4-015.soak] persona=${p.personaId} resolved=${p.resolved} transitions=${p.transitions} `
        + `batchInserted=${p.batchInserted} states={${distinct}}`);
    }

    // ── the scope was actually swept end to end — no persona silently skipped. Compared as a
    //    SET: `runSoak` starts every persona's replay on the same tick (soak.js — the `pending`
    //    array) and only awaits them together, so `perPersona` is in completion order, which is
    //    not the scope order and was never promised to be.
    expect([...perPersona.map((p) => p.personaId)].sort()).toEqual([...ids].sort());

    // ── every persona actually resolved a taxonomy state on at least some readings
    for (const p of perPersona) {
      expect(p.resolved).toBeGreaterThan(0);
    }

    // ── no pathological label flap: a 5-minute cadence against 3-30 minute dwell priors must
    //    transition on far fewer readings than it resolves a state at all.
    for (const p of perPersona) {
      expect(p.transitions).toBeLessThan(p.resolved);
    }

    // ── the batch lane landed real rows for every persona too (the OTHER ingest lane a soak
    //    must cover, not just the streaming one).
    for (const p of perPersona) {
      expect(p.batchInserted).toBeGreaterThan(0);
    }

    // ── memory: soak's own report field (W4-002), unchanged shape — a full-stack replay across
    //    the whole scope must not balloon the process. Generous ceiling: the property under test
    //    is boundedness, not a tight number this suite would need to keep re-tuning. Deliberately
    //    NOT scaled down with the scope (W4-D60) — the ceiling exists to catch a leak, and a leak
    //    that only shows under RUN_SOAK=1 is exactly the one worth catching there.
    expect(report.memory.heapUsedDeltaBytes).toBeLessThan(300 * 1024 * 1024);

    // ── coverage: record which of the ~34 taxonomy states this one simulated day actually hit.
    //    NOT asserted as "all of them" — a single simulated day is not expected to reach every
    //    state (many need multi-day sleep-debt/episode combinations, stateTaxonomy.js's own
    //    reachability notes). The floor scales with the scope (W4-D60): ungated, the pair must
    //    still resolve MORE THAN ONE distinct state or the engine is reporting one label for
    //    everyone; the full population is held to a strictly higher bar than the pair, so
    //    shrinking the default budget cannot quietly weaken what RUN_SOAK=1 proves.
    const hit = Object.entries(totalStateDwell).filter(([, n]) => n > 0).map(([id]) => id);
    expect(hit.length).toBeGreaterThan(soakPersonaScope().full ? 2 : 1);
  }, 150000);
});
