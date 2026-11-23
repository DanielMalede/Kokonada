# Work ledger

Two people change this repository in parallel: Daniel Malede, the owner, and Daniel Bedrack. Before either of them touches a file, he claims it here, so neither overwrites the other's work.

**The copy on `main` is history.** A claim is written on its own task branch and reaches `main` only when that PR merges. For the live picture run `node scripts/coord/coord.js status`, which reads this file as it stands on every branch on `origin`.

## Rules

1. Start every task with `node scripts/coord/coord.js start`. Malede runs it through the `coordinator` agent or `/claim`; Bedrack runs it through `$coordinate`. It checks the other partner's live work, claims a slot, marks the TASKS row and opens a draft PR.
2. Never push to `main`: a merge to `main` deploys the backend to production. Merge only your own PRs, one at a time, after CI is green on the head commit.
3. Edit only your own section, only on your own task branch, and only through the script.
4. A claim is live while its branch exists on `origin` and its slot has not landed on `main`. To drop a task, close its PR and delete its branch.
5. A collision stops whoever runs the check: the same file, a file inside a claimed folder, an exclusive file or a file it is coupled to, the same resource, the same TASKS row, or a recent branch of the other partner that carries no claim (or whose author maps to nobody here). Between two claims the earlier one holds. The two partners decide what happens next — wait, split the work, or agree in writing. The script never decides.
6. Elsewhere in this repository, "Daniel" means Daniel Malede, the owner. `DAN-` rows and the owner-only paths below are his alone.
7. New TASKS IDs: Malede takes them from the "Next free IDs" header of `TASKS.md`; Bedrack takes them only from his own block below.

## People

| login | name | role | section | git author | TASKS ids |
|---|---|---|---|---|---|
| `DanielMalede` | Malede | owner | `M` | `Full Stack Developer`, `Daniel <danielmalede@gmail.com>` | the "Next free IDs" header |
| `DanielBedrack` | Bedrack | partner | `B` | `DanielBedrack` | `900` to `999` in every prefix |

## Exclusive files

Only one live claim may hold a row at a time. Claiming any path in a row claims the whole row.

| path | also claims |
|---|---|
| `.github/workflows/**` | `backend/tests/ciWorkflowPermissions.test.js`, `backend/tests/secretScanGates.test.js`, `backend/tests/nodeRuntimePin.test.js` |
| `backend/Dockerfile` | `backend/tests/nodeRuntimePin.test.js` |
| `backend/package.json`, `backend/package-lock.json` | |
| `mobile/KokonadaHealth/package.json`, `mobile/KokonadaHealth/package-lock.json` | |
| `mobile/KokonadaHealth/src/navigation/**` | |
| `mobile/KokonadaHealth/src/design/tokens.ts` | `mobile/KokonadaHealth/src/design/__tests__/tokens.test.ts` |
| `backend/app/index.js` | |
| `backend/app/models/User.js` | |
| `backend/app/sockets/biometricHandler.js` | `backend/tests/biometricHandler.pipeline.test.js`, `backend/tests/biometricHandler.contextUri.test.js` |
| `backend/app/controllers/integrationsController.js` | `backend/tests/integrationsController.test.js`, `backend/tests/integrations.test.js` |
| `docs/PRIVACY_DECLARATIONS.md` | `backend/tests/sessionHealthDeclarations.test.js`, `backend/tests/wave4.retentionDocs.test.js`, `backend/tests/youtubeDeclarations.test.js`, `backend/tests/garminDisconnectErasure.integration.test.js`, `backend/tests/userJobPurge.guards.test.js`, `backend/tests/geminiEngine.cacheKey.test.js`, `mobile/KokonadaHealth/scripts/lab/__tests__/uploadGate.test.ts` |
| `CLAUDE.md` | |
| `AGENTS.md` | |
| `.claude/settings.json` | |

## Shared files

Both partners may edit these at the same time; each edits only his own rows or his own section.

`TASKS.md` · `WORK_LEDGER.md` · `docs/SCREENS.md` · `docs/design-v2/DECISIONS.md`

## Owner-only paths

Only Malede changes these.

`.claude/**` · `docs/design-v2/pages/**` · `docs/plans/WAVE4_STATE.md`

On 2026-10-08 the owner opened `.claude/agents/merge-guard.md`, `.claude/commands/merge.md` and `.claude/commands/review-pr.md` to Bedrack for the rows `OPS-178` and `OPS-182`–`OPS-186`, in his own words ("ולגביי OPS-178, OPS-182 עד 186 תן לבדרק לעשות אותם"). Bedrack stopped working on the repository on 2026-10-17: `OPS-187` closed as no longer needed, those rows are the owner's again, and the two-partner machinery stays dormant (`DEC-185`). The list above still says `.claude/**`.

