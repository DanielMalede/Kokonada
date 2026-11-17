import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import {
  cancelAnimation, useDerivedValue, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming, type SharedValue,
} from 'react-native-reanimated';
import { useClock } from '@shopify/react-native-skia';
import { Animated } from 'react-native';
import { useRealtimeFieldClock, MAX_FRAME_DT_MS, type FieldClock } from '../../design/v2/clock/fieldClock';
import { useCalmPulse } from '../../design/system/useCalmPulse';
import { installMotionFakes, type MotionFakes } from '../motion';

// QA-046: Reanimated (useFrameCallback, withRepeat, cancelAnimation, useReducedMotion), the Skia clock
// and RN Animated loops are replaced by fakes that record active callbacks and loops and advance a
// controllable clock. The global stubs (jest.setup.js) evaluate a derived value once, draw no frame and
// give useClock a constant, so stillness and teardown cannot be observed under them (MB-044).
// Semantics kept from Reanimated 4.5.1 and Skia 2.6.9 (node_modules sources):
//   · a frame callback registers in an effect keyed on [callback, autostart]; its first frame after a
//     (re)activation has timeSincePreviousFrame null and timeSinceFirstFrame 0 (FrameCallbackRegistryUI);
//   · Skia's useClock IS useSharedValue + useFrameCallback(t => clock.value = t.timeSinceFirstFrame);
//   · a derived value / animated style re-runs when a shared value in its worklet closure changes;
//   · useSharedValue cancels its own animation on unmount; useReducedMotion is a static read.
// Pass rule: a planted clock subscription under reduced motion fails; a planted missing
// cancelAnimation on unmount fails.

let motion: MotionFakes;
beforeEach(() => { motion = installMotionFakes(); });
afterEach(() => { motion.restore(); });

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];
const render = (el: React.ReactElement) => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => { tree = ReactTestRenderer.create(el); });
  mounted.push(tree);
  return tree;
};
afterEach(() => { for (const t of mounted.splice(0)) { try { act(() => { t.unmount(); }); } catch { /* already unmounted */ } } });
const frames = (...dts: number[]) => act(() => { for (const dt of dts) motion.frame(dt); });

describe('QA-046 · frame callbacks (the real v2 field clock on the fake)', () => {
  function mountClock(active: boolean) {
    const seen: { clock?: FieldClock } = {};
    const Probe = ({ on }: { on: boolean }) => { seen.clock = useRealtimeFieldClock(6000, on); return null; };
    const tree = render(<Probe on={active} />);
    return { seen, setActive: (on: boolean) => act(() => tree.update(<Probe on={on} />)), tree };
  }

  it('advances on frames while active; the first frame after it starts carries no dt', () => {
    const { seen } = mountClock(true);
    frames(16, 16, 16, 16);
    expect(seen.clock!.t.value).toBe(48);
    expect(motion.activeFrameCallbacks()).toBe(1);
  });

  it('pauses while inactive (0 active callbacks) and does not jump on the first frame back', () => {
    const { seen, setActive } = mountClock(true);
    frames(16, 16);
    setActive(false);
    expect(motion.activeFrameCallbacks()).toBe(0);
    frames(16, 16);
    expect(seen.clock!.t.value).toBe(16);
    setActive(true);
    frames(30000, 30000);
    expect(seen.clock!.t.value).toBe(16 + MAX_FRAME_DT_MS);
  });

  it('unregisters on unmount', () => {
    const { tree } = mountClock(true);
    act(() => { tree.unmount(); });
    expect(motion.activeFrameCallbacks()).toBe(0);
    expect(motion.registeredFrameCallbacks()).toBe(0);
  });
});

describe('QA-046 · the Skia clock, derived values and reduced motion', () => {
  function Live() {
    const clock = useClock();
    const phase = useDerivedValue(() => clock.value / 1000);
    return <Text>{String(phase.value)}</Text>;
  }

  it('useClock subscribes one frame callback whose value is the time since its first frame', () => {
    let clock!: SharedValue<number>;
    const Probe = () => { clock = useClock(); return null; };
    render(<Probe />);
    expect(motion.clockSubscriptions()).toBe(1);
    frames(16, 16, 16);
    expect(clock.value).toBe(32);
  });

  it('a derived value whose closure holds the clock re-runs on every frame', () => {
    render(<Live />);
    frames(16);
    frames(16);
    expect(motion.mapperRunsLastFrame()).toBe(1);
  });

  // The planted defect: the field subscribes the clock even when reduced motion asks for stillness.
  function PlantedField({ reduced }: { reduced: boolean }) {
    const clock = useClock();
    const pose = useDerivedValue(() => (reduced ? 0 : clock.value));
    return <Text>{String(pose.value)}</Text>;
  }
  // The compliant field: under reduced motion it never mounts the clock.
  function StillField({ reduced }: { reduced: boolean }) {
    return reduced ? <Text>still</Text> : <Live />;
  }

  it('planted: a clock subscription under reduced motion fails the stillness check', () => {
    render(<PlantedField reduced />);
    expect(motion.clockSubscriptions()).toBe(1);
    expect(() => motion.assertStill()).toThrow(/Skia clock subscriptions: 1/);
    // and the derived pose re-runs every frame although it can never change (MB-044's mechanism)
    expect(motion.visualWork().mapperRunsPerFrame).toBe(1);
  });

  it('the compliant field under reduced motion does no visual work', () => {
    render(<StillField reduced />);
    expect(() => motion.assertStill()).not.toThrow();
    expect(motion.visualWork()).toEqual({ frameCallbacks: 0, clockSubscriptions: 0, animations: 0, nativeAnimations: 0, loops: 0, mapperRunsPerFrame: 0 });
  });

  it('useReducedMotion is the static system read, scripted before render', () => {
    motion.setReducedMotion(true);
    let seen: boolean | undefined;
    const Probe = () => { seen = useReducedMotion(); return null; };
    render(<Probe />);
    expect(seen).toBe(true);
  });
});

