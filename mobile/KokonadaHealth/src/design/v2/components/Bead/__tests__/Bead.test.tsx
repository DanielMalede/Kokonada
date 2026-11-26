import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Animated, I18nManager, PixelRatio, StyleSheet } from 'react-native';
import { isRed, type RedBand } from '../../../color/redBand.ts';
import { DirectionProvider } from '../../../tokens/DirectionProvider.tsx';
import { EXTENSIONS } from '../../../tokens/tokens.extensions.generated.ts';
import { BASE, DIRECTIONS, type Face } from '../../../tokens/tokens.generated.ts';
import { plateGeometry, pointToLocal } from '../../Plate/geometry.ts';
import { Bead } from '../Bead.tsx';
import { beadEntrance, beadExit, beadMotion, beadPaint, beadTwinPaint, hexLab } from '../beadModel.ts';
import { EXIT_MIN_MS, exitDuration, PRESS_MS, RESPOND_MS } from '../beadTimeline.ts';

// The bead as drawn (F10 group A): views only, no Skia, no strings, no elevation (R1, R2, R9). It is purely
// visual: never a touch target and never an accessibility node (PlateTouch owns both, so the latest bead's
// 48 dp target and its Remove action live there).
//
// F1 (P0, the designer's rulings of 2026-11-25): a bead is never translucent in colour over the field. It is two
// discs under its setting ring: the grey disc, its achromatic twin (the fill at its own OKLab L with chroma 0, the
// highlight drawn from it, the token shadow), and over it the colour disc (the DSN-017 fill and its highlight), whose
// opacity is above 0 only while the bead's opacity is 1. Each phase is one clock on the native driver (ms since the
// presence's placedAt or leftAt), and every channel is an interpolation of it, sampled from the model, so the
// opacity, the colour and the scale can never part from each other or from beadModel.ts.

jest.useFakeTimers();
afterAll(() => jest.useRealTimers());

const ABYSS = DIRECTIONS.abyss;
const PLATE = plateGeometry({ base: BASE, direction: ABYSS }, 296, 1);
/** The bead's measures: its radius is the plate's, its setting ring the direction's. */
const g = { bead: PLATE.beadRadius, setting: ABYSS.bead.setting.width };
const POINT = { x: -0.4, y: 0.5 };
const CHECK: RedBand = { hueFrom: BASE.neverRed.check.hueStart, hueTo: BASE.neverRed.check.hueEnd, chromaFloor: BASE.neverRed.check.chromaFloor };
/** The entrance's clock runs to the later of the timeline's end and the scale's. */
const ENTRANCE_END = Math.max(PRESS_MS + RESPOND_MS, beadMotion('abyss', 'full').duration);

