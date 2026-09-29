// H2 (compliance B5 / C2, review H2-C1) — the durable, per-account wearable link on THIS phone,
// and the live-HR switch that lives inside it.
//
// Three states per account, persisted:
//   • nothing stored — this account never linked a wearable on this phone (or withdrew since): the
//     health lane stays shut, whatever Health Connect grant the PHONE holds for another account;
//   • 'on'  — linked here, live heart rate on (written only by an explicit wearable link);
//   • 'off' — linked here, live heart rate off (Disconnect): the Art.9 sync may run, the feed may not.
// Unknown always reads as the closed state: no identity, an unreadable store, or a value this build
// does not recognise.
//
// Real semantics: the switch runs over a REAL key-value map (the prod port is encrypted MMKV behind
// the same interface), and "survives a restart" is proven by building a SECOND switch over the same
// storage — the way a fresh process would.

import { createLiveHrSwitch, liveHrLinkKey, liveHrSwitch, bindLiveHrSwitchKV } from '../liveHrSwitch';
import { currentUserStore } from '../../auth/currentUser';

function makeKv() {
  const map = new Map<string, string>();
  return {
    map,
    kv: {
      getString: (k: string) => map.get(k),
      set: (k: string, v: string) => { map.set(k, v); },
      delete: (k: string) => { map.delete(k); },
    },
  };
}

describe('liveHrSwitch — the per-account wearable link on this phone', () => {
  it('an account that never linked a wearable on this phone is NOT linked, and its live HR reads as off', () => {
    const { kv } = makeKv();
    const sw = createLiveHrSwitch(kv, () => 'user-a');
    expect(sw.isLinkedHere()).toBe(false);
    expect(sw.isOff()).toBe(true);
  });

  it('an explicit link marks the account linked with live HR on, and survives a restart', () => {
    const { kv, map } = makeKv();
    createLiveHrSwitch(kv, () => 'user-a').markLinked();
    expect(map.get(liveHrLinkKey('user-a'))).toBe('on');
    const next = createLiveHrSwitch(kv, () => 'user-a');
    expect(next.isLinkedHere()).toBe(true);
    expect(next.isOff()).toBe(false);
  });

  it('is per account: account A\'s link on this phone never links account B', () => {
    const { kv } = makeKv();
    let uid = 'user-a';
    const sw = createLiveHrSwitch(kv, () => uid);
    sw.markLinked();
    uid = 'user-b';
    expect(sw.isLinkedHere()).toBe(false);
    expect(sw.isOff()).toBe(true);
    uid = 'user-a';
    expect(sw.isLinkedHere()).toBe(true);
  });

  it('a stored value this build does not recognise reads as not linked (fail closed)', () => {
    const { kv, map } = makeKv();
    map.set(liveHrLinkKey('user-a'), '1');
    const sw = createLiveHrSwitch(kv, () => 'user-a');
    expect(sw.isLinkedHere()).toBe(false);
    expect(sw.isOff()).toBe(true);
  });
});

describe('liveHrSwitch — Disconnect keeps the link and switches live HR off', () => {
  it('switchOff after a link: still linked, live HR off, durably', () => {
    const { kv, map } = makeKv();
    const sw = createLiveHrSwitch(kv, () => 'user-a');
    sw.markLinked();
    sw.switchOff();
    expect(map.get(liveHrLinkKey('user-a'))).toBe('off');
    const next = createLiveHrSwitch(kv, () => 'user-a');
    expect(next.isLinkedHere()).toBe(true);
    expect(next.isOff()).toBe(true);
  });

  it('switchOff NEVER creates a link: a Disconnect on an unlinked account leaves it unlinked', () => {
    const { kv, map } = makeKv();
    const sw = createLiveHrSwitch(kv, () => 'user-a');
    sw.switchOff();
    expect(sw.isLinkedHere()).toBe(false);
    expect(map.has(liveHrLinkKey('user-a'))).toBe(false);
  });

  it('a new explicit link switches live HR back on', () => {
    const { kv } = makeKv();
    const sw = createLiveHrSwitch(kv, () => 'user-a');
    sw.markLinked();
    sw.switchOff();
    sw.markLinked();
    expect(createLiveHrSwitch(kv, () => 'user-a').isOff()).toBe(false);
  });
});

describe('liveHrSwitch — a withdrawal ends the link', () => {
  it('unlink removes the stored link, so a restart reads the account as never linked', () => {
    const { kv, map } = makeKv();
    const sw = createLiveHrSwitch(kv, () => 'user-a');
    sw.markLinked();
    sw.unlink();
    expect(map.has(liveHrLinkKey('user-a'))).toBe(false);
    expect(sw.isLinkedHere()).toBe(false);
    expect(createLiveHrSwitch(kv, () => 'user-a').isLinkedHere()).toBe(false);
  });

  it('unlink after a Disconnect also ends the link', () => {
    const { kv } = makeKv();
    const sw = createLiveHrSwitch(kv, () => 'user-a');
    sw.markLinked();
    sw.switchOff();
    sw.unlink();
    expect(createLiveHrSwitch(kv, () => 'user-a').isLinkedHere()).toBe(false);
  });

  it('unlinking account A leaves account B\'s link on this phone alone', () => {
    const { kv } = makeKv();
    let uid = 'user-b';
    const sw = createLiveHrSwitch(kv, () => uid);
    sw.markLinked();
    uid = 'user-a';
    sw.markLinked();
    sw.unlink();
    uid = 'user-b';
    expect(sw.isLinkedHere()).toBe(true);
  });
});

