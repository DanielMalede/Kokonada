// QA-046: motion fakes that record active frame callbacks, animations, clocks and loops, and advance a
// controllable clock.
//
// The unit project's global stubs (jest.setup.js) evaluate a derived value once, draw no frame and give
// useClock a constant, so no test can see per-frame work, stillness or teardown (MB-044). These fakes
// replace those stub members by capture-and-restore (patch.ts) for the tests that opt in, keeping the
// semantics of the real libraries (Reanimated 4.5.1, Skia 2.6.9, read in node_modules):
//   · useFrameCallback registers in an effect keyed on [callback, autostart]; a callback's first
//     frame after (re)activation has timeSincePreviousFrame null and timeSinceFirstFrame 0, and
//     deactivation resets its start (frameCallback/FrameCallbackRegistryUI.ts);
//   · Skia's useClock IS useSharedValue + useFrameCallback(info => clock.value = info.timeSinceFirstFrame)
//     (external/reanimated/interpolators.ts:57-68), so it is built here from the fakes below;
//   · a write to a shared value notifies every listener, equal or not (mutables.ts `set _value`), and a
//     derived value / animated style re-runs when a shared value in its worklet closure changes
//     (useDerivedValue.ts: inputs = Object.values(updater.__closure)), on the next frame;
//   · assigning an animation to .value starts it at the current frame time; it advances on frames;
//     cancelAnimation stops it (callback finished=false); useSharedValue cancels its own animation on
//     unmount (useSharedValue.ts); useReducedMotion is a static read of the system setting (with the
//     platform fakes installed, their AccessibilityInfo reduceMotion is that setting).
// RN Animated with useNativeDriver: the preset's NativeAnimatedModule completes EVERY native animation
// after a 16 ms setTimeout and its stopAnimation cancels nothing (jest-preset/jest/mocks/NativeModules.js
// :96-99), so in jest a native-driven infinite Animated.loop "finishes" after 16 ms and a stopped one
// leaves a timer behind. Here a native animation runs on the motion clock instead: a frames config of
// n samples (round(duration/16.67) + 1, TimingAnimation) lasts (n - 1) x 1000/60 ms per iteration, iterations -1 never completes, and stopAnimation ends it
// with finished:false, as the native side does (Android NativeAnimatedNodesManager.stopAnimation).
// withSpring is modelled as an ease-out timing of config.duration (default 600 ms): spring physics are
// not reproduced, only "running until it settles", which is what stillness and teardown need.

import { useCallback, useEffect, useRef, useState } from 'react';
import * as RN from 'react-native';
import { Patcher } from './patch';
import { platformSource } from './platform';

const SV = Symbol('fake shared value');
const ANIM = Symbol('fake animation');

type Listener = () => void;
export interface FakeSharedValue<T = any> { value: T; get(): T; set(v: T | ((prev: T) => T)): void; modify(fn: (v: T) => T): void; [SV]: true }

type Anim = {
  [ANIM]: true;
  kind: 'timing' | 'spring' | 'repeat' | 'sequence' | 'delay';
  toValue?: number;
  duration?: number;
  easing?: (t: number) => number;
  inner?: Anim;
  inners?: Anim[];
  reps?: number;
  reverse?: boolean;
  delay?: number;
  callback?: (finished?: boolean) => void;
};
const isAnim = (v: unknown): v is Anim => typeof v === 'object' && v !== null && (v as Anim)[ANIM] === true;

// A running animation is a stepper: given the time now, it returns the value and whether it is done.
type Stepper = (now: number) => { value: number; done: boolean };

