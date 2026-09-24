# Track H regulatory dossier (gates G1 and G5). Prepared for counsel; nothing here is a legal decision.

Sources were fetched on 2026-09-23. Status tags: **RET** means the primary text was retrieved and quoted. **REP** means a reproduction that still needs Official Journal confirmation. **COM** means commentary. **UNR** means not retrieved. Path prefixes: `M` = `C:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src`, `B` = `C:\Users\danie\Videos\Kokonada\backend\app`.

The task asked for rulings on DT-7 (item 4) and H2 (item 5). I have not given rulings. Each gets a branch map instead, because both are questions of law for counsel.

## 0 · Product facts that change the picture (new since `r_regulatory.md`)

- **N1. A heart-rate path with no consent check.** When a user has no emotion input and a live heart rate exists, the Generate button offers "Listen to your heart" (`M\experience\generate\generateController.ts:75-82`).
  - Tapping it sends the phone's heart-rate reading to the server (`M\net\socketClient.ts:317-326`).
  - The `request_heart_playlist` handler has **no consent check** (`B\sockets\biometricHandler.js:1816-1830`). It falls back to the client's value (`:525-527`) and sets `stableHR`.
  - That value then feeds the affect engine (`:848`, through `buildTargets` into `resolveAffect`). It is also saved as `PlaylistSession.biometricSnapshot.heartRate` (`:958`). The model itself labels that field "special-category health data" (`B\models\PlaylistSession.js:19-21`).
  - Only `biometric_push` is gated (`:1769-1777`). So "the server gates ingestion" (`r_regulatory.md` F11) is **not true for this path**.
- **N2. The Bluetooth scan connects to the first heart-rate broadcaster it finds.** There is no pairing or device choice (`M\health\bleHeartRate.ts:45-50`), so the app can read a nearby stranger's heart rate.
- **N3. The heart-rate stream is never stopped.** The `LiveHrSession` handle is thrown away (`M\prodBootstrap.ts:77,93`; `M\appBootstrap.ts:33`).
  - The logout teardown clears the watch token but never calls `stop()` (`M\experience\profile\sessionTeardown.ts:24-40`).
  - Consent withdrawal calls only the API (`M\experience\profile\ProfileScreen.tsx:179-188`).
  - So the on-device reading continues after both.
- **N4. Minting the watch token needs no consent.** It also stamps `wearableProvider='garmin'` on the account (`B\controllers\integrationsController.js:701-720`). That runs at every sign-in, before the Bluetooth permission prompt (`M\health\liveHr.ts:24,26`). On API 30 and below, that prompt asks for **location** (`M\health\blePermissions.ts:18-23`).
- **N5. When a wearable user's data starts being processed.** After the Art. 9 grant, the Connect screen syncs straight away (`M\experience\connect\connectController.ts:56-57`). That queues a state recompute 60 seconds later (`B\services\wearable\metricStore.js:188-195`), which runs `resolveAffect` (`B\workers\stateVector.worker.js:50-70`). **So a consented user's data is processed starting on the Connect screen, just before Generate first appears.**
- **N6. "100% read confidence" is rule coverage, not accuracy.** Pulse prints `${confidence*100}% read confidence` (`M\experience\pulse\PulseScreen.tsx:199-203`). The legacy classifier's "confidence" is 1.0, 0.7 or 0.5 depending on how many rule conditions were evaluated (`B\services\medicalProfileService.js:179,183`). It does not measure accuracy.
- **N7. The Pulse label comes from nine hand-written rules, not the affect engine.** The server serves `stateVector.status` from `computeStateVector` (`B\services\medicalProfileService.js:195,223`; `B\controllers\pulseController.js:188-197`). The taxonomy id never ships (`:52-53`).
  - **Correction to `critique.md:145`:** "Pre-Panic" did not leak through `BAND_LABELS`. It leaks through `stateVector.status` and the capital-letter passthrough in `M\experience\pulse\statusLabels.ts:23`. `BAND_LABELS` is not rendered anywhere.
- **Route order.** Splash → Onboarding → Sign-in → Connect → App.
  - Onboarding appears only when there is no user and the device has never seen it (`M\navigation\routeMachine.ts:23-24`). It is one-way, and Skip is available from panel 1 (`M\onboarding\OnboardingScreen.tsx:125-134`).
  - Generate is the first tab (`M\navigation\tabRoutes.ts:6`; `RootNavigator.tsx:36`), with no navigation-state persistence. So **Generate is the first screen shown on every entry into the app**. Pulse mounts only when the user opens it.

