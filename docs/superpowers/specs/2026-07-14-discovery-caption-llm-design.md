# Discovery caption (LLM "why this discovery") — design spec

**Date:** 2026-07-14 · **Branch:** `feat/discovery-caption` (off `origin/main`, which has #131 + #132).
Brainstormed + approved with Daniel. Build sequence is 4 isolated steps (below); **Step 1 = this spec +
compliance green light BEFORE any backend logic.**

## Context / problem
The shipped discovery receipt shows a deterministic anchor line — "Because you love {nearest library
track title}" — computed by embedding similarity and gated to `youtube_music` library entries (Policy §II).
Two problems surfaced on-device: (1) the library contains non-music YouTube junk (clickbait/debates), so
the anchor sometimes names garbage ("Because you love देखो! पार्क में…"); (2) it's a fixed template, not the
"cool, short, genuinely-reasoned" line Daniel wants. Replace it with an LLM-written one-liner.

## Locked decisions
1. **Grounding (compliance-LOCKED — auditor option ii, 2026-07-14):** the caption reasons ONLY over
   **the discovery track's audio FEATURES** (tempo / energy / valence / danceability / acousticness —
   ReccoBeats/LLM-derived, **NOT** Spotify) **+ the user's first-party session context** (emotion taps /
   activity chip / heart-rate band that drove this generation). **NO title, artist, or genres are ever
   sent to the LLM.** → sends **zero Spotify Content to Groq**, needs **no provenance gate**, shows on
   **every** discovery track, and is immune to junk-title naming (it describes the sonic vibe + mood, never
   names a track). The caption describes *feel* (slow, smoky, driving, bright, high-energy) + *your mood*,
   not the track's name or genre label.
   > **Why not title/artist/genres:** the compliance gate (below) HALTed that — a discovery candidate's
   > title/artist/genres originate (for Spotify-origin catalog rows) from the Spotify Web API, so feeding
   > them to Groq = "ingest Spotify Content into an AI model" (Policy §II, inference-time limb). Excluding
   > *taste* does not cure it; the violation attaches to the track metadata itself.
2. **Voice:** witty / human — casual, clever, a wink. ≤ ~10 words, specific, no clichés, no "generic."
   Examples: "A slow jam your calm didn't know it needed." / "Smooth enough to lower your heart rate."
3. **Batch-at-generation:** ONE structured Groq call per generation captions all selected discovery
   tracks; captions are packed into the initial `playlist_ready` payload → zero client-side latency on
   track transitions (fits the existing receipt-in-payload model).
4. **Clean deletion (zero tech debt):** the LLM caption fully replaces the anchor line; the deterministic
   `libraryAnchor` "Because you love X" code is **removed entirely** (not kept dark as a fallback).
5. **Fallback:** if Groq fails / times out / the flag is off → **no caption** → the client degrades to the
   quiet "New discovery" pill. Never blocks or slows generation past a hard budget.
6. **Flag:** dark-launch behind `DISCOVERY_CAPTION_LLM` (default off).

## Architecture
- **Backend caption service** (new, isolated): given the selected discovery tracks' **audio features
  ONLY** (tempo/energy/valence/danceability/acousticness — via `audioFeatureRepo`/`featureService`, never
  title/artist/genres) + the session context (mood/activity/HR band, i.e. the biosonic `targets` + emotion
  quadrant), makes ONE Groq call with a strict style contract and **structured output**
  (`{ recordingKey|trackId → caption }`). The prompt MUST NOT receive any track name/artist/genre — a
  test asserts no such field is ever placed in the request payload (the compliance guard).
  Wrapped in a hard budget timeout (env, e.g. `DISCOVERY_CAPTION_BUDGET_MS`); any failure/timeout/parse
  error → return an empty map (no captions), never throw. Called from `generateAndEmitPlaylist` behind the
  flag, after selection, before `toClientTracks`. The caption is attached to each discovery track and
  emitted in the receipt.
