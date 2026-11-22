'use strict';

// BE-219 — Garmin's user permissions, parsed CLOSED.
//
// Garmin reports what a user granted in two places: GET /wellness-api/rest/user/permissions at connect, and the
// `userPermissionsChange` notification after it. The PKCE spec (2025-07-23) names five values in its example
// (ACTIVITY_EXPORT, WORKOUT_IMPORT, HEALTH_EXPORT, COURSE_IMPORT, MCT_EXPORT) and prints the body as
// `{["…", …]}`, which is not JSON, so the reader accepts exactly two shapes (a bare JSON array, or an object whose
// `permissions` is one) and nothing else. Every value it does not know is ignored and counted, never kept, and a
// shape it cannot read is "unknown", never "nothing granted": a malformed notice must not purge anybody.
//
// Real semantics: the REAL module; the REAL User model and its REAL encrypted token blob on a REAL Mongo for the
// stored-permission read.
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';

const perms = require('../app/services/wearable/garminPermissions');

describe('parsePermissionList — closed', () => {
  it('keeps the known values, sorted and de-duplicated, and counts the rest', () => {
    expect(perms.parsePermissionList(['WORKOUT_IMPORT', 'HEALTH_EXPORT', 'HEALTH_EXPORT', 'ACTIVITY_EXPORT']))
      .toEqual({ permissions: ['ACTIVITY_EXPORT', 'HEALTH_EXPORT', 'WORKOUT_IMPORT'], unknown: 0 });
    expect(perms.parsePermissionList(['HEALTH_EXPORT', 'health_export', 'NEW_THING', 7, null, { $gt: '' }]))
      .toEqual({ permissions: ['HEALTH_EXPORT'], unknown: 5 });
    expect(perms.parsePermissionList([])).toEqual({ permissions: [], unknown: 0 });
  });

  it('every value the spec names is known', () => {
    expect(perms.parsePermissionList(['ACTIVITY_EXPORT', 'WORKOUT_IMPORT', 'HEALTH_EXPORT', 'COURSE_IMPORT', 'MCT_EXPORT']).unknown).toBe(0);
  });

  it.each([[undefined], [null], ['HEALTH_EXPORT'], [{ permissions: ['HEALTH_EXPORT'] }], [42], [{}]])(
    'a value that is not an array (%p) is unreadable: null, never an empty grant',
    (raw) => { expect(perms.parsePermissionList(raw)).toBeNull(); },
  );
});

describe('parsePermissionsResponse — the GET /user/permissions body', () => {
  it('reads a bare JSON array and an object carrying `permissions`', () => {
    expect(perms.parsePermissionsResponse(['HEALTH_EXPORT'])).toEqual({ permissions: ['HEALTH_EXPORT'], unknown: 0 });
    expect(perms.parsePermissionsResponse({ permissions: ['MCT_EXPORT', 'HEALTH_EXPORT'] })).toEqual({ permissions: ['HEALTH_EXPORT', 'MCT_EXPORT'], unknown: 0 });
  });

  it.each([['{["HEALTH_EXPORT"]}'], [''], [null], [{ userPermissions: ['HEALTH_EXPORT'] }], [{ permissions: 'HEALTH_EXPORT' }]])(
    'any other body (%p) is unreadable',
    (raw) => { expect(perms.parsePermissionsResponse(raw)).toBeNull(); },
  );
});

describe('the summary types and the permission each needs', () => {
  it('every summary type the adapter ingests needs HEALTH_EXPORT', () => {
    expect(perms.SUMMARY_PERMISSION).toEqual({
      dailies: 'HEALTH_EXPORT', sleeps: 'HEALTH_EXPORT', hrv: 'HEALTH_EXPORT',
      stressDetails: 'HEALTH_EXPORT', respiration: 'HEALTH_EXPORT', pulseox: 'HEALTH_EXPORT',
    });
    expect(Object.isFrozen(perms.SUMMARY_PERMISSION)).toBe(true);
  });

  it('hasHealthPermission is true only for a list holding HEALTH_EXPORT', () => {
    expect(perms.hasHealthPermission(['HEALTH_EXPORT'])).toBe(true);
    expect(perms.hasHealthPermission(['ACTIVITY_EXPORT', 'MCT_EXPORT'])).toBe(false);
    expect(perms.hasHealthPermission([])).toBe(false);
    expect(perms.hasHealthPermission(null)).toBe(false);
  });
});

