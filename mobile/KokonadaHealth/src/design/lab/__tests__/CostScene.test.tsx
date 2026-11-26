import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import type { CostReport, CostResultBody } from '../cost/costResult';
import type { LabParams } from '../params';
import { ProbeRegistry } from '../probe/Probe';
import { ShaderReportContext, type ShaderReport } from '../shaderReport';

// B8-3, the cost scene (the architect's B8 plan, B8-3: "reports `ready`"). The scene is the bench's composition root: it
// measures its view, makes the bench's config (the field scene's layout at the device's pxPerDp and font scale, the
// tier's render size), and runs the bench one frame per frame callback on the UI thread, then hands the body to the lab
// through CostReportContext: once, and stops its frames. Any failure is an ERROR through the same context, never a
// RESULT. It says which surface it measures (UI-223): `ready` while the field effect (and, for .heavy and .empty, the
// calibration effect) is ready, else `fallback` with the reason.
//
// Faked here, as in FieldScene.test.tsx: the UI thread (SharedValues persist, a frame callback per identity, only active
// ones run, rising timestamps) and Skia (a stateful offscreen surface). The bench, the ledger and the builder are real.
const ui = { timestamp: 0 };
jest.mock('react-native-reanimated', () => {
  const { useEffect, useRef } = require('react');
  const registry = new Map<number, { fn: (info: unknown) => void; active: boolean }>();
  let nextId = 1;
  return {
    useSharedValue: (initial: unknown) => {
      const ref = useRef(null as null | { value: unknown });
      if (ref.current === null) ref.current = { value: initial };
      return ref.current;
    },
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
    __active: () => [...registry.values()].filter((e) => e.active).length,
  };
});
const reanimated = require('react-native-reanimated') as { __frame(dt: number): void; __active(): number };

const skiaState = { offscreen: 0, compiled: [] as string[], compile: true };
jest.mock('@shopify/react-native-skia', () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => children ?? null;
  return {
    Canvas: Stub, Image: () => null, Picture: () => null,
    FilterMode: { Nearest: 0, Linear: 1 }, MipmapMode: { None: 0, Nearest: 1, Linear: 2 },
    ColorType: { RGBA_8888: 4 }, AlphaType: { Unpremul: 3 },
    Skia: {
      RuntimeEffect: {
        Make: (source: string) => {
          skiaState.compiled.push(source);
          return skiaState.compile ? { getUniformFloatCount: () => require('../../v2/field/uniforms').FIELD_UNIFORM_FLOATS, makeShaderWithChildren: () => ({}) } : null;
        },
      },
      Surface: {
        MakeOffscreen: (w: number, h: number) => {
          skiaState.offscreen += 1;
          return {
            getCanvas: () => ({ drawPaint() {} }),
            flush() {},
            makeImageSnapshot: () => ({ width: () => w, height: () => h, readPixels: () => new Uint8Array(4), dispose() {} }),
          };
        },
      },
      Paint: () => ({ setDither() {}, setShader() {} }),
    },
  };
});
const effectState: { status: 'ready' | 'fallback' } = { status: 'ready' };
jest.mock('../../v2/field/effect.ts', () => ({
  fieldEffect: () => (effectState.status === 'ready'
    ? { status: 'ready', effect: { makeShaderWithChildren: () => ({}) }, blueNoise: {}, blueNoiseShader: { name: 'noise' } }
    : { status: 'fallback', reason: 'the field shader did not compile' }),
}));

import { COST_COUNTS } from '../cost/costBench';
import { CostReportContext, formatCostResult } from '../cost/costResult';
import { CostScene } from '../scenes/CostScene';

const W = 411;
const H = 914;
const clock = { t: { value: 0 } } as never;
const paramsOf = (scene: string): LabParams => ({ run: 'r', scene, clock: 'realtime', t: 0, stepMs: 0, frames: 10 });

type Sink = { results: CostResultBody[]; errors: string[]; shaders: ShaderReport[] };
const mounted: ReactTestRenderer.ReactTestRenderer[] = [];
function mount(scene: string, withReport = true) {
  const sink: Sink = { results: [], errors: [], shaders: [] };
  const report: CostReport = { result: (b) => sink.results.push(b), error: (m) => sink.errors.push(m) };
  const scene$ = <CostScene clock={clock} t={null} params={paramsOf(scene)} />;
  const tree = (
    <ProbeRegistry onMeasure={() => {}}>
      <ShaderReportContext.Provider value={(r) => sink.shaders.push(r)}>
        {withReport ? <CostReportContext.Provider value={report}>{scene$}</CostReportContext.Provider> : scene$}
      </ShaderReportContext.Provider>
    </ProbeRegistry>
  );
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => { r = ReactTestRenderer.create(tree); });
  mounted.push(r);
  return { r, sink };
}
const layoutAs = (r: ReactTestRenderer.ReactTestRenderer, width = W, height = H) =>
  act(() => r.root.find((n) => n.props.testID === 'cost-scene.view' && typeof n.type !== 'string').props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height } } }));
