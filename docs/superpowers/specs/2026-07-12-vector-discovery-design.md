# Vector-Based Live Discovery Engine — Design (2026-07-12)

> Spotify-independent Live Discovery for Kokonada, built on the existing vector layer
> (`TrackEmbedding` + Atlas `$vectorSearch`). Restores a core vision pillar after the
> Spotify Web API `/v1/recommendations` + `/v1/artists` **403** (app-level Dev-Mode
> restriction, not fixable in code or client-side — see the QueueTrack-payload / Now
> Playing-cover work that established this).

## 1. Problem & Goal

Live Discovery — surfacing tracks the user does **not** already have, matched to the
current mood/biometric target — is a defensible pillar of the product. Its old source,
Spotify `/v1/recommendations` (+ `/v1/artists` for genres), now returns 403 for this
app from anywhere (the 403 is an app-authorization property, not request-origin). The
generation pipeline already degrades gracefully to a familiars-only mix, so playlists
are never empty — but they are less novel.

**Goal:** replace Spotify-sourced discovery with a Spotify-independent engine that queries
our own embedding corpus with the generation's mood/target vector to return relevant,
undiscovered tracks — as a strictly additive **enhancement** that never blocks or breaks
delivery (the magic moment is protected above all).

## 2. Ground Truth (what exists today)

Verified by reading the code, not assumed:

- **Vector layer (built, Spotify-independent):**
  - `TrackEmbedding` — 70-dim vectors, keyed by `recordingKey` (unique) + `canonicalKey`
    (indexed), `model: 'v1-deterministic'`.
  - `vectorIndex` **port** (`services/vector/vectorIndex.js`): `use / upsertMany / getMany /
    queryNear`, with a `mongoAtlasVectorAdapter` (`$vectorSearch`) and a `fakeVectorIndex`
    for tests/local. Swappable — a text-embedding v2 slots in behind the same port.
  - `buildVector(features, genres)` (`services/vector/embedding.js`): **6 audio dims**
    (bpm/energy/valence/acousticness/danceability/loudness; missing → neutral 0.5) + a
    **64-dim FNV-hashed genre bag**, L2-normalized.
  - `embedding.worker` builds vectors off a queue (never on the hot path; idempotent;
    no self-re-enqueue) and optionally LLM-tags vibes.
- **Audio features are NOT Spotify-dead:** `AudioFeature` (`recordingKey`) is populated by
  **ReccoBeats** (`reccoBeatsAdapter`, `source:'api'`, confidence 1.0) with an **LLM
  estimator** fallback (`source:'llm'`, ≤0.7). So the embedding's sonic dims are real.
- **Genres have an LLM path:** `musicProfileService.inferArtistGenres` (Groq) backfills
  genres when Spotify's are missing — Spotify-independent.
- **`queryNear` (`$vectorSearch`) is LATENT:** built + contract-tested, but **not wired
  into discovery** today (vectors currently feed only in-memory MMR diversity). So this
  project is mostly **new wiring of existing infra**, not a rewrite.
- **No global track-metadata catalog exists.** Per-track `uri/title/artist/genres` lives
  ONLY inside per-user `MusicProfile.library[]`. `TrackEmbedding` and `AudioFeature` store
  keys + vectors/features, not display metadata. → a hydration component is required (§4.1).
- **Dead (Spotify 403), being replaced:** `fetchVibeDiscovery` → `getRecommendations`.

## 3. Approved Decisions (2026-07-12)

| # | Decision | Ruling |
| :- | :- | :- |
| Embedding model | **v1 deterministic now** (real ReccoBeats/LLM audio dims + LLM-genre bag); design strictly against the `VectorIndex` port so a **text-embedding v2** drops in later with zero change to matching/pipeline/fallback. |
| Corpus bootstrap | **One-time backfill of existing `MusicProfile` libraries** (instant non-trivial, cross-taste corpus) **+ grow via ingest**. Network-effect: one user's familiars are another's discovery. |
| Matching | **`queryNear` over-fetch → MMR re-rank** (reuse `mmr.js`) → diverse, non-clustered results. |

## 4. Architecture

Each unit has one purpose, communicates through a defined interface, and is testable in
isolation (against `fakeVectorIndex` / in-memory repos).

