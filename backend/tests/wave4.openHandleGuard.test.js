/**
 * W4-D06 — the standing open-handle guard.
 *
 * `npm test` is `jest --runInBand --forceExit`. `--forceExit` kills the process the moment the
 * run finishes, so a test that leaves a live handle behind — a 60 s debounce timer, an ioredis
 * dial, a BullMQ repeatable, an un-closed server — exits 0 and nothing anywhere notices. That is
 * how two leaked `setTimeout`s from `biometricHandler.js` survived a whole wave: the suite was
 * green either way, and the only thing that ever said otherwise was a flag nobody passes.
 *
 * The guard closes that hole at the one place that sees the whole run and still runs BEFORE
 * `--forceExit` takes the process out: jest's `globalTeardown`. It snapshots the process's active
 * resources before the first suite and again after the last one, and turns a surviving handle into
 * a non-zero exit that names the resource type.
 *
 * These pins cover the pure engine, the real wiring files, and — the part that matters — a
 * detector self-test proving the guard can still fail. A guard that has quietly stopped being able
 * to go red is worse than no guard, because it reads as evidence.
 */

process.env.NODE_ENV       = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET     = 'test-jwt-secret-for-tests-only';

// W4-003: handleBiometricReading fire-and-forgets a D10 persistence attempt against
// BiometricLog. The seam tests below drive it directly with a non-ObjectId fixture userId
// and no real Mongo connection — mocked so that attempt is a harmless no-op rather than an
// unresolved buffered command, which is exactly the kind of lingering handle this file's
// own guard exists to catch.
jest.mock('../app/models/BiometricLog', () => ({
  exists:     jest.fn().mockResolvedValue(false),
  insertMany: jest.fn().mockResolvedValue({ acknowledged: true, insertedCount: 1, insertedIds: {}, mongoose: { validationErrors: [] } }),
}));

const fs   = require('fs');
const path = require('path');

const guard = require('../jest/openHandleGuard');
const {
  IGNORED_TYPES,
  SNAPSHOT_KEY,
  countByType,
  diffResources,
  formatViolations,
  assertNoLeaks,
} = guard;

const BACKEND_ROOT = path.join(__dirname, '..');
const readBackend  = (rel) => fs.readFileSync(path.join(BACKEND_ROOT, rel), 'utf8');

// ── countByType ───────────────────────────────────────────────────────────────
describe('countByType — the tally the whole guard rests on', () => {
  it('returns an empty tally for an empty snapshot', () => {
    expect(countByType([])).toEqual({});
  });

  it('counts repeats of the same resource type', () => {
    expect(countByType(['Timeout', 'Timeout', 'TCPSocketWrap'])).toEqual({
      Timeout: 2, TCPSocketWrap: 1,
    });
  });

  it('is order independent — a snapshot is a multiset, not a sequence', () => {
    expect(countByType(['a', 'b', 'a'])).toEqual(countByType(['a', 'a', 'b']));
  });

  it.each([[null], [undefined], ['Timeout'], [42], [{}]])(
    'fails soft on a non-array snapshot (%p) instead of wedging the run', (bad) => {
      expect(countByType(bad)).toEqual({});
    });

  it('ignores non-string entries rather than tallying them', () => {
    expect(countByType(['Timeout', null, 7, undefined, 'Timeout'])).toEqual({ Timeout: 2 });
  });
});

