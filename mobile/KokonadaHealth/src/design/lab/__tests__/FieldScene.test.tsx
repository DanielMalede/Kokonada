import React from 'react';
import { PixelRatio } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { fieldStep, renderGeometry, renderScaleFor, type FrameParams } from '../../v2/field/fieldDriver';
import { heroLayout } from '../../v2/field/fallbackScenes';
import { NODE_SLOTS } from '../../v2/field/fieldLaw';
import { emptyLedger, fades } from '../../v2/field/placementLedger';
import { ledgerConfigFor } from '../../v2/field/statics';
import { FIELD_UNIFORMS } from '../../v2/field/uniforms';
import { FIELD_SCENES, FIELD_STATICS } from '../fieldScenes';
import { ProbeRegistry } from '../probe/Probe';
import type { LabParams } from '../params';

// T14, S2: a lab field scene mounts the real FieldView (never FieldSurface with known frames) once its view is measured
// (UI-175 at this root), keyed by the scene id, on the lab's clock. FieldView and its builder are the real ones; only the
// UI thread and the canvas are faked, as in FieldView.test.tsx and FieldPreview.test.tsx: SharedValues persist, a frame
// callback is registered per identity, only active callbacks run, and each frame carries a rising timestamp.
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
    __active: () => [...registry.values()].filter((e) => e.active).length,
  };
});
const reanimated = require('react-native-reanimated') as { __frame(dt: number): void; __active(): number };

jest.mock('@shopify/react-native-skia', () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => children ?? null;
  return { Canvas: Stub, Image: () => null, Picture: () => null, FilterMode: { Nearest: 0, Linear: 1 }, MipmapMode: { None: 0, Nearest: 1, Linear: 2 }, Skia: {} };
});
jest.mock('../../v2/field/effect.ts', () => ({
  fieldEffect: () => ({ status: 'ready', effect: { name: 'effect' }, blueNoise: {}, blueNoiseShader: { name: 'noise' } }),
}));

import { FieldSurface } from '../../v2/field/FieldSurface';
import { FieldView } from '../../v2/field/FieldView';
import { FieldScene } from '../scenes/FieldScene';

const W = 411;
const H = 914;
const OFFSET: Record<string, number> = {};
FIELD_UNIFORMS.reduce((at, u) => { OFFSET[u.name] = at; return at + u.floats; }, 0);
const placementFades = (u: readonly number[]) =>
  Array.from({ length: NODE_SLOTS }, (_, k) => ({ fade: u[OFFSET[`uNode${k}`] + 3], bead: u[OFFSET[`uNode${k}Bead`] + 2] === 1 })).filter((n) => n.bead).map((n) => n.fade);

const clock = { t: { value: 0 } } as never;
const paramsOf = (scene: string): LabParams => ({ run: 'r', scene, clock: 'fixed', t: 0, stepMs: 0, frames: 10 });
const element = (scene: string) => (
  <ProbeRegistry onMeasure={() => {}}>
    <FieldScene clock={clock} t={0} params={paramsOf(scene)} />
  </ProbeRegistry>
);
const mounted: ReactTestRenderer.ReactTestRenderer[] = [];
function mount(scene: string) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => { r = ReactTestRenderer.create(element(scene)); });
  mounted.push(r);
  return r;
}
afterEach(() => {
  for (const r of mounted.splice(0)) act(() => r.unmount());
  expect(reanimated.__active()).toBe(0);
});
beforeEach(() => { ui.timestamp = 0; });

const probes = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root.findAll((n) => typeof n.type === 'string' && typeof n.props.nativeID === 'string' && n.props.nativeID.startsWith('probe-')).map((n) => n.props.nativeID);
const layoutAs = (r: ReactTestRenderer.ReactTestRenderer, width = W, height = H) =>
  act(() => r.root.find((n) => n.props.testID === 'field-scene.view' && typeof n.type !== 'string').props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height } } }));
const field = (r: ReactTestRenderer.ReactTestRenderer) => r.root.findByType(FieldView).props;
const frames = (n: number, dt = 16) => { for (let i = 0; i < n; i++) act(() => reanimated.__frame(dt)); };
const uniformsOf = (r: ReactTestRenderer.ReactTestRenderer) => r.root.findByType(FieldSurface).props.uniforms.value as number[] | null;

const DARK_THREE = 'field.abyss.dark.three.full';

