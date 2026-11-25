import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Animated, I18nManager, PixelRatio, StyleSheet } from 'react-native';
import { isRed, type RedBand } from '../../../color/redBand.ts';
import type { MotionTier } from '../../../motion/useMotionPolicy.ts';
import { DirectionProvider } from '../../../tokens/DirectionProvider.tsx';
import { EXTENSIONS } from '../../../tokens/tokens.extensions.generated.ts';
import { BASE, DIRECTIONS, type Face } from '../../../tokens/tokens.generated.ts';
import { hexLab } from '../../Bead/beadModel.ts';
import { CommitCTA, useCtaMachine } from '../CommitCTA.tsx';
import { ctaColours, ctaInitial, ctaReduce, ctaState, type CtaMachine, type CtaPaint } from '../ctaState.ts';

// The commit CTA (Button variant "commit", F10 group A; DEC-174, DSN-018, R3–R9): the only tinted control. It draws
// DEC-174's machine at the present moment, frame by frame while a ramp runs and never otherwise; its tint is the
// machine's branded PlacementTint. It has no disabled state: while it may not be pressed it is hidden from touch and
// from TalkBack, and the Well says why. A press scales it to cta.pressScale over motion.press (none under reduced
// motion); P2's busy latch ignores presses with no visual change. The label arrives resolved and never truncates.

jest.useFakeTimers();
afterAll(() => jest.useRealTimers());

const ABYSS = DIRECTIONS.abyss;
const CHECK: RedBand = { hueFrom: BASE.neverRed.check.hueStart, hueTo: BASE.neverRed.check.hueEnd, chromaFloor: BASE.neverRed.check.chromaFloor };
const J = { id: 0, x: 0.6, y: 0.6 };
const R = { id: 1, x: -0.6, y: -0.6 };
const paintOf = (face: Face): CtaPaint => ({ id: 'abyss', face });
const LABEL = 'onboarding.continue';

interface Options {
  readonly machine: CtaMachine;
  readonly face?: Face;
  readonly tier?: MotionTier;
  readonly busy?: boolean;
  readonly label?: string;
  readonly onCommit?: () => void;
}
const element = (o: Options) => (
  <DirectionProvider direction="abyss" face={o.face ?? 'dark'}>
    <CommitCTA machine={o.machine} label={o.label ?? LABEL} onCommit={o.onCommit ?? jest.fn()} tier={o.tier ?? 'full'} busy={o.busy} />
  </DirectionProvider>
);
function mount(o: Options) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(element(o));
  });
  return tree;
}
const host = (tree: ReactTestRenderer.ReactTestRenderer, testID: string) => tree.root.findAll((n) => n.props.testID === testID && typeof n.type === 'string')[0];
/** The Pressable itself: its onPress, onPressIn and onPressOut are the handlers React Native's press calls. */
const pressable = (tree: ReactTestRenderer.ReactTestRenderer) => tree.root.findAll((n) => n.props.testID === 'hero.cta' && typeof n.type !== 'string' && typeof n.props.onPress === 'function')[0];
const flat = (style: unknown) => (StyleSheet.flatten(style as never) ?? {}) as Record<string, any>;
const now = () => performance.now();
/** A machine shown and settled now, tinted J, the store holding one tap. */
const shown = (face: Face = 'dark') => ctaInitial(paintOf(face), [J], 1, now());
const opacityOf = (tree: ReactTestRenderer.ReactTestRenderer) => {
  const v = flat(host(tree, 'cta.root').props.style).opacity;
  return typeof v === 'number' ? v : v.__getValue();
};

// F2 (P1, the designer's rulings of 2026-11-25): the hero's element IDs are the ledger's (EXTENSIONS hero.elements).
describe('CommitCTA: its element IDs (F2)', () => {
  it('the button is hero.cta and its label hero.cta.label, both in the ledger’s element list; nothing else here claims a hero ID', () => {
    const elements = EXTENSIONS.base.$root.hero.elements as readonly string[];
    const tree = mount({ machine: shown() });
    const ids = tree.root.findAll((x) => typeof x.type === 'string' && typeof x.props.testID === 'string').map((x) => x.props.testID as string);
    expect(ids.filter((id) => id.startsWith('hero.')).sort()).toEqual(['hero.cta', 'hero.cta.label']);
    for (const id of ['hero.cta', 'hero.cta.label']) expect([id, elements.includes(id)]).toEqual([id, true]);
    expect(host(tree, 'hero.cta').props.accessibilityRole).toBe('button');
  });
});

