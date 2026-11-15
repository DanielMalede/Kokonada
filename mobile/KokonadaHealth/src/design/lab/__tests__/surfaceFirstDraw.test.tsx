import React from 'react';
import { EventEmitter } from 'events';
import { View } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

// RA-50 (S3): a scene that draws through FieldSurface (the witness and grain scenes) said `ready` from the effect's status
// alone, so a surface that never drew (Skia gives no offscreen surface, and renderFieldImage returns null) still passed
// as the field. Now each FieldSurface tells the nearest FieldSurfaceDrawReport, once its UI thread has rendered an image,
// and the scene says `pending` until every surface it mounted has: LabRoot sends no READY while a scene is pending.
// The app mounts no listener, and then FieldSurface mounts nothing more and runs no extra worklet.
//
// Only the UI thread and Skia are faked. The Reanimated fake keeps SharedValues, reads a derived value when it is asked,
// and runs an animated reaction only on a UI frame (`__frame`), so nothing is drawn until a frame runs. The Skia fake
// gives an offscreen surface unless the test blocks one by its size, as a device without one would: renderFieldImage
// (the real one) then returns null and that surface has not drawn.
const mockUi = { reactions: new Set<{ prepare: () => unknown; react: (v: unknown, p: unknown) => void; prev: unknown }>() };
jest.mock('react-native-reanimated', () => {
  const { useEffect, useRef } = require('react');
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
    useAnimatedReaction: (prepare: () => unknown, react: (v: unknown, p: unknown) => void, deps?: unknown[]) => {
      useEffect(() => {
        const entry = { prepare, react, prev: null as unknown };
        mockUi.reactions.add(entry);
        return () => { mockUi.reactions.delete(entry); };
      }, deps); // eslint-disable-line react-hooks/exhaustive-deps
    },
    useFrameCallback: () => {
      const ref = useRef(null as null | { isActive: boolean; setActive: (a: boolean) => void });
      if (ref.current === null) ref.current = { isActive: false, setActive(a: boolean) { ref.current!.isActive = a; } };
      return ref.current;
    },
    __frame: () => {
      for (const r of [...mockUi.reactions]) {
        const v = r.prepare();
        if (v !== r.prev) { const p = r.prev; r.prev = v; r.react(v, p); }
      }
    },
  };
});
const reanimated = require('react-native-reanimated') as { __frame(): void };

const mockOffscreen = { blocked: (_w: number, _h: number) => false, made: 0 };
jest.mock('@shopify/react-native-skia', () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => children ?? null;
  const inert: unknown = new Proxy(function stub() {}, { get: () => inert, apply: () => inert });
  const surface = (w: number, h: number) => ({
    getCanvas: () => ({ drawPaint() {} }),
    flush() {},
    makeImageSnapshot: () => ({ width: () => w, height: () => h }),
  });
  const skia = new Proxy({}, {
    get: (_t, key) => {
      if (key === 'Surface') return { MakeOffscreen: (w: number, h: number) => { if (mockOffscreen.blocked(w, h)) return null; mockOffscreen.made += 1; return surface(w, h); } };
      if (key === 'Paint') return () => ({ setDither() {}, setShader() {} });
      return inert;
    },
  });
  return {
    Canvas: Stub, Image: () => null, Picture: () => null, Rect: () => null,
    FilterMode: { Nearest: 0, Linear: 1 }, MipmapMode: { None: 0, Nearest: 1, Linear: 2 },
    ClipOp: { Difference: 0, Intersect: 1 }, TileMode: { Clamp: 0, Repeat: 1, Mirror: 2, Decal: 3 },
    Skia: skia,
  };
});
jest.mock('../../v2/field/FieldFallback', () => ({ FieldFallback: () => null }));
jest.mock('../../v2/field/effect.ts', () => ({
  fieldEffect: () => ({ status: 'ready', effect: { makeShaderWithChildren: () => ({}) }, blueNoise: {}, blueNoiseShader: { name: 'noise' } }),
}));

import { FieldSurface } from '../../v2/field/FieldSurface';
import { LabRoot } from '../LabRoot';

