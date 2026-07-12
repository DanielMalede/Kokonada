# Vector-Based Live Discovery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore Spotify-independent Live Discovery by querying our own `TrackEmbedding` corpus with the generation's mood/target vector, as a dark-shipped, fail-safe enhancement.

**Architecture:** A new anonymous `TrackCatalog` (metadata + genres) pairs 1:1 with the existing `TrackEmbedding` corpus. A pure `DiscoveryVectorService` builds a target vector from the biosonic params, `queryNear`s the corpus, excludes the user's library, thresholds, MMR-diversifies, and hydrates hits into playable `discoveryTracks` — feeding the existing `candidatePool` in place of the dead `fetchVibeDiscovery`. A one-time backfill + ingest hook fill the corpus. Everything sits behind `VECTOR_DISCOVERY` (default OFF) and behind the `vectorIndex` port (so a text-embedding v2 drops in later).

**Tech Stack:** Node.js, Mongoose (MongoDB Atlas `$vectorSearch`), BullMQ workers, Jest (`--runInBand --forceExit`). Reuses `services/vector/{vectorIndex,embedding,fakeVectorIndex}`, `services/selection/mmr`, `repositories/audioFeatureRepo` patterns.

**Design spec:** `docs/superpowers/specs/2026-07-12-vector-discovery-design.md`.

## Global Constraints

- **Zero-knowledge:** `TrackCatalog` stores NO `userId`, `profileId`, or any personal/library linkage — purely track-identity metadata. A pinned test asserts the schema paths contain none of these.
- **Enhancement, never a dependency:** discovery code must NEVER throw into the generation path, never block delivery, and return `[]` on ANY failure (missing index, timeout, thin corpus, bad input).
- **TDD iron law:** a failing test is written and watched fail before any implementation. RED → GREEN → REFACTOR.
- **Baseline stays green:** `cd backend && npm test` — currently **94 suites / 1157 pass (+1 todo)**; no regression.
- **Feature flag:** `VECTOR_DISCOVERY` defaults OFF → behaviour identical to today (`discoveryTracks = []`).
- **Commits:** short single-line messages, no body, no trailers, NO AI/Claude/Anthropic attribution.
- **Cloud portal = Pause & Guide:** the Atlas vector index is created by Daniel in the Atlas UI (Task 11); never attempt it from code.
- **Env tunables (all with defaults, read at call time):** `VECTOR_DISCOVERY` (off), `DISCOVERY_K` (30), `DISCOVERY_OVERFETCH` (6), `DISCOVERY_MIN_COSINE` (0.5), `DISCOVERY_QUERY_BUDGET_MS` (2500), `ATLAS_VECTOR_INDEX` (`track_embedding_index`).
- Run backend tests through the Bash tool (PowerShell mangles jest stderr): `cd backend && npm test 2>&1 | grep -aE "Test Suites:|Tests:"`. Single file: `npx jest tests/<file> --runInBand`.

---

## Phase 1 — TrackCatalog (anonymous metadata store)

### Task 1: `TrackCatalog` model

**Files:**
- Create: `backend/app/models/TrackCatalog.js`
- Test: `backend/tests/trackCatalog.model.test.js`

**Interfaces:**
- Produces: mongoose model `TrackCatalog` with schema `{ recordingKey (String, unique, required), canonicalKey (String, indexed, default null), uri (String, default null), title (String, default null), artist (String, default null), genres ([String], default []), updatedAt (Date) }`.

- [ ] **Step 1: Write the failing test**

```javascript
// backend/tests/trackCatalog.model.test.js
const TrackCatalog = require('../app/models/TrackCatalog');

describe('TrackCatalog model', () => {
  it('has the metadata paths keyed by recordingKey', () => {
    const paths = TrackCatalog.schema.paths;
    expect(paths.recordingKey.options.unique).toBe(true);
    expect(paths.recordingKey.isRequired).toBe(true);
    expect(paths.canonicalKey).toBeDefined();
    expect(paths.uri).toBeDefined();
    expect(paths.title).toBeDefined();
    expect(paths.artist).toBeDefined();
    expect(paths.genres.instance).toBe('Array');
  });

  it('ZERO-KNOWLEDGE: stores no user identifiers or linkage', () => {
    const paths = Object.keys(TrackCatalog.schema.paths);
    for (const forbidden of ['userId', 'profileId', 'user', 'listener', 'ownerId', 'userIds']) {
      expect(paths).not.toContain(forbidden);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx jest tests/trackCatalog.model.test.js --runInBand`
Expected: FAIL — `Cannot find module '../app/models/TrackCatalog'`.

- [ ] **Step 3: Write the model**

```javascript
// backend/app/models/TrackCatalog.js
const mongoose = require('mongoose');

// Anonymous global track-metadata catalog: hydrates $vectorSearch hits into playable
// discovery candidates and supplies genres to the embedding. ZERO-KNOWLEDGE — keyed only
// by track identity (recordingKey/canonicalKey); it stores NO userId/profileId and no
// user→track linkage. A track-identity catalog, never a preference graph. Like the other
// global feature caches, it is intentionally outside user erasure (cf. ADR 0008).
const trackCatalogSchema = new mongoose.Schema({
  recordingKey: { type: String, required: true, unique: true },
  canonicalKey: { type: String, default: null, index: true },
  uri:          { type: String, default: null },
  title:        { type: String, default: null },
  artist:       { type: String, default: null },
  genres:       { type: [String], default: [] },
}, { timestamps: { createdAt: false, updatedAt: 'updatedAt' } });

module.exports = mongoose.model('TrackCatalog', trackCatalogSchema);
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd backend && npx jest tests/trackCatalog.model.test.js --runInBand`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/TrackCatalog.js backend/tests/trackCatalog.model.test.js
git commit -m "feat: anonymous TrackCatalog model for vector-discovery hydration"
```

### Task 2: `trackCatalogRepo` (upsert with genre-union, getMany)

**Files:**
- Create: `backend/app/repositories/trackCatalogRepo.js`
- Test: `backend/tests/trackCatalogRepo.test.js`

**Interfaces:**
- Consumes: `TrackCatalog` model (Task 1).
- Produces: `{ upsertMany(entries) → {upserted}, getMany(recordingKeys) → Map<recordingKey, {recordingKey,canonicalKey,uri,title,artist,genres}> }`. `entries` shape: `{ recordingKey, canonicalKey?, uri?, title?, artist?, genres? }`. Upsert unions genres (never shrinks), last-write-wins on scalar metadata.

- [ ] **Step 1: Write the failing test**

```javascript
// backend/tests/trackCatalogRepo.test.js
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const repo = require('../app/repositories/trackCatalogRepo');
const TrackCatalog = require('../app/models/TrackCatalog');