// ── diffResources ─────────────────────────────────────────────────────────────
describe('diffResources — only GROWTH in a watched type is a leak', () => {
  it('reports nothing when the snapshots match', () => {
    expect(diffResources(['Timeout'], ['Timeout'])).toEqual([]);
  });

  it('reports a single new Timeout with its before/after counts', () => {
    expect(diffResources([], ['Timeout'])).toEqual([
      { type: 'Timeout', before: 0, after: 1, leaked: 1 },
    ]);
  });

  it('reports how MANY leaked, not merely that something did', () => {
    const [v] = diffResources(['Timeout'], ['Timeout', 'Timeout', 'Timeout']);
    expect(v).toMatchObject({ type: 'Timeout', before: 1, after: 3, leaked: 2 });
  });

  it('never reports a resource that CLOSED during the run', () => {
    expect(diffResources(['Timeout', 'Timeout'], ['Timeout'])).toEqual([]);
  });

  it('ignores growth in a type on the ignore list', () => {
    expect(diffResources([], ['Ignored'], { ignore: ['Ignored'] })).toEqual([]);
  });

  it('still catches a watched type when an ignored one also grew', () => {
    const out = diffResources([], ['Ignored', 'Timeout'], { ignore: ['Ignored'] });
    expect(out.map((v) => v.type)).toEqual(['Timeout']);
  });

  it('honours an explicit empty ignore list — the caller can watch everything', () => {
    const out = diffResources([], [IGNORED_TYPES[0] ?? 'TTYWrap'], { ignore: [] });
    expect(out).toHaveLength(1);
  });

  it('orders violations deterministically (worst leak first, then by type)', () => {
    const out = diffResources([], ['B', 'A', 'A', 'C', 'C', 'C']);
    expect(out.map((v) => v.type)).toEqual(['C', 'A', 'B']);
  });

  it.each([[null, ['Timeout']], [['Timeout'], null], [undefined, undefined]])(
    'fails soft on malformed snapshots (%p, %p) — the guard must never break the run itself',
    (before, after) => {
      expect(diffResources(before, after)).toEqual([]);
    });
});

// ── formatViolations ──────────────────────────────────────────────────────────
describe('formatViolations — the failure has to be actionable', () => {
  it('is empty when there is nothing to say', () => {
    expect(formatViolations([])).toBe('');
  });

  it('names the resource type and the leaked count', () => {
    const msg = formatViolations([{ type: 'Timeout', before: 0, after: 2, leaked: 2 }]);
    expect(msg).toContain('Timeout');
    expect(msg).toMatch(/2/);
  });

  it('names every violation, not just the first', () => {
    const msg = formatViolations([
      { type: 'Timeout', before: 0, after: 1, leaked: 1 },
      { type: 'TCPSocketWrap', before: 0, after: 1, leaked: 1 },
    ]);
    expect(msg).toContain('Timeout');
    expect(msg).toContain('TCPSocketWrap');
  });

  it('points at the escalation command that gives per-handle stack traces', () => {
    const msg = formatViolations([{ type: 'Timeout', before: 0, after: 1, leaked: 1 }]);
    expect(msg).toContain('test:handles');
  });
});

// ── assertNoLeaks ─────────────────────────────────────────────────────────────
describe('assertNoLeaks — the throw that becomes the non-zero exit', () => {
  it('is silent on a clean run', () => {
    expect(() => assertNoLeaks(['Timeout'], ['Timeout'])).not.toThrow();
  });

  it('throws when a handle survived the run', () => {
    expect(() => assertNoLeaks([], ['Timeout'])).toThrow();
  });

  it('puts the formatted violations in the message so the log is self-explaining', () => {
    expect(() => assertNoLeaks([], ['Timeout'])).toThrow(/Timeout/);
  });

  it('honours the ignore option', () => {
    expect(() => assertNoLeaks([], ['Whatever'], { ignore: ['Whatever'] })).not.toThrow();
  });
});

// ── the real wiring, read from disk ───────────────────────────────────────────
describe('wiring — the guard is actually installed, not merely written', () => {
  const pkg = JSON.parse(readBackend('package.json'));

  it('package.json wires globalSetup and globalTeardown to the guard', () => {
    expect(pkg.jest.globalSetup).toContain('jest/globalSetup');
    expect(pkg.jest.globalTeardown).toContain('jest/globalTeardown');
  });

  it('package.json wires the results processor that fails a --detectOpenHandles run', () => {
    expect(pkg.jest.testResultsProcessor).toContain('jest/openHandleResultsProcessor');
  });

  it('`npm test` keeps --runInBand and --forceExit (the guard replaces the mask, not the speed)', () => {
    expect(pkg.scripts.test).toContain('--runInBand');
    expect(pkg.scripts.test).toContain('--forceExit');
  });

  it('`npm test` deliberately does NOT carry --detectOpenHandles', () => {
    // The always-on guard is the resource delta, not jest's detector, because the detector filters
    // handles to user-code stacks — measured here reporting 2 where the delta reported 3, having
    // dropped one raised inside node_modules. Everything this wave adds next (ioredis, BullMQ
    // workers and repeatables) is constructed inside a dependency, so that filter would blind the
    // guard exactly where the risk lives. The deep scan stays opt-in: it costs async_hooks
    // instrumentation on every async resource and adds nothing the delta misses except the stack.
    expect(pkg.scripts.test).not.toContain('--detectOpenHandles');
  });

  it('the deep scan exists as `test:handles` and does carry --detectOpenHandles', () => {
    expect(pkg.scripts['test:handles']).toContain('--detectOpenHandles');
  });
});