describe('permitSummaries — the narrowing the ingest seam applies', () => {
  const items = [
    { type: 'dailies', summary: { a: 1 } },
    { type: 'sleeps', summary: { b: 2 } },
    { type: 'activities', summary: { c: 3 } },
  ];

  it('no record (undefined): nothing is narrowed', () => {
    expect(perms.permitSummaries(items, undefined)).toEqual({ admitted: items, droppedNotPermitted: 0 });
  });

  it('HEALTH_EXPORT: the health types pass, a type with no known permission is dropped and counted', () => {
    expect(perms.permitSummaries(items, ['HEALTH_EXPORT'])).toEqual({ admitted: items.slice(0, 2), droppedNotPermitted: 1 });
  });

  it('no HEALTH_EXPORT: every health type is dropped', () => {
    expect(perms.permitSummaries(items, ['ACTIVITY_EXPORT'])).toEqual({ admitted: [], droppedNotPermitted: 3 });
    expect(perms.permitSummaries(items, [])).toEqual({ admitted: [], droppedNotPermitted: 3 });
  });

  it('a corrupt record (null or not an array): fail closed, nothing passes', () => {
    expect(perms.permitSummaries(items, null)).toEqual({ admitted: [], droppedNotPermitted: 3 });
    expect(perms.permitSummaries(items, 'HEALTH_EXPORT')).toEqual({ admitted: [], droppedNotPermitted: 3 });
  });

  it('a type named like an Object.prototype member is not permitted by inheritance', () => {
    const odd = [{ type: 'constructor', summary: {} }, { type: '__proto__', summary: {} }, { type: 'toString', summary: {} }];
    expect(perms.permitSummaries(odd, ['HEALTH_EXPORT'])).toEqual({ admitted: [], droppedNotPermitted: 3 });
  });
});

describe('storedPermissions — the record in the decrypted wearableToken blob', () => {
  it('no blob, or a blob with no `permissions` key: no record (undefined)', () => {
    expect(perms.storedPermissions(null)).toBeUndefined();
    expect(perms.storedPermissions({ accessToken: 'a', garminUserId: 'g' })).toBeUndefined();
  });

  it('a stored list is re-read closed; a corrupt one is null (fail closed)', () => {
    expect(perms.storedPermissions({ permissions: ['HEALTH_EXPORT', 'BOGUS'] })).toEqual(['HEALTH_EXPORT']);
    expect(perms.storedPermissions({ permissions: [] })).toEqual([]);
    expect(perms.storedPermissions({ permissions: 'HEALTH_EXPORT' })).toBeNull();
    expect(perms.storedPermissions({ permissions: null })).toBeNull();
  });
});

describe('readStoredPermissions — the seam\'s own read (real Mongo)', () => {
  const { MongoMemoryServer } = require('mongodb-memory-server');
  const mongoose = require('mongoose');
  const User = require('../app/models/User');
  jest.setTimeout(120000);
  let mem;
  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri(), { dbName: 'kokonada_garmin_permissions' });
  });
  afterAll(async () => { await mongoose.disconnect(); await mem.stop(); });

  it('reads the list out of the encrypted blob; a live link whose blob has no list is no record', async () => {
    const u = await User.create({ ssoProvider: 'google', ssoId: 's-p1', email: 'p1@x.c', wearableProvider: 'garmin', garminUserId: 'g-p1' });
    u.setToken('wearableToken', { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 1e6, garminUserId: 'g-p1', permissions: ['HEALTH_EXPORT'] });
    await u.save();
    const raw = await mongoose.connection.db.collection('users').findOne({ _id: u._id });
    expect(JSON.stringify(raw)).not.toContain('HEALTH_EXPORT'); // stored inside the encrypted blob only

    expect(await perms.readStoredPermissions(u._id)).toEqual(['HEALTH_EXPORT']);
    const legacy = await User.create({ ssoProvider: 'google', ssoId: 's-p3', email: 'p3@x.c', wearableProvider: 'garmin', garminUserId: 'g-p3' });
    legacy.setToken('wearableToken', { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 1e6, garminUserId: 'g-p3' });
    await legacy.save();
    expect(await perms.readStoredPermissions(legacy._id)).toBeUndefined();
  });

  // RA-4 of #304: a push the webhook resolved before an erasure reaches the seam after it.
  it('no live Garmin link permits nothing: no blob, another wearable, or no user', async () => {
    const bare = await User.create({ ssoProvider: 'google', ssoId: 's-p2', email: 'p2@x.c', wearableProvider: 'garmin', garminUserId: 'g-p2' });
    expect(await perms.readStoredPermissions(bare._id)).toBeNull();
    const other = await User.create({ ssoProvider: 'google', ssoId: 's-p4', email: 'p4@x.c', wearableProvider: 'health_connect' });
    other.setToken('wearableToken', { accessToken: 'a', refreshToken: 'r', permissions: ['HEALTH_EXPORT'] });
    await other.save();
    expect(await perms.readStoredPermissions(other._id)).toBeNull();
    expect(await perms.readStoredPermissions(new mongoose.Types.ObjectId())).toBeNull();
  });
});
