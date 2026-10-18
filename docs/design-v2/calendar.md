---
title: External-dates calendar
status: living
verified: 2026-10-18
owner: compliance-auditor
author agent: sentinel
source: 'sentinel-calendar.md (whole file)'
prepared: 2026-09-29
repo HEAD: b9639c5
scribe substitutions:
  - from: '(the certificate owner name and the fingerprint fragment)'
    to: 'O=Kokonada'
    count: 1
    match: 'B8'
    why: 'item B8 (line 168): the certificate owner name and the fingerprint fragment are dropped; the expiry date stays'
amended: 2026-10-04
amendments:
  - field: 'C1, Note'
    replaced: '`YOUTUBE_CLIENT_ID` is not set in production, so its clock is moot.'
    with: 'Not dormant by configuration: `youtube.js` falls back to `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (set in production), and `YOUTUBE_REDIRECT_URI` was present until 2026-10-01, so the backend treated YouTube as configured. Sealed in code by DEC-122 (HX-3); production counts all zero at 2026-10-01T14:05Z (DAN-046).'
    source: 'HX-3 re-scope verdicts, compliance-auditor, 2026-10-01 (§6, the "dormant" premise; TASKS OPS-091)'
  - field: 'Orchestrator''s production check (2026-09-29)'
    replaced: '`YOUTUBE_CLIENT_ID` is not set.'
    with: '`YOUTUBE_CLIENT_ID` is not set (the `GOOGLE_*` fallback made this moot; see C1).'
    source: 'HX-3 round-1 review, compliance-auditor, 2026-10-01 (§3, the optional annotation of calendar.md:30)'
  - field: 'C1, Note'
    replaced: 'Not dormant by configuration: `youtube.js` falls back to `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (set in production), and `YOUTUBE_REDIRECT_URI` was present until 2026-10-01, so the backend treated YouTube as configured. Sealed in code by DEC-122 (HX-3); production counts all zero at 2026-10-01T14:05Z (DAN-046).'
    with: 'Not dormant by configuration: `youtube.js` falls back to `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, and `GOOGLE_CLIENT_SECRET` and `YOUTUBE_REDIRECT_URI` were both set in production until 2026-10-01 (deleted at about 17:10Z, DAN-046), so the backend treated YouTube as configured until then. Sealed in code by DEC-122 (HX-3); the five DAN-046 P0 counts were zero at 2026-10-01T14:05Z.'
    source: 'HX-3 DEC-113 verification pass, compliance-auditor, 2026-10-01'
  - field: 'C2, the D-U-N-S line'
    replaced: 'the D-U-N-S number, which takes up to 30 days;'
    with: 'the D-U-N-S number, which takes up to 30 days (Play Help 13628312, retrieved 2026-10-04);'
    source: 'CMP-093 re-check, compliance-auditor, 2026-10-04 (§6, NEW-FINDING P1, docs: the line is accurate and needed only its source)'
  - field: 'B9'
    added: '**B9.** 2027, the day not yet named. Android developer verification goes global: an APK installed directly on a certified device, other than over ADB, needs its package registered by a verified developer. (With its Relevance, Source, Severity and Calendar lines, below B8.)'
    source: 'CMP-093 re-check, compliance-auditor, 2026-10-04 (§6, NEW-FINDING P2, watch)'
---

# External-dates calendar (plan step L1), 2026-09-29

**Scope and sourcing.** This calendar is for step L1 only. No repository file was written. Every external source was fetched on 2026-09-29 unless a line says otherwise.

**Orchestrator's production check (2026-09-29).** The Railway production variables show:
- `LLM_MODEL` is not set, so the code default applies: `llama-3.1-8b-instant`.
- `LLM_API_KEY` is a Groq key (`gsk_`).
- `TEMPO_CRITIC_MODEL` is not set.
- `DISCOVERY_CAPTION_LLM` is `true`.
- `YOUTUBE_CLIENT_ID` is not set (the `GOOGLE_*` fallback made this moot; see C1).

The logs of the current deployment start 2026-09-29 12:00 and contain no LLM calls. Older logs cannot be retrieved. Groq's deprecation page recommends `openai/gpt-oss-20b` as the replacement. Whether this project is affected depends on the owner's Groq tier.

## A. Already biting (date has passed)

**A1.** 2 Feb 2025. AI Act Art. 5 prohibitions apply, including emotion recognition at work or in education.
- **Source:** digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai
- **Action:** open no employer or education channel. Counsel's Q9 covers the wording of the "Working" and "Focus" chips.
- **Hits:** P2, P13.
- **Severity:** LOW today, HIGH if such a channel opens.
- **Calendar:** NO.

