# Design — Biosonic Variance (feature hydration) + Live-Biometric Mode

Date: 2026-07-05
Status: Proposed (awaiting review)
Related: `KOKONADA_ARCHITECTURE_MASTER.md` §1.2 (audio features), §3.2 (Audio Feature Store), §3.4 (Biosonic Translation), §3.5 (orchestrator); `UI_UX_MASTER_PLAN.md` (biometrics shift → recalibration → queue re-tunes)

## Context

On-device Spotify playback now works end-to-end (explicit `AuthorizationClient` grant → App Remote connect → play). With the core loop live, two product/logic defects surfaced. Both are reconciled **strictly** with the master architecture — no new architectural path is introduced.

1. **Same playlist every time** — different mood taps and the live-HR trigger all yield a near-identical playlist.
2. **Manual vs biometric clash** — an automatic biometric trigger races the user's manual generation on one playback surface.

## Root-cause analysis (grounded in code)

### Issue #1 — the biosonic loop is fully built and correct; audio features aren't flowing
The intended loop exists and is wired:
- `generateV2` → `_targets()` calls `biosonic/translate.js` for real → `{bpmCenter, bpmWidth, energyFloor/Ceiling, valenceTarget, …}` from live HR/activity + baselines + sleep + HRV/battery/readiness + hourOfDay + moodKey.
- `selection/score.js` `_featureFit` scores each track's measured features against those targets (gaussian BPM fit + energy-mid + valence + acousticness).

**The single break:** `AudioFeature` is empty for the candidate pool, so `_featureFit` returns `null` → `featureDistance` collapses to a **constant 0.5 for every track**. The `translate()` targets then have nowhere to land, and the score is dominated by static `taste`/affinity (W 0.35) plus a weak genre term and anti-repetition. Result: near-identical output regardless of mood or HR.

Per the master (§1.2/§3.2) the feature source is: **ReccoBeats measured API (by Spotify ID) + Groq LLM fallback (≤0.7 confidence) for YouTube-only tracks — never pure-LLM**, hydrated async by the in-process worker, enqueued at `buildProfile` tail (YT library) and post-emit. That pipeline is present; it is simply not populating the store for this account.

**Suspect links (to be confirmed in WS1 Phase 1 — all consistent with the master, none require redesign):**
- **ReccoBeats reachability** — is `api.reccobeats.com` returning data in prod, or silently `features:null`?
- **LLM fallback over the YouTube-built library** — `buildProfile` enqueues ~1508 `youtube:<id>` tracks for the Groq estimator; is it producing + persisting, or stalling/failing (Groq rate limits, misconfig, or profile built before Phase 2)?
- **recordingKey alignment** — the pool is keyed `youtube:<videoId>`; hydration must store under the exact key the scorer reads. A provider mismatch is indistinguishable from "no features."

### Issue #2 — two independent generators, one surface
The **manual** path is clean: `GenerateController.ctaMode()` picks `generate` (emotion) vs `listen-to-heart` from explicit input. The clash is a **separate automatic** path: HR readings → `biometric_push` → backend debounce (60s streaming / 25 bpm delta) → `generateAndEmitPlaylist(trigger='biometric')`, firing with no user action on the same socket/state and overriding the user. The master *wants* biometric recalibration, but it must be explicit and single-active.

## Non-goals

- No redesign of `score.js`, `translate.js`, or the selection pipeline — they are correct per the master.
- No new "mood signal" mechanism (e.g. genre-only scoring). The master forecloses pure-LLM/ad-hoc paths.
- No change to canonical identity, ledger windows, or the zero-knowledge boundary.

---

## Workstream 1 — Repair feature hydration (light up the existing biosonic scorer)

**Goal:** `AudioFeature` populates for the candidate pool so `featureDistance` varies, and different moods / HR states produce measurably different playlists.

**Phase 1 — diagnosis (read-only, no behavior change).** Determine which link is dry, using an always-on diagnostic on the serve path (extend the existing `[selection.v2]` line) that reports, per generation: pool size, how many pool tracks resolved features (`featuredCount`), and the feature source split (`api`/`llm`/`none`). Optionally a one-shot script/endpoint that runs `featureService.hydrate` over a sample of the user's library and reports API-hit / LLM-hit / failed counts + the recordingKeys written vs the recordingKeys the scorer reads.

