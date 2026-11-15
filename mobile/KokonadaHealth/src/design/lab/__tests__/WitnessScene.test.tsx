/// <reference types="node" />
import * as path from 'path';
import React from 'react';
import { PixelRatio } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { importClosure } from '../../../../scripts/lab/importGraph.mjs';
import { renderSize } from '../../v2/field/fieldDriver';
import { BASE } from '../../v2/tokens/tokens.generated';
import { packFrame } from '../../v2/field/uniforms';
import { ProbeRegistry } from '../probe/Probe';
import type { LabParams } from '../params';
import { ShaderReportContext, type ShaderReport } from '../shaderReport';

// B8-2: the witness scene. It draws known frames through FieldSurface (W1b on the whole stage, W1a in each W1a patch),
// the W2 and planted patches as Skia paints in one sRGB canvas, and W3 as React Native Views, each where the layout puts it
// (witnessLayout.ts, inside the capture region the window's insets leave); it mounts what it draws only once its view is
// measured (UI-175). Its probes are the stage, the capture region it laid out in, and each W1a and W3 patch (the designer's
// witness BLOCK, 2026-11-15): the Views a layout direction could move, so the harness can refuse a row where one moved. It
// reaches FieldSurface and never FieldView: FieldView takes no lab-only knob, and the witness needs no ledger. Only the
// canvas and the UI thread are faked (SharedValues persist; a derived value is read lazily, so no frame is drawn here).
jest.mock('react-native-reanimated', () => {
  const { useRef } = require('react');
  return {
    useSharedValue: (initial: unknown) => {
      const ref = useRef(null as null | { value: unknown });
      if (ref.current === null) ref.current = { value: initial };
      return ref.current;
    },
    useDerivedValue: (fn: () => unknown) => ({ get value() { return fn(); } }),
    // The UI thread never runs here, so no surface renders an image: a scene stays `pending` (RA-50, surfaceFirstDraw.test.tsx).
    useAnimatedReaction: () => {},
  };
});
jest.mock('@shopify/react-native-skia', () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => children ?? null;
  return { Canvas: Stub, Rect: () => null, Image: () => null, FilterMode: { Nearest: 0, Linear: 1 }, MipmapMode: { None: 0, Nearest: 1, Linear: 2 }, Skia: {} };
});
// The process's one field effect: ready, unless a test plants the fallback (a shader that did not compile).
const READY = { status: 'ready', effect: { name: 'effect' }, blueNoise: {}, blueNoiseShader: { name: 'noise' } };
const mockEffect: { current: unknown } = { current: READY };
jest.mock('../../v2/field/effect.ts', () => ({ fieldEffect: () => mockEffect.current }));
afterEach(() => { mockEffect.current = READY; });

import { Canvas, Rect } from '@shopify/react-native-skia';
import { FieldSurface } from '../../v2/field/FieldSurface';
import { SCENES } from '../scenes';
import { WitnessScene, WITNESS_SCENE_PROBES } from '../scenes/WitnessScene';
import { w1aFrame, w1bFrame, witnessColours } from '../witness/witnessFrames';
import { witnessInsets } from '../witness/witnessInsets';
import { witnessLayout } from '../witness/witnessLayout';
import { WITNESS_PROBES, witnessProbeId } from '../witness/witnessProbes';

const W = 411;
const H = 914;
const paramsOf = (scene: string): LabParams => ({ run: 'r', scene, clock: 'fixed', t: 0, stepMs: 0, frames: 10 });

function mount(scene: string, onReport: (r: ShaderReport) => void = () => {}) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(
      <ShaderReportContext.Provider value={onReport}>
        <ProbeRegistry onMeasure={() => {}}>
          <WitnessScene params={paramsOf(scene)} />
        </ProbeRegistry>
      </ShaderReportContext.Provider>,
    );
  });
  return r;
}
const probes = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root.findAll((n) => typeof n.type === 'string' && typeof n.props.nativeID === 'string' && n.props.nativeID.startsWith('probe-')).map((n) => n.props.nativeID);
const layoutAs = (r: ReactTestRenderer.ReactTestRenderer, width = W, height = H) =>
  act(() => r.root.find((n) => n.props.testID === 'witness-scene.view' && typeof n.type !== 'string').props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height } } }));
const ALL_PROBES = WITNESS_PROBES.map((id) => `probe-${id}`);
const probeHost = (r: ReactTestRenderer.ReactTestRenderer, id: string) => r.root.find((n) => typeof n.type === 'string' && n.props.nativeID === `probe-${id}`);
const flat = (style: unknown) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean)) as Record<string, unknown>;
/** Where a host View sits: its own style's left and top. */
const placed = (n: ReactTestRenderer.ReactTestInstance) => {
  const s = flat(n.props.style);
  return { x: s.left, y: s.top, width: s.width, height: s.height };
};

