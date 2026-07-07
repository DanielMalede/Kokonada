# Music Classification & Purge — Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax. TDD every task: test → red → green → commit.

**Goal:** Classify each `youtube_music` library track as music vs non-music, hard-delete the non-music, pool the undecidable (Groq-outage) for a periodic worker to resolve — at ingest, on a retroactive purge, and as a hydration pre-step.

**Architecture:** A pure classifier (`musicClassifier`) with a deterministic first pass (YouTube category / topicDetails / channel markers / music-form allowlist / junk lexicon) and a Groq tie-breaker for the ambiguous residue. Non-music → `$pull`; Groq-unavailable → `UnclassifiedTrack` pool drained by a repeatable `reclassify` worker. Wired into the profile build (ingest), a `purgeNonMusic` service, and a `classifyAndHydrate` runner.

**Tech Stack:** Node, Express, Mongoose, BullMQ (in-process), Groq via `llmClient.generateJson`, YouTube Data API via `youtube.js`. Jest with model-mocking (no in-memory Mongo).

## Global Constraints

- Commit style: **short single-line, no body/trailers**.
- Groq free tier **6000 TPM** — Groq only on the ambiguous residue, batched (~40/call), paced by `llmClient`'s existing `withRetry` 429 backoff. No concurrent double-spend.
- **Only `provider: 'youtube_music'` tracks are classified/purged**; Spotify tracks pass through as music.
- **Hard delete on a positive non-music verdict** (`$pull`) — no dry-run, no audit.
- **Ambiguous + Groq unavailable ⇒ `unclassified` pool** (never deleted, never in library) → periodic re-eval promotes (music) or hard-deletes (non-music).
- **Music-form allowlist** (dj set, live set, mix, cover, acoustic, instrumental, remix, live, concert…) overrides the junk lexicon.

## File structure

- Create `app/services/musicClassifier.js` — `classifyByMetadata` (pure), `classifyTracks` (3-way partition + enrich + Groq).
- Modify `app/services/youtube.js` — `fetchVideoTopics` also returns `categoryId`.
- Create `app/models/UnclassifiedTrack.js` — the pool collection.
- Create `app/repositories/unclassifiedRepo.js` — `addMany` / `dueBatch` / `remove` / `reschedule`.
- Modify `app/services/musicProfileService.js` — export `recomputeFootprint`; ingest gate in `buildProfile`.
- Create `app/services/musicPurge.js` — `purgeNonMusic(userId, opts)`.
- Modify `app/queues/definitions.js` — add `RECLASSIFY_UNCLASSIFIED`.
- Create `app/workers/reclassify.worker.js` + register in `app/workers/index.js`; repeatable schedule.
- Create `app/scripts/classifyAndHydrate.js` — the purge-then-hydrate runner.

---

### Task 1: `musicClassifier.classifyByMetadata` (pure verdict)

**Files:** Create `app/services/musicClassifier.js`; Test `tests/musicClassifier.test.js`.
**Produces:** `classifyByMetadata(track, meta = {}) -> 'music'|'non_music'|'ambiguous'`.

- [ ] Test-first (table-driven): categoryId '10' → music; a `/wiki/Rock_music` topic → music; channel `"Artist - Topic"` → music; title `"Sunset DJ Set (live)"` → music (music-form beats junk); title `"my morning routine vlog"` → non_music; categoryId '20' (Gaming) no keep-signal → non_music; Spotify provider → music; bare `"Untitled 3"` no signal → ambiguous.
- [ ] Run → red. Implement the pure function (regex allowlist/junk + category sets, keep-signals evaluated before purge-signals). Run → green. Commit.

### Task 2: `youtube.fetchVideoTopics` returns `categoryId`

**Files:** Modify `app/services/youtube.js`; Test `tests/youtube.fetchVideoTopics.test.js` (mock axios).
**Produces:** each row `{ id, categoryId, topicCategories, tags }`.

- [ ] Test-first: a mocked `videos.list` item with `snippet.categoryId:'10'` → row carries `categoryId:'10'`; missing → `null`. (Existing genre callers ignore the extra field — back-compatible.)
- [ ] Red → add `categoryId: v.snippet?.categoryId ?? null` → green. Commit.

### Task 3: `musicClassifier.classifyTracks` (3-way partition)

**Files:** Modify `app/services/musicClassifier.js`; Test extends `tests/musicClassifier.test.js` (mock `youtube`, `llmClient`).
**Consumes:** `classifyByMetadata`, `youtube.fetchVideoTopics`, `llmClient.generateJson`/`isConfigured`.
**Produces:** `classifyTracks(tracks, { youtubeToken=null, useLLM=true, metaById=null }) -> Promise<{ music, nonMusic, unclassified }>`.

- [ ] Tests: deterministic-only partition; `videos.list` enrichment flips an ambiguous track to non_music; Groq adjudicates residue via `{"non_music":[idx]}`; **`generateJson` throws ⇒ that batch lands in `unclassified` (never nonMusic)**; non-youtube tracks pass straight to `music`; `metaById` provided ⇒ no `fetchVideoTopics` call.
- [ ] Red → implement (pass1 deterministic, pass2 enrich when `youtubeToken && !metaById`, pass3 batched Groq with try/catch → unclassified) → green. Commit.

