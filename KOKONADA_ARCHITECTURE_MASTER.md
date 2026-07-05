# KOKONADA ARCHITECTURE MASTER — Session Handoff Document

> **Purpose:** A new AI session reads this file and instantly resumes the exact persona,
> context, protocols, and architectural state of the Kokonada "Monster Machine" build.
> Written 2026-07-03 at the completion of the backend (Phases 0–7).
> **Last updated 2026-07-04** — Sprint A11 shipped; now in the Road-to-Launch squads.
> **START WITH SECTION 0 below** — it is the authoritative current state and supersedes
> the older "Current State & Next Step" blocks in Sections 4 and D.

---

## 0. CURRENT STATE — ROAD TO LAUNCH (updated 2026-07-04, READ THIS FIRST)

> Supersedes the "Current State & Next Step" blocks in Section 4 and Section D below
> (both predate Sprint A11 and the Road-to-Launch squads). Everything through **Sprint
> A11 is SHIPPED**; we are now in the launch-hardening phase, run as an **Agent Squad**.

**Shipped & merged to `main` (currently PR #51 merged):**
- **Backend Phases 0–7** — the variance engine (queues, canonical identity, feature store,
  serve ledger, biosonic `translate`, selection pipeline, vector layer). PRs #35–#41.
- **Mobile Sprints A6–A10** — auth, RN foundation, Skia experience, playback, wearable/
  background. PRs #42–#46.
- **QA4 Red Team hardening** (PR #47) — a 4-agent full-system stress audit. Fixed 4
  confirmed architectural suspects (**the socket never connected in prod**; cold persistence
  never bootstrapped; warm `liveHr` never fed; player status unobservable) + 5 more bugs
  (`translate` 0/0 NaN-poison; foreground HR-wipe; aura NaN-phase Skia crash; unbounded
  persisted `activity`; stuck generation guard) + a permanent GDPR erasure-completeness guard.
- **Sprint A11 — Intelligence** (PR #48) — `GET /api/sessions` history feed +
  `GET /api/pulse/state` (both explicit whitelist DTOs), a shared mobile `apiClient`
  (single-flight 401-refresh-retry) on a unified `AuthSession` token plane, the auth-gated
  `startApp` ignition, HistoryScreen server feed, ProfileScreen (logout + server-first GDPR
  delete), and the richer state-vector Pulse screen.

**Test baselines (both green):** backend **81 suites / 1006 tests**; mobile **42 suites /
361 tests**. Backend: `cd backend && npm test`. Mobile: `./node_modules/.bin/jest` from
`mobile/KokonadaHealth` (mobile is NOT in CI — run locally).

### Operating model — the Agent Squad
Every task spawns a **Developer Agent** (executes end-to-end, strict TDD) paired with a
dedicated **Shadow QA/Security Agent** (attacks the Dev's work, pins regression tests).
Reconcile both branches, apply QA fixes, then PR → `gh pr merge --squash --delete-branch`.
- **Pause & Guide:** any manual cloud-portal action (Atlas, Railway, Apple Developer) STOPS
  the sprint — hand the human a step-by-step tutorial and wait for an explicit "DONE".
  (The AI cannot log into cloud portals.)
- **100% FREE app (product decision):** no paywalls, no paid tiers yet. A12's Entitlements/
  RevenueCat must scaffold a fully free tier with **NO subscription UI**.

### Squad 1 — Production Runbooks (✅ CLOSED — PRs #49, #50)
Executed the backend prod infra so the queue + vector layers actually run:
- **Atlas Vector Search index** — created in MongoDB Atlas on collection `trackembeddings`,
  name `track_embedding_index`, def `{ "fields":[{ "type":"vector","path":"vector",
  "numDimensions":70,"similarity":"cosine" }] }`. Status **Active**. (70 dims = 6 feature +
  64 hashed-genre-bag, from `embedding.js buildVector`.)
- **Legacy index dropped** — the orphaned `userId_1_moodKey_1_createdAt_-1` index on
  `playlistsessions` was **manually deleted** (schema removed it in Phase 6; the physical
  index lingered).
- **Railway Redis auth (NOAUTH resolved)** — provisioned Railway Redis; the first `REDIS_URL`
  was host-only → `NOAUTH Authentication required`. Fixed by pointing `REDIS_URL` at the
  **authenticated** Redis URL (`redis://default:<pw>@…`, via a `${{Redis.…}}` reference).
- **DELIBERATE ARCHITECTURE — in-process workers.** Railway's free plan blocks creating a
  2nd (worker) service; a separate project would force public-Redis egress + manual key
  parity. So workers run **inside the web service** via **`RUN_WORKERS_IN_PROCESS=true`** —
  `startInProcessWorkers()` launches the 3 BullMQ consumers in `app/index.js` with graceful
  SIGTERM shutdown. The standalone `app/worker.js` (`npm run worker`) is kept for a future
  dedicated worker (zero rework once on a paid tier). `scripts/verifyProdRunbooks.js`
  read-only-verifies all three runbooks.
- **SIGTERM crash-loop fixed** — the backend booted cleanly then was killed every ~4s. Root
  cause: the Railway health check hit a non-200 path. Fix: **Health Check Path = `/health`**
  (returns 200 JSON) + **Restart Policy = On Failure**. Loop stopped.
- **Env facts (load-bearing):** the app reads **`MONGO_URI`** (NOT `DATABASE_URL`). Prod
  Mongo is **Atlas** (literal `MONGO_URI`, not a Railway ref — hence no graph arrow); a
  separate Railway MongoDB service exists but is **unused**. In-process workers inherit the
  web service's `ENCRYPTION_KEY`/`MONGO_URI` — automatic parity (a key benefit of in-process).

### Squad 2 — Tech Debt Janitor (✅ CLOSED — PR #51)
Cleared the dual token-plane debt:
- **Deleted `src/auth/tokenStore.ts`** entirely — the app now has a **single JWT plane on
  `AuthSession`**.
- `liveHrClient.ts` + `uploadClient.ts` JWT calls routed through the shared `apiClient`
  (inheriting single-flight 401→refresh→retry). Login dropped the `saveToken` dual-write;
  `isLoggedIn`/`signOut` route through `AuthSession`. The separate **watch device token**
  (`com.kokonadahealth.watchToken`) is untouched.
- Logout keeps a **direct legacy purge** — `Keychain.resetGenericPassword(
  'com.kokonadahealth.jwt')` — so an upgrading user's pre-migration JWT is still wiped
  ("zero bytes after logout" holds).
- **QA fallback fix (found during reconciliation):** login now installs an **access-only**
  `AuthSession` when the backend returns no refresh token — previously that path left BOTH
  planes empty (a silent no-auth state once the `tokenStore` fallback was removed).
- Pinned `src/__tests__/shadow.authMigration.test.ts` — 9 guards that fail the build if
  anyone reintroduces `tokenStore`, drops the logout purge, or leaks a token to logs/URL/disk.

### Pending Roadmap
- **Squad 3 — A12 Compliance:** Apple Sign-In (App-Store-mandatory once social login
  exists); **FREE-tier RevenueCat/Entitlements scaffold — NO paywalls, no subscription UI**
  (product decision); privacy declarations (App Store nutrition / Play Data Safety); a11y +
  i18n/RTL completion.
- **Squad 4 — A13 DevOps:** get mobile into CI (currently local-only); release/build
  pipeline (fastlane or EAS); crash + telemetry reporting; store submission.
- **Squad 5 — Web Sunset:** remove the retired web surfaces (DiscoverPage stub, ActivityPanel,
  PlaylistDetailPage, Garmin credentials form, offline-buffer player); keep the Vercel domain
  for AASA/assetlinks deep links + OG cards.
- **Squad 6 — On-Device Verification:** a strict manual QA checklist run on the physical
  Galaxy device (login → history → profile → logout → GDPR delete → pulse gauges), exercising
  the A11 features that are unit-green but not yet device-verified.

### ⏭️ IMMEDIATE NEXT ACTION (updated 2026-07-06)
**Execute the Unified Variance Architecture** (spec: `docs/superpowers/specs/2026-07-06-unified-pool-dualpath-shadowbuffer-design.md`), which SUPERSEDES the Squad-6-first ordering. Root cause of "same playlist" was proven (prod Mongo read) to be the `SELECTION_POOL_MAX=500` cap + the L4 mood-strip — NOT empty features (the library is 64% measured-hydrated; the 2026-07-05 "empty features" diagnosis is retired). Order: **Part 1** (pool uncap to 10 000 + un-relaxable hard biosonic band, backend) → **Part 2** (manual/live dual-path + reanimated UI-thread analysis loader, mobile) → **Part 3** (shadow-worker biometric buffer, background). Squad 6 (On-Device Verification) + Squad 3 (A12) follow.

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
- **Git style:** short single-line commit messages, no body, no trailers. PR bodies end
  with the Claude Code attribution footer.
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
  default `llama-3.1-8b-instant`), `generateJson(prompt, {model,timeoutMs,temperature})`,
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

## 4. Current State & Next Step

**BACKEND: 100% FINISHED.** Suite: **844/844 across 65 suites** (includes every
shadow-attack suite as permanent regression guards).

- Merged: PR #35, #36, #37, #38, #39, #40.
- **PR #41 (Phase 7 — THE SEAL) is OPEN and audit-passed, awaiting merge approval**
  (branch `feat/monster-s7-seal`, commit `af0186a`).
- Prod runbooks pending after #41 merges:
  1. Create the Atlas Vector Search index (spec in `models/TrackEmbedding.js` comment).
  2. `db.playlistsessions.dropIndex('userId_1_moodKey_1_createdAt_-1')`.
  3. Set `REDIS_URL` on Railway + run the worker process (`startWorkers`) — until then
     all queue paths no-op gracefully.

**EXACT NEXT STEP — React Native Sprints (S5+)** per blueprint Part 8:
> ⚠️ **HISTORICAL / SUPERSEDED by Section 0.** Sprints A6–A11 are all DONE and merged;
> the "next step" below is the original plan, kept for context. Current state is Section 0.
1. **A6 — Auth & Accounts:** provider-agnostic `Identity` collection (google/apple/
   facebook/password), argon2id email flow, JWT + rotating refresh, entitlements/
   RevenueCat scaffolding, GDPR cascade extension. (Apple Sign-In is App Store-mandatory
   once social login exists.)
2. **A7 — RN Foundation:** grow `mobile/KokonadaHealth` into the Kokonada app —
   react-navigation, encrypted MMKV, socket client with typed contracts, the
   **three-lane state architecture** (Reanimated SharedValues hot lane for sensor ticks;
   throttled Zustand warm lane; Redux Toolkit cold lane ported from the web slices),
   i18n/RTL/a11y groundwork, deep links.
3. **A8 — RN Experience:** the **Skia radial emotion wheel** (gesture-handler taps →
   worklets → Skia, 120Hz, zero JS-thread round-trip, same ≤3-tap emotionSlice payload —
   backend contract unchanged), bio-aura shader, Spotify **App Remote** player
   (Web Playback SDK is desktop-only), mix receipts, Pulse screen.
- Screens: Generate / Now Playing / Pulse / History / Profile+Integrations.
  REMOVE from web before/at sunset: DiscoverPage stub, ActivityPanel,
  PlaylistDetailPage, Garmin credentials form, offline-buffer player.
- The web app stays alive during RN development as the production harness; the domain
  survives sunset for AASA/assetlinks + OG cards.

**Environment gotchas for the new session (Windows dev box):**
- Always `cd /c/Users/danie/Videos/AI-Music-App/backend` before npm/jest in Bash
  (the shell drops cwd; a root `npm install` once created a stray root package.json).
- `npm install` may prune devDeps (NODE_ENV=production) — restore with
  `npm install --include=dev`. Backend jest is v29 (`npm test` = `jest --runInBand --forceExit`).
- PowerShell 5.1 mangles jest stderr — run tests through the Bash tool with
  `2>&1 | grep -aE "Test Suites:|Tests:"`.
- Mobile builds: JDK/SDK configured; Windows path-length solved via directory junction;
  release APK proven on Galaxy S22+ with live BLE HR + Health Connect backfill.

---

# FRONTEND ARCHITECTURE & MOBILE SPRINTS (Phases A6–A10)

> **STATUS UPDATE (supersedes Section 4 above):** Section 3's backend is now fully
> merged — **PR #41 (Phase 7 Seal) MERGED**, backend at **909/909** after the A6
> auth additions. The React Native migration is well underway: **Sprints A6, A7,
> A8, A9, A10 are 100% COMPLETE and MERGED to `main`** (PRs #42, #43, #44, #45,
> #46). The app boots, captures emotion, generates playlists, and **plays music**
> through Spotify with a full 5-tab UI. This section is the authoritative handoff
> for the mobile app; read it before touching `mobile/KokonadaHealth`.

The app lives in `mobile/KokonadaHealth` (bare **React Native 0.86**, React 19.2,
jest 29). Doctrine, identical to the backend: **pure logic behind ports, TDD'd under
jest; native modules (Skia, Reanimated, gesture-handler, socket.io, Spotify SDK,
MMKV, Keychain) are thin adapters verified ON-DEVICE, never fake-snapshotted.** Every
sprint ends with a mobile Shadow Audit, an OPEN MANDATE to find bugs beyond the
dictated list, and a PR + audit comment before STOP-and-await-merge.

## A. The Mobile Foundation (Sprint A7 — PR #43)

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
`KVBackend` + `Cipher` (injected; tests use fakes, prod uses `mmkvBackend` = an
AES-encrypted MMKV instance whose 256-bit key lives in the hardware Keychain). It is
**encrypted-only** (refuses a backend not flagged `encrypted`), **biometric-denying**
(a hard `bio:/hr:/biometric:` key denylist — raw HR can never reach disk even by a
coding mistake), and **fail-soft** (a full/interrupted device returns `false`/`null`,
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

## B. The Context & Emotion Input Suite (Sprints A8 + A10 — PRs #44, #46)

The **Generate tab** (`src/experience/generate/GenerateScreen.tsx`) is the live suite:
a vertical composition of bio-aura + radial wheel (hero), Activity chips, Prompt box,
and a CTA that morphs Generate ↔ "Listen to your heart" ↔ disabled. `GenerateController`
(pure, tested) is the `hotLane → laneCommit → cold store` handoff + CTA logic + submit
→ live socket.

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

### B.3 Activity Chips (single-select)
`activities.ts` (8 presets, natural-language keys the backend prints verbatim into the
Groq prompt) + `ActivityChips.tsx` — single-select ToggleGroup; re-tapping the active
chip clears it (→ null). Writes straight to `emotion.activity`, rides the existing
`emotion_update` payload.

### B.4 The Emotional Prompt Box (sanitized, 500-char)
`promptSanitizer.ts` (`MAX_PROMPT_LENGTH = 500`) + `PromptBox.tsx`. **Critical
contract:** the backend stores `textPrompt` VERBATIM with **no server-side cap** and
prints it into the Groq prompt, so the CLIENT is the only enforcement point.
`sanitizePrompt` caps to 500, strips C0/DEL/NUL control bytes, collapses whitespace to
a single line, trims, and never throws on any paste. It runs **in the cold-slice
reducer AND in deserialize**, so state, the persisted MMKV blob, and the socket payload
are all bounded even against a 50k-char injection paste or a poisoned persisted blob.
The `TextInput` sets native `maxLength={500}` as a first line of defense (UI/UX: the
box is single-line; on-device the wheel scales to a compact mini-ring on keyboard focus
so committed taps stay visible — the keyboard-resize behavior from the approved
blueprint, verified on-device).

### B.5 Playback + Now Playing + Pulse/History (Sprints A9 + A10)
- `PlaybackQueue` (cursor over PLAYABLE tracks; skips YouTube-only null-URI tracks;
  clamps both edges) + `PlaybackOrchestrator` (THE conductor: `handlePlaylist`→play,
  track-end auto-advance with **stale-end guard**, skip **coalescing** via injected
  scheduler [burst → 1 play command], **single-flight generation guard** [skip-past-end
  spam → 1 request, not N], **URI-aware `reconcile`**).
- `foregroundReconcile` (reads native player state + OS permissions → orchestrator +
  warm store, each guarded, never throws) driven by `AppLifecycle` (AppState 'active').
- `NowPlayingScreen` (transport via orchestrator), `PulseScreen` (live HR/source/socket),
  `HistoryScreen` (session play history) — all subscribe with `useEffect` cleanup.

## C. Shadow Agent — Mobile Victories

**Mobile QA doctrine:** same as backend — hostile tests FIRST, stateful fakes with real
semantics (in-memory MMKV, EventEmitter sockets, flaky Spotify remotes), integration-
level attacks that cross lanes. Since A7 the **OPEN MANDATE** stands: the Shadow Agent
must research and exploit mobile edge cases beyond the dictated list. Each audit posts a
verdict table (DEFENDED-pinned / CONFIRMED→FIXED / ACCEPTED-documented) as a PR comment.

**Confirmed kills fixed pre-merge (all pinned as permanent regression tests):**
- **S9-1 — Zombie socket handler:** a late buffered event on a REPLACED (dead) socket
  after `auth_expired` spawned a 3rd socket / could spuriously log the user out mid-
  session. Fixed: `teardown()` detaches listeners on every socket swap + manual close.
- **S10-1 — Silent React 18 memory leak:** `GenerateScreen` subscribed to the warm store
  **in render body with no cleanup**, leaking a dead closure on every tab switch. React
  18+ REMOVED the "setState on unmounted component" warning, so it's invisible at
  runtime — the first detection attempt FALSE-GREENED. The pinned test tracks
  subscribe/unsubscribe **parity** directly (found 1 subscribe, 0 unsubscribes). Fixed
  with `useEffect` cleanup. **Lesson: React 18+ leak detection MUST use parity, not the
  removed warning.**
- **S11-1 — The Desync Ghost:** `reconcile` ignored the remote's actual track URI, so
  after the user played a FOREIGN song in the Spotify app, Now Playing falsely kept
  claiming our track was playing. Fixed: URI-aware reconcile.
- **S11-2 — Skip-spam backlog:** spamming Next PAST the queue end fired one generation
  request PER TAP (20 taps → 20 requests = rate-limit storm). Fixed: single-flight
  `generationPending` guard + `onGenerationError` unblock.
- **S12-1 — Bluetooth/Socket decoupling:** the warm-store permission reconciler CONFLATED
  the biometric transport with the server-socket status — turning off Bluetooth falsely
  set `connection='disconnected'` (Pulse would lie "socket: disconnected" while the socket
  was fine), violating three-lane independence. The A7 test had VACUOUSLY pinned the bug
  (socket defaulted to disconnected → assertion passed for the wrong reason). Fixed:
  severance touches only biometric fields; A7 test corrected to prove lane independence.

**Also DEFENDED-and-pinned** (open-mandate discoveries, no fix needed): shared-device
cross-user cold-state leak, prototype pollution via persisted blob, reqId type-confusion,
token-in-cold-persist, auth-refresh storm single-flight, prompt overflow/injection bound
everywhere, control-only-prompt phantom input.

## D. Current State & Next Step (mobile)

**SPRINTS A6–A10 = 100% COMPLETE and MERGED** (PRs #42–#46). Mobile suite: **23 suites /
213 tests green**; A-sprint production code `tsc --noEmit` clean. The app boots →
restores session → connects socket + Spotify → captures emotion (wheel + activity +
prompt) → generates → **plays music** → reconciles on foreground.

**EXACT NEXT STEP — Sprint A11 (do NOT start until the new session is briefed):**
> ⚠️ **HISTORICAL / SUPERSEDED by Section 0.** Sprint A11 is DONE and merged (PR #48);
> the three items below all shipped. Current state + next action are in Section 0.
1. **Persistent server-side history feed** — a `GET /api/sessions` backend endpoint
   returning the user's `PlaylistSession` history, and wire `HistoryScreen` to fetch it
   (today History only reflects the live in-memory session via `nowPlayingStore`).
2. **Profile + Integrations screen** — the 5th tab: Spotify connect/reconnect, Garmin/
   wearable connect, display name/avatar, logout, and **GDPR account deletion wiring**
   (call `DELETE /api/auth/account` — the backend cascade already erases Mongo + Redis;
   the mobile side must confirm, call it, and `ColdPersistence.wipe()` + clear the
   Keychain session locally).
3. **Richer Pulse** — HRV / recovery / body-battery from the backend state vector
   (`MedicalProfile.stateVector`), not just live HR.

**Mobile environment gotchas (for the new session):**
- Run mobile jest from `mobile/KokonadaHealth` with `./node_modules/.bin/jest` — the
  Bash cwd drifts and a bare `npx jest` resolves a stale cached global that no-ops.
- The RN jest resolver prefers the `react-native`/`src` package field, so **RTK, zustand,
  @react-navigation, react-native-screens** must be allowlisted in
  `jest.config.js` `transformIgnorePatterns`; native visual libs (Skia, Reanimated,
  gesture-handler, MMKV, Spotify remote) are stubbed in `jest.setup.js` for the headless
  App smoke test.
- **Whole-app `tsc --noEmit` has PRE-EXISTING errors** in `src/health/*` (react-native-
  health-connect lib typings) and test files using Node globals (`Buffer`/`global`,
  provided by jest at runtime) — these predate the A-sprints and are unrelated; verify
  only that the sprint's OWN files are clean. (An early sprint's "tsc clean" claim relied
  on a misleading `npx tsc` no-op — the honest statement is per-file.)
- Reanimated's babel plugin is in `babel.config.js` (must be last); it is jest-safe.
- Mobile is NOT in CI (CI = backend lint/test + frontend typecheck/build only); run the
  mobile suite locally and report. GitGuardian scans PRs — avoid token-shaped test
  fixtures (use inert placeholders) and the `Password` keyword next to a literal in
  Keychain calls (alias the accessors).
