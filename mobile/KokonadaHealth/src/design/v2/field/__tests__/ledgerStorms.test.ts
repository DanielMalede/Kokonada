/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { BASE, DIRECTIONS, type DirectionId, type Face } from '../../tokens/tokens.generated.ts';
import { buildFieldFrame, type FieldState } from '../fieldFrame.ts';
import { NODE, NODE_SLOTS } from '../fieldLaw.ts';
import { ADMISSION, emptyLedger, fades, reconcile, type Admission, type LedgerConfig, type LedgerFades, type Tap } from '../placementLedger.ts';
import { staticsFor } from '../statics.ts';
import { packFrame } from '../uniforms.ts';

// QA-068, the event path: E3 (resilience admission §3, the replacement text, adopted by the designer):
//
// "Ledger storms, run in every direction under {settle, reduced}. Storms: {toggle, cycle4, reemit,
//  neutral3 (Linen: three neutral placements, then three new neutral taps inside one settle window)},
//  with taps every {17, 50, 100, 143, 167, 250} ms, for 3 s and for 10 s, sampled every 1 ms.
//  - Demand: the ledger's node demand is at most NODE_SLOTS (6). Demand counts live, entering and
//    leaving placements, plus rest lobes whose fade is above 0 or rising. It is counted from the
//    ledger's output, never from the built frame.
//  - Overflow: buildFieldFrame throws RangeError when given more than NODE_SLOTS nodes; it never
//    slices. Planted case: a ledger that admits three swaps must make neutral3 throw.
//  - Fades: no fade, tracked by id, moves more than its curve's steepest slope per ms. An id enters at
//    0 and leaves only at 0. The built frame's rest-lobe fades obey the same bound.
//  - Starts: consecutive starts are at least BASE.motion.settle.duration apart, and every start admits
//    at least one pending change. reemit gives exactly one start and bit-identical fades.
//  - Convergence: the ids with fade above 0 equal the store's live ids by the last tap + 3·600 ms +
//    ramp, or + 2·600 ms + ramp wherever no rest lobe is lit. The 10 s storm converges within 600 ms of
//    the 3 s storm. Planted case: a raw first-in-first-out ledger must fail this.
//  - E5, the halo is bound: two frames with the same ledger output, one built while the store holds an
//    extra unadmitted tap, are byte-identical over the whole field (law and real Skia). A static guard
//    checks that no plate or bead file reads field.halo or draws a halo."
//
// neutral3 runs in every direction; it is the binding case in Linen, where neutral placements have no
// lobe and the rest lobes stay lit. E5's real-Skia half is in fieldShader.skia.test.ts.

type Mode = 'settle' | 'reduced';
type Storm = 'toggle' | 'cycle4' | 'reemit' | 'neutral3';
const IDS = Object.keys(DIRECTIONS) as DirectionId[];
const MODES: Mode[] = ['settle', 'reduced'];
const STORMS: Storm[] = ['toggle', 'cycle4', 'reemit', 'neutral3'];
const EVERY = [17, 50, 100, 143, 167, 250];
const SPAN = [3000, 10000];
const SETTLE = BASE.motion.settle.duration;
const RAMP: Record<Mode, number> = { settle: SETTLE, reduced: BASE.motion.fadeReduced.duration };
/** The steepest slope of either curve, per ms (E2): settle in 4/0.6 s, reduced out 2/0.15 s. */
const SLOPE: Record<Mode, number> = { settle: 4 / 0.6 / 1000, reduced: 2 / 0.15 / 1000 };
const LONG = 600_000;

const geometry = { centrePx: [100, 100] as [number, number], radiusPx: 80, pxPerDp: 80 / 170, fontScale: 1 };
const config = (id: DirectionId): LedgerConfig => ({ restLobes: staticsFor(id, EXTENSIONS as never).restLobes.length, neutralLobe: DIRECTIONS[id].field.lobe.neutralLobe > 0 });
const tap = (x: number, y: number): Tap => ({ x, y });
const QUAD = [tap(0.566, 0.566), tap(0.566, -0.566), tap(-0.566, -0.566), tap(-0.566, 0.566)];
const neutral = (k: number) => tap(0.01 * (k % 9) + 0.01, -0.02);

