# Runbook — T5: DISCOVERY_GENRE_RELEVANCE prod composition sweep (Pause & Guide)

> Branch `feat/discovery-genre-relevance`. This is the #135-style empirical before/after proof that must
> pass BEFORE `DISCOVERY_GENRE_RELEVANCE=true` is ever set in prod. Read-only. Daniel runs it (auto-mode
> blocks agent prod access — same as the #139 migration). The flag is **default OFF**; merging the branch
> ships nothing live until you flip it here.

## What the seam does (one line)
When `DISCOVERY_GENRE_RELEVANCE=true`, discovery passes `queryGenres = aiParams.seed_genres` into `find()`,
which adds `DISCOVERY_GENRE_WEIGHT · Jaccard(queryGenres, candidate.genres)` on top of the feature cosine to
**rerank the already-retrieved pool**. It does NOT change the query vector (stays genre-free — #139 invariant)
and adds ZERO new external egress.

## The two metrics (never conflate)
- **M_retrieval** — mbid: share of the top-N `$vectorSearch` pool. Embedding geometry. The seam does NOT move it.
- **M_served** — mbid: share of the final k the user gets. The seam moves this, **bounded by M_retrieval**.

## Run
```
# baseline (flag OFF is irrelevant — the script passes queryGenres to find() directly; it needs no flag):
railway run -p <projectId> -e production -s kokonada-backend -- \
  node app/scripts/measureDiscoveryComposition.js --runs 3 --weights 0.1,0.15,0.25,0.35
```
- One invocation prints the whole sweep: a `preflight` line, then per archetype `retrievalK`, `served=OFF`,
  and `served=ON weight=<w>` lines (energetic, calm, moderate, happy-dance, sad-acoustic).
- Read-only: no writes, no queue, no Redis cache write-through (verified by both auditors). Safe to re-run.
- Optional: to reproduce prod band tolerance in the membership check, prefix the live `BAND_*` env
  (`BAND_W_MIN`, `BAND_W_MAX`, `BAND_C0`, `BAND_K`, `BAND_E_TOL`) — the harness's `withinBand` honors them.

## Step 0 — PRE-FLIGHT go/no-go (before trusting any weight)
On the `preflight` line:
- **`mbidGenreCoverage`** — fraction of mbid: corpus rows carrying non-empty genres. If this is near-zero, the
  Jaccard boost has no fuel and the seam is INERT → STOP; fix the genre backfill first (this is the live
  unknown from the `inferArtistGenres` case-mismatch that only re-landed in `756c7e3`). Expect it high (~0.85)
  if Wave-1 + the case-fix populated genres; verify, don't assume.
- Per archetype, **`jaccardHitRate`** on the ON lines — if ~0 everywhere, query vocab doesn't overlap corpus
  genres → seam inert → STOP before tuning weight.

## Step 1 — Read the results against the LOCKED success bars
Decision (2026-07-16): **non-uniform recovery, where mbid genuinely fits.** Uniform 49.5% is NOT the goal.
- **PRIMARY (ship gate):** `servedOnMbidShare` (ON) lifts materially over `servedOffMbidShare` (OFF) at the
  targets with real pool mass, **monotonic in weight** up to the chosen value:
  - moderate ~5% → **≥20%**, happy-dance ~10% → **≥25%**, sad-acoustic ~17% → **≥30%**.
- **Energetic/calm may stay ~1–2% — that is CORRECT** if `mbidShare500` (M_retrieval) confirms the pool has
  almost no energetic/calm mbid (genuine CC0 scarcity, not miscalibration). Do NOT force these up; the
  energetic fix, if ever wanted, is new energetic CC0 ingestion — NOT lever (a).

## Step 2 — GUARDRAILS (any failure ⇒ keep the flag OFF)
- **Band adherence = HARD FAIL (locked decision).** On each ON line check **`admitsExtraOOB`** (true ⇒ ON
  admitted a higher out-of-band rate than OFF) and **`outOfBandRate`** ON vs OFF. Any ON weight where
  `admitsExtraOOB=true` or `outOfBandRate` rises meaningfully over OFF = **REJECT that weight** (a mbid lift
  bought with out-of-band tracks is not a win). `energyDelta`/`bpmDelta` (with `/nN` sample sizes) are the
  directional cross-check. Note `featureless=` served tracks pass the band by design (as in prod) — watch it
  doesn't balloon under ON.
- **No legacy collapse / no mbid monoculture.** Legacy share must stay healthy; MMR's same-artist cap guards
  monoculture. A `servedCount` far below k on any line = a thin/degenerate run — discount it (don't read the
  all-zeros of an empty served set as "clean").

## Step 3 — Choose the weight & flip (Daniel's action, after merge)
- Pick the **lowest** `DISCOVERY_GENRE_WEIGHT` that clears the PRIMARY bars with guardrails intact (start 0.15;
  ceiling 0.35, never above the 0.5 clamp). Archive the OFF-vs-ON per-target table in the PR.
- Only then set `DISCOVERY_GENRE_RELEVANCE=true` (+ the chosen `DISCOVERY_GENRE_WEIGHT` if ≠ 0.15) in prod env.
- **Rollback:** `DISCOVERY_GENRE_RELEVANCE=false` (or `DISCOVERY_GENRE_WEIGHT=0`) — instant, no migration.

## Fidelity caveat (read the numbers as a CEILING)
The harness calls `find()` **without** `targets`/`DISCOVERY_BAND_AWARE`, with an empty exclude set — so the
in-`find` band filter never runs and familiars aren't excluded. The reported mbid share/lift is an **upper
bound** on a real band-aware, familiar-excluded feed. The band guardrail is supplied separately as the
per-track `withinBand` membership count above. If even this ceiling shows no lift, the seam is not worth flipping.

## Phase-2 trigger (only if warranted)
If M_served stays starved at a target where mbid SHOULD fit AND `mbidShare500` (M_retrieval) shows real mbid
mass there (i.e. the pool has them but the rerank isn't surfacing them) → consider a clamped
`DISCOVERY_OVERFETCH`/`DISCOVERY_BAND_OVERFETCH` bump first. Feature recalibration (lever a) is the last resort,
justified ONLY if diagnostics attribute the gap to miscalibration, not catalog shape.
