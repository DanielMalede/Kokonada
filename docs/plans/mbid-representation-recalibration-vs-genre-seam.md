# Design Plan — Restoring `mbid:` Corpus Representation in Discovery: Feature Recalibration (a) vs Genre-Jaccard Seam (b)

> **Status:** DRAFT — awaiting Daniel's approval before implementation.
> **Date:** 2026-07-15 · **Author:** architect (design pass, read-only).
> **Origin:** follow-up to PR #139 (genre-bag dilution fix, merged `2e005e4`). The dilution fix is DONE and
> PROVEN (corpus 100% genre-free, both origins). This plan addresses a SEPARATE finding surfaced by #139's
> closing evidence: removing dilution did not restore `mbid:` (AcousticBrainz CC0) discovery representation.
> **Related:** ADR-0010 (Discovery Engine ⊥ Runtime Resolver); PR #135 (feature-only target + min-cosine retune);
> memory `embedding-genre-dilution-fix`, `mbid-representation-followup`.
> **Measured evidence (prod 2026-07-15):** top-500 $vectorSearch `mbid:` share is target-dependent —
> energetic 1.2%, calm 1.6%, moderate 5.0%, happy-dance 10.4%, sad-acoustic 17.6% (avg ~7% vs 49.5% corpus
> share). Per-dim feature distributions: energy 0.34±0.26 (mbid) vs 0.57±0.19 (legacy); danceability 0.43±0.36
> vs 0.59±0.15; loudness −13.8±18.0 vs −9.5±4.1; valence/acousticness/bpm comparable. Legacy = dense/tight
> commercial cluster; mbid = diffuse/calmer CC0 catalog.

---

## 1. Problem statement & the invariant

PR #139 removed genre-bag **dilution** from the stored embedding — the worker now always writes
`buildVector(doc, [])` (`backend/app/workers/embedding.worker.js:78`), and `reembedCorpus.js` migrated the
whole corpus to genre-free. Dilution is proven fixed, but the provider-agnostic `mbid:` (AcousticBrainz CC0)
slice — 49.5% of the corpus — is still **under-represented in discovery results**, unevenly by target. Root
cause is a **feature-space / calibration + catalog-shape** effect: legacy (Spotify/YouTube) is a dense, tight
cluster of loud/energetic/danceable tracks; `mbid:` is diffuse and skews calmer/quieter. So legacy floods the
nearest-neighbor pool wherever a target sits near its dense cluster.

