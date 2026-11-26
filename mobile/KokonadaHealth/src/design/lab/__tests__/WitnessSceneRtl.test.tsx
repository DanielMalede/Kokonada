import React from 'react';
import { I18nManager, PixelRatio, StatusBar, View } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { ProbeRegistry } from '../probe/Probe';
import { probeRect, type ProbeRect } from '../probe/geometry';
import { formatLine } from '../protocol';
import type { LabParams } from '../params';
import { LAB_SENTINEL } from '../sentinel';
import { ShaderReportContext } from '../shaderReport';
import { SKIA_BACKEND_MAX_REASON } from '../skiaBackend';

// The designer's witness BLOCK (dry run 2026-11-15 at 4323c76, Galaxy S22+, he-IL so isRTL true), items i, ii and iv.
// React Native on Android lays a right-to-left app out with left and right swapped (I18nManager.doLeftAndRightSwapInRTL,
// on by default): Fabric turns every `left` into `start` and every `right` into `end` (YogaLayoutableShadowNode::
// swapLeftAndRightInYogaStyleProps), and Yoga resolves start and end by each node's direction, inherited unless a style
// sets it. So the witness's Views (W1a, W3) landed at x' = W - x - 24 while the Skia canvas (W2, the planted patches, W1b)
// draws at the layout's own coordinates. Here the tree is laid out by those rules (the lab's shared model,
// __fixtures__/yogaRtl.ts), so the test sees where each View lands
// on the device, and every rect the scene draws is checked against the scene's own rules: GAP_DP from every other, each
// sample inside the capture region. The canvas and the UI thread are faked as WitnessScene.test.tsx fakes them.
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
jest.mock('../../v2/field/effect.ts', () => ({ fieldEffect: () => ({ status: 'ready', effect: { name: 'effect' }, blueNoise: {}, blueNoiseShader: { name: 'noise' } }) }));

import { Canvas, Rect } from '@shopify/react-native-skia';
import { FieldSurface } from '../../v2/field/FieldSurface';
import { WitnessScene, WITNESS_SCENE_PROBES } from '../scenes/WitnessScene';
import { GAP_DP, sampleOf, witnessLayout } from '../witness/witnessLayout';
import { witnessInsets } from '../witness/witnessInsets';
import { WITNESS_PROBES, witnessProbeProblems } from '../witness/witnessProbes';
import { frameOf, hostByNativeId, layoutRules, type Box, type Node } from './__fixtures__/yogaRtl';
import { labMounts } from './__fixtures__/labMounts';

// Each test's scene is unmounted after it, so its first-draw deadline (RA-55) never outlives the test (UI-261).
const mounts = labMounts();


// The dry run's device: 1080 × 2340 px at 2.625 px per dp; the status bar 74 px, the navigation bar 39 px, both over the
// stage (the lab window is edge to edge), so the capture region is y 74 to 2301 px.
const K = 2.625;
const W = 1080 / K;
const H = 2340 / K;
const STATUS_BAR = 74 / K;
const NAV_BAR = 39 / K;
const CAPTURE: Box = { x: 0, y: STATUS_BAR, width: W, height: H - STATUS_BAR - NAV_BAR };

const gapBetween = (a: Box, b: Box) => Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width), b.y - (a.y + a.height), a.y - (b.y + b.height));
const inside = (inner: Box, outer: Box) =>
  inner.x >= outer.x - 1e-9 && inner.y >= outer.y - 1e-9 && inner.x + inner.width <= outer.x + outer.width + 1e-9 && inner.y + inner.height <= outer.y + outer.height + 1e-9;
const paramsOf = (scene: string): LabParams => ({ run: 'r', scene, clock: 'fixed', t: 0, stepMs: 0, frames: 10 });

const originalHeight = StatusBar.currentHeight;
beforeEach(() => {
  jest.replaceProperty(I18nManager, 'isRTL', true);
  StatusBar.currentHeight = STATUS_BAR;
  jest.spyOn(PixelRatio, 'get').mockReturnValue(K);
  jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(1); // the dry run's font scale
});
afterEach(() => {
  jest.restoreAllMocks();
  StatusBar.currentHeight = originalHeight;
});

