'use strict';

// The wall clock, pinned to a fixture's own timeline.
//
// The sim fixtures are generated at a FIXED date, which is what keeps their counts reproducible,
// and the code they drive reads the wall clock. The A0 anomaly filter's S6 gate
// (agents/runtime/ingestion/anomalyFilter.js) refuses a reading older than MAX_AGE_MS (90 days)
// or newer than FUTURE_TOLERANCE_MS (5 min), measured against the handler's `now`, and that
// `now` falls back to Date.now(). On the machine's clock a fixed-date fixture therefore expires:
// T0 = 2026-07-06 reached the 90-day floor at 2026-10-04T00:00Z. From then on that day's readings
// went stale one five-minute sample at a time (a fake clock started at the machine's time lost all
// of them at once), and main went red. The gate is right; a replay has to run on its own clock.
//
// Only Date is faked. Timers, nextTick, setImmediate, queueMicrotask, hrtime and performance
// stay real, so Mongo round-trips and the handler's own timers run exactly as they did. The
// clock stays frozen at `atMs` until jest.useRealTimers().
//
// `now` is always explicit. Left out, jest starts the fake clock at the REAL time of its own
// realm (`now: config.now ?? Date.now()` in @jest/fake-timers), which is the very defect this
// helper exists to remove.

const EVERYTHING_BUT_DATE = Object.freeze([
  'hrtime', 'nextTick', 'performance', 'queueMicrotask',
  'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback',
  'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout',
]);

function pinWallClock(atMs) {
  if (!Number.isFinite(atMs)) throw new TypeError('pinWallClock: atMs (epoch ms) is required');
  jest.useFakeTimers({ now: atMs, doNotFake: [...EVERYTHING_BUT_DATE] });
}

module.exports = { pinWallClock, EVERYTHING_BUT_DATE };
