# Kokonada — Store Privacy Declarations

> **Status:** Reconciled 2026-07-17 — merges the post-#152 scope-minimization reconciliation
> ("now-true" state: SpO₂/respiratory/background-read removed, Groq/retention/export sections,
> Sign in with Apple shipped, Garmin deregistration) with the WS-5 GDPR Art.9 consent feature
> (`ConsentRecord`, the server consent gate, the consent screen — `docs/SCREENS.md` §11).
> Source-of-truth copy for the Apple App Store and Google Play console privacy forms and the
> in-app/hosted privacy policy. Derived from the actual collected fields
> (`backend/app/models/User.js`, `backend/app/models/BiometricLog.js`), the health scopes
> actually read (`mobile/KokonadaHealth/src/health/permissions.ts`), the retention TTLs, the
> GDPR export/erasure endpoints, and the sub-processor posture. Ground truth for the security
> posture: [ADR 0005 — zero-knowledge biometrics](adr/0005-zero-knowledge-biometrics.md).
>
> **What's true as of this reconciliation:** (1) SpO₂ and respiratory rate are **no longer
> collected** — their Health Connect scopes had no reader and were removed (scope
> minimization, PR #152); (2) the background-read scope was removed (all reads are
> foreground) — **except** the separate BLE live-HR lane, see the GDPR Art.9 section below;
> (3) **Sign in with Apple is client-side shipped** (native `AppleButton`, HIG-exact) —
> portal provisioning (Apple Developer capability + certificate) and on-device iOS
> verification are still a pending human action (Windows dev box cannot build/verify iOS);
> (4) the **GDPR Art.9 consent gate** (`ConsentRecord`, `requireConsent` middleware + an inline
> gate on the device-token-authed live-HR lane) now hard-gates **every** user-facing
> special-category ingestion path — H-9 is fully closed; (5) Groq sub-processor, retention
> windows, and the export/erasure rights below are current.
>
> **Egress summary (verify before every store submission):** outbound LLM prompts carry
> **no raw biometric values, no raw free-text, no account identifiers (name/email/userId),
> and no Spotify Content** — only abstract emotion coordinates, a coarse physiological
> intensity band, closed-vocabulary derived-intent tags, and mood-descriptor genres. Raw
> vitals map to audio targets **deterministically after the model returns**, never in the
> prompt. <!-- verified: backend/app/services/geminiEngine.js:255-262 (egress note); :173-179,206-209 (emotion prompt = allow-list genres + coords + intent, not Spotify genres); :231-239 (biometric prompt = band only, no vitals/identifiers); :296-299 (deterministic post-return banding) -->
>
> Any NEW external egress, permission, brand asset, or store field forces a diff of this
> document and a `compliance-auditor` re-review before submission.

## Data inventory (what the app actually stores)

| Data | Where | Purpose | Notes |
| :--- | :--- | :--- | :--- |
| Email address | `User.email` | Account identity (required) | From SSO (Google/Apple) or password signup. Apple may supply a **private relay** address. |
| Name / avatar | `User.displayName`, `avatarUrl` | Profile display | Optional; Apple sends name only on first grant. |
| SSO identifier | `User.ssoProvider`+`ssoId`, `Identity` | Authentication | Account keyed by (provider, ssoId); **not** auto-linked across providers by email. `Identity.passwordHash` (argon2id) is never exported. <!-- verified: backend/app/services/privacy/userDataExport.js:32 --> |
| 3rd-party OAuth tokens (Spotify, YouTube Music, wearable) | `User.spotifyToken` / `youtubeMusicToken` / `wearableToken` | Music sourcing + biometrics ingest | **AES-256-GCM encrypted at rest**; excluded from data export as credentials. <!-- verified: backend/app/services/privacy/userDataExport.js:38-40 --> |
| Health & fitness (heart rate, HRV, sleep, resting heart rate) | `BiometricLog`, `MedicalProfile` | Core feature: biometric-adaptive playlist generation | Field-level encrypted per ADR 0005; ingested from Garmin / Health Connect / Apple HealthKit / Suunto / sideloaded watch. **SpO₂ and respiratory rate are NOT collected** (scope removed — no reader). **Never** sent to any LLM/AI; raw values never leave the server boundary except in the subject's own authenticated export. |
| Music profile & listening-derived taste | `MusicProfile` | Personalised generation | Derived from the user's own Spotify/YouTube history. |
| Playlist history & serve events | `PlaylistSession`, `ServeEvent`, `UnclassifiedTrack` | History screen, anti-repetition | User-scoped. `PlaylistSession.contextPrompt` (free-text) is encrypted and kept for local history only. |
| **Consent records** | `ConsentRecord` | Proof of GDPR Art.9 explicit consent for health/biometric processing | Versioned & **append-only** (grant→withdraw→re-grant history preserved); records purpose (`health_biometric_processing`), consent version, the data categories consented to, status, timestamps, and optional app-version/locale provenance; **user-scoped; erased on account deletion; included in data export**. <!-- verified: backend/app/models/ConsentRecord.js:13-38; erased backend/app/services/privacy/erasure.js:17,46; exported backend/app/services/privacy/userDataExport.js:20,35 --> |
| Push tokens | `User.pushTokens` | Notifications (mobile) | Per device (ios/android/web); treated as rotating credentials, excluded from export. |
| Watch device token (hash) | `User.watchToken.hash` | Sideloaded watch HR streaming | Only a hash is stored; the `whr_` secret is shown once, never persisted in clear. |
| Entitlement tier | `User.entitlements` | Free-tier state (RevenueCat) | App is 100% free ([ADR 0001](adr/0001-100-percent-free-app.md)); no purchase/financial data collected. |

