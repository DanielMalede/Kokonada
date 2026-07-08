# WS1 — Feature-Hydration Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get real measured/estimated audio features flowing into `score.js` for the candidate pool, so different moods and HR states produce measurably different playlists (fixes "same playlist every time").

**Architecture:** The biosonic loop (`translate()` → targets → `featureDistance` scoring) is already built and correct. The break is that `AudioFeature` is unpopulated for the pool, so `_featureFit` collapses to a constant 0.5. This plan makes the gap **observable** in prod (Task 1), gives an **on-demand force-hydration** path that bypasses the async queue to populate the store and report exactly what each provider returns (Task 2), and **pins** that a fed pool differentiates (Task 3). No scorer/`translate()` redesign — strictly the master architecture (§1.2/§3.2).

**Tech Stack:** Node/Express, MongoDB (Mongoose), Redis/BullMQ, Jest 29. ReccoBeats measured API (verified reachable) + Groq LLM fallback for YouTube-only tracks.

## Global Constraints

- Backend tests run via Bash: `cd /c/Users/danie/Videos/AI-Music-App/backend && npx jest <file> 2>&1 | grep -aE "Test Suites:|Tests:|✕"`. The full suite is the regression gate.
- Ship to `main` via a throwaway worktree off `origin/main`; single-line commit messages, no body/trailers. PR body ends with the Claude Code footer. Daniel approves each merge.
- Never add a `railway up` CI job. Feature values must pass `clampFeatures` before persistence (already enforced in adapters).
- `recordingKeyOf`: Spotify → `spotify:<id>`, YouTube → `youtube:<videoId>`. The pool reads and hydration writes the SAME key — do not diverge.
- Do NOT store LLM estimates for tracks whose ReccoBeats batch merely failed (outage-poisoning rule already in `featureService`). Confidence for LLM ≤ 0.7.

---

### Task 1: Serve-path feature telemetry (make the gap observable)

Surface, on every generation, how many pool tracks actually resolved features — the single number that tells us whether hydration is the problem.

**Files:**
- Modify: `backend/app/services/selection/pipeline.js` (telemetry object in `selectPlaylist`)
- Modify: `backend/app/sockets/biometricHandler.js` (the always-on `[selection.v2]` log line)
- Test: `backend/tests/selectionPipeline.test.js`

**Interfaces:**
- Produces: `telemetry.featured` (number of pool tracks with non-null `features`) added to the object `selectPlaylist` already returns.

- [ ] **Step 1: Write the failing test** — add to `selectionPipeline.test.js`:

```javascript
it('reports how many pool tracks resolved features in telemetry', async () => {
  featureRepo.getMany.mockResolvedValue(new Map([
    ['spotify:t0', { bpm: 120, energy: 0.6, valence: 0.5 }],
  ]));
  const { telemetry } = await selectPlaylist(BASE);
  expect(telemetry.featured).toBe(1); // exactly one library track (t0) got features
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd /c/Users/danie/Videos/AI-Music-App/backend && npx jest tests/selectionPipeline.test.js -t "resolved features" 2>&1 | grep -aE "Tests:|✕"`
Expected: FAIL — `telemetry.featured` is `undefined`.

- [ ] **Step 3: Implement** — in `pipeline.js`, after the pool feature-attach loop (`for (const track of pool) { … track.features = … }`), compute the count, and add it to the returned `telemetry`:

```javascript
const featured = pool.reduce((n, t) => n + (t.features ? 1 : 0), 0);
// … in the telemetry object returned at the end of selectPlaylist:
telemetry: { poolSize: pool.length, afterFilters: filtered.length, relaxLevel, degraded, featured, stageMs },
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd /c/Users/danie/Videos/AI-Music-App/backend && npx jest tests/selectionPipeline.test.js -t "resolved features" 2>&1 | grep -aE "Tests:|✕"`
Expected: PASS.

- [ ] **Step 5: Thread it into the always-on log** — in `biometricHandler.js`, extend the `[selection.v2]` `console.warn` to include `featured`:

```javascript
console.warn(`[selection.v2] pool=${playlist.telemetry.poolSize} featured=${playlist.telemetry.featured} filtered=${playlist.telemetry.afterFilters} relax=${playlist.telemetry.relaxLevel} ms=${playlist.telemetry.stageMs?.total} reqId=${reqId}`);
```

