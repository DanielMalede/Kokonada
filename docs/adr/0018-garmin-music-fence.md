# ADR-0018 — The Garmin music fence: nothing from Garmin's Health API shapes the music until Garmin permits it in writing

**Status:** Accepted · 2026-11-22
**Implements:** `DEC-047` (DECIDED 2026-10-28: "עד שיאשרו, לא להשתמש בנתוני Garmin לבחירת מוזיקה.") · `BE-245` · PR #299 (PR-A)
**Related:** `BE-231` (RA-1), `BE-031`, `BE-219`, `OPS-331`, `DAN-015`, `DAN-103`

## Context

`DEC-047` rules that no Garmin value may choose music until Garmin permits it in writing. Nothing in the code
enforced it. A Garmin Health API push reached the stores the music is chosen from:

- `garminIngest.ingestSummaries` → `metricStore.persistMetrics` wrote the per-minute heart rate to
  `BiometricLog`, the resting HR and HRV to `VitalSample`, and the medians and last night's sleep to
  `MedicalProfile`;
- every one of those stores is read by generation: `biosonic/baselines.js` (the personal baselines), the
  state-vector worker (the state vector and the affect posterior, `bio:affect:<userId>`), the daily-analysis
  worker (`MorningState`), `targetsBuilder.buildTargets` and `biometricHandler.resolveBiometricContext`;
