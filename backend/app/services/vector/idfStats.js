'use strict';

// Corpus genre document frequencies for the v2 embedding's genre block (W4-014, §M.16).
//
// WHY THIS EXISTS
// v1's genre bag was UNWEIGHTED: every tag added 1.0 to its bin, so `pop` — a tag half the
// corpus carries — moved a vector exactly as far as `norwegian black metal`, which almost
// nothing carries. The tag that discriminates and the tag that does not were worth the same.
// §M.16 fixes that with the standard inverse-document-frequency weight `w_g = log(1 + N/df_g)`:
// the rarer a genre is in the corpus, the more it says about a track that has it.
//
// WHY THE CORPUS IS THE `mbid:` SLICE ONLY
// Two independent reasons, and they agree:
//   1. COMPLIANCE (ADR-0011/0012 · mission §0.2.1). This table is a PERSISTED, CROSS-USER learned
//      artefact — a statistical description of a catalogue. Fitting it over Spotify- or
//      YouTube-keyed rows would encode third-party Content into it. `embedding.worker.js` already
//      refuses to embed a `spotify:`/`youtube:` key; the statistics behind that embedding are
//      contained at exactly the same boundary, not one row wider.
//   2. STATISTICS. An IDF must describe the population it will be applied to. The v2 index holds
//      the `mbid:` (AcousticBrainz CC0) slice and nothing else, so document frequencies drawn
//      from any other slice would be describing a corpus that is never searched.
//
// WHY N COUNTS GENRE-CARRYING DOCUMENTS, NOT ALL OF THEM
// The corpus is ~98% genre-less (`discoveryFetch.js` header; PR #139's closing evidence). With
// N = every document, `N/df` is enormous for EVERY genre, every weight pins to the cap, and the
// IDF stops discriminating — the exact failure mode the mission's W16 note warns about ("IDF
// stats must handle a mostly-genre-less corpus"). Counting only documents that carry at least
// one genre makes the weight measure what it is meant to measure: among the tracks that are
// annotated at all, how selective is this tag. Genre-less documents are not evidence about
// genre vocabulary; they are absence of evidence.
//
// FAIL-SOFT
// No stats at all (empty corpus, cold cache, a failed load) → every weight is 0 → the genre block
// is exactly zero → `buildVectorV2` degrades to an audio-only vector. That is the SAFE direction:
// a genre-less corpus and an unknown-vocabulary corpus should behave identically, and neither
// should fabricate a genre signal. The one thing this module must never do is throw into the
// embedding path.

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — a corpus vocabulary moves on the ingestion cadence, not per request

// A genre is never treated as rarer than 1 document in 100. Without a floor, an unseen genre
// (df = 0) is a divide-by-zero → Infinity, and a genuinely-unique genre in a 10k corpus would
// outweigh a 1%-frequency one by ~2x for no informational reason: below ~1% the tag is
// "essentially unique" and every such tag deserves the same weight. Expressing the cap as a
// document-frequency RATIO rather than a raw constant keeps it stable as the corpus grows.
const MIN_DF_RATIO = 0.01;
const IDF_MAX = Math.log(1 + 1 / MIN_DF_RATIO); // = log(101) ≈ 4.615

const EMPTY = Object.freeze({ v: 1, n: 0, df: Object.freeze({}), computedAt: 0 });

// Genre keys are normalised the way `TrackCatalog` and `mmr._jaccardSets` already compare them:
// lowercased and trimmed. A blank key is not a genre.
function normalizeGenre(g) {
  if (typeof g !== 'string') return null;
  const s = g.toLowerCase().trim();
  return s || null;
}

