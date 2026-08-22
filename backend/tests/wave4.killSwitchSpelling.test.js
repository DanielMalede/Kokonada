'use strict';

// W4-D58 — ONE spelling for every S11 kill-switch.
//
// §0.4 S11 exists so a serving-path change can be reverted at 2am without a deploy. A lever whose
// meaning depends on which module reads it is the one thing a kill-switch cannot afford to be, and
// before this suite the repo had THREE incompatible readings of the same WAVE4_*_DISABLED name:
//
//   A · Boolean(env.X)        — 11 sites. X=false and X=0 ENGAGE the switch.
//   B · forgiving trim/lower  —  4 sites. X=false and X=0 do NOT engage it.
//   C · env.X === 'true'      —  2 sites. ONLY the literal true engages it; X=1 does nothing.
//
// So an operator writing the natural WAVE4_X_DISABLED=false across a Railway/compose env reverted
// eleven engines they meant to leave running, and an operator writing =1 in an incident failed to
// revert the two that demanded =true — the exact failure the B-sites' own comments warned about,
// which had been living 1000 lines below them in the same file.
//
// THE RULING: one truth parser, two meanings. enabled() and disabled() parse the string
// IDENTICALLY (non-empty and not an OFF spelling); they differ only in what the resulting boolean
// means about the feature. Deferring to what the operator actually wrote beats erring toward
// known-good, because "errs toward known-good" was never the real behaviour anyway — reading A
// already treated the empty string as OFF; it just drew the line in a place nobody would guess.

const fs = require('fs');
const path = require('path');
const { enabled, disabled, truthy } = require('../app/utils/envFlag');

// The table EVERY kill-switch must agree on. `false` is the load-bearing row (§0.4 S11).
const SPELLINGS = [
  [undefined, false], [null, false], ['', false], ['   ', false],
  ['false', false], ['FALSE', false], [' false ', false],
  ['0', false], ['no', false], ['off', false], ['OFF', false],
  ['1', true], [' 1 ', true], ['true', true], ['TRUE', true],
  ['yes', true], ['on', true], ['disable', true],
];

describe('W4-D58 · envFlag.disabled — the single kill-switch parser', () => {
  it.each(SPELLINGS)('disabled(%p) === %p', (raw, expectedEngaged) => {
    expect(disabled(raw)).toBe(expectedEngaged);
  });

  it('parses IDENTICALLY to enabled — the two helpers differ in meaning, not in spelling', () => {
    for (const [raw] of SPELLINGS) expect(disabled(raw)).toBe(enabled(raw));
  });

  it('exposes the shared parser so a third helper cannot invent a fourth reading', () => {
    expect(typeof truthy).toBe('function');
    for (const [raw, engaged] of SPELLINGS) expect(truthy(raw)).toBe(engaged);
  });

  it('the load-bearing rows: =false and =0 do NOT engage a kill-switch; =1 DOES', () => {
    expect(disabled('false')).toBe(false); // reading A regression
    expect(disabled('0')).toBe(false);     // reading A regression
    expect(disabled('1')).toBe(true);      // reading C regression
  });
});

// ── The tripwire: every disable flag in app/ goes through that ONE parser ──────────────────────
// Without this, the table above only pins a helper nobody is obliged to call. With it, the table
// has teeth by construction: there is exactly one parser and every site reaches it.

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const APP_DIR = path.join(__dirname, '..', 'app');
const SOURCES = walk(APP_DIR).map((f) => [
  path.relative(APP_DIR, f).replace(/\\/g, '/'),
  fs.readFileSync(f, 'utf8'),
]);

// Identifiers bound to a WAVE4_*_DISABLED name anywhere in app/ (const FEEDBACK_FLAG = '...'),
// plus destructuring renames of those on require lines ({ DISABLE_ENV_VAR: TRAJECTORY_DISABLED }).
function disableIdents() {
  const idents = new Set();
  for (const [, src] of SOURCES) {
    for (const m of src.matchAll(/(\w+)\s*[:=]\s*'(WAVE4_\w*_DISABLED)'/g)) idents.add(m[1]);
  }
  for (const [, src] of SOURCES) {
    for (const line of src.split('\n')) {
      if (!line.includes('require(')) continue;
      for (const r of line.matchAll(/(\w+)\s*:\s*(\w+)/g)) if (idents.has(r[1])) idents.add(r[2]);
    }
  }
  return idents;
}

