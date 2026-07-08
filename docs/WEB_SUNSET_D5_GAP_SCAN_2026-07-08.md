# Wave 2.5 "Web Sunset" — D5 Gap Scan (2026-07-08)

> Read-only pre-work for the Wave 2.5 Web Sunset (blueprint 2.5). Deletes `frontend/`
> (React web app), keeps `watch/` (Garmin Connect IQ) and the Vercel domain for OG/AASA.
> Scanned the main worktree; nothing modified. **Correction to the original premise:** the
> Spotify/YouTube/Garmin OAuth bridge lives **entirely in the backend**, redirecting through
> the Railway domain back into `kokonada://` — no `frontend/` file is in that path.

## Executive summary
Deleting `frontend/` is almost entirely safe — mobile is a native REST + Socket.IO client and
the OAuth bridge is backend-only. **Two blockers before deletion:**

1. **`WatchTokenCard` — MUST MIGRATE FIRST.** `frontend/src/components/WatchTokenCard/WatchTokenCard.tsx`
   is the only UI that mints **and displays a copyable** `whr_…` device token
   (`POST /api/integrations/watch/token`) for the sideloaded Garmin watch, plus Regenerate /
   Disconnect / live-status polling. Mobile mints the same token in
   `mobile/KokonadaHealth/src/health/liveHrClient.ts` for its own BLE path but **never surfaces
   it for copy/paste**. Delete the web app and there is no way for a user to provision the watch.
   → Port the mint/copy/revoke UX into mobile (Profile/Integrations "Privacy Vault" screen is
   the natural home — folds into Wave 2.8) **before** `frontend/` is removed.
2. **`FRONTEND_URL` — MUST KEEP SET.** `backend/app/index.js:43-48` hard-`throw`s at startup in
   production if unset (also used by `middleware/csrf.js:26`, `sockets/index.js:18`,
   `controllers/integrationsController.js:27` `frontendRedirect` for `returnTo=web` only). Point
   it at the retained Vercel domain — do not unset it.

**No AASA / assetlinks / `.well-known` exist anywhere in the repo today** — nothing deep-link
related needs preserving. Deep-linking uses the custom `kokonada://` scheme via backend
redirect. If HTTPS universal links are ever wanted, those files must be newly authored.

## Safe to delete (native equivalents exist in `mobile/KokonadaHealth/src/experience/*`, `auth/*`)
- Pages: Welcome, Login, App/dashboard, NowPlaying, PlaylistHistory, UserProfile, Integrations
  (minus the watch-token portion), Settings (folded into ProfileScreen — verify).
- **Dead / web-only:** `DiscoverPage.tsx` (stub "coming soon"), `YoutubeCallbackPage.tsx`
  (client-side GIS postmessage landing; `YOUTUBE_REDIRECT_URI` points at the backend, not this
  page), `components/ActivityPanel/*`, `components/LivePlayer/*` + `hooks/useSpotifyPlayer.ts` +
  `services/spotifyPlayer*` (**Spotify Web Playback SDK**, browser-only — mobile uses native
  `spotifyRemoteAdapter.ts`), and all web chrome (`AppShell`, `BottomNav`, `DesktopSidebar`,
  `NowPlayingBar`, `OfflineBanner`, `components/ui/*`, `EmotionCircle/Aura`, `HRZoneBar`, etc.).
- `PlaylistDetailPage.tsx` (`/history/:id`): no distinct mobile detail screen — verify it's
  merged into `HistoryScreen`, low value.

## Must keep (not part of `frontend/`, already survives)
- OAuth → `kokonada://` bridge: `backend/app/controllers/integrationsController.js`
  (`oauthRedirect`/`_returnTarget`/`frontendRedirect`), `backend/app/routes/integrations.js`
  (`/spotify|youtube|garmin/callback` above `router.use(auth)`; identity from signed `state`),
  env `APP_DEEPLINK_SCHEME`/`MOBILE_DEEP_LINK`.
- A stripped `frontend/` **or** a tiny static replacement so Vercel still serves `index.html`
  OG/meta tags + `vercel.json` security headers. Optionally add real `.well-known` AASA/assetlinks
  here for universal links.

## Watch coupling (docs/UX only — code is clean)
`watch/` code references **no** `frontend/` URL — `HrStreamer.mc` POSTs
`{backendUrl}/api/integrations/watch/hr` with `Bearer whr_…`, both from Connect IQ app settings.
The watch's "live session" requirement (backend `user:{id}` Socket.IO room, HTTP 409 otherwise)
is satisfied by the **mobile** socket (`socketFactory.ts`), so the real-time HR→playlist loop
survives. **Must update (docs/strings):** `watch/README.md`, `watch/docs/pre-sideload-checklist.md`,
and `HrStreamer.mc` status strings ("Set up watch card in the web app", "Open Kokonada in
browser") once the token UI moves to mobile.

## Verdict table
| Item | Verdict |
| :--- | :--- |
| `frontend/src` pages/components (dashboard, now-playing, history, profile, login, welcome) | **Safe to delete** |
| DiscoverPage/YoutubeCallback/ActivityPanel/LivePlayer/Web Playback SDK | **Safe to delete** (dead / web-only) |
| **WatchTokenCard mint+copy UI** | **MUST MIGRATE FIRST** → mobile |
| OAuth→`kokonada://` bridge (backend) | **Keep** (already survives) |
| `FRONTEND_URL` env | **Keep set** (startup guard) → point at Vercel domain |
| `frontend/vercel.json` + `index.html` OG + `public/*` icons | **Keep or replace** (retain domain for OG) |
| AASA / assetlinks / `.well-known` | **N/A — none exist**; author only if universal links wanted |
| Watch docs/status strings referencing the web app | **Must update** (docs/UX) after token UI moves |

**Bottom line:** delete `frontend/src` freely once (1) `WatchTokenCard` mint/copy/revoke is ported
to mobile, (2) `FRONTEND_URL` stays configured, (3) a minimal static `frontend/` (or replacement)
keeps serving OG tags on the Vercel domain, and (4) the watch docs/status strings are refreshed.
