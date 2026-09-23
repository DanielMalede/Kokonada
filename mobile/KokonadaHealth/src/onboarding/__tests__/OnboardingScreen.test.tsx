import React from 'react';
import * as RN from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { AccessibilityInfo } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors, space, haptics, type ThemeName } from '../../design/tokens';
import { contrastRatio, AA_NORMAL } from '../../design/contrast';
import { OnboardingScreen } from '../OnboardingScreen';

// Production wraps the whole app in a SafeAreaProvider; supply one (zero insets) so the
// safe-area-aware chrome can read its insets in the headless renderer.
const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

// The three-panel FTUE carousel. The load-bearing contracts:
//   • markSeen (onComplete) fires on BOTH exits — Skip (bypass) and Begin (terminal).
//   • exactly ONE haptic, on the terminal "Begin" — never per swipe / Continue / Skip.
//   • the pager encodes the active page by SHAPE (a widened pill) as well as color, so it
//     is legible to a colour-blind user.

function texts(node: any, acc: string[] = []): string[] {
  if (node == null) return acc;
  if (typeof node === 'string') { acc.push(node); return acc; }
  if (Array.isArray(node)) { node.forEach((n) => texts(n, acc)); return acc; }
  if (node.children) texts(node.children, acc);
  return acc;
}
function flatStyle(node: any): Record<string, unknown> {
  const s = node?.props?.style;
  return Array.isArray(s) ? Object.assign({}, ...s.flat(Infinity).filter(Boolean)) : (s ?? {});
}
const byLabel = (tree: ReactTestRenderer.ReactTestRenderer, label: string) =>
  tree.root.findAll((n) => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === label)[0];

// The standard primary CTA wears the INK fill (accent.ctaFill + content.onCtaFill), NOT the aurora
// violet. POSITIVE colour claims are pinned per FACE (see the describe.each below); only the
// NEGATIVE sets stay theme-spanning, because excluding a hue in BOTH faces is strictly stronger
// than excluding it in one. glowInk/onAccent stay live tokens (they feed the Generate hero's
// gradient), so their ABSENCE from a standard CTA has to be asserted, never inferred.
const GLOW_INKS = [colors.light.accent.glowInk, colors.dark.accent.glowInk];
const ON_ACCENTS = [colors.light.content.onAccent, colors.dark.content.onAccent];
const FACES: ThemeName[] = ['light', 'dark'];
// Forcing the face, correctly. jest.spyOn CANNOT do it here: @react-native/jest-preset already
// installs react-native's useColorScheme as a jest.fn(() => 'light'), and jest-mock's spyOn returns
// an EXISTING mock untouched WITHOUT registering a restore (jest-mock/build/index.js — the whole
// spy branch is guarded by `if (!this.isMockFunction(original))`). So mockReturnValue mutates the
// preset's shared mock permanently and jest.restoreAllMocks() is a no-op against it, leaking the
// last face into every later test in the file. Capture the preset's own implementation and put it
// back by hand.
const colorSchemeMock = RN.useColorScheme as unknown as jest.Mock;
const PRESET_COLOR_SCHEME = colorSchemeMock.getMockImplementation();
const forceFace = (scheme: ThemeName) => colorSchemeMock.mockImplementation(() => scheme);
const releaseFace = () => colorSchemeMock.mockImplementation(PRESET_COLOR_SCHEME);
const flattenStyle = (node: any): Record<string, any> => {
  const s = node?.props?.style;
  return Array.isArray(s) ? Object.assign({}, ...s.flat(Infinity).filter(Boolean)) : (s ?? {});
};
const firstText = (node: any) => node.findAll((n: any) => typeof n.type === 'string' && n.type === 'Text')[0];

const pagerValue = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.findAll((n) => n.props?.accessibilityValue?.text?.startsWith('Page '))[0]?.props.accessibilityValue.text;

// Teardown discipline, per FILE rather than per call site. A failed assertion aborts the test body,
// so a trailing tree.unmount() never runs — and a leaked tree keeps its Animated work running into
// the NEXT test's window, failing that one too and hiding the real cause behind a cascade. Every
// render registers here and is swept unconditionally, pass or fail.
const mounted: ReactTestRenderer.ReactTestRenderer[] = [];
afterEach(async () => {
  for (const t of mounted.splice(0)) await ReactTestRenderer.act(async () => { t.unmount(); });
});

async function render(props?: Partial<React.ComponentProps<typeof OnboardingScreen>>) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <OnboardingScreen {...props} />
      </SafeAreaProvider>,
    );
  });
  await ReactTestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); });
  mounted.push(tree);
  return tree;
}
async function press(node: any) {
  await ReactTestRenderer.act(async () => { await node.props.onPress(); });
}

beforeEach(() => {
  (AccessibilityInfo.isReduceMotionEnabled as jest.Mock) = jest.fn().mockResolvedValue(true); // deterministic: Begin pre-settled
});

