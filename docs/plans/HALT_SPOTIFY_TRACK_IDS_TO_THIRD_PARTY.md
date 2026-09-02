# HALT — Spotify track IDs are transmitted to a third-party API, live

**Raised:** 2026-08-26 by `compliance-auditor`, sources fetched that day.
**Severity:** the auditor's words — *"the only finding in this audit with a plausible path to permanent revocation of Platform access."*
**Routing:** `architect` to choose the resolution → `developer` under TDD → `compliance-auditor` re-audit. Option 2 needs a human (Spotify Developer Support).
**Status:** unresolved. **Must not reach production unresolved.**

---

## What the code does

`backend/app/services/features/reccoBeatsAdapter.js:7,17,20-21`:

```js
// Measured audio features by Spotify track id (ReccoBeats-style API).
const BASE_URL = () => process.env.RECCOBEATS_URL || 'https://api.reccobeats.com';
function supports(track) { return Boolean(spotifyIdOf(track)); }
```

Wired live at `backend/app/services/features/featureService.js:5,94`. **Every request this adapter makes is, by definition, a Spotify track ID sent to `api.reccobeats.com`.**

## The clauses

> **§IV.2.b** "**do not transfer Spotify Content to third parties**, including directly or indirectly transferring any data (including aggregate, anonymous or derivative data) received from Spotify to, or use such data in connection with, any ad network, ad exchange, data broker, or other advertising or monetization-related toolset, even if a user consents to such transfer or use."
> — Spotify Developer Terms, https://developer.spotify.com/terms, fetched 2026-08-26

> **§III.13** "Do not analyze the Spotify Content or the Spotify Service for any purpose, including without limitation, creating new or derived listenership metrics…"
> — Spotify Developer Policy, https://developer.spotify.com/policy/ (effective 15 May 2025), fetched 2026-08-26

The lead clause of §IV.2.b — *"do not transfer Spotify Content to third parties"* — is **unqualified**; the "including…" list illustrates the advertising case rather than exhausting it. ReccoBeats is not an ad network, but it is unambiguously a third party, and the purpose of the transfer is third-party **analysis** of Spotify Content, which §III.13 addresses directly.

**The auditor did not assert a confirmed breach.** It stated the §IV.2.b lead-clause scope is genuinely ambiguous and could not be resolved from the live text alone — and that the correct status is therefore *unresolved*, not *fine*.

## Why this reads as a gap rather than a decision

The architecture already knows about §IV containment and enforces it elsewhere. `llmEstimatorAdapter.js:47-52` hard-gates Spotify recordings out of the estimator with an explicit comment:

```js
// §II Spotify-Content lock: a Spotify recording's genre tags are Spotify Content and must not be
// sent to a third-party model. Gate spotify: recordings out of estimation entirely
```

with the predicate centralised in `utils/spotifyContent.js`, enforced at `discovery/catalogAndEmbed.js:25` and `toCatalogEntry.js:30`, and guarded by `monitoring/spotifyLeakMonitor.js`, `scripts/purgeSpotifyCorpus.js` and regression tests. **The same containment was not applied to the ReccoBeats path.**

## Resolve before submission — pick one

1. **Gate it.** Make `reccoBeats.supports()` exclude Spotify recordings, exactly as `llmEstimatorAdapter.js:50` already does. Cheapest, consistent with the existing posture, and pins the behaviour with the leak monitor already in place.
2. **Get it in writing.** Obtain confirmation from Spotify Developer Support that outbound Spotify track IDs to a feature-lookup service are permitted, and file it.
3. **Re-key the lookup** on a non-Spotify identifier (ISRC / MusicBrainz ID) so no Spotify Content crosses the boundary at all.

**Consequence if wrong**, from the live source: *"suspension, disabling your application or permanently revoking your access to the Spotify Platform"* — https://developer.spotify.com/compliance-tips, fetched 2026-08-26.

## Guard

Extend `spotifyLeakMonitor` to cover **outbound** third-party calls, not only corpus ingestion. The monitor exists precisely for this class and does not currently see this path.

---

## Two further shipped-code items from the same audit

### Clear-space breach in the shipped attribution component — FAIL

`mobile/KokonadaHealth/src/experience/player/SpotifyAttribution.tsx:25,93`

`LOGO_HEIGHT = space.xl` (24), and the container `gap: space.sm` (8). In the official 3432×940 asset the icon circle spans ~96% of canvas height, so at 24px the icon is ≈23px and the required exclusion zone is **≈11.6px**. The rendered gap is **8px**.

> "The exclusion zone is equal to half the height of the icon." — Design & Branding Guidelines, fetched 2026-08-26

**Fix:** derive clear space from the mark, not a spacing token — `const LOGO_CLEAR = Math.ceil(LOGO_HEIGHT * 0.5)`, used as the container `gap` and `paddingHorizontal`. A hard-coded `space.sm` will breach again the next time `LOGO_HEIGHT` moves.

**Everything else in that component is correct and should be preserved:** official asset, theme-correct black/white selection, width derived from the true 3432/940 ratio so the mark is never stretched, 88px ≥ the 70px full-logo minimum, and permitted link-back strings (`OPEN SPOTIFY` / `GET SPOTIFY FREE`).

### Dead `/audio-features` caller — LOW

`backend/app/services/spotify.js:395` still issues `GET /audio-features`, which is **Deprecated** (confirmed live). A repo grep finds **no call sites**. Not a compliance risk; a custodian dead-code item. Leaving a caller for a deprecated endpoint is a false signal to the next reader.

## Related

- `docs/plans/DEV_SPOTIFY_CANVAS_ASSETS.md` — the canvas-side items from the same audit.
