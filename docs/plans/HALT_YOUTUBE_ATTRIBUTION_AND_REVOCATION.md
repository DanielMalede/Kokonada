# HALT — YouTube: no brand attribution, no token revocation, and we call it the wrong product

**Raised:** 2026-08-26 by `compliance-auditor`. All requirements fetched live that day.
**Severity:** YT-2 and YT-3 are **ban risk on the developer account**, not store-rejection risk.
**Routing:** `developer` under TDD → `compliance-auditor` re-audit. YT-2 needs an official asset file.
**Status:** canvas items fixed 2026-08-26 (marked DONE). Shipped items not started.

---

## YT-1 · The integration is YouTube, not YouTube Music

There **is no YouTube Music API**. `backend/app/services/youtube.js:8` calls `https://www.googleapis.com/youtube/v3` with scope `youtube.readonly`, reading `channels`, `videos?myRating=like`, `playlists`, `playlistItems`, `subscriptions`. That is a **YouTube** account connection.

We labelled it "YouTube Music" on `providers.ts:38` and on four boards. That names a Google product we are not connecting, using a mark the API branding licence does not cover — and whose own brand terms are login-gated, so they could not be read at all.

The Branding Guidelines expressly permit the honest form: *"you may reference the fact that your app is for YouTube or works with YouTube."*

**Canvas: DONE** — `Connect.dc.html`, `Components.dc.html`, `You.dc.html` now say "YouTube".
**Shipped:** relabel `providers.ts:38`. Keep the internal `youtube_music` provider key — it is not user-facing. **Never put "YouTube Music" in store metadata or screenshots** until Google's brand approval is obtained.

## YT-2 · HALT — no YouTube brand attribution on any surface that shows YouTube content

> "Any API Client page or feature that displays YouTube content – including, without limitation, search results, YouTube videos, channels, playlists, thumbnails, and YouTube players – **must make clear to the viewer that YouTube is the source** of the relevant content by displaying YouTube Brand Features…"
> — YouTube API Services Developer Policies **III.F.2.1**

The Branding Guidelines name the right asset for exactly our case: the **YouTube Icon** provides attribution when "your application integrates multiple content sources including YouTube; content is intermingled requiring individual attribution; and space constraints make other logos infeasible." That is the mini player. Also: any YouTube logo "must link back to YouTube content", and "You cannot modify the colors of the YouTube logos or YouTube Icons."

Track title and artist on those rows derive from `snippet.title` and `cleanYouTubeArtist(snippet.channelTitle)` when the source is YouTube. That is YouTube content, displayed unattributed.

**Missing playback-surface attribution is the standard cause of YouTube API access revocation for music clients.** `docs/SCREENS.md:30` still carries "playback-surface Spotify/YouTube attribution" as an open item — and the Components board had codified its absence as a rule.

**Canvas: DONE** — the Components attribution rule now reads: the mark *is* the attribution, each row carries the mark of the service that supplied the track and links back to it, with both an `OFFICIAL SPOTIFY MARK` and an `OFFICIAL YOUTUBE ICON` slot, and "a content row never renders without one."

**Shipped:** add a provider discriminator to the mini-player / Now Playing attribution slot. For YouTube-sourced tracks render the **official YouTube Icon** from Google's asset pack — never redrawn, never recoloured — tappable, linking to `https://www.youtube.com/watch?v=<videoId>`. **NEEDS-ASSET.** Write it into the `docs/SCREENS.md` §7/§9 Definition of Done so no screen can merge without it.

## YT-3 · HALT — disconnect never revokes the token at Google

> Every API Client must provide "a clearly explained and easy way for users to revoke any authorization consent", must **"programmatically revoke that token right away"**, and delete all Authorized Data "within 7 calendar days of the revocation."
> — Developer Policies **III.D.2.3.1**

`backend/app/controllers/integrationsController.js:444-480` nulls `user.youtubeMusicToken` locally and reassigns `musicProvider`. **There is no call to `https://oauth2.googleapis.com/revoke`.**

The data-deletion half is satisfied — the rebuild strips `youtube_music` rows. The **revocation half is not**: the refresh token stays live in the user's Google grant list after they were told they disconnected.

**Fix:** POST the refresh token to `https://oauth2.googleapis.com/revoke` inside `youtubeDisconnect`, before the local purge. Best-effort, logged, never blocking the purge — the same shape already used behind `GARMIN_DEREGISTER_ENABLED`.

## YT-4 · YouTube artist names reach Groq under a consent the user may never have seen

`backend/app/services/musicProfileService.js:660-662` collects artist names for `youtube_music` tracks and passes them to `inferArtistGenres`, which posts them in a plaintext prompt to Groq (US) via `geminiEngine.js:367-375`. Those names are `cleanYouTubeArtist(snippet.channelTitle)` off the user's private liked videos and playlists — **Authorized Data**.

The only place the user is told is `Consent.dc.html` §4 — inside the **GDPR Art. 9 health consent**. A user who connects YouTube and declines health consent never sees that sentence. So there is no "express approval" (III.E.3.2) and no "user's consent" for the transfer (Google API Services User Data Policy, Limited Use — which explicitly extends to "data aggregated, anonymized, or derived from" the scopes).

