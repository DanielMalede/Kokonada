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

## Resources

Things that are not files. Claim one in a slot's `resources:` line, and it collides like a file.

`res:atlas-prod` · `res:railway-vars` · `res:store-android` · `res:store-ios` · `res:secrets` · `res:prod-deploy`

Hold `res:prod-deploy` while production must not change (a recount, a migration, an incident): claim it on the branch doing that work; while anyone holds it, `check --merge` refuses every merge to `main`, since a merge deploys.

## Malede

### M01
- task: `own:coord-paperwork` (own)
- title: close the coordinator rows on #229's evidence and record its last audit findings
- branch: `docs/coord-paperwork`
- paths: `TASKS.md`
- resources: none
- state: in-review · PR #236
- started: 2026-10-07

### M02
- task: `own:scribe-2026-10-06` (own)
- title: docs: scribe 2026-10-06: DEC-156 (the privacy page waits for the armed sweep), the post-J2 counsel annex and the session's TASKS rows
- branch: `docs/scribe2-2026-10-06`
- paths: `TASKS.md`, `docs/design-v2/DECISIONS.md`, `docs/design-v2/decisions/DEC-156.md`, `docs/design-v2/counsel/gating-five-2026-10-04.md`, `docs/design-v2/counsel/post-j2-privacy-questions-2026-10-06.md`, `docs/plans/HALT_HEALTH_CONNECT_PLAY_BLOCKERS.md`
- resources: none
- state: claimed
- started: 2026-10-06

### M03
- task: `own:handoff-bedrack` (own)
- title: Handoff to Bedrack: where the instruction layer stands and how to continue
- branch: `docs/handoff-bedrack`
- paths: `HANDOFF_2026-10-08_BEDRACK.md`
- resources: none
- state: in-review · PR #243
- started: 2026-10-08

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
