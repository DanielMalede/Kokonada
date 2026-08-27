import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { VaultConsentPanel } from '../VaultConsentPanel';
import { colors } from '../../../design/tokens';

// T4 — the §10 Health-data Vault panel. It is the trust summary + "what we read" disclosure + the
// consent WITHDRAWAL right (echoing §11, NOT delete-danger). The full legal document stays ONLY in
// the reused-unchanged ConsentSheet; this panel mirrors the on-device read set and never
// re-implements or weakens the H-9 consent gate. Withdrawal is a right → neutral brand, never red.

// The standard primary CTA wears the INK fill (accent.ctaFill + content.onCtaFill), NOT the aurora
// violet. Theme-agnostic sets — the headless renderer may resolve either face and the rule holds in
// both. glowInk/onAccent stay live tokens (they feed the Generate hero's gradient), so their
// ABSENCE from a standard CTA has to be asserted, never inferred.
const CTA_FILLS = [colors.light.accent.ctaFill, colors.dark.accent.ctaFill];
const CTA_LABELS = [colors.light.content.onCtaFill, colors.dark.content.onCtaFill];
const GLOW_INKS = [colors.light.accent.glowInk, colors.dark.accent.glowInk];
const ON_ACCENTS = [colors.light.content.onAccent, colors.dark.content.onAccent];
const flattenStyle = (node: any): Record<string, any> => {
  const s = node?.props?.style;
  return Array.isArray(s) ? Object.assign({}, ...s.flat(Infinity).filter(Boolean)) : (s ?? {});
};
const firstText = (node: any) => node.findAll((n: any) => typeof n.type === 'string' && n.type === 'Text')[0];

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

function base(over: Partial<React.ComponentProps<typeof VaultConsentPanel>> = {}) {
  return { consentGranted: false, syncing: false, withdrawing: false, onSync: jest.fn(), onWithdraw: jest.fn(), ...over };
}
function render(props: React.ComponentProps<typeof VaultConsentPanel>) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => { tree = ReactTestRenderer.create(<VaultConsentPanel {...props} />); });
  return tree;
}

describe('VaultConsentPanel', () => {
  it('renders the vault title/caption and a Sync CTA that fires onSync', () => {
    const onSync = jest.fn();
    const tree = render(base({ onSync }));
    expect(allText(tree)).toContain('Health data');
    expect(has(tree, 'sync-health')).toBe(true);
    ReactTestRenderer.act(() => { byLabel(tree, 'sync-health')[0].props.onPress(); });
    expect(onSync).toHaveBeenCalledTimes(1);
  });

  it('the Sync CTA shows a busy label while syncing', () => {
    const tree = render(base({ syncing: true }));
    expect(allText(tree)).toMatch(/syncing/i);
  });

  it('Sync and Withdraw both wear the standard CTA ink fill, never the aurora violet', () => {
    const tree = render(base({ consentGranted: true }));
    const sync = byLabel(tree, 'sync-health')[0];
    const syncStyle = flattenStyle(sync);
    expect(CTA_FILLS).toContain(syncStyle.backgroundColor);
    expect(GLOW_INKS).not.toContain(syncStyle.backgroundColor);
    expect(CTA_LABELS).toContain(flattenStyle(firstText(sync)).color);
    expect(ON_ACCENTS).not.toContain(flattenStyle(firstText(sync)).color);

    ReactTestRenderer.act(() => { byLabel(tree, 'withdraw-consent')[0].props.onPress(); });
    const confirm = byLabel(tree, 'withdraw-confirm')[0];
    const confirmStyle = flattenStyle(confirm);
    expect(CTA_FILLS).toContain(confirmStyle.backgroundColor);
    expect(CTA_FILLS).toContain(confirmStyle.borderColor);
    expect(GLOW_INKS).not.toContain(confirmStyle.backgroundColor);
    // Withdrawal stays a RIGHT, not destruction: the neutral CTA fill, never state.danger.
    expect([colors.light.state.danger, colors.dark.state.danger]).not.toContain(confirmStyle.backgroundColor);
  });

  it('the "what we read" disclosure mirrors the Health Connect read categories', () => {
    const tree = render(base());
    // Expand the WhyAccordion (collapsed by default) then read its body.
    const header = tree.root.findAll((n) => n.props.accessibilityLabel === 'What we read, and why')[0];
    expect(header).toBeTruthy();
    ReactTestRenderer.act(() => { header.props.onPress(); });
    const shown = allText(tree);
    expect(shown).toMatch(/heart rate/i);
    expect(shown).toMatch(/resting heart rate/i);
    expect(shown).toMatch(/sleep/i);
    expect(shown).toMatch(/6 months|~6|182/i); // historical readings horizon
  });

  it('hides the Withdraw affordance entirely when consent is not granted', () => {
    const tree = render(base({ consentGranted: false }));
    expect(has(tree, 'withdraw-consent')).toBe(false);
  });

  it('offers Withdraw only when granted, as a two-step confirm that calls onWithdraw once', () => {
    const onWithdraw = jest.fn();
    const tree = render(base({ consentGranted: true, onWithdraw }));
    expect(has(tree, 'withdraw-consent')).toBe(true);
    // First tap only opens the confirm — no withdrawal yet.
    ReactTestRenderer.act(() => { byLabel(tree, 'withdraw-consent')[0].props.onPress(); });
    expect(onWithdraw).not.toHaveBeenCalled();
    expect(has(tree, 'withdraw-confirm')).toBe(true);
    expect(has(tree, 'withdraw-cancel')).toBe(true);
    // Confirm actually withdraws.
    ReactTestRenderer.act(() => { byLabel(tree, 'withdraw-confirm')[0].props.onPress(); });
    expect(onWithdraw).toHaveBeenCalledTimes(1);
  });

  it('Cancel (Keep it) closes the confirm without withdrawing', () => {
    const onWithdraw = jest.fn();
    const tree = render(base({ consentGranted: true, onWithdraw }));
    ReactTestRenderer.act(() => { byLabel(tree, 'withdraw-consent')[0].props.onPress(); });
    ReactTestRenderer.act(() => { byLabel(tree, 'withdraw-cancel')[0].props.onPress(); });
    expect(onWithdraw).not.toHaveBeenCalled();
    expect(has(tree, 'withdraw-confirm')).toBe(false);
  });

  it('the withdraw confirm is NEUTRAL brand, not the account-deletion danger red, and fires a commit haptic', () => {
    const triggerHaptic = jest.fn();
    const tree = render(base({ consentGranted: true, triggerHaptic }));
    ReactTestRenderer.act(() => { byLabel(tree, 'withdraw-consent')[0].props.onPress(); });
    const confirm = byLabel(tree, 'withdraw-confirm')[0];
    const s = Array.isArray(confirm.props.style) ? Object.assign({}, ...confirm.props.style.filter(Boolean)) : confirm.props.style;
    expect(s.backgroundColor).not.toBe('#ff5a5a');
    expect(s.backgroundColor).toBeTruthy(); // a filled NEUTRAL brand CTA (accent.ctaFill), not an outline
    ReactTestRenderer.act(() => { confirm.props.onPress(); });
    expect(triggerHaptic).toHaveBeenCalledWith('commit');
  });
});
