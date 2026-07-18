import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { BrandMark } from '../BrandMark';
import { BREATH_OPACITY } from '../../aura/BreathingGlow';
import { treatments, geometry } from '../../../design/brandMark.geometry';

// The Aurora Seed, painted in Skia (Canvas/Group/Circle/Blur), from the shared geometry.
// Its pixel fidelity is device-verified (like TabIcon), so — mirroring SoftGlow.test — we
// assert STRUCTURE (which nodes, which props), never geometry: a decorative a11y-hidden
// wrapper, a coloured seed core, a soft blur (no hard rim), two stroked rings (the faint one
// thinner + dimmer), a bloom field in the accent colour, and a rest-opacity breath group.

async function render(el: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(el); });
  return tree;
}
const circlesWith = (tree: ReactTestRenderer.ReactTestRenderer, pred: (p: any) => boolean) =>
  tree.root.findAll((n) => typeof n.props?.r === 'number' && pred(n.props));

describe('BrandMark — the Aurora Seed (Skia, structural)', () => {
  it('is a decorative, a11y-hidden, non-interactive wrapper at the given size', async () => {
    const tree = await render(<BrandMark size={200} />);
    const w = tree.root.findAll((n) => n.props?.testID === 'brand-mark')[0];
    expect(w).toBeTruthy();
    expect(w.props.accessibilityElementsHidden).toBe(true);
    expect(w.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(w.props.pointerEvents).toBe('none');
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('paints the glowing seed core in the core colour, with a bright highlight on top', async () => {
    const tree = await render(<BrandMark size={200} treatment="dark" />);
    expect(circlesWith(tree, (p) => p.color === treatments.dark.coreBody)[0]).toBeTruthy();
    expect(circlesWith(tree, (p) => p.color === treatments.dark.coreHighlight)[0]).toBeTruthy();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('softens the seed with a Blur that clears the SoftGlow floor (>= 0.25 x core radius) — no hard rim', async () => {
    const size = 200;
    const tree = await render(<BrandMark size={size} treatment="dark" />);
    const core = circlesWith(tree, (p) => p.color === treatments.dark.coreBody)[0];
    const blurs = tree.root.findAll((n) => typeof n.props?.blur === 'number');
    expect(blurs.length).toBeGreaterThan(0);
    expect(blurs.some((b) => b.props.blur >= 0.25 * core.props.r)).toBe(true);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('draws TWO stroked rings — the faint outer ring thinner AND dimmer than the breath ring', async () => {
    const tree = await render(<BrandMark size={200} treatment="dark" />);
    const rings = tree.root.findAll((n) => n.props?.style === 'stroke' && typeof n.props?.r === 'number');
    expect(rings).toHaveLength(2);
    const [faint, breath] = [...rings].sort((a, b) => a.props.strokeWidth - b.props.strokeWidth);
    expect(faint.props.strokeWidth).toBeLessThan(breath.props.strokeWidth);
    expect(faint.props.opacity).toBeLessThan(breath.props.opacity);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('renders a bloom FIELD (a filled accent circle, not a stroked ring) and breathes at rest opacity by default', async () => {
    const tree = await render(<BrandMark size={200} treatment="dark" />);
    const bloom = circlesWith(tree, (p) => p.color === treatments.dark.bloom && p.style !== 'stroke')[0];
    expect(bloom).toBeTruthy(); // the fill bloom, distinct from the stroked rings
    const breathGroup = tree.root.findAll((n) => n.props?.opacity === BREATH_OPACITY.rest)[0];
    expect(breathGroup).toBeTruthy();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('swaps the whole palette when the treatment changes (light core, no dark core)', async () => {
    const tree = await render(<BrandMark size={200} treatment="light" />);
    expect(circlesWith(tree, (p) => p.color === treatments.light.coreBody)[0]).toBeTruthy();
    expect(circlesWith(tree, (p) => p.color === treatments.dark.coreBody)).toHaveLength(0);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('honours an explicit opacity (used to hold the mark full while a wrapper carries the breath)', async () => {
    const tree = await render(<BrandMark size={200} treatment="dark" opacity={1} />);
    expect(tree.root.findAll((n) => n.props?.opacity === 1).length).toBeGreaterThan(0);
    expect(tree.root.findAll((n) => n.props?.opacity === BREATH_OPACITY.rest)).toHaveLength(0);
    // geometry is the shared source — sanity that the component consumes it
    expect(geometry.ring2.r).toBeGreaterThan(geometry.ring1.r);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });
});