**A2.** 14 Aug 2025. Israel's Privacy Protection Law, Amendment 13, is in force. Health, biometric and psychological data are especially sensitive.
- **Source:** secondary only (loc.gov GLM 2025-11-17, iapp); gov.il returned 403.
- **Action:** DAN-014, counsel's Q1 on the controller's identity.
- **Hits:** P5, P9, P14.
- **Severity:** MEDIUM.
- **Calendar:** NO.

**A3.** 5 Feb 2026 and 19 Jun 2026. UK Data (Use and Access) Act: Part 5 commenced, then the complaints duty in s.103.
- **Sources:** gov.uk commencement guidance; legislation.gov.uk/uksi/2026/82/regulation/7/made
- **Action:** bites at the first UK user. Decide the Play country list (C3); if the UK is on it, P9 and P14 need a complaints route.
- **Severity:** MEDIUM.
- **Calendar:** NO.

**A4.** 9 Mar 2026. Spotify Development Mode: at most 5 users, and the owner must hold Premium.
- **Detail:**
  - Extended Quota requires an organisation and 250k MAU.
  - July 2026: 25 Client IDs per developer, with quota counted per developer.
  - Terms v10 are unchanged.
- **Sources:** developer.spotify.com (february-2026-migration-guide, quota-modes, 2026-07-23 blog post, terms).
- **Action:** keep playback independent of the provider (P3, ARCH-005), and keep the owner's Premium active.
- **Severity:** CRITICAL.
- **Calendar:** YES, twice: the owner's Premium renewal date, and a quarterly re-check (D1).

**A5.** 30 Apr 2026. Node.js 20 is end-of-life.
- **Evidence:** `backend/Dockerfile:1` is `node:20-slim`, and `.github/workflows/ci.yml:49` pins `'20'`.
- **Sources:** github.com/nodejs/Release schedule.json; nodejs.org previous releases.
- **Action:** move to Node 24 (maintained to 2028-04-30). Check the argon2 install, the full suite, a deploy and `/health`. About 1–2 hours.
- **Severity:** HIGH.
- **Calendar:** NO; it is a TASKS row.

**A6.** 28 May 2026. Texas SB 2420 (App Store Accountability Act) is in effect. The Play Age Signals API exists for it.
- **Sources:** support.google.com/googleplay/android-developer/answer/16569691; developer.android.com/google/play/age-signals/overview
- **Action:** covered by the US country-list decision (C3) and the P10 age slot.
- **Severity:** MEDIUM.
- **Calendar:** NO.

**A7.** US health-data laws already in force.
- **Washington MHMDA**, since 31 Mar 2024. It covers health data derived from non-health data, requires consent, and has a private right of action.
- **Connecticut SB 1295**, 1 Jul 2026 (commentary only).
- **FTC Health Breach Notification Rule**, amended 2024: a multi-source health app counts as a PHR vendor, and notice is due within 60 days.
- **Sources:** atg.wa.gov; ftc.gov HBNR guidance; wilmerhale 2026-07-31.
- **Action:** widen counsel's brief to the US, or keep the US off the Play country list.
- **Hits:** DAN-014, DAN-015, P5, P9, P13, P14.
- **Severity:** HIGH.
- **Calendar:** NO; this drives C3.

**A8.** About 14 Aug 2026. Play's User Data rules now cover third-party AI integrations, and unrated apps are not allowed.
- **Source:** support.google.com/googleplay/android-developer/answer/17134731
- **Action:** the Data safety form, the privacy policy and the in-app disclosure name the LLM sub-processor. Groq's DPA and zero-retention are unconfirmed, and Sentry is not listed. The IARC questionnaire must be done.
- **Hits:** P13, P5, DAN-015.
- **Severity:** HIGH at submission.
- **Calendar:** NO.

**A9.** 27 Jul 2026 and 2 Aug 2026. The AI Omnibus (Reg. (EU) 2026/1744) entered into force, and AI Act Art. 50 applies.
- **Sources:** the Commission's AI Act page; the Commission's Art. 50 FAQ (24 Jul 2026). The Official Journal text is unretrieved.
- **Status:** H1 shipped the notice (c3beeb4). The consent-screen wording and the notice to already-enrolled users wait on counsel (DAN-014, UI-005 surface 6).
- **Hits:** P2, P4, P5, P7, P10.
- **Severity:** HIGH.
- **Calendar:** NO.

