import React from 'react';
import { I18nManager, StyleSheet } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { DirectionProvider } from '../../../tokens/DirectionProvider.tsx';
import { BASE, DIRECTIONS, type Face } from '../../../tokens/tokens.generated.ts';
import { plateGeometry, type PlatePoint } from '../../Plate/geometry.ts';
import { plateSlot, rimWordSlot } from '../../Plate/readingOrder.ts';
import { RIM_POSITIONS, layRimWord, returningGroups, visualOrder, type RimBead, type RimPosition } from '../arc.ts';
import { RimLabels, type RimLabelsProps, type RimWords } from '../RimLabels.tsx';
import { BUNDLED_FACES } from '../../../typeface/faces.ts';
import { TypefaceProvider } from '../../../typeface/TypefaceProvider.tsx';
import type { FaceSources } from '../../../typeface/typefaces.ts';

// A stateful fake of the part of Skia the rim words draw with. Its font measures as Heebo does by the designer's budget
// basis (LEDGER rev §11: 0.50 em a Latin letter, 0.56 em a Hebrew one), with a fixed ascent and descent; its recorder keeps
// every text blob drawn and every dispose. Group renders its children and keeps its props (a returning layer's opacity, a
// shared value the UI thread sets). The layout's truth is arc.test.ts's; here, the component's wiring.
jest.mock('@shopify/react-native-skia', () => {
  const fake = {
    fonts: [] as Array<{ style: Record<string, unknown>; mgr: unknown; disposed: number }>,
    recordings: [] as Array<{ blobs: Array<{ ids: number[]; xforms: number[][]; colour: unknown; antiAlias: unknown }>; bounds: unknown; disposed: number }>,
    managers: [] as Array<{ families: string[]; disposed: number }>,
  };
  const Stub = ({ children }: { children?: unknown }) => children ?? null;
  const Group = ({ children }: { children?: unknown }) => children ?? null;
  const matchFont = (style: Record<string, unknown>, mgr?: unknown) => {
    const size = style.fontSize as number;
    const record = { style, mgr, disposed: 0 };
    fake.fonts.push(record);
    return {
      getSize: () => size,
      getMetrics: () => ({ ascent: -0.93 * size, descent: 0.24 * size, leading: 0 }),
      getGlyphIDs: (s: string) => Array.from(s).map((c) => c.codePointAt(0)!),
      getGlyphWidths: (ids: number[]) => ids.map((id) => (id >= 0x0590 && id <= 0x05ff ? 0.56 : 0.5) * size),
      dispose: () => { record.disposed += 1; },
    };
  };
  const Skia = {
    // The typeface provider's factories (typeface/typefaces.ts): a typeface from the bytes read, and a manager that keeps
    // each typeface under its family.
    Typeface: { MakeFreeTypeFaceFromData: (data: unknown) => ({ data, dispose() {} }) },
    TypefaceFontProvider: {
      Make: () => {
        const mgr = { families: [] as string[], disposed: 0, registerFont: (_t: unknown, family: string) => { mgr.families.push(family); }, dispose: () => { mgr.disposed += 1; } };
        fake.managers.push(mgr);
        return mgr;
      },
    },
    Paint: () => {
      const state: Record<string, unknown> = {};
      return { state, setAntiAlias: (v: unknown) => { state.antiAlias = v; }, setColor: (v: unknown) => { state.colour = v; }, dispose() {} };
    },
    Color: (hex: string) => `colour:${hex}`,
    XYWHRect: (x: number, y: number, width: number, height: number) => ({ x, y, width, height }),
    RSXform: (scos: number, ssin: number, tx: number, ty: number) => ({ xform: [scos, ssin, tx, ty], dispose() {} }),
    TextBlob: { MakeFromRSXformGlyphs: (ids: number[], xforms: Array<{ xform: number[] }>) => ({ ids, xforms: xforms.map((x) => x.xform), dispose() {} }) },
    PictureRecorder: () => {
      let current: (typeof fake.recordings)[number] | null = null;
      return {
        beginRecording: (bounds: unknown) => {
          const recording = { blobs: [] as (typeof fake.recordings)[number]['blobs'], bounds, disposed: 0 };
          current = recording;
          return {
            drawTextBlob: (blob: { ids: number[]; xforms: number[][] }, _x: number, _y: number, paint: { state: Record<string, unknown> }) =>
              recording.blobs.push({ ids: blob.ids, xforms: blob.xforms, colour: paint.state.colour, antiAlias: paint.state.antiAlias }),
          };
        },
        finishRecordingAsPicture: () => {
          const recording = current!;
          fake.recordings.push(recording);
          return { recording, dispose: () => { recording.disposed += 1; } };
        },
        dispose() {},
      };
    },
  };
  return { Canvas: Stub, Group, Paint: () => null, Picture: () => null, Skia, matchFont, __fake: fake };
});

