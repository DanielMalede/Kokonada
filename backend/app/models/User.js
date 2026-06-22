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
  youtubeMusicToken: { type: encryptedTokenSchema, default: null },
  wearableProvider:  { type: String, enum: ['garmin', 'apple_health', 'suunto', null], default: null },
  wearableToken:     { type: encryptedTokenSchema, default: null },

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

// Helpers for encrypting/decrypting token objects on the document
userSchema.methods.setToken = function (field, tokenObj) {
  this[field] = { blob: encrypt(tokenObj) };
};
userSchema.methods.getToken = function (field) {
  if (!this[field]?.blob) return null;
  return decrypt(this[field].blob, true);
};

module.exports = mongoose.model('User', userSchema);
