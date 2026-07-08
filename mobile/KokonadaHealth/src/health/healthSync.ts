import { getGranted } from './healthConnect';
import { fetchSixMonthHistory } from './fetchHistory';
import { toBackendSamples } from './mapToBackend';
import { uploadSamples } from './uploadClient';

// D-4a: the Health Connect → MedicalProfile ingestion, re-homed from the orphaned
// ConnectHealthScreen (which was unreachable — nothing navigated to it, so advanced
// biometrics never ingested and Pulse gauges stayed "—"). This module is the single
// sync entry point, called from (a) the Profile "Sync health data" CTA and (b) a
// fail-soft bootstrap kick. Fail-soft everywhere: a missing permission, an empty
// store, or a network error degrades to { synced:false } — never a throw into
// bootstrap or the UI.

// Per-record-type read counts — the diagnostic that distinguishes "pipeline broken"
// from "the watch never shared this metric" (D-4a v2). Surfaced in the sync alert,
// logcat, and the Pulse gauges' "not shared" notes.
export interface SyncCounts {
  heartRate: number;
  hrv: number;
  sleep: number;
  restingHeartRate: number;
}

export interface HealthSyncResult {
  synced: boolean;
  reason?: 'no-permission' | 'throttled' | 'no-data' | 'error';
  accepted?: number;
  inserted?: number;
  counts?: SyncCounts;
}

// Tiny observable for the last sync's counts so PulseScreen can annotate gauges
// honestly. In-memory + KV-persisted (rehydrated by the bootstrap sync even when
// the sync itself is throttled).
let lastCounts: SyncCounts | null = null;
const countListeners = new Set<(c: SyncCounts | null) => void>();
export function getLastSyncCounts(): SyncCounts | null { return lastCounts; }
export function subscribeSyncCounts(cb: (c: SyncCounts | null) => void): () => void {
  countListeners.add(cb);
  return () => { countListeners.delete(cb); };
}
function publishCounts(c: SyncCounts | null): void {
  lastCounts = c;
  countListeners.forEach((cb) => { try { cb(c); } catch { /* listener errors never break sync */ } });
}

function countByType(samples: Array<{ type: string }>): SyncCounts {
  const c: SyncCounts = { heartRate: 0, hrv: 0, sleep: 0, restingHeartRate: 0 };
  for (const s of samples) {
    if (s.type === 'heart_rate') c.heartRate++;
    else if (s.type === 'hrv') c.hrv++;
    else if (s.type === 'resting_heart_rate') c.restingHeartRate++;
    else if (s.type.startsWith('sleep_')) c.sleep++;
  }
  return c;
}

export interface HealthSyncDeps {
  granted?: () => Promise<unknown[]>;
  fetch?: () => Promise<Parameters<typeof toBackendSamples>[0]>;
  upload?: (samples: ReturnType<typeof toBackendSamples>) => Promise<{ accepted: number; inserted: number }>;
  // Throttle persistence (encrypted KV port, same shape liveModeStore binds).
  kv?: { getString(key: string): string | null | undefined | Promise<string | null | undefined>; set(key: string, value: string): unknown } | null;
  now?: () => number;
  // Skip a sync when the last one is fresher than this (bootstrap path). The manual
  // CTA passes 0 to force. Default 12h — the backend dedupes/aggregates idempotently,
  // so this is battery/network hygiene, not correctness.
  minIntervalMs?: number;
}

const LAST_SYNC_KEY = 'koko-health-last-sync-at';
const LAST_COUNTS_KEY = 'koko-health-last-counts';
const DEFAULT_MIN_INTERVAL_MS = 12 * 60 * 60 * 1000;

async function rehydrateCounts(kv: HealthSyncDeps['kv']): Promise<void> {
  if (!kv || lastCounts) return;
  try {
    const raw = await kv.getString(LAST_COUNTS_KEY);
    if (raw) publishCounts(JSON.parse(raw));
  } catch { /* corrupt/missing — stay null */ }
}

export async function syncMedicalProfile(deps: HealthSyncDeps = {}): Promise<HealthSyncResult> {
  const now = deps.now ?? Date.now;
  const minInterval = deps.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  try {
    // Permission gate: never prompt from here — only sync if the user already granted
    // (the CTA runs requestHealthPermissions() first; bootstrap must stay silent).
    const granted = await (deps.granted ?? getGranted)();
    if (!Array.isArray(granted) || granted.length === 0) return { synced: false, reason: 'no-permission' };

    if (minInterval > 0 && deps.kv) {
      const raw = await deps.kv.getString(LAST_SYNC_KEY);
      const last = raw ? Number(raw) : NaN;
      if (Number.isFinite(last) && now() - last < minInterval) {
        await rehydrateCounts(deps.kv); // a throttled boot still restores the gauge notes
        return { synced: false, reason: 'throttled' };
      }
    }

    const history = await (deps.fetch ?? fetchSixMonthHistory)();
    const samples = toBackendSamples(history);
    const counts = countByType(samples);
    console.log('[koko] healthSync read counts:', JSON.stringify(counts));
    if (samples.length === 0) {
      publishCounts(counts); // all-zero counts still inform the gauges
      return { synced: false, reason: 'no-data', counts };
    }

    const up = await (deps.upload ?? uploadSamples)(samples);
    deps.kv?.set(LAST_SYNC_KEY, String(now()));
    deps.kv?.set(LAST_COUNTS_KEY, JSON.stringify(counts));
    publishCounts(counts);
    return { synced: true, accepted: up.accepted, inserted: up.inserted, counts };
  } catch {
    return { synced: false, reason: 'error' };
  }
}
