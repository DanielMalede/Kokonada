// Pure helpers for the standard BLE Heart Rate Service — NO native imports, so this
// module is fully unit-testable on its own. The BLE plumbing (react-native-ble-plx)
// lives in bleHeartRate.ts and only calls into here.

// Standard GATT UUIDs (Bluetooth SIG):
//   Heart Rate Service          0x180D
//   Heart Rate Measurement char 0x2A37
export const HR_SERVICE_UUID     = '0000180d-0000-1000-8000-00805f9b34fb';
export const HR_MEASUREMENT_UUID = '00002a37-0000-1000-8000-00805f9b34fb';

// Local push cadence, mirrored from the sideloaded watch app's HrStreamer so the
// backend sees a consistent stream regardless of source: send when HR moves ≥ delta,
// or every liveness window as a heartbeat even if flat.
export const HR_DELTA_BPM = 8;
export const LIVENESS_MS  = 45_000;

// A physiologically plausible HR the backend will accept (matches watchHrIngest's
// 30–230 guard). Anything outside this is sensor noise (0 = no skin contact, etc.).
export function isPlausibleHr(hr: number): boolean {
  return Number.isFinite(hr) && hr >= 30 && hr <= 230;
}

/**
 * Parse the Heart Rate Measurement characteristic (0x2A37) payload.
 * Byte 0 is a flags field; bit 0 (0x01) selects the HR value format:
 *   0 → UINT8  heart rate at byte 1
 *   1 → UINT16 (little-endian) heart rate at bytes 1–2
 * Returns the BPM, or null if the buffer is too short / value is non-positive.
 */
export function parseHeartRateMeasurement(bytes: number[] | Uint8Array): number | null {
  if (!bytes || bytes.length < 2) return null;
  const flags = bytes[0];
  const is16bit = (flags & 0x01) === 0x01;
  const hr = is16bit ? (bytes[1] | (bytes[2] << 8)) : bytes[1];
  if (!Number.isFinite(hr) || hr <= 0) return null;
  return hr;
}

/** Decode react-native-ble-plx's base64 characteristic `value` into a byte array. */
export function base64ToBytes(b64: string): number[] {
  const bin =
    typeof atob === 'function'
      ? atob(b64)
      : // Buffer exists in the RN/jest runtime as a fallback for older engines.
        Buffer.from(b64, 'base64').toString('binary');
  const out = new Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface GateState {
  lastSent: number | null;
  lastSentAt: number;
}

/** Fresh gate state for a new streaming session. */
export function newGateState(): GateState {
  return { lastSent: null, lastSentAt: 0 };
}

/**
 * Decide whether a new HR reading should be POSTed to the backend. Sends the first
 * plausible reading, then only when HR moved ≥ HR_DELTA_BPM or the liveness window
 * elapsed — throttling Spotify churn while keeping the "live" session warm. Pure:
 * the caller mutates `state` after a true result.
 */
export function shouldSend(hr: number, state: GateState, now: number): boolean {
  if (!isPlausibleHr(hr)) return false;
  if (state.lastSent === null) return true;
  if (Math.abs(hr - state.lastSent) >= HR_DELTA_BPM) return true;
  if (now - state.lastSentAt >= LIVENESS_MS) return true;
  return false;
}
