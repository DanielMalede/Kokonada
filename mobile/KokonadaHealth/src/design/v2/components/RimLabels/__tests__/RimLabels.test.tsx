import React from 'react';
import { I18nManager, StyleSheet } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { DirectionProvider } from '../../../tokens/DirectionProvider.tsx';
import { BASE, DIRECTIONS, type Face } from '../../../tokens/tokens.generated.ts';
import { plateGeometry, type PlatePoint } from '../../Plate/geometry.ts';
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
  return { Canvas: Stub, Group, Picture: () => null, Skia, matchFont, __fake: fake };
});

// A stateful fake of the part of Reanimated the returning letters use, as Reanimated 4.5 behaves where it matters
// (node_modules/react-native-reanimated/src/hook/useFrameCallback.ts and frameCallback/FrameCallbackRegistryUI.ts): a
// shared value lives for the mount; a frame callback is registered in an effect keyed on its identity and autostart (a
// new identity unregisters the old one), and only an active one runs, given each frame's timestamp. __frame(t) draws one
// frame at the timestamp t on the UI thread: nothing re-renders, as on the device.
jest.mock('react-native-reanimated', () => {
  const { useEffect, useRef } = require('react');
  const registry = new Map<number, { fn: (info: unknown) => void; active: boolean; startTime: number | null; last: number | null }>();
  let nextId = 1;
  return {
    useSharedValue: (initial: unknown) => {
      const ref = useRef(null as null | { value: unknown });
      if (ref.current === null) ref.current = { value: initial };
      return ref.current;
    },
    useFrameCallback: (fn: (info: unknown) => void, autostart = true) => {
      const ref = useRef(null as null | { isActive: boolean; callbackId: number; setActive: (a: boolean) => void });
      if (ref.current === null) {
        const handle = {
          isActive: autostart,
          callbackId: -1,
          setActive(a: boolean) {
            const entry = registry.get(handle.callbackId);
            if (entry) {
              if (!a) entry.startTime = null;
              entry.active = a;
            }
            handle.isActive = a;
          },
        };
        ref.current = handle;
      }
      useEffect(() => {
        const handle = ref.current!;
        const id = nextId;
        nextId += 1;
        registry.set(id, { fn, active: false, startTime: null, last: null });
        handle.callbackId = id;
        handle.setActive(handle.isActive);
        return () => {
          registry.delete(id);
          handle.callbackId = -1;
        };
      }, [fn, autostart]);
      return ref.current;
    },
    useAnimatedStyle: (updater: () => unknown) => updater(),
    withTiming: (toValue: unknown) => toValue,
    __frame: (timestamp: number) => {
      for (const entry of [...registry.values()]) {
        if (!entry.active) continue;
        const first = entry.startTime === null;
        if (first) entry.startTime = timestamp;
        entry.fn({ timestamp, timeSincePreviousFrame: first ? null : timestamp - entry.last!, timeSinceFirstFrame: timestamp - entry.startTime! });
        entry.last = timestamp;
      }
    },
    __callbacks: () => [...registry.values()].map((entry) => ({ fn: entry.fn, active: entry.active })),
  };
});

const fake = () => jest.requireMock('@shopify/react-native-skia').__fake as {
  fonts: Array<{ style: Record<string, unknown>; mgr: unknown; disposed: number }>;
  recordings: Array<{ blobs: Array<{ ids: number[]; xforms: number[][]; colour: unknown; antiAlias: unknown }>; bounds: { width: number; height: number }; disposed: number }>;
  managers: Array<{ families: string[]; disposed: number }>;
};
const skia = () => jest.requireMock('@shopify/react-native-skia') as { Group: unknown; Picture: unknown };
const reanimated = jest.requireMock('react-native-reanimated') as Record<string, (...args: unknown[]) => unknown>;
type Callback = { fn: ((info: unknown) => void) & { __workletHash?: number; __closure?: Record<string, unknown> }; active: boolean };
const callbacks = () => (jest.requireMock('react-native-reanimated') as { __callbacks(): Callback[] }).__callbacks();
/** One frame on the UI thread, at the timestamp given. */
const frame = (timestamp: number) => (jest.requireMock('react-native-reanimated') as { __frame(t: number): void }).__frame(timestamp);

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
      .map((n) => ({ picture: n.props.picture as FakePicture, opacity: groupOf(n, canvas)!.props.opacity as { value: number } })),
  };
}
/** The letters a picture draws: each glyph id with its RSXform. */
const lettersOf = (p: FakePicture) => p.recording.blobs.flatMap((b) => b.ids.map((id, k) => ({ id, xform: b.xforms[k] })));

