# HealthKit Data Contract Foundation Design

## Intent

Kokonada needs an iOS HealthKit lane that can later synchronize Apple Watch data without breaking the existing Android Health Connect lane, weakening explicit health-data consent, or silently broadening collection. The first implementation increment is the server contract foundation only. It does not install an iOS package, request HealthKit permission, or collect a new metric.

## Current state

`POST /api/integrations/health/batch` currently accepts `{ platform, samples }`, recognizes heart rate, resting heart rate, generic HRV and three sleep-stage duration types, and caps a request at 2,000 samples. It identifies stored readings by source and timestamp. It does not retain a HealthKit object UUID, distinguish Apple SDNN from Android RMSSD, process deleted HealthKit objects, version the wire contract, or make a whole batch retry idempotent.

The shipped Android client posts the unversioned body and hardcodes `platform: 'health_connect'`. That flow must remain compatible throughout this increment.

## Decision

Add a versioned v2 envelope beside the existing unversioned request. Legacy requests remain accepted and unchanged. A v2 request has:

```json
{
  "schemaVersion": 2,
  "batchId": "UUID",
  "platform": "healthkit",
  "samples": [
    {
      "sampleId": "HealthKit HKObject UUID",
      "operation": "upsert",
      "type": "heart_rate",
      "value": 72,
      "unit": "bpm",
      "startDate": "2026-10-06T06:30:00.000Z",
      "endDate": "2026-10-06T06:30:00.000Z",
      "tzOffsetMinutes": 180,
      "method": null
    }
  ]
}
```

The first increment accepts and processes v2 `upsert` samples through the existing persistence lane. It validates the new identity and method fields but does not yet claim sample-level idempotency, because that requires persistent identity fields and migration/index review.

A batch containing any `delete` operation fails atomically with HTTP `501` and `{ "error": "health_delete_not_implemented" }` before any sample is written. Returning success while ignoring a deletion is forbidden. Persistent tombstones and aggregate recomputation belong to the next server-storage increment.

## Validation rules

- `schemaVersion`, when present, must equal `2`.
- A v2 `batchId` is a non-empty UUID string.
- `platform` remains `healthkit` or `health_connect`.
- `samples` must be an array of at most 2,000 items.
- Every v2 sample has a UUID `sampleId` and `operation` of `upsert` or `delete`.
- An upsert also has a recognized type, finite numeric value and valid ISO timestamps.
- `method` is required for HRV: `sdnn` for HealthKit and `rmssd` for Health Connect. Other metrics omit it.
- Existing unversioned requests keep their current tolerant normalizer behavior for backward compatibility.
- Validation errors contain no submitted physiological value and write nothing.

## Response behavior

Legacy responses remain unchanged. A successful v2 response echoes only non-sensitive operational identity: `schemaVersion: 2` and `batchId`, plus the existing counts. It never echoes individual samples or values.

## Privacy boundary

This increment does not add ECG, AFib burden, oxygen saturation, respiratory rate, wrist temperature, workouts, routes or clinical records. It does not request write access. Existing consent middleware remains in front of the endpoint. Logs may contain counts, platform, schema version and batch ID, but never a sample ID, value, timestamp, device name or source metadata.

## Compatibility and rollout

The v2 path is additive. Health Connect continues using its legacy request until its client is deliberately migrated. HealthKit has no shipped reader, so its future client starts on v2. No package or native capability is added in this increment.

## Verification

- Pure contract tests cover legacy compatibility, valid v2 batches, malformed envelopes, HRV-method separation, the 2,000-item boundary and atomic delete refusal.
- Controller tests prove invalid or delete-bearing batches never call persistence.
- Existing health-store, consent and zero-knowledge log tests remain green.
- The full backend suite and lint run before commit; the PR must be green at its current head before merge.

## Deferred work

- Persist `sampleId` and batch idempotency safely.
- Store tombstones and recompute affected aggregates after deletes.
- Decide and migrate the canonical HRV storage model so SDNN and RMSSD never share an unlabeled baseline.
- Run the `@kingstinct/react-native-healthkit` compatibility spike.
- Add HealthKit capability, purpose text, anchored queries, an outbox and background delivery.
- Verify on a signed real-device build paired with an Apple Watch.
