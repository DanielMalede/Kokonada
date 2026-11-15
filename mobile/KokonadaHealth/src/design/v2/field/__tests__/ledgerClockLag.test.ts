/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';
import { clampFrameDt } from '../../clock/frameDt.ts';
import type { MotionTier } from '../../motion/useMotionPolicy.ts';
import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { BASE, DIRECTIONS, type DirectionId } from '../../tokens/tokens.generated.ts';
import type { FieldStatics } from '../fieldFrame.ts';
import { capFrame, fieldStep, frameCapStart, renderGeometry, type FieldLayout, type FrameCap, type FrameParams } from '../fieldDriver.ts';
import { emptyLedger, type Ledger } from '../placementLedger.ts';
import { ledgerConfigFor, staticsFor } from '../statics.ts';

// RA-40 (resilience B4 re-audit, UI-230; the designer's agreement): at a capped tier the ledger clamps its dt per drawn
// frame (the time since the last drawn frame), the field clock per display frame. Without a stall the two agree at every
// drawn frame; a stall over motion.dtClamp that directly follows a skipped frame is clamped once for the ledger and
// once for the clock, so the skipped frame's dt, which the clock took on its own, is the ledger's lag. The bound is
// pinned here per stall, and that nothing reads the ledger's time against the clock's is pinned by a static scan.

const SENTENCE = 'At a capped tier, each stall over motion.dtClamp that directly follows a skipped frame may leave the placement ledger up to one display frame behind the field clock. The lag adds up over stalls but is never observable, because nothing reads ledger time against clock time: it only lengthens a crossfade in progress by that much, and a settled ledger is unaffected.';

const ID = Object.keys(DIRECTIONS)[0] as DirectionId;
const STATICS: FieldStatics = staticsFor(ID, EXTENSIONS as never);
const LAYOUT: FieldLayout = { width: 360, height: 640, centre: [180, 300], radius: 170, fontScale: 1 };
const PX_PER_DP = 2.625;
const GEOMETRY = renderGeometry(LAYOUT, PX_PER_DP, 0.5);
const params = (tier: MotionTier): FrameParams => ({ direction: ID, face: 'dark', stress: 0, confidence: 1, genesis: false, tier });
const STALL = 400;
const FRAME = 1000 / 120;

/**
 * Display frames at the given gaps (ms; the first frame has none), each through the field clock (its clamped dt, as
 * fieldClock.ts takes it) and the cap; a drawn frame steps the ledger on its own timestamp. Returns, at each drawn
 * frame, the clock's time since the first frame less the ledger's clock: the ledger's lag.
 */
function lagAtDraws(tier: MotionTier, gaps: readonly number[]): { lag: number[]; drawn: boolean[] } {
  let cap: FrameCap = frameCapStart();
  let ledger: Ledger = emptyLedger(ledgerConfigFor(ID, 'dark', STATICS, GEOMETRY));
  let now = 1000;
  let clock = 0;
  const lag: number[] = [];
  const drawn: boolean[] = [];
  for (let i = 0; i <= gaps.length; i++) {
    if (i > 0) {
      now += gaps[i - 1];
      clock += clampFrameDt(gaps[i - 1]);
    }
    const gate = capFrame(cap, now, tier, 0);
    cap = gate.cap;
    drawn.push(gate.draw);
    if (!gate.draw) continue;
    ledger = fieldStep(ledger, { seq: 0, taps: [] }, now, params(tier), GEOMETRY, STATICS, 0, 0.5).ledger;
    lag.push(clock - ledger.clock);
  }
  return { lag, drawn };
}

const steady = (n: number) => Array.from({ length: n }, () => FRAME);

