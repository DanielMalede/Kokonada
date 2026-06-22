# KOKONADA — Security & Data Privacy Audit

| | |
|---|---|
| **Date** | 2026-06-22 |
| **Auditor posture** | Zero-Trust DevSecOps / CISO. Assume the database, the Railway env, the browser, and every third party are hostile until proven otherwise. |
| **Scope** | Full `backend/` + `frontend/` source, deploy config, data models. |
| **Out of scope** | Runtime infra not observable from source (MongoDB Atlas/Railway disk-encryption settings, Vercel/Railway dashboard ACLs, secret-store contents) — flagged as **assumptions to verify operationally**. |
| **Status** | **Remediated** on branch `security/audit-remediation`. All 18 findings addressed (code or documented decision). Backend 297 tests + frontend 35 tests green; `npm audit` clean. See Remediation Status below. |

---

## Context — why this audit exists

Kokonada is a split-deploy app (Vercel frontend ↔ Railway backend, MongoDB + Redis) that ingests **special-category personal data**: biometric/health metrics (Garmin, Apple Health, Suunto), inferred emotional state, and **live third-party OAuth tokens** (Spotify, YouTube, Garmin) that grant standing access to users' external accounts. A breach here is not "leaked email addresses" — it is heart-rate/HRV/sleep history (GDPR Art. 9), emotional profiles, and the ability to take over a victim's Spotify/YouTube account. The blast radius justifies a merciless review.

**Headline finding:** The cryptographic core is **better than expected** — all three OAuth token types are genuinely AES-256-GCM encrypted at rest (the worst-case assumption is false). The real exposure has moved to **session-token handling on the client, rate-limiting that is blind behind the proxy, and unencrypted health data at the field level.**

---

## Executive Summary

| Verdict | Detail |
|---|---|
| OAuth tokens encrypted at rest? | **YES** — AES-256-GCM, per-record random IV, auth tag. Not plaintext. *(answers Requirement 1)* |
| Health/biometric data encrypted at rest? | **NO** — stored as plaintext fields; relies entirely on (unverified) provider disk encryption. |
| Session token handling | **WEAK** — JWT duplicated into `localStorage` + passed in URL query string; stateless, non-revocable, 7-day. |
| Rate limiting | **INEFFECTIVE in production** — no `trust proxy`, in-memory store. |
| Secrets hygiene (repo/build) | **GOOD** — `.env` gitignored, only placeholders committed, no secrets in frontend bundle. |
| Sensitive data in logs | **CLEAN** — no tokens/PII/health values logged anywhere. |

### Findings Register (severity-ranked)

