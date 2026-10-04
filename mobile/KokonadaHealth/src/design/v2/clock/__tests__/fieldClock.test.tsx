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
// The global Reanimated mock (jest.setup.js) draws no frames. This file replaces it with a stateful
// fake that behaves as Reanimated 4 does where these laws depend on it
// (node_modules/react-native-reanimated/src/hook/useFrameCallback.ts and
// frameCallback/FrameCallbackRegistryUI.ts):
//   · SharedValues keep their value across renders;
//   · a frame callback is registered in an effect keyed on its identity and autostart, so a NEW
//     callback identity unregisters the old one and registers again;
//   · the first frame after a registration or a re-activation has timeSincePreviousFrame: null;
//   · only active callbacks run.
jest.mock('react-native-reanimated', () => {
  const { useEffect, useRef } = require('react');
  const registry = new Map<number, { fn: (info: unknown) => void; active: boolean; fresh: boolean }>();
  let nextId = 1;
  return {
    useSharedValue: (initial: number) => {
      const ref = useRef(null as null | { value: number });
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
              if (a && !entry.active) entry.fresh = true;
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
        registry.set(id, { fn, active: false, fresh: true });
        handle.callbackId = id;
        handle.setActive(handle.isActive);
        return () => { registry.delete(id); handle.callbackId = -1; };
      }, [fn, autostart]);
      return ref.current;
    },
    __frame: (dt: number) => {
      for (const entry of registry.values()) {
        if (!entry.active) continue;
        const timeSincePreviousFrame = entry.fresh ? null : dt;
        entry.fresh = false;
        entry.fn({ timestamp: 0, timeSincePreviousFrame, timeSinceFirstFrame: 0 });
      }
    },
    __registrations: () => nextId - 1,
    __reset: () => registry.clear(),
  };
});
const reanimated = require('react-native-reanimated') as { __frame(dt: number): void; __registrations(): number; __reset(): void };

describe('advanceFieldTime (the worklet the frame callback runs)', () => {
  const T = 6000;

  it('adds a normal frame', () => {
    expect(advanceFieldTime(100, 16, T)).toBe(116);
  });

  it('clamps a long frame (a return from the background) to MAX_FRAME_DT_MS', () => {
    expect(MAX_FRAME_DT_MS).toBe(50); // motion.dtClamp in the V1 tokens (DSN-039)
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
    const Probe = ({ on }: { on: boolean; label?: string }) => {
      seen.clock = useRealtimeFieldClock(6000, on);
      return null;
    };
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => { tree = ReactTestRenderer.create(<Probe on={active} />); });
    return {
      seen,
      setActive: (on: boolean) => act(() => tree.update(<Probe on={on} />)),
      rerender: (label: string) => act(() => tree.update(<Probe on={active} label={label} />)),
      unmount: () => act(() => tree.unmount()),
    };
  }
  const frames = (...dts: number[]) => act(() => { for (const dt of dts) reanimated.__frame(dt); });

  it('advances on frames while active (the first frame after it starts carries no dt)', () => {
    const { seen } = mount(true);
    frames(16, 16, 16, 16);
    expect(seen.clock!.t.value).toBe(48);
  });

  it('pauses while inactive, and does not jump on the first frame back', () => {
    const { seen, setActive } = mount(true);
    frames(16, 16);
    setActive(false);
    frames(16, 16);
    expect(seen.clock!.t.value).toBe(16);
    setActive(true);
    frames(30000, 30000); // the first frame back has no dt; the next is clamped
    expect(seen.clock!.t.value).toBe(16 + MAX_FRAME_DT_MS);
  });

  it('a re-render with the same period loses no field time: the worklet keeps its identity', () => {
    const { seen, rerender } = mount(true);
    frames(16, 16, 16, 16);
    expect(seen.clock!.t.value).toBe(48);
    const registrations = reanimated.__registrations();
    rerender('an unrelated prop');
    frames(16);
    expect(reanimated.__registrations()).toBe(registrations);
    expect(seen.clock!.t.value).toBe(64);
  });

  it('starts paused when mounted inactive', () => {
    const { seen } = mount(false);
    act(() => { reanimated.__frame(16); });
    expect(seen.clock!.t.value).toBe(0);
  });
});
