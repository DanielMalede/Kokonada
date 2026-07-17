import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ConnectServicesScreen } from '../ConnectServicesScreen';
import { createConnectStore } from '../connectStore';
import { createConnectController, type ConnectControllerDeps } from '../connectController';
import { createConsentFlow } from '../../../health/consentStore';

// T6 — the wearable path, tested END TO END with the REAL controller + REAL consentStore + REAL
// ConsentSheet against stateful fakes (only the leaf I/O — availability, network, OS sheet, sync —
// is faked). The compliance invariant proven here is the whole point: the OS Health Connect sheet
// (requestHealthPermissions) opens ONLY after the §11 wall confirms a server-acked grant, and every
// off-happy path (decline, background, offline, install-required, unsupported, deny-twice) is
// penalty-free — resolved stays false and the mood-only path is untouched.

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const okStatus = (over: Record<string, unknown> = {}) =>
  ({ ok: true as const, data: { granted: false, currentVersion: 1, staleVersion: false, ...over } });

const consentNodes = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((n) => n.props.testID === id && n.parent?.props?.testID !== id);
const byLabel = (tree: ReactTestRenderer.ReactTestRenderer, label: string) =>
  tree.root.findAll((n) => n.props.accessibilityLabel === label);
const flush = async () => { await ReactTestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); }); };

function makeLeafDeps(over: Partial<ConnectControllerDeps> = {}) {
  return {
    checkAvailability: jest.fn().mockResolvedValue('available'),
    fetchConsentStatus: jest.fn().mockResolvedValue(okStatus()),
    grantConsent: jest.fn().mockResolvedValue(okStatus({ granted: true })),
    requestHealthPermissions: jest.fn().mockResolvedValue([{ recordType: 'HeartRate', accessType: 'read' }]),
    syncMedicalProfile: jest.fn().mockResolvedValue({ synced: true, counts: { heartRate: 3, hrv: 0, sleep: 0, restingHeartRate: 0 } }),
    createConsentFlow, // REAL §11 store — the invariant is delegated, never re-implemented
    ...over,
  };
}

async function renderFlow(over: Partial<ConnectControllerDeps> = {}) {
  const connect = createConnectStore(undefined, () => 'u1');
  const leaf = makeLeafDeps(over);
  const controller = createConnectController({ ...leaf, markResolved: () => connect.getState().markResolved() } as ConnectControllerDeps);
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <ConnectServicesScreen connect={connect} loadIntegrations={async () => null} controller={controller} />
      </SafeAreaProvider>,
    );
  });
  await flush();
  return { tree, connect, leaf };
}
const tapWearable = async (tree: ReactTestRenderer.ReactTestRenderer) => {
  await ReactTestRenderer.act(async () => { await byLabel(tree, 'connect-wearable')[0].props.onPress(); });
  await flush();
};

let alertSpy: jest.SpyInstance;
beforeEach(() => { alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {}); });
afterEach(() => { alertSpy.mockRestore(); });