describe('QA-046 · Reanimated animations and cancelAnimation', () => {
  function Breath({ sv, cancelOnUnmount }: { sv: SharedValue<number>; cancelOnUnmount: boolean }) {
    useEffect(() => {
      sv.value = withRepeat(withTiming(1, { duration: 1000 }), -1, true);
      return cancelOnUnmount ? () => cancelAnimation(sv) : undefined;
    }, [sv, cancelOnUnmount]);
    return null;
  }
  // The parent owns the shared value and stays mounted; the child that animates it unmounts.
  function Host({ show, cancelOnUnmount }: { show: boolean; cancelOnUnmount: boolean }) {
    const sv = useSharedValue(0);
    return show ? <Breath sv={sv} cancelOnUnmount={cancelOnUnmount} /> : null;
  }

  it('withRepeat(withTiming) runs on frames, reversing each period', () => {
    let sv!: SharedValue<number>;
    const Probe = () => {
      sv = useSharedValue(0);
      useEffect(() => { sv.value = withRepeat(withTiming(1, { duration: 100 }), -1, true); }, []);
      return null;
    };
    render(<Probe />);
    frames(50);
    expect(sv.value).toBeCloseTo(0.5, 5);
    frames(50, 50);
    expect(sv.value).toBeCloseTo(0.5, 5); // on its way back down
    expect(motion.activeAnimations()).toBe(1);
  });

  it('withTiming finishes, calls back with finished=true, and stops counting', () => {
    let sv!: SharedValue<number>;
    const done = jest.fn();
    const Probe = () => { sv = useSharedValue(0); useEffect(() => { sv.value = withTiming(1, { duration: 100 }, done); }, []); return null; };
    render(<Probe />);
    frames(60, 60);
    expect(sv.value).toBe(1);
    expect(done).toHaveBeenCalledWith(true);
    expect(motion.activeAnimations()).toBe(0);
  });

  it('a child that cancels the parent-owned animation on unmount leaves nothing running', () => {
    const tree = render(<Host show cancelOnUnmount />);
    frames(16);
    expect(motion.activeAnimations()).toBe(1);
    act(() => { tree.update(<Host show={false} cancelOnUnmount />); });
    expect(motion.activeAnimations()).toBe(0);
  });

  it('planted: a missing cancelAnimation on unmount leaves the loop running, and the stillness check fails', () => {
    const tree = render(<Host show cancelOnUnmount={false} />);
    frames(16);
    act(() => { tree.update(<Host show={false} cancelOnUnmount={false} />); });
    frames(16);
    expect(motion.activeAnimations()).toBe(1);
    expect(() => motion.assertStill()).toThrow(/Reanimated animations: 1/);
  });

  // RA-235-2: a zero-length iteration must yield the frame, whatever its shape. A sequence or a delay has
  // no duration of its own, so a guard that read `duration` let the reduced-motion shape spin forever
  // inside one frame (synchronously: jest's timeout cannot fire). The spin counter turns that hang into
  // a thrown error: it counts reads of the one field every new iteration reads.
  const spinGuard = <T extends object>(target: T, key: string): T => {
    let spins = 0;
    return new Proxy(target, {
      get(t, k, r) {
        if (k === key && ++spins > 10_000) throw new Error('RA-235-2: the repeat stepper spun without yielding');
        return Reflect.get(t, k, r);
      },
    });
  };
  const repeatOn = (make: () => unknown, reps: number, reverse = false) => {
    let sv!: SharedValue<number>;
    const Probe = () => {
      sv = useSharedValue(0);
      useEffect(() => { sv.value = withRepeat(make() as never, reps, reverse); }, []);
      return null;
    };
    render(<Probe />);
    return () => sv;
  };

  it.each([false, true])('withRepeat(withSequence(withTiming(1, 0 ms), withTiming(0, 0 ms)), -1, reverse=%s) yields every frame', (reverse) => {
    repeatOn(() => {
      const seq = withSequence(withTiming(1, { duration: 0 }), withTiming(0, { duration: 0 })) as unknown as { inners: unknown[] };
      seq.inners = spinGuard(seq.inners, '0');
      return seq;
    }, -1, reverse);
    expect(() => frames(16, 16)).not.toThrow();
    expect(motion.activeAnimations()).toBe(1);
  });

  it('withRepeat(withDelay(0, withTiming(1, 0 ms)), -1) yields every frame', () => {
    repeatOn(() => spinGuard(withDelay(0, withTiming(1, { duration: 0 })) as object, 'inner'), -1);
    expect(() => frames(16, 16)).not.toThrow();
    expect(motion.activeAnimations()).toBe(1);
  });

  it('a finite repeat of a zero-length sequence still finishes, one iteration per frame', () => {
    const sv = repeatOn(() => withSequence(withTiming(1, { duration: 0 }), withTiming(0.5, { duration: 0 })), 3);
    frames(16);
    expect(motion.activeAnimations()).toBe(1);
    frames(16, 16);
    expect(motion.activeAnimations()).toBe(0);
    expect(sv().value).toBe(0.5);
  });

  // Reanimated's repeat (animation/repeat.ts) completes at most one iteration per frame: on the frame an
  // iteration finishes it publishes that iteration's end value, restarts the inner animation at `now`
  // and returns false. It never catches up several iterations inside one long frame.
  it('a timed repeat completes one iteration per frame and shows its end value on that frame', () => {
    const sv = repeatOn(() => withTiming(1, { duration: 100 }), 3);
    frames(250);
    expect(sv().value).toBe(1);
    expect(motion.activeAnimations()).toBe(1);
    frames(50);
    expect(sv().value).toBeCloseTo(0.5, 5); // iteration 2 restarted from 0 at t=250
  });

  it('a shared value owned by the unmounting component is cancelled by useSharedValue itself (Reanimated 4)', () => {
    const Own = () => { const sv = useSharedValue(0); useEffect(() => { sv.value = withRepeat(withTiming(1, { duration: 500 }), -1); }, [sv]); return null; };
    const tree = render(<Own />);
    frames(16);
    expect(motion.activeAnimations()).toBe(1);
    act(() => { tree.unmount(); });
    expect(motion.activeAnimations()).toBe(0);
  });
});

