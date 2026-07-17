# Kokonada — Google Play Health Connect Declaration + Data Safety (copy-paste draft)

> **What this is:** ready-to-paste text for the Google Play Console **Health apps declaration
> form** and the **Data Safety** section, for the Android app that reads Health Connect data.
> This is a drafting aid — Daniel files it in the portal (Pause & Guide). Grounded in the
> actual permissions declared in
> `mobile/KokonadaHealth/android/app/src/main/AndroidManifest.xml`.
>
> **Single source of truth:** the wording here MUST match, verbatim in substance, (1) the
> published privacy policy, (2) the in-app permission-rationale screen
> (`PermissionsRationaleActivity` / `ViewPermissionUsageActivity`), and (3) the new consent
> screen (`docs/SCREENS.md` §11). Any drift between them is a rejection risk. <!-- verified rationale wiring: mobile/KokonadaHealth/android/app/src/main/AndroidManifest.xml:70-95 -->
>
> **Do not submit until:** the Groq DPA is executed + Zero-Data-Retention enabled (see the
> "Shared: No" caveat), and the consent screen + server consent gate are live.

## 0. App summary (for the declaration intro)

Kokonada generates music that continuously adapts to the listener's real-time physiological
and emotional state ("your body and mind → music"). It reads a small set of Health Connect
biometric signals to steer the tempo, energy, and mood of the soundtrack it generates. Health
data is transmitted to Kokonada's own backend (encrypted in transit and at rest) where it is
reduced to an **abstract physiological intensity band**; raw biometric values are never sent
to any advertiser, and never sent to the third-party inference provider. <!-- verified: backend/app/services/geminiEngine.js:231-239,296-299 -->

## 1. Health Connect data types read — and why (one line each)

All are **read-only**, requested in the **foreground only**, and **scope-minimized**: only
record types with a real reader in the shipped feature are requested (PR #152, T3 — SpO₂,
respiratory rate, and background access were dropped after confirming zero readers anywhere
in the app). <!-- verified permission set: mobile/KokonadaHealth/src/health/permissions.ts; mobile/KokonadaHealth/android/app/src/main/AndroidManifest.xml:6-14 -->

| Health Connect permission | Data type | Why the app needs it (user benefit) |
| :--- | :--- | :--- |
| `READ_HEART_RATE` | Heart rate | Primary live signal: current physiological intensity drives the tempo/energy of the generated music in real time. |
| `READ_HEART_RATE_VARIABILITY` | Heart rate variability | Autonomic recovery/stress signal: distinguishes "stressed/energized" from "recovered/calm" so the soundtrack matches state, not just pace. |
| `READ_SLEEP` | Sleep sessions | Recovery/readiness context: calibrates morning and wind-down music to how the user actually slept. |
| `READ_RESTING_HEART_RATE` | Resting heart rate | Personal baseline: lets the app read a live heart rate as "elevated *for this user*" instead of against a population average. |

**Common purpose statement (reuse verbatim):** "Kokonada reads this data solely to generate
and continuously re-tune music that matches your current physiological and emotional state.
The data is used for no other purpose, is never used for advertising, and is never sold or
shared with third parties for their own use."

## 2. Special permission — `READ_HEALTH_DATA_IN_BACKGROUND` — NOT REQUESTED

