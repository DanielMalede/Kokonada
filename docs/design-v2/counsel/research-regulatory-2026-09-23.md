# Regulatory UI-obligations dossier: Kokonada from-zero redesign

Prepared 2026-09-23 by `regulatory-researcher`. This prepares a file for counsel and decides nothing. Every web source was fetched on 2026-09-23. Status tags: **RET** = retrieved primary text. **REP** = a reproduction of a primary text, which needs Official Journal (OJ) or CURIA confirmation. **COM** = commentary, which is context only. **UNR** = not retrieved.

---

## 0 · PRODUCT FACTS (verified in the repo; later sections cite these by F-number)

| # | Fact | Where |
|---|---|---|
| F1 | The shipped app contains **no** sentence saying that an AI or automated system infers emotion. A search for `AI system\|infers your emotional\|automated system` across the mobile source returns zero matches. | `C:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src` |
| F2 | The shipped Art. 9 consent notice is marked as placeholder copy (`:16`, `:35`). Its retention section (`:57-60`) gives **no period**. None of its sections (`:37-74`) names the controller's identity. Decline is rendered first and Agree second (`:226-249`). | `C:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src\experience\profile\ConsentSheet.tsx` |
| F3 | The canvas consent screen's PURPOSE line (`:94`) reads "Reading how activated and how settled your body is… **That is the only purpose.**" It does **not** mention inferring an emotional state. The controller line (`:100`) still has a `PRIVACY CONTACT` placeholder. The only automated-processing line is "automated system, not by a person" (`:122`). | `C:\Users\danie\Videos\Kokonada\docs\canvas\Consent.dc.html` |
| F4 | The sign-in screen has no privacy notice, terms or policy link. A search for `privacy\|terms\|policy` returns zero matches. | `C:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src\auth\SignInScreen.tsx` |
| F5 | The mobile app has **no caller** of `/api/auth/account/export`. Yet `docs/privacy-declarations.md (was PRIVACY_DECLARATIONS.md:109)` says there is an "In-app entry point on the account/data screen". Delete account and Withdraw consent both exist (`ProfileScreen.tsx:179,195,344-372`). | `C:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src\experience\profile\ProfileScreen.tsx`, `C:\Users\danie\Videos\Kokonada\docs\privacy-declarations.md` |
| F6 | A shipped rule labels a state **`'High-Stress / Pre-Panic'`** when HRV < 20 ms (`:18-30`). `friendlyStatus` passes labels containing capitals through unchanged (`statusLabels.ts:23`). Pulse then renders the label as a screen-reader header (`PulseScreen.tsx:198`). | `C:\Users\danie\Videos\Kokonada\backend\app\services\medicalProfileService.js` |
| F7 | The product vision gives "High-Stress / Pre-Panic" as an example state (`:43`). It also says "a wellness product that senses distress must help regulate it" (`:47`). | `C:\Users\danie\Videos\Kokonada\docs\vision.md` |
| F8 | The state taxonomy has 34 states. The `stress` domain includes `anxious-restless` (`:290`) and `acute-stress` (`:276`). The `emotional` domain includes `low-mood-low-energy` (`:463`). | `C:\Users\danie\Videos\Kokonada\backend\app\agents\runtime\knowledge\stateTaxonomy.js` |
| F9 | Pulse gauges are "Display-normalization ranges — NOT medical thresholds". They use no good/bad colour ramp. | `C:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src\experience\pulse\pulsePresentation.ts:43-45` |
| F10 | The **shipped** aura pulses at HR/60, capped at 4 Hz (`pulseHz` at `:44`, `MAX_PULSE_HZ = 4` at `:17`). That is a mirror of the heart rate. The **canvas** Field instead sets its period as T = 4200 + 2000×stress, "never faster under stress" (`Field.dc.html:115,149`). The canvas discloses the Field to users and makes it switchable (`Field.dc.html:140`). | `C:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src\experience\aura\auraUniforms.ts` |
| F11 | Live heart-rate streaming starts at **every signed-in boot and at every sign-in** (`prodBootstrap.ts:77,93`). It calls `requestBlePermissions()`, which triggers an OS Bluetooth-permission prompt (`liveHr.ts:26`). There is no client-side check for Art. 9 consent. BLE heart rate is written into `warmStore` and drives the on-screen visuals (`biometricsWiring.ts:20`). The server gates ingestion of that data (`docs/privacy-declarations.md (was PRIVACY_DECLARATIONS.md:147)`). | `C:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src\health\liveHr.ts` |
| F12 | The mobile app has **no analytics or crash-reporting SDK**. Data stored on the device is: session tokens in Keychain (`auth/session.ts:20`) and an encrypted MMKV store (`platform/mmkvBackend.ts:41`). | `C:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\package.json` |
| F13 | There is **no age gate** anywhere in the repo. | repo-wide search |
| F14 | Discovery captions are LLM-generated through Groq. The feature is dark-launched behind the `DISCOVERY_CAPTION_LLM` flag. The Receipt sentence, by contrast, comes from a fixed template (`explain.js:8,55-62`). | `C:\Users\danie\Videos\Kokonada\backend\app\services\discovery\captionService.js:5-20` |
| F15 | The activity chips include `Working` (`:12`) and `Focus` (`:17`). | `C:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src\experience\generate\activities.ts` |
| F16 | Withdrawing consent requires a two-step confirm (`docs/design-v1/screens.md (was SCREENS.md:162)`). Granting is Agree followed by the OS sheet. "Mood-only users never see it [the Art. 9 consent]" (`docs/design-v1/screens.md (was SCREENS.md:167)`). | `C:\Users\danie\Videos\Kokonada\docs\design-v1\screens.md` |
| F17 | The light theme's internal name is "Clinical Premium". | `C:\Users\danie\Videos\Kokonada\docs\design-v1\ui-ux-overhaul-spec.md (was UI_UX_OVERHAUL_SPEC.md:13)` |
| F18 | Withdrawal erases `RewardEvent` and `PersonalWeights`. `MusicProfile` survives withdrawal, and the notice must say what goes and what stays. | `C:\Users\danie\Videos\Kokonada\docs\adr\0015-withdrawal-erases-learned-personalization.md` |
| F19 | Onboarding is shown once per device (`markSeen` is one-way). Skip is available from the first panel. | `TASKS.md` MB-009; `C:\Users\danie\Videos\Kokonada\mobile\KokonadaHealth\src\onboarding\onboardingStore.ts:8-14` |
| F20 | The launch is Android-first, around 2027, with no deadline. Today there are ≤5 hand-enrolled users. | `C:\Users\danie\Videos\Kokonada\docs\adr\0016-launch-platform.md` |

