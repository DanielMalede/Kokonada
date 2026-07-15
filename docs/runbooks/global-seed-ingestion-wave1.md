# Runbook — Global Seed Ingestion (Wave 1 data run)

The Wave-1 code is merged and **dark** (`GLOBAL_SEED_INGEST_ENABLED` unset). This runbook feeds it real
CC0 data and validates the discovery uplift. Steps that touch Railway/Atlas are **Pause & Guide** — the
agent cannot perform them.

## 1. Acquire the AcousticBrainz CC0 dump (Daniel / ops)
- Download from **https://acousticbrainz.org/download** (CC0). You need BOTH the **high-level** and
  **low-level** dumps (low-level carries `rhythm.bpm` + `lowlevel.average_loudness`; high-level carries
  the mood models + danceability). The full set is ~7.5M recordings — for Wave 1 take a **bounded slice**
  (e.g. the first N shards, or filter to a set of MBIDs from ListenBrainz popularity).
- **First: confirm the tarball host is still live** (the project is frozen; the download page was live at
  audit time 2026-07-15 but verify): `curl -I <tarball-url>`.

## 2. Normalize to NDJSON (data-prep)
The reader (`acousticBrainzDump.readBatch`) consumes an **NDJSON file: one MERGED record per line**, where
each record is the high-level + low-level JSON joined by MBID, shaped like:
```json
{"metadata":{"tags":{"musicbrainz_recordingid":["<MBID>"],"artist":["…"],"title":["…"]}},
 "rhythm":{"bpm":120},"lowlevel":{"average_loudness":0.8},
 "highlevel":{"danceability":{"all":{"danceable":0.7}},"mood_happy":{"all":{"happy":0.6}},
   "mood_sad":{"all":{"sad":0.2}},"mood_aggressive":{"all":{"aggressive":0.3}},
   "mood_party":{"all":{"party":0.5}},"mood_relaxed":{"all":{"relaxed":0.4}},
   "mood_acoustic":{"all":{"acoustic":0.65}}}}
```
Produce this NDJSON from the two dumps (join by MBID). A prep script is a small follow-up; only the fields
above are consumed — extras are ignored, and any line lacking `musicbrainz_recordingid` is skipped.

## 3. Configure env (Railway = Pause & Guide)
- `GLOBAL_AB_DUMP_PATH` = absolute path to the NDJSON from step 2 (must be readable by the worker service).
- `GLOBAL_SEED_INGEST_ENABLED=true` (flips the schedule AND the worker ON).
- `GLOBAL_SEED_BATCH` (records/run, default 200) and `GLOBAL_SEED_CRON` (default `0 3 * * *`) — start small.
- `GLOBAL_SEED_TRACK_CAP` (per-run cap, default 500), `GLOBAL_AB_CONFIDENCE` (default 0.85).
- Workers must be running: `RUN_WORKERS_IN_PROCESS=true` + `REDIS_URL` (in-process) OR the dedicated
  `npm run worker` service. Genres use the LLM path — ensure `LLM_API_KEY` is set.

## 4. Trigger + verify (MongoDB MCP, read-only)
Let one scheduled run fire (or enqueue `GLOBAL_SEED_INGEST` once). Then confirm:
- `db.trackcatalogs.countDocuments({source:'global'})` > 0, keys are `mbid:<MBID>`, **`uri` is null** (no platform id).
- `db.audiofeatures.countDocuments({source:'acousticbrainz'})` rose; `db.trackembeddings` count rose.
- Global rows carry non-empty `genres` (LLM). No `spotify:`/`youtube:` recordingKey on any `source:'global'` row.
- Re-run the discovery diagnostic (`$vectorSearch` against `trackembeddings`, exclude the user's library):
  the non-library **discoverable pool and `kept`/`bandKept` should rise above the 1529 library ceiling**.
- On device, confirm a Spotify user can still resolve + play a canonical global track (via `translateToSpotify`).

## 5. Recalibrate `DISCOVERY_MIN_COSINE` (mixed corpus)
AcousticBrainz's mood-derived energy/valence/acousticness have different semantics than the old
Spotify-trained targets, so the cosine geometry shifts. After a real slice is ingested, repeat the #135
empirical method: run `$vectorSearch` with a few realistic mood targets against the mixed corpus, read the
score distribution + non-library survivor counts, and set `DISCOVERY_MIN_COSINE` to admit a healthy pool
without letting in garbage. (Wave-1 note: genre-rich global rows can later have `DISCOVERY_FEATURE_ONLY_TARGET`
flipped OFF for that segment — a Wave-2 item.)

## Rollback
Set `GLOBAL_SEED_INGEST_ENABLED` unset/false → schedule + worker go dark immediately. Global rows are
isolated by `source:'global'` for targeted cleanup: `db.trackcatalogs.deleteMany({source:'global'})`
(+ the matching `audiofeatures`/`trackembeddings` by `mbid:` recordingKey) if a full purge is ever needed.
