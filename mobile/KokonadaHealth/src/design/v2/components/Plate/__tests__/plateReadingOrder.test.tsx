import React, { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { BeadLayer } from '../../Bead/BeadLayer.tsx';
import { useBeadPresence } from '../../Bead/useBeadPresence.ts';
import { PlateEntry, type PlateEntryHandle } from '../../PlateTouch/PlateEntry.tsx';
import { PlateTouch } from '../../PlateTouch/PlateTouch.tsx';
import { RimLabels, type RimWords } from '../../RimLabels/RimLabels.tsx';
import { DirectionProvider } from '../../../tokens/DirectionProvider.tsx';
import { useTokens } from '../../../tokens/useTokens.ts';
import { plateGeometry, pointToLocal, type PlatePoint } from '../geometry.ts';
import { Plate } from '../Plate.tsx';
import { PLATE_READING_ORDER, READING_STEP, plateSlot, rimWordSlot } from '../readingOrder.ts';
import { touchSurface } from '../../PlateTouch/plateTouchModel.ts';
import { RIM_READING_ORDER } from '../../RimLabels/arc.ts';
import { BASE, DIRECTIONS } from '../../../tokens/tokens.generated.ts';

// The plate's TalkBack order (ruling 9, and the device dump at d5479dc that read: latest bead, plate, top, left, right,
// bottom, CTA). Android never reads a view's children in mount order: ViewGroup.addChildrenForAccessibility sorts each
// parent's children by where they are (ChildListForAccessibility, ViewLocationHolder; RN 0.86's ReactViewGroup defers to
// it while the enableAccessibilityOrder flag is off, as it is in this build). `androidOrder` below is that algorithm,
// ported line for line from the SDK's android/view/ViewGroup.java (sources android-37.0): the stripe strategy, then left
// (LTR) or right (RTL), top, height, width, the first descendant with other screen bounds, and the accessibility id.
// It runs over the host tree the components render, with Fabric's view flattening modelled (a View that only lays out
// is flattened and its children join its parent), screen bounds clipped to every ancestor, and the accessibility ids in
// creation order. It is a model of Android, not Android: the device dump (uiautomator, the compressed tree TalkBack is
// offered) is the proof, and this test is its regression guard.

jest.mock('@shopify/react-native-skia', () => {
  // A Skia that records nothing and answers every factory with an object that answers everything: the order is about
  // views, not pictures. The font measures as Heebo does by the designer's budget basis, as RimLabels.test.tsx's.
  const anything: object = new Proxy(function anythingFn() {}, {
    get: (_t, key) => (key === 'then' ? undefined : anything),
    apply: () => anything,
  });
  const Stub = ({ children }: { children?: unknown }) => children ?? null;
  const matchFont = (style: { fontSize: number }) => {
    const size = style.fontSize;
    return {
      getSize: () => size,
      getMetrics: () => ({ ascent: -0.93 * size, descent: 0.24 * size, leading: 0 }),
      getGlyphIDs: (s: string) => Array.from(s).map((c) => c.codePointAt(0)!),
      getGlyphWidths: (ids: number[]) => ids.map((id) => (id >= 0x0590 && id <= 0x05ff ? 0.56 : 0.5) * size),
      dispose() {},
    };
  };
  return { Canvas: Stub, Group: Stub, Picture: () => null, PaintStyle: { Fill: 0, Stroke: 1 }, TileMode: { Clamp: 0 }, Skia: anything, matchFont };
});

type Node = ReactTestRenderer.ReactTestInstance;
interface Rect { left: number; top: number; right: number; bottom: number }

/** A native view as Android holds it: after flattening, with its rect in the root's coordinates. */
interface NativeView {
  readonly id: string;
  readonly axId: number;
  readonly rect: Rect;
  readonly parent: NativeView | null;
  readonly children: NativeView[];
  readonly include: boolean;
}

const HANDLERS = /^on[A-Z]/;

/** Fabric flattens a View that only lays out: no accessibility, no pointerEvents, no handler, no paint, collapsable not false. */
function flattened(n: Node, style: Record<string, unknown>): boolean {
  const p = n.props;
  if (p.collapsable === false) return false;
  if (p.accessible === true || p.accessibilityLabel != null || p.accessibilityRole != null || p.importantForAccessibility != null) return false;
  if (p.accessibilityElementsHidden != null || p.pointerEvents != null || p.nativeID != null || p.focusable != null) return false;
  if (Object.keys(p).some((k) => HANDLERS.test(k) && typeof p[k] === 'function')) return false;
  return ['opacity', 'transform', 'backgroundColor', 'borderWidth', 'boxShadow', 'experimental_backgroundImage'].every((k) => style[k] === undefined);
}

/** View.includeForAccessibility on RN's props: important (accessible, labelled, focusable or 'yes') and not hidden. */
function important(n: Node, hidden: boolean): boolean {
  const p = n.props;
  if (hidden || p.importantForAccessibility === 'no' || p.importantForAccessibility === 'no-hide-descendants') return false;
  return p.accessible === true || p.accessibilityLabel != null || p.importantForAccessibility === 'yes' || p.focusable === true;
}

/** The host tree as native views: each rect from its style (absolute boxes; a box with no position sits at its parent's origin). */
function nativeTree(root: Node): NativeView {
  let axId = 0;
  const visit = (n: Node, parentRect: Rect, into: NativeView, hidden: boolean) => {
    for (const c of n.children) {
      if (typeof c === 'string') continue;
      if (typeof c.type !== 'string') {
        visit(c, parentRect, into, hidden);
        continue;
      }
      const s = (StyleSheet.flatten(c.props.style) ?? {}) as Record<string, number | string | undefined>;
      const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
      const pw = parentRect.right - parentRect.left;
      const ph = parentRect.bottom - parentRect.top;
      const l = num(s.left) ?? 0;
      const t = num(s.top) ?? 0;
      const w = num(s.width) ?? (num(s.right) !== undefined ? pw - l - num(s.right)! : s.flex === 1 ? pw : 0);
      const h = num(s.height) ?? (num(s.bottom) !== undefined ? ph - t - num(s.bottom)! : s.flex === 1 ? ph : 0);
      const rect = { left: parentRect.left + l, top: parentRect.top + t, right: parentRect.left + l + w, bottom: parentRect.top + t + h };
      const hides = hidden || c.props.importantForAccessibility === 'no-hide-descendants';
      if (flattened(c, s)) {
        visit(c, rect, into, hides);
        continue;
      }
      const v: NativeView = { id: String(c.props.testID ?? ''), axId: axId++, rect, parent: into, children: [], include: important(c, hidden) };
      into.children.push(v);
      visit(c, rect, v, hides);
    }
  };
  const top: NativeView = { id: 'root', axId: axId++, rect: { left: 0, top: 0, right: 1000, bottom: 2000 }, parent: null, children: [], include: false };
  visit(root, top.rect, top, false);
  return top;
}

const same = (a: Rect, b: Rect) => a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;

/** View.getBoundsOnScreen(rect, true): clipped to every ancestor. */
function screenBounds(v: NativeView): Rect {
  const r = { ...v.rect };
  for (let p = v.parent; p !== null; p = p.parent) {
    r.left = Math.max(r.left, p.rect.left);
    r.top = Math.max(r.top, p.rect.top);
    r.right = Math.min(r.right, p.rect.right);
    r.bottom = Math.min(r.bottom, p.rect.bottom);
  }
  return r;
}

/** View.findViewByPredicateTraversal: this view, then its children in child order, depth first. */
function findFirst(v: NativeView, test: (x: NativeView) => boolean): NativeView | null {
  if (test(v)) return v;
  for (const c of v.children) {
    const f = findFirst(c, test);
    if (f !== null) return f;
  }
  return null;
}

type Direction = 'ltr' | 'rtl';

/** ViewLocationHolder.compareBoundsOfTree, the stripe strategy. */
function compareBoundsOfTree(a: NativeView, b: NativeView, dir: Direction): number {
  const A = a.rect;
  const B = b.rect;
  if (A.bottom - B.top <= 0) return -1;
  if (A.top - B.bottom >= 0) return 1;
  if (dir === 'ltr') {
    if (A.left - B.left !== 0) return A.left - B.left;
  } else if (A.right - B.right !== 0) {
    return -(A.right - B.right);
  }
  if (A.top - B.top !== 0) return A.top - B.top;
  const height = A.bottom - A.top - (B.bottom - B.top);
  if (height !== 0) return -height;
  const width = A.right - A.left - (B.right - B.left);
  if (width !== 0) return -width;
  const aBounds = screenBounds(a);
  const bBounds = screenBounds(b);
  const c1 = findFirst(a, (x) => !same(screenBounds(x), aBounds));
  const c2 = findFirst(b, (x) => !same(screenBounds(x), bBounds));
  if (c1 !== null && c2 !== null) return compareBoundsOfTree(c1, c2, dir);
  if (c1 !== null) return 1;
  if (c2 !== null) return -1;
  return 0;
}

/** ViewGroup.addChildrenForAccessibility, from the root: the nodes TalkBack is offered, in the order it is offered them. */
function androidOrder(root: NativeView, dir: Direction): string[] {
  const out: string[] = [];
  const add = (v: NativeView) => {
    const sorted = [...v.children].sort((a, b) => compareBoundsOfTree(a, b, dir) || a.axId - b.axId);
    for (const c of sorted) {
      if (c.include) out.push(c.id);
      else add(c);
    }
  };
  add(root);
  return out;
}

const WORDS: RimWords = { top: 'More energy', right: 'Pleasant', bottom: 'Less energy', left: 'Unpleasant' };
const A11Y: RimWords = { top: 'Top: more energy', right: 'Right: pleasant', bottom: 'Bottom: less energy', left: 'Left: unpleasant' };
const HE_WORDS: RimWords = { top: 'יותר אנרגיה', right: 'נעים', bottom: 'פחות אנרגיה', left: 'לא נעים' };
const D = 296;
const noop = () => {};

/** The plate as the hero composes it (HeroScene.tsx, ruling 9), between a step line above and the CTA below. */
function Hero({ taps, fontScale, script }: { taps: readonly PlatePoint[]; fontScale: number; script: 'latin' | 'hebrew' }) {
  const tokens = useTokens();
  const plate = plateGeometry(tokens, D, fontScale);
  const presence = useBeadPresence(taps, 'still');
  const entry = useRef<PlateEntryHandle>(null);
  return (
    <View testID="page" collapsable={false} style={{ position: 'absolute', left: 0, top: 0, width: 400, height: 800 }}>
      <View testID="page.step" accessible accessibilityLabel="Step" style={{ position: 'absolute', left: 20, top: 56, width: 360, height: 56 }} />
      <View testID="page.plateBox" style={{ position: 'absolute', left: 52, top: 120, width: D, height: D }}>
        <Plate diameter={D} fontScale={fontScale}>
          <PlateEntry ref={entry} plate={plate} label="Plate" hint="Opens a list" onOpenList={noop} onFocusChange={noop} inert={false} />
          <RimLabels diameter={D} fontScale={fontScale} words={script === 'hebrew' ? HE_WORDS : WORDS} a11y={A11Y} script={script} beads={presence.beads} beadOpacity={() => 1} />
          <BeadLayer beads={presence.beads} plate={plate} onGone={presence.onGone} />
          <PlateTouch plate={plate} taps={taps} toPoint={() => ({ x: 0, y: 0 })} onPlace={noop} onRemoveLatest={noop} haptics={{ fire: noop }} inert={false} entry={entry} latestLabel="Latest point" removeLabel="Remove" />
        </Plate>
      </View>
      <View testID="page.cta" accessible accessibilityRole="button" accessibilityLabel="Continue" style={{ position: 'absolute', left: 40, top: 120 + D + 24, width: 320, height: 56 }} />
    </View>
  );
}

function render(taps: readonly PlatePoint[], fontScale: number, script: 'latin' | 'hebrew') {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(
      <DirectionProvider direction="abyss" face="dark">
        <Hero taps={taps} fontScale={fontScale} script={script} />
      </DirectionProvider>,
    );
  });
  return r;
}

