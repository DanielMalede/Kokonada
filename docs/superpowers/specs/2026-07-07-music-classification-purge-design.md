# Music-vs-Non-Music Classification & Purge — Design (2026-07-07)

## Problem

Building the taste profile from YouTube ingests **non-music videos** — vlogs, talking
heads, podcasts, tutorials — as if they were tracks. They live in `MusicProfile.library`,
skew the taste footprint, and (once we run the full featureless-track hydration) would get
audio-features estimated as if they were songs. Daniel confirmed the junk directly in Mongo.

**Goal:** reliably classify each library track as music vs non-music, keep only legitimate
music (official songs, live performances, covers, instrumentals, **DJ sets, mixes**), and
**permanently delete** everything else — both retroactively (purge existing profiles) and at
ingest (junk never enters). When the classifier can't reach a verdict because the AI API is
unavailable, the track waits in an **unclassified pool** that a periodic worker drains.

## Locked decisions (approved 2026-07-07)

- **D1 — Classifier:** deterministic YouTube-metadata first pass, **Groq adjudicating every
  ambiguous track** — at bulk purge **and at ingest** (every new track is Groq-evaluated when
  deterministic signals are inconclusive). TPM-bounded against the 6000 free ceiling.
- **D2 — Delete:** a positive non-music verdict → **hard delete, permanent** (`$pull`, no
  dry-run, no quarantine of the junk, no audit copy).
- **D3 — Scope guard:** only `provider: 'youtube_music'` tracks are ever classified/purged.
  Spotify tracks come from a music catalog and are always kept.
- **D4 — Unclassified pool (safety floor):** if Groq is rate-limited / the API fails on an
  ambiguous track, it is **neither deleted nor put in the library** — it goes to an
  `UnclassifiedTrack` pool. A **periodic worker** re-evaluates the pool when the API is
  available and either **promotes** the track into the music profile (music) or **hard-deletes**
  it (non-music). Deletion happens ONLY on a positive non-music verdict — never on an outage.
- **D5 — Music-form allowlist:** DJ sets, live sets, mixes/mixtapes/megamixes, covers,
  acoustic, instrumental, remixes/edits, live performances and concerts are **music** and must
  survive — a music-form term in the title overrides the junk lexicon.

## Why YouTube is the whole problem (context)

`app/services/musicProfileService.js` + `app/services/youtube.js`:
- **Liked videos** are already fetched with `videoCategoryId: '10'` (Music-only).
- **Subscriptions** are already filtered by channel markers (`- Topic`/VEVO/Official Artist
  Channel) in `_subscriptionArtists`.
- **Playlist items** (`paginatePlaylistItems`) are fetched with `part: 'snippet'` and **no**
  category filter — the `playlistItems` endpoint does not support one. This is the junk door.
- `fetchVideoTopics` **already** fetches `topicDetails.topicCategories` (Wikipedia topic URLs);
  the reliable *is-music* signal is already in hand — the code just discards the generic
  `/wiki/Music` topic as "too coarse" for genre. We reuse it here.

## Architecture

### Unit A — `app/services/musicClassifier.js` (new, pure core + batch resolver)

**`classifyByMetadata(track, meta = {}) → 'music' | 'non_music' | 'ambiguous'`** (pure)
- `track`: `{ provider, name, artist, genres }`; `meta` (optional, from `videos.list`):
  `{ categoryId, topicCategories }`.
- Rules, in order:
  1. `provider !== 'youtube_music'` → `'music'` (Spotify etc. never classified).
  2. **KEEP → `'music'`** if any strong signal: `categoryId === '10'`; `topicCategories`
     contains a Music/music-genre Wikipedia topic; channel/`artist` matches
     `/-\s*Topic\s*$|VEVO\s*$|Official Artist Channel\s*$/i`; **or** the title matches the
     **music-form allowlist** (`dj set, live set, b2b, mix, mixtape, megamix, continuous mix,
     cover, acoustic, instrumental, remix, bootleg, edit, live at, live in, live performance,
     concert, unplugged, official audio, official (music) video, lyric video, visualizer,
     full album, single`).
  3. **PURGE → `'non_music'`** if no keep-signal AND (title matches the **junk lexicon** OR
     `categoryId` ∈ non-music set). Junk lexicon (expanded): `vlog, podcast, tutorial, how to,
     review, unboxing, news, documentary, interview, reaction, gameplay, walkthrough, let's
     play, q&a, day in the life, commentary, lecture, webinar, sermon, trailer, teaser, recap,
     explained, top 10, tier list, grwm/get ready with me, asmr, morning/night routine,
     storytime, rant, full episode, episode`. Non-music `categoryId` set: 22 People&Blogs,
     20 Gaming, 25 News&Politics, 27 Education, 26 Howto&Style, 28 Science&Tech, 24
     Entertainment-without-a-music-topic.
  4. else `'ambiguous'`.
- The music-form allowlist (rule 2) **overrides** the junk lexicon (rule 3), so "DJ Set (live)"
  or "… Guitar Cover" is kept even though "live"/"cover" sit near junk-ish words.

**`classifyTracks(tracks, { youtubeToken, useLLM = true }) → { music, nonMusic, unclassified }`**
- Filters to `youtube_music`; the rest are `music` by scope-guard.
  1. **Deterministic pass** on stored `name`/`artist`.
  2. **Metadata enrichment** of the ambiguous set (when `youtubeToken`): batch
     `videos.list?part=snippet,topicDetails` (50 ids/call) → `categoryId` + `topicCategories`
     → re-run `classifyByMetadata`.
  3. **Groq adjudication** of the still-ambiguous residue (when `useLLM`): batched
     (~40 `title — channel` lines/call), prompt returns the indices that are NOT music,
     TPM-paced via the existing `withRetry` 429 backoff in `llmClient`.
  4. **Partition:** decided-music → `music`; decided-non-music → `nonMusic`; **still ambiguous
     because Groq was unavailable/errored → `unclassified`** (never `nonMusic`).

