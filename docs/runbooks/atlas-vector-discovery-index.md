# Atlas Vector Search index — discovery corpus (Pause & Guide)

In the MongoDB Atlas UI → your cluster → **Atlas Search** → **Create Search Index** →
**JSON editor** → Database `<prod db>`, Collection `trackembeddings`, name = value of
`ATLAS_VECTOR_INDEX` (default `track_embedding_index`):

```json
{
  "fields": [
    { "type": "vector", "path": "vector", "numDimensions": 70, "similarity": "cosine" }
  ]
}
```

Wait until status is **READY**. Until then `queryNear` returns `[]` and discovery stays OFF
(the app logs a one-shot `[vectorIndex] $vectorSearch failed once` warning). Set
`VECTOR_DISCOVERY=true` on Railway ONLY after the index is READY and the backfill has run.

## Gated rollout order

1. Merge the PR with `VECTOR_DISCOVERY` OFF — zero behaviour change.
2. **Pause & Guide:** Daniel creates the Atlas vector index above (this is a cloud-portal
   step — never attempted from code); confirm status is **READY**.
3. Run the one-time backfill (`node backend/app/scripts/backfillDiscoveryCorpus.js`) off-peak;
   watch for the `[backfill] done profiles=<n> tracks=<m>` line and Groq spend.
4. Verify corpus size and that `[vectorIndex]` logs no failure warning; then set
   `VECTOR_DISCOVERY=true` on Railway.
5. Watch the `[discovery] candidates=… hits=… kept=… latencyMs=… indexReady=…` metric line
   (hit-rate, latency) plus on-device discovery quality. The `[]`-on-any-failure fallback
   guarantees no regression if the index is not READY or the corpus is thin.
