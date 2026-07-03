// The WARM lane holds live, ephemeral device state — the current heart rate, the
// socket connection status, biometric source, and OS permission grants. It is
// NEVER persisted (raw biometrics stay in memory and die with the process — the
// zero-knowledge posture). Its hardest job is Background Permission Revocation:
// the user suspends the app, revokes Bluetooth/Health in OS settings, and
// foregrounds — the severed biometric pipeline must transition cleanly, not crash.

import { createWarmStore } from '../warmStore';

describe('warmStore — live HR (ephemeral)', () => {
  it('accepts a physiologically plausible HR', () => {
    const s = createWarmStore();
    s.getState().setLiveHr(72);
    expect(s.getState().liveHr).toBe(72);
  });

  it('rejects implausible HR values (keeps the last good value)', () => {
    const s = createWarmStore();
    s.getState().setLiveHr(70);
    for (const bad of [0, -5, 260, NaN, Infinity, 500]) s.getState().setLiveHr(bad as number);
    expect(s.getState().liveHr).toBe(70);
  });

  it('starts with no HR and disconnected', () => {
    const s = createWarmStore();
    expect(s.getState().liveHr).toBeNull();
    expect(s.getState().connection).toBe('disconnected');
    expect(s.getState().biometricSource).toBe('none');
  });
});

describe('warmStore — connection status', () => {
  it('tracks connection transitions independently of biometrics', () => {
    const s = createWarmStore();
    s.getState().setConnection('connecting');
    expect(s.getState().connection).toBe('connecting');
    s.getState().setConnection('connected');
    expect(s.getState().connection).toBe('connected');
  });
});

describe('warmStore — Background Permission Revocation (attack #7)', () => {
  it('severs the biometric pipeline cleanly when a permission is revoked', () => {
    const s = createWarmStore();
    s.getState().setConnection('connected'); // the Kokonada server socket is up
    s.getState().setPermissions({ bluetooth: 'granted', health: 'granted' });
    s.getState().setBiometricSource('ble');
    s.getState().setLiveHr(88);

    // user revoked Bluetooth in OS settings while backgrounded; foreground reconciles
    s.getState().setPermissions({ bluetooth: 'denied', health: 'granted' });

    expect(s.getState().biometricSource).toBe('none'); // pipeline severed
    expect(s.getState().liveHr).toBeNull();            // stale HR dropped, not served
    // the SERVER socket is an independent lane — killing Bluetooth must not fake a
    // socket disconnect (S12-1)
    expect(s.getState().connection).toBe('connected');
  });

  it('does not crash and stays usable when BOTH permissions are revoked', () => {
    const s = createWarmStore();
    s.getState().setPermissions({ bluetooth: 'granted', health: 'granted' });
    s.getState().setLiveHr(90);
    expect(() => s.getState().setPermissions({ bluetooth: 'denied', health: 'denied' })).not.toThrow();
    expect(s.getState().liveHr).toBeNull();
    expect(s.getState().biometricSource).toBe('none');
  });

  it('re-granting a permission does NOT resurrect the stale pre-revocation HR', () => {
    const s = createWarmStore();
    s.getState().setPermissions({ bluetooth: 'granted', health: 'granted' });
    s.getState().setLiveHr(100);
    s.getState().setPermissions({ bluetooth: 'denied', health: 'granted' });
    s.getState().setPermissions({ bluetooth: 'granted', health: 'granted' }); // re-granted
    expect(s.getState().liveHr).toBeNull(); // must come from a fresh reading, not memory
  });
});

describe('warmStore — never persisted / logout', () => {
  it('exposes no serialize/persist surface (biometrics must not reach disk)', () => {
    const s = createWarmStore();
    const api = s.getState() as Record<string, unknown>;
    expect(api.serialize).toBeUndefined();
    expect(api.persist).toBeUndefined();
    expect(api.toJSON).toBeUndefined();
  });

  it('reset() returns to a cold, biometric-free baseline (logout)', () => {
    const s = createWarmStore();
    s.getState().setLiveHr(77);
    s.getState().setConnection('connected');
    s.getState().setBiometricSource('health-connect');
    s.getState().reset();
    expect(s.getState().liveHr).toBeNull();
    expect(s.getState().connection).toBe('disconnected');
    expect(s.getState().biometricSource).toBe('none');
  });
});
