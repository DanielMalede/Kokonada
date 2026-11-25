import React from 'react';
import { I18nManager, StyleSheet, View } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { contrastRatio } from '../../../color/contrast.ts';
import { maxInBandOnPixelBlend, maxInBandOnSrgbBlend, type Bytes } from '../../../color/edgeSweep.ts';
import type { Srgb } from '../../../color/oklab.ts';
import type { MotionTier } from '../../../motion/useMotionPolicy.ts';
import { CHECK_BAND, DESIGN_BAND } from '../../../tokens/neverRedSweeps.ts';
import { DirectionProvider } from '../../../tokens/DirectionProvider.tsx';
import { BASE, DIRECTIONS, type Face } from '../../../tokens/tokens.generated.ts';
import { Well, type WellProps } from '../Well.tsx';
import { hintEasing } from '../wellMotion.ts';

// A stateful fake of the part of Reanimated the Well uses: a shared value lives for the mount (as on the device), an
// animated style reads its shared values live whenever it is read (as the UI thread does), and withTiming records each
// animation it is asked for and lands on its target. The timing law itself is wellMotion.test.ts's.
jest.mock('react-native-reanimated', () => {
  const { useRef } = require('react');
  const RNView = require('react-native').View;
  const timings: Array<{ toValue: number; config: { duration: number; easing: (t: number) => number } }> = [];
  return {
    __esModule: true,
    default: { View: RNView },
    View: RNView,
    useSharedValue: (initial: number) => {
      const ref = useRef(null as null | { value: number });
      if (ref.current === null) ref.current = { value: initial };
      return ref.current;
    },
    useAnimatedStyle: (updater: () => Record<string, unknown>) => {
      const live = {};
      for (const key of Object.keys(updater())) Object.defineProperty(live, key, { enumerable: true, get: () => updater()[key] });
      return live;
    },
    withTiming: (toValue: number, config: { duration: number; easing: (t: number) => number }) => {
      timings.push({ toValue, config });
      return toValue;
    },
    __timings: timings,
  };
});

type Timing = { toValue: number; config: { duration: number; easing: (t: number) => number } };
const timings = (): Timing[] => jest.requireMock('react-native-reanimated').__timings;

type Node = ReactTestRenderer.ReactTestInstance;
const flat = (n: Node) => StyleSheet.flatten(n.props.style) ?? {};
const isHost = (n: Node) => typeof n.type === 'string';
const HINT = 'Tap the plate to place a point.';

type Mounted = Omit<WellProps, 'children'> & { face?: Face };
function mount(props: Mounted) {
  const tree = (p: Mounted) => (
    <DirectionProvider direction="abyss" face={p.face ?? 'dark'}>
      <Well actionShown={p.actionShown} hint={p.hint} script={p.script} tier={p.tier} consentSlot={p.consentSlot}>
        <View testID="action" />
      </Well>
    </DirectionProvider>
  );
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(tree(props));
  });
  const root = () => r.root.find((n) => isHost(n) && n.props.testID === 'hero.well');
  const text = () => r.root.findAll((n) => isHost(n) && String(n.type) === 'Text');
  const hostParent = (n: Node) => {
    for (let p = n.parent; p !== null; p = p.parent) if (isHost(p)) return p;
    throw new Error('no host parent');
  };
  const hintLayer = () => hostParent(text()[0]);
  /** The action's measured container, then the layer that holds it in the Well. */
  const actionBox = () => hostParent(r.root.find((n) => isHost(n) && n.props.testID === 'action'));
  const actionLayer = () => hostParent(actionBox());
  return { r, root, text, hintLayer, actionBox, actionLayer, update: (next: Mounted) => act(() => r.update(tree(next))), unmount: () => act(() => r.unmount()) };
}

const base: Mounted = { actionShown: false, hint: HINT, script: 'latin', tier: 'full' };

beforeEach(() => {
  timings().splice(0);
});
afterEach(() => jest.restoreAllMocks());