### 4.1 `TrackCatalog` (NEW — anonymous global metadata store)

The hydration + genre source the corpus currently lacks.

- **Model:** `{ recordingKey (unique), canonicalKey (indexed), uri, title, artist, genres[],
  updatedAt }`. **Anonymous** — NO `userId`, no listener linkage (a track-identity catalog,
  not a preference graph). Zero-knowledge preserved (aligns with the locked biometric/erasure
  rules — nothing here is personal data, so it is intentionally OUTSIDE user erasure, like the
  other global feature caches; document in an ADR, cf. ADR 0008).
- **Population:** written by the same backfill (§4.4) + ingest hook that feed embeddings,
  from `MusicProfile.library[]` entries (upsert by `recordingKey`; last-write-wins on
  metadata; union genres).
- **Reads:** (a) supplies `genres` to `buildVector` at embed time; (b) hydrates `queryNear`
  hits (`recordingKey` → `uri/title/artist/genres`) into playable discovery candidates.
- **Boundary:** a repository (`trackCatalogRepo`) with `upsertMany` / `getMany(recordingKeys)`,
  mirroring `audioFeatureRepo` (Mongo source-of-truth, optional Redis hot cache later).

### 4.2 `DiscoveryVectorService` (NEW — the matcher)

Pure logic behind the `vectorIndex` port; the single home of discovery matching.

- **Input:** the generation's biosonic target (`aiResult.params` / `targets`:
  `bpmCenter`, `energy`, `valence`, `acousticness`, `danceability`, `seed_genres`), the
  user's library key-set (for exclusion), and the 24h anti-repeat blacklist.
- **Steps:**
  1. **Target vector** — `buildVector({ bpm, energy, valence, acousticness, danceability,
     loudness? }, seedGenres)` from the target params (same function the corpus uses, so
     query + corpus live in one space). `loudness` neutral if absent.
  2. **`queryNear(targetVec, { k: DISCOVERY_K × OVERFETCH })`** — over-fetch nearest by cosine.
  3. **Post-filter** — drop hits whose `canonicalKey` is in the user's library set or the
     anti-repeat blacklist (robust vs. an Atlas `filter`, which needs filter-indexed fields).
  4. **Min-similarity threshold** — drop below `MIN_COSINE` (avoid weak/degenerate matches).
  5. **MMR re-rank** (`mmr.js`) over survivors → `DISCOVERY_K` diverse candidates.
  6. **Hydrate** via `trackCatalogRepo.getMany` → candidate objects
     `{ id, uri, title, artist, genres, canonicalKey, isDiscovery:true }`; drop any hit with
     no playable `uri`.
- **Output:** `discoveryTracks[]` in the exact shape `candidatePool`/`pipeline` already consume.
- **Never throws into the caller:** all failure modes return `[]` (see §5).

### 4.3 Discovery wiring (`biometricHandler` generation step)

Replace the dead `fetchVibeDiscovery(accessToken, params)` call with
`discoveryVectorService.find({ targets, userLibraryKeys, blacklist })`. The result flows
into the existing `candidatePool.buildPool({ ..., discoveryTracks })` → `pipeline` → MMR mix
at the current familiar/discovery ratio. **No change** to the selection/mix/ledger contracts
downstream — discovery is just a new *source* of `discoveryTracks`.

### 4.4 Corpus pipeline (backfill + ingest)

- **One-time backfill** (script + queued jobs): iterate all `MusicProfile.library[]` →
  upsert `TrackCatalog` (metadata + genres) → ensure `AudioFeature` exists (enqueue
  ReccoBeats/LLM feature jobs for misses) → enqueue `embedding.worker` jobs
  (`recordingKey` + genres). Batched, throttled, resumable, idempotent. Runs off-hot-path.
- **Ingest hook:** on library ingest/profile-build, enqueue the same catalog+feature+embed
  path for newly-seen `recordingKey`s only (dedup by upsert). Already partially present via
  `embedding.worker`; this wires the enqueue + catalog write.
- **Cost guard:** LLM genre/vibe + LLM feature-estimation are the spend (Groq ~6000 TPM
  ceiling). Batch, cache genres per artist (already cached), embed once per `recordingKey`
  (upsert dedupes, never re-embed), bounded worker concurrency, throttled backfill.

### 4.5 Feature flag & rollout

