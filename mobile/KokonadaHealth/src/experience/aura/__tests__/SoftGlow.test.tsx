import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { SoftGlow } from '../SoftGlow';

// The shared soft-falloff primitive: a Skia Circle with a Blur so the color ramps to
// transparent at the edge — a bioluminescent FIELD, not a hard-edged flat disc. Mirrors
// BioAura's Circle+Blur (Skia is mocked in jest.setup exactly as BioAura relies on).

function findAllWith(tree: ReactTestRenderer.ReactTestRenderer, key: string) {
  return tree.root.findAll((n) => n.props?.[key] !== undefined);
}
// the actual Skia Circle carries a numeric `r` (the SoftGlow wrapper also has a `color` prop)
const findCircle = (tree: ReactTestRenderer.ReactTestRenderer, color: string) =>
  tree.root.findAll((n) => n.props?.color === color && typeof n.props?.r === 'number')[0];
async function render(el: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(el); });
  return tree;
}

describe('SoftGlow — Skia soft-falloff glow', () => {
  it('draws a Circle in the given color', async () => {
    const tree = await render(<SoftGlow color="#31E1C4" size={200} />);
    const circle = findCircle(tree, '#31E1C4');
    expect(circle).toBeTruthy();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('applies a Blur (soft edge) whose radius is at least a quarter of the core radius', async () => {
    const size = 200;
    const tree = await render(<SoftGlow color="#31E1C4" size={size} />);
    const circle = findCircle(tree, '#31E1C4');
    const blur = findAllWith(tree, 'blur')[0];
    expect(blur).toBeTruthy();
    // no hard rim: blur ≥ 0.25 × core radius (the design-language floor, per BioAura)
    expect(blur.props.blur).toBeGreaterThanOrEqual(0.25 * circle.props.r);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('is NOT a flat filled disc — no backgroundColor rectangle carries the glow color', async () => {
    const tree = await render(<SoftGlow color="#31E1C4" size={200} />);
    const flatDisc = tree.root.findAll((n) => {
      const s = n.props?.style;
      const flat = Array.isArray(s) ? Object.assign({}, ...s.flat(Infinity).filter(Boolean)) : (s ?? {});
      return (flat as any).backgroundColor === '#31E1C4';
    });
    expect(flatDisc).toHaveLength(0);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('carries an opacity when asked (used as a dim scrim)', async () => {
    const tree = await render(<SoftGlow color="#060B11" size={200} opacity={0.45} />);
    const group = tree.root.findAll((n) => n.props?.opacity === 0.45)[0];
    expect(group).toBeTruthy();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });
});