// The UI thread: the stateful fake the beads' driver is tested on (Bead/__tests__/__fixtures__/uiThread.ts). A derived
// value is read live, so a returning layer's opacity is what the UI thread would draw from the looks as they are, with
// no React render in between.
jest.mock('react-native-reanimated', () => require('../../Bead/__tests__/__fixtures__/uiThread').uiThreadMock());

const fake = () => jest.requireMock('@shopify/react-native-skia').__fake as {
  fonts: Array<{ style: Record<string, unknown>; mgr: unknown; disposed: number }>;
  recordings: Array<{ blobs: Array<{ ids: number[]; xforms: number[][]; colour: unknown; antiAlias: unknown }>; bounds: { width: number; height: number }; disposed: number }>;
  managers: Array<{ families: string[]; disposed: number }>;
};
const skia = () => jest.requireMock('@shopify/react-native-skia') as { Group: unknown; Paint: unknown; Picture: unknown };
const reanimated = jest.requireMock('react-native-reanimated') as Record<string, (...args: unknown[]) => unknown>;
const ui = (jest.requireMock('react-native-reanimated') as { __ui: import('../../Bead/__tests__/__fixtures__/uiThread.ts').UiThread }).__ui;
const callbacks = () => ui.callbacks();

type Node = ReactTestRenderer.ReactTestInstance;
type FakePicture = { recording: { blobs: Array<{ ids: number[]; xforms: number[][] }>; bounds: { width: number; height: number }; disposed: number } };
const flat = (n: Node) => StyleSheet.flatten(n.props.style) ?? {};
const isHost = (n: Node) => typeof n.type === 'string';
/** The Group a node is drawn in, inside the canvas, if any. */
const groupOf = (n: Node, canvas: Node): Node | null => {
  for (let p = n.parent; p !== null && p !== canvas; p = p.parent) if (p.type === skia().Group) return p;
  return null;
};
/** What a word's canvas draws: its kept picture, then each returning picture with the opacity its Group is drawn at. */
function layers(canvas: Node) {
  const drawn = canvas.findAll((n) => n.type === skia().Picture);
  return {
    kept: drawn.filter((n) => groupOf(n, canvas) === null).map((n) => n.props.picture as FakePicture),
    returning: drawn
      .filter((n) => groupOf(n, canvas) !== null)
      .map((n) => ({ picture: n.props.picture as FakePicture, opacity: (groupOf(n, canvas)!.props.layer as { props: { opacity: { value: number } } }).props.opacity })),
  };
}
/** The letters a picture draws: each glyph id with its RSXform. */
const lettersOf = (p: FakePicture) => p.recording.blobs.flatMap((b) => b.ids.map((id, k) => ({ id, xform: b.xforms[k] })));

/** The looks the beads' driver writes, as RimLabels reads them: a shared value the test writes as the UI thread would. */
type Looks = { value: Record<number, { opacity: number; start: number | null }> };
const looksOf = (value: Looks['value'] = {}): Looks => ({ value });
const liveBead = (point: PlatePoint, id = 0): RimBead => ({ id, point, leaving: false });
const leavingBead = (point: PlatePoint, id = 0): RimBead => ({ id, point, leaving: true });

// Test data standing in for the page's resolved copy (the shared plate.rim.* keys are R: the lab shows pseudo-text).
const WORDS: RimWords = { top: 'More energy', right: 'Pleasant', bottom: 'Less energy', left: 'Unpleasant' };
const A11Y: RimWords = { top: 'Top: more energy', right: 'Right: pleasant', bottom: 'Bottom: less energy', left: 'Left: unpleasant' };
const HE_WORDS: RimWords = { top: 'יותר אנרגיה', right: 'נעים', bottom: 'פחות אנרגיה', left: 'לא נעים' };

type Mounted = Partial<Omit<RimLabelsProps, 'looks'>> & { face?: Face; looks?: Looks };
function mount(over: Mounted = {}) {
  const rest = looksOf();
  const props = (p: Mounted): RimLabelsProps => ({ diameter: 296, fontScale: 1, words: WORDS, a11y: A11Y, script: 'latin', beads: [], ...p, looks: (p.looks ?? rest) as never });
  const tree = (p: Mounted) => (
    <DirectionProvider direction="abyss" face={p.face ?? 'dark'}>
      <RimLabels {...props(p)} />
    </DirectionProvider>
  );
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(tree(over));
  });
  mounted.add(r);
  const nodes = () => r.root.findAll((n) => isHost(n) && /^hero\.plate\.word\.\w+\.a11y$/.test(String(n.props.testID)));
  const canvas = (position: RimPosition) => r.root.find((n) => !isHost(n) && n.props.testID === `hero.plate.word.${position}`);
  const unmount = () => {
    mounted.delete(r);
    act(() => r.unmount());
  };
  return { r, nodes, canvas, update: (next: Mounted) => act(() => r.update(tree(next))), unmount };
}
/** Trees a failed test left mounted: unmounted after each test, so none leaves a frame callback behind for the next. */
const mounted = new Set<ReactTestRenderer.ReactTestRenderer>();

