import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import type { DirectionId, Face } from '../../tokens/tokens.generated.ts';
import { fallbackPlan, type FallbackPlan } from '../fallbackModel.ts';
import { PHONE, heroLayout } from '../fallbackScenes.ts';
import type { FieldLayout } from '../fieldDriver.ts';
import { staticsFor } from '../statics.ts';

// UI-222 (RA-35): the fallback's clip walks every device row of its canvas on the JS thread, and Skia cannot make a surface
// over 16384 px on a side. So a canvas over 16384 px on either side draws no field and is drawn in dp, exactly as a density
// that is not a finite positive number is (RA-32): the same plan, byte for byte, and it returns at once. A canvas at the
// bound, and every real phone at a real density, keeps its field and its density: no real scene changes.

const ABYSS = 'abyss' as DirectionId;
const statics = staticsFor(ABYSS, EXTENSIONS as never);
const TAPS = [{ x: 0.45, y: 0.3 }];
const planOf = (layout: FieldLayout, pxPerDp: number, face: Face = 'dark'): FallbackPlan =>
  fallbackPlan({ direction: ABYSS, face, statics, taps: TAPS, layout, pxPerDp });
const timed = (layout: FieldLayout, pxPerDp: number) => {
  const t0 = Date.now();
  const plan = planOf(layout, pxPerDp);
  return { plan, ms: Date.now() - t0 };
};
const phone = heroLayout(ABYSS, PHONE.width, PHONE.height, 1);

describe('UI-222: a canvas over 16384 px on either side draws no field and is drawn in dp, at once', () => {
  it.each([
    ['a 10000 dp tall view at 2.625', heroLayout(ABYSS, PHONE.width, 10000, 1), 2.625],
    ['a phone at a density of 20', phone, 20],
    ['a phone at pxPerDp 1e300', phone, 1e300],
    ['a phone at pxPerDp 1e308 (its px size is not finite)', phone, 1e308],
    ['a 10000 dp wide view at 2.625', heroLayout(ABYSS, 10000, PHONE.height, 1), 2.625],
  ] as const)('%s: no field, drawn in dp like a bad density, in under 500 ms', (_label, layout, k) => {
    const { plan, ms } = timed(layout, k);
    expect(ms).toBeLessThan(500);
    expect(plan.field).toBeNull();
    expect(plan.pxPerDp).toBe(1);
    expect(plan.size).toEqual({ width: Math.ceil(layout.width), height: Math.ceil(layout.height) });
    expect(plan).toEqual(planOf(layout, Number.NaN));
  });

  it.each([['tall', 411, 8192, 411, 8192.5], ['wide', 8192, 914, 8192.5, 914]] as const)('the bound (%s): 16384 px keeps its field and density; one px over does not', (_label, w0, h0, w1, h1) => {
    const at = planOf(heroLayout(ABYSS, w0, h0, 1), 2);
    expect(at.field).not.toBeNull();
    expect(at.pxPerDp).toBe(2);
    expect(Math.max(at.size.width, at.size.height)).toBe(16384);
    const over = planOf(heroLayout(ABYSS, w1, h1, 1), 2);
    expect(over.field).toBeNull();
    expect(over.pxPerDp).toBe(1);
  });

  it.each([1, 1.5, 2, 2.625, 3, 3.5, 4])('the control: a phone at density %s keeps its field and its density, on both faces', (k) => {
    for (const face of ['dark', 'light'] as const) {
      const plan = planOf(phone, k, face);
      expect(plan.field).not.toBeNull();
      expect(plan.pxPerDp).toBe(k);
      expect(plan.size).toEqual({ width: Math.ceil(phone.width * k), height: Math.ceil(phone.height * k) });
    }
  });
});