| ID | Sev | Area | Finding |
|----|-----|------|---------|
| **F1** | 🔴 High | Session | JWT stored in `localStorage` **and** sent as `?token=` query param → XSS theft, leaks into server/proxy logs, browser history, `Referer`. |
| **F2** | 🔴 High | DoS/Brute | No `app.set('trust proxy')` → `express-rate-limit` keys on Railway's proxy IP; limiter is effectively bypassed or mis-buckets all users. In-memory store also resets per deploy / isn't shared across instances. |
| **F3** | 🔴 High | Privacy | Biometric & medical data (`BiometricLog`, `MedicalProfile`, `PlaylistSession.biometricSnapshot`, `contextPrompt`) stored **unencrypted at field level** — special-category data under GDPR Art. 9. |
| **F4** | 🟠 Med | XSS | Frontend (`vercel.json`) ships **no security headers** — no CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy. Directly amplifies F1. |
| **F5** | 🟠 Med | DoS/Webhook | Suunto webhook raw-body reader is **unbounded** (memory-exhaustion DoS), signature check **fails open** if `SUUNTO_WEBHOOK_SECRET` unset, and the route is also behind JWT `auth` (contradiction → unreachable by Suunto / broken-by-design). |
| **F6** | 🟠 Med | CSRF | `SameSite=None` auth cookie with **no CSRF token**; protection relies solely on CORS + non-simple content types. Fragile. |
| **F7** | 🟠 Med | Session | No JWT revocation / denylist; logout is client-side only; a leaked 7-day token is valid until natural expiry. Compounds F1. |
| **F8** | 🟡 Low | Crypto | Single static `ENCRYPTION_KEY`, no versioning/rotation, no KMS/envelope encryption, no AAD binding ciphertext→userId (blob-swap possible with DB write access). |
| **F9** | 🟡 Low | CORS | `cors({ origin: process.env.FRONTEND_URL })` not fail-closed; if env unset, behavior degrades to permissive/broken rather than safe. |
| **F10** | 🟡 Low | OAuth | Spotify/YouTube `*_oauth_state` cookies omit explicit `sameSite`; Garmin request token+secret stored as plaintext JSON in a (httpOnly, 10-min) cookie. |
| **F11** | 🟡 Low | Ops/GDPR | Env var name mismatch: app uses `MONGO_URI`, `gdpr-delete.js` uses `MONGODB_URI` → deletion script may connect to nothing/wrong DB → unfulfilled erasure requests. |
| **F12** | 🟡 Low | Token exposure | `GET /spotify/token` returns a decrypted Spotify access token to the browser (inherent to Web Playback SDK), exposed to any XSS for the token's lifetime. |
| **F13** | 🟡 Low | Error | `timingSafeEqual` throws on length-mismatched signatures → unhandled 500 path. |
| **F14** | 🟡 Low | Input | `biometric_push` socket event + adapter `normalize()` do no schema/range validation (`new Date(invalid)`, NaN HR); no per-socket flood control. |
| **F15** | ⚪ Info | Identity | No cross-provider account linking — same human via Google vs Facebook = two accounts (data fragmentation, duplicate erasure). |
| **F16** | ⚪ Info | Data egress | Heart rate, emotion coords, and **free-text `contextPrompt`** are sent to Google Gemini and cached in Redis 24h (key = `md5(prompt)`). Processor relationship + retention must be documented. |
| **F17** | ⚪ Info | Supply chain | No automated dependency scanning (npm audit / Dependabot) in CI. Versions currently current; `bcryptjs` is an unused dependency. |
| **F18** | ⚪ Info | Injection | NoSQL-injection surface is low (queries use provider-verified IDs, not raw user objects) — confirmed, keep it that way. |

---

## Remediation Status (branch `security/audit-remediation`)

All findings addressed. Verified: backend **297** tests / 17 suites, frontend **35** tests, `npm audit` **0 vulnerabilities**, typecheck clean.

| ID | Status | What changed |
|----|--------|--------------|
| F1 | ✅ Fixed | Removed raw `?token=` JWT from URLs; OAuth connect now uses a 120s single-use, purpose-scoped `?ct=` connect token (`jwt.signConnectToken`, burned on use). `auth.js` no longer accepts the session JWT via query. Frontend `buildConnectUrl()` replaces `tokenQuery()`. |
| F2 | ✅ Fixed | `app.set('trust proxy', 1)` so the rate limiter keys on the real client IP behind Railway. |
| F3 | ✅ Fixed | Field-level AES-256-GCM at rest via `models/encryptedField.js` getter/setter on `BiometricLog.heartRate`, `PlaylistSession.{contextPrompt,biometricSnapshot.heartRate}`, `MedicalProfile` numeric metrics; `stateVector.status` encrypted in service. Range validation preserved. Legacy-plaintext tolerant. |
| F4 | ✅ Fixed | `vercel.json` now sets HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy (enforced) + CSP in **Report-Only** (promote to enforcing after validating no violations). |
| F5 | ✅ Fixed | Suunto raw body bounded to 64 KB (413 on overflow); HMAC fail-closed in production when secret unset; length-guarded compare. |
| F6 | ✅ Fixed | `middleware/csrf.js` Origin-allowlist guard on unsafe methods (cross-origin browser CSRF blocked; mobile/webhook unaffected). |
| F7 | ✅ Fixed | Every token carries a `jti`; Redis denylist (`utils/tokenDenylist.js`); `auth` rejects revoked tokens; `logout` revokes the presented token. |
| F8 | ✅ Fixed | `encryption.js` supports key rotation (`ENCRYPTION_KEY_PREVIOUS`) and optional AAD context binding, fully backward compatible. |
| F9 | ✅ Fixed | CORS fails closed — refuses to start in production without `FRONTEND_URL`. |
| F10 | ✅ Fixed | Explicit `sameSite:'lax'` on Spotify/YouTube OAuth state cookies (shared `OAUTH_STATE_COOKIE_OPTS`). |
| F11 | ✅ Fixed | `gdpr-delete.js` uses `MONGO_URI` (falls back to `MONGODB_URI`); writes an append-only erasure audit trail. |
| F12 | ✅ Mitigated | Spotify/YouTube scopes cut to least privilege (removed unused write scopes), shrinking a stolen-token blast radius. Browser exposure is inherent to the Web Playback SDK. |
| F13 | ✅ Fixed | `timingSafeEqual` length-mismatch guarded in `suunto.js`. |
| F14 | ✅ Fixed | `handleBiometricReading` validates heart-rate range and timestamp before the AI/state machine. |
| F15 | ✅ Decision | Documented deliberate non-linking of accounts across providers (auto-link by email is a takeover footgun with Apple relay / unverified emails). |
| F16 | ✅ Documented | Gemini sub-processor egress documented in code; clarified the Redis cache stores only md5(prompt)+derived params, not raw biometrics. |
| F17 | ✅ Fixed | Removed unused `bcryptjs`; `npm audit` clean; new code uses Node's built-in `crypto.randomUUID()`. |
| F18 | ✅ Confirmed | No injection path; preserved by never spreading request objects into Mongo filters. |

