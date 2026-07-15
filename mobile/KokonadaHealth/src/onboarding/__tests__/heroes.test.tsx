import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { AccessibilityInfo } from 'react-native';
import { colors, emotionAnchors } from '../../design/tokens';

// The three panel heroes. Each is a decorative, token-only aura that honours reduced
// motion. The load-bearing guard here is PulseHero's REGULATOR ETHIC: even as a mood demo
// it drifts calm↔warm ONLY — it may NEVER render a coral/peak/danger (alarming, red) hue.

import { AuraHero } from '../AuraHero';
import { PulseHero } from '../PulseHero';
import { WheelTeaseHero } from '../WheelTeaseHero';

function flatStyle(node: any): Record<string, unknown> {
  const s = node?.props?.style;
  return Array.isArray(s) ? Object.assign({}, ...s.flat(Infinity).filter(Boolean)) : (s ?? {});
}
// Every color-ish value used anywhere in the rendered tree (bg / border / text / stroke).
function collectColors(inst: any, acc: Set<string> = new Set()): Set<string> {
  const all = inst.findAll(() => true);
  for (const n of all) {
    const st = flatStyle(n) as any;
    for (const key of ['backgroundColor', 'borderColor', 'color', 'shadowColor']) {
      if (typeof st[key] === 'string') acc.add(st[key]);
    }
    for (const key of ['color', 'colors']) {
      const v = n?.props?.[key];
      if (typeof v === 'string') acc.add(v);
      if (Array.isArray(v)) v.forEach((c) => typeof c === 'string' && acc.add(c));
    }
  }
  return acc;
}
async function render(el: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(el); });
  await ReactTestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); });
  return tree;
}

describe('AuraHero — panel 1 "Feel it."', () => {
  it('renders a decorative (a11y-hidden) breathing aura in the brand accent, unmounts clean', async () => {
    const tree = await render(<AuraHero size={280} />);
    const glow = tree.root.findAll((n) => n.props?.accessibilityElementsHidden === true)[0];
    expect(glow).toBeTruthy();
    const used = collectColors(tree.root);
    const brand = [colors.dark.accent.glow, colors.light.accent.glow];
    expect(brand.some((b) => used.has(b))).toBe(true);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });
});

describe('PulseHero — panel 2 "Your body is heard." (regulator ethic)', () => {
  it('drifts calm↔warm ONLY — never a coral / peak / danger (alarming red) hue', async () => {
    const tree = await render(<PulseHero size={280} />);
    const used = collectColors(tree.root);
    const forbidden = [
      emotionAnchors.coral, emotionAnchors.peak,
      colors.dark.state.danger, colors.light.state.danger,
    ];
    for (const f of forbidden) expect(used.has(f)).toBe(false);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('renders a decorative pulse aura and stays crash-free under reduced motion (static ring)', async () => {
    (AccessibilityInfo.isReduceMotionEnabled as jest.Mock) = jest.fn().mockResolvedValue(true);
    const tree = await render(<PulseHero size={280} />);
    expect(tree.root.findAll((n) => n.props?.accessibilityElementsHidden === true).length).toBeGreaterThan(0);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });
});

describe('WheelTeaseHero — panel 3 "Your soundtrack, tuned to you."', () => {
  it('under reduced motion the dot is PRE-SETTLED — onSettle fires so "Begin" can appear', async () => {
    (AccessibilityInfo.isReduceMotionEnabled as jest.Mock) = jest.fn().mockResolvedValue(true);
    const onSettle = jest.fn();
    const tree = await render(<WheelTeaseHero size={240} onSettle={onSettle} />);
    expect(onSettle).toHaveBeenCalledTimes(1);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('renders the faint wheel ring + a travelling dot positioned within the hero bounds', async () => {
    (AccessibilityInfo.isReduceMotionEnabled as jest.Mock) = jest.fn().mockResolvedValue(false);
    const size = 240;
    const tree = await render(<WheelTeaseHero size={size} active onSettle={jest.fn()} />);
    const dot = tree.root.findAll((n) => n.props?.testID === 'wheel-tease-dot')[0];
    expect(dot).toBeTruthy();
    const st = flatStyle(dot) as any;
    // the dot's resting position (left/top) is derived from circumplexToScreen → in-bounds
    expect(st.left).toBeGreaterThanOrEqual(0);
    expect(st.left).toBeLessThanOrEqual(size);
    expect(st.top).toBeGreaterThanOrEqual(0);
    expect(st.top).toBeLessThanOrEqual(size);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('WAITS for panel 3 to become ACTIVE — the dot does not settle while off-screen (reveal not wasted)', async () => {
    (AccessibilityInfo.isReduceMotionEnabled as jest.Mock) = jest.fn().mockResolvedValue(false);
    jest.useFakeTimers();
    const onSettle = jest.fn();
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(<WheelTeaseHero size={240} active={false} onSettle={onSettle} />); });
    await ReactTestRenderer.act(async () => { await jest.advanceTimersByTimeAsync(2000); });
    expect(onSettle).not.toHaveBeenCalled(); // still off-screen → no reveal, no settle
    await ReactTestRenderer.act(async () => { tree.unmount(); });
    jest.useRealTimers();
  });

  it('once ACTIVE, GUARANTEES settle via the bounded fallback (Begin never stuck hidden)', async () => {
    (AccessibilityInfo.isReduceMotionEnabled as jest.Mock) = jest.fn().mockResolvedValue(false);
    jest.useFakeTimers();
    const onSettle = jest.fn();
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(<WheelTeaseHero size={240} active onSettle={onSettle} />); });
    await ReactTestRenderer.act(async () => { await jest.advanceTimersByTimeAsync(1000); });
    expect(onSettle).toHaveBeenCalledTimes(1);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
    jest.useRealTimers();
  });
});
