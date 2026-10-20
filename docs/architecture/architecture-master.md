---
status: reference
verified: 2026-09-30
---

# Kokonada architecture (master)

> **Purpose:** the architecture of the backend and the mobile app as built. Section 0 is the authoritative current state (refreshed 2026-09-02, Wave 4); sections 1–4 are the standing design (section 4 is the mobile design restored from the July §A and §B). The July 2026 roadmap blocks and the sprint history that this file once carried (the "2026-07-07 STATE" block of section 0, the July section 4, and the rest of sections A–D) are history: `docs/ARCHIVE.md` § Deleted names the last commit that holds them. The measured-facts brief of 2026-09-02 is the appendix at the end.

> Written 2026-07-03 at the completion of the backend (Phases 0–7); **last updated 2026-09-02**; moved here from `KOKONADA_ARCHITECTURE_MASTER.md` at the repository root on 2026-10-18.

---

## 0. CURRENT STATE (READ THIS FIRST)

### WAVE 4 UPDATE — RUNTIME INTELLIGENCE (2026-09-02, READ THIS FIRST)

> Supersedes the 2026-07-07 state for everything backend/intelligence. That block was cut from this file
> on 2026-10-18 (`docs/ARCHIVE.md` names the commit that holds it); it was correct about what shipped
> through PR #78 and is ~340 commits stale.
> Authoritative measured facts: `docs/architecture/architecture-master.md#ground-truth-2026-09-02`. Closeout package:
> `WAVE4_REPORT.md (deleted; see docs/ARCHIVE.md)`. Live run state: `docs/plans/WAVE4_STATE.md`.

**Wave 4 (Runtime Intelligence) is complete and merged.** PRs #179 (`44fd951`) and #180 (`0e19ad8`) are
in `main`. It rebuilt both intelligence engines against twenty confirmed ground-truth defects (D1–D20),
all of which are addressed; one (D19, embedding v2) ships dark behind flags awaiting an Atlas index.

**Test baselines:** backend **232 suites / 3866 tests** green (`cd backend && npm test`, exit 0,
475 s, `--runInBand`), up from 91/1126; lint **0 errors / 22 warnings**. Mobile **48 suites / 416 tests**,
untouched this wave (backend-only) — `./node_modules/.bin/jest` from `mobile/KokonadaHealth`.

**What is new, structurally:**
- **`backend/app/agents/runtime/`** — 16 modules implementing `docs/architecture/runtime-agent-architecture.md`.
  These are backend services, **not** Claude Code sub-agents. Ingestion (Hampel + slew + Kalman anomaly
  filter), physiology (personal baselines, cosinor chronobiology, the affect engine, nightly analysis,
  the live state adapter), knowledge (a **34-state / 6-domain** taxonomy, novelty bandit, explain
  templates), translation (the wellbeing regulator), delivery (the trajectory planner), learning (the
  ADR-0012 two-track feedback loop).
- **`backend/sim/`** — a seeded synthetic-human simulator and replay harness (personas, generator,
  replay, soak, state scripts, coverage measurement) that drives the real ingest stack against
  `mongodb-memory-server`. Soak lanes are gated by `RUN_SOAK=1` and stay out of the default CI budget.
- **Four new collections** — `VitalSample`, `RewardEvent`, `MorningState`, `PersonalWeights` — each
  registered in the erasure cascade, Redis purge, wearable-scoped erasure and the Art. 15 export in the
  same PR that introduced it.
- **Three new ADRs** — `0012-learning-compliance`, `0013-state-model`, `0014-embedding-v2`.

**What changed in behaviour that a listener can notice:** stress no longer forces cheerful music
(the old `max(moodValence, 0.6)` floor is gone — regulation is done by trajectory, per VISION §6);
a workout no longer reads as maximal stress; scoring totals are normalised and band width finally
affects fit; one measured dimension can no longer fake a perfect score; playlists are ordered along an
arc instead of by score; taste decays with a ~90-day time constant; recalibration triggers on taxonomy
state rather than bpm deltas; live readings are filtered and persisted. Full before/after list with
evidence: `WAVE4_REPORT.md (deleted; see docs/ARCHIVE.md)` §4.

**Every serving-path change has an env kill-switch** that restores the prior behaviour with no revert and
no deploy (`WAVE4_*_DISABLED`, parsed by `backend/app/utils/envFlag.js`, pinned by
`tests/wave4.killSwitchSpelling.test.js`). None are set in production.

**What is still open:** the embedding-v2 read cutover (needs an Atlas index + a `DISCOVERY_MIN_COSINE`
retune), the user-facing taxonomy vocabulary (compliance review), consent v2 metrics (built and dormant),
and every mobile-side follow-up — `tzOffsetMinutes` emission, `playback_event` emission, and rendering
the Pulse/MorningState superset. See `WAVE4_REPORT.md (deleted; see docs/ARCHIVE.md)` §8 and §10.

---

## 1. System Role & Persona

You are a **Staff-Level Software Architect and Senior Data Scientist** working on
**Kokonada** — a next-generation music platform that generates hyper-personalized
playlists by combining active emotion input (a radial valence/arousal tap interface)
with passive, continuous biometric streams (Health Connect, BLE watch heart rate,
future HealthKit) — Spotify for playback, YouTube as a data engine.

**Working protocol with the product owner (Daniel, GitHub: DanielMalede):**
- Execute in **phases/sprints**. Adopt the relevant specialized **Agent persona** per
  sprint (A1 Identity & Ledger, A2 Feature Store, A3 Biosonic, A4 Selection/Retrieval,
  A5 Platform/Infra, A6 Auth & Accounts, A7 RN Foundation, A8 RN Experience,
  A9 Playback Orchestration, A10 Wearable & Background, A11 Intelligence,
  A12 Compliance, A13 DevOps) — personas are adopted **inline**, not spawned subagents.
- **Strict TDD** (iron law: no production code without a failing test watched first;
  RED → GREEN → REFACTOR; delete code written before its test).
- Per phase: build → full-suite gate → commit → push branch `feat/monster-s<N>-<name>` →
  open PR (`gh pr create --body-file …`) → run the **Shadow Audit** → fix findings →
  post the audit as a PR comment → **STOP and await merge approval**. Merges are
  `gh pr merge <N> --squash --delete-branch`.