Kokonada does **not** request background Health Connect access. Every read happens while the
app is in the foreground (the on-demand backfill and the live-poll fallback only run while a
screen is mounted); the scope was confirmed to have zero readers and was removed rather than
requested-and-unused (PR #152, T3). No background-read justification or demo video is needed
for this declaration. <!-- verified: mobile/KokonadaHealth/src/health/permissions.ts (comment: "background-read scope intentionally NOT requested"); mobile/KokonadaHealth/android/app/src/main/AndroidManifest.xml:6-14 -->

**Separate live-HR lane (not Health Connect, flag honestly if asked):** the app also reads
live heart rate over Bluetooth LE from a paired Garmin "Broadcast Heart Rate" device
(`BLUETOOTH_SCAN`/`BLUETOOTH_CONNECT`, not a Health Connect scope), including a periodic
foreground/background HTTP push from the watch companion. This lane is now **also** gated
behind the same GDPR Art.9 consent record as the Health Connect paths (server-side, on the
device token's resolved user) — H-9 is fully closed, see `docs/PRIVACY_DECLARATIONS.md`'s
GDPR Art.9 section. It remains outside the scope of *this* Health Connect declaration (it is
not a Health Connect permission), but is consent-gated identically.

## 3. Special permission — `READ_HEALTH_DATA_HISTORY` (historic / >30-day reads)

**Justification (paste into the form):**

> On first connect (and periodic re-baselining), Kokonada reads up to ~6 months of historical
> heart rate, HRV, resting heart rate, and sleep to compute a **personal physiological
> baseline** — the user's typical resting ranges, characteristic HRV, and sleep patterns. This
> calibration is what lets the app interpret a live reading as elevated, recovered, or resting
> *relative to that individual*, which materially improves how well the generated music matches
> their state. Historic access is used for one-time baseline establishment plus occasional
> re-baselining — not continuous bulk history retrieval. <!-- verified backfill use case: backend/app/routes/integrations.js:81 (medical-profile backfill) -->

## 4. Data Safety form answers (Android app)

| Field | Answer |
| :--- | :--- |
| Data collected | **Yes.** |
| Data type (health) | **Health and fitness → Health info** (heart rate, HRV) + **Fitness info** (resting heart rate, sleep). SpO₂ and respiratory rate are **not** collected. |
| Other data types collected | Personal info → Email (required), Name (optional); App activity → user-generated music/taste content + in-app actions; Device or other IDs → push token. |
| Data shared with third parties | **No.** Derived, non-identifying tokens are processed by Groq as a service provider under a DPA + Zero-Data-Retention; OAuth calls go to the user's chosen providers at their direction — neither is "sharing" per Google's definition. **This answer is conditional on the Groq DPA being executed + ZDR enabled** (business action — confirm before submission). |
| Is data collection optional? | **Yes** for health/fitness — the app has a "mood only" path that works without any wearable. |
| Encrypted in transit | **Yes** (HTTPS/TLS on every network call). |
| Encrypted at rest | **Yes** — AES-256-GCM field-level encryption of biometric and OAuth fields (ADR 0005). |
| Users can request deletion | **Yes** — in-app **Delete account** (`DELETE /api/auth/account`) hard-deletes all user-owned data (incl. `BiometricLog`, `MedicalProfile`, `ConsentRecord`) + user-scoped Redis, plus a documented deletion URL. <!-- verified: backend/app/controllers/authController.js:220-245; backend/app/services/privacy/erasure.js:33-49 --> |
| Users can access/export their data | **Yes** — authenticated `GET /api/auth/account/export` returns the subject's own records (health decrypted, credentials redacted). <!-- verified: backend/app/services/privacy/userDataExport.js:26-79; backend/app/routes/auth.js:24 --> |
| Purposes | App functionality; Personalization. **Not** advertising, **not** tracking. |
| Third-party SDK collection | None — no ad/analytics SDKs. |

**Related biometric inputs (declare consistently so the form is complete):** heart rate is also
read live over Bluetooth LE from a Garmin "Broadcast Heart Rate" device (`BLUETOOTH_SCAN`
`neverForLocation` / `BLUETOOTH_CONNECT`), feeding the same biometric pipeline. `ACCESS_FINE_LOCATION`
is declared **only on Android ≤11** solely to enable BLE scanning — **no location is read,
stored, or transmitted.** <!-- verified: mobile/KokonadaHealth/android/app/src/main/AndroidManifest.xml:16-23 -->

## 5. In-app rationale copy — single source of truth (requirement, not drafted here)

The permission-rationale screen reached via `PermissionsRationaleActivity` (Android ≤13) and
the `ViewPermissionUsageActivity` alias (Android 14+) MUST state the **same** data types,
purposes, background-read use, history-read use, and "never shared/never for ads" claim as this
declaration **and** the consent screen. <!-- verified: mobile/KokonadaHealth/android/app/src/main/AndroidManifest.xml:70-95 --> Do not author divergent copy in any one of the three places — a mismatch between the declaration, the rationale WebView, and the consent screen is a direct Health Connect rejection/enforcement risk. (Rationale copy itself is drafted with `designer` alongside the consent screen; this document only fixes the requirement.)

## 6. Pre-submission gate

- [ ] Groq DPA executed + ZDR enabled + Groq listed as sub-processor (blocks the "Shared: No" answer).
- [ ] Consent screen live and writing versioned `ConsentRecord`; server `requireConsent` gate confirmed on all user-facing health-ingest routes.
- [ ] Privacy policy URL + account-deletion URL live and consistent with this doc.
- [ ] ~~Demo video~~ — not required (Health Connect background read is not requested; the app is foreground-only). Reassess if the BLE/watch live-HR lane (§2) needs its own disclosure.
- [ ] Rationale WebView copy == this declaration == consent screen (verbatim in substance).