const ENV_READ = /process\.env\s*(?:\.\s*(\w+)|\[\s*([\w.]+)\s*\])/g;

// Every process.env read in app/ whose key is (or resolves to) a WAVE4_*_DISABLED name.
function disableFlagReads() {
  const idents = disableIdents();
  const reads = [];
  for (const [file, src] of SOURCES) {
    for (const m of src.matchAll(ENV_READ)) {
      const direct = m[1];
      const viaIdent = m[2] && m[2].split('.').pop();
      const isFlag = (direct && /^WAVE4_\w*_DISABLED$/.test(direct)) || (viaIdent && idents.has(viaIdent));
      if (!isFlag) continue;
      const line = src.slice(0, m.index).split('\n').length;
      const before = src.slice(Math.max(0, m.index - 40), m.index);
      reads.push({ file, line, key: direct || m[2], wrapped: /disabled\(\s*$/.test(before) });
    }
  }
  return reads;
}

describe('W4-D58 · tripwire — no module may read a kill-switch its own way', () => {
  it('finds the kill-switch read sites at all (the scanner is not vacuously green)', () => {
    const reads = disableFlagReads();
    // 17 sites when this landed; a floor keeps the guard honest as sites are added, and catches a
    // scanner that has silently stopped resolving the bracket/import forms.
    expect(reads.length).toBeGreaterThanOrEqual(15);
    expect(new Set(reads.map((r) => r.file)).size).toBeGreaterThanOrEqual(10);
  });

  it('every WAVE4_*_DISABLED read routes through envFlag.disabled()', () => {
    const rogue = disableFlagReads().filter((r) => !r.wrapped);
    expect(rogue.map((r) => `${r.file}:${r.line} (${r.key})`)).toEqual([]);
  });

  it('no module re-implements the parse — the three losing readings are gone from app/', () => {
    const idents = disableIdents();
    const offenders = [];
    const LOSING = /(Boolean\(\s*)?process\.env\s*(?:\.\s*(\w+)|\[\s*([\w.]+)\s*\])\s*(===\s*'true'|!==\s*'true')?/g;
    for (const [file, src] of SOURCES) {
      if (file === 'utils/envFlag.js') continue;
      for (const m of src.matchAll(LOSING)) {
        const key = m[2] || (m[3] && m[3].split('.').pop());
        const isFlag = /^WAVE4_\w*_DISABLED$/.test(m[2] || '') || (key && idents.has(key));
        if (!isFlag) continue;
        if (m[1] || m[4]) offenders.push(`${file}:${src.slice(0, m.index).split('\n').length} ${m[0].trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ── The wiring is real, not just textual: two exported predicates honour the table ─────────────

describe('W4-D58 · real predicates honour the table', () => {
  const { feedbackDisabled, FEEDBACK_FLAG } = require('../app/services/learning/rewardDispatch');
  const { decayDisabled, _resetDecayConfig } = require('../app/services/selection/affinity');

  const withEnv = (name, raw, fn) => {
    const prev = process.env[name];
    if (raw === undefined || raw === null) delete process.env[name];
    else process.env[name] = raw;
    try { return fn(); } finally {
      if (prev === undefined) delete process.env[name];
      else process.env[name] = prev;
    }
  };

  it.each(SPELLINGS)('WAVE4_FEEDBACK_DISABLED=%p → engaged %p', (raw, engaged) => {
    expect(withEnv(FEEDBACK_FLAG, raw, () => feedbackDisabled())).toBe(engaged);
  });

  it.each(SPELLINGS)('WAVE4_AFFINITY_DECAY_DISABLED=%p → engaged %p (memoized read)', (raw, engaged) => {
    expect(withEnv('WAVE4_AFFINITY_DECAY_DISABLED', raw, () => {
      _resetDecayConfig();
      return decayDisabled();
    })).toBe(engaged);
    _resetDecayConfig();
  });
});
