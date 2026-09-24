// H2 (compliance B5 / C2) — the durable, per-account "live heart rate switched off" marker.
//
// The live-HR lane opens on the device's wearable link (the Health Connect grant, reachable only
// through the Art.9 consent wall) plus a fresh server grant. Neither of those changes when the user
// presses Disconnect on the Live heart rate card, so without this marker the next app start re-minted
// the credential and restarted the stream on its own. The marker is the user's choice made durable:
//
//   • per ACCOUNT — keyed by userId, so a shared phone never carries account A's choice to account B;
//   • PERSISTED — the same encrypted KV port the Connect flags use, outside the `cold.` namespace, so
//     logout's cold wipe never erases it (it is a preference, not session state);
//   • cleared ONLY by an explicit wearable-path action (a Health Connect link through the consent
//     wall — connectController.runSync), never inferred from a cached credential or a server field.
//
// Fails closed: with no identity, or a store that cannot be read, the switch reads as OFF. A write
// that fails is still honoured for the rest of this process.

import { getCurrentUserId } from '../auth/currentUser';

export const LIVE_HR_KEY_PREFIX = 'koko.liveHr';
export const liveHrOffKey = (uid: string): string => `${LIVE_HR_KEY_PREFIX}.${uid}.off`;

interface KV {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
}

export interface LiveHrSwitch {
  isOff(): boolean;
  switchOff(): void;
  switchOn(): void;
}

export function createLiveHrSwitch(kv: KV | undefined, getUserId: () => string | null): LiveHrSwitch {
  // What this process decided, per account — so a failed write cannot undo a Disconnect.
  const decided = new Map<string, boolean>();

  const write = (off: boolean) => {
    const uid = getUserId();
    if (!uid) return;
    decided.set(uid, off);
    try { kv?.set(liveHrOffKey(uid), off ? '1' : '0'); } catch { /* the in-process decision stands */ }
  };

  return {
    isOff() {
      const uid = getUserId();
      if (!uid) return true;
      const known = decided.get(uid);
      if (known !== undefined) return known;
      try {
        return kv?.getString(liveHrOffKey(uid)) === '1';
      } catch {
        return true;
      }
    },
    switchOff: () => write(true),
    switchOn: () => write(false),
  };
}

// Prod singleton. The identity is read straight from the signed-in user; only the encrypted KV binds
// late (it is created async at bootstrap). Deliberately NOT a late-bound identity: a device whose
// secure store failed to open never binds, and a switch with no identity reads as off — so tying the
// identity to the bind would switch live HR off for every account on that device.
let _boundKv: KV | undefined;
export const liveHrSwitch = createLiveHrSwitch(
  { getString: (k) => _boundKv?.getString(k), set: (k, v) => { _boundKv?.set(k, v); } },
  getCurrentUserId,
);
export function bindLiveHrSwitchKV(kv: KV): void {
  _boundKv = kv;
}
