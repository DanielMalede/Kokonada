import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { BASE, DIRECTIONS, type DirectionId } from '../../tokens/tokens.generated.ts';
import type { MotionTier } from '../../motion/useMotionPolicy.ts';
import type { FieldStatics } from '../fieldFrame.ts';
import { emptyLedger, fades, type Ledger, type LedgerInput } from '../placementLedger.ts';
import { ledgerConfigFor, staticsFor } from '../statics.ts';

// The builder behind a counter: the real function, every call counted, so a skipped frame that still built is seen.
const counts = { build: 0 };
jest.mock('../fieldFrame.ts', () => {
  const actual = jest.requireActual('../fieldFrame.ts');
  return { ...actual, buildFieldFrame: (...args: unknown[]) => { counts.build += 1; return actual.buildFieldFrame(...args); } };
});

import { capFrame, fieldStep, FRAME_CAP_TOLERANCE, fpsCapFor, frameCapStart, renderGeometry, sameLayoutPass, sameTapValues, type FieldLayout, type FrameCap, type FrameParams } from '../fieldDriver.ts';

// UI-171, the owner's ruling of 2026-11-14: the full tier keeps the display's rate up to 120 frames a second, the low
// (power-save) tier runs at 60; the still tier has no cap (it draws only its ramps). The cap is field.tiers.<tier>.fpsCap,
// read from the token. A frame is drawn when its time has reached the next due time less a tolerance for timestamp
// jitter (a quarter of the cap's period); each draw moves the due time on by one period from the last due time, never
// from the frame's own time, so the drawn rate converges on the cap without drift; a frame later than a whole period
// re-anchors the schedule on itself. A skipped frame does no work at all: no ledger step, no build. The first frame after
// a mount, a tier change or a wake (a new generation) is always drawn. The ledger takes each drawn frame's own
// timestamp, so the time of a skipped frame is never lost: the next drawn frame's dt holds it, under motion.dtClamp.

const ID = Object.keys(DIRECTIONS)[0] as DirectionId;
const STATICS: FieldStatics = staticsFor(ID, EXTENSIONS as never);
const LAYOUT: FieldLayout = { width: 360, height: 640, centre: [180, 300], radius: 170, fontScale: 1 };
const PX_PER_DP = 2.625;
const GEOMETRY = renderGeometry(LAYOUT, PX_PER_DP, 0.5);
const params = (tier: MotionTier): FrameParams => ({ direction: ID, face: 'dark', stress: 0, confidence: 1, genesis: false, tier });
const ledger0 = (): Ledger => emptyLedger(ledgerConfigFor(ID, 'dark', STATICS, { radiusPx: LAYOUT.radius * PX_PER_DP * 0.5, pxPerDp: PX_PER_DP * 0.5 }));

// A deterministic jitter in [-amp, amp] ms per frame (an LCG), so a run is the same on every machine.
const jitter = (amp: number) => {
  let s = 12345;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return (s / 2147483648) * 2 * amp - amp;
  };
};

interface Run {
  /** Each display frame: drawn or skipped. */
  readonly drawn: boolean[];
  /** The timestamps of the drawn frames. */
  readonly at: number[];
  /** The dt each drawn frame's ledger step took (the ledger clock's advance). */
  readonly dt: number[];
  readonly builds: number;
  readonly ledger: Ledger;
}

/** Frames at `hz` for `frames` display frames, each through the cap and, when drawn, one real fieldStep. */
function run(tier: MotionTier, hz: number, frames: number, amp = 0, input: (i: number) => LedgerInput = () => ({ seq: 0, taps: [] })): Run {
  const next = jitter(amp);
  const before = counts.build;
  let cap: FrameCap = frameCapStart();
  let ledger = ledger0();
  const drawn: boolean[] = [];
  const at: number[] = [];
  const dt: number[] = [];
  for (let i = 0; i < frames; i++) {
    const now = 1000 + (i * 1000) / hz + (i === 0 ? 0 : next());
    const gate = capFrame(cap, now, tier, 0);
    cap = gate.cap;
    drawn.push(gate.draw);
    if (!gate.draw) continue;
    const step = fieldStep(ledger, input(i), now, params(tier), GEOMETRY, STATICS, 0, 0.5);
    if (at.length > 0) dt.push(step.ledger.clock - ledger.clock);
    at.push(now);
    ledger = step.ledger;
  }
  return { drawn, at, dt, builds: counts.build - before, ledger };
}

beforeEach(() => {
  counts.build = 0;
});

