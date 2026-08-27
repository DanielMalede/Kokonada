# HALT — Garmin branding, attribution, and a 30-day notice clock that has not started

**Raised:** 2026-08-26 by `compliance-auditor`. All requirements fetched live that day.
**Routing:** the 30-day notice is **Pause & Guide** (a human must send it). The rest: `developer` under TDD → `compliance-auditor` re-audit.
**Status:** canvas items fixed 2026-08-26 (marked DONE below). Everything else not started.

**Sources.** Garmin API Brand Guidelines **V 6.30.2025**; Garmin Connect Developer Program Agreement **FRM-0952 Rev. B**; Garmin OAuth2.0 PKCE Specification (Last-Modified 2025-07-23); Garmin Health API product page; Garmin trademark notices.

**Extraction caveat, disclosed rather than hidden:** the three PDFs were read through a text-extraction proxy pointed at the official Garmin URLs — no PDF renderer was available in the audit environment. The load-bearing clauses were corroborated by a second independent retrieval. Re-confirm against the PDFs opened directly before acting on the contract clauses.

---

## G1 · The 30-day prior-notice gate has not started — and it gates the whole redesign

> "Licensee shall provide Garmin with **no less than thirty (30) calendar days' prior written notice** of any planned introduction of new content formats, user interfaces, or display mechanisms that incorporate Garmin Brand Features … or display Garmin Device Sourced Data … Such notice must be sent to **connect-support@developer.garmin.com** and **include representative samples or mockups**."
> — Developer Program Agreement §6.6

The canvas *is* a complete redesign of every surface that displays Garmin data — Pulse, Generate, Mix receipt, Consent, Components. The boards **are** the mockups §6.6 asks for.

**This is a schedule risk, not paperwork.** Any ship date inside 30 days of the send is non-compliant on its face regardless of how correct the attribution is. Fix G2–G6 *first*, so the clock starts on the design that actually ships rather than on one that then changes.

Enforcement ladder if it is skipped — §6.5: 14 days to remedy, then Garmin "may reduce the quantity and/or content of Garmin Device Sourced Data", then suspension or termination.

## G2 · "Daily readiness — Garmin-only" is a misattribution: Garmin supplies no readiness metric

Garmin's Health API supplies Steps, Intensity Minutes, Sleep, Calories, Heart Rate, Stress, Pulse Ox, Body Battery, Body Composition, Respiration, Blood Pressure, Enhanced Beat-To-Beat Interval. **No readiness metric of any kind.**

Our own adapter agrees — `backend/app/services/wearable/adapter.js:269-333` `normalizeGarminSummaries` handles `sleeps | dailies | hrv | respiration | pulseox | stressDetails` and never emits `dailyReadiness`. A grep for `readiness` under `backend/app/services/wearable/` returns **zero matches**.

So the app tells users, in a health-consent context, that a metric is Garmin's when Garmin does not supply it. That is Agreement §5.2(g) — do not "mislead or confuse End Users as to the features, functionality, origin, capabilities, or other aspects of … the API".

**Shipped fix:** `mobile/KokonadaHealth/src/experience/pulse/pulsePresentation.ts:107` must not return `GARMIN_ONLY` for `dailyReadiness`. It needs a third note type — a source boundary with no named vendor and no retry affordance. Correct the comments at `backend/app/services/medicalProfileService.js:246` and `backend/app/models/MedicalProfile.js:65`; the model itself is unsure whose metric it is (*"Garmin/Whoop readiness score"*).

**Open product question, not a copy edit:** if no integrated source supplies it, either wire one or delete the metric. A row that can never populate is furniture.

**Canvas: DONE** — `Pulse.dc.html` and `Components.dc.html` now read "Not available · no connected source supplies it".

## G3 · No Garmin attribution exists on any populated surface

> "**TITLE-LEVEL OR PRIMARY DISPLAYS** — All uses of Garmin device-sourced data within dashboards, activity feeds, overview cards or summary views must include a **'Garmin [device model]'** attribution … Position the Garmin attribution directly beneath or adjacent to the primary title … **above the fold** … **Never bury the Garmin attribution in tooltips, footnotes or expandable containers.**"

In the shipped app the Garmin name appears **only in the empty state**. `pulsePresentation.ts:95,107` returns `GARMIN_ONLY` only when the value is null; `PulseScreen.tsx:153-162` renders label plus number and nothing else when a value exists.

Worse: `warmStore.ts:7` — `type BiometricSource = 'ble' | 'health-connect' | 'none'`. **There is no `'garmin'` member.** The app has no surface capable of rendering a Garmin attribution at all.

Also engaged, and unaddressed anywhere:

> "**COMBINED OR DERIVED DATA** — All uses of Garmin device-sourced data as an input to analytics, algorithms, machine learning models … must include a Garmin attribution … The attribution must list Garmin as a distinct or contributing data source (depending on what is true) and **must not imply Garmin endorsement of data from other devices**."

Kokonada's whole product is derived data. The Mix receipt's "WHY THIS MUSIC" and "Your body said — HRV 29 ms" carry no attribution.

The exemption does not rescue us: §6.4.a covers only the "defense, research, or remote patient monitoring" markets. Kokonada is consumer wellness with Kokonada branding.

**Fix:** add `'garmin'` to `BiometricSource`; render the attribution when the value is **present**, not only when absent; add it to the receipt surfaces as a *contributing* source, worded so it cannot imply Garmin endorsed the Health Connect or BLE inputs blended alongside; pin both with tests beside the existing honest-empty tests.

