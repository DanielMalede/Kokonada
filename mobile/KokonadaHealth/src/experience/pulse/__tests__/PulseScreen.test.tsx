import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

jest.mock('../pulseStateStore', () => {
  const { createStore } = require('zustand/vanilla');
  const refresh = jest.fn();
  const store = createStore(() => ({ data: null, loading: false, fetchedAt: null, refresh }));
  return { pulseStateStore: store };
});

import { PulseScreen } from '../PulseScreen';
import { pulseStateStore } from '../pulseStateStore';
import { warmStore } from '../../../state/store';

const mockRefresh = pulseStateStore.getState().refresh as jest.Mock;

function texts(node: any, acc: string[] = []): string[] {
  if (node == null) return acc;
  if (typeof node === 'string') { acc.push(node); return acc; }
  if (Array.isArray(node)) { node.forEach((n) => texts(n, acc)); return acc; }
  if (node.children) texts(node.children, acc);
  return acc;
}
async function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(<PulseScreen />); });
  return tree;
}

afterEach(() => {
  warmStore.getState().reset();
  pulseStateStore.setState({ data: null } as any);
  jest.clearAllMocks();
});

describe('PulseScreen', () => {
  it('renders placeholders when no pulse data exists (no crash)', async () => {
    const tree = await render();
    const all = texts(tree.toJSON());
    expect(all.filter((t) => t === '—').length).toBeGreaterThan(0); // dash placeholders
    expect(all.join(' ')).toContain('HRV');
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('fetches the state vector on mount', async () => {
    const tree = await render();
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('renders vitals + status when data is present', async () => {
    await ReactTestRenderer.act(async () => {
      pulseStateStore.setState({
        data: {
          stateVector: { status: 'Peak Athletic Performance', confidence: 0.9, computedAt: null },
          vitals: { hrv: 68, bodyBattery: 74, dailyReadiness: 81, restingHeartRate: 54 },
          sleep: { lastNight: { deep: 90, light: 280, rem: 85, date: null }, updatedAt: null },
          lastAnalyzed: null, sampleCount: 4200,
        },
      } as any);
    });
    const tree = await render();
    const all = texts(tree.toJSON()).join(' ');
    expect(all).toContain('Peak Athletic Performance');
    expect(all).toContain('68');
    expect(all).toContain('90');
    expect(all).toContain('confidence');
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('shows the live warm-store HR', async () => {
    await ReactTestRenderer.act(async () => { warmStore.getState().setLiveHr(77); });
    const tree = await render();
    expect(texts(tree.toJSON()).join(' ')).toContain('77');
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('unsubscribes from both stores on unmount (parity)', async () => {
    let subs = 0; let unsubs = 0;
    const realW = warmStore.subscribe.bind(warmStore);
    const realP = pulseStateStore.subscribe.bind(pulseStateStore);
    const w = jest.spyOn(warmStore, 'subscribe').mockImplementation((cb: any) => { subs++; const u = realW(cb); return () => { unsubs++; u(); }; });
    const p = jest.spyOn(pulseStateStore, 'subscribe').mockImplementation((cb: any) => { subs++; const u = realP(cb); return () => { unsubs++; u(); }; });
    const tree = await render();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
    w.mockRestore(); p.mockRestore();
    expect(subs).toBe(2);
    expect(unsubs).toBe(2);
  });
});