describe('Well: the slot', () => {
  it('is a full-column slot at least well.height tall, its height a minimum, never fixed (F10 R6)', () => {
    const view = mount(base);
    const s = flat(view.root());
    expect(s).toMatchObject({ minHeight: BASE.well.height, alignSelf: 'stretch', justifyContent: 'center' });
    expect(s).not.toHaveProperty('height');
    view.unmount();
  });

  it('with the reserved consent slot, is at least well.consentSlotHeight and shows no hint: the slot carries no copy (DEC-066)', () => {
    const view = mount({ ...base, consentSlot: true });
    expect(flat(view.root()).minHeight).toBe(BASE.well.consentSlotHeight);
    expect(view.text().map((n) => n.props.children)).toEqual([]);
    view.unmount();
  });

  it('grows to hold an action taller than its minimum, so a 2.0 label is never clipped, and shrinks back to the token', () => {
    const view = mount(base);
    act(() => view.actionBox().props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 336, height: 80 } } }));
    expect(flat(view.root()).minHeight).toBe(80);
    act(() => view.actionBox().props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 336, height: 40 } } }));
    expect(flat(view.root()).minHeight).toBe(BASE.well.height);
    view.unmount();
  });

  it('holds the hint in its flow and the action in a layer over it, centred, so each keeps the other’s place', () => {
    const view = mount(base);
    expect(flat(view.actionLayer())).toMatchObject({ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'center' });
    expect(flat(view.hintLayer())).not.toHaveProperty('position', 'absolute');
    // The hint comes first, so TalkBack reads it before the action, as it sits.
    const hosts = view.r.root.findAll(isHost);
    expect(hosts.indexOf(view.hintLayer())).toBeLessThan(hosts.indexOf(view.actionLayer()));
    view.unmount();
  });

  it('mirrors with the page, as the plate does not: it sets no direction, and fills symmetrically', () => {
    for (const rtl of [false, true]) {
      jest.replaceProperty(I18nManager, 'isRTL', rtl);
      const view = mount(base);
      for (const n of view.r.root.findAll(isHost)) expect(flat(n)).not.toHaveProperty('direction');
      view.unmount();
    }
  });

  it('has no tint, no fill and no elevation, and no spinner (F10 R3, R5, R9)', () => {
    const view = mount({ ...base, actionShown: true });
    const hosts = view.r.root.findAll(isHost);
    const keys = hosts.flatMap((n) => Object.keys(flat(n)));
    expect(keys.filter((k) => k === 'backgroundColor' || k === 'elevation' || k.startsWith('shadow'))).toEqual([]);
    expect([...new Set(hosts.map((n) => n.type))].sort()).toEqual(['Text', 'View']);
    view.unmount();
  });
});

describe('Well: the hint (LEDGER §3 L9: say what makes the action appear)', () => {
  it.each([['dark', 'latin'], ['light', 'hebrew']] as const)('%s, %s: ui.body in text.secondary, centred, from the tokens, never capped or ellipsised', (face, script) => {
    const view = mount({ ...base, face, script });
    const [hint] = view.text();
    expect(hint.props.children).toBe(HINT);
    const body = BASE.type.ui.body[script];
    expect(flat(hint)).toMatchObject({
      fontFamily: BASE.type.face.ui,
      fontSize: body.size,
      lineHeight: body.lineHeight,
      fontWeight: String(body.weight),
      letterSpacing: body.tracking * body.size,
      color: DIRECTIONS.abyss.color[face].text.secondary.hex,
      textAlign: 'center',
    });
    expect(hint.props.numberOfLines).toBeUndefined();
    expect(hint.props.adjustsFontSizeToFit).toBeFalsy();
    expect(hint.props.maxFontSizeMultiplier).toBeUndefined();
    expect(hint.props.allowFontScaling).not.toBe(false);
    view.unmount();
  });

  it('while the action is not shown, holds its place: in full, and reachable by TalkBack, as plain text', () => {
    const view = mount(base);
    expect(flat(view.hintLayer()).opacity).toBe(1);
    expect(view.hintLayer().props.accessibilityElementsHidden).toBeFalsy();
    expect(view.hintLayer().props.importantForAccessibility).not.toBe('no-hide-descendants');
    view.unmount();
  });

  it('is never a live region and never an alert: the Announcer speaks, the hint only sits (LEDGER §10)', () => {
    const view = mount(base);
    for (const n of view.r.root.findAll(isHost)) {
      expect(['polite', 'assertive']).not.toContain(n.props.accessibilityLiveRegion);
      expect(n.props.accessibilityRole).not.toBe('alert');
      expect(n.props.role).not.toBe('alert');
    }
    view.unmount();
  });

  it('without a hint the place is empty (P2, DEC-032), and the Well keeps its height', () => {
    const view = mount({ ...base, hint: undefined });
    expect(view.text().map((n) => n.props.children)).toEqual([]);
    expect(flat(view.root()).minHeight).toBe(BASE.well.height);
    view.unmount();
  });
});

