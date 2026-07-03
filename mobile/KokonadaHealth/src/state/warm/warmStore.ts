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

// A permission set severs the biometric pipeline if either grant is explicitly
// denied, or if neither grant is present at all.
function isSevered(perms: Permissions): boolean {
  if (perms.bluetooth === 'denied' || perms.health === 'denied') return true;
  return perms.bluetooth !== 'granted' && perms.health !== 'granted';
}

export function createWarmStore(): WarmStore {
  return createStore<WarmState>((set, get) => ({
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
    //
    // Crucially, this runs on EVERY foreground (reconcileOnForeground), usually with
    // unchanged, already-granted permissions. A no-op re-confirmation must be inert —
    // wiping the live HR each foreground was a state-corruption bug (QA4 Q1) that
    // blanked the Pulse reading on every app resume. Only sever/recovery TRANSITIONS
    // touch the HR. (This bug only became observable once Suspect #3 wired the BLE
    // stream into the warm lane.)
    setPermissions(perms: Permissions) {
      const wasSevered = isSevered(get().permissions);
      const nowSevered = isSevered(perms);
      if (nowSevered) {
        set({ permissions: perms, biometricSource: 'none', liveHr: null });
      } else if (wasSevered) {
        // Recovering from a severed state — require a fresh reading, drop any stale HR.
        set({ permissions: perms, liveHr: null });
      } else {
        // No-op re-confirmation of already-healthy permissions — leave the HR intact.
        set({ permissions: perms });
      }
    },

    reset() {
      set({ ...baseline, permissions: { ...baseline.permissions } });
    },
  }));
}