- **Git style:** short single-line commit messages, no body, no trailers. No AI/Claude/Anthropic
  attribution in commits or PR bodies — ever.
- The master plan (all 27 tasks, agents, sprint sequence) lives at
  `C:\Users\danie\.claude\plans\system-role-objective-eventual-shore.md`.

**Locked product decisions (do not relitigate):**
1. **Full React Native migration** — the React/Vite web app will be sunset;
   `mobile/KokonadaHealth` (bare RN 0.86, device-proven BLE + Health Connect) grows
   into the unified Kokonada app. The Vercel domain survives for deep links (AASA/assetlinks).
2. **Audio features:** third-party measured API (ReccoBeats-style, by Spotify ID) +
   permanent Mongo cache + Redis hot cache + engineered Groq LLM fallback
   (confidence ≤ 0.7) for YouTube-only tracks. Never pure-LLM features.
3. **Infra "design for both":** ship on Railway + MongoDB Atlas (Vector Search) +
   Redis (Railway add-on) + BullMQ, with strict Repository/Adapter ports so
   Qdrant/Neo4j/Redis-Cloud swap in with zero core-logic rewrites.
   **Never add a `railway up` CI job** (Railway deploys natively from GitHub, root `/backend`).

---

## 2. The Shadow Agent Directive (STANDING ORDER)

Every phase/sprint pairs its build agent with a **Shadow QA & Security Agent**. Since
Phase 4 the standing order is: **every Shadow Audit is an UNRESTRICTED, FULL-SYSTEM
ATTACK** — attack the new code AND all previous phases simultaneously. Nothing is safe.

**The Shadow Audit protocol (how to run it):**
1. After the build is green, switch persona to the Shadow Agent.
2. Write **hostile attack tests first** (RED where a defect is suspected) in
   `backend/tests/shadow.*.test.js` — use **stateful fakes** (real ZSET/Mongo/vector
   semantics), never stub theater. Fuzz with garbage inputs; simulate chaos
   (rate-limit storms, clock drift, cache poisoning, concurrency bursts, env misconfig).
3. Fix every CONFIRMED finding in the same PR; pin every held defense as a permanent test.
4. Post the audit report as a PR comment: a table per attack surface with
   **CONFIRMED → FIXED / DEFENDED (pinned) / ACCEPTED (documented)** verdicts + a score line.
5. The **full backend suite is the regression gate** — every prior phase's attack suite
   must stay green (`cd backend && npm test`; currently **844/844 across 65 suites**).
6. Permanent guards already in CI: an app-wide **purge-scan test**
   (`tests/shadow.flip.test.js`) bans legacy identifiers (`mixPlaylist`, `selectionShadow`,
   `critiqueTrackVibe`, `SELECTION_V2`, `_tierRotated`, `_varietyWindow`, all
   `STRICT_*`/`COOLDOWN_*` names, `isRepeatMood`, `pickSortAxis`, …) from the entire
   `app/` tree, comments included.

**Shadow scorecard to date: 22 confirmed kills fixed pre-merge**, including: Unicode
scrub breaking non-Latin dedup; ISRC junk collisions; ioredis offline-queue memory leak;
batch-size-0 → V8 OOM process death; ReccoBeats-outage permanent data poisoning;
NX cache backfill race; clock-drift decay explosion (4.26×10³⁹); NaN score poisoning;
keyless-entry batch rejection; state-vector queue flooding; pool cache-poisoning
identity bypass; Redis write-drop ledger lie; 975ms MMR latency; scorer env-read waste;
orphaned DB index; dangling comments/exports.

---

## 3. Completed Backend (Phases 0–7) — Exact Architecture

All paths relative to `backend/app/`. Merged PRs: **#35** (Phases 0–1), **#36** (Phase 2),
**#37** (Phase 3), **#38** (Phase 4), **#39** (Phase 5), **#40** (Phase 6).
**#41 (Phase 7) is OPEN awaiting merge.**

### 3.0 Queue/Worker platform (Phase 0)
- `queues/queue.js` — BullMQ seam: `enqueue(name, payload, opts)` /
  `scheduleRepeatable(name, cron, payload)`; validates names against
  `queues/definitions.js` (`feature-hydration`, `embedding-build`,
  `state-vector-recompute`; **+`biometric-buffer`** — approved 2026-07-06, Part 3 shadow
  worker, band-transition-debounced, precompiles a zero-latency Live-mode buffer from the
  cached feature store and records NO serves until played); **graceful no-op without `REDIS_URL`**; producers use
  `createConnection({ enableOfflineQueue: false })` (fail-fast — the offline-queue
  leak fix) and catch broker errors → `{queued:false, reason:'redis-error'}`.
- `workers/index.js` — `startWorkers(processors = DEFAULT_PROCESSORS)`; registry maps
  all three queues to `featureHydration.worker`, `stateVector.worker`, `embedding.worker`.
- `config/redis.js` — shared `getRedis()` (nullable) + `createConnection(overrides)`
  with `maxRetriesPerRequest: null` for BullMQ.

### 3.1 Canonical Track Identity (Phase 1)
- `services/identity/trackIdentity.js` (pure):
  `canonicalKey({title,artist,isrc,provider,id})` → `isrc:<ISRC>` when shape-valid
  (`^[A-Z]{2}[A-Z0-9]{3}\d{7}$` — junk like "n/a" falls through) else
  `at:<normArtist>|<normTitle>`. Normalization: NFKD → strip Latin combining marks
  (U+0300–U+036F only) → **NFC re-compose** (CJK dakuten survive) → casefold →
  strip feat./ft./featuring (bare "with" never stripped) → strip paren/bracket noise
  (word-bounded: remaster|live|lyric|official|video|…; **remix is NEVER collapsed**) →
  strip dash-suffix descriptors ("- Remastered 2011") → Unicode scrub
  (`[^\p{L}\p{N}]+`→space; apostrophes deleted). Fallback `<provider>:<id>`, else null.
- Attached at profile build (`musicProfileService` — both Spotify & YouTube branches,
  which also persist `isrc` from `track.external_ids.isrc`); `MusicProfile.library`
  entries carry `isrc` + `canonicalKey`; `PlaylistSession.trackKeys[]` mirrors trackIds.
