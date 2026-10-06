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

| login | name | section | git author | TASKS ids |
|---|---|---|---|---|
| `DanielMalede` | Malede | `M` | `Full Stack Developer`, `Daniel <danielmalede@gmail.com>` | the "Next free IDs" header |
| `DanielBedrack` | Bedrack | `B` | `DanielBedrack` | `900` to `999` in every prefix |

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

## Resources

Things that are not files. Claim one in a slot's `resources:` line, and it collides like a file.

`res:atlas-prod` · `res:railway-vars` · `res:store-android` · `res:store-ios` · `res:secrets`

## Malede

### M01
- task: `OPS-152` (TASKS)
- title: The work ledger and the coordinator for two partners working in parallel
- branch: `chore/work-ledger`
- paths: `WORK_LEDGER.md`, `scripts/coord/**`, `backend/tests/coord.*.test.js`, `.githooks/pre-push`, `.agents/skills/coordinate/**`, `.claude/agents/coordinator.md`, `.claude/agents/sentinel.md`, `.claude/commands/claim.md`, `.claude/commands/ship.md`, `.claude/commands/merge.md`, `CLAUDE.md`, `docs/ORCHESTRATOR_FABLE.md`, `.gitignore`, `TASKS.md`
- resources: none
- state: in-review · PR #228
- started: 2026-10-06

### M02
_free_

### M03
_free_

### M04
_free_

### M05
_free_

### M06
_free_

### M07
_free_

### M08
_free_

### M09
_free_

### M10
_free_

### M11
_free_

### M12
_free_

## Bedrack

### B01
- task: `own:healthkit-authoritative-store` (own)
- title: HealthKit authoritative sample store foundation
- branch: `feat/mb900-healthkit-store`
- paths: `backend/app/models/MedicalProfile.js`, `backend/app/services/wearable/healthSampleReconciliation.js`, `backend/tests/healthSampleReconciliation.integration.test.js`, `backend/tests/sleepSemantics.test.js`, `backend/tests/stateVectorJob.test.js`, `backend/tests/userJobPurge.guards.test.js`, `backend/app/queues/definitions.js`, `backend/app/queues/queue.js`, `backend/app/workers/healthSampleReconciliation.worker.js`, `backend/app/workers/index.js`, `backend/app/index.js`, `backend/tests/healthSampleReconciliation.worker.test.js`, `backend/tests/queues.test.js`, `backend/app/services/wearable/healthBatchContract.js`, `backend/app/services/wearable/healthStoreV2.js`, `backend/app/controllers/integrationsController.js`, `backend/tests/healthBatchContract.test.js`, `backend/tests/integrations.test.js`, `backend/tests/wave4.ingestLogZeroKnowledge.test.js`, `backend/tests/healthStoreV2.integration.test.js`
- resources: none
- state: claimed
- started: 2026-10-06

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