- the push also queued `STATE_VECTOR_RECOMPUTE`. That was the one way a Garmin push could set *when* the
  heart branch fires: the recompute advances `bio:affect`, and the next phone reading then sees a changed
  posterior and can fire `recalibrateForBand`, which sends a Spotify discovery request. The "garminPoller"
  that `BE-245`'s update of 2026-11-22 names (`biometricHandler.js:1590-1593`) does not exist: the legacy
  poller was removed (`backend/app/index.js:155-157`); that stale comment is fixed under `BE-231` RA-1 (#298).

Two facts shaped the design:

1. **The label is not the lane.** The phone's live heart rate (a BLE strap, or the Health Connect fallback
   through `watchHrIngest`) is also stored in `BiometricLog` as `source: 'garmin'` (`BE-031`). Garmin's terms
   cover the Health API lane, not a strap the phone reads. A fence keyed on the label in `BiometricLog` would
   silence that lane. (Open, not verified: whether `DEC-047` also covers Garmin-origin heart rate that reaches
   the phone through Garmin Connect's Health Connect sync or a Garmin watch's BLE broadcast; `compliance-auditor`
   reads it in writing on #299, else the owner (c); `BE-245`, RA-4.)
2. **Rows already stored.** A fence at ingest alone leaves any row that reached `VitalSample` before it, or
   some other way, readable by generation.

## Decision

The architect's forks, adopted by the session on 2026-11-22 (base `076cc9a`):

- **DT-1 F2 — quarantine at ingest, plus one read filter.** While permission is not on file, Health API values
  never reach a store generation reads: no `BiometricLog` row, no `MedicalProfile` write, no `lastNightSleep`,
  no `STATE_VECTOR_RECOMPUTE` queued. The two generation readers of `VitalSample` (`baselines.js`
  `_pageDecrypted`, before `_modalTzOffset`; the daily-analysis worker's `_pageVitals`) exclude the fenced
  sources from their queries.
- **DT-2 S1 — a frozen code constant.** `backend/app/services/wearable/garminMusicFence.js`:
  `GARMIN_MAY_SHAPE_MUSIC = false`, opened only by the literal `true` (`=== true`), exporting
  `garminMayShapeMusic()`, `fencedSources()` and `generationVitalQuery()` (the empty object when permitted, so
  a permitted query is byte-identical to today's; `{ source: { $nin: ['garmin'] } }` when fenced). Not an env
  var or a flag (no T8 wire contract, nothing a run can flip). Turning it on is a reviewed PR that flips the
  literal, carrying Garmin's written permission filed per `OPS-331`, `compliance-auditor`'s reading of it, and
  the owner's own approval quoted at the PR's head (T12, owner class (c)).
- **DT-4 L1 — fence by lane, not by label.** The read filter applies to `VitalSample` only. No `BiometricLog`
  reader applies it. `BE-031` must land before the switch is turned on.
- **DT-5 T1 — remove every Garmin trigger by construction.** Nothing is queued while fenced, and the import
  closure of `garminIngest.js` contains no `sockets/` module; both pinned structurally.
- **DT-6 — one switch.**

The owner's answers, 2026-11-22, by option selection in session 4da61bce:

- **O2** — "BE-245 (חסימת Garmin): עד ש-Garmin יאשרו בכתב, נתוני Garmin לא ישמשו לבחירת מוזיקה. השאלה היא מה
  שומרים מהם בינתיים כדי להציג למשתמש." → **"חנות תצוגה מלאה קודם"** (D-B, not the recommended D-A): every
  Garmin value, sleep included, is kept in a separate display-only store that never feeds music selection.
- **O3** — "הוחלט שלא פותחים מפתחות Garmin בפרודקשן כל עוד BE-245 ו-RA-1 פתוחים. אחרי BE-245, הבעיה שנשארת
  ב-RA-1 היא רק עיתוי הבקשה בדופק החי מהטלפון, ולא נתוני Garmin. מספיק BE-245 כדי להסיר את החסימה הזו?" →
  **"לא, גם RA-1"**: the keys halt stays until RA-1 (`BE-231`'s heart-branch timing link) is decoupled too.
- **DB-3** — "\"חנות תצוגה מלאה\": אילו ערכים נשמרים לתצוגה?" → **"כל מה ש-Garmin שולחים"** (V2, not the
  recommended V1): the display store keeps every value Garmin sends (SpO₂, respiration, Body Battery, stress,
  steps and calories included), so PR-B needs a new consent version, declaration and consent-screen changes
  (owner (c)), and lifting the "SpO₂ NOT collected" pins.
- **DB-8** — "סדר הבקשות ל-BE-245: מה קודם?" → **"קודם החסימה, אחר כך החנות (מומלץ)"** (two-F): PR-A the
  fence, then PR-B the store.
- **RA-1** — "איך מנתקים את עיתוי בקשת הגילוי ל-Spotify מהדופק?" → **"מטמון לפי משתמש (מומלץ)"** (R-β), and
  "…ניתוק בקשת הגילוי מספיק כדי לסגור את RA-1?" → **"כן, רק בקשת הגילוי (מומלץ)"**.

The display store's design (the architect's D-B follow-up, base `076cc9a` / `1136341`):

- **DB-1 (b)** — a new collection `HealthDisplaySummary` / `healthdisplaysummaries`, not a `MedicalProfile`
  section (per-minute HR does not fit it, it has no TTL, and every generation reader loads the whole document).
- **DB-2 (ii)** — one document per Garmin summary (dailies, sleeps, HRV, and under V2 every other summary type
  Garmin sends), the values in one `encryptedString` payload (JSON `{ metrics: [{ metric, value, unit, t,
  hrvMethod? }] }`), a closed metric set with ranges, at most 1,440 HR values; unique
  `{ userId, source, summaryType, periodDate }`; a per-summary upsert (no `bulkWrite`, so no T7); a
  `coverageSeconds` guard against an older revision.
- **DB-3** — V2, by the owner's answer above.
- **DB-4 I2** — `autoIndex: false`, `autoCreate: false`; the owner builds the indexes (Pause & Guide) before
  keys open; writes are refused until the indexes exist (`listIndexes`, cached; a negative result cached
  5 minutes).
- **DB-5 R-c** — a TTL of 90 days on `recordedAt` (the end of the period), pinned equal to the
  `VitalSample` and `BiometricLog` defaults.
- **DB-6 A2** — repository read functions and a DTO now; the HTTP route comes with the display page's
  `/page` G0.
- **DB-7 P1** — when the switch opens, write both stores; never re-derive display → generation.
- **DB-8 two-F** — PR-A (this ADR's code, no owner class) → PR-B (T4, T5, T6, T8, J12/J17/J18: owner (b) and
  (c)). PR-B requires T0 to confirm that no Garmin key or webhook secret is set in production.

**PR-A (#299), as built.** The D-B follow-up drops PR-A's earlier `vitalsOnly` idea: `metricStore.js` is
unchanged. While fenced, `ingestSummaries` runs the Art. 9 consent gate and the consent-version gate, never
calls `persistMetrics` (so no `BiometricLog`, `VitalSample` or `MedicalProfile` write and nothing queued),
returns `{ fenced: true, fencedDropped: N }` and logs one count-only line, `[garmin] fenced metrics=N` (no user
id, no value; T1). Until PR-B lands, Garmin's values are not kept at all.

## PR-B — the approved-plan text (owner classes (b) and (c))

Written out here so the owner's approval of PR-B can name this file's blob SHA (`CLAUDE.md`, class (b): "an
approved plan is a file whose path and blob SHA the owner's approval names; a step changed since is not
approved"). Until he approves it in his own words at a named SHA, nothing below is approved.

- **B0 — prerequisites.** `regulatory-researcher`'s brief on RQ-1 (is keeping Garmin data purely for display
  covered by the current consent, whose purpose is "biometric-adaptive playlist generation",
  `docs/PRIVACY_DECLARATIONS.md:53`?); under V2 the answer is a new consent version in any case, so the consent
  text, `CURRENT_CONSENT_VERSION`, the consent screen (`CONSENT_SCREEN_VERSION`), the declarations and the
  store declarations change first, each with the owner's (c) at its PR's head (rows J12 and J18; T4, T11).
  T0 recorded (below).
- **B1 — the model.** `backend/app/models/HealthDisplaySummary.js`, collection `healthdisplaysummaries`, as
  DB-1, DB-2 and DB-5 say, with `autoIndex: false` and `autoCreate: false` (DB-4). New user-data schema path
  (T4) and new collection (T8): `architect`, `security-auditor`, `regulatory-researcher`, owner (c).
- **B2 — the repository.** `backend/app/repositories/healthDisplayRepo.js`: a per-summary upsert with the
  `coverageSeconds` guard, refusing writes until both indexes exist (DB-4); read functions and a DTO (DB-6).
  It is imported only by `garminIngest.js`.
- **B3 — the seam.** `garminIngest.ingestSummaries`, after both consent gates and the new version's gate for
  the V2 metrics: while fenced, write the display store only; once the switch opens, write both (DB-7). The
  generation stores never read the display store.
- **B4 — erasure and export (T6).** `eraseWearableProvider(user, 'garmin')`, account deletion
  (`gdpr-delete.js`: `deleteMany`/`countDocuments`), consent withdrawal, the orphan sweep (`CASCADE_MODELS`)
  and `userDataExport` (`COLLECTIONS`) cover the new collection; `security-auditor`, owner (b) for the
  production deletion paths.
- **B5 — the structural guard.** The model's importers on an allow-list with each one's allowed use (the
  repository: any; `erasure`/`wearableErasure`: `.deleteMany` only; `orphanSweep`: `CASCADE_MODELS` only;
  `userDataExport`: `COLLECTIONS` only; `gdpr-delete.js`: `deleteMany`/`countDocuments`); the repository
  imported only by `garminIngest.js`; no lookup by name; the generation closures (`targetsBuilder`,
  `orchestrator`, `geminiEngine`, `biometricHandler`, `baselines`, `affectService`, `dailyAnalysis`,
  `stateVector`, `liveStateAdapter`, `discoveryFetch`, `medicalProfileService`) contain neither the repository
  nor `userDataExport`; `purgeOrphanedAggregates` counts unchanged. The espree walker of
  `backend/tests/shadow.fullSystem.test.js` and `garminMusicFence.structural.test.js` is reused.
- **B6 — the index build (T5, J17), an owner Pause & Guide.** A script under `backend/scripts/` creates the
  unique index `{ userId: 1, source: 1, summaryType: 1, periodDate: 1 }` and the TTL index
  `{ recordedAt: 1 }, { expireAfterSeconds: 7776000 }` on `healthdisplaysummaries`; the owner runs it against
  production himself, step by step, and the result is checked with `listIndexes` (names, keys and
  `expireAfterSeconds` only, never a document) and recorded on the keys-open row. `security-auditor` and
  `resilience-auditor` review the script; owner (b).
- **B7 — the records.** The declarations row of `docs/PRIVACY_DECLARATIONS.md:53` and the store declarations
  name the display store, its retention and its purpose (display only until Garmin permits), with the
  owner's (c); the "SpO₂ NOT collected" pins (`backend/tests/wave4.retentionDocs.test.js`) are lifted only by
  that same change.

**T0 (the owner, read-only counts).** `VitalSample { source: 'garmin' }`, `User { garminUserIdHmac:
{ $ne: null } }`, `BiometricLog { source: 'garmin' }`, and the names (never the values) of any `GARMIN_*`
variable on Railway. The `BiometricLog { source: 'garmin' }` count is expected non-zero, by design: the
phone's BLE and Health Connect fallback lane stores its live heart rate as `garmin` (`BE-031`,
`backend/app/controllers/integrationsController.js:856`), so it says nothing about the Health API. The deciding
evidence that no Health API data ever reached a derived store is `VitalSample { source: 'garmin' }` = 0,
`User { garminUserIdHmac: { $ne: null } }` = 0, and no `GARMIN_WEBHOOK_SECRET` name on Railway: without it the
webhook answers 503 (`integrationsController.js:563-565`).

**Keys open** only after PR-A, PR-B and RA-1 have merged, the owner's index build is verified with
`listIndexes`, the deregistration and permission-change handling (`BE-219`) has landed, and T0 is recorded.

## Consequences

- While the switch is closed, a Garmin push is acknowledged (200, counted) and dropped whole: the user sees no
  Garmin value anywhere until PR-B. Health Connect, the phone's live heart rate and every other lane are
  unchanged.
- The Garmin half of `BE-231` RA-1 is closed by construction: a Garmin push queues nothing and reaches no
  socket module, so it can neither move a posterior nor time a request. RA-1's other half, the phone's live
  heart rate timing the discovery request, is its own claim (R-β, #298).
- A permitted query is byte-identical to today's (`generationVitalQuery()` is `{}`), so opening the switch
  restores the old behaviour exactly; the integration suite proves it with the fence mocked open.
- `$nin` on `source` is a residual filter on the readers' existing `{ userId, recordedAt }` scans: no new
  index (no T5 in PR-A).
- Pinned by `backend/tests/garminMusicFence.unit.test.js` (closed by default, frozen, the literal tripwire,
  only `=== true`, no run-time override), `garminMusicFence.integration.test.js` (real Mongo: the quarantine,
  the read filter, and the end-to-end equality with a Health Connect-only control) and
  `garminMusicFence.structural.test.js` (every `VitalSample` read outside a file-by-file allow-list carries the
  filter in its own query, and the model or its collection reached by name fails; the seam's closed-fence return
  comes before `persistMetrics`, which only the two ingest lanes name; no `BiometricLog` reader is fenced; no socket module in
  the seam's closure; each rule also run on a mutated copy). The existing Garmin suites pin the permitted
  pipeline with the fence mocked open.
