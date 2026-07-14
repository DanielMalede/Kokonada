# KOKONADA — RUNTIME AGENT ARCHITECTURE
## A Master-Level Multi-Agent System (MAS) for Body + Mind → Music

> **Scope:** the *runtime* agents inside the running Kokonada app (backend services that turn live biometrics + emotion into an evolving Spotify playlist). This is a **different layer** from the build-time Claude Code sub-agents (`architect`, `designer`, `developer`, `resilience-auditor`, `compliance-auditor`) that *write* Kokonada. Those build; these *run*.
> **Audience:** the `developer` build-agent. Every runtime agent below is specified with Responsibility · I/O DTOs · Port/Adapter · State & Cache · Failure modes · Patterns · Code home — enough to write production Node.js directly.
> **Authoritative for runtime intent.** Cross-references: `KOKONADA_ARCHITECTURE_MASTER.md` (the existing engine), `docs/VISION.md` (why), `docs/ORCHESTRATOR_FABLE.md` (build rules).

---

## 0. FIRST PRINCIPLES (non-negotiable)

1. **Deterministic core, LLM only at the edges.** Pure, testable functions (`translate`, `score`, `mmr`) own the decisions; LLMs (Groq) appear *only* in intent-expansion and feature-fallback, always confidence-capped with a deterministic fallback. (Aligns with the locked "never pure-LLM features" decision.)
2. **Zero-knowledge boundary.** Raw vitals (HR/HRV/sleep) are AES-256-GCM encrypted; decrypted **only inside worker scope**; everywhere else agents pass **coarse bands / derived targets**, never raw values. No agent logs, ships, or persists a raw vital in the clear.
3. **Hexagonal (ports & adapters).** Every agent is a pure core behind a **Port** (interface); all I/O — Spotify, Groq, ReccoBeats, Garmin, weather, Mongo, Redis — is an **Adapter**. Swap Qdrant/Neo4j/Redis-Cloud/etc. with zero core rewrite.
4. **Event-driven decoupling.** Live signal flows over the **WebSocket bus**; heavy/async work over **BullMQ**; shared state in **Redis (hot) + Mongo (truth)**. Agents never call each other's internals — only typed events/DTOs.
5. **Fail soft, never silent.** Every agent degrades gracefully (fallback output) and emits a metric on every catch path. The music never stops.

### Maturity tiers (READ THIS before building)
"Master-level everywhere" is the target, **not** a day-one mandate — shipping all 24 agents at once is its own anti-pattern. Each agent is tagged:
- **P0** — core serving path; required for the app to function (mostly *already exists* — formalize/refactor).
- **P1** — high-ROI intelligence/resilience (build after P0 is clean).
- **P2** — visionary / world-class polish (build once P1 proves value).
Build order overrides ambition: a thin correct P0 beats a thick broken P1.

---

## 1. FOLDER STRUCTURE (`backend/app/agents/runtime/`)

> Migration note: the engine today lives in `backend/app/services/*`. Do **not** big-bang move it (huge blast radius). Introduce `agents/runtime/` as the new home; each agent starts as a **thin facade/port wrapping the existing service**, then logic migrates inward incrementally. New agents are born here directly.

