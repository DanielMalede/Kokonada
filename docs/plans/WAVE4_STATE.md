# WAVE4_STATE — machine-updated run state

> The SINGLE resume source for the Wave-4 run. Every session reads this first and updates it before exiting.
> Rules: update via small, surgical edits; never delete history sections; keep the task table authoritative.

## Run header

- phase: execute           <!-- review | execute | closeout | halted -->
- branch: feat/intelligence-wave   <!-- created from origin/main (== local main, in sync) in session 1 -->
- lastMainSha: 1a1657ea4bae1f48a6de4e2dd29b3f2a14d02010
- testBaseline: (unset — record in W4-000 exec session AFTER the worker.test.js real-connection-leak fix per §0.4 S1a; landscape: 162 test files at backend/tests top level)
- missionVersion: 2026-08-18 (as approved by Daniel; amended by W4-000 review deltas, same date)
- runStartedAt: 2026-08-18T22:56 local (session 1)
- day4CutoffAt: 2026-08-22T22:56 local (runStartedAt + 96h; after this, only W4-015 may run)

## Task table

| id | title | tier | size | deps | status | owner-session | notes |
|----|-------|------|------|------|--------|---------------|-------|
| W4-000 | Bootstrap, review pass, ADR-0012 | MUST | S | — | in_progress | 1 | review pass DONE (deltas below); remaining: S1 preflight, worker.test.js leak fix + green baseline, ADR-0012 + tripwire test |
| W4-001 | Surgical bug backlog (D3,D4,D5,D7,D8,D9,D11i,D14,D17,W8/W9) | MUST | M | 000 | pending | — | |
| W4-002 | Synthetic-human simulator + replay | MUST | L | 000 | pending | — | |
| W4-003 | A0 signal integrity + live persistence | MUST | L | 001,002 | pending | — | |
| W4-004 | A1+A2 baselines & chronobiology v2 | MUST | L | 003 | pending | — | superset blob = HRV fix |
| W4-005 | A3 affect engine core (axes+HMM) | MUST | L | 004 | pending | — | |
| W4-006 | A4 taxonomy + A5 regulator + seam | MUST | L | 005 | pending | — | reachability = hard DoD |
| W4-007 | B2 scoring & similarity rebuild | MUST | L | 001 | pending | — | eligible early if bio track stalls |
| W4-008 | B4 trajectory planner | MUST | L | 007 | pending | — | |
| W4-009 | A7 live analysis + state-triggered recalibration | SHOULD | M | 006 | pending | — | |
| W4-010 | B1 taste profile v2 | SHOULD | M | 001 | pending | — | |
| W4-011 | B6 feedback loop + RewardEvent | SHOULD | L | 003,006 | pending | — | mbid:-only guard |
| W4-012 | A6 daily analysis + MorningState | SHOULD | M | 004 | pending | — | |
| W4-013 | B5+B7 bandit + PersonalWeights | STRETCH | M | 011 | pending | — | ships dark |
| W4-014 | B3 embedding v2 dual-write | STRETCH | L | 007,W16 | pending | — | cutover HITL-blocked |
| W4-015 | Soak, closeout & package | MUST | M | any | pending | — | ALWAYS runs last |

## Review deltas (filled by W4-000)

Session 1 (2026-08-18, plan tier) — full-repo validation of the mission. All six flagged unknowns resolved; spot-checked defect refs D1–D5, D7–D9, D11, D13–D15 verified byte-accurate against source.