## IN FORCE NOW / APPLIES FROM

| Instrument | Position on 2026-09-23 | Status |
|---|---|---|
| AI Act (Reg. 2024/1689) | In force since 1 Aug 2024; Art. 3 and Art. 5 apply since 2 Feb 2025 | RET (Commission Guidelines C(2025) 5053, paras 1 and 4) |
| AI Act Art. 50(3) and 50(5) | **Apply from 2 Aug 2026.** The only grace period is for Art. 50(2), to 2 Dec 2026, and only for systems placed on the market before 2 Aug 2026 | RET (Commission Art. 50 FAQ, page dated 24 Jul 2026) |
| Digital Omnibus, Reg. 2026/1744 | Official Journal 24 Jul 2026; in force 27 Jul 2026 (COM). The Service Desk banners on Articles 2, 3 and 50 say "amended … not yet updated", so the Art. 50 text quoted below is the **pre-Omnibus reproduction** | OJ text UNR |
| AI Act Art. 2(8) | "…does not apply to any research, testing or development activity… prior to their being placed on the market or put into service… Testing in real world conditions shall not be covered by that exclusion." | REP |
| GDPR | Applies (since 25 May 2018) | REP |
| ePrivacy Directive Art. 5(3) | Applies through national law; EDPB Guidelines 2/2023 v2.0 adopted 7 Oct 2024 | RET (PDF cover; the landing page says 16 Oct) |
| MDR (Reg. 2017/745) | Applies (since 26 May 2021); MDCG 2019-11 rev.1, June 2025 | MDR REP; MDCG RET |

**What this means in practice:**
- For ≤5 hand-enrolled users, whether the AI Act obligations are live today turns on "putting into service" (Art. 3(11)) versus excluded testing (Art. 2(8)). That is open.
- GDPR, ePrivacy and the MDR have no testing exclusion. **So H2 and the MDR label fix are measured against law that applies today, whichever way that question goes.**

## THE PIVOT

**For a user on the wearable path, is the "first … exposure" in Art. 50(5) the moment Kokonada starts processing their biometric data, or the moment they first see an output?**

- Processing starts on the Connect screen after the Art. 9 grant (N5).
- The first output they see is Generate, a few seconds later, and Pulse after that.

**Why this one question matters for both tracks:**
- It decides whether the three-surface interim (DT-7) reaches wearable users on time.
- It explains why H2 matters for the AI Act as well as GDPR. Today, unconsented heart rate reaches the affect engine through N1.
- Art. 50(3) itself says deployers "shall process the personal data in accordance with Regulations (EU) 2016/679…" (REP).

## OBLIGATIONS THAT ATTACH REGARDLESS (the build can act on these now)

Everything in this section is a **draft for counsel, not cleared copy**. One exported constant per string, pinned by test.

### D1. AI Act Art. 50(3) disclosure

- **`AI_DISCLOSURE_LONG`** is the text `compliance-auditor` already ruled on twice (`TASKS.md:240`), reused verbatim to avoid wording drift:
  > An AI system infers your emotional state here. It is a machine's reading, not a person's — and it can be wrong.
- **`AI_DISCLOSURE_SHORT`**, for persistent chrome. It drops "here" because no processing happens on Onboarding:
  > An AI system infers your emotional state. It can be wrong.
- **Do not add an input sentence yet.** A line such as "It uses readings from your wearable only if you've agreed" is false today because of N1 and N2. It becomes true only after H2 and a server-side refusal of unconsented heart rate are both verified.
- The wording is second person, makes no efficacy or medical claim, and has no workplace or education wording. It says "AI system" and "emotional state" on purpose. Softening those words changes nothing legally, because Art. 3(39) is an objective purpose test.

**Where it goes:**

| Surface | Constant | Placement |
|---|---|---|
| Generate (first in-app surface, initial tab) | LONG | Persistent, above the fold, between the hero and the Live toggle (`GenerateScreen.tsx:280-282`), on `textScrimFill`. Present on the first frame, before any submit. |
| Onboarding | SHORT | In the bottom chrome (`OnboardingScreen.tsx:137`), visible on all 3 panels, including panel 1 before Skip. |
| Pulse | SHORT | Next to the state headline (`PulseScreen.tsx:198`), whenever a status renders. |