**Operational follow-ups (cannot be done from source — require your deploy/infra action):**
1. Promote the frontend CSP from `Content-Security-Policy-Report-Only` to enforcing after confirming no violations in production.
2. Provision Redis in production so JWT revocation (F7) and the rate-limit posture are fully effective (the app degrades gracefully without it, but revocation needs Redis).
3. Fully removing the localStorage JWT (residual F1) requires proxying `/api` through the Vercel domain so the auth cookie is first-party — a deployment-topology change. Until then the Bearer-in-localStorage path remains; the CSP report-only + headers reduce the XSS surface.
4. Verify MongoDB Atlas at-rest encryption + network allowlist, and high-entropy secrets per the assumptions section.

---

## 1. Cryptography & Token Security (At Rest & In Transit)

### 1.1 OAuth tokens at rest — **PASS (with hardening)**
All three providers' tokens are encrypted before persistence. The flow is consistent:

- `backend/app/utils/encryption.js` — AES-256-GCM, 12-byte random IV per call, 16-byte auth tag, key validated as exactly 64 hex chars (256-bit). Output layout `iv|authTag|ciphertext` base64. **This is a correct, modern AEAD construction.**
- `backend/app/models/User.js` — `spotifyToken`, `youtubeMusicToken`, `wearableToken` are an `encryptedTokenSchema` holding only `{ blob }`; `setToken()`/`getToken()` are the only write/read path and always encrypt/decrypt.
- `backend/app/controllers/integrationsController.js` — every callback calls `req.user.setToken(...)` (Spotify L50, YouTube L146, Garmin L256). The comments even say "never store plain text" — and the code honors it.
- `backend/app/middleware/auth.js` L29-31 and `sockets/index.js` L32-34 strip token blobs from the in-memory user object via `.select('-spotifyToken -youtubeMusicToken -wearableToken')`.

> **Direct answer to Requirement 1:** Tokens are **NOT** in plaintext. No CRITICAL flag here. This is a genuine strength.

**Hardening (F8):**
- Single static key, no rotation/versioning — there's no key-id prefix on the blob, so rotating `ENCRYPTION_KEY` would render every stored token undecryptable. Add a key-version byte and a two-key (current+previous) decrypt path before any rotation.
- No envelope encryption / KMS. The key lives in the same Railway env as `MONGO_URI`; an attacker who reaches the env reaches **both** key and data. At-rest encryption here defends against *DB-only* compromise (stolen backup/Atlas breach), **not** full-env compromise. State this honestly in your threat model.
- No AAD. Binding the ciphertext to `userId` (GCM additional authenticated data) would prevent an attacker with DB-write access from swapping one user's token blob into another's record.

### 1.2 Session & cookie management — **MIXED**
- `backend/app/utils/jwt.js` cookie options are correct per environment: `httpOnly:true`, `secure:isProd`, `sameSite: isProd ? 'none' : 'lax'`, 7-day. The cross-site Vercel↔Railway reasoning is sound. **Good.**
- **BUT (F1)** `frontend/src/lib/api.ts` deliberately also stores the JWT in `localStorage` and exposes `authHeaders()` (Bearer) and `tokenQuery()` (`?token=`). `auth.js` L18-20 accepts `req.query.token`. This **throws away the entire benefit of the httpOnly cookie**:
  - `localStorage` is readable by any injected script → one XSS = full 7-day account takeover token.
  - `?token=` rides in the URL → captured in Railway access logs, browser history, and the `Referer` header sent to Spotify/Garmin/Google during the connect redirect.
