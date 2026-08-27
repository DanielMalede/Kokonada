import React from 'react';
import * as RN from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ConnectServicesScreen } from '../ConnectServicesScreen';
import { createConnectStore, resolvedKey, moodOnlyKey } from '../connectStore';
import { colors, type ThemeName } from '../../../design/tokens';
import { contrastRatio, AA_NORMAL } from '../../../design/contrast';

// Production wraps the app in a SafeAreaProvider; supply one (zero insets) so the safe-area
// chrome reads its insets in the headless renderer.
const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

// §4 Connect Services shell (T3). Registry-driven cards: Music (Spotify halted, YouTube
// deferred — both action-less, honest) and Wearable/Health (the one live Connect CTA). The
// mood-only escape is always one tap away. Screen-level state (subtitle + bottom bar) is
// driven purely by the injected connect store; the body layout stays stable.

jest.setTimeout(20000);

// The standard primary CTA wears the INK fill (accent.ctaFill + content.onCtaFill), NOT the aurora
// violet. POSITIVE colour claims are pinned per FACE (see the describe.each below); only the
// NEGATIVE sets stay theme-spanning, because excluding a hue in BOTH faces is strictly stronger
// than excluding it in one. glowInk/onAccent stay live tokens (they feed the Generate hero's
// gradient), so their ABSENCE from a standard CTA has to be asserted, never inferred.
const GLOW_INKS = [colors.light.accent.glowInk, colors.dark.accent.glowInk];
const ON_ACCENTS = [colors.light.content.onAccent, colors.dark.content.onAccent];
const FACES: ThemeName[] = ['light', 'dark'];
// Forcing the face, correctly. jest.spyOn CANNOT do it here: @react-native/jest-preset already
// installs react-native's useColorScheme as a jest.fn(() => 'light'), and jest-mock's spyOn returns
// an EXISTING mock untouched WITHOUT registering a restore (jest-mock/build/index.js — the whole
// spy branch is guarded by `if (!this.isMockFunction(original))`). So mockReturnValue mutates the
// preset's shared mock permanently and jest.restoreAllMocks() is a no-op against it, leaking the
// last face into every later test in the file. Capture the preset's own implementation and put it
// back by hand.
const colorSchemeMock = RN.useColorScheme as unknown as jest.Mock;
const PRESET_COLOR_SCHEME = colorSchemeMock.getMockImplementation();
const forceFace = (scheme: ThemeName) => colorSchemeMock.mockImplementation(() => scheme);
const releaseFace = () => colorSchemeMock.mockImplementation(PRESET_COLOR_SCHEME);

function flatStyle(node: any): Record<string, any> {
  const s = node?.props?.style;
  return Array.isArray(s) ? Object.assign({}, ...s.flat(Infinity).filter(Boolean)) : (s ?? {});
}

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
const byTestId = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((n) => n.props.testID === id);

// Teardown discipline, per FILE rather than per call site. A failed assertion aborts the test body,
// so a trailing tree.unmount() never runs — and a leaked tree keeps its Animated work running into
// the NEXT test's window, failing that one too and hiding the real cause behind a cascade. Every
// render registers here and is swept unconditionally, pass or fail.
const mounted: ReactTestRenderer.ReactTestRenderer[] = [];
afterEach(async () => {
  for (const t of mounted.splice(0)) await ReactTestRenderer.act(async () => { t.unmount(); });
});

async function render(props: Partial<React.ComponentProps<typeof ConnectServicesScreen>> = {}) {
  const connect = props.connect ?? createConnectStore(undefined, () => 'u1');
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <ConnectServicesScreen loadIntegrations={async () => null} {...props} connect={connect} />
      </SafeAreaProvider>,
    );
  });
  await ReactTestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); });
  mounted.push(tree);
  return { tree, connect };
}

