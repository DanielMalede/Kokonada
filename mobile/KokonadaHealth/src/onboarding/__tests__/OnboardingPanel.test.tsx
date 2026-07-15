import React from 'react';
import { Text, View } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { colors, type as typography } from '../../design/tokens';
import { OnboardingPanel } from '../OnboardingPanel';

// A single full-bleed panel: a hero in the upper zone, ONE copy line below. Token-only,
// centered, one idea. The copy is the sole content element; the hero is passed in as a
// decorative child.

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
async function render(el: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(el); });
  await ReactTestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); });
  return tree;
}

describe('OnboardingPanel', () => {
  it('renders its one copy line in the title type + primary ink, centered, width-capped', async () => {
    const tree = await render(
      <OnboardingPanel width={360} copy="Your body is heard.">
        <View testID="hero-slot" />
      </OnboardingPanel>,
    );
    const copy = tree.root.findAllByType(Text).find((n) => texts(n).join('') === 'Your body is heard.');
    expect(copy).toBeTruthy();
    const st = flatStyle(copy);
    expect(st.fontSize).toBe(typography.size.title);
    expect(st.fontWeight).toBe(typography.weight.semibold);
    expect(st.letterSpacing).toBe(typography.tracking.heading);
    expect([colors.dark.content.primary, colors.light.content.primary]).toContain(st.color);
    expect(st.textAlign).toBe('center');
    expect(st.maxWidth).toBe(300);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('mounts the hero child (decorative slot) and is the given width', async () => {
    const tree = await render(
      <OnboardingPanel width={360} copy="Feel it.">
        <View testID="hero-slot" />
      </OnboardingPanel>,
    );
    expect(tree.root.findAll((n) => n.props?.testID === 'hero-slot')[0]).toBeTruthy();
    const panel = tree.root.findAll((n) => (flatStyle(n) as any).width === 360)[0];
    expect(panel).toBeTruthy();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });
});