**Invariant that must not break (from #139):** the stored/searched `TrackEmbedding.vector` stays
**genre-free** — dims 6–69 zero (`embedding.worker.js`, `mongoAtlasVectorAdapter.js`). Any fix must preserve
the feature-only vector geometry. Additional hard constraints: **Spotify-ToS HALT** (no new Spotify data to any
LLM), **Discovery ⊥ Runtime Resolver** (ADR-0010, `mbid:` / `uri:null` corpus), and the #135 rule that a
discovery-ranking change is proven only by a **prod-measured before/after composition sweep**, not unit tests.

### A load-bearing correction to earlier framing (verified in code)

An earlier note said lever (b) "requires turning `DISCOVERY_FEATURE_ONLY_TARGET` off." **That is incorrect and
would re-break retrieval.** Reading `discoveryVectorService.find()` and `discoveryFetch.js`:

- `seedGenres` (→ the query **vector**'s genre bag, `targetVector.buildTargetVector` → `buildVector`) and
  `queryGenres` (→ the scoring-layer `_scoreTotal` boost) are **two orthogonal parameters**.
  `DISCOVERY_FEATURE_ONLY_TARGET` gates only `seedGenres` (`discoveryFetch.js:59`).
- `aiParams.seed_genres` is present **regardless** of that flag; feature-only-target only decides whether it
  flows into the *vector*.
- Turning feature-only-target OFF would re-seed the query vector's 64-dim genre bag → orthogonal to the
  genre-less corpus → cosine collapse below `DISCOVERY_MIN_COSINE` → the exact #135 starvation.

**Correct activation of lever (b):** keep `DISCOVERY_FEATURE_ONLY_TARGET` **ON** (`seedGenres = []`, vector
stays genre-free → invariant preserved), and **additionally** thread `queryGenres = aiParams.seed_genres` into
`find()`. The two are independent; the genre signal lives purely in the scoring layer.

### A second load-bearing finding: lever (b) reranks, it does not re-retrieve

`_scoreTotal` (`discoveryVectorService.js:81-85`) is applied only to `survivors`/`candidates` — the set that
**already** passed ANN retrieval (`vectorIndex.queryNear`), `minCosine`, exclude-library, and the band
post-filter. It reranks that pool; it **cannot pull in `mbid:` tracks the ANN retrieval did not return.**
Two different metrics exist and must not be conflated:

- **M_retrieval** — `mbid:` share of the top‑N `$vectorSearch` pool (the prod "top-500" numbers). A property
  of the **embedding geometry**. Lever (a) moves this; lever (b) does **not**.
- **M_served** — `mbid:` share of the final `k` tracks `find()` returns (after threshold, band, `_scoreTotal`,
  MMR). This is **what the user actually gets**. Lever (b) moves this; lever (a) moves it indirectly.

Consequence: lever (b) is **bounded by the retrieval-pool composition**. Where the pool is ~1% `mbid:`
(energetic, calm), reranking can promote at most that ~1%. Where the pool has real `mbid:` mass
(moderate/happy/sad, 5–17%), reranking can lift M_served substantially. Retrieval pool =
`k · overfetch` = 180 (non-band) or 360 (band-aware; `bandOverfetch()` default 12, clamp ≤16), with Atlas
`numCandidates = (k·overfetch)·10` bounded under the 10 000 cap.

## 2. Decision table — Lever (a) Feature Recalibration vs Lever (b) Genre-Jaccard Seam

| Axis | (a) Quantile-matching feature recalibration | (b) Activate the genre-Jaccard scoring seam |
|---|---|---|
| **Mechanism** | Per-dim transform of `mbid:` (and/or legacy) feature values so both sources share a common CDF; changes the **embedding geometry** → changes M_retrieval directly. | Pass `queryGenres = aiParams.seed_genres` into `find()`; `_scoreTotal` adds `genreWeight()·Jaccard(queryGenres, candidate.genres)` on top of feature cosine → reranks the retrieved pool → changes M_served only. |
| **Expected `mbid:` recovery** | High **at the retrieval layer** — evens M_retrieval across targets. BUT can be *false*: forces `mbid:`'s marginal onto legacy's, mis-placing genuinely-calm CC0 tracks toward loud/energetic targets (band-violating). Recovers the *number*, not necessarily the *right tracks*. | Medium, **target-dependent and bounded by M_retrieval**. Strong where `mbid:` already has pool mass (moderate 5%→ plausibly ≥20%; sad-acoustic 17%→ ≥30%). Weak/none where the pool is ~1% (energetic, calm) — which may be **semantically correct** (CC0 catalog genuinely skews calm/quiet). Vocabulary alignment favorable: mbid genres and query `seed_genres` both come from the **same Groq `inferArtistGenres` prompt** → shared lowercase sub-genre vocabulary → real Jaccard overlap probability (a validation gate). MMR's own genre-Jaccard similarity caps `mbid:` monoculture. |
| **Implementation complexity** | High. Compute per-dim CDFs; choose a reference; implement invertible mapping; decide *where* it lives; regenerate embeddings; keep it reproducible for future ingest. New versioned calibration artifact. | Low. One `queryGenres` wire in `discoveryFetch.js` behind a new activation flag. `_scoreTotal`, `genreWeight()` clamp, and the `queryGenres` param **already exist** and are unit-test-ready. |
| **Blast radius / risk** | **Large.** `acousticBrainzFeatures.mapRecord` feeds BOTH the embedding AND the `AudioFeature` store. Recalibrating at `mapRecord` corrupts raw features that `withinBand`/`featuresOf` (band post-filter), `mmr._featureSim`, and the **runtime resolver** all read → semantic drift in band + the body→music contract. Recalibrating *only* at embed time **desyncs** embedding from raw features → ANN retrieves a track the band then drops. Touches `features/`, `vector/`, `selection/` band, discovery, runtime. | **Small, scoring-layer only.** Confined to `discovery/`. No feature-store, band, or runtime touch. `seedGenres` stays `[]` → vector geometry byte-identical → **dilution invariant intact**. Only side effect: candidate ordering into MMR. |
| **Reversibility** | **Poor.** Baked into stored vectors; rollback needs another full re-embed. Reference choice sticky. | **Excellent.** Single env flag / weight → instant, zero-migration rollback (`DISCOVERY_GENRE_RELEVANCE=false` or `DISCOVERY_GENRE_WEIGHT=0`). Dormancy is the default. |
| **Migration cost (re-embed?)** | **Yes — a full re-embed** of ≥4957 `mbid:` rows (all 10 019 if reference = pooled), re-running `reembedCorpus.js`. Plus a stored versioned calibration table for consistent future ingest. | **None.** Scoring-layer term; no write to `TrackEmbedding`. |
| **Validation burden** | High. Must prove M_retrieval evened **and** band adherence / served quality did not degrade (false-recovery risk). Re-run after every reference-choice iteration. | Moderate. #135-style prod sweep of **M_served** OFF vs ON + weight tuning. Cheaper — flip a flag, re-measure; no re-embed between iterations. |
| **Compliance / ToS exposure** | **Zero new egress** — pure math on already-stored CC0-derived features. HALT-neutral. | **Zero new egress** — `queryGenres` are `seed_genres` already computed and present in `aiParams`; passing them to `find()` sends nothing to any LLM. Inherits, does not worsen, the upstream `seed_genres` posture (the open profile-build HALT is a *separate* flow). |
| **Rough effort** | **L** — multi-day: design + implement transform + resolve raw/embedding desync + full re-embed + multi-iteration validation. | **S–M** — ~1 developer task: wire + tests + validation harness + one Pause-&-Guide prod sweep. |
| **Key unknown** | Is the per-target skew a *calibration artifact* (fixable, legitimate) or a *genuine catalog-shape difference* (forcing it = false representation)? Unproven — if the latter, (a) actively harms the band. | Does the Groq query-genre vocabulary actually overlap the Groq corpus-genre vocabulary densely enough for Jaccard to fire? Favorable by construction, must be measured on real corpus rows before trusting the weight. |

## 3. Recommendation — phased **(b)-first, (a) only if proven necessary**

**Do lever (b) now, flag-gated and validated. Hold lever (a) as a conditional Phase 2.** Rationale:

1. **Blast radius & the invariant decide it.** (b) is a self-contained scoring term inside `discovery/` that
   provably preserves the #139 genre-free-vector invariant (the seam was *designed* for exactly this). (a)
   reaches into the shared `AudioFeature` store that the biosonic band and the runtime resolver depend on —
   the highest-coupling surface in this slice — and cannot be done without either corrupting band semantics or
   desyncing embedding from raw features. Fix at the narrowest correct seam: (b).
2. **Reversibility & migration cost.** (b) rolls back with one env var and needs no re-embed; (a) bakes into
   stored vectors and needs a full re-embed to install *or* revert. For an unproven hypothesis, choose the
   reversible lever.
3. **(a) risks a *false* fix.** Quantile-matching assumes the two sources *should* share a marginal
   distribution. The evidence (mbid genuinely calmer/quieter/less danceable) suggests part of the skew is a
   **real catalog-shape difference**, not miscalibration. Forcing mbid onto legacy's distribution would surface
   genuinely-calm CC0 tracks for energetic targets — a **band/vision violation** dressed up as "recovery."
   Uniform 49.5% everywhere is the wrong goal (§5).
4. **(b) fixes the right thing where it matters.** It promotes `mbid:` where it is *both* feature-plausible
   (survived retrieval + band) *and* genre-relevant — a true, band-respecting recovery — and the
   same-Groq-prompt vocabulary alignment makes the Jaccard signal live rather than dead.

**Phase 2 trigger (conditional):** pursue lever (a) only if §5 validation shows M_served remains genuinely
starved at targets where `mbid:` *should* be present, AND diagnostics attribute the gap to calibration rather
than catalog shape. Even then, prefer a **non-destructive** design (store calibrated features in a *separate*
field, never overwrite raw `AudioFeature`; reference = pooled; flag-gated; fresh re-embed with rollback). A
cheaper intermediate before ever touching (a): a modest, already-clamped **overfetch bump**
(`DISCOVERY_OVERFETCH` / `DISCOVERY_BAND_OVERFETCH`) to widen the rerank pool so (b) has more `mbid:` to promote.

## 4. Dependency-ordered, TDD-ready plan — RECOMMENDED lever (b)

DAG: T1→T2 (tests before wire); T3 unit-tests the existing blend math (parallel with T1/T2); T4 (validation
harness) is code-independent but its *run* (T5) gates rollout. All backend, single package — one `developer` +
`resilience-auditor` gate; `compliance-auditor` sign-off is light (zero new egress) but still required (it is a
discovery-ranking change).

**Flags (all in the existing env-guard footgun-clamp style):**
- `DISCOVERY_GENRE_RELEVANCE` — NEW activation switch in `discoveryFetch.js`, **default OFF**. Only when
  `=== 'true'` does `queryGenres` get passed. Single-flag rollback.
- `DISCOVERY_GENRE_WEIGHT` — EXISTS, `genreWeight()` default 0.15, clamp [0, 0.5]. The blend weight to tune.
- `DISCOVERY_FEATURE_ONLY_TARGET` — **leave ON** (unchanged). Turning it off re-breaks retrieval.
- Optional: `DISCOVERY_OVERFETCH` / `DISCOVERY_BAND_OVERFETCH` — EXISTS, clamped — only if the pool is too thin.

### T1 — Test-first: activation wiring in `discoveryFetch`
Extend `backend/tests/discoveryWiring.test.js`:
1. Flag OFF (default): `find()` receives **no** `queryGenres` (dormancy guard stays green).
2. `DISCOVERY_GENRE_RELEVANCE=true`: `find()` receives `queryGenres` deep-equal to `aiParams.seed_genres`.
3. **Vector-invariant guard (critical):** even with genre-relevance ON, `seedGenres === []` when
   `DISCOVERY_FEATURE_ONLY_TARGET` is default-ON — proves the query *vector* stays genre-free while only the
   *scoring* term is genre-aware.
4. Env hygiene: `afterEach` deletes `DISCOVERY_GENRE_RELEVANCE`.

### T2 — Wire `queryGenres` in `discoveryFetch.vectorDiscoveryFetch`
`backend/app/services/discovery/discoveryFetch.js`: add
`genreRelevanceEnabled = () => process.env.DISCOVERY_GENRE_RELEVANCE === 'true'`. In the `find({...})` call,
conditionally add `queryGenres: genreRelevanceEnabled() ? (Array.isArray(aiParams.seed_genres) ? aiParams.seed_genres : []) : []`.
Leave the `seedGenres` line untouched. Acceptance: T1 green; all pre-existing `discoveryWiring` tests stay green.

### T3 — Unit-pin the blend math + footgun clamps (parallel with T1/T2)
Add `backend/tests/discoveryVectorService.scoreTotal.test.js` (or equivalent):
1. Empty `queryGenreSet` → returns `featureCosine` unchanged (dormancy).
2. One overlapping genre, query {g}, candidate {g,x,y} → `featureCosine + 0.15 · (1/3)`.
3. Case-insensitivity: `['House']` vs `['house']` → match.
4. `genreWeight()` clamp: blank/`''`→0.15; `'0'`→0; `'0.9'`→0.5; `'-1'`→0; non-numeric→0.15.
5. **find()-level fixture (fakeVectorIndex):** equal-cosine genre-less legacy rows + genre-tagged `mbid:` rows;
   with matching `queryGenres`, assert `mbid:` candidates rank above legacy in `find()`'s returned order.

### T4 — Read-only prod composition harness (NEW script)
`backend/app/scripts/measureDiscoveryComposition.js` (read-only; mirrors `countFeatureless.js` CLI/`railway run`):
for the fixed prod archetype sweep (energetic, calm, moderate, happy-dance, sad-acoustic), report per target:
- **M_retrieval**: `vectorIndex.queryNear(buildTargetVector(features, []), { k: N })`, bucket by `mbid:` prefix.
- **M_served OFF** and **M_served ON**: `find({ targetFeatures, queryGenres: [] })` then
  `{ ..., queryGenres: <seed_genres> }`, bucket returned `k`. Average over seeds to damp MMR noise; print per-target
  Jaccard hit-rate (how often candidate genres intersect queryGenres). Zero writes.

### T5 — Empirical validation run + weight tuning (Pause & Guide)
Run T4 on prod read-only with flag OFF then ON, sweep `DISCOVERY_GENRE_WEIGHT ∈ {0.1, 0.15, 0.25, 0.35}`.
Record before/after. `resilience-auditor` reviews for false-greens (mbid lift that violates band, or legacy
collapse). Only after §5 criteria met does the flag flip to `true` in prod env.

**Non-recommended lever (a) — sketch (kept so it is not lost):**
1. New `backend/app/services/features/featureCalibration.js`: per-dim empirical CDFs from the corpus (offline,
   versioned artifact); `calibrate(features, origin)` maps source→pooled reference (**reference = pooled marginal**).
2. Store calibrated values in a **separate** field/collection — **never overwrite** raw `AudioFeature` (band +
   runtime read raw). Document the deliberate embedding↔band divergence, or recalibrate the band too (larger scope).
3. Re-run `reembedCorpus.js` after the calibrated source feeds `embedding.worker`'s vector build.
4. Validate M_retrieval evened AND band adherence preserved. Gate hard on the false-recovery risk.

## 5. #135-style empirical validation protocol

**Metric:** `mbid:` share = `count(recordingKey startsWith 'mbid:') / total`, at **two stages** — M_retrieval
(diagnostic ceiling; geometry) from `queryNear` top‑N, and M_served (decision metric) from `find()`'s returned
`k`, **OFF vs ON**.

**Target sweep:** the five prod archetypes, each with representative `targetFeatures` **and** the `seed_genres` a
real mood would produce (drawn from `moodDescriptors` allow-lists so query vocabulary matches production — e.g.
energetic→`['electronic','house']`, calm→`['ambient','lo-fi']`, sad-acoustic→`['acoustic','singer-songwriter']`).
Include a moderate/neutral target explicitly.

**How to run (read-only, prod):** `railway run node app/scripts/measureDiscoveryComposition.js` with
`DISCOVERY_GENRE_RELEVANCE` unset (baseline) then `=true` across the weight sweep. Fixed/empty exclude set;
average per target over multiple seeds.

**Success criteria (honest, not naive uniformity):**
- **Primary:** M_served ON shows a **material lift over OFF at targets where `mbid:` genuinely fits** — e.g.
  moderate ~5%→**≥20%**, happy-dance ~10%→**≥25%**, sad-acoustic ~17%→**≥30%** — monotonic in
  `DISCOVERY_GENRE_WEIGHT` up to the chosen value.
- **Guardrail 1 (no band regression):** band-aware `bandKept` / `[selection.v2] banded=` do not fall; served
  tracks still honor the biosonic band. A lift bought by admitting out-of-band mbid tracks is a **fail**.
- **Guardrail 2 (no legacy collapse):** legacy share stays healthy; MMR still diversifies (no mbid monoculture).
- **Explicitly NOT a target:** uniform ~49.5% at every archetype. Energetic/calm may stay low because the CC0
  catalog genuinely lacks loud/energetic tracks — forcing them in would violate the band. Goal =
  **"discoverable and balanced across the mood space where mbid genuinely fits,"** not corpus-proportional
  everywhere. If energetic M_served stays ~1–2% *and* M_retrieval confirms the pool has almost no energetic
  mbid, that is a **correct** outcome — and the Phase-2 trigger question (real scarcity vs miscalibration).

## 6. Risks, footguns, rollback

- **Conflating M_retrieval with M_served (biggest analytical footgun).** Measuring only the top-N pool would
  show lever (b) doing "nothing." The harness must report **served** composition (T4 does both stages).
- **Dead Jaccard (vocabulary mismatch).** If real corpus `genres` don't overlap `seed_genres`, the boost is 0
  and (b) is inert. Favorable by construction (same Groq prompt) but unproven — T4 prints per-target hit rate;
  if near-zero, stop before tuning weight.
- **Accidentally re-seeding the vector.** A future edit setting `seedGenres` from `seed_genres` re-breaks
  retrieval (#135) and violates the invariant. T1 test 3 pins `seedGenres === []`; leave
  `DISCOVERY_FEATURE_ONLY_TARGET` untouched.
- **Weight too high → genre dominates cosine.** `genreWeight()` clamped [0,0.5] (a full 1.0 would let a genre
  match equal a whole cosine unit — a scoring echo of the removed dilution). Validation caps well under 0.5.
- **MMR noise in small `k`.** Final `k=30` → noisy per-run share. Average over seeds; optionally instrument
  pre-MMR candidate composition.
- **False recovery / band violation** — primarily a lever (a) risk; for (b), guardrail 1 catches out-of-band lift.
- **Rollback:** (b) — set `DISCOVERY_GENRE_RELEVANCE=false` (or `DISCOVERY_GENRE_WEIGHT=0`); instant, no
  migration, corpus untouched. (a) — requires a re-embed to install *and* to revert.

## 7. Open questions / human decisions before implementation

1. **Is the energetic/calm skew real scarcity or miscalibration?** Decides whether Phase 2 (lever a) is ever
   justified. T4's M_retrieval-vs-served split is the evidence; a human rules on "correct scarcity" vs "must fix."
2. **Success thresholds** in §5 are proposed, not sacred. Confirm the numeric bars and whether guardrail 1
   (band adherence) is a hard fail.
3. **Default weight** to ship after tuning — 0.15 (current default) vs a validation-chosen value.
4. **Where does `queryGenres` source from long-term?** Currently `aiParams.seed_genres` (LLM, allow-list). Note
   the upstream `seed_genres`/`topGenres` provenance sits under the **separate open Spotify-HALT**
   (`musicProfileService.inferArtistGenres`); lever (b) adds no new egress but inherits that posture — confirm
   the HALT fix (`fix/spotify-compliance-halt`) sequencing is independent and not blocked by this work.
5. **Optional overfetch bump** to widen the rerank pool for thin-pool targets — first validation sweep or defer?
6. **Compliance-auditor scope:** confirm the light sign-off (zero new LLM egress; CC0-only genre matching) is
   acceptable for a discovery-ranking change.

## Key files (repo-relative; merged code on `main` @ `2e005e4`)

`backend/app/services/discovery/discoveryVectorService.js`, `.../discovery/discoveryFetch.js`,
`.../discovery/targetVector.js`, `.../discovery/globalIngest.js`, `.../vector/embedding.js`,
`.../vector/mongoAtlasVectorAdapter.js`, `.../features/acousticBrainzFeatures.js`, `.../selection/mmr.js`,
`.../geminiEngine.js`, `.../moodDescriptors.js`, `backend/app/workers/embedding.worker.js`,
`.../scripts/reembedCorpus.js`, `.../scripts/countFeatureless.js`, `.../models/TrackEmbedding.js`,
`backend/tests/discoveryWiring.test.js`.
