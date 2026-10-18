---
status: living
verified: 2026-10-18
---

# Compliance HALTs

The open compliance HALT items raised by `compliance-auditor` on 2026-08-26, one section each, in alphabetical order of their original file names. Each item's status of record is its `TASKS.md` rows (last column); the text below is the original write-up, kept verbatim with its headings one level down. New HALT items are new sections here, never new files (`README.md` § Where a new file goes).

| Item | Raised | Status (as last written in the item) | TASKS rows |
|---|---|---|---|
| [HALT — Consent version, retention truth, and the store declarations](#consent-version-retention-and-declarations) | 2026-08-26 by `compliance-auditor`, re-auditing the five scr | canvas items fixed 2026-08-26 (marked DONE). Shipped items not started. | `BE-016`, `BE-020`, `UI-005`, `UI-012` |
| [DEV ITEM — Expose three consent fields the server already stores](#consent-field-exposure) | 2026-08-26, from the screen-13 (Health Data Vault) design re | not started. | `BE-164` |
| [HALT — Garmin branding, attribution, and a 30-day notice clock that has not started](#garmin-brand-and-attribution) | 2026-08-26 by `compliance-auditor` | canvas items fixed 2026-08-26 (marked DONE below). Everything else not started. | `BE-013`, `OPS-041`, `DAN-009`, `DAN-022` |
| [HALT — Account deletion leaves the Garmin registration live](#garmin-deregistration-on-delete) | 2026-08-26 | not started. **Not a canvas item.** Surfaced during the screen-13 design review; it is a backend defect and be… | `DAN-009` |
| [HALT — Health Connect / Play blockers: five in shipped Android code (2026-08-26), and the Play account type (2026-10-04)](#health-connect-play-blockers) | 2026-08-26 by `compliance-auditor`, all sources fetched that | (2026-10-04, `e4743af`) HALT 1–3 are fixed in code by HX-5 (#208) (`PermissionsRationaleActivity.kt:72-85`; `A… | `MB-034`, `MB-035`, `MB-093`, `OPS-143`, `DAN-015` |
| [HALT — Sign in with Apple cannot work: the iOS entitlement does not exist](#sign-in-with-apple-entitlement) | 2026-08-26 by `compliance-auditor`, verified against App Rev | not started. | `DAN-011` |
| [HALT — Spotify track IDs are transmitted to a third-party API, live](#spotify-track-ids-to-third-party) | 2026-08-26 by `compliance-auditor`, sources fetched that day | unresolved. **Must not reach production unresolved.** | `BE-043` |
| [HALT — YouTube: no brand attribution, no token revocation, and we call it the wrong product](#youtube-attribution-and-revocation) | 2026-08-26 by `compliance-auditor` | canvas items fixed 2026-08-26 (marked DONE). Shipped items not started. | `BE-022`, `MB-037`, `UI-003` |

---

<a id="consent-version-retention-and-declarations"></a>
## HALT — Consent version, retention truth, and the store declarations
_Was `docs/plans/HALT_CONSENT_VERSION_RETENTION_AND_DECLARATIONS.md` until 2026-10-18 (`docs/ARCHIVE.md` § Moved); its history is under that path._

**Raised:** 2026-08-26 by `compliance-auditor`, re-auditing the five screens closed without a compliance pass.
**Severity:** one item (C3) is a **live production failure**, not a redesign risk.
**Routing:** `developer` under TDD → `resilience-auditor` → `compliance-auditor` re-audit. C4 and C5 need a human (Play Console, App Store Connect, legal).
**Status:** canvas items fixed 2026-08-26 (marked DONE). Shipped items not started.

---

### C1 · The retention statement was false in either reading — canvas DONE, shipped still wrong

**Requirement** — GDPR Art. 13(2)(a): "the period for which the personal data will be stored, or if that is not possible, the criteria used to determine that period." Art. 4(11): consent must be "informed".

**Ground truth, verified file by file:**

| Thing | Retention | Survives withdrawal? |
|---|---|---|
| Readings (`BiometricLog`) | 90-day TTL — `models/BiometricLog.js:43-44` | no |
| **Physiological baseline** (`MedicalProfile`) | **no TTL index at all** | no — deleted on withdrawal |
| Music-learning coefficients (`PersonalWeights`, `RewardEvent`) | 365-day inactivity TTL — `models/PersonalWeights.js:98-99` | **yes — deliberately excluded**, `services/privacy/wearableErasure.js:62-82` |

The canvas said *"The baseline goes after a year without you. Both go if you withdraw."* Read "baseline" as the physiological profile and the first clause is false — it has no expiry. Read it as the music overlay and the second is false — it survives withdrawal by design. **There is no reading in which the sentence is true**, and it errs toward overstating deletion, which is the damaging direction. A false retention statement *inside* the Art. 9 notice contaminates the consent it collects.

**Canvas: DONE.** The KEPT row and §6 now separate the three lifetimes explicitly, say plainly that withdrawing health consent does **not** delete what the app learned about your music, and give the reason (it is learned from what you skipped and saved, not from your body). Uncomfortable and true; saying it costs less than being found out. §6 also now states the `ConsentRecord` retention, which was missing.

**Product decision, not a copy edit:** if the intent is "everything goes on withdraw", change the **code** — add `PersonalWeights` and `RewardEvent` to withdrawal erasure. That is a deliberate exclusion today, so it is the owner's call, not the developer's.

### C2 · Shipping the new copy without a version bump breaks Art. 7(1) — and the bump is booby-trapped

**Requirement** — Art. 7(1): "the controller shall be able to demonstrate that the data subject has consented." EDPB 05/2020 paras 107-108: retain consent statements, timestamps, workflow documentation, **and copies of the information presented at the time of consent**.

The shipped notice (`ConsentSheet.tsx:36-73`) is six sections. The canvas notice is eight, with different retention wording and named sub-processors. Both would record as `CONSENT_SCREEN_VERSION = 1` (`consentApi.ts:56`) against `CURRENT_CONSENT_VERSION = 1` (`consent.js:14`). **Two materially different documents under one version number destroys the proof the version number exists to carry.** The cross-package guard catches client-vs-server drift, never copy-vs-version drift.

**Fix:** bump both constants in lockstep, and archive the exact text per version as a versioned constant or fixture pinned by test, so "v2" resolves to a document.

#### Read this before bumping

`GARMIN_CONSENT_MIN_VERSION = 2` (`consent.js:26`) is the gate that currently **drops** `spo2 / respiratory_rate / body_battery` at Garmin ingest. The comment at `consent.js:21-22` states the design plainly: *"It sits ABOVE CURRENT_CONSENT_VERSION on purpose: flipping the lane live means bumping CURRENT_CONSENT_VERSION."*

So bumping `CURRENT_CONSENT_VERSION` 1 → 2 **for copy reasons would flip the Garmin special-category lane live** while Garmin production approval is still pending.

`backend/tests/garminConsentVersionGate.test.js:59` asserts `GARMIN_CONSENT_MIN_VERSION > CURRENT_CONSENT_VERSION` and will fail the build. **That failure is the guard working. Do not edit the assertion.**

**Correct move — SUPERSEDED, see below.** The original prescription was `CURRENT_CONSENT_VERSION = 2` **and** `GARMIN_CONSENT_MIN_VERSION = 3`, with `CONSENT_SCREEN_VERSION = 2` client-side in the same commit.

**The owner has chosen `CURRENT_CONSENT_VERSION = 3` and `GARMIN_CONSENT_MIN_VERSION = 4`** (2026-08-29), with `CONSENT_SCREEN_VERSION = 3` client-side in the same commit. Both forms hold the invariant `min > current`, so `garminConsentVersionGate.test.js:58` passes either way; 3/4 was chosen to leave a clear gap. **The two prescriptions must not be left disagreeing** — this doc is the discoverable internal rule, and a discoverable rule contradicted by the shipped code is the posture this plan itself warns against at the Decline rule.

**Deploy hazard, added by `compliance-auditor`:** the server bump must be sequenced *behind client adoption*. `recordConsent` rejects any `clientVersion !== CURRENT_CONSENT_VERSION` with `stale_client` and writes no row (`consent.js:44-46`). On a server-only bump every existing grantor becomes `staleVersion: true`, which hard-blocks all ingestion — sockets, the Garmin webhook, and the Apple/health batch via `requireConsent` — while users on an older binary cannot re-grant, because their `clientVersion: 1` is rejected. That is a health-lane outage they cannot escape until they update. Ship the client carrying `CONSENT_SCREEN_VERSION = 3` first, then bump the server.

### C3 · LIVE — placeholder legal copy is being recorded as consent v1 right now

This predates the redesign and is the worst finding in the re-audit.

`ConsentSheet.tsx:16` and `:34` both carry the banner **`PLACEHOLDER COPY — final legal wording pending compliance-auditor + legal review`**. It is shipped. Its retention section (`:58`) reads:

> "We keep only what personalisation needs and no longer. Raw samples are minimised over time…"

**No period. No criteria.** That fails Art. 13(2)(a) in production, today, for every user who has already granted.

**This argues for accelerating the new copy, not delaying it** — with C2's version bump attached. Every day the placeholder stands is another set of grants recorded against a document that was never meant to be legally operative.

### C4 · Sentry is a real sub-processor and is absent from the declarations

`backend/package.json:18` ships `@sentry/node`; `backend/app/index.js:35` initialises it via `config/sentry.js:16-31`; and events carry an identifier — `sockets/index.js:90` and `sockets/biometricHandler.js:972` both pass `userId: String(...)` into `captureException`.

`docs/PRIVACY_DECLARATIONS.md` does **not** list Sentry in its sub-processor table, and neither store form declares a crash-log / diagnostics category. `PRIVACY_DECLARATIONS.md:63` asserts "No third-party advertising or analytics SDKs" — defensible for error monitoring, but the Play **Crash logs / Diagnostics** category is unanswered.

**The canvas was more accurate than the declarations** — but it was also wrong in its own way: it said Sentry receives crash reports *"when error monitoring is on"*, implying a user control. There is none; it is gated on the `SENTRY_DSN` env var, an operator switch. And it said "crash reports" while Sentry receives an account ID.

**Canvas: DONE** — now "receives error reports, which can include your account ID."

**Shipped/declarations fix:**
1. Add Sentry to the `PRIVACY_DECLARATIONS.md` sub-processor table, stating it receives error/stack context **plus userId**.
2. Add Play "App info and performance → Crash logs" and Apple "Diagnostics → Crash Data".
3. Re-check the Play "shared with third parties: No" answer against the added processor.
4. **Reconcile Vercel** — listed in the declarations, absent from the canvas. Either it is gone (remove it) or it is live (the notice is incomplete). The two documents currently disagree in both directions.

Misdeclared Data Safety is a routine Play takedown reason.

### C5 · No "not a medical device" disclaimer exists anywhere

**Requirement** — Play Health Content and Services: other health and medical apps "must include a clear disclaimer in their app description indicating that the app is *'not a medical device and does not diagnose, treat, cure, or prevent any medical condition.'*" Apple 1.4.1: "Apps should remind users to check with a doctor in addition to using the app and before making medical decisions."

A repo-wide search for `not a medical device` / `diagnose, treat` returns **zero matches**. The app reads HR/HRV/sleep and renders interpretations ("Wired, but running on empty", "HRV 29 ms"), so it is squarely a health app. The Play Health apps declaration is still unticked at `PRIVACY_DECLARATIONS.md:155`.

**Fix:** add the disclaimer verbatim to the Play listing description, and echo it once in-app adjacent to the reads — Pulse and the Receipt head — which also answers Apple 1.4.1.

### C6 · Art. 13(1)(f) — naming the processors created a duty that naming alone does not discharge

Naming sub-processors is **not required** — Art. 13(1)(e) accepts "categories of recipients". Naming exceeds the minimum and is a good instinct. But once named, Art. 13(1)(f) still requires the adequacy statement, the Art. 46 safeguard reference, **and the means of obtaining a copy**. The canvas named four US/unknown-region processors and stopped.

**Canvas: DONE** — one sentence now covers it: transfers outside Europe run on the European Commission's standard contractual clauses, and the reader can ask for a copy. Groq's own documentation states SCCs apply, so the safeguard exists and was simply undisclosed.

**UNVERIFIED, and it must be resolved before the notice claims anything specific:** DPF certification or SCC status for Groq, Railway, MongoDB Atlas and Sentry, per processor. The EU-US Data Privacy Framework adequacy decision stands (the General Court dismissed *Latombe v Commission* T-553/23 on 3 September 2025; appeal C-703/25 P pending), but adequacy covers **DPF-certified** organisations only.

**Also standing and unexecuted:** `PRIVACY_DECLARATIONS.md:84-90` — the **Groq DPA + Zero-Data-Retention** condition is "a business/legal action that is not yet confirmed done." The canvas now states the Groq processing relationship to users in plain language. **Stating it to users while the Art. 28 contract is unexecuted is the wrong order**, and the Play "shared with third parties: No" answer depends on it.

### C7 · The consent notice is Android-only

`Consent.dc.html` described Health Connect exclusively, while `BiometricLog.source` includes `apple_health` and `suunto` and the declarations describe HealthKit ingestion. On iOS the notice misdescribed both the data source and the flow — Art. 12/13 accuracy, and Apple 5.1.2(i).

Partially addressed: the Google-brand corrections ("Android Health Connect" → "Health Connect"; the prohibited possessive "Android's own" → "the Health Connect permission sheet") are **DONE**. **Still open:** platform-conditional copy naming the actual source on iOS. That is a board variant, and it is queued rather than done.

### What the re-audit found *right*, and must not be broken

- **Decision 1 — filled Agree vs outlined Decline: PASS.** Not a recognised per-se dark pattern on the cited authorities. The EDPB Cookie Banner Taskforce Report names two failures: absence of a reject option on any layer (para 8) and contrast "so minimal that the text is unreadable" (para 18). Neither applies: identical geometry, stroke, radius, weight, size and hit area; Decline first in reading order; **Decline's label carries the highest text contrast on the screen**; anti-confirmshaming copy present. The test is explicitly case-by-case and this case passes it.
  **Five conditions hold that PASS**, and the first is a live inconsistency: **`docs/SCREENS.md` §11 currently says the opposite** — *"Decline is exactly as easy as Accept — equal size/position/contrast."* A discoverable internal rule contradicted by the shipped UI is the worst posture in a supervisory inquiry. Update §11 with the new rule **and its reasoning**, or revert. Do not leave them disagreeing. Also: never re-tint Agree to the emotion accent; no confirm step or re-prompt loop on Decline; measure the Decline outline at 3:1 (WCAG 2.2 1.4.11) in both themes — the canvas uses `--ink` and is safe, but **shipped `ConsentSheet.tsx:233` uses `c.content.tertiary` and is unmeasured**; and file a screenshot of the rendered screen against the consent version.
  **Shipped note:** `ConsentSheet.tsx:220-224` carries a comment asserting "equal-weight Decline · Agree" while `:233-248` renders outline-vs-fill. **A false comment on a legal control is worse than none.**
- **Decision 4 — eight collapsed sections: PASS on layering.** Layered information is expressly endorsed (EDPB 05/2020 paras 71-72). **FAIL on what the first layer carried:** of the para-64 minimum, controller identity and purpose sat inside collapsed sections and the transfer statement was absent entirely. C6 fixes the transfer statement. **Still open:** promote purpose and controller identity into the always-visible summary, and allow multiple sections open at once (the accordion currently closes one to open another, while claiming "this is the whole notice").
- **Least privilege: clean.** Nothing on these boards requests a scope beyond the declared minimum. Health Connect stays at heart rate / HRV / sleep / resting HR / history; the Garmin trio is disclosed-but-dormant and *enforced* dormant.

### Related

- `docs/plans/halts.md#consent-field-exposure` — correctly scoped already, and now **gating**: the Vault's "Version 1 · 12 Aug 2026" line must not ship before it. Rendering `currentVersion` beside a grant is an affirmative false statement whenever `staleVersion` is true. The shipped `VaultConsentPanel.tsx:59` is honest today; this is a canvas-only exposure.
- `docs/plans/halts.md#health-connect-play-blockers` — the other half of the Play story.

<a id="consent-field-exposure"></a>
### DEV ITEM — Expose three consent fields the server already stores
_Was `docs/plans/DEV_CONSENT_FIELD_EXPOSURE.md` until 2026-10-18 (`docs/ARCHIVE.md` § Moved); its history is under that path._

**Raised:** 2026-08-26, from the screen-13 (Health Data Vault) design review.
**Routing:** `developer` under TDD → `resilience-auditor`.
**Status:** not started.

---

#### Scope this correctly: it is DTO exposure, not a data change

**Nothing new is stored. Nothing new is written. No migration.** All three values already exist on the append-only `ConsentRecord`, which has `timestamps: true` and a `status: 'withdrawn'` value. The only work is returning them from the endpoint that already reads that record, and widening the client type.

Scoping this as a storage or schema change would be wrong and would make it look far larger than it is.

#### What the client can say today, and what it cannot

The client holds exactly `ConsentStatus { granted, currentVersion, staleVersion }` (`mobile/KokonadaHealth/src/health/consentApi.ts:60-64`). That supports three true statements and no others: **a grant is on file**, **what version the terms are currently at**, and **whether the grant on file is behind that version**.

The trap that makes this look solvable when it is not:

- **`currentVersion` is the server's `CURRENT_CONSENT_VERSION` constant** (`backend/app/services/privacy/consent.js:14`, returned unconditionally at `:126`). It is the version the terms are at **now** — *not* the version the user agreed to. Rendering it beside a grant reads as "you agreed to version N", which is false whenever `staleVersion` is true.
- The **granted** version is available server-internally via `getGrantedConsentVersion` (`consent.js:110-113`), and **no route exposes it**.
- `grantedAt` and `withdrawnAt` live on `ConsentRecord` (`consent.js:53`, `:72`) and are absent from `getConsentStatus`'s return (`:122-129`) — the sole payload of all three consent endpoints (`controllers/consentController.js:20`, `:29`, `:39`).

The shipped UI is honest about this constraint: `VaultConsentPanel.tsx:59` renders only *"Consent on file — personalising with your body's signals."*, with no date and no version.

#### The change

Add to `getConsentStatus`'s return and to the `ConsentStatus` interface:

| Field | Source | Nullable |
|---|---|---|
| `grantedVersion` | `getGrantedConsentVersion` (`consent.js:110-113`) | yes — null when no grant on file |
| `grantedAt` | newest `status:'granted'` `ConsentRecord.grantedAt` | yes |
| `withdrawnAt` | most recent `status:'withdrawn'` record, if any | yes |

**Client-side notes:**
- `isConsentStatus` (`consentApi.ts:71`) is the one place a `ConsentStatus` enters the app and it fails closed on an unshaped payload. The three new fields must be **optional** in the guard, so an older backend does not fail the shape check and lock a user out of the health path. That guard exists because of a resilience-audit finding; do not weaken it.
- Render `grantedVersion`, never `currentVersion`, next to a grant date. If they differ, that is what `staleVersion` is for — say so rather than showing the newer number.
- All three are nullable, so the UI needs a defined first-run state. The board's "Before that — Withdrawn …" line renders only when `withdrawnAt` exists.

#### Why it is wanted

Screen 13 draws the consent line as version, date, and any prior withdrawal (Daniel's `consent=history` choice). Because the record is append-only, a previous withdrawal is retrievable — which is a stronger and more honest statement than a single date: it shows the user their own history with the consent, including that they once revoked it and came back.

**Until this lands, the board shows three values the app cannot produce.** Either the fields ship before the screen, or the line degrades to the shipped sentence.

#### Related

- Screen 13 review: `docs/review/13-health-data-vault.html`
- `docs/plans/halts.md#garmin-deregistration-on-delete` — separate item, separate severity.

<a id="garmin-brand-and-attribution"></a>
## HALT — Garmin branding, attribution, and a 30-day notice clock that has not started
_Was `docs/plans/HALT_GARMIN_BRAND_AND_ATTRIBUTION.md` until 2026-10-18 (`docs/ARCHIVE.md` § Moved); its history is under that path._

**Raised:** 2026-08-26 by `compliance-auditor`. All requirements fetched live that day.
**Routing:** the 30-day notice is **Pause & Guide** (a human must send it). The rest: `developer` under TDD → `compliance-auditor` re-audit.
**Status:** canvas items fixed 2026-08-26 (marked DONE below). Everything else not started.

**Sources.** Garmin API Brand Guidelines **V 6.30.2025**; Garmin Connect Developer Program Agreement **FRM-0952 Rev. B**; Garmin OAuth2.0 PKCE Specification (Last-Modified 2025-07-23); Garmin Health API product page; Garmin trademark notices.

**Extraction caveat, disclosed rather than hidden:** the three PDFs were read through a text-extraction proxy pointed at the official Garmin URLs — no PDF renderer was available in the audit environment. The load-bearing clauses were corroborated by a second independent retrieval. Re-confirm against the PDFs opened directly before acting on the contract clauses.

---

### G1 · The 30-day prior-notice gate has not started — and it gates the whole redesign

> "Licensee shall provide Garmin with **no less than thirty (30) calendar days' prior written notice** of any planned introduction of new content formats, user interfaces, or display mechanisms that incorporate Garmin Brand Features … or display Garmin Device Sourced Data … Such notice must be sent to **connect-support@developer.garmin.com** and **include representative samples or mockups**."
> — Developer Program Agreement §6.6

The canvas *is* a complete redesign of every surface that displays Garmin data — Pulse, Generate, Mix receipt, Consent, Components. The boards **are** the mockups §6.6 asks for.

**This is a schedule risk, not paperwork.** Any ship date inside 30 days of the send is non-compliant on its face regardless of how correct the attribution is. Fix G2–G6 *first*, so the clock starts on the design that actually ships rather than on one that then changes.

Enforcement ladder if it is skipped — §6.5: 14 days to remedy, then Garmin "may reduce the quantity and/or content of Garmin Device Sourced Data", then suspension or termination.

### G2 · "Daily readiness — Garmin-only" is a misattribution: Garmin supplies no readiness metric

Garmin's Health API supplies Steps, Intensity Minutes, Sleep, Calories, Heart Rate, Stress, Pulse Ox, Body Battery, Body Composition, Respiration, Blood Pressure, Enhanced Beat-To-Beat Interval. **No readiness metric of any kind.**

Our own adapter agrees — `backend/app/services/wearable/adapter.js:269-333` `normalizeGarminSummaries` handles `sleeps | dailies | hrv | respiration | pulseox | stressDetails` and never emits `dailyReadiness`. A grep for `readiness` under `backend/app/services/wearable/` returns **zero matches**.

So the app tells users, in a health-consent context, that a metric is Garmin's when Garmin does not supply it. That is Agreement §5.2(g) — do not "mislead or confuse End Users as to the features, functionality, origin, capabilities, or other aspects of … the API".

**Shipped fix:** `mobile/KokonadaHealth/src/experience/pulse/pulsePresentation.ts:107` must not return `GARMIN_ONLY` for `dailyReadiness`. It needs a third note type — a source boundary with no named vendor and no retry affordance. Correct the comments at `backend/app/services/medicalProfileService.js:246` and `backend/app/models/MedicalProfile.js:65`; the model itself is unsure whose metric it is (*"Garmin/Whoop readiness score"*).

**Open product question, not a copy edit:** if no integrated source supplies it, either wire one or delete the metric. A row that can never populate is furniture.

**Canvas: DONE** — `Pulse.dc.html` and `Components.dc.html` now read "Not available · no connected source supplies it".

### G3 · No Garmin attribution exists on any populated surface

> "**TITLE-LEVEL OR PRIMARY DISPLAYS** — All uses of Garmin device-sourced data within dashboards, activity feeds, overview cards or summary views must include a **'Garmin [device model]'** attribution … Position the Garmin attribution directly beneath or adjacent to the primary title … **above the fold** … **Never bury the Garmin attribution in tooltips, footnotes or expandable containers.**"

In the shipped app the Garmin name appears **only in the empty state**. `pulsePresentation.ts:95,107` returns `GARMIN_ONLY` only when the value is null; `PulseScreen.tsx:153-162` renders label plus number and nothing else when a value exists.

Worse: `warmStore.ts:7` — `type BiometricSource = 'ble' | 'health-connect' | 'none'`. **There is no `'garmin'` member.** The app has no surface capable of rendering a Garmin attribution at all.

Also engaged, and unaddressed anywhere:

> "**COMBINED OR DERIVED DATA** — All uses of Garmin device-sourced data as an input to analytics, algorithms, machine learning models … must include a Garmin attribution … The attribution must list Garmin as a distinct or contributing data source (depending on what is true) and **must not imply Garmin endorsement of data from other devices**."

Kokonada's whole product is derived data. The Mix receipt's "WHY THIS MUSIC" and "Your body said — HRV 29 ms" carry no attribution.

The exemption does not rescue us: §6.4.a covers only the "defense, research, or remote patient monitoring" markets. Kokonada is consumer wellness with Kokonada branding.

**Fix:** add `'garmin'` to `BiometricSource`; render the attribution when the value is **present**, not only when absent; add it to the receipt surfaces as a *contributing* source, worded so it cannot imply Garmin endorsed the Health Connect or BLE inputs blended alongside; pin both with tests beside the existing honest-empty tests.

### G4 · `Garmin [DEVICE MODEL]` is an unresolved placeholder, and the bare-"Garmin" fallback is not yet justified

The fallback is permitted — but conditionally:

> "Access the device model information as instructed in the applicable API documentation. **If the device model is not provided or unknown via the API, list Garmin as the data source.**"

The canvas justifies bare "Garmin" with *"PulseState carries no device model"* (`Pulse.dc.html:145`). That is a statement about **our DTO**, not about **Garmin's API**. "We didn't plumb the field through" is not "not provided or unknown via the API".

**UNVERIFIED** — whether the Health API returns a device/model field could not be checked; the REST API Specification is behind the developer-portal login.

**Fix:** open the spec, record the answer in-repo with the doc version cited, then either plumb the model through or record the citation justifying the fallback so a future reviewer need not re-litigate it. **Never let the literal string `[DEVICE MODEL]` reach a build** — degrade to `Garmin`, never to the placeholder.

### G5 · Generic BLE straps are stamped as Garmin

`mobile/KokonadaHealth/src/health/bleHeartRate.ts:23-24` streams from "the first device advertising the standard BLE Heart Rate Service (0x180D)" — a generic profile that a Polar, Wahoo or Coros will match. `liveHrClient.ts:14` documents that minting the watch token "also flips the user's `wearableProvider` to `'garmin'`".

Invisible today, because the UI shows "Heart-rate sensor" for `ble`. **It becomes a false claim the moment G3 lands** — the exact case §6.5's "must not imply Garmin endorsement of data from other devices" names.

**Fix this before G3, not after.** Derive the provider from the actual pairing lane (Connect IQ app → Garmin; generic 0x180D → generic), or add a `ble_generic` value.

### G6 · Trademark form and the connection surface

- **"Body Battery" was mis-set as "Body battery"** on `Components.dc.html` and `canvas.json:40`. Rendering a proper-noun mark as a common noun is textbook genericization. **Canvas: DONE** (now `Body Battery™`). Shipped `pulsePresentation.ts:32` and `ConsentSheet.tsx:29` still read `Body Battery` unmarked — align them and pin with a unit test so four spellings of one mark cannot re-emerge.
- **Body Battery sits outside the §6.1 licence.** The licensed set is the Garmin / Garmin Connect / mountain-bike-dynamics word marks. Garmin's own developer guidance contemplates partner views showing "Body Battery™ energy monitoring", so nominative use is clearly anticipated — but the express licence does not cover it, and the trademark notice says these marks "may not be used without the express permission of Garmin". **Send one written request** to `connect-support@developer.garmin.com` confirming (a) the required marking form in a partner UI and (b) that display of the mark to label Health API `bodyBattery` data is permitted. §6.4.a shows Garmin issues written approvals, so this is a normal request. Keep the reply on file.
- **`Plan.dc.html` used "a Garmin" as a countable noun.** **Canvas: DONE.**
- **§6.1 requires Garmin Brand Features on the connection surface** — "Licensee **must** include the Garmin Brand Features in Licensee Applications … for these limited purposes." The connect row is generic ("Wearable & Health"). Text-only naming — "Garmin Connect", never abbreviated or stylized — is sufficient and lower-risk than the "works with" badge. Activates at go-live; not a defect while the lane is dark.
- **PASS, and worth protecting:** no Garmin tag logo is used anywhere, so none of the logo-misuse clauses is triggered. `ProfileScreen.tsx:162` already says "Open Garmin Connect → Settings → Health Connect" — the required full app name.

### UNVERIFIED — do not record as compliant

1. **Trademark-symbol policy for third parties.** No publicly reachable Garmin document mandates that a third party append ™/®. The document that would say — the Consumer Brand Style Guide at `creative.garmin.com` — is behind Garmin's Confidentiality Agreement. **Pause & Guide: a human must accept it and retrieve the guide.** Interim safe posture: mirror Garmin's own notice once in the legal/about surface — *"Garmin® and Body Battery™ are trademarks of Garmin Ltd. or its subsidiaries, registered in the USA and other countries."* Copied from Garmin, so it cannot itself be wrong. In running UI text keep bare `Garmin` as an adjective: "Garmin Forerunner 265", "a connected Garmin device". Never "a Garmin", never "garmin".
2. Whether the Health API exposes a device model (G4).
3. **Whether a Kokonada ToS exists carrying the Garmin-benefit clauses §5.3 requires** — "a written agreement with each End User that contains protections and limitations of liability, in each case for the benefit of Garmin, at least as protective as those contained in this Agreement." The consent notice is an Art. 9 notice, not a ToS. This is a distinct deliverable and a condition of the licence.

### Out of scope, flagged

`watch/manifest.xml` declares a **Connect IQ watch app** (fenix7, fr255, venu2; `Communications` + `Sensor` permissions). Connect IQ is governed by a **different agreement and different brand guidelines** from the Health API surface audited here, and the Connect IQ Store has its own submission requirements. The app name "Kokonada HR" contains no Garmin mark, which is correct. **Nothing else about that surface has been audited.** Commission a separate audit before any sideload-to-store transition.

### Related

- `docs/plans/halts.md#garmin-deregistration-on-delete` — the other Garmin blocker, and the more urgent one.

<a id="garmin-deregistration-on-delete"></a>
## HALT — Account deletion leaves the Garmin registration live
_Was `docs/plans/DEV_GARMIN_DEREGISTRATION_ON_DELETE.md` until 2026-10-18 (`docs/ARCHIVE.md` § Moved); its history is under that path._

**Raised:** 2026-08-26. **Escalated to HALT 2026-08-26** after `compliance-auditor` returned the governing clause.
**Severity:** GDPR Art. 17 failure in shipped code **and** a direct breach of a documented Garmin Application Requirement, which §9.4 makes an immediate automatic-termination trigger with no notice and no cure period.
**Routing:** `developer` under TDD, then `resilience-auditor`. The compliance question is now answered — see below.
**Status:** not started. **Not a canvas item.** Surfaced during the screen-13 design review; it is a backend defect and belongs in the backlog on its own terms.

Verified at high confidence by an independent adversarial pass. Every claim below carries file:line.

---

### The obligation is explicit, and "Delete My Account" is the exact trigger it names

> **Delete User Registration** — `DELETE https://apis.garmin.com/wellness-api/rest/user/registration`
> This endpoint **must be called if the partner website or application provides a "Delete My Account" or "Disconnect" mechanism outside of the normal Garmin Connect consent removal process**, or **in any case where the user would reasonably believe the partner program is allowing them to remove their consent to share Garmin data**.
> — Garmin OAuth2.0 PKCE Specification, doc Last-Modified 2025-07-23, fetched 2026-08-26

Supporting contract clauses (Developer Program Agreement FRM-0952 Rev. B):
- **§5.1(a)** — Licensee shall "follow all Application Requirements, including all upload and user experience guidelines and instructions".
- **§5.1(e)** — Process data "in a manner consistent with any End Users' consent".
- **§9.4** — "This Agreement will terminate **immediately and automatically, without any notice by either Party**, if Licensee violates any of the terms and conditions of this Agreement."

This is also the kind of defect Garmin's production-approval review exists to catch. It is likely to cost the approval outright, not merely earn a warning.

### Three aggravators found in the same pass

1. **The defect is irreversible.** `authController.js:229` `User.deleteOne` destroys `wearableToken`, `garminUserId` and `garminUserIdHmac`. Once the account is gone **there is no credential left with which the deregistration could ever be performed** — not by a retry, not by a backfill script, not by hand. The Garmin-side registration is orphaned permanently, and Garmin keeps pushing that person's health summaries to a webhook for a user who no longer exists.
2. **Even the two paths that do call it are no-ops today.** `wearableErasure.js:135` — `if (process.env.GARMIN_DEREGISTER_ENABLED !== 'true') return { attempted: false };`. Default off. So **right now, zero code paths in Kokonada ever deregister a Garmin user** — not withdrawal, not disconnect, not deletion.
3. **The go-live checklist is decoupled from the flag.** `consentApi.ts:39` names go-live as "`GARMIN_WEBHOOK_SECRET` + Garmin production approval". `GARMIN_DEREGISTER_ENABLED` is not in that sentence. Following the comment literally switches ingestion on while deregistration stays off — the worst possible ordering.

**Why this is HALT-before-ship rather than remediate-now:** the Garmin server-to-server lane is pre-production (`consentApi.ts:32-41`), so no live user is currently orphaned. That is the only mitigation.

---

### The defect

`DELETE /api/auth/account` (`backend/app/routes/auth.js:22` → `controllers/authController.js:220-245`) performs a full hard delete: `deleteMany` across 13 user-keyed collections plus Redis (`services/privacy/erasure.js:37-68`), removes the `User` document last (`authController.js:229`), kills sockets and revokes the JWT. There is no queue, timer, tombstone or undo anywhere — confirmed by `grep -riE "deletionQueue|scheduleDeletion|deleteAfter|purge"`.

**It never deregisters the user from Garmin.**

`maybeDeregisterGarmin` (`services/privacy/wearableErasure.js:134-144`) is reachable **only** through `eraseWearableProvider` (`:149`). `erasure.js` never requires `wearableErasure` — its only privacy-adjacent import is `ConsentRecord` (`erasure.js:21`).

So the two erasure paths differ **bidirectionally**, and deletion is *not* a superset of withdrawal:

| | Withdraw consent | Delete account |
|---|---|---|
| Biometric rows, MedicalProfile, MorningState, bio Redis keys | erased | erased |
| Wearable credentials on the User doc | cleared (`clearWearableCredentials`, `:107-126`) | User doc deleted |
| RewardEvent, PersonalWeights, MusicProfile, PlaylistSession, ServeEvent, Identity, RefreshToken, UnclassifiedTrack, ConsentRecord | **kept** (deliberate, `wearableErasure.js:62-82`) | erased |
| **Garmin server-side registration** | **deregistered** | **LEFT LIVE** |

The user's account and every row keyed to it are gone, and Garmin remains registered to push data for a user that no longer exists. The more total action does less.

### Why this is a compliance item, not a tidy-up

Under GDPR Art. 17 an erasure request should stop third-party processing initiated on the controller's behalf. A live registration after deletion means:

1. **Continuing third-party processing** for a data subject who has exercised erasure.
2. **Inbound webhooks for a deleted user.** `compliance-auditor` should establish what `garminIngest` does with a payload whose `userId` no longer resolves — specifically whether that path can error-loop, or whether any upsert could **resurrect** a record for a deleted account. A resurrection would turn a registration leak into a data-recreation defect.
3. A **retention question at the processor**: whether Garmin holds anything keyed to the registration after we stop consuming it.

### Fix direction

The deletion cascade must perform the same deregistration the withdrawal path does, **before** the `User` document is removed — the credentials it needs (`garminUserId`, `garminUserIdHmac`, `wearableToken`) live on that document, so ordering is not optional.

Deregistration is a network call to a third party, so it must not be able to strand the delete: if it fails, the cascade still has to complete and the failure has to be recorded for retry. A user must never be left half-deleted because Garmin was unreachable.

### The guard test — name it, do not leave it implied

**`backend/tests/erasureParity.test.js`** — a parity test whose single job is to stop the two paths drifting apart again.

It must assert:
- `eraseAccount` calls `maybeDeregisterGarmin` for a user with a Garmin registration, exactly as `eraseWearableProvider` does.
- Deregistration is invoked **before** the `User` document is deleted.
- A failing deregistration does not abort the cascade, and the failure is recorded.
- The collection list in `erasure.js` is a **superset** of the withdrawal path's, so any future collection added to one is caught if it is missing from the other.

That last assertion is the one that matters. This bug exists because one path was written later and quietly diverged; a test that only checks today's behaviour would not have caught it and will not catch the next one.

### Two more requirements the same pass added to the fix

- **Make `GARMIN_DEREGISTER_ENABLED=true` a blocking line item on the same go-live checklist as `GARMIN_WEBHOOK_SECRET`**, and update the comment at `consentApi.ts:39` to say so. Better: derive the deregistration behaviour from the same switch that enables ingestion, so they cannot diverge.
- **Record the deregistration outcome to an audit trail before the user row disappears.** Compliance must be demonstrable to Garmin, and after `User.deleteOne` there is no evidence left.
- **Extend it to every provider the user actually has**, not just Garmin, so the same class of bug does not recur for Suunto.

### Root cause, named

`wearableErasure.js:5-7` records the deferral: *"account-wide erasure stays owned by Wave 1; consolidation happens later."* **That deferral is what produced this defect.** Two erasure modules with different obligations and no shared test is the root cause; the missing call is the symptom. The parity assertion below is the fix for the cause.

### Related

- Surfaced by: `docs/review/13-health-data-vault.html`
- **Independently rated a pre-submission blocker by the sign-in audit** (`docs/plans/dev-items.md#signin-brand-assets`): Apple requires deletion of the account record "along with associated personal data", Play says "and associated data", and a live Garmin registration pushing biometrics for a deleted user fails both, as well as GDPR Art. 17.
- `docs/plans/halts.md#garmin-brand-and-attribution` — the other Garmin blocker.
- `docs/plans/halts.md#consent-field-exposure` — separate, and much smaller.

<a id="health-connect-play-blockers"></a>
## HALT — Health Connect / Play blockers: five in shipped Android code (2026-08-26), and the Play account type (2026-10-04)
_Was `docs/plans/HALT_HEALTH_CONNECT_PLAY_BLOCKERS.md` until 2026-10-18 (`docs/ARCHIVE.md` § Moved); its history is under that path._

**Raised:** 2026-08-26 by `compliance-auditor`, all sources fetched that day.
**Severity:** blocks **any** Play track, including closed testing. One item is a live user-facing privacy misstatement.
**Routing:** `developer` under TDD → `resilience-auditor` → `compliance-auditor` re-audit. Items 1 and 5 need a human (hosting + Play Console).
**Status:** (2026-10-04, `e4743af`) HALT 1–3 are fixed in code by HX-5 (#208) (`PermissionsRationaleActivity.kt:72-85`; `AndroidManifest.xml:82,91`). HALT 2–3 close on #208's device evidence (`CMP-067`, `MB-035`); HALT 1 also needs the hosted policy (`CMP-066`, `DAN-015`). HALT 4: the link ships on Sign-in and the Vault (`SignInScreen.tsx:109-111`; `VaultConsentPanel.tsx:56`), and on the consent sheet only from the build that sets `PRIVACY_POLICY_HOSTED` (`legalLinks.ts:30`; `ConsentSheet.tsx:221-225`); it closes once `DAN-015` hosts the page (`CMP-081`). HALT 5 and HALT 6 are open. HALT 5 is filed from the Play account that closes HALT 6, after `DAN-015`. The sections below are the text as raised.

---

### HALT 1 · Our "privacy policy" is a link to Google's own documentation

**Requirement** — https://developer.android.com/health-and-fitness/health-connect/get-started:
> "Your Android manifest needs to have an Activity that displays your app's privacy policy… **Note:** The activity must display the same privacy policy you provide for your app in the Google Play Console."

**What the code does** — `android/app/src/main/java/com/kokonadahealth/PermissionsRationaleActivity.kt:18-19`:
```kotlin
// TODO: replace with your hosted privacy policy describing how health data is used.
webView.loadUrl("https://developer.android.com/health-and-fitness/guides/health-connect/develop/get-started")
```

When a user taps **privacy policy** on the Health Connect permission screen, we render **Google's developer documentation** inside a Kokonada WebView. It also trips Google's trademark rule against displaying Brand Features "in any manner that implies a relationship with, affiliation with, sponsorship by, or endorsement by Google."

**Fix** — host the real policy, load that URL, and put the identical URL in the Play Console field. No release while the TODO stands.

### HALT 2 · On Android 14+ the privacy-policy link opens our home screen

**Requirement** — the manifest snippet on the same page requires the alias to target the rationale activity.

**What the code does** — `AndroidManifest.xml:90-99` sets `android:targetActivity=".MainActivity"`.

On Android 14+, where **Health Connect is part of the system** (the dominant install base), the required privacy surface is simply absent — the user lands on our launch screen.

**Fix** — retarget the alias to `.PermissionsRationaleActivity`.

### HALT 3 · Duplicate rationale intent-filter makes resolution ambiguous on Android ≤13

`AndroidManifest.xml:75-77` puts `androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE` on **MainActivity**, and `:84-86` puts the same action on **PermissionsRationaleActivity**. Two components claim one action, so the OS shows a chooser or picks arbitrarily. **This defeats HALT 2's fix even after the URL is corrected.**

**Fix** — delete the filter from MainActivity; keep it only on the rationale activity.

### HALT 4 · There is no privacy-policy link or text anywhere in the shipped app

**Requirement** — https://support.google.com/googleplay/android-developer/answer/16679511:
> "Your app must post a privacy policy link in the designated field within Play Console, **and a privacy policy link or text within the app itself**."

**What the code does** — a repo-wide grep of `mobile/KokonadaHealth/src` for `Linking` / `openURL` / `https://` returns exactly three destinations: Spotify OAuth, the Spotify download page, and the Health Connect Play listing. `ConsentSheet.tsx` — the Article 9 wall, where this belongs — has none.

**Note:** the canvas already solved this and the port dropped it. `Consent.dc.html` carries "Read the full privacy notice".

**Fix** — port that link into `ConsentSheet.tsx` and `VaultConsentPanel.tsx`.

### HALT 5 · The Health apps declaration appears not to be filed

**Requirement** — https://support.google.com/googleplay/android-developer/answer/14738291:
> "All developers that have an app published on Google Play must complete the Health apps declaration, **including apps on closed testing, open testing, or production tracks**."

Without it, allow-listed against package `com.kokonadahealth`, **Health Connect reads fail for real users** no matter how correct the client is — and data-type access is allow-listed per package regardless of app version.

Corroborating evidence the release checklist has not been run: `src/health/config.ts:2` still reads `https://YOUR-BACKEND.up.railway.app`, and the rationale URL is still a TODO.

**Fix** — file the declaration with a per-permission justification, including for `READ_HEALTH_DATA_HISTORY`.

### HALT 6 · Account type (CMP-093)

*Added 2026-10-04 from `compliance-auditor`'s re-check of `CMP-093`; sources fetched that day.*

**Requirement** — https://support.google.com/googleplay/android-developer/answer/10788890 (Play Console Requirements):
> "When creating your Play Console account, developers providing the following services must register as an Organization:" … "1.2. Health apps, such as Medical apps and Human Subjects Research apps. Learn more about Health app categories."

The linked page (answer/13996367) counts "Health and fitness apps" among health apps, and an app that reads health data must declare health features (answer/14738291).

**What stops** — no personal Google Play developer account is created for Kokonada, and no build goes to any Play track from one, internal testing included.

**Fix** — an organisation account with a D-U-N-S number ("up to 30 days", answer/13628312), or a written statement from Google Play that a Health-and-fitness-only declaration is outside §1.2. For the Israel tester stage an APK installed directly needs no Play account. The owner's steps are TASKS `DAN-056`, `DAN-057` and `DAN-058`.

### Exit criteria

*Added 2026-10-04.* The first upload to any Play track, internal testing included, waits until:
- HALT 1 to HALT 5 above are closed on evidence;
- **HALT 6 · Account type (CMP-093)** is closed: a verified organisation account with a D-U-N-S number exists, or Google Play's written statement is kept as `CMP-093` evidence;
- the store-gate hardening PR is merged, with:
  - the rxandroidble fix: `tools:node="remove"` on both `uses-permission-sdk-23` location entries that rxandroidble 1.17.2 adds to the merged release manifest with no `maxSdkVersion`, so the app declares location it never reads (`compliance-auditor`, V1 lab round 1: a HALT on any Play upload, not on a directly installed tester build);
    - **Satisfied in code by this PR (MB-093); closes when this PR's CI is green (the Android gate lines, the macOS phase run) and, for the Android line, when the Android 12+ device checks pass.** The main manifest removes both entries (`AndroidManifest.xml:28-33`). The merged release and debug manifests, the release variant's packaged manifest and a real debug APK (`aapt2 dump permissions`) carry neither, and FINE stays only up to API 30. CI's Android job holds every uploadable variant's merged permissions to `scripts/lab/uploadPermissions.mjs`. The Android 12+ device checks: `dumpsys package` lists no location permission, a live-HR scan works with only Nearby devices granted and Location off, and the permission dump of the exact artifact uploaded shows no location beyond FINE capped at API 30. **CI condition met, 2026-10-06:** PR #221's CI run 37428747263 on `5c01def` passed every job, the Android job that runs the gate included (https://github.com/DanielMalede/Kokonada/actions/runs/37428747263); #221 merged as `1c3ac55`, and main's run 37432740039 logs the gate lines (release 15 permissions, debug 16, all on their allow-lists). Still open here: the Android 12+ device checks and the dump of the exact artifact uploaded (TASKS `MB-093`).
  - the iOS `ENTRY_FILE` guard (a bundle-phase script, a pbxproj pin and a bash test), a precondition on any iOS archive: no iOS archive is exported for upload, and nothing goes to TestFlight or App Store Connect, until that PR is merged and the IPA scan exits 0.
    - **Satisfied in code by this PR (MB-093); closes when this PR's CI is green (the Android gate lines, the macOS phase run) and, for the Android line, when the Android 12+ device checks pass.** The bundle phase runs `ios/scripts/bundle-react-native.sh` through `with-environment.sh`. Before `react-native-xcode.sh` runs, the wrapper refuses: any `ENTRY_FILE` other than `index.js`; an `index.ios.js`; a non-empty `EXTRA_PACKAGER_ARGS`, `CLI_PATH`, `BUNDLE_COMMAND`, `BUNDLE_CONFIG`, `CONFIG_JSON`, `CONFIG_CMD`, `NODE_ARGS` or `BUNDLE_NAME`; a `PROJECT_ROOT` other than the app root; and `SKIP_BUNDLING` outside Debug. `scripts/ios/__tests__/bundlePhase.test.ts` pins the phase and runs it. The refusals are not exhaustive, so the IPA scan with exit 0 stays a condition on every archive and the control for every input; the first Release archive log (the wrapper ran and `main.jsbundle` was produced) is still owed. **CI condition met, 2026-10-06:** PR #221's CI run 37428747263 on `5c01def` passed every job, its macOS iOS build taking the bundle phase through the wrapper (https://github.com/DanielMalede/Kokonada/actions/runs/37428747263), and #221 merged as `1c3ac55`. CI builds Debug for the simulator, where bundling is skipped, so the first Release archive log and the scan of that exact IPA stay open (TASKS `OPS-143`).

---

### What is right, and must not be broken fixing the above

**The consent sequencing is the strongest part of the integration.** Play's Prominent Disclosure rules require in-app disclosure, before collection, with affirmative action, and that navigating away is never read as consent. `ConnectServicesScreen.tsx:153-155` presents `ConsentSheet` before the OS sheet; `ConsentSheet.tsx:124-127` gates on a server-acked grant; back/dismiss maps to `onDecline`. `connectController.test.ts` pins `requestHealthPermissions` as *not* called on unsupported, install-required, consent-required, stale-version and offline. **Verdict: COMPLIANT, with regression guards. Protect it.**

**Permission scope is genuinely minimised** — four read types plus history, no background access, and `permissions.ts:23-26` documents why `READ_HEALTH_DATA_IN_BACKGROUND` is deliberately not requested. That is the posture reviewers want.

**The twice-cancelled permission path is handled** (`ConnectServicesScreen.tsx:156-161` deep-links into Health Connect settings). **The CTA wording passes** — "Connect a wearable" avoids the prohibited "Connect to Health Connect."

---

### Also needs fixing, lower severity

| Item | File | Fix |
|---|---|---|
| "Historical readings" listed as a **data type** | `ConsentSheet.tsx:24`, `VaultConsentPanel.tsx:26` | It is a *permission*, not a category — our own `permissions.ts:19` says so. Move it to its own line. |
| "Sleep" vs "Sleep sessions" drift | `VaultConsentPanel.tsx:24` vs `ConsentSheet.tsx:22` | Align both on "Sleep session", matching the OS sheet the user sees seconds later. |
| Retention absent from shipped copy | `ConsentSheet.tsx` "How long we keep it" | Says only "minimised over time". Port the canvas facts (90 days / one year). |
| History wording understates granted scope | canvas + shipped | `READ_HEALTH_DATA_HISTORY` grants the **entire** history; 182 days is our self-imposed window. Say both — it is also a trust win. |
| Setup docs teach over-scoping | `native-snippets/AndroidManifest.additions.xml:14,15,19`, `SETUP_ANDROID.md:93` | Still declare SpO2, respiratory rate and background access. Anyone following the doc reintroduces three unjustified scopes and contradicts the filed declaration. Align or delete. |
| iOS ships an Android-only CTA | `ConnectServicesScreen.tsx:145` | On iOS its only outcome is "Available on Android" — App Store 2.1 non-functional-feature territory. Gate or hide. |
| "Google Health Connect" | `backend/app/services/wearable/healthStore.js:4` | Google never brands it that way. Cosmetic. |

### Standing constraint, worth pinning

The Spotify mark on Pulse sits on a surface rendering Health Connect data. As drawn it is inside a **functional** mini-player with a transport control, which is compliant. **The moment it becomes an upsell, a Premium prompt or a partner placement on a health-data surface, it enters Play's Limited Use clause** (answer/9888170) prohibiting use of health data for serving ads. Pin this; do not let a growth experiment cross it.

### Explicitly UNVERIFIED — do not assume either way

- **There is no Health Connect brand-guidelines page** — the expected URL returns **404**. No required attribution line ("Powered by Health Connect" or similar) could be verified. **Do not invent one.** If the logo is ever used, it needs Android brand-team approval, which the brand guidelines say takes **at least a week**.
- **Pre-tap platform-availability disclosure** — no Google rule found requiring it. Our post-tap alert is not a violation. (Our own `SCREENS.md:161` asks for a pre-check anyway, and `healthConnect.ts:17-23` already returns `'unsupported'` before any user action — so gating the CTA is free.)
- **Data-type label matching** — no requirement found; accuracy still binds.

<a id="sign-in-with-apple-entitlement"></a>
## HALT — Sign in with Apple cannot work: the iOS entitlement does not exist
_Was `docs/plans/HALT_SIGN_IN_WITH_APPLE_ENTITLEMENT.md` until 2026-10-18 (`docs/ARCHIVE.md` § Moved); its history is under that path._

**Raised:** 2026-08-26 by `compliance-auditor`, verified against App Review Guidelines fetched that day.
**Severity:** store-submission blocker. App Review Guideline **2.1(a)** and **4.8**.
**Routing:** **Pause & Guide** — a human must do steps 1–2 in the Apple Developer portal and Xcode. Then `developer` for step 4.
**Status:** not started.

---

### The defect

`SignInScreen.tsx:89-95` renders Apple's official `AppleButton`, and `auth.ts:70` calls `appleAuth.performRequest(...)`. The client code is correct. **The iOS project has no entitlement for it.**

| Check | Result |
|---|---|
| `mobile/KokonadaHealth/ios/**/*.entitlements` | **no file exists** |
| `CODE_SIGN_ENTITLEMENTS` in `KokonadaHealth.xcodeproj/project.pbxproj` | **not present** |
| `com.apple.developer.applesignin` anywhere under `ios/` | **zero matches** |
| A `.gitignore` rule hiding it | none — the absence is real |

Without `com.apple.developer.applesignin` in the binary, `ASAuthorizationController` fails immediately with `ASAuthorizationError.unknown` (1000). A reviewer taps the button, gets an error, and the app is rejected under 2.1 — **and** under 4.8, because the alternative login required alongside Google Sign-In does not function.

### Why our tests said this was fine — a false green

The only evidence Apple sign-in works is two Jest suites that **mock the native module**: `src/auth/__tests__/SignInScreen.test.tsx:95` and `src/auth/__tests__/loginFlow.test.ts:84`. There is no on-device proof. There is also no `ios/Podfile.lock` in the repo, so the iOS pod graph has never been resolved here.

This is exactly the failure mode `CLAUDE.md` warns about for the `developer` agent: *"real (on-device) evidence, never green mocks."* Two passing suites certified a capability that cannot execute.

### Guideline 4.8 — and the trap in it

Fetched 2026-08-26 from https://developer.apple.com/app-store/review/guidelines/:

> "Apps that use a third-party or social login service (such as Facebook Login, **Google Sign-In**, …) to set up or authenticate the user's primary account with the app **must also offer as an equivalent option another login service**…"

> "Another login service is not required if: **Your app exclusively uses your company's own account setup and sign-in systems.**"

Google Sign-In is named explicitly, so 4.8 is triggered. **Landing the email/password path does not exempt us** — the exception is conditioned on *"exclusively"*, and an app offering Google *and* first-party email is not exclusive. Our own email system also cannot satisfy 4.8's capability profile, because it offers no email-relay privacy option.

The gating logic itself is correct — `SignInScreen.tsx:49` gates on `Platform.OS === 'ios' && appleAuth.isSupported`, and with `IPHONEOS_DEPLOYMENT_TARGET = 15.1` there is no device where Google renders and Apple silently hides. The backend correctly accepts Apple's private-relay address (`auth.ts:67-68`). **All of that is void until the entitlement exists.**

### The fix

1. **Apple Developer portal** → Certificates, IDs & Profiles → the App ID → enable **Sign In with Apple**; regenerate provisioning profiles.
2. **Xcode** → target → Signing & Capabilities → **+ Capability → Sign In with Apple**. This creates `KokonadaHealth.entitlements` with `com.apple.developer.applesignin = [Default]` and sets `CODE_SIGN_ENTITLEMENTS`. **Commit that file.**
3. Confirm `POST /api/auth/apple` verifies the identity token against the Services ID / bundle ID matching the enabled capability.
4. **Gate release on a real-device run, not a Jest run.** Add an on-device verification step to the device-QA runbook so this cannot be certified by mocks again.

### Related

- `docs/plans/dev-items.md#signin-brand-assets` — the mark/asset failures on the same screen.
- `docs/plans/dev-items.md#email-signin-path` — note the "exclusively" clause above; that item does **not** remove this obligation.

<a id="spotify-track-ids-to-third-party"></a>
## HALT — Spotify track IDs are transmitted to a third-party API, live
_Was `docs/plans/HALT_SPOTIFY_TRACK_IDS_TO_THIRD_PARTY.md` until 2026-10-18 (`docs/ARCHIVE.md` § Moved); its history is under that path._

**Raised:** 2026-08-26 by `compliance-auditor`, sources fetched that day.
**Severity:** the auditor's words — *"the only finding in this audit with a plausible path to permanent revocation of Platform access."*
**Routing:** `architect` to choose the resolution → `developer` under TDD → `compliance-auditor` re-audit. Option 2 needs a human (Spotify Developer Support).
**Status:** unresolved. **Must not reach production unresolved.**

---

### What the code does

`backend/app/services/features/reccoBeatsAdapter.js:7,17,20-21`:

```js
// Measured audio features by Spotify track id (ReccoBeats-style API).
const BASE_URL = () => process.env.RECCOBEATS_URL || 'https://api.reccobeats.com';
function supports(track) { return Boolean(spotifyIdOf(track)); }
```

Wired live at `backend/app/services/features/featureService.js:5,94`. **Every request this adapter makes is, by definition, a Spotify track ID sent to `api.reccobeats.com`.**

### The clauses

> **§IV.2.b** "**do not transfer Spotify Content to third parties**, including directly or indirectly transferring any data (including aggregate, anonymous or derivative data) received from Spotify to, or use such data in connection with, any ad network, ad exchange, data broker, or other advertising or monetization-related toolset, even if a user consents to such transfer or use."
> — Spotify Developer Terms, https://developer.spotify.com/terms, fetched 2026-08-26

> **§III.13** "Do not analyze the Spotify Content or the Spotify Service for any purpose, including without limitation, creating new or derived listenership metrics…"
> — Spotify Developer Policy, https://developer.spotify.com/policy/ (effective 15 May 2025), fetched 2026-08-26

The lead clause of §IV.2.b — *"do not transfer Spotify Content to third parties"* — is **unqualified**; the "including…" list illustrates the advertising case rather than exhausting it. ReccoBeats is not an ad network, but it is unambiguously a third party, and the purpose of the transfer is third-party **analysis** of Spotify Content, which §III.13 addresses directly.

**The auditor did not assert a confirmed breach.** It stated the §IV.2.b lead-clause scope is genuinely ambiguous and could not be resolved from the live text alone — and that the correct status is therefore *unresolved*, not *fine*.

### Why this reads as a gap rather than a decision

The architecture already knows about §IV containment and enforces it elsewhere. `llmEstimatorAdapter.js:47-52` hard-gates Spotify recordings out of the estimator with an explicit comment:

```js
// §II Spotify-Content lock: a Spotify recording's genre tags are Spotify Content and must not be
// sent to a third-party model. Gate spotify: recordings out of estimation entirely
```

with the predicate centralised in `utils/spotifyContent.js`, enforced at `discovery/catalogAndEmbed.js:25` and `toCatalogEntry.js:30`, and guarded by `monitoring/spotifyLeakMonitor.js`, `scripts/purgeSpotifyCorpus.js` and regression tests. **The same containment was not applied to the ReccoBeats path.**

### Resolve before submission — pick one

1. **Gate it.** Make `reccoBeats.supports()` exclude Spotify recordings, exactly as `llmEstimatorAdapter.js:50` already does. Cheapest, consistent with the existing posture, and pins the behaviour with the leak monitor already in place.
2. **Get it in writing.** Obtain confirmation from Spotify Developer Support that outbound Spotify track IDs to a feature-lookup service are permitted, and file it.
3. **Re-key the lookup** on a non-Spotify identifier (ISRC / MusicBrainz ID) so no Spotify Content crosses the boundary at all.

**Consequence if wrong**, from the live source: *"suspension, disabling your application or permanently revoking your access to the Spotify Platform"* — https://developer.spotify.com/compliance-tips, fetched 2026-08-26.

### Guard

Extend `spotifyLeakMonitor` to cover **outbound** third-party calls, not only corpus ingestion. The monitor exists precisely for this class and does not currently see this path.

---

### Two further shipped-code items from the same audit

#### Clear-space breach in the shipped attribution component — FAIL

`mobile/KokonadaHealth/src/experience/player/SpotifyAttribution.tsx:25,93`

`LOGO_HEIGHT = space.xl` (24), and the container `gap: space.sm` (8). In the official 3432×940 asset the icon circle spans ~96% of canvas height, so at 24px the icon is ≈23px and the required exclusion zone is **≈11.6px**. The rendered gap is **8px**.

> "The exclusion zone is equal to half the height of the icon." — Design & Branding Guidelines, fetched 2026-08-26

**Fix:** derive clear space from the mark, not a spacing token — `const LOGO_CLEAR = Math.ceil(LOGO_HEIGHT * 0.5)`, used as the container `gap` and `paddingHorizontal`. A hard-coded `space.sm` will breach again the next time `LOGO_HEIGHT` moves.

**Everything else in that component is correct and should be preserved:** official asset, theme-correct black/white selection, width derived from the true 3432/940 ratio so the mark is never stretched, 88px ≥ the 70px full-logo minimum, and permitted link-back strings (`OPEN SPOTIFY` / `GET SPOTIFY FREE`).

#### Dead `/audio-features` caller — LOW

`backend/app/services/spotify.js:395` still issues `GET /audio-features`, which is **Deprecated** (confirmed live). A repo grep finds **no call sites**. Not a compliance risk; a custodian dead-code item. Leaving a caller for a deprecated endpoint is a false signal to the next reader.

### Related

- `docs/plans/dev-items.md#spotify-canvas-assets` — the canvas-side items from the same audit.

<a id="youtube-attribution-and-revocation"></a>
## HALT — YouTube: no brand attribution, no token revocation, and we call it the wrong product
_Was `docs/plans/HALT_YOUTUBE_ATTRIBUTION_AND_REVOCATION.md` until 2026-10-18 (`docs/ARCHIVE.md` § Moved); its history is under that path._

**Raised:** 2026-08-26 by `compliance-auditor`. All requirements fetched live that day.
**Severity:** YT-2 and YT-3 are **ban risk on the developer account**, not store-rejection risk.
**Routing:** `developer` under TDD → `compliance-auditor` re-audit. YT-2 needs an official asset file.
**Status:** canvas items fixed 2026-08-26 (marked DONE). Shipped items not started.

---

### YT-1 · The integration is YouTube, not YouTube Music

There **is no YouTube Music API**. `backend/app/services/youtube.js:8` calls `https://www.googleapis.com/youtube/v3` with scope `youtube.readonly`, reading `channels`, `videos?myRating=like`, `playlists`, `playlistItems`, `subscriptions`. That is a **YouTube** account connection.

We labelled it "YouTube Music" on `providers.ts:38` and on four boards. That names a Google product we are not connecting, using a mark the API branding licence does not cover — and whose own brand terms are login-gated, so they could not be read at all.

The Branding Guidelines expressly permit the honest form: *"you may reference the fact that your app is for YouTube or works with YouTube."*

**Canvas: DONE** — `Connect.dc.html`, `Components.dc.html`, `You.dc.html` now say "YouTube".
**Shipped:** relabel `providers.ts:38`. Keep the internal `youtube_music` provider key — it is not user-facing. **Never put "YouTube Music" in store metadata or screenshots** until Google's brand approval is obtained.

### YT-2 · HALT — no YouTube brand attribution on any surface that shows YouTube content

> "Any API Client page or feature that displays YouTube content – including, without limitation, search results, YouTube videos, channels, playlists, thumbnails, and YouTube players – **must make clear to the viewer that YouTube is the source** of the relevant content by displaying YouTube Brand Features…"
> — YouTube API Services Developer Policies **III.F.2.1**

The Branding Guidelines name the right asset for exactly our case: the **YouTube Icon** provides attribution when "your application integrates multiple content sources including YouTube; content is intermingled requiring individual attribution; and space constraints make other logos infeasible." That is the mini player. Also: any YouTube logo "must link back to YouTube content", and "You cannot modify the colors of the YouTube logos or YouTube Icons."

Track title and artist on those rows derive from `snippet.title` and `cleanYouTubeArtist(snippet.channelTitle)` when the source is YouTube. That is YouTube content, displayed unattributed.

**Missing playback-surface attribution is the standard cause of YouTube API access revocation for music clients.** `docs/SCREENS.md:30` still carries "playback-surface Spotify/YouTube attribution" as an open item — and the Components board had codified its absence as a rule.

**Canvas: DONE** — the Components attribution rule now reads: the mark *is* the attribution, each row carries the mark of the service that supplied the track and links back to it, with both an `OFFICIAL SPOTIFY MARK` and an `OFFICIAL YOUTUBE ICON` slot, and "a content row never renders without one."

**Shipped:** add a provider discriminator to the mini-player / Now Playing attribution slot. For YouTube-sourced tracks render the **official YouTube Icon** from Google's asset pack — never redrawn, never recoloured — tappable, linking to `https://www.youtube.com/watch?v=<videoId>`. **NEEDS-ASSET.** Write it into the `docs/SCREENS.md` §7/§9 Definition of Done so no screen can merge without it.

### YT-3 · HALT — disconnect never revokes the token at Google

> Every API Client must provide "a clearly explained and easy way for users to revoke any authorization consent", must **"programmatically revoke that token right away"**, and delete all Authorized Data "within 7 calendar days of the revocation."
> — Developer Policies **III.D.2.3.1**

`backend/app/controllers/integrationsController.js:444-480` nulls `user.youtubeMusicToken` locally and reassigns `musicProvider`. **There is no call to `https://oauth2.googleapis.com/revoke`.**

The data-deletion half is satisfied — the rebuild strips `youtube_music` rows. The **revocation half is not**: the refresh token stays live in the user's Google grant list after they were told they disconnected.

**Fix:** POST the refresh token to `https://oauth2.googleapis.com/revoke` inside `youtubeDisconnect`, before the local purge. Best-effort, logged, never blocking the purge — the same shape already used behind `GARMIN_DEREGISTER_ENABLED`.

### YT-4 · YouTube artist names reach Groq under a consent the user may never have seen

`backend/app/services/musicProfileService.js:660-662` collects artist names for `youtube_music` tracks and passes them to `inferArtistGenres`, which posts them in a plaintext prompt to Groq (US) via `geminiEngine.js:367-375`. Those names are `cleanYouTubeArtist(snippet.channelTitle)` off the user's private liked videos and playlists — **Authorized Data**.

The only place the user is told is `Consent.dc.html` §4 — inside the **GDPR Art. 9 health consent**. A user who connects YouTube and declines health consent never sees that sentence. So there is no "express approval" (III.E.3.2) and no "user's consent" for the transfer (Google API Services User Data Policy, Limited Use — which explicitly extends to "data aggregated, anonymized, or derived from" the scopes).

**Fix, in order of preference:**
1. **Delete the transfer.** We already fetch `topicDetails.topicCategories` (`youtube.js:252-279`) — Wikipedia music-genre URLs, a richer signal than an LLM guess. Derive YouTube genres from those and drop `youtube_music` from `LLM_BACKFILL_PROVIDERS`. One edit removes the III.E.3.2 question, the Limited Use question, and the Groq row from the YouTube story entirely.
2. If it stays: move the disclosure into a pre-OAuth sheet on the **YouTube connect** flow, worded identically to the consent copy, and name it in the privacy policy.
3. Separately audit the Groq prompt cache — `docs/PRIVACY_DECLARATIONS.md:73` says the key is `md5(prompt)` and the value is derived params. That value holds genres derived from YouTube artists, cross-user, with no expiry tied to the YouTube grant. Check against III.E.4.3.

**Worth keeping, and explicitly praised by the auditor:** the containment already built — `backend/app/utils/youtubeContent.js` fails closed on scheme and provider, `monitoring/youtubeLeakMonitor.js` counts leaks non-destructively, and `workers/youtubeRetention.worker.js` enforces the III.E.4.3 30-day ceiling with a correct terminal/transient split. None of it addresses III.E.4.8(ii), which on its face prohibits deriving new data from API Data at all — that clause is read narrowly in practice, but Google's enforcement posture **could not be confirmed → UNVERIFIED.**

### YT-5 · Do not promise a decision we do not control

`providers.ts:40` and the canvas said *"Coming once our Google review is complete."* Three problems: "our Google review" implies a relationship with Google; it treats the mark as a possessive-adjacent noun phrase; and if verification is denied, every shipped build carries a false statement — Apple 2.3.1(a), which names misleading marketing as grounds for **termination of the developer account**.

**Canvas: DONE** — now *"Not available yet — we're finishing the sign-in review."* No provider name, no promise, no date. Survives a denial and survives a reviewer.
**Shipped:** same edit at `providers.ts:40`.

**Stating a pending review is itself permitted** — the auditor searched Google's sensitive-scope verification page specifically and found no rule against it.

**The bigger adjacent problem, not this line's fault:** the Connect truth variant offers **zero** working music connections (Spotify halted, YouTube deferred) with "Continue with mood only" as the CTA. A reviewer sees two dead rows and a bypass — Apple 2.1 App Completeness. Consider hiding the Music card entirely until at least one provider is live. **That is a product decision, not an edit.**

### YT-6 · The Profile disconnect alert misrepresents both providers

`mobile/KokonadaHealth/src/experience/profile/ProfileScreen.tsx:122`:

> `Alert.alert('YouTube disconnected', 'Rebuilt your Spotify library (${res.data.library} tracks).')`

- **Spotify:** this states that Kokonada rebuilt the user's *Spotify* library. It did not — it rebuilt Kokonada's own `MusicProfile` from Spotify. A user reasonably reads it as Kokonada having written to their Spotify account. Spotify Developer Policy I.1.a (*"Don't mislead or confuse users about the ways you intend to use their data"*). It is also gratuitous: Spotify connect is halted for public users, so for most users this names a service they have not connected and reports `0`.
- **YouTube:** pressing "Disconnect" shows a spinner labelled **"Rebuilding…"** (`ProfileScreen.tsx:305`) — describing a side effect on a *different* provider rather than the revocation the user asked for. III.D.2.3.1 requires the revocation be clearly explained. And per YT-3, "Disconnect" currently overstates what happens.

**Fix:** `busyLabel: 'Disconnecting…'`. Alert body: *"Your YouTube account is no longer linked, and the music we imported from it has been deleted."* Say nothing about Spotify. If the rebuilt count should be visible, put it on the Spotify row's own reason line as **Kokonada's** library. **Land YT-3 before the copy claims disconnection.**

### PASS — and the limit on it

The app name is "Kokonada", and `providers.ts:19` carries the invariant *"plain-text service name — NEVER an official colored logo/wordmark"*. That satisfies the rule against using "YouTube" or any variant in the app name, and the no-redrawn-wordmark rule. **Keep that comment.**

**It does not clear YT-2.** Plain text is safe as a *service reference*. It is not a substitute for the Brand Feature attribution III.F.2.1 requires on a surface displaying YouTube content.

### UNVERIFIED — do not record as compliant

- **YouTube Music brand terms** — login-gated at `partnermarketinghub.withgoogle.com`. The public sibling (YouTube Kids) requires the ™ symbol on first appearance in creative and states that any creative referring to the marks "must be reviewed and fully approved by Google's brand approvals team". Store screenshots and listing copy are creative; an in-app functional label arguably is not.
- **III.E.4.8(ii)** as applied to derived taste data (see YT-4).

### Related

- `docs/plans/halts.md#spotify-track-ids-to-third-party` — the parallel finding on the other music provider.
- `docs/plans/dev-items.md#spotify-canvas-assets` — the mark-fidelity work that YT-2's fix shares.
