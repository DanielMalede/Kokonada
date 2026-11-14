import React from 'react';
import { EventEmitter } from 'events';
import { View } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

// UI-223 (RA-36): READY says which surface drew a field scene, so a capture of the fallback can never pass as a capture
// of the field. End to end through the real LabRoot, FieldScene, FieldView, its builder (fieldStep) and FieldFallback:
//   · a field scene says `ready` when the field effect compiled and the builder ran, and `fallback`, with the reason,
//     when the effect could not draw (FieldScene reads the memoised effect) or the builder threw on the UI thread
//     (FieldFallback hands on the reason FieldView gives it; FieldView takes no lab-only knob);
//   · a fallback scene says `fallback-scene`: FieldFallback mounted by design;
//   · a scene that draws no field (smoke) says null;
//   · a field that falls back after its READY was sent is an ERROR: the READY no longer describes the screen.
// Only the UI thread and Skia are faked: the Reanimated fake is FieldScene.test.tsx's (SharedValues persist, a frame
// callback runs only while active, each frame on a rising timestamp), and Skia is inert, as in FieldView.test.tsx, so
// FieldFallback's real model runs on its real props. The builder is the real one; a test may plant a throw in it.
const ui = { timestamp: 0 };
jest.mock('react-native-reanimated', () => {
  const { useEffect, useRef } = require('react');
  const registry = new Map<number, { fn: (info: unknown) => void; active: boolean }>();
  let nextId = 1;
  return {
    View: require('react-native').View,
    useAnimatedStyle: (fn: () => unknown) => fn(),
    useSharedValue: (initial: unknown) => {
      const ref = useRef(null as null | { value: unknown });
      if (ref.current === null) ref.current = { value: initial };
      return ref.current;
    },
    useDerivedValue: (fn: () => unknown) => ({ get value() { return fn(); } }),
    runOnJS: (fn: (...args: unknown[]) => void) => (...args: unknown[]) => fn(...args),
    useFrameCallback: (fn: (info: unknown) => void, autostart = true) => {
      const ref = useRef(null as null | { isActive: boolean; callbackId: number; setActive: (a: boolean) => void });
      if (ref.current === null) {
        const handle = {
          isActive: autostart,
          callbackId: -1,
          setActive(a: boolean) {
            const entry = registry.get(handle.callbackId);
            if (entry) entry.active = a;
            handle.isActive = a;
          },
        };
        ref.current = handle;
      }
      useEffect(() => {
        const handle = ref.current!;
        const id = nextId;
        nextId += 1;
        registry.set(id, { fn, active: false });
        handle.callbackId = id;
        handle.setActive(handle.isActive);
        return () => { registry.delete(id); handle.callbackId = -1; };
      }, [fn, autostart]);
      return ref.current;
    },
    __frame: (dt: number) => {
      ui.timestamp += dt;
      for (const entry of [...registry.values()]) if (entry.active) entry.fn({ timestamp: ui.timestamp, timeSincePreviousFrame: dt, timeSinceFirstFrame: 0 });
    },
  };
});
const reanimated = require('react-native-reanimated') as { __frame(dt: number): void };

jest.mock('@shopify/react-native-skia', () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => children ?? null;
  const inert: unknown = new Proxy(function stub() {}, { get: () => inert, apply: () => inert });
  return {
    Canvas: Stub, Image: () => null, Picture: () => null,
    FilterMode: { Nearest: 0, Linear: 1 }, MipmapMode: { None: 0, Nearest: 1, Linear: 2 },
    ClipOp: { Difference: 0, Intersect: 1 }, TileMode: { Clamp: 0, Repeat: 1, Mirror: 2, Decal: 3 },
    Skia: inert,
  };
});

// The effect, as effect.ts gives it: ready, or the fallback with its reason.
const effectState: { status: 'ready' | 'fallback' } = { status: 'ready' };
jest.mock('../../v2/field/effect.ts', () => ({
  fieldEffect: () => (effectState.status === 'ready'
    ? { status: 'ready', effect: { name: 'effect' }, blueNoise: {}, blueNoiseShader: { name: 'noise' } }
    : { status: 'fallback', reason: 'the field shader did not compile' }),
}));

// The real builder; a test may plant a throw in it, as the UI thread would meet one.
const planted = { throw: false };
jest.mock('../../v2/field/fieldFrame.ts', () => {
  const actual = jest.requireActual('../../v2/field/fieldFrame.ts');
  return {
    ...actual,
    buildFieldFrame: (...args: unknown[]) => {
      if (planted.throw) throw new RangeError('planted builder throw');
      return actual.buildFieldFrame(...args);
    },
  };
});

import { FieldFallback } from '../../v2/field/FieldFallback';
import { FieldSurface } from '../../v2/field/FieldSurface';
import { LabRoot } from '../LabRoot';

