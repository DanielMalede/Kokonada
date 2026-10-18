---
status: living
verified: 2026-10-18
---

# Archive — the movement ledger of the markdown files

Every markdown file this repository has moved, merged or deleted since 2026-10-18 has one row here, so that any reference written before the change still resolves. Nothing is restored from this file; it says where a thing went and how to read it again.

- **Moved**: the old path and the new one (for a merge, the new path carries the `#anchor` of the section that holds the old file verbatim). Update the reference to the new path.
- **Deleted**: the path, what it was, and the last commit on `main` that held it when the row was written. Read it with `git show <sha>:<path>`. A file an earlier PR of the same stack had already edited (reference rewrites) may differ from that commit by those lines; its last state is in that PR's squash commit.
- **Missing before this reorg**: paths that were referenced but did not exist when the ledger was opened, with what is known about them.

Rules: a file that moves or dies gets its row in the same commit; every live reference to it is rewritten in that commit (frozen records are not edited and resolve through this file: `docs/design-v2/decisions/**`, `docs/design-v2/registry/**` except `INDEX.md`'s Related-files line and a single citation line of an entry, which the PR that moves their target edits, `docs/plans/WAVE4_STATE.md`, `docs/plans/WAVE4_ARCHIVE.md`, `WEAKNESSES_AND_FAILURES.md`; the root `README.md` carries that list). `backend/tests/docsMap.test.js` enforces both. This file is machine-read: keep the three tables, their column order and the `## ` headings exactly.

## Moved

| old path | new path | date | PR |
|---|---|---|---|
| `docs/plans/HALT_CONSENT_VERSION_RETENTION_AND_DECLARATIONS.md` | `docs/plans/halts.md#consent-version-retention-and-declarations` | 2026-10-18 | PR 1 of the md reorganisation (OPS-278) |
| `docs/plans/DEV_CONSENT_FIELD_EXPOSURE.md` | `docs/plans/halts.md#consent-field-exposure` | 2026-10-18 | PR 1 of the md reorganisation (OPS-278) |
| `docs/plans/HALT_GARMIN_BRAND_AND_ATTRIBUTION.md` | `docs/plans/halts.md#garmin-brand-and-attribution` | 2026-10-18 | PR 1 of the md reorganisation (OPS-278) |
| `docs/plans/DEV_GARMIN_DEREGISTRATION_ON_DELETE.md` | `docs/plans/halts.md#garmin-deregistration-on-delete` | 2026-10-18 | PR 1 of the md reorganisation (OPS-278) |
| `docs/plans/HALT_HEALTH_CONNECT_PLAY_BLOCKERS.md` | `docs/plans/halts.md#health-connect-play-blockers` | 2026-10-18 | PR 1 of the md reorganisation (OPS-278) |
| `docs/plans/HALT_SIGN_IN_WITH_APPLE_ENTITLEMENT.md` | `docs/plans/halts.md#sign-in-with-apple-entitlement` | 2026-10-18 | PR 1 of the md reorganisation (OPS-278) |
| `docs/plans/HALT_SPOTIFY_TRACK_IDS_TO_THIRD_PARTY.md` | `docs/plans/halts.md#spotify-track-ids-to-third-party` | 2026-10-18 | PR 1 of the md reorganisation (OPS-278) |
| `docs/plans/HALT_YOUTUBE_ATTRIBUTION_AND_REVOCATION.md` | `docs/plans/halts.md#youtube-attribution-and-revocation` | 2026-10-18 | PR 1 of the md reorganisation (OPS-278) |
| `docs/COLD_JEST_TIMEOUT_TASK.md` | `docs/plans/dev-items.md#cold-jest-timeout` | 2026-10-18 | PR 1 of the md reorganisation (OPS-278) |
| `docs/plans/DEV_COLOUR_SINGLE_SOURCE.md` | `docs/plans/dev-items.md#colour-single-source` | 2026-10-18 | PR 1 of the md reorganisation (OPS-278) |
| `docs/plans/DEV_EMAIL_SIGNIN_PATH.md` | `docs/plans/dev-items.md#email-signin-path` | 2026-10-18 | PR 1 of the md reorganisation (OPS-278) |
| `docs/plans/DEV_HISTORY_STATE_COLOUR.md` | `docs/plans/dev-items.md#history-state-colour` | 2026-10-18 | PR 1 of the md reorganisation (OPS-278) |
| `docs/plans/DEV_PLAYBACK_SEEK_AND_POSITION.md` | `docs/plans/dev-items.md#playback-seek-and-position` | 2026-10-18 | PR 1 of the md reorganisation (OPS-278) |
| `docs/plans/DEV_SIGNIN_BRAND_ASSETS.md` | `docs/plans/dev-items.md#signin-brand-assets` | 2026-10-18 | PR 1 of the md reorganisation (OPS-278) |
| `docs/plans/DEV_SPOTIFY_CANVAS_ASSETS.md` | `docs/plans/dev-items.md#spotify-canvas-assets` | 2026-10-18 | PR 1 of the md reorganisation (OPS-278) |
| `docs/superpowers/specs/2026-10-06-healthkit-data-contract-design.md` | `docs/plans/healthkit/design.md#data-contract` | 2026-10-18 | PR 1 of the md reorganisation (OPS-278) |
| `docs/superpowers/specs/2026-10-06-healthkit-authoritative-sample-store-design.md` | `docs/plans/healthkit/design.md#authoritative-sample-store` | 2026-10-18 | PR 1 of the md reorganisation (OPS-278) |
| `docs/superpowers/plans/2026-10-06-healthkit-contract-foundation.md` | `docs/plans/healthkit/plan.md#contract-foundation` | 2026-10-18 | PR 1 of the md reorganisation (OPS-278) |
| `docs/superpowers/plans/2026-10-06-healthkit-authoritative-sample-store.md` | `docs/plans/healthkit/plan.md#authoritative-sample-store` | 2026-10-18 | PR 1 of the md reorganisation (OPS-278) |
| `docs/research/apple-healthkit-integration-research.md` | `docs/plans/healthkit/research.md` | 2026-10-18 | PR 1 of the md reorganisation (OPS-278) |
| `docs/design-v2/counsel/eu-questions-for-counsel-2026-09-29.md` | `docs/design-v2/counsel/questions-annex.md#eu` | 2026-10-18 | PR 2 of the md reorganisation (OPS-278) |
| `docs/design-v2/counsel/hx-questions-for-counsel-2026-09-30.md` | `docs/design-v2/counsel/questions-annex.md#hx` | 2026-10-18 | PR 2 of the md reorganisation (OPS-278) |
| `docs/design-v2/counsel/j1-questions-for-counsel-2026-10-02.md` | `docs/design-v2/counsel/questions-annex.md#j1` | 2026-10-18 | PR 2 of the md reorganisation (OPS-278) |
| `docs/design-v2/counsel/post-j2-privacy-questions-2026-10-06.md` | `docs/design-v2/counsel/questions-annex.md#pj2` | 2026-10-18 | PR 2 of the md reorganisation (OPS-278) |
| `docs/design-v2/research/2026-09-23/r_regulatory.md` | `docs/design-v2/counsel/research-regulatory-2026-09-23.md` | 2026-10-18 | PR 2 of the md reorganisation (OPS-278) |
| `docs/design-v2/research/2026-09-23/track-h/brief_regulatory.md` | `docs/design-v2/counsel/brief-regulatory-2026-09-23.md` | 2026-10-18 | PR 2 of the md reorganisation (OPS-278) |
| `docs/design-v2/registry/state-label-review.md` | `docs/design-v2/counsel/state-label-review.md` | 2026-10-18 | PR 2 of the md reorganisation (OPS-278) |
| `docs/plans/LEGAL_AI_ACT_EMOTION_RECOGNITION.md` | `docs/design-v2/counsel/legal-ai-act-emotion-recognition.md` | 2026-10-18 | PR 2 of the md reorganisation (OPS-278) |
| `backend/docs/garmin-health-api-application.md` | `docs/store/garmin-health-api-application.md` | 2026-10-18 | PR 2 of the md reorganisation (OPS-278) |
| `KOKONADA_ARCHITECTURE_MASTER.md` | `docs/architecture/architecture-master.md` | 2026-10-18 | PR 3 of the md reorganisation (OPS-278) |
| `docs/GROUND_TRUTH_2026-09-02.md` | `docs/architecture/architecture-master.md#ground-truth-2026-09-02` | 2026-10-18 | PR 3 of the md reorganisation (OPS-278) |
| `docs/RUNTIME_AGENT_ARCHITECTURE.md` | `docs/architecture/runtime-agent-architecture.md` | 2026-10-18 | PR 3 of the md reorganisation (OPS-278) |
| `docs/plans/mbid-representation-recalibration-vs-genre-seam.md` | `docs/architecture/mbid-representation-recalibration-vs-genre-seam.md` | 2026-10-18 | PR 3 of the md reorganisation (OPS-278) |
| `docs/SCREENS.md` | `docs/design-v1/screens.md` | 2026-10-18 | PR 3 of the md reorganisation (OPS-278) |
| `docs/UI_UX_OVERHAUL_SPEC.md` | `docs/design-v1/ui-ux-overhaul-spec.md` | 2026-10-18 | PR 3 of the md reorganisation (OPS-278) |
| `docs/ORCHESTRATOR_FABLE.md` | `docs/orchestrator-fable.md` | 2026-10-18 | PR 3 of the md reorganisation (OPS-278) |
| `docs/VISION.md` | `docs/vision.md` | 2026-10-18 | PR 3 of the md reorganisation (OPS-278) |
| `docs/PRIVACY_DECLARATIONS.md` | `docs/privacy-declarations.md` | 2026-10-18 | PR 3 of the md reorganisation (OPS-278) |
| `docs/plans/DESIGN_V2_PLAN.md` | `docs/plans/design-v2-plan.md` | 2026-10-18 | PR 3 of the md reorganisation (OPS-278) |

## Deleted

| path | what it was | era | last commit holding it | PR |
|---|---|---|---|---|
| `OAUTH_AUTH_TROUBLESHOOTING.md` | Web-app login failure report (Vercel and Facebook OAuth) | 2026-06-22 | `7dfbb6232ad1f664a63fa9f24e3854f115112394` | PR 1 of the md reorganisation (OPS-278) |
| `UI_UX_MASTER_PLAN.md` | UI plan of the deleted React web app (shadcn, Tailwind) | 2026-06 | `0b10c99961319704472780a54f1bfd468ab13801` | PR 1 of the md reorganisation (OPS-278) |
| `docs/HANDOFF_2026-09-23.md` | Handoff from a design session: branch cleanup and TASKS drift | 2026-09-23 | `c45b2bd7e0f17f5a92ecd5eb2547902a8d509a56` | PR 1 of the md reorganisation (OPS-278) |
| `docs/DEPLOYMENT_OAUTH_CONFIG.md` | Railway, Vercel and provider-console OAuth values of the web era (Vercel deleted, DAN-002) | 2026-06 | `14d8fc5a6d7ba4aa96660f8089c6be50afac31a8` | PR 1 of the md reorganisation (OPS-278) |
| `docs/GROUND_TRUTH_2026-07-07.md` | Measured-facts brief, phase 1; succeeded by GROUND_TRUTH_2026-09-02 | 2026-07-07 | `90bfc5e1b92d021606c34753d62a5f37dbd7b5df` | PR 1 of the md reorganisation (OPS-278) |
| `docs/WEB_SUNSET_D5_GAP_SCAN_2026-07-08.md` | Pre-deletion gap scan of frontend/ (ADR-0002) | 2026-07-08 | `ddd9ac2c2aa12102ea6135273dd13beb0d216aee` | PR 1 of the md reorganisation (OPS-278) |
| `docs/exporting-to-apk.md` | PWABuilder APK route for the deleted frontend/ | 2026-06 | `7df71fb5f6b13a4ad7cc5d7f667186e69f410141` | PR 1 of the md reorganisation (OPS-278) |
| `docs/plans/CANVAS_SCALE_AUDIT.md` | Audit of the v1 canvas token scales; retired with the canvas (design-v2 step S8) | 2026-08 | `c45b2bd7e0f17f5a92ecd5eb2547902a8d509a56` | PR 1 of the md reorganisation (OPS-278) |
| `docs/plans/DECISION_TWO_LOBE_FIELD.md` | Open v1 decision: two-lobe field vs the shipped aurora; moot under design-v2 | 2026-08-27 | `c45b2bd7e0f17f5a92ecd5eb2547902a8d509a56` | PR 1 of the md reorganisation (OPS-278) |
| `docs/plans/DEV_AMBIENT_FIELD_SCOPE_AND_DEGRADATION.md` | v1 canvas dev item (Flow screen ambient field); moot under design-v2 | 2026-08-26 | `7ee4400b89c0ec47ef1e97c8876e133ae9fadbcf` | PR 1 of the md reorganisation (OPS-278) |
| `docs/plans/DEV_MOTION_SETTLE_TOKEN.md` | v1 canvas dev item (motion.duration.settle token); moot under design-v2 | 2026-08-26 | `7ee4400b89c0ec47ef1e97c8876e133ae9fadbcf` | PR 1 of the md reorganisation (OPS-278) |
| `docs/plans/DEV_PROFILE_CONTROLS.md` | v1 canvas dev item (two Profile controls); moot under design-v2 | 2026-08-26 | `7ee4400b89c0ec47ef1e97c8876e133ae9fadbcf` | PR 1 of the md reorganisation (OPS-278) |
| `docs/plans/WAVE4_REPORT.md` | Wave-4 closeout report (narrative; its evidence stays in WAVE4_STATE.md and WAVE4_ARCHIVE.md) | 2026-09-02 | `7ee4400b89c0ec47ef1e97c8876e133ae9fadbcf` | PR 1 of the md reorganisation (OPS-278) |
| `docs/plans/WAVE4_SOAK_2026-09-02.md` | Raw Wave-4 soak output | 2026-09-02 | `7ee4400b89c0ec47ef1e97c8876e133ae9fadbcf` | PR 1 of the md reorganisation (OPS-278) |
| `docs/plans/WAVE4_INTELLIGENCE_MISSION.md` | Wave-4 directive, approved 2026-08-18; the loop closed 2026-09-02 | 2026-08-18 | `0e19ad8990639b275d70ac3caf91e43f9bbeb899` | PR 1 of the md reorganisation (OPS-278) |
| `docs/plans/WAVE4_KICKOFF.md` | How to start the Wave-4 four-day loop (Hebrew) | 2026-08-18 | `44fd95104d863902137e32124268ef11e6a60321` | PR 1 of the md reorganisation (OPS-278) |
| `docs/plans/WAVE4_TASK_W4-016.md` | Spec of one Wave-4 task | 2026-08-19 | `44fd95104d863902137e32124268ef11e6a60321` | PR 1 of the md reorganisation (OPS-278) |
| `docs/qa/2026-07-07-squad6-on-device-checklist.md` | Squad-6 on-device checklist and re-pass | 2026-07-07 | `b4ec071653a63d2869620c0c96fdbb41652c418c` | PR 1 of the md reorganisation (OPS-278) |
| `docs/audits/2026-07-16-fullstack-compliance/synthesis.md` | Security and compliance remediation plan of the July audit (findings.json stays until its own J14 row) | 2026-07-16 | `b264b0e4500f3cddb30986c749f9aea15c6f3901` | PR 1 of the md reorganisation (OPS-278) |
| `docs/superpowers/plans/2026-06-19-completion.md` | Implementation plan: completion (deleted React web app); the feature shipped in July 2026 | 2026-06-19 | `0d9eaf3551e261e9c5443cb6fafdd94d75691f31` | PR 1 of the md reorganisation (OPS-278) |
| `docs/superpowers/plans/2026-06-19-websocket-biometric-loop.md` | Implementation plan: websocket biometric loop; the feature shipped in July 2026 | 2026-06-19 | `d887a75bca720e00b62701f15f15ee4fa36be247` | PR 1 of the md reorganisation (OPS-278) |
| `docs/superpowers/plans/2026-06-21-biometric-mock-and-garmin-poller.md` | Implementation plan: biometric mock and garmin poller; the feature shipped in July 2026 | 2026-06-21 | `b8c6579cbfa328e539552b64a1d5e920c6d4217a` | PR 1 of the md reorganisation (OPS-278) |
| `docs/superpowers/plans/2026-06-21-spotify-web-playback-sdk.md` | Implementation plan: spotify web playback sdk (deleted React web app); the feature shipped in July 2026 | 2026-06-21 | `b8c6579cbfa328e539552b64a1d5e920c6d4217a` | PR 1 of the md reorganisation (OPS-278) |
| `docs/superpowers/plans/2026-06-24-watch-hr-ingest-backend-foundation.md` | Implementation plan: watch hr ingest backend foundation; the feature shipped in July 2026 | 2026-06-24 | `b8c6579cbfa328e539552b64a1d5e920c6d4217a` | PR 1 of the md reorganisation (OPS-278) |
| `docs/superpowers/plans/2026-07-04-frontend-tooling-foundation.md` | Implementation plan: frontend tooling foundation; the feature shipped in July 2026 | 2026-07-04 | `90bfc5e1b92d021606c34753d62a5f37dbd7b5df` | PR 1 of the md reorganisation (OPS-278) |
| `docs/superpowers/plans/2026-07-04-spotify-playback-turbomodule.md` | Implementation plan: spotify playback turbomodule; the feature shipped in July 2026 | 2026-07-04 | `5c82d1fa24fdc927555b2676514c2e406cea9a58` | PR 1 of the md reorganisation (OPS-278) |
| `docs/superpowers/plans/2026-07-05-ws1-feature-hydration-repair.md` | Implementation plan: ws1 feature hydration repair; the feature shipped in July 2026 | 2026-07-05 | `5c82d1fa24fdc927555b2676514c2e406cea9a58` | PR 1 of the md reorganisation (OPS-278) |
| `docs/superpowers/plans/2026-07-06-part1-pool-uncap-hard-mood-band.md` | Implementation plan: part1 pool uncap hard mood band; the feature shipped in July 2026 | 2026-07-06 | `fe8022e8bd599018ca79f3b1e9d9d989a75e5c7a` | PR 1 of the md reorganisation (OPS-278) |
| `docs/superpowers/plans/2026-07-07-music-classification-purge.md` | Implementation plan: music classification purge; the feature shipped in July 2026 | 2026-07-07 | `a1d3f80b7ac073f08694a0401e7a06129baab639` | PR 1 of the md reorganisation (OPS-278) |
| `docs/superpowers/plans/2026-07-12-vector-discovery.md` | Implementation plan: vector discovery; the feature shipped in July 2026 | 2026-07-12 | `e754ef411d93b1ce2f40273a9aa405f84bb458b7` | PR 1 of the md reorganisation (OPS-278) |
| `docs/superpowers/plans/frontend-watch-integration-plan.md` | Implementation plan: frontend watch integration plan (deleted React web app); the feature shipped in July 2026 | 2026-06-24 | `b8c6579cbfa328e539552b64a1d5e920c6d4217a` | PR 1 of the md reorganisation (OPS-278) |
| `docs/superpowers/specs/2026-06-19-websocket-biometric-loop-design.md` | Design spec: websocket biometric loop design; the feature shipped in July 2026 | 2026-06-19 | `074a76e681b0887935642c8ebd00cc8df2281199` | PR 1 of the md reorganisation (OPS-278) |
| `docs/superpowers/specs/2026-06-24-frontend-watch-integration-design.md` | Design spec: frontend watch integration design (deleted React web app); the feature shipped in July 2026 | 2026-06-24 | `b8c6579cbfa328e539552b64a1d5e920c6d4217a` | PR 1 of the md reorganisation (OPS-278) |
| `docs/superpowers/specs/2026-07-04-frontend-tooling-foundation-design.md` | Design spec: frontend tooling foundation design; the feature shipped in July 2026 | 2026-07-04 | `5c82d1fa24fdc927555b2676514c2e406cea9a58` | PR 1 of the md reorganisation (OPS-278) |
| `docs/superpowers/specs/2026-07-04-spotify-playback-turbomodule-design.md` | Design spec: spotify playback turbomodule design; the feature shipped in July 2026 | 2026-07-04 | `5c82d1fa24fdc927555b2676514c2e406cea9a58` | PR 1 of the md reorganisation (OPS-278) |
| `docs/superpowers/specs/2026-07-05-biosonic-variance-and-live-biometric-mode-design.md` | Design spec: biosonic variance and live biometric mode design; the feature shipped in July 2026 | 2026-07-05 | `5c82d1fa24fdc927555b2676514c2e406cea9a58` | PR 1 of the md reorganisation (OPS-278) |
| `docs/superpowers/specs/2026-07-06-texture-gates-rhythmic-affinity-design.md` | Design spec: texture gates rhythmic affinity design; the feature shipped in July 2026 | 2026-07-06 | `e4fb4eceb775c9e318afef96f009fa3dd96ca1fe` | PR 1 of the md reorganisation (OPS-278) |
| `docs/superpowers/specs/2026-07-06-unified-pool-dualpath-shadowbuffer-design.md` | Design spec: unified pool dualpath shadowbuffer design; the feature shipped in July 2026 | 2026-07-06 | `fe8022e8bd599018ca79f3b1e9d9d989a75e5c7a` | PR 1 of the md reorganisation (OPS-278) |
| `docs/superpowers/specs/2026-07-07-music-classification-purge-design.md` | Design spec: music classification purge design; the feature shipped in July 2026 | 2026-07-07 | `a1d3f80b7ac073f08694a0401e7a06129baab639` | PR 1 of the md reorganisation (OPS-278) |
| `docs/superpowers/specs/2026-07-12-vector-discovery-design.md` | Design spec: vector discovery design; the feature shipped in July 2026 | 2026-07-12 | `e754ef411d93b1ce2f40273a9aa405f84bb458b7` | PR 1 of the md reorganisation (OPS-278) |
| `docs/superpowers/specs/2026-07-13-discovery-ui-compliance.md` | Design spec: discovery ui compliance; the feature shipped in July 2026 | 2026-07-13 | `2bfe5189d72490919728a3bbc7b2001c95e22970` | PR 1 of the md reorganisation (OPS-278) |
| `docs/superpowers/specs/2026-07-13-discovery-ui-design.md` | Design spec: discovery ui design; the feature shipped in July 2026 | 2026-07-13 | `2bfe5189d72490919728a3bbc7b2001c95e22970` | PR 1 of the md reorganisation (OPS-278) |
| `docs/superpowers/specs/2026-07-13-discovery-ui-visual-direction.md` | Design spec: discovery ui visual direction; the feature shipped in July 2026 | 2026-07-13 | `2bfe5189d72490919728a3bbc7b2001c95e22970` | PR 1 of the md reorganisation (OPS-278) |
| `docs/superpowers/specs/2026-07-14-discovery-caption-llm-design.md` | Design spec: discovery caption llm design; the feature shipped in July 2026 | 2026-07-14 | `61533c2f30006eab08e92630659d78bde60bb9b0` | PR 1 of the md reorganisation (OPS-278) |
| `docs/design-v2/research/2026-09-23/PLAN_APPROVED.md` | The design-v2 plan as approved on 2026-09-23; docs/plans/design-v2-plan.md is its living successor | 2026-09-23 | `442d5758e243561a3a7da944bb31136c80944b37` | PR 2 of the md reorganisation (OPS-278) |
| `docs/design-v2/research/2026-09-23/critique.md` | Completeness critique of that plan: 50 gaps and fixes | 2026-09-23 | `442d5758e243561a3a7da944bb31136c80944b37` | PR 2 of the md reorganisation (OPS-278) |
| `docs/design-v2/research/2026-09-23/plan.md` | The architect's merged plan of the September research (cited by line from TASKS and QA-056) | 2026-09-23 | `442d5758e243561a3a7da944bb31136c80944b37` | PR 2 of the md reorganisation (OPS-278) |
| `docs/design-v2/research/2026-09-23/r_code-map.md` | The architect's ground-truth code map | 2026-09-23 | `442d5758e243561a3a7da944bb31136c80944b37` | PR 2 of the md reorganisation (OPS-278) |
| `docs/design-v2/research/2026-09-23/r_compliance.md` | The compliance-auditor's constraints registry (C-numbers), the source of CMP- entries | 2026-09-23 | `442d5758e243561a3a7da944bb31136c80944b37` | PR 2 of the md reorganisation (OPS-278) |
| `docs/design-v2/research/2026-09-23/r_design-audit.md` | The designer's audit of the v1 screens | 2026-09-23 | `442d5758e243561a3a7da944bb31136c80944b37` | PR 2 of the md reorganisation (OPS-278) |
| `docs/design-v2/research/2026-09-23/r_qa-guards.md` | The resilience audit, the source of QA- entries | 2026-09-23 | `442d5758e243561a3a7da944bb31136c80944b37` | PR 2 of the md reorganisation (OPS-278) |
| `docs/design-v2/research/2026-09-23/r_tools.md` | Design-tooling research | 2026-09-23 | `442d5758e243561a3a7da944bb31136c80944b37` | PR 2 of the md reorganisation (OPS-278) |
| `docs/design-v2/research/2026-09-23/track-h/brief_architect.md` | Track H pre-build brief: architect | 2026-09-26 | `442d5758e243561a3a7da944bb31136c80944b37` | PR 2 of the md reorganisation (OPS-278) |
| `docs/design-v2/research/2026-09-23/track-h/brief_compliance.md` | Track H pre-build brief: compliance-auditor | 2026-09-26 | `442d5758e243561a3a7da944bb31136c80944b37` | PR 2 of the md reorganisation (OPS-278) |
| `docs/design-v2/research/2026-09-23/track-h/brief_designer.md` | Track H pre-build brief: designer | 2026-09-26 | `442d5758e243561a3a7da944bb31136c80944b37` | PR 2 of the md reorganisation (OPS-278) |
| `docs/design-v2/research/2026-09-23/track-h/build_H1.md` | A JSON build report of H1 (worktree, branch, commits) | 2026-09-26 | `442d5758e243561a3a7da944bb31136c80944b37` | PR 2 of the md reorganisation (OPS-278) |
| `docs/runbooks/discovery-genre-relevance-t5-sweep.md` | Production sweep of the discovery genre-relevance threshold; ran once, PASS | 2026-07-16 | `9dac5878e5eca40c961d5bd4a46d5ce024187179` | PR 2 of the md reorganisation (OPS-278) |
| `docs/runbooks/reembed-corpus-genre-dilution.md` | One-time re-embed migration of the corpus; it ran | 2026-07-15 | `2e005e42cb48981540e4b6965db4590777789daf` | PR 2 of the md reorganisation (OPS-278) |
| `mobile/SETUP_ANDROID.md` | Setup of the legacy "drop-in kit" under mobile/src, which is not the app (OPS-281) | 2026-06 | `6e08ac93f4bf765665fe24d0d2b93cd2fe327797` | PR 2 of the md reorganisation (OPS-278) |
| `claude_handoff.md` | Cross-session handoff of 2026-07-19 (Wave 2.8.2 rollout, providers, the standalone build); its release facts live in docs/runbooks/android-release-signing.md | 2026-07-19 | `0b42679ad4b6f63bbdd27742ad85efad1d7f940b` | PR 2 of the md reorganisation (OPS-278) |
| `mobile/native-snippets/RELEASE_SIGNING.md` | Release-signing guide for the legacy kit's generated project; replaced by docs/runbooks/android-release-signing.md, a rewrite against the real build.gradle, not a copy | 2026-06 | `4253540732e1d46ec2b7cf7ec401bc60a47bd19c` | PR 2 of the md reorganisation (OPS-278) |
| `PLAN.md` | The founding prompt of the project (Python or Node, a React web app) | 2026-06 | `0d9eaf3551e261e9c5443cb6fafdd94d75691f31` | PR 3 of the md reorganisation (OPS-278) |
| `docs/MASTER_BLUEPRINT_2026-07-07.md` | The Waves 0–3 execution plan of July, amended 2026-09-02 | 2026-07-07 | `c45b2bd7e0f17f5a92ecd5eb2547902a8d509a56` | PR 3 of the md reorganisation (OPS-278) |
| `KOKONADA_SECURITY_DATA_AUDIT.md` | Security audit of the web app and backend of June, remediated | 2026-06-22 | `c154d660f2bf79c9ed52e0a37da5a15bb2e502ce` | PR 3 of the md reorganisation (OPS-278) |
| `KOKONADA_ARCHITECTURE_MASTER.md §0 "2026-07-07 STATE", §4, §A–§D` | The July roadmap block and the sprint history cut from the architecture master when it moved (the rest lives on as docs/architecture/architecture-master.md) | 2026-07 | `c866bf94f8991edab2b1e03a894c5d8c8dead08b` | PR 3 of the md reorganisation (OPS-278) |

## Missing before this reorg

| path as referenced | referrers | what we know | last commit holding it (if ever tracked) |
|---|---|---|---|
| `docs/STAGE_2_6_PROMPT.md` | TASKS.md (UI-001 src) | A session prompt of the v1 UI stage; never tracked | never tracked |
| `docs/STAGE_2_END_PROMPT.md` | TASKS.md (UI-001, UI-002 src) | A session prompt of the v1 UI stage; never tracked | never tracked |
| `docs/plans/H13_EMBEDDING_V2_HANDOFF.md` | TASKS.md (DAN-013), docs/plans/WAVE4_STATE.md, docs/plans/WAVE4_ARCHIVE.md | Wave-4 H13 handoff held in stash@{0}; never tracked | never tracked |
| `docs/runbooks/h13-v2-activation-deploy.md` | TASKS.md (BE-010 where:, DAN-013), docs/plans/WAVE4_ARCHIVE.md | The embedding-v2 activation runbook; planned, never written | never tracked |
| `docs/design-v2/registry/DSN-001.md` | TASKS.md (ARCH-020) | The first designer rule entry; planned, not written yet (future) | never tracked |
| `docs/design-v2/registry/VERIFICATIONS.md` | TASKS.md (OPS-041 options) | An append-only verification log; proposed, not decided (future) | never tracked |
| `docs/adr/0017-design-v2-stylesheet-tokens-own-primitives.md` | TASKS.md (ARCH-020), docs/plans/DESIGN_V2_PLAN.md | ADR-0017, pending on branch design/v1-vision-frame (future) | never tracked |
| `.claude/agents/x.md` | TASKS.md (OPS-187, closed) | An example path quoted from a test, not a file | never tracked |
| `docs/CLAUDE_DESIGN_PROMPT.md` | .claude/agents/custodian.md, docs/GROUND_TRUTH_2026-09-02.md, docs/plans/WAVE4_STATE.md, docs/plans/WAVE4_ARCHIVE.md | A design-session prompt of the v1 canvas era; never tracked | never tracked |
| `docs/DEP_CLEANUP_AND_LINT_TASK.md` | .claude/agents/custodian.md | The dependency-cleanup task write-up of 2026-08-26; never tracked (its finding lives in dev-items.md#cold-jest-timeout) | never tracked |
| `docs/DESIGN_MASTER_PROMPT.md` | docs/plans/WAVE4_STATE.md | A design-session prompt; never tracked | never tracked |
| `docs/GROUND_TRUTH_2026-08-22.md` | docs/GROUND_TRUTH_2026-09-02.md, docs/plans/WAVE4_STATE.md, docs/plans/WAVE4_ARCHIVE.md | An untracked draft from a killed session (W4-D67), superseded by GROUND_TRUTH_2026-09-02 | never tracked |
| `docs/commands.md` | mobile/KokonadaHealth/android/app/build.gradle:59 (comment) | Not a repository path: the tail of an external URL (the react-native-community/cli documentation); a reference checker must skip URL tails | never tracked |
| `docs/pre-sideload-checklist.md` | docs/WEB_SUNSET_D5_GAP_SCAN_2026-07-08.md (deleted above) | A web-era checklist; never tracked | never tracked |
| `docs/design-v2/LEDGER.md` | docs/design-v2/research/2026-09-23/critique.md | A proposed design-v2 ledger that became WORK_LEDGER.md; never tracked | never tracked |
| `docs/audits/custodian/LEDGER.md` | .claude/agents/custodian.md | The custodian's append-only ledger; not written yet (future) | never tracked |
| `.claude/commands/build-screen.md` | docs/plans/DESIGN_V2_PLAN.md | The v1 screen-building command, replaced by /page | `442d5758e243561a3a7da944bb31136c80944b37` |
| `.claude/commands/wave2.md` | docs/design-v2/research/2026-09-23/critique.md | The Wave-2 command of the v1 era | `442d5758e243561a3a7da944bb31136c80944b37` |
| `.claude/worktrees/sentinel/WEAKNESSES_AND_FAILURES.md` | TASKS.md (OPS-213) | The sentinel's worktree copy of the root file; a worktree path, never a tracked file | never tracked |
| `docs/adr/ADR-0012-learning-compliance.md` | docs/plans/WAVE4_STATE.md, docs/plans/WAVE4_INTELLIGENCE_MISSION.md (deleted above) | A misspelt name; the file is `docs/adr/0012-learning-compliance.md` | never tracked under this name |
| `.agents/skills/resilience-audit/SKILL.md` | HANDOFF_2026-10-08_BEDRACK.md (kept, DEC-185) | Exists only on the branch of #240 (`chore/resilience-auditor-max`); lands with it (future) | never tracked on main |
| `docs/HANDOFF_2026-10-08_BEDRACK.md` | HANDOFF_2026-10-08_BEDRACK.md (its own text) | The handoff names itself with the wrong directory; the file is at the repository root | never tracked |
