'use strict';

/**
 * W4-D06 — the standing open-handle guard (pure engine).
 *
 * The problem it exists for: `npm test` is `jest --runInBand --forceExit`, and `--forceExit` takes
 * the process out the instant the last suite finishes. A test that leaves a live handle behind —
 * a 60 s debounce timer, an ioredis dial, a BullMQ repeatable, an un-closed server — therefore
 * exits 0 and looks identical to a clean run. That is not a hypothetical: two leaked `setTimeout`s
 * from `app/sockets/biometricHandler.js` survived an entire wave behind that flag, and their
 * callbacks fired inside *later* suites of the same in-band run, which is a cross-suite flake
 * vector, not a hygiene nit.
 *
 * The mechanism: `process.getActiveResourcesInfo()` lists the resources currently keeping the event
 * loop alive. Snapshot it before the first suite (`globalSetup`) and after the last one
 * (`globalTeardown`); anything that GREW is something a suite armed and never cleared.
 *
 * Why this and not `--detectOpenHandles` on every run: jest's own detector FILTERS handles to those
 * whose stack points at user code. Measured here during this investigation, it reported 2 handles
 * where the delta reported 3 — it had filtered out one raised inside `node_modules`. That filter is
 * precisely wrong for what comes next in this wave: a leaked ioredis dial, BullMQ worker or
 * repeatable job is constructed inside a dependency, so the detector is at its weakest exactly
 * where the risk is highest. The delta cannot be filtered, and it costs one array per run instead
 * of async_hooks instrumentation on every async resource. The deep scan keeps its place as the
 * opt-in localizer (`npm run test:handles`) because it — and only it — names the file and line.
 *
 * Deliberately unref'd timers do not appear in `getActiveResourcesInfo()` — that is what `unref()`
 * means — so infrastructure that correctly opts out of holding the loop open is never flagged.
 *
 * Pure by §0.4 S9: no clock, no randomness, no `process` access, no fs. The wiring modules do the
 * sampling and pass snapshots in.
 */

/**
 * Resource types whose growth across a run is NOT a test leak.
 *
 * Empty by measurement, not by omission: the full 168-suite run was sampled with this list empty
 * and, once the debounce timers were released, reported NO growth of any type. Nothing in this
 * repo's suite legitimately outlives the run, so nothing is excused. Keep it that way — every entry
 * added here is a class of leak the guard stops seeing, and it must carry the measurement that
 * justified it. If a run starts reporting a type you believe is benign, prove it with
 * `npm run test:handles` before excusing it; the last time this looked like runner noise it was
 * two real 60 s timers.
 */
const IGNORED_TYPES = Object.freeze([]);

/** The slot `globalSetup` leaves the baseline in for `globalTeardown` to find. */
const SNAPSHOT_KEY = '__WAVE4_OPEN_HANDLE_BASELINE__';

/**
 * How long to let the event loop settle before sampling the closing snapshot.
 *
 * Derived, not guessed: jest's OWN progress reporter arms a 100 ms debounce on every
 * `testFinished` (`@jest/reporters/build/Status.js` `_debouncedEmit`, the literal `100` at its
 * `setTimeout`), and the last one is still pending when `globalTeardown` runs. Measured with an
 * async_hooks probe on this repo: that timer is the entire residue of a clean run. Sampling
 * without a settle window would therefore report a permanent phantom `Timeout` on every run, and
 * the only way to make the guard green again would be to ignore `Timeout` wholesale — which is
 * precisely the class W4-D06 exists to catch.
 *
 * 250 ms is 2.5× the known debounce, once per run. The trade it makes is explicit: a leaked timer
 * whose delay is under 250 ms will have fired by the time we look. That is the right side of the
 * trade — a sub-250 ms timer cannot meaningfully outlive its suite, whereas the 60 s debounce
 * timers this guard was written for, intervals, sockets, Redis dials and BullMQ workers all
 * survive it trivially.
 */
const DRAIN_MS = 250;

/**
 * Tally a `getActiveResourcesInfo()` snapshot into `{type: count}`.
 * Fails soft on anything that is not an array of strings — a guard that throws on its own input
 * would wedge the very run it is supposed to protect.
 */
function countByType(resources) {
  const tally = Object.create(null);
  if (!Array.isArray(resources)) return { ...tally };
  for (const entry of resources) {
    if (typeof entry !== 'string') continue;
    tally[entry] = (tally[entry] || 0) + 1;
  }
  return { ...tally };
}

/**
 * Resource types present in `after` in greater number than in `before`.
 *
 * Growth only. A resource that CLOSED during the run is not a finding, and neither is one that was
 * already open before the first suite — the guard measures what the run added and failed to give
 * back, which is exactly the leak definition.
 *
 * Ordering is deterministic (worst leak first, then alphabetical) so the failure message is stable
 * across runs and diffable.
 */
function diffResources(before, after, { ignore = IGNORED_TYPES } = {}) {
  if (!Array.isArray(before) || !Array.isArray(after)) return [];
  const ignored     = new Set(Array.isArray(ignore) ? ignore : []);
  const beforeCount = countByType(before);
  const afterCount  = countByType(after);

  const violations = [];
  for (const type of Object.keys(afterCount)) {
    if (ignored.has(type)) continue;
    const b = beforeCount[type] || 0;
    const a = afterCount[type];
    if (a > b) violations.push({ type, before: b, after: a, leaked: a - b });
  }
  violations.sort((x, y) => (y.leaked - x.leaked) || x.type.localeCompare(y.type));
  return violations;
}

/**
 * The operator-facing message. It has to name the resource types AND the escalation command,
 * because the delta says *that* something leaked and only `--detectOpenHandles` says *where*.
 */
function formatViolations(violations) {
  if (!Array.isArray(violations) || violations.length === 0) return '';
  const lines = violations.map(
    (v) => `  - ${v.type}: ${v.leaked} still active at the end of the run (${v.before} before, ${v.after} after)`,
  );
  return [
    'Open handles survived the test run — a suite armed a resource and never released it.',
    ...lines,
    '',
    'Run `npm run test:handles` for the per-handle stack traces that name the file and line,',
    'then clear the resource in that suite\'s teardown (or drive it with fake timers).',
  ].join('\n');
}

/** Throw iff a watched resource type grew across the run. The throw is what becomes exit 1. */
function assertNoLeaks(before, after, options) {
  const violations = diffResources(before, after, options);
  if (violations.length === 0) return;
  throw new Error(formatViolations(violations));
}

module.exports = {
  IGNORED_TYPES,
  SNAPSHOT_KEY,
  DRAIN_MS,
  countByType,
  diffResources,
  formatViolations,
  assertNoLeaks,
};
