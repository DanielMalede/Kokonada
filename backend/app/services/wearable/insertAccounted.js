'use strict';

/**
 * Truthful accounting for `ordered: false` bulk inserts. (W4-D08)
 *
 * WHY THIS EXISTS. `Model.insertMany(docs, { ordered: false })` writes the valid rows, resolves
 * WITHOUT rejecting, and gives the caller nothing to reconcile against. Every wearable ingest lane
 * therefore returned its own ATTEMPTED count — `inserted: hrDocs.length`, `ingested: docs.length` —
 * so the batch API reported full success on a lossy write. Measured: 10 heart-rate samples with one
 * at 340 bpm resolved `{ inserted: 10 }` with 9 rows in the collection and nothing logged. A x2 PPG
 * artifact on a workout reading clears the model's `max: 300` cap easily, so this is an ordinary
 * Tuesday, not a corner case, and a backfill client reconciling on the count believes data landed
 * that did not.
 *
 * ONE DEFINITION, three lanes. metricStore, appleHealth and suunto each hand-copied the same
 * `insertMany(docs, { ordered: false })` + `count = docs.length` pair. Fixing one and leaving two is
 * exactly the trigger/key divergence D11 was about, so the accounting lives here once and all three
 * call it.
 *
 * WHAT `rawResult: true` BUYS (measured against Mongoose 9.7.1 + mongodb-memory-server, not assumed):
 *   { acknowledged, insertedCount, insertedIds, mongoose: { validationErrors: [ValidationError], results } }
 * `insertedCount` is what Mongo actually took, and each `ValidationError` carries `.errors[path].kind`.
 * A server-side bulk write error (E11000) still THROWS with or without the flag — see below.
 *
 * ZERO-KNOWLEDGE (§0.2.2), and why the reason vocabulary is closed. Mongoose's own validator messages
 * quote the offending value: "`fitbit` is not a valid enum value for path `source`". Passing a message
 * through would put user-submitted data into a DTO, a log line and an HTTP response. Only the PATH and
 * the validator KIND ever leave this module. (The encrypted-number validator happens to be value-free
 * already — it fires after the setter, so its message names ciphertext, not bpm — but relying on that
 * would be relying on an accident of ordering in one validator.)
 */

// Mongoose `kind` values ('required', 'enum', 'min', 'user defined', …) are a closed, value-free
// vocabulary, so they pass through verbatim — normalized to a single token rather than mapped, since
// a mapping table is one more thing that can silently fall out of date with the schema.
function normalizeReason(kind) {
  const token = String(kind ?? '').trim().toLowerCase().replace(/\s+/g, '-');
  return /^[a-z0-9-]+$/.test(token) ? token : 'invalid';
}

/**
 * @param {import('mongoose').Model} Model
 * @param {Array<object>} docs
 * @param {{label?: string}} [opts]  label for the warn line; defaults to the model name
 * @returns {Promise<{inserted:number, rejected:{count:number, reasons:Array<{path:string,reason:string,count:number}>}}>}
 *   `inserted` is what the database took. `rejected.count` counts DOCUMENTS; `rejected.reasons`
 *   counts (path, reason) pairs, so a document failing two paths is one reject and two reasons.
 */
async function insertManyAccounted(Model, docs, opts = {}) {
  const list = Array.isArray(docs) ? docs : [];
  if (list.length === 0) return { inserted: 0, rejected: { count: 0, reasons: [] } };

  // Not caught: a MongoBulkWriteError means the SERVER refused rows, which already surfaces loudly.
  // W4-D08 is about silent loss; swallowing an infrastructure failure here would trade one silent
  // failure for another, and the callers' `source@recordedAt` dedupe makes a retry idempotent.
  const res = await Model.insertMany(list, { ordered: false, rawResult: true });

  // Count direction is deliberate: an over-report is silent data loss, an under-report is at worst a
  // re-send. So an unrecognised return shape counts as zero, never as `list.length`.
  let inserted = 0;
  if (res && Number.isFinite(res.insertedCount)) inserted = res.insertedCount;
  else if (Array.isArray(res)) inserted = res.length;             // legacy/mocked array return

  const validationErrors = Array.isArray(res?.mongoose?.validationErrors)
    ? res.mongoose.validationErrors
    : [];

  // Keyed by path+reason for identity, but both are carried in the VALUE rather than parsed back
  // out of the key — a separator is one more thing that can collide with a field name.
  const tally = new Map();
  const bump = (path, reason) => {
    const key = `${path}|${reason}`;
    const hit = tally.get(key);
    if (hit) hit.count += 1;
    else tally.set(key, { path, reason, count: 1 });
  };

  for (const ve of validationErrors) {
    const paths = ve && ve.errors ? Object.entries(ve.errors) : [];
    if (paths.length === 0) bump('unknown', 'invalid');
    else for (const [path, sub] of paths) bump(path, normalizeReason(sub?.kind));
  }

  const reasons = [...tally.values()];
  const rejected = { count: validationErrors.length, reasons };

  if (rejected.count > 0) {
    const label = opts.label || Model?.modelName || 'unknown';
    const summary = reasons.map(r => `${r.path}:${r.reason}=${r.count}`).join(',');
    console.warn(
      `[insertAccounted] model=${label} attempted=${list.length} inserted=${inserted} ` +
      `rejected=${rejected.count} reasons=${summary}`,
    );
  }

  return { inserted, rejected };
}

const NO_REJECTS = Object.freeze({ count: 0, reasons: Object.freeze([]) });

/**
 * Fold one reject report into another (a backfill is many batches, and the caller wants one
 * answer). Lives here rather than at the call site so the (path, reason) folding rule has ONE
 * definition — the same argument that put the insert accounting here in the first place.
 * Pure: neither argument is mutated.
 */
function mergeRejected(a, b) {
  const tally = new Map();
  for (const src of [a, b]) {
    for (const r of src?.reasons || []) {
      const key = `${r.path}|${r.reason}`;
      const hit = tally.get(key);
      if (hit) hit.count += r.count;
      else tally.set(key, { path: r.path, reason: r.reason, count: r.count });
    }
  }
  return { count: (a?.count || 0) + (b?.count || 0), reasons: [...tally.values()] };
}

module.exports = { insertManyAccounted, mergeRejected, NO_REJECTS };