- [ ] **Step 6: Run the full selection + handler suites**

Run: `cd /c/Users/danie/Videos/AI-Music-App/backend && npx jest tests/selectionPipeline.test.js tests/biometricHandler.pipeline.test.js 2>&1 | grep -aE "Test Suites:|Tests:"`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/selection/pipeline.js backend/app/sockets/biometricHandler.js backend/tests/selectionPipeline.test.js
git commit -m "feat: report pool feature coverage in selection telemetry + [selection.v2] log"
```

---

### Task 2: On-demand force-hydration route (populate + diagnose in one call)

A synchronous, authed endpoint that hydrates the caller's whole library right now (bypassing the possibly-idle queue) and returns the provider breakdown — so we both **fix** the empty store and **see** exactly what ReccoBeats vs the LLM returned.

**Files:**
- Modify: `backend/app/controllers/integrationsController.js` (add `hydrateLibrary`)
- Modify: `backend/app/routes/integrations.js` (wire the route — match the existing authed route pattern in this file)
- Test: `backend/tests/integrations.test.js` (or the existing integrations controller test)

**Interfaces:**
- Consumes: `featureService.hydrate(tracks)` → returns `{ requested, targeted, hydrated, api, llm, upgraded, failed }` (existing signature).
- Produces: `POST /integrations/hydrate-library` → `200 { summary }`.

- [ ] **Step 1: Write the failing test** — mock `MusicProfile.findOne` to return a 2-track library and `featureService.hydrate` to return a summary; assert the controller passes the library through and returns the summary:

```javascript
it('hydrateLibrary hydrates the user library and returns the provider summary', async () => {
  const library = [{ id: 'y1', provider: 'youtube_music' }, { id: 'y2', provider: 'youtube_music' }];
  MusicProfile.findOne.mockReturnValue({ lean: () => Promise.resolve({ library }) });
  featureService.hydrate.mockResolvedValue({ requested: 2, api: 0, llm: 2, failed: 0 });
  const req = { user: { _id: 'u1' } }; const res = mockRes();
  await integrationsController.hydrateLibrary(req, res);
  expect(featureService.hydrate).toHaveBeenCalledWith(library);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ summary: expect.objectContaining({ llm: 2 }) }));
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd /c/Users/danie/Videos/AI-Music-App/backend && npx jest tests/integrations.test.js -t "hydrateLibrary" 2>&1 | grep -aE "Tests:|✕"`
Expected: FAIL — `hydrateLibrary` is not a function.

- [ ] **Step 3: Implement the controller** — in `integrationsController.js`:

```javascript
// Force-hydrate the caller's library synchronously (bypasses the async queue) and
// return the provider breakdown — a diagnose-and-fix for an empty AudioFeature store.
async function hydrateLibrary(req, res) {
  const userId = req.user._id;
  const profile = await MusicProfile.findOne({ userId }).lean();
  const library = profile?.library ?? [];
  if (!library.length) return res.status(200).json({ summary: { requested: 0 }, note: 'empty library' });
  const summary = await featureService.hydrate(library);
  console.warn(`[hydrateLibrary] user=${userId} ${JSON.stringify(summary)}`);
  return res.status(200).json({ summary });
}
```
Ensure `MusicProfile` and `featureService` are required at the top of the controller, and add `hydrateLibrary` to `module.exports`.

- [ ] **Step 4: Wire the route** — in `routes/integrations.js`, following the file's existing authed route pattern:

```javascript
router.post('/hydrate-library', requireAuth, integrationsController.hydrateLibrary);
```
(Use whatever auth middleware the neighbouring routes in this file use — match it exactly.)

- [ ] **Step 5: Run test, verify it passes**

Run: `cd /c/Users/danie/Videos/AI-Music-App/backend && npx jest tests/integrations.test.js -t "hydrateLibrary" 2>&1 | grep -aE "Tests:|✕"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/controllers/integrationsController.js backend/app/routes/integrations.js backend/tests/integrations.test.js
git commit -m "feat: POST /integrations/hydrate-library — synchronous library hydration + provider summary"
```

---

### Task 3: Pin that a fed pool differentiates by mood/HR

Prove the biosonic loop reorders once features exist — so we know populating the store is sufficient, and we never regress it.

**Files:**
- Test: `backend/tests/selectionPipeline.test.js`

- [ ] **Step 1: Write the test** — give the pool distinct features and select under two different `targets`; assert the top track differs:

```javascript
it('a feature-fed pool reorders for different biosonic targets (mood/HR differentiation)', async () => {
  // Two library tracks with clearly different tempo/energy.
  const profile = { library: [
    lib('slow', { affinity: 5 }), lib('fast', { affinity: 5 }),
  ], lastAnalyzed: new Date('2026-07-01') };
  featureRepo.getMany.mockResolvedValue(new Map([
    ['spotify:slow', { bpm: 70,  energy: 0.2, valence: 0.5 }],
    ['spotify:fast', { bpm: 170, energy: 0.9, valence: 0.5 }],
  ]));
  const calm  = await selectPlaylist({ ...BASE, musicProfile: profile, k: 1, targets: { bpmCenter: 70,  bpmWidth: 15, energyFloor: 0.1, energyCeiling: 0.3, valenceTarget: 0.5, confidence: 1 } });
  const peak  = await selectPlaylist({ ...BASE, musicProfile: profile, k: 1, targets: { bpmCenter: 170, bpmWidth: 15, energyFloor: 0.7, energyCeiling: 0.95, valenceTarget: 0.5, confidence: 1 } });
  expect(calm.tracks[0].id).toBe('slow');
  expect(peak.tracks[0].id).toBe('fast');
});
```

- [ ] **Step 2: Run it**

Run: `cd /c/Users/danie/Videos/AI-Music-App/backend && npx jest tests/selectionPipeline.test.js -t "reorders for different biosonic" 2>&1 | grep -aE "Tests:|✕"`
Expected: PASS (the loop already differentiates when fed). If it FAILS, the scorer weighting needs tuning (`SCORE_W_FEATURE` vs `SCORE_W_TASTE`) — surface that as a follow-up before proceeding.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/selectionPipeline.test.js
git commit -m "test: pin biosonic pool differentiation once features are present"
```

