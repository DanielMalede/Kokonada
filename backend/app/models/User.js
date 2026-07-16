const mongoose = require('mongoose');
const { encrypt, decrypt, blindIndex } = require('../utils/encryption');
const { encryptedString } = require('./encryptedField');

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
  // We store ONLY the sha256 hash — the plaintext (whr_…) is shown to the user
  // once at generation time and pasted into Garmin Connect app settings.
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

// Helpers for encrypting/decrypting token objects on the document
userSchema.methods.setToken = function (field, tokenObj) {
  this[field] = { blob: encrypt(tokenObj) };
};
userSchema.methods.getToken = function (field) {
  if (!this[field]?.blob) return null;
  return decrypt(this[field].blob, true);
};

module.exports = mongoose.model('User', userSchema);