// ── the wiring modules, executed for real ─────────────────────────────────────
describe('globalSetup / globalTeardown — executed, not just grepped', () => {
  const setupPath    = path.join(BACKEND_ROOT, 'jest', 'globalSetup.js');
  const teardownPath = path.join(BACKEND_ROOT, 'jest', 'globalTeardown.js');

  afterEach(() => { delete globalThis[SNAPSHOT_KEY]; });

  it('globalSetup records a snapshot under the shared key', async () => {
    delete globalThis[SNAPSHOT_KEY];
    await require(setupPath)();
    expect(Array.isArray(globalThis[SNAPSHOT_KEY])).toBe(true);
  });

  it('globalTeardown throws when a handle is still armed at the end of the run', async () => {
    const teardown = require(teardownPath);
    globalThis[SNAPSHOT_KEY] = [];
    const leak = setTimeout(() => {}, 60_000);
    try {
      await expect(teardown()).rejects.toThrow(/Timeout/);
    } finally {
      clearTimeout(leak); // this suite does not get to leak the handle it is testing for
    }
  });

  it('globalTeardown is silent when nothing leaked', async () => {
    const teardown = require(teardownPath);
    globalThis[SNAPSHOT_KEY] = process.getActiveResourcesInfo();
    await expect(teardown()).resolves.toBeUndefined();
  });

  it('globalTeardown no-ops when no baseline was recorded — it never wedges a run', async () => {
    const teardown = require(teardownPath);
    delete globalThis[SNAPSHOT_KEY];
    await expect(teardown()).resolves.toBeUndefined();
  });
});

// ── the results processor ─────────────────────────────────────────────────────
describe('openHandleResultsProcessor — turns --detectOpenHandles findings into exit 1', () => {
  const processor = require('../jest/openHandleResultsProcessor');

  it('fails a run in which jest detected open handles', () => {
    const out = processor({ success: true, openHandles: [new Error('Timeout')] });
    expect(out.success).toBe(false);
  });

  it('leaves a clean run untouched', () => {
    expect(processor({ success: true, openHandles: [] })).toMatchObject({ success: true });
  });

  it('leaves a run without the field untouched (the flag was not passed)', () => {
    expect(processor({ success: true })).toMatchObject({ success: true });
  });

  it('never flips a failing run back to success', () => {
    expect(processor({ success: false, openHandles: [] })).toMatchObject({ success: false });
  });

  it('returns the results object — jest uses the return value', () => {
    const results = { success: true, openHandles: [] };
    expect(processor(results)).toBe(results);
  });
});

// ── detector self-test (the adr0012.tripwire pattern) ─────────────────────────
describe('the guard can still fail — a check that cannot go red is not a check', () => {
  it('a synthetic leaked type is caught by the DEFAULT ignore list', () => {
    // Not a custom ignore list: this asserts the shipped constant does not swallow everything.
    expect(diffResources([], ['WaveFourSyntheticLeak'])).toHaveLength(1);
  });

  it('`Timeout` is not on the ignore list — that is the exact class W4-D06 is about', () => {
    expect(IGNORED_TYPES).not.toContain('Timeout');
  });

  it('every ignored type is a plain non-empty string (a typo would silently widen the hole)', () => {
    expect(IGNORED_TYPES.length).toBeGreaterThanOrEqual(0);
    for (const t of IGNORED_TYPES) {
      expect(typeof t).toBe('string');
      expect(t.trim()).toBe(t);
      expect(t).not.toBe('');
    }
  });

  it('the ignore list is frozen — a suite cannot widen it at runtime to go green', () => {
    expect(Object.isFrozen(IGNORED_TYPES)).toBe(true);
  });
});

