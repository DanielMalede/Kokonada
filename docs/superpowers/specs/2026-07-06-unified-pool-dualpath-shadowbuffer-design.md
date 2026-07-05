# Design — Unified: Pool Uncap + Hard Mood Band · Manual/Live Dual-Path + Animated UI · Shadow-Worker Biometric Buffer

Date: 2026-07-06
Status: Proposed (awaiting review)
Supersedes: `2026-07-05-biosonic-variance-and-live-biometric-mode-design.md` WS1 (its "empty features" root cause is disproved — see Context)
Related master sections: §0 (Roadmap), §3.0 (Queue/Worker), §3.3 (Variance Engine), §3.4 (Biosonic Translate), §3.5–3.7 (Selection/Flip/Seal), §A.1 (three-lane mobile state), §B (input suite)

## Context — the corrected diagnosis (evidence, not assumption)

The reported bug is **"same playlist every time"** — different moods / HR yield a near-identical playlist. The earlier WS1 spec attributed this to an **empty `AudioFeature` store**. A read-only production Mongo diagnostic (user `6a49667…`) **disproved that**:

- The library is **Spotify** (1508 tracks, all with Spotify IDs), not YouTube-built.
- **970/1508 (64%) already carry measured (`source:api`) features.** The store is not empty.
- Production `[selection.v2]` logs on three live generations: **`pool=488 featured=344 filtered=488 relax=4`** — repeated identically.

The real causal chain:

1. **Affinity-capped, frozen pool.** `candidatePool.js` sorts the library by affinity DESC, slices to `SELECTION_POOL_MAX=500`, caches 12h. Only the top-500-affinity tracks ever become candidates; ~1000 library tracks never enter. `pool=488` confirms it.
2. **`relax=4` on every generation strips mood.** Heavy serving saturates the 8h serve-exclusion window (held through L0–L3), so the ladder can't reach minimum fill → the L4 last-resort (added in PR #64) fires, and L4 empties `energyCeiling`, `moodExcluded`, and genre excludes. Mood no longer gates candidates.
3. **Deterministic scorer + saturated exposure = no rotation.** When the whole pool is served recently, every track carries a similar exposure penalty → no spread → the affinity-weighted (`SCORE_W_TASTE=0.35`), fully deterministic scorer returns the same top-50. There is deliberately no random tiebreak (§3.7).

Compounding: Spotify `/recommendations` is dead (404 in prod) → the pool is familiar-only.

**Conclusion:** the fix is structural, in three parts — uncap the pool and make the mood band un-relaxable (Part 1), decouple manual vs live generation on the client with a UI-thread analysis animation (Part 2), and precompute a biometric buffer in the background for zero-latency live mode (Part 3).

## Non-goals

- **No reintroduction of variation seeds / randomness.** §3.7 mandates determinism; variety comes from the uncapped pool + the exposure engine, not stochasticity.
- No redesign of `translate.js`, `score.js`'s term math, canonical identity, ledger windows, or the zero-knowledge boundary.
- No live re-hydration of features during generation (features are already stored and permanently cached).

---

## Part 1 — Pool Uncap + Hard Mood Band (Backend)

### 1.1 Uncap the candidate pool
- `candidatePool.js`: `SELECTION_POOL_MAX` default becomes the **library size, bounded by the schema's 10 000-entry `library` cap** (set default high, e.g. `10000`; keep it env-tunable). Keep the affinity **sort** (stable ordering, high-affinity leads on ties); **drop the 500 slice**.
- Cache unchanged in shape: `pool:{userId}:{moodKey}` TTL 12h, invalidated by `lastAnalyzed`. Payload grows (~1508 tracks ≈ 300 KB; 10k ≈ 2 MB) — acceptable; pin a size note + a latency test.
- Effect: with ~1508 candidates, the 8h serve window can no longer saturate the pool → **`relax=4` stops firing in normal use**, and the exposure engine gains fresh, never-served tail tracks to rotate toward (deterministic variety).

