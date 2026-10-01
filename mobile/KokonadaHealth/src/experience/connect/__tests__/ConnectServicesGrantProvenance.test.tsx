import React from 'react';
import { Alert, I18nManager } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.setTimeout(20000); // cold-require headroom for CI (compile time, not assertion time)

// MB-062 (REG-034; DEC-117's O2 condition) through Connect's PRODUCTION binding (its default
// controller, no `controller` prop): a consent grant given here reaches the server carrying the
// build and the device's language. The screen, controller, consent store, consent sheet, consent
// client and grantProvenance are all real; only leaf I/O is faked — the HTTP layer (a stateful
// stand-in for the consent endpoints that records what it is sent), the OS Health Connect sheet,
// availability, the sync and the lane trigger. The server's side of the same contract is proven over
// real HTTP and Mongo in backend/tests/consentGrantBuildLocale.integration.test.js.

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
jest.mock('../../../health/healthConnect', () => ({
  checkAvailability: jest.fn(async () => 'available'),
  requestHealthPermissions: jest.fn(async () => [{ recordType: 'HeartRate', accessType: 'read' }]),
  openHealthConnectInStore: jest.fn(),
  openHealthConnectSettings: jest.fn(),
}));
jest.mock('../../../health/healthSync', () => ({
  syncMedicalProfile: jest.fn(async () => ({ synced: false, reason: 'no-data' })),
}));
jest.mock('../../../health/healthLaneServices', () => ({
  onWearableLinked: jest.fn(async () => true),
}));

import { ConnectServicesScreen } from '../ConnectServicesScreen';
import { createConnectStore } from '../connectStore';
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

async function grantThroughConnect() {
  const connect = createConnectStore(undefined, () => 'u1');
  await ReactTestRenderer.act(async () => {
    mounted = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <ConnectServicesScreen connect={connect} loadIntegrations={async () => null} />
      </SafeAreaProvider>,
    );
  });
  await flush();
  const tree = mounted!;
  await ReactTestRenderer.act(async () => { await pressable(tree, (p) => p.accessibilityLabel === 'connect-wearable').props.onPress(); });
  await flush();
  await ReactTestRenderer.act(async () => { await pressable(tree, (p) => p.testID === 'consent-agree').props.onPress(); });
  await flush();
  return mockServer.posts.filter((p) => p.route === '/api/consent');
}

describe('Connect — a grant carries the build and the device’s language setting', () => {
  it('the grant body has appVersion and the device locale as a language tag, and the flow completes', async () => {
    jest.spyOn(I18nManager, 'getConstants').mockReturnValue({ isRTL: false, doLeftAndRightSwapInRTL: true, localeIdentifier: 'he_IL' });
    const grants = await grantThroughConnect();
    expect(grants).toHaveLength(1);
    expect(grants[0].body).toEqual(expect.objectContaining({ appVersion: APP_VERSION, locale: 'he', clientVersion: 1 }));
    expect(requestHealthPermissions).toHaveBeenCalledTimes(1); // the OS sheet follows the acked grant, as before
  });

  it('a device that reports no locale still grants, with the build and no locale key', async () => {
    jest.spyOn(I18nManager, 'getConstants').mockReturnValue({ isRTL: false, doLeftAndRightSwapInRTL: true, localeIdentifier: undefined });
    const grants = await grantThroughConnect();
    expect(grants).toHaveLength(1);
    expect(grants[0].body.appVersion).toBe(APP_VERSION);
    expect('locale' in grants[0].body).toBe(false);
  });
});
