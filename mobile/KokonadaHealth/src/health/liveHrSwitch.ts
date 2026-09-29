// H2 (compliance B5 / C2, review H2-C1) — the durable, per-account wearable link on THIS phone, and
// the live-HR switch that lives inside it.
//
// The health lane used to treat "this phone holds a Health Connect grant for Kokonada" as the
// wearable opt-in. That grant belongs to the PHONE, while the Art.9 consent belongs to the ACCOUNT
// and can be given on any phone — so an account that signed in on a phone where ANOTHER account had
// linked Health Connect opened the lane without ever choosing the wearable path here. The opt-in is
// now this marker, one per account per phone, in three states:
//
//   • nothing stored — this account never made a wearable link on this phone (or withdrew since):
//     the lane stays shut, whatever grant the phone holds;
//   • 'on'  — linked here, live heart rate on. Written ONLY by an explicit wearable link (a real
//     Health Connect grant through the consent wall — connectController.runSync → onWearableLinked);
//   • 'off' — linked here, live heart rate switched off (Disconnect on the Live heart rate card): the
//     Art.9 gate still reports open, so the Health Connect sync may run, but the feed may not.
//
// The marker is PERSISTED (the same encrypted KV port the Connect flags use, outside the `cold.`
// namespace, so logout's cold wipe never erases it — it is a choice, not session state) and never
// inferred from a cached credential or a server field. It fails closed: no identity, a store that
// cannot be read, or a value this build does not recognise all read as not linked. A write that
// fails is still honoured for the rest of this process.

import { getCurrentUserId } from '../auth/currentUser';

export const LIVE_HR_KEY_PREFIX = 'koko.liveHr';
export const liveHrLinkKey = (uid: string): string => `${LIVE_HR_KEY_PREFIX}.${uid}.link`;

type Link = 'on' | 'off' | null; // null: not linked on this phone

interface KV {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
}

export interface LiveHrSwitch {
  /** This account made an explicit wearable link on THIS phone, and has not withdrawn since. */
  isLinkedHere(): boolean;
  /** Live heart rate is not switched on: not linked here, switched off (Disconnect), or unknown. */
  isOff(): boolean;
  /** An explicit wearable link on this phone: linked, live heart rate on. */
  markLinked(): void;
  /** Disconnect: live heart rate off, still linked. Never creates a link that was not there. */
  switchOff(): void;
  /** A consent withdrawal: the link is gone; only a new explicit link restores it. */
  unlink(): void;
}

export function createLiveHrSwitch(kv: KV | undefined, getUserId: () => string | null): LiveHrSwitch {
  // What this process decided, per account — so a failed write cannot undo a link, a Disconnect or
  // a withdrawal.
  const decided = new Map<string, Link>();

  const read = (uid: string): Link => {
    if (decided.has(uid)) return decided.get(uid) ?? null;
    try {
      const v = kv?.getString(liveHrLinkKey(uid));
      return v === 'on' || v === 'off' ? v : null;
    } catch {
      return null;
    }
  };

  const write = (uid: string, link: Link) => {
    decided.set(uid, link);
    try {
      if (link === null) kv?.delete(liveHrLinkKey(uid));
      else kv?.set(liveHrLinkKey(uid), link);
    } catch { /* the in-process decision stands */ }
  };

  return {
    isLinkedHere() {
      const uid = getUserId();
      return uid ? read(uid) !== null : false;
    },
    isOff() {
      const uid = getUserId();
      return uid ? read(uid) !== 'on' : true;
    },
    markLinked() {
      const uid = getUserId();
      if (uid) write(uid, 'on');
    },
    switchOff() {
      const uid = getUserId();
      if (uid && read(uid) !== null) write(uid, 'off');
    },
    unlink() {
      const uid = getUserId();
      if (uid) write(uid, null);
    },
  };
}

// Prod singleton. The identity is read straight from the signed-in user; only the encrypted KV binds
// late (it is created async at bootstrap). Deliberately NOT a late-bound identity: a device whose
// secure store failed to open never binds, and the in-process decisions must still hold there.
let _boundKv: KV | undefined;
export const liveHrSwitch = createLiveHrSwitch(
  {
    getString: (k) => _boundKv?.getString(k),
    set: (k, v) => { _boundKv?.set(k, v); },
    delete: (k) => { _boundKv?.delete(k); },
  },
  getCurrentUserId,
);
export function bindLiveHrSwitchKV(kv: KV): void {
  _boundKv = kv;
}
