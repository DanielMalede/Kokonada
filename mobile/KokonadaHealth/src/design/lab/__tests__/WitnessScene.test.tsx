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
// (witnessLayout.ts); it mounts what it draws only once its view is measured (UI-175), and its one probe is the stage. It
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
  };
});
jest.mock('@shopify/react-native-skia', () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => children ?? null;
  return { Canvas: Stub, Rect: () => null, Image: () => null, FilterMode: { Nearest: 0, Linear: 1 }, MipmapMode: { None: 0, Nearest: 1, Linear: 2 }, Skia: {} };
});
jest.mock('../../v2/field/effect.ts', () => ({
  fieldEffect: () => ({ status: 'ready', effect: { name: 'effect' }, blueNoise: {}, blueNoiseShader: { name: 'noise' } }),
}));

import { Canvas, Rect } from '@shopify/react-native-skia';
import { FieldSurface } from '../../v2/field/FieldSurface';
import { SCENES } from '../scenes';
import { WitnessScene, WITNESS_SCENE_PROBES } from '../scenes/WitnessScene';
import { w1aFrame, w1bFrame, witnessColours } from '../witness/witnessFrames';
import { witnessLayout } from '../witness/witnessLayout';

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
const flat = (style: unknown) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean)) as Record<string, unknown>;
/** Where a host View sits: its own style's left and top. */
const placed = (n: ReactTestRenderer.ReactTestInstance) => {
  const s = flat(n.props.style);
  return { x: s.left, y: s.top, width: s.width, height: s.height };
};

describe('the witness scene is registered, one per face', () => {
  it.each(['dark', 'light'])('witness.abyss.%s: WitnessScene, the field\'s master period, the stage probe', (face) => {
    const scene = SCENES[`witness.abyss.${face}`];
    expect(scene.Component).toBe(WitnessScene);
    expect(scene.periodMs).toBe(BASE.field.clock.T);
    expect(scene.probes).toEqual(['stage']);
    expect(WITNESS_SCENE_PROBES).toEqual(['stage']);
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
  it('the stage probe alone, nothing drawn', () => {
    const r = mount('witness.abyss.dark');
    expect(probes(r)).toEqual(['probe-stage']);
    expect(r.root.findAllByType(FieldSurface)).toHaveLength(0);
    expect(r.root.findAllByType(Canvas)).toHaveLength(0);
  });
});

describe.each(['dark', 'light'] as const)('once measured, the %s face', (face) => {
  const k = PixelRatio.get();
  const layout = witnessLayout(face, W, H, k, PixelRatio.getFontScale());
  const colours = witnessColours(face);

  it('reports that the field shader drew it (`ready`), as a field scene does', () => {
    const reports: ShaderReport[] = [];
    const r = mount(`witness.abyss.${face}`, (x) => reports.push(x));
    layoutAs(r);
    expect(reports.at(-1)).toEqual({ status: 'ready', reason: null });
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
    expect(probes(r)).toEqual(['probe-stage']);
  });

  it('W1a: one FieldSurface per colour, in its patch, drawing the colour over itself', () => {
    const r = mount(`witness.abyss.${face}`);
    layoutAs(r);
    const patches = layout.patches.filter((p) => p.kind === 'W1a');
    expect(patches).toHaveLength(5);
    for (const p of patches) {
      const host = r.root.find((n) => typeof n.type === 'string' && n.props.testID === `witness.W1a.${p.colour}`);
      expect(placed(host)).toEqual(p.rect);
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
      const host = r.root.find((n) => typeof n.type === 'string' && n.props.testID === `witness.W3.${p.colour}`);
      expect(placed(host)).toEqual(p.rect);
      expect(flat(host.props.style).backgroundColor).toBe(colours.find((c) => c.name === p.colour)!.hex);
    }
  });

  it('no other View paints a colour: only the W3 patches carry a background', () => {
    const r = mount(`witness.abyss.${face}`);
    layoutAs(r);
    const painted = r.root.findAll((n) => typeof n.type === 'string' && flat(n.props.style).backgroundColor !== undefined).map((n) => n.props.testID);
    expect(painted.sort()).toEqual(layout.patches.filter((p) => p.kind === 'W3').map((p) => `witness.W3.${p.colour}`).sort());
  });
});

it('a scene id that is not a witness scene is a programming error', () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  expect(() => mount('witness.abyss.dusk')).toThrow(/not a witness scene/);
  spy.mockRestore();
});
