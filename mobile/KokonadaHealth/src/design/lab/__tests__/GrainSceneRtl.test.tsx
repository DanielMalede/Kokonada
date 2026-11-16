import React from 'react';
import { I18nManager, PixelRatio, View } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { ProbeRegistry } from '../probe/Probe';
import type { ProbeRect } from '../probe/geometry';
import type { LabParams } from '../params';
import { ShaderReportContext } from '../shaderReport';

// The owner's phone runs in Hebrew (isRTL true). Yoga lays a `flexDirection: 'row'` out from start to end, and start is
// the right edge under RTL, so the grain strips would run ×0.5, ×0.71, ×1 left to right, the reverse of the scene's order
// and the owner's judging instructions. The scene pins its stage to `direction: 'ltr'` (as the witness scene does): here
// the tree is laid out by Yoga's row rule with each node's direction (inherited unless a style sets it), the probes are
// measured where that puts them, as the harness reads them, and the order must be ×1, ×0.71, ×0.5 left to right. The
// UI thread and the canvas are faked as in GrainScene.test.tsx.
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
jest.mock('@shopify/react-native-skia', () => require('./__fixtures__/skiaHeadless').skiaHeadless());
jest.mock('../../v2/field/FieldFallback', () => ({ FieldFallback: () => null }));
jest.mock('../../v2/field/effect.ts', () => ({ fieldEffect: () => ({ status: 'ready', effect: { name: 'effect' }, blueNoise: {}, blueNoiseShader: { name: 'noise' } }) }));

import { renderGeometry } from '../../v2/field/fieldDriver';
import { heroLayout } from '../../v2/field/fallbackScenes';
import { FieldSurface } from '../../v2/field/FieldSurface';
import { emptyLedger } from '../../v2/field/placementLedger';
import { ledgerConfigFor } from '../../v2/field/statics';
import { FIELD_STATICS } from '../fieldScenes';
import { GRAIN_FACTORS, GRAIN_SPECS, grainBase, grainParams, grainProbeId, grainSpec, grainStrips, stripWidth } from '../grain/grainFrames';
import { GrainScene } from '../scenes/GrainScene';

type Node = ReactTestRenderer.ReactTestInstance;
type Box = { x: number; y: number; width: number; height: number };

const K = 2.625;
const W = 1080 / K;
const H = 2340 / K;
const T = 11000;
const flat = (style: unknown) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean)) as Record<string, unknown>;
const hosts = (n: Node): Node[] => {
  const out: Node[] = [];
  for (let p: Node | null = n; p !== null; p = p.parent) if (typeof p.type === 'string') out.unshift(p);
  return out;
};

/** A node's direction: the nearest `direction` style on it or above it, else the root's (I18nManager). */
function directionOf(node: Node): 'ltr' | 'rtl' {
  let dir: 'ltr' | 'rtl' = I18nManager.isRTL ? 'rtl' : 'ltr';
  for (const h of hosts(node)) {
    const d = flat(h.props.style).direction;
    if (d === 'ltr' || d === 'rtl') dir = d;
  }
  return dir;
}

/** Where a strip probe lands, by Yoga's row rule: its row's children from start to end, start the right edge under rtl. */
function stripFrame(probe: Node): Box {
  const row = hosts(probe).reverse().find((h) => h !== probe && flat(h.props.style).flexDirection === 'row');
  if (row === undefined) throw new Error('the strip is in no row');
  const strips = row.findAll((n) => typeof n.type === 'string' && typeof n.props.nativeID === 'string' && n.props.nativeID.startsWith('probe-grain.'));
  const widths = strips.map((s) => flat(s.props.style).width as number);
  const i = strips.indexOf(probe);
  const before = widths.slice(0, i).reduce((a, b) => a + b, 0);
  const width = widths[i];
  const x = directionOf(row) === 'ltr' ? before : W - before - width;
  return { x, y: 0, width, height: flat(probe.props.style).height as number };
}

beforeEach(() => {
  jest.replaceProperty(I18nManager, 'isRTL', true);
  jest.spyOn(PixelRatio, 'get').mockReturnValue(K);
  jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(1);
});
afterEach(() => jest.restoreAllMocks());

