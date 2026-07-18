import React from 'react';
import { View } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { BreathingGlow, BREATH_OPACITY } from '../BreathingGlow';

// The brand's single recognisable gesture — a soft glow that BREATHES — now rendered as a
// SOFT-FALLOFF Skia glow (SoftGlow: Circle + Blur), not a hard-edged flat disc. It is
// purely decorative: hidden from assistive tech, non-interactive. The breath drives the
// wrapper's OPACITY (sine at motion.duration.breath); reduced motion → a still soft glow.

function flatStyle(node: any): Record<string, unknown> {
  const s = node.props.style;
  return Array.isArray(s) ? Object.assign({}, ...s.flat(Infinity).filter(Boolean)) : (s ?? {});
}
const findWrapper = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.findAll((n) => n.props?.accessibilityElementsHidden === true)[0];
const findCircle = (tree: ReactTestRenderer.ReactTestRenderer, color: string) =>
  tree.root.findAll((n) => n.props?.color === color && typeof n.props?.r === 'number')[0];

async function render(el: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(el); });
  await ReactTestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); });
  return tree;
}

describe('BreathingGlow — the shared soft brand breath', () => {
  it('is decorative (a11y-hidden, non-interactive) and the given size', async () => {
    const tree = await render(<BreathingGlow color="#31E1C4" reduced={false} breathMs={4200} size={200} />);
    const w = findWrapper(tree);
    expect(w).toBeTruthy();
    expect(w.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(w.props.pointerEvents).toBe('none');
    const st = flatStyle(w);
    expect(st.width).toBe(200);
    expect(st.height).toBe(200);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('renders a SOFT glow (Skia Circle + Blur in the given color), NOT a hard flat disc', async () => {
    const tree = await render(<BreathingGlow color="#31E1C4" reduced={false} breathMs={4200} size={200} />);
    expect(findCircle(tree, '#31E1C4')).toBeTruthy();          // Skia circle carries the color
    expect(tree.root.findAll((n) => n.props?.blur !== undefined).length).toBeGreaterThan(0); // soft falloff
    // the color must NOT be painted as a flat filled rectangle (the old flat-disc bug)
    const flatDisc = tree.root.findAll((n) => (flatStyle(n) as any).backgroundColor === '#31E1C4');
    expect(flatDisc).toHaveLength(0);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('STILLS under reduced motion at the fixed dim opacity (no breath loop), unmounts clean', async () => {
    const tree = await render(<BreathingGlow color="#31E1C4" reduced breathMs={4200} size={120} />);
    expect(flatStyle(findWrapper(tree)).opacity).toBe(BREATH_OPACITY.still);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('a non-positive breath does not start a loop (still glow), no crash', async () => {
    const tree = await render(<BreathingGlow color="#0C8C7B" reduced={false} breathMs={0} size={80} />);
    expect(findWrapper(tree)).toBeTruthy();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('breathes arbitrary children when given (the ONE breath can carry the full BrandMark, not only the bloom)', async () => {
    const tree = await render(
      <BreathingGlow color="#31E1C4" reduced={false} breathMs={4200} size={200}>
        <View testID="breathing-child" />
      </BreathingGlow>,
    );
    const child = tree.root.findAll((n) => n.props?.testID === 'breathing-child')[0];
    expect(child).toBeTruthy();
    // custom children REPLACE the default bloom — no duplicate SoftGlow circle underneath
    expect(findCircle(tree, '#31E1C4')).toBeFalsy();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });
});
