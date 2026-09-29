import { startLiveHr, type LiveHrSession } from './liveHr';
import type { LiveHrCallbacks } from './bleHeartRate';
import type { WarmStore } from '../state/warm/warmStore';

// Missing feeder for the warm lane. startLiveHr streams HR to the backend but never
// touched warmStore, so PulseScreen showed a value nothing set (QA4 Suspect #3). This
// bridges the stream → warm store. `start` is injected for tests; prod uses the real
// two-tier startLiveHr. Fail-soft: a stream that can't start degrades to null and
// leaves the biometric source at its resting default — never throws into bootstrap.

export interface BiometricsWiringDeps {
  warm: WarmStore;
  start?: (cb: LiveHrCallbacks) => Promise<LiveHrSession>;
  // H2: the health lane's liveness check. Once it reads false (withdrawal, Disconnect, logout)
  // a late reading is dropped, and a start that only resolves afterwards is stopped at once.
  isActive?: () => boolean;
}

export async function startBiometrics(deps: BiometricsWiringDeps): Promise<LiveHrSession | null> {
  const start = deps.start ?? startLiveHr;
  const active = () => deps.isActive?.() ?? true;
  try {
    const session = await start({
      onHr: (hr) => { if (active()) deps.warm.getState().setLiveHr(hr); }, // plausibility-gated in the store
    });
    if (!active()) {
      session.stop();
      return null;
    }
    deps.warm.getState().setBiometricSource(session.mode === 'ble' ? 'ble' : 'health-connect');
    return session;
  } catch {
    return null;
  }
}

// H2 teardown wipe: drop the live reading and its source. Deliberately NOT a warmStore action
// (the warm store's surface is S12-1 sacred) and deliberately blind to `connection` (the server
// socket) and `permissions` (the OS grants) — stopping the feed must not fake either.
export function clearBiometricFeed(warm: WarmStore): void {
  warm.setState({ liveHr: null, biometricSource: 'none' });
}
