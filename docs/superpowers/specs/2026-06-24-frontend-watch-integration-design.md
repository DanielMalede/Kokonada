# Frontend Watch HR Integration — Design

**Date:** 2026-06-24
**Status:** Approved (design); ready for implementation planning
**Branch context:** Builds on `feat/watch-hr-ingest-backend` (backend shipped, PR open to `main`)

## Context

We pivoted off the Garmin API. A sideloaded Monkey C watch app POSTs live heart
rate directly to our backend (`POST /api/integrations/watch/hr`) every ~5 minutes,
authenticated by an opaque device token (`whr_…`). The backend is shipped:

- `POST /api/integrations/watch/token` (auth) → `201 { token: "whr_…" }`. Returns the
  plaintext **once**; only the SHA-256 hash is persisted. Re-issuing overwrites the hash,
  which instantly revokes any prior token. Sets `wearableProvider = 'garmin'`.
- `DELETE /api/integrations/watch/token` (auth) → `200 { message: 'Watch disconnected' }`.
  Clears `watchToken` and `wearableProvider`.
- `POST /api/integrations/watch/hr` (public; Bearer device token) → `202 { ok: true }` on
  success, `409 { live: false }` when no browser socket is open, `401` invalid token,
  `400` invalid HR. On success it calls `handleBiometricReading(socket, 'garmin', …,
  { immediate: true })`, which emits `playlist_ready` with `trigger: 'biometric'`
  (a ≥25 bpm delta bypasses the 60s debounce).
- The User model stores `watchToken: { hash, createdAt, lastSeenAt }`. `lastSeenAt` is
  updated on each successful ingest but is **not** exposed by any GET endpoint today.

This phase builds the frontend to support the watch flow. Two components:
1. **Watch Token UI** — generate / copy / revoke the device token + a connection status badge.
2. **"Adjust Upcoming Queue Only" playback** — HR-driven playlists do not interrupt the
   current track; they queue and promote at the next track boundary.

## Decisions (resolved during brainstorming)

1. **Status data source — Hybrid.** Add a small `GET /api/integrations/watch/status`
   endpoint so the badge is accurate on page load (the watch only pings every 5 min, so a
   pure client-side approach could show "Offline" for up to 5 min after a refresh). Live
   socket events then upgrade the badge in real time.
2. **Defer scope — biometric only.** Playlists arriving with `trigger: 'biometric'`
   (i.e. watch HR) become a `pendingPlaylist` and wait for the track boundary.
   `emotion` / explicit user actions replace playback immediately.
3. **UI location — IntegrationsPage.** Replace the now-defunct Garmin OAuth row with the
   watch-token setup (the watch token *is* the biometric connection now).
4. **Boundary swap — track-change detection.** Extend the SDK service to emit the current
   track URI; on the next `player_state_changed` where the URI changed (current track ended,
   Spotify advanced, or user skipped), if a pending playlist exists, promote it and POST
   `/spotify/play` with the pending URIs. Deterministic and unit-testable; accepts a brief
   (<~1s) blip of the old next-track before the swap lands.

## Component 1 — Backend reopen: `GET /api/integrations/watch/status`

Auth-required route registered beside the existing watch-token routes (below `router.use(auth)`):

```js
exports.watchStatus = (req, res) => res.json({
  connected:  !!req.user.watchToken?.hash,
  lastSeenAt: req.user.watchToken?.lastSeenAt ?? null,
});
```

**Tests:** `{connected:false, lastSeenAt:null}` with no token; `{connected:true,
lastSeenAt:<ISO>}` when a token exists; route requires auth (401 unauthenticated).

## Component 2 — Watch Token UI (IntegrationsPage)

**Redux (`integrationsSlice`):**
- `watchToken: string | null` — plaintext, held **in-memory only**, immediately after generation.
- `watchConnected: boolean`, `watchLastSeenAt: string | null`, `watchStatus: 'idle'|'loading'|'error'`.
- Actions: `setWatchToken`, `setWatchConnection({ connected, lastSeenAt })`,
  `markWatchSeen()` (live override → `connected:true`, `lastSeenAt:now`), `clearWatchToken`.