**What the text itself requires:**
- **Art. 50(5):** "clear and distinguishable manner at the latest at the time of the first interaction or exposure. The information shall conform to the applicable accessibility requirements." (REP)
- **Recital 132:** notices should be "provided in accessible formats for persons with disabilities." (REP)
- **Commission FAQ (RET):** the duty "does not entail providing information regarding e.g. the purpose of the system's operation", and it applies "regardless of whether the persons are exposed to such systems in real-time or they are operated ex-post".
- **The text does not require** persistence, repetition or non-dismissibility.
- **Guidelines, as reproduced (REP, not settling):**
  - Point 142: the notice fails "if it can easily be overlooked, for instance in a manual or in the terms of use".
  - Point 143: "First exposure applies to each output and each person, and if it is foreseeable that the content will not be perceived from the beginning, initial disclosure must be complemented at later moments."

**Build posture that works on every reading (my preparation, not a ruling):**
- Make the notice **persistent and not dismissible** on Generate and Pulse.
- Onboarding is per device, one-way and skippable (MB-009), so it is foreseeable that users miss it. A "dismissed" flag would inherit the same per-device defect unless it is keyed per account.
- Render it as a single text node in the accessibility tree, meeting AA contrast on the worst aurora frame, and scaling to 200% font.

### D2. Not-a-medical-device line (`MEDICAL_DISCLAIMER`, Pulse)

> Kokonada is not a medical device and does not diagnose, treat, cure, or prevent any medical condition.

- It matches the store-listing wording `compliance-auditor` registered (`r_compliance.md:236`, P-HEALTH). I did not re-verify that wording.
- Render it in the Pulse body wherever readings or a state appear, not only inside the StateCard.
- **The disclaimer is not a safe harbour.**
  - MDR Art. 2(12) sets the intended purpose from "promotional or sales materials or statements" (REP).
  - MDCG 2019-11 §3 says claims must be backed by clinical evidence or the software cannot "present said claims" (RET).
  - So D3 below is what actually changes the MDR position. The disclaimer alone does not.

### D3. Display vocabulary

Backend keys stay as they are. Every string that can reach the screen today goes through the Pulse StateCard headline via `friendlyStatus`. Recommended implementation: an allow-list that **fails closed** on anything unmapped.

| Backend key (`medicalProfileService.js`) | Rendered today | Proposed display | Class |
|---|---|---|---|
| `High-Stress / Pre-Panic` (:20) | Verbatim | **Highly activated** | **REQUIRED.** "Pre-" is a prediction of a condition (MDR Art. 2(1) "prediction", REP), set off by a single physiological threshold. MDCG Annex I d): "A software module generating alarms based on the monitoring and analysis of patient specific physiological parameters is qualified as a medical device" (RET). |
| `Peak Athletic Performance` (:36) | Verbatim | Peak effort | Optional. Pinned by `PulseScreen.test.tsx:181,233`. |
| `Intense Workout` (:51) | Verbatim | Working hard | Optional. The rule fires on heart rate alone (:59), so "Workout" is an unverified claim. |
| `Active Recovery` (:66) | Verbatim | Cooling down | **COUNSEL** ("recovery", open question Q3) |
| `Exhausted Commute` (:86) | Verbatim | Low on energy | Recommended. "Exhausted" is a health verdict, and no input tells the app the user is commuting (:88-93). |
| `Screen-Off / Background Listening` (:100) | Verbatim | Listening in the background | Optional |
| `Deep Focus / Flow State` (:117) | Verbatim | Deep focus | Optional. Pinned by `statusLabels.test.ts:14`. |
| `Morning Activation` (:138) | Verbatim | Morning activation | Keep |
| `Resting / Meditative` (:151) | Verbatim | Resting | Optional. The rule cannot observe meditation. |
| `Neutral` (:183) and legacy `natural` | "Balanced" (`statusLabels.ts:8-9`) | Steady | **COUNSEL.** "Balanced" reads as an evaluation, close to the forbidden "normal/healthy", and it shows even when resting heart rate is missing (D-4a). |
| Any other string (legacy rows, future rules) | Passed through or title-cased (`:23-24`) | Fail closed to a neutral constant, e.g. "Current state" (final copy from `designer` plus me at G5) | **REQUIRED.** The passthrough is how "Pre-Panic" got out. |

