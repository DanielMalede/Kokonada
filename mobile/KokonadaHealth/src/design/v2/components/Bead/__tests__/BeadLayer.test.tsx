import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Animated, I18nManager, StyleSheet } from 'react-native';
import type { MotionTier } from '../../../motion/useMotionPolicy.ts';
import { DirectionProvider } from '../../../tokens/DirectionProvider.tsx';
import { BASE, DIRECTIONS } from '../../../tokens/tokens.generated.ts';
import { plateGeometry, pointToLocal } from '../../Plate/geometry.ts';
import { BeadLayer } from '../BeadLayer.tsx';

// The beads for the store's taps (oldest first): one Bead each, placed on the plate's LTR root, entering when
// placed and leaving when a fourth tap, an undo or a clear takes them (beadPresence.ts). Leaving beads draw
// under the live ones. The layer is inert: no touch, no accessibility node (PlateTouch owns both).

jest.useFakeTimers();
afterAll(() => jest.useRealTimers());

const D = 300;
const PLATE = plateGeometry({ base: BASE, direction: DIRECTIONS.abyss }, D, 1);
const A = { x: 0.6, y: 0.6 };
const B = { x: 0.6, y: -0.6 };
const C = { x: -0.6, y: -0.6 };
const E = { x: -0.6, y: 0.6 };

const element = (taps: ReadonlyArray<{ x: number; y: number }>, tier: MotionTier = 'full') => (
  <DirectionProvider direction="abyss" face="dark">
    <BeadLayer taps={taps} plate={PLATE} tier={tier} />
  </DirectionProvider>
);
function mount(taps: ReadonlyArray<{ x: number; y: number }>, tier: MotionTier = 'full') {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(element(taps, tier));
  });
  return tree;
}
const flat = (style: unknown) => (StyleSheet.flatten(style as never) ?? {}) as Record<string, any>;
const beads = (tree: ReactTestRenderer.ReactTestRenderer) => tree.root.findAll((n) => n.props.testID === 'bead' && typeof n.type === 'string');
/** Each drawn bead's centre, in the layer's dp, read back from its box. */
const centres = (tree: ReactTestRenderer.ReactTestRenderer) =>
  beads(tree).map((b) => {
    const s = flat(b.props.style);
    return { x: s.left + s.width / 2, y: s.top + s.height / 2 };
  });
const at = (p: { x: number; y: number }) => pointToLocal(p, PLATE);

let timing: jest.SpyInstance;
beforeEach(() => {
  timing = jest.spyOn(Animated, 'timing');
});
afterEach(() => {
  timing.mockRestore();
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
    expect(timing).not.toHaveBeenCalled();
  });

  it('a placed tap enters: one entrance, and the beads already there are untouched', () => {
    const tree = mount([A, B]);
    act(() => tree.update(element([A, B, C])));
    expect(centres(tree)).toEqual([at(A), at(B), at(C)]);
    expect(timing).toHaveBeenCalledTimes(1);
  });

  it('the same taps in a new array start nothing', () => {
    const tree = mount([A, B]);
    act(() => tree.update(element([{ ...A }, { ...B }])));
    expect(timing).not.toHaveBeenCalled();
    expect(centres(tree)).toEqual([at(A), at(B)]);
  });

  it('a fourth tap: the oldest leaves under the live beads, the new one enters; when its exit ends the oldest is gone', () => {
    const tree = mount([A, B, C]);
    act(() => tree.update(element([B, C, E])));
    expect(centres(tree)).toEqual([at(A), at(B), at(C), at(E)]);
    expect(timing).toHaveBeenCalledTimes(2);
    act(() => {
      jest.advanceTimersByTime(BASE.motion.settle.duration + 50);
    });
    expect(centres(tree)).toEqual([at(B), at(C), at(E)]);
  });

  it('undo takes the latest away, through its exit (drawn under the live bead while it leaves)', () => {
    const tree = mount([A, B]);
    act(() => tree.update(element([A])));
    expect(centres(tree)).toEqual([at(B), at(A)]);
    act(() => {
      jest.advanceTimersByTime(BASE.motion.settle.duration + 50);
    });
    expect(centres(tree)).toEqual([at(A)]);
  });

  it('clear takes every bead away, and the next tap enters on an empty plate', () => {
    const tree = mount([A, B, C]);
    act(() => tree.update(element([])));
    act(() => {
      jest.advanceTimersByTime(BASE.motion.settle.duration + 50);
    });
    expect(beads(tree)).toEqual([]);
    act(() => tree.update(element([E])));
    expect(centres(tree)).toEqual([at(E)]);
  });

  it('shows at most the newest three, as the field reads the store', () => {
    const tree = mount([A, B, C, E]);
    expect(centres(tree)).toEqual([at(B), at(C), at(E)]);
  });

  it('under reduced motion every exit is the 150 ms fade', () => {
    const tree = mount([A, B], 'still');
    act(() => tree.update(element([A], 'still')));
    expect(timing.mock.calls[0][1].duration).toBe(BASE.motion.fadeReduced.duration);
    act(() => {
      jest.advanceTimersByTime(BASE.motion.fadeReduced.duration + 20);
    });
    expect(centres(tree)).toEqual([at(A)]);
  });

  it('draws the same under RTL', () => {
    const ltr = mount([A, B, C]).toJSON();
    const rtl = jest.replaceProperty(I18nManager, 'isRTL', true);
    const flipped = mount([A, B, C]).toJSON();
    rtl.restore();
    expect(flipped).toEqual(ltr);
  });
});
