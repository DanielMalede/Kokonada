import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import * as RN from 'react-native';
import { StyleSheet } from 'react-native';
import { ProviderRow } from '../ProviderRow';
import { PROVIDERS, type Provider } from '../providers';
import { a11y } from '../../../design/tokens';

// HX-3 (designer §1.4, MUST): a status-only provider row reflows for large text. At the shared
// threshold (a11y.reflowFontScale) and below it renders as it always has: [glyph] [name + reason]
// ··· [status]. Above it the trailing status cluster moves INTO the column, between the name and
// the reason, and the row aligns to the top — so the status word no longer squeezes the column
// until "YouTube" breaks mid-word. The visual order then matches the reading order of the row's one
// composed label (name, status, reason), and that label never changes with the scale.
//
// The jest preset reports fontScale 2 by default, so every test here sets the scale explicitly.
// It is set where the OS reports it — Dimensions.get — so RN's REAL useWindowDimensions hook reads
// it. Spying on `RN.useWindowDimensions` instead never reaches the row: react-native's index is
// CommonJS, so `import * as RN` is a babel COPY of its exports, and a spy on the copy leaves the
// export the row calls untouched (the row then sees the preset's 2 and a 2.0 test passes on its own).

type J = ReactTestRenderer.ReactTestRendererJSON;

const byId = (id: string): Provider => PROVIDERS.find((p) => p.id === id)!;
const YOUTUBE = byId('youtube');
const SPOTIFY = byId('spotify');

function texts(node: any, acc: string[] = []): string[] {
  if (node == null) return acc;
  if (typeof node === 'string') { acc.push(node); return acc; }
  if (Array.isArray(node)) { node.forEach((n) => texts(n, acc)); return acc; }
  if (node.children) texts(node.children, acc);
  return acc;
}
const textOf = (node: any) => texts(node).join('');
const flat = (node: any): Record<string, any> => (StyleSheet.flatten(node?.props?.style) as any) ?? {};
const findJson = (node: any, pred: (n: J) => boolean): J | undefined => {
  if (node == null || typeof node === 'string') return undefined;
  if (Array.isArray(node)) {
    for (const n of node) { const hit = findJson(n, pred); if (hit) return hit; }
    return undefined;
  }
  if (pred(node)) return node;
  return findJson(node.children, pred);
};
// The rendered row, as host JSON: its children are [glyph, body column] plus, inline, the trailing
// status cluster.
const rowOf = (tree: ReactTestRenderer.ReactTestRenderer, id: string): J =>
  findJson(tree.toJSON(), (n) => n.props?.testID === `provider-row-${id}`)!;
const childrenOf = (node: J): J[] => (node.children ?? []).filter((c): c is J => typeof c !== 'string');

const PRESET_DIMS = { window: RN.Dimensions.get('window'), screen: RN.Dimensions.get('screen') };
let dimsSpy: jest.SpyInstance | null = null;
let threshold: { restore(): void } | null = null;
const atFontScale = (fontScale: number) => {
  dimsSpy?.mockRestore();
  dimsSpy = jest.spyOn(RN.Dimensions, 'get').mockImplementation((dim: 'window' | 'screen') => ({ ...PRESET_DIMS[dim], fontScale }));
};

const trees: ReactTestRenderer.ReactTestRenderer[] = [];
afterEach(async () => {
  for (const t of trees.splice(0)) await ReactTestRenderer.act(async () => { t.unmount(); });
  dimsSpy?.mockRestore(); dimsSpy = null;
  threshold?.restore(); threshold = null;
});
async function render(el: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(el); });
  trees.push(tree);
  return tree;
}

