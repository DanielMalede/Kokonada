# Apple HealthKit Integration Research

**Status:** server authoritative-store prerequisite implemented in draft PR #232; no iOS dependency, entitlement, permission, or HealthKit reader was added

**Date:** 2026-10-06
**Task:** MB-900 (`MB-105` is a separate Health Connect history-window task)

## Executive recommendation

Kokonada should add Apple HealthKit as a read-only iOS source in a deliberately small first release. The first useful scope is:

- heart rate;
- resting heart rate;
- HRV as Apple SDNN, kept semantically separate from Health Connect RMSSD;
- sleep stages: core/light, deep, and REM.

Respiratory rate and workouts are strong candidates for a later server-contract increment. Oxygen saturation, sleeping wrist temperature, ECG, AFib burden, heart-rate events, routes, and clinical records should not enter the first release. They have extra device, regional, medical-sensitivity, storage, or product-purpose questions that the current Kokonada model does not answer.

The preferred bridge candidate is `@kingstinct/react-native-healthkit`, but it must pass an isolated native build and real-device spike before adoption. Its current package metadata is compatible with Kokonada's React 19 and React Native 0.86 versions, and it exposes anchored queries plus deleted samples. It also introduces Swift, `react-native-nitro-modules`, HealthKit capability changes, CocoaPods changes, and an unresolved minimum-iOS question. Package installation is therefore a decision gate, not a research conclusion.

## Current Kokonada state

The mobile app is a bare React Native application, not Expo managed:

- React Native `0.86.0`;
- React `19.2.3`;
- TypeScript `5.8.3`;
- native `ios/` project and Podfile are committed;
- iOS deployment target is currently `15.1`;
- no HealthKit entitlement exists;
- no HealthKit usage description exists in `Info.plist`;
- Android already uses `react-native-health-connect` and reads six months of heart rate, resting heart rate, RMSSD HRV, and sleep.

The server now has the complete additive v2 storage prerequisite for a future HealthKit client. It persists keyed sample identity in the encrypted `HealthSample` collection, applies idempotent upserts and deletion tombstones, keeps SDNN distinct from RMSSD in the read model, rebuilds supported derived values, repairs interrupted projections, and covers account/provider erasure, owner export and 90-day retention. The legacy Health Connect v1 path remains unchanged; Health Connect v2 is explicitly rejected until it receives its own implementation decision.

The three production indexes required by this collection are documented in `docs/runbooks/health-sample-index-rollout.md`. Creating and visually verifying them in MongoDB Atlas is an owner action; this PR does not mutate production.

## HealthKit is a store, not an Apple Watch API

HealthKit data on the iPhone may come from Apple Watch, the user, another app, or another device. A type being present in HealthKit does not prove Apple Watch measured it.

For each sample, the future adapter should retain enough local information to make a source decision before upload:

- HealthKit object UUID;
- `sourceRevision` and source bundle identifier;
- `device`, when present;
- start and end dates;
- time-zone metadata where relevant;
- only explicitly allow-listed metadata.

The server contract should receive a normalized, privacy-minimized representation. It should not receive arbitrary HealthKit metadata.

## Metric map

| Kokonada concept | HealthKit identifier | Shape and unit | Likely source | Server status | Recommendation |
|---|---|---|---|---|---|
| Heart rate | `HKQuantityTypeIdentifierHeartRate` | quantity, count/min | Apple Watch, external sensor, apps | supported as `heart_rate` | MVP |
| Resting heart rate | `HKQuantityTypeIdentifierRestingHeartRate` | quantity, count/min | Apple-computed or other source | supported as `resting_heart_rate` | MVP |
| HRV | `HKQuantityTypeIdentifierHeartRateVariabilitySDNN` | quantity, ms, SDNN | Apple Watch/HealthKit sources | authoritative and projected rows preserve `sdnn`; RMSSD baselines remain separate | MVP server prerequisite complete; native reader pending |
| Sleep | `HKCategoryTypeIdentifierSleepAnalysis` | category intervals | Apple Watch, apps, manual data | deep/light/REM supported | MVP; map `asleepCore` to light and ignore awake/in-bed/unspecified initially |
| Respiratory rate | `HKQuantityTypeIdentifierRespiratoryRate` | quantity, count/min | automatically recorded on Apple Watch when available | not accepted by v2 contract | next candidate |
| Workout | shared `HKWorkoutType` | activity, duration, statistics | Apple Watch and apps | no storage model | next candidate, separate contract |
| Oxygen saturation | `HKQuantityTypeIdentifierOxygenSaturation` | quantity, percent | supported watches/devices/apps; availability varies | no approved v2 type | defer |
| Sleeping wrist temperature | `HKQuantityTypeIdentifierAppleSleepingWristTemperature` | nightly quantity, temperature | supported Apple Watch models while sleeping | no approved v2 type | defer |
| ECG | `HKElectrocardiogramType` | ECG sample and voltage series | supported watch/region | no model | defer; medically sensitive and structurally different |
| AFib burden | `HKQuantityTypeIdentifierAtrialFibrillationBurden` | percentage estimate | supported Apple Watch/region/settings | no model | defer; medically sensitive |
| High/low/irregular rhythm events | HealthKit category identifiers | event categories | Apple Watch notifications | no model | defer |
| Clinical records | `HKClinicalTypeIdentifier` family | FHIR clinical records | healthcare providers, not Apple Watch | no model | exclude |

