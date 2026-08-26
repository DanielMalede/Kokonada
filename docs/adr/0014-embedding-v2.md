# ADR 0014 — Embedding v2: two blocks, an IDF-weighted genre bag, and tempo on a circle

- **Status:** Accepted (code shipped dark; the read cutover is HITL-blocked on an Atlas index)
- **Date:** 2026-08-22 (Wave 4 — Runtime Intelligence, W4-014)
- **Extends:** [ADR 0010](0010-global-corpus-cc0-only-provider-agnostic.md) (CC0-only global corpus),
  [ADR 0011](0011-spotify-content-containment.md) and [ADR 0012](0012-learning-compliance.md) (learning compliance)
- **Implements:** `docs/plans/WAVE4_INTELLIGENCE_MISSION.md` §M.16, §M.10; kills D19
- **Required reading:** `docs/plans/mbid-representation-recalibration-vs-genre-seam.md`
  (prod-measured corpus composition and per-dim feature distributions, 2026-07-15)

## Context

`buildVector` (v1) writes a 70-dim vector: six audio dims in `[0,1]` followed by a 64-dim hashed
genre bag, **L2-normalised jointly**. That single choice produces all three of D19's defects, and
they are measured rather than suspected:

- **(a) Tag-count crush.** The joint norm grows with the number of genre tags, so a track's audio
  signal shrinks as it gains genres. Two identical recordings, one tagged once and one tagged
  twelve times, disagree about their own energy by more than 25% (pinned in
  `tests/wave4.embeddingV2.test.js` against the real v1 function, not asserted from theory).
  PR #139 dealt with this by **deleting the genre signal**: `embedding.worker.js` has written
  `buildVector(doc, [])` ever since. The crush is therefore *latent* in `buildVector`, not live in
  the stored index — and the stored corpus is genre-free as a consequence, not by design.
- **(b) Unweighted bag.** Every tag contributes exactly 1.0, so `pop` — which roughly half an
  annotated catalogue carries — moves a vector exactly as far as a tag almost nothing carries.
  The tag that discriminates and the tag that does not are worth the same.
- **(c) Linear tempo.** `bpm / 260` places 87 and 174 bpm — the same groove read at half and
  double time, a *known structured artefact* of every beat tracker in this corpus — at maximum
  distance. W4-007 already fixed this for scoring and MMR via the octave fold in
  `selection/tempo.js`; the stored geometry was left disagreeing with the metric that ranks it.

There is a fourth problem the mission does not number, and it is the one with prod evidence
behind it: v1 vectors live entirely in the all-positive orthant, so **every pair of corpus vectors
scores ~0.99** and `DISCOVERY_MIN_COSINE` is very nearly inert as a quality gate.

## Decision

Add `buildVectorV2` (`v2-deterministic`, 135 dims) beside `buildVector`. v1 is not modified.

### 1. Two blocks, normalised independently, then composed

`[0.8 · â ; 0.6 · ĝ]` — a 7-dim audio block and a 128-dim genre block, each an independent unit
vector (§M.16). The audio half is then identical regardless of tag count: **the crush is not
mitigated, it is structurally impossible**. `0.8² + 0.6² = 1`, so a track carrying genres is
already unit-norm, and audio outweighs genre ~1.78:1 in any dot product — genre reranks *within* a
feature neighbourhood and can never override it. That is deliberately the same posture
`discoveryVectorService`'s clamped genre-Jaccard weight takes.

**The composed vector is then renormalised to unit length.** With both blocks present this is a
no-op by construction, so it never touches the 0.8/0.6 split. It bites only when a block is empty
— which is the case the mission calls out, and it is load-bearing. A genre-less track composes to
norm 0.8; without renormalisation the dot product between two genre-less tracks would be scaled by
0.64, i.e. *not* "unchanged vs audio-only", and worse, a genre-less track (norm 0.8) and a tagged
one (norm 1.0) would have incomparable scores. In a corpus that is ~98% genre-less, that would let
**annotation coverage masquerade as relevance**. Renormalised, genre-less ↔ genre-less cosine is
exactly the bare audio cosine, and v2 is a strict superset of what the corpus can express today.

### 2. IDF-weighted genre bag over the `mbid:` slice only

`w_g = log(1 + N/df_g)` (§M.16), hashed with the existing FNV-1a into 128 bins, block-L2-normalised.
`services/vector/idfStats.js` owns the statistics; `buildVectorV2` takes the table as a **parameter**
and stays pure (§0.4 S9).

