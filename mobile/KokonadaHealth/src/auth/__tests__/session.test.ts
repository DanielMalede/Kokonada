// C1 (B1 P1 charter §2): the one session record as the phone stores it — the real AuthSession over the
// real keychainSession, with the Keychain replaced by a stateful fake that keeps one item per service, as
// react-native-keychain does. Only the network is absent.

const mockItems = new Map<string, string>();
jest.mock('react-native-keychain', () => ({
  setGenericPassword: jest.fn(async (_user: string, password: string, opts: { service: string }) => {
    mockItems.set(opts.service, password);
    return true;
  }),
  getGenericPassword: jest.fn(async (opts: { service: string }) => {
    const password = mockItems.get(opts.service);
    return password === undefined ? false : { username: 'session', password, service: opts.service };
  }),
  resetGenericPassword: jest.fn(async (opts: { service: string }) => { mockItems.delete(opts.service); return true; }),
}));

import { AuthSession } from '../authSession';
import { keychainSession } from '../session';

const SERVICE = 'com.kokonadahealth.session';
const UID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const stored = () => (mockItems.has(SERVICE) ? JSON.parse(mockItems.get(SERVICE) as string) : null);

beforeEach(() => { mockItems.clear(); });

function sessionOver(refreshAnswer?: { access: string; refresh: string }) {
  return new AuthSession({
    ...keychainSession,
    refreshEndpoint: async () => (refreshAnswer ? { kind: 'ok', tokens: refreshAnswer } : { kind: 'unavailable' }),
  });
}

describe('keychainSession — the v2 record is one Keychain item', () => {
  it('a v2 sign-in writes {v:2, access, refresh, uid, age} as one item', async () => {
    const s = sessionOver();
    await s.setSession({ v: 2, access: 'a', refresh: 'r', uid: UID, age: { over16: true, on: '2026-11-28' } });
    expect(mockItems.size).toBe(1);
    expect(stored()).toEqual({ v: 2, access: 'a', refresh: 'r', uid: UID, age: { over16: true, on: '2026-11-28' } });
  });

  it('a new process reads it back with its uid, and a rotation rewrites it with uid and age kept', async () => {
    await sessionOver().setSession({ v: 2, access: 'a', refresh: 'r', uid: UID, age: { over16: true, on: '2026-11-28' } });
    const next = sessionOver({ access: 'a2', refresh: 'r2' });
    expect(await next.bootstrap()).toBe(true);
    expect(next.getSessionUid()).toBe(UID);
    expect(await next.refresh()).toBe('a2');
    expect(stored()).toEqual({ v: 2, access: 'a2', refresh: 'r2', uid: UID, age: { over16: true, on: '2026-11-28' } });
  });

  it('a v1 pair already on the phone reads as v1, and v1 rotations keep writing the bare pair', async () => {
    mockItems.set(SERVICE, JSON.stringify({ access: 'old', refresh: 'old-r' }));
    const s = sessionOver({ access: 'new', refresh: 'new-r' });
    expect(await s.bootstrap()).toBe(true);
    expect(s.getSessionUid()).toBeNull();
    await s.refresh();
    expect(stored()).toEqual({ access: 'new', refresh: 'new-r' });
  });

  it('the age consent never reaches the device', async () => {
    const s = sessionOver();
    const age = { over16: true, on: '2026-11-28', consent: { version: '1', language: 'he', hash: 'a'.repeat(64) } };
    await s.setSession({ v: 2, access: 'a', refresh: 'r', uid: UID, age } as any);
    expect(mockItems.get(SERVICE)).not.toMatch(/consent|hash|language|"he"/);
  });

  it('the record goes with the tokens: an end leaves nothing on the device', async () => {
    const s = sessionOver();
    await s.setSession({ v: 2, access: 'a', refresh: 'r', uid: UID, age: { over16: true, on: '2026-11-28' } });
    await s.clear();
    expect(mockItems.size).toBe(0);
    const next = sessionOver();
    expect(await next.bootstrap()).toBe(false);
    expect(next.getSessionUid()).toBeNull();
  });

  it.each([
    ['not JSON', '{oops'],
    ['JSON null', 'null'],
    ['a number', '42'],
    ['a string', '"tok"'],
    ['an array', '[1,2]'],
  ])('a stored item that is %s reads as no session', async (_l, raw) => {
    mockItems.set(SERVICE, raw);
    expect(await keychainSession.loadTokens()).toBeNull();
    expect(await sessionOver().bootstrap()).toBe(false);
  });
});