describe('FieldView mounts only once the view is measured (UI-175 at this root)', () => {
  it('before layout: the stage probe and no FieldView', () => {
    const r = mount(DARK_THREE);
    expect(probes(r)).toEqual(['probe-stage']);
    expect(r.root.findAllByType(FieldView)).toHaveLength(0);
  });

  it('a zero-size layout mounts nothing', () => {
    const r = mount(DARK_THREE);
    layoutAs(r, 0, 0);
    expect(r.root.findAllByType(FieldView)).toHaveLength(0);
    layoutAs(r, W, 0);
    expect(r.root.findAllByType(FieldView)).toHaveLength(0);
  });

  it('after layout: the real FieldView, keyed by the scene id, on the lab\'s clock, with no lab-only knob', () => {
    const r = mount(DARK_THREE);
    layoutAs(r);
    expect(probes(r)).toEqual(['probe-stage']);
    const p = field(r);
    const spec = FIELD_SCENES[DARK_THREE];
    expect(p.scene).toBe(DARK_THREE);
    expect(p.clock).toBe(clock);
    expect(p.direction).toBe('abyss');
    expect(p.face).toBe('dark');
    expect(p.tier).toBe('full');
    expect(p.statics).toBe(FIELD_STATICS);
    expect(p.taps).toEqual(spec.taps);
    expect(p.layout).toEqual(heroLayout('abyss', W, H, PixelRatio.getFontScale()));
    expect(p.pxPerDp).toBe(PixelRatio.get());
    expect(Object.keys(p).sort()).toEqual(['clock', 'confidence', 'direction', 'face', 'genesis', 'layout', 'pxPerDp', 'scene', 'statics', 'stress', 'taps', 'tier'].sort());
  });

  // The policy scenes (B8-6) take their tier from the motion policy, end to end through LabRoot: policyScenes.test.tsx.
  it.each(Object.values(FIELD_SCENES).filter((s) => s.kind === 'field' && !s.policy).map((s) => s.id))('%s: its face, tier and taps from its id', (id) => {
    const r = mount(id);
    layoutAs(r);
    const spec = FIELD_SCENES[id];
    expect([field(r).scene, field(r).face, field(r).tier]).toEqual([id, spec.face, spec.tier]);
    expect(field(r).taps).toEqual(spec.taps);
  });

  it('a policy scene with no LabRoot to give it the device\'s settings is an error naming it, never a tier of its own', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => mount('field.abyss.dark.three.policy')).toThrow(/"field\.abyss\.dark\.three\.policy" takes its tier from the motion policy/);
    mounted.splice(0);
    jest.restoreAllMocks();
  });
});

describe('a fresh ledger per scene (resilience T5 r1 F5: the lab never relies on a seq reset)', () => {
  it('the first frame shows the scene\'s taps at once, at fade 1', () => {
    const r = mount(DARK_THREE);
    layoutAs(r);
    expect(uniformsOf(r)).toBeNull();
    frames(1);
    expect(placementFades(uniformsOf(r)!)).toEqual([1, 1, 1]);
  });

  it('scene B after scene A remounts FieldView: B\'s first input is shown at once, with no crossfade from A', () => {
    const A = 'field.abyss.dark.one.intense.full';
    const B = 'field.abyss.dark.one.joy.full';
    const r = mount(A);
    layoutAs(r);
    frames(3);
    const before = r.root.findByType(FieldSurface).props.uniforms;
    expect(placementFades(before.value)).toEqual([1]);
    act(() => r.update(element(B)));
    expect(field(r).scene).toBe(B);
    const after = r.root.findByType(FieldSurface).props.uniforms;
    expect(after).not.toBe(before); // a new mount: a new SharedValue, a fresh ledger
    frames(1);
    expect(placementFades(after.value)).toEqual([1]);
  });

  it('the ledger\'s first reset is not a start (fieldDriver.ts, started = starts went up): a mount reports no crossfade', () => {
    // What FieldView runs on its first frame, step for step: the scene's taps on an empty ledger at seq 0.
    const spec = FIELD_SCENES[DARK_THREE];
    const layout = heroLayout('abyss', W, H, 1);
    const geometry = renderGeometry(layout, 2.625, renderScaleFor('full'));
    const params: FrameParams = { direction: 'abyss', face: 'dark', stress: 0, confidence: 1, genesis: false, tier: 'full' };
    const first = fieldStep(emptyLedger(ledgerConfigFor('abyss', 'dark', FIELD_STATICS, geometry)), { seq: 0, taps: spec.taps }, 16, params, geometry, FIELD_STATICS, 0, 0);
    expect(first.error).toBeNull();
    expect(first.started).toBe(false);
    expect(first.ledger.starts).toBe(0);
    expect(fades(first.ledger).placements.map((p) => p.fade)).toEqual([1, 1, 1]);
    // The control: a change of seq on the same ledger is a start.
    const next = fieldStep(first.ledger, { seq: 1, taps: spec.taps.slice(0, 1) }, 32, params, geometry, FIELD_STATICS, 0, 0);
    expect(next.started).toBe(true);
  });
});