**Test conflict for `architect`.** Changing `friendlyStatus` itself breaks D-series pins: `statusLabels.test.ts:14-16,20-21` (D-4b pins passthrough and title-casing). A separate display layer applied after `friendlyStatus` would leave D-4b untouched. The minimum required change (rows 1 and the fail-closed row) touches no current `PulseScreen` assertion. Keep `statusQuadrant` (`pulsePresentation.ts:126-133`) keyed on the raw backend string.

**On the wire but not rendered today.** `pulseApi.ts:12-18` has no `affect` or `morning` fields, and nothing in the client consumes them. They must be mapped before any v2 page shows them:
- `affect.domain` values: rest, stress, focus, movement, rhythm, emotional (`stateTaxonomy.js:87`). **Never render `stress` or `emotional` verbatim (COUNSEL).**
- `affect.band` values: resting, active, peak. Suggested: "Resting", "Active", "Peak energy" (these match the History titles).
- `BAND_LABELS`: min, low, mid, high, peak, plus n/a (`affectEngine.js:198`), used for `readinessBucket` and `sleepDebt`. **"Readiness" and "sleep debt" are COUNSEL terms.**
- `drift.flagged` / `drift.direction`: **do not render without counsel.** It is a monitoring alert on physiological parameters, which touches Rule 11b (MDCG §4.2.1, RET).

**Never shipped today:**
- The 34 taxonomy ids. Before any of them is displayed, counsel is needed for `acute-stress`, `simmering-tension`, `anxious-restless`, `overload-needs-downshift`, `recovering-from-stress`, `mental-fatigue`, `low-mood-low-energy`, `restless-distracted`, `obligated-workout-low-recovery` and `drowsy-low-battery`.
- `receipt.why`, which the client currently drops.

**Checked and clean:** History titles (`B\services\sessionLabels.js:9-19`) and receipt labels (`biometricHandler.js:147-160`) contain no clinical terms.

### Other items that attach regardless

- **The H2 gate** (below) is the only configuration defensible on every branch.
- **Do not change consent copy or versions** during the interim. This keeps each grant tied to the text actually shown (Art. 7(1): "the controller shall be able to demonstrate that the data subject has consented", REP).

## BRANCH MAP

### DT-7: three surfaces now, the ConsentSheet later

| Branch (answer to the pivot) | What follows |
|---|---|
| **A.** First exposure is the first output seen (Generate) | The interim reaches every person at or before first exposure, because Generate always renders first. Leaving the ConsentSheet out affects only whether the GDPR consent is informed, not Art. 50. |
| **B.** First exposure is when processing starts (Connect, after the grant; N5) | Wearable users who never saw the Onboarding chrome get the notice a few seconds after processing begins. That covers already-onboarded devices, a second account on the same device, and anyone who skipped instantly. Whether that satisfies "at the latest" is for counsel. **A fix that avoids a consent version bump:** show SHORT on the Connect Services wearable card, outside the consent document. Counsel must say whether text next to the consent wall has to be versioned with it (R4). |
| **C.** Art. 50(3) does not attach (not an emotion-recognition system, no deployer, or Art. 2(8) testing) | The interim is voluntary and carries no AI Act exposure either way. |
| **Every branch** | The v1 consent text is placeholder (`ConsentSheet.tsx:16,35`) and never mentions emotion inference (`:51-54`). That informed-consent gap (R2) predates DT-7 and lasts until counsel's copy and the v1→v3 version bump. DT-7 neither fixes it nor makes it worse. |

**Conditions for counsel to weigh the interim against:**
1. LONG shows on Generate's first frame, persistently.
2. SHORT sits next to the Pulse state.
3. SHORT is in the Onboarding chrome on all panels.
4. The interim has a date and an end: counsel's copy plus the version bump.
5. Counsel decides whether the already-enrolled cohort needs direct notice. They have been processed after the fact by the nightly worker since 2 Aug 2026.
6. There are no store listings during the interim.

### H2: heart-rate reading, Bluetooth prompts and `whr_` token minting before consent

**Secondary pivot:** is a live heart-rate value of an identified user "data concerning health" (Art. 4(15): "…which reveal information about his or her health status", REP)?

