import { initialize, readRecords } from 'react-native-health-connect';
import { pushLiveHr } from './liveHrClient';
import { isPlausibleHr } from './hrMeasurement';
import type { LiveHrCallbacks } from './bleHeartRate';

// STRICT fallback cadence when BLE is unavailable/denied: push exactly every 3 minutes.
export const FALLBACK_INTERVAL_MS = 3 * 60 * 1000;

export interface FallbackController {
  stop: () => void;
}

/**
 * Read the single most-recent HeartRate sample Health Connect holds within the last
 * couple of fallback windows and return its BPM (or null if none). Health Connect is
 * populated by Garmin's background sync, so this is a near-live value without BLE.
 */
export async function readLatestHealthConnectHr(now: Date = new Date()): Promise<number | null> {
  await initialize();
  const { records } = await readRecords('HeartRate', {
    timeRangeFilter: {
      operator: 'between',
      startTime: new Date(now.getTime() - FALLBACK_INTERVAL_MS * 2).toISOString(),
      endTime: now.toISOString(),
    },
  });

  let latest: { t: number; bpm: number } | null = null;
  for (const rec of (records as any[]) ?? []) {
    for (const s of rec.samples ?? []) {
      const t = new Date(s.time).getTime();
      const bpm = s.beatsPerMinute;
      if (isPlausibleHr(bpm) && (!latest || t > latest.t)) latest = { t, bpm };
    }
  }
  return latest ? latest.bpm : null;
}

/**
 * Poll Health Connect for the latest HR every 3 minutes and push it to /watch/hr.
 * This is the strict fallback used when the user denies BLE permission or BLE is
 * unavailable. Fires once immediately, then on the fixed interval.
 */
export function startRestFallback(watchToken: string, cb: LiveHrCallbacks = {}): FallbackController {
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      const hr = await readLatestHealthConnectHr();
      if (hr != null) {
        cb.onHr?.(hr);
        await pushLiveHr(hr, watchToken);
      }
    } catch (e) {
      cb.onError?.(e as Error);
    }
  };

  tick();
  const timer = setInterval(tick, FALLBACK_INTERVAL_MS);
  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
