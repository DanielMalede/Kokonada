import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { AppState } from 'react-native';

// H2-8 — the on-device AppState binding of the foreground reconcile. Each return to the foreground
// re-checks the health lane through the STOP-ONLY trigger (recheckHealthOnForeground →
// evaluate({ allowStart: false })); nothing else about the reconcile changes. The reconcile logic
// is proven in foregroundReconcile.test.ts and the lane in health/__tests__/healthLane*.test.ts —
// this pins only that the binding fires the right trigger, on 'active' and nowhere else.

jest.mock('../playbackServices', () => ({
  orchestrator: { reconcile: jest.fn() },
  player: { getPlaybackState: jest.fn(async () => 'disconnected') },
}));
jest.mock('../../../health/currentPermissions', () => ({
  readCurrentPermissions: jest.fn(async () => ({ bluetooth: 'granted', health: 'granted' })),
}));
jest.mock('../../pulse/pulseStateStore', () => ({
  pulseStateStore: { getState: () => ({ refresh: jest.fn(async () => {}) }) },
}));
jest.mock('../../../health/healthLaneServices', () => ({
  recheckHealthOnForeground: jest.fn(async () => true),
  healthLane: { evaluate: jest.fn(async () => true) },
}));

import { AppLifecycle } from '../AppLifecycle';
import { recheckHealthOnForeground, healthLane } from '../../../health/healthLaneServices';

const flush = async () => { await ReactTestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); }); };

function mountAndCaptureHandler() {
  const addEventListener = AppState.addEventListener as unknown as jest.Mock;
  addEventListener.mockClear();
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => { tree = ReactTestRenderer.create(<AppLifecycle />); });
  const call = addEventListener.mock.calls.find(([event]) => event === 'change');
  if (!call) throw new Error('AppLifecycle did not subscribe to AppState changes');
  return { tree, onChange: call[1] as (s: string) => void };
}

beforeEach(() => { jest.clearAllMocks(); });

describe('AppLifecycle — the foreground re-check of the health lane (H2)', () => {
  it('a return to the foreground fires the stop-only re-check exactly once', async () => {
    const { tree, onChange } = mountAndCaptureHandler();
    await ReactTestRenderer.act(async () => { onChange('active'); });
    await flush();
    expect(recheckHealthOnForeground).toHaveBeenCalledTimes(1);
    // Never the start-allowed path: a foreground can never mint after a Disconnect.
    expect(healthLane.evaluate).not.toHaveBeenCalled();
    ReactTestRenderer.act(() => { tree.unmount(); });
  });

  it('going to the background re-checks nothing', async () => {
    const { tree, onChange } = mountAndCaptureHandler();
    await ReactTestRenderer.act(async () => { onChange('background'); onChange('inactive'); });
    await flush();
    expect(recheckHealthOnForeground).not.toHaveBeenCalled();
    ReactTestRenderer.act(() => { tree.unmount(); });
  });
});