describe('RA-40: the ledger behind the clock, per stall (UI-230)', () => {
  it('the stall is longer than motion.dtClamp, and two 120 Hz frames are shorter (the premise)', () => {
    expect(STALL).toBeGreaterThan(BASE.motion.dtClamp);
    expect(2 * FRAME).toBeLessThan(BASE.motion.dtClamp);
  });

  it('full: lockstep at every frame, with or without a stall', () => {
    for (const gaps of [steady(60), [...steady(9), STALL, ...steady(20)], [...steady(10), STALL, STALL, ...steady(20)]]) {
      const r = lagAtDraws('full', gaps);
      expect(r.drawn.every(Boolean)).toBe(true);
      r.lag.forEach((l) => expect(Math.abs(l)).toBeLessThan(1e-9));
    }
  });

  it('low without a stall: lockstep at every drawn frame', () => {
    const r = lagAtDraws('low', steady(120));
    expect(r.drawn.filter(Boolean)).toHaveLength(61);
    r.lag.forEach((l) => expect(Math.abs(l)).toBeLessThan(1e-9));
  });

  it('low, a stall right after a drawn frame: still lockstep', () => {
    // frames 0 … 10 at 120 Hz: 0, 2, 4, … 10 drawn; the stall follows the drawn frame 10
    const r = lagAtDraws('low', [...steady(10), STALL, ...steady(20)]);
    expect(r.drawn[10]).toBe(true);
    r.lag.forEach((l) => expect(Math.abs(l)).toBeLessThan(1e-9));
  });

  it('low, a stall right after a skipped frame: the ledger falls behind by at least 0 and at most one display frame, and stays there', () => {
    // frame 9 is skipped; the stall follows it
    const r = lagAtDraws('low', [...steady(9), STALL, ...steady(20)]);
    expect([r.drawn[8], r.drawn[9], r.drawn[10]]).toEqual([true, false, true]);
    const before = r.lag.slice(0, 5);
    before.forEach((l) => expect(Math.abs(l)).toBeLessThan(1e-9));
    const after = r.lag.slice(5);
    for (const l of after) {
      expect(l).toBeGreaterThanOrEqual(-1e-9);
      expect(l).toBeLessThanOrEqual(FRAME + 1e-9);
    }
    // here the bound is reached: the skipped frame's dt is the lag, and no later frame closes it
    expect(after[0]).toBeCloseTo(FRAME, 9);
    after.forEach((l) => expect(l).toBeCloseTo(after[0], 9));
  });

  it('the lag adds up over stalls, by at most one display frame each, and never runs the ledger ahead', () => {
    // three stalls, each right after a skipped frame, then one right after a drawn frame
    const gaps = [...steady(9), STALL, ...steady(11), STALL, ...steady(11), STALL, ...steady(10), STALL, ...steady(8)];
    const r = lagAtDraws('low', gaps);
    const stalls = gaps.reduce<number[]>((at, g, i) => (g === STALL ? [...at, i] : at), []);
    expect(stalls.map((i) => r.drawn[i])).toEqual([false, false, false, true]);
    const last = r.lag[r.lag.length - 1];
    expect(last).toBeGreaterThanOrEqual(-1e-9);
    expect(last).toBeLessThanOrEqual(3 * FRAME + 1e-9);
    // and here each of the three reaches the bound: the lag is the three skipped frames' dt
    expect(last).toBeCloseTo(3 * FRAME, 9);
    for (let k = 1; k < r.lag.length; k++) {
      const step = r.lag[k] - r.lag[k - 1];
      expect(step).toBeGreaterThanOrEqual(-1e-9);
      expect(step).toBeLessThanOrEqual(FRAME + 1e-9);
    }
  });
});

// The scan: no source file under src/design/v2 outside the tests computes from both the ledger's clock and the field
// clock's time in one function (or at module scope), read with the TypeScript compiler. What it matches:
//   · the ledger's clock: a property access `.clock` used as a value, not navigated on (`ledger.clock`, `l.clock`,
//     `step.ledger.clock`); `BASE.field.clock.T` and `props.clock.t` navigate on, so they are not it;
//   · the field clock's time: `<x>.t.value` or `t.value` (the clock's own SharedValue), `<…>clock.t`, or a read of `tMs` (an identifier or a `.tMs` property), the
//     name every field-time value travels under; a declaration or an object key named tMs is not a read.
// A read counts for every function it sits in, nested ones included, and for module scope when it sits in none. It is
// syntactic: a value carried from one function into another under another name is not followed.
const V2 = path.resolve(__dirname, '../..');

function sourcesUnderV2(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== '__tests__' && e.name !== 'node_modules') walk(p);
      } else if (/\.(ts|tsx)$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
    }
  };
  walk(V2);
  return out.sort();
}

interface Unit { readonly name: string; ledger: number; field: number }

function ledgerAndFieldTime(source: string, fileName: string): { offenders: string[]; ledgerReads: number; fieldReads: number } {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const units = new Map<ts.Node, Unit>();
  const line = (n: ts.Node) => file.getLineAndCharacterOfPosition(n.getStart(file)).line + 1;
  const unitOf = (n: ts.Node): Unit => {
    let u = units.get(n);
    if (u === undefined) {
      const named = (n as { name?: ts.Node }).name;
      const label = n === file ? 'module scope' : `${named !== undefined && ts.isIdentifier(named) ? named.text : 'a function'} at line ${line(n)}`;
      u = { name: label, ledger: 0, field: 0 };
      units.set(n, u);
    }
    return u;
  };
  const navigatedOn = (n: ts.Node) => {
    const up = n.parent;
    return (ts.isPropertyAccessExpression(up) || ts.isElementAccessExpression(up)) && up.expression === n;
  };
  const endsInClock = (e: ts.Expression) => (ts.isIdentifier(e) && e.text === 'clock') || (ts.isPropertyAccessExpression(e) && e.name.text === 'clock');
  const kindOf = (n: ts.Node): 'ledger' | 'field' | null => {
    if (ts.isPropertyAccessExpression(n)) {
      if (n.name.text === 'clock' && !navigatedOn(n)) return 'ledger';
      if (n.name.text === 'value' && ((ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 't') || (ts.isIdentifier(n.expression) && n.expression.text === 't'))) return 'field';
      if (n.name.text === 't' && endsInClock(n.expression) && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name.text === 'value')) return 'field';
      if (n.name.text === 'tMs') return 'field';
      return null;
    }
    if (ts.isIdentifier(n) && n.text === 'tMs') {
      const up = n.parent;
      if (ts.isPropertyAccessExpression(up) && up.name === n) return null; // counted at the access
      if ((ts.isParameter(up) || ts.isVariableDeclaration(up) || ts.isPropertyAssignment(up) || ts.isPropertySignature(up) || ts.isBindingElement(up)) && up.name === n) return null;
      return 'field';
    }
    return null;
  };
  let ledgerReads = 0;
  let fieldReads = 0;
  const visit = (n: ts.Node, scopes: ts.Node[]) => {
    const kind = kindOf(n);
    if (kind !== null) {
      if (kind === 'ledger') ledgerReads += 1;
      else fieldReads += 1;
      for (const s of scopes.length > 0 ? scopes : [file]) unitOf(s)[kind] += 1;
    }
    const inner = ts.isFunctionLike(n) ? [...scopes, n] : scopes;
    ts.forEachChild(n, (c) => visit(c, inner));
  };
  visit(file, []);
  const offenders = [...units.values()].filter((u) => u.ledger > 0 && u.field > 0).map((u) => `${path.basename(fileName)}: ${u.name}`);
  return { offenders, ledgerReads, fieldReads };
}

