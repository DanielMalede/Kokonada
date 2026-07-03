import { createStore, type StoreApi } from 'zustand/vanilla';

// WARM LANE — live, throttled, EPHEMERAL device state. Never persisted: raw HR
// lives here only in memory and dies with the process (zero-knowledge posture).

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';
export type BiometricSource = 'ble' | 'health-connect' | 'none';
export type Grant = 'granted' | 'denied' | 'unknown';

export interface Permissions {
  bluetooth: Grant;
  health: Grant;
}

export interface WarmState {
  liveHr: number | null;
  connection: ConnectionStatus;
  biometricSource: BiometricSource;
  permissions: Permissions;

  setLiveHr(hr: number): void;
  setConnection(status: ConnectionStatus): void;
  setBiometricSource(source: BiometricSource): void;
  setPermissions(perms: Permissions): void;
  reset(): void;
}

const HR_MIN = 30;
const HR_MAX = 220;

function isPlausibleHr(hr: number): boolean {
  return typeof hr === 'number' && Number.isFinite(hr) && hr >= HR_MIN && hr <= HR_MAX;
}

const baseline = {
  liveHr: null as number | null,
  connection: 'disconnected' as ConnectionStatus,
  biometricSource: 'none' as BiometricSource,
  permissions: { bluetooth: 'unknown' as Grant, health: 'unknown' as Grant },
};

export type WarmStore = StoreApi<WarmState>;

export function createWarmStore(): WarmStore {
  return createStore<WarmState>((set) => ({
    ...baseline,

    setLiveHr(hr: number) {
      if (!isPlausibleHr(hr)) return; // keep last good value
      set({ liveHr: hr });
    },

    setConnection(status: ConnectionStatus) {
      set({ connection: status });
    },

    setBiometricSource(source: BiometricSource) {
      set({ biometricSource: source });
    },

    // The Background Permission Revocation reconciler. If either required grant is
    // no longer 'granted', the biometric pipeline is severed: source → none, any
    // in-memory HR is dropped (never serve stale). It does NOT touch `connection`:
    // that is the independent Kokonada SERVER-socket status, and killing the
    // biometric transport (Bluetooth off) must not fake a socket disconnect. (S12-1)
    // Re-granting does NOT resurrect the old HR — a fresh reading must arrive.
    setPermissions(perms: Permissions) {
      const severed = perms.bluetooth !== 'granted' && perms.health !== 'granted'
        ? true
        : perms.bluetooth === 'denied' || perms.health === 'denied';
      if (severed) {
        set({ permissions: perms, biometricSource: 'none', liveHr: null });
      } else {
        set({ permissions: perms, liveHr: null });
      }
    },

    reset() {
      set({ ...baseline, permissions: { ...baseline.permissions } });
    },
  }));
}