**Fix, in order of preference:**
1. **Delete the transfer.** We already fetch `topicDetails.topicCategories` (`youtube.js:252-279`) — Wikipedia music-genre URLs, a richer signal than an LLM guess. Derive YouTube genres from those and drop `youtube_music` from `LLM_BACKFILL_PROVIDERS`. One edit removes the III.E.3.2 question, the Limited Use question, and the Groq row from the YouTube story entirely.
2. If it stays: move the disclosure into a pre-OAuth sheet on the **YouTube connect** flow, worded identically to the consent copy, and name it in the privacy policy.
3. Separately audit the Groq prompt cache — `docs/PRIVACY_DECLARATIONS.md:73` says the key is `md5(prompt)` and the value is derived params. That value holds genres derived from YouTube artists, cross-user, with no expiry tied to the YouTube grant. Check against III.E.4.3.

**Worth keeping, and explicitly praised by the auditor:** the containment already built — `backend/app/utils/youtubeContent.js` fails closed on scheme and provider, `monitoring/youtubeLeakMonitor.js` counts leaks non-destructively, and `workers/youtubeRetention.worker.js` enforces the III.E.4.3 30-day ceiling with a correct terminal/transient split. None of it addresses III.E.4.8(ii), which on its face prohibits deriving new data from API Data at all — that clause is read narrowly in practice, but Google's enforcement posture **could not be confirmed → UNVERIFIED.**

## YT-5 · Do not promise a decision we do not control

`providers.ts:40` and the canvas said *"Coming once our Google review is complete."* Three problems: "our Google review" implies a relationship with Google; it treats the mark as a possessive-adjacent noun phrase; and if verification is denied, every shipped build carries a false statement — Apple 2.3.1(a), which names misleading marketing as grounds for **termination of the developer account**.

**Canvas: DONE** — now *"Not available yet — we're finishing the sign-in review."* No provider name, no promise, no date. Survives a denial and survives a reviewer.
**Shipped:** same edit at `providers.ts:40`.

**Stating a pending review is itself permitted** — the auditor searched Google's sensitive-scope verification page specifically and found no rule against it.

**The bigger adjacent problem, not this line's fault:** the Connect truth variant offers **zero** working music connections (Spotify halted, YouTube deferred) with "Continue with mood only" as the CTA. A reviewer sees two dead rows and a bypass — Apple 2.1 App Completeness. Consider hiding the Music card entirely until at least one provider is live. **That is a product decision, not an edit.**

## YT-6 · The Profile disconnect alert misrepresents both providers

`mobile/KokonadaHealth/src/experience/profile/ProfileScreen.tsx:122`:

> `Alert.alert('YouTube disconnected', 'Rebuilt your Spotify library (${res.data.library} tracks).')`

- **Spotify:** this states that Kokonada rebuilt the user's *Spotify* library. It did not — it rebuilt Kokonada's own `MusicProfile` from Spotify. A user reasonably reads it as Kokonada having written to their Spotify account. Spotify Developer Policy I.1.a (*"Don't mislead or confuse users about the ways you intend to use their data"*). It is also gratuitous: Spotify connect is halted for public users, so for most users this names a service they have not connected and reports `0`.
- **YouTube:** pressing "Disconnect" shows a spinner labelled **"Rebuilding…"** (`ProfileScreen.tsx:305`) — describing a side effect on a *different* provider rather than the revocation the user asked for. III.D.2.3.1 requires the revocation be clearly explained. And per YT-3, "Disconnect" currently overstates what happens.

**Fix:** `busyLabel: 'Disconnecting…'`. Alert body: *"Your YouTube account is no longer linked, and the music we imported from it has been deleted."* Say nothing about Spotify. If the rebuilt count should be visible, put it on the Spotify row's own reason line as **Kokonada's** library. **Land YT-3 before the copy claims disconnection.**

## PASS — and the limit on it

The app name is "Kokonada", and `providers.ts:19` carries the invariant *"plain-text service name — NEVER an official colored logo/wordmark"*. That satisfies the rule against using "YouTube" or any variant in the app name, and the no-redrawn-wordmark rule. **Keep that comment.**

**It does not clear YT-2.** Plain text is safe as a *service reference*. It is not a substitute for the Brand Feature attribution III.F.2.1 requires on a surface displaying YouTube content.

## UNVERIFIED — do not record as compliant

- **YouTube Music brand terms** — login-gated at `partnermarketinghub.withgoogle.com`. The public sibling (YouTube Kids) requires the ™ symbol on first appearance in creative and states that any creative referring to the marks "must be reviewed and fully approved by Google's brand approvals team". Store screenshots and listing copy are creative; an in-app functional label arguably is not.
- **III.E.4.8(ii)** as applied to derived taste data (see YT-4).

## Related

- `docs/plans/HALT_SPOTIFY_TRACK_IDS_TO_THIRD_PARTY.md` — the parallel finding on the other music provider.
- `docs/plans/DEV_SPOTIFY_CANVAS_ASSETS.md` — the mark-fidelity work that YT-2's fix shares.