/** The layout the component must draw, from the fake font's numbers, through the pure arc law. */
function expected(position: RimPosition, over: { fontScale?: number; script?: 'latin' | 'hebrew'; words?: RimWords; beads?: readonly RimBead[] } = {}) {
  const fontScale = over.fontScale ?? 1;
  const script = over.script ?? 'latin';
  const size = BASE.type.ui.label[script].size * fontScale;
  const g = plateGeometry({ base: BASE, direction: DIRECTIONS.abyss }, 296, fontScale);
  const ids = Array.from(visualOrder((over.words ?? WORDS)[position])).map((c) => c.codePointAt(0)!);
  const band = BASE.plate.labelBand;
  const em = script === 'hebrew' ? band.trackingBottomHebrew : band.trackingBottomLatin;
  const layout = layRimWord({
    position,
    advances: ids.map((id) => (id >= 0x0590 && id <= 0x05ff ? 0.56 : 0.5) * size),
    font: { size, ascent: -0.93 * size, descent: 0.24 * size },
    tracking: position === 'bottom' ? em * size : 0,
    geometry: g,
    beads: over.beads ?? [],
    knockoutGap: band.knockoutGap,
    pad: (band.padding / 2) * (g.band / band.min),
  });
  return { ids, layout };
}

beforeEach(() => {
  fake().fonts.splice(0);
  fake().recordings.splice(0);
  fake().managers.splice(0);
});
afterEach(() => {
  for (const r of mounted) act(() => r.unmount());
  mounted.clear();
  jest.restoreAllMocks();
});

describe('RimLabels: four real text nodes carry the positions (DSN-027)', () => {
  it('mounted in the order TalkBack reads them, top, bottom, right, left (ruling 1), each the page’s accessible copy, as plain text and never a live region', () => {
    const view = mount();
    const nodes = view.nodes();
    const reading: RimPosition[] = ['top', 'bottom', 'right', 'left'];
    expect(nodes.map((n) => n.props.testID)).toEqual(reading.map((p) => `hero.plate.word.${p}.a11y`));
    expect(nodes.map((n) => n.props.accessibilityLabel)).toEqual(reading.map((p) => A11Y[p]));
    for (const n of nodes) {
      expect(n.props.accessible).toBe(true);
      expect(n.props.accessibilityRole).toBe('text');
      expect(n.props.accessibilityLiveRegion).toBeUndefined();
    }
    view.unmount();
  });

  it('holds each word’s arc drawing inside its node, hidden from TalkBack, and takes no touch', () => {
    const view = mount();
    for (const position of RIM_POSITIONS) {
      const canvas = view.canvas(position);
      const node = view.nodes().find((n) => n.props.testID === `hero.plate.word.${position}.a11y`)!;
      expect(node.findAll((n) => n === canvas).length).toBe(1);
      expect(canvas.props.accessibilityElementsHidden).toBe(true);
      expect(canvas.props.importantForAccessibility).toBe('no-hide-descendants');
      // The node is mounted in reading order and the words are drawn in drawing order: each canvas holds its own word.
      const { kept, returning } = layers(canvas);
      expect(kept).toHaveLength(1);
      expect(returning).toEqual([]);
      expect(kept[0].recording.blobs[0].ids).toEqual(expected(position).ids);
    }
    const root = view.r.root.findAll(isHost)[0];
    expect(root.props.pointerEvents).toBe('none');
    view.unmount();
  });

  it.each([false, true])('places each node at its word’s box on the arc, by left and top inside an ltr root (R7): isRTL %p', (rtl) => {
    jest.replaceProperty(I18nManager, 'isRTL', rtl);
    const view = mount();
    const tokens = { base: BASE, direction: DIRECTIONS.abyss };
    const g = plateGeometry(tokens, 296, 1);
    // The root is the plate's words slot and each node sits in its word slot (Plate/readingOrder.ts): the node's box,
    // from the two slots' origins, is the word's box in plate-local dp.
    const words = plateSlot(tokens, g, 'words');
    const root = view.r.root.findAll(isHost)[0];
    expect(flat(root)).toEqual({ position: 'absolute', direction: 'ltr', ...words });
    expect(root.props.testID).toBe('plate.slot.words');
    for (const n of view.nodes()) {
      const position = String(n.props.testID).split('.')[3] as RimPosition;
      const b = expected(position).layout.bounds;
      const slot = rimWordSlot(tokens, g, position);
      const host = view.r.root.findAll((x) => isHost(x) && x.props.testID === `plate.slot.word.${position}`)[0];
      expect(flat(host)).toEqual({ position: 'absolute', ...slot });
      expect(host.findAll((x) => x === n).length).toBe(1);
      expect(flat(n)).toMatchObject({ position: 'absolute', width: b.width, height: b.height });
      expect(words.left + slot.left + flat(n).left).toBeCloseTo(b.x, 9);
      expect(words.top + slot.top + flat(n).top).toBeCloseTo(b.y, 9);
    }
    view.unmount();
  });

  it('the words slot and each word slot are never flattened, take no touch and are no accessibility element', () => {
    const view = mount();
    const slots = view.r.root.findAll((x) => isHost(x) && /^plate\.slot\./.test(String(x.props.testID)));
    expect(slots.map((x) => x.props.testID)).toEqual(['plate.slot.words', 'plate.slot.word.top', 'plate.slot.word.bottom', 'plate.slot.word.right', 'plate.slot.word.left']);
    for (const x of slots) {
      expect(x.props.collapsable).toBe(false);
      expect(x.props.pointerEvents).toBe('none');
      expect(x.props.accessible).toBeUndefined();
      expect(x.props.accessibilityLabel).toBeUndefined();
    }
    view.unmount();
  });
});

