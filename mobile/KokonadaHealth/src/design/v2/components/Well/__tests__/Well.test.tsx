import React, { Profiler } from 'react';
import { I18nManager, Platform, StyleSheet, View } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { contrastRatio } from '../../../color/contrast.ts';
import { maxInBandOnPixelBlend, maxInBandOnSrgbBlend, type Bytes } from '../../../color/edgeSweep.ts';
import type { Srgb } from '../../../color/oklab.ts';
import type { MotionTier } from '../../../motion/useMotionPolicy.ts';
import { CHECK_BAND, DESIGN_BAND } from '../../../tokens/neverRedSweeps.ts';
import { DirectionProvider } from '../../../tokens/DirectionProvider.tsx';
import { BASE, DIRECTIONS, type Face } from '../../../tokens/tokens.generated.ts';
import { fontFace } from '../../../typeface/faces.ts';
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
/** The action's height in dp: 80 is a CommitCTA whose label wraps at font 2.0. */
const ACTION_AT_2 = 80;

// Every View measures, as on the device: React Native's jest View is a class whose measure() never calls back
// (@react-native/jest-preset MockNativeMethods), so here measure, measureInWindow and Fabric's getBoundingClientRect
// report the action's box at once. A Well that measured after its first layout and set its own height from what it
// read would commit a second time, which the Profiler in mount() records.
type Measurable = {
  measure: (cb: (...v: number[]) => void) => void;
  measureInWindow: (cb: (...v: number[]) => void) => void;
  getBoundingClientRect?: () => object;
};
const VIEW = View as unknown as { prototype: Measurable };
// The preset's measure and measureInWindow are already jest.fn, and jest.spyOn on an existing mock installs nothing and
// registers no restore (QA-112): their own implementations are captured and put back by identity after each test.
const measure = VIEW.prototype.measure as unknown as jest.Mock;
const measureInWindow = VIEW.prototype.measureInWindow as unknown as jest.Mock;
const PRESET_MEASURE = measure.getMockImplementation();
const PRESET_MEASURE_IN_WINDOW = measureInWindow.getMockImplementation();
let laidOutHeight = 40;
beforeEach(() => {
  measure.mockImplementation((cb: (...v: number[]) => void) => cb(0, 0, 336, laidOutHeight, 0, 0));
  measureInWindow.mockImplementation((cb: (...v: number[]) => void) => cb(0, 0, 336, laidOutHeight));
  Object.defineProperty(VIEW.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ x: 0, y: 0, width: 336, height: laidOutHeight, top: 0, left: 0, right: 336, bottom: laidOutHeight }),
  });
});
afterEach(() => {
  measure.mockImplementation(PRESET_MEASURE);
  measureInWindow.mockImplementation(PRESET_MEASURE_IN_WINDOW);
  delete VIEW.prototype.getBoundingClientRect;
});

function mount(props: Mounted, actionHeight = 40) {
  laidOutHeight = actionHeight;
  const commits: string[] = [];
  const tree = (p: Mounted) => (
    <DirectionProvider direction="abyss" face={p.face ?? 'dark'}>
      <Profiler id="well" onRender={(_id, phase) => commits.push(phase)}>
        <Well
          actionShown={p.actionShown}
          hint={p.hint}
          script={p.script}
          tier={p.tier}
          consentSlot={p.consentSlot}
          host={p.host}
          hintAlign={p.hintAlign}
          hintAccessibilityLabel={p.hintAccessibilityLabel}
        >
          <View testID="action" style={{ height: actionHeight }} />
        </Well>
      </Profiler>
    </DirectionProvider>
  );
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(tree(props));
  });
  const root = () => r.root.find((n) => isHost(n) && n.props.testID === 'hero.well');
  const text = () => r.root.findAll((n) => isHost(n) && String(n.type) === 'Text');
  const hintLayer = () => hostParent(text()[0]);
  const action = () => r.root.find((n) => isHost(n) && n.props.testID === 'action');
  /** The cell that holds the action in the Well. */
  const actionCell = () => hostParent(action());
  return { r, commits, root, text, hintLayer, action, actionCell, update: (next: Mounted) => act(() => r.update(tree(next))), unmount: () => act(() => r.unmount()) };
}
/** A host by its testID, else its type: what a failure prints, never the test instance itself. */
const named = (n: Node) => String(n.props.testID ?? n.type);
const hostParent = (n: Node) => {
  for (let p = n.parent; p !== null; p = p.parent) if (isHost(p)) return p;
  throw new Error('no host parent');
};