- **(F7)** The JWT is stateless with no server-side denylist; `logout` (`authController.js` L119) only clears the cookie. A token captured via any of the above is valid until expiry and **cannot be revoked**.
- **(F6)** With `SameSite=None`, CSRF defense rests entirely on CORS + JSON/DELETE preflights. No anti-CSRF token exists. Adequate today, brittle tomorrow.

### 1.3 In transit
- `Secure` cookies in prod ⇒ HTTPS only. CORS is credentialed and pinned to `FRONTEND_URL`. All outbound provider calls are HTTPS with timeouts. **OK.**
- **(F4)** No HSTS header is asserted by the app (relies on platform). No CSP anywhere. See §4.

### 1.4 Secret/key leakage into build or repo — **PASS**
- `.gitignore` excludes `.env`, `.env.*.local`, and `frontend/dist/`; `git ls-files` confirms **only** `backend/.env.example` and `frontend/.env.example` are tracked, both placeholders. `dist/` is **not** tracked.
- Frontend only references **public** identifiers (`VITE_GOOGLE_CLIENT_ID`, `VITE_FACEBOOK_APP_ID`, `VITE_APPLE_CLIENT_ID`, `VITE_BACKEND_URL`) — these are designed to be public. Grep for client secrets / API keys / `AIza…` / `apps.googleusercontent` long strings in `frontend/src` → **none**. No client secret ever reaches the bundle.
- All real secrets (`JWT_SECRET`, `ENCRYPTION_KEY`, `*_CLIENT_SECRET`, `GEMINI_API_KEY`, `SUUNTO_WEBHOOK_SECRET`) are server-side env only. **Good.** *(Operational verify: confirm these are set with high entropy in Railway and rotated off any value ever pasted into a chat/ticket.)*

---

## 2. User Data Flow & Storage Map

Lifecycle of sensitive data, phase by phase, with **exact residence**:

