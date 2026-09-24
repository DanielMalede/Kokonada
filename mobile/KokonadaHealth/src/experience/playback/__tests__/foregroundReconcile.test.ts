// When Kokonada returns to the foreground, the world may have moved on: the user
// changed the track directly in Spotify, and/or turned off Bluetooth (killing the
// live HR feed). reconcileOnForeground reads the two truths — the native player
// state and the OS permissions — and reconciles both lanes. It must NEVER throw:
// a dead remote or a permission read that rejects still leaves a consistent app.

import { reconcileOnForeground } from '../foregroundReconcile';
import { createWarmStore } from '../../../state/warm/warmStore';

function build(overrides: any = {}) {
  const warm = createWarmStore();
  const reconcile = jest.fn();
  const deps = {
    orchestrator: { reconcile },
    warmStore: warm,
    readPlayback: overrides.readPlayback
      ?? jest.fn(async () => ({ isPlaying: true, uri: 'spotify:track:a' })),
    readPermissions: overrides.readPermissions
      ?? jest.fn(async () => ({ bluetooth: 'granted', health: 'granted' })),
  };
  return { deps, warm, reconcile };
}

describe('reconcileOnForeground — playback truth', () => {
  it('reconciles the orchestrator to the native player state', async () => {
    const { deps, reconcile } = build({
      readPlayback: jest.fn(async () => ({ isPlaying: false, uri: 'spotify:track:foreign' })),
    });
    await reconcileOnForeground(deps);
    expect(reconcile).toHaveBeenCalledWith({ isPlaying: false, uri: 'spotify:track:foreign' });
  });

  it('reconciles disconnected when the remote is gone, without throwing', async () => {
    const { deps, reconcile } = build({ readPlayback: jest.fn(async () => 'disconnected') });
    await expect(reconcileOnForeground(deps)).resolves.toBeUndefined();
    expect(reconcile).toHaveBeenCalledWith('disconnected');
  });

  it('a readPlayback that REJECTS is treated as disconnected, never propagates', async () => {
    const { deps, reconcile } = build({ readPlayback: jest.fn(async () => { throw new Error('remote dead'); }) });
    await expect(reconcileOnForeground(deps)).resolves.toBeUndefined();
    expect(reconcile).toHaveBeenCalledWith('disconnected');
  });
});

describe('reconcileOnForeground — dead biometric lane', () => {
  it('severs the biometric lane when Bluetooth was turned off in the background', async () => {
    const { deps, warm } = build({
      readPermissions: jest.fn(async () => ({ bluetooth: 'denied', health: 'granted' })),
    });
    warm.getState().setBiometricSource('ble');
    warm.getState().setLiveHr(88);

    await reconcileOnForeground(deps);

    expect(warm.getState().biometricSource).toBe('none'); // pipeline severed
    expect(warm.getState().liveHr).toBeNull();             // stale HR dropped
  });

  it('a readPermissions that REJECTS degrades to no biometrics, never throws', async () => {
    const { deps, warm } = build({ readPermissions: jest.fn(async () => { throw new Error('perm read failed'); }) });
    warm.getState().setLiveHr(90);
    await expect(reconcileOnForeground(deps)).resolves.toBeUndefined();
    expect(warm.getState().biometricSource).toBe('none');
  });
});

describe('reconcileOnForeground — combined desync (attack #2)', () => {
  it('handles a foreign track AND a killed Bluetooth lane in one foreground pass, no crash', async () => {
    const { deps, warm, reconcile } = build({
      readPlayback: jest.fn(async () => ({ isPlaying: true, uri: 'spotify:track:foreign' })),
      readPermissions: jest.fn(async () => ({ bluetooth: 'denied', health: 'denied' })),
    });
    warm.getState().setLiveHr(120);

    await expect(reconcileOnForeground(deps)).resolves.toBeUndefined();

    expect(reconcile).toHaveBeenCalledWith({ isPlaying: true, uri: 'spotify:track:foreign' });
    expect(warm.getState().biometricSource).toBe('none');
    expect(warm.getState().liveHr).toBeNull();
  });

  it('a fully healthy foreground reconciles cleanly (playing, permissions granted)', async () => {
    const { deps, warm, reconcile } = build();
    await reconcileOnForeground(deps);
    expect(reconcile).toHaveBeenCalledWith({ isPlaying: true, uri: 'spotify:track:a' });
    expect(warm.getState().permissions).toEqual({ bluetooth: 'granted', health: 'granted' });
  });
});

// H2-8 (DT-H2-5 option F1): every foreground re-checks the health lane, which can only STOP a
// running feed — it catches a withdrawal whose response was lost and a grant revoked in Settings.
// Starting is never its job (the lane is called with allowStart:false), so it can never silently
// mint a fresh credential right after a Disconnect.
describe('reconcileOnForeground — health lane re-check (H2)', () => {
  it('re-checks the health lane once per activation, after the permission reconcile', async () => {
    const order: string[] = [];
    const { deps } = build({
      readPermissions: jest.fn(async () => { order.push('permissions'); return { bluetooth: 'granted', health: 'granted' }; }),
    });
    const reevaluateHealth = jest.fn(() => { order.push('health-lane'); });
    await reconcileOnForeground({ ...deps, reevaluateHealth });
    expect(reevaluateHealth).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['permissions', 'health-lane']);
  });

  it('a throwing re-check never breaks the reconcile', async () => {
    const { deps, reconcile, warm } = build();
    const reevaluateHealth = () => { throw new Error('lane down'); };
    await expect(reconcileOnForeground({ ...deps, reevaluateHealth })).resolves.toBeUndefined();
    expect(reconcile).toHaveBeenCalled();
    expect(warm.getState().permissions).toEqual({ bluetooth: 'granted', health: 'granted' });
  });

  it('is optional — a reconcile without it still works', async () => {
    const { deps } = build();
    await expect(reconcileOnForeground(deps)).resolves.toBeUndefined();
  });
});