function store(initial: Tap[] = []) {
  let taps = initial;
  let seq = 0;
  return {
    add(t: Tap) { taps = [...taps, t].slice(-3); seq++; },
    undo() { taps = taps.slice(0, -1); seq++; },
    taps: () => taps,
    seq: () => seq,
  };
}

const frameState = (id: DirectionId, face: Face, f: LedgerFades): FieldState => ({
  direction: id,
  face,
  placements: f.placements.map((p) => ({ x: p.x, y: p.y, fade: p.fade, ordinal: p.ordinal, slot: p.slot, role: p.role })),
  restFade: f.restFade,
  restSlots: f.restSlots,
  stress: 0,
  confidence: 1,
  genesis: false,
  tMs: 7000,
  breathPhase: 0.3,
  tier: 'full',
});

interface Outcome {
  starts: number[];
  admittedAtStarts: number[];
  maxDemand: number;
  demandMismatch: number;
  slopeBreaks: string[];
  entersNotAtZero: number[];
  leavesNotAtZero: number[];
  restBreaks: number;
  threw: string | null;
  lastTap: number;
  converged: number | null;
  restLitAfterLastTap: boolean;
  series: string[];
}

/** One storm, frame by frame at 1 ms, through the ledger and the builder. */
function storm(id: DirectionId, mode: Mode, kind: Storm, every: number, span: number, limits: Admission = ADMISSION, keepSeries = false): Outcome {
  const s = store(kind === 'neutral3' ? [neutral(1), neutral(2), neutral(3)] : []);
  const actions = new Map<number, Array<() => void>>();
  const at = (t: number, act: () => void) => actions.set(t, [...(actions.get(t) ?? []), act]);
  let lastTap = 0;
  // The ledger's first frame (t = 0) sees the store as it is; the storm's taps start at 1 ms.
  if (kind === 'toggle') {
    for (let t = 1, k = 0; t < span; t += every, k++) { at(t, k % 2 === 0 ? () => s.add(QUAD[1]) : () => s.undo()); lastTap = t; }
  } else if (kind === 'cycle4') {
    for (let t = 1, k = 0; t < span; t += every, k++) { const q = QUAD[k % 4]; at(t, () => s.add(q)); lastTap = t; }
  } else if (kind === 'reemit') {
    at(1, () => s.add(QUAD[0]));
    lastTap = 1;
  } else {
    for (let k = 0; k < 3; k++) { const q = neutral(4 + k); at(100 + k * every, () => s.add(q)); lastTap = 100 + k * every; }
  }
  const end = Math.max(span, lastTap) + 3 * SETTLE + RAMP[mode] + 200;
  const statics = staticsFor(id, EXTENSIONS as never);
  let ledger = emptyLedger(config(id), limits);
  const o: Outcome = { starts: [], admittedAtStarts: [], maxDemand: 0, demandMismatch: 0, slopeBreaks: [], entersNotAtZero: [], leavesNotAtZero: [], restBreaks: 0, threw: null, lastTap, converged: null, restLitAfterLastTap: false, series: [] };
  let previous = new Map<number, number>();
  let previousRest = -1;
  let lastKey = '';
  let startsSeen = 0;
  for (let t = 0; t <= end; t++) {
    for (const act of actions.get(t) ?? []) act();
    let input = { seq: s.seq(), taps: s.taps() };
    if (kind === 'reemit' && t > 0 && t % every === 0) {
      // the same taps re-sent: a fresh array of equal taps, under the same seq or a new one
      input = { seq: (t / every) % 2 === 0 ? s.seq() + t : s.seq(), taps: s.taps().map((x) => ({ ...x })) };
    }
    ledger = reconcile(ledger, input, t, mode);
    const f = fades(ledger);
    if (keepSeries) o.series.push(JSON.stringify(f));
    if (ledger.starts !== startsSeen) {
      startsSeen = ledger.starts;
      o.starts.push(t);
      o.admittedAtStarts.push(ledger.admitted);
    }
    const demand = f.placements.length + f.restSlots.length;
    if (demand !== f.demand) o.demandMismatch++;
    o.maxDemand = Math.max(o.maxDemand, demand);
    // Fades by id: the steepest slope per ms; enter at 0 (a reset's are exempt: no animation); leave at 0.
    const now = new Map<number, number>(f.placements.map((p) => [p.id, p.fade]));
    for (const e of f.ended) now.set(e, 0);
    for (const [pid, fade] of now) {
      const before = previous.get(pid);
      if (before === undefined) {
        if (fade !== 0 && t > 0) o.entersNotAtZero.push(pid);
      } else if (Math.abs(fade - before) > SLOPE[mode] * 1.001 + 1e-12) {
        o.slopeBreaks.push(`id ${pid} at ${t} ms: ${before} → ${fade}`);
      }
    }
    for (const [pid, before] of previous) if (!now.has(pid) && before !== 0) o.leavesNotAtZero.push(pid);
    previous = new Map([...now].filter(([pid]) => !f.ended.includes(pid)));
    if (t > lastTap && f.restFade > 0) o.restLitAfterLastTap = true;
    // The built frame: it must build (never slice, never overflow), and its rest lobes obey the bound.
    // The builder is pure, so a frame whose ledger output is unchanged builds the same frame: it is
    // built again only when the output changes.
    const key = f.placements.map((p) => `${p.id}:${p.slot}:${p.fade}`).join(',') + '|' + f.restFade + '|' + f.restSlots.join(',');
    if (o.threw === null && key !== lastKey) {
      lastKey = key;
      try {
        const frame = buildFieldFrame(frameState(id, 'dark', f), geometry, statics);
        packFrame(frame);
        const rest = Math.max(0, ...frame.nodes.filter((nd) => nd.id === NODE.R0 && nd.bead === null).map((nd) => nd.fade));
        if (previousRest >= 0 && Math.abs(rest - previousRest) > SLOPE[mode] * 1.001 + 1e-12) o.restBreaks++;
        previousRest = rest;
      } catch (error) {
        o.threw = `${(error as Error).name} at ${t} ms: ${(error as Error).message}`;
      }
    }
    // Convergence: what is shown above 0 is exactly the store's taps, every one at 1.
    const target = s.taps();
    const lit = f.placements.filter((p) => p.fade > 0);
    const same = lit.length === target.length && lit.every((p, i) => p.fade === 1 && p.x === target[i].x && p.y === target[i].y);
    if (t >= lastTap) {
      if (same && o.converged === null) o.converged = t - lastTap;
      if (!same) o.converged = null;
    }
  }
  return o;
}

