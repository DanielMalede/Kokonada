# HealthKit Authoritative Sample Store Design

## Intent

Kokonada needs a durable server-side source of truth for versioned HealthKit samples before an iPhone can safely use anchored synchronization. The store must make a retried upload harmless, preserve the distinction between HRV methods, process HealthKit deletions, and repair the existing derived models without relying on a multi-document MongoDB transaction.

This is a server-storage increment. It does not install an iOS dependency, add the HealthKit entitlement, request permission, or start collecting data from a device.

## Current problem

The v2 wire contract already validates a HealthKit UUID and requires `method: "sdnn"` for HealthKit HRV, but the persistence lane discards both fields. Existing persistence deduplicates by source and timestamp in application code. That has four gaps:

- concurrent retries can still create duplicate rows because there is no database-enforced identity;
- a HealthKit deletion names an object UUID, but the server does not retain a safe lookup key for it;
- sleep intervals are collapsed into `MedicalProfile`, so a deleted interval cannot be removed and recomputed accurately;
- Apple SDNN and the existing RMSSD-oriented `hrv` history would share an unlabeled baseline.

`BiometricLog`, `VitalSample`, and `MedicalProfile` remain useful read models for the current application. They are not suitable as the authoritative HealthKit event history because identity and deletion would be split across several collections.

## Decision

Add a `HealthSample` collection as the authoritative source for v2 OS health-store operations. A HealthKit UUID is converted into a purpose-namespaced, user-scoped HMAC before persistence. The raw UUID is never stored or logged.

The existing health models become projections:

- heart rate projects to `BiometricLog`;
- resting heart rate and HRV project to `VitalSample`;
- sleep intervals remain queryable in `HealthSample` and rebuild the sleep fields in `MedicalProfile`;
- `MedicalProfile` and the baseline cache remain derived state and can be rebuilt.

The authoritative row is written first. Projection is idempotent and retryable. A synchronous projection attempt keeps the common path current; a bounded reconciliation worker repairs rows left pending by a process crash or transient datastore failure. This replaces the need for a multi-document MongoDB transaction.

## Terminology

- **Source of truth:** the record that decides what really exists. A derived row may be deleted and rebuilt from it.
- **Projection:** a copy or summary shaped for an existing reader, such as a `BiometricLog` row or a sleep total.
- **Idempotent operation:** performing the same request again produces the same final state rather than a duplicate.
- **Tombstone:** a minimal record saying a sample was deleted. It prevents a delayed retry from bringing that sample back.
- **HMAC blind index:** a deterministic secret-key hash used for equality lookup. The server can recognize the same UUID again without storing the UUID itself.
- **Reconciliation:** retrying projection work until the derived models match the authoritative rows.
- **SDNN / RMSSD:** two different mathematical summaries of heartbeat timing variation. Both use milliseconds, but their numbers are not interchangeable.
- **MongoDB transaction:** a mechanism that commits changes to multiple documents together or rolls all of them back. This design does not require it.

## Authoritative model

Create `backend/app/models/HealthSample.js` with these logical fields:

| Field | Meaning |
|---|---|
| `userId` | Owning user; required and AAD owner for encrypted values |
| `sampleKey` | HMAC of namespace, user, provider and HealthKit UUID; raw UUID is not stored |
| `source` | Existing provider vocabulary, initially `apple_health` for this lane |
| `metric` | `heart_rate`, `resting_heart_rate`, `hrv`, `sleep_deep`, `sleep_light`, or `sleep_rem`; nullable only for an unseen deletion |
| `method` | `sdnn` or `rmssd` for HRV; null otherwise |
| `value` | Encrypted numeric value; null for an unseen-deletion tombstone |
| `unit` | Validated canonical unit; null for an unseen-deletion tombstone |
| `startAt`, `endAt` | Sample interval; null only for an unseen-deletion tombstone |
| `tzOffsetMinutes` | Optional offset in the existing `[-840, 720]` range |
| `state` | `active` or `deleted` |
| `projectionState` | `pending` or `applied` |
| `ingestState` | `staged` until the post-write consent/connection fence passes, then `committed` |
| `ingestToken`, `consentFence` | Internal CAS/recovery metadata while a write is staged; cleared on commit |
| `connectionVersion` | Monotonic wearable-connection generation that owns the row |
| `deletedAt` | When the server first accepted deletion; null for active rows |
| `expiresAt` | Absolute retention deadline used by a TTL index |
| `v` | Stored schema version; `2` adds staged-ingest and connection-generation metadata |
| timestamps | `createdAt` and `updatedAt` for operations and repair |

Required indexes:

- unique `{ userId: 1, source: 1, sampleKey: 1 }` for correctness under concurrent retries;
- `{ projectionState: 1, updatedAt: 1 }` for bounded repair scans;
- TTL `{ expiresAt: 1 }` with `expireAfterSeconds: 0`.

Active rows expire at the earlier of 90 days after `endAt` and 90 days after server receipt, so a future-dated client sample cannot extend retention beyond the disclosed window. An unseen-deletion tombstone expires 90 days after receipt. The v2 lane rejects an upsert whose sample is already outside that window and rejects an `endAt` more than five minutes in the future, so an expired tombstone cannot permit an accepted stale sample to reappear.

The v2 contract accepts only JSON numbers and canonical units: heart rate and resting heart rate use `bpm` in the existing physiological range 30–220; HRV uses `ms` in `(0, 1000]`; sleep stages use `min` in `(0, 1440]`. It rejects non-finite values, numeric strings, reversed intervals and timestamps outside the allowed future-skew boundary. A sleep-stage sample must span more than zero and no more than 24 hours, and its supplied minute value must match the timestamp-derived duration within one second of precision. Reconciliation still derives sleep from the timestamps rather than trusting the aggregate value.

## Identity and key rotation

The identity input is namespaced and user scoped:

```text
kokonada:health-sample:v1|<userId>|<source>|<sampleId>
```

The existing rotation-aware blind-index primitives produce the current write key and all valid lookup candidates. Looking up through all configured keys keeps rows reachable after encryption-key rotation. When a row is found under an old key, it is safely moved to the current key.

The `sampleKey`, staged-ingest token and consent-fence id are internal metadata. They are removed from the subject-facing data export. Logs contain counts and fixed error codes, never `sampleId`, `sampleKey`, values, timestamps, device names, or source metadata.

## Upsert semantics

Before database work, the service validates the whole envelope and collapses repeated operations for the same identity. If both an upsert and a delete for one UUID appear in a batch, delete wins independent of array order.

For an upsert:

- no row: create an active row with `projectionState: pending`;
- identical active row: treat as a replay and do not create a duplicate;
- active row with different immutable content: return `409 health_sample_identity_conflict` and do not overwrite it;
- deleted row: keep the tombstone and report the operation as already deleted.

A database duplicate-key race is resolved by rereading the winning row and applying the same rules. The unique index, not a read-before-write assumption, is the final concurrency guard.

`batchId` remains an operational correlation ID and is not the correctness boundary. A client may retry the same samples under a new batch ID and still get the same result.

## Delete semantics

For a delete:

- known active row: mark it deleted, clear no identity fields, and set `projectionState: pending`;
- known deleted row: treat as a replay;
- unknown UUID: create a minimal tombstone with no physiological value.

A delete never needs the sample type. This matches HealthKit deleted-object behavior and is why central identity is preferred over searching several projection collections.

Deleting wins over a delayed upsert for the same identity. The API returns success only after the synchronous reconciliation attempt finishes. If projection cleanup cannot finish, the endpoint returns a retryable `503 health_projection_pending`; the authoritative tombstone remains stored and the repair worker continues trying.

## Projection and recomputation

`BiometricLog` and `VitalSample` gain an optional internal `healthSampleKey` with a sparse unique index. Only rows projected from the authoritative store populate it, so legacy ingest remains compatible.

`VitalSample` also gains optional `hrvMethod`. A linked HealthKit HRV row requires `sdnn`; a future linked Health Connect row requires `rmssd`. Legacy unlabeled rows remain readable but are not silently relabeled.

HRV baseline output becomes method aware. The baseline blob adds separate SDNN and RMSSD statistics. Existing top-level `hrvMedian` and `hrvMAD` keep their legacy RMSSD-oriented meaning and must never include labeled SDNN rows. This storage increment preserves HealthKit SDNN for later method-aware state consumption; it does not feed SDNN into a classifier that still assumes generic HRV.

Sleep projections are rebuilt from active HealthSample intervals for the active provider. The service calculates stage totals by night, then rebuilds `MedicalProfile.sleepStages`, `lastNightSleep`, and `sleepUpdatedAt`. It does not subtract a duration from an existing aggregate because overlapping intervals, retries, and earlier deletions make arithmetic subtraction unsafe.

Every wearable connection has a monotonic server-side generation. Disconnecting or switching a provider advances that generation. HealthKit ingestion and projection capture it and refuse work from an older generation, including a disconnect/reconnect ABA where the provider name is again `apple_health`. A privacy-fence compensation clears only Apple-owned projection fields written by that run; it never restores a pre-erasure health snapshot. `MedicalProfile` records the owning connection generation as well as the provider, so cleanup for an old connection cannot clear a newer reconnect's profile.

