# Offline HealthKit contract spike — synthetic only

This isolated experiment asks whether documented native bridge objects can map into Kokonada's **existing** HealthKit `schemaVersion: 2` contract. It runs on Windows with Node, using only built-in modules and the real pure server validator (`backend/app/services/wearable/healthBatchContract.js`). It does not install or import a native library and is not shipped mobile functionality.

From the repository root:

```powershell
node scripts/healthkit-spike/cli.js --scenario demo
node scripts/healthkit-spike/cli.js --scenario empty
node scripts/healthkit-spike/cli.js --scenario invalid-unit
```

All fixtures are synthetic, including UUIDs, dates, quantities, source/device information and anchor strings. The demo uses a fixed synthetic clock and fixed batch UUIDs for reproducibility. Output contains aggregate counts, a verdict and limitations only; no health values, sample UUIDs, dates, source names or anchor contents are logged. The CLI accepts only built-in scenarios, never a real-data file.

Exit codes: `0` = the synthetic payload satisfies the server contract (including a valid empty result); `1` = rejected input; `2` = invalid CLI arguments. An empty response means **no visible data**, and does not establish whether read permission was granted or denied.

## Documented shape under test

The research candidate is `@kingstinct/react-native-healthkit` **16.0.0**, npm `gitHead` **6473f892c48dece1adbca978513b3e75d5041e48**. This spike neither installs the candidate nor proves its compatibility with Kokonada's React Native version, iOS configuration, native build or release build. See the [research record](../../docs/research/apple-healthkit-integration-research.md) for the verified source references and remaining native questions.

The adapter accepts one query result with `{ samples, deletedSamples, newAnchor }`, a query `identifier`, a caller-supplied batch UUID and a valid `Date` clock. Quantity samples carry `uuid`, `startDate: Date`, `endDate: Date`, `quantityType`, numeric `quantity` and `unit`. Sleep samples carry `categoryType` and numeric `value`. Deletions carry `uuid`, with no original sample required. The demo also supplies documented base fields (`sampleType`, `sourceRevision`, `device`, `metadata`, `hasUndeterminedDuration`) to exercise their exclusion from the payload.

| Query identifier | Requested native unit / category | Server sample |
|---|---|---|
| `HKQuantityTypeIdentifierHeartRate` | `count/min` | `heart_rate`, `bpm` |
| `HKQuantityTypeIdentifierRestingHeartRate` | `count/min` | `resting_heart_rate`, `bpm` |
| `HKQuantityTypeIdentifierHeartRateVariabilitySDNN` | `ms` | `hrv`, `ms`, `method: sdnn` |
| `HKCategoryTypeIdentifierSleepAnalysis` | core `3`, deep `4`, REM `5` | `sleep_light`, `sleep_deep`, `sleep_rem`, duration in `min` |

In-bed `0`, asleep-unspecified `1` and awake `2` are excluded deliberately. Unspecified sleep is not relabeled as core. Unknown categories, wrong identifiers or units, malformed UUIDs/results/anchors, nonfinite quantities, invalid or reversed dates and more than 2,000 incoming operations are rejected. The real server validator enforces its physiological ranges, sleep interval limits, future-skew boundary, batch ID and HRV method. Valid dates are serialized to canonical ISO timestamps; native UUID spelling is preserved. Upserts precede deletions, so a deleted UUID is not accidentally resurrected within the payload.

`normalizeAnchoredResult` returns `{ payload, pendingAnchor, counts, readOutcome }`. The payload uses a strict whitelist and drops source, device and arbitrary metadata. `pendingAnchor` is the unchanged opaque `newAnchor` candidate. It is never persisted or advanced; this experiment cannot establish a safe durable checkpoint or retry protocol.

## Verification boundary

Backend Jest tests exercise the adapter and the **real** `parseHealthBatchRequest`, plus CLI process output and exit codes:

```powershell
cd backend
npm test -- --runTestsByPath tests/healthkitSpike.test.js
```

The synthetic test result proves only offline normalization and server-contract compatibility. No network request, database write, OS permission call, HealthKit read, persisted anchor or production app import occurs. This is not proof of iPhone/Apple Watch availability, historical permission state, native library behavior, native/release build compatibility, delivery to the server or durable syncing. Those require a separately approved native implementation and real-device evidence; a green synthetic test does not close them.
