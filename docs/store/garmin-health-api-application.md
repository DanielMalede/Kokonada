# Garmin Connect Developer Program — Health API access request (draft)

Submit at the Garmin Developer Portal (developerportal.garmin.com). Replace every **[BRACKET]**
placeholder. This app uses **OAuth 2.0 + PKCE** (Garmin's current standard; OAuth 1.0a deprecated).

## 1. Company / applicant
- **Company / legal entity:** [LEGAL ENTITY NAME] — required; Garmin does not grant Health API access to individuals.
- **Website:** [https://your-domain]
- **Primary contact:** Daniel Malede — danielmalede@gmail.com
- **Country:** [COUNTRY]

## 2. Product summary
**Kokonada** is a music app that adapts what you listen to based on your physiology. It builds a
private, encrypted **wellness/medical profile** (resting HR, HRV, sleep stages, Body Battery,
respiration, SpO₂) from the user's Garmin history and uses it — together with real-time heart rate —
to personalize and react music selection to the user's current state (e.g. recovery vs. peak effort).

- **Platforms:** Web app (primary UI) + a sideloaded Garmin Connect IQ watch app (real-time HR only).
- **Why the Health API:** the watch app provides only live HR; the Health API provides the
  **historical baselines and sleep/recovery metrics** the profile needs. We are replacing an OS
  health-aggregator bridge with direct, server-to-server Health API access to reduce user friction
  (no extra phone app).

## 3. Integration type
- **Health API** (consumer wellness data), **server-to-server**.
- **OAuth 2.0 with PKCE** (S256). Authorization: `https://connect.garmin.com/oauth2Confirm`;
  token: `https://diauth.garmin.com/di-oauth2-service/oauth/token`.
- **Delivery:** **Ping/Push** (preferred) to our webhook + **Backfill** for initial ~6-month history.
- **Consumer key/secret:** [EXISTING — confirm which app/client]. Redirect URI: `[https://api-domain]/api/integrations/garmin/callback`.

## 4. Data types requested (read-only)
| Summary | Purpose in Kokonada |
|---|---|
| **Sleeps** (stages: deep/light/REM) | Sleep & recovery pillar of the medical profile |
| **Dailies** (resting HR, HR samples) | Resting-HR baseline + HR history |
| **HRV** | Cardiovascular/recovery baseline |
| **Stress Details / Body Battery** | Recovery/energy state for music adaptation |
| **Respiration** | Respiratory baseline |
| **Pulse Ox (SpO₂)** | Respiratory baseline (supported devices) |

No write access requested. No activity/GPS route data required for the MVP.

## 5. Webhook (Push) endpoint
- **URL:** `https://[API-DOMAIN]/api/integrations/garmin/webhook?secret=[GARMIN_WEBHOOK_SECRET]`
- Accepts Garmin's summary-type JSON arrays; maps each `userId` to our account and ingests.
- Returns `200` on receipt. Hardened: unguessable secret, payload size cap, ignores unknown users.

## 6. Data handling & privacy (Garmin reviews this)
- **Encryption at rest:** all biometric values (HR, HRV, sleep, Body Battery, etc.) stored
  **AES-256-GCM encrypted** (field-level); OAuth tokens encrypted the same way. Keys never in DB.
- **In transit:** HTTPS only.
- **Minimization:** only the summary types above; read-only; no resale or advertising use.
- **Retention & deletion:** per-user **GDPR soft-delete**; disconnect revokes tokens and stops ingest.
  User can delete their account/data on request.
- **Access:** data used solely to power the user's own in-app experience.
- **Privacy policy:** [https://your-domain/privacy]

## 7. Expected volume
- [N] users at launch; one ~6-month backfill per user at connect, then incremental pushes.

---
### Notes for us (not part of the submission)
- Approval = business review (often a few days) **plus** a whitelist propagation (~5–7 business days)
  before production data flows. Sandbox/eval may be available sooner for testing.
- After approval: register the webhook URL + enable the data types + Push + Backfill in the portal,
  set `GARMIN_REDIRECT_URI`, `GARMIN_WEBHOOK_SECRET`, and confirm `GARMIN_CONSUMER_KEY/SECRET` are the
  OAuth2 client credentials.