---

## 1 · IN FORCE NOW / APPLIES FROM

| Instrument | Status on 2026-09-23 | Source status |
|---|---|---|
| GDPR (Reg. 2016/679) | **Applies now** (since 25 May 2018). F2, F4 and F5 are measured against live obligations. | REP |
| ePrivacy Dir. 2002/58, Art. 5(3) | **Applies now**, through national transposing law. | REP |
| AI Act, Art. 5 prohibitions | **Apply now** (since 2 Feb 2025). | REP (Commission Service Desk) |
| AI Act, Art. 50 transparency | **Applies now** (since 2 Aug 2026). The Omnibus did not move it. The Art. 50(2) grace period to 2 Dec 2026 covers only systems already on the market before 2 Aug 2026. Whether Kokonada's ≤5 enrolled users count as "placed on the market / put into service" is an **open question**. | REP + COM |
| AI Act, Annex III high-risk regime | **Applies from 2 Dec 2027** (Omnibus). Annex I from 2 Aug 2028. Commentary says systems placed on the market before the date are covered only if substantially modified. | COM; OJ **UNR** |
| Digital Omnibus, Reg. (EU) 2026/1744 | OJ publication 24 Jul 2026. Secondary sources disagree on the in-force date: 27 Jul (repo and ertico) versus 29 Jul (Orrick). | UNR (OJ) |
| Art. 50 Guidelines, C(2026) 5054 final | Adopted 20 Jul 2026. The Commission's Art. 50 FAQ is dated 24 Jul 2026. | Landing page RET; text UNR |
| Draft Annex III classification guidelines | Published 19 May 2026. Still a **draft**; no final version found. | COM |
| European Accessibility Act (Dir. 2019/882) | Applies to in-scope services from 28 Jun 2025. Transition rules in Art. 32. Whether Kokonada is in scope is **open**. | REP |
| DSA (Reg. 2022/2065) | Applies to all providers since 17 Feb 2024. Art. 25 reaches only online platforms. | REP |
| MDR (Reg. 2017/745) | **Applies now** (since 26 May 2021). | REP |
| UCPD (Dir. 2005/29) | **Applies now**. | REP (pre-2022 copy) |
| Digital Fairness Act | **Not proposed.** Status "Announced", planned for Q4 2026 (EP Legislative Train page, updated 01/08/2026). | RET |

---

## 2 · THE PIVOT

**What is the legal character of the named state the app shows a person?** Examples: `anxious-restless`, `low-mood-low-energy`, "Wired, running on empty", "High-Stress / Pre-Panic".

Counsel should answer three limbs together, because one label drives all three regimes:

- **(i) AI Act.** Is the label an *emotion* (Recital 18) inferred "on the basis of biometric data" (Art. 3(34), 3(39))? This is the existing DAN-010 question. It decides whether Art. 50(3) attaches in law, and whether Annex III applies from 2 Dec 2027.
- **(ii) GDPR.** Is the label, together with its inputs, "data concerning health" (Art. 4(15), 9(1)) **including on the mood-only lane** (wheel taps, free text, inferred state)? Relevant tests are the C-21/23 *Lindenapotheke* "intellectual operation involving collation or deduction" test (para 83) and its probability test (para 90). If the answer is yes, the rule in F16 that mood-only users never see Art. 9 consent fails, and the Onboarding → Place flow gains a consent step before the first tap.
- **(iii) MDR.** Does any label or claim give the product a *medical intended purpose* (Art. 2(1) and 2(12), which count "promotional or sales materials")? F6 is the strongest indicator in the shipped product.

