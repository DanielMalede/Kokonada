# DEV ITEM — Playback position and seek, so the Now Playing scrubber is a real control

**Raised:** 2026-08-26, from the screen-08 (Now Playing) design review.
**Routing:** `developer` under TDD → `resilience-auditor` → `compliance-auditor`.
**Status:** not started.

---

## Why this exists

Daniel's screen-08 decision draws a **draggable scrubber** on Now Playing. The client cannot currently perform that action, and cannot even display the position it would scrub through. Same shape as the email sign-in item: the design is chosen, the code catches up.

## What exists today

| Piece | State |
|---|---|
| `positionMs`, `durationMs` from the Spotify App Remote | **Arrive**, via `onRemoteState` → `playbackServices.ts:49` → `orchestrator.syncToRemote(...)` |
| Where they are used | **Only** `playbackOrchestrator.isTrackFinished()` (`:342`), for end-of-track detection |
| `nowPlayingStore` | `{ track, isPlaying }` — no position, no duration |
| `spotifyRemoteAdapter` | `connect`, `disconnect`, `playUri`, `playContext`, `skipToIndex`, `skipNext`, `skipPrevious`, `pause`, `resume`, `getPlayerState`, `getTrackImage` |
| Seek | **No such method anywhere.** |

So there are two separate gaps, and they are not the same size.

## Scope

### A · Position display — plumbing, not new capability
1. Extend `nowPlayingStore` with `positionMs` and `durationMs` (nullable), fed from the same `syncToRemote` path that already receives them. Do **not** add a second subscription; the data is already flowing.
2. Both values must survive a `null`/`undefined`/non-finite remote payload without rendering `NaN:NaN` — the existing `isTrackFinished` guards show the shape to follow.
3. The remote emits on its own cadence, not per frame. The store must not become a per-frame write; throttle or accept the remote's rate.

### B · Seek — genuinely new capability
4. Add `seek(positionMs)` to `SpotifyRemoteLike` and implement it on `spotifyRemoteAdapter` (`SpotifyRemote.seek`). It is not in the interface today, so the type change will surface every call site.
5. Wire the Now Playing slider: drag updates a local value, release commits one `seek`. Never emit a seek per drag frame.
6. Clamp the target to `[0, durationMs]`. A seek past the end must not race `isTrackFinished()` into a false end-of-track.
7. **Tests first** — extend `experience/playback/__tests__`. Cover: seek clamping, drag-then-release emits exactly one call, a lost/rejected seek leaves the store consistent, and a null-position payload renders no time text.

### C · Accessibility
8. The slider carries `role="slider"` with `aria-valuemin`/`max`/`now` and a spoken `aria-valuetext` (the board models this). Those values must be **real** once the store is plumbed — the same rule applied to the Genesis meter: never announce a position the system does not have.

## Risk flag — read before shipping the screen

**Shipping Now Playing ahead of this puts a dead control in front of users**, and a scrubber is worse than a dead button: it invites a drag and then does nothing, which reads as the app being broken rather than the feature being absent. Either this lands first, or the screen ships with the bar as read-only (position only, no thumb) until seek exists.

If only part A lands, the honest interim is a **read-only progress bar with no thumb** — that is a real reading of real data and affords nothing it cannot do.

## Related

- Screen 08 review: `docs/review/08-now-playing.html`
- `docs/plans/DEV_EMAIL_SIGNIN_PATH.md` — same pattern: design chosen ahead of the code, with the same shipping rule.
