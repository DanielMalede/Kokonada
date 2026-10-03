import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { advanceFieldTime, MAX_FRAME_DT_MS, useRealtimeFieldClock, type FieldClock } from '../fieldClock';

// MB-085. The real-time field clock is a SharedValue that a frame callback advances on the UI
// thread. Its laws:
//   · dt is clamped (MAX_FRAME_DT_MS), so a return from the background does not jump the field;
//   · it pauses while the field is not active (the frame callback is switched off);
//   · it wraps modulo the master period T, so t never grows without bound or loses precision;
//   · it only moves forward: a negative, missing or non-finite dt adds nothing.
//
// The global Reanimated mock (jest.setup.js) draws no frames. This file replaces it with a small
// stateful fake that keeps SharedValues across renders and runs only ACTIVE frame callbacks, which
// is the part of Reanimated these laws depend on.
jest.mock('react-native-reanimated', () => {
  const { useRef } = require('react');
  const callbacks = new Set<{ fn: (info: unknown) => void; handle: { isActive: boolean } }>();
  return {
    useSharedValue: (initial: number) => {
      const ref = useRef(null as null | { value: number });
      if (ref.current === null) ref.current = { value: initial };
      return ref.current;
    },
    useFrameCallback: (fn: (info: unknown) => void, autostart = true) => {
      const ref = useRef(null as null | { fn: (info: unknown) => void; handle: { isActive: boolean; setActive(a: boolean): void } });
      if (ref.current === null) {
        const entry = { fn, handle: { isActive: autostart, setActive(a: boolean) { entry.handle.isActive = a; } } };
        ref.current = entry;
        callbacks.add(entry);
      }
      ref.current.fn = fn;
      return ref.current.handle;
    },
    __frame: (timeSincePreviousFrame: number | null) => {
      for (const c of callbacks) if (c.handle.isActive) c.fn({ timestamp: 0, timeSincePreviousFrame, timeSinceFirstFrame: 0 });
    },
    __reset: () => callbacks.clear(),
  };
});
const reanimated = require('react-native-reanimated') as { __frame(dt: number | null): void; __reset(): void };

describe('advanceFieldTime (the worklet the frame callback runs)', () => {
  const T = 6000;

  it('adds a normal frame', () => {
    expect(advanceFieldTime(100, 16, T)).toBe(116);
  });

  it('clamps a long frame (a return from the background) to MAX_FRAME_DT_MS', () => {
    expect(MAX_FRAME_DT_MS).toBeLessThanOrEqual(100);
    expect(advanceFieldTime(100, 30000, T)).toBe(100 + MAX_FRAME_DT_MS);
  });

  it('only moves forward: a negative, missing or non-finite dt adds nothing', () => {
    expect(advanceFieldTime(100, -16, T)).toBe(100);
    expect(advanceFieldTime(100, null, T)).toBe(100);
    expect(advanceFieldTime(100, NaN, T)).toBe(100);
    expect(advanceFieldTime(100, Infinity, T)).toBe(100);
  });

  it('wraps modulo T, landing on 0 rather than T', () => {
    expect(advanceFieldTime(5990, 16, T)).toBe(6);
    expect(advanceFieldTime(5984, 16, T)).toBe(0);
  });

  it('repairs a poisoned t (NaN, negative, past T) instead of carrying it forward', () => {
    expect(advanceFieldTime(NaN, 16, T)).toBe(16);
    expect(advanceFieldTime(-5, 16, T)).toBe(16);
    expect(advanceFieldTime(9000, 0, T)).toBe(3000);
  });

  it('holds at 0 for a period that is not a positive finite number', () => {
    expect(advanceFieldTime(100, 16, 0)).toBe(0);
    expect(advanceFieldTime(100, 16, NaN)).toBe(0);
  });
});

describe('useRealtimeFieldClock', () => {
  afterEach(() => reanimated.__reset());

  function mount(active: boolean) {
    const seen: { clock?: FieldClock } = {};
    const Probe = ({ on }: { on: boolean }) => {
      seen.clock = useRealtimeFieldClock(6000, on);
      return null;
    };
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => { tree = ReactTestRenderer.create(<Probe on={active} />); });
    return { seen, setActive: (on: boolean) => act(() => tree.update(<Probe on={on} />)), unmount: () => act(() => tree.unmount()) };
  }

  it('advances on frames while active', () => {
    const { seen } = mount(true);
    act(() => { reanimated.__frame(16); reanimated.__frame(16); reanimated.__frame(16); });
    expect(seen.clock!.t.value).toBe(48);
  });

  it('pauses while inactive, and does not jump on the first frame back', () => {
    const { seen, setActive } = mount(true);
    act(() => { reanimated.__frame(16); });
    setActive(false);
    act(() => { reanimated.__frame(16); reanimated.__frame(16); });
    expect(seen.clock!.t.value).toBe(16);
    setActive(true);
    act(() => { reanimated.__frame(null); reanimated.__frame(30000); });
    expect(seen.clock!.t.value).toBe(16 + MAX_FRAME_DT_MS);
  });

  it('starts paused when mounted inactive', () => {
    const { seen } = mount(false);
    act(() => { reanimated.__frame(16); });
    expect(seen.clock!.t.value).toBe(0);
  });
});