- **Identity trust boundary:** library keys (attached at build) are trusted/filled-if-missing;
  discovery candidates and Redis-cached pool partitions are ALWAYS recomputed
  (cache-poisoning defense).

### 3.2 Audio Feature Store (Phase 2)
- `models/AudioFeature`: keyed by **recordingKey** (`spotify:<id>` / `youtube:<videoId>`)
  — unique; `canonicalKey` non-unique grouping (**F3 ruling:** live vs studio share a
  ledger identity but NEVER share features); fields bpm/energy/valence/acousticness/
  danceability/loudness, `source:'api'|'llm'`, `confidence`, `vibeTags[]`.
- `services/features/featureProvider.js`: the port + `clampFeatures` trust boundary
  (whitelist, coercion, range clamps: bpm 30–260, loudness −60–5, rest 0–1) +
  `recordingKeyOf`/`spotifyIdOf`.
- `reccoBeatsAdapter`: batch by Spotify id (`RECCOBEATS_URL|_BATCH(≥1 clamp — OOM guard)|_TIMEOUT_MS`),
  429-aware retry via `utils/retry.withRetry`, matches responses by href-embedded id,
  never throws (failed batch → `features:null`).
- `services/llmClient.js`: Groq client (`LLM_API_KEY|GROQ_API_KEY`, `LLM_BASE_URL`,
  default `openai/gpt-oss-20b` from `config/llmProvider`), `generateJson(prompt, {model,timeoutMs,temperature})`,
  `isConfigured()`.
- `llmEstimatorAdapter`: **only for tracks the API can never serve** (never for API
  outages — the outage-poisoning fix); genre-anchored few-shot prompt, estimates joined
  by INDEX (coerced `Number(est.i)`), fence-tolerant parse, confidence hard-capped 0.7.
- `repositories/audioFeatureRepo`: cache-aside (Redis `af:{key}` TTL 7d → Mongo truth);
  **api docs write-through; llm docs only invalidate (DEL)**; llm upsert filter
  `{recordingKey, source:{$ne:'api'}}` + unique index ⇒ estimates can never clobber
  measurements (E11000 swallowed); read-backfill uses `SET … NX`;
  `setVibeTags` (invalidate), `llmUpgradeCandidates(limit)`.
- `services/features/featureService`: `hydrate(tracks)` — one `getMany` read, two
  cohorts: MISSING hydrate (api-first, llm only for unservable), stored **llm docs whose
  track gained a Spotify id are UPGRADED via the API**; tail enqueues `embedding-build`
  with `{recordingKeys, genresByKey}`. `enqueueHydration(tracks)` diffs then queues
  minimal payloads; never throws. Wired fire-and-forget in `buildProfile` tail and
  post-emit in the handler. Failed-both tracks are NOT persisted (no null poisoning).
- `workers/featureHydration.worker`: default mode + `mode:'upgrade-llm'` scan.

### 3.3 ServeLedger + Exposure Decay (Phase 3) — the Variance Engine core
- `models/ServeEvent`: `{userId, canonicalKey, moodKey, bioState:{tempoBand,activity},
  sessionId, servedAt}`; indexes `(userId,servedAt)`, `(userId,canonicalKey,servedAt)`,
  **TTL 90d**. `bioState` holds coarse bands ONLY — never raw HR (zero-knowledge).
- `services/ledger/serveLedger.js`: Redis ZSET hot windows `ledger:{userId}:served` and
  `ledger:{userId}:mood:{moodKey}` (score = servedAt ms, pruned on write to
  `LEDGER_HOT_DAYS=8`, TTL 8d) over Mongo as source of truth; lazy rebuild on missing
  key **answers from the Mongo rows directly** (never trusts a Redis write→read
  round-trip — the write-drop fix). API: `recordServes({userId,sessionId,entries}, now)`
  (server clock owns timestamps; keyless entries filtered), `hardExcluded(userId, now)`
  (**24h global window — NEVER relaxed**), `moodExcluded(userId, moodKey, now)`
  (72h per-mood), `getExposure(userId, keys, now)` (30d durable history).
  Env: `LEDGER_GLOBAL_EXCLUDE_HOURS=24`, `LEDGER_MOOD_EXCLUDE_HOURS=72`,
  `LEDGER_DECAY_TAU_HOURS=96`, `MOOD_PROXIMITY_SIGMA=0.4`.
- `services/ledger/exposureScore.js` (pure):
  `penalty = Σ W·exp(−ageHours/τ)·exp(−euclid(moodCoords)/σ)` over (energy, valence);
  age clamped ≥ 0 (clock-drift guard), non-finite timestamps skipped (NaN guard).
- `moodDescriptors.js` additions: `moodCoords(moodKey)` (presets derive from the MOODS
  tap table: energy=(y+1)/2, valence=(x+1)/2; `bio:*` parse → band energy
  {resting .2, active .6, peak .9}, valence .5; unknown → center) and
  `syntheticBioMoodKey(hr, activity)` → `bio:<band>:<activity>` (deterministic,
  biometric inputs only — **closed the historic HR-branch moodKey=null bypass**);
  `bandFromHeartRate`: <90 resting, <120 active, ≥120 peak.
- Every emit records serves (both branches) with the synthetic bio moodKey on HR.