describe('Well: the hint and the action take turns (DEC-174)', () => {
  it('while the action is shown, the hint gives way: faded out and hidden from TalkBack; the action can be pressed and reached', () => {
    const view = mount({ ...base, actionShown: true });
    expect(flat(view.hintLayer()).opacity).toBe(0);
    expect(view.hintLayer().props.accessibilityElementsHidden).toBe(true);
    expect(view.hintLayer().props.importantForAccessibility).toBe('no-hide-descendants');
    expect(view.actionLayer().props.pointerEvents).toBe('box-none');
    expect(view.actionLayer().props.accessibilityElementsHidden).toBeFalsy();
    view.unmount();
  });

  it('while the action is not shown, it can be neither pressed nor reached: never an invisible, pressable commit', () => {
    const view = mount(base);
    expect(view.actionLayer().props.pointerEvents).toBe('none');
    expect(view.actionLayer().props.accessibilityElementsHidden).toBe(true);
    expect(view.actionLayer().props.importantForAccessibility).toBe('no-hide-descendants');
    view.unmount();
  });

  it('arrives with the page: no fade of its own when it mounts, either way', () => {
    mount(base).unmount();
    mount({ ...base, actionShown: true }).unmount();
    expect(timings()).toEqual([]);
  });

  const easingAt = (f: (t: number) => number) => [0.1, 0.3, 0.5, 0.7, 0.9].map(f);
  it.each(['full', 'low'] as MotionTier[])('%s tier: gives way over motion.settle as the action shows, returns over motion.respond as it hides', (tier) => {
    const view = mount({ ...base, tier });
    view.update({ ...base, tier, actionShown: true });
    view.update({ ...base, tier, actionShown: false });
    const [out, back] = timings();
    expect(timings()).toHaveLength(2);
    expect([out.toValue, out.config.duration]).toEqual([0, BASE.motion.settle.duration]);
    expect(easingAt(out.config.easing)).toEqual(easingAt(hintEasing(BASE.motion.settle.easing)));
    expect([back.toValue, back.config.duration]).toEqual([1, BASE.motion.respond.duration]);
    expect(easingAt(back.config.easing)).toEqual(easingAt(hintEasing(BASE.motion.respond.easing)));
    expect(flat(view.hintLayer()).opacity).toBe(1);
    view.unmount();
  });

  it('still tier (reduced motion): one linear motion.fadeReduced either way, and nothing runs while nothing changes', () => {
    const view = mount({ ...base, tier: 'still' });
    view.update({ ...base, tier: 'still' });
    expect(timings()).toEqual([]);
    view.update({ ...base, tier: 'still', actionShown: true });
    view.update({ ...base, tier: 'still', actionShown: false });
    expect(timings().map((t) => [t.toValue, t.config.duration])).toEqual([[0, BASE.motion.fadeReduced.duration], [1, BASE.motion.fadeReduced.duration]]);
    expect(easingAt(timings()[0].config.easing)).toEqual(easingAt(hintEasing(BASE.motion.fadeReduced.easing)));
    view.unmount();
  });

  it('a tier change alone moves nothing: only a turn of the hint and the action is animated', () => {
    const view = mount(base);
    view.update({ ...base, tier: 'still' });
    view.update({ ...base, tier: 'low' });
    expect(timings()).toEqual([]);
    view.unmount();
  });
});

describe('Well: the hint’s ink is never red and reads at 4.5:1 on the ground it sits on', () => {
  const bytesOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as unknown as Bytes;
  const unit = (b: Bytes) => b.map((v) => v / 255) as unknown as Srgb;
  it.each(['dark', 'light'] as const)('%s: text.secondary over the ground (the Well is a quiet zone, the field is 0 there)', (face) => {
    const c = DIRECTIONS.abyss.color[face];
    const ink = bytesOf(c.text.secondary.hex);
    const ground = bytesOf(c.ground.hex);
    expect(maxInBandOnSrgbBlend(unit(ground), unit(ink), DESIGN_BAND, 1).chroma).toBeLessThan(DESIGN_BAND.chromaFloor - BASE.neverRed.margin);
    expect(maxInBandOnPixelBlend(ground, ink, CHECK_BAND, 254).chroma).toBeLessThan(CHECK_BAND.chromaFloor - BASE.neverRed.margin);
    // An arithmetic prediction, never evidence: the device capture measures it.
    expect(contrastRatio(unit(ink), unit(ground))).toBeGreaterThanOrEqual(4.5);
  });
});