describe('ConnectServicesScreen — shell, honest provider rows, screen-level states', () => {
  it('renders the wordmark, title and the default (none-connected) subtitle', async () => {
    const { tree } = await render();
    const t = allText(tree);
    expect(t).toContain('KOKONADA');
    expect(t).toContain('Set up your sound.');
    expect(t).toContain('Connect what you have');
  });

  it('the Spotify row is HALTED — "Unavailable" + honest reason, and offers NO connect action', async () => {
    const { tree } = await render();
    const t = allText(tree);
    expect(t).toContain('Spotify');
    expect(t).toContain('Unavailable');
    expect(t).toContain("Connecting Spotify isn't available in Kokonada right now.");
    // No live OAuth connect for a halted provider.
    expect(byLabel(tree, 'connect-spotify')).toHaveLength(0);
    // Composed, disabled a11y group.
    const row = byTestId(tree, 'provider-row-spotify')[0];
    expect(row.props.accessibilityState).toEqual({ disabled: true });
    expect(row.props.accessibilityLabel).toBe("Spotify. Unavailable. Connecting Spotify isn't available in Kokonada right now.");
  });

  it('the YouTube Music row is DEFERRED — "Not yet available" + Google-review reason, no connect action', async () => {
    const { tree } = await render();
    const t = allText(tree);
    expect(t).toContain('YouTube Music');
    expect(t).toContain('Not yet available');
    expect(t).toContain('Coming once our Google review is complete.');
    expect(byLabel(tree, 'connect-youtube')).toHaveLength(0);
    const row = byTestId(tree, 'provider-row-youtube')[0];
    expect(row.props.accessibilityState).toEqual({ disabled: true });
  });

  it('a pre-existing Spotify connection (from /api/integrations/status) shows "Connected" honestly', async () => {
    const { tree } = await render({ loadIntegrations: async () => ({ spotifyConnected: true }) });
    const row = byTestId(tree, 'provider-row-spotify')[0];
    expect(row.props.accessibilityLabel).toContain('Connected');
    // Still no NEW connect action offered for a halted provider.
    expect(byLabel(tree, 'connect-spotify')).toHaveLength(0);
  });

  it('the Wearable & Health card presents the one live "Connect a wearable" CTA', async () => {
    const { tree } = await render();
    expect(allText(tree)).toContain('Wearable & Health');
    const cta = byLabel(tree, 'connect-wearable');
    expect(cta.length).toBeGreaterThan(0);
    expect(cta[0].props.accessibilityRole).toBe('button');
  });

  // ── FACE-FORCED colour pins ──────────────────────────────────────────────────────────────────
  // @react-native/jest-preset REPLACES react-native's useColorScheme with jest.fn(() => 'light'),
  // so an unforced render always resolves the LIGHT face — the shipping DARK face was never
  // rendered here at all. Asserting set-membership across a union of both faces therefore waved a
  // CROSS-FACE pairing through: hard-coding one face's ctaFill under the other face's label
  // measures ~1.08:1 (an invisible control) with every assertion still green. Forcing the scheme
  // runs the REAL useTheme → resolveScheme path in BOTH faces, pins each value EXACTLY, and
  // measures the rendered pair, so the class dies whichever call site is edited next.
  describe.each(FACES)('the one live wearable CTA, rendered on the %s face', (scheme) => {
    const C = colors[scheme];
    beforeEach(() => { forceFace(scheme); });
    afterEach(() => { releaseFace(); });

    it('is THIS face’s ink fill under THIS face’s onCtaFill label, never the aurora violet', async () => {
      const { tree } = await render();
      const cta = flatStyle(byLabel(tree, 'connect-wearable')[0]);
      const label = flatStyle(tree.root.findAll((n) => n.props.children === 'Connect a wearable')[0]);
      expect(cta.backgroundColor).toBe(C.accent.ctaFill);
      expect(label.color).toBe(C.content.onCtaFill);
      expect(contrastRatio(label.color, cta.backgroundColor)).toBeGreaterThanOrEqual(AA_NORMAL);
      expect(GLOW_INKS).not.toContain(cta.backgroundColor);
      expect(ON_ACCENTS).not.toContain(label.color);
    });
  });

  it('the mood-only escape is pinned and always present (never a hard gate)', async () => {
    const { tree } = await render();
    const bar = byLabel(tree, 'continue-mood-only');
    expect(bar.length).toBeGreaterThan(0);
    expect(allText(tree)).toContain('Continue with mood only');
  });

  it('screen-level state: a mood-only account sees the mood-only subtitle + a filled "Continue"', async () => {
    const connect = createConnectStore(undefined, () => 'u1');
    connect.getState().setMoodOnly();
    const { tree } = await render({ connect });
    const t = allText(tree);
    expect(t).toContain('mood-only mode');
    expect(t).toContain('Continue');
    expect(t).not.toContain('Continue with mood only'); // no re-nag once chosen
  });

  it('screen-level state: a wearable-connected account sees the "all set" subtitle + filled "Continue"', async () => {
    const connect = createConnectStore(undefined, () => 'u1');
    connect.getState().markResolved(); // resolved via wearable, NOT mood-only
    const { tree } = await render({ connect });
    const t = allText(tree);
    expect(t).toContain("Your wearable's connected. You're all set.");
    expect(t).not.toContain('Continue with mood only');
  });

  it('each card carries a collapsed "why we ask" disclosure (Privacy-Vault tone, explain before asking)', async () => {
    const { tree } = await render();
    const musicWhy = tree.root.findAll((n) => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === 'Why connect music?');
    const healthWhy = tree.root.findAll((n) => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === 'Why we ask for health data');
    expect(musicWhy.length).toBeGreaterThan(0);
    expect(healthWhy.length).toBeGreaterThan(0);
    // Collapsed by default — the reason bodies are not read until asked for.
    expect(musicWhy[0].props.accessibilityState).toEqual({ expanded: false });
    expect(allText(tree)).not.toContain('never post, never your social graph');
  });

  it('color is never the sole signal — every provider state carries a status word', async () => {
    const { tree } = await render();
    const t = allText(tree);
    expect(t).toContain('Unavailable'); // halted word
    expect(t).toContain('Not yet available'); // deferred word
  });
});

