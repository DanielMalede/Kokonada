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

// Prod singleton. The encrypted KV and the identity are known only at/after bootstrap, so it reads
// and writes through late-bound references (mirrors connectStore's bindConnectKV).
let _boundKv: KV | undefined;
let _getUserId: (() => string | null) | undefined;
export const liveHrSwitch = createLiveHrSwitch(
  { getString: (k) => _boundKv?.getString(k), set: (k, v) => { _boundKv?.set(k, v); } },
  () => _getUserId?.() ?? null,
);
export function bindLiveHrSwitchKV(kv: KV, getUserId: () => string | null): void {
  _boundKv = kv;
  _getUserId = getUserId;
}