const frames = (n: number, dt = 1000 / 120) => act(() => { for (let i = 0; i < n; i++) reanimated.__frame(dt); });
const probes = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root.findAll((n) => typeof n.type === 'string' && typeof n.props.nativeID === 'string' && n.props.nativeID.startsWith('probe-')).map((n) => n.props.nativeID);
const ALL = COST_COUNTS.warmup + COST_COUNTS.frames + 1 + COST_COUNTS.gpuSamples;

beforeEach(() => {
  ui.timestamp = 0;
  effectState.status = 'ready';
  Object.assign(skiaState, { offscreen: 0, compiled: [], compile: true });
});
afterEach(() => {
  for (const r of mounted.splice(0)) act(() => r.unmount());
  expect(reanimated.__active()).toBe(0);
});

const IDLE = 'cost.abyss.dark.three.full';

describe('the cost scene', () => {
  it('renders the stage probe, before and after layout, and runs no frame before it is measured', () => {
    const { r, sink } = mount(IDLE);
    expect(probes(r)).toEqual(['probe-stage']);
    frames(5);
    expect(skiaState.offscreen).toBe(0);
    layoutAs(r);
    expect(probes(r)).toEqual(['probe-stage']);
    expect(sink.results).toEqual([]);
  });

  it.each([IDLE, 'cost.abyss.dark.three.low.heavy', 'cost.abyss.dark.three.full.empty', 'cost.abyss.light.three.low.storm'])('%s reports ready', (id) => {
    const { sink } = mount(id);
    expect(sink.shaders[sink.shaders.length - 1]).toEqual({ status: 'ready', reason: null });
  });

  it('.heavy and .empty compile their calibration shader; idle and storm compile none', () => {
    mount(IDLE);
    mount('cost.abyss.light.three.full.storm');
    expect(skiaState.compiled).toHaveLength(0);
    mount('cost.abyss.dark.three.full.heavy');
    mount('cost.abyss.dark.three.full.empty');
    expect(skiaState.compiled).toHaveLength(2);
    expect(skiaState.compiled[0]).toContain('half4 fieldMain(float2 p)');
  });

  it.each([IDLE, 'cost.abyss.dark.three.low.storm', 'cost.abyss.dark.three.full.heavy'])('%s: after layout the bench runs to the end and hands over one RESULT body, then stops its frames', (id) => {
    const { r, sink } = mount(id);
    layoutAs(r);
    frames(ALL - 1);
    expect(sink.results).toHaveLength(0);
    frames(1);
    expect(sink.errors).toEqual([]);
    expect(sink.results).toHaveLength(1);
    const body = sink.results[0];
    expect(body).toMatchObject({ kind: 'cost', scene: id, frames: COST_COUNTS.frames, displayHz: 120, clock: 'performance.now' });
    expect(() => formatCostResult({ run: 'r', seq: 0, ...body })).not.toThrow();
    expect(reanimated.__active()).toBe(0);
    frames(50);
    expect(sink.results).toHaveLength(1);
  });

  it('a field effect that cannot draw: fallback with its reason, an ERROR, no RESULT and no frames', () => {
    effectState.status = 'fallback';
    const { r, sink } = mount(IDLE);
    layoutAs(r);
    frames(ALL + 5);
    expect(sink.shaders[sink.shaders.length - 1]).toEqual({ status: 'fallback', reason: 'the field shader did not compile' });
    expect(sink.errors).toEqual([expect.stringMatching(/did not compile/)]);
    expect(sink.results).toEqual([]);
    expect(skiaState.offscreen).toBe(0);
  });

  it('a calibration shader that does not compile: fallback, an ERROR, no RESULT', () => {
    skiaState.compile = false;
    const { r, sink } = mount('cost.abyss.dark.three.full.heavy');
    layoutAs(r);
    frames(ALL + 5);
    expect(sink.shaders[sink.shaders.length - 1].status).toBe('fallback');
    expect(sink.errors).toEqual([expect.stringMatching(/heavy/)]);
    expect(sink.results).toEqual([]);
  });

  it('no UI-runtime clock: an ERROR naming performance.now, no RESULT, and its frames stop', () => {
    const real = globalThis.performance;
    const { r, sink } = mount(IDLE);
    layoutAs(r);
    Object.defineProperty(globalThis, 'performance', { value: undefined, configurable: true, writable: true });
    try {
      frames(3);
    } finally {
      Object.defineProperty(globalThis, 'performance', { value: real, configurable: true, writable: true });
    }
    expect(sink.errors).toEqual([expect.stringMatching(/performance\.now/)]);
    expect(sink.results).toEqual([]);
    expect(reanimated.__active()).toBe(0);
  });

  it('without a CostReport the bench still runs and nothing breaks (LabRoot provides it)', () => {
    const { r } = mount(IDLE, false);
    layoutAs(r);
    frames(ALL + 2);
    expect(reanimated.__active()).toBe(0);
  });
});
