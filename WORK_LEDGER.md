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
- task: `DAN-015` (TASKS)
- title: Re-anchor docs/PRIVACY_DECLARATIONS.md on main (D-1, D-2, BE-122 retry line, Groq row, site and mailbox recipients) and its pin tests; no publication
- branch: `docs/dan015-privacy-prep`
- paths: `TASKS.md`, `docs/PRIVACY_DECLARATIONS.md`, `backend/tests/sessionHealthDeclarations.test.js`, `backend/tests/youtubeDeclarations.test.js`, `backend/tests/wave4.retentionDocs.test.js`, `docs/store/play-health-connect-declaration.md`
- resources: none
- state: in-review · PR #287
- started: 2026-11-17

### M04
- task: `own:ops067-close` (own)
- title: close OPS-067 after #235 merged (988bab3, post-merge GREEN): the row to the archive with its evidence, release slot M04, and a row for merge-guard's finding that slot M03 on main still shows BE-229 although #281 merged
- branch: `docs/ops067-close`
- paths: `TASKS.md`, `WORK_LEDGER.md`
- resources: none
- state: claimed
- started: 2026-11-17

### M05
- task: `OPS-230` (TASKS)
- title: remove DAN-053 from Next up (the owner's words); record #277's post-merge findings on OPS-230, OPS-345 and OPS-288
- branch: `docs/ops230-nextup-dan053`
- paths: `TASKS.md`
- resources: none
- state: in-review · PR #282
- started: 2026-10-28

### M06
- task: `DAN-131` (TASKS)
- title: Never store a user's free-text note without current health consent: used for the choice, not kept in PlaylistSession, socket state, shadow, log or Sentry (owner ruling 2026-10-28)
- branch: `fix/dan131-note-consent`
- paths: `TASKS.md`, `backend/app/sockets/biometricHandler.js`, `backend/app/services/privacy/healthConsentGate.js`, `backend/app/models/PlaylistSession.js`, `backend/app/workers/sessionTrim.worker.js`, `backend/tests/biometricHandler.pipeline.test.js`, `backend/tests/biometricHandler.contextUri.test.js`, `backend/tests/emotionUpdatePayloadDoor.integration.test.js`, `backend/tests/socket.payloadDoor.test.js`, `backend/tests/consentWithdrawalLiveState.integration.test.js`, `backend/tests/sessionTrim.worker.test.js`, `backend/tests/healthConsentGate.test.js`, `backend/tests/noteConsentStorage.integration.test.js`
- resources: none
- state: claimed
- started: 2026-11-17

### M07
- task: `OPS-066` (TASKS)
- title: Stage 0 Q2: scoped tsc and the full-project type ratchet (QA-043), the recorded test counts (QA-042), the QA-115 action-props scanner
- branch: `test/s0-q2-tsc`
- paths: `mobile/KokonadaHealth/scripts/tsc/**`, `mobile/KokonadaHealth/scripts/baselines/**`, `mobile/KokonadaHealth/src/testing/guards/tsProgram.ts`, `mobile/KokonadaHealth/src/testing/__tests__/tsProgram.test.ts`, `docs/design-v2/registry/QA-042.md`, `docs/design-v2/registry/QA-043.md`, `docs/design-v2/registry/QA-115.md`, `TASKS.md`
- resources: none
- state: claimed
- started: 2026-11-17

### M08
- task: `OPS-065` (TASKS)
- title: Stage 0 Q1a: the contract manifest (QA-040), the interim test floor (QA-041) and the RETIRE pins (QA-118)
- branch: `test/s0-q1-contracts`
- paths: `mobile/KokonadaHealth/src/__contracts__/**`, `mobile/KokonadaHealth/src/testing/guards/contracts.ts`, `mobile/KokonadaHealth/src/testing/guards/retire.ts`, `mobile/KokonadaHealth/src/testing/guards/testFloor.ts`, `mobile/KokonadaHealth/src/testing/__tests__/contracts.test.ts`, `mobile/KokonadaHealth/src/testing/__tests__/retire.test.ts`, `mobile/KokonadaHealth/src/testing/__tests__/testFloor.test.ts`, `docs/design-v2/registry/QA-040.md`, `docs/design-v2/registry/QA-041.md`, `docs/design-v2/registry/QA-118.md`, `docs/design-v2/registry/INDEX.md`, `TASKS.md`
- resources: none
- state: claimed
- started: 2026-11-17

### M09
- task: `own:ops303-release-custody` (own)
- title: the release build no longer reads keystore.properties and yields an unsigned APK with no debug fallback; a reviewed signing script the owner runs as kokonada-signer (OPS-303)
- branch: `fix/ops303-release-custody`
- paths: `mobile/KokonadaHealth/android/app/build.gradle`, `mobile/KokonadaHealth/scripts/release/sign-release.ps1`, `mobile/KokonadaHealth/src/__tests__/releaseSigning.test.ts`, `TASKS.md`
- resources: none
- state: in-review · PR #271
- started: 2026-10-21

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