describe('the witness scene is registered, one per face', () => {
  it.each(['dark', 'light'])('witness.abyss.%s: WitnessScene, the field\'s master period, the witness probes', (face) => {
    const scene = SCENES[`witness.abyss.${face}`];
    expect(scene.Component).toBe(WitnessScene);
    expect(scene.periodMs).toBe(BASE.field.clock.T);
    expect(scene.probes).toEqual(WITNESS_PROBES);
    expect(WITNESS_SCENE_PROBES).toEqual(WITNESS_PROBES);
  });
});

describe('what the witness scene reaches (the import scan)', () => {
  const APP = path.resolve(__dirname, '../../../..');
  const closure = importClosure(path.join(APP, 'src/design/lab/scenes/WitnessScene.tsx')).map((f: string) => path.relative(APP, f).split(path.sep).join('/'));

  it('FieldSurface, and never FieldView, FieldFallback or the scene registry', () => {
    expect(closure).toContain('src/design/v2/field/FieldSurface.tsx');
    expect(closure).toContain('src/design/lab/witness/witnessLayout.ts');
    expect(closure).not.toContain('src/design/v2/field/FieldView.tsx');
    expect(closure).not.toContain('src/design/v2/field/FieldFallback.tsx');
    expect(closure).not.toContain('src/design/lab/scenes.ts');
  });
});

describe('before its view is measured', () => {
  it('every probe it declares, unplaced (0 × 0) but the stage, and nothing drawn: READY waits for the layout', () => {
    const r = mount('witness.abyss.dark');
    expect(probes(r).sort()).toEqual([...ALL_PROBES].sort());
    for (const id of WITNESS_PROBES.filter((x) => x !== 'stage')) expect(placed(probeHost(r, id))).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(r.root.findAllByType(FieldSurface)).toHaveLength(0);
    expect(r.root.findAllByType(Canvas)).toHaveLength(0);
  });
});

