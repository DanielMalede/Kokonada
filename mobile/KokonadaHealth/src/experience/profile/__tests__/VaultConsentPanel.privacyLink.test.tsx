import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import { VaultConsentPanel } from '../VaultConsentPanel';
import { space } from '../../../design/tokens';
import { PRIVACY_POLICY_LABEL } from '../../../legal/legalLinks';

jest.setTimeout(20000); // cold-require headroom for CI (compile time, not assertion time)

// HX-5 (CMP-081; compliance brief M6; designer direction Part 2). In the Vault the privacy-policy
// link is information, so it sits with the disclosure: directly after "What we read, and why", in
// one group with it (gap space.xs), start-aligned. It shows in both consent states, is never
// disabled, needs nothing expanded to be seen, and never sits between Sync and the Art. 7(3)
// withdrawal right — Withdraw stays directly under Sync.

type Node = ReactTestRenderer.ReactTestInstance;
const mounted: ReactTestRenderer.ReactTestRenderer[] = [];
afterEach(async () => {
  for (const t of mounted.splice(0)) await ReactTestRenderer.act(async () => { t.unmount(); });
});

function base(over: Partial<React.ComponentProps<typeof VaultConsentPanel>> = {}) {
  return { consentGranted: false, syncing: false, withdrawing: false, onSync: jest.fn(), onWithdraw: jest.fn(), ...over };
}
async function render(props: React.ComponentProps<typeof VaultConsentPanel>) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(<VaultConsentPanel {...props} />); });
  await ReactTestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); });
  mounted.push(tree);
  return tree;
}

const link = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.findAll((n) => n.props.testID === 'privacy-policy-link' && n.parent?.props?.testID !== 'privacy-policy-link');
const byLabel = (tree: ReactTestRenderer.ReactTestRenderer, label: string) =>
  tree.root.findAll((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];
const ancestors = (n: Node): Node[] => (n.parent ? [n.parent, ...ancestors(n.parent)] : []);
// The pressable controls a reader meets, in reading order, by their accessible names.
const controls = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.findAll((n) => typeof n.type === 'string' && typeof n.props.accessibilityRole === 'string'
    && ['button', 'link'].includes(n.props.accessibilityRole) && n.props.accessibilityLabel)
    .map((n) => n.props.accessibilityLabel as string);

describe('VaultConsentPanel — the privacy-policy link', () => {
  it.each([true, false])('consentGranted=%s: shown, as a link, never disabled', async (consentGranted) => {
    const tree = await render(base({ consentGranted }));
    expect(link(tree)).toHaveLength(1);
    expect(link(tree)[0].props.accessibilityRole).toBe('link');
    expect(link(tree)[0].props.accessibilityState).toEqual({ disabled: false });
  });

  it('stays enabled while a sync or a withdrawal is in flight', async () => {
    const tree = await render(base({ consentGranted: true, syncing: true, withdrawing: true }));
    expect(link(tree)[0].props.accessibilityState).toEqual({ disabled: false });
  });

  it('visible with nothing expanded: it is not inside the collapsed accordion', async () => {
    const tree = await render(base());
    const accordion = byLabel(tree, 'What we read, and why');
    expect(accordion.props.accessibilityState).toEqual({ expanded: false });
    expect(link(tree)).toHaveLength(1);
  });

  it('granted: reading order is accordion → policy → Sync → Withdraw (Withdraw stays directly under Sync)', async () => {
    const tree = await render(base({ consentGranted: true }));
    expect(controls(tree)).toEqual(['What we read, and why', PRIVACY_POLICY_LABEL, 'sync-health', 'withdraw-consent']);
  });

  it('not granted: accordion → policy → Sync', async () => {
    const tree = await render(base({ consentGranted: false }));
    expect(controls(tree)).toEqual(['What we read, and why', PRIVACY_POLICY_LABEL, 'sync-health']);
  });

  it('stays in place when the withdrawal confirm expands', async () => {
    const tree = await render(base({ consentGranted: true }));
    await ReactTestRenderer.act(async () => { byLabel(tree, 'withdraw-consent').props.onPress(); });
    expect(controls(tree)).toEqual(['What we read, and why', PRIVACY_POLICY_LABEL, 'sync-health', 'withdraw-cancel', 'withdraw-confirm']);
  });

  it('groups with the disclosure (gap space.xs), start-aligned, while the card keeps its own gap', async () => {
    const tree = await render(base({ consentGranted: true }));
    const accordionUp = new Set(ancestors(byLabel(tree, 'What we read, and why')));
    const group = ancestors(link(tree)[0]).find((a) => typeof a.type === 'string' && accordionUp.has(a))!;
    expect(StyleSheet.flatten(group.props.style)).toEqual({ gap: space.xs });
    const card = ancestors(group).find((a) => typeof a.type === 'string')!;
    expect(StyleSheet.flatten(card.props.style).gap).toBe(space.md);
    const wrapper = ancestors(link(tree)[0]).find((a) => typeof a.type === 'string')!;
    expect(StyleSheet.flatten(wrapper.props.style)).toEqual({ alignItems: 'flex-start' });
  });
});