function orderOf(taps: readonly PlatePoint[], fontScale: number, script: 'latin' | 'hebrew', dir: Direction): string[] {
  const r = render(taps, fontScale, script);
  const order = androidOrder(nativeTree(r.root), dir);
  act(() => r.unmount());
  return order;
}

const find = (v: NativeView, id: string): NativeView => findFirst(v, (x) => x.id === id) ?? (() => { throw new Error(`no ${id}`); })();
const TOKENS = { base: BASE, direction: DIRECTIONS.abyss };
/** Where the page puts the plate's box (Hero above). */
const BOX = { left: 52, top: 120 };

const DESIGNED = (latest: boolean) => [
  'page.step',
  'hero.listEntry',
  'hero.plate.word.top.a11y',
  'hero.plate.word.bottom.a11y',
  'hero.plate.word.right.a11y',
  'hero.plate.word.left.a11y',
  ...(latest ? ['hero.plate.bead.latest.a11y'] : []),
  'page.cta',
];

/** The latest bead at every place that could sort it first or last: the rims, the centre, a corner. */
const LATEST: ReadonlyArray<readonly [string, PlatePoint]> = [
  ['at the top rim', { x: 0, y: 1 }],
  ['at the bottom rim', { x: 0, y: -1 }],
  ['at the left rim', { x: -1, y: 0 }],
  ['at the right rim', { x: 1, y: 0 }],
  ['at the centre', { x: 0, y: 0 }],
  ['at the upper left', { x: -0.7, y: 0.7 }],
];

