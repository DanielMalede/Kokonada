import React from 'react';
import { StyleSheet } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import type { MotionTier } from '../../../motion/useMotionPolicy.ts';
import { DirectionProvider } from '../../../tokens/DirectionProvider.tsx';
import { BASE, DIRECTIONS } from '../../../tokens/tokens.generated.ts';
import { plateGeometry, type PlatePoint } from '../../Plate/geometry.ts';
import { RimLabels, type RimWords } from '../../RimLabels/RimLabels.tsx';
import type { SkiaWordsFake } from '../../RimLabels/__tests__/__fixtures__/skiaWords.ts';
import { BeadLayer } from '../BeadLayer.tsx';
import { useBeadPresence } from '../useBeadPresence.ts';
import type { UiThread } from './__fixtures__/uiThread.ts';

// T2, T5 and T6 (the architect's ruling of 2026-11-26, UI-320): the real BeadLayer and the real RimLabels under one
// useBeadPresence, as a page wires them, on a UI thread whose frames the test delivers. The delayed-start test holds
// everything off the JS thread back by d ms after a removal (the first frame, and the motion's start), then samples, at
// every frame and with no render in between, the bead's opacity as drawn and its returning letters' opacity:
//
//     letters in frame n === 1 − the bead's opacity in frame n−1 ÷ its opacity before it left   (to 1e-6)
//     letters in frame n  <=  1 − the bead's opacity in frame n ÷ its opacity before it left    (never ahead)
//     letters > 0  ⇒  the bead's colour disc is at 0
//
// (the designer's ruling of 2026-11-27, option (b): the letters read the bead's look of the frame before, so they may
// trail it by one frame and never lead it; a bead with no look of the frame before has its whole share).
//
// At 27107e1 the letters ran on the wall clock from leftAt and the bead on a clock of its own that started d later: at
// d = 300 the first frame had the letters at 0.9 beside a bead still whole.

jest.mock('react-native-reanimated', () => require('./__fixtures__/uiThread').uiThreadMock());
jest.mock('@shopify/react-native-skia', () => require('../../RimLabels/__tests__/__fixtures__/skiaWords').skiaWordsMock());
const ui = (jest.requireMock('react-native-reanimated') as { __ui: UiThread }).__ui;
const skia = jest.requireMock('@shopify/react-native-skia') as { Group: unknown; Picture: unknown; __fake: SkiaWordsFake };

jest.useFakeTimers();
afterAll(() => jest.useRealTimers());

const D = 296;
const PLATE = plateGeometry({ base: BASE, direction: DIRECTIONS.abyss }, D, 1);
const WORDS: RimWords = { top: 'More energy', right: 'Pleasant', bottom: 'Less energy', left: 'Unpleasant' };
const A11Y: RimWords = { top: 'Top: more energy', right: 'Right: pleasant', bottom: 'Bottom: less energy', left: 'Left: unpleasant' };
const TOP = { x: 0, y: 1 };
const LEFT_OF_TOP = { x: -0.06, y: 1 };
const RIGHT_OF_TOP = { x: 0.06, y: 1 };
const FRAME = 16;

/** The page as the rulings wire it: one presence, its beads and looks to the rim words and to the bead layer. */
function Page({ taps, tier }: { readonly taps: readonly PlatePoint[]; readonly tier: MotionTier }) {
  const presence = useBeadPresence(taps, tier);
  return (
    <>
      <RimLabels diameter={D} fontScale={1} words={WORDS} a11y={A11Y} script="latin" beads={presence.beads} looks={presence.looks} />
      <BeadLayer beads={presence.beads} plate={PLATE} looks={presence.looks} />
    </>
  );
}

type Node = ReactTestRenderer.ReactTestInstance;
const flat = (n: Node) => (StyleSheet.flatten(n.props.style) ?? {}) as Record<string, unknown>;
/** A drawn value now: a number, or an animated node's current value. */
const now = (v: unknown): number => (typeof v === 'number' ? v : (v as { __getValue(): number }).__getValue());