describe('RimLabels: the words on the arc', () => {
  it('sets them in type.face.ui at ui.label’s size and weight, times the OS scale with no cap, from the font manager given', () => {
    const mgr = { name: 'a typeface provider' };
    for (const fontScale of [1, 2, 3]) {
      const view = mount({ fontScale, fontMgr: mgr as never });
      const font = fake().fonts[fake().fonts.length - 1];
      expect(font.style).toEqual({ fontFamily: BASE.type.face.ui, fontSize: BASE.type.ui.label.latin.size * fontScale, fontWeight: String(BASE.type.ui.label.latin.weight) });
      expect(font.mgr).toBe(mgr);
      view.unmount();
    }
    const system = mount();
    expect(fake().fonts[fake().fonts.length - 1].mgr).toBeUndefined();
    system.unmount();
  });

  it.each(['dark', 'light'] as const)('%s: draws each word’s glyphs in the order seen, at the arc law’s places, in text.primary', (face) => {
    const view = mount({ face });
    expect(fake().recordings).toHaveLength(4);
    RIM_POSITIONS.forEach((position, i) => {
      const { ids, layout } = expected(position);
      const recording = fake().recordings[i];
      expect(recording.bounds).toMatchObject({ width: layout.bounds.width, height: layout.bounds.height });
      expect(recording.blobs).toHaveLength(1);
      const [blob] = recording.blobs;
      expect(blob.ids).toEqual(ids);
      expect(blob.colour).toBe(`colour:${DIRECTIONS.abyss.color[face].text.primary.hex}`);
      expect(blob.antiAlias).toBe(true);
      layout.glyphs.forEach((g, k) => {
        expect(blob.xforms[k][0]).toBeCloseTo(g.scos, 12);
        expect(blob.xforms[k][1]).toBeCloseTo(g.ssin, 12);
        expect(blob.xforms[k][2]).toBeCloseTo(g.tx - layout.bounds.x, 9);
        expect(blob.xforms[k][3]).toBeCloseTo(g.ty - layout.bounds.y, 9);
      });
    });
    view.unmount();
  });

  // On Android the system font manager has no Heebo, and the typeface it answers has no glyphs: every word measured 0 wide
  // and drew nothing (f3e4679). The typeface provider above the page holds the bundled faces (F6); with no fontMgr given,
  // the words are set in its manager.
  it('with no fontMgr given, sets the words in the typeface provider’s manager once its faces are in, re-laid and redrawn', async () => {
    const sources = Object.fromEntries(BUNDLED_FACES.map((f) => [f.id, f.id])) as FaceSources<string>;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const read = async (id: string) => { await held; return { id, dispose() {} } as never; };
    const props: RimLabelsProps = { diameter: 296, fontScale: 1, words: WORDS, a11y: A11Y, script: 'latin', beads: [], looks: looksOf() as never };
    let r!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      r = ReactTestRenderer.create(
        <TypefaceProvider sources={sources} read={read}>
          <DirectionProvider direction="abyss" face="dark"><RimLabels {...props} /></DirectionProvider>
        </TypefaceProvider>,
      );
    });
    mounted.add(r);
    // Until the faces are in: the system's.
    expect(fake().fonts.map((x) => x.mgr)).toEqual([undefined]);
    expect(fake().recordings).toHaveLength(4);
    await act(async () => { release(); for (let i = 0; i < 10; i++) await Promise.resolve(); });
    const [mgr] = fake().managers;
    expect(mgr.families).toEqual(BUNDLED_FACES.map((x) => x.family));
    expect(fake().fonts).toHaveLength(2);
    expect(fake().fonts[1].mgr).toBe(mgr);
    expect(fake().fonts[1].style).toEqual({ fontFamily: BASE.type.face.ui, fontSize: BASE.type.ui.label.latin.size, fontWeight: String(BASE.type.ui.label.latin.weight) });
    // The system's font and its pictures are freed, and the words are drawn again in the provider's.
    expect(fake().fonts[0].disposed).toBe(1);
    expect(fake().recordings).toHaveLength(8);
    expect(fake().recordings.slice(0, 4).map((x) => x.disposed)).toEqual([1, 1, 1, 1]);
    // And the provider's manager outlives nothing: freed when the page goes.
    act(() => r.unmount());
    mounted.delete(r);
    expect(mgr.disposed).toBe(1);
  });

  it('a fontMgr the page gives wins over the typeface provider’s', async () => {
    const sources = Object.fromEntries(BUNDLED_FACES.map((f) => [f.id, f.id])) as FaceSources<string>;
    const read = async (id: string) => ({ id, dispose() {} }) as never;
    const given = { name: 'the page’s own' };
    const props: RimLabelsProps = { diameter: 296, fontScale: 1, words: WORDS, a11y: A11Y, script: 'latin', beads: [], looks: looksOf() as never, fontMgr: given as never };
    let r!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      r = ReactTestRenderer.create(
        <TypefaceProvider sources={sources} read={read}>
          <DirectionProvider direction="abyss" face="dark"><RimLabels {...props} /></DirectionProvider>
        </TypefaceProvider>,
      );
    });
    mounted.add(r);
    await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
    expect(fake().managers).toHaveLength(1);
    expect(fake().fonts.map((x) => x.mgr)).toEqual([given]);
  });

  it('lays a Hebrew word in the order it is seen, and gives the bottom word Hebrew’s tracking', () => {
    const view = mount({ words: HE_WORDS, script: 'hebrew' });
    RIM_POSITIONS.forEach((position, i) => {
      const { ids, layout } = expected(position, { words: HE_WORDS, script: 'hebrew' });
      expect(fake().recordings[i].blobs[0].ids).toEqual(ids);
      expect(fake().recordings[i].bounds).toMatchObject({ width: layout.bounds.width });
    });
    expect(fake().recordings[0].blobs[0].ids[0]).toBe(HE_WORDS.top.codePointAt(HE_WORDS.top.length - 1));
    view.unmount();
  });

  it('a live bead knocks out the letters near it: they are not drawn, and the word’s node and copy stay whole', () => {
    const beads = [liveBead({ x: 0, y: 1 })];
    const view = mount({ beads });
    const top = expected('top', { beads });
    const kept = top.layout.glyphs.filter((g) => g.state === 'kept');
    expect(kept.length).toBeLessThan(top.ids.length);
    expect(fake().recordings[0].blobs[0].ids).toEqual(kept.map((g) => top.ids[g.index]));
    for (const i of [1, 2, 3]) expect(fake().recordings[i].blobs[0].ids).toEqual(expected(RIM_POSITIONS[i]).ids);
    const node = view.nodes()[0];
    expect(flat(node)).toMatchObject({ width: top.layout.bounds.width, height: top.layout.bounds.height });
    expect(node.props.accessibilityLabel).toBe(A11Y.top);
    view.unmount();
  });

  it('at font scale 2.0 the words grow with the band and stay inside it', () => {
    const view = mount({ fontScale: 2 });
    const g = plateGeometry({ base: BASE, direction: DIRECTIONS.abyss }, 296, 2);
    for (const position of RIM_POSITIONS) {
      for (const glyph of expected(position, { fontScale: 2 }).layout.glyphs) {
        const size = BASE.type.ui.label.latin.size * 2;
        for (const [x, y] of [[0, -0.93 * size], [glyph.advance, 0.24 * size]]) {
          const d = Math.hypot(glyph.scos * x - glyph.ssin * y + glyph.tx - g.centre[0], glyph.ssin * x + glyph.scos * y + glyph.ty - g.centre[1]);
          expect(d).toBeGreaterThanOrEqual(g.ringInner);
          expect(d).toBeLessThanOrEqual(g.radius);
        }
      }
    }
    view.unmount();
  });

  it('has no text of its own: no text element, and every label it shows is one of the page’s', () => {
    const view = mount();
    const hosts = view.r.root.findAll(isHost);
    expect(hosts.filter((n) => String(n.type) === 'Text').length).toBe(0);
    const labels = hosts.map((n) => n.props.accessibilityLabel).filter((l) => l !== undefined);
    expect(labels.every((l) => Object.values(A11Y).includes(l))).toBe(true);
    view.unmount();
  });

  it('refuses a word it cannot lay truthfully (mixed directions): a shaper’s job, never a guess', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => mount({ words: { ...HE_WORDS, top: 'נעים ok' }, script: 'hebrew' })).toThrow(RangeError);
  });
});