| Branch | What follows |
|---|---|
| **H-A.** Yes, it is health data | Art. 9(1) prohibits the processing unless 9(2)(a) applies: "explicit consent… for one or more specified purposes" (REP). Today's code runs these steps without that consent: display on the device, sending to `/watch/hr` (then refused with a 403), and N1, where the server saves the value and feeds it to the affect engine. |
| **H-B.** No, it is not health data | GDPR still needs a lawful basis under Art. 6. ePrivacy 5(3) applies when locally produced data is sent to a server (EDPB 2/2023 para 53; paras 58 and 60 cover a device relaying over Bluetooth: "a 'gaining of access'", RET). The exemption for a service "explicitly requested by the subscriber or user" has no obvious footing for a mood-only user. |
| **H-C.** Data stays on the device only | EDPB para 44 (RET): no "gaining of access… as long as the information does not leave the device". **The current code is not in this branch**, because both `pushLiveHr` and N1 send the data off the device. |
| **Every branch** | N2 (a stranger's heart rate) is not cured by any consent gate and needs device selection or an ownership check. Play policy P-UD requires a prominent disclosure immediately before the Bluetooth permission (`compliance-auditor` finding C6, a HALT). |

**The gate** (prepared as the configuration defensible on every branch; not a ruling). The live heart-rate lane covers token minting, the Bluetooth permission request, scanning, the REST fallback and writes to `warmStore.liveHr`. Start it only when all of these hold:
1. A signed-in identity is present.
2. A **fresh server check** says `granted && !staleVersion` for `health_biometric_processing`, which is the check behind `ready | granted_ack` (`consentStore.ts:47,87`).
   - Re-check at each boot, sign-in and return to foreground, and fail closed on any error.
   - `granted_ack` alone is a temporary state of one consent sheet, so it cannot serve as the lasting condition.
3. The account took an **affirmative wearable-path action**. Do not infer this from `!moodOnly`: that flag is one-way and wrong in both directions (`connectStore.ts:31-32`).
4. The disclosure required before the Bluetooth prompt has been shown (owned by `compliance-auditor`).

**Stop the lane** with the same rigour when withdrawal succeeds, on logout or account deletion, and when a re-check comes back not granted or stale:
- Call `stop()` on the session.
- Clear `warmStore.liveHr`.
- Clear the watch token.

These are extra steps added to teardown; the existing teardown order stays the same.

**Server-side checks that do not trust the client** (flag the scope for `architect`):
- Require a current grant on `POST /watch/token` (`integrationsController.js:714`).
- Stop stamping `wearableProvider='garmin'` (`:704`).
- Refuse the client's heart rate in `request_heart_playlist` unless a grant exists (`biometricHandler.js:525-527`).

`player.connect()` moves no health data. It is outside my remit and belongs to `compliance-auditor`.

## THE COUNTER-CASE

- **AI Act.**
  - The argument: Art. 2(8) excludes pre-market testing. Users acting in a personal capacity are not deployers (Art. 3(4)). Heart rate and HRV are not Art. 3(34) data, since the examples given are "facial images or dactyloscopic data". The Pulse label comes from hand-written rules, which Recital 12 excludes ("rules defined solely by natural persons"; Guidelines C(2025) 5053 paras 40 and 46, RET).
  - What it must overcome: Art. 2(8)'s own line that "Testing in real world conditions shall not be covered". Kokonada runs the inference itself, for a commercial purpose (Guidelines point 13, REP: "authority… means responsibility for the decision to deploy it"). Art. 3(34) has no identification requirement. The affect engine infers states in an explicitly emotional domain (`stateTaxonomy.js:455-482`). Guidelines para 39 counts logic- and knowledge-based inference engines as AI techniques (RET).
  - None of this changes the decision to ship H1, because UI-005 ships in every branch. It changes only whether H1 is a live legal duty today.
- **MDR.**
  - The argument: this is a wellness app. MDCG §3.1 (RET): "wellness or fitness apps, do not qualify as MDSW". Recital 19 excludes "life-style and well-being purposes" (REP, via search snippet only).
  - What it must overcome: the rendered "Pre-Panic" label, the alarm example in MDCG Annex I d), and Art. 2(12)'s rule that claims set the intended purpose.
- **GDPR (H2).**
  - The argument: the data is shown briefly on the device and the server refuses it.
  - What it must overcome: GDPR Recital 18 (REP), "this Regulation applies to controllers or processors which provide the means for processing personal data for such personal or household activities". Also N1's saved heart rate, the transmission itself (EDPB paras 53 and 60), and the stamped account attribute (N4).

