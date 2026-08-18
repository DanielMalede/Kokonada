# ADR 0012 — Learning Compliance: what the engines may be fit on

- **Status:** Accepted
- **Date:** 2026-08-19 (Wave 4 — Runtime Intelligence)
- **Extends:** [ADR 0010](0010-global-corpus-cc0-only-provider-agnostic.md) (CC0-only global corpus),
  [ADR 0011](0011-spotify-content-containment.md) §3 (bandit posteriors must not be fit on Spotify signals),
  [ADR 0005](0005-zero-knowledge-biometrics.md) (zero-knowledge biometrics)

## Context

Wave 4 makes the selection stack *learn*: a feedback loop (`RewardEvent`), a novelty bandit,
and a personal-weights overlay. ADR 0011 §3 anticipated exactly this and left a binding but
abstract constraint — "T7 posteriors MUST be fit only on non-Spotify corpus features and
engagement". That constraint is now load-bearing and needs a concrete, testable shape before
any learned artifact is persisted.

Spotify's Developer Terms forbid creating a persistent database of Spotify Content, ingesting
it into an ML model, and building derived functionality from it. A learned artifact keyed by,
or fit on, Spotify recordings is precisely the prohibited derived functionality — and unlike a
cache row it cannot be purged into compliance after the fact, because the prohibited content is
*smeared across the parameters*. The containment therefore has to be structural and fail-closed
at the schema, not a flag and not a review habit.

YouTube Content carries the same exclusion from cross-user stores; the existing
`featureService._dropRestricted` already drops both providers from the hydration/embedding
write paths.

## Decision

Learning is split into **two tracks**, and nothing else is learnable.

1. **Track A — state-space rewards (all users, all providers).** Rewards aggregate into
   *context buckets* keyed by `{stateDomain, targetBand, hourBin}` — coordinates of the
   listener's physiological/temporal state and the target we aimed at. A bucket **never stores
   track identity**, of any provider. This is learning about *the person and the moment*, not
   about anyone's catalog, so it is provider-neutral by construction and is the only track that
   sees Spotify-served plays. Bucket coordinates are coarse (ADR 0005: no numeric vitals).

2. **Track B — track-level posteriors (CC0 `mbid:` only).** Per-recording Beta posteriors are
   permitted **only** for `mbid:`-keyed CC0 corpus recordings (ADR 0010 identity). The schema
   enforces it: a track-level key that does not match `/^mbid:/` is **rejected by a schema-level
   validator** (fail-closed — reject, not silently drop), mirroring `_dropRestricted`'s
   containment and `utils/spotifyContent.js`'s single-predicate discipline.

3. **Persisted learned artifacts never encode Spotify or YouTube Content.** No learned artifact
   (`RewardEvent`, `PersonalWeights`, novelty posteriors, any future model) may contain a
   `spotify:`/`youtube:` key, a bare `spotifyId`, or a parameter fit on those recordings'
   features or on engagement measured against them.

4. **ReccoBeats features of Spotify tracks are serve-time-only.** They may be computed and
   scored **in memory, within one request**, and must never be written into a learned artifact
   or any persistent store. (Hydration already gates this path off per ADR 0011.)

5. **Personal weights** (`PersonalWeights`, W4-013) are a bounded overlay on *global* scoring
   weights, updated from Track-A bucket rewards only. Weights describe how to weigh *feature
   dimensions* for a person — they are not a catalog and encode no recording identity.

## Consequences

- `RewardEvent` splits into two collections/shapes rather than one convenient table: bucket
  aggregates (all users) and `mbid:`-only track posteriors. That separation is the compliance
  boundary and must not be "simplified" back together.
- Learning from Spotify-served plays is *not* forbidden outright — but only ever at bucket
  granularity (Track A). "This person, in this state, at this hour, responded well to this
  target" is a statement about the person, not about Spotify's catalog.
- Cold start is unavoidable for Track B: the CC0 corpus is a minority of served tracks, so
  track-level posteriors stay sparse. Accepted deliberately — Track A carries the personalization.
- A tripwire test (`backend/tests/adr0012.tripwire.test.js`) fails the build if any learned-artifact
  schema admits a non-`mbid:` track key or references provider-scheme literals in code. New learned
  artifacts must be added to its registry in the same PR that introduces them.
- If a future feature needs track-level learning over Spotify recordings, this ADR is the gate:
  it must be superseded, not worked around.
