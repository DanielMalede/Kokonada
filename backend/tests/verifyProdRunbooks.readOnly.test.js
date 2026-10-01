'use strict';

process.env.NODE_ENV = 'test';

// HX-2 round 1 (M1, resilience) — the runbook verifier must stay READ-ONLY against production.
//
// Requiring a Mongoose model registers it, and once `connectDB()` connects, Mongoose auto-builds
// every registered model's indexes (autoIndex) and may create its collection (autoCreate). The
// verifier connects to PRODUCTION. If it registers ServeEvent, then on a database without
// `servedAt_1` it would CREATE that index itself — and Runbook 5 would then pass on an index the
// verifier just built. So loading the script must register no model at all.
//
// Fresh module registry: nothing else in this file has touched mongoose.

const mongoose = require('mongoose');

describe('verifyProdRunbooks — loading it registers no Mongoose model (M1)', () => {
  it('mongoose.modelNames() is still empty after requiring the script', () => {
    expect(mongoose.modelNames()).toEqual([]); // control: this registry starts clean

    require('../scripts/verifyProdRunbooks');

    expect(mongoose.modelNames()).toEqual([]);
  });
});