describe('liveHrSwitch — failure modes', () => {
  it('no identity: not linked, off, and nothing is written keyed on null', () => {
    const { kv, map } = makeKv();
    const sw = createLiveHrSwitch(kv, () => null);
    expect(sw.isLinkedHere()).toBe(false);
    expect(sw.isOff()).toBe(true);
    sw.markLinked();
    sw.switchOff();
    sw.unlink();
    expect(map.size).toBe(0);
  });

  it('an unreadable store fails closed: not linked, off', () => {
    const sw = createLiveHrSwitch(
      { getString: () => { throw new Error('keystore locked'); }, set: () => {}, delete: () => {} },
      () => 'user-a',
    );
    expect(sw.isLinkedHere()).toBe(false);
    expect(sw.isOff()).toBe(true);
  });

  it('a failed write is still honoured for the rest of this process', () => {
    const sw = createLiveHrSwitch(
      {
        getString: () => undefined,
        set: () => { throw new Error('disk full'); },
        delete: () => { throw new Error('disk full'); },
      },
      () => 'user-a',
    );
    expect(() => sw.markLinked()).not.toThrow();
    expect(sw.isLinkedHere()).toBe(true);
    expect(sw.isOff()).toBe(false);
    expect(() => sw.switchOff()).not.toThrow();
    expect(sw.isOff()).toBe(true);
    expect(() => sw.unlink()).not.toThrow();
    expect(sw.isLinkedHere()).toBe(false);
  });

  it('a failed delete never lets a stored link come back in this process', () => {
    const { map } = makeKv();
    const kv = {
      getString: (k: string) => map.get(k),
      set: (k: string, v: string) => { map.set(k, v); },
      delete: () => { throw new Error('disk full'); },
    };
    const sw = createLiveHrSwitch(kv, () => 'user-a');
    sw.markLinked();
    sw.unlink();
    expect(sw.isLinkedHere()).toBe(false);
  });

  it('no store at all (secure store unavailable): in-memory only, never throws', () => {
    const sw = createLiveHrSwitch(undefined, () => 'user-a');
    expect(sw.isLinkedHere()).toBe(false);
    sw.markLinked();
    expect(sw.isLinkedHere()).toBe(true);
    sw.switchOff();
    expect(sw.isOff()).toBe(true);
  });

  it('the key lives outside the cold.* namespace, so logout\'s cold wipe never erases the link', () => {
    expect(liveHrLinkKey('user-a')).toBe('koko.liveHr.user-a.link');
    expect(liveHrLinkKey('user-a').startsWith('cold.')).toBe(false);
  });
});

describe('liveHrSwitch — the prod singleton', () => {
  afterEach(() => { currentUserStore.getState().clear(); });

  // The identity comes straight from the signed-in user, NOT from a late binding: a device whose
  // encrypted store failed to open never binds a KV, and the in-process decision must still hold.
  it('reads the signed-in account even when no store was ever bound (in-memory only)', () => {
    currentUserStore.getState().setUser({ id: 'user-a', displayName: 'A', email: 'a@x.io' } as any);
    expect(liveHrSwitch.isLinkedHere()).toBe(false);
    liveHrSwitch.markLinked();
    expect(liveHrSwitch.isLinkedHere()).toBe(true);
    liveHrSwitch.switchOff();
    expect(liveHrSwitch.isOff()).toBe(true);
    liveHrSwitch.unlink();
    expect(liveHrSwitch.isLinkedHere()).toBe(false);
  });

  it('signed out: not linked, off', () => {
    expect(liveHrSwitch.isLinkedHere()).toBe(false);
    expect(liveHrSwitch.isOff()).toBe(true);
  });

  it('once a store is bound, every decision is written through to it', () => {
    const { kv, map } = makeKv();
    bindLiveHrSwitchKV(kv);
    currentUserStore.getState().setUser({ id: 'user-b', displayName: 'B', email: 'b@x.io' } as any);
    liveHrSwitch.markLinked();
    expect(map.get(liveHrLinkKey('user-b'))).toBe('on');
    liveHrSwitch.switchOff();
    expect(map.get(liveHrLinkKey('user-b'))).toBe('off');
    liveHrSwitch.unlink();
    expect(map.has(liveHrLinkKey('user-b'))).toBe(false);
  });
});