**A10.** 16 Aug 2026. Groq shut down `llama-3.1-8b-instant`, and `llama-3.3-70b-versatile` too, for free and developer tiers.
- **Evidence:**
  - `backend/app/services/llmClient.js:10` has `DEFAULT_MODEL = 'llama-3.1-8b-instant'`.
  - `geminiEngine.js:39` falls back to the same model.
  - `.env.example:61` sets it, and `.env.example:78` sets `TEMPO_CRITIC_MODEL=llama-3.3-70b-versatile`.
  - Callers swallow the error (e.g. `llmEstimatorAdapter.js:113`).
- **Source:** console.groq.com/docs/deprecations, which recommends `openai/gpt-oss-20b` (and `openai/gpt-oss-120b` for the 70b model).
- **Action:** the owner confirms the Groq tier. If affected, move to the replacement, prove JSON mode with one real call, update the defaults, and re-run feature estimation for tracks served since 16 Aug.
- **Severity:** HIGH; possibly a live silent failure.
- **Calendar:** NO; this is a check for today.

**A11.** 26 Aug 2026 and 17 Sep 2026. Google removed the legacy Google Sign-In APIs: `play-services-auth` 22.0.0 and `play-services-base` 18.11.0.
- **Sources:** developers.google.com/android/guides/releases; developer.android.com/identity/sign-in/legacy-gsi-migration
- **Evidence:**
  - `@react-native-google-signin/google-signin` 16.1.2 imports GoogleSignIn classes (`RNGoogleSigninModule.java:31-38`).
  - Its library `build.gradle:78` defaults to auth 21.4.0.
- **Action:** choose a Credential Manager path at P11's G0/G1, and pin or guard the library versions until then.
- **Severity:** MEDIUM.
- **Calendar:** NO.

**A12.** 31 Aug 2026. Play requires target API 36 (extension to 1 Nov 2026). The app targets 36.
- **Android 16 behaviours now live on the S22+:**
  - the edge-to-edge opt-out is ignored;
  - predictive back is on by default, and the manifest does not set `enableOnBackInvokedCallback`;
  - orientation locks are ignored on large screens.
- **Sources:** support.google.com/googleplay/android-developer/answer/11926878; developer.android.com/about/versions/16/behavior-changes-16
- **Hits:** F5, every page's G11.
- **Severity:** MEDIUM.
- **Calendar:** NO.

## B. Dated, still ahead

**B1.** 30 Sep 2026. Android developer verification, first regions (BR, ID, SG, TH). Global rollout is "2027 and beyond". Adb installs are exempt.
- **Source:** developer.android.com/developer-verification
- **Severity:** LOW.
- **Calendar:** NO.

**B2.** 12 Oct 2026 and 7 Dec 2026. React Native 0.88 ships and 0.86 reaches "End of Cycle"; then 0.89 ships and 0.86 is unsupported.
- **Coupling:** Reanimated 4.5 supports RN up to 0.86. Moving to 0.87+ needs Reanimated 4.6+ and worklets 0.12+. Skia is 2.6.9, with 2.13.1 the latest.
- **Sources:** reactnative.dev/docs/next/releases; the Reanimated compatibility page.
- **Action:** decide the RN version at T1, before F1. The latest start for an upgrade is about 9 Nov 2026.
- **Hits:** T1, F1–F10, Q3.
- **Severity:** MEDIUM.
- **Calendar:** YES (12 Oct 2026 and 7 Dec 2026).

**B3.** 2 Dec 2026. The AI Act Art. 50(2) grace period for marking generated content ends. It covers only systems on the market before 2 Aug 2026.
- **Relevance:** the LLM discovery captions. `DISCOVERY_CAPTION_LLM` is **true** in production, per the orchestrator's check.
- **Action:** counsel's Q12 on whether Art. 50(2) attaches. Answer needed by about 2 Nov 2026.
- **Hits:** P4, DAN-014.
- **Severity:** MEDIUM.
- **Calendar:** YES, because the flag is on.

**B4.** 1 Jan 2027. California AB 1043 (Digital Age Assurance Act) becomes operative. A developer must request an age signal at download and launch.
- **Source:** leginfo.legislature.ca.gov, AB 1043.
- **Action:** if the US is on the list, integrate Play Age Signals at launch, and get counsel's answer on the minimum age (Q4). Latest start: P10's G1.
- **Hits:** P10, P11, P13.
- **Severity:** MEDIUM.
- **Calendar:** YES.

