---
title: 'Kokonada — counsel dossier (EU, UK, US, IL) — 2026-09-29'
author agent: regulatory-researcher
source: 'reg-world-and-dossier.md PART 3 (lines 1160–1560)'
prepared: 2026-09-29
repo HEAD: b9639c5
---

# Kokonada — counsel dossier (EU, UK, US, IL) — 2026-09-29

This dossier was prepared for counsel and decides nothing. The owner and counsel make every classification. Web sources for the UK, the US and Israel were fetched on 2026-09-29. The EU material comes from `r_regulatory.md` (2026-09-23) and `brief_regulatory.md` (2026-09-23) and was not re-verified. The registry IDs REG-200 to REG-263 are in the companion registry; EU items are cited by the R- and Q-numbers in those files. Status tags are RETRIEVED, REPRODUCTION, UNRETRIEVED, COM and SUPERSEDED, as defined at the top.

## 1. The product on one page (every fact is from the repository)

**What it is.**
- An Android app, launching Android-first around 2027 with no deadline (ADR-0016:89-115). It is a free app (ADR-0001).
- The launcher label today is "KokonadaHealth" (`strings.xml:2`).
- It selects and plays existing music through Spotify or YouTube playback. It does not synthesise audio (VISION §5, §8).

**Users and markets.**
- Enrolled users: the owner only, per the 2026-09-29 update to `DAN-021`. Historically there were 5 or fewer.
- The owner's decision is worldwide distribution through Google Play (DESIGN_V2_PLAN, decisions table).
- There is no age gate, and the user model has no age field (`User.js`; r_regulatory F13).
- Sign-in uses Google. Apple sign-in appears on iOS only and is unused at launch (`SignInScreen.tsx:51-57`).
- Sign-in collects the email address, an optional name and the SSO id (`PRIVACY_DECLARATIONS.md:40-42`). The sign-in screen has no privacy or terms link (`MB-034`).

**Inputs from the mind (always).**
- A tap on a valence-and-arousal wheel.
- Activity chips, such as "Working" and "Focus".
- Optional free text. The server reduces it to closed-vocabulary tags before any LLM sees it, and the raw text is never sent (`geminiEngine.js:182`). The text is stored encrypted as `PlaylistSession.contextPrompt` (`PRIVACY_DECLARATIONS.md:58`).

**Inputs from the body (optional, only after an Art. 9 consent grant).**
- Health Connect: heart rate, HRV, sleep and resting heart rate, plus history of about 6 months (`AndroidManifest.xml:12-18`; `consentApi.ts:24-30`).
- A live Bluetooth heart-rate broadcast. It starts only after a wearable link and a current grant; the server gate was verified in production on 2026-09-29 (`DAN-020`; `liveHr.ts:24-36`).
- The Garmin server lane is dormant (`DAN-009`), but the consent list still names Garmin-only categories (`consentApi.ts:45`).