### 3.4 Biosonic Translation (Phase 4)
- `services/biosonic/translate.js` — **PURE, zero I/O, range-clamped for ANY input**
  (300-round fuzz pinned). `translate({live:{heartRate,activity}, baselines:{rhrMedian,
  rhrMAD,hrvMedian,hrvMAD}, sleep:{lastNight:{deep,light,rem}, baseline}, state:{hrv,
  bodyBattery,dailyReadiness}, hourOfDay, moodKey})` →
  `{bpmCenter, bpmWidth, energyFloor, energyCeiling, valenceTarget, acousticnessBias,
  instrumentalBias, tempoBand, confidence, state:{recovery,stress,exertion}}`.
  - Robust z: `(x−median)/(1.4826·MAD)` with fallback MADs; explicit null guards
    (**gotcha: `Number(null)===0`**).
  - Recovery R = mean(sleepScore [stage-weighted deep×1.5/rem×1.2 vs baseline-or-543
    default night], hrvScore [.5+.2z], battery/100, readiness/100) else 0.6.
  - Stress S = mean(hrvSuppression [clamp01(−.4z)], restingElevation [.25z, resting only]) else 0.2.
  - Exertion E = max((hr−60)/100, activity floor {walking .35 … running .65}).
  - **energyCeiling = clamp((0.35 + 0.6R)·windDown, 0.2, 0.95)** — recovery gates
    energy: a wrecked body gets no bangers even on an "energize" tap.
  - BPM entrainment: walking/running/cycling cadence-lock 118/162/145; else
    round(.55·(70+intentEnergy·90) + .45·(60+E·100)); windDown ×0.8 when hour ≥21 or <5.
  - S≥.6 → bpmWidth 8, acousticness +.3, instrumental +.2, valence floor .6; S≥.35 → 14/.15/floor .5; else 20/0.
  - Confidence 1 − 0.15/missing input group, floor 0.3. Golden test: 4h sleep + high
    stress + walking (exact numbers) vs well-rested control.
- `services/biosonic/baselines.js`: 30-day resting-HR median/MAD.
  **ZERO-KNOWLEDGE BOUNDARY:** BiometricLog.heartRate is app-encrypted — decryption
  happens ONLY inside the worker (paged non-lean mongoose docs, `_id` pagination,
  MAX 40×5000 rows); <10 samples → null (never fabricated). Redis cache
  `bio:baseline:{userId}` stores an **AES-256-GCM blob AAD-bound to the userId**
  (cross-user replay rejected → fresh compute), TTL 6h.
  `peekBaselines(userId)` = request-safe cache-only read (+ debounced recompute enqueue).
  **Gotcha: `decrypt(blob, parseJson, aad)` — AAD is the THIRD argument.**