describe('the plate’s TalkBack order, as Android sorts it (ruling 9; the d5479dc dump)', () => {
  describe.each(['ltr', 'rtl'] as const)('in a %s window', (dir) => {
    it.each(LATEST)('the latest bead %s: plate node, top, bottom, right, left, latest bead, then what follows the plate', (_name, latest) => {
      const taps = [{ x: 0.3, y: -0.4 }, { x: -0.2, y: 0.5 }, latest];
      for (const fontScale of [1, 2]) {
        for (const script of ['latin', 'hebrew'] as const) {
          expect(orderOf(taps, fontScale, script, dir)).toEqual(DESIGNED(true));
        }
      }
    });

    it('with no tap: plate node, the four words, then what follows the plate', () => {
      expect(orderOf([], 1, 'latin', dir)).toEqual(DESIGNED(false));
      expect(orderOf([], 2, 'hebrew', dir)).toEqual(DESIGNED(false));
    });
  });
});

describe('the reading slots (readingOrder.ts): they order the nodes and change nothing else', () => {
  it('the plate’s slots share the touch surface’s left, right and bottom (its outset: the margin and HIT_EDGE); their tops rise READING_STEP apart in reading order; latest is the surface', () => {
    for (const fontScale of [1, 2]) {
      const plate = plateGeometry(TOKENS, D, fontScale);
      const s = touchSurface(TOKENS, plate);
      const boxes = PLATE_READING_ORDER.map((slot) => plateSlot(TOKENS, plate, slot));
      for (const b of boxes) {
        expect(b.left).toBe(-s.outset);
        expect(b.width).toBe(s.side);
        expect(b.top + b.height).toBe(-s.outset + s.side);
      }
      expect(boxes.map((b) => b.top)).toEqual([-s.outset - 2 * READING_STEP, -s.outset - READING_STEP, -s.outset]);
      expect(plateSlot(TOKENS, plate, 'latest')).toEqual({ left: -s.outset, top: -s.outset, width: s.side, height: s.side });
      const words = plateSlot(TOKENS, plate, 'words');
      const tops = RIM_READING_ORDER.map((p) => rimWordSlot(TOKENS, plate, p));
      expect(tops.map((b) => b.top)).toEqual([0, 1, 2, 3].map((k) => k * READING_STEP));
      for (const b of tops) {
        expect(b.left).toBe(0);
        expect(b.width).toBe(words.width);
        expect(b.top + b.height).toBe(words.height);
      }
    }
    // At least 2 px apart at the lowest density Android ships (ldpi, 0.75): rounding never ties two slots.
    expect(READING_STEP * 0.75).toBeGreaterThanOrEqual(1.5);
  });

  it.each([1, 2])('every node keeps its plate-local box, whole, never clipped by a slot: font scale %p', (fontScale) => {
    const latest = { x: -0.7, y: 0.7 };
    const r = render([{ x: 0.3, y: -0.4 }, latest], fontScale, 'latin');
    const tree = nativeTree(r.root);
    const plate = plateGeometry(TOKENS, D, fontScale);
    const s = touchSurface(TOKENS, plate);
    const at = (x: number, y: number, w: number, h: number): Rect => ({ left: BOX.left + x, top: BOX.top + y, right: BOX.left + x + w, bottom: BOX.top + y + h });
    const entry = find(tree, 'hero.listEntry');
    expect(entry.rect).toEqual(at(0, 0, D, D));
    const bead = pointToLocal(latest, plate);
    const node = find(tree, 'hero.plate.bead.latest.a11y');
    expect(node.rect).toEqual(at(bead.x - s.hit / 2, bead.y - s.hit / 2, s.hit, s.hit));
    expect(find(tree, 'hero.plate.touch').rect).toEqual(at(-s.outset, -s.outset, s.side, s.side));
    for (const position of RIM_READING_ORDER) {
      const word = find(tree, `hero.plate.word.${position}.a11y`);
      // The word inside the plate's box, as the arc law lays it (RimLabels.test.tsx holds the box to the law).
      expect(word.rect.left).toBeGreaterThanOrEqual(BOX.left);
      expect(word.rect.right).toBeLessThanOrEqual(BOX.left + D);
      expect(word.rect.top).toBeGreaterThanOrEqual(BOX.top);
      expect(word.rect.bottom).toBeLessThanOrEqual(BOX.top + D);
    }
    // Clipped by nothing between it and the plate: each node's bounds on screen, up to the plate's box, are its own.
    for (const id of ['hero.listEntry', 'hero.plate.word.top.a11y', 'hero.plate.word.bottom.a11y', 'hero.plate.word.right.a11y', 'hero.plate.word.left.a11y']) {
      const v = find(tree, id);
      expect(screenBounds(v)).toEqual(v.rect);
    }
    act(() => r.unmount());
  });

  it('the plate’s root and every slot are never flattened, take no touch and are no accessibility element', () => {
    const r = render([{ x: 0, y: 0 }], 1, 'latin');
    const host = (id: string) => r.root.find((n) => typeof n.type === 'string' && n.props.testID === id);
    expect(host('hero.plate').props.collapsable).toBe(false);
    for (const id of ['plate.slot.entry', 'plate.slot.words', ...RIM_READING_ORDER.map((p) => `plate.slot.word.${p}`)]) {
      const slot = host(id);
      expect(slot.props.collapsable).toBe(false);
      expect(slot.props.pointerEvents).toBe('none');
      expect(slot.props.accessible).not.toBe(true);
      expect(slot.props.accessibilityLabel).toBeUndefined();
      expect(slot.props.importantForAccessibility).toBeUndefined();
    }
    expect(host('hero.plate.touch').props.collapsable).toBe(false);
    act(() => r.unmount());
  });
});
