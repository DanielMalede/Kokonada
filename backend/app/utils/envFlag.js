'use strict';

// ONE spelling convention for every env switch in the codebase.
//
// The house has two kinds of env switch, and they mean OPPOSITE things about a feature:
//
//   · S11 KILL-SWITCHES (`WAVE4_*_DISABLED`) turn NEW behaviour OFF. Engaged ⇒ the old,
//     known-good path is restored with no revert and no deploy.
//   · ENABLE flags (`SCORING_V2_SHADOW`, `EMBEDDING_V2_WRITE`, `EMBEDDING_V2_READ`) turn NEW
//     behaviour ON. Engaged ⇒ the new path runs.
//
// They differ in MEANING, not in SPELLING. Both are parsed by `truthy` below: a switch is engaged
// when its value is a non-empty string that is not an OFF spelling. `enabled` and `disabled` are
// the two names for that one parse, so a reader can see at the call site which direction the
// boolean points without having to remember a second set of rules.
//
// W4-D58 — why one parser, and why THIS one. This file used to rule that `Boolean(process.env.X)`
// was correct for kill-switches, on the grounds that any spelling at all — including the string
// `"false"` — errs toward known-good behaviour. Measured against the real source, that convention
// had produced three incompatible readings of the same flag name: eleven sites on `Boolean()`
// (where `X=false` and `X=0` ENGAGE the switch), four on a forgiving trim/lower-case parse (where
// they do not), and two on `X === 'true'` (where `X=1` did nothing at all — silently, in the
// serving path). An operator templating `WAVE4_X_DISABLED=false` across a Railway/compose env
// therefore reverted eleven engines they meant to leave running, and an operator reaching for the
// natural `=1` during an incident failed to revert two.
//
// Deferring to what the operator actually WROTE wins over erring toward known-good, for two
// reasons. First, "errs toward known-good" was never really the behaviour: `Boolean()` already
// treated the empty string as OFF, so the line existed — it was just drawn where nobody would
// guess it. Second, the danger a kill-switch cannot afford is ambiguity about which way it points;
// a lever that does the opposite of what its value says is worse than either default, because the
// person pulling it at 2am has no way to tell which of the two rules the module they are reverting
// happens to follow. The `=1` case that the old comments defended against is preserved here — `1`,
// `true`, `yes`, `on` and anything else non-empty all engage.
//
// This lives as a shared util rather than a local helper because the convention only protects
// anything if every flag agrees on what "off" spells; two copies of the regex are two chances to
// drift, and that drift is exactly what W4-D58 found. `tests/wave4.killSwitchSpelling.test.js`
// pins the table and holds a tripwire asserting every `WAVE4_*_DISABLED` read in `app/` routes
// through `disabled()`, so a fourth reading cannot be reintroduced by a later module.

/** Spellings that mean OFF. Anything else non-empty means ON. */
const FALSEY = /^(0|false|no|off)$/i;

/**
 * The single truth parse shared by both flag directions.
 * @param {*} raw the raw env value (`process.env.X`)
 * @returns {boolean} true only for a non-empty string that is not an OFF spelling.
 *   A non-string is false: `process.env` only ever yields strings or undefined, so anything
 *   else is a programming error, and "off" is the safe reading of a programming error.
 */
function truthy(raw) {
  if (typeof raw !== 'string') return false;
  const v = raw.trim();
  return v !== '' && !FALSEY.test(v);
}

/** An ENABLE flag: true ⇒ the NEW behaviour is switched on. */
function enabled(raw) {
  return truthy(raw);
}

/** An S11 kill-switch: true ⇒ the switch is engaged and the OLD behaviour is restored. */
function disabled(raw) {
  return truthy(raw);
}

module.exports = { truthy, enabled, disabled, FALSEY };
