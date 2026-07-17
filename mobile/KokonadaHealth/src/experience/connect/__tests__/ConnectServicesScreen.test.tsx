import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ConnectServicesScreen } from '../ConnectServicesScreen';
import { createConnectStore, resolvedKey, moodOnlyKey } from '../connectStore';

// Production wraps the app in a SafeAreaProvider; supply one (zero insets) so the safe-area
// chrome reads its insets in the headless renderer.
const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

// §4 Connect Services shell (T3). Registry-driven cards: Music (Spotify halted, YouTube
// deferred — both action-less, honest) and Wearable/Health (the one live Connect CTA). The
// mood-only escape is always one tap away. Screen-level state (subtitle + bottom bar) is
// driven purely by the injected connect store; the body layout stays stable.

jest.setTimeout(20000);

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
  return { tree, connect };
}

describe('ConnectServicesScreen — shell, honest provider rows, screen-level states', () => {
  it('renders the wordmark, title and the default (none-connected) subtitle', async () => {
    const { tree } = await render();
    const t = allText(tree);
    expect(t).toContain('KOKONADA');
    expect(t).toContain('Set up your sound.');
    expect(t).toContain('Connect what you have');
    await ReactTestRenderer.act(async () => { tree.unmount(); });
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
    await ReactTestRenderer.act(async () => { tree.unmount(); });
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
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('a pre-existing Spotify connection (from /api/integrations/status) shows "Connected" honestly', async () => {
    const { tree } = await render({ loadIntegrations: async () => ({ spotifyConnected: true }) });
    const row = byTestId(tree, 'provider-row-spotify')[0];
    expect(row.props.accessibilityLabel).toContain('Connected');
    // Still no NEW connect action offered for a halted provider.
    expect(byLabel(tree, 'connect-spotify')).toHaveLength(0);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('the Wearable & Health card presents the one live "Connect a wearable" CTA', async () => {
    const { tree } = await render();
    expect(allText(tree)).toContain('Wearable & Health');
    const cta = byLabel(tree, 'connect-wearable');
    expect(cta.length).toBeGreaterThan(0);
    expect(cta[0].props.accessibilityRole).toBe('button');
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('the mood-only escape is pinned and always present (never a hard gate)', async () => {
    const { tree } = await render();
    const bar = byLabel(tree, 'continue-mood-only');
    expect(bar.length).toBeGreaterThan(0);
    expect(allText(tree)).toContain('Continue with mood only');
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('screen-level state: a mood-only account sees the mood-only subtitle + a filled "Continue"', async () => {
    const connect = createConnectStore(undefined, () => 'u1');
    connect.getState().setMoodOnly();
    const { tree } = await render({ connect });
    const t = allText(tree);
    expect(t).toContain('mood-only mode');
    expect(t).toContain('Continue');
    expect(t).not.toContain('Continue with mood only'); // no re-nag once chosen
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('screen-level state: a wearable-connected account sees the "all set" subtitle + filled "Continue"', async () => {
    const connect = createConnectStore(undefined, () => 'u1');
    connect.getState().markResolved(); // resolved via wearable, NOT mood-only
    const { tree } = await render({ connect });
    const t = allText(tree);
    expect(t).toContain("Your wearable's connected. You're all set.");
    expect(t).not.toContain('Continue with mood only');
    await ReactTestRenderer.act(async () => { tree.unmount(); });
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
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('color is never the sole signal — every provider state carries a status word', async () => {
    const { tree } = await render();
    const t = allText(tree);
    expect(t).toContain('Unavailable'); // halted word
    expect(t).toContain('Not yet available'); // deferred word
    await ReactTestRenderer.act(async () => { tree.unmount(); });
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
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });
});
