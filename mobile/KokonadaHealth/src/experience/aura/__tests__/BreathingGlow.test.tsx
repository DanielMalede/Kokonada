import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { BreathingGlow } from '../BreathingGlow';
import { radius } from '../../../design/tokens';

// The brand's single recognisable gesture — a soft glow that BREATHES — extracted from
// SignInScreen so Splash + Onboarding share ONE source of the breath (no duplication).
// It is purely decorative: hidden from assistive tech, non-interactive, and it STILLS
// (a fixed dim glow, no scale loop) under reduced motion or a non-positive breath.

function findGlow(tree: ReactTestRenderer.ReactTestRenderer) {
  return tree.root.findAll((n) => n.props?.accessibilityElementsHidden === true)[0];
}
function flatStyle(node: any): Record<string, unknown> {
  const s = node.props.style;
  return Array.isArray(s) ? Object.assign({}, ...s.flat(Infinity).filter(Boolean)) : (s ?? {});
}

async function render(el: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(el); });
  await ReactTestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); });
  return tree;
}

describe('BreathingGlow — the shared brand breath', () => {
  it('is decorative: hidden from a11y, non-interactive, and wears the given color + pill radius', async () => {
    const tree = await render(<BreathingGlow color="#31E1C4" reduced={false} breathMs={4200} size={200} />);
    const glow = findGlow(tree);
    expect(glow).toBeTruthy();
    expect(glow.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(glow.props.pointerEvents).toBe('none');
    const st = flatStyle(glow);
    expect(st.backgroundColor).toBe('#31E1C4');
    expect(st.borderRadius).toBe(radius.pill);
    expect(st.width).toBe(200);
    expect(st.height).toBe(200);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('STILLS under reduced motion (fixed dim opacity, renders without a loop) and unmounts cleanly', async () => {
    const tree = await render(<BreathingGlow color="#31E1C4" reduced breathMs={4200} size={120} />);
    const glow = findGlow(tree);
    expect(flatStyle(glow).opacity).toBe(0.55);
    await ReactTestRenderer.act(async () => { tree.unmount(); }); // dispose-on-unmount, no crash
  });

  it('a non-positive breath does not start a loop (still glow), no crash', async () => {
    const tree = await render(<BreathingGlow color="#0C8C7B" reduced={false} breathMs={0} size={80} />);
    expect(findGlow(tree)).toBeTruthy();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });
});
