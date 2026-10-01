import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import * as RN from 'react-native';
import { StyleSheet } from 'react-native';
import { ProfileIntegrationRow } from '../ProfileIntegrationRow';
import { PROVIDERS } from '../../connect/providers';
import { a11y } from '../../../design/tokens';

// T3 — the §10 integration row. One calm grammar for all four rows: [neutral glyph][name + reason]
// [status word + decorative ✓]. A status-only row is one accessible group with a composed label; a
// row WITH an action keeps the button separately focusable (so the row is never one big disabled
// group). No colored brand marks, no pills for halted/deferred providers — the status is a WORD.

function texts(node: any, acc: string[] = []): string[] {
  if (node == null) return acc;
  if (typeof node === 'string') { acc.push(node); return acc; }
  if (Array.isArray(node)) { node.forEach((n) => texts(n, acc)); return acc; }
  if (node.children) texts(node.children, acc);
  return acc;
}
const allText = (tree: ReactTestRenderer.ReactTestRenderer) => texts(tree.toJSON()).join(' ');
const byLabel = (tree: ReactTestRenderer.ReactTestRenderer, label: string) =>
  tree.root.findAll((n) => n.props.accessibilityLabel === label);
const has = (tree: ReactTestRenderer.ReactTestRenderer, label: string) => byLabel(tree, label).length > 0;
// The action button is selected by a stable testID; its accessibilityLabel is a HUMAN phrase.
const byTestId = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((n) => n.props.testID === id);

function render(el: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => { tree = ReactTestRenderer.create(el); });
  return tree;
}