describe('RimLabels: letters return on the bead’s own look (the designer’s ruling 2; UI-320, the rulings of 2026-11-26)', () => {
  const TOP = { x: 0, y: 1 };
  const LEFT_OF_TOP = { x: -0.06, y: 1 };
  const RIGHT_OF_TOP = { x: 0.06, y: 1 };
  const idsWhere = (e: ReturnType<typeof expected>, state: string) => e.layout.glyphs.filter((g) => g.state === state).map((g) => e.ids[g.index]);
  const byPlace = (a: { xform: number[] }, b: { xform: number[] }) => a.xform[2] - b.xform[2] || a.xform[3] - b.xform[3];
  const leaving = (opacity: number, start: number | null = 1) => ({ opacity, start });

  it('a live bead keeps its letters out, in no picture, and nothing runs while it stays', () => {
    const view = mount({ beads: [liveBead(TOP)] });
    const top = layers(view.canvas('top'));
    expect(top.kept[0].recording.blobs[0].ids).toEqual(idsWhere(expected('top', { beads: [liveBead(TOP)] }), 'kept'));
    expect(top.returning).toEqual([]);
    expect(callbacks()).toEqual([]);
    view.unmount();
  });

  it('as the bead begins to leave, its letters wait at 0 in a returning picture of their own, each at its place, the kept letters untouched', () => {
    const view = mount({ beads: [liveBead(TOP)] });
    const keptBefore = lettersOf(layers(view.canvas('top')).kept[0]);
    view.update({ beads: [leavingBead(TOP)] });
    const top = layers(view.canvas('top'));
    const e = expected('top', { beads: [leavingBead(TOP)] });
    expect(lettersOf(top.kept[0])).toEqual(keptBefore);
    expect(top.returning).toHaveLength(1);
    const [layer] = top.returning;
    expect(layer.picture.recording.blobs[0].ids).toEqual(idsWhere(e, 'returning'));
    expect(layer.picture.recording.bounds).toMatchObject({ width: e.layout.bounds.width, height: e.layout.bounds.height });
    e.layout.glyphs.filter((g) => g.state === 'returning').forEach((g, k) => {
      expect(layer.picture.recording.blobs[0].xforms[k][2]).toBeCloseTo(g.tx - e.layout.bounds.x, 9);
      expect(layer.picture.recording.blobs[0].xforms[k][3]).toBeCloseTo(g.ty - e.layout.bounds.y, 9);
    });
    // The driver has written no look for the bead yet: it may still be whole, so its letters stay out.
    expect(layer.opacity.value).toBe(0);
    for (const p of ['right', 'bottom', 'left'] as const) expect(layers(view.canvas(p)).returning).toEqual([]);
    view.unmount();
  });

  // UI-320's second cause, found on the emulator at 679e194: Skia draws a Picture with no paint
  // (node_modules/@shopify/react-native-skia/cpp/api/recorder/Drawings.h, PictureCmd: canvas->drawPicture(picture)), and a
  // Group's own opacity only scales the paints of the drawings under it (Paint.h SavePaintCmd, not standalone), so it
  // never reached the returning letters: at every head they were back whole in the first frame they were mounted, never
  // as a fade. A layer does reach them: the Group saves a layer with its paint, and the layer is composited at that
  // paint's alpha (RNRecorder.h SaveLayer).
  it('draws the returning picture in a layer whose paint carries the opacity; the Group has no opacity of its own, which a Picture would ignore', () => {
    const looks = looksOf({ 3: { opacity: 0.25, start: 1 } });
    const view = mount({ beads: [leavingBead(TOP, 3)], looks });
    const canvas = view.canvas('top');
    const [picture] = canvas.findAll((n) => n.type === skia().Picture).filter((n) => groupOf(n, canvas) !== null);
    const group = groupOf(picture, canvas)!;
    expect(group.props.opacity).toBeUndefined();
    const layer = group.props.layer as React.ReactElement<{ opacity: { value: number } }>;
    expect(React.isValidElement(layer)).toBe(true);
    expect(layer.type).toBe(skia().Paint);
    expect(layer.props.opacity.value).toBe(0.75);
    // The kept letters are drawn plainly, in no layer.
    const [kept] = canvas.findAll((n) => n.type === skia().Picture).filter((n) => groupOf(n, canvas) === null);
    expect(kept).toBeDefined();
    view.unmount();
  });

  it.each([1, 0.6])('returns them with the bead’s own look: at 100, 75, 50, 25 and 0%% of its start opacity (%p) they are at 0, 0.25, 0.5, 0.75 and 1, with no render', (from) => {
    const looks = looksOf();
    const view = mount({ beads: [leavingBead(TOP, 3)], looks });
    const [layer] = layers(view.canvas('top')).returning;
    for (const share of [1, 0.75, 0.5, 0.25, 0]) {
      looks.value = { 3: leaving(from * share, from) };
      expect(layer.opacity.value).toBeCloseTo(1 - share, 12);
    }
    view.unmount();
  });

  it('is exactly 0 while the bead holds its start opacity (the exit’s hold, its colour fading), and has no clock of its own: no frame callback, ever', () => {
    const looks = looksOf({ 3: leaving(1, 1) });
    const view = mount({ beads: [leavingBead(TOP, 3)], looks });
    const [layer] = layers(view.canvas('top')).returning;
    expect(layer.opacity.value).toBe(0);
    expect(callbacks()).toEqual([]);
    // Frames pass and nothing moves until the driver writes a look.
    ui.frame(1000);
    ui.frame(5000);
    expect(layer.opacity.value).toBe(0);
    looks.value = { 3: leaving(0.25, 1) };
    expect(layer.opacity.value).toBe(0.75);
    view.unmount();
  });

  it('a bead still on its entrance look (no start yet) keeps its letters out, whatever its opacity', () => {
    const looks = looksOf({ 3: leaving(0.3, null) });
    const view = mount({ beads: [leavingBead(TOP, 3)], looks });
    expect(layers(view.canvas('top')).returning[0].opacity.value).toBe(0);
    view.unmount();
  });

  it('a bead that began to leave from nothing (start opacity 0) leaves its letters back: 1, never NaN', () => {
    const view = mount({ beads: [leavingBead(TOP, 3)], looks: looksOf({ 3: leaving(0, 0) }) });
    expect(layers(view.canvas('top')).returning[0].opacity.value).toBe(1);
    view.unmount();
  });

  it('a letter near several leaving beads follows the one that fades last', () => {
    const looks = looksOf({ 1: leaving(0.5), 2: leaving(1) });
    const view = mount({ beads: [leavingBead(TOP, 1), leavingBead(TOP, 2)], looks });
    const top = layers(view.canvas('top'));
    expect(top.returning).toHaveLength(1);
    const [layer] = top.returning;
    expect(layer.opacity.value).toBe(0);
    looks.value = { 1: leaving(0), 2: leaving(0.5) };
    expect(layer.opacity.value).toBeCloseTo(0.5, 12);
    looks.value = { 1: leaving(0), 2: leaving(0) };
    expect(layer.opacity.value).toBe(1);
    view.unmount();
  });

  it('letters near different leaving beads each follow their own; those near both follow the later', () => {
    const beads = [leavingBead(LEFT_OF_TOP, 5), leavingBead(RIGHT_OF_TOP, 6)];
    const view = mount({ beads, looks: looksOf({ 5: leaving(0), 6: leaving(0.5) }) });
    const e = expected('top', { beads });
    const groups = returningGroups(e.layout);
    expect(groups.map((g) => g.follows.join(',')).sort()).toEqual(['0', '0,1', '1']);
    const top = layers(view.canvas('top'));
    expect(top.returning).toHaveLength(3);
    const want: Record<string, number> = { '0': 1, '1': 0.5, '0,1': 0.5 };
    for (const group of groups) {
      const letters = group.glyphs.map((g) => e.ids[g.index]);
      const layer = top.returning.find((r) => JSON.stringify(r.picture.recording.blobs[0].ids) === JSON.stringify(letters))!;
      expect([group.follows.join(','), layer.opacity.value]).toEqual([group.follows.join(','), want[group.follows.join(',')]]);
    }
    view.unmount();
  });

  it('a live bead near a leaving bead’s letters keeps them out: in no picture, and nothing runs', () => {
    const view = mount({ beads: [leavingBead(TOP, 1), liveBead(TOP, 2)], looks: looksOf({ 1: leaving(0) }) });
    const top = layers(view.canvas('top'));
    expect(top.returning).toEqual([]);
    expect(top.kept[0].recording.blobs[0].ids).toEqual(idsWhere(expected('top', { beads: [liveBead(TOP)] }), 'kept'));
    expect(callbacks()).toEqual([]);
    view.unmount();
  });

  it('when the bead is gone its letters fold into the kept picture exactly as they were drawn', () => {
    const looks = looksOf();
    const view = mount({ beads: [liveBead(TOP, 3)], looks });
    view.update({ beads: [leavingBead(TOP, 3)], looks });
    looks.value = { 3: leaving(0) };
    const before = layers(view.canvas('top'));
    expect(before.returning[0].opacity.value).toBe(1);
    const drawn = [...lettersOf(before.kept[0]), ...lettersOf(before.returning[0].picture)].sort(byPlace);
    view.update({ beads: [], looks });
    const after = layers(view.canvas('top'));
    expect(after.returning).toEqual([]);
    expect(lettersOf(after.kept[0]).sort(byPlace)).toEqual(drawn);
    view.unmount();
  });

  it('a returning layer keeps its place and its value while the beads around it change', () => {
    const looks = looksOf({ 3: leaving(0.5) });
    const gone = leavingBead(TOP, 3);
    const view = mount({ beads: [liveBead({ x: 0, y: -1 }, 2), gone], looks });
    const [layer] = layers(view.canvas('top')).returning;
    expect(layer.opacity.value).toBeCloseTo(0.5, 12);
    // The bottom bead goes, so the leaving one moves to the front, and a new one lands at the right.
    view.update({ beads: [{ ...gone }, liveBead({ x: 1, y: 0 }, 4)], looks });
    const [still] = layers(view.canvas('top')).returning;
    expect(still.opacity).toBe(layer.opacity);
    expect(still.opacity.value).toBeCloseTo(0.5, 12);
    view.unmount();
  });

  it('a new bead with the same place but another id is another bead: its letters follow its own look', () => {
    const looks = looksOf({ 3: leaving(0), 4: leaving(1) });
    const view = mount({ beads: [leavingBead(TOP, 3)], looks });
    expect(layers(view.canvas('top')).returning[0].opacity.value).toBe(1);
    view.update({ beads: [leavingBead(TOP, 4)], looks });
    expect(layers(view.canvas('top')).returning[0].opacity.value).toBe(0);
    view.unmount();
  });
});

