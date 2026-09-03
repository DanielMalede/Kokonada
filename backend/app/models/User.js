const mongoose = require('mongoose');
const { encrypt, blindIndex } = require('../utils/encryption');
const {
  encryptedString, decryptOwned, declareEncryptedOwner, bindEncryptedAadOnUpdate,
} = require('./encryptedField');

const encryptedTokenSchema = new mongoose.Schema({
  blob: { type: String, required: true }, // AES-256-GCM encrypted JSON
}, { _id: false });

const userSchema = new mongoose.Schema({
  // 'password' rows mirror the email flow (ssoId = normalized email) so the
  // (ssoProvider, ssoId) unique index keeps holding; Identity is the auth truth.
  ssoProvider: { type: String, enum: ['google', 'apple', 'password'], required: true },
  ssoId:       { type: String, required: true },
  email:       { type: String, required: true },
  displayName: { type: String, default: '' },
  avatarUrl:   { type: String, default: '' },

  // Encrypted 3rd-party OAuth tokens
  musicProvider:     { type: String, enum: ['spotify', 'youtube', null], default: null },
  spotifyToken:      { type: encryptedTokenSchema, default: null },
  // Space-separated Spotify scopes the user actually granted (plaintext, non-sensitive).
  // Lets /status tell the client whether Like/Export will work, instead of failing on a
  // 403 every click. (audit #5)
  spotifyScopes:     { type: String, default: '' },
  // D-1: id of the hidden "Kokonada Session" playlist backing App Remote context playback
  // (created once, rewritten each generation; plaintext, non-sensitive).
  spotifySessionPlaylistId: { type: String, default: null },
  youtubeMusicToken: { type: encryptedTokenSchema, default: null },
  wearableProvider:  { type: String, enum: ['garmin', 'apple_health', 'health_connect', 'suunto', null], default: null },
  wearableToken:     { type: encryptedTokenSchema, default: null },
  // Garmin Health API account id — special-category account identifier, ENCRYPTED at rest
  // (T3.3). It can no longer be queried directly; the webhook routes via garminUserIdHmac
  // (a keyed blind index) instead. (The same id is also kept inside the encrypted
  // wearableToken blob.)
  garminUserId:      encryptedString({ default: null }),
  // Deterministic keyed HMAC of garminUserId — indexed so the Garmin webhook can look up the
  // owning user WITHOUT decrypting every row. Backfilled on write by the pre-save hook below.
  garminUserIdHmac:  { type: String, default: null },

  // Opaque device token for the sideloaded Garmin watch app (HR streaming).
  // We store ONLY the sha256 hash. The plaintext (whr_…) is a long-lived
  // credential and is NEVER rendered in the browser DOM or clipboard (audit
  // L-15) — it is minted server-side and handed directly to the watch app via
  // the pairing exchange below (or, historically, the authenticated
  // issueWatchToken endpoint, still available for non-browser callers).
  watchToken: {
    hash:       { type: String, default: null },
    createdAt:  { type: Date,   default: null },
    lastSeenAt: { type: Date,   default: null },
  },

  // Mobile push notification tokens (FCM for Android, APNs for iOS) — device secrets,
  // ENCRYPTED at rest (T3.3). The getter decrypts transparently, so authController's
  // `t.token === deviceToken` dedup still works.
  pushTokens: [{
    token:     encryptedString({ required: true }),
    platform:  { type: String, enum: ['ios', 'android', 'web'], required: true },
    createdAt: { type: Date, default: Date.now },
    _id: false,
  }],

  // Billing tier — written by the RevenueCat webhook (or manual grants), read
  // through entitlements.resolveEntitlements which enforces expiry at read time.
  entitlements: {
    tier:             { type: String, enum: ['free', 'premium'], default: 'free' },
    source:           { type: String, enum: ['revenuecat', 'manual', null], default: null },
    currentPeriodEnd: { type: Date, default: null },
    updatedAt:        { type: Date, default: null },
  },

  deletedAt: { type: Date, default: null }, // GDPR soft-delete
}, {
  timestamps: true,
});

// The owner of an encrypted value on THIS model is the document itself — a `User` has no `userId`
// field, so the default lookup resolved null and every ciphertext here (garminUserId,
// pushTokens[].token, and the token blobs below) was written UNBOUND: replayable into any other
// row. Declaring the owner path binds them all. Reads stay tolerant of the legacy unbound blobs,
// which migrate forward on the next write. (W4-D74)
declareEncryptedOwner(userSchema, '_id');

// `pushTokens[].token` is an encrypted leaf inside a document ARRAY. An update operator casts
// array elements as detached sub-documents, so the setter cannot see the owner and would store a
// device secret with no AAD binding at all. This plugin refuses those shapes; the bound paths
// (`.push()` + `.save()`, which is what authController uses, and any write dotted through to the
// leaf) are untouched. (W4-D75)
bindEncryptedAadOnUpdate(userSchema);

userSchema.index({ ssoProvider: 1, ssoId: 1 }, { unique: true });
userSchema.index({ email: 1 });
// Sparse: most users never enroll a watch, so watchToken.hash is null for them
// — sparse keeps those documents out of the index and the lookup unique-friendly.
userSchema.index({ 'watchToken.hash': 1 }, { sparse: true });
// Blind-index lookup path for the Garmin webhook (garminUserId is encrypted, unqueryable).
// Sparse: most users never connect Garmin. (T3.3)
userSchema.index({ garminUserIdHmac: 1 }, { sparse: true });

// Recompute the garminUserId blind index from the (decrypted) plaintext. Idempotent; null
// when the id is cleared. Exposed as a method so callers/tests can backfill deterministically.
userSchema.methods.syncGarminIndex = function () {
  this.garminUserIdHmac = this.garminUserId ? blindIndex(this.garminUserId) : null;
  return this;
};

// Backfill-on-write: keep garminUserIdHmac in lockstep with garminUserId on every save that
// touches it, so the webhook lookup never goes stale. Synchronous hook (no next) — the
// modern Mongoose style, and the next-callback form isn't invoked with a callback here. (T3.3)
userSchema.pre('save', function () {
  if (this.isModified('garminUserId')) this.syncGarminIndex();
});

// Helpers for encrypting/decrypting token objects on the document. These blobs are stored as a
// PLAIN String with no setter, so they are the explicit-encrypt case the encryptedField header
// describes: pass the owner id as AAD on write, read back through `decryptOwned`. Without it an
// OAuth refresh token lifted out of one row decrypted fine in another — an account takeover of
// that integration. (W4-D74)
userSchema.methods.setToken = function (field, tokenObj) {
  this[field] = { blob: encrypt(tokenObj, String(this._id)) };
};
userSchema.methods.getToken = function (field) {
  if (!this[field]?.blob) return null;
  // Tolerant read: bound first, then the legacy unbound blob, so no one is logged out by the
  // migration. A blob that answers to NEITHER is a tamper/row-swap and still throws, as before —
  // fail closed rather than degrade into "some token".
  return decryptOwned(this[field].blob, this._id, true);
};

module.exports = mongoose.model('User', userSchema);