function mount(taps: readonly PlatePoint[], tier: MotionTier = 'full') {
  const element = (t: readonly PlatePoint[], m: MotionTier) => (
    <DirectionProvider direction="abyss" face="dark">
      <Page taps={t} tier={m} />
    </DirectionProvider>
  );
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(element(taps, tier));
  });
  trees.add(tree);
  let shown = { taps, tier };
  const byId = (testID: string) => tree.root.findAll((n) => n.props.testID === testID);
  /** The opacity a node with this testID is drawn at, read live. */
  const opacityOf = (testID: string): number | null => {
    const nodes = byId(testID);
    if (nodes.length === 0) return null;
    const animated = nodes.map((n) => flat(n).opacity).find((o) => typeof o === 'object' && o !== null);
    return now(animated ?? flat(nodes[nodes.length - 1]).opacity);
  };
  const canvas = (position: string) => tree.root.find((n) => typeof n.type !== 'string' && n.props.testID === `hero.plate.word.${position}`);
  const groupOf = (n: Node, root: Node): Node | null => {
    for (let p = n.parent; p !== null && p !== root; p = p.parent) if (p.type === skia.Group) return p;
    return null;
  };
  /** The top word's returning layers: each one's letters and the opacity it is drawn at, read live. */
  const returning = (position = 'top') => {
    const root = canvas(position);
    return root
      .findAll((n) => n.type === skia.Picture)
      .filter((n) => groupOf(n, root) !== null)
      .map((n) => ({
        letters: (n.props.picture as { recording: { blobs: Array<{ ids: number[] }> } }).recording.blobs.flatMap((b) => b.ids),
        // The layer's paint carries the opacity (a Group's own opacity never reaches a Picture: RimLabels.test.tsx).
        opacity: () => (groupOf(n, root)!.props.layer as { props: { opacity: { value: number } } }).props.opacity.value,
      }));
  };
  const kept = (position = 'top') => {
    const root = canvas(position);
    return root
      .findAll((n) => n.type === skia.Picture)
      .filter((n) => groupOf(n, root) === null)
      .flatMap((n) => (n.props.picture as { recording: { blobs: Array<{ ids: number[] }> } }).recording.blobs.flatMap((b) => b.ids));
  };
  return {
    tree,
    update: (next: readonly PlatePoint[], nextTier: MotionTier = shown.tier) => {
      shown = { taps: next, tier: nextTier };
      act(() => tree.update(element(next, nextTier)));
    },
    /** The parent renders again with the very same props. */
    rerender: () => act(() => tree.update(element(shown.taps, shown.tier))),
    opacityOf,
    returning,
    kept,
  };
}
const trees = new Set<ReactTestRenderer.ReactTestRenderer>();
const activeCallbacks = () => ui.callbacks().filter((c) => c.active).length;

beforeEach(() => {
  ui.jsCalls.splice(0);
  skia.__fake.recordings.splice(0);
  skia.__fake.fonts.splice(0);
  for (const key of Object.keys(skia.__fake.canvasRenders)) delete skia.__fake.canvasRenders[key];
});
afterEach(() => {
  for (const tree of trees) act(() => tree.unmount());
  trees.clear();
  act(() => ui.flushJS());
  jest.clearAllTimers();
});

/**
 * One removal of the top bead with everything off JS held back by `d` ms: the samples of every frame until the bead is
 * gone. `base` is where the UI thread's timestamps start: any clock, not the JS one.
 */
function removal(d: number, base: (jsNow: number) => number = (t) => t) {
  const view = mount([TOP]);
  const a0 = view.opacityOf('hero.plate.bead.0')!;
  view.update([]);
  const [layer] = view.returning();
  const samples: Array<{ ms: number; bead: number; colour: number; letters: number }> = [];
  const leftAt = performance.now();
  // Nothing off JS moves for d ms: no frame is delivered, and no timer runs a motion.
  for (let ms = d; ms <= d + 2000; ms += FRAME) {
    ui.frame(base(leftAt) + ms);
    const bead = view.opacityOf('hero.plate.bead.leaving');
    if (bead === null) break;
    samples.push({ ms, bead, colour: view.opacityOf('bead.colour')!, letters: layer.opacity() });
    // JS and its timers move with the frames from here on, and hear what the UI thread sent.
    act(() => {
      jest.advanceTimersByTime(FRAME);
      ui.flushJS();
    });
  }
  return { view, a0, samples, layer };
}

/** The law's breaches over a removal's samples. */
function breaches({ a0, samples }: ReturnType<typeof removal>): string[] {
  const out: string[] = [];
  samples.forEach((s, i) => {
    const share = i === 0 ? 1 : samples[i - 1].bead / a0;
    if (Math.abs(s.letters - (1 - share)) > 1e-6) out.push(`${s.ms} ms: letters ${s.letters.toFixed(4)}, the bead was at ${(share * a0).toFixed(4)} of ${a0} the frame before`);
    if (s.letters > 1 - s.bead / a0 + 1e-6) out.push(`${s.ms} ms: letters ${s.letters.toFixed(4)} ahead of a bead at ${s.bead.toFixed(4)} of ${a0}`);
    if (s.letters > 0 && s.colour !== 0) out.push(`${s.ms} ms: letters ${s.letters.toFixed(4)} beside a bead in colour (${s.colour.toFixed(4)})`);
  });
  return out;
}