**B5.** 1 Feb 2027. Play blocks updates that do not support 16 KB memory pages. The app is compliant today: `4e13a49` passes `zipalign -c -P 16`, and all 20 arm64 `.so` files are aligned to 16384.
- **Source:** developer.android.com/guide/practices/page-sizes
- **Action:** a G11 guard for any new native dependency.
- **Severity:** LOW.
- **Calendar:** NO.

**B6.** August 2027 (the day is not yet listed). Play requires target API 37.
- **Target-37 behaviours:**
  - no resizability opt-out on large screens;
  - a foreground service for background audio played by the app itself;
  - `ACCESS_LOCAL_NETWORK`;
  - reflection hardening.
- **Sources:** android-developers.googleblog.com 2026-02; developer.android.com/about/versions/17/behavior-changes-17
- **Action:** latest start 1 May 2027.
- **Hits:** F5, G4, G11.
- **Severity:** MEDIUM.
- **Calendar:** YES (1 May 2027, then August 2027).

**B7.** 2 Dec 2027. AI Act Annex III high-risk rules apply. Annex I follows on 2 Aug 2028.
- **Classification:** Art. 50 Guidelines point 102 says "all emotion recognition systems are also classified as high-risk". The Annex III guidelines are still a draft (19 May 2026).
- **Source:** the Commission's AI Act page.
- **Action:** counsel's classification answer by about 15 Jan 2027 (DAN-010, DAN-014). Latest start: now.
- **Hits:** P2, P4, P5, P7, P10, and launch timing.
- **Severity:** CRITICAL.
- **Calendar:** YES (15 Jan 2027 checkpoint; 2 Dec 2027).

**B8.** 3 Dec 2053. The release signing certificate expires (O=Kokonada).
- **Open risk:** whether a keystore backup exists is unverified.
- **Severity:** LOW.
- **Calendar:** NO.

**B9.** 2027, the day not yet named. Android developer verification goes global: an APK installed directly on a certified device, other than over ADB, needs its package registered by a verified developer.
- **Relevance:** the Israel tester stage can run on an APK installed directly, with no Play account (`CMP-093`). From the global date, `com.kokonadahealth` needs a registered developer: a full account, or a limited-distribution account for up to 20 devices.
- **Source:** developer.android.com/developer-verification ("Verification capability will be expanded globally for all apps on certified Android devices in 2027"); its FAQ ("Apps installed using ADB won't require verification"); the limited-distribution guide. Retrieved 2026-10-04 by the compliance-auditor.
- **Severity:** MEDIUM (a watch item).
- **Calendar:** NO, until Google names the date.

## C. Clocks triggered by a Kokonada event

