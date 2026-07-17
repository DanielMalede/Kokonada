import {
  createConnectStore,
  connectStore,
  bindConnectKV,
  resolvedKey,
  moodOnlyKey,
} from '../connectStore';

// The §4 forward-gate flags, per-userId device KV (Decision 2 = A). Two facts:
//   • resolved — has this account, on this device, finished (or escaped) Connect Services?
//                One-way; it gates AppFlow's `connect` vs `app` route.
//   • moodOnly — did the account choose the mood-only path? (implies resolved)
// Keyed by userId so account A's choice never leaks to account B on a shared device, and
// (unlike the cold slice) NOT under the `cold.` prefix, so it survives logout — it is a
// per-DEVICE-per-ACCOUNT preference. Best-effort persistence never throws into render.

interface FakeKV {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  __map: Map<string, string>;
}
function makeKV(seed?: Record<string, string>): FakeKV {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return { __map: map, getString: (k) => map.get(k), set: (k, v) => { map.set(k, v); } };
}

describe('connectStore — per-userId forward-gate flags', () => {
  it('defaults to unresolved, not-mood-only (a fresh account sees Connect Services)', () => {
    const s = createConnectStore(makeKV(), () => 'uA');
    expect(s.getState().resolved).toBe(false);
    expect(s.getState().moodOnly).toBe(false);
  });

  it('markResolved is a one-way flip to resolved AND persists under the per-uid key', () => {
    const kv = makeKV();
    const s = createConnectStore(kv, () => 'uA');
    s.getState().markResolved();
    expect(s.getState().resolved).toBe(true);
    expect(s.getState().moodOnly).toBe(false); // resolving via wearable is NOT mood-only
    expect(kv.__map.get(resolvedKey('uA'))).toBe('1');
  });

  it('setMoodOnly sets moodOnly AND resolved, persisting BOTH per-uid keys', () => {
    const kv = makeKV();
    const s = createConnectStore(kv, () => 'uA');
    s.getState().setMoodOnly();
    expect(s.getState().moodOnly).toBe(true);
    expect(s.getState().resolved).toBe(true); // mood-only satisfies the forward gate
    expect(kv.__map.get(moodOnlyKey('uA'))).toBe('1');
    expect(kv.__map.get(resolvedKey('uA'))).toBe('1');
  });

  it('exposes NO reset/unresolve surface — the gate flags are one-way', () => {
    const s = createConnectStore(makeKV(), () => 'uA');
    const api = s.getState() as unknown as Record<string, unknown>;
    expect(api.reset).toBeUndefined();
    expect(api.unresolve).toBeUndefined();
    expect(api.clear).toBeUndefined();
  });

  it('is per-userId isolated: uid A resolved leaves uid B unresolved (no cross-account leak)', () => {
    const kv = makeKV();
    let uid = 'uA';
    const s = createConnectStore(kv, () => uid);
    s.getState().markResolved(); // A resolves
    expect(kv.__map.get(resolvedKey('uA'))).toBe('1');
    // account switch on the same device → re-hydrate for B, who never resolved
    uid = 'uB';
    s.getState().hydrate();
    expect(s.getState().resolved).toBe(false);
    expect(s.getState().moodOnly).toBe(false);
    // …and switching back to A restores A's resolved flag
    uid = 'uA';
    s.getState().hydrate();
    expect(s.getState().resolved).toBe(true);
  });

  it('hydrate reads the persisted per-uid flags into state', () => {
    const s = createConnectStore(makeKV({ [resolvedKey('uA')]: '1', [moodOnlyKey('uA')]: '1' }), () => 'uA');
    expect(s.getState().resolved).toBe(false); // not yet hydrated
    s.getState().hydrate();
    expect(s.getState().resolved).toBe(true);
    expect(s.getState().moodOnly).toBe(true);
  });

  it('with no identity yet (uid null) hydrate resets to defaults and setters do not persist', () => {
    const kv = makeKV();
    const s = createConnectStore(kv, () => null);
    s.getState().markResolved();
    expect(s.getState().resolved).toBe(true); // in-memory flip still happens
    expect([...kv.__map.keys()]).toHaveLength(0); // …but nothing is written without a uid
    s.getState().hydrate();
    expect(s.getState().resolved).toBe(false); // no uid → defaults
  });

  it('a corrupt/throwing KV never crashes hydrate or the setters (best-effort persistence)', () => {
    const brittle = {
      getString: () => { throw new Error('mmkv unavailable'); },
      set: () => { throw new Error('disk full'); },
    };
    const s = createConnectStore(brittle, () => 'uA');
    expect(() => s.getState().hydrate()).not.toThrow();
    expect(() => s.getState().markResolved()).not.toThrow();
    expect(() => s.getState().setMoodOnly()).not.toThrow();
    expect(s.getState().resolved).toBe(true); // in-memory flip survived the KV failure
  });
});

describe('connectStore — bound prod singleton', () => {
  it('bindConnectKV attaches the late-bound KV + getUserId and hydrates for the current account', () => {
    const kv = makeKV({ [resolvedKey('me')]: '1' });
    // reset the singleton's in-memory state before binding (test isolation)
    connectStore.setState({ resolved: false, moodOnly: false });
    bindConnectKV(kv, () => 'me');
    expect(connectStore.getState().resolved).toBe(true);
    // a subsequent setMoodOnly writes through the bound KV under the bound uid
    connectStore.getState().setMoodOnly();
    expect(kv.__map.get(moodOnlyKey('me'))).toBe('1');
  });
});
