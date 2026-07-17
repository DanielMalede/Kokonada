import React from 'react';
import { StyleSheet } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

// Deterministic theme so the tint assertions are exact (no async color-scheme flicker).
jest.mock('../../../design/theme', () => ({ useTheme: jest.fn(), useMotion: jest.fn() }));

import { SourceGlyph } from '../SourceGlyph';
import { useTheme } from '../../../design/theme';
import { colors } from '../../../design/tokens';

const DARK = colors.dark;

beforeEach(() => {
  (useTheme as jest.Mock).mockReturnValue({ name: 'dark', c: DARK });
});

function flatStyle(node: any): Record<string, unknown> {
  const s = node?.props?.style;
  return Array.isArray(s) ? Object.assign({}, ...s.flat(Infinity).filter(Boolean)) : (s ?? {});
}
async function render(el: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(el); });
  return tree;
}
const ring = (t: ReactTestRenderer.ReactTestRenderer) => t.root.findAll((n) => n.props?.testID === 'source-glyph-ring')[0];
const dot = (t: ReactTestRenderer.ReactTestRenderer) => t.root.findAll((n) => n.props?.testID === 'source-glyph-dot')[0];

describe('SourceGlyph — WCAG 1.4.1 non-color silhouette signal', () => {
  it('is decorative — fully hidden from assistive tech (the row label speaks the source)', async () => {
    const tree = await render(<SourceGlyph source="live" />);
    const hidden = tree.root.findAll((n) => n.props?.accessibilityElementsHidden === true)[0];
    expect(hidden).toBeTruthy();
    expect(hidden.props.importantForAccessibility).toBe('no-hide-descendants');
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('Live wears the brand accent (bold ring); Manual wears the quiet secondary (thin ring)', async () => {
    const liveTree = await render(<SourceGlyph source="live" />);
    const manualTree = await render(<SourceGlyph source="manual" />);
    expect(flatStyle(ring(liveTree)).borderColor).toBe(DARK.accent.glow);
    expect(flatStyle(ring(manualTree)).borderColor).toBe(DARK.content.secondary);
    // the tint also colors the dot (color is reinforcement, never the sole channel)
    expect(flatStyle(dot(liveTree)).backgroundColor).toBe(DARK.accent.glow);
    expect(flatStyle(dot(manualTree)).backgroundColor).toBe(DARK.content.secondary);
    // ring weight differs (secondary, non-color reinforcement)
    const liveW = flatStyle(ring(liveTree)).borderWidth as number;
    const manualW = flatStyle(ring(manualTree)).borderWidth as number;
    expect(liveW).toBe(2);
    expect(manualW).toBe(StyleSheet.hairlineWidth);
    expect(liveW).toBeGreaterThan(manualW);
    await ReactTestRenderer.act(async () => { liveTree.unmount(); manualTree.unmount(); });
  });

  it('differs in SILHOUETTE not just tint — Live dot is centred, Manual dot is pushed off-centre', async () => {
    const liveTree = await render(<SourceGlyph source="live" />);
    const manualTree = await render(<SourceGlyph source="manual" />);
    // Live: radially symmetric — no absolute offset (centred by the ring).
    expect(flatStyle(dot(liveTree)).position).toBeUndefined();
    // Manual: an off-centre dot — an absolute offset the eye reads without any color.
    expect(flatStyle(dot(manualTree)).position).toBe('absolute');
    await ReactTestRenderer.act(async () => { liveTree.unmount(); manualTree.unmount(); });
  });
});