let mongod;
beforeAll(async () => { mongod = await MongoMemoryServer.create(); await mongoose.connect(mongod.getUri()); });
afterAll(async () => { await mongoose.disconnect(); await mongod.stop(); });
afterEach(async () => { await TrackCatalog.deleteMany({}); });

describe('trackCatalogRepo', () => {
  it('upserts and getMany returns hydrated metadata', async () => {
    await repo.upsertMany([{ recordingKey: 'spotify:t1', canonicalKey: 'at:a|b', uri: 'spotify:track:t1', title: 'B', artist: 'A', genres: ['rock'] }]);
    const map = await repo.getMany(['spotify:t1', 'missing']);
    expect(map.get('spotify:t1')).toMatchObject({ uri: 'spotify:track:t1', title: 'B', artist: 'A', genres: ['rock'] });
    expect(map.has('missing')).toBe(false);
  });

  it('unions genres on re-upsert and never shrinks', async () => {
    await repo.upsertMany([{ recordingKey: 'k', genres: ['rock'] }]);
    await repo.upsertMany([{ recordingKey: 'k', genres: ['indie'], title: 'T2' }]);
    const map = await repo.getMany(['k']);
    expect(map.get('k').genres.sort()).toEqual(['indie', 'rock']);
    expect(map.get('k').title).toBe('T2');
  });

  it('empty input is a no-op', async () => {
    expect(await repo.upsertMany([])).toEqual({ upserted: 0 });
    expect((await repo.getMany([])).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx jest tests/trackCatalogRepo.test.js --runInBand`
Expected: FAIL — `Cannot find module '../app/repositories/trackCatalogRepo'`.

- [ ] **Step 3: Write the repo**

```javascript
// backend/app/repositories/trackCatalogRepo.js
'use strict';

const TrackCatalog = require('../models/TrackCatalog');

// Anonymous track-metadata catalog access. Upsert unions genres ($addToSet) so a track
// re-seen from another library only ever GAINS genre signal; scalar metadata is last-write.
async function upsertMany(entries = []) {
  const rows = (entries || []).filter(e => e && e.recordingKey);
  if (!rows.length) return { upserted: 0 };
  await TrackCatalog.bulkWrite(
    rows.map(e => ({
      updateOne: {
        filter: { recordingKey: e.recordingKey },
        update: {
          $set: {
            canonicalKey: e.canonicalKey ?? null,
            ...(e.uri != null ? { uri: e.uri } : {}),
            ...(e.title != null ? { title: e.title } : {}),
            ...(e.artist != null ? { artist: e.artist } : {}),
          },
          ...(Array.isArray(e.genres) && e.genres.length
            ? { $addToSet: { genres: { $each: e.genres } } } : {}),
        },
        upsert: true,
      },
    })),
    { ordered: false }
  );
  return { upserted: rows.length };
}

async function getMany(recordingKeys = []) {
  const out = new Map();
  if (!recordingKeys.length) return out;
  const rows = await TrackCatalog.find({ recordingKey: { $in: recordingKeys } }).lean();
  for (const r of rows) {
    out.set(r.recordingKey, {
      recordingKey: r.recordingKey, canonicalKey: r.canonicalKey ?? null,
      uri: r.uri ?? null, title: r.title ?? null, artist: r.artist ?? null, genres: r.genres ?? [],
    });
  }
  return out;
}

module.exports = { upsertMany, getMany };
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd backend && npx jest tests/trackCatalogRepo.test.js --runInBand`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/repositories/trackCatalogRepo.js backend/tests/trackCatalogRepo.test.js
git commit -m "feat: trackCatalogRepo with genre-union upsert and getMany hydration"
```

---

## Phase 2 — DiscoveryVectorService (the matcher)

### Task 3: `buildTargetVector`

**Files:**
- Create: `backend/app/services/discovery/targetVector.js`
- Test: `backend/tests/targetVector.test.js`

**Interfaces:**
- Consumes: `buildVector` from `services/vector/embedding` (existing; `buildVector(features, genres)` → 70-dim L2-normalized).
- Produces: `buildTargetVector(targetFeatures, seedGenres) → number[70]`. `targetFeatures` = `{ bpm?, energy?, valence?, acousticness?, danceability?, loudness? }` (missing → neutral, handled by `buildVector`).

- [ ] **Step 1: Write the failing test**

```javascript
// backend/tests/targetVector.test.js
const { buildTargetVector } = require('../app/services/discovery/targetVector');
const { DIM, cosine, buildVector } = require('../app/services/vector/embedding');

describe('buildTargetVector', () => {
  it('produces a DIM-length unit vector matching buildVector', () => {
    const v = buildTargetVector({ bpm: 120, energy: 0.4, valence: 0.6 }, ['rock']);
    expect(v).toHaveLength(DIM);
    expect(Math.abs(v.reduce((s, x) => s + x * x, 0) - 1)).toBeLessThan(1e-9);
    expect(cosine(v, buildVector({ bpm: 120, energy: 0.4, valence: 0.6 }, ['rock']))).toBeCloseTo(1, 9);
  });

  it('a track near the target scores higher than one far from it', () => {
    const target = buildTargetVector({ bpm: 90, energy: 0.2, valence: 0.3 }, ['ambient']);
    const near = buildVector({ bpm: 92, energy: 0.25, valence: 0.35 }, ['ambient']);
    const far  = buildVector({ bpm: 175, energy: 0.95, valence: 0.9 }, ['metal']);
    expect(cosine(target, near)).toBeGreaterThan(cosine(target, far));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx jest tests/targetVector.test.js --runInBand`
Expected: FAIL — `Cannot find module '.../discovery/targetVector'`.

- [ ] **Step 3: Write the builder**

```javascript
// backend/app/services/discovery/targetVector.js
'use strict';

const { buildVector } = require('../vector/embedding');

// Build the query vector for discovery from the generation's biosonic target, in the SAME
// space as the corpus (buildVector neutral-fills any missing dim). seedGenres carry the
// genre-bag half of the match.
function buildTargetVector(targetFeatures = {}, seedGenres = []) {
  const f = targetFeatures || {};
  return buildVector({
    bpm: f.bpm, energy: f.energy, valence: f.valence,
    acousticness: f.acousticness, danceability: f.danceability, loudness: f.loudness,
  }, Array.isArray(seedGenres) ? seedGenres : []);
}

module.exports = { buildTargetVector };
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd backend && npx jest tests/targetVector.test.js --runInBand`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/discovery/targetVector.js backend/tests/targetVector.test.js
git commit -m "feat: buildTargetVector maps biosonic targets into the corpus vector space"
```

### Task 4: `withVectorBudget` (wall-clock guard that yields to delivery)

**Files:**
- Create: `backend/app/services/discovery/withVectorBudget.js`
- Test: `backend/tests/withVectorBudget.test.js`

**Interfaces:**
- Produces: `withVectorBudget(promise, ms, fallback) → Promise` — resolves the promise if it settles within `ms`; otherwise resolves `fallback`. A rejection also resolves `fallback` (never throws).

- [ ] **Step 1: Write the failing test**

```javascript
// backend/tests/withVectorBudget.test.js
const { withVectorBudget } = require('../app/services/discovery/withVectorBudget');

const slow = (ms, val) => new Promise(r => setTimeout(() => r(val), ms));

describe('withVectorBudget', () => {
  it('returns the value when it settles in time', async () => {
    expect(await withVectorBudget(slow(5, ['a']), 100, [])).toEqual(['a']);
  });
  it('returns the fallback when the promise is too slow', async () => {
    expect(await withVectorBudget(slow(100, ['a']), 10, [])).toEqual([]);
  });
  it('returns the fallback when the promise rejects', async () => {
    expect(await withVectorBudget(Promise.reject(new Error('boom')), 100, [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx jest tests/withVectorBudget.test.js --runInBand`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the guard**

```javascript
// backend/app/services/discovery/withVectorBudget.js
'use strict';

// Bound a vector query by a wall-clock budget that YIELDS to delivery: on timeout OR
// rejection, resolve the fallback (never throw, never block the generation wall-clock).
function withVectorBudget(promise, ms, fallback) {
  let timer;
  const budget = new Promise(resolve => { timer = setTimeout(() => resolve(fallback), ms); });
  return Promise.race([
    Promise.resolve(promise).catch(() => fallback),
    budget,
  ]).finally(() => clearTimeout(timer));
}

module.exports = { withVectorBudget };
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd backend && npx jest tests/withVectorBudget.test.js --runInBand`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/discovery/withVectorBudget.js backend/tests/withVectorBudget.test.js
git commit -m "feat: withVectorBudget bounds vector queries and yields to delivery"
```

### Task 5: `DiscoveryVectorService.find`

**Files:**
- Create: `backend/app/services/discovery/discoveryVectorService.js`
- Test: `backend/tests/discoveryVectorService.test.js`

**Interfaces:**
- Consumes: `vectorIndex` port (`queryNear`), `buildTargetVector` (Task 3), `withVectorBudget` (Task 4), `trackCatalogRepo.getMany` (Task 2), `mmr.select`/`defaultSimilarity` (existing).
- Produces: `find({ targetFeatures, seedGenres, excludeCanonicalKeys=Set, k, overfetch, minCosine, budgetMs }) → Promise<Array<{ id, uri, title, artist, genres, canonicalKey, recordingKey, isDiscovery:true }>>`. Returns `[]` on any failure/empty. Never throws.

- [ ] **Step 1: Write the failing test**

```javascript
// backend/tests/discoveryVectorService.test.js
const vectorIndex = require('../app/services/vector/vectorIndex');
const { fakeVectorIndex } = require('../app/services/vector/fakeVectorIndex');
const { buildVector } = require('../app/services/vector/embedding');

// In-memory catalog stub matching trackCatalogRepo.getMany's contract.
const catalog = new Map();
jest.mock('../app/repositories/trackCatalogRepo', () => ({
  getMany: async (keys) => new Map(keys.filter(k => catalog.has(k)).map(k => [k, catalog.get(k)])),
}));
const svc = require('../app/services/discovery/discoveryVectorService');

function seed(fake, recordingKey, canonicalKey, features, genres, meta) {
  fake.store.set(recordingKey, { vector: buildVector(features, genres), canonicalKey });
  catalog.set(recordingKey, { recordingKey, canonicalKey, uri: meta.uri, title: meta.title, artist: meta.artist, genres });
}

describe('DiscoveryVectorService.find', () => {
  let fake;
  beforeEach(() => { fake = fakeVectorIndex(); vectorIndex.use(fake); catalog.clear(); });
  afterEach(() => vectorIndex.use(null));

  it('returns nearest, hydrated, non-familiar candidates', async () => {
    seed(fake, 'r1', 'c1', { bpm: 90, energy: 0.2, valence: 0.3 }, ['ambient'], { uri: 'spotify:track:1', title: 'Near', artist: 'A' });
    seed(fake, 'r2', 'c2', { bpm: 175, energy: 0.95, valence: 0.9 }, ['metal'], { uri: 'spotify:track:2', title: 'Far', artist: 'B' });
    const out = await svc.find({ targetFeatures: { bpm: 92, energy: 0.25, valence: 0.35 }, seedGenres: ['ambient'], excludeCanonicalKeys: new Set(), k: 5, minCosine: 0, budgetMs: 500 });
    expect(out[0]).toMatchObject({ uri: 'spotify:track:1', title: 'Near', isDiscovery: true });
    expect(out.map(t => t.canonicalKey)).not.toContain(undefined);
  });

  it('excludes tracks already in the user library (by canonicalKey)', async () => {
    seed(fake, 'r1', 'c1', { bpm: 90, energy: 0.2 }, ['ambient'], { uri: 'spotify:track:1', title: 'Owned', artist: 'A' });
    const out = await svc.find({ targetFeatures: { bpm: 90, energy: 0.2 }, seedGenres: ['ambient'], excludeCanonicalKeys: new Set(['c1']), k: 5, minCosine: 0, budgetMs: 500 });
    expect(out).toEqual([]);
  });

  it('drops hits below the min-cosine threshold', async () => {
    seed(fake, 'r2', 'c2', { bpm: 175, energy: 0.95, valence: 0.9 }, ['metal'], { uri: 'spotify:track:2', title: 'Far', artist: 'B' });
    const out = await svc.find({ targetFeatures: { bpm: 90, energy: 0.1, valence: 0.1 }, seedGenres: ['ambient'], excludeCanonicalKeys: new Set(), k: 5, minCosine: 0.99, budgetMs: 500 });
    expect(out).toEqual([]);
  });

  it('drops hits with no playable uri', async () => {
    seed(fake, 'r1', 'c1', { bpm: 90 }, ['ambient'], { uri: null, title: 'NoUri', artist: 'A' });
    const out = await svc.find({ targetFeatures: { bpm: 90 }, seedGenres: ['ambient'], excludeCanonicalKeys: new Set(), k: 5, minCosine: 0, budgetMs: 500 });
    expect(out).toEqual([]);
  });

  it('never throws — a queryNear failure yields []', async () => {
    vectorIndex.use({ queryNear: async () => { throw new Error('atlas down'); } });
    const out = await svc.find({ targetFeatures: { bpm: 90 }, seedGenres: [], excludeCanonicalKeys: new Set(), k: 5, minCosine: 0, budgetMs: 500 });
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx jest tests/discoveryVectorService.test.js --runInBand`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the service**

```javascript
// backend/app/services/discovery/discoveryVectorService.js
'use strict';

const vectorIndex = require('../vector/vectorIndex');
const trackCatalogRepo = require('../../repositories/trackCatalogRepo');
const { buildTargetVector } = require('./targetVector');
const { withVectorBudget } = require('./withVectorBudget');
const mmr = require('../selection/mmr');

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

// Spotify-independent discovery: match the mood/target vector against our corpus, exclude
// the user's library, threshold, diversify (MMR), hydrate. ENHANCEMENT — returns [] on any
// failure and never throws into the generation path.
async function find({
  targetFeatures = {}, seedGenres = [], excludeCanonicalKeys = new Set(),
  k = num(process.env.DISCOVERY_K, 30),
  overfetch = num(process.env.DISCOVERY_OVERFETCH, 6),
  minCosine = num(process.env.DISCOVERY_MIN_COSINE, 0.5),
  budgetMs = num(process.env.DISCOVERY_QUERY_BUDGET_MS, 2500),
} = {}) {
  try {
    const target = buildTargetVector(targetFeatures, seedGenres);
    const hits = await withVectorBudget(
      vectorIndex.queryNear(target, { k: Math.max(1, k * overfetch) }), budgetMs, []
    );
    // Threshold + exclude familiar (by canonicalKey).
    const kept = (hits || []).filter(h =>
      h && num(h.score, 0) >= minCosine && !excludeCanonicalKeys.has(h.canonicalKey));
    if (!kept.length) return [];

    // Hydrate metadata; drop unplayable (no uri).
    const meta = await trackCatalogRepo.getMany(kept.map(h => h.recordingKey));
    const candidates = [];
    for (const h of kept) {
      const m = meta.get(h.recordingKey);
      if (!m || !m.uri) continue;
      candidates.push({ track: {
        id: m.recordingKey, recordingKey: m.recordingKey, canonicalKey: m.canonicalKey,
        uri: m.uri, title: m.title, artist: m.artist, genres: m.genres || [], isDiscovery: true,
      }, total: num(h.score, 0) });
    }
    if (!candidates.length) return [];

    // MMR diversify to k (reuses the hardened selector).
    return mmr.select(candidates, { k, lambda: 0.7 }).map(s => s.track);
  } catch {
    return []; // enhancement contract: any failure → no discovery, delivery unaffected
  }
}

module.exports = { find };
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd backend && npx jest tests/discoveryVectorService.test.js --runInBand`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/discovery/discoveryVectorService.js backend/tests/discoveryVectorService.test.js
git commit -m "feat: DiscoveryVectorService — vector match, exclude-familiar, threshold, MMR, hydrate"
```

---

## Phase 3 — Corpus pipeline (backfill + ingest)

### Task 6: `catalogAndEmbed` enqueue helper (DI, pure)

**Files:**
- Create: `backend/app/services/discovery/catalogAndEmbed.js`
- Test: `backend/tests/catalogAndEmbed.test.js`

**Interfaces:**
- Produces: `catalogAndEmbed(tracks, deps) → Promise<{catalogued, enqueued}>`. `tracks`: `[{ recordingKey, canonicalKey?, uri?, title?, artist?, genres? }]`. `deps`: `{ upsertCatalog(entries), enqueueEmbedding(recordingKeys, genresByKey) }` (both injected → testable without Mongo/BullMQ). Skips tracks with no `recordingKey`. Idempotent by construction (upsert + queue dedupe upstream).

- [ ] **Step 1: Write the failing test**

```javascript
// backend/tests/catalogAndEmbed.test.js
const { catalogAndEmbed } = require('../app/services/discovery/catalogAndEmbed');

describe('catalogAndEmbed', () => {
  it('upserts catalog metadata and enqueues embedding with genresByKey', async () => {
    const calls = { catalog: null, embed: null };
    const deps = {
      upsertCatalog: async (entries) => { calls.catalog = entries; },
      enqueueEmbedding: async (keys, genresByKey) => { calls.embed = { keys, genresByKey }; },
    };
    const res = await catalogAndEmbed([
      { recordingKey: 'r1', canonicalKey: 'c1', uri: 'u1', title: 'T', artist: 'A', genres: ['rock'] },
      { recordingKey: '', title: 'skip me' },
    ], deps);
    expect(res).toEqual({ catalogued: 1, enqueued: 1 });
    expect(calls.catalog).toHaveLength(1);
    expect(calls.embed.keys).toEqual(['r1']);
    expect(calls.embed.genresByKey).toEqual({ r1: ['rock'] });
  });

  it('no valid tracks is a no-op', async () => {
    const deps = { upsertCatalog: jest.fn(), enqueueEmbedding: jest.fn() };
    const res = await catalogAndEmbed([{ title: 'no key' }], deps);
    expect(res).toEqual({ catalogued: 0, enqueued: 0 });
    expect(deps.upsertCatalog).not.toHaveBeenCalled();
    expect(deps.enqueueEmbedding).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx jest tests/catalogAndEmbed.test.js --runInBand`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the helper**

```javascript
// backend/app/services/discovery/catalogAndEmbed.js
'use strict';

// Fan a batch of library tracks into the discovery corpus: upsert the anonymous catalog
// (metadata + genres) and enqueue an embedding-build job. Deps are injected so the unit is
// pure and testable; the real wiring passes trackCatalogRepo.upsertMany + the embed queue.
async function catalogAndEmbed(tracks = [], deps = {}) {
  const valid = (tracks || []).filter(t => t && t.recordingKey);
  if (!valid.length) return { catalogued: 0, enqueued: 0 };

  await deps.upsertCatalog(valid.map(t => ({
    recordingKey: t.recordingKey, canonicalKey: t.canonicalKey ?? null,
    uri: t.uri ?? null, title: t.title ?? null, artist: t.artist ?? null, genres: t.genres ?? [],
  })));

  const genresByKey = {};
  for (const t of valid) if (Array.isArray(t.genres) && t.genres.length) genresByKey[t.recordingKey] = t.genres;
  await deps.enqueueEmbedding(valid.map(t => t.recordingKey), genresByKey);

  return { catalogued: valid.length, enqueued: valid.length };
}

module.exports = { catalogAndEmbed };
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd backend && npx jest tests/catalogAndEmbed.test.js --runInBand`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/discovery/catalogAndEmbed.js backend/tests/catalogAndEmbed.test.js
git commit -m "feat: catalogAndEmbed fans library tracks into the discovery corpus"
```

### Task 7: Ingest hook — populate the corpus on profile build

**Files:**
- Modify: `backend/app/services/musicProfileService.js:598` (add a `corpusIngest.ingestLibrary(library)` call immediately after the existing `featureService.enqueueHydration(library)` line).
- Create: `backend/app/services/discovery/corpusIngest.js` (thin binding: wires `catalogAndEmbed` to the real repo + queue).
- Test: `backend/tests/corpusIngest.test.js`

**Interfaces:**
- Consumes: `catalogAndEmbed` (Task 6), `trackCatalogRepo.upsertMany`, the embedding queue's add.
- Produces: `corpusIngest.ingestLibrary(libraryTracks) → Promise<{catalogued, enqueued}>` — maps `MusicProfile.library[]` entries (`{ recordingKey?, canonicalKey, uri, title, artist, genres }`) into `catalogAndEmbed`. Best-effort: catches and logs, never throws into profile build.

- [ ] **Step 1: Write the failing test**

```javascript
// backend/tests/corpusIngest.test.js
jest.mock('../app/repositories/trackCatalogRepo', () => ({ upsertMany: jest.fn(async () => ({ upserted: 0 })) }));
jest.mock('../app/queues/queue', () => ({ enqueue: jest.fn(async () => {}) }));

const corpusIngest = require('../app/services/discovery/corpusIngest');
const trackCatalogRepo = require('../app/repositories/trackCatalogRepo');
const { enqueue } = require('../app/queues/queue');
const { QUEUES } = require('../app/queues/definitions');

describe('corpusIngest.ingestLibrary', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('catalogs + enqueues an embedding-build job for tracks with a recordingKey', async () => {
    const res = await corpusIngest.ingestLibrary([
      { recordingKey: 'spotify:t1', canonicalKey: 'c1', uri: 'spotify:track:t1', title: 'B', artist: 'A', genres: ['rock'] },
    ]);
    expect(res.catalogued).toBe(1);
    expect(trackCatalogRepo.upsertMany).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(QUEUES.EMBEDDING_BUILD, { recordingKeys: ['spotify:t1'], genresByKey: { 'spotify:t1': ['rock'] } });
  });

  it('never throws — a repo failure is swallowed', async () => {
    trackCatalogRepo.upsertMany.mockRejectedValueOnce(new Error('db down'));
    await expect(corpusIngest.ingestLibrary([{ recordingKey: 'x' }])).resolves.toMatchObject({ catalogued: 0 });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx jest tests/corpusIngest.test.js --runInBand`
Expected: FAIL — `Cannot find module '.../discovery/corpusIngest'`.

- [ ] **Step 3: Write the binding**

The embedding queue is enqueued via `queues/queue.js`'s `enqueue(queueName, payload)` (a graceful no-op without Redis, so tests/dev are safe); `embedding.worker` reads `job.data.recordingKeys` + `job.data.genresByKey`.

```javascript
// backend/app/services/discovery/corpusIngest.js
'use strict';

const trackCatalogRepo = require('../../repositories/trackCatalogRepo');
const { catalogAndEmbed } = require('./catalogAndEmbed');
const { enqueue } = require('../../queues/queue');
const { QUEUES } = require('../../queues/definitions');

// Real-dependency binding of catalogAndEmbed for profile-build / ingest. Best-effort:
// corpus population is an enhancement and must never break profile assembly. enqueue() is a
// graceful no-op without Redis (dev/test); the worker reads recordingKeys + genresByKey.
async function ingestLibrary(libraryTracks = []) {
  try {
    return await catalogAndEmbed(libraryTracks, {
      upsertCatalog: (entries) => trackCatalogRepo.upsertMany(entries),
      enqueueEmbedding: (recordingKeys, genresByKey) => enqueue(QUEUES.EMBEDDING_BUILD, { recordingKeys, genresByKey }),
    });
  } catch (e) {
    console.warn(`[corpusIngest] skipped: ${e.message}`);
    return { catalogued: 0, enqueued: 0 };
  }
}

module.exports = { ingestLibrary };
```

- [ ] **Step 4: Wire it into profile build (Modify `musicProfileService.js:598`)**

Line 598 already fires `featureService.enqueueHydration(library).catch(() => {})` right after `library` is assembled (this ALSO ensures AudioFeatures via ReccoBeats/LLM — so the corpus's sonic dims fill in). Add the corpus ingest immediately after it — same `library` in scope, same fire-and-forget so it never delays the profile:

```javascript
featureService.enqueueHydration(library).catch(() => {});
require('./discovery/corpusIngest').ingestLibrary(library).catch(() => {}); // grow the discovery corpus
```

- [ ] **Step 5: Run it and watch it pass + full suite green**

Run: `cd backend && npx jest tests/corpusIngest.test.js --runInBand` → PASS (2 tests).
Run: `cd backend && npm test 2>&1 | grep -aE "Test Suites:|Tests:"` → no regression.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/discovery/corpusIngest.js backend/app/services/musicProfileService.js backend/tests/corpusIngest.test.js
git commit -m "feat: grow the discovery corpus on profile build (best-effort ingest hook)"
```

### Task 8: One-time backfill runner

**Files:**
- Create: `backend/app/scripts/backfillDiscoveryCorpus.js`
- Test: `backend/tests/backfillDiscoveryCorpus.test.js`

**Interfaces:**
- Consumes: `MusicProfile` model, `corpusIngest.ingestLibrary` (Task 7).
- Produces: `runBackfill({ batchSize=200, ingest=corpusIngest.ingestLibrary, cursorFactory } ) → Promise<{ profiles, tracks }>` — iterates every `MusicProfile`, ingests each `library`, batched + resumable, throttled. Injected `ingest`/`cursorFactory` make it testable without Mongo.

- [ ] **Step 1: Write the failing test**

```javascript
// backend/tests/backfillDiscoveryCorpus.test.js
const { runBackfill } = require('../app/scripts/backfillDiscoveryCorpus');

describe('runBackfill', () => {
  it('ingests every profile library and tallies totals', async () => {
    const profiles = [
      { library: [{ recordingKey: 'a' }, { recordingKey: 'b' }] },
      { library: [{ recordingKey: 'c' }] },
      { library: [] },
    ];
    const ingested = [];
    const res = await runBackfill({
      ingest: async (lib) => { ingested.push(...lib.map(t => t.recordingKey)); return { catalogued: lib.length, enqueued: lib.length }; },
      cursorFactory: async function* () { for (const p of profiles) yield p; },
    });
    expect(res).toEqual({ profiles: 3, tracks: 3 });
    expect(ingested.sort()).toEqual(['a', 'b', 'c']);
  });

  it('a single profile failure does not abort the run', async () => {
    const profiles = [{ library: [{ recordingKey: 'a' }] }, { library: [{ recordingKey: 'b' }] }];
    let n = 0;
    const res = await runBackfill({
      ingest: async (lib) => { if (n++ === 0) throw new Error('one bad profile'); return { catalogued: lib.length }; },
      cursorFactory: async function* () { for (const p of profiles) yield p; },
    });
    expect(res.profiles).toBe(2);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx jest tests/backfillDiscoveryCorpus.test.js --runInBand`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the runner**

```javascript
// backend/app/scripts/backfillDiscoveryCorpus.js
'use strict';

// One-time backfill: embed every existing MusicProfile library into the discovery corpus.
// Resumable + fault-tolerant by construction (idempotent upserts; a bad profile is logged,
// not fatal). Runs OFF the serving path. Deps injected for testing; defaults hit real infra.
const corpusIngest = require('../services/discovery/corpusIngest');

async function _defaultCursor() {
  const MusicProfile = require('../models/MusicProfile');
  const cursor = MusicProfile.find({}, { library: 1 }).lean().cursor();
  return cursor; // async-iterable
}

async function runBackfill({ ingest = corpusIngest.ingestLibrary, cursorFactory = _defaultCursor } = {}) {
  let profiles = 0, tracks = 0;
  const cursor = await cursorFactory();
  for await (const p of cursor) {
    profiles++;
    const lib = Array.isArray(p?.library) ? p.library : [];
    if (!lib.length) continue;
    try { const r = await ingest(lib); tracks += r?.catalogued ?? 0; }
    catch (e) { console.warn(`[backfill] profile skipped: ${e.message}`); }
  }
  console.warn(`[backfill] done profiles=${profiles} tracks=${tracks}`);
  return { profiles, tracks };
}

// CLI entrypoint: `node app/scripts/backfillDiscoveryCorpus.js` (after DB connect in the caller).
if (require.main === module) {
  require('../config/db').connect().then(runBackfill).then(() => process.exit(0))
    .catch(e => { console.error(e); process.exit(1); });
}

module.exports = { runBackfill };
```

> NOTE: confirm the DB-connect helper path (`../config/db` / `connect`) against the repo's actual bootstrap before running the CLI; the exported `runBackfill` (used by tests + the eventual ops run) does not depend on it.

- [ ] **Step 4: Run it and watch it pass**

Run: `cd backend && npx jest tests/backfillDiscoveryCorpus.test.js --runInBand`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/scripts/backfillDiscoveryCorpus.js backend/tests/backfillDiscoveryCorpus.test.js
git commit -m "feat: one-time backfill of existing libraries into the discovery corpus"
```

---

## Phase 4 — Discovery wiring + flag

### Task 9: Replace `fetchVibeDiscovery` with the vector service behind `VECTOR_DISCOVERY`

**Files:**
- Modify: `backend/app/sockets/biometricHandler.js:516-530` (the spotify `fetchTracks` closure).
- Test: `backend/tests/discoveryWiring.test.js` (unit-test a small extracted adapter — see Step 1).

**Interfaces:**
- Consumes: `discoveryVectorService.find` (Task 5).
- Produces: `vectorDiscoveryFetch({ musicProfile, aiParams, blacklistCanonicalKeys }) → Promise<candidates[]>` — extracts `targetFeatures` + `seedGenres` from `aiParams`, builds `excludeCanonicalKeys` from `musicProfile.library`, calls the service. Flag-gated by the caller.

- [ ] **Step 1: Write the failing test**

```javascript
// backend/tests/discoveryWiring.test.js
const find = jest.fn(async () => [{ id: 'x', uri: 'spotify:track:x', title: 'D', artist: 'A', genres: ['rock'], canonicalKey: 'cx', isDiscovery: true }]);
jest.mock('../app/services/discovery/discoveryVectorService', () => ({ find: (...a) => find(...a) }));
const { vectorDiscoveryFetch, extractTargetFeatures } = require('../app/services/discovery/discoveryFetch');

describe('discoveryFetch', () => {
  beforeEach(() => find.mockClear());

  it('extracts sonic targets from aiParams (bpm center + energy midpoint + valence)', () => {
    expect(extractTargetFeatures({ target_bpm: 120, energy: [0.2, 0.5], valence: 0.6 }))
      .toMatchObject({ bpm: 120, energy: 0.35, valence: 0.6 });
  });

  it('excludes the user library by canonicalKey and returns the service candidates', async () => {
    const out = await vectorDiscoveryFetch({
      musicProfile: { library: [{ canonicalKey: 'owned1' }] },
      aiParams: { target_bpm: 120, energy: [0.2, 0.5], valence: 0.6, seed_genres: ['rock'] },
      blacklistCanonicalKeys: ['bl1'],
    });
    expect(out[0].isDiscovery).toBe(true);
    const arg = find.mock.calls[0][0];
    expect([...arg.excludeCanonicalKeys]).toEqual(expect.arrayContaining(['owned1', 'bl1']));
    expect(arg.seedGenres).toEqual(['rock']);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx jest tests/discoveryWiring.test.js --runInBand`
Expected: FAIL — `Cannot find module '.../discovery/discoveryFetch'`.

- [ ] **Step 3: Write the adapter**

```javascript
// backend/app/services/discovery/discoveryFetch.js
'use strict';

const discoveryVectorService = require('./discoveryVectorService');

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : undefined);
const mid = (r) => (Array.isArray(r) && r.length === 2 ? (num(r[0]) + num(r[1])) / 2 : num(r));

// Map the generator's aiParams to the buildVector feature space. Params carry bpm as a
// center and energy as a [min,max] band — take the center / midpoint.
function extractTargetFeatures(aiParams = {}) {
  return {
    bpm:          num(aiParams.target_bpm) ?? num(aiParams.bpmCenter),
    energy:       mid(aiParams.energy),
    valence:      num(aiParams.valence),
    acousticness: num(aiParams.acousticness),
    danceability: num(aiParams.danceability),
  };
}

// Vector-discovery replacement for the dead fetchVibeDiscovery. Exclude the user's library +
// the anti-repeat blacklist so results are genuinely undiscovered.
async function vectorDiscoveryFetch({ musicProfile = {}, aiParams = {}, blacklistCanonicalKeys = [] } = {}) {
  const exclude = new Set(blacklistCanonicalKeys || []);
  for (const t of musicProfile.library || []) if (t?.canonicalKey) exclude.add(t.canonicalKey);
  return discoveryVectorService.find({
    targetFeatures: extractTargetFeatures(aiParams),
    seedGenres: Array.isArray(aiParams.seed_genres) ? aiParams.seed_genres : [],
    excludeCanonicalKeys: exclude,
  });
}

module.exports = { vectorDiscoveryFetch, extractTargetFeatures };
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd backend && npx jest tests/discoveryWiring.test.js --runInBand`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire the flag into `biometricHandler.js` (Modify 516-530)**

Replace the spotify `fetchTracks` closure body so that, when `VECTOR_DISCOVERY` is on, discovery comes from the vector service; otherwise the current behaviour is preserved. `aiResult.params` is available where `fetchTracks(params)` is invoked (pass it through, or call `vectorDiscoveryFetch` at the existing discovery call site). Concretely:

```javascript
const VECTOR_DISCOVERY = () => process.env.VECTOR_DISCOVERY === 'true';
const { vectorDiscoveryFetch } = require('../services/discovery/discoveryFetch');
// ...
fetchTracks = async (params) => {
  if (VECTOR_DISCOVERY()) {
    // Spotify-independent discovery over our own corpus (dead /v1/recommendations replacement).
    return vectorDiscoveryFetch({ musicProfile, aiParams: params, blacklistCanonicalKeys: [] });
  }
  if (!spotify.artistGenresAvailable()) return [];
  const raw     = await spotify.fetchVibeDiscovery(accessToken, params, { limit: DISCOVERY_FETCH_LIMIT });
  const tagged  = await tagSpotifyDiscovery(accessToken, raw);
  return personalizeWhitelist(tagged, { genreSet: musicProfile.genreSet, knownArtistIds: musicProfile.knownArtistIds });
};
```

> NOTE: if an anti-repeat blacklist set is already in scope at the discovery call site (the 24h hardExcluded keys), thread it into `blacklistCanonicalKeys` for cleaner novelty. Otherwise the library-exclude alone is correct for v1.

- [ ] **Step 6: Run the full suite green**

Run: `cd backend && npm test 2>&1 | grep -aE "Test Suites:|Tests:"`
Expected: no regression (flag defaults OFF → existing discovery tests unchanged).

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/discovery/discoveryFetch.js backend/app/sockets/biometricHandler.js backend/tests/discoveryWiring.test.js
git commit -m "feat: dark-ship vector discovery behind VECTOR_DISCOVERY, replacing dead Spotify discovery"
```

---

## Phase 5 — Observability, Atlas prerequisite, integration

### Task 10: Discovery metrics

**Files:**
- Modify: `backend/app/services/discovery/discoveryVectorService.js` (emit a one-line structured metric per call).
- Test: `backend/tests/discoveryMetrics.test.js`

**Interfaces:**
- Produces: on each `find`, a `console` line `[discovery] candidates=<n> hits=<h> kept=<k> latencyMs=<ms> indexReady=<bool>` (parseable; `indexReady=false` when `queryNear` returned `[]` from a budget/throw). No new deps.

- [ ] **Step 1: Write the failing test**

```javascript
// backend/tests/discoveryMetrics.test.js
const vectorIndex = require('../app/services/vector/vectorIndex');
const svc = require('../app/services/discovery/discoveryVectorService');

describe('discovery metrics', () => {
  afterEach(() => vectorIndex.use(null));
  it('logs a [discovery] metric line per find', async () => {
    vectorIndex.use({ queryNear: async () => [] });
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await svc.find({ targetFeatures: { bpm: 90 }, seedGenres: [], excludeCanonicalKeys: new Set(), budgetMs: 200 });
    expect(spy.mock.calls.flat().some(l => String(l).includes('[discovery]'))).toBe(true);
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx jest tests/discoveryMetrics.test.js --runInBand`
Expected: FAIL — no `[discovery]` line emitted.

- [ ] **Step 3: Add the metric line** to `discoveryVectorService.find` — capture `const t0 = Date.now();` at the top, and before each `return`, emit:

```javascript
console.log(`[discovery] candidates=${candidates?.length ?? 0} hits=${hits?.length ?? 0} kept=${kept?.length ?? 0} latencyMs=${Date.now() - t0} indexReady=${(hits?.length ?? 0) > 0}`);
```

(Compute the values that exist at each return path; use `0`/`false` where a stage was not reached. Keep the enhancement contract — the metric must never throw.)

- [ ] **Step 4: Run it and watch it pass + full suite**

Run: `cd backend && npx jest tests/discoveryMetrics.test.js --runInBand` → PASS.
Run: `cd backend && npx jest tests/discoveryVectorService.test.js --runInBand` → still PASS (5).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/discovery/discoveryVectorService.js backend/tests/discoveryMetrics.test.js
git commit -m "feat: per-generation discovery metrics (candidates/hits/latency/index-ready)"
```

### Task 11: Atlas index prerequisite (Pause & Guide) + end-to-end integration

**Files:**
- Create: `docs/runbooks/atlas-vector-discovery-index.md` (the Pause & Guide runbook — the exact index JSON Daniel creates).
- Create: `backend/tests/discoveryIntegration.test.js`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the runbook (the exact index JSON for Daniel)**

```markdown
# Atlas Vector Search index — discovery corpus (Pause & Guide)

In the MongoDB Atlas UI → your cluster → **Atlas Search** → **Create Search Index** →
**JSON editor** → Database `<prod db>`, Collection `trackembeddings`, name = value of
`ATLAS_VECTOR_INDEX` (default `track_embedding_index`):

​```json
{
  "fields": [
    { "type": "vector", "path": "vector", "numDimensions": 70, "similarity": "cosine" }
  ]
}
​```

Wait until status is **READY**. Until then `queryNear` returns `[]` and discovery stays OFF
(the app logs a one-shot `[vectorIndex] $vectorSearch failed once` warning). Set
`VECTOR_DISCOVERY=true` on Railway ONLY after the index is READY and the backfill has run.
```

- [ ] **Step 2: Write the failing integration test**

```javascript
// backend/tests/discoveryIntegration.test.js
const vectorIndex = require('../app/services/vector/vectorIndex');
const { fakeVectorIndex } = require('../app/services/vector/fakeVectorIndex');
const { buildVector } = require('../app/services/vector/embedding');

const mockCatalog = new Map();
jest.mock('../app/repositories/trackCatalogRepo', () => ({ getMany: async (keys) => new Map(keys.filter(k => mockCatalog.has(k)).map(k => [k, mockCatalog.get(k)])) }));
const { vectorDiscoveryFetch } = require('../app/services/discovery/discoveryFetch');

describe('discovery integration (fake index)', () => {
  let fake;
  beforeEach(() => { fake = fakeVectorIndex(); vectorIndex.use(fake); mockCatalog.clear(); });
  afterEach(() => vectorIndex.use(null));

  it('end-to-end: aiParams → vector match → hydrated, non-familiar, isDiscovery candidates', async () => {
    fake.store.set('r1', { vector: buildVector({ bpm: 100, energy: 0.4, valence: 0.5 }, ['indie']), canonicalKey: 'new1' });
    mockCatalog.set('r1', { recordingKey: 'r1', canonicalKey: 'new1', uri: 'spotify:track:r1', title: 'Fresh', artist: 'New', genres: ['indie'] });
    fake.store.set('r2', { vector: buildVector({ bpm: 100, energy: 0.4, valence: 0.5 }, ['indie']), canonicalKey: 'owned' });
    mockCatalog.set('r2', { recordingKey: 'r2', canonicalKey: 'owned', uri: 'spotify:track:r2', title: 'Have it', artist: 'Known', genres: ['indie'] });

    const out = await vectorDiscoveryFetch({
      musicProfile: { library: [{ canonicalKey: 'owned' }] },
      aiParams: { target_bpm: 100, energy: [0.3, 0.5], valence: 0.5, seed_genres: ['indie'] },
      blacklistCanonicalKeys: [],
    });
    expect(out.map(t => t.canonicalKey)).toEqual(['new1']);
    expect(out[0]).toMatchObject({ uri: 'spotify:track:r1', isDiscovery: true });
  });
});
```

- [ ] **Step 3: Run it and watch it pass**

Run: `cd backend && npx jest tests/discoveryIntegration.test.js --runInBand`
Expected: PASS (1 test) — the whole chain works end-to-end on the fake index.

- [ ] **Step 4: Full suite + commit**

Run: `cd backend && npm test 2>&1 | grep -aE "Test Suites:|Tests:"` → green, no regression.

```bash
git add docs/runbooks/atlas-vector-discovery-index.md backend/tests/discoveryIntegration.test.js
git commit -m "docs+test: Atlas discovery-index runbook + end-to-end vector-discovery integration test"
```

---

## Rollout order (after merge, gated by Daniel)

1. Merge the PR (flag OFF — zero behaviour change).
2. **Pause & Guide:** Daniel creates the Atlas vector index (Task 11 runbook); confirm READY.
3. Run the one-time backfill (Task 8) off-peak; watch `[backfill] done` + Groq spend.
4. Verify corpus size + `[vectorIndex]` has no failure warning; then set `VECTOR_DISCOVERY=true` on Railway.
5. Watch `[discovery]` metrics (hit-rate, latency) + on-device discovery quality; the fallback guarantees no regression if any of the above is not ready.

## Post-implementation

- Resilience audit across Phases 1–5 (degenerate params, index flapping, huge exclude sets, thin corpus) — confirm the enhancement never wedges the hot path.
- Follow-up (separate spec): **text-embedding v2** behind the same `vectorIndex`/`buildVector` boundary for richer semantic discovery.
