'use strict';

// W4-D74 — AAD binding for the encrypted fields on `User`.
//
// `encryptedField` binds every ciphertext to its owner as GCM additional authenticated data, so a
// blob lifted out of one row cannot be replayed into another's (T3.3, extended to update operators
// by W4-D71). That binding resolves the owner by reading `userId` off the owning document — and a
// `User` document has no `userId` field: the owner id on that model IS its `_id`. So the lookup
// resolved null and EVERY encrypted value on the one model that holds credentials was written
// unbound. Two separate mechanisms, one cause:
//
//   1. `garminUserId` and `pushTokens[].token` are `encryptedString` fields — their setter asked
//      `_ownerAad` for an owner and got null.
//   2. `setToken` / `getToken` (`spotifyToken`, `youtubeMusicToken`, `wearableToken`) call
//      `encrypt` / `decrypt` directly with no AAD argument at all.
//
// These are OAuth refresh tokens and a provider identity rather than Art.9 values, which is why
// W4-D71 stopped at the health collections. A lifted `spotifyToken` blob is an account takeover of
// that integration, so the row-swap tests below are the point of the whole file.
//
// Assertions go through the DRIVER wherever the claim is "bound", because the read path is
// deliberately tolerant of both bound and unbound blobs — a getter-only test cannot tell them
// apart. Real Mongo (mongodb-memory-server) rather than `hydrate()`, matching W4-D71: casting is
// where the defect lives.

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';

const fs = require('fs');
const path = require('path');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

const { encrypt, decrypt } = require('../app/utils/encryption');
const {
  encryptedLeafPaths,
  encryptedOwnerPath,
} = require('../app/models/encryptedField');
const User = require('../app/models/User');

jest.setTimeout(120000);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_wave4_user_aad' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(async () => {
  await User.deleteMany({});
});

const uid = () => new mongoose.Types.ObjectId();
const rawUsers = () => mongoose.connection.db.collection('users');

/** Walk a dotted path on a plain driver document. */
const at = (doc, p) => p.split('.').reduce((o, k) => (o == null ? o : o[k]), doc);

/**
 * The single assertion this row is about: the stored blob is readable ONLY with the owner's id as
 * AAD. `decrypt` throws on an authentication failure, so "throws WITHOUT the AAD" is the positive
 * evidence the binding is real rather than merely present.
 */
function expectBoundTo(blob, ownerId, plaintext) {
  expect(typeof blob).toBe('string');
  expect(decrypt(blob, false, String(ownerId))).toBe(String(plaintext));
  expect(() => decrypt(blob)).toThrow();
  expect(() => decrypt(blob, false, String(uid()))).toThrow();
}

const baseUser = (over = {}) => ({
  ssoProvider: 'google',
  ssoId: `sso-${new mongoose.Types.ObjectId()}`,
  email: `u${Date.now()}${Math.round(Math.random() * 1e6)}@example.com`,
  ...over,
});

const TOKENS = { accessToken: 'at-123', refreshToken: 'rt-456', expiresAt: 1893456000000 };

