import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { I18nManager, StyleSheet } from 'react-native';
import type { MotionTier } from '../../../motion/useMotionPolicy.ts';
import { DirectionProvider } from '../../../tokens/DirectionProvider.tsx';
import { EXTENSIONS } from '../../../tokens/tokens.extensions.generated.ts';
import { BASE, DIRECTIONS } from '../../../tokens/tokens.generated.ts';
import { plateGeometry, pointToLocal } from '../../Plate/geometry.ts';
import { BeadLayer } from '../BeadLayer.tsx';
import type { PresentBead } from '../beadPresence.ts';
import { exitDuration } from '../beadTimeline.ts';
import { useBeadPresence } from '../useBeadPresence.ts';
import type { UiThread } from './__fixtures__/uiThread.ts';

// The beads for the page's presence (oldest first): one Bead each, placed on the plate's LTR root, entering when
// placed and leaving when a fourth tap, an undo or a clear takes them. Leaving beads draw under the live ones. The
// layer is inert: no touch, no accessibility node (PlateTouch owns both). Ruling 2: the page owns the presence
// (useBeadPresence), shared with the rim words; the layer draws its beads, each reading its own look from the presence's
// driver (UI-320), which reports each finished exit so the presence drops that bead.

jest.mock('react-native-reanimated', () => require('./__fixtures__/uiThread').uiThreadMock());
const ui = (jest.requireMock('react-native-reanimated') as { __ui: UiThread }).__ui;

jest.useFakeTimers();
afterAll(() => jest.useRealTimers());

const D = 300;
const PLATE = plateGeometry({ base: BASE, direction: DIRECTIONS.abyss }, D, 1);
const A = { x: 0.6, y: 0.6 };
const B = { x: 0.6, y: -0.6 };
const C = { x: -0.6, y: -0.6 };
const E = { x: -0.6, y: 0.6 };
/** Past the longest exit: an opaque bead's colour step and opacity step. */
const EXIT = exitDuration(1) + 50;

/** The page as the rulings wire it: the presence from the store's taps, its beads and onGone to the layer. */
function Page({ taps, tier }: { readonly taps: ReadonlyArray<{ x: number; y: number }>; readonly tier: MotionTier }) {
  const { beads, looks } = useBeadPresence(taps, tier);
  return <BeadLayer beads={beads} plate={PLATE} looks={looks} />;
}
const element = (taps: ReadonlyArray<{ x: number; y: number }>, tier: MotionTier = 'full') => (
  <DirectionProvider direction="abyss" face="dark">
    <Page taps={taps} tier={tier} />
  </DirectionProvider>
);
function mount(taps: ReadonlyArray<{ x: number; y: number }>, tier: MotionTier = 'full') {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(element(taps, tier));
  });
  trees.add(tree);
  return tree;
}
const flat = (style: unknown) => (StyleSheet.flatten(style as never) ?? {}) as Record<string, any>;
/** Each drawn bead's root, in draw order: a live one is hero.plate.bead.<n>, a leaving one hero.plate.bead.leaving (F2). */
const beads = (tree: ReactTestRenderer.ReactTestRenderer) => tree.root.findAll((n) => typeof n.type === 'string' && /^hero\.plate\.bead\.(\d+|leaving)$/.test(String(n.props.testID)));
/** Each drawn bead's centre, in the layer's dp, read back from its box. */
const centres = (tree: ReactTestRenderer.ReactTestRenderer) =>
  beads(tree).map((b) => {
    const s = flat(b.props.style);
    return { x: s.left + s.width / 2, y: s.top + s.height / 2 };
  });
const at = (p: { x: number; y: number }) => pointToLocal(p, PLATE);
/** The UI thread runs `ms` of frames from where it stands, JS hearing of each as it happens. */
let uiNow = 0;
const advance = (ms: number) => {
  for (const end = uiNow + ms; uiNow <= end; uiNow += 10) {
    ui.frame(uiNow);
    act(() => ui.flushJS());
  }
};
/** How many frame callbacks are running: the presence's one driver, while a bead moves. */
const running = () => ui.callbacks().filter((c) => c.active).length;
const opacities = (tree: ReactTestRenderer.ReactTestRenderer) => beads(tree).map((b) => flat(b.props.style).opacity as number);

