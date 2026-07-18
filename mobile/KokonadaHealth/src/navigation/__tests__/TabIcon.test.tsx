import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { TabIcon } from '../TabIcon';
import { TAB_ROUTES, type TabRoute } from '../tabRoutes';
import { space } from '../../design/tokens';

// TabIcon is a Skia token-drawn glyph — STRUCTURALLY tofu-proof (no font, no substitution). The
// Skia primitives are jest-stubbed (render null), so this suite pins the CONTRACT the shell relies
// on — a distinct host wrapper per route, color + fill/outline forwarding, and decorative a11y —
// NOT the glyph geometry (that is device-verified via screenshots + the designer SHIP, per R6).

async function render(el: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(el); });
  return tree;
}
// The glyph Path is the only node whose `style` prop is the string 'fill' | 'stroke' (the wrapper
// View + Canvas carry object styles), so it is unambiguously locatable under the Skia stub.
const glyph = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.findAll((n) => n.props?.style === 'fill' || n.props?.style === 'stroke')[0];
const wrapper = (tree: ReactTestRenderer.ReactTestRenderer, route: TabRoute) =>
  tree.root.findAll((n) => n.props?.testID === `tab-icon-${route}`)[0];

describe('TabIcon — Skia token glyph (zero-tofu chrome)', () => {
  it('renders a distinct host wrapper for each of the 5 TAB_ROUTES', async () => {
    for (const route of TAB_ROUTES) {
      const tree = await render(<TabIcon route={route} color="#ABCDEF" />);
      expect(wrapper(tree, route)).toBeTruthy();
      await ReactTestRenderer.act(async () => { tree.unmount(); });
    }
    // all five ids are distinct
    expect(new Set(TAB_ROUTES.map((r) => `tab-icon-${r}`)).size).toBe(5);
  });

  it('forwards `color` to the glyph paint', async () => {
    const tree = await render(<TabIcon route="Generate" color="#31E1C4" />);
    expect(glyph(tree).props.color).toBe('#31E1C4');
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('SOLID glyphs (Generate/NowPlaying/Profile) → Skia fill when active, stroke when inactive [shape signal]', async () => {
    for (const route of ['Generate', 'NowPlaying', 'Profile'] as const) {
      const active = await render(<TabIcon route={route} color="#fff" filled />);
      expect(glyph(active).props.style).toBe('fill');
      const inactive = await render(<TabIcon route={route} color="#fff" />);
      expect(glyph(inactive).props.style).toBe('stroke');
      await ReactTestRenderer.act(async () => { active.unmount(); inactive.unmount(); });
    }
  });

  it('LINE glyphs (Pulse/History) stay STROKED in both states and go HEAVIER when active [weight signal, never a fill-blob]', async () => {
    // Skia implicitly closes an open contour when filling, so filling the ECG polyline / clock rim
    // would collapse the SELECTED state into a blob/disc. Line glyphs therefore never fill — active
    // is signalled by a bolder stroke instead (colour stays non-sole: weight + wash + hue + selected).
    for (const route of ['Pulse', 'History'] as const) {
      const active = await render(<TabIcon route={route} color="#fff" filled />);
      const inactive = await render(<TabIcon route={route} color="#fff" />);
      expect(glyph(active).props.style).toBe('stroke');
      expect(glyph(inactive).props.style).toBe('stroke');
      expect(glyph(active).props.strokeWidth).toBeGreaterThan(glyph(inactive).props.strokeWidth);
      await ReactTestRenderer.act(async () => { active.unmount(); inactive.unmount(); });
    }
  });

  it('is DECORATIVE — the wrapper hides the glyph from assistive tech (label rides on the tab)', async () => {
    const tree = await render(<TabIcon route="Profile" color="#fff" />);
    const w = wrapper(tree, 'Profile');
    expect(w.props.accessibilityElementsHidden).toBe(true);
    expect(w.props.importantForAccessibility).toBe('no-hide-descendants');
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('sizes from the icon token (space.xl) by default, and honours an explicit size', async () => {
    const def = await render(<TabIcon route="History" color="#fff" />);
    expect(wrapper(def, 'History').props.style).toMatchObject({ width: space.xl, height: space.xl });
    await ReactTestRenderer.act(async () => { def.unmount(); });

    const big = await render(<TabIcon route="History" color="#fff" size={space['2xl']} />);
    expect(wrapper(big, 'History').props.style).toMatchObject({ width: space['2xl'], height: space['2xl'] });
    await ReactTestRenderer.act(async () => { big.unmount(); });
  });
});
