# Kokonada — Store Privacy Declarations

> **Status:** Reconciled to the post-remediation ("now-true") state — source-of-truth copy for
> the Apple App Store and Google Play console privacy forms and the in-app/hosted privacy
> policy. Derived from the actual collected fields (`backend/app/models/User.js`,
> `backend/app/models/BiometricLog.js`), the health scopes actually read
> (`mobile/KokonadaHealth/src/health/permissions.ts`), the retention TTLs, the GDPR
> export/erasure endpoints, and the sub-processor posture. Ground truth for the security
> posture: [ADR 0005 — zero-knowledge biometrics](adr/0005-zero-knowledge-biometrics.md).
>
> **What changed in this reconciliation:** (1) SpO₂ and respiratory rate are **no longer read
> via Android Health Connect** — those scopes had no reader and were removed (scope
> minimization); they may **still** be ingested from Garmin pulseox/respiration and Apple
> Health and are stored encrypted on `MedicalProfile` (NOT a claim of zero collection);
> (2) the background-read scope was removed (all reads are foreground);
> (3) added the **Groq sub-processor** disclosure (anonymized taste/mood signals only — **no
> biometrics** reach any LLM, per ADR 0005); (4) added **retention windows**; (5) added the
> **data-export** right; (6) noted Garmin **deregistration** on disconnect.

## Data inventory (what the app actually stores)

| Data | Where | Purpose | Notes |
| :--- | :--- | :--- | :--- |
| Email address | `User.email` | Account identity (required) | From SSO (Google/Apple) or password signup. Apple may supply a **private relay** address. |
| Name / avatar | `User.displayName`, `avatarUrl` | Profile display | Optional; Apple sends name only on first grant. |
| SSO identifier | `User.ssoProvider`+`ssoId`, `Identity` | Authentication | Account keyed by (provider, ssoId); **not** auto-linked across providers by email. |
| 3rd-party OAuth tokens (Spotify, YouTube Music, wearable) | `User.spotifyToken` / `youtubeMusicToken` / `wearableToken` | Music sourcing + biometrics ingest | **AES-256-GCM encrypted at rest** (`encryptedTokenSchema`). |
| Health & fitness (HR, HRV, sleep, resting HR, SpO₂, respiration) | `BiometricLog`, `MedicalProfile` | Core feature: biometric-adaptive playlist generation | Field-level encrypted per ADR 0005; ingested from Garmin / Health Connect / watch. **Never** sent to any LLM/AI. SpO₂ & respiration are no longer read via **Android Health Connect** but may still arrive from **Garmin** pulseox/respiration and **Apple Health** (persisted encrypted on `MedicalProfile.spO2` / `.respirationRate`). |
| Music profile & listening-derived taste | `MusicProfile` | Personalised generation | Derived from the user's own Spotify/YouTube history. |
| Playlist history & serve events | `PlaylistSession`, `ServeEvent`, `UnclassifiedTrack` | History screen, anti-repetition | User-scoped. |
| Push tokens | `User.pushTokens` | Notifications (mobile) | Per device (ios/android/web). |
| Watch device token (hash) | `User.watchToken.hash` | Sideloaded watch HR streaming | Only a hash is stored; the `whr_` secret is shown once, never persisted in clear. |
| Entitlement tier | `User.entitlements` | Free-tier state (RevenueCat) | App is 100% free ([ADR 0001](adr/0001-100-percent-free-app.md)); no purchase/financial data collected. |

**Not collected:** precise location, contacts, browsing history, advertising identifiers, financial/payment info. **No third-party advertising or analytics SDKs; no data sold or shared for ads.**

## Sub-processors & AI

| Sub-processor | What it receives | What it NEVER receives |
| :--- | :--- | :--- |
| **Groq** (LLM inference for mood/taste reasoning during generation) | **Anonymized** taste/mood signals — genre/mood descriptors and derived generation parameters, keyed by `md5(prompt)`; plus **YouTube-sourced artist names** for one-time genre backfill (see below). | **No biometrics** (HR/HRV/sleep/resting HR/SpO₂/respiration), **no Spotify content**, **no** raw identity, **no** account email. |
| Music providers (**Spotify**, **YouTube Music**) | The user's OAuth token, used **at the user's direction** to read their own library/taste and source playback — nothing more. | Not transferred to any other party for that party's own use. |
| Wearable providers (**Garmin**, Health Connect, Suunto) | OAuth/webhook plumbing to ingest the user's own biometrics. | — |

