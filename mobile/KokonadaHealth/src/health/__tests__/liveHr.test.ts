// Native modules are mocked so this suite runs under the RN app's jest without a real
// device. It covers the pure BLE parsing/gating, the strict 3-minute fallback cadence,
// and the BLE→REST fallback SELECTION logic (the crux of Agent 3).

jest.mock('react-native-health-connect', () => ({
  initialize: jest.fn().mockResolvedValue(true),
  readRecords: jest.fn().mockResolvedValue({ records: [] }),
}));
jest.mock('react-native-keychain', () => ({
  // Fake cached watch token so getWatchToken() short-circuits without a network call.
  // Only `.password` is read; no username field (avoids credential-pair scanners).
  getGenericPassword: jest.fn().mockResolvedValue({ password: 'fake-test-token' }),
  setGenericPassword: jest.fn().mockResolvedValue(undefined),
  resetGenericPassword: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('react-native-ble-plx', () => ({
  BleManager: jest.fn().mockImplementation(() => ({
    startDeviceScan: jest.fn(),
    stopDeviceScan: jest.fn(),
    destroy: jest.fn(),
  })),
}));
jest.mock('react-native', () => ({
  Platform: { OS: 'android', Version: 31 },
  PermissionsAndroid: {
    PERMISSIONS: { BLUETOOTH_SCAN: 'scan', BLUETOOTH_CONNECT: 'connect', ACCESS_FINE_LOCATION: 'loc' },
    RESULTS: { GRANTED: 'granted', DENIED: 'denied' },
    requestMultiple: jest.fn(),
  },
}));

import { PermissionsAndroid } from 'react-native';
import { parseHeartRateMeasurement, shouldSend, newGateState, isPlausibleHr } from '../hrMeasurement';
import { FALLBACK_INTERVAL_MS, readLatestHealthConnectHr } from '../restFallback';
import { startLiveHr } from '../liveHr';

const readRecords = require('react-native-health-connect').readRecords as jest.Mock;
const requestMultiple = PermissionsAndroid.requestMultiple as unknown as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
});

describe('parseHeartRateMeasurement (0x2A37)', () => {
  it('reads an 8-bit HR (flags bit0 = 0)', () => {
    expect(parseHeartRateMeasurement([0x00, 72])).toBe(72);
  });
  it('reads a 16-bit HR (flags bit0 = 1, little-endian)', () => {
    expect(parseHeartRateMeasurement([0x01, 0x2c, 0x01])).toBe(300); // 0x012C
  });
  it('returns null for a truncated buffer', () => {
    expect(parseHeartRateMeasurement([0x00])).toBeNull();
    expect(parseHeartRateMeasurement([])).toBeNull();
  });
});

describe('shouldSend gating', () => {
  it('sends the first plausible reading, then throttles by delta', () => {
    const s = newGateState();
    expect(shouldSend(70, s, 1000)).toBe(true);
    s.lastSent = 70; s.lastSentAt = 1000;
    expect(shouldSend(73, s, 2000)).toBe(false);        // < 8 bpm delta
    expect(shouldSend(80, s, 2000)).toBe(true);         // ≥ 8 bpm delta
  });
  it('sends a heartbeat once the liveness window elapses even if HR is flat', () => {
    const s = { lastSent: 70, lastSentAt: 0 };
    expect(shouldSend(70, s, 44_000)).toBe(false);
    expect(shouldSend(70, s, 46_000)).toBe(true);       // > LIVENESS_MS
  });
  it('rejects physiologically implausible values', () => {
    expect(isPlausibleHr(0)).toBe(false);
    expect(isPlausibleHr(260)).toBe(false);
    expect(shouldSend(0, newGateState(), 1000)).toBe(false);
  });
});

describe('REST fallback', () => {
  it('uses a strict 3-minute cadence', () => {
    expect(FALLBACK_INTERVAL_MS).toBe(3 * 60 * 1000);
  });
  it('returns the most recent Health Connect HR sample', async () => {
    readRecords.mockResolvedValueOnce({
      records: [
        { samples: [{ time: '2026-07-01T10:00:00Z', beatsPerMinute: 60 }, { time: '2026-07-01T10:02:00Z', beatsPerMinute: 66 }] },
      ],
    });
    expect(await readLatestHealthConnectHr(new Date('2026-07-01T10:03:00Z'))).toBe(66);
  });
});

describe('startLiveHr — strict BLE→REST selection', () => {
  it('uses BLE when permission is granted', async () => {
    requestMultiple.mockResolvedValue({ scan: 'granted', connect: 'granted' });
    const session = await startLiveHr();
    expect(session.mode).toBe('ble');
    session.stop();
  });

  it('falls back to the 3-minute REST push when BLE permission is denied', async () => {
    requestMultiple.mockResolvedValue({ scan: 'denied', connect: 'granted' });
    const session = await startLiveHr();
    expect(session.mode).toBe('rest-fallback');
    session.stop();
  });
});
