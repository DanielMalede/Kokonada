import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { WatchPairingCard } from '../WatchPairingCard';
import { createWatchPairingFlow, type WatchPairingDeps } from '../watchPairingStore';
import { haptics, colors } from '../../../design/tokens';

// T2 — the §10 watch pairing CARD. States render from the store; the code is large + selectable
// with NO Copy button (you can't paste into a watch bezel — you read + type); the a11y label spells
// the digits; the countdown is a polite live region. The card's output NEVER contains a whr_ token.

const CODE = { code: '123456', expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() };

function makeDeps(over: Partial<WatchPairingDeps> = {}): WatchPairingDeps {
  return {
    requestPairing: jest.fn().mockResolvedValue({ ok: true, data: CODE }),
    fetchStatus: jest.fn().mockResolvedValue({ ok: true, data: { connected: false, lastSeenAt: null } }),
    revoke: jest.fn().mockResolvedValue({ ok: true, data: { message: 'Watch disconnected' } }),
    clearToken: jest.fn().mockResolvedValue(undefined),
    now: () => Date.now(),
    ...over,
  };
}

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
// react-test-renderer surfaces both the Pressable and its host node for one label, so presence is
// "> 0" (mirrors the pinned ProfileScreen test's [0] convention), and absence is exactly 0.
const has = (tree: ReactTestRenderer.ReactTestRenderer, label: string) => byLabel(tree, label).length > 0;
const flush = async () => { await ReactTestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); }); };

async function renderCard(deps: WatchPairingDeps) {
  const store = createWatchPairingFlow(deps);
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(<WatchPairingCard store={store} />); });
  await flush();
  return { tree, store };
}

describe('WatchPairingCard', () => {
  it('not-set-up: offers a single "Set up watch" control that mints a code', async () => {
    const { tree } = await renderCard(makeDeps());
    expect(has(tree, 'watch-set-up')).toBe(true);
    expect(allText(tree)).toMatch(/set up watch/i);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('the "Set up watch" CTA wears the standard ink fill with its onCtaFill label', async () => {
    const { tree } = await renderCard(makeDeps());
    const cta = byLabel(tree, 'watch-set-up')[0];
    const s = flattenStyle(cta);
    expect(CTA_FILLS).toContain(s.backgroundColor);
    expect(GLOW_INKS).not.toContain(s.backgroundColor);
    const label = flattenStyle(firstText(cta));
    expect(CTA_LABELS).toContain(label.color);
    expect(ON_ACCENTS).not.toContain(label.color);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  // END-TO-END haptic wiring. Nothing is stubbed between this tap and the native module: the
  // card takes the real `fireHaptic` default (no triggerHaptic prop), fireHaptic does its real
  // lazy require, and the assertion lands on the NATIVE trigger. Before jest.setup.js stubbed
  // that module the whole chain was dead in every test in the suite and nothing said so, because
  // fireHaptic swallows its own failure by design.
  it('the set-up tap drives the real fireHaptic through to the native trigger', async () => {
    const nativeTrigger = (jest.requireMock('react-native-haptic-feedback') as { trigger: jest.Mock }).trigger;
    nativeTrigger.mockClear();
    const { tree } = await renderCard(makeDeps());
    await ReactTestRenderer.act(async () => { byLabel(tree, 'watch-set-up')[0].props.onPress(); });
    await flush();
    expect(nativeTrigger).toHaveBeenCalledWith(haptics.selection);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('code_shown: renders the code grouped, with an expiry line + Cancel and NO Copy button', async () => {
    const { tree, store } = await renderCard(makeDeps());
    await ReactTestRenderer.act(async () => { await store.getState().setUp(); });
    await flush();
    const shown = allText(tree);
    expect(shown).toContain('123 456');            // grouped 6-digit code
    expect(shown).toMatch(/one-time use/i);        // single-use messaging
    expect(shown).toMatch(/expires in/i);          // countdown
    expect(has(tree, 'watch-cancel')).toBe(true);
    expect(has(tree, 'watch-copy')).toBe(false); // NO clipboard affordance
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('code_shown: the code a11y label spells the digits and lives in a polite live region', async () => {
    const { tree, store } = await renderCard(makeDeps());
    await ReactTestRenderer.act(async () => { await store.getState().setUp(); });
    await flush();
    const codeNode = tree.root.findAll((n) => typeof n.props.accessibilityLabel === 'string' && /pairing code/i.test(n.props.accessibilityLabel))[0];
    expect(codeNode).toBeTruthy();
    expect(codeNode.props.accessibilityLabel).toContain('1 2 3 4 5 6'); // spelled, not "one hundred..."
    const live = tree.root.findAll((n) => n.props.accessibilityLiveRegion === 'polite');
    expect(live.length).toBeGreaterThan(0);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('Cancel clears the shown code back to not-set-up', async () => {
    const { tree, store } = await renderCard(makeDeps());
    await ReactTestRenderer.act(async () => { await store.getState().setUp(); });
    await flush();
    await ReactTestRenderer.act(async () => { byLabel(tree, 'watch-cancel')[0].props.onPress(); });
    await flush();
    expect(store.getState().phase).toBe('not_connected');
    expect(has(tree, 'watch-set-up')).toBe(true);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('connected: shows last-seen + Re-pair + Disconnect (neutral), no code', async () => {
    const { tree, store } = await renderCard(makeDeps({
      fetchStatus: jest.fn().mockResolvedValue({ ok: true, data: { connected: true, lastSeenAt: new Date().toISOString() } }),
    }));
    expect(store.getState().phase).toBe('connected');
    expect(allText(tree)).toMatch(/connected/i);
    expect(has(tree, 'watch-repair')).toBe(true);
    expect(has(tree, 'watch-disconnect')).toBe(true);
    await ReactTestRenderer.act(async () => { await byLabel(tree, 'watch-disconnect')[0].props.onPress(); });
    await flush();
    expect(store.getState().phase).toBe('not_connected');
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('NEVER renders a whr_ token in any state — even if the mint payload leaks one', async () => {
    // ADVERSARIAL: the mint carries an extra whr_ device-token field alongside the pairing code.
    // The card must render/announce only the 6-digit code + expiry — never the token.
    const LEAK = 'whr_LEAKED_must_never_render';
    const { tree, store } = await renderCard(makeDeps({
      requestPairing: jest.fn().mockResolvedValue({ ok: true, data: { ...CODE, token: LEAK, deviceToken: LEAK } }),
      fetchStatus: jest.fn().mockResolvedValue({ ok: true, data: { connected: true, lastSeenAt: null, token: LEAK } }),
    }));
    await ReactTestRenderer.act(async () => { await store.getState().setUp(); });
    await flush();
    // Scan both rendered text AND every accessibilityLabel for the token prefix.
    const labels = tree.root.findAll((n) => typeof n.props.accessibilityLabel === 'string').map((n) => n.props.accessibilityLabel).join(' ');
    expect(`${allText(tree)} ${labels}`).not.toContain('whr_');
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });
});
