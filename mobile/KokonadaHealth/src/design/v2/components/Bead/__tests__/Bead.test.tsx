import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { I18nManager, PixelRatio, StyleSheet } from 'react-native';
import { isRed, type RedBand } from '../../../color/redBand.ts';
import { DirectionProvider } from '../../../tokens/DirectionProvider.tsx';
import { EXTENSIONS } from '../../../tokens/tokens.extensions.generated.ts';
import { BASE, DIRECTIONS, type Face } from '../../../tokens/tokens.generated.ts';
import { plateGeometry, pointToLocal } from '../../Plate/geometry.ts';
import { Bead } from '../Bead.tsx';
import { driverStep, entranceEnd, type BeadLooks, type BeadPlay, type BeadRuns } from '../beadDriver.ts';
import { beadEntrance, beadExit, beadMotion, beadPaint, beadTwinPaint, hexLab } from '../beadModel.ts';
import { exitDuration, playMs } from '../beadTimeline.ts';

// The bead as drawn (F10 group A): views only, no Skia, no strings, no elevation (R1, R2, R9). It is purely
// visual: never a touch target and never an accessibility node (PlateTouch owns both, so the latest bead's
// 48 dp target and its Remove action live there).
//
// F1 (P0, the designer's rulings of 2026-11-25): a bead is never translucent in colour over the field. It is two
// discs under its setting ring: the grey disc, its achromatic twin (the fill at its own OKLab L with chroma 0, the
// highlight drawn from it, the token shadow), and over it the colour disc (the DSN-017 fill and its highlight), whose
// opacity is above 0 only while the bead's opacity is 1. As amended on 2026-11-26 (UI-320): every channel of the look is
// computed off the JS thread from one clock per bead and written in the same frame (beadDriver.ts); the bead reads its
// own look from the driver's shared value, live, with no render, and its colour disc can never land a frame ahead.

jest.mock('react-native-reanimated', () => require('./__fixtures__/uiThread').uiThreadMock());

const ABYSS = DIRECTIONS.abyss;
const PLATE = plateGeometry({ base: BASE, direction: ABYSS }, 296, 1);
/** The bead's measures: its radius is the plate's, its setting ring the direction's. */
const g = { bead: PLATE.beadRadius, setting: ABYSS.bead.setting.width };
const POINT = { x: -0.4, y: 0.5 };
const CHECK: RedBand = { hueFrom: BASE.neverRed.check.hueStart, hueTo: BASE.neverRed.check.hueEnd, chromaFloor: BASE.neverRed.check.chromaFloor };
const MOTION = beadMotion('abyss', 'full');
/** The entrance's clock runs to the later of the timeline's end and the scale's. */
const ENTRANCE_END = entranceEnd(MOTION);
/** The looks a test's bead reads: the driver's shared value, which the test writes as the UI thread would. */
const shared = (value: BeadLooks = {}) => ({ value }) as { value: BeadLooks };

interface Options {
  readonly face?: Face;
  /** Placed with an entrance (the presence's placedAt is not null). */
  readonly entered?: boolean;
  readonly looks?: { value: BeadLooks };
  readonly point?: { x: number; y: number };
  readonly slot?: number | 'leaving';
}
const element = (o: Options = {}) => (
  <DirectionProvider direction="abyss" face={o.face ?? 'dark'}>
    <Bead id={0} point={o.point ?? POINT} plate={PLATE} entered={o.entered ?? false} looks={(o.looks ?? shared()) as never} slot={o.slot ?? 0} />
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
const flat = (style: unknown) => (StyleSheet.flatten(style as never) ?? {}) as Record<string, any>;
const scaleOf = (style: Record<string, any>) => (style.transform as Array<Record<string, any>>).find((t) => 'scale' in t)!.scale as number;
/** The look as drawn now, with no render: the bead's opacity, its colour disc's opacity, its scale. */
const drawnLook = (tree: ReactTestRenderer.ReactTestRenderer, slot: number | 'leaving' = 0) => {
  const root = flat(host(tree, 'hero.plate.bead.' + slot).props.style);
  return { opacity: root.opacity as number, colour: flat(host(tree, 'bead.colour').props.style).opacity as number, scale: scaleOf(root) };
};
const grey = (hex: string) => hex.slice(1, 3) === hex.slice(3, 5) && hex.slice(3, 5) === hex.slice(5, 7);

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
      const ids = heroIds(mount({ slot }));
      expect(ids).toEqual([`hero.plate.bead.${slot}`, `hero.plate.bead.${slot}.setting`]);
      for (const id of ids) expect([id, elements.includes(id)]).toEqual([id, true]);
    }
  });

  it('a leaving bead is hero.plate.bead.leaving, in the ledger’s list; its ring claims no hero ID', () => {
    const tree = mount({ slot: 'leaving' });
    expect(heroIds(tree)).toEqual(['hero.plate.bead.leaving']);
    expect(elements.includes('hero.plate.bead.leaving')).toBe(true);
    expect(host(tree, 'bead.setting')).toBeDefined();
  });
});

