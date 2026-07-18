import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

// CI-starvation headroom (issue #84). The first create(<ProfileScreen/>) in this file pays the
// one-time cold-require cost of the whole ProfileScreen module tree inside the jest worker. On
// resource-constrained CI runners (≈4 cores, many suites per worker) that first async-render
// act() flush occasionally exceeds jest's 5000 ms default; a timed-out act() then leaves
// react-test-renderer unable to commit, cascading the remaining tests to empty-render failures
// (reproduced exactly with --testTimeout=1). There is NO product race — the screen shows a '—'
// placeholder until loadProfile() resolves (correct async load). PR #97 fixed flush *ordering*;
// this gives the tail adequate wall-clock so starvation can't trip the default ceiling.
jest.setTimeout(20000);

jest.mock('../profileServices', () => ({
  profileController: {
    loadProfile: jest.fn(),
    logout: jest.fn().mockResolvedValue(undefined),
    deleteAccount: jest.fn().mockResolvedValue({ ok: true, data: {} }),
    disconnectYouTube: jest.fn().mockResolvedValue({ ok: true, data: { rebuilt: true, provider: 'spotify', library: 240 } }),
    getSpotifyConnectToken: jest.fn(),
  },
}));

// WS-5 (Art.9 consent) native + network seams. The real consentStore/ConsentSheet run against
// these fakes so the ProfileScreen gate wiring is tested against real component behaviour.
// Faithful to the REAL consentApi exports (audit correction): CONSENT_DATA_CATEGORIES is the
// UNION across every wearable lane (HC + Garmin), and HEALTH_CONNECT_DATA_CATEGORIES is the
// on-device read set the Vault panel mirrors. The old mock listed an invented/stale set
// (spo2/respiratory/background_access as if they were the HC set) — corrected here to source truth.
jest.mock('../../../health/consentApi', () => ({
  fetchConsentStatus: jest.fn(),
  grantConsent: jest.fn(),
  withdrawConsent: jest.fn(),
  CONSENT_PURPOSE: 'health_biometric_processing',
  HEALTH_CONNECT_DATA_CATEGORIES: ['heart_rate', 'hrv', 'sleep', 'resting_heart_rate', 'historical_access_182d'],
  CONSENT_DATA_CATEGORIES: ['heart_rate', 'hrv', 'sleep', 'resting_heart_rate', 'historical_access_182d', 'spo2', 'respiratory_rate', 'body_battery'],
}));
jest.mock('../../../health/healthConnect', () => ({
  requestHealthPermissions: jest.fn(),
  openHealthConnectSettings: jest.fn(),
  openHealthConnectInStore: jest.fn(),
  checkAvailability: jest.fn(),
}));
jest.mock('../../../health/healthSync', () => ({ syncMedicalProfile: jest.fn() }));

// useFocusEffect needs a navigation context; mock it to run the effect on mount and expose the
// callback so a test can simulate returning to the tab (re-focus → re-fetch profile/consent/watch).
let mockFocusCb: null | (() => void) = null;
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = require('react');
    mockFocusCb = cb;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { cb(); }, []); // run once on mount, mimicking a first focus
  },
}));
// The §10 watch pairing seam — mocked so the WatchPairingCard's mount hydrate never touches the
// network. The card/store are proven end-to-end in their own suites; here they just stay quiet.
jest.mock('../../../health/watchPairingClient', () => ({
  requestWatchPairing: jest.fn().mockResolvedValue({ ok: true, data: { code: '123456', expiresAt: new Date(Date.now() + 300000).toISOString() } }),
  fetchWatchStatus: jest.fn().mockResolvedValue({ ok: true, data: { connected: false, lastSeenAt: null } }),
  revokeWatchPairing: jest.fn().mockResolvedValue({ ok: true, data: { message: 'ok' } }),
}));

