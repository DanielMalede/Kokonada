import React, { useLayoutEffect, useRef } from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Animated, StyleSheet } from 'react-native';
import { DirectionProvider } from '../../../tokens/DirectionProvider.tsx';
import { BASE, DIRECTIONS } from '../../../tokens/tokens.generated.ts';
import { plateGeometry, type PlatePoint } from '../../Plate/geometry.ts';
import { returningOpacity } from '../../RimLabels/arc.ts';
import { BeadLayer } from '../BeadLayer.tsx';
import type { PresentBead } from '../beadPresence.ts';
import { beadOpacityAt, entranceOpacity, exitDuration, exitPlayMs } from '../beadTimeline.ts';
import { useBeadPresence } from '../useBeadPresence.ts';

// Ruling 2 under a loaded JS thread (F10 G8 round 2, removal 2 of knock-dark-latin, f207 to f209): the letters a
// leaving bead knocked out came back at full strength while the bead was still opaque. RimLabels read the exit on the
// model's clock from leftAt, while Bead, whose effect ran late, played the whole exit from where the bead was over its
// own compressed time (exitPlayMs). One source of truth: the presence entry carries when the bead's view really began
// its exit, and beadOpacityAt reads the exit on that compressed time, so the letters never show through the bead.
//
// The page's wiring, real: useBeadPresence's entries go to BeadLayer (its Beads report their exit's real start) and to
// the letters, whose opacity is RimLabels' own worklet, returningOpacity(beads, t, beadOpacityAt). The late effect is a
// layout effect that moves the fake clock between the render that stamps leftAt and Bead's passive effect.

jest.useFakeTimers();
afterAll(() => jest.useRealTimers());

const PLATE = plateGeometry({ base: BASE, direction: DIRECTIONS.abyss }, 300, 1);
const A = { x: 0.6, y: 0.6 };

let timing: jest.SpyInstance;
beforeEach(() => {
  timing = jest.spyOn(Animated, 'timing');
});
afterEach(() => {
  timing.mockRestore();
  jest.clearAllTimers();
});

interface Run {
  /** Every presence the page rendered, in order. */
  readonly seen: (readonly PresentBead[])[];
  readonly tree: ReactTestRenderer.ReactTestRenderer;
  readonly update: (taps: readonly PlatePoint[]) => void;
}

function run(taps: readonly PlatePoint[], late: { ms: number }): Run {
  const seen: (readonly PresentBead[])[] = [];
  function Page({ t }: { readonly t: readonly PlatePoint[] }) {
    const presence = useBeadPresence(t, 'full');
    seen.push(presence.beads);
    const first = useRef(true);
    useLayoutEffect(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      // The JS thread is busy between the commit and the passive effects: Bead's effect runs `late.ms` after leftAt.
      if (late.ms > 0) jest.advanceTimersByTime(late.ms);
    }, [t]);
    return <BeadLayer {...presence} plate={PLATE} />;
  }
  const element = (t: readonly PlatePoint[]) => (
    <DirectionProvider direction="abyss" face="dark">
      <Page t={t} />
    </DirectionProvider>
  );
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(element(taps));
  });
  return { seen, tree, update: (t) => act(() => tree.update(element(t))) };
}

const flat = (style: unknown) => (StyleSheet.flatten(style as never) ?? {}) as Record<string, any>;
const valueOf = (v: any): number => (typeof v === 'number' ? v : v.__getValue());
/** The leaving bead's opacity as drawn. */
const drawnOpacity = (tree: ReactTestRenderer.ReactTestRenderer) =>
  valueOf(flat(tree.root.findAll((n) => n.props.testID === 'hero.plate.bead.leaving' && typeof n.type !== 'string')[0].props.style).opacity);

describe('a leaving bead and the letters it knocked out answer to one exit, however late its view starts it', () => {
  // [how long the bead had been entering when it was taken (null: whole), how late its exit's effect ran]
  const cases: Array<[number | null, number]> = [
    [null, 0],
    [null, 60],
    [null, 150],
    [null, 300],
    [null, 600],
    [null, 10_000],
    [40, 300],
  ];
  it.each(cases)('entered %p ms, effect %p ms late: at every 0.25 ms the letters are 1 − bead ÷ start, never above it', (entered, lateMs) => {
    const late = { ms: 0 };
    const r = run(entered === null ? [A] : [], late);
    if (entered !== null) {
      r.update([A]);
      act(() => {
        jest.advanceTimersByTime(entered);
      });
    }
    late.ms = lateMs;
    const leftAt = performance.now();
    r.update([]);
    const playedFrom = leftAt + lateMs;
    expect(performance.now()).toBe(playedFrom);

    // The entry as the letters hold it before the bead's view started (the render that stamped leftAt), and after.
    const entries = r.seen.map((beads) => beads.find((b) => b.leaving)).filter((b): b is PresentBead => b !== undefined);
    expect(entries.length).toBeGreaterThanOrEqual(2);
    const before = entries[0];
    const after = entries[entries.length - 1];
    expect(before.leftAt).toBe(leftAt);
    const start = entered === null ? 1 : entranceOpacity(entered);
    expect(before.startOpacity).toBe(start);

    // Bead's exit clock: the native driver plays it linearly from where the effect started it.
    const exitCall = timing.mock.calls.filter(([, config]) => config.toValue === exitDuration(start)).pop()!;
    expect(exitCall).toBeDefined();
    const [clock, config] = exitCall;
    expect(config.duration).toBe(exitPlayMs(start, lateMs));
    const end = exitDuration(start);
    const nativeClockAt = (t: number) => end * Math.min(1, Math.max(0, (t - playedFrom) / config.duration));

    let returned = 0;
    for (let t = leftAt; t <= playedFrom + config.duration + 20; t += 0.25) {
      clock.setValue(nativeClockAt(t));
      const bead = drawnOpacity(r.tree);
      const bound = 1 - bead / start;
      for (const entry of t < playedFrom ? [before, after] : [after]) {
        const letters = returningOpacity([entry], t, beadOpacityAt);
        if (letters > bound + 0.002) expect({ t: t - leftAt, letters, bead }).toEqual({ t: t - leftAt, letters: bound, bead });
      }
      const letters = returningOpacity([after], t, beadOpacityAt);
      // In step, not merely held out: the letters come back exactly as the bead goes.
      expect(Math.abs(letters - bound)).toBeLessThan(0.002);
      if (letters > 0.5) returned++;
    }
    expect(returned).toBeGreaterThan(40);
    expect(returningOpacity([after], playedFrom + config.duration, beadOpacityAt)).toBe(1);
  });
});
