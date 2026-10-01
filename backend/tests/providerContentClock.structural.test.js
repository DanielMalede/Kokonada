'use strict';

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';

// HX-2 — every collection that can hold provider track data has a declared clock, or a named reason
// it does not need one. A new model that stores trackIds / trackSummary / canonicalKey / library
// (or an opaque Mixed payload, which could be any of them) fails this suite until someone declares
// how long it lives. This is how CMP-022 happened: ServeEvent kept track keys for 90 days and
// MusicProfile has no Spotify clock at all, and nothing noticed.
//
// Discovery reads the REAL schemas (every path, nested sub-schemas included), never source text, so
// a comment cannot hide a field and a comment cannot invent one. Each declared clock is then checked
// against what actually runs: a TTL against the schema's index, a job step against a real run of
// the daily job on MongoDB.

jest.mock('../app/config/redis', () => ({ getRedis: () => null }));

const fs = require('fs');
const path = require('path');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { PROVIDER_CONTENT_CLOCKS, PROVIDER_CONTENT_FIELDS } = require('../app/services/privacy/providerContentErasure');
const { defaultCollections } = require('../app/services/monitoring/spotifyLeakMonitor');

jest.setTimeout(120000);

const MODELS_DIR = path.join(__dirname, '../app/models');
const CARRIER_NAMES = new Set(['trackIds', 'trackKeys', 'trackSummary', 'canonicalKey', 'library']);
const MAX_SECONDS = 30 * 24 * 3600;

// Collections allowed to hold these fields WITHOUT a clock, each with the reason and what enforces it.
const NAMED_EXCEPTIONS = {
  TrackCatalog: 'global corpus with no userId; refuses Spotify Content at write (toCatalogEntry) and is counted by spotifyLeakMonitor',
  TrackEmbedding: 'global corpus with no userId; refuses Spotify Content at write (catalogAndEmbed, embedding.worker) and is counted by spotifyLeakMonitor',
  AudioFeature: 'global cache with no userId; refuses Spotify Content at write and is counted by spotifyLeakMonitor',
  MusicProfile: 'PENDING CMP-138 (Spotify refresh clock). Deleted on disconnect today (HX-2 M5); YouTube rows are on the youtubeRetention clock',
};

function modelsByName() {
  const out = {};
  for (const file of fs.readdirSync(MODELS_DIR).filter((f) => f.endsWith('.js') && f !== 'encryptedField.js')) {
    const exported = require(path.join(MODELS_DIR, file));
    const candidates = [exported, ...Object.values(exported || {})];
    const model = candidates.find((m) => m && m.schema && typeof m.modelName === 'string');
    if (model) out[model.modelName] = model;
  }
  return out;
}

// Every path whose last segment names track data, or whose content is opaque (Mixed).
function carrierPaths(schema, prefix = '') {
  const found = [];
  schema.eachPath((p, type) => {
    const full = prefix + p;
    const last = p.split('.').pop();
    if (CARRIER_NAMES.has(last) || type.instance === 'Mixed') found.push(full);
    if (type.schema) found.push(...carrierPaths(type.schema, `${full}.`));
  });
  return found;
}

const models = modelsByName();
const carriers = Object.fromEntries(
  Object.entries(models).map(([name, m]) => [name, carrierPaths(m.schema)]).filter(([, paths]) => paths.length),
);

describe('every collection holding provider track data has a declared clock', () => {
  it('discovery is not vacuous: it finds the collections this rule was written about', () => {
    expect(Object.keys(carriers)).toEqual(expect.arrayContaining([
      'PlaylistSession', 'ServeEvent', 'UnclassifiedTrack', 'MusicProfile', 'TrackCatalog', 'TrackEmbedding', 'AudioFeature',
    ]));
  });

  it('each carrier has a clock or a named exception — never neither', () => {
    const undeclared = Object.keys(carriers).filter((name) => !PROVIDER_CONTENT_CLOCKS[name] && !NAMED_EXCEPTIONS[name]);
    expect(undeclared).toEqual([]);
  });

  it('no stale declarations: every clock and exception names a real carrier', () => {
    const declared = [...Object.keys(PROVIDER_CONTENT_CLOCKS), ...Object.keys(NAMED_EXCEPTIONS)];
    expect(declared.filter((name) => !carriers[name])).toEqual([]);
  });

  it('a collection is never both clocked and excused', () => {
    expect(Object.keys(PROVIDER_CONTENT_CLOCKS).filter((n) => NAMED_EXCEPTIONS[n])).toEqual([]);
  });

  it('the global-corpus exceptions are exactly what spotifyLeakMonitor counts', () => {
    const corpora = Object.keys(NAMED_EXCEPTIONS).filter((n) => n !== 'MusicProfile').sort();
    expect(Object.keys(defaultCollections()).sort()).toEqual(corpora);
  });

  it('a field-trim clock covers every carrier path of its collection', () => {
    for (const [name, clock] of Object.entries(PROVIDER_CONTENT_CLOCKS)) {
      if (clock.mechanism !== 'field-trim') continue;
      const top = [...new Set(carriers[name].map((p) => p.split('.')[0]))];
      expect(clock.fields).toEqual(expect.arrayContaining(top));
    }
    expect(PROVIDER_CONTENT_CLOCKS.PlaylistSession.fields).toEqual(PROVIDER_CONTENT_FIELDS);
  });

  it('a declared TTL is really on the schema, on the declared field, at most 30 days', () => {
    for (const [name, clock] of Object.entries(PROVIDER_CONTENT_CLOCKS)) {
      if (clock.ttlSeconds == null) continue;
      const ttl = models[name].schema.indexes()
        .find(([keys, opts]) => Object.keys(keys).length === 1 && keys[clock.field] === 1 && opts.expireAfterSeconds != null);
      expect(ttl).toBeDefined();
      expect(ttl[1].expireAfterSeconds).toBe(clock.ttlSeconds);
      expect(clock.ttlSeconds).toBeLessThanOrEqual(MAX_SECONDS);
    }
  });

  describe('a declared job step is really run by the daily job', () => {
    let mem;
    beforeAll(async () => {
      mem = await MongoMemoryServer.create();
      await mongoose.connect(mem.getUri(), { dbName: 'kokonada_clock_structural_it' });
    });
    afterAll(async () => {
      await mongoose.disconnect();
      await mem.stop();
    });

    it('the sessionTrim run reports every clock\'s count', async () => {
      const { process: runJob } = require('../app/workers/sessionTrim.worker');
      jest.spyOn(console, 'log').mockImplementation(() => {});
      const result = await runJob();
      console.log.mockRestore();
      for (const clock of Object.values(PROVIDER_CONTENT_CLOCKS)) {
        expect(result).toHaveProperty(clock.jobCount);
      }
    });
  });
});