describe('the cap is the tier’s token (UI-171, the owner’s ruling)', () => {
  it('full 120, low 60, still 0 (no cap): field.tiers.<tier>.fpsCap', () => {
    expect([BASE.field.tiers.full.fpsCap, BASE.field.tiers.low.fpsCap, BASE.field.tiers.still.fpsCap]).toEqual([120, 60, 0]);
    expect(fpsCapFor('full')).toBe(BASE.field.tiers.full.fpsCap);
    expect(fpsCapFor('low')).toBe(BASE.field.tiers.low.fpsCap);
    expect(fpsCapFor('still')).toBe(BASE.field.tiers.still.fpsCap);
  });

  it('read from the token, never a number in the code: plant another cap and the skipping follows', () => {
    let planted: { full: number; low: number; drawn: number } | null = null;
    jest.isolateModules(() => {
      jest.doMock('../../tokens/tokens.generated', () => {
        const actual = jest.requireActual('../../tokens/tokens.generated');
        const tiers = actual.BASE.field.tiers;
        return { ...actual, BASE: { ...actual.BASE, field: { ...actual.BASE.field, tiers: { ...tiers, full: { ...tiers.full, fpsCap: 40 }, low: { ...tiers.low, fpsCap: 20 } } } } };
      });
      const d = require('../fieldDriver');
      let cap = d.frameCapStart();
      let drawn = 0;
      for (let i = 0; i < 120; i++) {
        const g = d.capFrame(cap, (i * 1000) / 120, 'full', 0);
        cap = g.cap;
        if (g.draw) drawn += 1;
      }
      planted = { full: d.fpsCapFor('full'), low: d.fpsCapFor('low'), drawn };
    });
    expect(planted).toEqual({ full: 40, low: 20, drawn: 40 });
  });

  it('the tolerance is a quarter of the cap’s period', () => {
    expect(FRAME_CAP_TOLERANCE).toBe(0.25);
  });
});

describe('frames skipped to the cap, counted at the builder', () => {
  it('120 Hz, full: nothing is skipped, with ±0.5 ms of jitter', () => {
    const r = run('full', 120, 240, 0.5);
    expect(r.drawn.every(Boolean)).toBe(true);
    expect(r.builds).toBe(240);
  });

  it('120 Hz, low: every second frame is skipped, exactly, with ±0.5 ms of jitter; a skipped frame builds nothing', () => {
    const r = run('low', 120, 240, 0.5);
    expect(r.drawn).toEqual(Array.from({ length: 240 }, (_, i) => i % 2 === 0));
    expect(r.builds).toBe(120);
  });

  it('60 Hz: nothing is skipped at either tier, with ±0.5 ms of jitter (a frame 0.5 ms early is drawn)', () => {
    for (const tier of ['full', 'low'] as const) {
      const r = run(tier, 60, 180, 0.5);
      expect(r.drawn.every(Boolean)).toBe(true);
      expect(r.builds).toBe(180);
    }
  });

  it('a frame 0.5 ms early at a display rate equal to the cap is drawn, at both caps', () => {
    for (const [tier, hz] of [['full', 120], ['low', 60]] as const) {
      const period = 1000 / hz;
      let cap = frameCapStart();
      cap = capFrame(cap, 0, tier, 0).cap;
      const early = capFrame(cap, period - 0.5, tier, 0);
      expect(early.draw).toBe(true);
      // and the schedule holds: the next frame, on time, is drawn too
      expect(capFrame(early.cap, 2 * period, tier, 0).draw).toBe(true);
    }
  });

  it('90 Hz, full: nothing is skipped (90 is under the cap)', () => {
    const r = run('full', 90, 270, 0.5);
    expect(r.drawn.every(Boolean)).toBe(true);
  });

  it('90 Hz, low: two drawn of every three, never two skips in a row, and never faster than the cap', () => {
    const exact = run('low', 90, 270);
    // 0 drawn (due 16.7), 11.1 skipped, 22.2 drawn (due 33.3), 33.3 drawn (due 50), 44.4 skipped, …
    expect(exact.drawn).toEqual(Array.from({ length: 270 }, (_, i) => i % 3 !== 1));
    for (const amp of [0, 0.5]) {
      const r = run('low', 90, 270, amp);
      const period = 1000 / 60;
      const frame = 1000 / 90;
      // never two skips in a row: the cadence the cap implies at 90 Hz (60 of 90), no 45 Hz stutter
      for (let i = 1; i < r.drawn.length; i++) expect(r.drawn[i] || r.drawn[i - 1]).toBe(true);
      // never faster than the cap: k draws apart span at least k periods, less one display frame and the jitter
      for (let j = 0; j < r.at.length; j++) {
        for (let k = j + 1; k < r.at.length; k++) expect(r.at[k] - r.at[j]).toBeGreaterThanOrEqual((k - j) * period - frame - 2 * amp - 1e-9);
      }
      // 3 s at 60: 180 draws, one either side at the ends
      expect(Math.abs(r.at.length - 180)).toBeLessThanOrEqual(1);
    }
  });

  it('the still tier is not capped: every frame it runs is drawn', () => {
    const r = run('still', 120, 60);
    expect(r.drawn.every(Boolean)).toBe(true);
  });
});