### 1.2 Hard, un-relaxable biosonic band
- **Structural separation:** split "anti-repetition relaxation" (serve windows, genre — the ladder) from "mood identity" (the tempo/energy band). Introduce a pure `biosonicBand.js` (or a fixed pre-filter in `pipeline.js`) applied to the pool **before** the relaxation ladder and **never** relaxed by any level, including L4.
- **Band definition:** for a track with features, keep it iff `bpm ∈ [bpmCenter − w·bpmWidth, bpmCenter + w·bpmWidth]` **and** `energy ∈ [energyFloor, energyCeiling]` from `translate()`. Tracks **without** features pass the band (can't be judged) and carry the existing `unknownFeaturePenalty` in scoring.
- **Confidence-adaptive tolerance (logistic, replaces §3.5's binary `confidence ≥ 0.7` gate).** A single tolerance multiplier `τ(c)` over confidence `c ∈ [0,1]`:
  - `τ(c) = w_min + (w_max − w_min)·σ(k·(c₀ − c))`, `σ(x)=1/(1+e^{−x})`, with `w_min=1.0`, `w_max=3.0`, `c₀=0.6`, `k=10`.
  - BPM band: `[bpmCenter − τ(c)·bpmWidth, bpmCenter + τ(c)·bpmWidth]`.
  - Energy band: `[energyFloor − (τ(c)−w_min)·E_tol, energyCeiling + (τ(c)−w_min)·E_tol]`, `E_tol=0.1`, clamped `[0,1]`.
  - Chosen logistic (not linear/exponential/Gaussian) for **double saturation**: `τ` floors at `w_min>0` (measured/estimated features carry irreducible error — the band must never collapse) and ceils at `w_max` (a zero-confidence request still keeps a mood identity — the band must never diverge). `c₀=0.6` sets a calibrated "trust cliff" mid `translate()`'s operational range (floor 0.3→1.0); `k=10` makes it crisp but C^∞-smooth, so no threshold jitter as confidence drifts. Constants live in `biosonicBand.js` (env-overridable), pinned by a unit test asserting the value table (τ(1.0)≈1.04, τ(0.6)=2.0, τ(0.3)≈2.91).
- **Never-empty reconciliation (supersedes the raw PR #64 L4):** the L4 last-resort still guarantees a non-empty playlist, but **replays familiar tracks WITHIN the band**. Only if the band yields *literally zero* on-mood familiar tracks (rare with an uncapped pool) does an absolute last-resort widen the band (logged as `bandWidened`), rather than serving off-mood tracks. Mood is the sacred constraint; repetition and genre are what relax.

### 1.3 Telemetry
- Extend `[selection.v2]`: add `banded=<tracks passing the biosonic band>` alongside `pool`/`featured`/`filtered`/`relax`, plus a `bandWidened=0|1` flag when the absolute last-resort fires.

### 1.4 Interfaces / files
- Modify: `services/selection/candidatePool.js` (cap), `services/selection/pipeline.js` (apply band pre-ladder, telemetry), `services/selection/hardFilters.js` (energy-ceiling gate → delegate to band), `sockets/biometricHandler.js` (telemetry line). New pure: `services/selection/biosonicBand.js`. `score.js` term math unchanged.

### 1.5 Tests (TDD)
- Band excludes off-mood tracks even at relaxLevel 4.
- Uncapped pool returns the full deduped library (no 500 slice).
- Two distinct `translate()` targets over a large fed pool yield materially different top-50s.
- Never-empty holds; `bandWidened` fires only when zero on-mood familiar tracks exist.
- Full backend suite is the regression gate.

---

## Part 2 — Manual/Live Dual-Path Routing + Animated UI (Frontend, `feat/spotify-playback-turbomodule`)

This absorbs and supersedes the surviving half (WS2) of the 2026-07-05 spec, and adds the analysis animation.

### 2.1 Dual-path state (single source of truth)
- **WARM lane** (`liveMode: boolean`, persisted per §A.1): a prominent **"Live Biometric ↔ Manual"** switch on the Generate screen, above the mood chips.
- **Manual (default):** mood chips + activity + text → **Generate**; plus the one-shot **Listen to your heart**. HR is streamed/shown but **never** fires a generation. Manual **bypasses the shadow buffer** and performs a live, on-the-fly LLM generation incorporating the prompt/mood (accepting slight latency for maximum personalization).
- **Live Biometric (opt-in):** HR **band** shifts drive auto-recalibration served from the precompiled buffer (Part 3). The manual Generate CTA yields to a "live-tuned" state so both can't drive the queue.
- **Mode-gating (server-safe):** the `biometric_push` auto-generation is gated on `liveMode` — the client suppresses off-mode auto-generation and/or sends mode so the handler gates on it. The server never auto-generates behind a manual user. Complements the shipped generation-timeout + epoch guards.
- **Queue re-tune:** on auto-recalibration, **finish the current track, then swap the upcoming queue** (no hard interrupt). `playbackOrchestrator` gains a "replace upcoming, keep current" path distinct from the immediate manual/heart replace.

### 2.2 Neural-analysis loading animation (new)
- A `react-native-reanimated` component (`NeuralAnalysisLoader`) running **strictly on the UI thread** (HOT lane per §A.1 — SharedValues + worklets, 120 Hz), so generation latency never janks the animation.
- **Contract:** `<NeuralAnalysisLoader active={generating} engagement={promptSignal} />`. `active` drives the "AI analyzing" motion; `engagement` is a SharedValue fed by prompt state (length / typing cadence) so the animation **subtly reacts to prompt engagement**. All animated values NaN-clamped (per the §B.2 bio-aura precedent).
- The concrete visual language (the "neural" motif, palette, motion curves) is designed at implementation time via the frontend-design skill — this spec fixes the component boundary, thread placement, and driver inputs only.

### 2.3 Interfaces / files (mobile)
- WARM store: `liveMode` + actions. Generate screen: the switch + CTA gating. New: `components/NeuralAnalysisLoader.tsx`. `playbackOrchestrator`: replace-upcoming path. Socket/biometric layer: mode-gate the auto-trigger.

### 2.4 Tests
- Mode gates the auto-trigger (Manual: HR never generates; Live: band change re-tunes upcoming after current).
- Replace-upcoming preserves the current track.
- Loader runs on the UI thread (worklet) and is NaN-safe. Existing 382-test mobile suite stays green.

---

## Part 3 — Shadow-Worker Biometric Buffer (Background Infrastructure)

### 3.1 Trigger
- Activates only when an **active smartwatch connection** is detected — defined as an HR sample received within a freshness window `SHADOW_HR_FRESH_MS = 300000` (**5 min**) via `/watch/hr` or the socket. Manual-only users never spin it up.

### 3.2 Debounce to band transitions (not raw heartbeats)
- The worker regenerates the buffer **only on a tempo-band transition** — resting `<90` / active `<120` / peak `≥120` (`bandFromHeartRate`), keyed by `syntheticBioMoodKey(hr, activity)` → `bio:<band>:<activity>`. Hysteresis (reuse the existing 60 s streaming / 25 bpm-delta debounce) prevents boundary flapping.

### 3.3 Precompile from cached features (no live hydration)
- On a confirmed band transition, the worker runs `orchestrator.generateV2` for the new `bio-moodKey` using the **existing `AudioFeature` store** (already 64–100% populated, permanently cached). It does **not** re-hydrate features live — Groq's role is only the emotion/critic prompt. Output is a ready-to-play Spotify-URI playlist stored as `buffer:{userId}:{bio-moodKey}` in Redis (TTL `SHADOW_BUFFER_TTL_S = 1800` — **30 min**).

### 3.4 Zero-latency toggle + cold fallback
- Flipping to Live Biometric Mode reads the buffer for the current band and **plays instantly**. If the buffer is **cold** (just connected, no band seen yet), fall back to a one-time live generation while the worker warms buffers for subsequent bands — and **never fail silently**: the client shows the Part 2 neural-analysis loader with an explicit "assembling your live biometric soundscape" message until the first buffer warms.

### 3.5 Serve recording — critical
- **Precompiling a buffer does NOT record serves.** Serves are recorded (`serveLedger.recordServes`) **only when a buffer is actually played** (toggled + playback begins). Otherwise unplayed buffers would pollute the exposure ledger and re-trigger the very saturation Part 1 fixes.

### 3.6 In-process constraint (§3.0)
- A 4th BullMQ queue `QUEUES.BIOMETRIC_BUFFER = 'biometric-buffer'` + `workers/biometricBuffer.worker.js`, run **in-process** (`RUN_WORKERS_IN_PROCESS`, Railway free-tier model). The HR-ingest path enqueues a buffer job on a confirmed band transition; band-debouncing bounds CPU so the worker never starves the web service.

### 3.7 Interfaces / files
- `queues/definitions.js` (+`BIOMETRIC_BUFFER`), `workers/biometricBuffer.worker.js`, `workers/index.js` (register), HR-ingest (`watchHrIngest`/`biometricHandler`) enqueue-on-transition, a Redis buffer repo, the socket "toggle live" reads the buffer. Reuses `generateV2` + `translate` + `serveLedger` (serve-on-play only).

### 3.8 Tests
- Enqueues only on band transition, not per HR sample.
- Buffer built from cached features (no hydration call in the hot path).
- Cold buffer → live fallback path.
- Serves recorded on play, never on precompile.
- In-process registration + graceful SIGTERM.

---

## Conflict Audit vs `KOKONADA_ARCHITECTURE_MASTER.md`

| # | Master doc states | This spec | Conflict | Resolution (in favour of this spec) |
|---|---|---|---|---|
| **C1** | §3.5 (l.314): `SELECTION_POOL_MAX=500` affinity cap | Uncap to library size (≤10k schema bound) | **YES** | Raise default cap to 10 000; keep affinity sort, drop the slice. Update §3.5. |
| **C2** | §3.5 (l.336-337): "hardExcluded NEVER relaxed — returns **empty** rather than repeat" (L0–L3 only) | L4 last-resort replays familiar **within the hard band** | **YES** (master already stale — PR #64 shipped L4) | Document L4 + the hard biosonic band; mood is the un-relaxable constraint, repetition relaxes. Update §3.5. |
| **C3** | §3.5 (l.320): energy ceiling only at `confidence ≥ 0.7` + has features | Hard band always applies; **width scales with confidence** | **PARTIAL** | Band always applies, proportionate to confidence; supersedes the binary 0.7 gate. Update §3.5. |
| **C4** | §3.7 (l.348): "no variation seeds, deterministic" | Part 1 stays deterministic; variety from uncapped pool + exposure | **NO** | Explicitly honoured; note the uncapped pool (not seeds) is the variety mechanism. |
| **C5** | §3.0: three in-process BullMQ queues | +1 queue `biometric-buffer` + worker, in-process, band-debounced | **NO** (extension) | Additive; document as the 4th queue in §3.0. |
| **C6** | §3.5 (l.352-353): serves recorded post-emit | Shadow precompile records **no** serves; serve-on-play only | **NO** (refinement) | Precompile ≠ serve; document in §3.0/§3.3. |
| **C7** | §0 IMMEDIATE NEXT ACTION: "Execute Squad 6 — On-Device Verification" | New priority: Part 1 → Part 2 → Part 3 | **YES** (roadmap) | This mandate supersedes the Squad-6-first ordering; Squad 6 follows. Update §0. |
| **C8** | 2026-07-05 spec WS1: "empty features → same playlist" | Disproved (64% populated); cause = pool cap + L4 strip | **YES** (supersedes prior spec) | Retire that WS1 diagnosis; its WS2 (mode decoupling) survives as Part 2. |
| **C9** | §A.1: three-lane mobile state (HOT Reanimated UI thread; WARM persisted) | Loader on HOT lane; `liveMode` on WARM lane | **NO** (fits) | Consistent with §A.1; no change needed beyond adding the components. |

All conflicts (C1, C2, C3, C7, C8) resolve **in favour of this spec**, and drive the master-doc update (§3.5, §3.7 note, §3.0, §0) that follows approval.

## Rollout order (authoritative)

1. **Part 1** (backend, off `origin/main`) — fixes the live "same playlist" bug; ships + device-verified first.
2. **Part 2** (mobile, `feat/…`) — dual-path routing + analysis animation; after Part 1 proves variety is restored.
3. **Part 3** (background) — biometric buffer; last, once Live mode's playback path (Part 2) exists to consume it.

Each part is a separate spec→plan→implementation cycle sharing this master design. Part 1 is the critical path.

## Resolved decisions (approved 2026-07-06)

- **D1 — Pool ceiling:** `SELECTION_POOL_MAX = 10000` (the full schema max).
- **D2 — Band width vs confidence:** the logistic `τ(c)` in §1.2 — `τ(c)=1.0+2.0·σ(10·(0.6−c))`. Pinned now.
- **D3 — Buffer TTL / HR freshness:** `SHADOW_BUFFER_TTL_S=1800` (30 min); `SHADOW_HR_FRESH_MS=300000` (5 min).
- **D4 — Cold-buffer UX:** show the neural loader with "assembling your live biometric soundscape" — never a silent wait.