### Task 4: `UnclassifiedTrack` model + `unclassifiedRepo`

**Files:** Create `app/models/UnclassifiedTrack.js`, `app/repositories/unclassifiedRepo.js`; Test `tests/unclassifiedRepo.test.js` (mock the model).
**Produces:** `addMany(userId, tracks, reason) -> Promise<number>`; `dueBatch(limit, now=Date.now()) -> Promise<rows>`; `remove(_id) -> Promise`; `reschedule(_id, attempts, nextAttemptAt) -> Promise`.

- [ ] Schema: `{ userId(ObjectId,ref User,req), track(Mixed,req), reason(String), attempts(Number,0), createdAt, lastAttemptAt, nextAttemptAt(Date, index) }`, unique compound `(userId, 'track.id')`.
- [ ] Tests (mock model): `addMany` upserts one row per track (idempotent on userId+track.id, `nextAttemptAt` = now); `dueBatch` queries `nextAttemptAt ≤ now` sorted asc limited; `reschedule` sets attempts + nextAttemptAt. Red → implement → green. Commit.

### Task 5: `recomputeFootprint` + ingest gate

**Files:** Modify `app/services/musicProfileService.js`; Test extends its test file (mock `youtube`, `musicClassifier`, `unclassifiedRepo`).
**Produces:** `recomputeFootprint(library) -> { topGenres, topArtists, genreSet }` (export). Ingest: `buildProfile` classifies `ytAnalysis.library` (metaById from already-fetched topics, `useLLM:true`) → keep `music`, drop `nonMusic`, `unclassifiedRepo.addMany(userId, unclassified, 'ingest')` — before the weighting/`library.push`.

- [ ] Test: `recomputeFootprint` ranks genres(≤10)/artists(≤20)/genreSet(distinct). Test: a junk youtube track (classifier → nonMusic) never enters `library`; an unclassified one is pooled not added. Red → implement → green. Commit.

### Task 6: `musicPurge.purgeNonMusic`

**Files:** Create `app/services/musicPurge.js`; Test `tests/musicPurge.test.js` (mock `MusicProfile`, `musicClassifier`, `unclassifiedRepo`, `recomputeFootprint`).
**Produces:** `purgeNonMusic(userId, { youtubeToken=null, useLLM=true }) -> Promise<{ scanned, purged, pooled, kept }>`.

- [ ] Test: mixed library → hard-removes only `nonMusic` youtube ids from `library`, moves `unclassified` to the pool (`addMany` + removed from library), keeps Spotify + music, recomputes footprint, saves; no-junk profile is a no-op. Red → implement → green. Commit.

### Task 7: `reclassify` worker + queue + repeatable schedule

**Files:** Modify `app/queues/definitions.js`, `app/workers/index.js`; Create `app/workers/reclassify.worker.js`; Test `tests/reclassify.worker.test.js` (mock `unclassifiedRepo`, `musicClassifier`, `MusicProfile`, `User`).
**Consumes:** `unclassifiedRepo`, `musicClassifier.classifyTracks`, `recomputeFootprint`.
**Produces:** `QUEUES.RECLASSIFY_UNCLASSIFIED='reclassify-unclassified'`; `reclassify.worker.process(job) -> Promise<{ promoted, deleted, deferred }>`.

- [ ] Test: a due pooled row classified `music` → promoted into the owner's `library` (dedup by canonicalKey, footprint recomputed) + pool row removed; `non_music` → pool row hard-deleted; still `unclassified` (Groq down) → `reschedule` with backoff, not deleted; non-due rows skipped. Registration test: queue name in `QUEUE_NAMES`; processor wired. Red → implement (batch by userId, load token best-effort) → green. Commit.

### Task 8: `classifyAndHydrate.js` runner

**Files:** Create `app/scripts/classifyAndHydrate.js`; Test `tests/classifyAndHydrate.test.js` (mock `musicPurge`, `MusicProfile`, `featureService`, `User`).
**Produces:** `runForUser(userId, { budgetS }) -> Promise<{ purged, pooled, hydrated, missing }>` + a CLI wrapper.

- [ ] Test: for a user, calls `purgeNonMusic` then hydrates the surviving featureless music tracks via `featureService.hydrate`, returns counts; a purge/hydrate failure is caught and reported. Red → implement thin orchestration over tested units → green. Commit.

## Self-review

- Spec coverage: classifier (T1,T3), Groq-at-ingest (T5), music-form allowlist + junk lexicon (T1), hard delete (T6), unclassified pool (T4) + periodic worker (T7), retroactive purge (T6), runner (T8), footprint recompute (T5). ✅
- Types consistent across tasks (`classifyTracks` → `{music,nonMusic,unclassified}` consumed by T5/T6/T7; `recomputeFootprint` shared by T5/T6/T7).