`VECTOR_DISCOVERY` (default OFF). When OFF, the generation path behaves exactly as today
(`discoveryTracks = []` → familiars-only), so the engine ships dark and is enabled after the
corpus + Atlas index are ready. No user-visible change until flipped.

## 5. Fallback & Edge Cases (the enhancement contract)

Discovery is **strictly additive**; the never-empty familiar-pool + variance ladder (L1–L4)
always backstops it, so the magic moment is untouched.

| Case | Behavior |
| :- | :- |
| Atlas index missing / `$vectorSearch` error | `queryNear` already degrades to `[]` (one-shot warn) → `discoveryTracks=[]` → familiars-only. |
| Cold / thin corpus | Few/no candidates survive → familiars-only; corpus grows with usage. |
| Timeout | `queryNear` bounded by a wall-clock budget that **yields to delivery** (same discipline as the artwork M1 fix); never eats the 30s generation wall-clock. |
| Poor matches | `MIN_COSINE` threshold drops weak hits; too few survivors → familiar-heavy mix (existing ratio-inversion). |
| Hydration miss (no catalog/URI) | Candidate dropped (unplayable); remaining candidates still used. |
| Flag OFF | `discoveryTracks=[]` — identical to today. |

## 6. Observability (engineering-excellence bar)

Metrics (structured logs / counters): corpus size (`TrackEmbedding` + `TrackCatalog`),
per-generation `discovery_candidates_returned`, `discovery_hit_rate`, `queryNear` latency,
`vector_index_ready` (from the adapter's one-shot signal), and LLM-enrichment spend during
backfill. Alert on index-not-ready and on discovery-hit-rate collapse.

## 7. Prerequisites — Pause & Guide (Daniel; no session can satisfy from code)

1. **Atlas Vector Search index** — create in the Atlas UI/API: `{ type: vector, path: "vector",
   numDimensions: 70, similarity: "cosine" }`, name = `ATLAS_VECTOR_INDEX` (default
   `track_embedding_index`), status **READY**. `queryNear` silently returns `[]` until it exists.
2. **Groq TPM headroom** for the backfill's genre/feature-estimation batch (throttle to stay
   under the free ceiling).

## 8. Testing (TDD, iron law)

- `DiscoveryVectorService` — unit-tested against `fakeVectorIndex` + in-memory `trackCatalogRepo`:
  target-vector correctness; exclude-library / blacklist filter; `MIN_COSINE` threshold; MMR
  diversify; empty/degenerate → `[]`; hydration drops URI-less hits.
- `TrackCatalog` repo — upsert idempotency, genre union, `getMany`.
- Corpus backfill — idempotency, batching, resumability, non-blocking; never re-embeds.
- Fallback — `queryNear` `[]` / throw / timeout → familiars-only (generation still emits).
- Adapter contract — extend `vectorRunbook.contract.test` for 70-dim/cosine + the new filter.
- Integration — end-to-end generation with `VECTOR_DISCOVERY` on (fake index) → `discoveryTracks`
  mixed at the ratio, receipts still honest (`isDiscovery` → "New discovery").
- Resilience audit — corpus/query under degenerate inputs (NaN/∞ params, empty seedGenres,
  huge library sets, index flapping); confirm the enhancement never wedges the hot path.

## 9. Scope Boundaries (YAGNI)

- **In:** `TrackCatalog` + repo; `DiscoveryVectorService`; backfill + ingest wiring; discovery
  wiring in `biometricHandler`; flag + fallback + metrics; Atlas index prereq.
- **Out (future):** text-embedding **v2** (only the `VectorIndex` boundary is preserved for it);
  cross-app/external corpus sources; a discovery UI surface (this feeds the existing mix, not a
  new screen); re-embedding schedules (only needed on a model change).

## 10. Open Items for the Plan

- Confirm the exact `MusicProfile.library[]` → `TrackCatalog` field mapping (`recordingKey`
  derivation via `trackIdentity`, genre union source).
- Decide backfill execution: one-shot script vs. a BullMQ backfill queue (prefer the queue for
  resumability/throttle, consistent with existing workers).
- Pin `DISCOVERY_K`, `OVERFETCH`, `MIN_COSINE`, and the `queryNear` wall-clock budget as env-tunable.