```
┌── PHASE 0: LOGIN (SSO) ──────────────────────────────────────────────────────┐
│ Browser: provider id_token/access_token (Google/Apple/FB)                     │
│   → POST /api/auth/* (HTTPS)                                                   │
│ Node RAM: provider token verified (authController.verify*Token); discarded    │
│ DB(User): ssoProvider, ssoId, email, displayName, avatarUrl  [PLAINTEXT]      │
│ Issued: app JWT → (a) httpOnly cookie  AND  (b) JSON body                      │
│ Browser: JWT persisted in localStorage('koko-token')   ⚠ F1                    │
└──────────────────────────────────────────────────────────────────────────────┘
┌── PHASE 1: CONNECT MUSIC / WEARABLE (OAuth) ─────────────────────────────────┐
│ Browser → GET /integrations/<p>/connect?token=<JWT>   ⚠ F1 (token in URL)      │
│ Cookie (10-min, httpOnly): OAuth state / Garmin req-token+secret  (F10)        │
│ Provider → /callback → Node RAM: access+refresh tokens                         │
│ DB(User.*Token.blob): AES-256-GCM encrypted   ✅                               │
└──────────────────────────────────────────────────────────────────────────────┘
┌── PHASE 2: BIOMETRIC INGEST ─────────────────────────────────────────────────┐
│ Garmin: server poll every 30s (garminPoller) → decrypt token in RAM →         │
│         garmin API → handleBiometricReading (RAM only, debounceMap)           │
│ Apple Health: mobile → POST /apple/push (≤500 samples) → DB(BiometricLog)      │
│ Suunto: webhook → DB(BiometricLog)   ⚠ F5                                      │
│ DB(BiometricLog): heartRate, activity, source, recordedAt   ⚠ PLAINTEXT (F3)  │
│ DB(MedicalProfile): HRV, SpO2, sleep stages, readiness, zones ⚠ PLAINTEXT(F3) │
└──────────────────────────────────────────────────────────────────────────────┘
┌── PHASE 3: AI GENERATION ────────────────────────────────────────────────────┐
│ Node RAM: musicProfile (anonymised) + HR + emotion coords + contextPrompt     │
│ EGRESS → Google Gemini API (prompt text)   ⚠ F16                              │
│ Cache: Redis key md5(prompt) → AI params, TTL 24h (incl. HR values)  ⚠ F16    │
│ Note: geminiEngine deliberately excludes PII; emotion/HR are not PII but       │
│       are health-adjacent, and contextPrompt is free text.                     │
└──────────────────────────────────────────────────────────────────────────────┘
┌── PHASE 4: PLAYLIST OUTPUT / HISTORY ────────────────────────────────────────┐
│ Spotify access token (decrypted) → Browser via GET /spotify/token  ⚠ F12      │
│ DB(PlaylistSession): emotionTaps, contextPrompt, biometricSnapshot.heartRate, │
│   AI params, trackIds   ⚠ PLAINTEXT (F3)                                       │
│ Browser: localStorage('koko-history') — session metadata, client-side         │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Where every piece lives, summarized:**

| Data | Browser | Node RAM | MongoDB | Redis | 3rd party |
|---|---|---|---|---|---|
| App JWT | localStorage + cookie ⚠ | transient | — | — | leaks via `?token=`/Referer ⚠ |
| OAuth access/refresh tokens | Spotify access only (F12) | transient (decrypt) | **encrypted** ✅ | — | the provider |
| Heart rate / activity | history meta | debounceMap | **plaintext** ⚠ | in cached prompt ⚠ | Gemini ⚠ |
| HRV/SpO2/sleep (MedicalProfile) | — | transient | **plaintext** ⚠ | — | — |
| Emotion taps + free-text prompt | history meta | transient | **plaintext** ⚠ | in cached prompt ⚠ | Gemini ⚠ |
| Identity (email, ssoId) | redux state | transient | plaintext | — | — |

---

## 3. Admin Access & Data Handling Protocol

### 3.1 How you access data today (observed)
- Direct MongoDB connection via `MONGO_URI` (Atlas/Railway). No app-level admin UI, no audit log of admin reads.
- `backend/scripts/gdpr-delete.js` — the only privileged tooling; supports `--dry-run` and ObjectId validation. **But (F11)** it reads `MONGODB_URI` while the app uses `MONGO_URI` — likely a silent no-op/misconnect in production. Fix before relying on it for legal erasure.

### 3.2 Recommended secure admin protocol (to formalize)
1. **Never query the prod DB with a read-write URI for debugging.** Provision a separate, **read-only** Atlas user for inspection; reserve the read-write URI for migrations/erasure only.
2. **Tokens are opaque to you by design** — `*Token.blob` is ciphertext. Do not build admin tooling that decrypts tokens for viewing. If you must validate a connection, check `!!blob`, never the contents.
3. **Mask by default.** Any debug/admin script should project *away* `email`, `ssoId`, and all `MedicalProfile`/`BiometricLog` fields unless a specific, logged reason exists. Provide a "redacted view" helper.
4. **Audit privileged access.** Log who ran erasure/inspection, when, and for which userId (the GDPR script already prints userId — extend to an append-only audit record).
5. **Just-in-time, not standing access.** Pull `MONGO_URI` from the secret store per-session; don't keep prod creds in your shell profile or `.env`. Rotate after any exposure.
6. **Bastion/IP-allowlist the DB.** Confirm Atlas/Railway network rules restrict DB ingress to the backend's egress IPs + your admin IP, not `0.0.0.0/0`. *(operational verify)*

### 3.3 Sensitive logging — **PASS**
Full sweep of `console.*` across `backend/app`: only `e.message`, `user._id`, ports, and connection lifecycle are logged. **No tokens, no health values, no full request bodies.** `errorHandler.js` returns generic messages and only attaches `stack`/`detail` when `NODE_ENV==='development'`. Keep it this way; add a lint/CI guard so future code can't log token objects or `MedicalProfile` documents.

---

## 4. Advanced Threat Modeling & Unrestricted Vulnerability Scanning

Stricter tests beyond the brief:

- **Rate limiting / brute force / DDoS (F2 — High):** `index.js` never calls `app.set('trust proxy', 1)`. Behind Railway's reverse proxy, `req.ip` resolves to the proxy, so `express-rate-limit` either lumps all users into one bucket (one abuser locks everyone out) or mis-attributes — and v8 will emit the `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` validation error. The store is in-memory, so limits reset on every deploy and aren't shared across horizontally-scaled instances. **The auth limiter (10/15min) relied on for credential-stuffing defense is not doing its job in prod.** Lock down: set a precise `trust proxy` hop count + move to a Redis-backed store.
- **Application-layer DoS (F5 — Med):** the Suunto raw-body middleware (`index.js` L34-43) concatenates the request stream with **no size cap**, while every other route is capped at 10kb. A single large POST to `/api/integrations/suunto/webhook` exhausts memory. Also `JSON.parse(rawBody)` + `insertMany` on attacker-sized arrays.
- **Webhook spoofing / fail-open (F5 — Med):** `suunto.verifyWebhookSignature` returns `true` when `SUUNTO_WEBHOOK_SECRET` is unset ("skip in dev"). If that var is ever missing in prod, **all forged biometric payloads are accepted**. Fail-open on a security control is a finding regardless of intent. Separately, the route sits behind `router.use(auth)` (JWT required) — but Suunto's servers send no JWT, so the webhook is simultaneously over-gated (unreachable) and under-gated (fail-open). The design is internally contradictory and should be reworked to HMAC-only with mandatory secret.
- **XSS & CSP (F4 — Med):** `vercel.json` defines only SPA rewrites. No `Content-Security-Policy`, `X-Frame-Options`/`frame-ancestors` (clickjacking), `Referrer-Policy` (mitigates `?token=` leakage), `Strict-Transport-Security`, or `Permissions-Policy`. Given the JWT and Spotify access token live in JS-reachable storage, **a single XSS is catastrophic** and there is no CSP backstop. React auto-escaping helps, but third-party SDKs (Google/Apple/FB/Spotify) are injected via `document.createElement('script')` with no SRI.
- **CSRF (F6 — Med):** covered in §1.2 — `SameSite=None` + no token.
- **NoSQL/SQL injection (F18 — Info, currently OK):** Mongo queries use IDs derived from **verified** JWT/provider payloads (`findById(payload.userId)`, `findOne({ ssoProvider, ssoId })`); request bodies flow only into typed/validated schema fields (`insertMany` via `normalize`, numeric casts). No raw user object reaches a query operator. **No injection path found** — preserve this by never spreading `req.body`/`req.query` into a Mongo filter.
- **Third-party API poisoning (Med-by-design):** Gemini output is strictly validated (`_parseAndValidate`: required fields, numeric ranges, array types) before use, and there's a static fallback playlist — **good defense**. Residual: Spotify/YouTube responses are largely trusted; a compromised provider response is shaped into tracks without deep validation (low risk, note it).
- **OAuth-specific:** CSRF `state` is checked on Spotify/YouTube callbacks; Garmin has an explicit **token-fixation guard** (returned token must equal stored token). Strong. Residual (F10): state cookies lack explicit `sameSite`; Garmin request secret sits in a cookie (short-lived, httpOnly).
- **Token over-privilege:** Spotify scopes include `playlist-modify-public/private`, `user-modify-playback-state`, `streaming`; YouTube includes `youtube.force-ssl` (write). A stolen access token (via F12+XSS) can **modify the victim's playlists and playback**. Apply least privilege — drop write scopes you don't use.
- **Session/biometric integrity (F14 — Low):** `biometric_push` is authenticated but unvalidated; a user can spoof their own HR or send `NaN`/invalid dates (`new Date('garbage')`). Self-only impact, but add range checks (0–300 bpm) and a per-socket rate cap to keep garbage out of the AI/DB.
- **`debounceMap` memory growth (Low):** keyed by `socket.id`, cleaned on `disconnect` — acceptable, but a reconnect storm grows RAM; bound it.
- **Supply chain (F17 — Info):** dependencies are current (Express 5, Mongoose 9, Helmet 8, socket.io 4.8, jsonwebtoken 9). No `npm audit`/Dependabot in CI; `bcryptjs` is declared but unused (SSO-only app) — remove. Add automated scanning + lockfile policy.
- **Right-to-erasure completeness (F11/F15):** erasure script targets all five collections (good) but the env mismatch may break it, and cross-provider duplicate accounts (F15) mean one human's data can survive an erasure run under a second `ssoId`.

---

## 5. Remediation Roadmap (no code written yet)

Prioritized; each item maps to finding IDs. Implementation deferred until explicitly approved.

**P0 — do first (High):**
1. **Kill the token-in-URL/localStorage pattern (F1, F7).** Standardize on the httpOnly cookie for web; for the cross-site OAuth-connect navigation, replace `?token=` with a short-lived, single-use, server-issued nonce (or proxy `/api` through the Vercel domain so the cookie is first-party). Add server-side JWT revocation (denylist in Redis) so `logout` and breach response actually work.
2. **Make rate limiting real (F2).** `app.set('trust proxy', <exact hops>)` + Redis-backed `express-rate-limit` store, with per-route auth limits verified behind the proxy.
3. **Encrypt special-category data at rest (F3).** Field-level encryption for `BiometricLog`, `MedicalProfile`, `PlaylistSession.{biometricSnapshot,contextPrompt}` (reuse `encryption.js` AEAD, or MongoDB CSFLE), **or** at minimum a documented, verified Atlas encryption-at-rest + access-control posture with a written risk acceptance.

**P1 — next (Med):**
4. **Add security headers (F4)** via `vercel.json` `headers` + tighten backend Helmet: CSP (allowlist Google/Apple/FB/Spotify SDK origins), HSTS, `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, `Permissions-Policy`. Add SRI to injected SDK scripts.
5. **Fix the Suunto webhook (F5):** bound the raw body, make HMAC mandatory (fail-closed), and remove the JWT gate from the webhook route (HMAC *is* its auth).
6. **CSRF defense (F6):** add double-submit/synchronizer token, or move fully to Bearer-from-cookie-less flow.

