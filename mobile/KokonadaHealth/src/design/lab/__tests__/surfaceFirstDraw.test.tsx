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
import { GRAIN_FACTORS, grainProbeId } from '../grain/grainFrames';
import type { LabParams } from '../params';
import { ProbeRegistry } from '../probe/Probe';
import { GrainScene } from '../scenes/GrainScene';
import { WitnessScene } from '../scenes/WitnessScene';
import { SETTING_READ_DEADLINE_MS } from '../settingRead';
import { ShaderReportContext, type ShaderReport } from '../shaderReport';

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

  // `widest`: W1b over the whole stage for the witness, every strip for the grain (all equal). `last`: the surface whose
  // reaction runs last on each UI frame (one read per surface per frame): the last W1a patch, or the third strip.
  it.each(['widest', 'last'] as const)('the %s surface cannot draw (no offscreen surface): READY is held, every other drawn; once it draws, READY comes', (which) => {
    const h = setup(scene);
    h.sizeScene(view);
    h.measure();
    const widths = h.tree.root.findAllByType(FieldSurface).map((s) => s.props.renderSize.width as number);
    const widest = Math.max(...widths);
    let calls = 0;
    mockOffscreen.blocked = which === 'widest' ? (w) => w === widest : () => (calls++ % widths.length) === widths.length - 1;
    h.uiFrames(3);
    // The others drew; only when every surface is the widest (the grain's equal strips) did none.
    expect(mockOffscreen.made > 0).toBe(which === 'last' || widths.some((w) => w !== widest));
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
    // The offscreen surface goes away and comes back: the image is null, then rendered again. Still once per mount.
    mockOffscreen.blocked = () => true;
    act(() => reanimated.__frame());
    mockOffscreen.blocked = () => false;
    act(() => reanimated.__frame());
    expect(told).toEqual([1]);
    act(() => tree.unmount());
    expect(mockUi.reactions.size).toBe(0);
  });
});

// The cost scene gets no first-draw signal, and needs none (its header, RA-50): it mounts no on-screen field surface, and
// its shots are judged by their RESULT, which only an offscreen render that drew can produce.
describe('the cost scene: no on-screen surface, so RA-50 does not reach it', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const APP = path.resolve(__dirname, '../../../..');

  // Its import closure reaches both through `import type { SceneProps } from '../scenes'` (the scan reads type imports
  // too), so the pin is what it mounts: measured and running, a cost scene draws neither, only its blank stage.
  // The .heavy and .empty variants compile a calibration shader, which this Skia fake cannot; they mount the same tree.
  it.each(['cost.abyss.dark.three.full', 'cost.abyss.light.three.low.storm'])('%s mounts no FieldSurface and no FieldView', (scene) => {
    const { FieldView } = require('../../v2/field/FieldView') as typeof import('../../v2/field/FieldView');
    const h = setup(scene);
    h.sizeScene('cost-scene.view');
    h.measure();
    h.uiFrames(3);
    h.tick(5);
    expect(h.tree.root.findAll((n) => n.props.testID === 'cost-scene.view').length).toBeGreaterThan(0);
    expect(h.tree.root.findAllByType(FieldSurface)).toHaveLength(0);
    expect(h.tree.root.findAllByType(FieldView)).toHaveLength(0);
  });

  it('every cost shot is proved by its RESULT', () => {
    const plan = JSON.parse(fs.readFileSync(path.join(APP, 'scripts/lab/capture-plans/v1-cost.json'), 'utf8')) as { shots: Array<{ scene: string; proof?: { kind: string } }> };
    expect(plan.shots.length).toBeGreaterThan(0);
    for (const shot of plan.shots) expect([shot.scene, shot.proof?.kind]).toEqual([shot.scene, 'result']);
  });
});

