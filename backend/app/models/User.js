const mongoose = require('mongoose');
const { encrypt, decrypt } = require('../utils/encryption');

const encryptedTokenSchema = new mongoose.Schema({
  blob: { type: String, required: true }, // AES-256-GCM encrypted JSON
}, { _id: false });

const userSchema = new mongoose.Schema({
  ssoProvider: { type: String, enum: ['google', 'apple'], required: true },
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
  youtubeMusicToken: { type: encryptedTokenSchema, default: null },
  wearableProvider:  { type: String, enum: ['garmin', 'apple_health', 'health_connect', 'suunto', null], default: null },
  wearableToken:     { type: encryptedTokenSchema, default: null },
  // Garmin Health API account id — plaintext + indexed so the server-to-server
  // webhook can map an inbound Garmin userId to our user. (The same id is also kept
  // inside the encrypted wearableToken blob.)
  garminUserId:      { type: String, default: null, index: true },

  // Opaque device token for the sideloaded Garmin watch app (HR streaming).
  // We store ONLY the sha256 hash — the plaintext (whr_…) is shown to the user
  // once at generation time and pasted into Garmin Connect app settings.
  watchToken: {
    hash:       { type: String, default: null },
    createdAt:  { type: Date,   default: null },
    lastSeenAt: { type: Date,   default: null },
  },

  // Mobile push notification tokens (FCM for Android, APNs for iOS)
  pushTokens: [{
    token:     { type: String, required: true },
    platform:  { type: String, enum: ['ios', 'android', 'web'], required: true },
    createdAt: { type: Date, default: Date.now },
    _id: false,
  }],

  deletedAt: { type: Date, default: null }, // GDPR soft-delete
}, {
  timestamps: true,
});

userSchema.index({ ssoProvider: 1, ssoId: 1 }, { unique: true });
userSchema.index({ email: 1 });
// Sparse: most users never enroll a watch, so watchToken.hash is null for them
// — sparse keeps those documents out of the index and the lookup unique-friendly.
userSchema.index({ 'watchToken.hash': 1 }, { sparse: true });

// Helpers for encrypting/decrypting token objects on the document
userSchema.methods.setToken = function (field, tokenObj) {
  this[field] = { blob: encrypt(tokenObj) };
};
userSchema.methods.getToken = function (field) {
  if (!this[field]?.blob) return null;
  return decrypt(this[field].blob, true);
};

module.exports = mongoose.model('User', userSchema);