## Resources

Things that are not files. Claim one in a slot's `resources:` line, and it collides like a file.

`res:atlas-prod` · `res:railway-vars` · `res:store-android` · `res:store-ios` · `res:secrets` · `res:prod-deploy`

Hold `res:prod-deploy` while production must not change (a recount, a migration, an incident): claim it on the branch doing that work; while anyone holds it, `check --merge` refuses every merge to `main`, since a merge deploys.

## Malede

### M01
- task: `own:garmin-rulings-records` (own)
- title: Record the owner's 2026-10-28/29 rulings: DEC-047 and DEC-048 DECIDED, TASKS update lines, a DAN row for OAuth domains, #281 review findings
- branch: `docs/garmin-rulings-records`
- paths: `TASKS.md`, `docs/design-v2/decisions/DEC-047.md`, `docs/design-v2/decisions/DEC-048.md`, `docs/design-v2/DECISIONS.md`
- resources: none
- state: claimed
- started: 2026-11-01

### M02
- task: `own:scribe-2026-10-06` (own)
- title: docs: scribe 2026-10-06: DEC-156 (the privacy page waits for the armed sweep), the post-J2 counsel annex and the session's TASKS rows
- branch: `docs/scribe2-2026-10-06`
- paths: `TASKS.md`, `docs/design-v2/DECISIONS.md`, `docs/design-v2/decisions/DEC-156.md`, `docs/design-v2/counsel/gating-five-2026-10-04.md`, `docs/design-v2/counsel/post-j2-privacy-questions-2026-10-06.md`, `docs/plans/HALT_HEALTH_CONNECT_PLAY_BLOCKERS.md`
- resources: none
- state: claimed
- started: 2026-10-06

### M03
- task: `own:ra1-heart-discovery-cache` (own)
- title: BE-231 RA-1: a per-user discovery cache disc:bio:<userId>, refreshed only by user-driven events; the heart branch reads it only and sends no Spotify discovery request
- branch: `fix/ra1-heart-discovery-cache`
- paths: `backend/app/sockets/biometricHandler.js`, `backend/app/services/discovery/discoveryCache.js`, `backend/app/utils/userRedisPurge.js`, `backend/app/services/privacy/spotifyErasure.js`, `backend/tests/discoveryCache.test.js`, `backend/tests/discoveryHealthEgress.test.js`, `backend/tests/discoveryHealthEgress.structural.test.js`, `backend/tests/biometricHandler.pipeline.test.js`, `backend/tests/heartConsentGate.integration.test.js`, `backend/tests/userRedisPurge.test.js`, `backend/tests/spotifyDisconnectErasure.integration.test.js`, `backend/tests/sessionHealthDeclarations.test.js`, `backend/tests/consentWithdrawalSessionHealth.integration.test.js`, `backend/tests/shadow.generationFaultReply.test.js`, `backend/tests/youtubeEgressSeam.integration.test.js`, `docs/PRIVACY_DECLARATIONS.md`, `TASKS.md`, `backend/tests/shadow.discoveryRefreshStorm.test.js`
- resources: none
- state: claimed
- started: 2026-11-22

### M04
- task: `BE-245` (TASKS)
- title: PR-A: the DEC-047 Garmin music fence (closed by default): quarantine at ingest and a VitalSample read filter
- branch: `fix/be245-garmin-fence`
- paths: `backend/app/services/wearable/garminMusicFence.js`, `backend/app/services/wearable/garminIngest.js`, `backend/app/services/wearable/metricStore.js`, `backend/app/services/biosonic/baselines.js`, `backend/app/workers/dailyAnalysis.worker.js`, `backend/tests/garminMusicFence.unit.test.js`, `backend/tests/garminMusicFence.integration.test.js`, `backend/tests/garminMusicFence.structural.test.js`, `backend/tests/art9GateClass.structural.test.js`, `backend/tests/garminConsentVersionGate.test.js`, `backend/tests/garminFutureCap.integration.test.js`, `backend/tests/garminIngest.test.js`, `backend/tests/garminIngestConsentGate.integration.test.js`, `backend/tests/garminLocationExclusion.test.js`, `backend/tests/garminRetentionFilter.integration.test.js`, `backend/tests/garminVitalSample.integration.test.js`, `backend/tests/garminWebhook.integration.test.js`, `backend/tests/healthStoreConsentVersionGate.test.js`, `backend/tests/integrations.test.js`, `backend/tests/integrationsConsentGate.test.js`, `backend/tests/shadow.garminHrvIdentity.integration.test.js`, `backend/tests/shadow.garminHrvNightIdentity.integration.test.js`, `backend/tests/shadow.garminWebhookSeam.integration.test.js`, `backend/tests/metricStore.test.js`, `backend/tests/baselines.test.js`, `backend/tests/dailyAnalysis.worker.test.js`, `backend/tests/coldBaselineParity.integration.test.js`, `docs/adr/0018-garmin-music-fence.md`, `docs/adr/README.md`, `TASKS.md`, `backend/app/controllers/integrationsController.js`
- resources: none
- state: claimed
- started: 2026-11-22

