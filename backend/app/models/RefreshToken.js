const mongoose = require('mongoose');

// One rotating refresh-token lineage per login ("family"). Only the newest member
// is 'active'; presenting a 'rotated' member is a theft signal that burns the whole
// family. Only the sha256 hash of the opaque token ever touches the database.
const refreshTokenSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  familyId:  { type: String, required: true, index: true },
  status:    { type: String, enum: ['active', 'rotated', 'revoked'], default: 'active' },
  expiresAt: { type: Date, required: true },
  rotatedAt: { type: Date, default: null },
}, {
  timestamps: true,
});

// Mongo garbage-collects expired rows itself; revocation state before expiry is
// what the status field is for.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);
