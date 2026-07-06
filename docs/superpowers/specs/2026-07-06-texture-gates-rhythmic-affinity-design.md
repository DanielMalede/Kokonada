# Texture Outlier Gates + Rhythmic Rotation Boost — Design Spec

**Date:** 2026-07-06
**Status:** Approved (Daniel, exact parameters below)
**Branch:** `feat/texture-gates-rhythmic-affinity`

## Goal

Eliminate two feature bleed-over anomalies and lift proven personal tracks in activity-driven
playlists, without weakening the un-relaxable biosonic energy/tempo gates.

1. **Acoustic double-time bleed** — fast acoustic tracks mis-tagged with 2× BPM pass the tempo
   window and (if mid-energy) the energy floor into high-exertion playlists.
2. **Intensity bleed into calm** — a mis-read-low energy on a genuinely intense track slips it
   into resting/wind-down playlists.
3. **Proven rhythmic tracks buried** — activity-mode scoring crushes `taste` to 0.10, so
   heavy-rotation tracks (incl. curated playlists) lose to any on-target track.

## Architectural invariant (why this is safe)

The biosonic band (`filterBand`) runs at `pipeline.js:99` — **upstream of scoring** and
**un-relaxable** (the L0–L4 ladder only loosens anti-repetition/genre/mood, never the band).
Therefore:
- Texture bounds added to the band are **true hard-drops**; the ladder cannot undo them. The only
  escape is the existing `banded.length === 0 → full-pool` never-empty fallback.
- Any affinity boost added to the scorer is **automatically "without breaking the energy gates"**,
  because scoring only ever sees tracks that already passed the band.

## Available features

`track.features` at `pipeline.js:87` carries `{ bpm, energy, valence, acousticness, danceability }`.
`instrumentalness`/`loudness` are **not** projected — `acousticness` (texture) and `danceability`
(rhythm) are the orthogonal signals used here. Featureless tracks pass the band (unchanged) and pay
`unknownFeaturePenalty` in scoring; the library is now fully hydrated so this is ~0 in practice.

---

## Workstream A — Strict Outlier Rejection (un-relaxable texture gates)

### A.1 `translate.js` — emit an intensity classification (stays pure, no env reads)

Add one output field derived from the already-computed `activityEnergy`:

```
activityIntensity =
    activityEnergy == null ? null            // no explicit activity (mood-only) → no texture gate
  : activityEnergy >= 0.7  ? 'high'          // running .85, workout .9, strength .85, cycling .75, swimming .7
  : activityEnergy <= 0.2  ? 'low'           // resting .15, winding down .15
  :                          null            // walking/commuting/working/focus → mid, no texture gate
```

The env-tunable ceiling *values* live in `biosonicBand.js` (co-located with the other `BAND_*`
knobs), so `translate` remains free of `process.env` and its purity tests hold. The output shape
gains exactly one key: `activityIntensity`.

### A.2 `biosonicBand.js` — enforce the ceilings (after the energy gate)

New env knobs:
```
BAND_ACOUSTIC_CEIL  default 0.4    // high-exertion acousticness ceiling
BAND_DANCE_CEIL     default 0.6    // low-exertion danceability ceiling
```

In `withinBand`, after the energy check, before `return true`:
```
if (targets.activityIntensity === 'high') {
  const a = Number(f.acousticness);
  if (Number.isFinite(a) && a > ACOUSTIC_CEIL()) return false;   // kills acoustic double-time
} else if (targets.activityIntensity === 'low') {
  const d = Number(f.danceability);
  if (Number.isFinite(d) && d > DANCE_CEIL()) return false;      // kills intensity bleed into calm
}
```

Rationale: acousticness is a timbre measure **invariant to the BPM-octave error**, so a
high-acousticness track at "running BPM" is almost always a double-time artifact — dropped
structurally at 0.4. Danceability is the orthogonal intensity cross-check for calm.

---

## Workstream B — Deep Profile Integration (proven rhythmic rotation boost)

### B.1 `score.js` — a dedicated, feature-fit-scaled rotation term (intent mode)

New weight + param (memoized like the existing weights):
```
SCORE_INTENT_W_ROTATION  default 0.40   // intent mode
SCORE_W_ROTATION         default 0      // mood mode (unchanged behavior)
SCORE_ROTATION_FLOOR     default 0.5    // only top-half affinity earns the boost
```

Computed per track (only meaningful when `W.rotation > 0` and `maxAffinity > 0`):
```
a        = clamp01(affinity / maxAffinity)
proven   = clamp01((a − FLOOR) / max(1e-6, 1 − FLOOR))     // #1 affinity → ~1, tail → 0
rhythmic = danceability != null ? clamp01(danceability) : 0.6
rotation = proven · rhythmic · featureDistance             // featureDistance = featureFit ?? 0.5
total   += W.rotation · rotation
```

**Why `· featureDistance`:** it scopes the boost to tracks that are proven *and* on-target ("win
**their** band"). In prod the band already guarantees on-target, so among survivors the boost is
near-full for centered tracks and tapers at the band edge. In isolation (unit tests, no band) it
prevents a proven but far-off-target track from hijacking the ranking — preserving the existing
"biosonic target dominates over stale affinity" invariant.

`terms.provenRotation = rotation` is added for telemetry.

### B.2 `musicProfileService.js` — raise the curated-playlist signal

`SOURCE_WEIGHTS.playlist: 1 → 4` (equal to `topLong`, above `saved` 3 / `recent` 2). A curated
playlist is a deliberate signal, not passive noise. **Takes effect only after a profile rebuild**
(`buildProfile` recomputes `affinity`); Daniel authorized the rebuild post-deploy.

---

## Parameters (locked)

| Knob | Value | Env |
|---|---|---|
| High-exertion acousticness ceiling | **0.4** | `BAND_ACOUSTIC_CEIL` |
| Low-exertion danceability ceiling | **0.6** | `BAND_DANCE_CEIL` |
| Rotation boost weight (intent) | **0.40** | `SCORE_INTENT_W_ROTATION` |
| Rotation boost weight (mood) | 0 | `SCORE_W_ROTATION` |
| Proven-rotation floor | **0.5** | `SCORE_ROTATION_FLOOR` |
| Playlist ingestion weight | **4** (was 1) | code constant |

## Testing (TDD)

- `biosonicTranslate.test.js`: `activityIntensity` = high (running/workout), low (resting/winding
  down), null (walking, mood-only).
- `shadow.fullSystem.test.js`: add `activityIntensity` to the translate output-key allowlist.
- `biosonicBand.test.js`: high drops acousticness > 0.4 / keeps ≤ 0.4; low drops danceability > 0.6;
  mid/none applies neither; featureless still passes.
- `selectionUnits.test.js`: proven+rhythmic+on-target track earns a rotation boost; tail-affinity
  earns ~0; off-target proven track does NOT overtake on-target (existing invariant holds); mood
  mode rotation = 0.
- `musicProfile.test.js`: playlist source contributes weight 4 to affinity.

## Out of scope (YAGNI)

- `instrumentalness` (not stored) — `acousticness` covers the double-time signal.
- General BPM half/double-time octave reconciliation in `featureFit` — only if non-acoustic tempo
  bleed persists after this ships.

## Ops (post-merge)

1. Merge → Railway deploys.
2. Rebuild Daniel's profile analysis so `playlist=4` re-weights affinity.
3. Tap Running → confirm energetic + proven-track Top-50 via `[selection.v2]` / `[gen.targets]`.