function setup(scene: string) {
  const lines: string[] = [];
  const emitter = new EventEmitter();
  const frames = {
    queue: [] as Array<() => void>,
    next(cb: () => void) { frames.queue.push(cb); return () => { frames.queue = frames.queue.filter((x) => x !== cb); }; },
    tick(n = 1) { for (let i = 0; i < n; i += 1) { const due = frames.queue; frames.queue = []; due.forEach((cb) => cb()); } },
  };
  const events = { addListener: (name: string, cb: (e: unknown) => void) => { emitter.on(name, cb); return { remove: () => emitter.off(name, cb) }; } };
  const reduceMotion = { current: () => new Promise<boolean>(() => {}), subscribe: () => () => {} };
  jest.spyOn(View.prototype as never as { measureInWindow(cb: unknown): void }, 'measureInWindow')
    .mockImplementation((cb: unknown) => (cb as (...v: number[]) => void)(0, 0, 411, 914));
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <LabRoot labArgs={{ run: 'r', scene, clock: 'fixed', t: '11000', frames: '3' }} nonStringKeys={[]} deps={{ emit: (l: string) => lines.push(l), frames, events, reduceMotion }} />,
    );
  });
  const of = (kind: string) => lines.filter((l) => l.startsWith(`KOKONADA_LAB ${kind} `)).map((l) => JSON.parse(l.slice(`KOKONADA_LAB ${kind} `.length)));
  const sizeScene = (testID: string) => act(() => {
    tree.root.find((n) => n.props.testID === testID && typeof n.type !== 'string').props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 411, height: 914 } } });
  });
  const measure = () => act(() => {
    for (const p of tree.root.findAll((n) => typeof n.type === 'string' && String(n.props.nativeID ?? '').startsWith('probe-'))) p.props.onLayout({ nativeEvent: { layout: {} } });
  });
  const uiFrames = (n: number) => { for (let i = 0; i < n; i++) act(() => reanimated.__frame()); };
  const tick = (n = 1) => act(() => frames.tick(n));
  return { tree, of, sizeScene, measure, uiFrames, tick };
}

const statusOf = (r: { shaderStatus?: unknown; shaderReason?: unknown }) => [r.shaderStatus, r.shaderReason];

beforeEach(() => {
  mockOffscreen.blocked = () => false;
  mockOffscreen.made = 0;
  mockUi.reactions.clear();
});
afterEach(() => jest.restoreAllMocks());

describe.each([
  ['witness.abyss.dark', 'witness-scene.view'],
  ['witness.abyss.light', 'witness-scene.view'],
  ['grain.abyss.dark.full', 'grain-scene.view'],
  ['grain.abyss.light.low', 'grain-scene.view'],
])('%s: READY waits for its surfaces to draw (RA-50)', (scene, view) => {
  it('no UI frame: no READY at all, however many frames go by', () => {
    const h = setup(scene);
    h.sizeScene(view);
    h.measure();
    h.tick(20);
    expect(h.tree.root.findAllByType(FieldSurface).length).toBeGreaterThan(0);
    expect(h.of('READY')).toEqual([]);
    expect(h.of('ERROR')).toEqual([]);
  });

  it('after the first UI frame has rendered every surface, READY counts its frames from there and says ready', () => {
    const h = setup(scene);
    h.sizeScene(view);
    h.measure();
    h.tick(5);
    h.uiFrames(1);
    expect(mockOffscreen.made).toBeGreaterThanOrEqual(h.tree.root.findAllByType(FieldSurface).length);
    h.tick(2);
    expect(h.of('READY')).toEqual([]);
    h.tick(1);
    expect(h.of('READY').map(statusOf)).toEqual([['ready', null]]);
    h.uiFrames(5);
    h.tick(10);
    expect(h.of('READY')).toHaveLength(1);
    expect(h.of('ERROR')).toEqual([]);
  });

  it('one surface that cannot draw (no offscreen surface) holds READY, every other drawn; once it draws, READY comes', () => {
    // The widest render target only: W1b over the whole stage for the witness, and every strip for the grain (all equal).
    const h = setup(scene);
    h.sizeScene(view);
    h.measure();
    const widths = h.tree.root.findAllByType(FieldSurface).map((s) => s.props.renderSize.width as number);
    const widest = Math.max(...widths);
    mockOffscreen.blocked = (w) => w === widest;
    h.uiFrames(3);
    h.tick(20);
    expect(h.of('READY')).toEqual([]);
    mockOffscreen.blocked = () => false;
    h.uiFrames(1);
    h.tick(3);
    expect(h.of('READY').map(statusOf)).toEqual([['ready', null]]);
  });
});

describe('FieldSurface in the app: no listener, nothing more', () => {
  const props = () => ({
    uniforms: { value: [1, 2, 3] } as never, effect: { makeShaderWithChildren: () => ({}) } as never, blueNoise: {} as never,
    width: 10, height: 10, renderSize: { width: 10, height: 10 }, pxPerDp: 1, renderScale: 1,
  });

  it('without a FieldSurfaceDrawReport it registers no reaction: a UI frame renders nothing extra', () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => { tree = ReactTestRenderer.create(<FieldSurface {...props()} />); });
    expect(mockUi.reactions.size).toBe(0);
    act(() => reanimated.__frame());
    expect(mockOffscreen.made).toBe(0);
    act(() => tree.unmount());
  });

  it('under a listener it tells it once, when its image is first rendered, never again on later frames', () => {
    const { FieldSurfaceDrawReport } = require('../../v2/field/surfaceDrawReport') as typeof import('../../v2/field/surfaceDrawReport');
    const told: number[] = [];
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(
        <FieldSurfaceDrawReport.Provider value={() => told.push(1)}>
          <FieldSurface {...props()} />
        </FieldSurfaceDrawReport.Provider>,
      );
    });
    expect(told).toEqual([]);
    for (let i = 0; i < 5; i++) act(() => reanimated.__frame());
    expect(told).toEqual([1]);
    act(() => tree.unmount());
    expect(mockUi.reactions.size).toBe(0);
  });
});
