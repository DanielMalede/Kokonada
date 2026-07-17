import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { MoodOnlyBar } from '../MoodOnlyBar';
import { createConnectStore } from '../connectStore';
import { colors, space } from '../../../design/tokens';

// Designer REVISE guards for the pinned escape bar:
//  1. The glow-OUTLINE secondary's LABEL must be AA-normal on surface.base in BOTH themes —
//     accent.glow (3.88:1 in light) fails at 16dp/600, so the label is content.primary (proven AA),
//     while the 1.5px accent.glow BORDER stays (a 1.4.11 boundary, ≥3:1). No accent.glowInk on base.
//  2. The bar must clear the gesture-nav home indicator: paddingBottom = bottom safe-area inset +
//     space.xl, on BOTH the unresolved and resolved variants.

const INSET_BOTTOM = 34;
const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: INSET_BOTTOM } };
// Theme-agnostic sets (the jest env may resolve either face). The designer requirement holds in
// BOTH: the label is a content.primary (AA-normal on base everywhere), never an accent glow/glowInk
// (accent.glow fails AA-normal in the LIGHT theme); the ring is an accent.glow (a ≥3:1 boundary).
const PRIMARIES = [colors.light.content.primary, colors.dark.content.primary];
const GLOW_LABELS = [colors.light.accent.glow, colors.dark.accent.glow, colors.light.accent.glowInk, colors.dark.accent.glowInk];
const ACCENT_GLOWS = [colors.light.accent.glow, colors.dark.accent.glow];

function flatStyle(node: any): Record<string, any> {
  const s = node?.props?.style;
  return Array.isArray(s) ? Object.assign({}, ...s.flat(Infinity).filter(Boolean)) : (s ?? {});
}
const byLabel = (tree: ReactTestRenderer.ReactTestRenderer, label: string) =>
  tree.root.findAll((n) => n.props.accessibilityLabel === label)[0];
const textNode = (tree: ReactTestRenderer.ReactTestRenderer, value: string) =>
  tree.root.findAll((n) => n.props.children === value)[0];
const barNode = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.findAll((n) => n.props.testID === 'mood-only-bar')[0];

async function render(resolved: boolean) {
  const connect = createConnectStore(undefined, () => 'u1');
  if (resolved) connect.getState().markResolved();
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <MoodOnlyBar connect={connect} onMoodOnly={() => {}} onContinue={() => {}} />
      </SafeAreaProvider>,
    );
  });
  return tree;
}

describe('MoodOnlyBar — AA label + bottom safe-area (designer REVISE)', () => {
  it('the mood-only LABEL is content.primary (AA on base), NEVER an accent glow/glowInk', async () => {
    const tree = await render(false);
    const label = flatStyle(textNode(tree, 'Continue with mood only'));
    expect(PRIMARIES).toContain(label.color);
    expect(GLOW_LABELS).not.toContain(label.color);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('the 1.5px brand-glow BORDER is retained (an equal-weight secondary ring, not a fill)', async () => {
    const tree = await render(false);
    const btn = flatStyle(byLabel(tree, 'continue-mood-only'));
    expect(ACCENT_GLOWS).toContain(btn.borderColor);
    expect(btn.borderWidth).toBe(1.5);
    expect(btn.backgroundColor).toBe('transparent'); // outline, never a filled brand CTA here
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('the unresolved bar clears the home indicator: paddingBottom = inset.bottom + space.xl', async () => {
    const tree = await render(false);
    expect(flatStyle(barNode(tree)).paddingBottom).toBe(INSET_BOTTOM + space.xl);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('the RESOLVED bar variant also respects the bottom safe-area inset', async () => {
    const tree = await render(true);
    expect(flatStyle(barNode(tree)).paddingBottom).toBe(INSET_BOTTOM + space.xl);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });
});
