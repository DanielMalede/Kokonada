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
 *
 * W4-D24 — why the third parameter exists.
 *
 * The closing snapshot is taken through an injectable `sample()` so this module can be executed for
 * real by a test WITHOUT that test's verdict depending on the live process. It has to: the pin that
 * used to assert "silent when nothing leaked" sampled ambient process state either side of the
 * drain, which makes it a claim about what an unrelated suite happened to arm during those 250 ms,
 * not about the guard. It failed six consecutive CI runs of PR #180 and then passed on a docs-only
 * commit — identical backend bytes, opposite verdict.
 *
 * The seam is safe because jest 29.7 calls `globalModule(globalConfig, projectConfig)`
 * (`@jest/core/build/runGlobalHook.js`) with exactly two arguments, so the third can only ever be
 * filled by a caller that means to. That arity is pinned by a tripwire in
 * `tests/wave4.openHandleGuard.test.js`, and the production default — the real
 * `process.getActiveResourcesInfo()` — stays covered by the sibling test that arms a genuine timer
 * and injects nothing at all.
 *
 * A malformed injection falls back to the real sampler rather than throwing: this module's own rule
 * is that the guard must never break the run it protects (see `openHandleGuard`'s fail-soft
 * `countByType`/`diffResources`). Note what is deliberately NOT done here — `Timeout` is not added
 * to `IGNORED_TYPES`. Excusing the type would switch off the exact class W4-D06 exists to catch;
 * the defect was the test's oracle, never the guard's sensitivity.
 */
module.exports = async function wave4GlobalTeardown(_globalConfig, _projectConfig, deps) {
  const before = globalThis[SNAPSHOT_KEY];
  if (!Array.isArray(before)) return;

  const sample = typeof deps?.sample === 'function'
    ? deps.sample
    : () => process.getActiveResourcesInfo();

  // Let jest's own reporter debounce expire first — see DRAIN_MS for why this is not a fudge.
  await new Promise((resolve) => { setTimeout(resolve, DRAIN_MS); });
  assertNoLeaks(before, sample());
};
