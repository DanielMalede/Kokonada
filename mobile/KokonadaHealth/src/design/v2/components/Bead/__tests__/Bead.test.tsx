import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Animated, I18nManager, PixelRatio, StyleSheet } from 'react-native';
import { isRed, type RedBand } from '../../../color/redBand.ts';
import type { MotionTier } from '../../../motion/useMotionPolicy.ts';
import { DirectionProvider } from '../../../tokens/DirectionProvider.tsx';
import { BASE, DIRECTIONS, type Face } from '../../../tokens/tokens.generated.ts';
import { plateGeometry, pointToLocal } from '../../Plate/geometry.ts';
import { Bead } from '../Bead.tsx';
import { beadEntrance, beadExit, beadMotion, beadPaint, hexLab } from '../beadModel.ts';

// The bead as drawn (F10 group A): views only, no Skia, no strings, no elevation (R1, R2, R9). It is purely
// visual: never a touch target and never an accessibility node (PlateTouch owns both, so the latest bead's
// 48 dp target and its Remove action live there). It enters on motion.placement and leaves from where it is;
// the views hand the model's own curve to the native driver, and the model is pinned in beadModel.test.ts.

jest.useFakeTimers();
afterAll(() => jest.useRealTimers());

const ABYSS = DIRECTIONS.abyss;
const PLATE = plateGeometry({ base: BASE, direction: ABYSS }, 296, 1);
/** The bead's measures: its radius is the plate's, its setting ring the direction's. */
const g = { bead: PLATE.beadRadius, setting: ABYSS.bead.setting.width };
const POINT = { x: -0.4, y: 0.5 };
const CHECK: RedBand = { hueFrom: BASE.neverRed.check.hueStart, hueTo: BASE.neverRed.check.hueEnd, chromaFloor: BASE.neverRed.check.chromaFloor };

interface Options {
  readonly face?: Face;
  readonly tier?: MotionTier;
  readonly leaving?: boolean;
  readonly initial?: boolean;
  readonly onLeft?: () => void;
  readonly point?: { x: number; y: number };
}
const element = (o: Options = {}) => (
  <DirectionProvider direction="abyss" face={o.face ?? 'dark'}>
    <Bead point={o.point ?? POINT} plate={PLATE} tier={o.tier ?? 'full'} leaving={o.leaving ?? false} initial={o.initial ?? false} onLeft={o.onLeft ?? jest.fn()} />
  </DirectionProvider>
);
function mount(o: Options = {}) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(element(o));
  });
  return tree;
}
const host = (tree: ReactTestRenderer.ReactTestRenderer, testID: string) => tree.root.findAll((n) => n.props.testID === testID && typeof n.type === 'string')[0];
const composite = (tree: ReactTestRenderer.ReactTestRenderer, testID: string) => tree.root.findAll((n) => n.props.testID === testID && typeof n.type !== 'string')[0];
const flat = (style: unknown) => (StyleSheet.flatten(style as never) ?? {}) as Record<string, any>;
const valueOf = (v: any): number => (typeof v === 'number' ? v : v.__getValue());
const scaleOf = (style: Record<string, any>) => valueOf((style.transform as Array<Record<string, any>>).find((t) => 'scale' in t)!.scale);

let timing: jest.SpyInstance;
beforeEach(() => {
  timing = jest.spyOn(Animated, 'timing');
});
afterEach(() => {
  timing.mockRestore();
  jest.clearAllTimers();
});

