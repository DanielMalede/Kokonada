# DEV ITEM — Spotify marks, cover art and link-back on the canvas

**Raised:** 2026-08-26 by `compliance-auditor` (two independent passes agreed on the findings below).
**Routing:** `designer` for the board changes → `developer` for the shipped component → `compliance-auditor` re-check before submission.
**Status:** the redrawn-mark failure is **fixed**; the cover-art and geometry items are **open**.

---

## What was wrong, and why the redraw was the worst version of it

Five boards drew a **hand-authored SVG path** for the Spotify mark, filled from a `--spotify` design token.

> "The logo should not be misinterpreted, modified, or added to. Its orientation, color, and composition should remain as indicated in this document — **there are no exceptions**."
> — Spotify Design & Branding Guidelines, fetched 2026-08-26

The auditor's framing is the one to keep: **a redraw is worse than a labelled placeholder precisely because it looks right.** A dashed slot is an honest unresolved dependency that someone chases. A redraw passes design review, ships, and becomes an unlicensed derivative of a registered mark on every tab root. A design token is also not a colour guarantee — `var(--spotify)` could drift to any value without anything failing.

**DONE.** All five surfaces (`Login`, `NowPlaying`, `Receipt`, `Components`, `Pulse`, `You`) now carry labelled `OFFICIAL … MARK` slots. `--spotify` has been retired; `#191414` survives only as `--spotify-playback-bg`, scoped to the artwork fallback, with a comment recording that it is **not** a mark colour — the official marks carry their own colour and must never be tinted.

## Open · Cover art is required during playback, and the boards paint a gradient

> **§II.5** — "there shall be no playback of Spotify Content without showing relevant cover art and metadata in your SDA."
> **§II.4.a** — "If you display any Spotify Content you must clearly attribute the content as being supplied and made available by Spotify, by using the Spotify Marks."

The mini-player artwork tiles are `linear-gradient(140deg, var(--accentfill), var(--artph))` — a mood gradient standing in for album art, on rows that show real track and artist metadata.

**Fix:** convert every artwork tile to a labelled cover-art slot, the same way the marks were converted. Write into the `docs/SCREENS.md` Definition of Done: **real cover art is required for Spotify-sourced tracks; the gradient placeholder may never ship.**

## Open · Geometry

| Item | Current | Required |
|---|---|---|
| Artwork corner radius | 20px / 10px | **4px / 8px** per the guidelines' artwork rules |
| Mark slot geometry | ~148×20 | icon floor is **21px** in digital; the slot is 1px under it and has no exclusion zone drawn |
| Mini-player exclusion gap | 12px | **14–16px** — the zone is half the icon height, so it must be derived from the mark, not from a spacing token |

## Open · Link-back target on the Receipt

> **§II.4.b** — "Metadata, cover art and Audio Preview Clips must be accompanied by a link back to the applicable album, content or playlist on the Spotify Service."

On the Receipt the mark and "Listen on Spotify" sit in the **UP NEXT** section header, above three tracks that are not playing, while the shipped action foregrounds the *currently playing* item (`SpotifyAttribution.tsx:61` → `foregroundSpotify`). For Now Playing that resolves correctly; for the Up-Next list it does not link back to the listed content.

**Fix:** either move the mark and link so they govern only the playing item, or give the Up-Next rows their own Spotify URIs.

## Standing condition on the closed decision — do not lose this

Screen 08 and 09 closed on `attr=linkback`: the words "content from Spotify" were dropped and the link-back kept. **That decision is compliant** — under §II.4.a the *mark* is the attribution mechanism, and no fetched clause requires the words "content from Spotify" or "Powered by Spotify". (The auditor also corrected a standing assumption of mine here: "Powered by Spotify" is absent from the current guidelines and policy entirely.)

But the decision **moves 100% of the attribution burden onto asset fidelity**. Two consequences:

1. **"Link-back only" must never propagate to a developer as "drop the mark."** If the logo does not render, the surface has a link-back and **no attribution at all** — a straight §II.4.a breach on every content screen. This is the note that belongs beside the decision, not buried in a report.
2. **Replace the guard, never just delete it.** `mobile/KokonadaHealth/src/experience/player/__tests__/SpotifyAttribution.test.tsx:52` pins `expect(...).toContain('content from Spotify')`. Removing the string means editing a compliance regression test. Replace it with assertions that the logo renders (`spotify-attribution-logo` present, theme-correct source) and that the link-back exists — otherwise the next refactor can silently drop the logo and nothing fails.

## Open · Store screenshots

`Components.dc.html` and `You.dc.html` show **"Holocene" / "Bon Iver"** — a real recording by a living artist — paired with our own mood label "winding down".

PASS in-app: runtime metadata is user-driven. **NEEDS CHANGE for any store asset** — Spotify Developer Policy §II.3 exists to prevent exactly the confusion of "artist, creator or user associated with any Spotify Content", and Apple 2.3.7 covers misleading metadata. Use fictitious track and artist strings in every asset destined for a store listing.

## Related

- `docs/plans/HALT_SPOTIFY_TRACK_IDS_TO_THIRD_PARTY.md` — the shipped-code half, and the higher-severity one. It also carries the `SpotifyAttribution.tsx` clear-space breach (8px gap against ≈11.6px required) and the dead `/audio-features` caller.
- `docs/plans/HALT_YOUTUBE_ATTRIBUTION_AND_REVOCATION.md` — YT-2 is the same attribution problem on the other provider, and its fix shares this slot.
