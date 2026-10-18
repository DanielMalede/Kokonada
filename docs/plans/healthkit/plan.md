---
status: living
verified: 2026-10-18
---

# HealthKit implementation plans (MB-900)

The two implementation plans of the iOS HealthKit lane (`MB-900`), in dependency order. Each plan implements the design of the same name in `docs/plans/healthkit/design.md`. Text kept verbatim with headings one level down.

| Plan | Date | Status | TASKS rows |
|---|---|---|---|
| [HealthKit Contract Foundation Implementation Plan](#contract-foundation) | — | — | `MB-900` |
| [HealthKit Authoritative Sample Store Implementation Plan](#authoritative-sample-store) | — | — | — |

---

<a id="contract-foundation"></a>
## HealthKit Contract Foundation Implementation Plan
_Was `docs/superpowers/plans/2026-10-06-healthkit-contract-foundation.md` until 2026-10-18 (`docs/ARCHIVE.md` § Moved); its history is under that path._

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a backward-compatible, versioned HealthKit batch contract that validates stable sample identity and HRV method while refusing unimplemented deletions atomically.

**Architecture:** A pure contract parser owns envelope validation and produces the legacy `(platform, samples)` input consumed by the existing normalizer. The controller calls it before persistence and decorates only v2 responses with operational identity. Existing Health Connect requests bypass new strict sample rules and retain their current behavior.

**Tech Stack:** Node.js, Express, Jest, existing wearable services; no new dependency.

**Spec:** `docs/plans/healthkit/design.md#data-contract`

### Global Constraints

- Preserve the existing unversioned Health Connect request and response.
- Keep the 2,000-sample cap.
- Do not add a HealthKit dependency, entitlement, permission string or new metric.
- Do not log or echo physiological values, sample IDs, timestamps or device/source metadata.
- Reject a batch containing any delete before any write.
- HRV v2 requires `sdnn` on HealthKit and `rmssd` on Health Connect.
- Every production behavior starts with a failing test and finishes with the full backend suite and lint.

### Review Focus

- A mixed upsert/delete batch must perform zero writes, even when the delete is last.
- A legacy Health Connect caller must receive the same response shape as before.
- A malformed v2 batch must not fall through to the tolerant legacy normalizer.
- HRV method/platform mismatch must fail before persistence.
- Error and receipt logs must not expose fields copied from a sample.

---

#### Task 1: Pure health-batch contract

**Files:**
- Create: `backend/app/services/wearable/healthBatchContract.js`
- Create: `backend/tests/healthBatchContract.test.js`

**Interfaces:**
- Consumes: raw `req.body`.
- Produces: `parseHealthBatchRequest(body) -> { version, platform, batchId, samples }`; throws an error with stable `code` and HTTP `statusCode` (`400` for invalid input, `501` plus `health_delete_not_implemented` for any delete).

- [x] **Step 1: Write failing contract tests**

Test legacy passthrough, valid v2 HealthKit HR/SDNN samples, unknown schema versions, malformed UUIDs/timestamps, more than 2,000 samples, HRV method mismatch, and atomic refusal of a mixed delete batch. Assert errors by `code`, never by submitted value.

- [x] **Step 2: Run the new test file and verify RED**

Run: `npm test -- --runTestsByPath tests/healthBatchContract.test.js`

Expected: FAIL because `healthBatchContract` does not exist.

- [x] **Step 3: Implement the minimal pure parser**

Implement `parseHealthBatchRequest(body)` without a new package. Preserve the original samples array for valid requests; scan and validate the entire v2 batch before returning.

- [x] **Step 4: Run the contract tests and verify GREEN**

Run: `npm test -- --runTestsByPath tests/healthBatchContract.test.js`

Expected: all contract tests pass with no console errors or warnings.

#### Task 2: Controller integration and response compatibility

**Files:**
- Modify: `backend/app/controllers/integrationsController.js`
- Modify: `backend/tests/integrations.test.js`
- Modify: `backend/tests/wave4.ingestLogZeroKnowledge.test.js`

**Interfaces:**
- Consumes: `parseHealthBatchRequest` from Task 1.
- Produces: legacy response unchanged; v2 response adds `{ schemaVersion: 2, batchId }`.

- [x] **Step 1: Write failing controller tests**

Assert valid v2 forwarding, legacy response compatibility, invalid/delete batches performing zero `healthStore.ingestBatch` calls, stable status/code responses, and logs containing no sample identity or values.

- [x] **Step 2: Run the focused tests and verify RED**

Run: `npm test -- --runTestsByPath tests/integrations.test.js tests/wave4.ingestLogZeroKnowledge.test.js`

Expected: new v2 assertions fail against the current controller.

- [x] **Step 3: Wire the parser before persistence**

Call `parseHealthBatchRequest(req.body)`, pass its platform and samples to `healthStore.ingestBatch`, and decorate only versioned responses. Map stable contract errors directly without exposing raw input.

- [x] **Step 4: Run the focused tests and verify GREEN**

Run: `npm test -- --runTestsByPath tests/integrations.test.js tests/wave4.ingestLogZeroKnowledge.test.js`

Expected: both suites pass with no newly introduced log leakage.

#### Task 3: Baseline cleanup and complete verification

**Files:**
- Modify: `backend/tests/healthStore.test.js`
- Modify: `TASKS.md`

**Interfaces:**
- Consumes: the existing `VitalSample` persistence call exercised by `healthStore.test.js`.
- Produces: a truthful test fixture that follows the successful persistence path instead of swallowing a mocked CastError; MB-900 remains open with this increment recorded.

- [x] **Step 1: Pin the false-green fixture behavior**

Add the `VitalSample` mock used by the real health-store path and assert that an accepted resting-HR/HRV batch actually calls `VitalSample.insertMany`.

- [x] **Step 2: Run the focused health suites**

Run: `npm test -- --runTestsByPath tests/healthStoreAdapter.test.js tests/healthStore.test.js tests/healthStoreConsentVersionGate.test.js tests/integrationsConsentGate.test.js tests/healthBatchContract.test.js tests/integrations.test.js tests/wave4.ingestLogZeroKnowledge.test.js`

Expected: all focused suites pass without the current swallowed `CastError` console output.

- [x] **Step 3: Record the completed increment without closing MB-900**

Add a dated MB-900 update listing the implemented contract foundation and explicitly naming persistent identity, tombstones and iOS integration as remaining.

- [x] **Step 4: Run complete verification**

Run: `npm test`

Expected: all backend suites pass.

Run: `npm run lint`

Expected: exit 0 with no lint errors.

Run: `git diff --check`

Expected: no whitespace errors.

- [x] **Step 5: Commit only after verification**

Commit the task row, spec, plan, tests and implementation together with a short single-line message. Do not push or open a PR without Bedrack's explicit instruction.

<a id="authoritative-sample-store"></a>
## HealthKit Authoritative Sample Store Implementation Plan
_Was `docs/superpowers/plans/2026-10-06-healthkit-authoritative-sample-store.md` until 2026-10-18 (`docs/ARCHIVE.md` § Moved); its history is under that path._

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist versioned HealthKit samples as an idempotent, deletion-aware source of truth and safely rebuild the existing health projections.

**Architecture:** A new encrypted `HealthSample` collection owns v2 sample identity, active/deleted state and repair status. Existing health collections remain read-optimized projections. Writes are source-first and projections are idempotently reconciled, so correctness does not depend on a multi-document MongoDB transaction.

**Tech Stack:** Node.js 24, Express 5, Mongoose 9, MongoDB, Jest 29, mongodb-memory-server, BullMQ/Redis, AES-256-GCM encrypted fields, rotation-aware HMAC blind indexes.

**Spec:** `docs/plans/healthkit/design.md#authoritative-sample-store`

### Global Constraints

- Do not install an iOS package, change HealthKit entitlements, or request device permission in this plan.
- Legacy unversioned Health Connect behavior and response shape must remain unchanged.
- Only v2 HealthKit uses the new authoritative lane in this increment.
- Do not store or log raw HealthKit `sampleId`; persist only a namespaced, user-scoped HMAC.
- Physiological values remain AES-256-GCM encrypted and AAD-bound to `userId`.
- Health samples and tombstones have a 90-day retention boundary.
- SDNN and RMSSD remain labeled and must never share an unlabeled baseline calculation.
- A delete wins over an upsert for the same sample identity and cannot be undone by retry.
- Production Atlas index creation is a human-run Pause & Guide action.
- Do not edit `TASKS.md` until Malede's PR #222 is integrated and the branch is rebased.
- Every commit requires its targeted tests plus the full local CI-equivalent gate below. A pushed commit is not mergeable until all GitHub Actions checks are green.

#### Full local CI-equivalent gate before every commit

Run from the repository root:

```powershell
node --version # must report v24.x, matching .github/workflows/ci.yml

Push-Location backend
npm test
npm run lint
Pop-Location

Push-Location mobile/KokonadaHealth
./node_modules/.bin/jest --ci
npm run lint:design-system
node scripts/lab/assertLabExcluded.mjs
node scripts/lab/assertLabExcluded.mjs --platform ios
Pop-Location

git diff --check
git diff --cached --check
```

Expected: Node reports v24.x; backend and mobile tests pass; both Design Lab exclusion checks pass; design-system lint does not exceed its baseline; backend lint has zero errors; and both Git whitespace checks print nothing. GitHub's gitleaks job remains the authoritative secret scan; inspect its result before merge.

### Review Focus

- Two requests insert the same new UUID concurrently: one authoritative row and one projection must remain.
- A delete arrives before the corresponding upsert: the tombstone must block later resurrection.
- One batch contains both operations for one UUID in either order: delete must win in both orders.
- Projection or Redis/queue work fails after the authoritative write: the row remains pending, the response is retryable, and reconciliation repairs it without duplication.
- A user has labeled SDNN, labeled RMSSD and unlabeled legacy HRV: the legacy baseline must exclude SDNN and the method-aware output must keep both labeled populations separate.

---

#### Task 1: Safe HealthKit identity and authoritative model

**Files:**
- Create: `backend/app/services/wearable/healthSampleIdentity.js`
- Create: `backend/app/models/HealthSample.js`
- Create: `backend/tests/healthSampleIdentity.test.js`
- Create: `backend/tests/healthSampleModel.integration.test.js`

**Interfaces:**
- Consumes: `blindIndex(value)` and `blindIndexAll(value)` from `backend/app/utils/encryption.js`; `encryptedNumber` and `bindEncryptedAadOnUpdate` from `backend/app/models/encryptedField.js`.
- Produces: `healthSampleIdentityInput(userId, source, sampleId) -> string`, `healthSampleKey(userId, source, sampleId) -> string`, `healthSampleKeyCandidates(userId, source, sampleId) -> string[]`, and the `HealthSample` Mongoose model/constants.

- [ ] **Step 1: Write failing identity tests**

Add tests proving the key is deterministic, differs across users/sources/UUIDs, contains neither the UUID nor user ID, and that candidates include old- and current-key results during `ENCRYPTION_KEY_PREVIOUS` rotation.

- [ ] **Step 2: Run the identity tests and verify RED**

Run: `Push-Location backend; npx jest tests/healthSampleIdentity.test.js --runInBand --forceExit; Pop-Location`

Expected: FAIL because `healthSampleIdentity.js` does not exist.

- [ ] **Step 3: Implement the identity helper**

Use the exact namespace `kokonada:health-sample:v1` and serialize `<namespace>|<userId>|<source>|<sampleId>` before calling the existing blind-index functions. Export only the three named functions.

- [ ] **Step 4: Write failing model tests**

Pin these assertions: encrypted value round-trip is AAD-bound; raw Mongo never contains plaintext; active HRV requires a method; non-HRV rejects a method; an unseen-deletion tombstone may omit metric/value/unit/dates; the unique compound, pending-scan and absolute TTL indexes exist; `expiresAt` is required.

- [ ] **Step 5: Run the model tests and verify RED**

Run: `Push-Location backend; npx jest tests/healthSampleModel.integration.test.js --runInBand --forceExit; Pop-Location`

Expected: FAIL because `HealthSample` does not exist.

- [ ] **Step 6: Implement `HealthSample`**

Define schema version `1`, the exact fields and indexes from the spec, metric/source/method/state enums, validation for active versus tombstone rows, timestamps, JSON/object getters, and the encrypted-field update guard.

- [ ] **Step 7: Run targeted tests and the full gate**

Run the two Jest files together, then run the global gate.

Expected: all commands pass with zero new lint errors.

- [ ] **Step 8: Commit**

```powershell
git add backend/app/services/wearable/healthSampleIdentity.js backend/app/models/HealthSample.js backend/tests/healthSampleIdentity.test.js backend/tests/healthSampleModel.integration.test.js
git commit -m "feat: add authoritative health sample model"
```

#### Task 2: Idempotent operation repository and tombstones

**Files:**
- Create: `backend/app/services/wearable/healthSampleRepository.js`
- Create: `backend/tests/healthSampleRepository.integration.test.js`

**Interfaces:**
- Consumes: Task 1 identity helpers and `HealthSample`.
- Produces: `applyHealthOperations(userId, source, samples, { now } = {}) -> Promise<{ accepted, created, replayed, deleted, pendingKeys }>` and error codes `health_sample_identity_conflict` / `health_sample_outside_retention`.

- [ ] **Step 1: Write failing repository tests**

Cover new upsert, identical replay with a different batch context, conflicting immutable content, active delete, repeated delete, unknown delete, delete-before-upsert, both same-identity operation orders, stale upsert rejection, and two concurrent identical upserts producing one row.

- [ ] **Step 2: Run the repository tests and verify RED**

Run: `Push-Location backend; npx jest tests/healthSampleRepository.integration.test.js --runInBand --forceExit; Pop-Location`

Expected: FAIL because the repository does not exist.

- [ ] **Step 3: Implement operation reduction and persistence**

Normalize each identity through Task 1, collapse duplicates before writing, make delete dominant, query through all rotation candidates, create/update using the unique index as the race guard, and reread after duplicate-key errors. Never include a submitted value, UUID, HMAC, or timestamp in an error/log.

- [ ] **Step 4: Run targeted tests and the full gate**

Expected: repository tests and the global gate pass.

- [ ] **Step 5: Commit**

```powershell
git add backend/app/services/wearable/healthSampleRepository.js backend/tests/healthSampleRepository.integration.test.js
git commit -m "feat: persist idempotent health sample operations"
```

#### Task 3: Idempotent heart-rate and vital projections

**Files:**
- Modify: `backend/app/models/BiometricLog.js`
- Modify: `backend/app/models/VitalSample.js`
- Create: `backend/app/services/wearable/healthSampleProjection.js`
- Create: `backend/tests/healthSampleProjection.integration.test.js`
- Modify: `backend/tests/biometricRetention.test.js`
- Modify: `backend/tests/vitalSample.integration.test.js`

**Interfaces:**
- Consumes: active/deleted `HealthSample` documents.
- Produces: `projectTimeSeriesSample(sample) -> Promise<{ inserted, removed }>` and `removeTimeSeriesProjection(sampleKey, userId) -> Promise<number>`.

- [ ] **Step 1: Write failing projection/model tests**

Assert sparse unique `healthSampleKey` indexes on both projections, optional compatibility for legacy rows, required `hrvMethod` for linked HRV, `sdnn` preservation, one projection after repeated calls, and removal of either projection by an authoritative tombstone.

- [ ] **Step 2: Run the projection tests and verify RED**

Run: `Push-Location backend; npx jest tests/healthSampleProjection.integration.test.js tests/biometricRetention.test.js tests/vitalSample.integration.test.js --runInBand --forceExit; Pop-Location`

Expected: FAIL on the missing fields and service.

- [ ] **Step 3: Extend projection schemas**

Add optional internal `healthSampleKey` to both models, sparse unique indexes, and optional `hrvMethod` to `VitalSample`. Require the method only when a linked row has metric `hrv`; leave legacy unlabeled rows valid.

- [ ] **Step 4: Implement time-series projection**

Project `heart_rate` to `BiometricLog`, `resting_heart_rate`/`hrv` to `VitalSample`, and make the `healthSampleKey` unique index the idempotency guard. Deleted/unknown tombstones remove matching linked rows without scanning by physiological value.

- [ ] **Step 5: Run targeted tests and the full gate**

Expected: all pass.

- [ ] **Step 6: Commit**

```powershell
git add backend/app/models/BiometricLog.js backend/app/models/VitalSample.js backend/app/services/wearable/healthSampleProjection.js backend/tests/healthSampleProjection.integration.test.js backend/tests/biometricRetention.test.js backend/tests/vitalSample.integration.test.js
git commit -m "feat: project authoritative health time series"
```

#### Task 4: Method-aware HRV baselines

**Files:**
- Modify: `backend/app/agents/runtime/physiology/baselineEngine.js`
- Modify: `backend/app/services/biosonic/baselines.js`
- Modify: `backend/tests/baselineEngine.test.js`
- Modify: `backend/tests/baselines.test.js`

**Interfaces:**
- Consumes: `VitalSample` rows with optional `hrvMethod`.
- Produces: baseline blob `hrvByMethod: { rmssd, sdnn }`; preserves top-level `hrvMedian` / `hrvMAD` as RMSSD plus unlabeled legacy rows only.

- [ ] **Step 1: Write failing mixed-method baseline tests**

Use deliberately different SDNN/RMSSD values and assert they produce separate medians/MADs. Assert labeled SDNN cannot change legacy top-level keys, unlabeled legacy rows stay in the legacy calculation, and cache serialization/readback preserves `hrvByMethod`.

- [ ] **Step 2: Run baseline tests and verify RED**

Run: `Push-Location backend; npx jest tests/baselineEngine.test.js tests/baselines.test.js --runInBand --forceExit; Pop-Location`

Expected: FAIL because method-aware output is absent.

- [ ] **Step 3: Implement method partitioning**

Partition HRV rows before `estimateMetricBaseline`. Add `hrvByMethod` without changing existing consumers or feeding SDNN into the legacy top-level values.

- [ ] **Step 4: Run targeted tests and the full gate**

Expected: all pass and existing translation behavior remains unchanged.

- [ ] **Step 5: Commit**

```powershell
git add backend/app/agents/runtime/physiology/baselineEngine.js backend/app/services/biosonic/baselines.js backend/tests/baselineEngine.test.js backend/tests/baselines.test.js
git commit -m "feat: separate SDNN and RMSSD baselines"
```

#### Task 5: Sleep/profile recomputation and reconciliation service

**Files:**
- Modify: `backend/app/models/MedicalProfile.js`
- Create: `backend/app/services/wearable/healthSampleReconciliation.js`
- Create: `backend/tests/healthSampleReconciliation.integration.test.js`
- Modify: `backend/tests/sleepSemantics.test.js`

**Interfaces:**
- Consumes: Task 2 pending authoritative rows, Task 3 projection functions, `User.wearableProvider`, existing cache invalidation and state-vector enqueue utilities.
- Produces: `reconcileHealthSamples(userId, source) -> Promise<{ projected, removed, profileUpdated }>`.

- [ ] **Step 1: Write failing reconciliation tests**

Assert that active sleep intervals are grouped into stage totals per night, long-run medians and latest night are rebuilt, deletion removes one interval and recomputes from the rest, another provider's active profile is not overwritten, time-series projection is invoked, cache invalidation/state recompute occur, and `projectionState` changes to `applied` only after all required writes succeed.

- [ ] **Step 2: Add a projection-failure test**

Force a projection write to reject and assert the authoritative rows remain `pending`, no false applied state is recorded, and a second reconciliation call repairs the state without duplicates.

- [ ] **Step 3: Run reconciliation tests and verify RED**

Run: `Push-Location backend; npx jest tests/healthSampleReconciliation.integration.test.js tests/sleepSemantics.test.js --runInBand --forceExit; Pop-Location`

Expected: FAIL because the service and profile provenance are absent.

- [ ] **Step 4: Add profile provenance**

Add a provider field for the supported health projection. Do not migrate or relabel existing profile data. A HealthKit recompute writes supported fields only when `apple_health` is active.

- [ ] **Step 5: Implement reconciliation**

Process pending rows idempotently, rebuild sleep from active authoritative intervals rather than subtracting durations, preserve SDNN as method-aware data without assigning it to the legacy generic profile HRV, invalidate derived caches, enqueue the existing debounced state job, then mark the processed set applied.

- [ ] **Step 6: Run targeted tests and the full gate**

Expected: all pass.

- [ ] **Step 7: Commit**

```powershell
git add backend/app/models/MedicalProfile.js backend/app/services/wearable/healthSampleReconciliation.js backend/tests/healthSampleReconciliation.integration.test.js backend/tests/sleepSemantics.test.js
git commit -m "feat: reconcile health samples into derived profiles"
```

#### Task 6: Crash-repair worker

**Files:**
- Modify: `backend/app/queues/definitions.js`
- Modify: `backend/app/queues/queue.js`
- Create: `backend/app/workers/healthSampleReconciliation.worker.js`
- Modify: `backend/app/workers/index.js`
- Modify: `backend/app/index.js`
- Create: `backend/tests/healthSampleReconciliation.worker.test.js`
- Modify: `backend/tests/queues.test.js`
- Modify: `backend/tests/userJobPurge.guards.test.js`

**Interfaces:**
- Consumes: `reconcileHealthSamples(userId, source)` from Task 5 and pending rows ordered by oldest `updatedAt`.
- Produces: `process() -> Promise<{ groups, repaired }>` for a global queue job with no user identifier in its payload.

- [ ] **Step 1: Write failing worker tests**

Assert a scan is bounded to 100 oldest pending rows, identities are grouped by user/source, one failing group does not skip later groups, the registered queue payload is empty, and account-erasure job guards do not misclassify the global job as user-owned.

- [ ] **Step 2: Run worker/queue tests and verify RED**

Run: `Push-Location backend; npx jest tests/healthSampleReconciliation.worker.test.js tests/queues.test.js tests/userJobPurge.guards.test.js --runInBand --forceExit; Pop-Location`

Expected: FAIL because the queue and worker are not registered.

- [ ] **Step 3: Implement and schedule bounded repair**

Add `HEALTH_SAMPLE_RECONCILE`, register the worker, and schedule one global repeatable job every five minutes. Do not place a user ID, sample identity, value, or timestamp in the queue payload or logs.

- [ ] **Step 4: Run targeted tests and the full gate**

Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add backend/app/queues/definitions.js backend/app/queues/queue.js backend/app/workers/healthSampleReconciliation.worker.js backend/app/workers/index.js backend/app/index.js backend/tests/healthSampleReconciliation.worker.test.js backend/tests/queues.test.js backend/tests/userJobPurge.guards.test.js
git commit -m "feat: repair pending health projections"
```

#### Task 7: Route v2 HealthKit through the authoritative lane

**Files:**
- Modify: `backend/app/services/wearable/healthBatchContract.js`
- Create: `backend/app/services/wearable/healthStoreV2.js`
- Modify: `backend/app/controllers/integrationsController.js`
- Modify: `backend/tests/healthBatchContract.test.js`
- Modify: `backend/tests/integrations.test.js`
- Modify: `backend/tests/wave4.ingestLogZeroKnowledge.test.js`
- Create: `backend/tests/healthStoreV2.integration.test.js`

**Interfaces:**
- Consumes: `applyHealthOperations` and `reconcileHealthSamples`.
- Produces: `ingestV2Batch(userId, platform, samples, options = {}) -> Promise<{ accepted, created, replayed, deleted, projected }>`.

- [ ] **Step 1: Replace delete-refusal tests with failing delete-semantic tests**

Keep whole-envelope validation atomic. Allow a delete to contain only UUID and operation. Assert v2 HealthKit uses the new service, mixed upsert/delete succeeds with delete dominance, conflicts return `409`, pending projection returns `503`, and no submitted identity/value appears in logs or errors.

- [ ] **Step 2: Add legacy compatibility controls**

Assert unversioned Health Connect still calls the existing `healthStore.ingestBatch`, has the same result shape, and never creates `HealthSample` rows.

- [ ] **Step 3: Run contract/controller/store tests and verify RED**

Run: `Push-Location backend; npx jest tests/healthBatchContract.test.js tests/integrations.test.js tests/healthStoreV2.integration.test.js tests/wave4.ingestLogZeroKnowledge.test.js --runInBand --forceExit; Pop-Location`

Expected: FAIL because delete still returns `501` and no v2 store exists.

- [ ] **Step 4: Implement the v2 orchestration service**

Map `healthkit` to `apple_health`, persist the full operation set, reconcile synchronously, return only operational counts, and translate fixed repository/reconciliation errors to the contract status codes.

- [ ] **Step 5: Dispatch by parsed contract version in the controller**

Keep v1 on the existing service. Send v2 HealthKit to `ingestV2Batch`. Preserve consent middleware and provider marking. Do not enable v2 Health Connect yet.

- [ ] **Step 6: Run targeted tests and the full gate**

Expected: all pass, including all pre-existing health-store and consent suites.

- [ ] **Step 7: Commit**

```powershell
git add backend/app/services/wearable/healthBatchContract.js backend/app/services/wearable/healthStoreV2.js backend/app/controllers/integrationsController.js backend/tests/healthBatchContract.test.js backend/tests/integrations.test.js backend/tests/wave4.ingestLogZeroKnowledge.test.js backend/tests/healthStoreV2.integration.test.js
git commit -m "feat: enable idempotent HealthKit v2 sync"
```

#### Task 8: Complete privacy, erasure, export and retention registration

**Files:**
- Modify: `backend/app/services/privacy/erasure.js`
- Modify: `backend/scripts/gdpr-delete.js`
- Modify: `backend/app/services/privacy/userDataExport.js`
- Modify: `backend/app/services/privacy/wearableErasure.js`
- Modify: `backend/tests/shadow.qa4.crypto.test.js`
- Modify: `backend/tests/accountDeletion.test.js`
- Modify: `backend/tests/userDataExport.test.js`
- Modify: `backend/tests/wearableErasure.test.js`
- Modify: `backend/tests/wave4.retentionDocs.test.js`
- Modify: the retention inventory file identified by `wave4.retentionDocs.test.js`

**Interfaces:**
- Consumes: `HealthSample` and Task 5 reconciliation/cache behavior.
- Produces: complete lifecycle coverage for the new user-owned wearable collection.

- [ ] **Step 1: Write failing lifecycle tests**

Assert account erasure and the CLI script include `HealthSample`, export returns decrypted owner data but redacts `sampleKey`, provider disconnect deletes only matching source rows, derived profile/cache cleanup runs, and structural discovery recognizes the new model as wearable-derived without depending only on a `'garmin'` literal.

- [ ] **Step 2: Run privacy tests and verify RED**

Run: `Push-Location backend; npx jest tests/shadow.qa4.crypto.test.js tests/accountDeletion.test.js tests/userDataExport.test.js tests/wearableErasure.test.js tests/wave4.retentionDocs.test.js --runInBand --forceExit; Pop-Location`

Expected: FAIL because the new model is not registered.

- [ ] **Step 3: Register the collection in every lifecycle surface**

Keep account erasure and the operator script in lockstep. Add export redaction, source-scoped provider deletion and truthful 90-day retention documentation. Update structural discovery so future Apple/Android-only wearable models cannot evade it.

- [ ] **Step 4: Run targeted tests and the full gate**

Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add backend/app/services/privacy/erasure.js backend/scripts/gdpr-delete.js backend/app/services/privacy/userDataExport.js backend/app/services/privacy/wearableErasure.js backend/tests/shadow.qa4.crypto.test.js backend/tests/accountDeletion.test.js backend/tests/userDataExport.test.js backend/tests/wearableErasure.test.js backend/tests/wave4.retentionDocs.test.js docs
git commit -m "feat: cover health samples across privacy lifecycle"
```

#### Task 9: Final verification and human-gated rollout notes

**Files:**
- Modify: `docs/plans/healthkit/research.md`
- Create: `docs/runbooks/health-sample-index-rollout.md`
- Modify after PR #222 rebase only: `TASKS.md`

**Interfaces:**
- Consumes: completed Tasks 1-8.
- Produces: operator instructions and verified MB-105 status without mutating production.

- [ ] **Step 1: Add a production index runbook**

Document the expected unique, pending-scan and TTL indexes; Atlas UI verification; duplicate preflight; rollback/stop conditions; and the rule that Daniel or Malede performs and visually verifies production index creation.

- [ ] **Step 2: Update research status and task tracking**

Mark the server storage prerequisite complete in the research document. After fetching/rebasing Malede's merged PR #222, add/update `MB-105` in `TASKS.md` while preserving both ID reservations and resolving its known small conflict.

- [ ] **Step 3: Run focused acceptance suites**

Run:

```powershell
Push-Location backend
npx jest tests/healthSampleIdentity.test.js tests/healthSampleModel.integration.test.js tests/healthSampleRepository.integration.test.js tests/healthSampleProjection.integration.test.js tests/healthSampleReconciliation.integration.test.js tests/healthSampleReconciliation.worker.test.js tests/healthStoreV2.integration.test.js tests/healthBatchContract.test.js tests/integrations.test.js tests/shadow.qa4.crypto.test.js --runInBand --forceExit
Pop-Location
```

Expected: all authoritative-store, deletion, projection, endpoint and privacy acceptance suites pass.

- [ ] **Step 4: Run the full gate and inspect the final diff**

Run the global gate, then:

```powershell
git status --short
git diff --stat origin/main...HEAD
git log --oneline origin/main..HEAD
```

Expected: only scoped HealthKit storage/research changes, no secrets, no unrelated mobile/native change, and every commit represented by a green local gate.

- [ ] **Step 5: Commit the rollout documentation**

```powershell
git add docs/plans/healthkit/research.md docs/runbooks/health-sample-index-rollout.md TASKS.md
git commit -m "docs: add HealthKit storage rollout guide"
```

- [ ] **Step 6: Push only after coordination**

Fetch Malede's latest remote work, rebase this branch, resolve the known `TASKS.md` reservation conflict while preserving both sides, rerun the full gate, then push. Open a PR and require all GitHub Actions checks to be green before merge.

#### Task 10: Remediate compliance audit blockers

**Files:**
- Modify: `backend/app/services/wearable/healthSampleReconciliation.js`
- Modify: `backend/app/services/wearable/healthStoreV2.js`
- Modify: `backend/app/controllers/integrationsController.js`
- Modify: `backend/app/models/User.js`
- Modify: `backend/app/services/privacy/wearableErasure.js`
- Modify: `backend/app/services/wearable/healthSampleProjection.js`
- Create: `backend/tests/healthSampleConsentRace.integration.test.js`
- Modify: `backend/app/models/HealthSample.js`
- Create: `backend/tests/healthSampleAutoIndex.integration.test.js`
- Modify: `backend/app/services/wearable/healthBatchContract.js`
- Modify: `backend/app/services/wearable/healthSampleRepository.js`
- Modify: `backend/tests/healthBatchContract.test.js`
- Modify: `backend/tests/healthSampleRepository.integration.test.js`
- Modify: `backend/app/services/privacy/userDataExport.js`
- Modify: `backend/tests/userDataExport.test.js`
- Modify: `docs/privacy-declarations.md`
- Modify: `TASKS.md`

**Interfaces:**
- Consumes: `healthWriteFence`, provider connection state and the authoritative sample/projection links.
- Produces: consent/provider-fenced reconciliation with targeted compensation; owner-gated index rollout; bounded 90-day retention and canonical input validation; identifier-free export.
- Produces: a monotonic wearable connection generation that rejects stale ingest/reconciliation across disconnect/reconnect ABA transitions.

- [ ] **Step 1: Add failing race tests**

On real MongoDB, hold reconciliation after its projection writes, then withdraw consent, disconnect Apple Health, or remove the account. Assert the post-write fence removes only this run's linked time-series rows/profile projection, leaves authoritative rows pending where the account still exists, and never enqueues derived state after refusal.

- [ ] **Step 2: Implement start and post-write fences**

Require a current consent fence and matching active provider before reading pending rows. Re-check both after writes, compare the consent record id, and compensate by linked sample keys plus the Apple-owned profile projection. Keep logs closed-token only.

- [ ] **Step 3: Add a failing automatic-index test**

Connect a process that has registered `HealthSample` without calling `syncIndexes()` and assert startup creates none of its three application indexes.

- [ ] **Step 4: Disable HealthSample automatic index creation**

Set schema-level `autoIndex: false`; keep the index declarations so tests and the owner-run rollout can create and verify them explicitly.

- [ ] **Step 5: Add failing contract and retention tests**

Reject non-number values, non-canonical units, out-of-range values, reversed intervals and timestamps beyond the allowed future skew. Assert stored expiry is never later than receipt plus 90 days.

- [ ] **Step 6: Implement strict validation and bounded expiry**

Use per-metric unit/range rules, a five-minute future-skew ceiling, interval ordering and `min(endAt + 90 days, receipt + 90 days)` retention.

- [ ] **Step 7: Remove internal projection identifiers from export and correct declarations**

Redact `healthSampleKey` from `BiometricLog` and `VitalSample` exports. State that the authoritative store is active for Apple Health only; Health Connect v2 remains future work.

- [ ] **Step 8: Pin and remediate second-review lifecycle and interval findings**

Start with an existing Apple-owned profile, hold its reconciliation write, then exercise withdrawal, disconnect, account deletion, withdraw/regrant and disconnect/reconnect. Never restore the pre-erasure snapshot. Add a monotonic connection generation, advance it on disconnect/connect, and reject stale v2 ingest before persistence. For sleep, require a positive interval of at most 24 hours and timestamp/value agreement within one second.

- [ ] **Step 9: Run focused suites, full local gates, exact-head CI and repeat compliance review**

Do not mark `OPS-174` complete or make the PR ready until the compliance auditor returns a non-HALT verdict on the exact green SHA.

- [ ] **Step 10: Close the third-review authoritative-write race**

Write authoritative rows as staged under the admitting consent fence and wearable connection generation. Re-check both after storage, promote only matching rows, and remove stale staged rows before returning an error. Add a durable projection-cleanup journal before any derived write and let the repair worker resolve both staged rows and owed compensation. Pin real-Mongo held-write races for withdrawal, disconnect, account deletion and reconnect ABA, including a transient cleanup failure followed by successful repair. Then repeat the complete local gate, exact-head CI and compliance audit.