describe('QA-046 · RN Animated loops', () => {
  function Pulse({ reduced }: { reduced: boolean }) {
    const v = useCalmPulse(reduced, 2000, { rest: 0.3, peak: 1, still: 0.6 });
    return <Text>{typeof v === 'number' ? 'still' : 'breathing'}</Text>;
  }

  it('counts the real useCalmPulse loop while mounted, and its stop on unmount', () => {
    const tree = render(<Pulse reduced={false} />);
    expect(motion.activeLoops()).toBe(1);
    act(() => { tree.unmount(); });
    expect(motion.activeLoops()).toBe(0);
  });

  it('a native-driven infinite loop keeps running across frames (the preset would end it after 16 ms)', () => {
    render(<Pulse reduced={false} />);
    frames(...Array.from({ length: 300 }, () => 16)); // 4.8 s: more than two full 2 s periods
    expect(motion.activeLoops()).toBe(1);
    expect(motion.activeNativeAnimations()).toBe(1);
  });

  it('a native-driven timing completes on the motion clock and calls back finished=true', () => {
    const done = jest.fn();
    const v = new Animated.Value(0);
    act(() => { Animated.timing(v, { toValue: 1, duration: 100, useNativeDriver: true }).start(done); });
    expect(motion.activeNativeAnimations()).toBe(1);
    frames(50);
    expect(done).not.toHaveBeenCalled();
    frames(60);
    expect(done).toHaveBeenCalledWith({ finished: true });
    expect(motion.activeNativeAnimations()).toBe(0);
  });

  it('useCalmPulse under reduced motion starts no loop', () => {
    render(<Pulse reduced />);
    expect(motion.activeLoops()).toBe(0);
  });

  it('planted: a loop started without a stop on unmount is still running, and the check fails', () => {
    function Leaky() {
      const [t] = useState(() => new Animated.Value(0));
      useEffect(() => {
        Animated.loop(Animated.timing(t, { toValue: 1, duration: 500, useNativeDriver: true })).start();
      }, [t]);
      return null;
    }
    const tree = render(<Leaky />);
    act(() => { tree.unmount(); });
    expect(motion.activeLoops()).toBe(1);
    expect(() => motion.assertStill()).toThrow(/RN Animated loops: 1/);
  });
});

describe('QA-046 · restore', () => {
  it('puts the global stubs back by identity', () => {
    const reanimated = require('react-native-reanimated');
    const skia = require('@shopify/react-native-skia');
    motion.restore();
    const before = { a: reanimated.useFrameCallback, b: reanimated.useDerivedValue, c: skia.useClock, d: Animated.loop };
    const again = installMotionFakes();
    expect(reanimated.useFrameCallback).not.toBe(before.a);
    again.restore();
    expect({ a: reanimated.useFrameCallback, b: reanimated.useDerivedValue, c: skia.useClock, d: Animated.loop }).toEqual(before);
    expect(reanimated.withRepeat).toBeUndefined(); // the global stub never had it
    motion = installMotionFakes();
  });
});
