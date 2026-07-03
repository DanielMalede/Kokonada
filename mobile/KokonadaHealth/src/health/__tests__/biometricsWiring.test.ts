// Suspect #3 (QA4 — Biometric Validation): warmStore.setLiveHr had NO production
// caller. The BLE / Health-Connect stream POSTed HR to the backend but never fed the
// warm lane, so PulseScreen rendered a liveHr that nothing on-device ever set. This
// wiring is the missing feeder: it bridges the live HR stream → warm store, and is
// additive — the existing pushLiveHr(backend) path inside startLiveHr is untouched.

import { startBiometrics } from '../biometricsWiring';
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