## UNRETRIEVED

1. **Art. 50 Guidelines C(2026) 5054** (20 Jul 2026). The Commission link served a binary file that my reader cannot open; it is saved at `C:\Users\danie\.claude\projects\c--Users-danie-Videos-Kokonada\3181c7f6-a2e3-45a7-ba43-a520798841cb\tool-results\webfetch-1790175420328-gs00qe.bin`.
   - Would settle: the pivot (points 141-144), who the deployer is in a consumer app (points 10-17), and persistence and dismissal.
   - How: rename the file to `.pdf` and read it, about 30 minutes. **Top priority.**
2. **Official Journal text of Reg. 2024/1689 as amended by Reg. 2026/1744.** EUR-Lex (HTML, PDF and ELI routes) returned empty pages.
   - Would settle: whether the Omnibus touched the text of Art. 50(3) or 50(5), and whether the in-force date is 27 or 29 July.
   - How: open it in a browser, about 10 minutes.
3. **MDR Official Journal text** (Art. 2 and Recital 19): blocked the same way. Recital 19 rests only on a search snippet.
4. **EDPB Guidelines 05/2020 on consent**, paras 64, 107-108 and 114 (not fetched this session). Would settle whether adding emotion inference to the consent needs re-consent or only re-informing.
5. **CJEU C-21/23** and national data-protection-authority positions on wearable heart rate as health data. Would settle branch H-A.
6. **Play health and user-data policy wording** belongs to `compliance-auditor`. I did not re-fetch it.
7. **Whether any `PlaylistSession` rows exist** that were created through the N1 path for users without a grant. This needs a database query by the owner.

## QUESTIONS FOR COUNSEL (ordered by how much they unblock)

1. **The pivot, and the Connect-screen fix.** Is first exposure for a wearable user the start of processing at the grant, or the Generate screen a few seconds later? If it is the grant, may the notice sit on the Connect Services screen, outside the consent document, without being versioned with it?
2. **Is live heart rate "data concerning health"?** Does showing it on the device before consent count as Kokonada's processing? Does transmitting it and then refusing it with a 403 count as collection?
3. **The N1 exposure.** Heart rate has been saved server-side without consent. What remediation is needed beyond closing the path: erasure, a record, notification?
4. **Third-party heart rate (N2).** What is owed to non-users whose heart rate was read? Must device ownership be confirmed before any read?
5. **Scope of the v1 grant.** Does it cover the Bluetooth lane and emotion inference? The text is placeholder and framed around Health Connect. Or must Bluetooth wait for the v3 re-consent?
6. **AI Act status today.** Is ≤5 hand-enrolled users "putting into service" or testing under Art. 2(8)? Is Kokonada the deployer?
7. **Is the nine-rule classifier an "AI system"?** This decides whether the notice next to the Pulse label is accurate or merely over-inclusive.
8. **Vocabulary approval**, in particular: stress, recovery, readiness, sleep debt, exhausted, balanced.
9. **Must "100% read confidence" go?** Does it contradict "it can be wrong"?
10. **Existing cohort.** Does the after-the-fact processing since 2 Aug 2026 require direct notice?
11. **Language.** Is an English-only interim acceptable for EU users?

## WHAT I AM NOT SAYING

- I am not saying the interim satisfies Art. 50, that Art. 50 applies, that today's Bluetooth lane is unlawful, or that the gate makes it lawful. The v1 consent is placeholder copy.
- I am not saying the disclaimer settles the MDR question, or that any label is "cleared".
- I am not saying renaming labels affects the AI Act position. It does not. It matters only for MDR claims.
- I am not deciding DT-7 or H2, and I am not advising whether to proceed.
- I did not verify Play or Spotify terms.

## Per-source status (all fetched 2026-09-23)

