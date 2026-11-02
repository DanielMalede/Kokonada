import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { BASE, DIRECTIONS, type DirectionId, type Face } from '../../tokens/tokens.generated.ts';
import { QUIET_SLOTS } from '../fieldLaw.ts';
import type { FieldStatics } from '../fieldFrame.ts';
import { frameState } from '../ledgerStorms.ts';
import { emptyLedger, fades, needsFrames, reconcile, type Ledger } from '../placementLedger.ts';
import { ledgerConfigFor, staticsFor } from '../statics.ts';

// The builder and the packing behind a counter: the real functions, every call counted, so a step
// that built twice (or never) is seen. Nothing else is replaced.
const counts = { build: 0, pack: 0 };
jest.mock('../fieldFrame.ts', () => {
  const actual = jest.requireActual('../fieldFrame.ts');
  return { ...actual, buildFieldFrame: (...args: unknown[]) => { counts.build += 1; return actual.buildFieldFrame(...args); } };
});
jest.mock('../uniforms.ts', () => {
  const actual = jest.requireActual('../uniforms.ts');
  return { ...actual, packFrame: (...args: unknown[]) => { counts.pack += 1; return actual.packFrame(...args); } };
});

// eslint-disable-next-line import/first
import { buildFieldFrame } from '../fieldFrame.ts';
// eslint-disable-next-line import/first
import { packFrame } from '../uniforms.ts';
// eslint-disable-next-line import/first
import { fieldStep, modeFor, renderGeometry, renderScaleFor, renderSize, sanitisePresence, stateFromLedger, type FieldLayout, type FrameParams } from '../fieldDriver.ts';

// T12: FieldView's per-frame work, as pure worklets (architect rerule §4 item 12, T5 r1 §5; law round 2
// D7; UI-152's update). One step per frame: reconcile the ledger, read its fades, build the frame once,
// pack it once. A builder throw is caught and named, so FieldView switches to FieldFallback instead of
// crashing the UI thread.

const ID = Object.keys(DIRECTIONS)[0] as DirectionId;
const statics = (id: DirectionId = ID): FieldStatics => staticsFor(id, EXTENSIONS as never);
const LAYOUT: FieldLayout = { width: 360, height: 640, centre: [180, 300], radius: 170, fontScale: 1 };
const PX_PER_DP = 2.625;
const params = (over: Partial<FrameParams> = {}): FrameParams => ({ direction: ID, face: 'dark', stress: 0, confidence: 1, genesis: false, tier: 'full', ...over });
const ledgerFor = (face: Face, s: FieldStatics = statics()): Ledger =>
  emptyLedger(ledgerConfigFor(ID, face, s, { radiusPx: LAYOUT.radius * PX_PER_DP * 0.5, pxPerDp: PX_PER_DP * 0.5 }));

beforeEach(() => {
  counts.build = 0;
  counts.pack = 0;
});

describe('renderScale by tier (UI-114, UI-151; designer 2.8)', () => {
  it('full and low read field.tiers; the still draws at the full tier’s renderScale', () => {
    expect(renderScaleFor('full')).toBe(BASE.field.tiers.full.renderScale);
    expect(renderScaleFor('low')).toBe(BASE.field.tiers.low.renderScale);
    expect(renderScaleFor('still')).toBe(BASE.field.tiers.full.renderScale);
    expect([renderScaleFor('full'), renderScaleFor('low')]).toEqual([0.5, 0.33]);
  });

  it('the crossfade mode: the still tier (reduced motion) takes fadeReduced, the others settle', () => {
    expect(modeFor('still')).toBe('reduced');
    expect(modeFor('full')).toBe('settle');
    expect(modeFor('low')).toBe('settle');
  });
});