describe('W4-D74 · encryptedString fields on User bind the owner AAD', () => {
  it('binds `garminUserId` to the document that owns it', async () => {
    const user = await User.create(baseUser({ garminUserId: 'garmin-abc' }));

    const raw = await rawUsers().findOne({ _id: user._id });
    expectBoundTo(raw.garminUserId, user._id, 'garmin-abc');
  });

  it('binds `pushTokens[].token` through the document-array subdocument', async () => {
    const user = await User.create(baseUser());
    user.pushTokens.push({ token: 'fcm-device-secret', platform: 'android' });
    await user.save();

    const raw = await rawUsers().findOne({ _id: user._id });
    expect(raw.pushTokens).toHaveLength(1);
    expectBoundTo(raw.pushTokens[0].token, user._id, 'fcm-device-secret');
  });

  it('still round-trips through the model getters after the binding', async () => {
    const user = await User.create(baseUser({ garminUserId: 'garmin-abc' }));
    user.pushTokens.push({ token: 'fcm-device-secret', platform: 'android' });
    await user.save();

    const read = await User.findById(user._id);
    expect(read.garminUserId).toBe('garmin-abc');
    expect(read.pushTokens[0].token).toBe('fcm-device-secret');
    // The dedup authController relies on (`t.token === deviceToken`) still works.
    expect(read.pushTokens.some((t) => t.token === 'fcm-device-secret')).toBe(true);
  });

  it('keeps the garmin blind index in lockstep with the bound ciphertext', async () => {
    const { blindIndex } = require('../app/utils/encryption');
    const user = await User.create(baseUser({ garminUserId: 'garmin-abc' }));
    expect(user.garminUserIdHmac).toBe(blindIndex('garmin-abc'));

    const read = await User.findById(user._id);
    // The webhook's decrypt-match fallback (`garminUserLookup`) reads through this getter.
    expect(String(read.garminUserId)).toBe('garmin-abc');
  });

  it('a `garminUserId` ciphertext moved into ANOTHER user row reads as null, never as the value', async () => {
    const owner = await User.create(baseUser({ garminUserId: 'garmin-abc' }));
    const victim = await User.create(baseUser());

    const raw = await rawUsers().findOne({ _id: owner._id });
    await rawUsers().updateOne({ _id: victim._id }, { $set: { garminUserId: raw.garminUserId } });

    const read = await User.findById(victim._id);
    expect(read.garminUserId).toBeNull();
  });

  it('a `pushTokens[].token` ciphertext moved into ANOTHER user row reads as null', async () => {
    const owner = await User.create(baseUser());
    owner.pushTokens.push({ token: 'fcm-device-secret', platform: 'android' });
    await owner.save();
    const victim = await User.create(baseUser());

    const raw = await rawUsers().findOne({ _id: owner._id });
    await rawUsers().updateOne(
      { _id: victim._id },
      { $set: { pushTokens: [{ token: raw.pushTokens[0].token, platform: 'android' }] } },
    );

    const read = await User.findById(victim._id);
    expect(read.pushTokens[0].token).toBeNull();
  });

  it('LEGACY unbound rows still decrypt (migration safety — no user loses their connection)', async () => {
    const user = await User.create(baseUser());
    await rawUsers().updateOne(
      { _id: user._id },
      {
        $set: {
          garminUserId: encrypt('legacy-garmin'),                       // written before the binding
          pushTokens: [{ token: encrypt('legacy-fcm'), platform: 'ios' }],
        },
      },
    );

    const read = await User.findById(user._id);
    expect(read.garminUserId).toBe('legacy-garmin');
    expect(read.pushTokens[0].token).toBe('legacy-fcm');
  });

  it('a legacy unbound value migrates forward on the next save', async () => {
    const user = await User.create(baseUser());
    await rawUsers().updateOne({ _id: user._id }, { $set: { garminUserId: encrypt('legacy-garmin') } });

    const read = await User.findById(user._id);
    read.garminUserId = 'garmin-new';
    await read.save();

    const raw = await rawUsers().findOne({ _id: user._id });
    expectBoundTo(raw.garminUserId, user._id, 'garmin-new');
  });

  it('recovers the owner from an UPDATE OPERATOR keyed on `_id`', async () => {
    const user = await User.create(baseUser());
    await User.findOneAndUpdate({ _id: user._id }, { $set: { garminUserId: 'garmin-via-update' } });

    const raw = await rawUsers().findOne({ _id: user._id });
    expectBoundTo(raw.garminUserId, user._id, 'garmin-via-update');
  });

  it('a NON-SCALAR `_id` filter stays unbound rather than binding to "[object Object]"', async () => {
    const user = await User.create(baseUser());
    await User.updateMany({ _id: { $in: [user._id] } }, { $set: { garminUserId: 'garmin-bulk' } });

    const raw = await rawUsers().findOne({ _id: user._id });
    expect(decrypt(raw.garminUserId)).toBe('garmin-bulk'); // unbound, and still readable
    const read = await User.findById(user._id);
    expect(read.garminUserId).toBe('garmin-bulk');          // the tolerant read covers it
  });
});