const paramsOf = (scene: string): LabParams => ({ run: 'r', scene, clock: 'fixed', t: T, stepMs: 0, frames: 10 });

function mountMeasured(scene: string) {
  const reported: Record<string, ProbeRect> = {};
  let r!: ReactTestRenderer.ReactTestRenderer;
  jest.spyOn(View.prototype as never as { measureInWindow(cb: unknown): void }, 'measureInWindow').mockImplementation(function (this: { props: { nativeID?: string } }, cb: unknown) {
    const host = r.root.find((n) => typeof n.type === 'string' && n.props.nativeID === this.props.nativeID);
    const f = host.props.nativeID === 'probe-stage' ? { x: 0, y: 0, width: W, height: H } : stripFrame(host);
    (cb as (...v: number[]) => void)(f.x, f.y, f.width, f.height);
  });
  act(() => {
    r = ReactTestRenderer.create(
      <ShaderReportContext.Provider value={() => {}}>
        <ProbeRegistry onMeasure={(id, rect) => { reported[id] = rect; }}>
          <GrainScene clock={{ t: { value: T } } as never} t={T} params={paramsOf(scene)} />
        </ProbeRegistry>
      </ShaderReportContext.Provider>,
    );
  });
  act(() => r.root.find((n) => n.props.testID === 'grain-scene.view' && typeof n.type !== 'string').props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: W, height: H } } }));
  const probes = r.root.findAll((n) => typeof n.type === 'string' && typeof n.props.nativeID === 'string' && n.props.nativeID.startsWith('probe-'));
  act(() => { for (const n of probes) n.props.onLayout({ nativeEvent: { layout: {} } }); });
  return { r, reported };
}

describe.each(Object.keys(GRAIN_SPECS))('under RTL (isRTL true), %s', (id) => {
  it('the strips land ×1, ×0.71, ×0.5 from left to right, side by side from the left edge', () => {
    const { reported } = mountMeasured(id);
    const strips = GRAIN_FACTORS.map(grainProbeId);
    expect(Object.keys(reported).sort()).toEqual(['stage', ...strips].sort());
    const byX = [...strips].sort((a, b) => reported[a].dp.x - reported[b].dp.x);
    expect(byX).toEqual(strips);
    const w = stripWidth(W, K);
    strips.forEach((p, i) => expect([reported[p].dp.x, reported[p].dp.width]).toEqual([i * w, w]));
  });

  it("each strip's content is unchanged: the strip at ×k holds the frame at ×k, the same window of the field", () => {
    const { r } = mountMeasured(id);
    const spec = grainSpec(id);
    const layout = heroLayout('abyss', W, H, 1);
    const geometry = renderGeometry(layout, K, spec.renderScale);
    const ledger = emptyLedger(ledgerConfigFor('abyss', spec.face, FIELD_STATICS, geometry));
    const expected = grainStrips(grainBase(ledger, grainParams(spec), geometry, FIELD_STATICS, T).uniforms);
    GRAIN_FACTORS.forEach((k, i) => {
      const probe = r.root.find((n) => typeof n.type === 'string' && n.props.nativeID === `probe-${grainProbeId(k)}`);
      const surface = probe.findByType(FieldSurface).props;
      expect(surface.uniforms.value).toEqual(expected[i]);
      expect([surface.width, surface.renderScale]).toEqual([stripWidth(W, K), spec.renderScale]);
    });
  });
});

it('the model bites: under RTL a row with no direction of its own runs from the right edge', () => {
  const { r } = mountMeasured('grain.abyss.dark.full');
  const row = r.root.find((n) => typeof n.type === 'string' && flat(n.props.style).flexDirection === 'row');
  expect(directionOf(row)).toBe('ltr');
  const stage = r.root.find((n) => typeof n.type === 'string' && n.props.nativeID === 'probe-stage');
  // The stage probe sets no direction, so under RTL it is rtl: the pin is the scene's own.
  expect(directionOf(stage)).toBe('rtl');
});