- **Receipt contract change:** `receipt.anchor: { title, artist }` → `receipt.caption: string` (present only
  for a discovery track with a caption). `buildReceipt` emits `caption` instead of `anchor`.
- **Mobile client:** `TrackReceipt` + `sanitizeReceipt` accept `caption?: string` (kept only when a
  non-empty string), replacing `anchor`. `NowPlayingScreen` renders the caption where the anchor line was —
  same ✦ glyph + `emotionAccent` outline enriched treatment; absent caption → the quiet "New discovery"
  pill (branch 3), byte-identical to today's no-anchor fallback.
- **Removal:** delete `backend/app/services/discovery/libraryAnchor.js` + its call in `pipeline.js` + the
  `DISCOVERY_ANCHOR_MIN_COSINE` env + its tests; remove `anchor` from `TrackReceipt`/`sanitizeReceipt`/
  `NowPlayingScreen` on the client. Surgical, last (Step 4), after the caption path is green so there's no
  window with no anchor line at all.

## Compliance (Step 1 — RESOLVED 2026-07-14)
**Auditor verdict: HALT on the original grounding (title/artist/genres), GO under option ii.** Feeding a
discovery track's title/artist/genres to Groq feeds Spotify Content into an AI model at inference —
Policy §II "…or otherwise ingest Spotify Content into a machine learning or AI model" (the inference-time
limb, confirmed against Spotify's live *Building with AI* docs) + the derived-functionality limb.
Track/artist names + Spotify-derived genres ARE "Spotify Content" (Developer Terms definition includes
"metadata"), and for the Spotify-origin subset of the shared `TrackCatalog` (populated via
`corpusIngest.ingestLibrary` from Spotify-Web-API metadata) they reach the caption call. Excluding user
taste does NOT cure it — the violation is the metadata itself. Live access-revocation risk (Spotify
Feb-2026 enforcement update).
**Resolution (Daniel-approved):** ground the caption in **audio features + first-party session context
ONLY** — tempo/energy/valence (ReccoBeats/LLM-derived, non-Spotify) + emotion/activity/HR. **Zero Spotify
Content to Groq**, no provenance gate, works on every track, still yields the witty vibe line. Display
side PASSES (first-party voice, visually distinct from the Spotify-provided metadata it never modifies, no
Spotify Marks, no new attribution/link-back beyond the shipped C1/C2). **Hard build guard:** a test must
assert the Groq request payload contains NO track title/artist/genre for any candidate.

## Implementation sequence (4 isolated steps — each gated)
1. **Spec + compliance green light** (this doc → compliance-auditor). No code until clean.
2. **Backend Groq caption service** behind `DISCOVERY_CAPTION_LLM` + strict budget timeout, RED-first TDD;
   receipt emits `caption`. Resilience gate. (libraryAnchor still present — not removed yet.)
3. **RN client** parses `receipt.caption` + renders it (fallback to quiet pill), RED-first TDD.
4. **Surgical removal** of `libraryAnchor` (backend) + `anchor` (client) + `DISCOVERY_ANCHOR_MIN_COSINE`,
   RED-first (tests updated), leaving no dead code.

## Testing / DoD
- Backend: caption service unit tests (structured parse, style-contract shape, batch, budget-timeout →
  empty map, flag-off no-call, never-throws); `buildReceipt` emits `caption` not `anchor`; generation never
  blocked/slowed past budget. Full backend suite green, no regression.
- Mobile: `sanitizeReceipt` keep/strip `caption`; NowPlayingScreen enriched-vs-quiet branches; reduced
  motion. Full mobile suite green (`--runInBand`), no regression.
- Each step: resilience gate + independent re-verify; whole-branch review; hold at push gate (Daniel merges).

## Open / flagged (not this feature)
- Library junk still pollutes Up-Next/playback as fake "tracks" — the separate `classifyAndHydrate` purge
  (Daniel chose the **--dry-run-first** path) addresses that; independent of this caption work.
