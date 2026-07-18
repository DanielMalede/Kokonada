import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { AccessibilityInfo } from 'react-native';
import { colors, type as typography } from '../../design/tokens';

// The first breath of the instrument. Same organism as SignInScreen — one soft breathing
// aura behind the wordmark, token-only, nothing else (no tagline / button / spinner). The
// aura is decorative; the wordmark is the sole a11y element (a header). Under reduced
// motion the aura stills and the wordmark appears without a fade-up (dwell is unchanged —
// that timing is owned by the route machine, not this pure visual).

import { SplashScreen } from '../SplashScreen';

function texts(node: any, acc: string[] = []): string[] {
  if (node == null) return acc;
  if (typeof node === 'string') { acc.push(node); return acc; }
  if (Array.isArray(node)) { node.forEach((n) => texts(n, acc)); return acc; }
  if (node.children) texts(node.children, acc);
  return acc;
}
function flatStyle(node: any): Record<string, unknown> {
  const s = node.props.style;
  return Array.isArray(s) ? Object.assign({}, ...s.flat(Infinity).filter(Boolean)) : (s ?? {});
}
async function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(<SplashScreen />); });
  await ReactTestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); });
  return tree;
}

describe('SplashScreen — the brand breath', () => {
  it('shows the Kokonada wordmark as a header, in the display type + primary ink', async () => {
    const tree = await render();
    const header = tree.root.findAll((n) => n.props.accessibilityRole === 'header')[0];
    expect(header).toBeTruthy();
    expect(texts(header).join('')).toBe('Kokonada');
    const st = flatStyle(header);
    expect(st.fontSize).toBe(typography.size.display);
    expect(st.fontWeight).toBe(typography.weight.semibold);
    expect(st.fontFamily).toBe(typography.family.display);
    expect(st.letterSpacing).toBe(typography.tracking.display);
    // token-derived ink (theme is resolved from the OS at render — accept either face)
    expect([colors.dark.content.primary, colors.light.content.primary]).toContain(st.color);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('renders on surface.base with a decorative (a11y-hidden) breathing glow behind it', async () => {
    const tree = await render();
    const bases = [colors.dark.surface.base, colors.light.surface.base];
    const screen = tree.root.findAll((n) => bases.includes((flatStyle(n) as any).backgroundColor))[0];
    expect(screen).toBeTruthy();
    const glow = tree.root.findAll((n) => n.props?.accessibilityElementsHidden === true)[0];
    expect(glow).toBeTruthy();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('is nearly wordless — no tagline, no button, no spinner (only the wordmark)', async () => {
    const tree = await render();
    expect(tree.root.findAll((n) => n.props.accessibilityRole === 'button')).toHaveLength(0);
    const allText = texts(tree.toJSON()).join(' ').trim();
    expect(allText).toBe('Kokonada');
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('renders under reduced motion (glow stills, wordmark still shown) without crashing', async () => {
    (AccessibilityInfo.isReduceMotionEnabled as jest.Mock) = jest.fn().mockResolvedValue(true);
    const tree = await render();
    expect(texts(tree.toJSON()).join(' ')).toContain('Kokonada');
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });
});
