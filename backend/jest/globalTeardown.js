'use strict';

const { SNAPSHOT_KEY, DRAIN_MS, assertNoLeaks } = require('./openHandleGuard');

/**
 * W4-D06 — the standing guard's one enforcement point.
 *
 * `globalTeardown` is the last thing jest runs that can still influence the exit code: it fires
 * after every suite and after the reporters, but BEFORE `--forceExit` takes the process out
 * (`runJest.js` → `runGlobalHook`, then `readResultsAndExit`). Throwing here surfaces as
 * "Got error running globalTeardown" and exits 1 — verified against jest 29 in this repo.
 *
 * A missing baseline is a silent no-op on purpose. If `globalSetup` never ran, the guard has no
 * measurement to make, and inventing a failure out of that would break runs for a reason unrelated
 * to any leak.
 */
module.exports = async function wave4GlobalTeardown() {
  const before = globalThis[SNAPSHOT_KEY];
  if (!Array.isArray(before)) return;
  // Let jest's own reporter debounce expire first — see DRAIN_MS for why this is not a fudge.
  await new Promise((resolve) => { setTimeout(resolve, DRAIN_MS); });
  assertNoLeaks(before, process.getActiveResourcesInfo());
};