**Not collected:** precise location, contacts, browsing history, advertising identifiers, financial/payment info, SpO₂, respiratory rate. **No third-party advertising or analytics SDKs; no data sold or shared for ads.**

> **Location note (Data Safety accuracy):** the app declares `ACCESS_FINE_LOCATION` **only on Android ≤11** and **only** to satisfy the legacy Bluetooth-scan requirement for Garmin broadcast-HR; on Android 12+ the scan uses `neverForLocation`. No location is ever read, stored, or transmitted. <!-- verified: mobile/KokonadaHealth/android/app/src/main/AndroidManifest.xml:18,23 -->

## Sub-processors (who touches the data, and what they receive)

Kokonada uses the following processors. None is an advertiser; none receives raw biometric values or free-text. All processing is on Kokonada's behalf to deliver the feature the user requested.

| Sub-processor | Role | What it receives | What it NEVER receives |
| :--- | :--- | :--- | :--- |
| **Groq** (`api.groq.com`, US-hosted inference) | LLM inference for music-parameter generation, genre enrichment, and audio-feature estimation | Non-identifying, derived tokens only: abstract emotion coordinates, a coarse physiological intensity band, closed-vocabulary derived-intent tags, mood-descriptor genres (generation); genre tags for feature estimation; and — at profile-build only — **non-Spotify (YouTube Music) library artist names** for genre enrichment. Cache key is `md5(prompt)`; the cached value is only derived AI params, never vitals. <!-- verified: backend/app/services/geminiEngine.js:173-179,231-239 (generation prompts); backend/app/services/features/llmEstimatorAdapter.js:54-59 (genre tags only, title/artist/channel withheld); artist-name backfill gated to youtube_music only backend/app/services/musicProfileService.js:570-571 --> | Raw HR/HRV/sleep/resting-HR values; raw user free-text; name/email/userId; and **Spotify Content** (artist names, genres, URIs are gated out of every LLM path). <!-- verified: backend/app/services/geminiEngine.js:255-262; backend/app/utils/spotifyContent.js:25-52; backend/app/services/features/llmEstimatorAdapter.js:47-52 --> |
| **Wearable data sources** — Garmin, Suunto, Apple HealthKit, Android Health Connect | Biometric data providers connected at the user's direction | (These are data **sources**, not recipients.) | — |
| **Music providers** — Spotify, YouTube Music | Taste import + playback, at the user's direction | OAuth-scoped access to the user's own library/playback | — |
| **Railway** | Application/API hosting | All application traffic (encrypted in transit) | — |
| **MongoDB Atlas** | Managed database | Encrypted-at-rest health/OAuth fields + user-scoped records | — |
| **Vercel** | Legacy web client hosting (being sunset) | Web-client static assets / SPA | — |
<!-- NEEDS VERIFICATION: the Railway / MongoDB Atlas / Vercel provider identities are architectural facts (prod deploy topology) not confirmed from source this pass — reconfirm the current hosting/DB provider list before filing. -->