const cases = IDS.flatMap((id) => MODES.flatMap((mode) => STORMS.map((kind) => [id, mode, kind] as const)));

describe('E3: ledger storms, every direction × mode × storm, taps every 17–250 ms, for 3 s and 10 s', () => {
  it.each(cases)(
    '%s, %s, %s',
    (id, mode, kind) => {
      for (const every of EVERY) {
        const runs = SPAN.map((span) => storm(id, mode, kind, every, span));
        for (const [i, o] of runs.entries()) {
          const label = `${id} ${mode} ${kind} every ${every} ms for ${SPAN[i]} ms`;
          expect({ label, threw: o.threw }).toEqual({ label, threw: null });
          expect({ label, maxDemand: Math.min(o.maxDemand, NODE_SLOTS + 1), mismatch: o.demandMismatch }).toEqual({ label, maxDemand: Math.min(o.maxDemand, NODE_SLOTS), mismatch: 0 });
          expect({ label, slope: o.slopeBreaks.slice(0, 3), enters: o.entersNotAtZero, leaves: o.leavesNotAtZero, rest: o.restBreaks }).toEqual({ label, slope: [], enters: [], leaves: [], rest: 0 });
          const gaps = o.starts.slice(1).map((t, k) => t - o.starts[k]);
          expect({ label, shortGaps: gaps.filter((g) => g < SETTLE) }).toEqual({ label, shortGaps: [] });
          expect({ label, emptyStarts: o.admittedAtStarts.filter((a) => a < 1).length }).toEqual({ label, emptyStarts: 0 });
          const bound = (o.restLitAfterLastTap ? 3 : 2) * SETTLE + RAMP[mode];
          expect({ label, converged: o.converged !== null && o.converged <= bound }).toEqual({ label, converged: true });
          if (kind === 'reemit') expect({ label, starts: o.starts.length }).toEqual({ label, starts: 1 });
        }
        // No backlog: the 10 s storm converges no more than 600 ms after the 3 s one (a raw queue lags in proportion to its length).
        expect(runs[1].converged!).toBeLessThanOrEqual(runs[0].converged! + SETTLE);
      }
    },
    LONG,
  );

  it.each(MODES)('%s: reemit’s fades are bit-identical to one tap sent once', (mode) => {
    for (const every of EVERY) {
      const re = storm('abyss', mode, 'reemit', every, 3000, ADMISSION, true);
      const once = storm('abyss', mode, 'reemit', 1e9, 3000, ADMISSION, true);
      expect(re.series).toEqual(once.series);
    }
  });
});