describe('a skipped frame’s time is never lost: the dt law takes the real elapsed time between drawn frames', () => {
  it('120 Hz, low: each drawn frame’s dt is the time since the last drawn frame (two display frames), under motion.dtClamp', () => {
    const r = run('low', 120, 240, 0.5);
    expect(r.dt.length).toBe(119);
    for (let i = 0; i < r.dt.length; i++) {
      expect(r.dt[i]).toBeCloseTo(r.at[i + 1] - r.at[i], 9);
      expect(r.dt[i]).toBeGreaterThan(1000 / 60 - 1.01);
      expect(r.dt[i]).toBeLessThan(BASE.motion.dtClamp);
    }
  });

  it('the clamp still holds: a stall longer than motion.dtClamp moves the ledger by the clamp, and the next frame is drawn', () => {
    let cap = capFrame(frameCapStart(), 0, 'low', 0).cap;
    const l0 = fieldStep(ledger0(), { seq: 0, taps: [] }, 0, params('low'), GEOMETRY, STATICS, 0, 0.5).ledger;
    const late = capFrame(cap, 400, 'low', 0);
    expect(late.draw).toBe(true);
    cap = late.cap;
    const l1 = fieldStep(l0, { seq: 0, taps: [] }, 400, params('low'), GEOMETRY, STATICS, 0, 0.5).ledger;
    expect(l1.clock - l0.clock).toBe(BASE.motion.dtClamp);
    // the schedule re-anchors on the late frame: no burst of catch-up frames after a stall
    expect(capFrame(cap, 400 + 1000 / 120, 'low', 0).draw).toBe(false);
    expect(capFrame(cap, 400 + 1000 / 60, 'low', 0).draw).toBe(true);
  });

  it('after N seconds, 120 Hz full and 120 Hz low stand at the same place: the same ledger clock and the same crossfade', () => {
    const taps = (i: number): LedgerInput => (i < 24 ? { seq: 0, taps: [{ x: 0.5, y: 0.5 }] } : { seq: 1, taps: [{ x: 0.5, y: 0.5 }, { x: -0.4, y: 0.3 }] });
    // 24 frames in, a change starts a crossfade; 36 frames (0.3 s) later both tiers draw that frame (an even index)
    const full = run('full', 120, 61, 0, taps);
    const low = run('low', 120, 61, 0, taps);
    expect(full.at[full.at.length - 1]).toBe(low.at[low.at.length - 1]);
    expect(low.ledger.clock).toBeCloseTo(full.ledger.clock, 9);
    const fadesOf = (l: Ledger) => fades(l).placements.map((p) => p.fade);
    const mid = fadesOf(full.ledger);
    expect(mid.some((f) => f > 0 && f < 1)).toBe(true);
    const lowFades = fadesOf(low.ledger);
    expect(lowFades).toHaveLength(mid.length);
    lowFades.forEach((f, i) => expect(f).toBeCloseTo(mid[i], 9));
  });
});

