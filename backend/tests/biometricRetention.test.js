'use strict';

process.env.ENCRYPTION_KEY = 'a'.repeat(64);

// Retention / TTL for special-category health data (T3.1). The TTL must be sized to the
// real analytics window: the longest reader of BiometricLog is the rolling RHR baseline in
// biosonic/baselines.js (WINDOW_DAYS = 30). Expiring inside that window would starve the
// median aggregation, so the TTL must comfortably EXCEED 30 days.
const BiometricLog = require('../app/models/BiometricLog');

const BASELINE_WINDOW_DAYS = 30; // biosonic/baselines.js WINDOW_DAYS — keep in lockstep.

function ttlIndex() {
  return BiometricLog.schema.indexes().find(
    ([keys]) => Object.keys(keys).length === 1 && keys.recordedAt != null,
  );
}

describe('BiometricLog retention (TTL index)', () => {
  it('declares a single-field TTL index on recordedAt', () => {
    const idx = ttlIndex();
    expect(idx).toBeDefined();
    const [, opts] = idx;
    expect(typeof opts.expireAfterSeconds).toBe('number');
  });

  it('retains samples beyond the 30-day baseline window so aggregation is never starved', () => {
    const [, opts] = ttlIndex();
    expect(opts.expireAfterSeconds).toBeGreaterThan(BASELINE_WINDOW_DAYS * 24 * 3600);
  });
});
