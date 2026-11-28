import React from 'react';
import { I18nManager, PixelRatio, StyleSheet } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

// UI-242 for the hero scene (F10 G8): the harness reads probes in physical px and the owner's phone is he-IL (isRTL true),
// so every View the scene places by its sides must land where it lands on a left-to-right phone. React Native on Android
// swaps left and right under RTL (Fabric turns `left` into `start`), so the scene lays the plate's box out in a full-stage
// box with `direction: 'ltr'`, and the Plate, RimLabels, BeadLayer and PlateTouch each pin their own root left to right
// (R7, QA-088): the plate never mirrors. The Well is centred on the CTA's column by the same inset on both sides, so the
// swap cannot move it, and it mirrors inside with the page, as it should. Laid out by the lab's one Yoga model
// (__fixtures__/yogaRtl.ts) under RTL and under LTR, on the owner's phone's stage, at the font scales the captures use.
jest.mock('react-native-reanimated', () => {
  const { useRef } = require('react');
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
    useFrameCallback: () => {
      const ref = useRef({ isActive: false, callbackId: -1, setActive(a: boolean) { ref.current.isActive = a; } });
      return ref.current;
    },
  };
});
jest.mock('@shopify/react-native-skia', () => require('./__fixtures__/skiaHeadless').skiaHeadless());
// FieldView draws through Skia, which never mirrors; only the lab's own Views are laid out here.
jest.mock('../../v2/field/FieldView', () => ({ FieldView: () => null }));
// heroLayout centres the plate on the stage, where mirroring moves nothing; a test may move the centre off the middle
// (mockShift), where a plate laid out by the page's direction would land mirrored under RTL. The field scenes' catalogue
// calls heroLayout as it loads, before this file's body has run, so the shift reads as 0 until then.
const mockShift = { dx: 0 };
jest.mock('../../v2/field/fallbackScenes', () => {
  const actual = jest.requireActual('../../v2/field/fallbackScenes');
  return {
    ...actual,
    heroLayout: (...args: unknown[]) => {
      const layout = actual.heroLayout(...args);
      return { ...layout, centre: [layout.centre[0] + (mockShift?.dx ?? 0), layout.centre[1]] };
    },
  };
});

import { heroLayout } from '../../v2/field/fallbackScenes';
import type { MotionPorts } from '../../v2/motion/ports';
import { ProbeRegistry } from '../probe/Probe';
import type { LabParams } from '../params';
import { LabMotionPortsContext } from '../scenes/FieldScene';
import { HeroScene } from '../scenes/HeroScene';
import { frameOf, hostByNativeId, layoutRules, type Box, type Node } from './__fixtures__/yogaRtl';
import { labMounts } from './__fixtures__/labMounts';

const mounts = labMounts();

// The owner's phone: 1080 × 2340 px at 2.625 px per dp.
const K = 2.625;
const W = 1080 / K;
const H = 2340 / K;
const STAGE: Box = { x: 0, y: 0, width: W, height: H };
const never: MotionPorts = { reduceMotion: { read: () => new Promise(() => {}), subscribe: () => () => {} }, powerSave: { read: () => new Promise(() => {}), subscribe: () => () => {} } };
const paramsOf = (scene: string): LabParams => ({ run: 'r', scene, clock: 'fixed', t: 0, stepMs: 0, frames: 3 });
const isHost = (n: Node) => typeof n.type === 'string';

/** The scene mounted under `rtl`, its view given the stage's size, and every placed View's frame by the shared model. */
function placed(scene: string, rtl: boolean, fontScale: number) {
  jest.replaceProperty(I18nManager, 'isRTL', rtl);
  jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(fontScale);
  const rules = layoutRules(I18nManager);
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(
      <ProbeRegistry onMeasure={() => {}}>
        <LabMotionPortsContext.Provider value={never}>
          <HeroScene clock={{ t: { value: 0 } } as never} t={0} params={paramsOf(scene)} />
        </LabMotionPortsContext.Provider>
      </ProbeRegistry>,
    );
  });
  mounts.track(r);
  act(() => r.root.find((n) => n.props.testID === 'hero-scene.view' && !isHost(n)).props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: W, height: H } } }));
  const at = (n: Node) => frameOf(n, STAGE, rules);
  const byTestId = (id: string) => r.root.find((n) => isHost(n) && n.props.testID === id);
  const all = (pattern: RegExp) => r.root.findAll((n) => isHost(n) && pattern.test(String(n.props.testID ?? '')));
  const frames: Record<string, Box> = {
    plate: at(hostByNativeId(r.root, 'probe-plate')),
    root: at(byTestId('hero.plate')),
    entry: at(byTestId('hero.listEntry')),
    touch: at(byTestId('hero.plate.touch')),
    latest: at(byTestId('hero.plate.bead.latest.a11y')),
    beads: at(byTestId('bead.layer')),
  };
  for (const n of all(/^hero\.plate\.word\.\w+\.a11y$/)) frames[n.props.testID] = at(n);
  for (const n of all(/^hero\.plate\.bead\.\d$/)) frames[`bead.${n.props.testID.slice('hero.plate.bead.'.length)}`] = at(n);
  const well = StyleSheet.flatten(byTestId('hero-scene.well-column').props.style);
  return { frames, well };
}

