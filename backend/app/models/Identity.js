const mongoose = require('mongoose');

// Provider-agnostic login identity. The auth source of truth going forward:
// one row per (provider, providerUserId) pointing at the owning User. SSO logins
// upsert their row lazily; email/password logins live only here. User.ssoProvider/
// ssoId stay mirrored for password users ('password', normalized email) so the
// legacy unique index keeps holding without a migration.
const identitySchema = new mongoose.Schema({
  userId:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  provider:       { type: String, enum: ['google', 'apple', 'password'], required: true },
  // google/apple: the provider's stable sub claim; password: the normalized email.
  providerUserId: { type: String, required: true },
  email:          { type: String, default: '' },
  // argon2id PHC string; only ever set for provider 'password'.
  passwordHash:   { type: String, default: null },
  emailVerified:  { type: Boolean, default: false },
  lastLoginAt:    { type: Date, default: null },
}, {
  timestamps: true,
});

identitySchema.index({ provider: 1, providerUserId: 1 }, { unique: true });

module.exports = mongoose.model('Identity', identitySchema);
