# HealthKit Contract Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a backward-compatible, versioned HealthKit batch contract that validates stable sample identity and HRV method while refusing unimplemented deletions atomically.

**Architecture:** A pure contract parser owns envelope validation and produces the legacy `(platform, samples)` input consumed by the existing normalizer. The controller calls it before persistence and decorates only v2 responses with operational identity. Existing Health Connect requests bypass new strict sample rules and retain their current behavior.

**Tech Stack:** Node.js, Express, Jest, existing wearable services; no new dependency.

**Spec:** `docs/superpowers/specs/2026-10-06-healthkit-data-contract-design.md`

## Global Constraints

- Preserve the existing unversioned Health Connect request and response.
- Keep the 2,000-sample cap.
- Do not add a HealthKit dependency, entitlement, permission string or new metric.
- Do not log or echo physiological values, sample IDs, timestamps or device/source metadata.
- Reject a batch containing any delete before any write.
- HRV v2 requires `sdnn` on HealthKit and `rmssd` on Health Connect.
- Every production behavior starts with a failing test and finishes with the full backend suite and lint.

## Review Focus

- A mixed upsert/delete batch must perform zero writes, even when the delete is last.
- A legacy Health Connect caller must receive the same response shape as before.
- A malformed v2 batch must not fall through to the tolerant legacy normalizer.
- HRV method/platform mismatch must fail before persistence.
- Error and receipt logs must not expose fields copied from a sample.

---

### Task 1: Pure health-batch contract

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

### Task 2: Controller integration and response compatibility

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

### Task 3: Baseline cleanup and complete verification

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
