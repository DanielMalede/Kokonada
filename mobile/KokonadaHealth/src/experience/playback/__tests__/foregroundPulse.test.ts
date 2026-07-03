import { reconcileOnForeground } from '../foregroundReconcile';
import { createWarmStore } from '../../../state/warm/warmStore';

// A11 Task 5: the foreground reconcile also refreshes the state-vector Pulse snapshot.
// Single-flighting lives in the pulse store, so the reconcile just fires it (guarded).

const base = () => ({
  orchestrator: { reconcile: jest.fn() },
  warmStore: createWarmStore(),
  readPlayback: async () => 'disconnected' as const,
  readPermissions: async () => ({ bluetooth: 'granted' as const, health: 'granted' as const }),
});

describe('reconcileOnForeground — pulse refresh', () => {
  it('invokes refreshPulse once per activation', async () => {
    const refreshPulse = jest.fn();
    await reconcileOnForeground({ ...base(), refreshPulse });
    expect(refreshPulse).toHaveBeenCalledTimes(1);
  });

  it('a throwing refreshPulse never breaks the reconcile', async () => {
    const deps = { ...base(), refreshPulse: () => { throw new Error('pulse down'); } };
    await expect(reconcileOnForeground(deps)).resolves.toBeUndefined();
    expect(deps.orchestrator.reconcile).toHaveBeenCalled(); // reconcile still ran
  });

  it('is optional — a reconcile without refreshPulse still works', async () => {
    await expect(reconcileOnForeground(base())).resolves.toBeUndefined();
  });
});
