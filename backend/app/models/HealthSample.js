'use strict';

const mongoose = require('mongoose');
const { encryptedNumber, bindEncryptedAadOnUpdate } = require('./encryptedField');

const HEALTH_SAMPLE_VERSION = 2;
const HEALTH_SAMPLE_SOURCES = Object.freeze(['apple_health', 'health_connect']);
const HEALTH_SAMPLE_METRICS = Object.freeze([
  'heart_rate',
  'resting_heart_rate',
  'hrv',
  'sleep_deep',
  'sleep_light',
  'sleep_rem',
]);
const HEALTH_SAMPLE_METHODS = Object.freeze(['sdnn', 'rmssd']);
const HEALTH_SAMPLE_STATES = Object.freeze(['active', 'deleted']);
const HEALTH_SAMPLE_PROJECTION_STATES = Object.freeze(['pending', 'applied']);
const HEALTH_SAMPLE_INGEST_STATES = Object.freeze(['staged', 'committed']);

const healthSampleSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  sampleKey: { type: String, required: true, match: /^[0-9a-f]{64}$/ },
  source: { type: String, enum: HEALTH_SAMPLE_SOURCES, required: true },
  metric: { type: String, enum: HEALTH_SAMPLE_METRICS },
  method: { type: String, enum: HEALTH_SAMPLE_METHODS, default: null },
  value: encryptedNumber(),
  unit: { type: String },
  startAt: { type: Date },
  endAt: { type: Date },
  tzOffsetMinutes: { type: Number, default: null, min: -840, max: 720 },
  state: { type: String, enum: HEALTH_SAMPLE_STATES, required: true, default: 'active' },
  projectionState: {
    type: String,
    enum: HEALTH_SAMPLE_PROJECTION_STATES,
    required: true,
    default: 'pending',
  },
  // A v2 batch is staged until the post-write consent/connection fence passes. A process crash
  // or cleanup failure therefore leaves an explicit, retryable marker rather than an apparently
  // valid health row. Legacy rows predate this field and read as committed through the default.
  ingestState: {
    type: String,
    enum: HEALTH_SAMPLE_INGEST_STATES,
    required: true,
    default: 'committed',
  },
  ingestToken: { type: String, default: null, match: /^[0-9a-f]{32}$/ },
  consentFence: { type: String, default: null },
  connectionVersion: { type: Number, default: 0, min: 0 },
  deletedAt: { type: Date, default: null },
  expiresAt: { type: Date, required: true },
  v: { type: Number, default: HEALTH_SAMPLE_VERSION },
}, {
  // Production indexes are an owner-gated Atlas rollout. Keep declarations for explicit
  // syncIndexes()/createIndexes() calls, but never create unique or TTL indexes on app startup.
  autoIndex: false,
  optimisticConcurrency: true,
  timestamps: true,
  toJSON: { getters: true },
  toObject: { getters: true },
});

healthSampleSchema.pre('validate', function enforceHealthSampleState() {
  if (this.state === 'active') {
    for (const field of ['metric', 'value', 'unit', 'startAt', 'endAt']) {
      const value = this[field];
      if (value == null || (field === 'unit' && value === '')) {
        this.invalidate(field, `${field} is required for an active health sample`);
      }
    }
  }

  if (this.state === 'deleted' && this.deletedAt == null) {
    this.invalidate('deletedAt', 'deletedAt is required for a deleted health sample');
  }

  if (this.metric === 'hrv') {
    if (!this.method) this.invalidate('method', 'method is required for an HRV health sample');
  } else if (this.method != null) {
    this.invalidate('method', 'method is allowed only for an HRV health sample');
  }
});

healthSampleSchema.index({ userId: 1, source: 1, sampleKey: 1 }, { unique: true });
healthSampleSchema.index({ projectionState: 1, updatedAt: 1 });
healthSampleSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

healthSampleSchema.plugin(bindEncryptedAadOnUpdate);

const HealthSample = mongoose.model('HealthSample', healthSampleSchema);

HealthSample.HEALTH_SAMPLE_VERSION = HEALTH_SAMPLE_VERSION;
HealthSample.HEALTH_SAMPLE_SOURCES = HEALTH_SAMPLE_SOURCES;
HealthSample.HEALTH_SAMPLE_METRICS = HEALTH_SAMPLE_METRICS;
HealthSample.HEALTH_SAMPLE_METHODS = HEALTH_SAMPLE_METHODS;
HealthSample.HEALTH_SAMPLE_STATES = HEALTH_SAMPLE_STATES;
HealthSample.HEALTH_SAMPLE_PROJECTION_STATES = HEALTH_SAMPLE_PROJECTION_STATES;
HealthSample.HEALTH_SAMPLE_INGEST_STATES = HEALTH_SAMPLE_INGEST_STATES;

module.exports = HealthSample;