- Selector `selectWatchLiveness(state, now)` → `'connected' | 'offline'` using
  `WATCH_STALE_MS = 6 * 60 * 1000` (5-min cadence + 1-min jitter grace).

**API helpers (`lib/api.ts`):** `issueWatchToken()`, `revokeWatchToken()`, `fetchWatchStatus()`.

**`WatchTokenCard` component** (replaces the defunct Garmin `ServiceRow`):
- **Not connected:** "Set up watch" button → issue → display the `whr_…` token **once** with a
  Copy button and a "Copy this now — it won't be shown again" warning.
- **Connected:** status badge (`Connected` / `Last seen 3m ago` / `Offline`), **Regenerate**
  (re-issue; backend overwrites hash → old token dies), and **Disconnect** (revoke).
- Copy via `navigator.clipboard` + `sonner` toast.

**Wiring:**
- Hydrate on mount: `fetchWatchStatus()` → `setWatchConnection`.
- Live override: in `useSocket`, on `biometric_ack` and biometric-trigger `playlist_ready`,
  dispatch `markWatchSeen()`.
- Badge re-renders on a ~30s interval so "Xm ago" ages and flips to Offline.

**Forced by the backend:** the plaintext token is only returned at issue time, so on reload we
show "connected — regenerate to get a new token," never the old value.

## Component 3 — "Adjust Upcoming Queue Only" playback

**Redux (`playerSlice`):**
- `pendingPlaylist: Track[]` (default `[]`); `sdkCurrentTrackUri: string | null`.
- Actions: `setPendingPlaylist(tracks)` (replaces any existing pending — newest HR wins);
  `promotePendingPlaylist()` (pending → `playlist`, `currentIndex:0`, refill `offlineBuffer`,
  clear pending). `currentTrackUri` folded into `setSdkState`.

**SDK service (`spotifyPlayer.ts`):** in `player_state_changed`, read
`data.track_window.current_track.uri` and emit it via the state callback.

**Routing the incoming playlist (`useSocket` `playlist_ready`):**
- "Actively playing" is defined precisely as `playlist.length > 0 && sdkIsPaused === false`
  (a track is loaded *and* currently playing). Paused or empty counts as "not playing."
- `trigger === 'biometric'` **and** actively playing → `setPendingPlaylist(tracks)`
  (do not touch `playbackMode` or interrupt).
- Otherwise (`emotion`, `skip_loop`, or not actively playing) → `setPlaylist(...)` immediately
  (the biometric-but-nothing-playing case falls through to immediate play).

**Boundary promotion (`usePendingPromotion` hook, mounted in AppShell):** watches
`sdkCurrentTrackUri`; when it **changes** and `pendingPlaylist.length > 0`, dispatch
`promotePendingPlaylist()`. The existing AppShell play effect then sees the new active URIs
and POSTs `/spotify/play`, playing the pending mix from track 1. Guard: only promotes when
pending exists, so the initial play never spuriously promotes.

**"Mix queued" badge:** when `pendingPlaylist.length > 0`, show a non-intrusive
"New heart-rate mix queued — starts after this track" indicator in `LivePlayer` /
`NowPlayingPage`.

## Known limitations (carried forward)

- ~0.5–1s blip of the old next-track before the swap lands (accepted tradeoff).
- Token shown once only (backend design).
- Multi-tab: backend delivers HR to the first socket only; other tabs get the load-time badge
  but no live socket override. Acceptable, documented.

## Test surface (TDD)

- Backend `GET /watch/status` (supertest): connected true/false, auth required.
- `integrationsSlice` watch reducers + `selectWatchLiveness` thresholds.
- `playerSlice` `setPendingPlaylist` / `promotePendingPlaylist` reducers; `sdkCurrentTrackUri`.
- `spotifyPlayer` service emits `currentTrackUri` from `player_state_changed`.
- `useSocket` routing: biometric→pending when playing, immediate when idle; emotion→immediate;
  `markWatchSeen` on biometric events.
- `usePendingPromotion`: uri-change + pending → promote; no-pending → no-op.
- `WatchTokenCard`: generate shows token + copy; connected shows badge + regenerate/revoke;
  copy calls clipboard.