describe('W4-D74 · setToken/getToken bind the owner AAD', () => {
  it.each(['spotifyToken', 'youtubeMusicToken', 'wearableToken'])('binds %s to its owner', async (field) => {
    const user = await User.create(baseUser());
    user.setToken(field, TOKENS);
    await user.save();

    const raw = await rawUsers().findOne({ _id: user._id });
    const blob = at(raw, `${field}.blob`);
    expect(typeof blob).toBe('string');
    expect(decrypt(blob, true, String(user._id))).toEqual(TOKENS);
    expect(() => decrypt(blob, true)).toThrow();
    expect(() => decrypt(blob, true, String(uid()))).toThrow();
  });

  it('round-trips through getToken on a re-read document', async () => {
    const user = await User.create(baseUser());
    user.setToken('spotifyToken', TOKENS);
    await user.save();

    const read = await User.findById(user._id);
    expect(read.getToken('spotifyToken')).toEqual(TOKENS);
  });

  it('reads a LEGACY unbound token blob (migration safety — no one is logged out)', async () => {
    const user = await User.create(baseUser());
    await rawUsers().updateOne({ _id: user._id }, { $set: { spotifyToken: { blob: encrypt(TOKENS) } } });

    const read = await User.findById(user._id);
    expect(read.getToken('spotifyToken')).toEqual(TOKENS);
  });

  it('a legacy unbound token migrates forward on the next refresh-triggered setToken', async () => {
    const user = await User.create(baseUser());
    await rawUsers().updateOne({ _id: user._id }, { $set: { spotifyToken: { blob: encrypt(TOKENS) } } });

    const read = await User.findById(user._id);
    read.setToken('spotifyToken', { ...TOKENS, accessToken: 'refreshed' });
    await read.save();

    const raw = await rawUsers().findOne({ _id: user._id });
    expect(decrypt(raw.spotifyToken.blob, true, String(user._id))).toEqual({ ...TOKENS, accessToken: 'refreshed' });
    expect(() => decrypt(raw.spotifyToken.blob, true)).toThrow();
  });

  it('a token blob lifted into ANOTHER row FAILS CLOSED instead of handing over the integration', async () => {
    const owner = await User.create(baseUser());
    owner.setToken('spotifyToken', TOKENS);
    await owner.save();
    const attacker = await User.create(baseUser());

    const raw = await rawUsers().findOne({ _id: owner._id });
    await rawUsers().updateOne({ _id: attacker._id }, { $set: { spotifyToken: { blob: raw.spotifyToken.blob } } });

    const read = await User.findById(attacker._id);
    // Loud rather than silent: an unreadable credential blob has always thrown here, and a
    // row-swap is exactly the case that must not degrade into "some token".
    expect(() => read.getToken('spotifyToken')).toThrow();
  });

  it('getToken still returns null when there is no blob at all', async () => {
    const user = await User.create(baseUser());
    expect(user.getToken('spotifyToken')).toBeNull();
  });
});

// The guard W4-D74 exists because it was missing: W4-D71's model walk checks sub-document blind
// spots, so it cannot see a whole model whose OWNER field is named something else. This one fails
// the build for any schema carrying an encrypted leaf whose owner path does not resolve — so the
// next model that keys on something other than `userId` cannot repeat this silently.
describe('W4-D74 · every schema with an encrypted leaf can name its owner', () => {
  const modelDir = path.join(__dirname, '..', 'app', 'models');
  const modelFiles = fs.readdirSync(modelDir)
    .filter((f) => f.endsWith('.js') && f !== 'encryptedField.js');

  it.each(modelFiles)('%s', (file) => {
    const exported = require(path.join(modelDir, file));
    const schema = exported && exported.schema;
    if (!schema || !schema.paths) return; // not a model module (helpers, enums)

    const leaves = encryptedLeafPaths(schema);
    if (!leaves.length) return;

    const ownerPath = encryptedOwnerPath(schema);
    expect({ file, leaves, ownerPath, resolves: !!schema.path(ownerPath) })
      .toEqual({ file, leaves, ownerPath, resolves: true });
  });

  it('finds the leaves it was built for, including through a document ARRAY (not vacuous)', () => {
    expect(encryptedLeafPaths(User.schema).sort()).toEqual(['garminUserId', 'pushTokens.token']);
    expect(encryptedOwnerPath(User.schema)).toBe('_id');
  });

  it('leaves every other schema on the default `userId` owner', () => {
    const MorningState = require('../app/models/MorningState');
    expect(encryptedOwnerPath(MorningState.schema)).toBe('userId');
  });
});
