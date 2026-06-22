# Production OAuth Config — Railway + Provider Consoles

Paste-ready values to make **login** and **integrations connect** (Spotify / YouTube /
Garmin) work in production.

| Role | URL |
|------|-----|
| Frontend (Vercel) | `https://kokonada-frontend.vercel.app` |
| Backend (Railway) | `https://kokonada-backend-production.up.railway.app` |

> The redirect URI the backend sends to each provider **is** the value of the
> corresponding `*_REDIRECT_URI` env var. The provider console must contain that
> **exact** string (scheme + host + path, no trailing slash). A single character of
> mismatch → `redirect_uri_mismatch` / `INVALID_CLIENT`.

---

## 1. Railway — backend service → Variables

Set / verify these (the app reads them at runtime; Railway redeploys on change):

```
NODE_ENV=production
FRONTEND_URL=https://kokonada-frontend.vercel.app

# Spotify (client id/secret already in your backend/.env — copy them here)
SPOTIFY_CLIENT_ID=<copy from backend/.env>
SPOTIFY_CLIENT_SECRET=<copy from backend/.env>
SPOTIFY_REDIRECT_URI=https://kokonada-backend-production.up.railway.app/api/integrations/spotify/callback

# YouTube — the code auto-falls-back to GOOGLE_CLIENT_ID/SECRET (the login client),
# so YOUTUBE_CLIENT_ID/SECRET are OPTIONAL. At minimum set YOUTUBE_REDIRECT_URI and
# make sure a client secret exists on Railway (GOOGLE_CLIENT_SECRET works — note the
# GSI login flow does NOT need the secret, so it may not be set yet).
YOUTUBE_REDIRECT_URI=https://kokonada-backend-production.up.railway.app/api/integrations/youtube/callback
GOOGLE_CLIENT_SECRET=<copy from backend/.env — required for the YouTube token exchange>
```

- `FRONTEND_URL` must be the **exact** Vercel origin (no trailing slash) — the public
  callbacks redirect the browser back to `${FRONTEND_URL}/integrations?...`, and it also
  gates CORS + the CSRF origin guard.
- Do **not** paste secrets into chat/tickets; copy them from `backend/.env`.

---

## 2. Spotify Developer Dashboard
`developer.spotify.com/dashboard` → your app → **Settings** → **Redirect URIs** → Add:

```
https://kokonada-backend-production.up.railway.app/api/integrations/spotify/callback
http://localhost:5000/api/integrations/spotify/callback   ← keep for local dev
```
Save. (No scope/app-review needed — scopes are least-privilege and requested at runtime.)

---

## 3. Google Cloud Console — YouTube (reuse the login OAuth client)
APIs & Services → **Credentials** → open the existing **OAuth 2.0 Client** (the
`225621926146-…` one login already uses):

1. **Authorized redirect URIs** → Add:
   ```
   https://kokonada-backend-production.up.railway.app/api/integrations/youtube/callback
   http://localhost:5000/api/integrations/youtube/callback   ← keep for local dev
   ```
2. **Authorized JavaScript origins** → make sure these exist (for GSI login):
   ```
   https://kokonada-frontend.vercel.app
   http://localhost:5173
   ```
3. APIs & Services → **Enabled APIs** → enable **YouTube Data API v3** for this project.
4. Copy the client **secret** from this client into Railway `YOUTUBE_CLIENT_SECRET`
   (it's the same value as `GOOGLE_CLIENT_SECRET`).

> Why reuse works: one OAuth client supports both the browser GSI login flow
> (JavaScript origins) and the server-side YouTube code exchange (redirect URIs).
> No need for a second client.

---

## 4. Garmin (optional, lower priority)
Garmin uses OAuth 1.0a and is **not yet credentialed** (`GARMIN_CONSUMER_KEY` /
`GARMIN_CONSUMER_SECRET` are empty). It requires Garmin Developer Program approval,
then set those two vars on Railway and register the callback
`https://kokonada-backend-production.up.railway.app/api/integrations/garmin/callback`
in the Garmin portal. Skip until Spotify + YouTube are confirmed working.

---

## 5. Verify (after setting the above + redeploy)
1. Log in → **Integrations** → click **Connect Spotify**.
   - Browser goes to Spotify consent → back to `…/api/integrations/spotify/callback`
     → redirects to `https://kokonada-frontend.vercel.app/integrations?music=spotify`.
   - On error you'll see a toast (e.g. "That connection link expired") and the URL
     carries `?error=spotify_*` — read the code to pinpoint the misconfig.
2. Repeat for **Connect YouTube** (`?music=youtube`).
3. Quick backend reachability check:
   ```
   curl -i "https://kokonada-backend-production.up.railway.app/api/integrations/spotify/callback"
   ```
   Expect a `302` redirect to the frontend with `?error=spotify_state` (no valid state) —
   that proves the **public callback route is live** (not 401/404).