describe('ConnectServicesScreen — mood-only path (T5)', () => {
  interface FakeKV { getString(k: string): string | undefined; set(k: string, v: string): void; __map: Map<string, string>; }
  const makeKV = (): FakeKV => { const m = new Map<string, string>(); return { __map: m, getString: (k) => m.get(k), set: (k, v) => { m.set(k, v); } }; };

  it('tapping "Continue with mood only" persists moodOnly+resolved, fires a commit haptic, and is idempotent', async () => {
    const kv = makeKV();
    const connect = createConnectStore(kv, () => 'u1');
    const triggerHaptic = jest.fn();
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <SafeAreaProvider initialMetrics={METRICS}>
          <ConnectServicesScreen connect={connect} loadIntegrations={async () => null} triggerHaptic={triggerHaptic} />
        </SafeAreaProvider>,
      );
    });
    // This test mounts its OWN tree (it needs a per-test KV + haptic spy), so it must register with
    // the file sweep by hand — an unregistered tree is never unmounted at all, and jest then cannot
    // exit: --detectOpenHandles hangs on the live SafeAreaProvider/screen timers it left behind.
    mounted.push(tree);
    await ReactTestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); });

    await ReactTestRenderer.act(async () => { byLabel(tree, 'continue-mood-only')[0].props.onPress(); });

    // Forward gate satisfied via mood-only, persisted per-uid, and a single commit haptic fired.
    expect(connect.getState().moodOnly).toBe(true);
    expect(connect.getState().resolved).toBe(true);
    expect(kv.__map.get(moodOnlyKey('u1'))).toBe('1');
    expect(kv.__map.get(resolvedKey('u1'))).toBe('1');
    expect(triggerHaptic).toHaveBeenCalledWith('commit');

    // The bar has swapped to the filled "Continue" — no re-nag. Tapping forward stays a no-op-safe path.
    expect(byLabel(tree, 'continue-mood-only')).toHaveLength(0);
    const forward = byLabel(tree, 'continue-forward');
    expect(forward.length).toBeGreaterThan(0);
    await ReactTestRenderer.act(async () => { forward[0].props.onPress(); });
    expect(connect.getState().resolved).toBe(true); // idempotent — still resolved, nothing regressed
  });
});