describe('OnboardingScreen — three-panel FTUE', () => {
  it('renders all three near-wordless copy lines', async () => {
    const tree = await render();
    const all = texts(tree.toJSON()).join(' ');
    expect(all).toContain('Feel it.');
    expect(all).toContain('Your body is heard.');
    expect(all).toContain('Your soundtrack, tuned to you.');
  });

  it('starts on page 1 with a persistent Skip and a Continue CTA', async () => {
    const tree = await render();
    expect(pagerValue(tree)).toBe('Page 1 of 3');
    expect(byLabel(tree, 'Skip')).toBeTruthy();
    expect(byLabel(tree, 'Continue')).toBeTruthy();
  });

  it('Skip → markSeen (onComplete) fires, and NO haptic (bypass is quiet)', async () => {
    const onComplete = jest.fn();
    const triggerHaptic = jest.fn();
    const tree = await render({ onComplete, triggerHaptic });
    await press(byLabel(tree, 'Skip'));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(triggerHaptic).not.toHaveBeenCalled();
  });

  it('Continue advances the pager WITHOUT completing or firing a haptic', async () => {
    const onComplete = jest.fn();
    const triggerHaptic = jest.fn();
    const tree = await render({ onComplete, triggerHaptic });
    await press(byLabel(tree, 'Continue'));
    expect(pagerValue(tree)).toBe('Page 2 of 3');
    expect(onComplete).not.toHaveBeenCalled();
    expect(triggerHaptic).not.toHaveBeenCalled();
  });

  // ── FACE-FORCED colour pins ──────────────────────────────────────────────────────────────────
  // @react-native/jest-preset REPLACES react-native's useColorScheme with jest.fn(() => 'light'),
  // so an unforced render always resolves the LIGHT face — the shipping DARK face was never
  // rendered here at all. Asserting set-membership across a union of both faces therefore waved a
  // CROSS-FACE pairing through: hard-coding one face's ctaFill under the other face's label
  // measures ~1.08:1 (an invisible control) with every assertion still green. Forcing the scheme
  // runs the REAL useTheme → resolveScheme path in BOTH faces, pins each value EXACTLY, and
  // measures the rendered pair, so the class dies whichever call site is edited next.
  describe.each(FACES)('the FTUE CTAs, rendered on the %s face', (scheme) => {
    const C = colors[scheme];
    beforeEach(() => { forceFace(scheme); });
    afterEach(() => { releaseFace(); });

    it('BOTH Continue and the terminal Begin wear THIS face’s ink fill under THIS face’s label', async () => {
      const tree = await render();
      const check = (node: any) => {
        const fill = flattenStyle(node).backgroundColor;
        const ink = flattenStyle(firstText(node)).color;
        expect(fill).toBe(C.accent.ctaFill);
        expect(ink).toBe(C.content.onCtaFill);
        expect(contrastRatio(ink, fill)).toBeGreaterThanOrEqual(AA_NORMAL);
        expect(GLOW_INKS).not.toContain(fill);
        expect(ON_ACCENTS).not.toContain(ink);
      };
      check(byLabel(tree, 'Continue'));
      await press(byLabel(tree, 'Continue')); // → page 2
      await press(byLabel(tree, 'Continue')); // → page 3 (the CTA morphs to Begin)
      check(byLabel(tree, 'Begin'));
    });
  });

  it('the CTA morphs to "Begin" on the last panel; Begin → markSeen + exactly one commit haptic', async () => {
    const onComplete = jest.fn();
    const triggerHaptic = jest.fn();
    const tree = await render({ onComplete, triggerHaptic });
    await press(byLabel(tree, 'Continue')); // → page 2
    await press(byLabel(tree, 'Continue')); // → page 3
    expect(pagerValue(tree)).toBe('Page 3 of 3');
    expect(byLabel(tree, 'Continue')).toBeUndefined(); // no longer Continue
    const begin = byLabel(tree, 'Begin');
    expect(begin).toBeTruthy();
    await press(begin);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(triggerHaptic).toHaveBeenCalledTimes(1);
    expect(triggerHaptic).toHaveBeenCalledWith('commit');
  });

  it('the active pager dot is encoded by SHAPE (a widened pill), not by colour alone', async () => {
    const tree = await render();
    const dot0 = tree.root.findAll((n) => n.props?.testID === 'pager-dot-0')[0];
    const dot1 = tree.root.findAll((n) => n.props?.testID === 'pager-dot-1')[0];
    const s0 = flatStyle(dot0) as any;
    const s1 = flatStyle(dot1) as any;
    // inactive dots are the base diameter; the active dot is widened → distinguishable w/o colour
    expect(s1.width).toBe(space.sm);
    expect(s0.width).toBeGreaterThan(space.sm);
    expect(s0.width).not.toBe(s1.width);
    // and it also carries the brand accent (colour reinforces, does not solely encode)
    const accents = [colors.dark.accent.glow, colors.light.accent.glow, colors.dark.emotionAccent.calm.ink, colors.light.emotionAccent.calm.ink];
    expect(accents).toContain(s0.backgroundColor);
  });

  it('defaults are safe: no crash when rendered with no injected props', async () => {
    const tree = await render();
    expect(byLabel(tree, 'Skip')).toBeTruthy();
  });

  it('exposes the commit haptic token used for Begin (guards the semantic key)', () => {
    expect(haptics.commit).toBe('impactMedium');
  });
});
