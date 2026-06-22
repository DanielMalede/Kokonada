# Kokonada — OAuth Authentication Troubleshooting Report

**Scope:** Production login failures (Vercel frontend ↔ Railway backend) for
Google and Facebook. **Date:** 2026-06-22. **Decision:** Facebook Login dropped
(see §Recommendation). Remediation status is tracked in the final section.

---

## 0. Architectural reframing (read this first)

The original symptom report assumes a **server-side OAuth redirect / authorization-code
flow** with `/auth/google/callback` routes. **That is not how login works here.**

Login is a **client-side SDK → backend-verify → backend-JWT** flow:

| Step | Where | Code |
|------|-------|------|
| 1. Load provider JS SDK in the browser | Frontend | `LoginPage.tsx` `useEffect` |
| 2. SDK mints a token in-browser (Google `credential`, FB `accessToken`) | Browser | provider SDK |
| 3. `POST` token to `/api/auth/{provider}` | Frontend → Backend | `LoginPage.tsx` |
| 4. Backend verifies token with provider, issues **its own** JWT | Backend | `authController.js` |

**Implications:**

- **"Valid OAuth Redirect URIs" / "Authorized redirect URIs" do NOT apply to login.**
- What applies to login is **Google → Authorized JavaScript origins** and
  **Facebook → App Domains + "Allowed Domains for the JavaScript SDK".**
- `GOOGLE_CALLBACK_URL` / `FACEBOOK_CALLBACK_URL` were **vestigial and unused** (now removed).
- Redirect URIs *do* apply to the separate **integrations** subsystem
  (Spotify / YouTube / Garmin → `GET /api/integrations/{provider}/callback`). That
  is unrelated to login.

---

## 1. Provider configuration & credentials

### Google

| ID | Finding | Severity |
|----|---------|----------|
| **F-G1** | `VITE_GOOGLE_CLIENT_ID` is baked at **build time**. Local `frontend/.env` held the literal placeholder `your_google_client_id_here`. If Vercel's Production env var is unset/placeholder, the bundle ships an invalid `client_id` → GSI init rejects it → button silently no-ops. | **Critical** |
| **F-G2** | The production Vercel origin must be in **Authorized JavaScript origins** (exact `scheme://host[:port]`, no path, no trailing slash, no wildcard, no IP). Missing → `[GSI_LOGGER]: The given origin is not allowed for the given client ID` (silent). | **Critical** |
| **F-G3** | Backend `verifyIdToken({ audience: GOOGLE_CLIENT_ID })` requires the frontend and backend client IDs to be **identical**. Mismatch → `Wrong recipient, payload audience != requiredAudience`. | High |

### Facebook (now removed — see §Recommendation)

| ID | Finding | Severity |
|----|---------|----------|
| **F-FB1** | `VITE_FACEBOOK_APP_ID` was entirely absent from `frontend/.env`; `FB.init({ appId: undefined })` initializes a broken SDK. | Critical |
| **F-FB2** | App must be in **Live mode**; in Development mode only listed testers can authenticate — everyone else blocked. | Critical |
| **F-FB3** | Production Vercel domain must be in **App Domains** + **"Allowed Domains for the JavaScript SDK"** (exact match). | High |
| **F-FB4** | `email` requires Meta **Advanced Access** (app review). Without it Graph omits `email`, so `verifyFacebookToken` returns `email:''`, and `User.email: required:true` throws a Mongoose `ValidationError` on create → **every non-approved user fails**. | Critical |

### Backend environment (Railway)

| ID | Finding | Severity |
|----|---------|----------|
| **F-E1** | `FRONTEND_URL` must equal the **exact** Vercel production origin (no trailing slash). It gates both CORS and the CSRF Origin guard — a mismatch → `403 Cross-site request blocked` / CORS failure on the login POST. | **Critical** |
| **F-E2** | `NODE_ENV=production` must be set, else the auth cookie downgrades to `SameSite=Lax; insecure` and is dropped cross-site. *Mitigated* by the localStorage Bearer fallback, so not a hard login blocker. | Medium |
| **F-E3** | Check `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` for trailing spaces / name typos. Local secrets are gitignored and **untracked** (no VCS leak); rotation precautionary-only. | Low |

---

## 2. Frontend flow & UI event handling

| ID | Finding | Severity |
|----|---------|----------|
| **F-UI1** | `handleGoogleClick` used `google.accounts.id.prompt()` — **One Tap**, which is silently suppressed under common conditions (FedCM, third-party-cookie blocking, prior-dismissal cooldown). When suppressed the callback never fires → **dead button**. No `notification` callback was used to detect it. | **Critical** |
| **F-UI2** | Both handlers used `catch {}` with **no `console.error`**, and `if (!res.ok) throw new Error('auth failed')` **discarded the backend's JSON error body** — collapsing every real cause into a generic message. | **Critical** |
| **F-UI3** | SDK `<script>` tags had `onload` but **no `onerror`** — an ad-blocker/network failure left buttons permanently disabled with no explanation. | High |
| **F-UI4** | `FB.login` uses a popup (blockable) with no redirect fallback. | Medium |
| **F-UI5** | CORS is fail-closed/single-origin (correct), but Vercel **preview deployments** get unique URLs ≠ `FRONTEND_URL`, so login from any preview is blocked by both CORS and CSRF. Only the exact production domain works. | Medium |

