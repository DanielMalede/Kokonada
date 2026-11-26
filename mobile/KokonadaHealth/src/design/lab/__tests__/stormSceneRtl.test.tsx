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
// recording put it. The tree is laid out by those rules here, by the lab's shared model (__fixtures__/yogaRtl.ts), on
// the S22+'s geometry: 1080 × 2340 px at 2.625 px per dp, the
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
import { frameOf, hostByNativeId, layoutRules, type Box } from './__fixtures__/yogaRtl';

const K = 2.625;
const W = 1080 / K;
const H = 2340 / K;
const STATUS_BAR = 74 / K;

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
  const rules = layoutRules(I18nManager);
  const stage: Box = { x: 0, y: 0, width: W, height: H };
  const reported: Record<string, ProbeRect> = {};
  let r!: ReactTestRenderer.ReactTestRenderer;
  jest.spyOn(View.prototype as never as { measureInWindow(cb: unknown): void }, 'measureInWindow').mockImplementation(function (this: { props: { nativeID?: string } }, cb: unknown) {
    const f = frameOf(hostByNativeId(r.root, this.props.nativeID), stage, rules);
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
  const marker = frameOf(hostByNativeId(r.root, 'probe-marker'), stage, rules);
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