function makeStepper(anim: Anim, from: number, start: number): Stepper {
  switch (anim.kind) {
    case 'timing':
    case 'spring': {
      const to = anim.toValue ?? 0;
      const duration = Math.max(0, anim.duration ?? (anim.kind === 'spring' ? 600 : 300));
      const ease = anim.easing ?? (anim.kind === 'spring' ? (t: number) => 1 - (1 - t) ** 3 : (t: number) => t);
      return (now) => {
        const p = duration === 0 ? 1 : Math.min(1, Math.max(0, (now - start) / duration));
        return { value: p >= 1 ? to : from + (to - from) * ease(p), done: p >= 1 };
      };
    }
    case 'delay': {
      let inner: Stepper | null = null;
      const at = start + (anim.delay ?? 0);
      return (now) => {
        if (now < at) return { value: from, done: false };
        inner ??= makeStepper(anim.inner!, from, at);
        return inner(now);
      };
    }
    case 'sequence': {
      const list = anim.inners ?? [];
      let i = 0;
      let cur: Stepper | null = list.length ? makeStepper(list[0], from, start) : null;
      let value = from;
      return (now) => {
        while (cur) {
          const r = cur(now);
          value = r.value;
          if (!r.done) return { value, done: false };
          i += 1;
          cur = i < list.length ? makeStepper(list[i], value, now) : null;
        }
        return { value, done: true };
      };
    }
    case 'repeat': {
      const infinite = !(anim.reps != null && anim.reps > 0);
      const total = infinite ? Infinity : anim.reps!;
      let iteration = 0;
      let iterFrom = from;
      let cur = makeStepper(anim.inner!, iterFrom, start);
      let target = anim.inner!.toValue ?? 0;
      // As Reanimated's repeat (animation/repeat.ts): at most one iteration completes per frame. On that
      // frame the finished iteration's end value is shown and the next one starts at `now`, unstepped,
      // so no shape of inner animation (a zero-length sequence or delay included) can spin (RA-235-2).
      return (now) => {
        const r = cur(now);
        if (!r.done) return r;
        iteration += 1;
        if (iteration >= total) return { value: r.value, done: true };
        const next: Anim = anim.reverse ? { ...anim.inner!, toValue: iterFrom } : anim.inner!;
        const nextFrom = anim.reverse ? target : iterFrom;
        if (anim.reverse) { const t = target; target = iterFrom; iterFrom = t; }
        cur = makeStepper(next, nextFrom, now);
        return { value: r.value, done: false };
      };
    }
  }
}

export interface VisualWork { frameCallbacks: number; clockSubscriptions: number; animations: number; nativeAnimations: number; loops: number; mapperRunsPerFrame: number }

export interface MotionFakes {
  /** Advance one frame by dtMs (default 1000/60): frame callbacks, then animations, then dirty mappers. */
  frame(dtMs?: number): void;
  now(): number;
  setReducedMotion(reduced: boolean): void;
  activeFrameCallbacks(): number;
  registeredFrameCallbacks(): number;
  clockSubscriptions(): number;
  activeAnimations(): number;
  /** RN Animated animations running on the (faked) native driver. */
  activeNativeAnimations(): number;
  activeLoops(): number;
  mappers(): number;
  mapperRunsLastFrame(): number;
  /** The visual work in steady state, measured over two probe frames (the counts, and the mapper runs of the second). */
  visualWork(): VisualWork;
  /** Throws unless the steady-state visual work is zero. */
  assertStill(): void;
  restore(): void;
}

let installed = false;