describe('RA-40: nothing under src/design/v2 reads the ledger’s time against the field clock’s (UI-230)', () => {
  const files = sourcesUnderV2();

  it('no function and no module scope reads both, and the scan sees both kinds of read in the tree', () => {
    let ledger = 0;
    let field = 0;
    const offenders: string[] = [];
    const seenLedger: string[] = [];
    const seenField: string[] = [];
    for (const f of files) {
      const r = ledgerAndFieldTime(fs.readFileSync(f, 'utf8'), f);
      ledger += r.ledgerReads;
      field += r.fieldReads;
      if (r.ledgerReads > 0) seenLedger.push(path.relative(V2, f).replace(/\\/g, '/'));
      if (r.fieldReads > 0) seenField.push(path.relative(V2, f).replace(/\\/g, '/'));
      offenders.push(...r.offenders);
    }
    expect(offenders).toEqual([]);
    // not vacuous: the ledger's own clock and FieldView's and the clock's field time are all read where the scan looks
    expect(files.map((f) => path.relative(V2, f).replace(/\\/g, '/'))).toEqual(expect.arrayContaining(['field/FieldView.tsx', 'field/placementLedger.ts', 'clock/fieldClock.ts', 'field/fieldDriver.ts']));
    expect(seenLedger).toEqual(expect.arrayContaining(['field/placementLedger.ts']));
    expect(seenField).toEqual(expect.arrayContaining(['field/FieldView.tsx', 'clock/fieldClock.ts', 'field/fieldDriver.ts', 'field/fieldFrame.ts']));
    expect(ledger).toBeGreaterThan(0);
    expect(field).toBeGreaterThan(0);
  });

  it('planted in FieldView’s frame worklet: the lag computed from the clock and the stepped ledger is flagged', () => {
    const real = fs.readFileSync(path.resolve(V2, 'field/FieldView.tsx'), 'utf8');
    const from = '    ledger.value = step.ledger;\n';
    expect(real.split(from)).toHaveLength(2);
    const planted = real.replace(from, () => `${from}    const lag = clock.t.value - step.ledger.clock;\n`);
    expect(ledgerAndFieldTime(real, 'FieldView.tsx').offenders).toEqual([]);
    expect(ledgerAndFieldTime(planted, 'FieldView.tsx').offenders.length).toBeGreaterThan(0);
  });

  it('planted: each form of a field-time read beside a ledger clock read is flagged; apart, or navigated on, they are not', () => {
    const flagged = [
      'function a(l, clock) { return clock.t.value - l.clock; }',
      'const b = (step, tMs) => step.ledger.clock > tMs;',
      'function c(l, state) { return state.tMs - l.clock; }',
      'function d(l, props) { const f = () => props.clock.t; return [f(), l.clock]; }',
      'const lag = field.t.value - ledger.clock;',
      'function m(t, l) { t.value = l.clock; }',
    ];
    for (const src of flagged) expect([src, ledgerAndFieldTime(src, 'planted.ts').offenders.length]).toEqual([src, 1]);
    const clean = [
      'const T = BASE.field.clock.T; function e(state) { return state.tMs % T; }',
      'function f(l) { return l.clock; }\nfunction g(c) { return c.t.value; }',
      'function h(props, l) { const clock = props.clock; return l.seq; }',
      'const o = { tMs: 7000, clock: 0 }; function k(tMs) { return 1; }',
    ];
    for (const src of clean) expect([src, ledgerAndFieldTime(src, 'planted.ts').offenders]).toEqual([src, []]);
  });
});

describe('RA-40: the bound is written in frameDt.ts and in FieldView’s contract, word for word', () => {
  const prose = (file: string) => fs.readFileSync(path.resolve(V2, file), 'utf8').split('\n').map((l) => l.replace(/^\s*\/\/\s?/, '').replace(/^\s*·\s*/, '').trim()).join(' ').replace(/\s+/g, ' ');
  it.each(['clock/frameDt.ts', 'field/FieldView.tsx'])('%s', (file) => {
    expect(prose(file)).toContain(SENTENCE);
  });
});
