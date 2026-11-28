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
- task: `own:b2b3-dec-records` (own)
- title: Design v2 B2/B3 decision records: DEC-194 appended with owner items 108-131, DEC-201 and DEC-203 (forks ruled under DEC-142)
- branch: `docs/b2b3-dec-records`
- paths: `docs/design-v2/decisions/DEC-194.md`, `docs/design-v2/decisions/DEC-201.md`, `docs/design-v2/decisions/DEC-203.md`, `docs/design-v2/decisions/DEC-039.md`, `docs/design-v2/registry/CMP-018.md`, `docs/design-v2/DECISIONS.md`, `TASKS.md`
- resources: none
- state: claimed
- started: 2026-11-28

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
- task: `own:v2-foundations` (own)
- title: Design v2 foundations: tokens, fonts, typeface provider, copy port, hero components, Design Lab scenes
- branch: `feat/v2-foundations`
- paths: `TASKS.md`, `design-tokens/base.tokens.json`, `design-tokens/direction.abyss.tokens.json`, `mobile/KokonadaHealth/assets/fonts/Bellefair-Regular.ttf`, `mobile/KokonadaHealth/assets/fonts/Heebo-Light.ttf`, `mobile/KokonadaHealth/assets/fonts/Heebo-Medium.ttf`, `mobile/KokonadaHealth/assets/fonts/Heebo-Regular.ttf`, `mobile/KokonadaHealth/assets/fonts/Heebo-SemiBold.ttf`, `mobile/KokonadaHealth/assets/fonts/OFL-Bellefair.txt`, `mobile/KokonadaHealth/assets/fonts/OFL-Heebo.txt`, `mobile/KokonadaHealth/assets/fonts/README.md`, `mobile/KokonadaHealth/react-native.config.js`, `mobile/KokonadaHealth/scripts/field/bandEvidence.stamp.json`, `mobile/KokonadaHealth/scripts/lab/README.md`, `mobile/KokonadaHealth/scripts/lab/__tests__/bundleAndBuild.test.ts`, `mobile/KokonadaHealth/scripts/lab/__tests__/capture.test.ts`, `mobile/KokonadaHealth/scripts/lab/buildLabApk.mjs`, `mobile/KokonadaHealth/scripts/lab/bundleLab.mjs`, `mobile/KokonadaHealth/scripts/lab/capture.mjs`, `mobile/KokonadaHealth/scripts/lab/importGraph.mjs`, `mobile/KokonadaHealth/scripts/tokens/__tests__/__fixtures__/direction.fixture-inner.tokens.json`, `mobile/KokonadaHealth/scripts/tokens/__tests__/__fixtures__/direction.fixture-outer.tokens.json`, `mobile/KokonadaHealth/scripts/tokens/__tests__/freshness.test.ts`, `mobile/KokonadaHealth/scripts/tokens/__tests__/generate.test.ts`, `mobile/KokonadaHealth/scripts/tokens/__tests__/schema.test.ts`, `mobile/KokonadaHealth/scripts/tokens/__tests__/secretScanShape.test.ts`, `mobile/KokonadaHealth/scripts/tokens/generate.mjs`, `mobile/KokonadaHealth/scripts/tokens/lib/emit.mjs`, `mobile/KokonadaHealth/scripts/tokens/lib/schema.mjs`, `mobile/KokonadaHealth/src/__contracts__/__tests__/pinnedCallers.test.ts`, `mobile/KokonadaHealth/src/__contracts__/deadList.ts`, `mobile/KokonadaHealth/src/design/__tests__/fontLicence.test.ts`, `mobile/KokonadaHealth/src/design/__tests__/v2FaceSources.test.ts`, `mobile/KokonadaHealth/src/design/lab/FontProbes.tsx`, `mobile/KokonadaHealth/src/design/lab/LabRoot.tsx`, `mobile/KokonadaHealth/src/design/lab/__tests__/FontsScene.test.tsx`, `mobile/KokonadaHealth/src/design/lab/__tests__/HeroScene.test.tsx`, `mobile/KokonadaHealth/src/design/lab/__tests__/HeroSceneRtl.test.tsx`, `mobile/KokonadaHealth/src/design/lab/__tests__/LabRoot.test.tsx`, `mobile/KokonadaHealth/src/design/lab/__tests__/PartsScenes.test.tsx`, `mobile/KokonadaHealth/src/design/lab/__tests__/__fixtures__/drawnFaces.ts`, `mobile/KokonadaHealth/src/design/lab/__tests__/__fixtures__/skiaHeadless.ts`, `mobile/KokonadaHealth/src/design/lab/__tests__/__fixtures__/yogaRtl.ts`, `mobile/KokonadaHealth/src/design/lab/__tests__/capturePlans.test.ts`, `mobile/KokonadaHealth/src/design/lab/__tests__/fieldScenes.test.ts`, `mobile/KokonadaHealth/src/design/lab/__tests__/fonts.test.ts`, `mobile/KokonadaHealth/src/design/lab/__tests__/heroDriverMutants.test.tsx`, `mobile/KokonadaHealth/src/design/lab/__tests__/labExclusion.test.ts`, `mobile/KokonadaHealth/src/design/lab/__tests__/labFontGate.test.tsx`, `mobile/KokonadaHealth/src/design/lab/__tests__/labScenesRtl.test.tsx`, `mobile/KokonadaHealth/src/design/lab/__tests__/labTypefaceGate.test.tsx`, `mobile/KokonadaHealth/src/design/lab/__tests__/params.test.ts`, `mobile/KokonadaHealth/src/design/lab/__tests__/partsMutants.test.tsx`, `mobile/KokonadaHealth/src/design/lab/__tests__/sceneGroups.test.ts`, `mobile/KokonadaHealth/src/design/lab/__tests__/scenes.test.tsx`, `mobile/KokonadaHealth/src/design/lab/__tests__/yogaRtlModel.test.tsx`, `mobile/KokonadaHealth/src/design/lab/fieldScenes.ts`, `mobile/KokonadaHealth/src/design/lab/fonts.ts`, `mobile/KokonadaHealth/src/design/lab/params.ts`, `mobile/KokonadaHealth/src/design/lab/parts/partsIds.ts`, `mobile/KokonadaHealth/src/design/lab/parts/sampleLegalDoc.ts`, `mobile/KokonadaHealth/src/design/lab/sceneGroups/fonts.ts`, `mobile/KokonadaHealth/src/design/lab/sceneGroups/hero.ts`, `mobile/KokonadaHealth/src/design/lab/sceneGroups/parts.ts`, `mobile/KokonadaHealth/src/design/lab/scenes.ts`, `mobile/KokonadaHealth/src/design/lab/scenes/FieldScene.tsx`, `mobile/KokonadaHealth/src/design/lab/scenes/FontsScene.tsx`, `mobile/KokonadaHealth/src/design/lab/scenes/HeroScene.tsx`, `mobile/KokonadaHealth/src/design/lab/scenes/NoticeScene.tsx`, `mobile/KokonadaHealth/src/design/lab/scenes/ReaderScene.tsx`, `mobile/KokonadaHealth/src/design/lab/scenes/WellHintScene.tsx`, `mobile/KokonadaHealth/src/design/v2/__tests__/isolation.test.ts`, `mobile/KokonadaHealth/src/design/v2/components/**`, `mobile/KokonadaHealth/src/design/v2/components/InlineNotice/InlineNotice.tsx`, `mobile/KokonadaHealth/src/design/v2/components/InlineNotice/__tests__/InlineNotice.test.tsx`, `mobile/KokonadaHealth/src/design/v2/components/InlineNotice/__tests__/actionLayout.test.ts`, `mobile/KokonadaHealth/src/design/v2/components/InlineNotice/__tests__/inlineNoticeClosure.test.ts`, `mobile/KokonadaHealth/src/design/v2/components/InlineNotice/actionLayout.ts`, `mobile/KokonadaHealth/src/design/v2/components/InlineNotice/index.ts`, `mobile/KokonadaHealth/src/design/v2/components/LegalReader/LegalReader.tsx`, `mobile/KokonadaHealth/src/design/v2/components/LegalReader/__tests__/LegalReader.test.tsx`, `mobile/KokonadaHealth/src/design/v2/components/LegalReader/__tests__/legalDocument.test.ts`, `mobile/KokonadaHealth/src/design/v2/components/LegalReader/__tests__/legalReaderClosure.test.ts`, `mobile/KokonadaHealth/src/design/v2/components/LegalReader/index.ts`, `mobile/KokonadaHealth/src/design/v2/components/LegalReader/legalDocument.ts`, `mobile/KokonadaHealth/src/design/v2/components/LegalReader/readerSpace.ts`, `mobile/KokonadaHealth/src/design/v2/components/Well/Well.tsx`, `mobile/KokonadaHealth/src/design/v2/components/Well/__tests__/Well.test.tsx`, `mobile/KokonadaHealth/src/design/v2/components/__tests__/__fixtures__/importClosure.ts`, `mobile/KokonadaHealth/src/design/v2/copy/**`, `mobile/KokonadaHealth/src/design/v2/field/FieldSurface.tsx`, `mobile/KokonadaHealth/src/design/v2/field/FieldView.tsx`, `mobile/KokonadaHealth/src/design/v2/field/__tests__/FieldView.test.tsx`, `mobile/KokonadaHealth/src/design/v2/field/__tests__/fieldLaw.test.ts`, `mobile/KokonadaHealth/src/design/v2/field/__tests__/placementLedger.test.ts`, `mobile/KokonadaHealth/src/design/v2/field/crossfade.ts`, `mobile/KokonadaHealth/src/design/v2/field/fieldLaw.ts`, `mobile/KokonadaHealth/src/design/v2/field/placementLedger.ts`, `mobile/KokonadaHealth/src/design/v2/tokens/__tests__/extensionsBoundary.test.ts`, `mobile/KokonadaHealth/src/design/v2/tokens/__tests__/neverRed.beadTwin.test.ts`, `mobile/KokonadaHealth/src/design/v2/tokens/__tests__/neverRed.full.abyss.sweeps.test.ts`, `mobile/KokonadaHealth/src/design/v2/tokens/__tests__/tokens.rules.test.ts`, `mobile/KokonadaHealth/src/design/v2/tokens/neverRedSweeps.ts`, `mobile/KokonadaHealth/src/design/v2/tokens/tokens.extensions.generated.ts`, `mobile/KokonadaHealth/src/design/v2/tokens/tokens.generated.ts`, `mobile/KokonadaHealth/src/design/v2/tokens/tokens.statics.generated.ts`, `mobile/KokonadaHealth/src/design/v2/typeface/**`, `mobile/KokonadaHealth/src/design/v2FaceSources.ts`
- resources: none
- state: claimed
- started: 2026-11-28