describe('the first frame after a mount, a tier change or a wake is always drawn', () => {
  it('a mount: the first frame is drawn at any tier', () => {
    for (const tier of ['full', 'low', 'still'] as const) expect(capFrame(frameCapStart(), 5, tier, 0).draw).toBe(true);
  });

  it('a tier change: the next frame is drawn, though its cap would skip it', () => {
    const low = capFrame(frameCapStart(), 0, 'low', 0).cap;
    expect(capFrame(low, 1000 / 120, 'low', 0).draw).toBe(false);
    expect(capFrame(low, 1000 / 120, 'full', 0).draw).toBe(true);
    // full to low, one 120 Hz frame after a full draw: drawn, and then low's cadence from it
    const full = capFrame(capFrame(frameCapStart(), 0, 'full', 0).cap, 1000 / 120, 'full', 0).cap;
    const changed = capFrame(full, 2000 / 120, 'low', 0);
    expect(changed.draw).toBe(true);
    expect(capFrame(changed.cap, 3000 / 120, 'low', 0).draw).toBe(false);
    expect(capFrame(changed.cap, 4000 / 120, 'low', 0).draw).toBe(true);
  });

  it('a wake (a new generation): the next frame is drawn, though its cap would skip it', () => {
    const low = capFrame(frameCapStart(), 0, 'low', 3).cap;
    expect(capFrame(low, 1000 / 120, 'low', 3).draw).toBe(false);
    expect(capFrame(low, 1000 / 120, 'low', 4).draw).toBe(true);
  });

  it('time that runs backwards past a period re-anchors the schedule instead of skipping until it catches up', () => {
    const cap = capFrame(frameCapStart(), 10_000, 'low', 0).cap;
    expect(capFrame(cap, 100, 'low', 0).draw).toBe(true);
  });

  it('a non-finite timestamp is drawn, and the next frame is drawn too', () => {
    const cap = capFrame(frameCapStart(), 0, 'low', 0).cap;
    const bad = capFrame(cap, Number.NaN, 'low', 0);
    expect(bad.draw).toBe(true);
    expect(capFrame(bad.cap, 1000 / 120, 'low', 0).draw).toBe(true);
  });
});

// RA-39 (the designer's ruling): a layout pass that changed by value forces a draw (FieldView), so the comparison is by
// value over every field the rim, the words and the beads are placed from, and never true for two different passes.
describe('sameLayoutPass: the layout passes compared by value (RA-39)', () => {
  const QUIET = [{ x: 20, y: 20, width: 40, height: 20 }, { x: 200, y: 500, width: 60, height: 30 }];
  const pass = (over: Partial<FieldLayout> = {}, pxPerDp = PX_PER_DP, renderScale = 0.5) => ({ layout: { ...LAYOUT, quietRects: QUIET, ...over }, pxPerDp, renderScale });

  it('the same values in new objects are the same pass; omitted quiet rects are none', () => {
    expect(sameLayoutPass(pass(), { ...pass(), layout: { ...pass().layout, centre: [180, 300], quietRects: QUIET.map((q) => ({ ...q })) } })).toBe(true);
    expect(sameLayoutPass(pass({ quietRects: undefined }), pass({ quietRects: [] }))).toBe(true);
  });

  it('NaN equals NaN, so a poisoned value rebuilt on every render is not a change on every render', () => {
    expect(sameLayoutPass(pass({ radius: Number.NaN }), pass({ radius: Number.NaN }))).toBe(true);
    expect(sameLayoutPass(pass({}, Number.NaN), pass({}, Number.NaN))).toBe(true);
  });

  it('each field alone is a change', () => {
    const changed = [
      pass({ width: 361 }), pass({ height: 641 }), pass({ centre: [181, 300] }), pass({ centre: [180, 301] }), pass({ radius: 171 }),
      pass({ fontScale: 1.3 }), pass({}, 3), pass({}, PX_PER_DP, 0.4), pass({ quietRects: [QUIET[0]] }),
      pass({ quietRects: [{ ...QUIET[0], x: 21 }, QUIET[1]] }), pass({ quietRects: [{ ...QUIET[0], y: 21 }, QUIET[1]] }),
      pass({ quietRects: [QUIET[0], { ...QUIET[1], width: 61 }] }), pass({ quietRects: [QUIET[0], { ...QUIET[1], height: 31 }] }),
    ];
    changed.forEach((c, i) => {
      expect([i, sameLayoutPass(pass(), c)]).toEqual([i, false]);
      expect([i, sameLayoutPass(c, pass())]).toEqual([i, false]);
    });
  });
});

describe('sameTapValues: the taps compared by value (RA-39)', () => {
  it('the same values in a new array are the same; NaN equals NaN', () => {
    expect(sameTapValues([{ x: 0.5, y: 0.5 }, { x: -0.4, y: 0.3 }], [{ x: 0.5, y: 0.5 }, { x: -0.4, y: 0.3 }])).toBe(true);
    expect(sameTapValues([], [])).toBe(true);
    expect(sameTapValues([{ x: Number.NaN, y: 0 }], [{ x: Number.NaN, y: 0 }])).toBe(true);
  });

  it('a tap added, removed, moved in x or in y, or the order changed, is a change', () => {
    const t = [{ x: 0.5, y: 0.5 }, { x: -0.4, y: 0.3 }];
    for (const c of [[t[0]], [...t, { x: 0, y: 0 }], [{ x: 0.51, y: 0.5 }, t[1]], [t[0], { x: -0.4, y: 0.31 }], [t[1], t[0]]]) {
      expect(sameTapValues(t, c)).toBe(false);
      expect(sameTapValues(c, t)).toBe(false);
    }
  });
});

