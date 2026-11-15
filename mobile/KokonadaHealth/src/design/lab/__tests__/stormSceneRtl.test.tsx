import React from 'react';
import { I18nManager, PixelRatio, View } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { heroLayout } from '../../v2/field/fallbackScenes';
import { ProbeRegistry } from '../probe/Probe';
import type { ProbeRect } from '../probe/geometry';
import type { LabParams } from '../params';
import { ShaderReportContext } from '../shaderReport';

// B8-7, the owner's phone in Hebrew (Galaxy S22+, he-IL, isRTL true). React Native on Android swaps left and right under
// RTL (I18nManager.doLeftAndRightSwapInRTL, on by default): Fabric turns every `left` into `start`
// (YogaLayoutableShadowNode::swapLeftAndRightInYogaStyleProps) and Yoga resolves start by each node's direction, inherited
// unless a style sets it. A storm marker at `left: 0` would land on the right edge while flashTrace looks for it on the
// left. The stage sets `direction: 'ltr'`, as the witness scene does, so the marker lands where the field's layout and the
// recording put it. The tree is laid out by those rules here, as WitnessSceneRtl.test.tsx lays it out (its frameOf is a
// test file's own function, so it is repeated below), on the S22+'s geometry: 1080 × 2340 px at 2.625 px per dp, the
// status bar 74 px over the edge-to-edge stage.
jest.mock('react-native-reanimated', () => {
  const { useEffect, useRef } = require('react');
  return {
    useSharedValue: (initial: unknown) => {
      const ref = useRef(null as null | { value: unknown });
      if (ref.current === null) ref.current = { value: initial };
      return ref.current;
    },
    useDerivedValue: (fn: () => unknown) => ({ get value() { return fn(); } }),
    runOnJS: (fn: (...args: unknown[]) => void) => (...args: unknown[]) => fn(...args),
    useFrameCallback: () => {
      const ref = useRef({ isActive: false, callbackId: -1, setActive(a: boolean) { ref.current.isActive = a; } });
      useEffect(() => undefined, []);
      return ref.current;
    },
  };
});
jest.mock('@shopify/react-native-skia', () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => children ?? null;
  return { Canvas: Stub, Image: () => null, Picture: () => null, FilterMode: { Nearest: 0, Linear: 1 }, MipmapMode: { None: 0, Nearest: 1, Linear: 2 }, Skia: {} };
});
jest.mock('../../v2/field/effect.ts', () => ({ fieldEffect: () => ({ status: 'ready', effect: { name: 'effect' }, blueNoise: {}, blueNoiseShader: { name: 'noise' } }) }));

import { StormScene } from '../scenes/StormScene';
import { STORM_MARKER_DP } from '../storm/stormMarker';
import { STORM_SCENE_SPECS } from '../storm/stormScenes';

type Box = { x: number; y: number; width: number; height: number };
type Node = ReactTestRenderer.ReactTestInstance;

const K = 2.625;
const W = 1080 / K;
const H = 2340 / K;
const STATUS_BAR = 74 / K;

const flat = (style: unknown) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean)) as Record<string, unknown>;
const num = (v: unknown) => (v === undefined ? undefined : (v as number));

/** Where a host node lands, by Yoga's rules under RN's left/right swap (WitnessSceneRtl.test.tsx's model). */
function frameOf(node: Node, stage: Box, swap: boolean, rootDir: 'ltr' | 'rtl'): Box {
  const chain: Node[] = [];
  for (let n: Node | null = node; n !== null; n = n.parent) if (typeof n.type === 'string') chain.unshift(n);
  let box = stage;
  let dir = rootDir;
  for (const n of chain) {
    const s = flat(n.props.style);
    if (s.direction === 'ltr' || s.direction === 'rtl') dir = s.direction;
    if (s.position !== 'absolute') {
      if (Object.keys(s).some((k) => !['flex', 'direction'].includes(k))) throw new Error(`unmodelled in-flow style ${JSON.stringify(s)}`);
      continue;
    }
    let start = num(s.start);
    let end = num(s.end);
    let left = num(s.left);
    let right = num(s.right);
    if (swap) {
      if (left !== undefined) start = left;
      if (right !== undefined) end = right;
      left = undefined;
      right = undefined;
    }
    const L = left ?? (dir === 'rtl' ? end : start);
    const R = right ?? (dir === 'rtl' ? start : end);
    const T = num(s.top);
    const B = num(s.bottom);
    const width = num(s.width) ?? box.width - (L ?? 0) - (R ?? 0);
    const height = num(s.height) ?? box.height - (T ?? 0) - (B ?? 0);
    const x = L !== undefined ? box.x + L : R !== undefined ? box.x + box.width - R - width : box.x;
    const y = T !== undefined ? box.y + T : B !== undefined ? box.y + box.height - B - height : box.y;
    box = { x, y, width, height };
  }
  return box;
}

