'use strict';

process.env.NODE_ENV = 'test';

const ServeEvent = require('../app/models/ServeEvent');

describe('ServeEvent schema', () => {
  const path = (name) => ServeEvent.schema.path(name);

  it('requires the ledger identity fields', () => {
    expect(path('userId').isRequired).toBe(true);
    expect(path('canonicalKey').isRequired).toBe(true);
    expect(path('servedAt').isRequired).toBe(true);
  });

  it('bioState stores only coarse bands — never raw heart rate (zero-knowledge posture)', () => {
    expect(path('bioState.tempoBand')).toBeDefined();
    expect(path('bioState.activity')).toBeDefined();
    expect(path('bioState.hr')).toBeUndefined();
    expect(path('bioState.heartRate')).toBeUndefined();
  });

  // RETIRED under DEC-091 (HX-2): was 90 days. Serve rows name provider recordings, so they fall
  // under the 30-day provider-content cap; the daily job deletes them at 29 days and this TTL is
  // the backstop. Production needs a one-off collMod — see the TTL runbook in verifyProdRunbooks.
  it('self-expires after 30 days (TTL index on servedAt, 2592000 s)', () => {
    const ttl = ServeEvent.schema.indexes().find(([, opts]) => opts.expireAfterSeconds != null);
    expect(ttl).toBeDefined();
    expect(ttl[0]).toEqual({ servedAt: 1 });
    expect(ttl[1].expireAfterSeconds).toBe(2592000);
  });

  it('carries the per-user recency and per-track history indexes', () => {
    const indexes = ServeEvent.schema.indexes().map(([fields]) => fields);
    expect(indexes).toContainEqual({ userId: 1, servedAt: -1 });
    expect(indexes).toContainEqual({ userId: 1, canonicalKey: 1, servedAt: -1 });
  });
});