/** The fade-out the stand-in exit takes: motion.respond. */
const FADE = BASE.motion.respond.duration;
/** A stand-in for the bead model's exit function (Bead/ exports the real one): linear from where the bead was to 0, as beadExit at 8077d2d. */
function linearExit(b: RimBead, nowMs: number): number {
  'worklet';
  if (b.leftAt === null) return b.startOpacity;
  return b.startOpacity * (1 - Math.min(1, Math.max(0, (nowMs - b.leftAt) / FADE)));
}
const liveBead = (point: PlatePoint): RimBead => ({ point, leaving: false, leftAt: null, startOpacity: 1 });
const leavingBead = (point: PlatePoint, leftAt: number | null, startOpacity = 1): RimBead => ({ point, leaving: true, leftAt, startOpacity });

// Test data standing in for the page's resolved copy (the shared plate.rim.* keys are R: the lab shows pseudo-text).
const WORDS: RimWords = { top: 'More energy', right: 'Pleasant', bottom: 'Less energy', left: 'Unpleasant' };
const A11Y: RimWords = { top: 'Top: more energy', right: 'Right: pleasant', bottom: 'Bottom: less energy', left: 'Left: unpleasant' };
const HE_WORDS: RimWords = { top: 'יותר אנרגיה', right: 'נעים', bottom: 'פחות אנרגיה', left: 'לא נעים' };