/** A UI thread for one bead: the driver's own step, its looks written into the shared value the bead reads. */
function driven(looks: { value: BeadLooks }) {
  let runs: BeadRuns = {};
  const gone: number[] = [];
  return {
    frame(play: BeadPlay, timestamp: number) {
      const out = driverStep([play], runs, looks.value, timestamp, { motion: MOTION, timeScale: 1 });
      runs = out.runs;
      looks.value = out.looks;
      gone.push(...out.gone);
    },
    gone,
  };
}
const ENTER: BeadPlay = { id: 0, leaving: false, entered: true, late: 0 };

describe('Bead: it draws the look the driver wrote, in the frame it was written', () => {
  it('reads its own look by its id, live: opacity, colour disc and scale change with the shared value and with no render', () => {
    const looks = shared({ 0: { opacity: 0.4, colour: 0, scale: 0.8, start: null, before: null }, 1: { opacity: 1, colour: 1, scale: 1, start: null, before: null } });
    const tree = mount({ entered: true, looks });
    expect(drawnLook(tree)).toEqual({ opacity: 0.4, colour: 0, scale: 0.8 });
    looks.value = { 0: { opacity: 1, colour: 0.25, scale: 0.97, start: null, before: null } };
    expect(drawnLook(tree)).toEqual({ opacity: 1, colour: 0.25, scale: 0.97 });
  });

  it('a bead with no entrance (the mount, a restore, or the still tier) and no look is whole from its first frame', () => {
    expect(drawnLook(mount({ entered: false }))).toEqual({ opacity: 1, colour: 1, scale: 1 });
  });

  it('a bead placed with an entrance is not drawn until its first look: opacity 0, no colour, at the entrance’s first scale; never whole in its first frame', () => {
    const looks = shared();
    const tree = mount({ entered: true, looks });
    expect(drawnLook(tree)).toEqual({ opacity: 0, colour: 0, scale: MOTION.scaleFrom });
    driven(looks).frame(ENTER, 5000);
    expect(drawnLook(tree)).toEqual({ opacity: 0, colour: 0, scale: MOTION.scaleFrom });
  });

  it('a leaving bead with no look yet stays as it was: whole when it never had an entrance', () => {
    expect(drawnLook(mount({ entered: false, slot: 'leaving' }), 'leaving')).toEqual({ opacity: 1, colour: 1, scale: 1 });
  });
});

describe('Bead: the entrance (F1)', () => {
  it('draws the model’s look at every half millisecond of the driver’s clock: opacity, colour and scale, exactly', () => {
    const looks = shared();
    const tree = mount({ entered: true, looks });
    const ui = driven(looks);
    for (let t = 0; t <= ENTRANCE_END + 5; t += 0.5) {
      ui.frame(ENTER, 1000 + t);
      expect([t, drawnLook(tree)]).toEqual([t, beadEntrance('abyss', 'full', t)]);
    }
  });

  it('never colour while translucent: at every 0.25 ms of the clock, the colour disc is above 0 only where the bead is opaque', () => {
    const looks = shared();
    const tree = mount({ entered: true, looks });
    const ui = driven(looks);
    let coloured = 0;
    for (let t = 0; t <= ENTRANCE_END; t += 0.25) {
      ui.frame(ENTER, 1000 + t);
      const drawn = drawnLook(tree);
      if (drawn.colour > 0) {
        coloured++;
        if (drawn.opacity !== 1) expect([t, drawn]).toEqual([t, { ...drawn, opacity: 1 }]);
      }
    }
    expect(coloured).toBeGreaterThan(1000);
  });

  it('an entrance dispatched 430 ms late is drawn whole, compressed: translucent grey first, then its colour, never a bead already in colour', () => {
    const looks = shared();
    const tree = mount({ entered: true, looks });
    const ui = driven(looks);
    const seen: Array<{ opacity: number; colour: number }> = [];
    for (let ms = 0; ms <= 400; ms += 1000 / 60) {
      ui.frame({ ...ENTER, late: 430 }, 1000 + ms);
      seen.push(drawnLook(tree));
    }
    expect(seen[0]).toMatchObject({ opacity: 0, colour: 0 });
    expect(seen.filter((l) => l.opacity > 0 && l.opacity < 1 && l.colour === 0).length).toBeGreaterThanOrEqual(3);
    expect(seen[seen.length - 1]).toMatchObject({ opacity: 1, colour: 1 });
  });
});

