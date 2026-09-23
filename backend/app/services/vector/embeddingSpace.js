'use strict';

const { enabled } = require('../../utils/envFlag');
const { DIM, DIM_V2, MODEL_V2 } = require('./embedding');

// WHICH EMBEDDING SPACE IS LIVE — resolved in ONE place, deliberately.
//
// A vector search is a comparison between two things that must live in the same space: the
// QUERY vector we build, and the INDEX + PATH we search it against. Those are two independent
// decisions in two different modules (`targetVector.js` builds the query; the Atlas adapter
// names the index and path), and the failure mode when they disagree is the nastiest kind:
//
//   · dims differ (70 vs 135) → `$vectorSearch` throws → the adapter's catch degrades to `[]`
//     → discovery is silently OFF with no error anywhere. The exact class of failure the
//     one-shot `_warnedVectorSearch` line was added for.
//   · dims coincide → a coordinate-wise comparison of two unrelated geometries, which does not
//     fail at all. It returns confident nonsense.
//
// So neither module decides for itself. Both ask this module, and a "space" is a single frozen
// record binding the four things that must move together: path, dim, model tag and index name.
// That is what makes a half-flipped cutover structurally impossible rather than merely unlikely.
//
// v2 is a SECOND PATH ON THE SAME DOCUMENT, not a second collection: Atlas `numDimensions` is
// immutable per index, so 135-dim v2 needs its own index (H13, Daniel's portal action), but
// `recordingKey` stays unique and the cutover is an index+path switch with nothing to migrate.

const V1 = Object.freeze({
  version: 'v1',
  path: 'vector',
  dimPath: 'dim',
  modelPath: 'model',
  model: 'v1-deterministic',
  dim: DIM,
  indexEnv: 'ATLAS_VECTOR_INDEX',
  defaultIndex: 'track_embedding_index',
});

const V2 = Object.freeze({
  version: 'v2',
  path: 'vectorV2',
  dimPath: 'dimV2',
  modelPath: 'modelV2',
  model: MODEL_V2,
  dim: DIM_V2,
  indexEnv: 'ATLAS_VECTOR_INDEX_V2',
  defaultIndex: 'track_embedding_index_v2',
});

/**
 * @param {string} [version] 'v2' for the v2 space; ANYTHING else resolves to v1.
 *
 * The fallback direction is not arbitrary. v1 is the index that exists in production today; v2
 * may not exist at all until Daniel builds it. A typo'd or absent version must therefore land
 * on the space that is known to be there, not on the one that might not be.
 */
function spaceFor(version) {
  return version === 'v2' ? V2 : V1;
}

/** Per-space index-name override. Each space reads its OWN env var, so renaming one cannot rename the other. */
function indexNameFor(version) {
  const s = spaceFor(version);
  return process.env[s.indexEnv] || s.defaultIndex;
}

/** Is the worker dual-writing v2 vectors? Read per call, so no restart is needed to flip it. */
function writeV2Enabled(env = process.env) {
  return enabled(env?.EMBEDDING_V2_WRITE);
}

// One-shot operator warning (the `_warnedVectorSearch` precedent — never per call, or a busy
// generation path floods the log).
let _warnedStaleRead = false;
function _resetWarnings() { _warnedStaleRead = false; }

/**
 * Which space the SERVING path reads from. Both `discoveryVectorService` (the $vectorSearch
 * query) and `pipeline` (the MMR embedding load) call this, so the two can never end up in
 * different spaces within one generation.
 *
 * Reading v2 while NOT writing it is honoured — the operator may be mid-cutover with a completed
 * backfill — but it is warned about once, because it is the one misconfiguration that looks like
 * success: every NEW track stops getting a v2 vector, the index quietly goes stale, and the only
 * symptom is discovery slowly returning less.
 */
function readVersion(env = process.env) {
  if (!enabled(env?.EMBEDDING_V2_READ)) return 'v1';
  if (!writeV2Enabled(env) && !_warnedStaleRead) {
    _warnedStaleRead = true;
    console.warn(
      '[embeddingSpace] EMBEDDING_V2_READ is ON while EMBEDDING_V2_WRITE is OFF — serving from the ' +
        'v2 index while nothing writes to it. Newly ingested tracks will never enter that index and ' +
        'it will go stale silently. Turn EMBEDDING_V2_WRITE on, or turn the read back off.'
    );
  }
  return 'v2';
}

module.exports = { spaceFor, indexNameFor, writeV2Enabled, readVersion, V1, V2, _resetWarnings };
