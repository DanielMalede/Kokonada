import React from 'react';
import { Alert, I18nManager } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.setTimeout(20000); // cold-require headroom for CI (same rationale as ProfileScreen.test.tsx, #84)

// MB-062 (REG-034; DEC-117's O2 condition) through Profile's "Sync now", the second place a consent
// grant is given. The screen, its controller, the consent store, the consent sheet, the consent
// client and grantProvenance are real; only leaf I/O is faked — the HTTP layer (a stateful stand-in
// for the consent endpoints that records what it is sent), the OS Health Connect sheet, availability,
// the sync, the profile load and the lane triggers.

const mockServer = { granted: false, posts: [] as Array<{ route: string; body: any }> };
jest.mock('../../../net/apiClient', () => {
  const statusOf = () => ({ granted: mockServer.granted, currentVersion: 1, staleVersion: false });
  return {
    apiGet: jest.fn(async (route: string) =>
      route.startsWith('/api/consent/status') ? { ok: true, data: statusOf() } : { ok: false, status: 404, error: 'not faked' }),
    apiPost: jest.fn(async (route: string, body: any) => {
      mockServer.posts.push({ route, body });
      if (route !== '/api/consent') return { ok: false, status: 404, error: 'not faked' };
      mockServer.granted = true;
      return { ok: true, data: statusOf() };
    }),
    apiDelete: jest.fn(async () => ({ ok: false, status: 404, error: 'not faked' })),
  };
});
jest.mock('../profileServices', () => ({
  profileController: {
    loadProfile: jest.fn(async () => ({
      me: { id: 'u1', displayName: 'Dan Malede', email: 'd@x.io', wearableProvider: null },
      integrations: { spotifyConnected: false },
    })),
    logout: jest.fn(async () => undefined),
    deleteAccount: jest.fn(async () => ({ ok: true, data: {} })),
    disconnectYouTube: jest.fn(),
    getSpotifyConnectToken: jest.fn(),
  },
}));
jest.mock('../../../health/healthConnect', () => ({
  checkAvailability: jest.fn(async () => 'available'),
  requestHealthPermissions: jest.fn(async () => [{ recordType: 'HeartRate', accessType: 'read' }]),
  openHealthConnectSettings: jest.fn(),
  openHealthConnectInStore: jest.fn(),
}));
jest.mock('../../../health/healthSync', () => ({ syncMedicalProfile: jest.fn(async () => ({ synced: false, reason: 'no-data' })) }));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = require('react');
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { cb(); }, []);
  },
}));
jest.mock('../../../health/watchPairingClient', () => ({
  fetchWatchStatus: jest.fn(async () => ({ ok: true, data: { connected: false, lastSeenAt: null } })),
  revokeWatchPairing: jest.fn(async () => ({ ok: true, data: { message: 'ok' } })),
}));
jest.mock('../../../health/healthLaneServices', () => ({
  onWearableLinked: jest.fn(async () => true),
  onConsentWithdrawn: jest.fn(async () => {}),
  onLiveHrDisconnected: jest.fn(async () => {}),
}));

import { ProfileScreen } from '../ProfileScreen';
import { requestHealthPermissions } from '../../../health/healthConnect';
import { APP_VERSION } from '../../../appVersion';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const flush = async () => { await ReactTestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); }); };
const pressable = (tree: ReactTestRenderer.ReactTestRenderer, pick: (p: any) => boolean) =>
  tree.root.findAll((n) => pick(n.props) && typeof n.props.onPress === 'function')[0];

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;
let alertSpy: jest.SpyInstance;
beforeEach(() => {
  mockServer.granted = false;
  mockServer.posts = [];
  jest.clearAllMocks();
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(async () => {
  alertSpy.mockRestore();
  jest.restoreAllMocks();
  const t = mounted;
  mounted = null;
  if (t) await ReactTestRenderer.act(async () => { t.unmount(); });
});

describe('Profile — a grant from "Sync now" carries the build and the device’s language setting', () => {
  it('the grant body has appVersion and the device locale as a language tag, and the OS sheet follows', async () => {
    jest.spyOn(I18nManager, 'getConstants').mockReturnValue({ isRTL: false, doLeftAndRightSwapInRTL: true, localeIdentifier: 'en_GB' });
    await ReactTestRenderer.act(async () => {
      mounted = ReactTestRenderer.create(<SafeAreaProvider initialMetrics={METRICS}><ProfileScreen /></SafeAreaProvider>);
    });
    await flush();
    const tree = mounted!;
    await ReactTestRenderer.act(async () => { await pressable(tree, (p) => p.accessibilityLabel === 'sync-health').props.onPress(); });
    await flush();
    await ReactTestRenderer.act(async () => { await pressable(tree, (p) => p.testID === 'consent-agree').props.onPress(); });
    await flush();
    const grants = mockServer.posts.filter((p) => p.route === '/api/consent');
    expect(grants).toHaveLength(1);
    expect(grants[0].body).toEqual(expect.objectContaining({ appVersion: APP_VERSION, locale: 'en', clientVersion: 1 }));
    expect(requestHealthPermissions).toHaveBeenCalledTimes(1);
  });
});
