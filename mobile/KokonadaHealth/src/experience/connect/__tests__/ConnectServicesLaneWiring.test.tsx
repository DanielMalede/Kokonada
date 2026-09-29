import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// H2-7 — the PRODUCTION binding of the Connect screen (its default controller, no `controller`
// prop): a Health Connect link made here must tell the health lane, and the mood-only escape must
// not. The other Connect suites inject their own controller, so they never exercise this binding.
// Only leaf I/O is faked (availability, the consent endpoints, the OS sheet, the sync); the
// controller, the consent store and the screen are real. The lane trigger is a recorder: the
// lane's own behaviour is proven in health/__tests__/healthLane*.test.ts.

jest.mock('../../../health/healthConnect', () => ({
  checkAvailability: jest.fn(async () => 'available'),
  requestHealthPermissions: jest.fn(async () => [{ recordType: 'HeartRate', accessType: 'read' }]),
  openHealthConnectInStore: jest.fn(),
  openHealthConnectSettings: jest.fn(),
}));
jest.mock('../../../health/consentApi', () => ({
  fetchConsentStatus: jest.fn(async () => ({ ok: true, data: { granted: true, currentVersion: 1, staleVersion: false } })),
  grantConsent: jest.fn(),
  CONSENT_DATA_CATEGORIES: [],
  HEALTH_CONNECT_DATA_CATEGORIES: [],
  GARMIN_ONLY_DATA_CATEGORIES: [],
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
import { onWearableLinked } from '../../../health/healthLaneServices';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const byLabel = (tree: ReactTestRenderer.ReactTestRenderer, label: string) =>
  tree.root.findAll((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function');
const flush = async () => { await ReactTestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); }); };

// Unmounted in afterEach, never inline: a failing assertion must not leave the screen's breathing
// header animation running (it keeps the jest process alive).
let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

async function render() {
  const connect = createConnectStore(undefined, () => 'u1');
  await ReactTestRenderer.act(async () => {
    mounted = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <ConnectServicesScreen connect={connect} loadIntegrations={async () => null} />
      </SafeAreaProvider>,
    );
  });
  await flush();
  return { tree: mounted!, connect };
}

const press = async (tree: ReactTestRenderer.ReactTestRenderer, label: string) => {
  const node = byLabel(tree, label)[0];
  if (!node) throw new Error(`no pressable carrying accessibilityLabel "${label}"`);
  await ReactTestRenderer.act(async () => { await node.props.onPress(); });
  await flush();
};

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(async () => {
  alertSpy.mockRestore();
  const tree = mounted;
  mounted = null;
  if (tree) await ReactTestRenderer.act(async () => { tree.unmount(); });
});

describe('ConnectServicesScreen — the production binding tells the health lane about a new link (H2)', () => {
  it('a Health Connect link through the default controller notifies the lane exactly once', async () => {
    const { tree } = await render();
    await press(tree, 'connect-wearable');
    expect(requestHealthPermissions).toHaveBeenCalledTimes(1);
    expect(onWearableLinked).toHaveBeenCalledTimes(1);
  });

  it('the mood-only escape never reaches the lane', async () => {
    const { tree, connect } = await render();
    await press(tree, 'continue-mood-only');
    expect(connect.getState().moodOnly).toBe(true);
    expect(onWearableLinked).not.toHaveBeenCalled();
  });
});