## G4 · `Garmin [DEVICE MODEL]` is an unresolved placeholder, and the bare-"Garmin" fallback is not yet justified

The fallback is permitted — but conditionally:

> "Access the device model information as instructed in the applicable API documentation. **If the device model is not provided or unknown via the API, list Garmin as the data source.**"

The canvas justifies bare "Garmin" with *"PulseState carries no device model"* (`Pulse.dc.html:145`). That is a statement about **our DTO**, not about **Garmin's API**. "We didn't plumb the field through" is not "not provided or unknown via the API".

**UNVERIFIED** — whether the Health API returns a device/model field could not be checked; the REST API Specification is behind the developer-portal login.

**Fix:** open the spec, record the answer in-repo with the doc version cited, then either plumb the model through or record the citation justifying the fallback so a future reviewer need not re-litigate it. **Never let the literal string `[DEVICE MODEL]` reach a build** — degrade to `Garmin`, never to the placeholder.

## G5 · Generic BLE straps are stamped as Garmin

`mobile/KokonadaHealth/src/health/bleHeartRate.ts:23-24` streams from "the first device advertising the standard BLE Heart Rate Service (0x180D)" — a generic profile that a Polar, Wahoo or Coros will match. `liveHrClient.ts:14` documents that minting the watch token "also flips the user's `wearableProvider` to `'garmin'`".

Invisible today, because the UI shows "Heart-rate sensor" for `ble`. **It becomes a false claim the moment G3 lands** — the exact case §6.5's "must not imply Garmin endorsement of data from other devices" names.

**Fix this before G3, not after.** Derive the provider from the actual pairing lane (Connect IQ app → Garmin; generic 0x180D → generic), or add a `ble_generic` value.

## G6 · Trademark form and the connection surface

- **"Body Battery" was mis-set as "Body battery"** on `Components.dc.html` and `canvas.json:40`. Rendering a proper-noun mark as a common noun is textbook genericization. **Canvas: DONE** (now `Body Battery™`). Shipped `pulsePresentation.ts:32` and `ConsentSheet.tsx:29` still read `Body Battery` unmarked — align them and pin with a unit test so four spellings of one mark cannot re-emerge.
- **Body Battery sits outside the §6.1 licence.** The licensed set is the Garmin / Garmin Connect / mountain-bike-dynamics word marks. Garmin's own developer guidance contemplates partner views showing "Body Battery™ energy monitoring", so nominative use is clearly anticipated — but the express licence does not cover it, and the trademark notice says these marks "may not be used without the express permission of Garmin". **Send one written request** to `connect-support@developer.garmin.com` confirming (a) the required marking form in a partner UI and (b) that display of the mark to label Health API `bodyBattery` data is permitted. §6.4.a shows Garmin issues written approvals, so this is a normal request. Keep the reply on file.
- **`Plan.dc.html` used "a Garmin" as a countable noun.** **Canvas: DONE.**
- **§6.1 requires Garmin Brand Features on the connection surface** — "Licensee **must** include the Garmin Brand Features in Licensee Applications … for these limited purposes." The connect row is generic ("Wearable & Health"). Text-only naming — "Garmin Connect", never abbreviated or stylized — is sufficient and lower-risk than the "works with" badge. Activates at go-live; not a defect while the lane is dark.
- **PASS, and worth protecting:** no Garmin tag logo is used anywhere, so none of the logo-misuse clauses is triggered. `ProfileScreen.tsx:162` already says "Open Garmin Connect → Settings → Health Connect" — the required full app name.

## UNVERIFIED — do not record as compliant

1. **Trademark-symbol policy for third parties.** No publicly reachable Garmin document mandates that a third party append ™/®. The document that would say — the Consumer Brand Style Guide at `creative.garmin.com` — is behind Garmin's Confidentiality Agreement. **Pause & Guide: a human must accept it and retrieve the guide.** Interim safe posture: mirror Garmin's own notice once in the legal/about surface — *"Garmin® and Body Battery™ are trademarks of Garmin Ltd. or its subsidiaries, registered in the USA and other countries."* Copied from Garmin, so it cannot itself be wrong. In running UI text keep bare `Garmin` as an adjective: "Garmin Forerunner 265", "a connected Garmin device". Never "a Garmin", never "garmin".
2. Whether the Health API exposes a device model (G4).
3. **Whether a Kokonada ToS exists carrying the Garmin-benefit clauses §5.3 requires** — "a written agreement with each End User that contains protections and limitations of liability, in each case for the benefit of Garmin, at least as protective as those contained in this Agreement." The consent notice is an Art. 9 notice, not a ToS. This is a distinct deliverable and a condition of the licence.

## Out of scope, flagged

`watch/manifest.xml` declares a **Connect IQ watch app** (fenix7, fr255, venu2; `Communications` + `Sensor` permissions). Connect IQ is governed by a **different agreement and different brand guidelines** from the Health API surface audited here, and the Connect IQ Store has its own submission requirements. The app name "Kokonada HR" contains no Garmin mark, which is correct. **Nothing else about that surface has been audited.** Commission a separate audit before any sideload-to-store transition.

## Related

- `docs/plans/DEV_GARMIN_DEREGISTRATION_ON_DELETE.md` — the other Garmin blocker, and the more urgent one.