describe('Bead: where it sits and what it paints', () => {
  it('a box of the disc plus its setting ring, centred on the plate’s point (pointToLocal: the halo’s centre), placed by left and top', () => {
    const tree = mount();
    const c = pointToLocal(POINT, PLATE);
    const style = flat(host(tree, 'bead').props.style);
    const box = 2 * (g.bead + g.setting);
    expect(style).toMatchObject({ position: 'absolute', left: c.x - g.bead - g.setting, top: c.y - g.bead - g.setting, width: box, height: box });
    expect(style.right).toBeUndefined();
    expect(style.start).toBeUndefined();
  });

  it('the disc is the DSN-017 fill with the highlight’s radial gradient and the token shadow; the ring is the setting, outside the disc', () => {
    for (const face of ['dark', 'light'] as const) {
      const tree = mount({ face });
      const paint = beadPaint('abyss', face, POINT);
      const disc = flat(host(tree, 'bead.disc').props.style);
      expect(disc).toMatchObject({ position: 'absolute', left: g.setting, top: g.setting, width: 2 * g.bead, height: 2 * g.bead, borderRadius: g.bead, backgroundColor: paint.fill });
      expect(disc.boxShadow).toEqual([{ offsetX: 0, offsetY: ABYSS.bead.shadow.offsetY, blurRadius: ABYSS.bead.shadow.blur, color: paint.shadow }]);
      const radius = ABYSS.bead.highlight.radius * g.bead;
      expect(disc.experimental_backgroundImage).toEqual([
        {
          type: 'radial-gradient',
          shape: 'ellipse',
          size: { x: radius, y: radius },
          position: { left: g.bead * (1 + ABYSS.bead.highlight.offsetX), top: g.bead * (1 + ABYSS.bead.highlight.offsetY) },
          colorStops: [{ color: paint.highlight, positions: ['0%'] }, { color: paint.fill, positions: ['100%'] }],
        },
      ]);
      const ring = flat(host(tree, 'bead.setting').props.style);
      const box = 2 * (g.bead + g.setting);
      expect(ring).toMatchObject({ position: 'absolute', left: 0, top: 0, width: box, height: box, borderRadius: g.bead + g.setting, borderWidth: ABYSS.bead.setting.width, borderColor: ABYSS.color[face].bead.setting.hex });
      expect(ring.backgroundColor).toBeUndefined();
      act(() => tree.unmount());
    }
  });

  it('is never a touch target and never an accessibility node', () => {
    const tree = mount();
    const root = host(tree, 'bead');
    expect(root.props.pointerEvents).toBe('none');
    expect(root.props.accessible).toBe(false);
    expect(root.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(root.props.accessibilityElementsHidden).toBe(true);
    expect(tree.root.findAll((n) => typeof n.type === 'string' && (n.props.accessibilityLabel !== undefined || n.props.accessibilityRole !== undefined))).toEqual([]);
  });

  it('has no elevation and paints nothing red (R4, R9)', () => {
    const tree = mount({ point: { x: 0.9, y: 0.1 } });
    const colours: string[] = [];
    for (const n of tree.root.findAll((x) => typeof x.type === 'string')) {
      const s = flat(n.props.style);
      expect(s.elevation).toBeUndefined();
      for (const key of ['backgroundColor', 'borderColor']) if (typeof s[key] === 'string') colours.push(s[key]);
      for (const layer of s.boxShadow ?? []) colours.push(layer.color);
      for (const image of s.experimental_backgroundImage ?? []) for (const stop of image.colorStops) colours.push(stop.color);
    }
    expect(colours.length).toBeGreaterThanOrEqual(5);
    for (const c of colours) expect(isRed(hexLab(c.slice(0, 7)), CHECK)).toBe(false);
  });
});

describe('Bead: the entrance', () => {
  it('starts once at mount: the eased value to 1 over the placement token, on its curve, on the native driver', () => {
    mount();
    expect(timing).toHaveBeenCalledTimes(1);
    const [, config] = timing.mock.calls[0];
    const m = beadMotion('abyss', 'full');
    expect(config).toMatchObject({ toValue: 1, duration: m.duration, useNativeDriver: true });
    for (const x of [0.05, 0.25, 0.5, 0.75, 0.95]) expect(config.easing(x)).toBeCloseTo(beadEntrance('abyss', 'full', x * m.duration).opacity, 9);
  });

  it('maps the eased value to the model’s look: opacity e, scale scaleFrom + (1 − scaleFrom)·e', () => {
    const tree = mount();
    const [value] = timing.mock.calls[0];
    const m = beadMotion('abyss', 'full');
    for (const t of [0, 60, 150, 300, 600]) {
      const want = beadEntrance('abyss', 'full', t);
      act(() => value.setValue(want.opacity));
      const style = flat(composite(tree, 'bead').props.style);
      expect(valueOf(style.opacity)).toBeCloseTo(want.opacity, 9);
      expect(scaleOf(style)).toBeCloseTo(want.scale, 9);
    }
    expect(m.scaleFrom).toBe(ABYSS.motion.placement.scaleFrom);
  });

  it('battery saver (low) plays the same entrance as full', () => {
    mount({ tier: 'low' });
    const [, config] = timing.mock.calls[0];
    expect(config.duration).toBe(beadMotion('abyss', 'full').duration);
    expect(config.easing(0.5)).toBeCloseTo(beadEntrance('abyss', 'full', beadMotion('abyss', 'full').duration / 2).opacity, 9);
  });

  it('reduced motion (still): a linear fade over motion.fadeReduced, and the scale is never animated', () => {
    const tree = mount({ tier: 'still' });
    const [value, config] = timing.mock.calls[0];
    expect(config).toMatchObject({ toValue: 1, duration: BASE.motion.fadeReduced.duration, useNativeDriver: true });
    for (const x of [0.1, 0.5, 0.9]) expect(config.easing(x)).toBeCloseTo(x, 12);
    act(() => value.setValue(0.4));
    const style = flat(composite(tree, 'bead').props.style);
    expect(valueOf(style.opacity)).toBeCloseTo(0.4, 12);
    expect((style.transform as Array<Record<string, unknown>>).find((t) => 'scale' in t)!.scale).toBe(1);
  });

  it('a bead shown at the mount (initial: a restore, or the page’s first frame) has no entrance', () => {
    const tree = mount({ initial: true });
    expect(timing).not.toHaveBeenCalled();
    const style = flat(composite(tree, 'bead').props.style);
    expect(valueOf(style.opacity)).toBe(1);
    expect(scaleOf(style)).toBe(1);
  });
});

describe('Bead: the exit', () => {
  it('leaves from where it is: a linear fade to 0 over the entrance’s duration, the scale held', () => {
    const tree = mount();
    act(() => {
      jest.advanceTimersByTime(150);
    });
    const from = beadEntrance('abyss', 'full', 150);
    expect(from.opacity).toBeGreaterThan(0.5);
    expect(from.opacity).toBeLessThan(1);
    act(() => tree.update(element({ leaving: true })));
    expect(timing).toHaveBeenCalledTimes(2);
    const [exit, config] = timing.mock.calls[1];
    expect(config).toMatchObject({ toValue: 1, duration: beadMotion('abyss', 'full').duration, useNativeDriver: true });
    expect(config.easing(0.3)).toBeCloseTo(0.3, 12);
    // setValue stops a running animation, so the curve is read here and the end is checked on its own below.
    for (const u of [0, 0.25, 0.5, 1]) {
      act(() => exit.setValue(u));
      const style = flat(composite(tree, 'bead').props.style);
      const want = beadExit('abyss', 'full', from, u * beadMotion('abyss', 'full').duration);
      expect(valueOf(style.opacity)).toBeCloseTo(want.opacity, 6);
      expect(scaleOf(style)).toBeCloseTo(from.scale, 6);
    }
  });

  it('reports onLeft once, when the exit ends, and never at the entrance’s end', () => {
    const onLeft = jest.fn();
    const tree = mount({ onLeft });
    act(() => {
      jest.advanceTimersByTime(BASE.motion.settle.duration + 50);
    });
    expect(onLeft).not.toHaveBeenCalled();
    act(() => tree.update(element({ onLeft, leaving: true })));
    expect(onLeft).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(BASE.motion.settle.duration + 50);
    });
    expect(onLeft).toHaveBeenCalledTimes(1);
    act(() => tree.update(element({ onLeft, leaving: true })));
    act(() => {
      jest.advanceTimersByTime(BASE.motion.settle.duration + 50);
    });
    expect(onLeft).toHaveBeenCalledTimes(1);
  });

  it('under reduced motion the exit is the 150 ms linear fade', () => {
    const tree = mount({ tier: 'still', initial: true });
    act(() => tree.update(element({ tier: 'still', initial: true, leaving: true })));
    const [, config] = timing.mock.calls[0];
    expect(config.duration).toBe(BASE.motion.fadeReduced.duration);
    expect(config.easing(0.6)).toBeCloseTo(0.6, 12);
  });

  it('an exit cut short by an unmount never reports onLeft', () => {
    const onLeft = jest.fn();
    const tree = mount({ onLeft, initial: true });
    act(() => tree.update(element({ onLeft, initial: true, leaving: true })));
    act(() => tree.unmount());
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(onLeft).not.toHaveBeenCalled();
  });
});

describe('Bead: RTL and font scale', () => {
  it('draws the same under RTL as under LTR: its place is physical (the plate is LTR, R7)', () => {
    const ltr = mount().toJSON();
    const rtl = jest.replaceProperty(I18nManager, 'isRTL', true);
    const flipped = mount().toJSON();
    rtl.restore();
    expect(flipped).toEqual(ltr);
  });

  it('draws the same at font scale 2.0: nothing in the bead scales with text', () => {
    const plain = mount().toJSON();
    const spy = jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(2);
    const large = mount().toJSON();
    spy.mockRestore();
    expect(large).toEqual(plain);
  });
});