describe.each(['dark', 'light'] as const)('once measured, the %s face', (face) => {
  const k = PixelRatio.get();
  const layout = witnessLayout(face, W, H, k, PixelRatio.getFontScale(), witnessInsets());
  const colours = witnessColours(face);

  // RA-50: `ready` only once every FieldSurface rendered an image; no UI frame runs here, so it stays `pending`
  // (surfaceFirstDraw.test.tsx draws the frames and sees `ready`).
  it('reports `pending` while its surfaces have not drawn, never `ready` from the effect alone', () => {
    const reports: ShaderReport[] = [];
    const r = mount(`witness.abyss.${face}`, (x) => reports.push(x));
    layoutAs(r);
    expect(reports.at(-1)).toEqual({ status: 'pending', reason: null });
    expect(reports.map((x) => x.status)).not.toContain('ready');
  });

  it('W1b: one FieldSurface over the whole stage, drawing the production frame', () => {
    const r = mount(`witness.abyss.${face}`);
    layoutAs(r);
    const surfaces = r.root.findAllByType(FieldSurface);
    expect(surfaces).toHaveLength(1 + colours.length);
    const stage = surfaces[0].props;
    const w1b = w1bFrame(face, layout.field, k);
    expect(stage.uniforms.value).toEqual(w1b.uniforms);
    expect([stage.width, stage.height, stage.pxPerDp, stage.renderScale]).toEqual([W, H, k, w1b.renderScale]);
    expect(stage.renderSize).toEqual(renderSize(layout.field, k, w1b.renderScale));
    expect([stage.effect, stage.blueNoise]).toEqual([{ name: 'effect' }, { name: 'noise' }]);
    expect(probes(r).sort()).toEqual([...ALL_PROBES].sort());
  });

  it('W1a: one FieldSurface per colour, in its patch, drawing the colour over itself', () => {
    const r = mount(`witness.abyss.${face}`);
    layoutAs(r);
    const patches = layout.patches.filter((p) => p.kind === 'W1a');
    expect(patches).toHaveLength(5);
    for (const p of patches) {
      // The patch's probe is the View the layout places; the patch fills it.
      expect(placed(probeHost(r, witnessProbeId('W1a', p.colour)))).toEqual(p.rect);
      const host = probeHost(r, witnessProbeId('W1a', p.colour)).find((n) => typeof n.type === 'string' && n.props.testID === `witness.W1a.${p.colour}`);
      expect(flat(host.props.style)).toMatchObject({ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 });
      const surface = host.findByType(FieldSurface).props;
      const size = renderSize({ ...layout.field, width: p.rect.width, height: p.rect.height }, k, surface.renderScale);
      expect(surface.renderSize).toEqual(size);
      expect([surface.width, surface.height]).toEqual([p.rect.width, p.rect.height]);
      expect(surface.uniforms.value).toEqual(packFrame(w1aFrame(face, colours.find((c) => c.name === p.colour)!, size)));
    }
  });

  it('W2 and the planted patches: one sRGB Skia canvas over the stage, a rect of each paint where the layout puts it', () => {
    const r = mount(`witness.abyss.${face}`);
    layoutAs(r);
    // FieldSurface draws in a Canvas of its own: the patches' canvas is the one outside every FieldSurface.
    const insideSurface = (n: ReactTestRenderer.ReactTestInstance | null): boolean => n !== null && (n.type === FieldSurface || insideSurface(n.parent));
    const canvases = r.root.findAllByType(Canvas).filter((n) => !insideSurface(n.parent));
    expect(canvases.length).toBe(1);
    expect(canvases[0].props.colorSpace).toBe('srgb');
    const rects = canvases[0].findAllByType(Rect).map((n) => ({ x: n.props.x, y: n.props.y, width: n.props.width, height: n.props.height, color: n.props.color }));
    const expected = layout.patches.filter((p) => p.kind !== 'W1a' && p.kind !== 'W3').map((p) => ({ ...p.rect, color: p.paint }));
    expect(rects).toEqual(expected);
    expect(rects).toHaveLength(20);
  });

  it('W3: a React Native View of the hex, in each W3 patch', () => {
    const r = mount(`witness.abyss.${face}`);
    layoutAs(r);
    for (const p of layout.patches.filter((x) => x.kind === 'W3')) {
      expect(placed(probeHost(r, witnessProbeId('W3', p.colour)))).toEqual(p.rect);
      const host = probeHost(r, witnessProbeId('W3', p.colour)).find((n) => typeof n.type === 'string' && n.props.testID === `witness.W3.${p.colour}`);
      expect(flat(host.props.style)).toMatchObject({ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 });
      expect(flat(host.props.style).backgroundColor).toBe(colours.find((c) => c.name === p.colour)!.hex);
    }
  });

  it('the stage lays its Views out left to right whatever the locale, and the region probe is the capture region', () => {
    const r = mount(`witness.abyss.${face}`);
    layoutAs(r);
    expect(flat(probeHost(r, 'stage').props.style).direction).toBe('ltr');
    expect(flat(r.root.find((n) => typeof n.type === 'string' && n.props.testID === 'witness-scene.view').props.style).direction).toBe('ltr');
    expect(placed(probeHost(r, 'region'))).toEqual(layout.region);
    expect(layout.insets).toEqual(witnessInsets());
  });

  it('no other View paints a colour: only the W3 patches carry a background', () => {
    const r = mount(`witness.abyss.${face}`);
    layoutAs(r);
    const painted = r.root.findAll((n) => typeof n.type === 'string' && flat(n.props.style).backgroundColor !== undefined).map((n) => n.props.testID);
    expect(painted.sort()).toEqual(layout.patches.filter((p) => p.kind === 'W3').map((p) => `witness.W3.${p.colour}`).sort());
  });
});

describe('when the field effect cannot draw', () => {
  it('reports `fallback` with the effect reason and draws no patch at all, but places every probe, so READY comes and the harness refuses the shot', () => {
    mockEffect.current = { status: 'fallback', reason: 'the field shader did not compile' };
    const reports: ShaderReport[] = [];
    const r = mount('witness.abyss.dark', (x) => reports.push(x));
    layoutAs(r);
    expect(reports.at(-1)).toEqual({ status: 'fallback', reason: 'the field shader did not compile' });
    expect(r.root.findAllByType(FieldSurface)).toHaveLength(0);
    expect(r.root.findAllByType(Canvas)).toHaveLength(0);
    expect(r.root.findAll((n) => typeof n.type === 'string' && typeof n.props.testID === 'string' && n.props.testID.startsWith('witness.W'))).toHaveLength(0);
    expect(probes(r).sort()).toEqual([...ALL_PROBES].sort());
    expect(r.root.findAll((n) => typeof n.type === 'string' && flat(n.props.style).backgroundColor !== undefined)).toHaveLength(0);
  });
});

it('a scene id that is not a witness scene is a programming error', () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  expect(() => mount('witness.abyss.dusk')).toThrow(/not a witness scene/);
  spy.mockRestore();
});