- Sleep semantics fix: `MedicalProfile.lastNightSleep{deep,light,rem (encrypted), date}`
  + `sleepUpdatedAt` — latest-night sums (sleep debt input) beside the median
  `sleepStages` baseline; night-date guard stops backfills overwriting fresher nights.
  `metricStore.persistMetrics` writes both (explicit `encrypt()` on `$set` — setters
  don't run on findOneAndUpdate) and enqueues `state-vector-recompute` **debounced**
  (`jobId: state-vector:{userId}`, delay 60s, removeOnComplete/Fail — the flood fix).
- `workers/stateVector.worker`: fresh baselines + encrypted cache refresh +
  `upsertStateVector(userId, telemetry)`.

### 3.5 Selection Pipeline (Phase 5) + 3.6 The Flip (Phase 6) + 3.7 The Seal (Phase 7)
- `services/selection/candidatePool.js`: per-(user,mood) library partitions —
  exclude-genre filtered (exact token), **`SELECTION_POOL_MAX=10000`** (full-library;
  approved 2026-07-06 — the old 500 affinity-slice caused L4 collapse → "same playlist";
  variety is now the uncapped pool + exposure decay, still deterministic, NO seeds per §3.7),
  Redis-cached `pool:{userId}:{moodKey}` TTL 12h invalidated by `lastAnalyzed`;
  **cached partitions re-run attachCanonicalKeys on load**; discovery appended fresh
  with forced key recompute; canonical dedup at the pool (library first).
- `services/selection/hardFilters.js` (pure): ledger windows (absolute) → provider
  routing → EXACT-TOKEN genre exclusion ("pop punk" no longer kills "pop"). The energy/tempo
  constraint moved OUT of the relaxable filters into `services/selection/biosonicBand.js`
  (approved 2026-07-06) — an **un-relaxable pre-filter** applied before the ladder: keep a
  featured track iff `bpm ∈ [center ± τ(c)·bpmWidth]` AND `energy ∈ [floor ∓ (τ(c)−1)·0.1, ceil]`,
  where `τ(c)=1.0+2.0·σ(10·(0.6−c))` (logistic, replaces the binary `confidence ≥ 0.7` gate:
  tight band at high confidence, widens smoothly + bounded when unsure). Featureless tracks pass
  (unknown penalty in score).
- `services/selection/score.js` (pure): terms tasteAffinity (affinity/max),
  featureDistance (gaussian bpm fit `exp(−((bpm−center)/(2·width))²)` + energy-mid +
  valence + acoustic-bias dims), moodGenreFit (1 / 0.3 / 0.5 neutral), exposurePenalty
  (reuses exposureScore, capped 2), discoveryBonus, unknownFeaturePenalty. Weights
  `SCORE_W_TASTE=.35|FEATURE=.30|GENRE=.20|EXPOSURE=.40|DISCOVERY=.10|UNKNOWN=.05` —
  **memoized once** (hot-path fix; `_resetWeights()` for tests); allow-genre Sets
  memoized per array reference.
- `services/selection/mmr.js`: greedy MMR, λ=0.7, top-window scan (max(2k,100)),
  **branch-and-bound cutoff** (score-sorted ⇒ λ·total upper bound); similarity:
  same artist → 1; **embedding cosine primary** (Phase 7); else .6·featureSim+.3·genreJaccard
  (WeakMap-memoized genre sets).
- `services/selection/pipeline.js` — `selectPlaylist({userId, musicProfile, moodKey,
  provider, aiParams, targets, discoveryTracks, k=50, now, ignoreExclusions})`:
  pool → parallel [hardExcluded, moodExcluded] + [features, exposure, embeddings
  (`.catch(()=>new Map())`)] → **un-relaxable biosonic band pre-filter** (biosonicBand.js — mood
  identity, NEVER relaxed) → **relaxation ladder** over anti-repetition/genre only: L0 full →
  L1 drop genre excludes → L2 drop mood window (**hardExcluded NEVER relaxed**) →
  **L4 last-resort** (approved 2026-07-06, generalizing PR #64): replay FAMILIAR tracks ignoring
  the serve windows but STILL within the biosonic band — never serve empty, never serve off-mood;
  only a literal-zero band widens (`bandWidened=1`) as absolute last resort → score → MMR →
  `{tracks, telemetry:{poolSize, featured, banded, afterFilters, relaxLevel, bandWidened, degraded, stageMs}}`.
  Ledger total-outage → degraded=true, empty sets.
  Per-call latency pinned <300ms sequential; bursts are throughput-bounded (queueing).
- `services/generation/orchestrator.js` — **THE ONLY SERVING PATH** (`generateV2`,
  unconditional; `SELECTION_V2`/`isV2`/rollback deleted in Phase 7): assembles
  peekBaselines + MedicalProfile (lastNightSleep, hrv, bodyBattery, dailyReadiness) +
  live {heartRate, activity} + hourOfDay → `translate()` targets → selectPlaylist →
  `{familiar, discovery, merged, telemetry, targets}` (legacy playlist shape preserved).
- `sockets/biometricHandler.js` (the 800-line handler, now lean): socket events
  `emotion_update`/`biometric_push`/`request_playlist`/`request_heart_playlist` →
  `generateAndEmitPlaylist` → LLM (`buildEmotionPlaylist`/`adjustBiometricPlaylist`,
  Groq via geminiEngine — **no variation seeds, deterministic prompt cache**; the
  fetchTracks closure does vibe-playlist sourcing + `personalizeWhitelist` ONLY — the
  critic left the hot path and `critiqueTrackVibe` was deleted) → `orchestrator.generateV2`
  → Spotify URI translation (`crossPlatform.translateToSpotify`) → emit → PlaylistSession
  (with trackKeys + moodKey incl. `bio:*`) → fire-and-forget: `enqueueHydration(merged)`
  + `serveLedger.recordServes`. LLM failure → `buildMoodParams` deterministic on-vibe
  fallback through generateV2 (discovery []) → `generateFallbackPlaylist` static last resort.
- **Vector layer (Phase 7):** `models/TrackEmbedding` (recordingKey unique, 70-dim);
  `services/vector/vectorIndex.js` port (`use(adapter)` injection) →
  `mongoAtlasVectorAdapter` (`$vectorSearch` on index `ATLAS_VECTOR_INDEX=
  track_embedding_index`, **degrades to []** off-Atlas) + `fakeVectorIndex` (stateful,
  brute-force cosine); `embedding.js` `buildVector(features, genres)` = 6 normalized
  feature dims + 64-dim FNV1a-hashed genre bag, L2-normalized, deterministic
  (**gotcha: never name a function `process` — it shadows the Node global**).
- `workers/embedding.worker`: vectors + optional sanitized vibeTags (≤5 tags ≤24 chars,
  index-joined, `VIBE_ENRICH!=='false'` + llmClient configured); one-pass, no re-enqueue.
- `playlistMixer.js` = ONLY `{personalizeWhitelist, generateFallbackPlaylist}`.

### Data models summary
`User` (OAuth tokens, watch token hash) · `MusicProfile` (library[] w/ canonicalKey+isrc,
topGenres, genreSet, knownArtistIds) · `PlaylistSession` (trackIds+trackKeys, moodKey
always set, encrypted contextPrompt/biometricSnapshot; **orphaned (userId,moodKey,createdAt)
index removed** — prod: `db.playlistsessions.dropIndex('userId_1_moodKey_1_createdAt_-1')`) ·
`MedicalProfile` (encrypted scalars, sleepStages median baseline, lastNightSleep, stateVector) ·
`BiometricLog` (encrypted HR time-series, 100k cap) · `ServeEvent` (TTL 90d) ·
`AudioFeature` · `TrackEmbedding`.

### Encryption & zero-knowledge posture
AES-256-GCM field-level (`utils/encryption.js`; key rotation via ENCRYPTION_KEY_PREVIOUS;
**AAD binding available — decrypt(blob, parseJson, aad)**). Raw vitals: encrypted in
Mongo, decrypted only in worker scope; ledger stores coarse bands; baseline cache is
AAD-bound ciphertext; worker job summaries carry no biometric values; `translate()`
output is a whitelisted derived-targets shape.

---

## 4. Mobile: standing design

> Restored on 2026-10-19 from §A.1–A.4 and §B.1, §B.2, §B.4 of the July master (`KOKONADA_ARCHITECTURE_MASTER.md` at commit `c866bf9`), which the move had cut as sprint history: they are the standing design of `mobile/KokonadaHealth`. The sprint narrative around them is a Deleted row in `docs/ARCHIVE.md`. Written in July 2026; verify any line against the code before relying on it. A.2's on-device encryption and B.4's prompt path were corrected against the code on 2026-10-20.

### A.1 Three-lane state architecture
The single most important mobile concept. Sensor/gesture data, live device state,
and committed intent live in **three separate lanes** so a 120 Hz gesture never
touches the JS thread and biometrics never touch disk:

- **HOT lane** — Reanimated SharedValues + worklets on the UI thread (120 Hz). The
  radial-wheel gesture math runs here; only a *single* `runOnJS` crosses to JS on
  gesture-end. The commit boundary is `src/state/hot/laneCommit.ts` (pure, tested):
  `clampToDisc` (unit-disc clamp, NaN→center), `TapCommitter` (aliasing-safe COPY +
  gesture-end debounce so a reused worklet frame object can't retro-corrupt a
  committed tap), `smoothTowards` (TIME-based exponential smoothing → frame-rate
  independent, the aura's degrade-gracefully-at-30fps guarantee).
- **WARM lane** — `zustand/vanilla` store `src/state/warm/warmStore.ts`. Live,
  EPHEMERAL, **never persisted**: `liveHr` (plausibility-gated 30–220), `connection`
  (**the Kokonada SERVER-socket status — NOT the biometric transport; keep these
  lanes independent, see S12-1**), `biometricSource`, `permissions`. Holds the
  Background-Permission-Revocation reconciler (`setPermissions` severs biometrics
  → source `none`, drops stale HR).
- **COLD lane** — Redux Toolkit `src/state/cold/emotionSlice.ts`. Committed intent
  (`taps[]` ≤3 ring buffer, `activity`, `textPrompt`), the ONLY persisted lane.
  `serializeForPersist`/`deserializeForPersist` are a **hard allowlist** — a
  tampered/stale blob can't inject a biometric field, a privilege flag, or a
  `__proto__` payload, and can't grow the tap buffer past 3. `setTextPrompt` and
  deserialize both run `sanitizePrompt` (see B.4).

### A.2 Encrypted persistence (`SecureStore`)
`src/storage/secureStore.ts` — the ONLY sanctioned persistence path. Ports
`KVBackend` + `Cipher` (injected; tests use fakes). In production `mmkvBackend` is an
MMKV instance under MMKV's native AES (AES-128 in CFB mode, unauthenticated), keyed by
a random key held in the Keychain / Keystore; MMKV uses at most 16 bytes of key and the
app hands it 64 hex characters, so only the first 16 characters (64 bits) count, and
the production `Cipher` (`src/platform/mmkvCipher.ts`) is a passthrough, not a second
layer (`MB-133`; corrected 2026-10-20). It is
**encrypted-only** (refuses a backend not flagged `encrypted`), **biometric-denying**
(a hard `bio:/hr:/biometric:` key-prefix denylist; it refuses those keys and never
inspects a value), and **fail-soft** (a full/interrupted device returns `false`/`null`,
never throws into the UI thread). `ColdPersistence` namespaces the persisted key by
`userId` (shared-device isolation — user A's intent never rehydrates into user B),
and `wipe()` detaches the writer BEFORE resetting so logout leaves zero bytes.

### A.3 Socket & Spotify lifecycle (the fragile edges)
- **`src/net/socketClient.ts` (`KokonadaSocket`)** — typed Socket.IO client, the one
  module owning connection lifecycle: **reqId gating** (stale responses dropped —
  zombie-navigation defense), **reconnect re-hydration** (re-emits `emotion_update`
  on EVERY connect because the server's emotion cache is keyed by socketId),
  `auth_expired` → **refresh-then-reconnect-ONCE** with a loop cap (self-DoS defense),
  and `teardown()` detaches a replaced/closed socket's listeners so a late buffered
  event can't corrupt the new session (S9-1). Transient reconnects delegate to
  socket.io's own backoff — never a manual parallel-socket storm. Handles
  `playlist`, `playlist_error` (reqId-gated), `auth_expired`, `disconnect`.
- **`src/experience/player/spotifyController.ts` (`SpotifyPlayerController`)** — wraps
  the notoriously fragile `react-native-spotify-remote` behind a `SpotifyRemoteLike`
  port. EVERY failure mode (connect reject, command throw mid-song,
  `remoteDisconnected`, revoked auth) collapses into a clean `disconnected` state and
  a `{ok:false}` result — **never** an unhandled rejection that white-screens the app.
  Capped reconnect. `getPlaybackState()` reads the native truth for the foreground
  reconcile.
- **Auth bridge** — `src/auth/authSession.ts` (`AuthSession`) solves the async→sync
  gap: `KokonadaSocket` needs a SYNCHRONOUS `getAccessToken()` but tokens live in the
  async Keychain. It loads once into memory, serves the access token synchronously,
  and does **single-flight** rotating refresh (concurrent `auth_expired` + a 401 can't
  double-rotate and burn the token family).

### A.4 Navigation & bootstrap
`src/navigation/RootNavigator.tsx` — 5-tab shell (Generate / Now Playing / Pulse /
History / Profile). `src/experience/playback/playbackServices.ts` composes the app
singletons (session → socket → player → orchestrator → nowPlaying/error stores);
`App.tsx` wraps in `GestureHandlerRootView` + Redux + SafeArea, calls `startPlayback()`
and mounts `<AppLifecycle/>` (the AppState foreground hook).

### B.1 The Skia Radial Wheel
`src/experience/wheel/wheelGeometry.ts` (pure) + `RadialWheel.tsx` (Skia + gesture-
handler + Reanimated). `screenToCircumplex` maps a finger position to a circumplex
coord (x=valence −1..1, y=arousal −1..1), **Y-flipped** (screen-down → arousal-up),
unit-disc clamped, NaN/Infinity/zero-radius safe, signed-zero normalized. The gesture
worklet commits ONE tap per gesture-end via a single `runOnJS` — the ≤3-tap payload
contract is byte-identical to the web. Committed dots draw back with
`circumplexToScreen` at recency-ordered opacity.

### B.2 The Bio-aura Shader (NaN-clamped)
`src/experience/aura/auraUniforms.ts` (pure) + `BioAura.tsx` (Skia `Blur` glow).
`deriveAuraUniforms(hr)` → `{hue 0–360, intensity 0–1, pulseHz 0.1–4}`, **every output
hard-clamped and finite** — a single NaN/Infinity uniform crashes the whole Skia
surface, so a null HR yields a calm `RESTING_AURA` and an absurd HR spike (0, 300,
9999, ∞) is clamped, strobe-capped at 4 Hz. `advancePulsePhase` advances the breathing
by ELAPSED TIME (frame-rate independent, wrapped to [0,2π), dropped-frame safe).

### B.4 The Emotional Prompt Box (sanitized, 500-char)
`promptSanitizer.ts` (`MAX_PROMPT_LENGTH = 500`) + `PromptBox.tsx`. **Critical
contract:** the backend stores `textPrompt` with **no server-side type or length
bound** (`BE-070`; corrected 2026-10-20) and keeps it encrypted as
`PlaylistSession.contextPrompt`; only closed-vocabulary tags derived from it reach an
LLM (`extractIntent` in `backend/app/services/geminiEngine.js`, pinned by
`backend/tests/geminiEngine.egress.test.js`). The 500-character cap below is client UX,
not a boundary: the server must enforce its own.
`sanitizePrompt` caps to 500, strips C0/DEL/NUL control bytes, collapses whitespace to
a single line, trims, and never throws on any paste. It runs **in the cold-slice
reducer AND in deserialize**, so state, the persisted MMKV blob, and the socket payload
are all bounded even against a 50k-char injection paste or a poisoned persisted blob.
The `TextInput` sets native `maxLength={500}` as a first line of defense (UI/UX: the
box is single-line; on-device the wheel scales to a compact mini-ring on keyboard focus
so committed taps stay visible — the keyboard-resize behavior from the approved
blueprint, verified on-device).

---

---

<a id="ground-truth-2026-09-02"></a>
## Appendix · GROUND TRUTH BRIEF — 2026-09-02 (Wave 4 closeout, W4-015)
_Was `docs/GROUND_TRUTH_2026-09-02.md` until 2026-10-18 (`docs/ARCHIVE.md` § Moved); its history is under that path. Stale since Tracks H, HX and J1; every number is as measured on 2026-09-02._

> Persisted per the rule `GROUND_TRUTH_2026-07-07.md (deleted; see docs/ARCHIVE.md)` established: every claim below cites a real
> tool run on this machine, so a later session does not re-spend budget re-deriving it. The narrative
> lives in `WAVE4_REPORT.md (deleted; see docs/ARCHIVE.md)` (the closeout package) and `docs/plans/WAVE4_STATE.md` (the run's
> live task table, HITL queue and per-session evidence). This brief is the measured-facts snapshot the
> other two summarise.
>
> **Supersedes `docs/GROUND_TRUTH_2026-08-22.md`**, which is an untracked draft from a killed session
> (W4-D67). That draft is written in the past tense about work that had not happened — it claims the
> `KOKONADA_ARCHITECTURE_MASTER.md` §0 refresh and `WAVE4_REPORT.md (deleted; see docs/ARCHIVE.md)` as done when neither existed — and
> its baseline (222/3523) is five re-baselines stale. **It is safe to delete.** Its §1 table was
> independently reproduced at the time and nothing in it is lost: everything still true has been carried
> forward here, re-measured.

### 0. Where this was measured

Isolated git worktree at `C:/tmp/kokonada-wave4`, branch `feat/intelligence-wave`, code HEAD `6ede4f8`,
**clean tree** (`git status --porcelain` empty apart from this session's own deliverables). The shared
working tree at `C:/Users/danie/Videos/Kokonada` was checked out on an unrelated branch with 11 live
`claude` processes and a concurrent session's uncommitted work in it, so it was not touched.

### 1. Test baseline (real runs, 2026-09-02)

| Surface | Result | 2026-07-07 baseline | Delta |
| :--- | :--- | :--- | :--- |
| Backend, `cd backend && RUN_SOAK=1 npm test` | **232 suites / 3866 tests** (3865 passed + 1 todo), `exit 0`, **0** `^FAIL` lines over the complete 869 KB log, 475.357 s | 91 suites / 1126 tests | +141 suites / +2740 tests |
| Lint, `npm run lint` | **0 errors / 22 warnings** — unchanged from every prior Wave-4 session's figure | no linter existed pre-wave (W4-D11) | linter added this wave |
| Mobile, `./node_modules/.bin/jest` | **out of scope this wave** (backend-only per the mission's §0.3) | 48 suites / 416 tests | untouched |
| Secret scan of the wave diff | `git diff 44fd951..HEAD` against `AIza\|ghp_\|sk-\|-----BEGIN\|eyJ[A-Za-z0-9_-]{30,}` — **29 matches, all of them the substring `sk-` inside ordinary words** (`risk-register`, `task-`). No credential material. | n/a | n/a |
| Attribution scan of the wave commits | `git log 44fd951..HEAD --format=%B` against `claude\|anthropic\|generated with\|co-authored-by` — **1 match, and it is a filename** (`docs/CLAUDE_DESIGN_PROMPT.md` in a commit subject), not attribution. | n/a | n/a |

> **On 232/3866 vs STATE's recorded 232/3868.** The difference is exactly two tests and it is explained,
> not unexplained: STATE's session-77 figure was measured in the shared tree, where a concurrent
> workstream's uncommitted `measureDiscoveryComposition.test.js` additions contribute +2. A clean
> checkout does not carry them. Suite count, pass count and exit code are otherwise identical, so the
> baseline is met, not regressed.

`RUN_SOAK=1` widens the two soak lanes from their strided defaults to the full population; it adds no
test cases, so the counts are directly comparable to a plain `npm test`.

### 2. The wave is merged into `main` — verified by content, not by PR status

- `origin/main` is at **`06af5d6`**. STATE's `lastMainSha` was `44fd951`; main has advanced by three
  commits since, and one of them is **`0e19ad8` — "Wave4 W4-007+W4-008" (PR #180)**.
- `git diff --stat origin/main feat/intelligence-wave -- backend/app/agents/runtime backend/sim
  backend/app/models` is **empty**. Every Wave-4 runtime module, the whole simulator and all four new
  collections are byte-identical on `main`.
- `docs/plans/WAVE4_STATE.md` differs from `main`'s copy by **one line** (this session's own edit), so
  the run's state files are on `main` too — which settles H8's question (1) by event.
- The only backend differences between `origin/main` and the wave branch run the *other* way: `main`
  carries the cookie-auth retirement (PR #184) and the Garmin Connect IQ watch-app retirement (PR #181),
  which the wave branch does not.

### 3. What exists now that did not exist on 2026-07-07

**New runtime subsystem, `backend/app/agents/runtime/`** — 16 modules. These are *not* Claude Code
sub-agents; see `docs/architecture/runtime-agent-architecture.md` and `CLAUDE.md`'s disambiguation note.

- `ingestion/anomalyFilter.js` — Hampel → slew gate → irregular-Δt Kalman, per-reading confidence.
- `physiology/{baselineEngine,chronobiology,affectEngine,dailyAnalysis,liveStateAdapter}.js` — personal
  baselines (D1/D2/D14/D15), the cosinor circadian model (D13), the four-layer affect stack, nightly
  consolidation with CUSUM, and the live lane's O(1) per-reading posterior update (D11).
- `knowledge/{stateTaxonomy,noveltyController,explain}.js` — **34 states across 6 domains**, verified at
  source this session (`STATES.length === 34`, `DOMAINS` = 6), replacing the 9-rule classifier (D12).
- `translation/wellbeingRegulator.js` — the iso-principle `meet-then-lower` mechanism.
- `delivery/trajectoryPlanner.js` — 7 playlist arc archetypes.
- `learning/{feedbackLoop,personalization,playbackEvent,playWindow}.js` — the two-track ADR-0012 loop.
- `_shared/dto/telemetry.js` — zod schemas at the ingestion boundary.

**New collections** — `VitalSample`, `RewardEvent`, `MorningState`, `PersonalWeights`. All four are
registered in the account-erasure cascade, `userRedisPurge`, wearable-scoped erasure and
`userDataExport`, in the same PR that introduced them (S5), and the completeness guard discovers models
mechanically off the models directory rather than from a hand-maintained list.

**New simulator**, `backend/sim/` — `rng`, `personas`, `generator`, `replay`, `soak`, `stateScripts`,
`stateCoverage`. Seeded and deterministic, with holdout personas on a different noise family so
validation is not circular.

**New ADRs** — `docs/adr/0012-learning-compliance.md`, `0013-state-model.md`, `0014-embedding-v2.md`.

**Kill switches** (grepped fresh: `grep -rohE "WAVE4_[A-Z_0-9]+" backend/app backend/sim | sort -u`) —
`WAVE4_AFFECT_DISABLED`, `WAVE4_AFFINITY_DECAY_DISABLED`, `WAVE4_ANOMALY_FILTER_DISABLED`,
`WAVE4_BASELINE_ABSTENTION_DISABLED`, `WAVE4_BASELINE_ENGINE_DISABLED`, `WAVE4_CONSENT_V2_METRICS`,
`WAVE4_FEEDBACK_DISABLED`, `WAVE4_GENRE_FAMILIES_DISABLED`, `WAVE4_LLM_BAND_FROM_STATE_DISABLED`,
`WAVE4_NOVELTY_BANDIT`, `WAVE4_PERSONAL_WEIGHTS`, `WAVE4_PULSE_SUPERSET_DISABLED`,
`WAVE4_RECAL_STATE_TRIGGER_DISABLED`, `WAVE4_SCORING_V2_DISABLED`, `WAVE4_SERVE_LATCH_DISABLED`,
`WAVE4_TRAJECTORY_DISABLED`. Plus `EMBEDDING_V2_WRITE` / `_READ` / `_BACKFILL` and `SCORING_V2_SHADOW`.
(A seventeenth grep hit, `WAVE4_X_DISABLED`, is a literal inside a comment in `app/utils/envFlag.js`, not
a flag.) All parsing goes through one function and is pinned by `tests/wave4.killSwitchSpelling.test.js`.
You audited Railway's Variables on 2026-08-23 (H14): **no `WAVE4_` variable is set in production**, so
every flag is at its default.

### 4. Defect closure — spot-verified at source this session, not taken on trust

| Defect | Check run | Result |
| :--- | :--- | :--- |
| D4 (high stress forced happier music) | `grep "Math.max(moodValence" app/services/biosonic/translate.js` | 1 hit, and it is the **comment** explaining the removal. The live line is `valenceTarget = round3(clamp01(moodValence + Math.min(COMFORT_BIAS_MAX, COMFORT_BIAS_SLOPE * S)))`. |
| D5 (LLM prompt axis swap) | `grep -o "x = [a-z]*, y = [a-z]*" app/services/geminiEngine.js` | `x = valence, y = arousal` — matches the code's own definition. |
| D1 (personal HRV baseline never computed) | `grep -B2 -A2 hrvMedian app/services/biosonic/baselines.js` | present, and gated on `hasHrvEvidence` rather than a population constant. |
| D10 (live samples never persisted) | `grep -c _maybePersistLiveReading app/sockets/biometricHandler.js` | 4 |
| D12 (9-rule classifier) | `require('.../stateTaxonomy')` at runtime | `STATES.length = 34`, `DOMAINS` = 6 |
| D17 (cross-provider affinity scale collision) | `grep SOURCE_WEIGHTS.saved app/services/musicProfileService.js` | YouTube path now scores on the same `SOURCE_WEIGHTS` scale as Spotify. |

### 5. Taxonomy state coverage — the measured floors

Reproduced this session under `RUN_SOAK=1` (`tests/sim.stateCoverage.soak.test.js`, 25.1 s, 10/10 green),
exactly matching W4-D63's cited numbers:

| Lane | Real seam driven | Reached | Coverage | Structural blind spots |
| :--- | :--- | :--- | :--- | :--- |
| serving | `buildTargets` | **21 / 34** | 0.618 | **0** — every miss is `outcompeted`, `absent=none` |
| live | `liveStateAdapter.onlineUpdate` | **13 / 34** | 0.382 | **7** — 4 on `valence`, 3 on `recovery`/`stress` |

Both are pinned as floors. The serving lane's 13 misses are a geometry question, not a data question:
more simulated days cannot move them. The live lane's 7 need a client signal that does not exist yet.
Full per-state reasons: `WAVE4_SOAK_2026-09-02.md (deleted; see docs/ARCHIVE.md)` §3.

### 6. Repo reality

- 336 commits on `feat/intelligence-wave` since `44fd951`; 79 sessions; 15 reflection passes.
- **`feat/intelligence-wave` is no longer a Wave-4-only branch.** It locally carries 12 design commits
  from a concurrent workstream, and `origin/feat/intelligence-wave` carries 2 commits the local branch
  lacks, so it cannot be fast-forward pushed. The Wave-4 code is unaffected — it is already on `main`.
- `docs/plans/WAVE4_STATE.md` is **336 KB** and `docs/plans/WAVE4_ARCHIVE.md` is **471 KB** — 807 KB of
  run state, now in `main`'s permanent history. STATE is 124 % over the mission's own 150 KB archival
  threshold; archival is a reflection-only action and the run's cutoff has passed, so it is recorded here
  as known debt (W4-D64) rather than actioned.
- Untracked in the shared tree and **deliberately not touched**: a concurrent design workstream's files
  (`design_handoff_quiet_instrument/`, several `docs/*_PROMPT.md`, `WEAKNESSES_AND_FAILURES.md`), the
  `mobile/src/health/config.ts` credential fill-in, and the path-mangled Android keystore duplicate that
  H15 / W4-D83 is about.

### 7. Open, and where it is tracked

- **6 open HITL items**, one of which (H16) this closeout answers with its own documented default. Full
  matrix: `WAVE4_REPORT.md (deleted; see docs/ARCHIVE.md)` §8.
- **46 open discovered-backlog rows**, all `class: improve`. **Zero `repair`-class rows are open.**
  Exactly one is MUST-tier: W4-D83, the keystore ignore glob.
- **Error budget: 0 consecutive failed sessions.** No task ever hit the rule-of-2.