The regimes read the same fact differently:
- The AI Act test is objective. Renaming states changes nothing.
- The MDR test is driven by the manufacturer's claims. Wording is legally operative.

The copy rulebook in §3b depends on this asymmetry.

---

## 3 · OBLIGATIONS THAT ATTACH REGARDLESS (the build can act on these now)

- **R1 · Art. 13(1) notice where data is collected, i.e. at sign-in** (email, name, SSO id). The notice must give the controller's identity and contact details, purposes and legal basis, and recipients (Art. 13(1)(a), (c), (e)). It must also cover transfers and safeguards and how to get a copy (Art. 13(1)(f)), plus retention (Art. 13(2)(a)) and rights (Art. 13(2)(b)). Currently absent (F4). The first-layer "WHO" line cannot be filled until Q1 is answered.
- **R2 · The Art. 9 consent must be specific and informed about the actual processing.** Art. 4(11) requires consent to be "specific, informed and unambiguous". Art. 9(2)(a) requires consent "for one or more specified purposes". EDPB 05/2020 para 64 sets a minimum: controller identity, the purpose of each processing operation, the data, the right to withdraw, automated decision-making where relevant, and transfer risks (REP). F3's line "That is the only purpose" omits the inference of an emotional state and the building of a personal baseline. The consent-screen wording in UI-005 ("An AI system infers your emotional state…") contradicts that line on the same screen.
- **R3 · The retention period must appear on the consent layer** (Art. 13(2)(a)). The shipped notice gives none (F2). A retention statement must be true of the code (lesson of ADR-0015; F18).
- **R4 · Proof of consent** (Art. 7(1); EDPB 05/2020 paras 107-108, REP). Keep a version number, the archived text for each version, and a screenshot of the rendered screen for each version. Placeholder copy must never be recorded as operative consent (F2).
- **R5 · Withdrawal must be as easy as giving consent and use the same interface.** Art. 7(3): "It shall be as easy to withdraw as to give consent." EDPB 05/2020 para 114 (REP): withdrawal is done "via the same electronic interface". Art. 13(2)(c) requires telling the user about this right before they consent. Whether the two-step confirm (F16) satisfies this is **OPEN Q6**.
- **R6 · Rights controls must be reachable.** Art. 12(2) requires the controller to "facilitate the exercise of data subject rights". An in-app export (Art. 15/20) is missing although the store declaration says it exists (F5). This is a declared-versus-shipped contradiction.
- **R7 · Refusing must cause no detriment, and consent must not be bundled** (Art. 7(4); Art. 7(2) "clearly distinguishable from the other matters"). The mood-only path must be a real equal, not a degraded fallback.
- **R8 · Fairness and choice architecture.** GDPR Art. 5(1)(a) fairness and Art. 25(2) data protection by default apply (REP). EDPB 4/2019 names autonomy, no deception, non-exploitation and power balance as fairness elements (REP summary). Design line that follows: **an inferred emotional state may shape ambience and music; it must never shape choice architecture.** That means consent, permissions, settings, rating prompts, notification opt-ins, purchases and exit or withdrawal flows. The existing rule "never emotion-tint Agree" is one instance of this line.
- **R9 · Use EDPB 03/2022 v2 as a design checklist** for each page. Its six categories are Overloading, Skipping, Stirring, Obstructing, Fickle and Left in the dark (REP; subtypes need the PDF). Formally it is scoped to social media, so it is persuasive here by analogy only.
- **R10 · Honesty about inference, in the form of the UI-005 invariant sentence.** In law this rests on Art. 50(3) in branches A and B, and possibly Art. 50(1) (open whether a music generator "interacts directly"). In practice, UI-005 already chose to ship it in every branch. Form requirements:
  - "clear and distinguishable… at the latest at the time of the first interaction or exposure" (Art. 50(5)).
  - "The information shall conform to the applicable accessibility requirements" (Art. 50(5), second sentence).
  - Recital 132: "provided in accessible formats for persons with disabilities".
  - Guidelines points 141-144 (REP): the notice fails if it "can easily be overlooked, for instance in a manual or in the terms of use". Art. 50 "does not impose accessibility requirements of its own"; it refers to Dir. 2016/2102 and 2019/882.
  - The Commission FAQ (RET, dated 24 Jul 2026) says the duty "does not entail providing information regarding e.g. the purpose of the system's operation".