// RA-41 (resilience B4 re-audit, UI-231): every display rate a phone ships, at both tiers, with ±0.5 ms of timestamp
// jitter over 4 s. The drawn count is the lower of the display rate and the cap, a gap between two draws is never longer
// than one cap period (or one display frame, when the display is slower) plus one display frame, and no 10 draws ever
// run faster than the cap allows, less one display frame of phase and the jitter.
describe('RA-41: every display rate, both tiers, with jitter (UI-231)', () => {
  const RATES = [30, 48, 60, 90, 96, 120, 144, 165];
  const AMP = 0.5;
  /** The timestamps drawn over `seconds` at `hz`, through the cap alone. */
  const drawnAt = (tier: MotionTier, hz: number, seconds: number) => {
    const next = jitter(AMP);
    let cap = frameCapStart();
    const at: number[] = [];
    for (let i = 0; i < hz * seconds; i++) {
      const now = 1000 + (i * 1000) / hz + (i === 0 ? 0 : next());
      const gate = capFrame(cap, now, tier, 0);
      cap = gate.cap;
      if (gate.draw) at.push(now);
    }
    return at;
  };

  for (const tier of ['full', 'low'] as const) {
    for (const hz of RATES) {
      it(`${tier} at ${hz} Hz: min(${hz}, cap)·4 draws within 2, no long gap, never faster than the cap over 10 draws`, () => {
        const fps = fpsCapFor(tier);
        const period = 1000 / fps;
        const frame = 1000 / hz;
        const at = drawnAt(tier, hz, 4);
        expect(Math.abs(at.length - Math.min(hz, fps) * 4)).toBeLessThanOrEqual(2);
        let longest = 0;
        for (let k = 1; k < at.length; k++) longest = Math.max(longest, at[k] - at[k - 1]);
        expect(longest).toBeLessThanOrEqual(Math.max(period, frame) + frame + 1);
        let shortest = Infinity;
        for (let k = 10; k < at.length; k++) shortest = Math.min(shortest, at[k] - at[k - 10]);
        expect(shortest).toBeGreaterThanOrEqual(10 * period - frame - 2 * AMP);
      });
    }
  }

  // The earliest draw the tolerance allows sets the next due time 1 + FRAME_CAP_TOLERANCE periods ahead of itself, the
  // farthest ahead a schedule ever stands without time running backwards. A frame repeating that timestamp (a display
  // that reports one vsync twice) is the same frame: it is not drawn again, and the schedule stands.
  it('a repeated timestamp right after the earliest draw the tolerance allows is drawn once, at both tiers and many phases', () => {
    for (const tier of ['full', 'low'] as const) {
      const period = 1000 / fpsCapFor(tier);
      for (let n = 0; n < 2000; n++) {
        const t0 = 1000 + n * 7.31 + (n % 13) * 0.0137;
        const first = capFrame(frameCapStart(), t0, tier, 0).cap;
        const earliest = first.dueMs! - period * FRAME_CAP_TOLERANCE;
        const drawn = capFrame(first, earliest, tier, 0);
        expect([tier, n, drawn.draw]).toEqual([tier, n, true]);
        const again = capFrame(drawn.cap, earliest, tier, 0);
        expect([tier, n, again.draw]).toEqual([tier, n, false]);
        expect(again.cap).toBe(drawn.cap);
        // and the next frame, at its due time, is drawn
        expect(capFrame(again.cap, again.cap.dueMs!, tier, 0).draw).toBe(true);
      }
    }
  });

  it('the re-anchor sits one tolerance beyond the farthest lead a draw can set: time back by less is skipped, by more is drawn', () => {
    for (const tier of ['full', 'low'] as const) {
      const period = 1000 / fpsCapFor(tier);
      const onTime = capFrame(frameCapStart(), 1000, tier, 0).cap;
      // due 1000 + period: a frame back to 1000 − 0.4 periods stands 1.4 periods short of it (skipped, the schedule kept);
      // one back to 1000 − 0.6 periods stands 1.6 short (re-anchored on itself and drawn)
      const short = capFrame(onTime, 1000 - 0.4 * period, tier, 0);
      expect([tier, short.draw, short.cap]).toEqual([tier, false, onTime]);
      const far = capFrame(onTime, 1000 - 0.6 * period, tier, 0);
      expect([tier, far.draw, far.cap.dueMs]).toEqual([tier, true, 1000 - 0.6 * period + period]);
    }
  });
});