- **AI Act Service Desk** — Art. 50(1), (3), (5), (6); Art. 3 points 1, 4, 9, 10, 11, 34, 39, 57; Art. 2(8) and 2(10); Recitals 12, 18, 132: **REP**, bannered "amended by the Digital Omnibus… not yet updated".
- **Commission Art. 50 FAQ** (page dated 24 Jul 2026): **RET**.
- **Commission Guidelines on the AI-system definition, C(2025) 5053 final** (29 Jul 2025), paras 1, 4, 26, 39, 40, 46: **RET**. How it relates to C(2025) 924 (6 Feb 2025) is not verified.
- **Art. 50 Guidelines**, via the ai-resources.eu reproduction, points 13 and 141-144: **REP**. It appears paraphrased and cannot settle anything.
- **Art. 50 Guidelines C(2026) 5054**: library page metadata **RET** (adopted 20 Jul 2026); the text itself **UNR**.
- **MDCG 2019-11 rev.1** (June 2025): **RET**. By its own disclaimer it is not legally binding.
- **MDR Art. 2(1) and 2(12)**: **REP**. **Recital 19**: **REP** (search snippet only).
- **GDPR Art. 4(2), (7), (11), (15); Art. 7(1), (3); Art. 9(1), 9(2)(a); Recital 18**: **REP**.
- **EDPB Guidelines 2/2023 v2.0**, paras 1, 4, 13, 15, 40, 44, 53, 58, 60: **RET**.
- **EUR-Lex** (Reg. 2024/1689, Reg. 2017/745, Reg. 2026/1744): **UNR**.
- **Commentary** (COM, context only): Faegre Drinker, and search summaries on the Omnibus. Bird & Bird returned a paywall (HTTP 402), so **UNR**.

Sources:
- [AI Act Service Desk, Art. 50](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-50) · [Art. 3](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-3) · [Art. 2](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-2) · [Recital 12](https://ai-act-service-desk.ec.europa.eu/en/ai-act/recital-12) · [Recital 18](https://ai-act-service-desk.ec.europa.eu/en/ai-act/recital-18) · [Recital 132](https://ai-act-service-desk.ec.europa.eu/en/ai-act/recital-132)
- [Commission Art. 50 FAQ](https://digital-strategy.ec.europa.eu/en/faqs/transparency-obligations-under-article-50-ai-act) · [Art. 50 Guidelines library page](https://digital-strategy.ec.europa.eu/en/library/guidelines-transparency-obligations-providers-and-deployers-ai-systems) · [Guidelines download (binary)](https://ec.europa.eu/newsroom/dae/redirection/document/131215) · [ai-resources.eu reproduction](https://ai-resources.eu/soft-law/transparency-guidelines-art-50/)
- [Commission AI-system definition Guidelines C(2025) 5053](https://ai-act-service-desk.ec.europa.eu/sites/default/files/2025-08/commission_guidelines_on_the_definition_of_an_artificial_intelligence_system_established_by_regulation_eu_20241689_ai_actenglish_nf2skcqfrtjdfggjavcodopcwz4_112455.PDF)
- [MDCG 2019-11 rev.1](https://health.ec.europa.eu/document/download/b45335c5-1679-4c71-a91c-fc7a4d37f12b_en) · [MDR Art. 2 (reproduction)](https://www.medical-device-regulation.eu/2019/07/10/mdr-article-2-definitions/) · [TÜV SÜD MDR recitals (search source for Recital 19)](https://de-mdr-ivdr.tuvsud.com/Recitals-MDR.html)
- [EDPB Guidelines 2/2023 v2.0 PDF](https://www.edpb.europa.eu/system/files/2024-10/edpb_guidelines_202302_technical_scope_art_53_eprivacydirective_v2_en_0.pdf) · [EDPB 2/2023 landing page](https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-22023-technical-scope-art-53-eprivacy-directive_en)
- GDPR (reproductions): [Art. 4](https://gdpr-info.eu/art-4-gdpr/) · [Art. 7](https://gdpr-info.eu/art-7-gdpr/) · [Art. 9](https://gdpr-info.eu/art-9-gdpr/) · [Recital 18](https://gdpr-info.eu/recitals/no-18/)
- Commentary: [Faegre Drinker](https://www.faegredrinker.com/en/insights/publications/2026/7/eu-ai-act-commission-confirms-transparency-code-of-practice-as-adequate-and-publishes-final-version-of-its-guidelines-on-transparency-obligations) · [White & Case, Omnibus](https://www.whitecase.com/insight-alert/eu-ai-omnibus-enters-force-amending-ai-act) · [Usercentrics, Omnibus](https://usercentrics.com/knowledge-hub/eu-ai-act-high-risk-delay-article-50-transparency-consent/)
- Not retrieved: [EUR-Lex 2024/1689](https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng) · [Bird & Bird (HTTP 402)](https://www.twobirds.com/en/insights/2026/european-commission-adopts-final-guidelines-on-ai-act-article-50-transparency-obligations-first-impr)