```
backend/app/agents/runtime/
├── _shared/
│   ├── ports/            # TypeScript-style interfaces (JSDoc) for every port
│   ├── schemas/          # zod/ajv schemas — the contract for every event/DTO
│   ├── bus/              # event bus (pub/sub over socket.io + BullMQ)
│   ├── resilience/       # circuit-breaker, bulkhead, retry-with-jitter, timeout budget
│   └── dto/              # shared DTOs (Telemetry, StateVector, MusicTarget, Playlist…)
├── orchestrator/
│   └── sessionConductor.js        # O1  (facade/saga)  [was generation/orchestrator]
├── platform/
│   ├── resilienceFabric.js        # P1  circuit-breaker + bulkhead registry
│   ├── finopsGuardian.js          # P2-A rate-limit/quota guardian  [NEW 8]
│   ├── offlineBuffer.js           # P2  offline cache/buffer layer
│   ├── observability.js           # P1  SLOs, drift, cost  [NEW 6]
│   └── privacyGovernor.js         # P0  consent/GDPR/zero-knowledge enforcement  [NEW]
├── ingestion/
│   ├── ingestionAgent.js          # A   [was sockets/biometricHandler]
│   ├── adaptivePolling.sub.js     # A1  BLE throttle by exertion  [NEW]
│   ├── anomalyFilter.sub.js       # A2  artifact/outlier rejection  [NEW 1]
│   └── schemaGuard.sub.js         # A3  strict validation gate
├── physiology/
│   ├── stateAgent.js              # B   [was biosonic/baselines + stateVector.worker]
│   └── chronobiology.sub.js       # B1  circadian + multi-day fatigue slopes  [NEW]
├── context/
│   ├── routineAgent.js            # C5  routine/situation inference  [NEW-ish]
│   └── environmentAgent.js        # E7  weather/altitude  [NEW 7 — privacy-gated]
├── intent/
│   └── intentExpansion.llm.js     # D   [was geminiEngine]  (LLM edge)
├── translation/
│   ├── biosonicTranslator.js      # C   [was biosonic/translate.js]  (pure)
│   └── wellbeingRegulator.js      # W4  safety clamp on target  [NEW 4]
├── features/
│   ├── featureStoreAgent.js       # E   [was featureService]
│   └── multiTierFallback.sub.js   # E1  tiered feature resolution  [NEW]
├── knowledge/
│   ├── identityAgent.js           # I   [was services/identity/trackIdentity]
│   └── vectorDiscoveryAgent.js    # V   [was vector/* + discoveryBonus]  explore/exploit
├── curation/
│   ├── selectionAgent.js          # F   [was selection/pipeline]
│   └── varianceAgent.js           # G   [was serveLedger] + context-aware decay [NEW G1]
├── delivery/
│   ├── playbackBridge.js          # H   [was crossPlatform + spotifyController]
│   └── transitionFlow.js          # T9  psychoacoustic BPM/energy gradient  [NEW 9]
└── learning/
    ├── personalization.js         # L2  taste-learning  [NEW 2]
    ├── feedbackLoop.js            # L3  reinforcement/closed loop  [NEW 3]
    ├── explainability.js          # X   "why this mix" receipts  [NEW]
    └── coldStart.js               # CS  new-user bootstrap  [NEW]
```

---

## 2. SHARED SUBSTRATE (`_shared/`)

**Event bus (Pub/Sub).** A typed publish/subscribe seam. Live topics (`telemetry.raw`, `telemetry.clean`, `state.updated`, `target.ready`, `playlist.ready`, `playback.event`, `feedback.signal`) ride socket.io + an internal EventEmitter; durable/async topics (`feature.hydrate`, `embedding.build`, `state.recompute`, `learning.train`) ride BullMQ. Agents subscribe to topics, never to each other.

**Schemas (validation).** Every event/DTO has a `zod` (or `ajv`) schema in `schemas/`. **No agent emits an event that hasn't passed its schema** (Design-by-Contract). Core DTOs: `TelemetryRaw`, `TelemetryClean`, `StateVector`, `MusicTarget`, `TrackFeature`, `Candidate`, `Playlist`, `PlaybackEvent`, `FeedbackSignal`, `MixReceipt`.

**Resilience fabric (`resilience/`).** One shared toolkit every adapter wraps with:
- **Circuit Breaker** (per external dependency: Spotify, Groq, ReccoBeats, Garmin, weather) — OPEN on N consecutive failures, HALF-OPEN probe, CLOSED on success.
- **Bulkhead** — isolated concurrency pools so a Groq stall can't starve the Spotify path.
- **Retry w/ exponential backoff + jitter**, bounded budget, honoring `Retry-After`.
- **Timeout budget** per call; **dead-letter** for un-processable async jobs.

---

## 3. AGENT SPECIFICATIONS

> Template per agent — **Responsibility · Input→Output · Port/Adapter · State & Cache · Failure & Fallback · Patterns · Home**.

### Layer 0 — Orchestration & Platform

#### O1 · Session Conductor — `orchestrator/sessionConductor.js` · P0 · EXISTS (`generation/orchestrator.generateV2`)
- **Responsibility:** the *only* serving path; a Saga that sequences one generation request across agents. Holds **no domain logic** — pure conduction.
- **Input→Output:** `{userId, trigger, emotion, live}` → `{playlist, target, telemetry, mixReceipt}`.
- **Port/Adapter:** depends on every agent **through its port**, never its module.
- **State & Cache:** per-session state machine `IDLE → GATHERING → TRANSLATING → SELECTING → RESOLVING → SERVING → LEARNING`; correlation-id per request; idempotency key so a retried request never double-serves.
- **Failure & Fallback:** any agent failure → the deterministic fallback path (`buildMoodParams` → static last-resort playlist). Partial degradation is allowed; total failure returns cached last-good.
- **Patterns:** Facade, Saga/Orchestration, State Machine.