import { Linking, Alert, AccessibilityInfo } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ProfileScreen } from '../ProfileScreen';
import { profileController } from '../profileServices';
import { playerStatusStore } from '../../player/playerStatusStore';
import { warmStore } from '../../../state/store';
import { fetchConsentStatus, grantConsent, withdrawConsent } from '../../../health/consentApi';
import { requestHealthPermissions, checkAvailability } from '../../../health/healthConnect';
import { syncMedicalProfile } from '../../../health/healthSync';

const loadProfile = profileController.loadProfile as jest.Mock;
const logout = profileController.logout as jest.Mock;
const deleteAccount = profileController.deleteAccount as jest.Mock;
const disconnectYouTube = profileController.disconnectYouTube as jest.Mock;

function texts(node: any, acc: string[] = []): string[] {
  if (node == null) return acc;
  if (typeof node === 'string') { acc.push(node); return acc; }
  if (Array.isArray(node)) { node.forEach((n) => texts(n, acc)); return acc; }
  if (node.children) texts(node.children, acc);
  return acc;
}

// The screen reads safe-area insets (parity with §4/§5); provide zero-inset metrics like the
// ConnectServices suite so a headless render never needs the app shell's real provider.
const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

async function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={METRICS}><ProfileScreen /></SafeAreaProvider>,
    );
  });
  // Flush the mount effect's async loadProfile().then(setSnap) chain deterministically.
  // A single act() around create() does NOT reliably drain a resolved-promise → setSnap →
  // re-render chain, which intermittently failed the auth-critical "identity from /me"
  // assertion in CI (issue #84). A setImmediate macrotask boundary empties the ENTIRE
  // microtask queue first (the resolved promise, its .then, and React's scheduled update),
  // and the surrounding act() commits the result — deterministic across Node/scheduler timing.
  await ReactTestRenderer.act(async () => { await new Promise((resolve) => setImmediate(resolve)); });
  return tree;
}

const flush = async () => { await ReactTestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); }); };
const status = (over: Record<string, unknown> = {}) => ({ ok: true, data: { granted: false, currentVersion: 1, staleVersion: false, ...over } });

beforeEach(() => {
  jest.clearAllMocks();
  loadProfile.mockResolvedValue({
    me: { id: 'u1', displayName: 'Dan Malede', email: 'd@x.io', wearableProvider: null },
    integrations: { spotifyConnected: false },
  });
  (fetchConsentStatus as jest.Mock).mockResolvedValue(status());
  (grantConsent as jest.Mock).mockResolvedValue(status({ granted: true }));
  (withdrawConsent as jest.Mock).mockResolvedValue(status({ granted: false }));
  (checkAvailability as jest.Mock).mockResolvedValue('available');
  (requestHealthPermissions as jest.Mock).mockResolvedValue([]);
  (syncMedicalProfile as jest.Mock).mockResolvedValue({ synced: false, reason: 'no-data' });
});