type Mounted = Partial<RimLabelsProps> & { face?: Face };
function mount(over: Mounted = {}) {
  const props = (p: Mounted): RimLabelsProps => ({ diameter: 296, fontScale: 1, words: WORDS, a11y: A11Y, script: 'latin', beads: [], beadOpacity: linearExit, ...p });
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

  // On Android the system font manager has no Heebo, and the typeface it answers has no glyphs: every word measured 0 wide
  // and drew nothing (f3e4679). The typeface provider above the page holds the bundled faces (F6); with no fontMgr given,
  // the words are set in its manager.
  it('with no fontMgr given, sets the words in the typeface provider’s manager once its faces are in, re-laid and redrawn', async () => {
    const sources = Object.fromEntries(BUNDLED_FACES.map((f) => [f.id, f.id])) as FaceSources<string>;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const read = async (id: string) => { await held; return { id, dispose() {} } as never; };
    const props: RimLabelsProps = { diameter: 296, fontScale: 1, words: WORDS, a11y: A11Y, script: 'latin', beads: [], beadOpacity: linearExit };
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
    const props: RimLabelsProps = { diameter: 296, fontScale: 1, words: WORDS, a11y: A11Y, script: 'latin', beads: [], beadOpacity: linearExit, fontMgr: given as never };
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

describe('RimLabels: letters return on the bead’s own fade (the designer’s ruling 2)', () => {
  const TOP = { x: 0, y: 1 };
  const LEFT_OF_TOP = { x: -0.06, y: 1 };
  const RIGHT_OF_TOP = { x: 0.06, y: 1 };
  const idsWhere = (e: ReturnType<typeof expected>, state: string) => e.layout.glyphs.filter((g) => g.state === state).map((g) => e.ids[g.index]);
  const byPlace = (a: { xform: number[] }, b: { xform: number[] }) => a.xform[2] - b.xform[2] || a.xform[3] - b.xform[3];

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
    view.update({ beads: [leavingBead(TOP, 1000)] });
    const top = layers(view.canvas('top'));
    const e = expected('top', { beads: [leavingBead(TOP, 1000)] });
    expect(lettersOf(top.kept[0])).toEqual(keptBefore);
    expect(top.returning).toHaveLength(1);
    const [layer] = top.returning;
    expect(layer.picture.recording.blobs[0].ids).toEqual(idsWhere(e, 'returning'));
    expect(layer.picture.recording.bounds).toMatchObject({ width: e.layout.bounds.width, height: e.layout.bounds.height });
    e.layout.glyphs.filter((g) => g.state === 'returning').forEach((g, k) => {
      expect(layer.picture.recording.blobs[0].xforms[k][2]).toBeCloseTo(g.tx - e.layout.bounds.x, 9);
      expect(layer.picture.recording.blobs[0].xforms[k][3]).toBeCloseTo(g.ty - e.layout.bounds.y, 9);
    });
    expect(layer.opacity.value).toBe(0);
    for (const p of ['right', 'bottom', 'left'] as const) expect(layers(view.canvas(p)).returning).toEqual([]);
    view.unmount();
  });

  it.each([1, 0.6])('returns them on the UI thread with the bead’s own fade: at 0, 25, 50, 75 and 100%% of it they are at 0, 0.25, 0.5, 0.75 and 1 (from opacity %p)', (from) => {
    const view = mount({ beads: [leavingBead(TOP, 1000, from)] });
    const [layer] = layers(view.canvas('top')).returning;
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      frame(1000 + f * FADE);
      expect(layer.opacity.value).toBeCloseTo(f, 12);
    }
    view.unmount();
  });

  it('hands the exit function each frame’s own timestamp: the clock leftAt is stamped on', () => {
    const seen: number[] = [];
    function recorded(b: RimBead, nowMs: number): number {
      'worklet';
      seen.push(nowMs);
      return linearExit(b, nowMs);
    }
    const view = mount({ beads: [leavingBead(TOP, 1000)], beadOpacity: recorded });
    frame(1016.5);
    frame(1033);
    expect(seen).toEqual([1016.5, 1033]);
    view.unmount();
  });

  it('a letter near several leaving beads follows the one that fades last', () => {
    const view = mount({ beads: [leavingBead(TOP, 1000), leavingBead(TOP, 1000 + FADE / 2)] });
    const top = layers(view.canvas('top'));
    expect(top.returning).toHaveLength(1);
    const [layer] = top.returning;
    frame(1000 + FADE / 2);
    expect(layer.opacity.value).toBeCloseTo(0, 12);
    frame(1000 + FADE);
    expect(layer.opacity.value).toBeCloseTo(0.5, 12);
    frame(1000 + (3 * FADE) / 2);
    expect(layer.opacity.value).toBe(1);
    view.unmount();
  });

  it('letters near different leaving beads each follow their own; those near both follow the later', () => {
    const beads = [leavingBead(LEFT_OF_TOP, 1000), leavingBead(RIGHT_OF_TOP, 1000 + FADE / 2)];
    const view = mount({ beads });
    const e = expected('top', { beads });
    const groups = returningGroups(e.layout);
    expect(groups.map((g) => g.follows.join(',')).sort()).toEqual(['0', '0,1', '1']);
    const top = layers(view.canvas('top'));
    expect(top.returning).toHaveLength(3);
    frame(1000 + FADE);
    const want: Record<string, number> = { '0': 1, '1': 0.5, '0,1': 0.5 };
    for (const group of groups) {
      const letters = group.glyphs.map((g) => e.ids[g.index]);
      const layer = top.returning.find((r) => JSON.stringify(r.picture.recording.blobs[0].ids) === JSON.stringify(letters))!;
      expect([group.follows.join(','), layer.opacity.value]).toEqual([group.follows.join(','), want[group.follows.join(',')]]);
    }
    view.unmount();
  });

  it('a live bead near a leaving bead’s letters keeps them out: in no picture, and nothing runs', () => {
    const view = mount({ beads: [leavingBead(TOP, 1000), liveBead(TOP)] });
    const top = layers(view.canvas('top'));
    expect(top.returning).toEqual([]);
    expect(top.kept[0].recording.blobs[0].ids).toEqual(idsWhere(expected('top', { beads: [liveBead(TOP)] }), 'kept'));
    expect(callbacks()).toEqual([]);
    view.unmount();
  });

  it('under reduced motion (the bead goes in one frame) the letters are back in full in the frame it goes, never before', () => {
    function oneFrame(b: RimBead, nowMs: number): number {
      'worklet';
      return b.leftAt !== null && nowMs >= b.leftAt ? 0 : b.startOpacity;
    }
    const view = mount({ beads: [liveBead(TOP)], beadOpacity: oneFrame });
    view.update({ beads: [leavingBead(TOP, 1000)], beadOpacity: oneFrame });
    const [layer] = layers(view.canvas('top')).returning;
    expect(layer.opacity.value).toBe(0);
    frame(1000 - 16);
    expect(layer.opacity.value).toBe(0);
    frame(1000);
    expect(layer.opacity.value).toBe(1);
    view.unmount();
  });

  it('when the bead is gone its letters fold into the kept picture exactly as they were drawn, and its frame callback ends', () => {
    const view = mount({ beads: [liveBead(TOP)] });
    view.update({ beads: [leavingBead(TOP, 1000)] });
    frame(1000 + FADE);
    const before = layers(view.canvas('top'));
    expect(before.returning[0].opacity.value).toBe(1);
    const drawn = [...lettersOf(before.kept[0]), ...lettersOf(before.returning[0].picture)].sort(byPlace);
    view.update({ beads: [] });
    const after = layers(view.canvas('top'));
    expect(after.returning).toEqual([]);
    expect(lettersOf(after.kept[0]).sort(byPlace)).toEqual(drawn);
    expect(callbacks()).toEqual([]);
    view.unmount();
  });

  it('a fade-out stamped a render late: the letters wait at 0, then follow the bead from its leftAt, in the same layer', () => {
    const view = mount({ beads: [liveBead(TOP)] });
    expect(layers(view.canvas('top')).returning).toEqual([]);
    // The bead turns to leave before its leftAt is stamped: only `leaving` changes.
    view.update({ beads: [leavingBead(TOP, null)] });
    const [layer] = layers(view.canvas('top')).returning;
    frame(5000);
    expect(layer.opacity.value).toBe(0);
    // Only leftAt changes: the bead was opaque when its fade-out began.
    view.update({ beads: [leavingBead(TOP, 5000)] });
    const [stamped] = layers(view.canvas('top')).returning;
    expect(stamped.opacity).toBe(layer.opacity);
    frame(5000 + FADE / 4);
    expect(stamped.opacity.value).toBeCloseTo(0.25, 12);
    view.unmount();
  });

  it('a returning layer keeps its place and its opacity while the beads around it change', () => {
    const leaving = leavingBead(TOP, 1000);
    const view = mount({ beads: [liveBead({ x: 0, y: -1 }), leaving] });
    const [layer] = layers(view.canvas('top')).returning;
    frame(1000 + FADE / 2);
    expect(layer.opacity.value).toBeCloseTo(0.5, 12);
    // The bottom bead goes, so the leaving one moves to the front, and a new one lands at the right.
    view.update({ beads: [{ ...leaving }, liveBead({ x: 1, y: 0 })] });
    const [still] = layers(view.canvas('top')).returning;
    expect(still.opacity).toBe(layer.opacity);
    expect(still.opacity.value).toBeCloseTo(0.5, 12);
    view.unmount();
  });

  it('runs a frame callback only while letters are returning: none at rest, one while the bead leaves, none once it is gone', () => {
    const view = mount();
    expect(callbacks()).toEqual([]);
    view.update({ beads: [liveBead(TOP)] });
    expect(callbacks()).toEqual([]);
    view.update({ beads: [leavingBead({ x: 0, y: 0 }, 1000)] });
    expect(callbacks()).toEqual([]);
    view.update({ beads: [leavingBead(TOP, 1000)] });
    expect(callbacks().map((c) => c.active)).toEqual([true]);
    view.update({ beads: [] });
    expect(callbacks()).toEqual([]);
    view.unmount();
  });

  it('its frame callback is a worklet, and so is everything it calls: the UI thread cannot call a plain function', () => {
    const view = mount({ beads: [leavingBead(TOP, 1000)] });
    const [callback] = callbacks();
    expect(typeof callback.fn.__workletHash).toBe('number');
    const called = Object.values(callback.fn.__closure ?? {}).filter((v) => typeof v === 'function') as Array<{ __workletHash?: number }>;
    expect(called.length).toBeGreaterThanOrEqual(2);
    expect(called.filter((f) => typeof f.__workletHash !== 'number')).toEqual([]);
    view.unmount();
  });
});

