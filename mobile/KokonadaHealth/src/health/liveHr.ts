import { requestBlePermissions } from './blePermissions';
import { startBleHeartRate, type LiveHrCallbacks } from './bleHeartRate';
import { startRestFallback } from './restFallback';
import { getWatchToken } from './liveHrClient';

export type LiveHrMode = 'ble' | 'rest-fallback';

export interface LiveHrSession {
  mode: LiveHrMode;
  stop: () => void;
}

/**
 * Start live heart-rate streaming with a STRICT two-tier strategy:
 *   1. Prefer BLE — real-time readings from a Garmin "Broadcast Heart Rate" stream.
 *   2. If the user denies BLE permission (or it's unavailable), fall back to a fixed
 *      3-minute REST push sourced from Health Connect.
 * Both tiers authenticate with the same watch device token and hit /watch/hr, so the
 * backend/socket pipeline is identical regardless of which one is active.
 *
 * Returns the active mode + a stop() handle the caller keeps for teardown.
 */
export async function startLiveHr(cb: LiveHrCallbacks = {}): Promise<LiveHrSession> {
  const watchToken = await getWatchToken();

  const bleGranted = await requestBlePermissions();
  if (bleGranted) {
    const ctrl = startBleHeartRate(watchToken, cb);
    return { mode: 'ble', stop: ctrl.stop };
  }

  cb.onStatus?.('Bluetooth unavailable — using 3-minute Health Connect updates');
  const ctrl = startRestFallback(watchToken, cb);
  return { mode: 'rest-fallback', stop: ctrl.stop };
}