The profile records which provider produced its supported health projection. A HealthKit recompute may replace those supported fields only when `apple_health` is the user's active wearable provider. It never combines an Apple SDNN value with an older generic HRV aggregate from another provider.

After applying or deleting projections, reconciliation invalidates the baseline and affect caches and schedules the existing state-vector recomputation. Only after all required writes complete does it mark authoritative rows `projectionState: applied`.

## Failure and repair model

MongoDB transactions are deliberately not required. Local integration tests use standalone `mongodb-memory-server`, and transaction-only correctness would require a replica set in tests and deployment. More importantly, a transaction cannot include Redis cache invalidation or a queue publish.

Instead:

- an ingest writes authoritative rows as `staged`, with the consent fence and connection generation that admitted it;
- a second fence runs after storage and before success; invalid work is removed and a transient cleanup failure leaves the staged row as a durable retry marker;
- only a matching post-write fence promotes staged rows to `committed`, and projection ignores staged rows;
- every projection operation is idempotent;
- pending projection state is visible in MongoDB;
- before projection starts, the User row receives a values-free cleanup journal containing the internal sample keys, consent fence and connection generation; it is removed only after success or verified compensation;
- the request tries reconciliation immediately;
- a global reconciliation job first resolves staged ingests and owed cleanup journals, then scans a bounded number of oldest committed pending rows grouped by user, source and connection generation;
- account deletion removes the authoritative rows, and the global job carries no user identifier in its queue payload.

This gives eventual repair after a crash while preserving a deterministic retry path.

## Compatibility boundary

- Legacy unversioned Health Connect requests continue through `metricStore.persistMetrics` unchanged.
- Versioned v2 HealthKit requests use the authoritative store.
- v2 Health Connect support may be enabled later through the same model after its client supplies persistent sample identity and method metadata.
- Existing rows in `BiometricLog`, `VitalSample`, and `MedicalProfile` are not migrated in this increment.
- No new metric category is authorized. The accepted metrics remain the six already present in the v2 contract.

## Privacy lifecycle

The new collection is special-category health data and must be added in the same change to:

- account erasure;
- the operator GDPR deletion script;
- subject data export, with `sampleKey` redacted;
- provider-scoped wearable erasure;
- the retention/declaration documentation;
- structural tests that keep these inventories in lockstep.

Provider disconnect deletes its `HealthSample` rows, then rebuilds or removes derived health fields and invalidates caches. Consent withdrawal and account deletion continue to purge jobs before deleting health data.

Production creation of the unique and TTL indexes remains a human-run, verified Atlas action. Code and tests may define the indexes, but an agent must not silently mutate production indexes.

## Response shape

A successful v2 response continues to echo `schemaVersion` and `batchId`, and adds only operational counts:

```json
{
  "schemaVersion": 2,
  "batchId": "UUID",
  "accepted": 4,
  "created": 2,
  "replayed": 1,
  "deleted": 1,
  "projected": 3
}
```

No individual sample identity or physiological value is returned. Legacy response shape remains unchanged.

## Verification requirements

- concurrent identical upserts create exactly one authoritative row and one projection;
- a retry with a different batch ID remains a replay;
- conflicting content under the same UUID returns `409` without mutation;
- delete-before-upsert creates a tombstone and prevents resurrection;
- mixed upsert/delete for one UUID resolves to deleted independent of order;
- a projection failure leaves `pending`, returns a retryable failure, and succeeds on reconciliation;
- held-write races across withdrawal, direct disconnect, account deletion, withdraw/regrant and disconnect/reconnect never return success for stale work and never delete a newer connection generation;
- a failed compensating delete leaves a durable cleanup journal and the repair worker removes the late projection on retry;
- SDNN never contributes to legacy RMSSD baseline keys;
- deleting a sleep interval rebuilds nightly and long-run sleep fields from remaining active intervals;
- legacy Health Connect tests remain unchanged and green;
- logs remain zero-knowledge;
- erasure, export, provider disconnect, retention, encryption/AAD, TTL, and unique-index tests pass;
- the complete GitHub CI-equivalent local gate runs before every commit.

## Deferred work

- native iOS bridge selection and installation;
- HealthKit capability and permission copy;
- local anchors and durable mobile outbox;
- method-aware use of Apple SDNN by the live state classifier;
- versioned v2 migration for Health Connect;
- respiratory rate, workouts, oxygen saturation, temperature, ECG, AFib and clinical records;
- production Atlas index creation, which remains human gated.
