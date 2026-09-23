import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { LiveHeartRateCard } from '../LiveHeartRateCard';
import { haptics } from '../../../design/tokens';

// The §10 live-HR credential card. It replaces the retired watch PAIRING-CODE card: the Connect IQ
// app is gone, but the whr_ device token it shared is still minted by the PHONE for the BLE and
// Health-Connect live-HR tiers (liveHrClient.getWatchToken → POST /watch/token). Revoking that
// credential was previously reachable ONLY from the pairing card's Disconnect, so these tests pin
// the salvaged affordance: without it a user cannot revoke a long-lived health credential at all.

const flush = async () => { await ReactTestRenderer.act(async () => { await Promise.resolve(); }); };

// Host nodes only. react-test-renderer surfaces the same accessibilityLabel on the Pressable
// component node, its inner host View and the wrapper, so an unfiltered findAll counts one button
// three times — filter to host elements so the count means "how many controls", not "how many nodes".
function findByLabel(tree: ReactTestRenderer.ReactTestRenderer, label: string) {
  return tree.root.findAll(n => n.props?.accessibilityLabel === label && typeof n.type === 'string');
}

// The host View carries the label but not the handler — Pressable keeps onPress on the component
// node — so pressing and counting need different lookups.
function pressByLabel(tree: ReactTestRenderer.ReactTestRenderer, label: string) {
  const node = tree.root.findAll(
    n => n.props?.accessibilityLabel === label && typeof n.props?.onPress === 'function',
  )[0];
  if (!node) throw new Error(`no pressable carrying accessibilityLabel "${label}"`);
  node.props.onPress();
}

describe('LiveHeartRateCard', () => {
  it('reports connected + last-seen from the status endpoint', async () => {
    const fetchStatus = jest.fn().mockResolvedValue({
      ok: true, data: { connected: true, lastSeenAt: new Date().toISOString() },
    });
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <LiveHeartRateCard fetchStatus={fetchStatus} revoke={jest.fn()} />,
      );
    });
    await flush();

    expect(fetchStatus).toHaveBeenCalledTimes(1);
    const text = JSON.stringify(tree.toJSON());
    expect(text).toContain('Connected');
    expect(findByLabel(tree, 'live-hr-disconnect').length).toBe(1);
  });

  it('offers NO disconnect when nothing is connected — there is no credential to revoke', async () => {
    const fetchStatus = jest.fn().mockResolvedValue({
      ok: true, data: { connected: false, lastSeenAt: null },
    });
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <LiveHeartRateCard fetchStatus={fetchStatus} revoke={jest.fn()} />,
      );
    });
    await flush();

    expect(findByLabel(tree, 'live-hr-disconnect').length).toBe(0);
  });

  it('Disconnect revokes the server slot and drops back to not-connected', async () => {
    const fetchStatus = jest.fn().mockResolvedValue({
      ok: true, data: { connected: true, lastSeenAt: null },
    });
    const revoke = jest.fn().mockResolvedValue({ ok: true, data: { message: 'ok' } });
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <LiveHeartRateCard fetchStatus={fetchStatus} revoke={revoke} />,
      );
    });
    await flush();

    await ReactTestRenderer.act(async () => {
      pressByLabel(tree, 'live-hr-disconnect');
    });
    await flush();

    expect(revoke).toHaveBeenCalledTimes(1);
    expect(findByLabel(tree, 'live-hr-disconnect').length).toBe(0);
  });

  it('a failed status read leaves the card honest-empty rather than claiming connected', async () => {
    const fetchStatus = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <LiveHeartRateCard fetchStatus={fetchStatus} revoke={jest.fn()} />,
      );
    });
    await flush();

    expect(findByLabel(tree, 'live-hr-disconnect').length).toBe(0);
    expect(JSON.stringify(tree.toJSON())).not.toContain('Connected ·');
  });

  // END-TO-END haptic wiring. Ported from the retired WatchPairingCard suite, where it was written
  // after jest.setup.js gained the react-native-haptic-feedback stub: before that stub the whole
  // chain was dead in EVERY test in the suite and nothing said so, because fireHaptic swallows its
  // own failure by design. The finding is about the chain, not the deleted card, and this card is
  // now the one that fires on a destructive action — so the assertion moves here rather than dying
  // with the file. Nothing is stubbed between this tap and the native module: no triggerHaptic prop,
  // so the card takes the real fireHaptic default and does its real lazy require.
  it('the Disconnect tap drives the real fireHaptic through to the native trigger', async () => {
    const nativeTrigger = (jest.requireMock('react-native-haptic-feedback') as { trigger: jest.Mock }).trigger;
    nativeTrigger.mockClear();
    const fetchStatus = jest.fn().mockResolvedValue({
      ok: true, data: { connected: true, lastSeenAt: null },
    });
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <LiveHeartRateCard
          fetchStatus={fetchStatus}
          revoke={jest.fn().mockResolvedValue({ ok: true, data: { message: 'ok' } })}
        />,
      );
    });
    await flush();

    await ReactTestRenderer.act(async () => { pressByLabel(tree, 'live-hr-disconnect'); });
    await flush();

    expect(nativeTrigger).toHaveBeenCalledWith(haptics.selection);
  });

  it('a failed revoke does NOT pretend the credential is gone', async () => {
    const fetchStatus = jest.fn().mockResolvedValue({
      ok: true, data: { connected: true, lastSeenAt: null },
    });
    const revoke = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <LiveHeartRateCard fetchStatus={fetchStatus} revoke={revoke} />,
      );
    });
    await flush();

    await ReactTestRenderer.act(async () => {
      pressByLabel(tree, 'live-hr-disconnect');
    });
    await flush();

    expect(revoke).toHaveBeenCalledTimes(1);
    expect(findByLabel(tree, 'live-hr-disconnect').length).toBe(1);
  });
});
