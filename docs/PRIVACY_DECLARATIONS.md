# Kokonada — Store Privacy Declarations (DRAFT)

> **Status:** Draft for Wave 2.3 (A12) → consumed by Wave 3 store submission. Derived from the
> actual collected fields (`backend/app/models/User.js`) and the GDPR erasure inventory
> (`backend/app/services/privacy/erasure.js`). Revisit after Web Sunset (2.5) and the
> entitlements scaffold (2.2) land, in case the surface changes. Ground truth for the security
> posture: [ADR 0005 — zero-knowledge biometrics](adr/0005-zero-knowledge-biometrics.md).

## Data inventory (what the app actually stores)

| Data | Where | Purpose | Notes |
| :--- | :--- | :--- | :--- |
| Email address | `User.email` | Account identity (required) | From SSO (Google/Apple) or password signup. Apple may supply a **private relay** address. |
| Name / avatar | `User.displayName`, `avatarUrl` | Profile display | Optional; Apple sends name only on first grant. |
| SSO identifier | `User.ssoProvider`+`ssoId`, `Identity` | Authentication | Account keyed by (provider, ssoId); **not** auto-linked across providers by email. |
| 3rd-party OAuth tokens (Spotify, YouTube Music, wearable) | `User.spotifyToken` / `youtubeMusicToken` / `wearableToken` | Music sourcing + biometrics ingest | **AES-256-GCM encrypted at rest** (`encryptedTokenSchema`). |
| Health & fitness (HR, HRV, sleep, resting HR, SpO₂, respiratory rate) | `BiometricLog`, `MedicalProfile` | Core feature: biometric-adaptive playlist generation | Field-level encrypted per ADR 0005; ingested from Garmin / Health Connect / watch. |
| Music profile & listening-derived taste | `MusicProfile` | Personalised generation | Derived from the user's own Spotify/YouTube history. |
| Playlist history & serve events | `PlaylistSession`, `ServeEvent`, `UnclassifiedTrack` | History screen, anti-repetition | User-scoped. |
| Push tokens | `User.pushTokens` | Notifications (mobile) | Per device (ios/android/web). |
| Watch device token (hash) | `User.watchToken.hash` | Sideloaded watch HR streaming | Only a hash is stored; the `whr_` secret is shown once, never persisted in clear. |
| Entitlement tier | `User.entitlements` | Free-tier state (RevenueCat) | App is 100% free ([ADR 0001](adr/0001-100-percent-free-app.md)); no purchase/financial data collected. |

**Not collected:** precise location, contacts, browsing history, advertising identifiers, financial/payment info. **No third-party advertising or analytics SDKs; no data sold or shared for ads.**

## Apple App Store — Privacy Nutrition Labels

- **Data Used to Track You:** *None.* (No ad networks, no cross-app tracking, no IDFA.)
- **Data Linked to You** (identifiable, used for **App Functionality** only — not tracking, not advertising):
  - Contact Info → **Email Address** (account).
  - Health & Fitness → **Health** (HR/HRV/sleep/SpO₂/respiratory) and **Fitness** (activity/resting HR) — core feature.
  - User Content → **Other User Content** (music/taste profile, playlist history).
  - Identifiers → **User ID** (SSO subject).
  - Usage Data → **Product Interaction** (generation/serve events, for anti-repetition + history).
- **Data Not Linked to You:** none declared (everything is account-scoped).
- **Sign in with Apple** offered alongside Google (App Store §4.8 requirement on iOS). Apple **private-relay** email is honored — a relay address is accepted as the account email.
- Health data is **never** used for advertising, shared with third parties, or used to build cross-app profiles (App Store Health data rules). Deleting the account erases it (see below).

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
- **Health Connect (Android):** permissions are read-only (`READ_HEART_RATE`, `READ_HRV`, `READ_SLEEP`, `READ_RESTING_HEART_RATE`, `READ_OXYGEN_SATURATION`, `READ_RESPIRATORY_RATE`, history + background). Health Connect data is used **solely** for on-device→server biometric-adaptive generation and is never shared or used for ads — must be stated in the Health Connect data-use disclosure and the in-app rationale screen (`PermissionsRationaleActivity`).

## Cross-store consistency checklist (for Wave 3)
- [ ] Privacy policy URL live on the retained Vercel domain (survives Web Sunset).
- [ ] Account-deletion URL/flow documented for both stores (in-app + web).
- [ ] Health-data-use disclosure copy matches this inventory exactly (Apple Health + Health Connect).
- [ ] "No third-party sharing / no ads / no tracking" asserted identically on both stores.
- [ ] Re-verify inventory after 2.5 (Web Sunset) removes web-only surfaces.