function setup(scene: string, t = '11000') {
  const lines: string[] = [];
  const emitter = new EventEmitter();
  const frames = {
    queue: [] as Array<() => void>,
    next(cb: () => void) { frames.queue.push(cb); return () => { frames.queue = frames.queue.filter((x) => x !== cb); }; },
    tick(n = 1) { for (let i = 0; i < n; i += 1) { const due = frames.queue; frames.queue = []; due.forEach((cb) => cb()); } },
  };
  const events = {
    addListener: (name: string, cb: (e: unknown) => void) => { emitter.on(name, cb); return { remove: () => emitter.off(name, cb) }; },
  };
  // A fixed clock never asks the setting; it stays unknown, so nothing lands after the test.
  const reduceMotion = { current: () => new Promise<boolean>(() => {}), subscribe: () => () => {} };
  jest.spyOn(View.prototype as never as { measureInWindow(cb: unknown): void }, 'measureInWindow')
    .mockImplementation((cb: unknown) => (cb as (...v: number[]) => void)(0, 0, 411, 914));
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <LabRoot
        labArgs={{ run: 'r', scene, clock: 'fixed', t, frames: '3' }}
        nonStringKeys={[]}
        deps={{ emit: (l: string) => lines.push(l), frames, events, reduceMotion }}
      />,
    );
  });
  const of = (kind: string) => lines.filter((l) => l.startsWith(`KOKONADA_LAB ${kind} `)).map((l) => JSON.parse(l.slice(`KOKONADA_LAB ${kind} `.length)));
  /** The scene's own view gets its size: FieldView (or FieldFallback) mounts. */
  const sizeScene = (testID: string) => act(() => {
    tree.root.find((n) => n.props.testID === testID && typeof n.type !== 'string').props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 411, height: 914 } } });
  });
  /** Every probe is measured. */
  const measure = () => act(() => {
    for (const p of tree.root.findAll((n) => typeof n.type === 'string' && String(n.props.nativeID ?? '').startsWith('probe-'))) p.props.onLayout({ nativeEvent: { layout: {} } });
  });
  const uiFrames = (n: number) => { for (let i = 0; i < n; i++) act(() => reanimated.__frame(16)); };
  const tick = (n = 1) => act(() => frames.tick(n));
  return { tree, of, sizeScene, measure, uiFrames, tick };
}

const FIELD = 'field.abyss.dark.three.full';
const FALLBACK = 'fallback.abyss.dark.three';
const status = (ready: { shaderStatus?: unknown; shaderReason?: unknown }) => [ready.shaderStatus, ready.shaderReason];

beforeEach(() => {
  effectState.status = 'ready';
  planted.throw = false;
  ui.timestamp = 0;
});
afterEach(() => jest.restoreAllMocks());

describe('READY says which surface drew the scene (UI-223)', () => {
  it('a field scene drawn by the field shader: ready, and the field is on screen', () => {
    const h = setup(FIELD);
    h.sizeScene('field-scene.view');
    h.uiFrames(3);
    h.measure();
    h.tick(3);
    expect(h.tree.root.findAllByType(FieldSurface)).toHaveLength(1);
    expect(h.tree.root.findAllByType(FieldFallback)).toHaveLength(0);
    expect(h.of('READY').map(status)).toEqual([['ready', null]]);
    expect(h.of('ERROR')).toEqual([]);
  });

  it('the effect cannot draw (mocked to fallback): READY says fallback with the reason, before and after the field mounts', () => {
    effectState.status = 'fallback';
    const before = setup(FIELD);
    before.measure();
    before.tick(3);
    expect(before.of('READY').map(status)).toEqual([['fallback', 'the field shader did not compile']]);

    const after = setup(FIELD);
    after.sizeScene('field-scene.view');
    expect(after.tree.root.findAllByType(FieldFallback)).toHaveLength(1);
    after.measure();
    after.tick(3);
    expect(after.of('READY').map(status)).toEqual([['fallback', 'the field shader did not compile']]);
  });

  it('the builder throws on the UI thread: FieldView falls back, and READY says fallback with the builder\'s error', () => {
    planted.throw = true;
    const h = setup(FIELD);
    h.sizeScene('field-scene.view');
    h.uiFrames(1);
    expect(h.tree.root.findAllByType(FieldFallback)).toHaveLength(1);
    h.measure();
    h.tick(3);
    expect(h.of('READY').map(status)).toEqual([['fallback', 'RangeError: planted builder throw']]);
  });

  it('a fallback scene says it is the fallback by design', () => {
    const h = setup(FALLBACK);
    h.sizeScene('fallback-scene.view');
    expect(h.tree.root.findAllByType(FieldFallback)).toHaveLength(1);
    h.measure();
    h.tick(3);
    expect(h.of('READY').map((r) => r.shaderStatus)).toEqual(['fallback-scene']);
    expect(h.of('READY')[0].shaderReason).toMatch(/fallback scene/);
  });

  it('a scene that draws no field (smoke) says null', () => {
    const h = setup('smoke', '1500');
    h.measure();
    h.tick(3);
    expect(h.of('READY').map(status)).toEqual([[null, null]]);
  });

  it('a field that falls back after its READY was sent is an ERROR naming why: the READY no longer describes the screen', () => {
    const h = setup(FIELD);
    h.sizeScene('field-scene.view');
    h.uiFrames(2);
    h.measure();
    h.tick(3);
    expect(h.of('READY').map(status)).toEqual([['ready', null]]);
    planted.throw = true;
    h.uiFrames(1);
    expect(h.tree.root.findAllByType(FieldFallback)).toHaveLength(1);
    expect(h.of('ERROR')).toEqual([{ run: 'r', errors: [expect.stringMatching(/after READY.*ready.*fallback.*RangeError: planted builder throw/)] }]);
    expect(h.of('READY')).toHaveLength(1);
  });
});