**Inference.**
- A backend affect engine fuses the tap with physiology into a state vector over 34 states. They include `acute-stress`, `anxious-restless` and `low-mood-low-energy` (`stateTaxonomy.js:276,290,463`).
- Pulse shows a status label produced by nine hand-written rules (brief_regulatory N7). The client relabels "High-Stress / Pre-Panic" (PR #192).
- The app learns personalisation over time (ADR-0012 and ADR-0015).

**Output.**
- A playlist, Now Playing, and a receipt explaining "why this music".
- Pulse shows banded readings; raw vitals never reach the client (ADR-0005).
- An ambient animated field.

**Disclosures today.**
- An AI disclosure line on Generate, Onboarding and Pulse.
- On Pulse, a "not a medical device" line and a reminder to consult a healthcare professional (`legalCopy.ts:11-24`).
- The consent text is a v1 placeholder (`ConsentSheet.tsx:16,35`) and gives no retention period (`:57-61`).

**Storage and recipients.**
- The backend runs on Railway, whose DPA says its "primary processing operations take place in the United States".
- The database is MongoDB Atlas; its region is not recorded in the repo.
- Vitals are field-encrypted.
- Retention: 90 days for biometric samples, 365 days of inactivity for learned data, and until deletion for account data (`PRIVACY_DECLARATIONS.md:93-105`).
- A US LLM inference sub-processor receives derived tokens only. Its DPA and zero-data-retention setting are unconfirmed (`:74,85-91`).
- Sentry is in the backend code (`sentry.js:16-31`) but is not declared (`BE-020`). Whether it is live is unknown (`DAN-018`).
- There is no analytics SDK, no advertising and no sale of data (`:64`).
- Push tokens exist (`User.js:57`), but no push ships at launch (plan default).

**Rights.**
- Delete account and Withdraw consent exist in the app.
- The export endpoint has no in-app caller (r_regulatory F5).
- Withdrawal erases wearable data and learned personalisation; MusicProfile survives (ADR-0015).

**Planned store listing.**
- Google Play only.
- It needs the Data safety form, the Health apps declaration and the Health Connect declaration (`PRIVACY_DECLARATIONS.md:127-141`).
- It carries the Play "not a medical device" sentence (r_compliance A5).
- No listing draft exists in the repo.

## 2. IN FORCE NOW / APPLIES FROM (as of 2026-09-29)

| Instrument | Position | Status |
|---|---|---|
| UK GDPR and DPA 2018 | Apply now | RETRIEVED |
| Data (Use and Access) Act 2025: UK GDPR and PECR changes | Revision date of 5 Feb 2026 on UK GDPR Arts. 5 and 13 and on PECR Sch. A1; the Art. 9 amendment took effect 20 Aug 2025 | RETRIEVED (annotations) |
| DPA 2018 s.164A (complaints) | Applies from 19 Jun 2026 (S.I. 2026/82) | RETRIEVED |
| DMCC Act 2024, Part 4 Ch. 1 and Sch. 20 | Applies from 6 Apr 2025 | RETRIEVED |
| UK MDR 2002 | Applies now. MHRA DMHT guidance updated 29 Jul 2026 | Regulations RETRIEVED; guidance UNRETRIEVED |
| UK–US data bridge (S.I. 2023/1028) | In force; the commencement date was not shown on the page | RETRIEVED (reg. 3) |
| FTC Act §5 | Applies now | REPRODUCTION |
| FTC Health Breach Notification Rule (as amended at 89 FR 47054, 30 May 2024) | Applies now | RETRIEVED (eCFR) |
| COPPA Rule (as amended at 90 FR 16977) | Effective 23 Jun 2025; compliance by 22 Apr 2026 | Rule RETRIEVED; dates REPRODUCTION |
| Washington My Health My Data Act | Applies since 31 Mar 2024 (small businesses since 30 Jun 2024) | REPRODUCTION |
| Nevada SB 370 | Applies since 31 Mar 2024 | COM only |
| Connecticut P.A. 25-113 | Applies from 1 Jul 2026 | AG page RETRIEVED; date COM |
| CCPA (amended by AB 1170) | Applies now (subject to thresholds) | RETRIEVED |
| California AB 1043 | **Applies from 1 Jan 2027** | RETRIEVED |
| Texas SB 2420 | Enforceable since 6 Jul 2026 | COM only |
| Colorado SB 26-189 | Signed 14 May 2026; operative date conflicts between sources (REG-247). SB 24-205 SUPERSEDED | RETRIEVED (summary) |
| Illinois P.A. 104-0054; Nevada AB 406 | Apply now (since 2025) | COM only |
| New York S9269 | **Not law.** Passed both houses in Jun 2026; would apply 6 months after enactment | RETRIEVED |
| FDA General Wellness guidance | Reissued Jan 2026; the 2019 edition is SUPERSEDED | Landing page RETRIEVED; text UNRETRIEVED |
| Israel PPL, Amendment 13 | Applies since 14 Aug 2025 | REPRODUCTION |
| Israel: Data Security Regs 2017; Transfer Regs 2001; EEA Regs 2023 | Apply now | REPRODUCTION |
| Israel: PPA consent opinion | Final in March 2026 per commentary | COM; text UNRETRIEVED |
| Israel: PPA AI guidance | Draft of 30 Apr 2025; final status unknown | COM; UNRETRIEVED |
| Israel: accessibility reg. 35 | Applies now | REPRODUCTION |
| EU adequacy: UK (renewed Dec 2025), Israel, US (Data Privacy Framework) | In place | Commission page RETRIEVED |
| EU AI Act Art. 50 | Applies from 2 Aug 2026; Annex III from 2 Dec 2027 | per r_regulatory §1 |

## 3. THE PIVOT

**The question.** Is the mood-only lane health data? That lane covers the user's own wheel placement, activity chip and free text, and the state Kokonada infers from them when no wearable is involved.

Every market treats the wearable lane in nearly the same way:
- **UK:** Art. 4(15) data concerning health.
- **Washington:** "bodily functions, vital signs … measurements".
- **HBNR:** "vital signs … sleep".
- **Israel:** "מצב בריאותו" (state of health).

The markets diverge only on the mood-only lane. Counsel should answer yes or no, market by market:
- **EU:** r_regulatory limb (ii), the C-21/23 probability test.
- **UK:** is it data concerning "mental health" (Art. 4(15))?
- **Washington:** is it "mental health status", or an inference "derived or extrapolated from nonhealth information" (REG-230)?
- **Nevada:** does Kokonada "use" it to identify health status (REG-235)?
- **Connecticut:** is it data used to identify a mental health condition (REG-236)?
- **California CMIA:** is it "inferred … mental health" information (REG-239)?
- **Israel:** is it a health state, or a "הערכת אישיות … באמצעי שמיועד לביצוע הערכה של מאפייני אישיות" [a personality assessment made by a means intended to assess personality characteristics] (REG-253)?

**The consequence.** A "yes" in any market launched in means a consent step comes before the first tap in that market. Under the stricter-rule default proposed in §8, that consent step would then apply worldwide.

## 4. OBLIGATIONS THAT ATTACH REGARDLESS (the only part the build can act on now)

- **Consent flows.**
  - Explicit, informed, unbundled consent before any wearable read: REG-200 (UK), REG-250 (IL), REG-230 (WA), REG-236 (CT), plus EU R2.
  - Withdrawal as easy as consent: REG-214 and EU R5.
  - The privacy-protective choice has equal prominence, and inferred affect never shapes a choice screen: REG-220 and EU R8.
- **Notice at sign-in.**
  - UK: REG-201. Israel: REG-252. EU: R1.
  - The notice's WHO line waits for DEC-W01.
- **Truthful declarations** (REG-217). Close the three known contradictions first: Sentry undeclared, export claimed but with no caller, and Vercel still listed.
- **Claims discipline**, which extends the EU Rule 0 ("describe the music, never an effect on the body or mind"):
  - UK: REG-208, REG-209, REG-210.
  - US: REG-218, REG-219, REG-226, REG-227.
  - Israel: REG-260, REG-262.
  - No-therapy copy: REG-244, REG-245, REG-239.
- **Device storage and reads each documented** against an exception (REG-206).
- **Complaints channel** for UK users (REG-207).
- **Preparation the build can start now:**
  - the DPIA (REG-205);
  - the Israeli database definition document (REG-256);
  - a breach runbook with an in-app notice path (REG-222).
- **No sale of data:** REG-234 and REG-242.
- **Accessibility at WCAG 2.2 AA:** REG-212, REG-229 and REG-261.
- **Trigger gates:** BIPA capture (REG-243), user-to-user features (REG-216), consequential decisions (REG-247).

## 5. BRANCH MAP (by jurisdiction)

**EU** (from r_regulatory §4, not re-verified).
- **Branch A** (limbs i and ii both yes): Art. 50(3) applies as law, consent comes before the first tap, and Annex III applies from 2 Dec 2027.
- **Branch B** (limb i yes on the wearable lane only): Art. 50(3) applies to outputs derived from wearable data.
- **Branch C** (limb i no): the Art. 50 sentence becomes voluntary, and Art. 9 still covers the wearable lane.
- **M-yes / M-no:** MDR classification under Rule 11, or copy discipline as the only control.
- **Channel:** any B2B, employer or education deployment engages the Art. 5(1)(f) prohibition.
- **Applies in every branch:** R1 to R14.

**UK**
- **Pivot yes:**
  - Art. 9 explicit consent covers the mood-only lane, so consent comes before the first tap;
  - the DPIA scope widens;
  - REG-213 applies to the mood-only inference.
- **Pivot no:** Art. 9 consent is scoped to the wearable lane, and the mood-only lane needs an Art. 6 basis chosen by counsel.
- **Medical axis (REG-211):**
  - M-yes: UK MDR conformity is required and MHRA registration follows.
  - M-no: REG-208 to REG-210 are the controls.
- **Establishment:**
  - Controller outside the UK: Art. 27 representative (REG-202).
  - Children likely to access: conform to the Children's code or age-assure (REG-204).
- **Applies regardless:** REG-200, 201, 205, 206, 207, 208, 209, 212, 214, 215.

**US**
- **Pivot yes:**
  - WA, NV and CT consent content reaches mood-only users (REG-230, 235, 236);
  - HBNR "mental health" tracking strengthens the case that Kokonada is a vendor of personal health records (REG-221);
  - CMIA risk rises (REG-239).
- **Pivot no:** the state duties are scoped to the wearable lane.
- **HBNR:**
  - Vendor: REG-222 and REG-223 apply.
  - Not a vendor: FTC §5 only.
- **Medical axis:**
  - M-no: the §520(o)(1)(B) wording and the general wellness policy.
  - M-yes: FDA device regulation.
  - REG-228: the name "KokonadaHealth" is a factor on this axis.
- **Scale:** CCPA only above the thresholds (REG-237, 238). Connecticut applies at any volume (REG-236).
- **Age:** COPPA (REG-224, 225); California from 1 Jan 2027 (REG-240); Texas (REG-241).
- **Nothing found to attach on current facts:**
  - Colorado SB 26-189: music selection is not a "consequential decision".
  - Utah §13-75-103: attaches only if LLM captions ship, and then only on request.
  - BIPA: no statutory identifier is processed.
  - NY S9269: not law.
  - HIPAA: no covered-entity relationship was found.
  - Each is a trigger, not a clearance.

**Israel**
- **Law applies (REG-249 yes):**
  - REG-250, 251, 252, 256 and 257 apply;
  - REG-254 and REG-255 depend on scale;
  - REG-258 applies if EU data is held "in Israel".
- **Law does not apply:** Israeli users are still covered through the consent and notice duties to the extent counsel finds they reach.
- **Pivot yes (via the personality-assessment limb):** the mood-only lane becomes information of special sensitivity (REG-253).
- **Medical axis:** does "טיפול פסיכולוגי" (psychological treatment) or "טיפול רפואי מונע" (preventive treatment) reach a wellness app (REG-260)?
- **Accessibility:** the exemption applies or it does not (REG-261).

**Cross-border**
- EU→US: the Data Privacy Framework (the General Court upheld it on 3 Sep 2025 in T-553/23 [COM]; an appeal, reported as C-703/25 P, is unverified) or SCCs.
- UK→US: the UK Extension (REG-215).
- IL→US: the 2001 Regulations route plus a written undertaking (REG-257).
- EU→IL and EU→UK: adequacy is in place (Commission page, RETRIEVED).
- UK→IL: adequate (ICO page, RETRIEVED).
- **Open question:** if the controller is in Israel, is a flow from an EU or UK user straight to a US processor a "transfer" at all? EDPB Guidelines 05/2021 are UNRETRIEVED.

## 6. THE COUNTER-CASE (the strongest arguments against exposure, and what each must overcome)

- **HBNR.**
  - The argument: Kokonada is a music app. The health data is an input, not a record "managed … primarily for the individual".
  - What it must overcome: the 2024 definition names any "mobile application … that provides mechanisms to track … vital signs … sleep, mental health". There are several sources (Health Connect, Bluetooth, self-report), Pulse displays history, and an export endpoint exists.
- **Washington.**
  - The argument: collection is "necessary to provide a product or service that the consumer has requested", so no separate consent is needed.
  - What it must overcome: the policy and deletion duties (REG-232, 233) apply anyway; sharing needs "separate and distinct" consent; and the exception has not been tested.
- **CCPA and COPPA.** These are strong arguments on the facts: Kokonada is below the thresholds and has a general audience. They must overcome growth, and the COPPA "music" factor.
- **FDA and MHRA.**
  - The argument: this is a wellness product under §520(o)(1)(B) and the general wellness policy, and UK "wellbeing or lifestyle products" are outside regulation.
  - What it must overcome:
    - the "Pre-Panic" history (F6);
    - VISION §6 ("must help regulate it");
    - the name "KokonadaHealth";
    - 21 CFR 801.4, under which claims set intended use;
    - the DMHT guidance, which is unread.
- **UK establishment.**
  - The argument: a controller outside the UK with occasional processing needs no representative.
  - What it must overcome: Art. 27(2)(a) excludes "large scale" special-category processing, and a UK-targeted Play listing counts under Art. 3(2).
- **Children's code.**
  - The argument: the service is not aimed at children.
  - What it must overcome: the "substantive and identifiable user group" test for a music app with no age gate.
- **Israeli Medical Equipment Law.**
  - The argument: "משמש לטיפול רפואי" (used for medical treatment) presupposes a treating professional ("מטפל", a professional listed in the Patient's Rights Law).
  - What it must overcome: the definition includes "טיפול פסיכולוגי" (psychological treatment), and VISION frames the app as a regulator.
- **Israeli accessibility.**
  - The argument: a free app with average turnover at or below NIS 100,000 is exempt under reg. 35ו.
  - What it must overcome: the exemption lasts three years; it depends on "עוסק פטור" (exempt-dealer) or turnover status; and a future revenue change would end it.
- **Israeli consumer law.**
  - The argument: a free service is arguably not a "עסקה" (transaction).
  - What it must overcome: a "service" is included in the definition, and unfair-influence doctrine exists.
- **State AI laws.** None attaches on current facts. The EU Art. 50 sentence already exceeds them.

## 7. QUESTIONS FOR COUNSEL (ordered by what blocks the build soonest)

**P5 — consent wording and version bump (v1→v3; GARMIN_CONSENT_MIN_VERSION→4)**
1. **The pivot.** Is the mood-only lane health data (or special-sensitivity, or consumer health data) in each launch market? Answer Y/N for the EU, UK, WA, NV, CT, CA (CMIA) and IL. [REG-230, 235, 236, 239, 253; EU Q2]
2. Does adding "emotional-state inference and baseline profiling" to the purpose require fresh affirmative consent, rather than notice alone? Answer Y/N for the EU, UK, IL and WA. [REG-251, 232, 200; EU Q5]
3. May one global consent text serve all markets, with market-specific additions? Y/N. If no, name the variants. [REG-200, 230, 236, 250]
4. **Washington.** Does the "necessary to provide a product or service that the consumer has requested" exception cover collection on the wearable lane? Y/N. Must P5 carry the MHMDA content list anyway? Y/N. [REG-230]
5. **WA and NV.** Is sending derived tokens to the LLM inference sub-processor a "share" that needs separate consent? Y/N. [REG-231, 235]
6. **Israel.** Is a decline-first pair of buttons with no checkbox "explicit" consent under the PPA's March 2026 opinion? Y/N. [REG-250]
7. **Israel.** Is the inferred state, or the learned profile, a "personality assessment"? Y/N. [REG-253]
8. **UK.** Is explicit consent the only Art. 9 condition relied on, so that no appropriate policy document is needed? Y/N. [REG-200]
9. Must P5 name each sub-processor and the destination country, or are categories enough? Short answer, per market. [REG-215, 232, 252, 257]
10. **Withdrawal parity.** Does a two-step withdrawal against a one-tap Agree meet UK Art. 7(3) and EU Art. 7(3)? Y/N. [REG-214; EU Q6]
11. Must the AI disclosure also appear inside the consent document for Israel (the PPA AI draft) or for the EU? Y/N. [REG-259; EU R10]

**P11 — sign-in first layer**

12. **Controller.** Which legal entity is the controller, and where is it established? (Short answer; the owner's input is DEC-W01.) [REG-201, 249, 252; EU Q1]
13. Is a UK representative required? Is an EU representative required (Art. 27(2), large-scale special-category processing)? Y/N for each. [REG-202; EU Q1]
14. **Israel s.11.** May the legal-duty-or-voluntary statement, the recipients and the rights sit one tap away from sign-in, or must they be on the first layer? Short answer. [REG-252]
15. **UK.** Must the first layer mention the US transfer and its safeguard? Y/N. [REG-201, 215]

**P9 — vault and export**

16. **Washington.** What deletion window for Atlas backups is acceptable? Short answer. [REG-233]
17. **UK s.164A.** Is an email address an "electronic form" for complaints, or is an in-app form needed? Short answer. [REG-207]
18. **HBNR.** Is Kokonada a vendor of personal health records? Y/N. [REG-221]
19. **HBNR.** If Sentry received vitals (`BE-020`), is that a notifiable breach? Y/N. [REG-223]
20. **Israel.** Is the database "in Israel" for the 2023 EEA Regulations? Y/N. [REG-258]
21. Must export (r_regulatory F5) ship before launch in the UK, the EU and Israel (access rights, s.13)? Y/N. [REG-217, 252]

**P13 — listing claims**

22. Does the name "KokonadaHealth" signal a medical intended use? Answer Y/N for the US, UK and IL. [REG-228]
23. Clear or strike each draft claim against DMCC Sch. 20 para 19(1)(b), FTC substantiation and 21 CFR 801.4. Return a list. [REG-208, 218, 226, 227]
24. Is emotion inference combined with stress-adaptive music SaMD under the UK DMHT guidance? Y/N. [REG-211]
25. Is Kokonada "ציוד רפואי" (medical equipment) under the Israeli law? Y/N. [REG-260]
26. Give the forbidden-term list for Illinois P.A. 104-0054, Nevada AB 406 and CMIA "mental health digital service". Return a list. [REG-244, 245, 239]
27. Give the exact "not a medical device" line for each market. Is the Play sentence acceptable everywhere? Short answer. [REG-211, 226, 260]
28. Is a free app a "עסקה" (transaction) under Israel's Consumer Protection Law? Y/N. [REG-262]

**Age slot (P10)**

29. May the product adopt an 18+ minimum worldwide? Y/N. If not, give the minimum per market. [REG-203, 224, 263; EU Q4]
30. Is a neutral self-declared age screen enough, or must OS or store age signals be consumed (CA from 1 Jan 2027; TX SB 2420)? Short answer. [REG-240, 241, 225]
31. **UK.** Is the service "likely to be accessed by children"? Y/N. [REG-204]
32. **Israel.** Can a 16- or 17-year-old consent to processing of special-sensitivity data? Y/N. [REG-263]

**After the pages (governance and transfers)**

33. Name the transfer mechanism per recipient and per origin (EU, UK, IL). Is a flow straight from a user to a US processor of an Israeli controller a "transfer"? Short answer. [REG-215, 257]
34. Does Israeli law govern a database controlled from Israel but hosted in the US? Y/N. [REG-249, 256]
35. **Israel.** Is a DPO required at launch scale? Y/N. [REG-254]
36. **Israel.** Is Kokonada exempt from reg. 35 under 35ו? Y/N. [REG-261]
37. **Connecticut.** Does any sensitive data bring Kokonada in scope, and what then applies beyond consent (for example a DPIA)? Short answer. [REG-236]
38. **CCPA.** Confirm Kokonada is not a business. Is HRV "neural data"? Y/N for each. [REG-237, 238]
39. **ADA.** Does Title III reach an app-only service? UK Equality Act: does it reach a foreign provider? Short answer. [REG-229, 212]
40. **FTC biometric statement.** Is it still current, and does it reach heart rate and HRV? Y/N. [REG-219]
41. **PECR.** Are the Keychain and MMKV tokens and the Health Connect and Bluetooth reads "strictly necessary"? Is reading a stranger's broadcast "monitoring information automatically emitted"? Y/N for each. [REG-206]
42. **New York S9269.** If it is signed, what changes? Short answer (watch). [REG-248]
43. The remaining EU questions: r_regulatory Q3 and Q7 to Q14, and brief_regulatory Q1 to Q11 (Art. 50, first exposure, BLE, cohort notice, vocabulary).

## 8. WORDING COUNSEL MUST SUPPLY

| Slot | Page | Constraints the wording must meet |
|---|---|---|
| **Consent text** (v3, archived by version and locale per F7). This replaces the placeholder `CONSENT_SECTIONS` (`ConsentSheet.tsx:37-74`) | P5 | **Explicit and specific** (EU and UK Art. 4(11) and 9(2)(a)).<br>**Purpose** includes emotional-state inference and baseline profiling (EU R2).<br>**Data categories** are identical to the OS request (`consentApi.ts:24-51`) and drop the untrue "Training Readiness — from a connected Garmin device" (`UI-012`).<br>**Retention** is stated and true to the code (`PRIVACY_DECLARATIONS.md:93-105`).<br>**Withdrawal:** says what goes and what stays (ADR-0015), and tells the user about the right before consent (UK Art. 7(3)).<br>**Recipients and countries** are named.<br>**Washington content list:** categories, purpose with specific uses, categories of entities, how to withdraw (REG-230).<br>**Israel s.11 items** (REG-252).<br>**Form:** clearly distinguishable, no bundling, decline-first with equal geometry, no emotional tint. |
| **Sign-in first layer** | P11 | **Content:** controller identity and contact; representative(s) if required; purposes and legal basis; recipient categories; link to the full notice; a terms of use link; a link to the consumer health data policy (REG-232).<br>**Form:** no pre-ticked boxes, and no Art. 9 consent or marketing consent bundled into sign-in.<br>**Play:** the privacy-policy link must be inside the app. |
| **AI disclosure, final form.** The drafts are `AI_DISCLOSURE_LONG` and `AI_DISCLOSURE_SHORT` (`legalCopy.ts:11-15`) | P2, P7, P10, P5 chrome | **Terms:** says "AI system" and "emotional state", and says it can be wrong.<br>**Barred:** no efficacy or medical claim; no workplace or education wording.<br>**Form:** meets accessibility requirements (EU Art. 50(5)); the same text across markets; covers the Israeli PPA draft's bot disclosure and the Utah on-request duty. |
| **"Not a medical device" line, per market.** The current drafts are `MEDICAL_DISCLAIMER` and `MEDICAL_CONSULT_REMINDER` | P4, P7, P13, P14 | **Play:** the sentence Play requires, word for word.<br>**US:** no disease or threshold reference (REG-226).<br>**UK:** no claim about a physiological function (REG-208).<br>**Israel:** a Hebrew version with no "טיפול" (treatment) framing (REG-260).<br>**Always:** it must not be used as a safe harbour, and a market variant must never add a claim. |
| **Privacy notice sections** (hosted) | P14, with links from P11, P9, P5 | Controller, contact and DPO or privacy contact; representatives; purposes and bases; categories including inferences; sources; named recipients; transfers and safeguards per origin; retention table; rights per market (UK complaints; Washington deletion including backups; Israel ss.13 and 14 and the EEA Regulations); a consumer health data section or separate page linked from the homepage (WA, NV, CT); age; AI and automated processing; breach contact; how changes are handled and when re-consent is asked; the accessibility statement link; languages. |
| **Accessibility statement** | P14 | Israeli reg. 35ה content per IS 5568, unless counsel finds the exemption applies (REG-261). A Hebrew version. |
| **Sharing consent** (reserved slot) | P5 | Washington's "separate and distinct" consent, used only if Q5 is answered yes. |
| **Age screen copy** | P10 | Neutral, with no hint of the "right" answer (COPPA mixed audience); follows Q29 and Q30. |

## 9. WHERE THE MARKETS CONFLICT, AND THE STRICTER DEFAULT (PROPOSAL)

Every row below is a proposal. The owner and counsel decide.

| Topic | How the markets differ | Stricter default the product would adopt (PROPOSAL) |
|---|---|---|
| Age | UK Art. 8: 13. EU: 13 to 16. COPPA: under 13. Israel: minor under 18. UK Children's code: under 18. CA and TX age signals | 18+ worldwide at launch, with a neutral screen plus OS and store signals (DEC-W04) |
| Consent model | EU/UK explicit consent; WA consent for collection and separate consent for sharing; IL explicit consent preferred, and a new purpose needs new consent; CT consent | One explicit, active, unbundled consent before any health read. A separate sharing line if sharing ever happens. Treat v1→v3 as re-consent everywhere |
| Physiological claims | EU UCPD point 17 (cure); UK DMCC para 19 (modify a physiological function); FDA ("any function of the body"); IL (psychological or preventive treatment); IL and NV (therapy) | Describe the music, never an effect on the body or mind, in every market |
| Deletion | WA includes backups; EU/UK erasure; IL EEA Regulations | Deletion reaches backups within a stated window, and processors are told |
| Breach notice | HBNR 60 days plus FTC; UK/EU 72 hours to the regulator; IL "immediately" to the Registrar for a severe incident | A single runbook built to the fastest deadline in each case, with an in-app notice path |
| Notice | EU/UK Art. 13; IL s.11; WA consumer health data policy on the homepage | One global notice with a consumer health data section, and a separate policy URL linked from the homepage and the app |
| Accessibility | EU EAA open; UK reasonable adjustments; US ADA open; IL reg. 35 | WCAG 2.2 AA, plus an accessibility statement in P14 for every market, including Hebrew |
| Transfers | EU DPF or SCCs; UK Extension or IDTA; IL undertaking or consent | A written processor agreement with a ban on onward transfer for every sub-processor, a DPF check, and optionally an EU hosting region (DEC-W03) |
| AI disclosure | EU Art. 50 (applies now); IL draft; UT on request | The EU form, used globally (already in `legalCopy.ts`) |
| Language | EU Art. 12 "intelligible"; IL expectations | Consent and notice in each launch market's language, archived by version and locale |
| DPO and representative | IL s.17ב1; EU/UK Art. 37 and Art. 27 | Name a privacy contact now; a formal DPO and representatives as counsel directs |

## 10. UNRETRIEVED (each missing source: why it is missing, what it would settle, and how to get it)

1. **RCW 19.373 (Washington), full text.**
   - Why: ECONNREFUSED on app.leg.wa.gov and lawfilesext.
   - Would settle: whether processors are excluded from "share", the full list of consumer health data categories, and the necessity exception (REG-230 to REG-233).
   - How: open app.leg.wa.gov in a browser, about 10 minutes.
2. **NRS 603A.400–.550 (Nevada).**
   - Why: HTTP 403.
   - Would settle: REG-235.
   - How: a browser at leg.state.nv.us.
3. **Connecticut statutes and P.A. 25-113.**
   - Why: cga.ct.gov failed TLS certificate verification.
   - Would settle: REG-236 (definitions, whether neural data is central-only, the DPIA duty).
   - How: a browser.
4. **Texas SB 2420 and Business & Commerce Code ch. 541.**
   - Why: the Texas site is rendered by JavaScript.
   - Would settle: REG-241 and REG-242.
   - How: a browser at capitol.texas.gov.
5. **740 ILCS 14 (BIPA) and Illinois P.A. 104-0054.**
   - Why: ilga.gov refused the connection.
   - Would settle: REG-243 and REG-244 (the definition of therapy and its exclusions).
   - How: a browser.
6. **Nevada AB 406 (enrolled PDF), Utah Code 13-75, Colorado SB 26-189 (enrolled text).**
   - Why: a binary PDF, a 404, and a summary-only page.
   - Would settle: REG-245, REG-246, and REG-247's operative-date conflict.
7. **FDA General Wellness guidance (Jan 2026).**
   - Why: a binary PDF, saved at `C:\Users\danie\.claude\projects\c--Users-danie-Videos-Kokonada\3181c7f6-a2e3-45a7-ba43-a520798841cb\tool-results\webfetch-1790707843847-gwo0j2.pdf`.
   - Would settle: REG-226 and REG-227 (stress and relaxation examples, HRV outputs, notifications).
   - How: open the PDF, about 20 minutes. **This is the highest-priority US item.**
8. **FTC Biometric Policy Statement (P225402), the FTC Dark Patterns report, the HBNR 2024 preamble (89 FR 47054), and the dates of the 2025 COPPA final rule.**
   - Why: PDFs, and federalregister.gov blocks automated fetching.
   - Would settle: REG-219, REG-220 and REG-221 (the preamble's app examples decide whether Kokonada is a vendor of personal health records), and REG-225.
9. **MHRA DMHT guidance (updated 29 Jul 2026, PDF only) and MHRA stand-alone software guidance (Jul 2023).**
   - Why: PDFs. The second is saved at `…\tool-results\webfetch-1790707271528-21b2qi.pdf`.
   - Would settle: REG-211. **This is the highest-priority UK item.**
10. **ICO: the original 2022 emotion-analysis press release (404 on ico.org.uk), "Regulating AI" (PDF, saved at `…\tool-results\webfetch-1790707227601-4fb5wn.pdf`), and the full Children's code standards.**
    - Would settle: REG-213 and REG-204.
11. **The UK–US data bridge commencement date, and the full DUAA commencement schedule.** The page showed no date.
12. **Israel: the official Knesset consolidated PPL PDF (`fs.knesset.gov.il/25/law/25_ls_bk_4300009.pdf`, binary).**
    - Every Israeli quote here is from Nevo.
    - How: download it and check the quoted sections, about 30 minutes.
13. **Israel: PPA texts.**
    - Why: gov.il returned 403.
    - The texts are the consent opinion (March 2026), the AI guidance (draft of April 2025, or a final version), the DPO opinion, the guidance on notifying the PPA above 100,000 people, and the Administrative Warning Regulations 2026 (Nevo 241527, not fetched).
    - Would settle: REG-250, 251, 254, 255, 259.
    - How: a browser at gov.il/he/departments/the_privacy_protection_authority.
14. **AMAR software and app guidance** (gov.il 403). Would settle REG-260.
15. **IS 5568.** It is a paid standard from the Standards Institution of Israel. Would settle REG-261.
16. **Data Privacy Framework List entries** for Railway, MongoDB, the LLM inference sub-processor and Sentry.
    - Why: the page is rendered by JavaScript.
    - How: dataprivacyframework.gov/list in a browser, about 10 minutes.
    - Would settle: REG-215 and REG-257.
17. **EDPB Guidelines 05/2021** (the interplay between Art. 3 and Chapter V). Not attempted. Would settle the transfer question in §5.
18. **The Latombe appeal (reported as C-703/25 P).** Only commentary was found. How: curia.europa.eu.
19. **The Railway service region and the Atlas cluster region.** These are owner dashboard facts.
20. **Washington breach law (RCW 19.255).** Not attempted.
21. **The EU items listed in r_regulatory §6 and brief_regulatory "UNRETRIEVED"**, especially the Art. 50 Guidelines C(2026) 5054 and the OJ text of Reg. 2026/1744.

## 11. WHAT I AM NOT SAYING

- I am not saying that Kokonada is, or is not, a vendor of personal health records, a regulated entity under any state law, a medical device (FDA, MHRA or AMAR), subject to Israeli law, or required to appoint a representative or a DPO.
- I am not saying that any regime "does not apply". The rows marked "nothing found to attach on current facts" are trigger gates on today's code and may change.
- No listed phrase is "cleared". The copy rules reduce risk; they are not a safe harbour.
- A "not a medical device" line decides nothing in any market; claims decide.
- The "stricter default" rows in §9 are proposals for the owner, not advice to proceed.
- SETTLED in the registry means the build may act now. It does not mean counsel has approved the item.
- Every Israeli quote is a Nevo reproduction, and every quote rendered in English is a gloss, not an official translation.
- Store and provider terms (Play, Spotify, Garmin, Railway as a provider) belong to `compliance-auditor`. I read the Railway DPA only for the transfer facts.