describe('ProfileScreen', () => {
  it('renders the identity from /me', async () => {
    const tree = await render();
    const all = texts(tree.toJSON()).join(' ');
    expect(all).toContain('Dan Malede');
    expect(all).toContain('d@x.io');
    expect(all).toContain('Log out');
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('reflects a live Spotify connection from the player status store', async () => {
    await ReactTestRenderer.act(async () => { playerStatusStore.getState().set('connected'); });
    const tree = await render();
    const all = texts(tree.toJSON()).join(' ');
    expect(all).toContain('Connected');
    await ReactTestRenderer.act(async () => { tree.unmount(); });
    await ReactTestRenderer.act(async () => { playerStatusStore.getState().set('disconnected'); });
  });

  it('unsubscribes from every store on unmount (parity)', async () => {
    let subs = 0; let unsubs = 0;
    const realPlayer = playerStatusStore.subscribe.bind(playerStatusStore);
    const realWarm = warmStore.subscribe.bind(warmStore);
    const p = jest.spyOn(playerStatusStore, 'subscribe').mockImplementation((cb: any) => { subs++; const u = realPlayer(cb); return () => { unsubs++; u(); }; });
    const w = jest.spyOn(warmStore, 'subscribe').mockImplementation((cb: any) => { subs++; const u = realWarm(cb); return () => { unsubs++; u(); }; });
    const tree = await render();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
    p.mockRestore(); w.mockRestore();
    expect(subs).toBeGreaterThan(0);
    expect(unsubs).toBe(subs);
  });

  const byLabel = (tree: ReactTestRenderer.ReactTestRenderer, label: string) =>
    tree.root.findAll((n) => n.props.accessibilityLabel === label)[0];
  // Integration action buttons are selected by a stable testID; their accessibilityLabel is a human
  // phrase that folds in the status word (so screen readers announce "Connected" on these rows).
  const byTestId = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
    tree.root.findAll((n) => n.props.testID === id)[0];

  it('the delete flow requires a confirmation step before calling the server', async () => {
    const tree = await render();
    expect(deleteAccount).not.toHaveBeenCalled();
    // First press only opens the confirm panel — no server call yet.
    await ReactTestRenderer.act(async () => { byLabel(tree, 'delete-account').props.onPress(); });
    expect(deleteAccount).not.toHaveBeenCalled();
    // The explicit confirmation is what actually calls the server.
    await ReactTestRenderer.act(async () => { await byLabel(tree, 'delete-confirm').props.onPress(); });
    expect(deleteAccount).toHaveBeenCalledTimes(1);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('shows a YouTube Disconnect button when connected and routes it through the controller', async () => {
    loadProfile.mockResolvedValue({
      me: { id: 'u1', displayName: 'Dan', email: 'd@x.io', wearableProvider: null },
      integrations: { spotifyConnected: true, youtubeConnected: true },
    });
    const tree = await render();
    expect(texts(tree.toJSON()).join(' ')).toContain('YouTube Music');
    await ReactTestRenderer.act(async () => { await byTestId(tree, 'disconnect-youtube').props.onPress(); });
    expect(disconnectYouTube).toHaveBeenCalledTimes(1);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('hides the YouTube Disconnect action when YouTube is not connected (the row still renders)', async () => {
    const tree = await render(); // beforeEach integrations has no youtubeConnected
    expect(tree.root.findAll((n) => n.props.testID === 'disconnect-youtube')).toHaveLength(0);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('logout routes through the controller', async () => {
    const tree = await render();
    await ReactTestRenderer.act(async () => { await byLabel(tree, 'log-out').props.onPress(); });
    expect(logout).toHaveBeenCalledTimes(1);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('honors the Spotify halt: a NOT-connected user sees NO Connect pill — only the honest "Unavailable" status (§4 registry, D1)', async () => {
    // D1/reconciliation: ProfileScreen used to offer a dead Spotify "Connect" pill that contradicted
    // the §4 registry (Spotify is HALTED — external cap, no known fix). The redesign retires that
    // dead OAuth entirely for a not-connected user; there is no connect-spotify affordance to strand
    // them on. (Reconnect stays reachable for an ALREADY-connected account — see the next test.)
    await ReactTestRenderer.act(async () => { playerStatusStore.getState().set('disconnected'); });
    const tree = await render(); // beforeEach: integrations spotifyConnected:false
    expect(tree.root.findAll((n) => n.props.accessibilityLabel === 'connect-spotify')).toHaveLength(0);
    expect(texts(tree.toJSON()).join(' ')).toContain('Unavailable');
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('reconnect-spotify is offered WHEN already connected and re-launches the same OAuth flow (scope migration)', async () => {
    // A stored token keeps the badge "Connected", but a new scope (playlist-modify-private)
    // only lands on a fresh grant. Without a Reconnect control the user is stranded — the
    // "Connect" button only shows when disconnected. So a Reconnect must always be reachable.
    loadProfile.mockResolvedValue({
      me: { id: 'u1', displayName: 'Dan', email: 'd@x.io', wearableProvider: null },
      integrations: { spotifyConnected: true },
    });
    (profileController.getSpotifyConnectToken as jest.Mock).mockResolvedValue('ct-token');
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as any);

    const tree = await render();
    const btn = byTestId(tree, 'reconnect-spotify');
    expect(btn).toBeTruthy();
    expect(btn.props.accessibilityLabel).toContain('Connected'); // status folded into the button's a11y label
    await ReactTestRenderer.act(async () => { await btn.props.onPress(); });

    expect(openURL).toHaveBeenCalledTimes(1);
    const url = openURL.mock.calls[0][0];
    expect(url).toContain('/api/integrations/spotify/connect?ct=');
    expect(url).toContain('returnTo=app'); // same deep-link-back flow as first connect

    openURL.mockRestore();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  // ── WS-5 (audit H-9): the Art.9 consent gate wiring (T8) ─────────────────────────────────
  const consentNodes = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
    tree.root.findAll((n) => n.props.testID === id && n.parent?.props?.testID !== id);

  it('T8: an already-consented Sync proceeds straight to the OS flow — the wall is never shown', async () => {
    (fetchConsentStatus as jest.Mock).mockResolvedValue(status({ granted: true }));
    (requestHealthPermissions as jest.Mock).mockResolvedValue([{ recordType: 'HeartRate', accessType: 'read' }]);
    (syncMedicalProfile as jest.Mock).mockResolvedValue({ synced: true, counts: { heartRate: 3, hrv: 0, sleep: 0, restingHeartRate: 0 } });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const tree = await render();
    await ReactTestRenderer.act(async () => { await byLabel(tree, 'sync-health').props.onPress(); });
    await flush();
    expect(consentNodes(tree, 'consent-title')).toHaveLength(0); // short-circuit — no wall
    expect(requestHealthPermissions).toHaveBeenCalledTimes(1);
    alertSpy.mockRestore();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('T8: a not-yet-consented Sync shows the wall and does NOT open the OS sheet until consent is granted', async () => {
    (fetchConsentStatus as jest.Mock).mockResolvedValue(status({ granted: false }));
    (grantConsent as jest.Mock).mockResolvedValue(status({ granted: true }));
    (requestHealthPermissions as jest.Mock).mockResolvedValue([{ recordType: 'HeartRate', accessType: 'read' }]);
    (syncMedicalProfile as jest.Mock).mockResolvedValue({ synced: true, counts: { heartRate: 1, hrv: 0, sleep: 0, restingHeartRate: 0 } });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const tree = await render();
    await ReactTestRenderer.act(async () => { await byLabel(tree, 'sync-health').props.onPress(); });
    await flush();
    // The wall is up and the OS permission sheet has NOT been requested.
    expect(consentNodes(tree, 'consent-document').length).toBeGreaterThan(0);
    expect(requestHealthPermissions).not.toHaveBeenCalled();
    // Agree → grant → granted_ack → onProceed → NOW the OS sheet runs.
    const agree = consentNodes(tree, 'consent-agree')[0];
    await ReactTestRenderer.act(async () => { agree.props.onPress(); });
    await flush();
    await flush();
    expect(requestHealthPermissions).toHaveBeenCalledTimes(1);
    alertSpy.mockRestore();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('T8: when Health Connect is unavailable, routes to the install path — no wall, no OS sheet', async () => {
    (checkAvailability as jest.Mock).mockResolvedValue('install-required');
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const tree = await render();
    await ReactTestRenderer.act(async () => { await byLabel(tree, 'sync-health').props.onPress(); });
    await flush();
    expect(consentNodes(tree, 'consent-title')).toHaveLength(0);
    expect(requestHealthPermissions).not.toHaveBeenCalled();
    expect(String(alertSpy.mock.calls[0]?.[0])).toMatch(/health connect/i);
    alertSpy.mockRestore();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  // ── WS-5 (audit H-9): withdrawal UI (T9) ─────────────────────────────────────────────────
  it('T9: offers Withdraw only when consent is granted; a two-step confirm calls the endpoint then reflects ungranted', async () => {
    (fetchConsentStatus as jest.Mock).mockResolvedValue(status({ granted: true }));
    (withdrawConsent as jest.Mock).mockResolvedValue(status({ granted: false }));
    const tree = await render();
    expect(byLabel(tree, 'withdraw-consent')).toBeTruthy();
    expect(withdrawConsent).not.toHaveBeenCalled();
    // First tap only opens the confirm — no server call yet (two-step).
    await ReactTestRenderer.act(async () => { byLabel(tree, 'withdraw-consent').props.onPress(); });
    expect(withdrawConsent).not.toHaveBeenCalled();
    // Confirm actually withdraws.
    await ReactTestRenderer.act(async () => { await byLabel(tree, 'withdraw-confirm').props.onPress(); });
    await flush();
    expect(withdrawConsent).toHaveBeenCalledTimes(1);
    // Local UI now reflects ungranted → the action is gone.
    expect(tree.root.findAll((n) => n.props.accessibilityLabel === 'withdraw-consent')).toHaveLength(0);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('T9: hides the Withdraw action when consent is not granted', async () => {
    const tree = await render(); // beforeEach default: granted:false
    expect(tree.root.findAll((n) => n.props.accessibilityLabel === 'withdraw-consent')).toHaveLength(0);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('T9: the withdraw confirm uses a neutral tone, not the account-deletion danger red', async () => {
    (fetchConsentStatus as jest.Mock).mockResolvedValue(status({ granted: true }));
    const tree = await render();
    await ReactTestRenderer.act(async () => { byLabel(tree, 'withdraw-consent').props.onPress(); });
    const confirm = byLabel(tree, 'withdraw-confirm');
    const s = Array.isArray(confirm.props.style) ? Object.assign({}, ...confirm.props.style.filter(Boolean)) : confirm.props.style;
    expect(s.backgroundColor).not.toBe('#ff5a5a');
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  // ── T7: refresh on tab focus so a change elsewhere (§11 withdrawal) reflects on return ──────────
  it('T7: re-focusing the tab re-fetches consent, so a withdrawal made elsewhere is reflected on return', async () => {
    (fetchConsentStatus as jest.Mock).mockResolvedValue(status({ granted: true }));
    const tree = await render();
    // First focus saw a grant on file → the Withdraw affordance is present.
    expect(tree.root.findAll((n) => n.props.accessibilityLabel === 'withdraw-consent').length).toBeGreaterThan(0);
    // Consent is withdrawn elsewhere; the next status read returns ungranted.
    (fetchConsentStatus as jest.Mock).mockResolvedValue(status({ granted: false }));
    await ReactTestRenderer.act(async () => { mockFocusCb?.(); });
    await flush();
    // Re-focus re-fetched → the local UI reflects ungranted (Withdraw gone), no manual refresh.
    expect(tree.root.findAll((n) => n.props.accessibilityLabel === 'withdraw-consent')).toHaveLength(0);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  // ── T10: reduced-motion polish — the consent Modal drops its slide when reduce-motion is on ─────
  it('T10: under reduced motion, the consent Modal uses animationType "none" (no slide)', async () => {
    const rm = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true as any);
    (fetchConsentStatus as jest.Mock).mockResolvedValue(status({ granted: false }));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const tree = await render();
    await ReactTestRenderer.act(async () => { await byLabel(tree, 'sync-health').props.onPress(); });
    await flush();
    const modal = tree.root.findAll((n) => typeof n.props.onRequestClose === 'function')[0];
    expect(modal.props.animationType).toBe('none');
    rm.mockRestore(); alertSpy.mockRestore();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });
});