describe('CommitCTA: shown', () => {
  it('a pill of at least cta.height, radius radius.pill (the renderer clamps it to half the shorter side, F4), filled with the tint’s token, the label in its ink: no fixed height, no elevation', () => {
    for (const face of ['dark', 'light'] as const) {
      const tree = mount({ machine: shown(face), face });
      const pill = flat(host(tree, 'hero.cta').props.style);
      expect(pill).toMatchObject({ minHeight: BASE.cta.height, borderRadius: BASE.radius.pill, backgroundColor: ctaColours(paintOf(face), 'J').fillHex });
      expect(pill.height).toBeUndefined();
      expect(pill.elevation).toBeUndefined();
      expect(pill.borderWidth).toBeUndefined();
      const label = host(tree, 'hero.cta.label');
      expect(flat(label.props.style).color).toBe(ABYSS.color[face].text.onTint.hex);
      expect(label.props.children).toBe(LABEL);
      expect(opacityOf(tree)).toBe(1);
      act(() => tree.unmount());
    }
  });

  it('is a button labelled by its resolved label, exposed and touchable, with no disabled state', () => {
    const tree = mount({ machine: shown() });
    const pill = host(tree, 'hero.cta');
    expect(pill.props).toMatchObject({ accessible: true, accessibilityRole: 'button', accessibilityLabel: LABEL });
    expect(pill.props.accessibilityState?.disabled).toBeUndefined();
    expect(pill.props.disabled).toBeUndefined();
    const root = host(tree, 'cta.root');
    expect(root.props.pointerEvents).toBe('auto');
    expect(root.props.importantForAccessibility).toBe('auto');
  });

  it('a press commits, once', () => {
    const onCommit = jest.fn();
    const tree = mount({ machine: shown(), onCommit });
    act(() => pressable(tree).props.onPress());
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('the label never truncates or shrinks (QA-013): no line cap, no font fitting, no scale cap; centred', () => {
    const label = host(mount({ machine: shown() }), 'hero.cta.label');
    expect(label.props.numberOfLines).toBeUndefined();
    expect(label.props.adjustsFontSizeToFit).toBeUndefined();
    expect(label.props.maxFontSizeMultiplier).toBeUndefined();
    expect(flat(label.props.style).textAlign).toBe('center');
  });

  it('sets the label in ui.cta, Latin or Hebrew metrics by its script (Hebrew line height is the Latin + 2)', () => {
    const latin = flat(host(mount({ machine: shown() }), 'hero.cta.label').props.style);
    expect(latin).toMatchObject({ fontFamily: BASE.type.face.ui, fontSize: BASE.type.ui.cta.latin.size, lineHeight: BASE.type.ui.cta.latin.lineHeight, fontWeight: String(BASE.type.ui.cta.latin.weight) });
    const hebrew = flat(host(mount({ machine: shown(), label: 'המשך' }), 'hero.cta.label').props.style);
    expect(hebrew).toMatchObject({ fontSize: BASE.type.ui.cta.hebrew.size, lineHeight: BASE.type.ui.cta.hebrew.lineHeight });
  });
});

describe('CommitCTA: hidden, and no disabled state', () => {
  it('before an admitted start it is transparent, out of touch and out of TalkBack, and a press does nothing', () => {
    const onCommit = jest.fn();
    const machine = ctaReduce(ctaInitial(paintOf('dark'), [], 0, now()), { kind: 'store', taps: 1 }, now(), 'settle', paintOf('dark'));
    const tree = mount({ machine, onCommit });
    expect(opacityOf(tree)).toBe(0);
    const root = host(tree, 'cta.root');
    expect(root.props.pointerEvents).toBe('none');
    expect(root.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(root.props.accessibilityElementsHidden).toBe(true);
    expect(host(tree, 'hero.cta').props.accessible).toBe(false);
    act(() => pressable(tree).props.onPress());
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('while it hides it takes no press, though it is still partly visible', () => {
    const onCommit = jest.fn();
    const hiding = ctaReduce(shown(), { kind: 'store', taps: 0 }, now(), 'settle', paintOf('dark'));
    const tree = mount({ machine: hiding, onCommit });
    expect(opacityOf(tree)).toBeGreaterThan(0.9);
    expect(host(tree, 'cta.root').props.pointerEvents).toBe('none');
    act(() => pressable(tree).props.onPress());
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('busy (P2’s latch after a commit): presses are ignored and TalkBack hears busy, with no visual change', () => {
    const onCommit = jest.fn();
    const machine = shown();
    const idle = mount({ machine });
    const busy = mount({ machine, busy: true, onCommit });
    act(() => pressable(busy).props.onPress());
    expect(onCommit).not.toHaveBeenCalled();
    expect(host(busy, 'hero.cta').props.accessibilityState).toEqual({ busy: true });
    expect(flat(host(busy, 'hero.cta').props.style)).toEqual(flat(host(idle, 'hero.cta').props.style));
    expect(opacityOf(busy)).toBe(opacityOf(idle));
  });
});

describe('CommitCTA: the ramps, frame by frame, and none at rest', () => {
  it('draws the machine at the present moment while a show runs, then stops asking for frames', () => {
    const paint = paintOf('dark');
    const t0 = now();
    const machine = ctaReduce(ctaReduce(ctaInitial(paint, [], 0, t0), { kind: 'store', taps: 1 }, t0, 'settle', paint), { kind: 'start', live: [J] }, t0, 'settle', paint);
    const tree = mount({ machine });
    expect(opacityOf(tree)).toBe(0);
    for (let i = 0; i < 10; i++) {
      act(() => {
        jest.advanceTimersByTime(16);
      });
      expect(opacityOf(tree)).toBeCloseTo(ctaState(machine, now(), paint).opacity, 12);
    }
    expect(opacityOf(tree)).toBeGreaterThan(0.5);
    act(() => {
      jest.advanceTimersByTime(BASE.motion.settle.duration);
    });
    expect(opacityOf(tree)).toBe(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('a tint change runs on the frames too, and lands on the token', () => {
    const paint = paintOf('dark');
    const t0 = now();
    const machine = ctaReduce(ctaReduce(shown(), { kind: 'store', taps: 2 }, t0, 'settle', paint), { kind: 'start', live: [J, R] }, t0, 'settle', paint);
    const tree = mount({ machine });
    act(() => {
      jest.advanceTimersByTime(48);
    });
    expect(flat(host(tree, 'hero.cta').props.style).backgroundColor).toBe(ctaState(machine, now(), paint).tint!.fill);
    act(() => {
      jest.advanceTimersByTime(BASE.motion.settle.duration);
    });
    expect(flat(host(tree, 'hero.cta').props.style).backgroundColor).toBe(ctaColours(paint, 'R').fillHex);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('at rest it asks for no frame at all (zero frame work)', () => {
    mount({ machine: shown() });
    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('CommitCTA: the press (cta.pressScale over motion.press; none under reduced motion)', () => {
  let timing: jest.SpyInstance;
  beforeEach(() => {
    timing = jest.spyOn(Animated, 'timing');
  });
  afterEach(() => timing.mockRestore());

  it('press in scales to cta.pressScale and press out back to 1, over motion.press on its curve, on the native driver; no colour change', () => {
    const tree = mount({ machine: shown() });
    const before = flat(host(tree, 'hero.cta').props.style).backgroundColor;
    act(() => pressable(tree).props.onPressIn());
    expect(timing).toHaveBeenCalledTimes(1);
    expect(timing.mock.calls[0][1]).toMatchObject({ toValue: ABYSS.cta.pressScale, duration: BASE.motion.press.duration, useNativeDriver: true });
    const e = BASE.motion.press.easing;
    const easing = timing.mock.calls[0][1].easing;
    expect(easing(0)).toBeCloseTo(0, 9);
    expect(easing(1)).toBeCloseTo(1, 9);
    expect(easing(0.2)).toBeGreaterThan(0.2 * e[1]);
    act(() => pressable(tree).props.onPressOut());
    expect(timing.mock.calls[1][1]).toMatchObject({ toValue: 1, duration: BASE.motion.press.duration, useNativeDriver: true });
    expect(flat(host(tree, 'hero.cta').props.style).backgroundColor).toBe(before);
  });

  it('under reduced motion a press does not scale', () => {
    const tree = mount({ machine: shown(), tier: 'still' });
    act(() => pressable(tree).props.onPressIn());
    act(() => pressable(tree).props.onPressOut());
    expect(timing).not.toHaveBeenCalled();
    expect(BASE.motion.press.reducedMotion).toBe('none');
  });
});

describe('CommitCTA: RTL, font scale, never red', () => {
  const drawn = (tree: ReactTestRenderer.ReactTestRenderer) => JSON.stringify(tree.toJSON());

  it('draws the same under RTL (a centred pill label)', () => {
    const machine = shown();
    const ltr = drawn(mount({ machine }));
    const rtl = jest.replaceProperty(I18nManager, 'isRTL', true);
    const flipped = drawn(mount({ machine }));
    rtl.restore();
    expect(flipped).toBe(ltr);
  });

  it('at font scale 2.0 nothing caps the label: it grows the pill, which has only a minimum height', () => {
    const machine = shown();
    const spy = jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(2);
    const tree = mount({ machine });
    spy.mockRestore();
    const pill = flat(host(tree, 'hero.cta').props.style);
    expect(pill.minHeight).toBe(BASE.cta.height);
    expect(pill.height).toBeUndefined();
    expect(pill.maxHeight).toBeUndefined();
    expect(host(tree, 'hero.cta.label').props.allowFontScaling).not.toBe(false);
  });

  it('never paints red: every tint, in both faces, settled and mid-change', () => {
    for (const face of ['dark', 'light'] as const) {
      const paint = paintOf(face);
      for (const to of [J, R, { id: 2, x: 0.6, y: -0.6 }, { id: 3, x: -0.6, y: 0.6 }, { id: 4, x: 0.05, y: 0 }]) {
        const t0 = now();
        const machine = ctaReduce(ctaReduce(shown(face), { kind: 'store', taps: 2 }, t0, 'settle', paint), { kind: 'start', live: [{ ...to, id: 9 }] }, t0, 'settle', paint);
        const tree = mount({ machine, face });
        for (let i = 0; i < 4; i++) {
          const s = flat(host(tree, 'hero.cta').props.style);
          expect(isRed(hexLab(s.backgroundColor), CHECK)).toBe(false);
          expect(isRed(hexLab(flat(host(tree, 'hero.cta.label').props.style).color), CHECK)).toBe(false);
          act(() => {
            jest.advanceTimersByTime(96);
          });
        }
        act(() => tree.unmount());
      }
    }
  });
});

describe('useCtaMachine: the page’s DEC-174 machine, stamped on the JS clock', () => {
  function Probe({ tier, out }: { tier: MotionTier; out: { current: ReturnType<typeof useCtaMachine> | null } }) {
    out.current = useCtaMachine({ id: 'abyss', face: 'dark' }, tier, { live: [], taps: 0 });
    return null;
  }

  it('store and start move the machine at the moment they are called, in the tier’s mode', () => {
    for (const [tier, ramp] of [['full', BASE.motion.settle.duration], ['still', BASE.motion.fadeReduced.duration]] as const) {
      const out: { current: ReturnType<typeof useCtaMachine> | null } = { current: null };
      act(() => {
        ReactTestRenderer.create(<Probe tier={tier} out={out} />);
      });
      const t0 = now();
      act(() => out.current!.store(1));
      act(() => out.current!.start([J]));
      const m = out.current!.machine;
      expect(ctaState(m, t0, { id: 'abyss', face: 'dark' })).toMatchObject({ phase: 'showing', pressable: true });
      expect(ctaState(m, t0 + ramp, { id: 'abyss', face: 'dark' }).opacity).toBe(1);
      act(() => {
        jest.advanceTimersByTime(ramp / 2);
      });
      act(() => out.current!.store(0));
      expect(ctaState(out.current!.machine, now(), { id: 'abyss', face: 'dark' }).phase).toBe('hiding');
    }
  });
});