describe('E3’s planted controls: each guard is shown to bite', () => {
  it('a ledger that admits three swaps makes Linen’s neutral3 overflow, and the builder throws a RangeError', () => {
    const three: Admission = { ...ADMISSION, entering: 3, leaving: 3, nodes: 99 };
    const o = storm('linen', 'settle', 'neutral3', 100, 3000, three);
    expect(o.threw).toMatch(/^RangeError/);
    expect(storm('linen', 'settle', 'neutral3', 100, 3000).threw).toBeNull();
  });

  it('a raw first-in-first-out ledger (no netting) fails convergence', () => {
    const raw: Admission = { ...ADMISSION, netting: false };
    const outcomes = [17, 50].map((every) => [storm('abyss', 'settle', 'toggle', every, 3000, raw), storm('abyss', 'settle', 'toggle', every, 10000, raw)]);
    const fails = outcomes.some(([short, long]) => long.converged === null || short.converged === null || long.converged - short.converged > SETTLE || long.converged > 3 * SETTLE + SETTLE);
    expect(fails).toBe(true);
  });
});

describe('E5: the halo is bound to the ledger', () => {
  // Same ledger output, one built while the store holds an extra tap that is not yet admitted. Under
  // reduced motion the first ramp ends at 150 ms, so only the spacing keeps the tap out until 601 ms.
  it.each(IDS.flatMap((id) => MODES.map((mode) => [id, mode] as const)))('%s, %s: a frame built while the store holds an unadmitted tap is byte-identical to one built without it', (id, mode) => {
    const a = store();
    const b = store();
    let la = emptyLedger(config(id));
    let lb = emptyLedger(config(id));
    let checked = 0;
    for (let t = 0; t <= 500; t++) {
      if (t === 1) { a.add(QUAD[3]); b.add(QUAD[3]); }
      if (t === 100) b.add(QUAD[1]); // waits for the spacing: not admitted before 601 ms
      la = reconcile(la, { seq: a.seq(), taps: a.taps() }, t, mode);
      lb = reconcile(lb, { seq: b.seq(), taps: b.taps() }, t, mode);
      if (t >= 100 && t % 50 === 0) {
        expect(fades(lb)).toEqual(fades(la));
        const fa = buildFieldFrame(frameState(id, 'dark', fades(la)), geometry, staticsFor(id, EXTENSIONS as never));
        const fb = buildFieldFrame(frameState(id, 'dark', fades(lb)), geometry, staticsFor(id, EXTENSIONS as never));
        expect(packFrame(fb)).toEqual(packFrame(fa));
        checked++;
      }
    }
    expect(checked).toBe(9);
  });

  const DESIGN = path.resolve(__dirname, '../../..');
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(e.name) && !full.includes(`${path.sep}__tests__${path.sep}`)) out.push(full);
    }
    return out;
  };
  /** A plate or bead source that reads field.halo or draws a halo of its own. */
  const offends = (file: string, source: string) => /(plate|bead)/i.test(path.basename(file)) && /field\.halo|\bhalo\b|Halo\b/.test(source);

  it('the static guard: no plate or bead file reads field.halo or draws a halo', () => {
    const files = [...walk(path.join(DESIGN, 'v2')), ...walk(path.join(DESIGN, 'lab'))];
    expect(files.length).toBeGreaterThan(20);
    expect(files.filter((f) => offends(f, fs.readFileSync(f, 'utf8'))).map((f) => path.relative(DESIGN, f))).toEqual([]);
  });

  it('the static guard bites on planted sources', () => {
    expect(offends('lab/v1hero/Beads.tsx', 'const r = BASE.field.halo.diameter / 2;')).toBe(true);
    expect(offends('lab/v1hero/Plate.tsx', '<Circle r={22} color={haloColour} /> // the Halo')).toBe(true);
    expect(offends('lab/v1hero/VoiceLine.tsx', 'const halo = 1;')).toBe(false);
  });
});