describe('ProfileIntegrationRow', () => {
  it('renders name, reason and status word, with the ✓ decorative + a11y-hidden when connected', () => {
    const tree = render(
      <ProfileIntegrationRow label="Spotify" reason="Playing your library." statusWord="Connected" connected />,
    );
    const shown = allText(tree);
    expect(shown).toContain('Spotify');
    expect(shown).toContain('Playing your library.');
    expect(shown).toContain('Connected');
    // The check glyph must be decorative-only (word carries meaning).
    const check = tree.root.findAll((n) => typeof n.props.children === 'string' && n.props.children === '✓')[0];
    expect(check).toBeTruthy();
    const hiddenAncestor = tree.root.findAll((n) => n.props.importantForAccessibility === 'no-hide-descendants');
    expect(hiddenAncestor.length).toBeGreaterThan(0);
  });

  it('a status-only row is one accessible group with a composed label and no action button', () => {
    const tree = render(
      <ProfileIntegrationRow label="Spotify" reason="Connecting Spotify isn't available in Kokonada right now." statusWord="Unavailable" connected={false} />,
    );
    const group = tree.root.findAll((n) => n.props.accessible === true && typeof n.props.accessibilityLabel === 'string')[0];
    expect(group).toBeTruthy();
    expect(group.props.accessibilityLabel).toBe("Spotify. Unavailable. Connecting Spotify isn't available in Kokonada right now.");
    expect(group.props.accessibilityState).toEqual({ disabled: true });
  });

  it('renders a secondary text action (Reconnect) selected by testID, announcing the status word', () => {
    const onPress = jest.fn();
    const tree = render(
      <ProfileIntegrationRow label="Spotify" reason="Playing your library." statusWord="Connected" connected
        action={{ label: 'Reconnect', testId: 'reconnect-spotify', onPress }} />,
    );
    const btn = byTestId(tree, 'reconnect-spotify')[0];
    expect(btn).toBeTruthy();
    // The status word is folded into the button's a11y label so a screen reader announces "Connected".
    expect(btn.props.accessibilityLabel).toContain('Reconnect');
    expect(btn.props.accessibilityLabel).toContain('Connected');
    ReactTestRenderer.act(() => { btn.props.onPress(); });
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('a busy action shows its busy label and is disabled', () => {
    const tree = render(
      <ProfileIntegrationRow label="YouTube Music" reason="Rebuilding your library…" statusWord="Connected" connected
        action={{ label: 'Disconnect', busyLabel: 'Rebuilding…', testId: 'disconnect-youtube', onPress: jest.fn(), busy: true }} />,
    );
    expect(allText(tree)).toContain('Rebuilding…');
    const btn = byTestId(tree, 'disconnect-youtube')[0];
    expect(btn.props.accessibilityState).toEqual({ disabled: true });
  });

  it('no colored brand mark — the glyph is a neutral monochrome initial only', () => {
    const tree = render(
      <ProfileIntegrationRow label="Spotify" reason="Playing your library." statusWord="Connected" connected />,
    );
    // The glyph shows the initial "S"; there is no <Image> logo anywhere in the row.
    expect(allText(tree)).toContain('S');
    expect(tree.root.findAll((n) => (n.type as unknown as string) === 'Image')).toHaveLength(0);
  });
});

// HX-3 (designer §1.4, MUST): the status-only row reflows for large text, exactly like the Connect
// row. At a11y.reflowFontScale and below: [glyph] [name + reason] ··· [status]. Above it the status
// cluster moves into the column between the name and the reason and the row aligns to the top; the
// composed label never changes. A row WITH an action keeps its layout (UI-053 owns that row).
//
// The scale is set where the OS reports it (Dimensions.get), so RN's real useWindowDimensions hook
// reads it; a spy on `RN.useWindowDimensions` would only patch babel's copy of the exports.
describe('ProfileIntegrationRow — the status-only row reflows above the shared large-text threshold (HX-3)', () => {
  type J = ReactTestRenderer.ReactTestRendererJSON;
  const YOUTUBE = PROVIDERS.find((p) => p.id === 'youtube')!;
  const ROWS = {
    youtube: { label: YOUTUBE.label, reason: YOUTUBE.why, statusWord: 'Not yet available', connected: false },
    wearable: { label: 'Wearable', reason: 'Connect a heart-rate source to stream live heart rate.', statusWord: 'Not connected', connected: false },
  } as const;

  const PRESET_DIMS = { window: RN.Dimensions.get('window'), screen: RN.Dimensions.get('screen') };
  let dimsSpy: jest.SpyInstance | null = null;
  let threshold: { restore(): void } | null = null;
  const atFontScale = (fontScale: number) => {
    dimsSpy?.mockRestore();
    dimsSpy = jest.spyOn(RN.Dimensions, 'get').mockImplementation((dim: 'window' | 'screen') => ({ ...PRESET_DIMS[dim], fontScale }));
  };
  const trees: ReactTestRenderer.ReactTestRenderer[] = [];
  afterEach(() => {
    for (const t of trees.splice(0)) ReactTestRenderer.act(() => { t.unmount(); });
    dimsSpy?.mockRestore(); dimsSpy = null;
    threshold?.restore(); threshold = null;
  });
  const renderRow = (el: React.ReactElement): J => {
    const tree = render(el);
    trees.push(tree);
    return tree.toJSON() as J;
  };

  const textOf = (node: any) => texts(node).join('');
  const flat = (node: any): Record<string, any> => (StyleSheet.flatten(node?.props?.style) as any) ?? {};
  const childrenOf = (node: J): J[] => (node.children ?? []).filter((c): c is J => typeof c !== 'string');

  it.each(Object.keys(ROWS) as (keyof typeof ROWS)[])('above the threshold (2.0) the %s row puts its status between the name and the reason, inside the column, top-aligned', (key) => {
    const r = ROWS[key];
    atFontScale(2.0);
    const row = renderRow(<ProfileIntegrationRow {...r} />);
    expect(flat(row).alignItems).toBe('flex-start');
    const [glyph, body, ...rest] = childrenOf(row);
    expect(rest).toEqual([]); // nothing trails the column
    expect(textOf(glyph)).toBe(r.label.charAt(0));
    expect(childrenOf(body).map(textOf)).toEqual([r.label, r.statusWord, r.reason]);
  });

  it.each(Object.keys(ROWS) as (keyof typeof ROWS)[])('at the threshold (1.3) the %s row keeps today\'s order: name and reason in the column, the status trailing, centred', (key) => {
    const r = ROWS[key];
    atFontScale(1.3);
    const row = renderRow(<ProfileIntegrationRow {...r} />);
    expect(flat(row).alignItems).toBe('center');
    const [glyph, body, trailing, ...rest] = childrenOf(row);
    expect(rest).toEqual([]);
    expect(textOf(glyph)).toBe(r.label.charAt(0));
    expect(childrenOf(body).map(textOf)).toEqual([r.label, r.reason]);
    expect(textOf(trailing)).toBe(r.statusWord);
  });

  it('the accessibility label and state are identical at 1.3 and at 2.0 (one stop: name, status, reason)', () => {
    const a11yAt = (s: number) => {
      atFontScale(s);
      const row = renderRow(<ProfileIntegrationRow {...ROWS.youtube} />);
      return { accessible: row.props.accessible, label: row.props.accessibilityLabel, state: row.props.accessibilityState };
    };
    const inline = a11yAt(1.3);
    const stacked = a11yAt(2.0);
    expect(stacked).toEqual(inline);
    expect(inline).toEqual({
      accessible: true,
      label: `${YOUTUBE.label}. Not yet available. ${YOUTUBE.why}`,
      state: { disabled: true },
    });
  });

  it('the moved status cluster stays a11y-hidden and keeps its own styles (never a second focus stop)', () => {
    atFontScale(1.3);
    const inlineCluster = childrenOf(renderRow(<ProfileIntegrationRow {...ROWS.youtube} />))[2];
    atFontScale(2.0);
    const stackedCluster = childrenOf(childrenOf(renderRow(<ProfileIntegrationRow {...ROWS.youtube} />))[1])[1];
    for (const cluster of [inlineCluster, stackedCluster]) {
      expect(cluster.props.importantForAccessibility).toBe('no-hide-descendants');
      expect(cluster.props.accessibilityElementsHidden).toBe(true);
    }
    expect(flat(stackedCluster)).toEqual(flat(inlineCluster));
    expect(childrenOf(stackedCluster).map(flat)).toEqual(childrenOf(inlineCluster).map(flat));
  });

  it('a connected status-only row moves its ✓ with the status word', () => {
    atFontScale(2.0);
    const row = renderRow(<ProfileIntegrationRow label="Health data" reason="Reading your body, with your consent." statusWord="On" connected />);
    const [, body, ...rest] = childrenOf(row);
    expect(rest).toEqual([]);
    expect(childrenOf(body).map(textOf)).toEqual(['Health data', '✓On', 'Reading your body, with your consent.']);
  });

  it('follows a11y.reflowFontScale, not a local copy of the number', () => {
    atFontScale(1.5);
    expect(childrenOf(renderRow(<ProfileIntegrationRow {...ROWS.youtube} />))).toHaveLength(2); // stacked
    threshold = jest.replaceProperty(a11y as { reflowFontScale: number }, 'reflowFontScale', 1.6);
    expect(childrenOf(renderRow(<ProfileIntegrationRow {...ROWS.youtube} />))).toHaveLength(3); // inline
  });

  it('a row with an action keeps its layout at 2.0 — the reflow is the status-only row\'s (UI-053 owns the rest)', () => {
    const shapeAt = (s: number) => {
      atFontScale(s);
      const row = renderRow(
        <ProfileIntegrationRow label="Spotify" reason="Playing your library." statusWord="Connected" connected
          action={{ label: 'Reconnect', testId: 'reconnect-spotify', onPress: () => {} }} />,
      );
      return { align: flat(row).alignItems, children: childrenOf(row).map(textOf) };
    };
    expect(shapeAt(2.0)).toEqual(shapeAt(1.3));
  });
});