/** The scene mounted, measured on the dry run's stage, with every probe laid out and measured where Yoga puts it. */
function mountMeasured(scene: string) {
  const rules = layoutRules(I18nManager);
  const stage: Box = { x: 0, y: 0, width: W, height: H };
  const reported: Record<string, ProbeRect> = {};
  let r!: ReactTestRenderer.ReactTestRenderer;
  // The device's measureInWindow: the window rect of the view that asks, by the layout rules above.
  jest.spyOn(View.prototype as never as { measureInWindow(cb: unknown): void }, 'measureInWindow').mockImplementation(function (this: { props: { nativeID?: string } }, cb: unknown) {
    const f = frameOf(hostByNativeId(r.root, this.props.nativeID), stage, rules);
    (cb as (...v: number[]) => void)(f.x, f.y, f.width, f.height);
  });
  act(() => {
    r = ReactTestRenderer.create(
      <ShaderReportContext.Provider value={() => {}}>
        <ProbeRegistry onMeasure={(id, rect) => { reported[id] = rect; }}>
          <WitnessScene params={paramsOf(scene)} />
        </ProbeRegistry>
      </ShaderReportContext.Provider>,
    );
  });
  mounts.track(r);
  act(() => r.root.find((n) => n.props.testID === 'witness-scene.view' && typeof n.type !== 'string').props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: W, height: H } } }));
  const probeHosts = r.root.findAll((n) => typeof n.type === 'string' && typeof n.props.nativeID === 'string' && n.props.nativeID.startsWith('probe-'));
  act(() => { for (const n of probeHosts) n.props.onLayout({ nativeEvent: { layout: {} } }); });
  const at = (n: Node) => frameOf(n, stage, rules);
  return { r, reported, at };
}

describe.each(['dark', 'light'] as const)('under RTL (isRTL true, left and right swapped), the %s witness', (face) => {
  // The layout the scene makes from the insets it reads (StatusBar.currentHeight is set in beforeEach).
  const layoutOf = () => witnessLayout(face, W, H, K, 1, witnessInsets());

  it('every rect the scene draws is at least GAP_DP from every other, and every sample square is inside the capture region', () => {
    const layout = layoutOf();
    const { r, at } = mountMeasured(`witness.abyss.${face}`);
    const insideSurface = (n: Node | null): boolean => n !== null && (n.type === FieldSurface || insideSurface(n.parent));
    const canvas = r.root.findAllByType(Canvas).filter((n) => !insideSurface(n.parent));
    expect(canvas).toHaveLength(1);
    const canvasHost = (n: Node): Node => (typeof n.type === 'string' ? n : canvasHost(n.parent as Node));
    const origin = at(canvasHost(canvas[0]));
    const drawn: Array<{ id: string; rect: Box }> = canvas[0].findAllByType(Rect).map((n) => ({
      id: `skia ${n.props.color}`, rect: { x: origin.x + n.props.x, y: origin.y + n.props.y, width: n.props.width, height: n.props.height },
    }));
    for (const kind of ['W1a', 'W3']) {
      for (const n of r.root.findAll((x) => typeof x.type === 'string' && typeof x.props.testID === 'string' && x.props.testID.startsWith(`witness.${kind}.`))) {
        drawn.push({ id: n.props.testID, rect: at(n) });
      }
    }
    // W1b is the stage's own field: its patch is where the layout put it, on the surface over the whole stage.
    const surface = r.root.findAllByType(FieldSurface)[0];
    const surfaceAt = at(canvasHost(surface));
    drawn.push({ id: 'W1b', rect: { ...layout.w1b.rect, x: surfaceAt.x + layout.w1b.rect.x, y: surfaceAt.y + layout.w1b.rect.y } });
    expect(drawn).toHaveLength(31);
    const crowded: string[] = [];
    for (let i = 0; i < drawn.length; i++) {
      for (let j = i + 1; j < drawn.length; j++) {
        const g = gapBetween(drawn[i].rect, drawn[j].rect);
        if (g < GAP_DP) crowded.push(`${drawn[i].id} | ${drawn[j].id}: ${g.toFixed(2)} dp`);
      }
    }
    expect(crowded).toEqual([]);
    expect(drawn.filter((d) => !inside(sampleOf(d.rect), CAPTURE)).map((d) => d.id)).toEqual([]);
  });

  it('every W1a and W3 probe lands on its layout rect: the row passes the harness\'s 1 px check', () => {
    const { reported } = mountMeasured(`witness.abyss.${face}`);
    expect(Object.keys(reported).sort()).toEqual([...WITNESS_PROBES].sort());
    expect(witnessProbeProblems(layoutOf(), reported)).toEqual([]);
  });

  it('READY with every probe, at full float precision, is one logcat line', () => {
    const { reported } = mountMeasured(`witness.abyss.${face}`);
    const long = 1079.9999656677246;
    const worst = Object.fromEntries(Object.keys(reported).map((id) => [id, probeRect({ x: long / K, y: long / K, width: long / K, height: long / K }, K)]));
    // UI-276: and the longest Skia backend fact the lab can send, a reason clipped to its most.
    const skiaBackend = { backend: null, readBy: null, reason: `${'x'.repeat(SKIA_BACKEND_MAX_REASON - 1)}…` };
    expect(() => formatLine('READY', {
      run: 'wit-0000000-dark-1', seq: 0, scene: `witness.abyss.${face}`, clock: 'fixed', t: 11000, powerSave: false, pixelRatio: K,
      isRTL: true, fontScale: 1, probes: worst, sentinel: LAB_SENTINEL, shaderStatus: 'ready', shaderReason: null, tier: null, skiaBackend,
    })).not.toThrow();
  });
});

it('the scene declares exactly the witness probes, so READY waits for every one', () => {
  expect(WITNESS_SCENE_PROBES).toEqual(WITNESS_PROBES);
});
