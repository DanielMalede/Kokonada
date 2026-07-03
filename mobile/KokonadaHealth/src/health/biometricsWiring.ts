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
}

export async function startBiometrics(deps: BiometricsWiringDeps): Promise<LiveHrSession | null> {
  const start = deps.start ?? startLiveHr;
  try {
    const session = await start({
      onHr: (hr) => deps.warm.getState().setLiveHr(hr), // plausibility-gated in the store
    });
    deps.warm.getState().setBiometricSource(session.mode === 'ble' ? 'ble' : 'health-connect');
    return session;
  } catch {
    return null;
  }
}