describe('the geometry boundary: dp to render px, converted once', () => {
  it('centre, R and rects scale by pxPerDp × renderScale; pxPerDp becomes render px per dp', () => {
    const k = PX_PER_DP * 0.5;
    const g = renderGeometry({ ...LAYOUT, quietRects: [{ x: 10, y: 20, width: 100, height: 30 }] }, PX_PER_DP, 0.5);
    expect(g.centrePx).toEqual([180 * k, 300 * k]);
    expect(g.radiusPx).toBe(170 * k);
    expect(g.pxPerDp).toBe(k);
    expect(g.fontScale).toBe(1);
    expect(g.quietRects).toEqual([{ cx: 60 * k, cy: 35 * k, hx: 50 * k, hy: 15 * k }]);
  });

  it('the render target is the view in render px, rounded up, never 0', () => {
    expect(renderSize(LAYOUT, PX_PER_DP, 0.5)).toEqual({ width: Math.ceil(360 * PX_PER_DP * 0.5), height: Math.ceil(640 * PX_PER_DP * 0.5) });
    expect(renderSize({ ...LAYOUT, width: 0.1, height: 0.1 }, 1, 0.33)).toEqual({ width: 1, height: 1 });
  });

  it('the shipped clamp: more than QUIET_SLOTS rects keep the first QUIET_SLOTS (the registry’s slots), and the builder never sees more', () => {
    const rects = Array.from({ length: QUIET_SLOTS + 2 }, (_, i) => ({ x: 10 * i, y: 5, width: 8, height: 8 }));
    const g = renderGeometry({ ...LAYOUT, quietRects: rects }, PX_PER_DP, 0.5);
    expect(g.quietRects).toHaveLength(QUIET_SLOTS);
    expect(g.quietRects).toEqual(renderGeometry({ ...LAYOUT, quietRects: rects.slice(0, QUIET_SLOTS) }, PX_PER_DP, 0.5).quietRects);
    // Without the clamp the builder refuses the frame in every build (architect T5 r1 §5).
    const raw = { ...g, quietRects: [...g.quietRects!, g.quietRects![0]] };
    const state = stateFromLedger(fades(reconcile(ledgerFor('dark'), { seq: 0, taps: [] }, 0, 'settle')), params(), 0, 0.5);
    expect(() => buildFieldFrame(state, raw, statics())).toThrow(RangeError);
    const step = fieldStep(ledgerFor('dark'), { seq: 0, taps: [] }, 0, params(), g, statics(), 0, 0.5);
    expect(step.error).toBeNull();
    expect(step.uniforms).not.toBeNull();
  });
});

describe('quiet presence at the boundary (law round 2 D7, UI-152 update)', () => {
  it('a non-finite presence becomes 1, finite values pass untouched', () => {
    expect(sanitisePresence([Number.NaN, 0.25, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0], 5)).toEqual([1, 0.25, 1, 1, 0]);
  });

  it('it follows the clamp: values past the kept rects go with them; omitted stays omitted (the builder’s default, 1 per rect)', () => {
    expect(sanitisePresence([1, 0, 1, 0, 1, 0, 1, 0], QUIET_SLOTS)).toEqual([1, 0, 1, 0, 1, 0]);
    expect(sanitisePresence(undefined, 3)).toBeUndefined();
  });

  it('a step with a NaN presence draws as presence 1; the builder alone refuses it', () => {
    const g = renderGeometry({ ...LAYOUT, quietRects: [{ x: 10, y: 20, width: 100, height: 30 }, { x: 200, y: 20, width: 40, height: 40 }] }, PX_PER_DP, 0.5);
    const nan = fieldStep(ledgerFor('dark'), { seq: 0, taps: [] }, 0, params({ quietPresence: [Number.NaN, 0.5] }), g, statics(), 0, 0.5);
    const one = fieldStep(ledgerFor('dark'), { seq: 0, taps: [] }, 0, params({ quietPresence: [1, 0.5] }), g, statics(), 0, 0.5);
    expect(nan.error).toBeNull();
    expect(nan.uniforms).toEqual(one.uniforms);
    const state = { ...stateFromLedger(fades(reconcile(ledgerFor('dark'), { seq: 0, taps: [] }, 0, 'settle')), params(), 0, 0.5), quietPresence: [Number.NaN, 0.5] };
    expect(() => buildFieldFrame(state, g, statics())).toThrow(RangeError);
  });
});