**C1.** Google OAuth clocks. In "Testing" status, refresh tokens expire after 7 days. An unused client is deleted after 6 months.
- **Note:** Not dormant by configuration: `youtube.js` falls back to `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, and `GOOGLE_CLIENT_SECRET` and `YOUTUBE_REDIRECT_URI` were both set in production until 2026-10-01 (deleted at about 17:10Z, DAN-046), so the backend treated YouTube as configured until then. Sealed in code by DEC-122 (HX-3); the five DAN-046 P0 counts were zero at 2026-10-01T14:05Z.
- **Action:** check the publishing status, and make sure someone reads the Cloud contact email.
- **Severity:** LOW–MEDIUM.
- **Calendar:** NO.

**C2.** Legal entity and controller. This one decision gates:
- the D-U-N-S number, which takes up to 30 days (Play Help 13628312, retrieved 2026-10-04);
- an organisation Play account, which Play requires for health apps;
- Garmin, whose program is business use only;
- Spotify Extended Quota;
- the privacy policy's "who" line (DAN-015).

Latest start: before P5's G1. Severity: HIGH. Calendar: YES, as a reminder the owner sets.

**C3.** The Play country list, decided before the first closed test. Severity: HIGH. Calendar: YES.

**C4.** Trademark clearance on "Kokonada" before P12 starts. The EUIPO, USPTO and Israeli registers were not searched. Severity: MEDIUM. Calendar: YES.

**C5.** Before the first upload to any Play track:
- the Health apps declaration and the Health Connect data-type declaration;
- the Data safety form, the IARC rating, the privacy-policy URL and the account-deletion URL;
- the Health Connect rationale screen (MB-035);
- the Play App Signing SHA-1 added to the Android OAuth client.

Review time is unverified; plan a 2-week buffer. Severity: HIGH. Calendar: YES, six weeks before the upload.

**C6.** A new personal account needs 12 testers opted in for 14 days, then a review of about 7 days. This conflicts with DAN-021 and with the Spotify 5-user cap.
- **Action:** recruit 12 or more testers with a playback path that does not need Spotify, or use an organisation account.
- **Source:** support.google.com/googleplay/android-developer/answer/14151465
- **Severity:** HIGH.
- **Calendar:** YES, at least six weeks before launch.

**C7.** Garmin §6.6: 30 days' written notice, with mockups, before shipping UI that shows Garmin data. The text is unverified, from the repo's 2026-08-26 extraction.
- **Program:** business use only.
- **Conflict:** DAN-009 says accounts are not being issued; the public FAQ shows no pause.
- **Calendar:** NO now; YES once an agreement exists.

**C8.** Rolling data clocks:
- **YouTube:** stored API data refreshed or deleted within 30 days (III.E.4.c); after a revoke, deletion within 7 days (via the app) or 30 days (via Google) (III.D.2.3); a quota above the default requires an audit.
- **Spotify:** personal data deleted within 5 days of a disconnect, and Spotify content not stored indefinitely.
- **Enforced at:** P8 and P9, including the HALT on `PlaylistSession.trackSummary`.
- **Calendar:** NO.

**C9.** Incident clocks: the FTC 60-day breach notice, and the UK 30-day complaint acknowledgement (commentary). These go into the P9 and P14 runbooks. Calendar: NO.

## D. Recurring, and checked as not applicable

**D1.** A quarterly platform re-check, first on 4 Jan 2027, plus one run before Stage 0 closes. It covers:
- Spotify, Play policy, Groq's deprecations page, YouTube's revision history, the Garmin FAQ and Android's behaviour changes;
- the GDPR half of the Digital Omnibus (in negotiation);
- the Digital Fairness Act (planned Q4 2026).

Calendar: YES.

**Checked and not applicable:**
- Google Fit end of 2026: the app has no Fit usage.
- AI Act prohibition 9 (nudification).
- Android 16 `BODY_SENSORS`: not used.
- Health Connect framework module.
- GitHub Actions' removal of the Node 20 runtime: CI is green.
- Node 22 end-of-life: relevant only if the backend moves to 22.
- European Accessibility Act (applies from 28 Jun 2025): wellness apps are not in the service list. E-commerce comes into scope only with in-app purchases. The microenterprise exemption was not re-verified.

## Unverified
1. Health declaration review time.
2. Garmin §6.6 text and API changes.
3. The Official Journal text of Reg. 2026/1744.
4. The exact day of API 37 in August 2027.
5. The global developer-verification date.
6. Israel's Amendment 13 milestones (primary source returned 403).
7. Connecticut (commentary only); Nevada.
8. Owner-only facts:
   - the Groq tier;
   - that Railway builds from the Dockerfile;
   - the OAuth publishing status;
   - the Play account type and creation date;
   - the Spotify Premium renewal date.
9. A Credential Manager path in the Google Sign-In library's free tier.
10. Trademark registers.
11. YouTube's revision history marked 2026-09-29 with no entry.
12. A keystore backup.

## Changed since the 2026-09-23 research
- **Omnibus:** in force on 27 Jul 2026 (resolved).
- **API 37:** now sourced as August 2027.
- **New since that research:**
  - the Groq shutdown;
  - Google Sign-In removed from the SDK;
  - Node 20 end-of-life;
  - RN 0.86 end of support;
  - 16 KB pages;
  - the 15 Jul 2026 Play policy;
  - Texas SB 2420 and California AB 1043;
  - UK s.103;
  - target-37 behaviours;
  - Spotify's July 2026 quota change.
- **Garmin:** status conflict with DAN-009.

## Act on first
1. Groq model shutdown: confirm the tier; if affected, switch model.
2. Node 20 end-of-life: move to Node 24 this week.
3. RN 0.86 end of support: decide at T1, before F1.

The most severe date is 2 Dec 2027 (Annex III), with its checkpoint on 15 Jan 2027.

## Proposed TASKS rows (no IDs assigned)
- The Groq tier and model in DAN-018.
- Node 24.
- A Credential Manager migration for P11, with a version guard.
- The RN version decision at T1.
- The entity/D-U-N-S decision.
- The Play country list.
- A trademark search before P12.
- The Spotify Premium renewal date.
- The OAuth publishing status.