describe('RimLabels: lifecycle', () => {
  it('at rest nothing runs, in every tier: with no letter returning, no frame callback, no shared or derived value, no timing', () => {
    const spies = ['useFrameCallback', 'useSharedValue', 'useDerivedValue', 'useAnimatedStyle', 'withTiming'].map((name) => jest.spyOn(reanimated, name));
    const view = mount();
    view.update({ beads: [liveBead({ x: 0, y: 1 })] });
    view.update({ beads: [liveBead({ x: 0, y: 1 }), liveBead({ x: 1, y: 0 })] });
    // A bead leaving far from every word returns no letter, so it starts nothing either.
    view.update({ beads: [leavingBead({ x: 0, y: 0 })] });
    view.unmount();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('reads the beads by value (RA-39): a bead moved along x alone, or along y alone, knocks out the word it now sits on', () => {
    const view = mount({ beads: [liveBead({ x: 1, y: 0 })] });
    const out = (p: RimPosition) => lettersOf(layers(view.canvas(p)).kept[0]).length < expected(p).ids.length;
    expect([out('right'), out('left')]).toEqual([true, false]);
    view.update({ beads: [liveBead({ x: -1, y: 0 })] });
    expect([out('right'), out('left')]).toEqual([false, true]);
    view.update({ beads: [liveBead({ x: 0, y: 1 })] });
    expect([out('top'), out('bottom')]).toEqual([true, false]);
    view.update({ beads: [liveBead({ x: 0, y: -1 })] });
    expect([out('top'), out('bottom')]).toEqual([false, true]);
    view.unmount();
  });

  it('frees every picture once it is replaced and on unmount, and its font once it changes (RA-31)', () => {
    const view = mount();
    // A page that rebuilds the same beads and words on every render redraws nothing (as FieldView's taps, RA-39).
    view.update({ beads: [], words: { ...WORDS }, a11y: { ...A11Y } });
    view.update({});
    expect(fake().recordings).toHaveLength(4);
    view.update({ beads: [liveBead({ x: 0, y: 1 })] });
    expect(fake().recordings).toHaveLength(8);
    view.update({ beads: [liveBead({ x: 0, y: 1 })] });
    expect(fake().recordings).toHaveLength(8);
    expect(fake().recordings.slice(0, 4).map((r) => r.disposed)).toEqual([1, 1, 1, 1]);
    // A bead leaving: the four words' kept letters and the top word's returning ones, freeing what they replace.
    view.update({ beads: [leavingBead({ x: 0, y: 1 })] });
    expect(fake().recordings).toHaveLength(13);
    expect(fake().recordings.slice(4, 8).map((r) => r.disposed)).toEqual([1, 1, 1, 1]);
    view.update({ beads: [leavingBead({ x: 0, y: 1 })] });
    expect(fake().recordings).toHaveLength(13);
    expect(fake().fonts).toHaveLength(1);
    view.update({ beads: [leavingBead({ x: 0, y: 1 })], fontScale: 2 });
    expect(fake().fonts).toHaveLength(2);
    expect(fake().fonts[0].disposed).toBe(1);
    view.unmount();
    expect(fake().recordings.map((r) => r.disposed).every((d) => d === 1)).toBe(true);
    expect(fake().fonts.map((f) => f.disposed)).toEqual([1, 1]);
  });
});