describe('ProviderRow — the status-only row reflows above the shared large-text threshold (HX-3)', () => {
  it.each([
    ['youtube', 'Not yet available'],
    ['spotify', 'Unavailable'],
  ])('above the threshold (2.0) the %s row puts its status between the name and the reason, inside the column, top-aligned', async (id, statusWord) => {
    const provider = byId(id);
    atFontScale(2.0);
    const row = rowOf(await render(<ProviderRow provider={provider} />), provider.id);
    expect(flat(row).alignItems).toBe('flex-start');
    // Nothing trails the column any more: the row is the glyph and the body only.
    const [glyph, body, ...rest] = childrenOf(row);
    expect(rest).toEqual([]);
    expect(textOf(glyph)).toBe(provider.label.charAt(0));
    expect(childrenOf(body).map(textOf)).toEqual([provider.label, statusWord, provider.why]);
  });

  it.each([
    ['youtube', 'Not yet available'],
    ['spotify', 'Unavailable'],
  ])('at the threshold (1.3) the %s row keeps today\'s order: name and reason in the column, the status trailing, centred', async (id, statusWord) => {
    const provider = byId(id);
    atFontScale(1.3);
    const row = rowOf(await render(<ProviderRow provider={provider} />), provider.id);
    expect(flat(row).alignItems).toBe('center');
    const [glyph, body, trailing, ...rest] = childrenOf(row);
    expect(rest).toEqual([]);
    expect(textOf(glyph)).toBe(provider.label.charAt(0));
    expect(childrenOf(body).map(textOf)).toEqual([provider.label, provider.why]);
    expect(textOf(trailing)).toBe(statusWord);
  });

  it('the accessibility label and state are identical at 1.3 and at 2.0 (one stop: name, status, reason)', async () => {
    const a11yAt = async (s: number) => {
      atFontScale(s);
      const row = rowOf(await render(<ProviderRow provider={YOUTUBE} />), 'youtube');
      return { accessible: row.props.accessible, label: row.props.accessibilityLabel, state: row.props.accessibilityState };
    };
    const inline = await a11yAt(1.3);
    const stacked = await a11yAt(2.0);
    expect(stacked).toEqual(inline);
    expect(inline).toEqual({
      accessible: true,
      label: `${YOUTUBE.label}. Not yet available. ${YOUTUBE.why}`,
      state: { disabled: true },
    });
  });

  it('the moved status cluster stays a11y-hidden and keeps its own styles (never a second focus stop)', async () => {
    atFontScale(1.3);
    const inlineCluster = childrenOf(rowOf(await render(<ProviderRow provider={YOUTUBE} />), 'youtube'))[2];
    atFontScale(2.0);
    const stackedCluster = childrenOf(childrenOf(rowOf(await render(<ProviderRow provider={YOUTUBE} />), 'youtube'))[1])[1];
    for (const cluster of [inlineCluster, stackedCluster]) {
      expect(cluster.props.importantForAccessibility).toBe('no-hide-descendants');
      expect(cluster.props.accessibilityElementsHidden).toBe(true);
    }
    expect(flat(stackedCluster)).toEqual(flat(inlineCluster));
    expect(childrenOf(stackedCluster).map(flat)).toEqual(childrenOf(inlineCluster).map(flat));
  });

  it('a connected row moves its ✓ with the status word', async () => {
    atFontScale(2.0);
    const row = rowOf(await render(<ProviderRow provider={SPOTIFY} connected />), 'spotify');
    const [, body, ...rest] = childrenOf(row);
    expect(rest).toEqual([]);
    expect(childrenOf(body).map(textOf)).toEqual(['Spotify', '✓Connected', 'Playing your library.']);
  });

  it('follows a11y.reflowFontScale, not a local copy of the number', async () => {
    atFontScale(1.5);
    expect(childrenOf(rowOf(await render(<ProviderRow provider={YOUTUBE} />), 'youtube'))).toHaveLength(2); // stacked
    threshold = jest.replaceProperty(a11y as { reflowFontScale: number }, 'reflowFontScale', 1.6);
    expect(childrenOf(rowOf(await render(<ProviderRow provider={YOUTUBE} />), 'youtube'))).toHaveLength(3); // inline
  });

  it('a row with an action (enabled) keeps its layout at 2.0 — the reflow is the status-only row\'s (UI-053 owns the rest)', async () => {
    const enabled: Provider = { id: 'probe', label: 'Probe', kind: 'music', state: 'enabled', why: 'A reason.' };
    const shapeAt = async (s: number) => {
      atFontScale(s);
      const tree = await render(<ProviderRow provider={enabled} onConnect={() => {}} />);
      const json = tree.toJSON() as J;
      return { align: flat(json).alignItems, children: childrenOf(json).map(textOf) };
    };
    expect(await shapeAt(2.0)).toEqual(await shapeAt(1.3));
  });
});