// ── the seam the leak fix rests on ────────────────────────────────────────────
describe('_resetDebounceState — release and clear are ONE operation', () => {
  const {
    handleBiometricReading, _debounceMap, _resetDebounceState,
  } = require('../app/sockets/biometricHandler');

  const liveTimeouts = () => process.getActiveResourcesInfo().filter((t) => t === 'Timeout').length;
  const socketFor    = (id) => ({ id, emit: jest.fn(), data: { user: { _id: 'u-w4d06' } } });
  // W4-003: a fixed historical date is now genuinely stale against the anomaly filter's S6
  // gate (>90 days) and would be rejected rather than arming the debounce timer this file
  // exists to test. Recent + 6-minute spacing keeps the Kalman gain near pass-through.
  const RAW_BASE_MS = Date.now() - 3 * 3600_000;
  const RAW_STEP_MS = 6 * 60_000;
  let rawSeq = 0;
  const RAW = (heartRate) => {
    rawSeq += 1;
    return { heartRate, activityType: 0, startTimeLocal: new Date(RAW_BASE_MS + rawSeq * RAW_STEP_MS).toISOString() };
  };

  // Arms the streaming lane's real 60 s debounce: a baseline reading, then one past the gate.
  const armDebounce = (id) => {
    const socket = socketFor(id);
    handleBiometricReading(socket, 'garmin', RAW(60));
    handleBiometricReading(socket, 'garmin', RAW(78));
    return socket;
  };

  beforeEach(() => { _resetDebounceState(); });
  afterEach(()  => { _resetDebounceState(); });

  it('arming the streaming debounce really does hold the event loop open', () => {
    const before = liveTimeouts();
    const socket = armDebounce('w4d06-arm');
    expect(_debounceMap.get(socket.id).timer).not.toBeNull();
    expect(liveTimeouts()).toBeGreaterThan(before); // the leak, reproduced in one assertion
  });

  it('gives the timer back to the event loop, measured the way the guard measures', () => {
    const before = liveTimeouts();
    armDebounce('w4d06-release');
    _resetDebounceState();
    expect(liveTimeouts()).toBe(before);
  });

  it('also drops the state, so callers never need a second call', () => {
    armDebounce('w4d06-drop');
    _resetDebounceState();
    expect(_debounceMap.size).toBe(0);
  });

  it('is idempotent and safe on an empty map', () => {
    _resetDebounceState();
    expect(() => _resetDebounceState()).not.toThrow();
    expect(_debounceMap.size).toBe(0);
  });

  it('releases EVERY socket, not just the most recent one', () => {
    const before = liveTimeouts();
    armDebounce('w4d06-a');
    armDebounce('w4d06-b');
    expect(liveTimeouts()).toBe(before + 2);
    _resetDebounceState();
    expect(liveTimeouts()).toBe(before);
  });
});

// ── the footgun itself, pinned shut ───────────────────────────────────────────
const OFFENDING_CALL = /_debounceMap\s*\.\s*(?:clear|delete)\s*\(/;

describe('no suite may drop debounce state without releasing the timer first', () => {
  it('no test file drops debounce state without releasing the timer', () => {
    // Those two look like cleanup and are not: they orphan a live 60 s timer that then fires in a
    // LATER suite of the same in-band run. `_resetDebounceState()` is the one safe form. Pinned as
    // a tripwire rather than left to review, because the failure mode is invisible by construction.
    const offenders = [];
    for (const file of fs.readdirSync(__dirname)) {
      if (!file.endsWith('.test.js')) continue;
      const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
      if (OFFENDING_CALL.test(src)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('the tripwire can actually fire (detector self-test)', () => {
    // Built by concatenation on purpose: a literal here would make THIS file an offender and the
    // scan would have to skip itself, which is how a tripwire quietly stops covering everything.
    const probe = (method) => `_debounceMap.${method}(x)`;
    expect(OFFENDING_CALL.test(probe('clear'))).toBe(true);
    expect(OFFENDING_CALL.test(probe('delete'))).toBe(true);
    expect(OFFENDING_CALL.test('_resetDebounceState()')).toBe(false);
  });
});