---

## 3. Backend flow, token exchange & session

| ID | Finding | Severity |
|----|---------|----------|
| **F-BE1** | `POST /api/auth/*` passes through the CSRF Origin guard first; a wrong `FRONTEND_URL` → `403` **before** the controller runs (same root as F-E1). | High |
| **F-BE2** | `SameSite=None; Secure` in prod is correct; depends on F-E2. Bearer fallback keeps login working if the cookie is dropped. | Low |
| **F-BE3** | Accounts keyed by unique `(ssoProvider, ssoId)`; `email` index is non-unique → no E11000 on duplicate-email-across-providers (intentional, audit F15). But the `email: required:true` + provider-omitted-email crash (F-FB4) applied to any provider that may omit email. | High |

---

## 4. Advanced test cases & threat model

- **Case A — corrupted state / CSRF:** Login uses no OAuth `state` param (client-side
  SDK), so there is no provider state to corrupt. The real CSRF surface is the Origin
  guard: a forged `Origin` → `403 Cross-site request blocked`. Google GSI callback
  mode does not use the `g_csrf_token` double-submit cookie (that's redirect-mode only).
- **Case B — SDK/network failure (ad-blocker):** Previously a dead, unexplained
  disabled button. **Fixed:** `onerror` now surfaces a "disable ad-blocker" message.
- **Case C — user cancels consent:**
  - Google One Tap dismiss → previously nothing happened. The rendered-button flow now
    always shows the account chooser; backend `access_denied`-class errors surface.
  - Facebook cancel → was handled (now removed with Facebook).
  - Apple cancel → now distinguished as "Apple sign-in cancelled."

---

## 🎯 Verdict — where the connection drops (production, ranked)

1. **Vercel build-time env** (`VITE_GOOGLE_CLIENT_ID`) unset/placeholder, or set
   without a redeploy → invalid `client_id` → GSI silently fails. **[F-G1]**
2. **Google Cloud Console** — production Vercel origin missing from Authorized
   JavaScript origins. **[F-G2]**
3. **Railway `FRONTEND_URL`** ≠ exact Vercel origin → CORS + CSRF `403`. **[F-E1, F-BE1]**
4. **Code-level error swallowing** hid all of the above. **[F-UI1, F-UI2, F-UI3]**

(Facebook **[F-FB1–4]** was an independent, structurally-broken provider — removed.)

---

## 💬 Recommendation — Facebook Login

**Dropped.** Rationale: leaving Development mode + Meta app review for `email`
**Advanced Access** is slow/friction-heavy for a biometric/health-adjacent app;
until then F-FB4 makes it structurally broken; and it is the lowest-value provider
for a music app. **Google (primary) + Apple (App Store)** cover the audience. Re-add
later if real demand appears.

---

## ✅ Remediation status

**Code (this branch) — applied:**
- **[A]** Errors surfaced: `console.error` + backend `{error}` body parsed and shown;
  SDK `onerror` fallback messages; Google One Tap `prompt()` replaced with the
  official **rendered button**; Apple cancel distinguished. → `frontend/src/pages/LoginPage.tsx`
- **[C]** `handleSso` now returns a clean **422 JSON** when a provider omits the
  required email (no more 500 crash); vestigial `*_CALLBACK_URL` removed.
  → `backend/app/controllers/authController.js`, `backend/.env(.example)`
- **[D]** Facebook fully removed: SDK/button/handler, `/api/auth/facebook` route,
  `facebookAuth`/`verifyFacebookToken`, `User.ssoProvider` enum, CSP entries, env vars.
- **[E]** Local `frontend/.env` Google client ID corrected for dev.

**Manual — action required by you (Step B):**
1. **Vercel → Settings → Environment Variables (Production):** set
   `VITE_GOOGLE_CLIENT_ID` (must equal Railway `GOOGLE_CLIENT_ID`) and
   `VITE_BACKEND_URL` = your Railway HTTPS URL → **redeploy** (Vite bakes at build).
2. **Google Cloud Console → Credentials → OAuth client → Authorized JavaScript
   origins:** add your exact Vercel production origin (e.g. `https://<app>.vercel.app`
   and any custom domain). No path, no trailing slash.
3. **Railway:** `FRONTEND_URL` = exact Vercel origin (no trailing slash);
   `NODE_ENV=production`.

## Verification

- `cd frontend && npm run build` then grep `dist/` for the real client ID (proves the
  var baked in, not the placeholder).
- DevTools Console: no `[GSI_LOGGER]` origin/client-ID errors; Network:
  `POST /api/auth/google` shows real status + body.
- `curl -i` the backend with the correct `Origin` and an empty body → expect
  `400 {"error":"idToken is required"}` (route reachable, CORS+CSRF pass); with a
  wrong `Origin` → `403 Cross-site request blocked`.
- Complete a real Google login on production → redirect to `/integrations`.