- **The corpus is the `mbid:` slice, for two independent and agreeing reasons.** *Compliance:* this
  table is a persisted, cross-user artefact describing a catalogue, so fitting it over Spotify- or
  YouTube-keyed rows would encode third-party Content into it (ADR-0011/0012, mission §0.2.1). The
  embedding worker already refuses to embed those keys; the statistics behind the embedding are
  contained at exactly the same boundary, not one row wider. The containment is enforced in the
  **counting loop**, not only in the query, because `rows` is an injection point and a boundary a
  caller can step around is not a boundary. *Statistics:* an IDF must describe the population it is
  applied to, and the v2 index holds the `mbid:` slice and nothing else.
- **`N` counts genre-carrying documents, not all documents.** With `N` = the whole corpus, `N/df` is
  enormous for every genre, every weight pins to the cap, and the IDF stops discriminating — the
  exact failure the mission's W16 note warns about. Among the tracks annotated at all, "how
  selective is this tag" is the question the weight is meant to answer.
- **`df = 0` caps rather than diverging.** A genre is never treated as rarer than 1 document in 100
  (`MIN_DF_RATIO = 0.01`, so `IDF_MAX = log(101) ≈ 4.615`). Expressed as a ratio rather than a raw
  constant so it stays stable as the corpus grows.
- **A missing df table is not evidence of rarity.** A genre absent from a table that *exists* earns
  the rarity cap; a table that could not be read yields weight 0 for everything. Inferring maximal
  rarity from a table that was never loaded would turn a load failure into a confident genre
  direction.
- **Fail-soft:** no stats at all → every weight 0 → the genre block is exactly zero → v2 degrades to
  an audio-only vector. A genre-less corpus and an unknown-vocabulary corpus behave identically, and
  neither fabricates a genre signal. `idfStats` never throws into the embedding path.

### 3. Tempo on a circle

`[sin(2π·log₂ bpm), cos(2π·log₂ bpm)]`. An octave is exactly `+1` in log₂, hence exactly one full
turn, so 87 and 174 bpm land on the **same point** — D18/M.10's octave equivalence expressed as
geometry rather than recomputed at rank time. `toLog2` is imported from `selection/tempo.js` rather
than re-derived; that module exists so the octave arithmetic has one home, and its own header names
this call site. The pair also contributes a constant 1.0 to the raw block norm (`sin² + cos² = 1`),
so tempo's share of the audio block does not drift with the value.

### 4. Centred dims, and abstention as the block origin

v2 maps each bounded feature from `[0,1]` to `[-1,1]`. This is **forced, not cosmetic**: sin/cos are
already centred and their "no evidence" point is the circle's centre `(0,0)`. A block mixing centred
and uncentred dims would have two different zeros and no coherent origin, so its L2 normalisation
would mean nothing. One zero also gives an unmeasured dim somewhere honest to sit: at the origin,
contributing nothing to any dot product, instead of masquerading as a measurement — the W4-D21
defect class, where v1 read an absent loudness as a measured value. Every dim goes through
`featureProvider.measured()`, the same trust boundary the scorer uses.

A track with **no evidence at all** returns `null` rather than a vector. That follows
`tempoKernel`'s house pattern (abstain; the caller decides what "no evidence" is worth) and refuses
the specific bug W4-D21 named: a featureless track embedding to a confident direction. Callers must
not store a `null`.

Centring also fixes the ~0.99 collapse: cosine now spans `[-1, 1]` and discriminates.

## Consequences

