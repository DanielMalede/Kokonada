# Music-vs-Non-Music Classification & Purge — Design (2026-07-07)

## Problem

Building the taste profile from YouTube ingests **non-music videos** — vlogs, talking
heads, podcasts, tutorials — as if they were tracks. They live in `MusicProfile.library`,
skew the taste footprint, and (once we run the full featureless-track hydration) would get
audio-features estimated as if they were songs. Daniel confirmed the junk directly in Mongo.

**Goal:** reliably classify each library track as music vs non-music, keep only legitimate
music (official songs, live performances, covers, instrumentals), and **permanently delete**
everything else — both retroactively (purge existing profiles) and at ingest (junk never
enters going forward). Classification is added to the hydration pipeline as its pre-step.

## Locked decisions (approved 2026-07-07)

- **D1 — Classifier:** deterministic YouTube-metadata first pass, **Groq tie-breaker on the
  ambiguous residue only** (bounded TPM against the 6000 free ceiling).
- **D2 — Safety:** **hard delete, permanent.** No dry-run, no quarantine, no audit copy. The
  engine evaluates each record and removes non-music outright (`$pull` from `library`).
- **D3 — Scope guard:** only `provider: 'youtube_music'` tracks are ever classified/purged.
  Spotify tracks come from a music catalog and are always kept — this bounds work and cost to
  the actual junk source.

## Why YouTube is the whole problem (context)

`app/services/musicProfileService.js` + `app/services/youtube.js`:
- **Liked videos** are already fetched with `videoCategoryId: '10'` (Music-only).
- **Subscriptions** are already filtered by channel markers (`- Topic`/VEVO/Official Artist
  Channel) in `_subscriptionArtists`.
- **Playlist items** (`paginatePlaylistItems`) are fetched with `part: 'snippet'` and **no**
  category filter — the `playlistItems` endpoint does not support one. This is the junk door:
  a user playlist can hold any video, and those flow into `library` via `_analyzeYouTubeTracks`.
- `fetchVideoTopics` **already** fetches `topicDetails.topicCategories` (Wikipedia topic URLs)
  for genre extraction — the reliable *is-music* signal is already in hand; the code just
  discards the generic `/wiki/Music` topic as "too coarse" for genre. We reuse it here.

## Architecture

### Unit A — `app/services/musicClassifier.js` (new)

Pure, unit-testable core + a batch resolver. One clear job: decide music vs non-music.

**`classifyByMetadata(track, meta = {}) → 'music' | 'non_music' | 'ambiguous'`** (pure)
- `track`: `{ provider, name, artist, genres }` (a `library` entry).
- `meta` (optional, from `videos.list`): `{ categoryId, topicCategories }`.
- Rules:
  - `provider !== 'youtube_music'` → `'music'` (Spotify etc. never classified).
  - **KEEP → `'music'`** if any: `categoryId === '10'`; `topicCategories` contains a Music or
    music-genre Wikipedia topic (`/wiki/Music`, `/wiki/Rock_music`, …); channel/`artist`
    matches `/-\s*Topic\s*$|VEVO\s*$|Official Artist Channel\s*$/i`.
  - **PURGE → `'non_music'`** if no keep-signal AND any: title matches the junk lexicon
    (`vlog, podcast, episode, \bep\.?\b, q&a, tutorial, how to, reaction, gameplay, live
    stream, interview, news, trailer, unboxing, review, day in the life, highlights, …`); or
    `categoryId` ∈ non-music set (22 People&Blogs, 20 Gaming, 25 News&Politics, 27 Education,
    26 Howto&Style, 24 Entertainment-without-music-topic, …).
  - else `'ambiguous'`.

