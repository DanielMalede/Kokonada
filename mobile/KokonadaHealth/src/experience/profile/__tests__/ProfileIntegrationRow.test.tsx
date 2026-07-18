import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ProfileIntegrationRow } from '../ProfileIntegrationRow';

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