- (a) **W16 / embedding.worker.js:** stored vectors ALREADY genre-free (`buildVector(doc, [])`, PR #139 dilution fix; only `mbid:` keys reach the index). D19 is latent in `buildVector`, not live in the index → W4-014 spec amended in the mission (genre block = deliberate re-introduction; corpus ~98% genre-less → IDF must handle df≈0; `docs/plans/mbid-representation-recalibration-vs-genre-seam.md` (tracked draft, 2026-07-15, measured prod evidence) is required reading).
- (b) **discoveryFetch.js:** adapter confirmed — `extractTargetFeatures(aiParams)` → `{bpm, energy, valence, acousticness, danceability}`; `biasToBand` re-centers the query on `{bpmCenter, energyFloor/Ceiling, valenceTarget, acousticnessBias}`; `DISCOVERY_FEATURE_ONLY_TARGET` default ON; dormant genre-Jaccard scoring seam behind `DISCOVERY_GENRE_RELEVANCE`.
- (c) **audioFeatureRepo.js:** upsert precedence api > acousticbrainz > llm (filter excludes higher sources + swallowed E11000; measured sources write through to Redis, llm invalidates) — W4-007's source-tier confidences (1.0/0.85/0.7) align with the real enum.
- (d) **queues/definitions.js:** frozen QUEUES map + QUEUE_NAMES set — feature-hydration, embedding-build, state-vector-recompute, biometric-buffer, reclassify-unclassified, global-seed-ingest, session-trim, youtube-retention. New W4 queues extend this map.
- (e) **watchHrIngest:** Art.9 consent hard gate confirmed inline (fail-fast, before body validation, same consent service). Route validates HR 30–230 — a THIRD range; W4-001 D9 fix amended in the mission to align it with the shared 30–220 predicate. Delivers immediate-mode to every socket in the user's room.
- (f) **biometric-mock.js:** socket-lane driver, payload `socket.emit('biometric_push', { source: 'garmin', raw })`, fixed-constant scenarios; `mock-biometrics.js` is a near-duplicate. W4-002 spec amended: reuse the payload shape, don't extend the scripts.
- **Seam paths pinned:** `app/services/selection/biosonicBand.js` (withinBand at :33), `app/services/generation/targetsBuilder.js`, `app/services/features/featureProvider.js`, selection dir = {biosonicBand, candidatePool, hardFilters, mmr, pipeline, score}.
- **Repo hygiene:** `.claude/settings.json` `includeCoAuthoredBy: false` ✓; `.gitignore` had NO `logs/` entry (ccusage JSON + session logs were unignored) → `logs/` added this session; `docker-compose.yml` present at repo root (S1a cheap green-baseline path viable); `worker.test.js` structure matches S1a exactly (success-path tests at lines 31/63/120 set `REDIS_URL='redis://example:6379'`).
- **CI ground truth re-confirmed via gh:** push CI on main green; scheduled "Secret scan (full history)" failing weekly since ≥2026-07-27 (~10–13s runs — pre-existing, unrelated) → HITL H1.
- **S2 dirty-tree decisions (session 1):** `backend/package-lock.json` — optional-peer-dep churn (gcp-metadata removal, bare `npm install` artifact) → restored to HEAD (stash-and-drop equivalent). `mobile/src/health/config.ts` — Daniel's intentional local deployment config (public client IDs over tracked placeholders) → LEFT IN PLACE uncommitted; mobile out of scope; do not commit, do not drop.

## HITL queue (for Daniel — numbered tutorials, decisions, portal actions)

- **H1 — DISCOVERED (not in roadmap): scheduled Secret-scan workflow failing on main.** The weekly "Secret scan (full history)" GitHub Action has failed every scheduled run since at least 2026-07-27 (runs last ~10–13s → likely a setup/config error, not a found secret; push CI is green). Steps: (1) GitHub → Actions → "Secret scan (full history)" → open the latest failed run; (2) read the failing step's log — if it's a tooling/setup error (e.g. action version, token perms), fix the workflow file; (3) if it actually reports a secret hit, treat as an incident. Nothing in Wave-4 is blocked on this; the wave was instructed not to chase it.

## PR queue

| PR | cluster(s) | url | status |
|----|-----------|-----|--------|
| — | — | — | — |

## Error budget

- consecutiveFailedSessions: 0
- perTaskFailures: (none)

## Session log (append one line per session)

| # | started | result line (`WAVE4_SESSION_RESULT: ...`) |
|---|---------|--------------------------------------------|
| 1 | 2026-08-18 22:56 | WAVE4_SESSION_RESULT: W4-000 in_progress review pass complete — 6 unknowns resolved, mission amended, phase→execute |