beforeEach(() => {
  jest.spyOn(PixelRatio, 'get').mockReturnValue(K);
});
afterEach(() => {
  jest.restoreAllMocks();
  mockShift.dx = 0;
});

describe('a plate centred off the stage\'s middle (the field\'s centre moved 40 dp right)', () => {
  it('lands at the field\'s centre under RTL as under LTR: the plate is laid out left to right in every locale (R7, QA-088)', () => {
    mockShift.dx = 40;
    const rtl = placed('hero.abyss.dark.three.hebrew', true, 1);
    const ltr = placed('hero.abyss.dark.three.hebrew', false, 1);
    const layout = heroLayout('abyss', W, H, 1);
    expect(layout.centre[0]).toBeCloseTo(W / 2 + 40, 9);
    expect(rtl.frames.plate).toEqual({ x: layout.centre[0] - layout.radius, y: layout.centre[1] - layout.radius, width: 2 * layout.radius, height: 2 * layout.radius });
    expect(rtl.frames).toEqual(ltr.frames);
  });
});

describe.each([1, 2])('at font scale %d, under RTL (isRTL true, left and right swapped)', (fontScale) => {
  it.each(['hero.abyss.dark.three.latin', 'hero.abyss.light.three.hebrew'])('%s: the plate, its words, its beads and its touch layer land as on a left-to-right phone', (scene) => {
    const rtl = placed(scene, true, fontScale);
    const ltr = placed(scene, false, fontScale);
    expect(Object.keys(rtl.frames)).toEqual(expect.arrayContaining(['plate', 'entry', 'latest', 'bead.0', 'bead.1', 'bead.2', 'hero.plate.word.top.a11y', 'hero.plate.word.left.a11y']));
    expect(rtl.frames).toEqual(ltr.frames);
  });

  it('the plate\'s box is the field\'s: heroLayout\'s centre and R on the stage, and the Plate fills it', () => {
    const { frames } = placed('hero.abyss.dark.three.latin', true, fontScale);
    const layout = heroLayout('abyss', W, H, fontScale);
    const box = { x: layout.centre[0] - layout.radius, y: layout.centre[1] - layout.radius, width: 2 * layout.radius, height: 2 * layout.radius };
    expect(frames.plate).toEqual(box);
    expect(frames.root).toEqual(box);
    // The list's button covers the plate's box (ruling 9).
    expect(frames.entry).toEqual(box);
    // The rim words sit on the ring, inside the plate's box; the latest bead's target is centred on the latest bead.
    for (const p of ['top', 'right', 'bottom', 'left']) {
      const w = frames[`hero.plate.word.${p}.a11y`];
      expect([p, w.x >= box.x - 1e-9 && w.y >= box.y - 1e-9 && w.x + w.width <= box.x + box.width + 1e-9 && w.y + w.height <= box.y + box.height + 1e-9]).toEqual([p, true]);
    }
    const bead = frames['bead.2'];
    const latest = frames.latest;
    expect(latest.x + latest.width / 2).toBeCloseTo(bead.x + bead.width / 2, 9);
    expect(latest.y + latest.height / 2).toBeCloseTo(bead.y + bead.height / 2, 9);
  });

  it('the Well\'s column is inset the same on both sides, so the swap cannot move it', () => {
    const { well } = placed('hero.abyss.dark.three.latin', true, fontScale);
    expect(well.position).toBe('absolute');
    expect(well.left).toBe(well.right);
    expect(typeof well.top).toBe('number');
  });
});
