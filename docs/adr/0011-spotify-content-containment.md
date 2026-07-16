# ADR 0011 — Spotify Content Containment (corpus, feature store, erasure, bandit)

- **Status:** Accepted
- **Date:** 2026-07-16 (Wave 1 — Spotify Developer-Terms containment)

## Context

Spotify's Developer Terms forbid (a) creating a persistent database of Spotify Content,
(b) ingesting Spotify Content into an ML model / building derived functionality from it, and
(c) feeding Spotify Content to third-party AI. Prior waves already contained the LLM egress
(#145) and moved the global discovery corpus to CC0-only, provider-agnostic identity
(ADR 0010). This ADR covers the remaining standing-data leaks: the corpus/catalog/embedding/
feature-store WRITE paths still admitted `spotify:`-keyed rows, disconnect did not fully erase
personalized Spotify state, and the forward-looking T7 selection bandit could be trained on
Spotify-derived signals.

## Decision

1. **Write paths refuse Spotify Content.** The catalog choke (`toCatalogEntry` /
   `catalogAndEmbed`), profile-build corpus ingest (`musicProfileService`), feature hydration
   and its embedding self-enqueue (`featureService`), the embedding worker, and the
   `upgrade-llm` re-hydration all drop any row whose `recordingKey` / `uri` is `spotify:` (or
   `provider === 'spotify'`), via the single predicate `utils/spotifyContent.js`. This is
   unconditional (no feature flag — a prod-off flag does not cure a ToS breach). The CC0/mbid
   global-seed path (ADR 0010) is unaffected.

2. **Global caches: excluded from per-user erasure, eliminated globally for Spotify.** The
   URI-keyed caches (`TrackCatalog` / `TrackEmbedding` / `AudioFeature`) carry no `userId`/PII,
   so per-user GDPR erasure still excludes them (ADR 0008 unchanged). That exclusion is a
   privacy statement, NOT a license to retain Spotify Content globally: any `spotify:`-keyed
   rows are eliminated GLOBALLY by the one-time, human-gated script
   `backend/scripts/purgeSpotifyCorpus.js`. Spotify disconnect additionally erases the user's
   `ServeEvent` history and user-scoped Redis state alongside the existing `MusicProfile` drop.

3. **T7 bandit posteriors must never be fit on Spotify-derived signals.** The selection scorer
   (`backend/app/services/selection/score.js`) will, under the T7 feedback loop, replace its
   static env weights with bandit-sampled posteriors. Those posteriors MUST be fit only on
   non-Spotify corpus features and engagement — never on Spotify Content, its features, or
   engagement measured against Spotify recordings — or we recreate the prohibited derived
   functionality. `score.js` currently reads only static env weights + non-Spotify corpus
   features, so no code change is required today; this is a binding constraint on T7.

## Consequences

- ReccoBeats' measured-feature path (`supports = Boolean(spotifyIdOf)`) is spotify-only and is
  now gated off in hydration; non-Spotify (youtube / global mbid) tracks are feature-estimated
  via the LLM tier. The measured path remains in code for a future non-Spotify measured source.
- A standing leak monitor counts `spotify:`-keyed rows across the three caches and alerts if any
  reappear post-purge — so a regression is caught, not silently retained.
- If T7 is implemented without honoring §3, this ADR is violated; the bandit training input set
  is the gate to review.