describe('ConnectServicesScreen — wearable → §11 consent → OS sheet (T6)', () => {
  it('CROWN JEWEL: a not-yet-consented tap shows the wall and does NOT open the OS sheet until consent is granted', async () => {
    const { tree, connect, leaf } = await renderFlow({ fetchConsentStatus: jest.fn().mockResolvedValue(okStatus({ granted: false })) });
    await tapWearable(tree);
    // The §11 wall is up; the OS permission sheet has NOT been requested; the gate is still open.
    expect(consentNodes(tree, 'consent-document').length).toBeGreaterThan(0);
    expect(leaf.requestHealthPermissions).not.toHaveBeenCalled();
    expect(connect.getState().resolved).toBe(false);
    // Agree → grant → granted_ack → onProceed → NOW the OS sheet runs and the gate resolves.
    await ReactTestRenderer.act(async () => { consentNodes(tree, 'consent-agree')[0].props.onPress(); });
    await flush(); await flush(); await flush();
    expect(leaf.requestHealthPermissions).toHaveBeenCalledTimes(1);
    expect(connect.getState().resolved).toBe(true);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('an already-consented tap short-circuits invisibly — no wall, OS sheet + resolve run directly', async () => {
    const { tree, connect, leaf } = await renderFlow({ fetchConsentStatus: jest.fn().mockResolvedValue(okStatus({ granted: true })) });
    await tapWearable(tree);
    expect(consentNodes(tree, 'consent-title')).toHaveLength(0); // no wall
    expect(leaf.requestHealthPermissions).toHaveBeenCalledTimes(1);
    expect(connect.getState().resolved).toBe(true);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('DECLINE is penalty-free — dismisses the wall, never opens the OS sheet, mood-only intact', async () => {
    const { tree, connect, leaf } = await renderFlow({ fetchConsentStatus: jest.fn().mockResolvedValue(okStatus({ granted: false })) });
    await tapWearable(tree);
    await ReactTestRenderer.act(async () => { consentNodes(tree, 'consent-decline')[0].props.onPress(); });
    await flush();
    expect(consentNodes(tree, 'consent-document')).toHaveLength(0); // wall gone
    expect(leaf.requestHealthPermissions).not.toHaveBeenCalled();
    expect(connect.getState().resolved).toBe(false);
    expect(connect.getState().moodOnly).toBe(false);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('BACKGROUND mid-consent (Modal onRequestClose) dismisses the wall with the OS sheet still shut', async () => {
    const { tree, connect, leaf } = await renderFlow({ fetchConsentStatus: jest.fn().mockResolvedValue(okStatus({ granted: false })) });
    await tapWearable(tree);
    const modal = tree.root.findAll((n) => typeof n.props.onRequestClose === 'function')[0];
    await ReactTestRenderer.act(async () => { modal.props.onRequestClose(); });
    await flush();
    expect(consentNodes(tree, 'consent-document')).toHaveLength(0);
    expect(leaf.requestHealthPermissions).not.toHaveBeenCalled();
    expect(connect.getState().resolved).toBe(false);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('OFFLINE during grant fails CLOSED — Agree errors, the OS sheet never opens, gate stays open', async () => {
    const { tree, connect, leaf } = await renderFlow({
      fetchConsentStatus: jest.fn().mockResolvedValue(okStatus({ granted: false })),
      grantConsent: jest.fn().mockResolvedValue({ ok: false, error: 'offline' }),
    });
    await tapWearable(tree);
    await ReactTestRenderer.act(async () => { consentNodes(tree, 'consent-agree')[0].props.onPress(); });
    await flush(); await flush();
    // The grant failed → submit_error → onProceed never fired → OS sheet shut → gate open.
    expect(consentNodes(tree, 'consent-error').length).toBeGreaterThan(0);
    expect(leaf.requestHealthPermissions).not.toHaveBeenCalled();
    expect(connect.getState().resolved).toBe(false);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('Health Connect UNAVAILABLE routes to install — no wall, no OS sheet, gate open', async () => {
    const { tree, connect, leaf } = await renderFlow({ checkAvailability: jest.fn().mockResolvedValue('install-required') });
    await tapWearable(tree);
    expect(consentNodes(tree, 'consent-title')).toHaveLength(0);
    expect(leaf.requestHealthPermissions).not.toHaveBeenCalled();
    expect(String(alertSpy.mock.calls[0]?.[0])).toMatch(/health connect/i);
    expect(connect.getState().resolved).toBe(false);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('UNSUPPORTED platform (non-Android) presents an honest note, not a broken CTA', async () => {
    const { tree, connect, leaf } = await renderFlow({ checkAvailability: jest.fn().mockResolvedValue('unsupported') });
    await tapWearable(tree);
    expect(consentNodes(tree, 'consent-title')).toHaveLength(0);
    expect(leaf.requestHealthPermissions).not.toHaveBeenCalled();
    expect(String(alertSpy.mock.calls[0]?.[0])).toMatch(/android/i);
    expect(connect.getState().resolved).toBe(false);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('DENY-TWICE throttle (OS sheet resolves []) → guidance alert, gate stays open', async () => {
    const { tree, connect } = await renderFlow({
      fetchConsentStatus: jest.fn().mockResolvedValue(okStatus({ granted: true })), // consented → short-circuit to the OS sheet
      requestHealthPermissions: jest.fn().mockResolvedValue([]), // Android suppressed the popup
    });
    await tapWearable(tree);
    expect(String(alertSpy.mock.calls[0]?.[0])).toMatch(/permission/i);
    expect(connect.getState().resolved).toBe(false); // no grant → no wearable → gate open
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });
});