- **`DISCOVERY_MIN_COSINE` must be re-tuned before `EMBEDDING_V2_READ` is switched on.** Its 0.3
  floor was retuned (PR #135) against v1's compressed positive-orthant scale, where corpus cosines
  cluster ~0.99. Against v2 the same number means something entirely different. This is a hard
  prerequisite of the read cutover, not a follow-up.
- **A new Atlas index is required and cannot be created by an agent.** `numDimensions` is immutable
  per index, so v2 needs `track_embedding_index_v2` (135 dims, cosine) on a separate path. That is a
  Daniel portal action — Pause & Guide. Everything ships dark behind `EMBEDDING_V2_WRITE` /
  `EMBEDDING_V2_READ`; with both unset the v1 path is byte-identical.
- **v1 stays authoritative until the cutover**, and the two are different lengths (70 vs 135), so
  nothing can silently write one into the other's index.
- **Rollback** is an env flag in both directions; v1 vectors are never overwritten.

## Alternatives considered

- **Signed hashing (Weinberger et al.).** Giving each genre a `±1` sign makes hash collisions cancel
  in expectation instead of always adding constructively. Genuinely better for the inner product,
  and deferred rather than rejected: §M.16 specifies `+= w_g`, the annotated vocabulary is small
  relative to 128 bins, and block L2-normalisation plus the 0.6 weight bound the damage. Revisit if
  measured collision bias shows up in the composition sweep.
- **Quantile-matching feature recalibration ("lever (a)").** Assessed and rejected in
  `docs/plans/mbid-representation-recalibration-vs-genre-seam.md` §2–3: it reaches into the shared
  `AudioFeature` store that the biosonic band and the runtime resolver read, and it risks a *false*
  recovery — forcing genuinely calm CC0 tracks toward loud targets. v2 changes the geometry without
  touching a single stored feature value.
- **Keeping one jointly-normalised block and simply capping tag count.** Caps the symptom; two
  tracks with 1 and 3 tags still disagree about their own energy.

---

## Addendum — the wiring half (session 55)

The core above decided the geometry. This addendum records the three decisions the plumbing forced,
because each of them is invisible in the diff and expensive to rediscover.

### 1. One resolver decides which space is live, and it decides for everyone

A vector search compares two things that must live in the same space: the **query vector** we build
and the **index + path** we search it against. Those were two independent decisions in two modules
(`discovery/targetVector.js` and `vector/mongoAtlasVectorAdapter.js`), and the failure when they
disagree is the worst kind available here:

- **dims differ (70 vs 135)** — `$vectorSearch` throws, the adapter's `catch` degrades to `[]`, and
  discovery is silently OFF with no error anywhere;
- **dims coincide** (a future v3 sized like v1) — no failure at all, just a coordinate-wise
  comparison of two unrelated geometries returning confident nonsense.

So neither module reads the flag. `services/vector/embeddingSpace.js` owns a frozen record per space
binding the four things that must move together — path, dim, model tag, index-name env — and
`discoveryVectorService.find()` resolves it **once per call** and passes the same value to the query
builder and to `queryNear`. `pipeline`'s MMR embedding load reads the same resolver, so a single
generation can never judge similarity in one space while retrieving from another. A half-flipped
cutover is now structurally impossible rather than merely unlikely.

`EMBEDDING_V2_READ` on while `EMBEDDING_V2_WRITE` is off is honoured (an operator may be mid-cutover
with a finished backfill) but warned about once: it is the one misconfiguration that looks like
success — new tracks stop entering the index, which goes stale with no symptom but slowly thinner
discovery.

### 2. The backfill re-enqueues; it does not build vectors itself

The obvious backfill reads features and genres and writes vectors directly. That would create a
second place that builds a stored vector, with its own copy of the `spotify:`/`youtube:` ToS gate,
its own genre lookup and its own model tag — and a second place is a second thing to drift. The repo
already made this call once for the same reason (`reembedCorpus.js`), so `backfillEmbeddingV2.js`
scans for rows with no `vectorV2` and re-enqueues them onto `EMBEDDING_BUILD`, where the one writer
writes. Resumability is the filter itself (`{vectorV2: {$exists: false}}`), so a killed run resumes
with no bookkeeping and a finished run scans to zero.

The cost of that choice, stated honestly: the worker resolves the IDF table through `idfStats.peek()`
(6h cache), so a long run rebuilds the table a few times instead of once. Accepted, and bounded by
the maths — document frequencies over a near-static catalogue move by `O(1/N)` between refreshes, the
genre block is L2-normalised per vector so a uniform weight shift divides straight back out, and what
survives is far below the scale at which cosine discriminates. Re-running is idempotent, so any row
built against a stale table can simply be rebuilt.

The script refuses to start when `EMBEDDING_V2_WRITE` is off, because otherwise it would re-embed the
whole corpus, write no v2 vector, and report a confident "done".

### 3. Annotation MATCH is worth exactly 0.8 — the second cutover prerequisite

Measured, not derived after the fact (`tests/wave4.embeddingV2Wiring.test.js`, section 7):

| query | vs untagged candidate | vs tagged candidate |
|---|---|---|
| feature-only (`DISCOVERY_FEATURE_ONLY_TARGET` default) | **1.00** | **0.80** |
| genre-seeded | 0.80 | 1.00 |

A v2 vector's genre block is `0.6` of a unit vector when the track is tagged and **exactly zero**
when it is not, so the query and the candidate must agree about whether genre evidence exists. The
`0.8` is not an estimate — it is the composition weight.

Neither direction is a defect, and neither is fixable by tuning a weight: it is what cosine length
normalisation *means* when a document carries a field the query does not. Giving untagged tracks a
synthetic "unknown" bin would cancel the factor and is rejected for the reason the core rejects
everywhere else — it fabricates a genre direction, and it would make all untagged tracks mutually
similar in genre space.

What it changes is the cutover. The corpus is ~98% genre-less, so a genre-seeded v2 query hands ~98%
of the corpus a flat `0.8` handicap — the PR #135 starvation mechanism wearing a different hat —
while a feature-only v2 query systematically buries the annotated slice v2 exists to exploit.
`DISCOVERY_FEATURE_ONLY_TARGET` and `DISCOVERY_MIN_COSINE` therefore **stop being independent
settings** the moment `EMBEDDING_V2_READ` flips, and must be swept together with
`app/scripts/measureDiscoveryComposition.js` rather than one at a time. Recorded in H13 next to the
floor retune.
