'use strict';

/**
 * W4-D06 — makes `npm run test:handles` exit non-zero when jest detects open handles.
 *
 * Jest reports open handles as console output and then exits 0, which is the whole reason a leak
 * can hide behind `--forceExit`. `testResultsProcessor` is the only seam that runs AFTER
 * `collectHandles()` populates `results.openHandles` and BEFORE `onComplete` hands the results to
 * the exit-code logic (`runJest.js` `processResults`), so a reporter cannot do this job — by the
 * time `onRunComplete` fires, `openHandles` is not yet set and `success` is already computed.
 *
 * Inert on a normal `npm test`: without `--detectOpenHandles`, jest sets `openHandles` to `[]`.
 */
module.exports = function wave4OpenHandleResultsProcessor(results) {
  if (results && Array.isArray(results.openHandles) && results.openHandles.length > 0) {
    results.success = false;
  }
  return results;
};
