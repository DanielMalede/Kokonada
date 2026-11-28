// A stateful fake of the part of Reanimated the beads' driver and its readers use, as Reanimated 4.5 behaves where it
// matters (node_modules/react-native-reanimated/src/hook/useFrameCallback.ts, frameCallback/FrameCallbackRegistryUI.ts):
//
//   · a shared value lives for the mount;
//   · a frame callback is registered in an effect keyed on its identity and autostart (a new identity unregisters the old
//     one), and only an active one runs, given each frame's timestamp;
//   · a derived value and an animated style are read live: each read runs its worklet on the shared values as they are,
//     so a test samples what the UI thread would draw in that frame with no React render in between;
//   · runOnJS is a hop: the call is queued on the UI thread and reaches JS later (flushJS), as on the device.
//
// Use it from a jest.mock factory: jest.mock('react-native-reanimated', () => require('<path>/uiThread').uiThreadMock()).
// The controls are the module's own `__ui`: jest.requireMock('react-native-reanimated').__ui.

export interface UiThread {
  /** One frame on the UI thread at `timestamp`: every active frame callback runs. JS hears nothing until flushJS(). */
  frame(timestamp: number): void;
  /** Deliver every queued runOnJS call, in order. Wrap it in act(). */
  flushJS(): void;
  /** The registered frame callbacks, each with whether it is active. */
  callbacks(): Array<{ fn: ((info: unknown) => void) & { __workletHash?: number; __closure?: Record<string, unknown> }; active: boolean }>;
  /** Every runOnJS call made so far, delivered or not: the function's name and its arguments. */
  readonly jsCalls: Array<{ name: string; args: unknown[] }>;
  /** How many runOnJS calls wait to be delivered. */
  pending(): number;
}

export function uiThreadMock() {
  const { useEffect, useRef } = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');
  type Entry = { fn: (info: unknown) => void; active: boolean; startTime: number | null; last: number | null };
  const registry = new Map<number, Entry>();
  const queue: Array<() => void> = [];
  const jsCalls: Array<{ name: string; args: unknown[] }> = [];
  let nextId = 1;

  const ui: UiThread = {
    frame(timestamp) {
      for (const entry of [...registry.values()]) {
        if (!entry.active) continue;
        const first = entry.startTime === null;
        if (first) entry.startTime = timestamp;
        entry.fn({ timestamp, timeSincePreviousFrame: first ? null : timestamp - entry.last!, timeSinceFirstFrame: timestamp - entry.startTime! });
        entry.last = timestamp;
      }
    },
    flushJS() {
      while (queue.length > 0) queue.shift()!();
    },
    callbacks: () => [...registry.values()].map((entry) => ({ fn: entry.fn, active: entry.active })),
    jsCalls,
    pending: () => queue.length,
  };

  /** An object whose every property is read live from `read()`: its keys are those of the first read. */
  const live = <T extends object>(read: () => T): T => {
    const out = {};
    for (const key of Object.keys(read())) Object.defineProperty(out, key, { enumerable: true, get: () => (read() as Record<string, unknown>)[key] });
    return out as T;
  };

  return {
    __esModule: true,
    default: { View },
    View,
    useSharedValue: <T,>(initial: T) => {
      const ref = useRef<{ value: T } | null>(null);
      if (ref.current === null) ref.current = { value: initial };
      return ref.current;
    },
    useDerivedValue: <T,>(fn: () => T) => {
      const latest = useRef(fn);
      latest.current = fn;
      const ref = useRef<{ readonly value: T } | null>(null);
      if (ref.current === null) ref.current = { get value() { return latest.current(); } };
      return ref.current;
    },
    useAnimatedStyle: <T extends object>(fn: () => T) => {
      const latest = useRef(fn);
      latest.current = fn;
      const ref = useRef<T | null>(null);
      if (ref.current === null) ref.current = live(() => latest.current());
      return ref.current;
    },
    withTiming: (to: unknown) => to,
    runOnJS: (fn: (...args: unknown[]) => void) => (...args: unknown[]) => {
      jsCalls.push({ name: fn.name, args });
      queue.push(() => fn(...args));
    },
    useFrameCallback: (fn: (info: unknown) => void, autostart = true) => {
      const ref = useRef<{ isActive: boolean; callbackId: number; setActive: (a: boolean) => void } | null>(null);
      if (ref.current === null) {
        const handle = {
          isActive: autostart,
          callbackId: -1,
          setActive(a: boolean) {
            const entry = registry.get(handle.callbackId);
            if (entry) {
              if (!a) entry.startTime = null;
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
        registry.set(id, { fn, active: false, startTime: null, last: null });
        handle.callbackId = id;
        handle.setActive(handle.isActive);
        return () => {
          registry.delete(id);
          handle.callbackId = -1;
        };
      }, [fn, autostart]);
      return ref.current;
    },
    __ui: ui,
  };
}