const finiteNonNeg = (x) => {
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * §M.16 `w_g = log(1 + N/df_g)`, floored at MIN_DF_RATIO so df = 0 caps instead of diverging.
 * PURE — the stats blob is a parameter (§0.4 S9).
 *
 * @returns {number} weight in [0, IDF_MAX]; 0 whenever the stats are unusable (fail-soft).
 */
function weight(genre, stats) {
  const key = normalizeGenre(genre);
  if (!key) return 0;
  const n = finiteNonNeg(stats?.n);
  if (!n) return 0; // no corpus → no genre signal, rather than a fabricated one
  // A MISSING df table is not the same fact as a genre ABSENT from a table that exists. The
  // second is evidence ("the corpus has never seen this tag") and earns the rarity cap; the
  // first is a malformed blob, and inferring maximal rarity from a table that was never read
  // would turn a load failure into a confident genre direction. Fail-soft: weight 0.
  const table = stats?.df;
  if (!table || typeof table !== 'object') return 0;
  const df = finiteNonNeg(table[key]);
  // ratio = N/df, capped at 1/MIN_DF_RATIO. df === 0 (unseen) takes the cap directly.
  const ratio = df > 0 ? Math.min(n / df, 1 / MIN_DF_RATIO) : 1 / MIN_DF_RATIO;
  return Math.min(IDF_MAX, Math.log(1 + ratio));
}

/**
 * Count document frequencies over the `mbid:` slice.
 *
 * @param {object}   [opts]
 * @param {Array}    [opts.rows]  pre-read rows `{recordingKey, genres}` (tests, backfill passes)
 * @param {object}   [opts.model] mongoose model to read from; defaults to TrackCatalog
 * @param {number}   [opts.now]   injected clock (§0.4 S9) for `computedAt`
 * @returns {Promise<{v:1,n:number,df:Object,computedAt:number}>}
 */
async function compute({ rows, model, now = 0 } = {}) {
  let source = rows;
  if (!Array.isArray(source)) {
    // Lazy require: this module is pulled in by the pure embedding path, and only the DB
    // branch should ever cost a mongoose model registration.
    const m = model ?? require('../../models/TrackCatalog');
    source = await m.find({ recordingKey: /^mbid:/ }, { genres: 1, _id: 0 }).lean();
  }

  const df = Object.create(null);
  let n = 0;
  for (const row of source ?? []) {
    // The `mbid:` containment is enforced HERE, not only in the query above: `rows` is an
    // injection point (backfill passes, tests), and a compliance boundary that a caller can
    // step around by handing in its own rows is not a boundary. Same fail-closed posture as
    // `embedding.worker.js`'s key gate and RewardEvent's `mbid:` schema validator.
    if (typeof row?.recordingKey === 'string' && !row.recordingKey.startsWith('mbid:')) continue;
    // A row's genre list is a SET for counting purposes: a document either carries a genre or
    // it does not, so a row listing "house" three times is still one document frequency.
    const seen = new Set();
    for (const g of row?.genres ?? []) {
      const key = normalizeGenre(g);
      if (key) seen.add(key);
    }
    if (!seen.size) continue; // genre-less document — not part of the genre population (see header)
    n++;
    for (const key of seen) df[key] = (df[key] ?? 0) + 1;
  }
  return { v: 1, n, df: { ...df }, computedAt: Number.isFinite(Number(now)) ? Number(now) : 0 };
}

// ---------------------------------------------------------------------------
// Cache seam. The blob is corpus-wide and anonymous — no userId, no PII, no per-user key —
// so unlike the baseline cache it needs neither encryption nor an AAD binding (mission §0.2.2
// governs VITALS; this is catalogue vocabulary). Process-local with a TTL, plus an explicit
// `use()` injection so a backfill can compute the table ONCE and hand the same blob to every
// vector it builds instead of re-reading the corpus per batch.
// ---------------------------------------------------------------------------
let _injected = null;
let _cached = null;
let _cachedAt = 0;

function use(stats) { _injected = stats ?? null; }
function reset() { _injected = null; _cached = null; _cachedAt = 0; }

async function peek({ loader, now = Date.now(), ttlMs = CACHE_TTL_MS } = {}) {
  if (_injected) return _injected;
  const ttl = Number.isFinite(Number(ttlMs)) && Number(ttlMs) > 0 ? Number(ttlMs) : CACHE_TTL_MS;
  const t = Number.isFinite(Number(now)) ? Number(now) : 0;
  if (_cached && t - _cachedAt < ttl) return _cached;
  try {
    _cached = await (loader ? loader() : compute({ now: t }));
    _cachedAt = t;
  } catch (e) {
    // NEVER throw into the embedding path: an unreachable corpus degrades v2 to audio-only,
    // which is a correct vector, not a broken one.
    console.warn(`[idfStats] genre IDF unavailable — v2 embeddings are audio-only this cycle. Cause: ${e?.message ?? e}`);
    _cached = EMPTY;
    _cachedAt = t;
  }
  return _cached;
}

module.exports = { weight, compute, peek, use, reset, normalizeGenre, EMPTY, IDF_MAX, MIN_DF_RATIO, CACHE_TTL_MS };
