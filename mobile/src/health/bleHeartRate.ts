import { BleManager, type Device } from 'react-native-ble-plx';
import {
  HR_SERVICE_UUID,
  HR_MEASUREMENT_UUID,
  parseHeartRateMeasurement,
  base64ToBytes,
  shouldSend,
  newGateState,
} from './hrMeasurement';
import { pushLiveHr } from './liveHrClient';

export interface LiveHrCallbacks {
  onHr?: (hr: number) => void;
  onStatus?: (status: string) => void;
  onError?: (err: Error) => void;
}

export interface BleController {
  stop: () => void;
}

/**
 * Stream heart rate in real time from the first device advertising the standard BLE
 * Heart Rate Service (0x180D) — e.g. a Garmin watch with "Broadcast Heart Rate"
 * enabled. Each reading is gated (delta + liveness) and POSTed to /watch/hr via the
 * watch device token. Returns a controller whose stop() tears the whole thing down.
 *
 * Native (react-native-ble-plx); the parsing/gating it relies on is the pure logic in
 * hrMeasurement.ts, which is unit-tested independently.
 */
export function startBleHeartRate(watchToken: string, cb: LiveHrCallbacks = {}): BleController {
  const manager = new BleManager();
  const gate = newGateState();
  let device: Device | null = null;
  let stopped = false;

  const stop = () => {
    stopped = true;
    try { manager.stopDeviceScan(); } catch { /* already stopped */ }
    if (device) device.cancelConnection().catch(() => {});
    try { manager.destroy(); } catch { /* already destroyed */ }
  };

  cb.onStatus?.('Scanning for a heart-rate broadcast…');
  manager.startDeviceScan([HR_SERVICE_UUID], null, async (error, scanned) => {
    if (stopped) return;
    if (error) { cb.onError?.(error); return; }
    if (!scanned) return;

    manager.stopDeviceScan();
    try {
      cb.onStatus?.('Connecting…');
      device = await scanned.connect();
      await device.discoverAllServicesAndCharacteristics();
      cb.onStatus?.('Streaming live heart rate');

      device.monitorCharacteristicForService(
        HR_SERVICE_UUID,
        HR_MEASUREMENT_UUID,
        async (err, characteristic) => {
          if (stopped) return;
          if (err) { cb.onError?.(err); return; }
          if (!characteristic?.value) return;

          const hr = parseHeartRateMeasurement(base64ToBytes(characteristic.value));
          if (hr == null) return;
          cb.onHr?.(hr);

          const now = Date.now();
          if (shouldSend(hr, gate, now)) {
            gate.lastSent = hr;
            gate.lastSentAt = now;
            try {
              const res = await pushLiveHr(hr, watchToken);
              // On rate-limit, hold the gate open a bit by resetting lastSentAt back so
              // we don't hammer; the next qualifying reading naturally retries.
              if (res.rateLimited) gate.lastSentAt = now - 20_000;
            } catch (e) {
              cb.onError?.(e as Error);
            }
          }
        },
      );
    } catch (e) {
      cb.onError?.(e as Error);
    }
  });

  return { stop };
}