const base: Mounted = { actionShown: false, hint: HINT, script: 'latin', tier: 'full' };

beforeEach(() => {
  timings().splice(0);
});
afterEach(() => jest.restoreAllMocks());

describe('Well: the slot', () => {
  it('is a full-column slot at least well.height tall, its height a minimum, never fixed (F10 R6)', () => {
    const view = mount(base);
    const s = flat(view.root());
    expect(s).toMatchObject({ minHeight: BASE.well.height, alignSelf: 'stretch' });
    expect(s).not.toHaveProperty('height');
    view.unmount();
  });

  it('with the reserved consent slot, is at least well.consentSlotHeight and shows no hint: the slot carries no copy (DEC-066)', () => {
    const view = mount({ ...base, consentSlot: true });
    expect(flat(view.root()).minHeight).toBe(BASE.well.consentSlotHeight);
    expect(view.text().map((n) => n.props.children)).toEqual([]);
    view.unmount();
  });

  // Ruling 6a: the first painted frame already has the final height, with no second layout pass. Jest has no layout
  // engine, so these pin the mechanism that gives Yoga the final height in its first pass (the action in the Well's own
  // flow, never measured); the device capture at font 2.0 is the closing evidence.
  it('at font 2.0, an 80 dp action with no hint: its first layout holds it, in the Well’s own flow, never measured, with no second pass (ruling 6a)', () => {
    const view = mount({ ...base, hint: undefined }, ACTION_AT_2);
    // One commit: nothing measured the action after the first layout and set the Well's height from it.
    expect(view.commits).toEqual(['mount']);
    // No host in the Well asks for its own layout: its height can never arrive a frame late.
    expect(view.r.root.findAll((n) => isHost(n) && n.props.onLayout !== undefined).map(named)).toEqual([]);
    // No absolute layer between the action and the Well: the action's 80 dp is the Well's in the first layout pass.
    for (let n = view.action(); n !== view.root(); n = hostParent(n)) expect([n.props.testID, flat(n).position]).not.toEqual([n.props.testID, 'absolute']);
    expect(named(hostParent(view.actionCell()))).toBe('hero.well');
    // The minimum stays the token, never a measured number: the flow does the growing.
    expect(flat(view.root())).toMatchObject({ minHeight: BASE.well.height });
    expect(flat(view.root())).not.toHaveProperty('height');
    // With no hint the action's cell is the only one: full width, pulled over nothing.
    expect(flat(view.actionCell())).toMatchObject({ width: '100%' });
    expect(flat(view.actionCell())).not.toHaveProperty('marginStart');
    view.unmount();
  });

  it('with a hint, both share one row, centred across: each cell full width, the action’s pulled back over the hint’s by marginStart −100%, so the Well is as tall as the taller in one pass (ruling 6a, option 1)', () => {
    const view = mount(base, ACTION_AT_2);
    expect(flat(view.root())).toMatchObject({ flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', minHeight: BASE.well.height });
    expect(flat(view.hintLayer())).toMatchObject({ width: '100%' });
    expect(flat(view.actionCell())).toMatchObject({ width: '100%', marginStart: '-100%' });
    for (const cell of [view.hintLayer(), view.actionCell()]) {
      expect(flat(cell)).not.toHaveProperty('position', 'absolute');
      expect(named(hostParent(cell))).toBe('hero.well');
    }
    expect(view.commits).toEqual(['mount']);
    expect(view.r.root.findAll((n) => isHost(n) && n.props.onLayout !== undefined).map(named)).toEqual([]);
    // The hint comes first, so TalkBack reads it before the action, as it sits; the action draws over it.
    const hosts = view.r.root.findAll(isHost);
    expect(hosts.indexOf(view.hintLayer())).toBeLessThan(hosts.indexOf(view.actionCell()));
    view.unmount();
  });

  it('the hint coming or going re-lays the row in the same pass: the pull follows the hint’s cell, never a stale one', () => {
    const view = mount({ ...base, hint: undefined }, ACTION_AT_2);
    view.update(base);
    expect(flat(view.actionCell())).toMatchObject({ width: '100%', marginStart: '-100%' });
    view.update({ ...base, hint: undefined });
    expect(flat(view.actionCell())).not.toHaveProperty('marginStart');
    expect(view.commits).toEqual(['mount', 'update', 'update']);
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
  // Jest runs as iOS (the preset's Platform.OS), where a face is the family at the weight; Android's form is pinned below.
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

  // React Native on Android loads fonts/<fontFamily>.ttf by its exact name and picks a file by normal or bold only: the
  // family 'Heebo' with a weight finds no file and draws the system face (the lab's font check, f3e4679: Heebo@400 at the
  // fallback's width). So on Android the hint names ui.body's per-weight file, with no weight on top (typeface/faces.ts).
  it.each([['latin', 'Heebo-Regular'], ['hebrew', 'Heebo-Regular']] as const)('on Android, %s: the hint is set in ui.body’s own file, %s, with no fontWeight', (script, file) => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const view = mount({ ...base, script });
    const style = flat(view.text()[0]);
    expect(style.fontFamily).toBe(file);
    expect(style.fontFamily).toBe(fontFace(BASE.type.face.ui, BASE.type.ui.body[script].weight, 'android').fontFamily);
    expect(style).not.toHaveProperty('fontWeight');
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
    expect(view.actionCell().props.pointerEvents).toBe('box-none');
    expect(view.actionCell().props.accessibilityElementsHidden).toBeFalsy();
    view.unmount();
  });

  it('while the action is not shown, it can be neither pressed nor reached: never an invisible, pressable commit', () => {
    const view = mount(base);
    expect(view.actionCell().props.pointerEvents).toBe('none');
    expect(view.actionCell().props.accessibilityElementsHidden).toBe(true);
    expect(view.actionCell().props.importantForAccessibility).toBe('no-hide-descendants');
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

// The designer's F3 (LEDGER rev §3 L9; QA-068): a Well that hosts a Button (P1·AGE) crossfades the Button against the
// hint itself, and changes state at most once per well.hold: a turn starts at most once per hold, and when a hold ends
// the Well takes the latest state the page asked for, if it differs from the one it shows.
describe('Well: the button host (F3)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  const R = BASE.motion.respond;
  const button: Mounted = { ...base, host: 'button' };
  /** Moves the clock on by `ms`, running the hold's end and the turn it starts. */
  const wait = (ms: number) => act(() => {
    jest.advanceTimersByTime(ms);
  });
  const turns = () => timings().map((t) => [t.toValue, t.config.duration]);
  const easingAt = (f: (t: number) => number) => [0.1, 0.3, 0.5, 0.7, 0.9].map(f);

  it.each(['full', 'low'] as MotionTier[])('%s tier: the Button and the hint crossfade over motion.respond, both ways', (tier) => {
    const view = mount({ ...button, tier });
    expect([flat(view.hintLayer()).opacity, flat(view.actionCell()).opacity]).toEqual([1, 0]);
    view.update({ ...button, tier, actionShown: true });
    expect(turns()).toEqual([[0, R.duration], [1, R.duration]]);
    expect([flat(view.hintLayer()).opacity, flat(view.actionCell()).opacity]).toEqual([0, 1]);
    wait(BASE.well.hold);
    view.update({ ...button, tier, actionShown: false });
    expect(turns()).toEqual([[0, R.duration], [1, R.duration], [1, R.duration], [0, R.duration]]);
    for (const t of timings()) expect(easingAt(t.config.easing)).toEqual(easingAt(hintEasing(R.easing)));
    expect([flat(view.hintLayer()).opacity, flat(view.actionCell()).opacity]).toEqual([1, 0]);
    view.unmount();
  });

  it('still tier (reduced motion): one linear motion.fadeReduced, both ways, for both', () => {
    const F = BASE.motion.fadeReduced;
    const view = mount({ ...button, tier: 'still' });
    view.update({ ...button, tier: 'still', actionShown: true });
    wait(BASE.well.hold);
    view.update({ ...button, tier: 'still', actionShown: false });
    expect(turns()).toEqual([[0, F.duration], [1, F.duration], [1, F.duration], [0, F.duration]]);
    for (const t of timings()) expect(easingAt(t.config.easing)).toEqual(easingAt(hintEasing(F.easing)));
    view.unmount();
  });

  it('well.hold: two turns asked inside 400 ms start only one; when the hold ends the Well takes the latest, as it differs', () => {
    const view = mount(button);
    view.update({ ...button, actionShown: true });
    expect(timings()).toHaveLength(2);
    wait(100);
    view.update({ ...button, actionShown: false });
    expect(timings()).toHaveLength(2);
    expect(flat(view.actionCell()).opacity).toBe(1);
    wait(BASE.well.hold - 101);
    expect(timings()).toHaveLength(2);
    wait(1);
    expect(turns().slice(2)).toEqual([[1, R.duration], [0, R.duration]]);
    expect([flat(view.hintLayer()).opacity, flat(view.actionCell()).opacity]).toEqual([1, 0]);
    view.unmount();
  });

  it('when the hold ends it takes nothing if the page asked back for the state the Well shows', () => {
    const view = mount(button);
    view.update({ ...button, actionShown: true });
    wait(100);
    view.update({ ...button, actionShown: false });
    wait(100);
    view.update({ ...button, actionShown: true });
    wait(BASE.well.hold);
    expect(timings()).toHaveLength(2);
    expect(flat(view.actionCell()).opacity).toBe(1);
    // At rest nothing runs: no hold is left armed once the last one ended with nothing to take.
    expect(jest.getTimerCount()).toBe(0);
    view.unmount();
  });

  it('holds every turn, the one a hold’s end starts too', () => {
    const view = mount(button);
    view.update({ ...button, actionShown: true });
    wait(100);
    view.update({ ...button, actionShown: false });
    wait(BASE.well.hold - 100);
    expect(timings()).toHaveLength(4);
    wait(100);
    view.update({ ...button, actionShown: true });
    wait(BASE.well.hold - 101);
    expect(timings()).toHaveLength(4);
    wait(1);
    expect(timings()).toHaveLength(6);
    view.unmount();
  });

  it('the Button can be pressed and reached exactly while the Well shows it, through a held hide too', () => {
    const view = mount(button);
    const reach = () => [view.actionCell().props.pointerEvents, Boolean(view.actionCell().props.accessibilityElementsHidden), Boolean(view.hintLayer().props.accessibilityElementsHidden)];
    expect(reach()).toEqual(['none', true, false]);
    view.update({ ...button, actionShown: true });
    expect(reach()).toEqual(['box-none', false, true]);
    wait(100);
    view.update({ ...button, actionShown: false });
    expect(reach()).toEqual(['box-none', false, true]);
    wait(BASE.well.hold - 100);
    expect(reach()).toEqual(['none', true, false]);
    view.unmount();
  });

  it('arrives with the page: no fade and no hold at mount, so the first turn starts at once', () => {
    const view = mount({ ...button, actionShown: true });
    expect(timings()).toEqual([]);
    expect([flat(view.hintLayer()).opacity, flat(view.actionCell()).opacity]).toEqual([0, 1]);
    view.update({ ...button, actionShown: false });
    expect(turns()).toEqual([[1, R.duration], [0, R.duration]]);
    view.unmount();
  });

  it('frees its hold when it unmounts: no timer is left to turn a Well that is gone', () => {
    const view = mount(button);
    view.update({ ...button, actionShown: true });
    wait(100);
    view.update({ ...button, actionShown: false });
    expect(jest.getTimerCount()).toBe(1);
    view.unmount();
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('Well: the commit host is unchanged (DEC-174)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('two turns inside 400 ms both start at once: DEC-174 limits CommitCTA upstream, never the Well', () => {
    const view = mount({ ...base, host: 'commit' });
    view.update({ ...base, host: 'commit', actionShown: true });
    view.update({ ...base, host: 'commit', actionShown: false });
    expect(timings().map((t) => [t.toValue, t.config.duration])).toEqual([[0, BASE.motion.settle.duration], [1, BASE.motion.respond.duration]]);
    expect(jest.getTimerCount()).toBe(0);
    view.unmount();
  });

  it('never fades the action itself: CommitCTA draws its own show and hide', () => {
    const view = mount({ ...base, host: 'commit' });
    view.update({ ...base, host: 'commit', actionShown: true });
    expect(flat(view.actionCell())).not.toHaveProperty('opacity');
    view.update({ ...base, host: 'commit', actionShown: false });
    expect(flat(view.actionCell())).not.toHaveProperty('opacity');
    view.unmount();
  });
});

describe('Well: the hint’s alignment (F3)', () => {
  // React Native lays textAlign 'left' at the paragraph's start: Fabric's TextLayoutManager aligns it to the paragraph's
  // direction, and Paper and iOS swap left and right under RTL. So 'left' is the start in both directions.
  it.each([false, true])('centred by default and on P10, at the start on P1·AGE: isRTL %p', (rtl) => {
    jest.replaceProperty(I18nManager, 'isRTL', rtl);
    for (const [hintAlign, textAlign] of [[undefined, 'center'], ['center', 'center'], ['start', 'left']] as const) {
      const view = mount({ ...base, hintAlign });
      expect([hintAlign, flat(view.text()[0]).textAlign]).toEqual([hintAlign, textAlign]);
      view.unmount();
    }
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

describe('Well: the hint’s accessibility label (DEC-195 FY-4, additive)', () => {
  const LABEL = 'Enter your birth month and year, and tick the box, to continue.';

  it('gives the hint the label the page passes, so TalkBack reads it in place of the hint’s words', () => {
    const view = mount({ ...base, host: 'button', hintAlign: 'start', hintAccessibilityLabel: LABEL });
    const hint = view.text()[0];
    expect(hint.props.children).toBe(HINT);
    expect(hint.props.accessibilityLabel).toBe(LABEL);
    view.unmount();
  });

  it('without one, the hint carries no label of its own: an existing caller is unchanged', () => {
    const view = mount(base);
    expect(view.text()[0].props).not.toHaveProperty('accessibilityLabel', expect.anything());
    expect(view.text()[0].props.accessibilityLabel).toBeUndefined();
    view.unmount();
  });

  it('the label is on the hint alone: never on the action’s cell, and gone with the hint when the action shows', () => {
    const view = mount({ ...base, hintAccessibilityLabel: LABEL });
    expect(view.actionCell().props.accessibilityLabel).toBeUndefined();
    view.update({ ...base, hintAccessibilityLabel: LABEL, actionShown: true });
    expect(view.hintLayer().props.accessibilityElementsHidden).toBe(true);
    expect(view.hintLayer().props.importantForAccessibility).toBe('no-hide-descendants');
    view.unmount();
  });

  it('with the reserved consent slot there is no hint, so no label is drawn anywhere', () => {
    const view = mount({ ...base, consentSlot: true, hintAccessibilityLabel: LABEL });
    expect(view.r.root.findAll((n) => isHost(n) && n.props.accessibilityLabel === LABEL)).toEqual([]);
    view.unmount();
  });
});