#### P (Privacy Governor) · `platform/privacyGovernor.js` · P0 · NEW (grounded in `erasure.js`)
- **Responsibility:** the guardian of the zero-knowledge boundary and GDPR Art. 9. Gate for: PII-stripping before any egress to Groq/weather; enforcing "decrypt-only-in-worker"; data-retention windows; right-to-export; cascade-erase.
- **Input→Output:** intercepts outbound payloads → returns sanitized payloads or **BLOCKS**. Emits `privacy.violation` (should never fire) + audit log on any decrypt.
- **State & Cache:** consent ledger per user; retention timers.
- **Failure & Fallback:** fail **closed** — if it can't verify a payload is clean, it blocks egress (never leaks on error).
- **Patterns:** Policy/Guard, Decorator (wraps egress adapters), Audit Log.

#### P (Resilience Fabric) · `platform/resilienceFabric.js` · P1 · NEW (partial: `utils/retry`)
- **Responsibility:** central registry of circuit breakers + bulkheads keyed by dependency; exposes `withResilience(dep, fn)`.
- **State & Cache:** breaker state per dependency in Redis (shared across instances).
- **Patterns:** Circuit Breaker, Bulkhead, Registry.

#### [8] FinOps & Rate-Limit Guardian · `platform/finopsGuardian.js` · P2 · NEW
- **Responsibility:** track live quota/spend per external API (Spotify calls, Groq TPM against the 6000 ceiling, ReccoBeats batches). **Predict** an imminent 429 (token-bucket accounting) and pre-emptively route to the Offline Buffer / cache-only mode before the limit is hit.
- **Input→Output:** observes all outbound-call metadata → emits `finops.pressure {dep, level}` and a routing directive (`live | degraded | offline`).
- **State & Cache:** rolling token-bucket per dep in Redis; cost counters.
- **Failure & Fallback:** on pressure=high → conductor switches that dependency to cached/offline; alarms via Observability.
- **Patterns:** Token Bucket, Strategy (routing), Observer.

#### [6] Observability · `platform/observability.js` · P1 · NEW
- **Responsibility:** SLOs (selection p95 <300ms), recommendation-quality drift, cache hit-rate, Groq cost, error budgets → Sentry + structured JSONL with correlation ids.
- **Patterns:** Observer, Aggregator.

#### Offline Buffer & Cache · `platform/offlineBuffer.js` · P2 · NEW
- **Responsibility:** keep a rolling 5–10 track buffer per active session (last-good playlist), served when FinOps/network forces offline. Exponential-backoff reconnect.
- **Patterns:** Cache-aside, Circuit-Breaker consumer.

### Layer 1 — Sensing & Cleaning

#### A · Ingestion & Transport · `ingestion/ingestionAgent.js` · P0 · EXISTS (`sockets/biometricHandler`)
- **Responsibility:** the single door for live signal (BLE HR, Health Connect HRV/sleep/steps/activity, emotion taps + prompt). Normalize heterogeneous wearable formats → one schema.
- **Input→Output:** `TelemetryRaw` (per-provider) → `TelemetryClean`-candidate (normalized, pre-filter).
- **Port/Adapter:** `WearableAdapter` (Garmin/HealthConnect/BLE/Suunto), `SocketPort`.
- **State & Cache:** per-socket session; reqId gating (drop stale); reconnect re-hydration (re-emit `emotion_update` on every connect — server cache is socketId-keyed).
- **Failure & Fallback:** malformed → drop + metric; transport drop → socket.io backoff (never a manual parallel-socket storm).
- **Patterns:** Adapter, Facade, Pub/Sub.

##### A1 · Adaptive Polling Sub-Agent · `ingestion/adaptivePolling.sub.js` · P2 · NEW
- **Responsibility:** throttle BLE sampling by exertion state to save device battery — high cadence during `peak`/exercise, low during `resting`/still. Sends a poll-rate directive back to the mobile client.
- **Input→Output:** current `StateVector.exertion` + `activity` → `{pollHz}` directive.
- **State:** hysteresis (avoid flapping between rates).
- **Patterns:** Strategy, Feedback control (note: the *actuation* lives on-device; this agent computes the policy).