- **Biometrics are never shipped to any LLM or external AI**, never logged, and decrypted only in worker scope ([ADR 0005](adr/0005-zero-knowledge-biometrics.md); audit F3/F16).
- Raw HR/HRV/sleep are **AES-256-GCM field-encrypted at rest**; the serve ledger stores only **coarse bands**, never raw vitals.

> **Standing condition — Groq DPA + Zero-Data-Retention.** Because derived music/mood tokens
> (and, at profile-build, non-Spotify artist names) are transmitted to Groq, a **Data
> Processing Agreement MUST be executed and Zero-Data-Retention MUST be enabled in the Groq
> Data Controls console**, and Groq MUST be listed as a sub-processor in the published privacy
> policy, **before public launch**. Groq offers customer-selectable ZDR and does not train on
> API data by default, but this is a **business/legal action that is not yet confirmed done** —
> until it is executed, treat this row as UNVERIFIED for launch purposes. <!-- NEEDS VERIFICATION: DPA/ZDR execution is a portal/legal action, not confirmable from code -->

## Retention

| Data | Retention | Mechanism |
| :--- | :--- | :--- |
| Biometric samples (`BiometricLog`) | **90 days** (default; `BIOMETRIC_RETENTION_DAYS`) | MongoDB TTL index on `recordedAt`. |
| Serve/generation events (`ServeEvent`) | **90 days** | MongoDB TTL index on `servedAt`. |
| Refresh tokens (`RefreshToken`) | Until expiry | TTL index on `expiresAt`. |
| Consent records (`ConsentRecord`) | Until the user deletes the account | Append-only; full history retained for Art.7(1) demonstrability while the account exists; erased with the account (no anonymized retention ledger — decision, WS-5). |
| Account + profile/history | Until the user deletes the account (or requests erasure) | Server-first hard delete across every user-owned collection. |

## Your rights — export, erasure & consent (GDPR Art. 7/9/15/17/20)

- **Export:** `GET /api/auth/account/export` returns the caller's own data as JSON (portability), including consent history. In-app entry point on the account/data screen. <!-- verified: backend/app/services/privacy/userDataExport.js:26-79 -->
- **Erasure:** in-app **Delete account** performs a server-first hard delete across every user-owned collection, including `ConsentRecord` (`backend/app/services/privacy/erasure.js`); also `scripts/gdpr-delete.js`.
- **Per-wearable erasure & Garmin deregistration:** the live **Disconnect** action (`DELETE /api/integrations/garmin/disconnect`) erases exactly that provider's biometric/medical footprint — a source-scoped `BiometricLog` delete plus an orphaned-`MedicalProfile` drop (`services/privacy/wearableErasure.js`) — synchronously, before the disconnect response returns. On Garmin disconnect the app also **deregisters** with Garmin so Garmin stops pushing data and drops our access (gated behind `GARMIN_DEREGISTER_ENABLED` until Garmin Health API approval is live); deregistration is **best-effort** — a Garmin-API failure is swallowed and never blocks the local data purge. <!-- verified: garminDisconnect → eraseWearableProvider in backend/app/controllers/integrationsController.js; regression backend/tests/garminDisconnectErasure.integration.test.js -->
- **Consent (Art.9) grant/withdraw:** see the dedicated section below — a separate, versioned mechanism from OS permission grants.

## Apple App Store — Privacy Nutrition Labels

- **Data Used to Track You:** *None.* (No ad networks, no cross-app tracking, no IDFA.)
- **Data Linked to You** (identifiable, used for **App Functionality** only — not tracking, not advertising):
  - Contact Info → **Email Address** (account).
  - Health & Fitness → **Health** (heart rate, HRV, sleep) and **Fitness** (resting heart rate) — core feature. SpO₂/respiratory rate are **not** collected.
  - User Content → **Other User Content** (music/taste profile, playlist history).
  - Identifiers → **User ID** (SSO subject).
  - Usage Data → **Product Interaction** (generation/serve events, for anti-repetition + history).
