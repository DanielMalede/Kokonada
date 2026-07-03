// Suspect #2 (QA4 — Crypto & State): bootstrapColdPersistence() was defined but NEVER
// invoked from App.tsx, so committed emotion intent never rehydrated or persisted in
// production despite the A7 three-lane architecture claiming it did. App.tsx only
// called startPlayback(). bootstrapApp is the single composed ignition sequence that
// closes that gap (and wires the socket / biometrics only once a session exists).

import { bootstrapApp, type AppBootstrapDeps } from '../appBootstrap';

function deps(overrides: Partial<AppBootstrapDeps> = {}): AppBootstrapDeps & {
  _cp: { rehydrate: jest.Mock; attach: jest.Mock };
} {
  const cp = { rehydrate: jest.fn(), attach: jest.fn() };
  const base: AppBootstrapDeps = {
    bootstrapSession: jest.fn().mockResolvedValue(true),
    getUserId: jest.fn().mockReturnValue('user-1'),
    connectSocket: jest.fn(),
    connectPlayer: jest.fn(),
    startBiometrics: jest.fn().mockResolvedValue(null),
    setupColdPersistence: jest.fn().mockReturnValue(cp),
    ...overrides,
  };
  return Object.assign(base, { _cp: cp });
}

describe('bootstrapApp', () => {
  it('with a live session + known user: connects socket, starts biometrics, rehydrates+attaches cold persistence', async () => {
    const d = deps();
    await bootstrapApp(d);
    expect(d.connectSocket).toHaveBeenCalledTimes(1);
    expect(d.startBiometrics).toHaveBeenCalledTimes(1);
    expect(d.setupColdPersistence).toHaveBeenCalledTimes(1);
    expect(d._cp.rehydrate).toHaveBeenCalledTimes(1);
    expect(d._cp.attach).toHaveBeenCalledTimes(1);
    // rehydrate MUST precede attach or the reset dispatch would re-persist mid-load
    expect(d._cp.rehydrate.mock.invocationCallOrder[0])
      .toBeLessThan(d._cp.attach.mock.invocationCallOrder[0]);
  });

  it('always attempts the Spotify player (its auth is independent of the Kokonada session)', async () => {
    const d = deps({ bootstrapSession: jest.fn().mockResolvedValue(false) });
    await bootstrapApp(d);
    expect(d.connectPlayer).toHaveBeenCalledTimes(1);
  });

  it('with NO session: does not connect the socket or touch persistence', async () => {
    const d = deps({ bootstrapSession: jest.fn().mockResolvedValue(false) });
    await bootstrapApp(d);
    expect(d.connectSocket).not.toHaveBeenCalled();
    expect(d.startBiometrics).not.toHaveBeenCalled();
    expect(d.setupColdPersistence).not.toHaveBeenCalled();
  });

  it('authed but no user id yet: connects socket but skips persistence (never spills to a global key)', async () => {
    const d = deps({ getUserId: jest.fn().mockReturnValue(null) });
    await bootstrapApp(d);
    expect(d.connectSocket).toHaveBeenCalledTimes(1);
    expect(d.setupColdPersistence).not.toHaveBeenCalled();
  });

  it('never throws even if a wiring step rejects', async () => {
    const d = deps({ startBiometrics: jest.fn().mockRejectedValue(new Error('ble down')) });
    await expect(bootstrapApp(d)).resolves.toBeUndefined();
  });
});
