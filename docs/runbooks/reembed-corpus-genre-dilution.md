# Runbook — re-embed corpus to strip genre-bag dilution (migration)

Companion to the `fix/embedding-genre-dilution` change. The code fix makes the embedding worker build
every NEW vector genre-free, but the ~10,019 EXISTING `TrackEmbedding` rows keep their genre-bag
dilution until this migration re-embeds them. This is a deliberate, Daniel-triggered ops step (not
auto-run), like the Wave-1 data run. Steps touching Railway/env are Pause & Guide.

## Sequencing
Run this **after** the unrelated Spotify-compliance purge lands (if it's in flight) — no sense
re-embedding `source:'library'` Spotify rows that fix will delete. Otherwise, run any time post-merge.

## 1. Run the migration (enqueues re-embed jobs)
Point at prod `MONGO_URI` + a reachable `REDIS_URL`, workers running (in-process or `npm run worker`).
**Set `VIBE_ENRICH=false` for the run** — the migration re-enqueues every row, and the worker's LLM
vibe-enrich step writes `AudioFeature.vibeTags` that nothing currently consumes for the vector
(it was only ever a genre-bag fallback, now removed). Leaving it on burns ~50 large Groq prompts and
contends with live traffic for zero benefit.
```
VIBE_ENRICH=false node backend/app/scripts/reembedCorpus.js
```
Tunables (all footgun-clamped): `REEMBED_BATCH_SIZE` (default 200), `REEMBED_THROTTLE_MS` (default 250).
The script enqueues fast (~50 jobs in ~12.5s); the worker drains at its own pace. Watch for
`[reembed] done — scanned=<N> enqueued=<N> batches=<N>` and reconcile any `[reembed] a batch … failed
to enqueue` warnings (a failed batch leaves those rows diluted — re-run to pick them up; idempotent).

## 2. Wait for the embed queue to drain
The `EMBEDDING_BUILD` worker rebuilds each vector (deterministic, genre-free). With `VIBE_ENRICH=false`
this is pure CPU — seconds to a couple minutes for 10k keys. Confirm the queue is empty before verifying.

## 3. Verify — the closing evidence (MongoDB MCP, read-only)
The fix is NOT proven by the test suite alone; these two checks are the real behavioral proof:

- **Corpus is genre-free:** aggregate over `trackembeddings` — every row's `vector` dims 6-69 must be
  all zero (0 genre-bag mass) for BOTH legacy and `mbid:` rows. Re-run the exact distributional check
  that found the bug (`avgFeatureSumSq`/`avgGenreSumSq` split by origin) — both origins should now show
  ~100% feature-mass / ~0% genre-mass (no more 47.5% vs 99.4% asymmetry).
- **Discovery representation recovered:** re-run the top-500 `$vectorSearch` composition sample (calm +
  energetic feature-only targets) — AcousticBrainz (`mbid:`) share of nearest-neighbor hits should rise
  from the ~1% observed pre-fix toward its ~49.5% corpus share. This is the behavioral close-out.

## Rollback
None needed — the migration only rebuilds vectors deterministically (idempotent, convergent). If
interrupted, re-run; already-rebuilt rows converge to the identical vector.
