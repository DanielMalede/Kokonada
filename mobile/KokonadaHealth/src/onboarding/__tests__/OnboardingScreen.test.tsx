import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { AccessibilityInfo } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors, space, haptics } from '../../design/tokens';
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
// violet. Theme-agnostic sets — the headless renderer may resolve either face and the rule holds in
// both. glowInk/onAccent stay live tokens (they feed the Generate hero's gradient), so their
// ABSENCE from a standard CTA has to be asserted, never inferred.
const CTA_FILLS = [colors.light.accent.ctaFill, colors.dark.accent.ctaFill];
const CTA_LABELS = [colors.light.content.onCtaFill, colors.dark.content.onCtaFill];
const GLOW_INKS = [colors.light.accent.glowInk, colors.dark.accent.glowInk];
const ON_ACCENTS = [colors.light.content.onAccent, colors.dark.content.onAccent];
const flattenStyle = (node: any): Record<string, any> => {
  const s = node?.props?.style;
  return Array.isArray(s) ? Object.assign({}, ...s.flat(Infinity).filter(Boolean)) : (s ?? {});
};
const firstText = (node: any) => node.findAll((n: any) => typeof n.type === 'string' && n.type === 'Text')[0];

const pagerValue = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.findAll((n) => n.props?.accessibilityValue?.text?.startsWith('Page '))[0]?.props.accessibilityValue.text;

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
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('starts on page 1 with a persistent Skip and a Continue CTA', async () => {
    const tree = await render();
    expect(pagerValue(tree)).toBe('Page 1 of 3');
    expect(byLabel(tree, 'Skip')).toBeTruthy();
    expect(byLabel(tree, 'Continue')).toBeTruthy();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('Skip → markSeen (onComplete) fires, and NO haptic (bypass is quiet)', async () => {
    const onComplete = jest.fn();
    const triggerHaptic = jest.fn();
    const tree = await render({ onComplete, triggerHaptic });
    await press(byLabel(tree, 'Skip'));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(triggerHaptic).not.toHaveBeenCalled();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('Continue advances the pager WITHOUT completing or firing a haptic', async () => {
    const onComplete = jest.fn();
    const triggerHaptic = jest.fn();
    const tree = await render({ onComplete, triggerHaptic });
    await press(byLabel(tree, 'Continue'));
    expect(pagerValue(tree)).toBe('Page 2 of 3');
    expect(onComplete).not.toHaveBeenCalled();
    expect(triggerHaptic).not.toHaveBeenCalled();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('BOTH FTUE CTAs (Continue and the terminal Begin) wear the standard ink fill', async () => {
    const tree = await render();
    const cont = byLabel(tree, 'Continue');
    expect(CTA_FILLS).toContain(flattenStyle(cont).backgroundColor);
    expect(GLOW_INKS).not.toContain(flattenStyle(cont).backgroundColor);
    expect(CTA_LABELS).toContain(flattenStyle(firstText(cont)).color);
    expect(ON_ACCENTS).not.toContain(flattenStyle(firstText(cont)).color);

    await press(byLabel(tree, 'Continue')); // → page 2
    await press(byLabel(tree, 'Continue')); // → page 3 (the CTA morphs to Begin)
    const begin = byLabel(tree, 'Begin');
    expect(CTA_FILLS).toContain(flattenStyle(begin).backgroundColor);
    expect(GLOW_INKS).not.toContain(flattenStyle(begin).backgroundColor);
    expect(CTA_LABELS).toContain(flattenStyle(firstText(begin)).color);
    expect(ON_ACCENTS).not.toContain(flattenStyle(firstText(begin)).color);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
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
    await ReactTestRenderer.act(async () => { tree.unmount(); });
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
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('defaults are safe: no crash when rendered with no injected props', async () => {
    const tree = await render();
    expect(byLabel(tree, 'Skip')).toBeTruthy();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('exposes the commit haptic token used for Begin (guards the semantic key)', () => {
    expect(haptics.commit).toBe('impactMedium');
  });
});