---

### Task 4: Full-suite regression + PR

- [ ] **Step 1: Run the full backend suite**

Run: `cd /c/Users/danie/Videos/AI-Music-App/backend && npx jest 2>&1 | grep -aE "Test Suites:|Tests:|FAIL "`
Expected: all pass except the known wall-clock flakes (`shadow.flip`/`shadow.selection`, green in isolation).

- [ ] **Step 2: Push + open PR to `main`**, wait for Daniel's merge approval, verify CI + `/health` after.

---

### Ops verification (Daniel runs after deploy — informs whether more code is needed)

- [ ] Deploy, then `POST /integrations/hydrate-library` for Daniel's account (from the app or curl with the session JWT). Read the returned `summary`:
  - `llm > 0`, `failed` low → the estimator works; the store now has features; **regenerate and confirm different moods give different playlists** (and `[selection.v2] featured=…` climbs).
  - `llm = 0` / `failed` high → Groq (`LLM_API_KEY`) is the gap — fix the env/config, not the code.
- [ ] Confirm `REDIS_URL` is set on Railway and the in-process workers are consuming `feature-hydration` (so hydration keeps up automatically, not just on the manual endpoint).
- [ ] Create the Atlas Vector Search index (spec in `models/TrackEmbedding.js`) so embedding-based MMR diversity stops degrading to its fallback (compounds variety).

## Self-Review

- **Spec coverage:** WS1 Phase-1 diagnosis → Task 1 (telemetry) + Task 2 (force-hydrate summary) + Ops. WS1 Phase-2 fix → Task 2 populates; ops handles env gaps. Success criteria (featured climbs; moods differ) → Task 3 + ops regenerate. ✓
- **Placeholders:** none — every step has concrete code/commands. Route-wiring says "match the neighbouring authed route" because the exact middleware name is file-local; the implementer reads one line above.
- **Type consistency:** `telemetry.featured` (number) defined in Task 1, read in the Task-1 log; `featureService.hydrate` summary shape (`{requested,api,llm,failed,…}`) matches the existing function.
