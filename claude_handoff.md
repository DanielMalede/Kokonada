# Kokonada — Session Handoff (2026-07-06)

Everything below is committed unless noted. Safe to `/clear` and resume from this.

## ✅ Shipped & merged (prod)
- #70 energy-primary band, #71 hydration 429-backoff, #72 texture gates + rhythmic rotation + playlist weight, #73 Spotify playlist-read scopes, #74 OAuth deep-link back to app, #75 geminiEngine 429-backoff (fixed the `tracks=10` generation collapse). **Running/Workout confirmed SOLID by Daniel.**

## 🔄 Hydration (background, unattended)
- New account `userId=6a4b992f0e82ab8ed85e8d9a`. Was 2276 featureless; **pass 2 running** (50-min budget, TPM-paced on Groq free 6000 TPM).
- Driver: `kokonada-wt-ws1/backend/_hydrateDriver.js`. Re-fire until it prints `missing=0`:
  `HYDRATE_BUDGET_S=3000 railway run -p 1dea751f-6230-491f-9229-29fa158d61df -e production -s kokonada-backend -- node C:/Users/danie/Videos/kokonada-wt-ws1/backend/_hydrateDriver.js`
- Delete `_hydrateDriver.js` + `_rebuildDriver.js` (temp, gitignored-by-convention) when done.

## ✅ Part 2a — Neural-Analysis Loader (DONE, committed on `feat/spotify-playback-turbomodule`, NOT pushed)
- Design LOCKED via preview: **Genesis** — bigger translucent glass pearl, **living 3D reticulated neural net** (nodes pulse on own phase), undulating harmonic bloom, `active` springs intensity (soft overshoot), `engagement` heats **cyan→coral→red**.
- Files: `mobile/KokonadaHealth/src/experience/generate/` → `neuralLoaderMath.ts` (14 tests, pure+worklet-safe, NaN-clamped), `NeuralAnalysisLoader.tsx` (Skia+Reanimated), `generationStatusStore.ts` (3 tests, begin/settle + 30s auto-settle), Generate-screen wiring; `jest.setup.js` mocks extended. **401 mobile tests green.**
- To SEE it: **Metro reload (press `r`)** — pure JS + existing Skia, no `gradlew` rebuild. On-device visual tuning may follow (values map 1:1 from preview).

## 🔨 Part 3 — Biometric Buffer (in progress, branch `feat/biometric-buffer` off main, NOT pushed)
- **Done + committed (1078 backend tests green):**
  - `queues/definitions.js` → `BIOMETRIC_BUFFER='biometric-buffer'`
  - `repositories/shadowBufferRepo.js` (setBuffer/getBuffer, key `buffer:{userId}:{bioMoodKey}`, TTL `SHADOW_BUFFER_TTL_S=1800`, 6 tests)
  - `workers/biometricBuffer.worker.js` (+ registered in `workers/index.js`) — reuses `generateV2`, stores buffer, **records NO serves** (3 tests). Kept as infra for future predictive warming.
  - **Warm-on-transition (inline)** in `sockets/biometricHandler.js` after the `[generate] done` log: an HR-driven gen (`!useEmotion && isPhysiologicalHR`) caches its `clientTracks` under `moodKey` (the `bio:*` key) via `shadowBufferRepo.setBuffer` — **zero extra Groq cost** (reuses the playlist, NOT the worker, to protect the free-tier TPM). Fire-and-forget, no serves recorded.
- **Remaining — folds into Part 2b (needs the client Live toggle):**
  - **Read buffer on toggle**: `getBuffer(userId, currentBioMoodKey)` → play instantly; cold → one-time live gen + loader "assembling your live biometric soundscape".
  - **Serve-on-play**: `serveLedger.recordServes` ONLY when a buffer is actually played (§3.5) — currently the live gen path records serves on emit; the buffer *store* does not.
- `generateV2({ userId, musicProfile, moodKey, provider, aiParams, discoveryTracks, live:{heartRate,activity}, k, now, crossPlatform }) → { familiar, discovery, merged, telemetry, targets }` (`services/generation/orchestrator.js:54`).
- Spec: `docs/superpowers/specs/2026-07-06-unified-pool-dualpath-shadowbuffer-design.md` §3.

## 🔨 Part 2b — mobile dual-path (in progress on `feat/spotify-playback-turbomodule`)
- **Done + committed:** `src/experience/generate/liveModeStore.ts` — persisted (KVBackend port) `liveMode` store, default Manual; `createLiveModeStore(kv?)` (5 tests) + prod singleton + `bindLiveModeKV(kv)`. This RESOLVES the "liveMode has no home" fork (warmStore ephemeral / emotionSlice sealed).
- **Done + committed (406 mobile tests green):**
  1. ✅ **Bootstrap bind** — `prodBootstrap.ts` calls `bindLiveModeKV({getString,set})` (adapting SecureStore's `getItem`/`setItem`) after `createSecureStore()`, so the preference persists.
  2. ✅ **Live/Manual switch** on `GenerateScreen` (above ActivityChips), reads/sets `liveModeStore`, `accessibilityLabel="live-mode-toggle"`.
- **Remaining — the ONE last piece (needs a fresh session; touches socket/server):**
  - **Slice 4 — Band recalibration serving the buffer:** in Live mode, on a confirmed band change, serve the Part-3 buffer instead of a fresh gen: a socket handler reads `shadowBufferRepo.getBuffer(userId, currentBioMoodKey)` → play instantly; **cold** → one-time live gen + show the loader with "assembling your live biometric soundscape"; **record serves ONLY on play** (`serveLedger.recordServes`, §3.5). Also gate the Generate CTA to a "live-tuned" state when `liveMode` (so manual + live can't both drive the queue). Server-side: mode-gate `biometricHandler` auto-gen on `liveMode` (client sends mode, or a per-socket flag). This is the only unfinished item in the whole plan.
- No client auto-generation exists today (manual is the only trigger) — Live mode's band-recalibration is net-new. Reorder (2a→3→2b) was approved.

## Environment / gotchas
- Backend worktree: `C:\Users\danie\Videos\kokonada-wt-ws1` (branch off `origin/main`). Mobile: `C:\Users\danie\Videos\AI-Music-App` on `feat/spotify-playback-turbomodule`.
- Run mobile jest from `mobile/KokonadaHealth` (`cd` first — cwd resets to repo root where root jest fails with "import outside a module").
- Groq free **6000 TPM** is the ceiling (Daniel staying free); `withRetry` 429-backoff in `llmClient` + `geminiEngine` handles it.
- Commit style: **short single-line, no body/trailers**.
- Railway: project `1dea751f-6230-491f-9229-29fa158d61df`, service `kokonada-backend`, env `production`. CLI authed.
- To push/PR when ready: `feat/biometric-buffer` (Part 3) and the loader commits on `feat/spotify-playback-turbomodule`.