### M05
- task: `OPS-230` (TASKS)
- title: remove DAN-053 from Next up (the owner's words); record #277's post-merge findings on OPS-230, OPS-345 and OPS-288
- branch: `docs/ops230-nextup-dan053`
- paths: `TASKS.md`
- resources: none
- state: in-review · PR #282
- started: 2026-10-28

### M06
- task: `own:dan015-page-round` (own)
- title: docs: DEC-190 records the owner's round-6 legal-basis rulings and the page round's findings as TASKS rows (own:dan015-page-round)
- branch: `docs/dan015-page-round`
- paths: `TASKS.md`, `docs/design-v2/decisions/DEC-190.md`, `docs/design-v2/DECISIONS.md`
- resources: none
- state: in-review · PR #300
- started: 2026-11-22

### M07
- task: `OPS-066` (TASKS)
- title: Stage 0 Q2: scoped tsc and the full-project type ratchet (QA-043), the recorded test counts (QA-042), the QA-115 action-props scanner
- branch: `test/s0-q2-tsc`
- paths: `mobile/KokonadaHealth/scripts/tsc/**`, `mobile/KokonadaHealth/scripts/baselines/**`, `mobile/KokonadaHealth/src/testing/guards/tsProgram.ts`, `mobile/KokonadaHealth/src/testing/__tests__/tsProgram.test.ts`, `docs/design-v2/registry/QA-042.md`, `docs/design-v2/registry/QA-043.md`, `docs/design-v2/registry/QA-115.md`, `TASKS.md`
- resources: none
- state: claimed
- started: 2026-11-17

### M08
- task: `own:ops389-accepted-neutral` (own)
- title: merge-guard step 3f: an owner-accepted external neutral check passes on his quoted words, the check and the head SHA (OPS-389)
- branch: `fix/ops389-accepted-neutral`
- paths: `.claude/agents/merge-guard.md`, `.claude/hooks/merge-guard-trigger.test.mjs`, `backend/tests/mergeGuardHook.test.js`, `TASKS.md`
- resources: none
- state: claimed
- started: 2026-11-23

### M09
- task: `own:ops417-qa116-pinned-callers` (own)
- title: Stage 0 Q1b: the pinned-caller check (QA-116) and its dead list (OPS-417)
- branch: `test/s0-q1b-callers`
- paths: `mobile/KokonadaHealth/src/testing/guards/pinnedCallers.ts`, `mobile/KokonadaHealth/src/testing/__tests__/pinnedCallers.test.ts`, `mobile/KokonadaHealth/src/__contracts__/deadList.ts`, `mobile/KokonadaHealth/src/__contracts__/__tests__/pinnedCallers.test.ts`, `docs/design-v2/registry/QA-116.md`, `TASKS.md`
- resources: none
- state: claimed
- started: 2026-11-18

### M10
_free_

### M11
_free_

### M12
_free_

## Bedrack

### B01
- task: `own:coord-ci-pr-metadata` (own)
- title: Use GitHub PR state in coordination CI
- branch: `codex/coord-ci-pr-metadata`
- paths: `scripts/coord/coord.js`, `scripts/coord/lib/gh.js`, `scripts/coord/lib/render.js`, `scripts/coord/lib/collide.js`, `backend/tests/coord.e2e.test.js`, `backend/tests/coord.collide.test.js`, `.github/workflows/coordination.yml`, `backend/tests/ciWorkflowPermissions.test.js`, `TASKS.md`
- resources: none
- state: in-review · PR #239
- started: 2026-10-08

### B02
_free_

### B03
_free_

### B04
_free_

### B05
_free_

### B06
_free_