describe('RimLabels: lifecycle', () => {
  it('at rest nothing runs, in every tier: with no letter returning, no frame callback, no animated value, no timing', () => {
    const spies = ['useFrameCallback', 'useSharedValue', 'useAnimatedStyle', 'withTiming'].map((name) => jest.spyOn(reanimated, name));
    const view = mount();
    view.update({ beads: [liveBead({ x: 0, y: 1 })] });
    view.update({ beads: [liveBead({ x: 0, y: 1 }), liveBead({ x: 1, y: 0 })] });
    // A bead leaving far from every word returns no letter, so it starts nothing either.
    view.update({ beads: [leavingBead({ x: 0, y: 0 }, 1000)] });
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
    view.update({ beads: [leavingBead({ x: 0, y: 1 }, 1000)] });
    expect(fake().recordings).toHaveLength(13);
    expect(fake().recordings.slice(4, 8).map((r) => r.disposed)).toEqual([1, 1, 1, 1]);
    view.update({ beads: [leavingBead({ x: 0, y: 1 }, 1000)] });
    expect(fake().recordings).toHaveLength(13);
    expect(fake().fonts).toHaveLength(1);
    view.update({ beads: [leavingBead({ x: 0, y: 1 }, 1000)], fontScale: 2 });
    expect(fake().fonts).toHaveLength(2);
    expect(fake().fonts[0].disposed).toBe(1);
    view.unmount();
    expect(fake().recordings.map((r) => r.disposed).every((d) => d === 1)).toBe(true);
    expect(fake().fonts.map((f) => f.disposed)).toEqual([1, 1]);
  });
});