// RA-55 (S3): a surface that never renders an image kept its scene `pending` for good, so LabRoot held READY in silence
// until the harness's READY timeout (30 s in every plan). Now the scene allows its surfaces the lab's settings deadline
// (SETTING_READ_DEADLINE_MS, at most half of every plan's readyTimeoutMs, labSettingsRead.test.tsx), and then LabRoot
// sends an ERROR naming the surfaces that drew nothing, while the harness still waits.
describe.each([
  ['witness.abyss.dark', 'witness-scene.view', ['W1b']],
  ['grain.abyss.dark.full', 'grain-scene.view', GRAIN_FACTORS.map(grainProbeId)],
])('%s: a surface that never draws (RA-55)', (scene, view, never) => {
  afterEach(() => jest.useRealTimers());

  it('becomes a named ERROR before the READY timeout, and nothing follows it', () => {
    jest.useFakeTimers();
    const h = setup(scene);
    h.sizeScene(view);
    h.measure();
    const widest = Math.max(...h.tree.root.findAllByType(FieldSurface).map((x) => x.props.renderSize.width as number));
    mockOffscreen.blocked = (w) => w === widest;
    h.uiFrames(3);
    h.tick(20);
    act(() => { jest.advanceTimersByTime(SETTING_READ_DEADLINE_MS - 1); });
    expect(h.of('ERROR')).toEqual([]);
    act(() => { jest.advanceTimersByTime(1); });
    expect(h.of('ERROR')).toEqual([{ run: 'r', errors: [`${scene}: no image within ${SETTING_READ_DEADLINE_MS} ms from ${never.join(', ')}`] }]);
    mockOffscreen.blocked = () => false;
    h.uiFrames(3);
    h.tick(20);
    expect(h.of('READY')).toEqual([]);
    expect(h.of('ERROR')).toHaveLength(1);
  });

  it('every surface drew before the deadline: READY, and the deadline sends nothing later', () => {
    jest.useFakeTimers();
    const h = setup(scene);
    h.sizeScene(view);
    h.measure();
    h.uiFrames(1);
    h.tick(3);
    expect(h.of('READY').map(statusOf)).toEqual([['ready', null]]);
    act(() => { jest.advanceTimersByTime(SETTING_READ_DEADLINE_MS * 3); });
    expect(h.of('ERROR')).toEqual([]);
  });
});

// RA-56 (S3): a scene change on the same mount must draw afresh: each surface is keyed by the scene, so it mounts anew and
// tells its listener again; a surface kept from the earlier scene told once and would never tell the new one.
describe.each([
  ['witness.abyss.dark', 'witness.abyss.light', 'witness-scene.view'],
  ['grain.abyss.dark.full', 'grain.abyss.light.low', 'grain-scene.view'],
])('%s, then %s on the same mount (RA-56)', (first, second, view) => {
  it('pending, ready, then pending again for the new scene, and ready once its surfaces drew', () => {
    const reports: ShaderReport[] = [];
    const clock = { t: { value: 11000 } } as never;
    const paramsOf = (scene: string): LabParams => ({ run: 'r', scene, clock: 'fixed', t: 11000, stepMs: 0, frames: 3 });
    const Scene = first.startsWith('witness.') ? WitnessScene : GrainScene;
    const element = (scene: string) => (
      <ProbeRegistry onMeasure={() => {}}>
        <ShaderReportContext.Provider value={(r) => reports.push(r)}>
          <Scene clock={clock} t={11000} params={paramsOf(scene)} />
        </ShaderReportContext.Provider>
      </ProbeRegistry>
    );
    const last = () => reports[reports.length - 1];
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => { tree = ReactTestRenderer.create(element(first)); });
    act(() => {
      tree.root.find((n) => n.props.testID === view && typeof n.type !== 'string').props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 411, height: 914 } } });
    });
    expect(last()).toEqual({ status: 'pending', reason: null });
    act(() => reanimated.__frame());
    expect(last()).toEqual({ status: 'ready', reason: null });

    act(() => tree.update(element(second)));
    expect(last()).toEqual({ status: 'pending', reason: null });
    act(() => reanimated.__frame());
    expect(last()).toEqual({ status: 'ready', reason: null });
    act(() => tree.unmount());
  });
});
