import React from 'react';
import * as RN from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { VaultConsentPanel } from '../VaultConsentPanel';
import { colors, type ThemeName } from '../../../design/tokens';
import { contrastRatio, AA_NORMAL } from '../../../design/contrast';

// T4 — the §10 Health-data Vault panel. It is the trust summary + "what we read" disclosure + the
// consent WITHDRAWAL right (echoing §11, NOT delete-danger). The full legal document stays ONLY in
// the reused-unchanged ConsentSheet; this panel mirrors the on-device read set and never
// re-implements or weakens the H-9 consent gate. Withdrawal is a right → neutral brand, never red.

// The standard primary CTA wears the INK fill (accent.ctaFill + content.onCtaFill), NOT the aurora
// violet. POSITIVE colour claims are pinned per FACE (see the describe.each below); only the
// NEGATIVE sets stay theme-spanning, because excluding a hue in BOTH faces is strictly stronger
// than excluding it in one. glowInk/onAccent stay live tokens (they feed the Generate hero's
// gradient), so their ABSENCE from a standard CTA has to be asserted, never inferred.
const GLOW_INKS = [colors.light.accent.glowInk, colors.dark.accent.glowInk];
const ON_ACCENTS = [colors.light.content.onAccent, colors.dark.content.onAccent];
// The account-deletion red, as the palette ACTUALLY defines it. The literal '#ff5a5a' this file
// used to assert against is in NEITHER face, so that guard could never fail: the confirm could be
// painted state.danger fill AND state.danger label and still pass.
const DANGERS = [colors.light.state.danger, colors.dark.state.danger];
const FACES: ThemeName[] = ['light', 'dark'];

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

// Teardown discipline, per FILE rather than per call site. This file previously unmounted NOTHING
// across eight renders, while WhyAccordion starts an Animated.parallel on expand and useMotion
// resolves an async OS probe — so every tree stayed live for the rest of the run. Registering here
// sweeps them all, on the failure path as well as the success path.
const mounted: ReactTestRenderer.ReactTestRenderer[] = [];
afterEach(async () => {
  for (const t of mounted.splice(0)) await ReactTestRenderer.act(async () => { t.unmount(); });
  jest.restoreAllMocks();
});

function base(over: Partial<React.ComponentProps<typeof VaultConsentPanel>> = {}) {
  return { consentGranted: false, syncing: false, withdrawing: false, onSync: jest.fn(), onWithdraw: jest.fn(), ...over };
}
async function render(props: React.ComponentProps<typeof VaultConsentPanel>) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(<VaultConsentPanel {...props} />); });
  // Flush useMotion's async reduce-motion probe so its setState lands INSIDE act(), not after the
  // test has returned (which is what raised "an update to WhyAccordion was not wrapped in act").
  await ReactTestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); });
  mounted.push(tree);
  return tree;
}

