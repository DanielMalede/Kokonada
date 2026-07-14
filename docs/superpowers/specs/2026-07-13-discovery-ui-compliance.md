# Discovery UI — Compliance Audit Record (pre-build)

> Authored by the `compliance-auditor` agent (read-only + web), 2026-07-13, against CURRENT live
> Spotify text (developer.spotify.com) + current Apple guidelines. This is the gate record; the build
> tasks are gated on the conditions below. Daniel's resolutions (2026-07-13) are recorded at the end.

## Controlling clauses (live text)
- **Design & Branding Guidelines** (developer.spotify.com/documentation/design):
  - Attribution: "You must always attribute content from Spotify with either the Spotify logo or icon."
  - Link-back: "If you use any Spotify metadata (artist, album and track names, album artwork and audio playback) it must always link back to the Spotify Service."
  - Metadata: presented as provided by Spotify, legible, truncation-with-full-view only.
  - Link text: not installed → "GET SPOTIFY FREE"; installed → "OPEN SPOTIFY" / "PLAY ON SPOTIFY" / "LISTEN ON SPOTIFY".
  - Album art: "If screen real estate is limited, it's OK to not include any album artwork." (art optional).
- **Developer Policy** §II: "Do not use the Spotify Platform or any Spotify Content to train a machine learning or AI model or otherwise ingest Spotify Content into a machine learning or AI model." / "Do not analyze the Spotify Content … creating new or derived … functionality … or building profiles of users…" / "must not offer metadata, cover art … as a standalone service" / "Do not create any product … integrated with streams or content from another service."
- **Developer Terms:** attribution via Spotify Marks; "may not store, aggregate or create compilations or databases of Spotify Content, other than as strictly necessary"; "Do not store Spotify Content indefinitely"; delete a user's Spotify Content on logout/inactivity.
- **Apple App Store Review** 5.2.2 (third-party content must be permitted under the service's terms), 5.2.1 (protected marks).

## Verdicts by surface
1. **Up-Next queue sheet → PASS WITH CONDITIONS.** Metadata display allowed; omitting cover art is explicitly compliant. Conditions: **C1** Spotify attribution (logo/icon + "content from Spotify") on the surface (per-screen, not per-row); **C2** a link-back affordance ("OPEN/PLAY/LISTEN ON SPOTIFY", or "GET SPOTIFY FREE" if not installed); **C3** show Spotify-provided, unmodified, legible metadata — for YouTube-origin tracks translated at serve time, display the **Spotify-resolved** title/artist.
2. **"Because you love X" anchor → HALT (on the derivation).** No implied Spotify endorsement (first-party voice, keep attribution visually separate). But the anchor derived by embedding-similarity against a **Spotify-Web-API-sourced** library (`_buildSpotifyProfile`, fanned into the corpus via `corpusIngest.ingestLibrary` → `catalogAndEmbed`) trips Policy §II (ingest/analyze Spotify Content into derived, user-visible functionality; building user profiles). Consequence: access revocation + quota-extension denial. Compliant alternatives: (i) derive/display the anchor **only** from non-Spotify data (YouTube/first-party) and never from a Spotify-sourced anchor; (ii) Spotify written permission; (iii) drop the anchor, keep the neutral "New discovery" pill.
3. **DiscoveryBadge → PASS WITH CONDITION C4:** custom glyph must not resemble the Spotify icon (no three-bar soundwave-in-circle) and must not use Spotify green (#1DB954 / #1ED760). The bioluminescent/`emotionAccent` palette clears this; make it an explicit designer constraint.
4. **Now Playing receipt treatment → PASS WITH CONDITIONS.** Cover art + metadata here come live from App Remote = Spotify Content on screen. There is currently **no attribution, no link-back anywhere in the RN app** (grep-confirmed) — a pre-existing gap. **C1 + C2 apply here too** and are the moment to close it. The anchor line rendered here inherits Surface 2's HALT.
5. **Store / quota exposure → PASS WITH CONDITIONS + standing flags.** Satisfying C1–C4 clears the Apple 5.2.2 / 5.2.1 and Play IP risk; no new OS permission → no privacy-label change this phase. Standing quota-review exposures (pre-existing, engine-level, OUTSIDE this UI phase): (i) §II ML ingestion/profile-building from Spotify Content; (ii) `TrackCatalog` caches `spotify:track:` URIs indefinitely (`updateResolvedUris`, only nulled on failure) vs. the no-indefinite-storage / delete-on-logout terms; (iii) absent attribution/link-back; (iv) YouTube-content integration vs. the "integrated with another service" clause.

## Gating summary
The Up-Next sheet, DiscoveryBadge, and Now Playing text treatment may be built, blocked on: **C1** Spotify
attribution mark on the sheet + Now Playing; **C2** link-back on both; **C3** Spotify-provided unmodified
legible metadata; **C4** badge avoids Spotify green + soundwave motif. Omitting cover art is compliant.
The one HALT is the "Because you love X" anchor — do not derive/display it from Spotify-sourced data.

## Sources
- https://developer.spotify.com/documentation/design
- https://developer.spotify.com/policy
- https://developer.spotify.com/terms
- https://developer.apple.com/app-store/review/guidelines/

---

## Daniel's resolutions (2026-07-13, HITL gate)
- **HALT (anchor) → RESOLVED via alternative (i):** the anchor is derived/displayed **only** when the
  nearest library track's `provider === 'youtube_music'`; when it is `spotify`-sourced, no anchor is
  claimed (UI degrades to the neutral "New discovery" pill). `MusicProfile.library[].provider` is a
  required enum, so this is a hard, testable gate. Works fully for the current 100%-YouTube prod profile.
- **C1/C2 (attribution + link-back) → both surfaces this phase:** added to the new Up-Next sheet AND the
  shipped Now Playing screen (closing the pre-existing gap). Requires the official Spotify brand asset
  (Pause & Guide). The rendered marks/placement get a compliance re-check before ship.
- **Standing engine-level flags (i)–(iv):** acknowledged; a SEPARATE remediation track (not this UI
  phase). To be scheduled before any Spotify quota-extension application.