interface Options {
  readonly face?: Face;
  readonly placedAt?: number | null;
  readonly leftAt?: number | null;
  readonly onLeft?: () => void;
  readonly onExitStart?: (atMs: number, playMs: number) => void;
  readonly point?: { x: number; y: number };
  readonly slot?: number | 'leaving';
}
const element = (o: Options = {}) => (
  <DirectionProvider direction="abyss" face={o.face ?? 'dark'}>
    <Bead point={o.point ?? POINT} plate={PLATE} placedAt={o.placedAt === undefined ? performance.now() : o.placedAt} leftAt={o.leftAt ?? null} slot={o.slot ?? 0} onLeft={o.onLeft ?? jest.fn()} onExitStart={o.onExitStart ?? jest.fn()} />
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
/** The look as drawn: the bead's opacity, its colour disc's opacity, its scale. */
const drawnLook = (tree: ReactTestRenderer.ReactTestRenderer) => {
  const root = flat(composite(tree, 'hero.plate.bead.0').props.style);
  return { opacity: valueOf(root.opacity), colour: valueOf(flat(composite(tree, 'bead.colour').props.style).opacity), scale: scaleOf(root) };
};
const grey = (hex: string) => hex.slice(1, 3) === hex.slice(3, 5) && hex.slice(3, 5) === hex.slice(5, 7);

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
    const style = flat(host(tree, 'hero.plate.bead.0').props.style);
    const box = 2 * (g.bead + g.setting);
    expect(style).toMatchObject({ position: 'absolute', left: c.x - g.bead - g.setting, top: c.y - g.bead - g.setting, width: box, height: box });
    expect(style.right).toBeUndefined();
    expect(style.start).toBeUndefined();
  });

  it('F1: the grey disc is the twin (the fill at its own L, chroma 0, its highlight drawn from it) with the token shadow; the colour disc over it is the DSN-017 fill, the same circle, with no shadow', () => {
    for (const face of ['dark', 'light'] as const) {
      const tree = mount({ face });
      const colour = beadPaint('abyss', face, POINT);
      const twin = beadTwinPaint('abyss', face, POINT);
      const radius = ABYSS.bead.highlight.radius * g.bead;
      const gradient = (from: string, to: string) => [
        {
          type: 'radial-gradient',
          shape: 'ellipse',
          size: { x: radius, y: radius },
          position: { left: g.bead * (1 + ABYSS.bead.highlight.offsetX), top: g.bead * (1 + ABYSS.bead.highlight.offsetY) },
          colorStops: [{ color: from, positions: ['0%'] }, { color: to, positions: ['100%'] }],
        },
      ];
      const circle = { position: 'absolute', left: g.setting, top: g.setting, width: 2 * g.bead, height: 2 * g.bead, borderRadius: g.bead };
      const disc = flat(host(tree, 'bead.disc').props.style);
      expect(disc).toMatchObject({ ...circle, backgroundColor: twin.fill });
      expect(disc.boxShadow).toEqual([{ offsetX: 0, offsetY: ABYSS.bead.shadow.offsetY, blurRadius: ABYSS.bead.shadow.blur, color: colour.shadow }]);
      expect(disc.experimental_backgroundImage).toEqual(gradient(twin.highlight, twin.fill));
      expect([twin.fill, twin.highlight].every(grey)).toBe(true);
      const tint = flat(host(tree, 'bead.colour').props.style);
      expect(tint).toMatchObject({ ...circle, backgroundColor: colour.fill });
      expect(tint.experimental_backgroundImage).toEqual(gradient(colour.highlight, colour.fill));
      expect(tint.boxShadow).toBeUndefined();
      expect(host(tree, 'bead.colour').props.pointerEvents).toBe('none');
      const ring = flat(host(tree, 'hero.plate.bead.0.setting').props.style);
      const box = 2 * (g.bead + g.setting);
      expect(ring).toMatchObject({ position: 'absolute', left: 0, top: 0, width: box, height: box, borderRadius: g.bead + g.setting, borderWidth: ABYSS.bead.setting.width, borderColor: ABYSS.color[face].bead.setting.hex });
      expect(ring.backgroundColor).toBeUndefined();
      act(() => tree.unmount());
    }
  });

  it('draws the grey disc, then the colour disc, then the setting ring: the colour sits on its twin, under the ring', () => {
    const tree = mount();
    expect(host(tree, 'hero.plate.bead.0').children.map((c) => (typeof c === 'string' ? c : c.props.testID))).toEqual(['bead.disc', 'bead.colour', 'hero.plate.bead.0.setting']);
  });

  it('is never a touch target and never an accessibility node', () => {
    const tree = mount();
    const root = host(tree, 'hero.plate.bead.0');
    expect(root.props.pointerEvents).toBe('none');
    expect(root.props.accessible).toBe(false);
    expect(root.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(root.props.accessibilityElementsHidden).toBe(true);
    expect(tree.root.findAll((n) => typeof n.type === 'string' && (n.props.accessibilityLabel !== undefined || n.props.accessibilityRole !== undefined)).map((n) => n.props.testID)).toEqual([]);
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
    expect(colours.length).toBeGreaterThanOrEqual(8);
    for (const c of colours) expect(isRed(hexLab(c.slice(0, 7)), CHECK)).toBe(false);
  });
});

// F2 (P1, the designer's rulings of 2026-11-25): the hero's element IDs are the ledger's (EXTENSIONS hero.elements).
describe('Bead: its element IDs (F2)', () => {
  const heroIds = (tree: ReactTestRenderer.ReactTestRenderer) =>
    tree.root.findAll((n) => typeof n.type === 'string' && typeof n.props.testID === 'string' && n.props.testID.startsWith('hero.')).map((n) => n.props.testID as string);
  const elements = EXTENSIONS.base.$root.hero.elements as readonly string[];

  it('a live bead is hero.plate.bead.<slot> (0 to 2), with .setting on its ring, each in the ledger’s list', () => {
    for (const slot of [0, 1, 2]) {
      const ids = heroIds(mount({ slot, placedAt: null }));
      expect(ids).toEqual([`hero.plate.bead.${slot}`, `hero.plate.bead.${slot}.setting`]);
      for (const id of ids) expect([id, elements.includes(id)]).toEqual([id, true]);
    }
  });

  it('a leaving bead is hero.plate.bead.leaving, in the ledger’s list; its ring claims no hero ID', () => {
    const tree = mount({ slot: 'leaving', placedAt: null, leftAt: performance.now() });
    expect(heroIds(tree)).toEqual(['hero.plate.bead.leaving']);
    expect(elements.includes('hero.plate.bead.leaving')).toBe(true);
    expect(host(tree, 'bead.setting')).toBeDefined();
  });
});