const trees = new Set<ReactTestRenderer.ReactTestRenderer>();
afterEach(() => {
  for (const tree of trees) act(() => tree.unmount());
  trees.clear();
  act(() => ui.flushJS());
  jest.clearAllTimers();
});

describe('BeadLayer', () => {
  it('is the plate box: LTR, absolutely at its origin, the plate’s size, and inert', () => {
    const tree = mount([A]);
    const root = tree.root.findAll((n) => n.props.testID === 'bead.layer' && typeof n.type === 'string')[0];
    expect(flat(root.props.style)).toMatchObject({ position: 'absolute', left: 0, top: 0, width: D, height: D, direction: 'ltr' });
    expect(root.props.pointerEvents).toBe('none');
    expect(root.props.accessible).toBe(false);
    expect(root.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('shows the taps present at the mount at once, in order, with no entrance', () => {
    const tree = mount([A, B]);
    expect(centres(tree)).toEqual([at(A), at(B)]);
    expect(running()).toBe(0);
    expect(opacities(tree)).toEqual([1, 1]);
  });

  it('a placed tap enters on the driver: out until its first frame, then in, and the beads already there are untouched', () => {
    const tree = mount([A, B]);
    act(() => tree.update(element([A, B, C])));
    expect(centres(tree)).toEqual([at(A), at(B), at(C)]);
    expect(running()).toBe(1);
    expect(opacities(tree)).toEqual([1, 1, 0]);
    advance(60);
    expect(opacities(tree)[2]).toBeGreaterThan(0);
    expect(opacities(tree).slice(0, 2)).toEqual([1, 1]);
    advance(700);
    expect(opacities(tree)).toEqual([1, 1, 1]);
    expect(running()).toBe(0);
  });

  it('the same taps in a new array start nothing', () => {
    const tree = mount([A, B]);
    act(() => tree.update(element([{ ...A }, { ...B }])));
    expect(running()).toBe(0);
    expect(centres(tree)).toEqual([at(A), at(B)]);
  });

  it('a fourth tap: the oldest leaves under the live beads, the new one enters; when its exit ends the oldest is gone', () => {
    const tree = mount([A, B, C]);
    act(() => tree.update(element([B, C, E])));
    expect(centres(tree)).toEqual([at(A), at(B), at(C), at(E)]);
    expect(running()).toBe(1);
    advance(EXIT);
    expect(centres(tree)).toEqual([at(B), at(C), at(E)]);
  });

  it('undo takes the latest away, through its exit (drawn under the live bead while it leaves)', () => {
    const tree = mount([A, B]);
    act(() => tree.update(element([A])));
    expect(centres(tree)).toEqual([at(B), at(A)]);
    advance(EXIT);
    expect(centres(tree)).toEqual([at(A)]);
  });

  it('clear takes every bead away, and the next tap enters on an empty plate', () => {
    const tree = mount([A, B, C]);
    act(() => tree.update(element([])));
    advance(EXIT);
    // Plain data, never test instances: a failure must print, not exhaust the heap pretty-printing fibers.
    expect(centres(tree)).toEqual([]);
    act(() => tree.update(element([E])));
    expect(centres(tree)).toEqual([at(E)]);
  });

  it('shows at most the newest three, as the field reads the store', () => {
    const tree = mount([A, B, C, E]);
    expect(centres(tree)).toEqual([at(B), at(C), at(E)]);
  });

  it('under reduced motion a bead is whole in the frame it is placed and gone in the frame it is taken: no clock at all', () => {
    const tree = mount([A, B], 'still');
    act(() => tree.update(element([A, B, C], 'still')));
    expect(centres(tree)).toEqual([at(A), at(B), at(C)]);
    act(() => tree.update(element([A], 'still')));
    expect(centres(tree)).toEqual([at(A)]);
    expect(running()).toBe(0);
  });

  it('draws the same under RTL', () => {
    const ltr = mount([A, B, C]).toJSON();
    const rtl = jest.replaceProperty(I18nManager, 'isRTL', true);
    const flipped = mount([A, B, C]).toJSON();
    rtl.restore();
    expect(flipped).toEqual(ltr);
  });
});

// F2 (P1, the designer's rulings of 2026-11-25): the hero's element IDs are the ledger's (EXTENSIONS hero.elements).
describe('BeadLayer: the beads’ element IDs (F2)', () => {
  const ids = (tree: ReactTestRenderer.ReactTestRenderer) => beads(tree).map((b) => b.props.testID as string);
  const byId = (tree: ReactTestRenderer.ReactTestRenderer, id: string) => {
    const s = flat(beads(tree).find((b) => b.props.testID === id)!.props.style);
    return { x: s.left + s.width / 2, y: s.top + s.height / 2 };
  };

  it('the live beads are hero.plate.bead.0 to 2, oldest first; a leaving bead is hero.plate.bead.leaving, drawn under them', () => {
    const tree = mount([A, B, C]);
    expect(ids(tree)).toEqual(['hero.plate.bead.0', 'hero.plate.bead.1', 'hero.plate.bead.2']);
    expect([byId(tree, 'hero.plate.bead.0'), byId(tree, 'hero.plate.bead.2')]).toEqual([at(A), at(C)]);
    act(() => tree.update(element([B, C, E])));
    expect(ids(tree)).toEqual(['hero.plate.bead.leaving', 'hero.plate.bead.0', 'hero.plate.bead.1', 'hero.plate.bead.2']);
    expect([byId(tree, 'hero.plate.bead.leaving'), byId(tree, 'hero.plate.bead.0'), byId(tree, 'hero.plate.bead.2')]).toEqual([at(A), at(B), at(E)]);
  });

  it('every hero ID the layer draws is in the ledger’s element list, rings included', () => {
    const elements = EXTENSIONS.base.$root.hero.elements as readonly string[];
    const tree = mount([A, B, C]);
    act(() => tree.update(element([B, C, E])));
    const hero = tree.root.findAll((n) => typeof n.type === 'string' && String(n.props.testID).startsWith('hero.')).map((n) => n.props.testID as string);
    expect(hero.length).toBe(7);
    expect(hero.filter((id) => !elements.includes(id))).toEqual([]);
  });
});

describe('BeadLayer draws the presence it is given (ruling 2)', () => {
  const entry = (id: number, point: { x: number; y: number }, over: Partial<PresentBead> = {}): PresentBead => ({
    id,
    point,
    leaving: false,
    placedAt: null,
    leftAt: null,
    startOpacity: 1,
    ...over,
  });
  const direct = (list: readonly PresentBead[], looks: { value: Record<number, unknown> }) => (
    <DirectionProvider direction="abyss" face="dark">
      <BeadLayer beads={list} plate={PLATE} looks={looks as never} />
    </DirectionProvider>
  );

  it('hands each bead its own id and the one looks value: each draws its own look, and one with none is at rest', () => {
    const looks = { value: { 7: { opacity: 0.5, colour: 0, scale: 1, start: 1 } } };
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(direct([entry(4, A), entry(7, B, { leaving: true, leftAt: 0 }), entry(9, C, { placedAt: 0 })], looks));
    });
    trees.add(tree);
    // Draw order: the leaving bead under the live ones.
    expect(beads(tree).map((b) => b.props.testID)).toEqual(['hero.plate.bead.leaving', 'hero.plate.bead.0', 'hero.plate.bead.1']);
    // Bead 7 at its look; bead 4, with no entrance, whole; bead 9, placed with an entrance and not yet drawn, out.
    expect(opacities(tree)).toEqual([0.5, 1, 0]);
  });
});