describe('one step per frame', () => {
  const g = renderGeometry(LAYOUT, PX_PER_DP, 0.5);

  it('builds exactly once and packs exactly once', () => {
    let l = ledgerFor('dark');
    for (let i = 0; i < 10; i++) {
      const before = { ...counts };
      const step = fieldStep(l, { seq: i < 3 ? 0 : 1, taps: i < 3 ? [] : [{ x: 0.5, y: 0.5 }] }, i * 16, params(), g, statics(), i * 16, 0.5);
      expect(counts.build - before.build).toBe(1);
      expect(counts.pack - before.pack).toBe(1);
      l = step.ledger;
    }
  });

  it('draws the ledger’s placements and nothing else: the uniforms are the pack of the ledger’s frame', () => {
    const input = { seq: 1, taps: [{ x: 0.5, y: 0.5 }, { x: -0.4, y: 0.3 }] };
    const step = fieldStep(ledgerFor('light'), input, 0, params({ face: 'light' }), g, statics(), 1234, 0.25);
    const l = reconcile(ledgerFor('light'), input, 0, 'settle');
    expect(step.ledger).toEqual(l);
    expect(step.uniforms).toEqual(packFrame(buildFieldFrame(stateFromLedger(fades(l), params({ face: 'light' }), 1234, 0.25), g, statics())));
  });

  it('the ledger-to-state mapping is the storm harness’s (frameState), field for field', () => {
    let l = ledgerFor('light');
    l = reconcile(l, { seq: 1, taps: [{ x: 0.5, y: 0.5 }] }, 0, 'settle');
    l = reconcile(l, { seq: 2, taps: [{ x: 0.5, y: 0.5 }, { x: -0.5, y: -0.5 }] }, 700, 'settle');
    l = reconcile(l, { seq: 2, taps: [{ x: 0.5, y: 0.5 }, { x: -0.5, y: -0.5 }] }, 900, 'settle');
    const f = fades(l);
    expect(f.placements.some((p) => p.fade > 0 && p.fade < 1)).toBe(true);
    expect(stateFromLedger(f, params({ face: 'light' }), 7000, 0.3)).toEqual(frameState(ID, 'light', f));
  });

  it('reports a start only on the frame that starts a crossfade', () => {
    let l = ledgerFor('dark');
    l = fieldStep(l, { seq: 0, taps: [] }, 0, params(), g, statics(), 0, 0.5).ledger;
    const starts: boolean[] = [];
    for (let i = 1; i <= 60; i++) {
      const step = fieldStep(l, { seq: 1, taps: [{ x: 0.5, y: 0.5 }] }, i * 16, params(), g, statics(), 0, 0.5);
      starts.push(step.started);
      l = step.ledger;
    }
    expect(starts.filter(Boolean)).toHaveLength(1);
    expect(starts[0]).toBe(true);
  });

  it('the still tier runs one fadeReduced ramp, then is idle; the moving tiers are never idle', () => {
    let l = ledgerFor('dark');
    l = fieldStep(l, { seq: 0, taps: [] }, 0, params({ tier: 'still' }), g, statics(), 0, 0.5).ledger;
    let ms = 1000;
    const first = fieldStep(l, { seq: 1, taps: [{ x: 0.5, y: 0.5 }] }, ms, params({ tier: 'still' }), g, statics(), 0, 0.5);
    expect(first.started).toBe(true);
    expect(first.ledger.running?.mode).toBe('reduced');
    expect(first.idle).toBe(false);
    l = first.ledger;
    let idleAt = -1;
    for (let i = 1; i <= 40 && idleAt < 0; i++) {
      ms += 16;
      const step = fieldStep(l, { seq: 1, taps: [{ x: 0.5, y: 0.5 }] }, ms, params({ tier: 'still' }), g, statics(), 0, 0.5);
      l = step.ledger;
      if (step.idle) idleAt = i * 16;
    }
    expect(idleAt).toBeGreaterThanOrEqual(BASE.motion.fadeReduced.duration);
    expect(idleAt).toBeLessThan(BASE.motion.fadeReduced.duration + 16);
    expect(needsFrames(l)).toBe(false);
    const moving = fieldStep(l, { seq: 1, taps: [{ x: 0.5, y: 0.5 }] }, ms + 16, params({ tier: 'full' }), g, statics(), 0, 0.5);
    expect(moving.idle).toBe(false);
  });
});

describe('a builder throw falls back, never crashes (architect T5 r1 §5, P2)', () => {
  const g = renderGeometry(LAYOUT, PX_PER_DP, 0.5);

  it('planted over-demand (statics with seven rest lobes): the step returns the error and no uniforms, and does not throw', () => {
    const s = statics();
    const planted: FieldStatics = { ...s, restLobes: { dark: Array.from({ length: 7 }, (_, i) => [0.1 * i - 0.3, 0.2] as const), light: s.restLobes.light } };
    const run = () => fieldStep(ledgerFor('dark', planted), { seq: 0, taps: [] }, 0, params(), g, planted, 0, 0.5);
    expect(run).not.toThrow();
    const step = run();
    expect(step.uniforms).toBeNull();
    expect(step.error).toMatch(/RangeError/);
    expect(step.error).toMatch(/node/);
    // The control: the shipped statics build.
    expect(fieldStep(ledgerFor('dark'), { seq: 0, taps: [] }, 0, params(), g, statics(), 0, 0.5).error).toBeNull();
  });
});