- **Data Not Linked to You:** none declared (everything is account-scoped).
- **Sign in with Apple — client-side SHIPPED, portal/device verification PENDING.** Native `AppleButton` (`@invertase/react-native-apple-authentication`, `ASAuthorizationAppleIDButton`) offered alongside Google, satisfying App Store §4.8. Apple **private-relay** email is honored. **Remaining human action (cannot be done from this Windows dev box):** enable the Sign in with Apple capability in Xcode + create the App ID key/certificate in the Apple Developer Portal, `pod install`, and on-device iOS QA — do not submit the iOS binary until this is complete. <!-- verified: mobile/KokonadaHealth/src/auth/SignInScreen.tsx AppleButton wiring; mobile/KokonadaHealth/src/auth/auth.ts signInWithApple(); backend verifier unchanged backend/app/routes/auth.js:3 -->
- Health data is **never** used for advertising, shared with third parties for their own purposes, used to build cross-app profiles (App Store Health data rules), or sent to any LLM/AI. Raw biometric values are processed only server-side and in the subject's own export. Deleting the account erases all of it (see **Your rights** above).

## Google Play — Data Safety Form

- **Data collected & shared:** Collected: **yes.** **Shared with third parties: No** — OAuth tokens go only to the respective provider APIs (Spotify/YouTube/Garmin) **at the user's direction**, and derived tokens go to Groq as a **service provider/sub-processor** under the standing DPA/ZDR condition; neither is a transfer to another party for that party's own use, which is Play's definition of "sharing." **This "No" is conditional on the Groq DPA being executed and ZDR enabled** (Sub-processors, above) — if that condition is not met before launch, re-evaluate the answer. <!-- verified sub-processor egress: backend/app/services/geminiEngine.js:255-262 --> <!-- NEEDS VERIFICATION: DPA/ZDR execution -->
- **Categories collected:**
  - Personal info → **Email address**, **Name** (optional). Purpose: Account management. Linked to user. Optional/required: required (email).
  - **Health and fitness** → **Health info** (heart rate, HRV) + **Fitness info** (sleep, resting heart rate). Purpose: App functionality. Linked to user. **Optional** (app works "mood only" without a wearable — the "Try with mood only" path). SpO₂/respiratory rate are **not** collected.
  - App activity → **Other user-generated content** (music/taste profile, playlist history) + **Other actions** (generation events). Purpose: App functionality + personalization.
  - Device or other IDs → push token (App functionality — messaging). **User payment info: none.**
- **Security practices:**
  - **Data is encrypted in transit** (HTTPS/TLS): yes.
  - **Data is encrypted at rest:** yes — OAuth tokens and biometrics are AES-256-GCM field-level encrypted ([ADR 0005](adr/0005-zero-knowledge-biometrics.md)).
  - **Users can request data deletion:** yes — in-app **Delete account** (`DELETE /api/auth/account`) performs a server-first hard delete across every user-owned collection (BiometricLog, MedicalProfile, MusicProfile, PlaylistSession, ServeEvent, Identity, RefreshToken, UnclassifiedTrack, ConsentRecord) plus user-scoped Redis state, removes the User doc last, disconnects live sockets, and revokes the session JWT; `scripts/gdpr-delete.js` mirrors the same cascade. A deletion URL will be provided for the Play listing. <!-- verified: backend/app/controllers/authController.js:220-245; backend/app/services/privacy/erasure.js:33-49 -->
  - **Users can request their data (access/portability):** yes — authenticated **`GET /api/auth/account/export`** returns the subject's own records as JSON, health data **decrypted** for the subject, with credential secrets (password hash, refresh-token hash, OAuth blobs) redacted. <!-- verified: backend/app/controllers/gdprExportController.js:8-16; backend/app/services/privacy/userDataExport.js:26-79; backend/app/routes/auth.js:24 -->
  - **Committed to Play Families / independent security review:** N/A (not a Families app).