describe('VaultConsentPanel', () => {
  it('renders the vault title/caption and a Sync CTA that fires onSync', async () => {
    const onSync = jest.fn();
    const tree = await render(base({ onSync }));
    expect(allText(tree)).toContain('Health data');
    expect(has(tree, 'sync-health')).toBe(true);
    ReactTestRenderer.act(() => { byLabel(tree, 'sync-health')[0].props.onPress(); });
    expect(onSync).toHaveBeenCalledTimes(1);
  });

  it('the Sync CTA shows a busy label while syncing', async () => {
    const tree = await render(base({ syncing: true }));
    expect(allText(tree)).toMatch(/syncing/i);
  });

  // ── FACE-FORCED colour pins ───────────────────────────────────────────────────────────────────
  // @react-native/jest-preset REPLACES react-native's useColorScheme with jest.fn(() => 'light'),
  // so an unforced render always resolves the LIGHT face — the shipping DARK face was never
  // rendered here at all. Asserting set-membership across a union of both faces therefore waved a
  // CROSS-FACE pairing through: a fill from one face under a label from the other measures ~1.09:1
  // (an invisible control) with every assertion still green. Forcing the scheme runs the REAL
  // useTheme → resolveScheme path in BOTH faces, pins each value EXACTLY, and measures the
  // rendered pair.
  describe.each(FACES)('the vault CTAs, rendered on the %s face', (scheme) => {
    const C = colors[scheme];
    beforeEach(() => { jest.spyOn(RN, 'useColorScheme').mockReturnValue(scheme); });

    it('Sync wears THIS face’s ink fill AND THIS face’s label, never the aurora violet', async () => {
      const tree = await render(base({ consentGranted: true }));
      const sync = byLabel(tree, 'sync-health')[0];
      const s = flattenStyle(sync);
      const label = flattenStyle(firstText(sync));
      expect(s.backgroundColor).toBe(C.accent.ctaFill);
      expect(label.color).toBe(C.content.onCtaFill);
      expect(contrastRatio(label.color, s.backgroundColor)).toBeGreaterThanOrEqual(AA_NORMAL);
      expect(GLOW_INKS).not.toContain(s.backgroundColor);
      expect(ON_ACCENTS).not.toContain(label.color);
    });

    // Withdrawal is a RIGHT, not destruction. The fill was pinned; the LABEL was not — so
    // `color: c.state.danger` on "Withdraw" produced a red-lettered withdrawal button with the
    // whole suite green, which is exactly the framing the guarantee forbids.
    it('the withdraw CONFIRM is neutral brand in fill AND label — never the account-deletion red', async () => {
      const tree = await render(base({ consentGranted: true }));
      ReactTestRenderer.act(() => { byLabel(tree, 'withdraw-consent')[0].props.onPress(); });
      const confirm = byLabel(tree, 'withdraw-confirm')[0];
      const s = flattenStyle(confirm);
      const label = flattenStyle(firstText(confirm));
      expect(s.backgroundColor).toBe(C.accent.ctaFill);
      expect(s.borderColor).toBe(C.accent.ctaFill);
      expect(label.color).toBe(C.content.onCtaFill);
      expect(contrastRatio(label.color, s.backgroundColor)).toBeGreaterThanOrEqual(AA_NORMAL);
      expect(GLOW_INKS).not.toContain(s.backgroundColor);
      expect(DANGERS).not.toContain(s.backgroundColor);
      expect(DANGERS).not.toContain(s.borderColor);
      expect(DANGERS).not.toContain(label.color);
    });

    // The ENTRY link is the more visible of the two — it is on screen for every consenting user,
    // whereas the confirm only appears after a tap. It is a quiet secondary, never a red warning.
    it('the withdraw ENTRY link is a quiet content.secondary link — never the account-deletion red', async () => {
      const tree = await render(base({ consentGranted: true }));
      const link = byLabel(tree, 'withdraw-consent')[0];
      const label = flattenStyle(firstText(link));
      expect(label.color).toBe(C.content.secondary);
      expect(DANGERS).not.toContain(label.color);
      // It is a bare link, so its label is read against the card it sits on.
      expect(flattenStyle(link).backgroundColor).toBeUndefined();
      expect(contrastRatio(label.color, C.surface.raised)).toBeGreaterThanOrEqual(AA_NORMAL);
    });
  });

  it('the "what we read" disclosure mirrors the Health Connect read categories', async () => {
    const tree = await render(base());
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

  it('hides the Withdraw affordance entirely when consent is not granted', async () => {
    const tree = await render(base({ consentGranted: false }));
    expect(has(tree, 'withdraw-consent')).toBe(false);
  });

  it('offers Withdraw only when granted, as a two-step confirm that calls onWithdraw once', async () => {
    const onWithdraw = jest.fn();
    const tree = await render(base({ consentGranted: true, onWithdraw }));
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

  it('Cancel (Keep it) closes the confirm without withdrawing', async () => {
    const onWithdraw = jest.fn();
    const tree = await render(base({ consentGranted: true, onWithdraw }));
    ReactTestRenderer.act(() => { byLabel(tree, 'withdraw-consent')[0].props.onPress(); });
    ReactTestRenderer.act(() => { byLabel(tree, 'withdraw-cancel')[0].props.onPress(); });
    expect(onWithdraw).not.toHaveBeenCalled();
    expect(has(tree, 'withdraw-confirm')).toBe(false);
  });

  it('the withdraw confirm is NEUTRAL brand, not the account-deletion danger red, and fires a commit haptic', async () => {
    const triggerHaptic = jest.fn();
    const tree = await render(base({ consentGranted: true, triggerHaptic }));
    ReactTestRenderer.act(() => { byLabel(tree, 'withdraw-consent')[0].props.onPress(); });
    const confirm = byLabel(tree, 'withdraw-confirm')[0];
    const s = flattenStyle(confirm);
    expect(DANGERS).not.toContain(s.backgroundColor);
    expect(s.backgroundColor).toBeTruthy(); // a filled NEUTRAL brand CTA (accent.ctaFill), not an outline
    ReactTestRenderer.act(() => { confirm.props.onPress(); });
    expect(triggerHaptic).toHaveBeenCalledWith('commit');
  });
});