### Unit B — Ingest gate (`musicProfileService`, Groq ON — D1)

After `_analyzeYouTubeTracks` builds `ytAnalysis.library` (topics already fetched), run
`classifyTracks(..., { youtubeToken, useLLM: true })`. Only `music` merges into `library`;
`nonMusic` is dropped; `unclassified` is written to the `UnclassifiedTrack` pool (never the
library). Cost: Groq is spent on the ambiguous fraction of *new* tracks, batched + paced.

### Unit C — Retroactive purge (`purgeNonMusic`)

**`purgeNonMusic(userId) → { scanned, purged, pooled, kept }`**: load the profile,
`classifyTracks` over its `youtube_music` entries, then: **hard-`$pull`** `nonMusic` ids from
`library`; **move** `unclassified` ids out of `library` into the `UnclassifiedTrack` pool; keep
`music`; **recompute** `topGenres`/`topArtists`/`genreSet` from the surviving library.
Idempotent.

### Unit D — Unclassified pool + periodic reclassifier

- **`app/models/UnclassifiedTrack.js`** (new collection): `{ userId, track (full library-entry
  payload so it can be promoted verbatim), reason, attempts, createdAt, lastAttemptAt,
  nextAttemptAt }`, unique on `(userId, track.id)` (idempotent, no dupes).
- **Queue** `QUEUES.RECLASSIFY_UNCLASSIFIED = 'reclassify-unclassified'` + **`app/workers/
  reclassify.worker.js`**, run in-process (existing `RUN_WORKERS_IN_PROCESS` model) and driven
  by a **repeatable BullMQ job** (e.g. every 30 min) registered at worker startup. Each tick:
  pull a TPM-bounded batch of **due** pooled rows (`nextAttemptAt ≤ now`), re-run
  `classifyTracks({ useLLM: true })` → **promote** `music` into the owner's `library`
  (dedup by `canonicalKey`, recompute footprint) and delete the pool row; **hard-delete** the
  pool row for `nonMusic`; for still-`unclassified` (Groq still down), bump `attempts` +
  exponential-backoff `nextAttemptAt` and leave it. No attempt cap — it keeps retrying until a
  verdict lands; deletion only ever follows a positive non-music verdict.

## Data flow

```
ingest:  youtube likes+playlists+subs → _analyzeYouTubeTracks → classifyTracks(Groq on)
             ├─ music        → library
             ├─ non_music    → dropped
             └─ unclassified → UnclassifiedTrack pool

purge:   MusicProfile.library ─(youtube_music)→ classifyTracks(det → videos.list → Groq)
             ├─ non_music    → $pull (hard delete)
             ├─ unclassified → move to pool ($pull + insert)
             └─ music        → keep    → recompute footprint

periodic: UnclassifiedTrack (due) → classifyTracks(Groq on)
             ├─ music     → promote into library + recompute footprint + drop pool row
             ├─ non_music → hard-delete pool row
             └─ still unc → attempts++, backoff nextAttemptAt

hydrate:  surviving featureless music tracks → featureService.hydrate (ReccoBeats → Groq LLM)
```

### Runner
**`app/scripts/classifyAndHydrate.js`** (committed maintenance runner, replaces the deleted
temp `_hydrateDriver.js`): for the target user(s), `purgeNonMusic` → then hand the remaining
featureless **music** tracks to `featureService.hydrate`, budget-bounded + TPM-paced. Prints
`purged=N pooled=N hydrated=N missing=N`. Run against prod via `railway run`.

## Cost / TPM

- Deterministic pass + `videos.list` enrichment are **free of Groq** (`videos.list` is YouTube
  quota, batched 50/call).
- Groq is spent only on the **ambiguous residue** — at ingest, at purge, and in the periodic
  drain — plus the **catalog-gap** tracks in hydration. All batched and paced by the existing
  429 backoff; the periodic worker processes a bounded batch per tick so it never bursts the
  TPM ceiling.

## Error handling / safety

- **Deletion is gated on a positive non-music verdict.** Groq/enrichment failure ⇒ track is
  `unclassified` ⇒ pooled, never deleted, retried later (D4).
- Every external call (`videos.list`, Groq) degrades gracefully; classification/purge/promote
  never throws upward — a failure leaves the track safely pooled.
- Promotion into `library` respects the 10 000-entry cap and dedups by `canonicalKey`.

## Testing (TDD)

- **`classifyByMetadata`** — table-driven over signal combinations, including the **music-form
  allowlist overriding junk** (DJ set / live set / mix / cover / instrumental / remix kept) and
  the expanded junk lexicon; Spotify passthrough.
- **`classifyTracks`** — deterministic-only; `videos.list` enrichment flips an ambiguous track;
  Groq adjudicates residue; **Groq outage ⇒ track lands in `unclassified` (not `nonMusic`)**.
- **`purgeNonMusic`** — hard-deletes only non-music youtube tracks, moves unclassified to the
  pool, keeps music, recomputes footprint; empty/no-junk profile is a no-op.
- **Ingest gate** — junk playlist item never enters `library`; a Groq-unavailable ambiguous
  track is pooled, not added.
- **reclassify worker** — a due pooled row is promoted (music) / deleted (non-music) / backed
  off (still unavailable); promotion dedups + respects the cap; non-due rows are skipped.

## Out of scope

- Quarantine / audit / undo of deleted junk (declined — D2).
- Re-classifying Spotify tracks (D3).
- Changing the ReccoBeats/LLM hydration internals (unchanged; we feed it the survivors).