describe('T2: a removal whose motion starts late: the letters are the bead’s own fade, one frame behind, at every frame', () => {
  it.each([0, 16, 100, 300, 1000])('held back %p ms: letters === 1 − the bead’s opacity the frame before ÷ its start, never ahead of it, and above 0 only once its colour is 0', (d) => {
    const run = removal(d);
    expect(run.a0).toBe(1);
    expect(breaches(run)).toEqual([]);
    // The exit is played whole from its first frame: the bead as it was, then the grey fade, never a jump.
    expect(run.samples[0]).toMatchObject({ bead: 1, colour: 1, letters: 0 });
    expect(run.samples.filter((s) => s.bead > 0.05 && s.bead < 0.95).length).toBeGreaterThanOrEqual(4);
    expect(run.samples.filter((s) => s.letters > 0.05 && s.letters < 0.95).length).toBeGreaterThanOrEqual(4);
    // When the bead is gone its letters are kept, whole, and nothing is left returning.
    expect(run.view.opacityOf('hero.plate.bead.leaving')).toBeNull();
    expect(run.view.returning()).toEqual([]);
    expect(run.view.kept()).toHaveLength(WORDS.top.length);
  });

  it('the UI thread’s clock need not be the JS clock: on any base the law holds', () => {
    for (const base of [() => 0, (t: number) => t + 86_400_000, (t: number) => t - 250]) expect(breaches(removal(300, base))).toEqual([]);
  });

  it('a glyph near two leaving beads follows the last of them; one near a live and a leaving bead stays out', () => {
    const view = mount([LEFT_OF_TOP, RIGHT_OF_TOP]);
    // The latest goes, the older stays: the letters near both stay out, in no returning layer.
    view.update([LEFT_OF_TOP]);
    const beside = view.returning();
    expect(beside).toHaveLength(1);
    const nearRightOnly = beside[0].letters;
    ui.frame(0);
    ui.frame(200);
    ui.frame(216);
    expect(beside[0].opacity()).toBeGreaterThan(0);
    // Now the older goes too, 200 ms into the first one's exit: three groups, and those near both follow the later bead.
    view.update([]);
    const groups = view.returning();
    expect(groups).toHaveLength(3);
    ui.frame(232);
    ui.frame(400);
    const first = view.opacityOf('hero.plate.bead.leaving');
    expect(first).not.toBeNull();
    const byLetters = (letters: number[]) => groups.find((g) => JSON.stringify(g.letters) === JSON.stringify(letters))!;
    const later = groups.filter((g) => g !== byLetters(nearRightOnly));
    const opacities = later.map((g) => g.opacity());
    // The two groups that follow the later bead (alone, or with the first) are equal, and behind the first bead's own.
    expect(opacities[0]).toBe(opacities[1]);
    expect(opacities[0]).toBeLessThan(byLetters(nearRightOnly).opacity());
    expect(byLetters(nearRightOnly).opacity()).toBeGreaterThan(0.5);
  });
});

describe('T5: between leave and gone, a parent’s re-render commits no word canvas', () => {
  it('equal props: no canvas renders again, and no picture is recorded again', () => {
    const view = mount([TOP]);
    view.update([]);
    ui.frame(0);
    ui.frame(120);
    const beadAt120 = view.opacityOf('hero.plate.bead.leaving')!;
    const renders = { ...skia.__fake.canvasRenders };
    const recorded = skia.__fake.recordings.length;
    expect(Object.keys(renders).sort()).toEqual(['hero.plate.word.bottom', 'hero.plate.word.left', 'hero.plate.word.right', 'hero.plate.word.top']);
    view.rerender();
    view.rerender();
    ui.frame(200);
    view.rerender();
    expect(skia.__fake.canvasRenders).toEqual(renders);
    expect(skia.__fake.recordings).toHaveLength(recorded);
    // The returning layer goes on with the bead through it all, a frame behind it: at 200 ms it shows the bead of 120 ms.
    const [layer] = view.returning();
    expect(beadAt120).toBeLessThan(1);
    expect(layer.opacity()).toBeCloseTo(1 - beadAt120, 9);
    expect(layer.opacity()).toBeLessThan(1 - view.opacityOf('hero.plate.bead.leaving')!);
  });

  it('a change that is real still commits: the word’s canvas renders once more with its new pictures', () => {
    const view = mount([TOP]);
    const renders = { ...skia.__fake.canvasRenders };
    view.update([]);
    expect(skia.__fake.canvasRenders['hero.plate.word.top']).toBe(renders['hero.plate.word.top'] + 1);
  });
});

describe('T6: the still tier', () => {
  it('no driver runs, the bead is whole in the frame it is placed and gone in the frame it is taken, and its letters are kept in that frame', () => {
    const view = mount([], 'still');
    view.update([TOP]);
    expect(view.opacityOf('hero.plate.bead.0')).toBe(1);
    expect(view.opacityOf('bead.colour')).toBe(1);
    expect(view.kept().length).toBeLessThan(WORDS.top.length);
    expect(activeCallbacks()).toBe(0);
    view.update([]);
    expect(view.opacityOf('hero.plate.bead.0')).toBeNull();
    expect(view.opacityOf('hero.plate.bead.leaving')).toBeNull();
    expect(view.returning()).toEqual([]);
    expect(view.kept()).toHaveLength(WORDS.top.length);
    expect(activeCallbacks()).toBe(0);
    ui.frame(0);
    ui.frame(16);
    expect(ui.jsCalls.length).toBe(0);
  });

  it('turning reduced motion on mid-exit ends it in that render: the letters are kept at once', () => {
    const view = mount([TOP]);
    view.update([]);
    ui.frame(0);
    ui.frame(150);
    view.update([], 'still');
    expect(view.opacityOf('hero.plate.bead.leaving')).toBeNull();
    expect(view.returning()).toEqual([]);
    expect(view.kept()).toHaveLength(WORDS.top.length);
  });
});