- **Biometrics are never shipped to any LLM or external AI**, never logged, and decrypted only in worker scope ([ADR 0005](adr/0005-zero-knowledge-biometrics.md); audit F3/F16). The Groq cache stores only `md5(prompt)` + derived params — never vitals.
- Raw HR/HRV/sleep are **AES-256-GCM field-encrypted at rest**; the serve ledger stores only **coarse bands**, never raw vitals.
- **Music-content policy (Wave 0 H-3):** Spotify content is **never** sent to any LLM (Spotify Developer Policy AI-ingestion ban). When a profile has no usable genres, **YouTube-sourced artist names only** are sent to Groq once at profile-build time for genre backfill (`inferArtistGenres`) — an explicit allowlist (`youtube_music`) that fails **closed** (a provider-less/mis-tagged track's artist is never sent). No track audio/content and no biometrics are involved.

## Retention

| Data | Retention | Mechanism |
| :--- | :--- | :--- |
| Biometric samples (`BiometricLog`) | **90 days** (default; `BIOMETRIC_RETENTION_DAYS`) | MongoDB TTL index on `recordedAt`. |
| Serve/generation events (`ServeEvent`) | **90 days** | MongoDB TTL index on `servedAt`. |
| Refresh tokens (`RefreshToken`) | Until expiry | TTL index on `expiresAt`. |
| Account + profile/history | Until the user deletes the account (or requests erasure) | Server-first hard delete across every user-owned collection. |

## Your rights — export & erasure (GDPR Art. 15/17/20)

- **Export:** `GET /api/auth/account/export` returns the caller's own data as JSON (portability). In-app entry point on the account/data screen.
- **Erasure:** in-app **Delete account** performs a server-first hard delete across every user-owned collection (`backend/app/services/privacy/erasure.js`); also `scripts/gdpr-delete.js`.
- **Per-wearable erasure & Garmin deregistration:** disconnecting a wearable erases exactly that provider's biometric/medical footprint (`services/privacy/wearableErasure.js`); on Garmin disconnect the app also **deregisters** with Garmin so Garmin stops pushing data and drops our access (gated behind `GARMIN_DEREGISTER_ENABLED` until Garmin Health API approval is live).
- **Withdraw consent / stop collection:** disconnect the wearable (above) or use "mood only" — the app functions without any biometric input.

## Apple App Store — Privacy Nutrition Labels

- **Data Used to Track You:** *None.* (No ad networks, no cross-app tracking, no IDFA.)
- **Data Linked to You** (identifiable, used for **App Functionality** only — not tracking, not advertising):
  - Contact Info → **Email Address** (account).
  - Health & Fitness → **Health** (HR/HRV/sleep, and SpO₂/respiration when supplied by Garmin/Apple Health) and **Fitness** (activity/resting HR) — core feature.
  - User Content → **Other User Content** (music/taste profile, playlist history).
  - Identifiers → **User ID** (SSO subject).
  - Usage Data → **Product Interaction** (generation/serve events, for anti-repetition + history).
- **Data Not Linked to You:** none declared (everything is account-scoped).
- **Sign in with Apple** offered alongside Google (App Store §4.8 requirement on iOS). Apple **private-relay** email is honored — a relay address is accepted as the account email.
- Health data is **never** used for advertising, shared with third parties, used to build cross-app profiles (App Store Health data rules), or sent to any LLM/AI. Deleting the account erases it (see **Your rights** above).

## Google Play — Data Safety Form

- **Data collected & shared:** Collected: yes. **Shared with third parties: No.** (OAuth tokens go only to the respective provider APIs Spotify/YouTube/Garmin **at the user's direction** to deliver the feature — declared as "Data is not shared" per Play's definition, since it is not transferred to *other* parties for their own use.)
- **Categories collected:**
  - Personal info → **Email address**, **Name** (optional). Purpose: Account management. Linked to user. Optional/required: required (email).
  - **Health and fitness** → HR/HRV/sleep/activity. Purpose: App functionality. Linked to user. **Optional** (app works "mood only" without a wearable — the "Try with mood only" path).
  - App activity → **Other user-generated content** (music/taste profile, playlist history) + **Other actions** (generation events). Purpose: App functionality + personalization.
  - Device/other IDs → **User payment info:** none. **Device or other IDs:** push token (App functionality — messaging).
- **Security practices:**
  - **Data is encrypted in transit** (HTTPS/TLS): yes.
  - **Data is encrypted at rest:** yes — OAuth tokens and biometrics are AES-256-GCM field-level encrypted ([ADR 0005](adr/0005-zero-knowledge-biometrics.md)).
  - **Users can request data deletion:** yes — in-app **Delete account** (Profile → two-step confirm) performs a server-first hard delete across every user-owned collection; also `scripts/gdpr-delete.js`. A deletion URL will be provided for the Play listing.
  - **Committed to Play Families / independent security review:** N/A (not a Families app).
- **Health Connect (Android):** permissions are read-only and **scope-minimized** to exactly what a shipped feature reads — `READ_HEART_RATE`, `READ_HEART_RATE_VARIABILITY`, `READ_SLEEP`, `READ_RESTING_HEART_RATE`, plus `READ_HEALTH_DATA_HISTORY` (needed for the ~6-month backfill beyond the 30-day cap). **No** `READ_OXYGEN_SATURATION`, `READ_RESPIRATORY_RATE`, or `READ_HEALTH_DATA_IN_BACKGROUND` — those had no reader and were removed (all reads are foreground). Health Connect data is used **solely** for on-device→server biometric-adaptive generation, never shared, never used for ads, and never sent to any LLM — stated in the Health Connect data-use disclosure and the in-app rationale screen (`PermissionsRationaleActivity`).

## Cross-store consistency checklist (for Wave 3)
- [ ] Privacy policy URL live on the retained Vercel domain (survives Web Sunset).
- [ ] Account-deletion URL/flow documented for both stores (in-app + web).
- [ ] Data-export path (`GET /api/auth/account/export`) surfaced in-app + noted in the policy.
- [ ] Health-data-use disclosure copy matches this inventory exactly (Apple Health + Health Connect).
- [ ] "No third-party sharing / no ads / no tracking" asserted identically on both stores.
- [ ] Re-verify inventory after 2.5 (Web Sunset) removes web-only surfaces.