describe('Bead: the entrance (F1)', () => {
  it('runs one clock on the native driver: linear, from where the entrance is to the later of the timeline’s end and the scale’s', () => {
    mount({ placedAt: performance.now() - 40 });
    expect(timing).toHaveBeenCalledTimes(1);
    const [clock, config] = timing.mock.calls[0];
    expect(config).toMatchObject({ toValue: ENTRANCE_END, duration: ENTRANCE_END - 40, useNativeDriver: true });
    for (const x of [0.1, 0.5, 0.9]) expect(config.easing(x)).toBeCloseTo(x, 12);
    expect(clock.__getValue()).toBe(40);
  });

  it('maps the clock to the model’s look: opacity, colour and scale within 0.001 of beadEntrance at every millisecond', () => {
    const tree = mount();
    const [clock] = timing.mock.calls[0];
    let worst = 0;
    for (let t = 0; t <= ENTRANCE_END + 5; t += 0.5) {
      clock.setValue(t);
      const drawn = drawnLook(tree);
      const want = beadEntrance('abyss', 'full', t);
      worst = Math.max(worst, Math.abs(drawn.opacity - want.opacity), Math.abs(drawn.colour - want.colour), Math.abs(drawn.scale - want.scale));
    }
    expect(worst).toBeLessThan(0.001);
  });

  it('never colour while translucent: at every 0.25 ms of the clock, the colour disc is above 0 only where the bead is opaque', () => {
    const tree = mount();
    const [clock] = timing.mock.calls[0];
    let coloured = 0;
    for (let t = 0; t <= ENTRANCE_END; t += 0.25) {
      clock.setValue(t);
      const drawn = drawnLook(tree);
      if (drawn.colour > 0) {
        coloured++;
        if (drawn.opacity !== 1) expect([t, drawn]).toEqual([t, { ...drawn, opacity: 1 }]);
      }
    }
    expect(coloured).toBeGreaterThan(1000);
  });

  it('a bead with no entrance (placedAt null: the mount, a restore, or the still tier) is whole from its first frame, with no clock', () => {
    const tree = mount({ placedAt: null });
    expect(timing).not.toHaveBeenCalled();
    expect(drawnLook(tree)).toEqual({ opacity: 1, colour: 1, scale: 1 });
  });

  it('an entrance already over when its effect runs starts no clock and is whole', () => {
    const tree = mount({ placedAt: performance.now() - 5000 });
    expect(timing).not.toHaveBeenCalled();
    expect(drawnLook(tree)).toEqual({ opacity: 1, colour: 1, scale: 1 });
  });
});

