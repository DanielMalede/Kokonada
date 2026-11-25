import React from 'react';
import { I18nManager, StyleSheet } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { DirectionProvider } from '../../../tokens/DirectionProvider.tsx';
import { BASE, DIRECTIONS, type Face } from '../../../tokens/tokens.generated.ts';
import { plateGeometry, type PlatePoint } from '../../Plate/geometry.ts';
import { RIM_POSITIONS, layRimWord, visualOrder, type RimPosition } from '../arc.ts';
import { RimLabels, type RimLabelsProps, type RimWords } from '../RimLabels.tsx';

// A stateful fake of the part of Skia the rim words draw with. Its font measures as Heebo does by the designer's budget
// basis (LEDGER rev §11: 0.50 em a Latin letter, 0.56 em a Hebrew one), with a fixed ascent and descent; its recorder keeps
// every text blob drawn and every dispose. The layout's truth is arc.test.ts's; here, the component's wiring.
jest.mock('@shopify/react-native-skia', () => {
  const fake = {
    fonts: [] as Array<{ style: Record<string, unknown>; mgr: unknown; disposed: number }>,
    recordings: [] as Array<{ blobs: Array<{ ids: number[]; xforms: number[][]; colour: unknown; antiAlias: unknown }>; bounds: unknown; disposed: number }>,
  };
  const Stub = ({ children }: { children?: unknown }) => children ?? null;
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
          return { dispose: () => { recording.disposed += 1; } };
        },
        dispose() {},
      };
    },
  };
  return { Canvas: Stub, Picture: () => null, Skia, matchFont, __fake: fake };
});

const fake = () => jest.requireMock('@shopify/react-native-skia').__fake as {
  fonts: Array<{ style: Record<string, unknown>; mgr: unknown; disposed: number }>;
  recordings: Array<{ blobs: Array<{ ids: number[]; xforms: number[][]; colour: unknown; antiAlias: unknown }>; bounds: { width: number; height: number }; disposed: number }>;
};
const reanimated = jest.requireMock('react-native-reanimated') as Record<string, (...args: unknown[]) => unknown>;

type Node = ReactTestRenderer.ReactTestInstance;
const flat = (n: Node) => StyleSheet.flatten(n.props.style) ?? {};
const isHost = (n: Node) => typeof n.type === 'string';

// Test data standing in for the page's resolved copy (the shared plate.rim.* keys are R: the lab shows pseudo-text).
const WORDS: RimWords = { top: 'More energy', right: 'Pleasant', bottom: 'Less energy', left: 'Unpleasant' };
const A11Y: RimWords = { top: 'Top: more energy', right: 'Right: pleasant', bottom: 'Bottom: less energy', left: 'Left: unpleasant' };
const HE_WORDS: RimWords = { top: 'יותר אנרגיה', right: 'נעים', bottom: 'פחות אנרגיה', left: 'לא נעים' };

type Mounted = Partial<RimLabelsProps> & { face?: Face };
function mount(over: Mounted = {}) {
  const props = (p: Mounted): RimLabelsProps => ({ diameter: 296, fontScale: 1, words: WORDS, a11y: A11Y, script: 'latin', beads: [], ...p });
  const tree = (p: Mounted) => (
    <DirectionProvider direction="abyss" face={p.face ?? 'dark'}>
      <RimLabels {...props(p)} />
    </DirectionProvider>
  );
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(tree(over));
  });
  const nodes = () => r.root.findAll((n) => isHost(n) && /^hero\.plate\.word\.\w+\.a11y$/.test(String(n.props.testID)));
  const canvas = (position: RimPosition) => r.root.find((n) => !isHost(n) && n.props.testID === `hero.plate.word.${position}`);
  return { r, nodes, canvas, update: (next: Mounted) => act(() => r.update(tree(next))), unmount: () => act(() => r.unmount()) };
}

/** The layout the component must draw, from the fake font's numbers, through the pure arc law. */
function expected(position: RimPosition, over: { fontScale?: number; script?: 'latin' | 'hebrew'; words?: RimWords; beads?: readonly PlatePoint[] } = {}) {
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
});
afterEach(() => jest.restoreAllMocks());

describe('RimLabels: four real text nodes carry the positions (DSN-027)', () => {
  it('top, right, bottom, left, each the page’s accessible copy, as plain text and never a live region', () => {
    const view = mount();
    const nodes = view.nodes();
    expect(nodes.map((n) => n.props.testID)).toEqual(RIM_POSITIONS.map((p) => `hero.plate.word.${p}.a11y`));
    expect(nodes.map((n) => n.props.accessibilityLabel)).toEqual(RIM_POSITIONS.map((p) => A11Y[p]));
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
    }
    const root = view.r.root.findAll(isHost)[0];
    expect(root.props.pointerEvents).toBe('none');
    view.unmount();
  });

  it.each([false, true])('places each node at its word’s box on the arc, by left and top inside an ltr root (R7): isRTL %p', (rtl) => {
    jest.replaceProperty(I18nManager, 'isRTL', rtl);
    const view = mount();
    const root = view.r.root.findAll(isHost)[0];
    expect(flat(root)).toMatchObject({ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, direction: 'ltr' });
    for (const n of view.nodes()) {
      const position = String(n.props.testID).split('.')[3] as RimPosition;
      const b = expected(position).layout.bounds;
      expect(flat(n)).toMatchObject({ position: 'absolute', left: b.x, top: b.y, width: b.width, height: b.height });
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

  it('a bead knocks out the letters near it: they are not drawn, and the word’s node and copy stay whole', () => {
    const beads = [{ x: 0, y: 1 }];
    const view = mount({ beads });
    const top = expected('top', { beads });
    const kept = top.layout.glyphs.filter((g) => !g.knockedOut);
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

describe('RimLabels: lifecycle', () => {
  it('is the designed still in every tier: no frame callback, no animated value, no timing', () => {
    const spies = ['useFrameCallback', 'useSharedValue', 'useAnimatedStyle', 'withTiming'].map((name) => jest.spyOn(reanimated, name));
    const view = mount();
    view.update({ beads: [{ x: 0, y: 1 }] });
    view.unmount();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('frees every picture once it is replaced and on unmount, and its font once it changes (RA-31)', () => {
    const view = mount();
    // A page that rebuilds the same beads and words on every render redraws nothing (as FieldView's taps, RA-39).
    view.update({ beads: [], words: { ...WORDS }, a11y: { ...A11Y } });
    view.update({});
    expect(fake().recordings).toHaveLength(4);
    view.update({ beads: [{ x: 0, y: 1 }] });
    expect(fake().recordings).toHaveLength(8);
    expect(fake().recordings.slice(0, 4).map((r) => r.disposed)).toEqual([1, 1, 1, 1]);
    expect(fake().fonts).toHaveLength(1);
    view.update({ beads: [{ x: 0, y: 1 }], fontScale: 2 });
    expect(fake().fonts).toHaveLength(2);
    expect(fake().fonts[0].disposed).toBe(1);
    view.unmount();
    expect(fake().recordings.map((r) => r.disposed).every((d) => d === 1)).toBe(true);
    expect(fake().fonts.map((f) => f.disposed)).toEqual([1, 1]);
  });
});
