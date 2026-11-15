/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { PixelRatio } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { moduleSpecifiers } from '../../../../scripts/lab/importGraph.mjs';
import { renderGeometry, renderSize } from '../../v2/field/fieldDriver';
import { heroLayout } from '../../v2/field/fallbackScenes';
import { emptyLedger } from '../../v2/field/placementLedger';
import { ledgerConfigFor } from '../../v2/field/statics';
import { BASE } from '../../v2/tokens/tokens.generated';
import { FIELD_STATICS } from '../fieldScenes';
import { GRAIN_FACTORS, GRAIN_SPECS, grainBase, grainParams, grainProbeId, grainSpec, grainStrips, stripWidth } from '../grain/grainFrames';
import type { LabParams } from '../params';
import { ProbeRegistry } from '../probe/Probe';
import { ShaderReportContext, type ShaderReport } from '../shaderReport';

// B8-4: the grain scene draws the hero's rest field three times, side by side, through FieldSurface (the shipped surface,
// never a copy and never FieldView, which takes no lab-only knob): one packed frame, its grain at ×1, ×0.71 and ×0.5. Each
// strip shows the same window of the field (its left third: the ground, the ring and the lens edge under the vignette), so
// the strips' pixels differ only by their grain. The UI thread and the canvas are faked as in FieldScene.test.tsx:
// SharedValues persist and a derived value is computed when read.
jest.mock('react-native-reanimated', () => {
  const { useRef } = require('react');
  return {
    useSharedValue: (initial: unknown) => {
      const ref = useRef(null as null | { value: unknown });
      if (ref.current === null) ref.current = { value: initial };
      return ref.current;
    },
    useDerivedValue: (fn: () => unknown) => ({ get value() { return fn(); } }),
    runOnJS: (fn: (...args: unknown[]) => void) => (...args: unknown[]) => fn(...args),
  };
});
jest.mock('@shopify/react-native-skia', () => require('./__fixtures__/skiaHeadless').skiaHeadless());
// FieldFallback records a Skia picture, which the headless stub cannot: only its props are read here.
jest.mock('../../v2/field/FieldFallback', () => ({ FieldFallback: () => null }));
const mockEffect: { current: unknown } = { current: null };
jest.mock('../../v2/field/effect.ts', () => ({ fieldEffect: () => mockEffect.current }));
const READY = { status: 'ready', effect: { name: 'effect' }, blueNoise: {}, blueNoiseShader: { name: 'noise' } };
// A planted builder throw: grainBase is the real one unless a test sets an error, which the scene then sees.
const mockBaseError: { current: string | null } = { current: null };
jest.mock('../grain/grainFrames', () => {
  const actual = jest.requireActual('../grain/grainFrames');
  return {
    ...actual,
    grainBase: (...args: unknown[]) => (mockBaseError.current === null
      ? actual.grainBase(...args)
      : { ledger: args[0], uniforms: null, error: mockBaseError.current, started: false, idle: false }),
  };
});

import { FieldFallback } from '../../v2/field/FieldFallback';
import { FieldSurface } from '../../v2/field/FieldSurface';
import { GrainScene, GRAIN_SCENE_PROBES } from '../scenes/GrainScene';

const W = 384;
const H = 832;
const clock = { t: { value: 11000 } };
const paramsOf = (scene: string): LabParams => ({ run: 'r', scene, clock: 'fixed', t: 11000, stepMs: 0, frames: 10 });
const reports: ShaderReport[] = [];
const element = (scene: string) => (
  <ShaderReportContext.Provider value={(r) => reports.push(r)}>
    <ProbeRegistry onMeasure={() => {}}>
      <GrainScene clock={clock as never} t={11000} params={paramsOf(scene)} />
    </ProbeRegistry>
  </ShaderReportContext.Provider>
);
const mounted: ReactTestRenderer.ReactTestRenderer[] = [];
function mount(scene: string) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => { r = ReactTestRenderer.create(element(scene)); });
  mounted.push(r);
  return r;
}
beforeEach(() => {
  mockEffect.current = READY;
  reports.length = 0;
  clock.t.value = 11000;
});
afterEach(() => { for (const r of mounted.splice(0)) act(() => r.unmount()); });

const probes = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root.findAll((n) => typeof n.type === 'string' && typeof n.props.nativeID === 'string' && n.props.nativeID.startsWith('probe-')).map((n) => n.props.nativeID);
const layoutAs = (r: ReactTestRenderer.ReactTestRenderer, width = W, height = H) =>
  act(() => r.root.find((n) => n.props.testID === 'grain-scene.view' && typeof n.type !== 'string').props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height } } }));
const surfaces = (r: ReactTestRenderer.ReactTestRenderer) => r.root.findAllByType(FieldSurface).map((n) => n.props);

function expected(id: string, tMs: number) {
  const spec = grainSpec(id);
  const layout = heroLayout('abyss', W, H, PixelRatio.getFontScale());
  const geometry = renderGeometry(layout, PixelRatio.get(), spec.renderScale);
  const ledger = emptyLedger(ledgerConfigFor('abyss', spec.face, FIELD_STATICS, geometry));
  return { spec, layout, strips: grainStrips(grainBase(ledger, grainParams(spec), geometry, FIELD_STATICS, tMs).uniforms) };
}