- **R11 · No medical-purpose claims unless the product is certified.** MDR Art. 2(1) lists "diagnosis, prevention, monitoring, **prediction**, prognosis, treatment or alleviation of disease", and Art. 2(12) counts claims "in promotional or sales materials" (REP). MDR Recital 19 says lifestyle and well-being software is not a device (REP). UCPD Annex I point 17 bans "Falsely claiming that a product is able to cure illnesses…" (REP). F6 and F7 are the live pressure points. See §3b.
- **R12 · Consent before any health read.** The rule in §11 that consent comes immediately before the OS sheet is not met by the BLE lane (F11). Whether that ordering is legally required is **OPEN Q8**. As it stands, the repo's own written rule is contradicted by the shipped code.
- **R13 · ePrivacy Art. 5(3)** requires consent to store or access information on a device, "unless… strictly necessary in order for the provider of an information society service explicitly requested by the subscriber or user to provide the service" (REP). The Keychain and MMKV use (F12) and Health Connect/BLE reads should each have their exemption reasoning written down. **Adding any analytics or crash SDK to the mobile app** would create a consent surface that does not exist today.
- **R14 · Accessibility is already committed internally** (WCAG 2.2 AA, `docs/design-v1/screens.md (was SCREENS.md:32,197)`). The shipped 4 Hz pulse (F10) should be measured against WCAG 2.3.1 "Three Flashes". This is not a finding that it fails.

### 3b · COPY RULEBOOK

**Rule 0: describe the music and the selection, never an effect on the body or mind.** This follows from MDR Art. 2(12), UCPD Annex I point 17, and GDPR fairness.

| Class | FORBIDDEN (user-facing, store listing, screenshots, notifications) | SAFE PATTERN |
|---|---|---|
| Condition names and predictions (MDR "prediction… of disease") | "Pre-Panic", "panic", "anxiety attack", "depression / depressed", "burnout risk", "disorder", "symptoms", "at risk", "early warning", "predicts" | Non-clinical affect descriptors: "wired", "activated", "settled", "low-energy", "bright". Whether "stressed", "tense" or "anxious" are acceptable is **OPEN Q4**. |
| Efficacy verbs | "reduces stress / anxiety", "lowers your heart rate", "improves HRV / sleep", "calms your nervous system", "regulates you", "helps with insomnia" | "A slower, softer set when your body reads activated"; "Calmer music" (describes the music, not the user) |
| Medical-authority language | "clinical / clinically proven", "medical-grade", "therapy / therapeutic", "treat / heal / cure", "prescription / dose", "biofeedback", "vagus", "for people with…" | "Your readings, in context. Not a medical measurement." Keep "Clinical Premium" (F17) internal only. |
| Thresholds and verdicts on vitals | "HRV below 20 = danger", "normal / healthy range", red or green zones, "alert", "abnormal" | A raw value with its unit and a magnitude-only fill (keep F9) |
| Accuracy overclaims (Recital 44: "limited reliability") | "reads your mind", "knows exactly how you feel", "science-backed emotion detection", "100% accurate" | "An AI system infers your emotional state here. It is a machine's reading, not a person's, and it can be wrong." |
| Concealment (AI Act test is objective) | Removing "emotion" or renaming `emotionAccent` to escape the AI Act | Keep the invariant sentence. Renaming does **not** help under the AI Act, although claims **do** matter under MDR. |
| Workplace and education (Art. 5(1)(f)) | "Manage stress at work", "for your team / employees / students", any employer-wellness or school wording | "Working" as a user-chosen context chip is **OPEN Q9** |
| Steering and confirmshaming | "Are you sure? Your calm depends on it", copy that changes with the user's inferred state on any choice screen | Neutral, identical wording on both choices |
| Erasure and retention promises | Any promise the code does not keep (ADR-0015) | Name what goes and what stays (F18) |

---

## 4 · BRANCH MAP

| Branch | What attaches (on top of R1-R14) |
|---|---|
| **A** · Limb (i) yes on the wearable lane **and** limb (ii) yes on the mood-only lane | Art. 50(3) and (5) apply as law. An Art. 9 lawful basis is needed for mood-only processing, so explicit consent appears **before the first wheel tap or free-text entry**. Special-category data then reaches Groq (US): the Art. 28 contract and SCCs must exist before the notice claims them (HALT C6). Annex III applies from 2 Dec 2027, adding Art. 26(11): "inform the natural persons that they are subject to the use of the high-risk AI system" (REP). This line can share the same component as the Art. 50 sentence. The Guidelines, as reproduced, say emotion-recognition systems "all… also high-risk, unless prohibited under Article 5(1)(f)" (REP, points 101-104). |
| **B** · Limb (i) yes, wearable lane only; limb (ii) no | Art. 50(3) applies wherever outputs derived from wearables are shown. On the mood-only lane Art. 50(3) arguably has no biometric input; Art. 50(1) is open. Art. 9 consent stays scoped to the wearable lane. Annex III applies from 2 Dec 2027 as in A. |
| **C** · Limb (i) no (Recital 18 physical states, or HR/HRV not Art. 3(34) data) | No Art. 50(3) duty in law. The UI-005 sentence becomes voluntary; it does no legal harm and remains a product choice. No Annex III. Art. 9 still covers HR, HRV and sleep. Limb (ii) still decides the mood-only consent question. |
| **M-yes** · Limb (iii): a medical purpose is found | MDR conformity assessment (software classification under Rule 11). The system reaches the AI Act through **Annex I**, which applies from 2 Aug 2028. Art. 5(1)(f)'s medical exception becomes available but only "strictly for medical or safety reasons" (Recital 44). Commentary citing the Guidelines says the exception "does not extend to general well-being monitoring, such as stress or burnout detection". |
| **M-no** · Wellness | Copy discipline (§3b) is the control. Any single forbidden claim can move the product into M-yes, because intended purpose is set by claims. |
| **Channel** · Any B2B, employer or education deployment | The **Art. 5(1)(f) prohibition** applies, in force since 2 Feb 2025, highest penalty tier, no transition. This is independent of A, B or C. |