### M09
- task: `own:gen-targets-log-trim` (own)
- title: The [gen.targets] log keeps only tempoBand and counts: no emotion tap, valence, energy, bpm or confidence in the server log (C-P4-0, RA-91 S0)
- branch: `fix/gen-targets-log-trim`
- paths: `backend/app/sockets/biometricHandler.js`, `backend/tests/genTargetsLog.test.js`, `backend/tests/wave4.liveLogZeroKnowledge.test.js`, `TASKS.md`
- resources: none
- state: claimed
- started: 2026-11-28

### M10
- task: `own:v2-tokens-fix` (own)
- title: Design v2 tokens fix (PR-TOK): a color.<face>.selection token for InlineNotice and LegalReader (UI-336, D316-1), one CTA radius (UI-337), aliased 48 dp repeats (UI-338), token-sourced proportions (UI-340), CommitCTA takes a script prop (UI-341)
- branch: `feat/v2-tokens-fix`
- paths: `design-tokens/base.tokens.json`, `design-tokens/direction.abyss.tokens.json`, `mobile/KokonadaHealth/src/design/v2/components/InlineNotice/**`, `mobile/KokonadaHealth/src/design/v2/components/LegalReader/**`, `mobile/KokonadaHealth/src/design/v2/components/CommitCTA/**`, `mobile/KokonadaHealth/src/design/lab/scenes/WellHintScene.tsx`, `mobile/KokonadaHealth/src/design/v2/tokens/tokens.generated.ts`, `mobile/KokonadaHealth/src/design/v2/tokens/tokens.extensions.generated.ts`, `mobile/KokonadaHealth/src/design/v2/tokens/tokens.statics.generated.ts`, `mobile/KokonadaHealth/src/design/v2/tokens/__tests__/tokens.rules.test.ts`, `mobile/KokonadaHealth/src/design/lab/scenes/HeroScene.tsx`, `mobile/KokonadaHealth/src/design/lab/__tests__/HeroScene.test.tsx`, `mobile/KokonadaHealth/src/design/v2/__tests__/__fixtures__/fixtureTokens.ts`, `TASKS.md`, `mobile/KokonadaHealth/scripts/tokens/__tests__/__fixtures__/direction.fixture-outer.tokens.json`, `mobile/KokonadaHealth/scripts/tokens/__tests__/__fixtures__/direction.fixture-inner.tokens.json`, `mobile/KokonadaHealth/scripts/field/bandEvidence.stamp.json`
- resources: none
- state: claimed
- started: 2026-11-28