## Sleep mapping rules

HealthKit sleep samples are intervals with category values. They can overlap an `inBed` interval, while detailed awake/core/deep/REM intervals do not overlap each other. Apple warns that Watch-generated awake samples may be absent at the beginning or end of an in-bed interval.

The first adapter should:

- map `asleepCore` to `sleep_light`;
- map `asleepDeep` to `sleep_deep`;
- map `asleepREM` to `sleep_rem`;
- ignore `inBed`, `awake`, and `asleepUnspecified` until the server has explicit types;
- compute minutes from the interval, not trust a supplied aggregate;
- keep the HealthKit UUID on each stage interval;
- never infer that missing awake intervals mean uninterrupted sleep.

## Authorization behavior

HealthKit requires permission per data type. Kokonada should request read access only for the approved MVP types and pass an empty write set.

Important product behavior:

- `requestAuthorization` succeeding means the permission workflow completed, not that every read permission was granted.
- Apple intentionally prevents an app from determining that read access to a specific type was denied. A denied type generally looks like an empty query.
- Users may grant only a limited historical window. The app should query the earliest authorized sample date and avoid describing missing older data as absent health history.
- Permission can change at any time in Settings or Health.
- The UI must distinguish “no readable samples” from “pipeline error,” but it must not claim it knows the user denied read permission.
- Missing HealthKit usage descriptions can crash the app when authorization is requested.

Suggested read-only permission copy should explain, in plain language, that Kokonada reads heart rate, resting heart rate, HRV, and sleep to personalize its state and music experience. Final copy needs product and privacy approval before implementation.

## Incremental synchronization

Use one persisted anchor per HealthKit type and authorization context.

1. On first sync, query only the permitted history window and page/chunk the result.

2. Normalize every added sample to the v2 contract, using the HealthKit UUID as `sampleId`.

3. Upload no more than 2,000 operations per batch and keep the batch in a durable local outbox until the server acknowledges it.

4. Advance the local HealthKit anchor only after every batch derived from that query result is durably acknowledged.

5. On later syncs, reuse the anchor to receive only added and deleted objects.

6. The server prerequisite is now implemented: it persists sample identity, makes retries idempotent, and processes tombstones. Production anchored sync must still wait for the Atlas index rollout and the native outbox/anchor implementation and real-device verification.

Deleted HealthKit objects are not permanent history. Apple may eventually remove deletion records, so background observation plus anchored follow-up is required if Kokonada promises deletion fidelity.

## Background delivery

Background delivery is separate from ordinary reads. On current Apple platforms it requires the HealthKit background-delivery entitlement. HealthKit may wake the app when matching samples are added or deleted, subject to the requested delivery frequency and system scheduling.

For Kokonada, background delivery should be a later increment after foreground anchored sync is proven. The background callback should enqueue work and complete promptly; it should not perform an unbounded six-month query or assume immediate network availability.

Health data is commonly unavailable while the phone is locked. Real-device verification must include locked-device behavior and protected-data retry handling.

## Bridge assessment

### Candidate: `@kingstinct/react-native-healthkit`

Current upstream package metadata observed on 2026-10-06:

- package version `16.0.0`;
- peer dependency React `>=19`;
- peer dependency React Native `>=0.79`;
- peer dependency `react-native-nitro-modules >=0.35`;
- anchored quantity queries return `samples`, `deletedSamples`, and a serializable anchor;
- bare React Native installation requires the main package, `@react-native-healthkit/core`, and `react-native-nitro-modules` to be explicit dependencies for CLI autolinking;
- installation requires CocoaPods, usage descriptions, and the HealthKit Xcode capability;
- the package is MIT licensed.

This is the best current candidate because it maps closely to native HealthKit, supports TypeScript, exposes UUID/deletion/anchor primitives, and fits the existing bare React Native architecture.

It is not yet approved for adoption. The spike must prove:

- CocoaPods installation with Kokonada's targeted modular-header workaround;
- compilation under the project's Xcode/Swift toolchain;
- compatibility with React Native 0.86's New Architecture;
- whether the current iOS `15.1` deployment target is supported or must be raised;
- no launch crash on the supported iOS versions;
- correct UUID, source, device, unit, start/end, and deleted-sample serialization;
- foreground anchor round-trip after app restart;
- behavior when a read type is denied or history is limited;
- signed-device behavior; the simulator is insufficient for the final decision.

Upstream issue history contains recent reports around iOS 26, Nitro/Swift module imports, and background-delivery integration. These reports are not proof that Kokonada will fail, but they make a compiled spike mandatory before package adoption.

### Native Swift wrapper fallback

If the package spike fails, build a narrow native module rather than adopting a second broad abstraction. The wrapper would expose only:

- HealthKit availability;
- read-only authorization for the approved identifiers;
- earliest authorized sample dates;
- anchored quantity and sleep queries;
- serialized anchors;
- deleted UUIDs;
- foreground observer notification.

This costs more maintenance but gives Kokonada control over the exact contract and avoids exposing unsupported HealthKit surfaces.

## Recommended delivery sequence

1. **Complete in PR #232:** server identity storage and idempotent upsert semantics.

2. **Complete in PR #232:** tombstones, aggregate recomputation, repair worker, v2 delete operations and privacy lifecycle coverage. Before deployment, Daniel or Malede creates and verifies the production indexes using the runbook.

3. Run the bridge spike on a temporary branch without changing production screens.

4. Add a platform-neutral health-source port so Android Health Connect and iOS HealthKit have separate native readers but share normalization, upload, outbox, diagnostics, and UI state.

5. Add read-only HealthKit capability and final permission copy.

6. Implement foreground anchored synchronization for the four MVP concepts.

7. Verify on a signed iPhone paired with Apple Watch using real and partial-permission data.

8. Add background delivery only after foreground correctness and deletion fidelity are proven.

## Real-device acceptance checklist

- Fresh install with no prior HealthKit authorization.
- Full read approval for all MVP types.
- One or more types withheld; app stays honest and usable.
- Limited historical window.
- No Apple Watch data for one metric.
- Apple Watch-origin and third-party-origin samples in the same HealthKit store.
- App restart preserves anchors and does not re-upload acknowledged samples.
- Network failure preserves the outbox and retries without duplication.
- HealthKit deletion reaches the server and removes/recomputes derived state.
- Background update while the app is suspended.
- Device locked during delivery and unlocked retry.
- Permission revoked after a successful sync.
- Batch size above 2,000 is chunked rather than rejected.

## Decision gates

No native implementation should begin until these decisions are approved:

- whether the product accepts a possible increase in minimum iOS version;
- final read-only permission copy and privacy disclosure;
- whether samples from non-Apple sources are accepted, filtered, or labeled;
- whether the first iOS release accepts non-Apple HealthKit sources, filters them, or labels them;
- whether respiratory rate and workouts belong in the first product release or a later contract.

Resolved on the server side in PR #232: Apple HRV is preserved as SDNN rather than mixed into RMSSD baselines; authoritative samples and tombstones use a 90-day expiry; deletes rebuild the supported read models; provider/account erasure and owner export include the new collection.

## Primary sources

- [Apple: Setting up HealthKit](https://developer.apple.com/documentation/healthkit/setting-up-healthkit)
- [Apple: Authorizing access to health data](https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data)
- [Apple: HealthKit data types](https://developer.apple.com/documentation/healthkit/data-types)
- [Apple: Sleep analysis type](https://developer.apple.com/documentation/healthkit/hkcategorytypeidentifier/sleepanalysis)
- [Apple: Sleep analysis values](https://developer.apple.com/documentation/healthkit/hkcategoryvaluesleepanalysis)
- [Apple: Executing anchored object queries](https://developer.apple.com/documentation/healthkit/executing-anchored-object-queries)
- [Apple: Deleted HealthKit objects](https://developer.apple.com/documentation/healthkit/hkdeletedobject)
- [Apple: Background delivery](https://developer.apple.com/documentation/healthkit/hkhealthstore/enablebackgrounddelivery(for:frequency:withcompletion:))
- [Apple: Workouts and activity rings](https://developer.apple.com/documentation/healthkit/workouts-and-activity-rings)
- [Apple: Sleeping wrist temperature](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/applesleepingwristtemperature)
- [Kingstinct: React Native HealthKit](https://github.com/kingstinct/react-native-healthkit)
- [Kingstinct package metadata](https://github.com/kingstinct/react-native-healthkit/blob/master/packages/react-native-healthkit/package.json)