**`resolveNonMusic(tracks, { youtubeToken, useLLM = true }) → { nonMusic: Set<id>, stats }`**
- Filters to `youtube_music` tracks, then:
  1. **Deterministic pass** on stored fields (`name`, `artist`) → music / non_music / ambiguous.
  2. **Metadata enrichment** for the ambiguous set (when `youtubeToken`): batch
     `videos.list?part=snippet,topicDetails` (50 ids/call) → real `categoryId` + `topicCategories`
     → re-run `classifyByMetadata`. (No token → skip; stay ambiguous.)
  3. **Groq tie-breaker** on the still-ambiguous residue (when `useLLM`): batched
     (~40 `title — channel` lines/call), prompt "return the indices that are NOT music tracks",
     TPM-paced via the existing `withRetry` 429 backoff in `llmClient`. This is the AI engine
     actively adjudicating the hard cases.
- **Safety floor:** a track is added to `nonMusic` only on a *positive* non-music verdict. If a
  Groq batch is entirely unavailable (rate-limited out / errored), its residue stays ambiguous
  → **kept** → retried next run. A real song is never deleted because of an API outage.

### Unit B — Ingest gate (`musicProfileService`)

After `_analyzeYouTubeTracks` builds `ytAnalysis.library` and `fetchVideoTopics` returns
topics, run `resolveNonMusic` (deterministic + the topics already fetched; Groq optional here
and off by default to keep profile builds fast) and drop non-music entries **before** they
merge into `library`. Junk never enters going forward.

### Unit C — Purge + hydration runner

- **`purgeNonMusic(userId, opts) → { scanned, purged, kept }`** (new, in
  `musicProfileService` or a thin `maintenance` service): load the profile, `resolveNonMusic`
  over its `youtube_music` entries, **hard-`$pull`** the non-music ids from `library`, then
  **recompute** `topGenres` / `topArtists` / `genreSet` from the surviving library (the footprint
  changes when tracks leave). Idempotent.
- **`app/scripts/classifyAndHydrate.js`** (committed maintenance runner, replaces the deleted
  temp `_hydrateDriver.js`): for the target user(s), `purgeNonMusic` → then hand the remaining
  featureless **music** tracks to `featureService.hydrate`, budget-bounded and TPM-paced. Prints
  `purged=N hydrated=N missing=N`. Run against prod via `railway run`.

## Data flow

```
ingest:   youtube likes+playlists+subs → _analyzeYouTubeTracks → resolveNonMusic(det.) → drop junk → library
purge:    MusicProfile.library ─(youtube_music)→ resolveNonMusic(det. → videos.list → Groq) → $pull non-music → recompute footprint
hydrate:  surviving featureless music tracks → featureService.hydrate (ReccoBeats → Groq LLM) → AudioFeature store
```

## Cost / TPM

- Deterministic pass + `videos.list` enrichment are **free of Groq** (`videos.list` is YouTube
  quota, batched 50/call).
- Groq is spent only on the **ambiguous residue** (classification) and then on the
  **catalog-gap** tracks (hydration LLM estimator) — sequentially, both batched and paced by the
  existing 429 backoff. No concurrent double-spend.

## Error handling / safety

- Deletion is gated on a positive non-music verdict (see safety floor). Ambiguous ⇒ kept.
- Every external call (`videos.list`, Groq) degrades gracefully: enrichment failure → stay
  ambiguous; Groq failure → keep + retry next run. Classification/purge never throws upward.

## Testing (TDD)

- **`classifyByMetadata`** — table-driven over signal combinations (categoryId, topicCategories,
  channel markers, junk titles, Spotify passthrough) → music / non_music / ambiguous.
- **`resolveNonMusic`** — deterministic-only path; `videos.list` enrichment flips an ambiguous
  track; Groq tie-breaker adjudicates residue; **Groq outage ⇒ ambiguous kept** (safety floor).
- **`purgeNonMusic`** — hard-deletes only non-music youtube tracks, keeps Spotify + music,
  recomputes footprint; empty/no-junk profile is a no-op.
- **Ingest gate** — a junk playlist item never enters `library`; a real song does.

## Out of scope

- Quarantine / audit / undo (explicitly declined — D2).
- Re-classifying Spotify tracks (D3).
- Changing the ReccoBeats/LLM hydration internals (unchanged; we only feed it the survivors).
