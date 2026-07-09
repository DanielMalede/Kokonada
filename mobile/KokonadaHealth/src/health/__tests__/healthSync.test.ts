import { syncMedicalProfile, getLastSyncCounts, subscribeSyncCounts } from '../healthSync';

// D-4a: the re-homed Health Connect → MedicalProfile sync. All deps injected — no
// native module, fully deterministic.

const HISTORY = {
  heartRate: [{ samples: [{ time: 't1', beatsPerMinute: 70 }] }],
  hrv: [{ time: 't2', heartRateVariabilityMillis: 45 }],
  sleep: [],
  restingHeartRate: [{ time: 't3', beatsPerMinute: 52 }],
};

function makeKv(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getString: (k: string) => store.get(k) ?? null,
    set: jest.fn((k: string, v: string) => { store.set(k, v); }),
    store,
  };
}

describe('syncMedicalProfile (D-4a)', () => {
  it('fetches, maps (incl. resting_heart_rate) and uploads when permission is granted', async () => {
    const upload = jest.fn(async (samples: any[]) => ({ accepted: samples.length, inserted: 2 }));
    const kv = makeKv();
    const res = await syncMedicalProfile({
      granted: async () => [{ recordType: 'HeartRate' }],
      fetch: async () => HISTORY,
      upload,
      kv,
      now: () => 1_000_000,
      minIntervalMs: 0,
    });
    expect(res).toEqual({
      synced: true, accepted: 3, inserted: 2,
      counts: { heartRate: 1, hrv: 1, sleep: 0, restingHeartRate: 1 }, // per-type diagnostics (D-4a v2)
    });
    const types = upload.mock.calls[0][0].map((s: any) => s.type);
    expect(types).toContain('resting_heart_rate'); // the classifier's missing input now flows
    expect(kv.set).toHaveBeenCalled(); // lastSync recorded
    expect(getLastSyncCounts()).toEqual({ heartRate: 1, hrv: 1, sleep: 0, restingHeartRate: 1 });
  });

  it('publishes counts to subscribers so Pulse can annotate "not shared" gauges', async () => {
    const seen: any[] = [];
    const off = subscribeSyncCounts((c) => seen.push(c));
    await syncMedicalProfile({
      granted: async () => [{ recordType: 'HeartRate' }],
      fetch: async () => ({ ...HISTORY, hrv: [] }), // watch shares no HRV
      upload: async () => ({ accepted: 2, inserted: 2 }),
      minIntervalMs: 0,
    });
    off();
    expect(seen[seen.length - 1]).toEqual({ heartRate: 1, hrv: 0, sleep: 0, restingHeartRate: 1 });
  });

  it('does NOT sync (and never prompts) without a granted permission', async () => {
    const upload = jest.fn();
    const res = await syncMedicalProfile({ granted: async () => [], upload, minIntervalMs: 0 });
    expect(res).toEqual({ synced: false, reason: 'no-permission' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('throttles a bootstrap sync when the last one is fresh', async () => {
    const upload = jest.fn();
    const kv = makeKv({ 'koko-health-last-sync-at': '900000' });
    const res = await syncMedicalProfile({
      granted: async () => [{ recordType: 'HeartRate' }],
      fetch: async () => HISTORY,
      upload, kv,
      now: () => 1_000_000,
      minIntervalMs: 200_000, // 100k elapsed < 200k window
    });
    expect(res).toEqual({ synced: false, reason: 'throttled' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('minIntervalMs: 0 (the manual CTA) bypasses the throttle', async () => {
    const upload = jest.fn(async () => ({ accepted: 1, inserted: 1 }));
    const kv = makeKv({ 'koko-health-last-sync-at': '999999' });
    const res = await syncMedicalProfile({
      granted: async () => [{ recordType: 'HeartRate' }],
      fetch: async () => HISTORY,
      upload, kv,
      now: () => 1_000_000,
      minIntervalMs: 0,
    });
    expect(res.synced).toBe(true);
  });

  it('an empty health store is a clean no-data result, not an upload', async () => {
    const upload = jest.fn();
    const res = await syncMedicalProfile({
      granted: async () => [{ recordType: 'HeartRate' }],
      fetch: async () => ({ heartRate: [], hrv: [], sleep: [], restingHeartRate: [] }),
      upload,
      minIntervalMs: 0,
    });
    expect(res).toEqual({
      synced: false, reason: 'no-data',
      counts: { heartRate: 0, hrv: 0, sleep: 0, restingHeartRate: 0 },
    });
    expect(upload).not.toHaveBeenCalled();
  });

  it('fail-soft: a throwing fetch degrades to error WITH the message (never throws into bootstrap)', async () => {
    // The error detail is the #90 unblock — the silent catch used to swallow it.
    await expect(syncMedicalProfile({
      granted: async () => [{ recordType: 'HeartRate' }],
      fetch: async () => { throw new Error('HC read failed'); },
      minIntervalMs: 0,
    })).resolves.toEqual({ synced: false, reason: 'error', error: 'HC read failed' });
  });

  it('a FAILED upload keeps the read counts + surfaces the status (the #90 mystery)', async () => {
    // Root of #90: the watch data IS read, but the POST to /health/batch fails and the
    // old silent catch hid it. Now the result carries the failure detail AND the counts
    // that were read, so we can tell "read fine, upload broke" from "watch shared nothing".
    const res = await syncMedicalProfile({
      granted: async () => [{ recordType: 'HeartRate' }],
      fetch: async () => HISTORY,
      upload: async () => { throw new Error('Ingest failed (401) on chunk starting at 0'); },
      minIntervalMs: 0,
    });
    expect(res.synced).toBe(false);
    expect(res.reason).toBe('error');
    expect(res.error).toContain('401');
    expect(res.counts).toEqual({ heartRate: 1, hrv: 1, sleep: 0, restingHeartRate: 1 });
  });
});
