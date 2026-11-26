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
// own compressed time (exitPlayMs), and its native clock started later still (the op queue flushed behind the re-render;
// 27f2bee's capture: the letters whole while the bead was opaque, in both removals). One source of truth: the presence
// entry carries when the bead's native clock really started and how long it plays (Bead reads both off the clock's own
// first moving value), and beadOpacityAt reads the exit on that time, so the letters are never ahead of the bead.
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

describe('a leaving bead and the letters it knocked out answer to one exit, however late its view and its native clock start it', () => {
  // [how long the bead had been entering when it was taken (null: whole), how late its exit's effect ran, and how much
  // later still the native driver started its clock (the device: the op queue flushed behind a re-render)]
  const cases: Array<[number | null, number, number]> = [
    [null, 0, 0],
    [null, 60, 0],
    [null, 300, 0],
    [null, 0, 250],
    [null, 150, 120],
    [null, 300, 300],
    [null, 10_000, 120],
    [40, 300, 200],
  ];
  it.each(cases)('entered %p ms, effect %p ms late, native clock %p ms later: the letters are never ahead of the bead, and in step once it moves', (entered, lateMs, nativeDelay) => {
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
    const effectAt = leftAt + lateMs;
    expect(performance.now()).toBe(effectAt);
    const start = entered === null ? 1 : entranceOpacity(entered);
    const leaving = () => r.seen[r.seen.length - 1].find((b) => b.leaving)!;
    expect(leaving()).toMatchObject({ leftAt, startOpacity: start });

    // Bead's exit clock, played by the native driver from nativeStart, linearly over the length Bead gave it. In jest the
    // native driver is inert: each value is pushed at its own time, as the driver's value updates reach JS.
    const exitCall = timing.mock.calls.filter(([, config]) => config.toValue === exitDuration(start)).pop()!;
    expect(exitCall).toBeDefined();
    const [clock, config] = exitCall;
    expect(config.duration).toBe(exitPlayMs(start, lateMs));
    const end = exitDuration(start);
    const nativeStart = effectAt + nativeDelay;
    const nativeClockAt = (t: number) => end * Math.min(1, Math.max(0, (t - nativeStart) / config.duration));

    let returned = 0;
    let inStep = 0;
    const STEP = 4;
    for (let t = effectAt; t <= nativeStart + config.duration + 40; t += STEP) {
      if (t > effectAt) {
        act(() => {
          jest.advanceTimersByTime(STEP);
        });
      }
      act(() => clock.setValue(nativeClockAt(t)));
      const bead = drawnOpacity(r.tree);
      const bound = 1 - bead / start;
      const letters = returningOpacity([leaving()], t, beadOpacityAt);
      if (letters > bound + 0.002) expect({ t: t - leftAt, letters, bead }).toEqual({ t: t - leftAt, letters: `at most ${bound}`, bead });
      if (Math.abs(letters - bound) < 0.002) inStep++;
      if (letters > 0.5) returned++;
    }
    // In step, not merely held out: once the clock moves the letters come back exactly as the bead goes, and they are whole at its end.
    expect(inStep).toBeGreaterThan((config.duration + 40) / STEP - 2);
    expect(returned).toBeGreaterThan(10);
    expect(returningOpacity([leaving()], nativeStart + config.duration, beadOpacityAt)).toBe(1);
  });
});