### M11
- task: `own:stop-google-picture` (own)
- title: The backend stops storing Google's profile picture URL (avatarUrl) at sign-in, per the owner's ruling of 2026-11-24 (B1 regulatory Q6)
- branch: `fix/stop-google-picture`
- paths: `backend/app/controllers/authController.js`, `backend/tests/auth.controller.test.js`, `backend/app/models/User.js`, `TASKS.md`
- resources: none
- state: claimed
- started: 2026-11-24

### M12
- task: `own:v2-teardown-contract` (own)
- title: Design v2 B1 G7 teardown contract C9 (PR-TD; C-B2-T and C-P9-4 follow on the same files)
- branch: `feat/v2-teardown-contract`
- paths: `mobile/KokonadaHealth/src/experience/profile/sessionTeardown.ts`, `mobile/KokonadaHealth/src/experience/profile/profileServices.ts`, `mobile/KokonadaHealth/src/experience/profile/__tests__/sessionTeardown.test.ts`, `mobile/KokonadaHealth/src/__contracts__/deadList.ts`, `mobile/KokonadaHealth/src/__contracts__/__tests__/pinnedCallers.test.ts`, `mobile/KokonadaHealth/src/__tests__/shadow.authMigration.test.ts`, `mobile/KokonadaHealth/src/experience/profile/__tests__/profileController.test.ts`, `backend/tests/ciWorkflowPermissions.test.js`, `mobile/KokonadaHealth/src/health/liveHrSwitch.ts`, `mobile/KokonadaHealth/src/prodBootstrap.ts`, `mobile/KokonadaHealth/src/__tests__/shadow.c9Composition.test.ts`, `mobile/KokonadaHealth/src/__tests__/shadow.c9Teardown.test.ts`, `mobile/KokonadaHealth/src/experience/connect/connectStore.ts`, `TASKS.md`
- resources: none
- state: claimed
- started: 2026-11-28

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
