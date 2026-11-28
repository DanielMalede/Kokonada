// C3 (B1 P1 charter §2): the identity is getSessionUid(), the session record's uid, read from the one
// AuthSession the app holds; getCurrentUserId() keeps v1's semantics (the in-memory user store) until
// the cutover. Over the real singleton; the Keychain is jest.setup.js's global mock.

import { currentUserStore, getCurrentUserId, getSessionUid } from '../currentUser';
import { authSession } from '../session';

const UID = '65f0c0ffee0123456789abcd';

afterEach(async () => {
  await authSession.clear();
  currentUserStore.getState().clear();
});

describe('C3 — getSessionUid()', () => {
  it('is the v2 session record uid', async () => {
    await authSession.setSession({ v: 2, access: 'a', refresh: 'r', uid: UID });
    expect(getSessionUid()).toBe(UID);
  });

  it('is null for a v1 pair, with no session, and after the session ends', async () => {
    expect(getSessionUid()).toBeNull();
    await authSession.setSession({ access: 'a', refresh: 'r' });
    expect(getSessionUid()).toBeNull();
    await authSession.setSession({ v: 2, access: 'a', refresh: 'r', uid: UID });
    await authSession.clear();
    expect(getSessionUid()).toBeNull();
  });

  it('never reads the v1 user store', async () => {
    currentUserStore.getState().setUser({ id: 'u1', displayName: 'D', email: 'd@x.io' });
    expect(getSessionUid()).toBeNull();
  });
});

describe('C3 — getCurrentUserId() keeps v1 semantics until the cutover', () => {
  it('reads the user store, whatever the session record holds', async () => {
    await authSession.setSession({ v: 2, access: 'a', refresh: 'r', uid: UID });
    expect(getCurrentUserId()).toBeNull();
    currentUserStore.getState().setUser({ id: 'u1', displayName: 'D', email: 'd@x.io' });
    expect(getCurrentUserId()).toBe('u1');
    await authSession.clear();
    expect(getCurrentUserId()).toBe('u1');
  });
});
