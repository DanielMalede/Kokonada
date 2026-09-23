// Suspect #3 (QA4 — Biometric Validation): warmStore.setLiveHr had NO production
// caller. The BLE / Health-Connect stream POSTed HR to the backend but never fed the
// warm lane, so PulseScreen rendered a liveHr that nothing on-device ever set. This
// wiring is the missing feeder: it bridges the live HR stream → warm store, and is
// additive — the existing pushLiveHr(backend) path inside startLiveHr is untouched.

import { startBiometrics, clearBiometricFeed } from '../biometricsWiring';
import { createWarmStore } from '../../state/warm/warmStore';
import type { LiveHrSession } from '../liveHr';
import type { LiveHrCallbacks } from '../bleHeartRate';

function fakeStart(mode: LiveHrSession['mode'], emit: (cb: LiveHrCallbacks) => void) {
  return async (cb: LiveHrCallbacks): Promise<LiveHrSession> => {
    emit(cb);
    return { mode, stop: jest.fn() };
  };
}

describe('startBiometrics — feed the warm lane (Suspect #3)', () => {
  it('routes each plausible HR reading into warmStore.liveHr', async () => {
    const warm = createWarmStore();
    await startBiometrics({ warm, start: fakeStart('ble', (cb) => { cb.onHr?.(72); cb.onHr?.(81); }) });
    expect(warm.getState().liveHr).toBe(81);
  });

  it('marks the biometric source from the active tier (ble)', async () => {
    const warm = createWarmStore();
    await startBiometrics({ warm, start: fakeStart('ble', () => {}) });
    expect(warm.getState().biometricSource).toBe('ble');
  });

  it('maps the rest-fallback tier to health-connect', async () => {
    const warm = createWarmStore();
    await startBiometrics({ warm, start: fakeStart('rest-fallback', () => {}) });
    expect(warm.getState().biometricSource).toBe('health-connect');
  });

  it('respects the warm plausibility gate (an absurd HR never lands)', async () => {
    const warm = createWarmStore();
    await startBiometrics({ warm, start: fakeStart('ble', (cb) => { cb.onHr?.(9999); }) });
    expect(warm.getState().liveHr).toBeNull();
  });

  it('never throws into bootstrap when the stream fails to start', async () => {
    const warm = createWarmStore();
    const boom = async () => { throw new Error('no bluetooth'); };
    await expect(startBiometrics({ warm, start: boom })).resolves.toBeNull();
    expect(warm.getState().biometricSource).toBe('none');
  });
});

// H2: the health lane tears the feed down on withdrawal / Disconnect / logout. Readings that
// arrive after that — or a start that only resolves after it — must never repopulate the warm
// lane (the next account on the phone would otherwise see the previous account's heart rate).
describe('startBiometrics — isActive guard (H2 teardown)', () => {
  it('drops a reading that arrives after the lane went inactive', async () => {
    const warm = createWarmStore();
    let active = true;
    let emit!: (hr: number) => void;
    await startBiometrics({
      warm,
      isActive: () => active,
      start: fakeStart('ble', (cb) => { emit = (hr) => cb.onHr?.(hr); }),
    });
    emit(72);
    expect(warm.getState().liveHr).toBe(72);
    active = false;
    emit(95);
    expect(warm.getState().liveHr).toBe(72); // the late reading never lands
  });

  it('a start that resolves after teardown is stopped at once and never sets a source', async () => {
    const warm = createWarmStore();
    let active = true;
    let resolveStart!: (s: LiveHrSession) => void;
    const session: LiveHrSession = { mode: 'ble', stop: jest.fn() };
    const pending = startBiometrics({
      warm,
      isActive: () => active,
      start: () => new Promise<LiveHrSession>((r) => { resolveStart = r; }),
    });
    active = false; // torn down while the start was in flight
    resolveStart(session);
    await expect(pending).resolves.toBeNull();
    expect(session.stop).toHaveBeenCalledTimes(1);
    expect(warm.getState().biometricSource).toBe('none');
  });
});

describe('clearBiometricFeed — the lane-teardown wipe (S12-1 safe)', () => {
  it('clears liveHr and the source but leaves the server connection and the permissions alone', () => {
    const warm = createWarmStore();
    warm.getState().setConnection('connected');
    warm.getState().setPermissions({ bluetooth: 'granted', health: 'granted' });
    warm.getState().setBiometricSource('ble');
    warm.getState().setLiveHr(72);

    clearBiometricFeed(warm);

    const s = warm.getState();
    expect(s.liveHr).toBeNull();
    expect(s.biometricSource).toBe('none');
    expect(s.connection).toBe('connected');
    expect(s.permissions).toEqual({ bluetooth: 'granted', health: 'granted' });
  });
});