describe('Bead: the exit (F1)', () => {
  it('an opaque bead: the colour to 0 over press, then the opacity to 0 over respond, its scale held, on one native clock from leftAt', () => {
    const placedAt = performance.now();
    const tree = mount({ placedAt });
    act(() => {
      jest.advanceTimersByTime(300);
    });
    const from = beadEntrance('abyss', 'full', 300);
    expect(from.opacity).toBe(1);
    expect(from.colour).toBeGreaterThan(0.5);
    expect(from.colour).toBeLessThan(1);
    act(() => tree.update(element({ placedAt, leftAt: performance.now() })));
    expect(timing).toHaveBeenCalledTimes(2);
    const [clock, config] = timing.mock.calls[1];
    expect(config).toMatchObject({ toValue: exitDuration(1), duration: exitDuration(1), useNativeDriver: true });
    expect(config.easing(0.3)).toBeCloseTo(0.3, 12);
    let worst = 0;
    for (let t = 0; t <= exitDuration(1) + 5; t += 0.5) {
      clock.setValue(t);
      const drawn = drawnLook(tree);
      const want = beadExit('abyss', 'full', from, t);
      worst = Math.max(worst, Math.abs(drawn.opacity - want.opacity), Math.abs(drawn.colour - want.colour));
      expect(drawn.scale).toBe(from.scale);
      if (drawn.colour > 0 && drawn.opacity !== 1) expect([t, drawn]).toEqual([t, { ...drawn, opacity: 1 }]);
    }
    expect(worst).toBeLessThan(0.001);
  });

  it('a bead caught translucent in its entrance shows no colour: its opacity fades at once, from where it is', () => {
    const placedAt = performance.now();
    const tree = mount({ placedAt });
    act(() => {
      jest.advanceTimersByTime(40);
    });
    const from = beadEntrance('abyss', 'full', 40);
    expect(from.opacity).toBeLessThan(1);
    act(() => tree.update(element({ placedAt, leftAt: performance.now() })));
    const [clock, config] = timing.mock.calls[1];
    expect(config.toValue).toBe(exitDuration(from.opacity));
    for (const t of [0, 50, 175, 349]) {
      clock.setValue(t);
      const drawn = drawnLook(tree);
      expect(drawn.colour).toBe(0);
      expect(drawn.opacity).toBeCloseTo(beadExit('abyss', 'full', from, t).opacity, 3);
      expect(drawn.scale).toBe(from.scale);
    }
  });

  it('reports onLeft once, when the exit ends, and never at the entrance’s end', () => {
    const onLeft = jest.fn();
    const placedAt = performance.now();
    const tree = mount({ onLeft, placedAt });
    act(() => {
      jest.advanceTimersByTime(ENTRANCE_END + 50);
    });
    expect(onLeft).not.toHaveBeenCalled();
    const leftAt = performance.now();
    act(() => tree.update(element({ onLeft, placedAt, leftAt })));
    expect(onLeft).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(exitDuration(1) + 50);
    });
    expect(onLeft).toHaveBeenCalledTimes(1);
    act(() => tree.update(element({ onLeft, placedAt, leftAt })));
    act(() => {
      jest.advanceTimersByTime(exitDuration(1) + 50);
    });
    expect(onLeft).toHaveBeenCalledTimes(1);
  });

  it('a late exit’s first painted frame, before its effect runs, is the bead as it was at leftAt: never gone', () => {
    // The frame React paints before the passive effect runs is the clock's value when it is made: record it.
    const Real = Animated.Value;
    const made: number[] = [];
    const spy = jest.spyOn(Animated, 'Value').mockImplementation(function made_(value: number, config?: object) {
      made.push(value);
      return new Real(value, config as never);
    } as never);
    try {
      mount({ placedAt: null, leftAt: performance.now() - 10_000, slot: 0 });
    } finally {
      spy.mockRestore();
    }
    expect(made).toEqual([0]);
  });

  it('an exit whose effect runs a little late plays its whole timeline from where the bead is, over what is left of it', () => {
    const onLeft = jest.fn();
    const leftAt = performance.now() - 60;
    const tree = mount({ placedAt: null, leftAt, onLeft, slot: 0 });
    const [clock, config] = timing.mock.calls[0];
    expect(clock.__getValue()).toBe(0);
    expect(drawnLook(tree)).toEqual({ opacity: 1, colour: 1, scale: 1 });
    expect(config).toMatchObject({ toValue: exitDuration(1), duration: exitDuration(1) - 60, useNativeDriver: true });
    expect(onLeft).not.toHaveBeenCalled();
  });

  // The d5479dc capture: the bead went whole to gone within one 147 ms frame gap, because an effect that ran more than the
  // exit's 450 ms after leftAt (a loaded JS thread) set the clock to its end. A late exit is compressed, never skipped.
  it.each([300, 600, 10_000])('an exit whose effect runs %p ms late still plays, from the bead as it is, over EXIT_MIN_MS: grey before it goes, then onLeft', (late) => {
    const onLeft = jest.fn();
    const tree = mount({ placedAt: null, leftAt: performance.now() - late, onLeft, slot: 0 });
    expect(onLeft).not.toHaveBeenCalled();
    expect(timing).toHaveBeenCalledTimes(1);
    const [clock, config] = timing.mock.calls[0];
    expect(clock.__getValue()).toBe(0);
    expect(drawnLook(tree)).toEqual({ opacity: 1, colour: 1, scale: 1 });
    expect(config).toMatchObject({ toValue: exitDuration(1), duration: EXIT_MIN_MS, useNativeDriver: true });
    expect(config.easing(0.3)).toBeCloseTo(0.3, 12);
    // The native driver plays the clock linearly on the UI thread (jest never sees its frames: the device recording is the
    // proof). At each 16 ms frame of EXIT_MIN_MS the clock stands at end × (frame time ÷ duration): never colour while
    // translucent, and the grey, translucent bead on screen for frames on end.
    act(() => {
      jest.advanceTimersByTime(EXIT_MIN_MS + 50);
    });
    expect(onLeft).toHaveBeenCalledTimes(1);
    let translucent = 0;
    for (let ms = 0; ms <= EXIT_MIN_MS; ms += 16) {
      clock.setValue((exitDuration(1) * ms) / EXIT_MIN_MS);
      const drawn = drawnLook(tree);
      if (drawn.colour > 0) expect([ms, drawn.opacity]).toEqual([ms, 1]);
      if (drawn.opacity > 0.05 && drawn.opacity < 0.95) translucent += 1;
    }
    expect(translucent).toBeGreaterThanOrEqual(6);
    clock.setValue(exitDuration(1));
    expect(drawnLook(tree).opacity).toBe(0);
    // F1 holds under the compression at every 0.5 ms of the clock: the colour is 0 before the opacity leaves 1.
    for (let t = 0; t <= exitDuration(1); t += 0.5) {
      clock.setValue(t);
      const drawn = drawnLook(tree);
      if (drawn.colour > 0) expect([t, drawn.opacity]).toEqual([t, 1]);
    }
  });

  // 27f2bee's capture: the native driver started the exit's clock 240 to 300 ms after Bead's effect (its op queue flushed
  // behind a re-render), so the effect's time is not when the exit starts. Bead reads it off the clock itself.
  it('reports onExitStart once, off the exit clock’s first moving value: when it started and how long it plays; never at the effect, never for an entrance', () => {
    const onExitStart = jest.fn();
    const placedAt = performance.now();
    const tree = mount({ placedAt, onExitStart });
    act(() => {
      jest.advanceTimersByTime(ENTRANCE_END + 50);
    });
    expect(onExitStart).not.toHaveBeenCalled();
    const leftAt = performance.now() - 300;
    act(() => tree.update(element({ placedAt, leftAt, onExitStart })));
    const [clock, config] = timing.mock.calls[timing.mock.calls.length - 1];
    expect(config.duration).toBe(EXIT_MIN_MS);
    // Not at the effect, and not on a value that is not moving.
    expect(onExitStart).not.toHaveBeenCalled();
    act(() => clock.setValue(0));
    expect(onExitStart).not.toHaveBeenCalled();
    // The native clock started 200 ms later; its first value reaches JS 40 ms after that.
    act(() => {
      jest.advanceTimersByTime(240);
    });
    const v = (exitDuration(1) * 40) / EXIT_MIN_MS;
    act(() => clock.setValue(v));
    expect(onExitStart.mock.calls).toEqual([[performance.now() - 40, EXIT_MIN_MS]]);
    act(() => clock.setValue(2 * v));
    act(() => tree.update(element({ placedAt, leftAt, onExitStart: jest.fn() })));
    expect(onExitStart).toHaveBeenCalledTimes(1);
  });

  it('an exit cut short before its clock moved stops listening: no report after the unmount', () => {
    const onExitStart = jest.fn();
    const tree = mount({ placedAt: null, leftAt: performance.now(), slot: 'leaving', onExitStart });
    const [clock] = timing.mock.calls[timing.mock.calls.length - 1];
    act(() => tree.unmount());
    clock.setValue(10);
    expect(onExitStart).not.toHaveBeenCalled();
  });

  it('an exit cut short by an unmount never reports onLeft', () => {
    const onLeft = jest.fn();
    const tree = mount({ onLeft, placedAt: null });
    act(() => tree.update(element({ onLeft, placedAt: null, leftAt: performance.now() })));
    act(() => tree.unmount());
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(onLeft).not.toHaveBeenCalled();
  });
});

describe('Bead: RTL and font scale', () => {
  it('draws the same under RTL as under LTR: its place is physical (the plate is LTR, R7)', () => {
    const ltr = mount({ placedAt: null }).toJSON();
    const rtl = jest.replaceProperty(I18nManager, 'isRTL', true);
    const flipped = mount({ placedAt: null }).toJSON();
    rtl.restore();
    expect(flipped).toEqual(ltr);
  });

  it('draws the same at font scale 2.0: nothing in the bead scales with text', () => {
    const plain = mount({ placedAt: null }).toJSON();
    const spy = jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(2);
    const large = mount({ placedAt: null }).toJSON();
    spy.mockRestore();
    expect(large).toEqual(plain);
  });
});