export function installMotionFakes(): MotionFakes {
  if (installed) throw new Error('QA-046: motion fakes are already installed; restore() the previous install first.');
  installed = true;
  const patcher = new Patcher();
  let now = 0;
  let reducedMotion = false;

  // ── shared values, mappers, animations ────────────────────────────────────────────────────────
  const valueListeners = new Map<FakeSharedValue, Set<Listener>>();
  const running = new Map<FakeSharedValue, { step: Stepper; anim: Anim }>();
  const mappers = new Set<{ run: () => void; dirty: boolean }>();
  let mapperRuns = 0;

  const notify = (sv: FakeSharedValue) => { for (const l of valueListeners.get(sv) ?? []) l(); };
  const finish = (sv: FakeSharedValue, finished: boolean) => {
    const r = running.get(sv);
    if (!r) return;
    running.delete(sv);
    r.anim.callback?.(finished);
  };

  function makeMutable<T>(initial: T): FakeSharedValue<T> {
    let value = initial;
    const sv = {
      [SV]: true as const,
      get value() { return value; },
      set value(next: T) {
        if (isAnim(next)) {
          finish(sv, false);
          running.set(sv, { step: makeStepper(next, Number(value), now), anim: next });
          return;
        }
        finish(sv, false); // a plain write cancels a running animation, as in Reanimated
        value = next;
        notify(sv);
      },
      get() { return value; },
      set(v: T | ((prev: T) => T)) { sv.value = typeof v === 'function' ? (v as (p: T) => T)(value) : v; },
      modify(fn: (v: T) => T) { sv.value = fn(value); },
    } as FakeSharedValue<T>;
    // animations write through the raw setter (they must not cancel themselves)
    (sv as any).__write = (v: T) => { value = v; notify(sv); };
    return sv;
  }

  const isSV = (v: unknown): v is FakeSharedValue => typeof v === 'object' && v !== null && (v as FakeSharedValue)[SV] === true;
  // Reanimated's extractInputs: shared values found in the closure, through arrays and plain objects.
  const inputsOf = (fn: unknown, deps?: unknown[]): FakeSharedValue[] => {
    const out = new Set<FakeSharedValue>();
    const walk = (v: unknown, depth: number) => {
      if (isSV(v)) { out.add(v); return; }
      if (depth > 3 || v === null || typeof v !== 'object') return;
      if (Array.isArray(v)) { v.forEach((x) => walk(x, depth + 1)); return; }
      if (Object.getPrototypeOf(v) === Object.prototype) Object.values(v).forEach((x) => walk(x, depth + 1));
    };
    walk(Object.values((fn as { __closure?: Record<string, unknown> }).__closure ?? {}), 0);
    if (out.size === 0 && deps) walk(deps, 0);
    return [...out];
  };

  function useMapper(run: () => void, inputs: FakeSharedValue[], deps: unknown[]) {
    useEffect(() => {
      const m = { run, dirty: false };
      const mark = () => { m.dirty = true; };
      mappers.add(m);
      for (const sv of inputs) {
        if (!valueListeners.has(sv)) valueListeners.set(sv, new Set());
        valueListeners.get(sv)!.add(mark);
      }
      return () => {
        mappers.delete(m);
        for (const sv of inputs) valueListeners.get(sv)?.delete(mark);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed like Reanimated's own effect
    }, deps);
  }

  // ── frame callbacks ───────────────────────────────────────────────────────────────────────────
  type Cb = { fn: (info: unknown) => void; active: boolean; startTime: number | null; clock: boolean };
  const callbacks = new Map<number, Cb>();
  let nextCb = 1;
  let previousFrame: number | null = null;

  function useFrameCallbackImpl(fn: (info: unknown) => void, autostart = true, clock = false) {
    const ref = useRef<{ isActive: boolean; callbackId: number; setActive(a: boolean): void } | null>(null);
    if (ref.current === null) {
      const handle = {
        isActive: autostart,
        callbackId: -1,
        setActive(a: boolean) {
          const cb = callbacks.get(handle.callbackId);
          if (cb) {
            if (!a) cb.startTime = null;
            cb.active = a;
          }
          handle.isActive = a;
        },
      };
      ref.current = handle;
    }
    useEffect(() => {
      const handle = ref.current!;
      const id = nextCb++;
      callbacks.set(id, { fn, active: false, startTime: null, clock });
      handle.callbackId = id;
      handle.setActive(handle.isActive);
      return () => { callbacks.delete(id); handle.callbackId = -1; };
      // eslint-disable-next-line react-hooks/exhaustive-deps -- [callback, autostart], as Reanimated
    }, [fn, autostart]);
    return ref.current;
  }

  // ── the Reanimated stub members ───────────────────────────────────────────────────────────────
  const reanimated = require('react-native-reanimated') as Record<string, unknown>;
  const timing = (toValue: number, config: { duration?: number; easing?: (t: number) => number } = {}, callback?: (f?: boolean) => void): Anim =>
    ({ [ANIM]: true, kind: 'timing', toValue, duration: config.duration, easing: config.easing, callback });
  const members: Record<string, unknown> = {
    makeMutable,
    useSharedValue: <T,>(initial: T | (() => T)) => {
      const [sv] = useState(() => makeMutable(typeof initial === 'function' ? (initial as () => T)() : initial));
      useEffect(() => () => { finish(sv, false); }, [sv]); // Reanimated 4 cancels on unmount
      return sv;
    },
    useDerivedValue: <T,>(updater: () => T, deps?: unknown[]) => {
      const [sv] = useState(() => makeMutable(updater()));
      const inputs = inputsOf(updater, deps);
      const run = () => { mapperRuns += 1; (sv as any).__write(updater()); };
      useMapper(run, inputs, deps ?? [...inputs, (updater as { __workletHash?: number }).__workletHash]);
      return sv;
    },
    useAnimatedStyle: (updater: () => Record<string, unknown>, deps?: unknown[]) => {
      const [style] = useState(() => ({ ...updater() }));
      const inputs = inputsOf(updater, deps);
      const run = () => { mapperRuns += 1; Object.assign(style, updater()); };
      useMapper(run, inputs, deps ?? [...inputs, (updater as { __workletHash?: number }).__workletHash]);
      return style;
    },
    useAnimatedReaction: <T,>(prepare: () => T, react: (cur: T, prev: T | null) => void, deps?: unknown[]) => {
      const prev = useRef<T | null>(null);
      const inputs = inputsOf(prepare, deps);
      const run = () => {
        mapperRuns += 1;
        const cur = prepare();
        if (!Object.is(cur, prev.current)) { react(cur, prev.current); prev.current = cur; }
      };
      useMapper(run, inputs, deps ?? [...inputs, (prepare as { __workletHash?: number }).__workletHash]);
    },
    useFrameCallback: (fn: (info: unknown) => void, autostart = true) => useFrameCallbackImpl(fn, autostart, false),
    withTiming: timing,
    withSpring: (toValue: number, config: { duration?: number } = {}, callback?: (f?: boolean) => void): Anim =>
      ({ [ANIM]: true, kind: 'spring', toValue, duration: config.duration, callback }),
    withRepeat: (inner: Anim, reps = 2, reverse = false, callback?: (f?: boolean) => void): Anim =>
      ({ [ANIM]: true, kind: 'repeat', inner, reps, reverse, callback }),
    withSequence: (...inners: Anim[]): Anim => ({ [ANIM]: true, kind: 'sequence', inners }),
    withDelay: (delay: number, inner: Anim): Anim => ({ [ANIM]: true, kind: 'delay', delay, inner }),
    cancelAnimation: (sv: FakeSharedValue) => { finish(sv, false); },
    // One OS setting: with the platform fakes installed it lives in their AccessibilityInfo (RA-235-6).
    useReducedMotion: () => platformSource.current?.accessibility.get('reduceMotion') ?? reducedMotion,
    runOnJS: (fn: (...a: unknown[]) => unknown) => fn,
    runOnUI: (fn: (...a: unknown[]) => unknown) => fn,
    Easing: RN.Easing, // Reanimated's Easing mirrors RN's API
  };
  for (const [k, v] of Object.entries(members)) patcher.set(reanimated, k, v);

  // ── the Skia stub's useClock: exactly Skia's own implementation, on the fakes above ─────────
  const skia = require('@shopify/react-native-skia') as Record<string, unknown>;
  patcher.set(skia, 'useClock', () => {
    const clock = (members.useSharedValue as (v: number) => FakeSharedValue<number>)(0);
    const cb = useCallback((info: { timeSinceFirstFrame: number }) => { clock.value = info.timeSinceFirstFrame; }, [clock]);
    useFrameCallbackImpl(cb as (i: unknown) => void, true, true);
    return clock;
  });

  // ── RN Animated loops ─────────────────────────────────────────────────────────────────────────
  const loops = new Set<number>();
  const loopStops = new Map<number, () => void>();
  let nextLoop = 1;
  const realLoop = RN.Animated.loop;
  patcher.set(RN.Animated, 'loop', (animation: RN.Animated.CompositeAnimation, config?: Parameters<typeof RN.Animated.loop>[1]) => {
    const composite = realLoop(animation, config);
    const id = nextLoop++;
    loopStops.set(id, () => composite.stop());
    return {
      ...composite,
      start(cb?: (r: { finished: boolean }) => void) {
        loops.add(id);
        composite.start((r) => { loops.delete(id); cb?.(r); });
      },
      stop() { loops.delete(id); composite.stop(); },
      reset() { loops.delete(id); composite.reset(); },
    };
  });

  // ── RN Animated's native driver ──────────────────────────────────────────────────────────────────
  type NativeAnim = { endsAt: number; end?: (r: { finished: boolean }) => void };
  const nativeAnims = new Map<number, NativeAnim>();
  const nativeModule = (RN.NativeModules as Record<string, any>).NativeAnimatedModule as Record<string, unknown> | undefined;
  if (nativeModule) {
    const durationOf = (config: { type?: string; frames?: unknown[]; duration?: number }) =>
      config?.type === 'frames' && Array.isArray(config.frames) ? Math.max(0, config.frames.length - 1) * (1000 / 60) : (config?.duration ?? 600);
    patcher.set(nativeModule, 'startAnimatingNode', (id: number, _tag: number, config: { iterations?: number }, end?: (r: { finished: boolean }) => void) => {
      const iterations = config?.iterations ?? 1;
      const endsAt = iterations === -1 || !Number.isFinite(iterations) ? Infinity : now + durationOf(config as any) * Math.max(1, iterations);
      nativeAnims.set(id, { endsAt, end });
    });
    patcher.set(nativeModule, 'stopAnimation', (id: number) => {
      const a = nativeAnims.get(id);
      if (!a) return;
      nativeAnims.delete(id);
      a.end?.({ finished: false });
    });
  }

  // ── the clock ─────────────────────────────────────────────────────────────────────────────────
  let lastRuns = 0;
  const frame = (dt = 1000 / 60) => {
    now += dt;
    const runsBefore = mapperRuns;
    const delta = previousFrame === null ? dt : now - previousFrame;
    for (const cb of [...callbacks.values()]) {
      if (!cb.active) continue;
      if (cb.startTime === null) {
        cb.startTime = now;
        cb.fn({ timestamp: now, timeSincePreviousFrame: null, timeSinceFirstFrame: 0 });
      } else {
        cb.fn({ timestamp: now, timeSincePreviousFrame: delta, timeSinceFirstFrame: now - cb.startTime });
      }
    }
    previousFrame = [...callbacks.values()].some((c) => c.active) ? now : null;
    for (const [sv, r] of [...running]) {
      const { value, done } = r.step(now);
      (sv as any).__write(value);
      if (done) finish(sv, true);
    }
    for (const m of [...mappers]) if (m.dirty) { m.dirty = false; m.run(); }
    for (const [id, a] of [...nativeAnims]) if (a.endsAt <= now) { nativeAnims.delete(id); a.end?.({ finished: true }); }
    lastRuns = mapperRuns - runsBefore;
  };

  const counts = () => ({
    frameCallbacks: [...callbacks.values()].filter((c) => c.active).length,
    clockSubscriptions: [...callbacks.values()].filter((c) => c.active && c.clock).length,
    animations: running.size,
    nativeAnimations: nativeAnims.size,
    loops: loops.size,
  });

  const api: MotionFakes = {
    frame,
    now: () => now,
    setReducedMotion(v) {
      reducedMotion = v;
      // Production reads AccessibilityInfo (design/theme.ts useMotion), so the change reaches it too.
      platformSource.current?.accessibility.set('reduceMotion', v);
    },
    activeFrameCallbacks: () => counts().frameCallbacks,
    registeredFrameCallbacks: () => callbacks.size,
    clockSubscriptions: () => counts().clockSubscriptions,
    activeAnimations: () => running.size,
    activeNativeAnimations: () => nativeAnims.size,
    activeLoops: () => loops.size,
    mappers: () => mappers.size,
    mapperRunsLastFrame: () => lastRuns,
    visualWork() {
      frame();
      frame();
      return { ...counts(), mapperRunsPerFrame: lastRuns };
    },
    assertStill() {
      const w = api.visualWork();
      const lines = [
        w.frameCallbacks && `  frame callbacks: ${w.frameCallbacks}`,
        w.clockSubscriptions && `  Skia clock subscriptions: ${w.clockSubscriptions}`,
        w.animations && `  Reanimated animations: ${w.animations}`,
        w.nativeAnimations && `  RN Animated native-driver animations: ${w.nativeAnimations}`,
        w.loops && `  RN Animated loops: ${w.loops}`,
        w.mapperRunsPerFrame && `  derived values / animated styles re-run per frame: ${w.mapperRunsPerFrame}`,
      ].filter(Boolean);
      if (lines.length) throw new Error(`QA-046: visual work is still running:\n${lines.join('\n')}`);
    },
    restore() {
      // a loop a test leaked must not outlive it (it would keep scheduling frames and hold the process open)
      for (const id of [...loops]) { loops.delete(id); loopStops.get(id)?.(); }
      loopStops.clear();
      for (const sv of [...running.keys()]) running.delete(sv);
      nativeAnims.clear();
      patcher.restore();
      installed = false;
    },
  };
  return api;
}

/** Install the motion fakes around every test of the enclosing describe (or file). */
export function useMotionFakes(): () => MotionFakes {
  let current: MotionFakes | null = null;
  beforeEach(() => { current = installMotionFakes(); });
  afterEach(() => { current?.restore(); current = null; });
  return () => {
    if (!current) throw new Error('QA-046: the motion fakes are installed only inside a test.');
    return current;
  };
}
