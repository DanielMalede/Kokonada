# ADR 0010 — The global discovery corpus is CC0-only and provider-agnostic

Status: Accepted (2026-07-15)

## Context

Live Discovery matches a biosonic target vector against the anonymous corpus (`TrackCatalog` +
`TrackEmbedding` + `AudioFeature`), which was bootstrapped only from user libraries and is therefore
capped at what users already own. To grow it, we add a background **Global Seed Ingestion** pipeline.

Two compliance gates (2026-07-14/15) shaped the design decisively:
- Sourcing seeds from **Spotify** was **HALTed** — it would create a prohibited "database of Spotify
  Content" and trip the §II "derived functionality / ingest into an ML model" clause, and the Feb-2026
  API changes + likely-denied Extended Quota make it infeasible regardless.
- Of the open alternatives: **MusicBrainz core, ListenBrainz, and the frozen AcousticBrainz dump are
  CC0 (SHIP)**; **MusicBrainz genres/tags are CC BY-NC-SA 3.0 (NOT CC0)**; **Deezer is HALT** (its terms
  call bulk fetching "counterfeiting" and forbid data-mining/ML use).

## Decision

1. **The global corpus is provider-agnostic.** Global rows are keyed by canonical identity
   (`mbid:<MBID>` recordingKey; ISRC / `at:<artist>|<title>` canonicalKey) and carry **no platform id**
   (no `spotify:` URI, no YouTube video id). Playback-provider resolution is a separate **runtime**
   concern, done per-user at play time and never persisted to the shared corpus (Discovery Engine ⊥
   Runtime Resolver). `TrackCatalog.source` (`library` | `global`) records provenance only — never a user.

2. **The global corpus is CC0-only.** Seeds + canonical metadata come from CC0 sources (MusicBrainz core
   / ListenBrainz); acoustic features come from the **CC0 AcousticBrainz dump** (waterfall:
   AcousticBrainz → ReccoBeats opportunistic → LLM last-resort). **Genres are NOT sourced from
   MusicBrainz** (CC BY-NC-SA) — they come from the existing LLM path (`inferArtistGenres`), so the genre
   bag stays CC0-independent.

3. **Deezer is not used** for the corpus (ToS HALT).

## Binding conditions (the landmine)

- The CC0-only guarantee is **load-bearing on Kokonada remaining non-commercial / "100% free."** If a
  paid tier is ever introduced, any MusicBrainz-genre use (CC BY-NC-SA NonCommercial) and any Deezer
  use flip from survivable to a **hard HALT** — revisit this ADR before monetizing.
- This corpus must remain free of any `userId`/PII (inherits ADR-0008); a non-user `source` enum is
  safe, anything user-identifying is not and would require adding these models to the erasure cascade.
- **Attribution (courtesy, CC0 does not legally require it):** surface "Data provided by MusicBrainz /
  ListenBrainz / AcousticBrainz" where the corpus's provenance is shown. Sink-side Spotify/YouTube
  attribution obligations still apply at the play-time resolution UI (unchanged, out of corpus scope).

## Consequences

- Discovery reaches beyond user libraries while no single provider's ToS is implicated by the standing
  data. AcousticBrainz's dump is frozen (~mid-2022), so post-2022 tracks fall to the LLM tier (lower
  fidelity) until a newer measured source is vetted. The mood-derived feature dims differ in semantics
  from the prior Spotify-trained targets, so the mixed corpus needs a `DISCOVERY_MIN_COSINE` retune.
