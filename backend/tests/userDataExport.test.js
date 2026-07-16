'use strict';

// T3.4 GDPR data export (Art. 15/20): serialize the subject's OWN records to JSON, decrypted
// where they are the subject, reusing the account-erasure collection list — while redacting
// credential secrets (password hash, refresh-token hash, OAuth blobs) and never touching
// another user's rows.
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

jest.mock('../app/utils/biometricAudit', () => ({ logBiometricAccess: jest.fn(), auditedDecrypt: jest.fn() }));
const { logBiometricAccess } = require('../app/utils/biometricAudit');
const BiometricLog    = require('../app/models/BiometricLog');
const MedicalProfile  = require('../app/models/MedicalProfile');
const MusicProfile    = require('../app/models/MusicProfile');
const PlaylistSession = require('../app/models/PlaylistSession');
const ServeEvent      = require('../app/models/ServeEvent');
const Identity        = require('../app/models/Identity');
const RefreshToken    = require('../app/models/RefreshToken');
const UnclassifiedTrack = require('../app/models/UnclassifiedTrack');
const User            = require('../app/models/User');
const { exportUserData } = require('../app/services/privacy/userDataExport');

const OID = '507f1f77bcf86cd799439011';

function stubFind(model, docs = []) {
  jest.spyOn(model, 'find').mockResolvedValue(docs);
}

beforeEach(() => {
  jest.restoreAllMocks();
  // Real model instances so the encrypted getters actually run (real decryption semantics).
  stubFind(BiometricLog, [new BiometricLog({ userId: OID, heartRate: 72, source: 'garmin', recordedAt: new Date() })]);
  stubFind(MedicalProfile, []);
  stubFind(MusicProfile, []);
  stubFind(PlaylistSession, [new PlaylistSession({
    userId: OID, emotionTaps: [{ x: 0, y: 0 }], contextPrompt: 'private note', musicProvider: 'spotify',
  })]);
  stubFind(ServeEvent, []);
  stubFind(Identity, [new Identity({ userId: OID, provider: 'password', providerUserId: 'e@x.c', passwordHash: 'argon2-secret' })]);
  stubFind(RefreshToken, [new RefreshToken({ userId: OID, tokenHash: 'sha256-secret', familyId: 'fam-1', expiresAt: new Date() })]);
  stubFind(UnclassifiedTrack, []);
  jest.spyOn(User, 'findById').mockResolvedValue(new User({
    ssoProvider: 'google', ssoId: 's', email: 'me@x.c', garminUserId: 'garmin-1',
    pushTokens: [{ token: 'fcm-secret', platform: 'android' }], spotifyToken: { blob: 'oauth-secret' },
  }));
});

afterEach(() => jest.restoreAllMocks());

describe('exportUserData', () => {
  it('scopes every collection query to the subject userId (never another user)', async () => {
    await exportUserData(OID);
    for (const model of [BiometricLog, MedicalProfile, MusicProfile, PlaylistSession, ServeEvent, Identity, RefreshToken, UnclassifiedTrack]) {
      expect(model.find).toHaveBeenCalledWith({ userId: OID });
    }
    expect(User.findById).toHaveBeenCalledWith(OID);
  });

  it('decrypts the subject\'s own special-category data', async () => {
    const out = await exportUserData(OID);
    expect(out.collections.biometriclogs[0].heartRate).toBe(72);       // decrypted
    expect(out.collections.playlistsessions[0].contextPrompt).toBe('private note'); // decrypted
  });

  it('redacts credential secrets (password hash, refresh-token hash)', async () => {
    const out = await exportUserData(OID);
    expect(out.collections.identities[0]).not.toHaveProperty('passwordHash');
    expect(out.collections.identities[0].provider).toBe('password'); // non-secret metadata kept
    expect(out.collections.refreshtokens[0]).not.toHaveProperty('tokenHash');
  });

  it('exports a curated user profile without OAuth blobs / device secrets / internal index', async () => {
    const out = await exportUserData(OID);
    expect(out.user.email).toBe('me@x.c');
    expect(out.user.garminUserId).toBe('garmin-1'); // subject's own account id, decrypted
    expect(out.user).not.toHaveProperty('spotifyToken');
    expect(out.user).not.toHaveProperty('wearableToken');
    expect(out.user).not.toHaveProperty('pushTokens');
    expect(out.user).not.toHaveProperty('garminUserIdHmac');
  });

  it('reuses the full account-erasure collection list (completeness)', async () => {
    const out = await exportUserData(OID);
    expect(Object.keys(out.collections).sort()).toEqual([
      'biometriclogs', 'identities', 'medicalprofiles', 'musicprofiles',
      'playlistsessions', 'refreshtokens', 'serveevents', 'unclassifiedtracks',
    ].sort());
  });

  it('records an audited biometric access for the bulk export decrypt (ADR-0005, M2)', async () => {
    await exportUserData(OID);
    expect(logBiometricAccess).toHaveBeenCalledWith(String(OID), 'gdpr-export');
  });
});