- **Health Connect (Android):** all reads are **read-only** and **scope-minimized** to exactly what a shipped feature reads. The manifest declares: `READ_HEART_RATE`, `READ_HEART_RATE_VARIABILITY`, `READ_SLEEP`, `READ_RESTING_HEART_RATE`, plus `READ_HEALTH_DATA_HISTORY` (needed for the ~6-month backfill beyond the 30-day cap). **No** `READ_OXYGEN_SATURATION`, `READ_RESPIRATORY_RATE`, or `READ_HEALTH_DATA_IN_BACKGROUND` — those scopes had no reader and were removed; every Health Connect read happens in the foreground. <!-- verified: mobile/KokonadaHealth/src/health/permissions.ts; mobile/KokonadaHealth/android/app/src/main/AndroidManifest.xml:6-14 --> Health Connect data is used **solely** for server-side biometric-adaptive generation, is never shared for ads, and is gated behind an explicit GDPR Art.9 consent record that the server enforces before special-category ingestion is accepted (see below). The Play **Health apps declaration form** must be filed (see `docs/store/play-health-connect-declaration.md`) and its wording, the in-app rationale (`PermissionsRationaleActivity` / `ViewPermissionUsageActivity`), and the consent screen must all match this inventory exactly. <!-- verified server consent gate: backend/app/routes/integrations.js:79,83 (requireConsent on apple/push + health/batch) -->

## GDPR Art.9 consent (health/biometric processing)

- OS/OAuth read grants alone are **not** lawful Art.9 consent. A dedicated, versioned, explicit consent record is captured and enforced server-side: special-category ingestion endpoints are hard-gated by `requireConsent('health_biometric_processing')`, and a stale/absent/withdrawn consent blocks ingestion. <!-- verified: backend/app/routes/integrations.js:21-24,79,83; backend/app/models/ConsentRecord.js:5-12,45-47 -->
- A user-facing **consent screen** presents purpose, data types, retention, sub-processors, and the withdrawal path, and writes the versioned `ConsentRecord` — shown just-in-time immediately before the OS Health Connect permission prompt (`docs/SCREENS.md` §11). Withdrawal is a new append-only `withdrawn` row, revokes future ingestion, and erases the wearable data footprint.
- **H-9 is now fully closed across every user-facing ingestion path.** All three special-category ingestion routes are consent-gated: `/apple/push` and `/health/batch` via the session-authed `requireConsent` middleware; `POST /integrations/watch/hr` (the device-token-authed live BLE heart-rate lane — previously the one gap, since it has no session `req.user`) via an inline check on the same `getConsentStatus` service against its already-resolved token→user lookup, running BEFORE any body validation or socket delivery. <!-- verified: backend/app/controllers/integrationsController.js watchHrIngest (getConsentStatus gate, resilience-audit follow-up); backend/tests/watchIntegration.test.js "Art.9 consent gate" (5 tests) --> `POST /integrations/garmin/webhook` remains genuinely not yet reachable, pending Garmin Health API production approval (separate Pause & Guide human gate) — not a live gap, since no traffic flows there today.
- **Cross-package version integrity:** the mobile client declares which contract version (`CONSENT_SCREEN_VERSION`) its consent copy/data-categories represent on every grant; the server rejects (409 `stale_client`) a mismatch rather than silently recording an un-updated app's grant as "current." This closes a residual gap where a server-only `CURRENT_CONSENT_VERSION` bump could otherwise let an old app's grant read as consented to terms it never displayed. <!-- verified: backend/app/services/privacy/consent.js recordConsent clientVersion check; mobile/KokonadaHealth/src/health/consentApi.ts CONSENT_SCREEN_VERSION -->

## Cross-store consistency checklist (for Wave 3)
- [ ] Privacy policy URL live and listing Groq as a sub-processor + the Groq DPA/ZDR executed.
- [ ] Account-deletion URL/flow documented for both stores (in-app `DELETE /api/auth/account` + web).
- [ ] Self-service data-export flow (`GET /api/auth/account/export`) reflected in both stores' "can request data" answers.
- [ ] **Sign in with Apple** — client UI shipped; complete the Apple Developer Portal capability/cert provisioning + on-device iOS QA before iOS submission.
- [x] **`/watch/hr` gated by Art.9 consent** — H-9 fully resolved across every user-facing ingestion path (see above).
- [ ] Play **Health apps declaration form** filed (`docs/store/play-health-connect-declaration.md`); history-read justification submitted.
- [ ] Health-data-use disclosure copy matches this inventory **verbatim** across: Apple Health label, Health Connect declaration, in-app `PermissionsRationaleActivity`, and the consent screen (single source of truth).
- [ ] "No third-party sharing / no ads / no tracking" asserted identically on both stores (conditional on the Groq DPA/ZDR standing condition).
- [ ] Re-verify inventory after Web Sunset removes web-only surfaces (drops the Vercel sub-processor).