##### A2 · Anomaly / Noise Filter Sub-Agent · `ingestion/anomalyFilter.sub.js` · P1 · NEW **[highest-ROI]**
- **Responsibility:** reject sensor artifacts before they poison state — motion-induced HR spikes vs. real, dropouts, implausible values, flatlines. Emits a **confidence** per reading.
- **Input→Output:** `TelemetryClean`-candidate → `TelemetryClean {value, confidence, artifactFlags}`.
- **Logic:** robust z via median/MAD (already the baseline math), plausibility gate (30–220), rate-of-change limits (a 40→180 jump in 1s is motion, not cardiac), short-gap interpolation, NaN/∞ clamp.
- **Failure & Fallback:** low-confidence run → degrade to **mood-only** (don't fabricate physiology).
- **Patterns:** Chain of Responsibility (filter stages), Strategy.

##### A3 · Schema Guard · `ingestion/schemaGuard.sub.js` · P0 · NEW
- **Responsibility:** hard schema validation at the boundary — nothing enters the system unvalidated (prompt length cap, control-byte strip, tap-buffer ≤3, no injected biometric fields).
- **Patterns:** Design-by-Contract, Guard.

### Layer 2 — Physiology & Context

#### B · Physiological State Agent · `physiology/stateAgent.js` · P0 · EXISTS (`baselines` + `stateVector.worker`)
- **Responsibility:** "how is the body right now" → the **State Vector** (recovery, stress, exertion, tempoBand, status).
- **Input→Output:** `TelemetryClean` + 30-day history → `StateVector`. Decrypt **only here, in-worker**.
- **State & Cache:** Redis `bio:baseline:{userId}` = AES-256-GCM blob **AAD-bound to userId** (cross-user replay rejected), TTL 6h; recompute debounced (`jobId: state-vector:{userId}`, 60s delay).
- **Failure & Fallback:** <10 samples → null (never fabricate); missing groups → confidence penalty, not a crash.
- **Patterns:** Repository, Worker, CQRS-lite (read model for Pulse).

##### B1 · Chronobiology & Micro-Trends Sub-Agent · `physiology/chronobiology.sub.js` · P2 · NEW
- **Responsibility:** move beyond a flat 30-day average — model **circadian phase** (time-of-day energy curve) and **multi-day fatigue slopes** (accumulating sleep debt, a downward HRV trend across days). Outputs modifiers the translator folds in.
- **Input→Output:** rolling multi-day series → `{circadianEnergyBias, fatigueSlope, readinessTrend}`.
- **State & Cache:** per-user time-bucketed aggregates in Mongo; nightly recompute.
- **Failure & Fallback:** insufficient history → neutral modifiers (0 bias).
- **Patterns:** Strategy, Time-series aggregation.

#### C5 · Context / Routine Agent · `context/routineAgent.js` · P1 · NEW-ish (extends `stateVector.status`)
- **Responsibility:** infer the *situation* (commute, workout, focus, wind-down) from motion + time + learned routines → a context label that shapes selection.
- **Input→Output:** `StateVector` + motion + time + history → `ContextLabel {situation, confidence}`.
- **Patterns:** Strategy, lightweight temporal pattern learning.

#### [7] Environmental Context Agent · `context/environmentAgent.js` · P2 · NEW · ⚠️ privacy-gated
- **Responsibility:** feed weather (temp, rain), daylight, and altitude into the translation matrix (cold rainy morning ≠ bright warm afternoon).
- **Input→Output:** coarse location → `EnvContext {tempBand, precip, daylight, altitudeBand}` → modifiers.
- **⚠️ Architect caveat:** location is sensitive and *not* currently collected — this widens your privacy surface. **Gate it behind the Privacy Governor and explicit opt-in**, use **coarse** location (city-grid, never precise GPS), cache aggressively (weather changes slowly), and treat it strictly as a *bias*, never a hard driver. If in doubt, keep it P2/optional.
- **Port/Adapter:** `WeatherAdapter` (behind circuit breaker; stale-cache on outage).
- **Patterns:** Adapter, Decorator (cache), Strategy.

### Layer 3 — Intent & Translation

#### D · Intent Expansion Agent (LLM) · `intent/intentExpansion.llm.js` · P0 · EXISTS (`geminiEngine`)
- **Responsibility:** the *only* hot-path LLM — expand emotion taps + activity + **PII-stripped** prompt into genre/vibe hints.
- **Input→Output:** sanitized intent → `{genreHints, vibeTags, confidence≤0.7}`.
- **Failure & Fallback:** Groq down/timeout/429 → **deterministic `buildMoodParams`** (on-vibe, no LLM). Prompt-cache for determinism.
- **Patterns:** Adapter, Strategy (LLM vs deterministic), Circuit Breaker.

#### C · Biosonic Translation Agent · `translation/biosonicTranslator.js` · P0 · EXISTS (`biosonic/translate.js`, pure)
- **Responsibility:** **the mind+body → music-attributes mapper.** Fuse State Vector + live HR/activity + emotion + intent hints + chronobiology/environment modifiers → the **Music Target Vector**.
- **Input→Output:** all of the above → `MusicTarget {bpmCenter, bpmWidth, energyFloor, energyCeiling, valenceTarget, acousticnessBias, instrumentalBias, tempoBand, confidence, state{recovery,stress,exertion}}`.
- **State:** **stateless & pure** — 300-round fuzz-pinned, range-clamped for ANY input. This is the crown jewel of testability.
- **Failure & Fallback:** every input group missing → confidence floor 0.3, never a throw.
- **Patterns:** Pure function, Strategy (band rules).

#### [4] Wellbeing / Regulator Agent · `translation/wellbeingRegulator.js` · P1 · NEW (formalizes existing recovery-gating)
- **Responsibility:** the safety guardrail — when the State Vector shows high stress / low recovery, **clamp** the target toward calming, entraining music (cap energy ceiling, raise acousticness/valence floor). Enforces the "regulator, not mirror" ethic.
- **Input→Output:** `MusicTarget` + `StateVector` → constrained `MusicTarget`.
- **State:** stateless policy.
- **Patterns:** Decorator (wraps translator output), Policy.

### Layer 4 — Music Knowledge & Curation

#### I · Identity & Resolution Agent · `knowledge/identityAgent.js` · P0 · EXISTS (`trackIdentity`)
- **Responsibility:** canonical identity + dedup + URI resolution (ISRC → `isrc:` key, else `artist|title`); trust boundary (library keys trusted, discovery/cache recomputed — cache-poisoning defense). Owns the `resolvedDiscoveryUris` work.
- **Input→Output:** raw track → `{canonicalKey, recordingKey, resolvedUri}`.
- **Patterns:** Strategy (key derivation), Adapter (cross-platform resolve).

#### E · Feature-Store Agent · `features/featureStoreAgent.js` · P0 · EXISTS (`featureService`)
- **Responsibility:** give every candidate measurable audio attributes; api-first, cache-aside (Redis `af:{key}` 7d → Mongo truth), **api docs write-through / llm docs invalidate-only** (estimates never clobber measurements).
- **Input→Output:** track IDs → `TrackFeature[]`.
- **Patterns:** Repository, Cache-aside, Adapter.

##### E1 · Multi-Tier Fallback Sub-Agent · `features/multiTierFallback.sub.js` · P1 · NEW
- **Responsibility:** **guarantee a usable feature/vector even when the primary source lacks data.** ⚠️ Architect accuracy note: the requested "MusicBrainz → Last.fm → LLM" chain conflates different data types — so the tiers map to what each source *actually* yields:
  1. **Measured audio features** (ReccoBeats-style / AcousticBrainz archive) — the truth (bpm/energy/valence).
  2. **Identity/metadata** (MusicBrainz) — canonical ISRC/relations → feeds the Identity Agent + improves match rate (not features themselves).
  3. **Tags/similarity** (Last.fm) — genre/mood tags → *heuristic* feature priors + discovery signal.
  4. **LLM fast-estimation** (Groq, confidence ≤0.7) — the true last-resort feature estimate for tracks nothing else can serve.
- **Logic:** Chain of Responsibility — try each tier until a feature of acceptable confidence is produced; tag the source + confidence on the output.
- **Failure & Fallback:** all tiers fail → mark track `unknownFeature` (selection applies `unknownFeaturePenalty`, never a crash).
- **Patterns:** Chain of Responsibility, Strategy, Adapter (one per source, each behind a breaker).

#### V · Vector / Discovery Agent · `knowledge/vectorDiscoveryAgent.js` · P1 · EXISTS (`vector/*` + `discoveryBonus`)
- **Responsibility:** similarity search (Atlas `$vectorSearch`, 70-dim embeddings) + principled **explore/exploit** — a bandit-style novelty controller balancing known taste against fresh discovery.
- **Input→Output:** target + user vector → `{familiarCandidates, discoveryCandidates, noveltyBudget}`.
- **Failure & Fallback:** off-Atlas / vector outage → `.catch(()=>[])` (degrades to feature-only similarity, never blocks).
- **Patterns:** Adapter (`use(adapter)` injection), Strategy (explore/exploit bandit).

#### F · Curation / Selection Agent · `curation/selectionAgent.js` · P0 · EXISTS (`selection/pipeline`)
- **Responsibility:** the recommender core — pool → hard filters → score → MMR diversity → **relaxation ladder** (L0 full → L1 drop energy ceiling → L2 drop genre → L3 drop mood window; **hardExcluded NEVER relaxed**).
- **Input→Output:** pool + `MusicTarget` + features + exposure + embeddings → ordered `Playlist {familiar, discovery, merged, telemetry}`.
- **State:** pure `score.js`/`mmr.js`; memoized weights (hot-path).
- **Failure & Fallback:** ledger outage → `degraded=true`, empty exclusion sets (still serves).
- **Patterns:** Pipeline, Strategy (scoring), Chain of Responsibility (relaxation).

#### G · Variance / Exposure Agent · `curation/varianceAgent.js` · P0 · EXISTS (`serveLedger`) + **G1 NEW**
- **Responsibility:** freshness — exposure decay + exclusion windows (24h global / 72h per-mood) so tracks don't repeat.
- **G1 · Context-Aware Decay (NEW, P1):** penalty is **weighted by context similarity** — a track played on a *calm walk* is only lightly penalized for an *intense run* the next day (different context = lower repeat-fatigue). Extend `exposureScore` with a context-distance multiplier (reuse the mood-proximity `σ` idea, add a `ContextLabel` distance term).
- **Input→Output:** serve history + current `ContextLabel` → exposure penalties + exclusions.
- **State & Cache:** Redis ZSET hot windows over Mongo truth; lazy rebuild answers from Mongo directly (never trusts a write→read round-trip).
- **Patterns:** Repository, Strategy (decay kernel), Time-decay.

### Layer 5 — Delivery & Flow

#### H · Playback Bridge Agent (Spotify) · `delivery/playbackBridge.js` · P0 · EXISTS (`crossPlatform` + `spotifyController`)
- **Responsibility:** resolve track keys → Spotify URIs; drive App Remote; **remote-as-truth** reconcile (URI-aware); own all Spotify resilience (auth/scope, reconnect, foreground handling).
- **Input→Output:** `Playlist` → playback commands + `PlaybackEvent` stream.
- **Failure & Fallback:** connect/command failure → clean `disconnected` state, never an unhandled rejection; capped reconnect; context-attach 403 → fail-open to track playback.
- **Patterns:** Adapter (`SpotifyRemoteLike` port), State Machine, Circuit Breaker.

#### [9] Transition & Flow Agent (Psychoacoustic) · `delivery/transitionFlow.js` · P2 · NEW
- **Responsibility:** DJ-style flow — manage **BPM/energy gradients between consecutive tracks** so the body isn't shocked (no 70→160 BPM jump); order/curate transitions, and hint crossfade timing (respecting Bluetooth/ANC latency, per PLAN §3C).
- **Input→Output:** ordered `Playlist` + `MusicTarget.tempoBand` → re-sequenced playlist + per-gap `{crossfadeMs, gradientOk}`.
- **Logic:** compute inter-track BPM/energy deltas; if a delta exceeds a comfort threshold, insert a bridging track or re-order; under `wind-down`, monotonically decrease energy.
- **Failure & Fallback:** if re-sequencing isn't possible within budget → pass through original order (never block playback).
- **Patterns:** Strategy (gradient policy), Post-processor/Decorator over Selection.

### Layer 6 — Learning & Explainability

#### [2] Personalization / Taste-Learning · `learning/personalization.js` · P1 · NEW **[retention driver]**
- **Responsibility:** learn per-user preferences over time and tune the Selection Agent's **scoring weights** (does this user want higher energy under stress? which genres for "focus"?).
- **Input→Output:** long-run serve history + feedback + context → `PersonalWeights {taste, feature, genre, exposure, discovery…}` (overrides the global defaults).
- **State & Cache:** per-user weight model in Mongo; updated by the Feedback Loop's reward signal; **online, incremental** (no heavy retrain).
- **Failure & Fallback:** cold/sparse user → fall back to global weights (see Cold-Start).
- **Patterns:** Strategy (pluggable weight model), Repository, incremental learner.

#### [3] Feedback-Loop / Reinforcement · `learning/feedbackLoop.js` · P1 · NEW **["reads my mind" feel]**
- **Responsibility:** close the loop — observe reactions (skip / replay / complete, and the **HR response** to a track) → infer whether it "worked" → (a) nudge the *live* target mid-session, (b) emit a reward signal to Personalization.
- **Input→Output:** `PlaybackEvent` + `TelemetryClean` → `{targetDelta, reward}`.
- **Logic:** 2 consecutive skips → recalibrate energy/valence (the PLAN seed), formalized as a bounded controller; HR dropping on a calm track under stress = positive reward.
- **Failure & Fallback:** noisy/insufficient signal → no-op (never over-correct).
- **Patterns:** Observer, Controller (closed loop), Reinforcement-lite.

#### X · Explainability / "Why this mix" · `learning/explainability.js` · P1 · NEW
- **Responsibility:** turn the internal signals (state, target, top score terms) into the human-readable **mix receipt** the Now-Playing screen shows ("Low HRV · winding down · calm tempo lock").
- **Input→Output:** `{StateVector, MusicTarget, selection telemetry}` → `MixReceipt {headline, reasons[]}`.
- **Failure & Fallback:** missing signals → generic-but-honest copy, never fabricated reasons.
- **Patterns:** Presenter/Adapter, read-only over the pipeline's telemetry.

#### CS · Cold-Start / Onboarding · `learning/coldStart.js` · P0 · NEW (fixes the onboarding-latency class)
- **Responsibility:** solve the new-user problem — no history, no baselines, library still hydrating. Bootstrap a usable profile from minimal input so **first generation works instantly** (phased hydration: seed a small batch → unlock generation → background the rest).
- **Input→Output:** minimal signup signals → provisional `PersonalWeights` + a "warming" state the client shows gracefully (no hard error).
- **Failure & Fallback:** nothing yet → mood-only defaults; emits `playlist_building` heartbeat, never a hard timeout.
- **Patterns:** Strategy (bootstrap heuristics), State Machine (`cold → warming → warm`).

---

## 4. DATA FLOW (ASCII — watch → Spotify, full master graph)

```
                              ┌──────────────────────── PLATFORM (cross-cutting) ─────────────────────────┐
                              │  privacyGovernor(P0)  resilienceFabric(P1)  finopsGuardian(8)             │
                              │  observability(6)     offlineBuffer                                        │
                              └──▲───────────────▲──────────────▲───────────────▲──────────────▲──────────┘
                                 │ guards egress  │ wraps adapters│ quota/429     │ metrics       │ offline
 WATCH / PHONE                   │                │               │               │               │
 BLE HR, HealthConnect ─┐        │                │               │               │               │
 (HRV, sleep, steps)    │        │                │               │               │               │
 Emotion taps + prompt ─┤        │                │               │               │               │
                        ▼        │                                                                 │
                 [A] Ingestion ──┼─▶ [A1] Adaptive Polling (battery)  ──(pollHz)──▶ back to device │
                        │        │                                                                 │
                        ▼        │                                                                 │
                 [A3] Schema Guard ─▶ [A2] Anomaly/Noise Filter ──▶ TelemetryClean{value,conf}     │
                        │                                                    │                     │
        ┌───────────────┴───────────────┐                                   ▼                     │
        ▼                               ▼                          [B] Physiological State  ◀── [B1] Chronobiology
 [D] Intent Expansion (LLM)     [E7] Environmental ──┐             (StateVector, ZK boundary)     (circadian, fatigue slope)
   (PII-stripped, Groq)          (weather/altitude)  │                       │
        │ genre/vibe hints        privacy-gated ⚠️   │             [C5] Routine/Context ──(situation)──┐
        │                                            │                       │                          │
        └───────────────┬────────────────────────────┴───────────────────────┘                          │
                        ▼                                                                                 │
                 [C] Biosonic Translator (pure) ──▶ MusicTarget                                           │
                        │                                                                                 │
                 [W4] Wellbeing Regulator (clamp under stress) ──▶ constrained MusicTarget                │
                        │                                                                                 │
        ┌───────────────┼───────────────────────────────────────────────┐                               │
        ▼               ▼                                                 ▼                               │
 [I] Identity     [E] Feature Store ──▶ [E1] Multi-Tier Fallback   [V] Vector/Discovery                  │
 (dedup/URI)      (api-first cache)     (measured→MB→Last.fm→LLM)   (explore/exploit)                     │
        └───────────────┴───────────────────────┬───────────────────────┘                               │
                                                 ▼                                                        │
                                   [F] Curation / Selection  ◀────── [G] Variance/Exposure ◀──── [G1] Context-Aware Decay ◀─┘
                                   (pool→filter→score→MMR→relax)      (24h/72h windows)
                                                 ▼
                                   [T9] Transition/Flow (BPM/energy gradient, crossfade)
                                                 ▼
                                   [H] Playback Bridge ──▶ resolve URIs ──▶ Spotify App Remote ──▶ 🎵
                                                 │                                    │
                                                 ▼                                    ▼
                                   [X] Explainability                        PlaybackEvent stream
                                   ("why this mix" → UI)                              │
                                                                                      ▼
                                                                     [3] Feedback Loop ◀── HR response + skips
                                                                          │  (a) live target delta ──▲ (back to [C])
                                                                          │  (b) reward
                                                                          ▼
                                                              [2] Personalization (tunes [F] weights) ◀── [CS] Cold-Start (bootstrap)
```

**Cadence & guards:** the whole left column lives inside the **zero-knowledge boundary**; live re-generation is **debounced** (sustained physiological change ~60s) to respect rate limits; every external adapter is wrapped by the **Resilience Fabric** and watched by **FinOps**; every egress passes the **Privacy Governor**.

---

## 5. FAILURE-MODE MATRIX (what happens when X is down)

| Dependency down | Detected by | Fallback behavior (music never stops) |
| :--- | :--- | :--- |
| **Groq / LLM** | breaker OPEN on D/E1 | deterministic `buildMoodParams` intent + LLM feature tier skipped |
| **Spotify App Remote** | H state machine | clean `disconnected`, capped reconnect; context-403 → fail-open track playback |
| **ReccoBeats / feature API** | breaker on E | Multi-Tier Fallback (MB→Last.fm→LLM); else `unknownFeaturePenalty` |
| **Atlas Vector** | `.catch` on V | feature-only similarity; discovery degrades, never blocks |
| **Redis** | getRedis null | queues no-op gracefully; ledger rebuilds from Mongo truth |
| **Garmin/HealthConnect** | Anomaly Filter confidence=0 | mood-only mode (no fabricated physiology) |
| **Weather API** | breaker on E7 | stale cache → neutral env modifiers |
| **Rate limit imminent (429)** | FinOps token-bucket | route to Offline Buffer / cache-only for that dep |
| **Full network drop** | Offline Buffer | serve buffered 5–10 tracks; exp-backoff reconnect |

---

## 6. SEQUENCING & HONEST CAVEATS (build order)

**P0 (formalize what exists, make it clean):** Session Conductor, Privacy Governor, Ingestion + Schema Guard, State Agent, Intent (LLM), Biosonic Translator, Identity, Feature Store, Selection, Variance, Playback Bridge, Cold-Start. → This is a fully working app.

**P1 (the intelligence + resilience that make it *smart*):** Anomaly Filter, Wellbeing Regulator, Context/Routine, Vector/Discovery explore-exploit, Context-Aware Decay (G1), Multi-Tier Fallback (E1), Personalization (2), Feedback Loop (3), Explainability (X), Resilience Fabric, Observability.

**P2 (world-class polish — build once P1 proves value):** Adaptive Polling (A1), Chronobiology (B1), Environmental (7, privacy-gated), Transition/Flow (9), FinOps Guardian (8), Offline Buffer.

**Three caveats I owe you as your architect:**
1. **Don't build all 24 at once** — the highest-ROI real order is Anomaly Filter → Feedback Loop → Personalization; those unlock everything downstream.
2. **Environmental (7) widens your privacy surface** — location is sensitive, currently uncollected. Keep it opt-in, coarse, cached, and behind the Privacy Governor, or defer it.
3. **The Multi-Tier Fallback sources aren't interchangeable** — MusicBrainz = identity, Last.fm = tags, only measured-APIs/LLM = actual audio features. The doc above maps each to what it truly contributes so you don't build a tier that returns the wrong data type.

---

*This document is the runtime contract. Build agents: implement P0 first, one agent per PR, each behind its port, TDD with real semantics — never a green mock for an integration boundary.*
