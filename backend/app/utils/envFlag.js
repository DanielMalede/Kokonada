'use strict';

// ONE spelling convention for every ENABLE flag in the codebase.
//
// The house has two kinds of env switch and they must be read in OPPOSITE directions:
//
//   · S11 KILL-SWITCHES (`WAVE4_*_DISABLED`) are DISABLE flags. `Boolean(process.env.X)` is
//     correct there: any spelling at all — including the string `"false"` — errs toward the old,
//     known-good behaviour, which is exactly what an emergency lever should do.
//   · ENABLE flags (`SCORING_V2_SHADOW`, `EMBEDDING_V2_WRITE`, `EMBEDDING_V2_READ`) turn NEW
//     behaviour on. `Boolean()` there means `X=0` and `X=false` switch the new path ON — the
//     W4-D05 defect in reverse, and for `EMBEDDING_V2_READ` it would silently repoint discovery
//     at an index that may not even exist.
//
// This module is the second kind. It exists as a shared util rather than a local helper because
// the convention only protects anything if every enable flag agrees on what "off" spells; two
// copies of the regex are two chances to drift.

/** Spellings that mean OFF. Anything else non-empty means ON. */
const FALSEY = /^(0|false|no|off)$/i;

/**
 * @param {*} raw the raw env value (`process.env.X`)
 * @returns {boolean} true only for a non-empty string that is not an OFF spelling.
 *   A non-string is false: `process.env` only ever yields strings or undefined, so anything
 *   else is a programming error, and "off" is the safe reading of a programming error.
 */
function enabled(raw) {
  if (typeof raw !== 'string') return false;
  const v = raw.trim();
  return v !== '' && !FALSEY.test(v);
}

module.exports = { enabled, FALSEY };
