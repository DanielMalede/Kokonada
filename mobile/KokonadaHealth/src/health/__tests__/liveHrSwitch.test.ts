// H2 (compliance B5 / C2) — the durable, per-account "live heart rate switched off" marker.
//
// Disconnect on the Live heart rate card used to last only until the next app start: the next boot
// re-minted the credential and restarted the stream on its own. The marker makes the user's choice
// stick — per account (a shared phone never leaks account A's choice to account B), across restarts
// (a persisted KV, not memory), until an explicit wearable-path action switches it back on.
//
// Real semantics: the switch runs over a REAL key-value map (the prod port is encrypted MMKV behind
// the same two-method interface), and "survives a restart" is proven by building a SECOND switch over
// the same storage — the way a fresh process would.

import { createLiveHrSwitch, liveHrOffKey, liveHrSwitch, bindLiveHrSwitchKV } from '../liveHrSwitch';
import { currentUserStore } from '../../auth/currentUser';

function makeKv() {
  const map = new Map<string, string>();
  return {
    map,
    kv: {
      getString: (k: string) => map.get(k),
      set: (k: string, v: string) => { map.set(k, v); },
    },
  };
}

describe('liveHrSwitch — the durable per-account live-HR off marker', () => {
  it('a signed-in account that never pressed Disconnect is not switched off', () => {
    const { kv } = makeKv();
    const sw = createLiveHrSwitch(kv, () => 'user-a');
    expect(sw.isOff()).toBe(false);
  });

  it('switchOff survives a restart: a fresh switch over the same storage still reads it', () => {
    const { kv, map } = makeKv();
    createLiveHrSwitch(kv, () => 'user-a').switchOff();
    expect(map.get(liveHrOffKey('user-a'))).toBe('1');
    expect(createLiveHrSwitch(kv, () => 'user-a').isOff()).toBe(true);
  });

  it('is per account: account A switching off never switches off account B on the same phone', () => {
    const { kv } = makeKv();
    let uid = 'user-a';
    const sw = createLiveHrSwitch(kv, () => uid);
    sw.switchOff();
    uid = 'user-b';
    expect(sw.isOff()).toBe(false);
    uid = 'user-a';
    expect(sw.isOff()).toBe(true);
  });

  it('switchOn (an explicit wearable link) clears it, durably', () => {
    const { kv } = makeKv();
    const sw = createLiveHrSwitch(kv, () => 'user-a');
    sw.switchOff();
    sw.switchOn();
    expect(sw.isOff()).toBe(false);
    expect(createLiveHrSwitch(kv, () => 'user-a').isOff()).toBe(false);
  });

  it('no identity: reads as off (nothing to run a feed for) and writes nothing keyed on null', () => {
    const { kv, map } = makeKv();
    const sw = createLiveHrSwitch(kv, () => null);
    expect(sw.isOff()).toBe(true);
    sw.switchOff();
    sw.switchOn();
    expect(map.size).toBe(0);
  });

  it('an unreadable store fails closed to off — a Disconnect is never silently forgotten', () => {
    const sw = createLiveHrSwitch(
      { getString: () => { throw new Error('keystore locked'); }, set: () => {} },
      () => 'user-a',
    );
    expect(sw.isOff()).toBe(true);
  });

  it('a failed write is still honoured for the rest of this process', () => {
    const sw = createLiveHrSwitch(
      { getString: () => undefined, set: () => { throw new Error('disk full'); } },
      () => 'user-a',
    );
    expect(() => sw.switchOff()).not.toThrow();
    expect(sw.isOff()).toBe(true);
    expect(() => sw.switchOn()).not.toThrow();
    expect(sw.isOff()).toBe(false);
  });

  it('no store at all (secure store unavailable): in-memory only, never throws', () => {
    const sw = createLiveHrSwitch(undefined, () => 'user-a');
    expect(sw.isOff()).toBe(false);
    sw.switchOff();
    expect(sw.isOff()).toBe(true);
  });

  it('the key lives outside the cold.* namespace, so logout\'s cold wipe never erases the choice', () => {
    expect(liveHrOffKey('user-a')).toBe('koko.liveHr.user-a.off');
    expect(liveHrOffKey('user-a').startsWith('cold.')).toBe(false);
  });
});

describe('liveHrSwitch — the prod singleton', () => {
  afterEach(() => { currentUserStore.getState().clear(); });

  // The identity comes straight from the signed-in user, NOT from a late binding: a device whose
  // encrypted store failed to open never binds a KV, and a switch with no identity reads as OFF —
  // tying identity to the KV bind would have switched live HR off for every account on that device.
  it('reads the signed-in account even when no store was ever bound (in-memory only)', () => {
    currentUserStore.getState().setUser({ id: 'user-a', displayName: 'A', email: 'a@x.io' } as any);
    expect(liveHrSwitch.isOff()).toBe(false);
    liveHrSwitch.switchOff();
    expect(liveHrSwitch.isOff()).toBe(true);
    liveHrSwitch.switchOn();
    expect(liveHrSwitch.isOff()).toBe(false);
  });

  it('signed out: reads as off', () => {
    expect(liveHrSwitch.isOff()).toBe(true);
  });

  it('once a store is bound, the choice is written through to it', () => {
    const { kv, map } = makeKv();
    bindLiveHrSwitchKV(kv);
    currentUserStore.getState().setUser({ id: 'user-b', displayName: 'B', email: 'b@x.io' } as any);
    liveHrSwitch.switchOff();
    expect(map.get(liveHrOffKey('user-b'))).toBe('1');
  });
});