**Phase 2 — fix the dry link(s):**
- If **ReccoBeats** is unreachable/empty: confirm/adjust `RECCOBEATS_URL`, batch, timeout; ensure `features:null` on outage never poisons (already designed) and that translated Spotify-ID serve tracks are hydrated via the API.
- If **LLM fallback** is the gap: ensure the YouTube library is enqueued and the Groq estimator runs to completion within rate limits (batching/backoff), persisting `youtube:<id>` docs at confidence ≤ 0.7.
- If **recordingKey mismatch**: align the key the pool/scorer reads with the key hydration writes (single `recordingKeyOf`), so YouTube pool tracks resolve their features.
- Trigger a re-hydration of the existing profile library so this account benefits without a full profile rebuild.

**Success criteria:**
- `[selection.v2]` shows `featuredCount` climbing to a substantial fraction of the pool.
- Two distinct moods (e.g. calm vs intense) and two HR bands (resting vs peak) yield playlists that differ by a meaningful margin (measured overlap well below 100%).
- Backend suite stays green; a new test pins that non-null features cause the scorer to reorder for different `translate()` targets.

## Workstream 2 — Live-Biometric vs Manual mode decoupling

**Goal:** exactly one generator is active at a time; the automatic biometric trigger never races a manual user.

**Frontend (`mobile/KokonadaHealth`):**
- A single **mode switch** — "Live Biometric" ↔ "Manual" — with one source of truth in the warm store (`liveMode: boolean`), placed **prominently on the Generate screen, near/above the manual mood buttons** (the primary friction point): the user gets immediate visual feedback that Live Mode is active, which contextualizes why the manual buttons are visually suppressed.
- **Manual (default):** only user input generates — mood chips + activity + text → **Generate**, plus the existing one-shot **Listen to your heart**. HR is still streamed/shown but does **not** fire generations.
- **Live Biometric (opt-in):** HR shifts drive auto-recalibration; the manual Generate CTA yields to a "live-tuned" state so both can't drive the queue.
- **Queue re-tune behavior (chosen):** on an auto-recalibration, **finish the current track, then swap the upcoming queue** to the new HR-tuned playlist (no hard interrupt) — matches the master's "queue re-tunes." `playbackOrchestrator.handlePlaylist` gains a "replace upcoming, keep current" path distinct from the immediate `heart`/manual replace.

**Backend (`sockets/biometricHandler.js`):**
- The `biometric_push` → auto-generation trigger becomes **mode-gated**: the client only drives auto-generation in Live mode (either the client suppresses `biometric_push`-triggered generation off-mode, or sends the mode and the handler gates on it). The server never auto-generates behind a manual user. Complements the already-shipped generation-timeout + epoch guards.
- Auto-recalibration emits with a trigger that the client maps to the "replace upcoming" path, not the immediate-replace path.

**Success criteria:**
- In Manual mode, HR changes never produce a playlist; only Generate / Listen-to-heart do.
- In Live mode, an HR band change re-tunes the upcoming queue after the current track, and the manual CTA reflects the live state.
- Mobile tests pin: mode gates the auto-trigger; the "replace upcoming" path preserves the current track.

## Testing strategy

- WS1: backend unit test — a pool with hydrated features reorders under two different `translate()` targets; diagnostic counters asserted. Full backend suite is the regression gate.
- WS2: mobile tests — `GenerateController`/orchestrator gate the auto-trigger by mode and honor the "replace upcoming" path; existing 382-test suite stays green.

## Rollout (authoritative)

- **Two separate PRs, WS1 first.** WS1 (backend feature hydration) ships and is verified independently — restoring biosonic variance is the critical path. WS1 → `main` via a throwaway worktree off `origin/main`. Only once the backend is confirmed generating dynamic playlists from real features do we start WS2 (mobile, on `feat/spotify-playback-turbomodule`).