describe('Bead: the exit (F1)', () => {
  const leave = (late: number): BeadPlay => ({ id: 0, leaving: true, entered: true, late });

  it('an opaque bead: the colour to 0 over press, then the opacity to 0 over respond, its scale held, from the look it had', () => {
    const looks = shared();
    const tree = mount({ entered: true, looks, slot: 'leaving' });
    const ui = driven(looks);
    ui.frame(ENTER, 0);
    ui.frame(ENTER, 300);
    const from = beadEntrance('abyss', 'full', 300);
    expect(from.opacity).toBe(1);
    expect(from.colour).toBeGreaterThan(0.5);
    expect(from.colour).toBeLessThan(1);
    for (let t = 0; t <= exitDuration(1) + 5; t += 0.5) {
      ui.frame(leave(0), 2000 + t);
      const drawn = drawnLook(tree, 'leaving');
      const want = t < exitDuration(1) ? beadExit('abyss', 'full', from, t) : { opacity: 0, colour: 0, scale: from.scale };
      expect([t, drawn]).toEqual([t, want]);
      if (drawn.colour > 0 && drawn.opacity !== 1) expect([t, drawn]).toEqual([t, { ...drawn, opacity: 1 }]);
    }
    expect(ui.gone).toEqual([0]);
  });

  it('a bead caught translucent in its entrance shows no colour: its opacity fades at once, from where it is', () => {
    const looks = shared();
    const tree = mount({ entered: true, looks, slot: 'leaving' });
    const ui = driven(looks);
    ui.frame(ENTER, 0);
    ui.frame(ENTER, 40);
    const from = beadEntrance('abyss', 'full', 40);
    expect(from.opacity).toBeLessThan(1);
    for (const t of [0, 50, 175, 349]) {
      ui.frame(leave(0), 2000 + t);
      const drawn = drawnLook(tree, 'leaving');
      expect(drawn.colour).toBe(0);
      expect(drawn.opacity).toBe(beadExit('abyss', 'full', from, t).opacity);
      expect(drawn.scale).toBe(from.scale);
    }
  });

  // The d5479dc capture: the bead went whole to gone within one 147 ms frame gap. A late exit is compressed, never skipped.
  it.each([300, 600, 10_000])('an exit dispatched %p ms late still plays, from the bead as it is, over motion.respond: grey before it goes', (late) => {
    const looks = shared();
    const tree = mount({ entered: false, looks, slot: 'leaving' });
    const ui = driven(looks);
    const play = playMs(exitDuration(1), late);
    let translucent = 0;
    for (let ms = 0; ms <= play; ms += 16) {
      ui.frame({ id: 0, leaving: true, entered: false, late }, 9000 + ms);
      const drawn = drawnLook(tree, 'leaving');
      if (ms === 0) expect(drawn).toEqual({ opacity: 1, colour: 1, scale: 1 });
      if (drawn.colour > 0) expect([ms, drawn.opacity]).toEqual([ms, 1]);
      if (drawn.opacity > 0.05 && drawn.opacity < 0.95) translucent += 1;
    }
    expect(translucent).toBeGreaterThanOrEqual(6);
    ui.frame({ id: 0, leaving: true, entered: false, late }, 9000 + play);
    expect(drawnLook(tree, 'leaving').opacity).toBe(0);
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