const paramsOf = (scene: string): LabParams => ({ run: 'r', scene, clock: 'realtime', t: 0, stepMs: 0, frames: 10 });
const ID = 'storm.abyss.dark.idle-still';

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(PixelRatio, 'get').mockReturnValue(K);
  jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(1);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

function mountMeasured(rtl: boolean) {
  jest.replaceProperty(I18nManager, 'isRTL', rtl);
  const swap = I18nManager.isRTL && I18nManager.doLeftAndRightSwapInRTL !== false;
  const rootDir = I18nManager.isRTL ? 'rtl' : 'ltr';
  const stage: Box = { x: 0, y: 0, width: W, height: H };
  const reported: Record<string, ProbeRect> = {};
  let r!: ReactTestRenderer.ReactTestRenderer;
  jest.spyOn(View.prototype as never as { measureInWindow(cb: unknown): void }, 'measureInWindow').mockImplementation(function (this: { props: { nativeID?: string } }, cb: unknown) {
    const host = r.root.find((n) => typeof n.type === 'string' && n.props.nativeID === this.props.nativeID);
    const f = frameOf(host, stage, swap, rootDir);
    (cb as (...v: number[]) => void)(f.x, f.y, f.width, f.height);
  });
  act(() => {
    r = ReactTestRenderer.create(
      <ShaderReportContext.Provider value={() => {}}>
        <ProbeRegistry onMeasure={(id, rect) => { reported[id] = rect; }}>
          <StormScene clock={{ t: { value: 0 } } as never} t={null} params={paramsOf(ID)} />
        </ProbeRegistry>
      </ShaderReportContext.Provider>,
    );
  });
  act(() => r.root.find((n) => n.props.testID === 'storm-scene.view' && typeof n.type !== 'string').props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: W, height: H } } }));
  const hosts = r.root.findAll((n) => typeof n.type === 'string' && typeof n.props.nativeID === 'string' && n.props.nativeID.startsWith('probe-'));
  act(() => { for (const n of hosts) n.props.onLayout({ nativeEvent: { layout: {} } }); });
  const marker = frameOf(r.root.find((n) => typeof n.type === 'string' && n.props.nativeID === 'probe-marker'), stage, swap, rootDir);
  act(() => r.unmount());
  return { marker, reported };
}

const WANT: Box = { x: STORM_MARKER_DP.left, y: STORM_MARKER_DP.top, width: STORM_MARKER_DP.size, height: STORM_MARKER_DP.size };

describe.each([true, false])('isRTL %s: the storm marker lands at the window\'s top left', (rtl) => {
  it('the marker\'s frame is its dp rect, and READY\'s marker probe says the same in px', () => {
    const { marker, reported } = mountMeasured(rtl);
    expect(marker).toEqual(WANT);
    expect(reported.marker.px).toEqual({ x: WANT.x * K, y: WANT.y * K, width: WANT.width * K, height: WANT.height * K });
  });
});

describe('the marker on the S22+ (1080 × 2340 px, 2.625 px per dp, the status bar 74 px)', () => {
  const layout = heroLayout(STORM_SCENE_SPECS[ID].direction, W, H, 1);
  const corners = [[WANT.x, WANT.y], [WANT.x + WANT.width, WANT.y], [WANT.x, WANT.y + WANT.height], [WANT.x + WANT.width, WANT.y + WANT.height]];

  it('below the status bar, inside the window', () => {
    expect(WANT.y).toBeGreaterThanOrEqual(STATUS_BAR);
    expect(WANT.x + WANT.width).toBeLessThanOrEqual(W);
  });

  it('clear of the plate: its nearest point is outside the plate by more than a 24 dp cell', () => {
    const [cx, cy] = layout.centre;
    const nx = Math.min(Math.max(cx, WANT.x), WANT.x + WANT.width);
    const ny = Math.min(Math.max(cy, WANT.y), WANT.y + WANT.height);
    expect(Math.hypot(cx - nx, cy - ny)).toBeGreaterThan(layout.radius + 24);
    expect(corners.length).toBe(4);
  });

  it('over the ground: no quiet rect meets it', () => {
    const meets = (q: Box) => !(q.x >= WANT.x + WANT.width || q.x + q.width <= WANT.x || q.y >= WANT.y + WANT.height || q.y + q.height <= WANT.y);
    expect((layout.quietRects ?? []).filter((q) => meets(q as Box))).toEqual([]);
  });
});