describe('the grain scene', () => {
  it('declares the stage and one probe per strength', () => {
    expect([...GRAIN_SCENE_PROBES]).toEqual(['stage', 'grain.x1.00', 'grain.x0.71', 'grain.x0.50']);
    expect(GRAIN_FACTORS.map(grainProbeId)).toEqual(GRAIN_SCENE_PROBES.slice(1));
  });

  it('before layout: every declared probe (READY waits for each, scenes.test.tsx) and no surface (UI-175)', () => {
    const r = mount('grain.abyss.dark.full');
    expect(probes(r)).toEqual(['probe-stage', ...GRAIN_SCENE_PROBES.slice(1).map((p) => `probe-${p}`)]);
    expect(surfaces(r)).toHaveLength(0);
    layoutAs(r, W, 0);
    expect(surfaces(r)).toHaveLength(0);
  });

  it.each(Object.keys(GRAIN_SPECS))('%s: three FieldSurfaces, the same window of the field at the tier\'s renderScale', (id) => {
    const r = mount(id);
    layoutAs(r);
    expect(probes(r)).toEqual(['probe-stage', ...GRAIN_SCENE_PROBES.slice(1).map((p) => `probe-${p}`)]);
    const { spec, layout } = expected(id, 11000);
    const strip = stripWidth(W, PixelRatio.get());
    const all = surfaces(r);
    expect(all).toHaveLength(3);
    for (const p of all) {
      expect(p.effect).toBe(READY.effect);
      expect(p.blueNoise).toBe(READY.blueNoiseShader);
      expect([p.width, p.height]).toEqual([strip, H]);
      expect(p.pxPerDp).toBe(PixelRatio.get());
      expect(p.renderScale).toBe(BASE.field.tiers[spec.tier].renderScale);
      expect(p.renderSize).toEqual(renderSize({ ...layout, width: strip }, PixelRatio.get(), BASE.field.tiers[spec.tier].renderScale));
    }
  });

  it.each(Object.keys(GRAIN_SPECS))('%s: each strip is the base frame at its strength, in order, on the lab\'s clock', (id) => {
    const r = mount(id);
    layoutAs(r);
    const got = () => surfaces(r).map((p) => p.uniforms.value);
    expect(got()).toEqual(expected(id, 11000).strips);
    clock.t.value = 4000;
    expect(got()).toEqual(expected(id, 4000).strips);
    expect(got()[0]).not.toEqual(expected(id, 11000).strips[0]);
  });

  it('reports ready while the field effect is ready', () => {
    const r = mount('grain.abyss.light.low');
    layoutAs(r);
    expect(reports.at(-1)).toEqual({ status: 'ready', reason: null });
  });

  it('an effect that cannot draw: reports fallback with its reason, and draws FieldFallback, never a surface', () => {
    mockEffect.current = { status: 'fallback', reason: 'the field shader did not compile' };
    const r = mount('grain.abyss.dark.full');
    layoutAs(r);
    expect(reports.at(-1)).toEqual({ status: 'fallback', reason: 'the field shader did not compile' });
    expect(surfaces(r)).toHaveLength(0);
    expect(probes(r)).toEqual(['probe-stage', ...GRAIN_SCENE_PROBES.slice(1).map((p) => `probe-${p}`)]); // READY still comes, and says fallback
    const fb = r.root.findByType(FieldFallback).props;
    expect([fb.direction, fb.face, fb.reason]).toEqual(['abyss', 'dark', 'the field shader did not compile']);
  });

  it('a builder throw on the scene\'s layout: reports fallback with the throw, and draws FieldFallback, never a surface', () => {
    mockBaseError.current = 'RangeError: planted';
    try {
      const r = mount('grain.abyss.light.full');
      layoutAs(r);
      expect(reports.at(-1)).toEqual({ status: 'fallback', reason: 'RangeError: planted' });
      expect(probes(r)).toEqual(['probe-stage', ...GRAIN_SCENE_PROBES.slice(1).map((p) => `probe-${p}`)]);
      expect(surfaces(r)).toHaveLength(0);
      expect(r.root.findByType(FieldFallback).props.reason).toBe('RangeError: planted');
    } finally {
      mockBaseError.current = null;
    }
  });

  it('a scene id that is not a grain scene is an Error', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => mount('field.abyss.dark.rest.full')).toThrow('"field.abyss.dark.rest.full"');
    spy.mockRestore();
  });

  it('imports FieldSurface and never FieldView (the shipped surface; FieldView takes no lab-only knob)', () => {
    const file = path.resolve(__dirname, '../scenes/GrainScene.tsx');
    const specs = moduleSpecifiers(fs.readFileSync(file, 'utf8'), file);
    expect(specs.some((s: string) => /\/v2\/field\/FieldSurface(\.tsx)?$/.test(s))).toBe(true);
    expect(specs.filter((s: string) => /FieldView|FieldScene/.test(s))).toEqual([]);
  });
});
