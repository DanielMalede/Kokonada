import { StatusBar } from 'react-native';
import { PHONE } from '../../v2/field/fallbackScenes';
import type { Face } from '../../v2/tokens/tokens.generated';
import { NAV_BAR_BOUND_DP, witnessInsets } from '../witness/witnessInsets';
import { GAP_DP, NO_INSETS, witnessLayout, type Insets } from '../witness/witnessLayout';

// The designer's witness BLOCK (dry run 2026-11-15, 4323c76, Galaxy S22+, he-IL), item iii: the stage runs under the system
// bars, and the capture is cropped to the app region (the screen minus the bars: there y = 74 px, 28.2 dp, down to
// 2301 px), so a patch placed GAP_DP inside the stage had its sample outside the capture. The layout takes the window's
// insets and keeps every patch and W1b GAP_DP inside the capture region, the stage minus the insets.

type Rect = { x: number; y: number; width: number; height: number };
const inside = (inner: Rect, outer: Rect) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
const gapBetween = (a: Rect, b: Rect) => Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width), b.y - (a.y + a.height), a.y - (b.y + b.height));

// The dry run's device: a 1080 × 2340 px window at 2.625 px per dp, the status bar 74 px, the navigation bar 39 px.
const S22 = { width: 1080 / 2.625, height: 2340 / 2.625, k: 2.625 };
const S22_BARS: Insets = { top: 74 / 2.625, right: 0, bottom: 39 / 2.625, left: 0 };
/** The insets the scene lays out with on that device: the measured top, the bound at the bottom. */
const S22_SCENE: Insets = { top: 74 / 2.625, right: 0, bottom: NAV_BAR_BOUND_DP, left: 0 };

const CASES: ReadonlyArray<readonly [string, Face, number, number, number, number, Insets]> = (['dark', 'light'] as const).flatMap((face) => [
  ['the S22+ with the scene\'s insets', face, S22.width, S22.height, S22.k, 1, S22_SCENE],
  ['the S22+ with its bars', face, S22.width, S22.height, S22.k, 1, S22_BARS],
  ['the board phone, 24 dp on every edge', face, PHONE.width, PHONE.height, PHONE.pxPerDp, 1.3, { top: 24, right: 24, bottom: 24, left: 24 }],
] as const);

describe('the witness layout keeps every patch and W1b GAP_DP inside the capture region (the stage minus the insets)', () => {
  it.each(CASES)('%s (%s)', (_name, face, w, h, k, fontScale, insets) => {
    const l = witnessLayout(face, w, h, k, fontScale, insets);
    const region = { x: insets.left, y: insets.top, width: w - insets.left - insets.right, height: h - insets.top - insets.bottom };
    expect(l.insets).toEqual(insets);
    expect(l.region).toEqual(region);
    const inner = { x: region.x + GAP_DP, y: region.y + GAP_DP, width: region.width - 2 * GAP_DP, height: region.height - 2 * GAP_DP };
    const all = [...l.patches.map((p) => p.rect), l.w1b.rect];
    expect(all).toHaveLength(31);
    for (let i = 0; i < all.length; i++) {
      expect(inside(all[i], inner)).toBe(true);
      for (let j = i + 1; j < all.length; j++) expect(gapBetween(all[i], all[j])).toBeGreaterThanOrEqual(GAP_DP);
    }
    for (const p of l.patches) expect(inside(p.sample, region)).toBe(true);
  });

  it('the S22+ rows: the first row of patches starts below the status bar, where the dry run had it under the bar', () => {
    const before = witnessLayout('dark', S22.width, S22.height, S22.k, 1);
    expect(Math.min(...before.patches.map((p) => p.sample.y))).toBeLessThan(S22_BARS.top); // the dry run's fault
    const after = witnessLayout('dark', S22.width, S22.height, S22.k, 1, S22_SCENE);
    expect(Math.min(...after.patches.map((p) => p.rect.y))).toBeGreaterThanOrEqual(S22_BARS.top + GAP_DP);
    expect(Math.max(...after.patches.map((p) => p.rect.y + p.rect.height))).toBeLessThanOrEqual(S22.height - NAV_BAR_BOUND_DP - GAP_DP);
  });

  it('no insets is the stage itself: the default, so a report that rebuilds a stage inside the app region keeps its layout', () => {
    expect(NO_INSETS).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    const l = witnessLayout('dark', PHONE.width, PHONE.height, PHONE.pxPerDp, 1);
    expect(l).toEqual(witnessLayout('dark', PHONE.width, PHONE.height, PHONE.pxPerDp, 1, NO_INSETS));
    expect(l.region).toEqual({ x: 0, y: 0, width: PHONE.width, height: PHONE.height });
  });

  it('is a pure function of the insets too', () => {
    expect(witnessLayout('light', S22.width, S22.height, S22.k, 1, S22_SCENE)).toEqual(witnessLayout('light', S22.width, S22.height, S22.k, 1, { ...S22_SCENE }));
  });

  it.each([
    ['a negative inset', { top: -1, right: 0, bottom: 0, left: 0 }],
    ['an inset that is not a number', { top: NaN, right: 0, bottom: 0, left: 0 }],
    ['insets that leave no region', { top: 500, right: 0, bottom: 500, left: 0 }],
  ])('%s is a RangeError, never a layout over the bars', (_name, insets) => {
    expect(() => witnessLayout('dark', PHONE.width, PHONE.height, PHONE.pxPerDp, 1, insets)).toThrow(RangeError);
  });
});

describe('witnessInsets: the insets the scene lays out with', () => {
  const original = StatusBar.currentHeight;
  afterEach(() => { StatusBar.currentHeight = original; });

  it('the top is the status bar height React Native measured from the window\'s insets (StatusBar.currentHeight, dp)', () => {
    StatusBar.currentHeight = 74 / 2.625;
    expect(witnessInsets()).toEqual({ top: 74 / 2.625, right: 0, bottom: NAV_BAR_BOUND_DP, left: 0 });
    StatusBar.currentHeight = 24;
    expect(witnessInsets().top).toBe(24);
  });

  it('the bottom is a bound no Android navigation bar exceeds (48 dp, the three-button bar), as no lab-reachable API measures it', () => {
    expect(NAV_BAR_BOUND_DP).toBe(48);
  });

  it('no status bar height (not Android) is no inset: the probes then show the harness what the scene used', () => {
    StatusBar.currentHeight = undefined;
    expect(witnessInsets().top).toBe(0);
  });
});