### 4b · PER-SCREEN OBLIGATIONS

Tags: [R] regardless of branch · [A/B] branch-dependent · [M] MDR · [OPEN] question for counsel.

| Screen | MUST | MUST NOT | OPEN |
|---|---|---|---|
| **Global shell / tab bar** | A tab tint driven by inferred state is an exposure surface, so the notice must appear first [A/B]. Include a cue that does not rely on colour [R14]. | Carry the inferred-state tint into any control that opens a choice [R8]. | – |
| **Splash** | Nothing required. Installing the app is not exposure. | Breathing faster than 3 flashes/s [R14]. | – |
| **Onboarding** | Put the invariant AI sentence in the persistent chrome, not on a panel (F19) [R10]. State that body data is optional [R7]. Reserve an **age step** slot. In branch A, place the mood-only Art. 9 consent before Place. | "reads your mind" or medical claims [3b]. Rely on per-device onboarding (F19) to carry any legally required notice. | Q2, Q5 |
| **Sign-in** | Art. 13 first layer (controller identity and contact, purposes, link to the full notice), plus the EU representative line if the controller is outside the EU [R1]. | Pre-ticked boxes. Bundling Art. 9 or marketing consent into sign-in [R7]. | Q1, Q5 |
| **Connect** | "Why we ask" appears before any OS sheet. Health Connect **and BLE** both go through §11 first, or counsel accepts the current order [R12]. Record the ePrivacy Art. 5(3) basis [R13]. | Make the mood-only path look like a penalty. Confirmshaming [R7, R9]. | Q8 |
| **Consent (Art. 9)** | Pinned first layer: controller, **purpose including emotional-state inference and baseline profiling** (F3), data categories matching the real request, retention, withdrawal, transfers [R2, R3]. Explicit statement. Decline first with identical geometry, no scroll-gating. Version plus archived text plus screenshot [R4]. The scope-framed UI-005 sentence goes in the fixed chrome. | Placeholder copy (F2). Emotion tint on Agree. Recording data categories the granted version does not authorise. False erasure claims. | Q6, Q7 |
| **Place / Generate** | Invariant sentence, persistent, above the fold, on a scrim, as an accessibility node [R10]. A text alternative to the wheel [R14]. A free-text field whose treatment follows Q2. | Tie inferred affect to nudges or prompts [R8]. Imperceptible stimuli (Art. 5(1)(a) "subliminal techniques beyond a person's consciousness"). Workplace-marketing wording on `Working`/`Focus` (F15). | Q2, Q9, Q10 |
| **Genesis** | Honest status copy. Reduced-motion path. | "Analysing your emotions with precision". Fake progress that implies a measurement that is not happening [R8, 3b]. Strobing [R14]. | – |
| **Now Playing** | Describe the "target state" easing as music and ambience [M]. | "This set will lower your heart rate" [M]. | – |
| **Receipt** | Server-authored evidence set. "can be wrong". Confidence shown. Ceilings drawn as exclusions. If the LLM captions (F14) ship: Art. 50(2) machine-readable marking; a visible label is **open**. | Normative verdicts on HRV or HR [M]. Accuracy beyond the engine's own confidence. | Q12, Q14 |
| **Pulse** | Invariant sentence next to the state headline [A/B]. A "not a medical device" line in the app (C5(b)) [M]. Keep F9's threshold-free gauges. Disclose the method for any derived score. | **"High-Stress / Pre-Panic"** or any condition or prediction label (F6) [M]. Red/green zones, "normal range", alerts. | Q4 |
| **Archive / History** | Rows tinted by state are inferred records: cover them with the notice and include them in export [R6]. The generic state gets no colour. | Mood-diary framing of conditions, e.g. "stressed 5 days running" [M; Q2]. | Q2 |
| **You / Profile** | Rights controls above preferences. **Export** (F5), Delete, and Withdraw in the same interface [R5, R6]. A "Living background" explainer and switch. A privacy notice link. Say what survives withdrawal (F18). | A withdrawal maze or danger styling on Withdraw (EDPB 03/2022 "Obstructing") [R9]. | Q1, Q6 |
| **Vault** | Show the consent version only when it is current. Show truthful consequences, including the 30-day `PlaylistSession` residual (BE-016). | Show `currentVersion` beside a stale grant. | Q7 |
| **Field** (ambient layer) | Disclosed, switchable, reduced-motion still, flash-safe (F10) [R14]. | Sub-perceptual modulation. "Calms your nervous system" [M]. | Q10 |
| **System states** | No claim of "reading your body" when no data exists. | – | – |
| **Notifications** (push tokens exist) | – | Sending triggered by inferred distress (Art. 5(1)(b), UCPD Art. 9(c) "exploitation… of any specific misfortune", MDR monitoring). | Q10 |
| **Store listing and screenshots** | Fictitious data. The disclaimer line (store policy is compliance-auditor's). | Condition labels, threshold gauges, before/after physiology charts, symptom-relief testimonials [M; UCPD]. | Q4 |

---

## 5 · THE COUNTER-CASE (the strongest argument against exposure, and what it must overcome)

- **AI Act.** Art. 3(34)'s examples ("facial images or dactyloscopic data") suggest identification-type data, which HR and HRV are not. Recital 18 excludes "physical states, such as pain or fatigue". The outputs are musical targets, and the named state is an intermediate step. The mood-only lane is self-report, not biometrics. Art. 3(4) excludes "personal non-professional" use from the deployer definition.
  - *Must overcome:* the product shows affect labels to users (F8). Recital 18's own list names "satisfaction" and "excitement". F6. The Guidelines as reproduced (points 10-17): where a provider operates a system for consumers, the provider remains responsible. The UI-005 sentence already says "infers your emotional state".
- **GDPR on the mood-only lane.** A passing mood is not a health status, and there is no diagnosis.
  - *Must overcome:* the C-21/23 probability test (para 90, REP). Labels such as `anxious-restless` and `low-mood-low-energy`. Free text. A persistent history tinted by state.
- **MDR.** Recital 19 excludes lifestyle and well-being software. There are no treatment claims, music is not a medical intervention, and the gauges avoid thresholds (F9).
  - *Must overcome:* F6 (a prediction tied to a threshold), F7 ("senses distress… help regulate it"), the readiness score, and Art. 2(12)'s reach into promotional material.
- **Art. 5(1)(a).** The Field is perceptible, disclosed and switchable, and its aim is benign. Commentary reports that the Guidelines treat even a subliminal therapeutic chatbot as not causing "significant harm" (COM).
  - *Must overcome:* the prohibition covers "objective, **or the effect**" and "it is not necessary… to have the intention" (Recital 29). The counter-case collapses if inferred affect ever drives an engagement or commercial choice.
- **DSA Art. 25.** Kokonada is not an online platform (Art. 3(i) requires dissemination "to the public"), and Art. 25(2) carves out practices covered by GDPR or UCPD. This counter-case is strong. A public sharing feature would change it.
- **EAA.** The service is not in the Art. 2(2) list; the app is free (no "consumer contract" as in Art. 3(29)); and the microenterprise exemption in Art. 4(5) may apply.
  - *Must overcome:* any in-app purchase flow, national gold-plating, and Art. 50(5)'s reference to "applicable" accessibility requirements.
- **ePrivacy.** The storage in use is strictly necessary, and Health Connect reads are explicitly requested by the user.
  - *Must overcome:* EDPB 2/2023's broad reading, and F11's prompt firing before consent.

---

## 6 · UNRETRIEVED

For each item: what it would settle, and how a person can get it.

1. **OJ text of Reg. (EU) 2026/1744.** EUR-Lex returns an empty page to my fetcher (bot challenge), both at `eli/reg/2026/1744/oj/eng` and at the HTML view.
   - Would settle: the exact dates; whether the Art. 3, 5 and 50 amendments (the Service Desk shows "amended by the Digital Omnibus" banners on all three) touch Art. 3(34), 3(39), 50(3) or 50(5); the in-force date (27 or 29 Jul); whether Art. 49 registration was deferred.
   - How: open it in a browser, about 10 minutes.
2. **Art. 50 Guidelines, C(2026) 5054 final** (`ec.europa.eu/newsroom/dae/redirection/document/131215`). Downloaded, but it is a binary PDF I cannot parse. Only point-numbered reproductions were available (ai-resources.eu).
   - Would settle: who the deployer is in a B2C app (points 10-17), "first exposure" per person and per output, the accessibility point (point 144).
   - How: download it and read the §50(3) and §50(5) sections, about 30 minutes. **First priority**, because it governs the only live AI Act duty.
3. **Commission Guidelines on prohibited practices, C(2025) 884 final** (4 Feb 2025; PDF on the Service Desk). Binary PDF; only commentary available.
   - Would settle: the Art. 5(1)(a) "manipulative technique" and significant-harm factors as applied to an affect-adaptive UI; the Art. 5(1)(f) exclusion of "well-being" (quoted only in FPF commentary).
4. **Draft Annex III guidelines (19 May 2026).** Binary PDF; no final version found. Would settle limb (i).
5. **EDPB Guidelines 05/2020** (paras 64, 107-108, 114), **03/2022 v2** (the subtypes; the EDPB page as fetched showed "adopted 24 Feb 2023", secondary sources say 14 Feb, so check the cover), **4/2019**, and **2/2023 v2** (page as fetched: adopted 16 Oct 2024). All binary PDFs to my tooling. Paragraph content above rests on reproductions. How: open on edpb.europa.eu.
6. **MDCG 2019-11 rev.1 (June 2025)**, from health.ec.europa.eu. Binary PDF. Would settle limb (iii) and the Q4 vocabulary, through its examples of well-being and stress/relaxation apps.
7. **CURIA judgments.** C-21/23 (paras 83 and 90 seen only through dpcuria.eu), C-184/20, C-219/11 *Brain Products*, C-329/16 *Snitem* (the last two decide intended purpose for medical-device software). Would settle limbs (ii) and (iii). How: curia.europa.eu.
8. **WP260 rev.01** (transparency guidelines: layered and just-in-time notices, language). Not attempted.
9. **Commission guidance on EAA scope for free apps.** Not found.
10. **EDPB Statement 1/2025 on age assurance.** Not attempted.
11. **OJ texts of the GDPR, ePrivacy Directive, DSA, EAA, MDR and UCPD.** Blocked on EUR-Lex. Every quote above is a reproduction. The UCPD copy predates the 2022 amendments.

---

## 7 · QUESTIONS FOR COUNSEL (ordered by how much they unblock)

1. **Controller.** Which legal entity is the controller, and is it established in the EU? If not: Art. 27 representative; note Art. 27(2) excludes large-scale Art. 9 processing from the exemption. This fills the "WHO" line on Sign-in, Consent and You.
2. **Limb (ii).** Are mood-only taps, free text and inferred states (F8) Art. 9 data under C-21/23 and C-184/20? This decides whether a consent step precedes the first tap.
3. **Limb (iii).** Which terms may appear on the user surface and the store: "stress", "calm", "recovery", "readiness"? Do F6 or F7 create a medical intended purpose?
4. **Minimum age and age-assurance method.** Art. 8(1): 16, or national 13-16. Can a minor give Art. 9(2)(a) explicit consent?
5. **Consent purpose change.** Does adding "emotional-state inference and baseline profiling" to the Art. 9 purpose (F3) require **re-consent** or only **re-informing**? This joins ADR-0015's open point and the consent-version bump in HALT C2.
6. **Withdrawal parity.** Does a two-step withdrawal against a one-tap Agree plus the OS sheet meet Art. 7(3) and EDPB para 114, given that withdrawal triggers irreversible erasure?
7. **BLE lane.** Is on-device reading and rendering of heart rate before Art. 9 consent "processing" by Kokonada, and does it trigger ePrivacy Art. 5(3)? Must the OS prompt move behind §11 (F11)?
8. **DAN-010 limb (i).** Include whether Kokonada itself is the deployer for Art. 50(3), and whether ≤5 enrolled users counts as "putting into service".
9. **Art. 5(1)(f).** Does a user-chosen "Working" context engage it? Confirm that B2B, employer and education channels are excluded.
10. **Art. 5(1)(a)/(b) and UCPD Art. 9(c).** Is the line "affect shapes ambience and music, never choice architecture" sufficient? Is stress-adaptive pacing a "technique" at all, given it is disclosed and switchable?
11. **EAA.** Applicability to a free app; microenterprise status; the effect of any future in-app purchase.
12. **Art. 50(2).** Marking duties for LLM captions (F14): is a visible label needed?
13. **Markets and languages.** Art. 12 "intelligible" requires notices translated for each target market.
14. **Art. 22.** Confirm it is not engaged. If so, the Receipt's logic explanation is voluntary.

---

## 8 · WHAT I AM NOT SAYING

- I am not saying Kokonada is, or is not, an emotion-recognition system, high-risk, a medical device, or within the EAA or DSA.
- I am not saying any screen is compliant or non-compliant. F1-F19 are facts, several of which contradict the repo's own rules or declarations.
- I am not saying that renaming states helps under the AI Act (it does not). I am not saying that avoiding clinical words is "designing around" the law: under the MDR, claims are what legally define the intended purpose.
- I am not saying the regulating ambience is manipulative. I have mapped where that line would be tested.
- The copy rulebook reduces risk. It is not a safe harbour, and no phrase is "cleared".
- Store and provider terms (Play and Apple health policies, Spotify, Garmin) are out of scope here and belong to `compliance-auditor`.
- I am not endorsing any design tooling (Taste Skill and the others are outside this file).

---

## ANNEX · WHERE I MUST BE CONSULTED IN THE PER-PAGE PIPELINE

- **R0 · Regulatory intake.** At page kickoff, **before** the `designer` direction and the `architect` plan, and held **jointly with `compliance-auditor`** so both sets of constraints arrive at once.
  - Input: the page brief and its data flows (what is read, inferred, shown, stored, sent).
  - Output: a per-page reg-card, i.e. the §4b row with MUST, MUST NOT and OPEN items. These become acceptance criteria in the design brief and the developer's Definition of Done.
  - Branch-dependent items become **reserved layout slots**, so that counsel's answer changes content, not layout: WHO/representative line, age step, mood-only consent sheet, Art. 50 / Art. 26(11) sentence component, not-a-medical-device line, caption label, analytics-consent slot.
- **R1 · Copy and claims freeze.** After the board copy is drafted and **before** the `designer` SHIP verdict, the copy is linted against §3b, again jointly with `compliance-auditor`.
- **R2 · Triggered consults only.** Not every page. Triggers:
  - a new data category, inference, SDK or on-device storage;
  - a new place where an inferred state is displayed or used;
  - any change to consent text;
  - a new market, language or channel (B2B, education);
  - anything about age or children;
  - any link from inferred affect to a notification or prompt.
- **R3 · Store listing and screenshots,** before upload.
- **Not needed:** verification on device after the build. `compliance-auditor` checks the built result against the reg-card and calls me back only if something deviates.

---

## Sources (fetched 2026-09-23)

- [AI Act Service Desk, Art. 50](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-50) · [Art. 5](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-5) · [Art. 3](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-3) · [Art. 26](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-26) · [Recital 18](https://ai-act-service-desk.ec.europa.eu/en/ai-act/recital-18) · [Recital 29](https://ai-act-service-desk.ec.europa.eu/en/ai-act/recital-29) · [Recital 44](https://ai-act-service-desk.ec.europa.eu/en/ai-act/recital-44) · [Recital 132](https://ai-act-service-desk.ec.europa.eu/en/ai-act/recital-132) (REP; bannered as not updated for the Omnibus)
- [Commission Art. 50 FAQ](https://digital-strategy.ec.europa.eu/en/faqs/transparency-obligations-under-article-50-ai-act) (RET) · [Guidelines library page](https://digital-strategy.ec.europa.eu/en/library/guidelines-transparency-obligations-providers-and-deployers-ai-systems) (RET, metadata only) · [ai-resources.eu reproduction](https://ai-resources.eu/soft-law/transparency-guidelines-art-50/) (REP)
- [EUR-Lex 2026/1744](https://eur-lex.europa.eu/eli/reg/2026/1744/oj/eng) (UNR) · [Orrick, Omnibus](https://www.orrick.com/en/Insights/2026/07/EU-AI-Act-Update-Digital-Omnibus-Finalizes-8-Compliance-Changes) (COM) · [FPF, Art. 5(1)(f)](https://fpf.org/blog/red-lines-under-eu-ai-act-unpacking-the-prohibition-of-emotion-recognition-in-the-workplace-and-education-institutions/) (COM) · [FPF, Art. 5(1)(a)](https://fpf.org/blog/red-lines-under-the-eu-ai-act-understanding-manipulative-techniques-and-the-exploitation-of-vulnerabilities/) (COM) · [McCann FitzGerald](https://www.mccannfitzgerald.com/knowledge/data-privacy-and-cyber-risk/ai-transparency-european-commissions-guidelines-on-article-50-part-2-deployer-obligations) (COM)
- GDPR (REP): [Art. 4](https://gdpr-info.eu/art-4-gdpr/) · [Art. 7](https://gdpr-info.eu/art-7-gdpr/) · [Art. 8](https://gdpr-info.eu/art-8-gdpr/) · [Art. 9](https://gdpr-info.eu/art-9-gdpr/) · [Art. 12](https://gdpr-info.eu/art-12-gdpr/) · [Art. 13](https://gdpr-info.eu/art-13-gdpr/) · [Art. 21](https://gdpr-info.eu/art-21-gdpr/) · [Art. 22](https://gdpr-info.eu/art-22-gdpr/) · [Art. 25](https://gdpr-info.eu/art-25-gdpr/) · [gdpr-text.com, EDPB 05/2020 paras](https://gdpr-text.com/read/article-7/)
- EDPB (RET, metadata only): [05/2020](https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-052020-consent-under-regulation-2016679_en) · [03/2022](https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-032022-deceptive-design-patterns-social-media_en) · [2/2023](https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-22023-technical-scope-art-53-eprivacy-directive_en)
- Other instruments (REP): [DSA Art. 25](https://www.eu-digital-services-act.com/Digital_Services_Act_Article_25.html) · [DSA Art. 3](https://www.eu-digital-services-act.com/Digital_Services_Act_Article_3.html) · [ePrivacy Art. 5(3)](https://consenttheater.org/law/eprivacy/art-5/) · EAA [Art. 2](https://www.legislation.gov.uk/eudr/2019/882/article/2), [Art. 3](https://www.legislation.gov.uk/eudr/2019/882/article/3), [Art. 4](https://www.legislation.gov.uk/eudr/2019/882/article/4) · UCPD [Art. 9](https://www.legislation.gov.uk/eudr/2005/29/article/9), [Annex I](https://www.legislation.gov.uk/eudr/2005/29/annex/I) · [MDR Art. 2](https://www.medical-device-regulation.eu/2019/07/10/mdr-article-2-definitions/)
- Case law and legislative status: [C-21/23 via dpcuria](https://www.dpcuria.eu/case?reference=C-21%2F23) (REP) · [EP Legislative Train, Digital Fairness Act](https://www.europarl.europa.eu/legislative-train/theme-protecting-our-democracy-upholding-our-values/file-digital-fairness-act) (RET) · [MDCG 2019-11 rev.1](https://health.ec.europa.eu/document/download/b45335c5-1679-4c71-a91c-fc7a4d37f12b_en) (UNR)