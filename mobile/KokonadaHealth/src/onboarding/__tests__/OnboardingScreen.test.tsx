import React from 'react';
import * as RN from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { AccessibilityInfo } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors, space, haptics, type ThemeName } from '../../design/tokens';
import { contrastRatio, AA_NORMAL } from '../../design/contrast';
import { textScrimFill } from '../../design/auroraSurfaces';
import { AI_DISCLOSURE_SHORT } from '../../legal/legalCopy';
import { LegalNote } from '../../legal/LegalNote';
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

// ── H1 / UI-005: the AI Act Art. 50 notice lives in the persistent bottom chrome ─────────────────
// Onboarding is per device, one-way and skippable from panel 1, so the notice must be on panel 1
// BEFORE Skip, identical on every panel, never on a swiping panel, never under the Begin fade.
describe('OnboardingScreen — AI Act Art. 50 notice in the persistent chrome (H1)', () => {
  // A host (native) node of the given RN type — 'View' / 'Text' are strings in the jest renderer.
  const isHost = (n: { type: unknown }, name: 'View' | 'Text') => n.type === name;
  const notices = (tree: ReactTestRenderer.ReactTestRenderer) =>
    tree.root.findAll((n) => isHost(n, 'View') && n.props.testID === 'legal-note');
  const expectNotice = (tree: ReactTestRenderer.ReactTestRenderer) => {
    expect(notices(tree)).toHaveLength(1);
    const lines = notices(tree)[0].findAll((n) => isHost(n, 'Text'));
    expect(lines).toHaveLength(1);
    expect(lines[0].props.children).toBe(AI_DISCLOSURE_SHORT);
    expectVisible(notices(tree)[0]);
  };
  const ancestors = (node: any) => {
    const out: any[] = [];
    for (let p = node.parent; p; p = p.parent) out.push(p);
    return out;
  };
  // VISIBLE, not merely present: nothing on the band, its line or any ancestor fades, collapses,
  // hides or moves it. The device dump (visible-to-user, on-screen bounds) is the closing evidence.
  const expectVisible = (band: any) => {
    for (const n of [band, ...ancestors(band)]) {
      const s = (RN.StyleSheet.flatten(n.props?.style) ?? {}) as any;
      expect(s.opacity ?? 1).toBe(1);
      expect(s.display).not.toBe('none');
      for (const k of ['width', 'height', 'maxWidth', 'maxHeight']) expect(s[k]).not.toBe(0);
      expect(s.transform).toBeUndefined();
    }
    for (const line of band.findAll((n: any) => isHost(n, 'Text'))) {
      expect(flattenStyle(line).opacity ?? 1).toBe(1);
      expect(flattenStyle(line).color).not.toBe('transparent');
    }
  };
  const dfs = (tree: ReactTestRenderer.ReactTestRenderer) => {
    const order: any[] = [];
    const walk = (n: any) => { order.push(n); n.children.forEach((ch: any) => { if (typeof ch !== 'string') walk(ch); }); };
    walk(tree.root);
    return order;
  };

  it('is on panel 1 before any input (Skip is reachable there), and identical on panels 2 and 3', async () => {
    const tree = await render();
    expect(pagerValue(tree)).toBe('Page 1 of 3');
    expectNotice(tree);
    await press(byLabel(tree, 'Continue'));
    expect(pagerValue(tree)).toBe('Page 2 of 3');
    expectNotice(tree);
    await press(byLabel(tree, 'Continue'));
    expect(pagerValue(tree)).toBe('Page 3 of 3');
    expectNotice(tree);
  });

  it('lives in the chrome, never on a panel: outside the swiping pager, the hero zone and the copy zone', async () => {
    const tree = await render();
    const anc = ancestors(notices(tree)[0]);
    expect(anc.some((a) => a.props.testID === 'onboarding-copy-zone' || a.props.testID === 'onboarding-hero-zone')).toBe(false);
    expect(anc.some((a) => a.props.horizontal === true)).toBe(false); // not inside the paging ScrollView
  });

  it('the chrome FLOWS below the pager — no ancestor is absolutely positioned over the panel copy', async () => {
    const tree = await render();
    for (const a of ancestors(notices(tree)[0])) expect(flattenStyle(a).position).not.toBe('absolute');
  });

  it('never inherits the Begin fade and is part of no control (panel 3, before Begin has faded in)', async () => {
    (AccessibilityInfo.isReduceMotionEnabled as jest.Mock) = jest.fn().mockResolvedValue(false); // the fade is live
    const tree = await render();
    await press(byLabel(tree, 'Continue'));
    await press(byLabel(tree, 'Continue'));
    expectNotice(tree);
    for (const a of ancestors(notices(tree)[0])) {
      expect(flattenStyle(a).opacity).toBeUndefined();
      expect(a.props.accessibilityRole).not.toBe('button');
      expect(typeof a.props.onPress).not.toBe('function');
    }
  });

  it('sits between the pager dots and the CTA, on the CTA measure, 16 above it', async () => {
    const tree = await render();
    const order = dfs(tree);
    const iDots = order.findIndex((n) => n.props.accessibilityRole === 'progressbar');
    const iNotice = order.indexOf(notices(tree)[0]);
    const iCta = order.indexOf(byLabel(tree, 'Continue'));
    expect(iDots).toBeGreaterThanOrEqual(0);
    expect(iDots).toBeLessThan(iNotice);
    expect(iNotice).toBeLessThan(iCta);
    const wrapper = flattenStyle(tree.root.findByType(LegalNote).parent);
    expect(wrapper.width).toBe('100%');
    expect(wrapper.maxWidth).toBe(flattenStyle(byLabel(tree, 'Continue')).maxWidth);
    expect(wrapper.marginBottom).toBe(space.lg);
  });

  it('reading order: TalkBack reaches the notice before EITHER exit (the CTA and Skip)', async () => {
    const tree = await render();
    // indexOf(undefined) is -1, which is "before" everything — so presence is asserted first.
    const before = (a: any, b: any) => {
      const order = dfs(tree);
      expect(order.indexOf(a)).toBeGreaterThanOrEqual(0);
      expect(order.indexOf(b)).toBeGreaterThanOrEqual(0);
      expect(order.indexOf(a)).toBeLessThan(order.indexOf(b));
    };
    expectNotice(tree);
    before(notices(tree)[0], byLabel(tree, 'Continue'));
    before(notices(tree)[0], byLabel(tree, 'Skip'));
    await press(byLabel(tree, 'Continue'));
    await press(byLabel(tree, 'Continue'));
    expectNotice(tree);
    before(notices(tree)[0], byLabel(tree, 'Begin'));
    before(notices(tree)[0], byLabel(tree, 'Skip'));
  });

  it('is reachable: no ancestor hides it, swallows its touches, or makes it a live region', async () => {
    const tree = await render();
    for (const a of ancestors(notices(tree)[0])) {
      expect(a.props.pointerEvents).not.toBe('none');
      expect(a.props.accessibilityElementsHidden).not.toBe(true);
      expect(a.props.importantForAccessibility).not.toBe('no-hide-descendants');
      expect(a.props.accessibilityLiveRegion ?? 'none').toBe('none');
    }
  });

  describe.each(FACES)('rendered on the %s face', (scheme) => {
    const C = colors[scheme];
    beforeEach(() => { forceFace(scheme); });
    afterEach(() => { releaseFace(); });

    it('the line is content.secondary on the AA-proven text scrim', async () => {
      const tree = await render();
      const line = notices(tree)[0].findAll((n) => isHost(n, 'Text'))[0];
      expect(flattenStyle(line).color).toBe(C.content.secondary);
      expect(flattenStyle(notices(tree)[0]).backgroundColor).toBe(textScrimFill(C, scheme));
    });
  });
});
