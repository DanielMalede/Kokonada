'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');

const MAX_BATCH_LEASE_MS = 5 * 60 * 1000;
const MAX_PROJECTION_SAMPLE_KEYS = 2000;

// These are operational deletion journals, not product data. They deliberately live outside
// app/models: account erasure must not remove an owed cleanup before an in-flight writer has
// compensated. Both records are removed as soon as their operation reaches a terminal state.
const ingestBatchSchema = new mongoose.Schema({
  _id: { type: String, match: /^[0-9a-f]{32}$/ },
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  source: { type: String, enum: ['apple_health'], required: true },
  connectionVersion: { type: Number, required: true, min: 0 },
  consentFence: { type: String, required: true },
  status: { type: String, enum: ['writing', 'complete', 'aborted'], required: true },
  leaseUntil: { type: Date, required: true },
  createdAt: { type: Date, required: true },
}, {
  collection: 'healthingestbatches',
  versionKey: false,
  autoIndex: false,
});

const projectionCleanupSchema = new mongoose.Schema({
  _id: { type: String, match: /^[0-9a-f]{64}$/ },
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  provider: { type: String, enum: ['apple_health'], required: true },
  connectionVersion: { type: Number, required: true, min: 0 },
  consentFence: { type: String, required: true },
  status: { type: String, enum: ['projecting', 'cleanup'], required: true },
  leaseUntil: { type: Date, required: true },
  sampleKeys: {
    type: [{ type: String, match: /^[0-9a-f]{64}$/ }],
    validate: {
      validator: (keys) => keys.length <= MAX_PROJECTION_SAMPLE_KEYS,
      message: `sampleKeys exceeds ${MAX_PROJECTION_SAMPLE_KEYS}`,
    },
  },
  createdAt: { type: Date, required: true },
}, {
  collection: 'healthprojectioncleanups',
  versionKey: false,
  autoIndex: false,
});

const HealthIngestBatch = mongoose.models.HealthIngestBatch
  || mongoose.model('HealthIngestBatch', ingestBatchSchema);
const HealthProjectionCleanup = mongoose.models.HealthProjectionCleanup
  || mongoose.model('HealthProjectionCleanup', projectionCleanupSchema);

function projectionCleanupId(userId, provider, connectionVersion) {
  return crypto.createHash('sha256')
    .update(`${userId}:${provider}:${Number(connectionVersion ?? 0)}`)
    .digest('hex');
}

module.exports = {
  HealthIngestBatch,
  HealthProjectionCleanup,
  MAX_BATCH_LEASE_MS,
  MAX_PROJECTION_SAMPLE_KEYS,
  projectionCleanupId,
};