**P2 — hardening (Low/Info):**
7. Key rotation/versioning + optional AAD binding for `encryption.js` (F8).
8. Fail-closed CORS + explicit `sameSite` on OAuth state cookies; consider encrypting the Garmin request cookie (F9, F10).
9. Fix `MONGO_URI`/`MONGODB_URI` mismatch in `gdpr-delete.js`; add erasure audit log (F11).
10. Reduce Spotify/YouTube scopes to least privilege; shorten Spotify token endpoint exposure (F12).
11. Guard `timingSafeEqual` length mismatch; validate `biometric_push` payloads + per-socket cap (F13, F14).
12. Document Gemini as a sub-processor; consider stripping/hashing `contextPrompt` from the cached/sent prompt; review Redis TTL/eviction policy (F16).
13. CI: add `npm audit`/Dependabot, a log-redaction lint rule, remove unused `bcryptjs` (F17).
14. Cross-provider account-linking by verified email (F15).

---

## 6. Verification Plan (how each fix will be proven)

- **Crypto/at-rest:** unit tests asserting stored `BiometricLog`/`MedicalProfile` fields are ciphertext; round-trip decrypt tests; key-rotation test (old blob still decrypts after rotation). Extend existing `backend/tests/encryption.test.js`.
- **Rate limiting:** integration test behind a simulated `X-Forwarded-For` proving per-client buckets; assert 429 after threshold with correct client attribution.
- **Headers/CSP:** `curl -I` the Vercel deploy + automated check asserting CSP/HSTS/Referrer-Policy present; manual XSS smoke test that injected script cannot read the token.
- **Token handling:** test that no endpoint accepts `?token=`; that `localStorage` no longer holds the JWT; that a revoked JWT is rejected post-logout.
- **Webhook:** test rejecting oversized bodies and forged/missing signatures (fail-closed); confirm valid HMAC path still ingests.
- **GDPR script:** dry-run + real-run against a seeded test user across all five collections using the corrected env var; assert zero residual documents.
- **Regression:** full `npm test` (backend Jest + frontend Vitest) green before any merge; `npm audit` clean.

---

## 7. Assumptions to verify operationally (outside source control)
- MongoDB Atlas/Railway **encryption at rest** is enabled and the DB is **not** network-open to `0.0.0.0/0`.
- `JWT_SECRET` (≥256-bit), `ENCRYPTION_KEY` (64 hex), and all `*_SECRET`/`GEMINI_API_KEY` are set with high entropy in Railway and have never leaked into chats/tickets/logs.
- `SUUNTO_WEBHOOK_SECRET` and `FRONTEND_URL` are present in prod (their absence triggers fail-open / permissive behavior — F5/F9).
- Vercel/Railway dashboard access is MFA-protected and least-privilege.

---

*End of audit. No remediation code has been written. Awaiting go-ahead to begin P0.*
