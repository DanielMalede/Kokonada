import { createPulseStateStore } from '../pulseStateStore';
import type { PulseState } from '../pulseApi';

const sample: PulseState = {
  stateVector: { status: 'Peak Athletic Performance', confidence: 0.9, computedAt: '2026-07-03T11:00:00Z' },
  vitals: { hrv: 68, bodyBattery: 74, dailyReadiness: 81, restingHeartRate: 54 },
  sleep: { lastNight: { deep: 90, light: 280, rem: 85, date: '2026-07-03T06:00:00Z' }, updatedAt: '2026-07-03T07:00:00Z' },
  lastAnalyzed: '2026-07-03T10:00:00Z', sampleCount: 4200,
};

describe('pulseStateStore', () => {
  it('populates data + fetchedAt on a successful refresh', async () => {
    const store = createPulseStateStore(async () => ({ ok: true, data: sample }));
    await store.getState().refresh();
    expect(store.getState().data?.vitals.hrv).toBe(68);
    expect(store.getState().fetchedAt).not.toBeNull();
    expect(store.getState().loading).toBe(false);
  });

  it('is SINGLE-FLIGHT: a burst of refreshes during one in-flight fetch calls the API once', async () => {
    let calls = 0;
    let resolve!: (v: any) => void;
    const store = createPulseStateStore(() => { calls++; return new Promise((r) => { resolve = r; }); });
    store.getState().refresh(); store.getState().refresh(); store.getState().refresh();
    expect(calls).toBe(1);
    resolve({ ok: true, data: sample });
    await Promise.resolve();
  });

  it('stale-while-revalidate: a failed refresh keeps the last good data', async () => {
    let ok = true;
    const store = createPulseStateStore(async () => (ok ? { ok: true, data: sample } : { ok: false, status: 500, error: 'down' }));
    await store.getState().refresh();
    ok = false;
    await store.getState().refresh();
    expect(store.getState().data?.vitals.hrv).toBe(68); // last good preserved
    expect(store.getState().loading).toBe(false);
  });

  it('never throws even if the fetcher rejects', async () => {
    const store = createPulseStateStore(async () => { throw new Error('airplane'); });
    await expect(store.getState().refresh()).resolves.toBeUndefined();
    expect(store.getState().loading).toBe(false);
  });
});
