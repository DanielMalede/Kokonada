// H2 race gap in the BLE tier. stop() can land while the scanned device is still CONNECTING or
// DISCOVERING services. At that moment `device` is not yet assigned, so stop() had nothing to
// cancel — the connection then completed, got monitored, and kept streaming (a zombie link that
// outlives logout / withdrawal). The tier must re-check after each await and cancel the device.
//
// The fake below is stateful: the manager records the scan callback and every device it hands
// out; each device's connect()/discover step is a promise the test resolves by hand, and
// monitorCharacteristicForService records its listener so a reading can be delivered for real.

type Listener = (err: unknown, characteristic: { value: string } | null) => void;

class FakeDevice {
  connectGate!: (d: FakeDevice) => void;
  discoverGate!: (d: FakeDevice) => void;
  monitored: Listener | null = null;
  cancelConnection = jest.fn(async () => this);
  connect = jest.fn(() => new Promise<FakeDevice>((r) => { this.connectGate = r; }));
  discoverAllServicesAndCharacteristics = jest.fn(() => new Promise<FakeDevice>((r) => { this.discoverGate = r; }));
  monitorCharacteristicForService = jest.fn((_s: string, _c: string, cb: Listener) => { this.monitored = cb; });
}

class FakeManager {
  scanCb: ((err: unknown, d: FakeDevice | null) => void) | null = null;
  startDeviceScan = jest.fn((_uuids: unknown, _opts: unknown, cb: (err: unknown, d: FakeDevice | null) => void) => { this.scanCb = cb; });
  stopDeviceScan = jest.fn();
  destroy = jest.fn();
}

let mockManager: FakeManager;
jest.mock('react-native-ble-plx', () => ({
  BleManager: jest.fn().mockImplementation(() => mockManager),
}));

import { startBleHeartRate } from '../bleHeartRate';

const settle = () => new Promise((r) => setImmediate(r));
// 0x2A37 payload: flags 0 (8-bit HR), 72 bpm → base64 of [0x00, 0x48].
const HR_72 = Buffer.from([0x00, 72]).toString('base64');

beforeEach(() => {
  jest.clearAllMocks();
  mockManager = new FakeManager();
  (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
});

describe('startBleHeartRate — a stop() during connect/discover never leaves a live link', () => {
  it('control: an uninterrupted connect is monitored and a reading reaches onHr and the push', async () => {
    const onHr = jest.fn();
    const ctrl = startBleHeartRate('fake-test-token', { onHr });
    const dev = new FakeDevice();
    mockManager.scanCb!(null, dev);
    dev.connectGate(dev);
    await settle();
    dev.discoverGate(dev);
    await settle();
    expect(dev.monitorCharacteristicForService).toHaveBeenCalledTimes(1);
    dev.monitored!(null, { value: HR_72 });
    await settle();
    expect(onHr).toHaveBeenCalledWith(72);
    expect((global as any).fetch).toHaveBeenCalledTimes(1);
    ctrl.stop();
  });

  it('stop() while connect() is pending: the device is cancelled when it resolves and never monitored', async () => {
    const onHr = jest.fn();
    const ctrl = startBleHeartRate('fake-test-token', { onHr });
    const dev = new FakeDevice();
    mockManager.scanCb!(null, dev);
    expect(dev.connect).toHaveBeenCalledTimes(1);

    ctrl.stop();
    dev.connectGate(dev);
    await settle();

    expect(dev.cancelConnection).toHaveBeenCalledTimes(1);
    expect(dev.discoverAllServicesAndCharacteristics).not.toHaveBeenCalled();
    expect(dev.monitorCharacteristicForService).not.toHaveBeenCalled();
    expect(onHr).not.toHaveBeenCalled();
    expect((global as any).fetch).not.toHaveBeenCalled();
  });

  it('stop() while services are being discovered: the device is cancelled and never monitored', async () => {
    const ctrl = startBleHeartRate('fake-test-token', {});
    const dev = new FakeDevice();
    mockManager.scanCb!(null, dev);
    dev.connectGate(dev);
    await settle();
    expect(dev.discoverAllServicesAndCharacteristics).toHaveBeenCalledTimes(1);

    ctrl.stop();
    dev.discoverGate(dev);
    await settle();

    expect(dev.cancelConnection).toHaveBeenCalled();
    expect(dev.monitorCharacteristicForService).not.toHaveBeenCalled();
  });
});
