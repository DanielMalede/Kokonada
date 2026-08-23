'use strict';

// Transparent field-level encryption for Mongoose. Stores AES-256-GCM ciphertext
// as a String; the setter encrypts on write, the getter decrypts on read. Special-
// category health data (heart rate, emotion prompts, physiological metrics) must
// not sit in the database as plaintext. (audit F3)
//
// AAD CONTEXT-BINDING (T3.3): every ciphertext is bound to its owning userId as GCM
// Additional Authenticated Data. A ciphertext lifted from one user's row therefore
// fails to decrypt under another user's id — defense against row-swap / replay. The
// owning userId is read off the document (`this`) — subdocuments climb to the owner.
//
// MIGRATION: existing ciphertexts were written WITHOUT AAD. Reads try the AAD-bound
// decrypt first, then fall back to a no-AAD decrypt, then to legacy plaintext — so
// nothing breaks. Writes always re-encrypt WITH AAD, so data migrates forward on any
// update. (See tests/encryptedFieldAad.test.js.)
//
// UPDATE OPERATORS BIND TOO (W4-D71). This header used to say an update-operator write was
// unbound "and that is fine (the next document-level .save() re-binds AAD)". For a collection
// whose ONLY writer upserts there is no next .save(): `MorningState` was permanently unbound on
// every row, i.e. the one collection holding a person's nightly sleep and cardiac values had no
// row-swap protection at all. So the owner is now recovered from the UPDATE context as well:
//   - the setter's `this` in an update operator is the Query, which knows the owner through its
//     own filter (every encrypted collection here is keyed by userId) or through $setOnInsert;
//   - a filter that holds a query OPERATOR rather than a value ({$in:[…]}) binds nothing, exactly
//     as before — an id that is not a scalar is not an owner.
// One context Mongoose gives no owner at all: a whole-object $set on a SINGLE-NESTED
// sub-document, where the setter's `this` is a detached sub-document with no parent link. Schemas
// with encrypted leaves inside a sub-document therefore install `bindEncryptedAadOnUpdate`, which
// rewrites those assignments into dotted leaf paths (preserving $set's replace semantics with a
// paired $unset) so the leaves are cast in the Query's context like every other path.
// `tests/wave4.aadUpdateBinding.test.js` pins all of it against real Mongo.
//
// Caveats (documented intentionally):
//  - Mongoose 9 runs setters on findOneAndUpdate/updateOne($set) too — so pass the RAW
//    value in an update operator and let the setter encrypt ONCE. Pre-encrypting into
//    $set DOUBLE-encrypts (getter then peels one layer → Number(ciphertext)=NaN). (This
//    bit metricStore's Health-Connect ingest — Pulse showed "—" despite a good sync.)
//    Fields stored as a PLAIN String that you encrypt yourself (e.g. MedicalProfile
//    stateVector.status) have NO setter — keep encrypting those explicitly, and pass the
//    owner id as AAD when you do (`encrypt(value, String(userId))`), reading them back
//    through `decryptOwned` so legacy unbound blobs still resolve.
//  - The getter is tolerant of legacy plaintext (pre-encryption rows): if a value
//    fails to decrypt it is returned/parsed as-is, enabling a gradual migration.
//  - Schemas using these fields should set { toJSON: { getters: true },
//    toObject: { getters: true } } so any serialization decrypts.

const { encrypt, decrypt, isCiphertextFormat } = require('../utils/encryption');

// An owner id is a SCALAR: a string or a BSON id. A query filter may hold an operator object
// ({$in:[…]}, {$ne:null}) in the same slot — binding to `String(that)` would produce the constant
// "[object Object]", which is not a binding at all, so those stay unbound (the pre-W4-D71
// behaviour) rather than pretending to be protected.
function _scalarId(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object' && typeof v.toHexString === 'function') return v.toHexString();
  return null;
}

// The owner of an UPDATE: its filter first (every encrypted collection here is keyed by userId),
// then $setOnInsert / $set for an upsert that keys on something else.
function _queryAad(query) {
  let filter = null;
  try { filter = query.getFilter(); } catch { /* a query mid-construction has none */ }
  const fromFilter = _scalarId(filter && filter.userId);
  if (fromFilter != null) return fromFilter;

  let update = null;
  try { update = query.getUpdate(); } catch { /* ditto */ }
  if (!update || typeof update !== 'object') return null;
  return _scalarId(update.$setOnInsert && update.$setOnInsert.userId)
      ?? _scalarId(update.$set && update.$set.userId)
      ?? _scalarId(update.userId);
}

// The owning userId (string) for AAD, or null when unknown. Subdocuments climb to the
// owner document via ownerDocument(); top-level documents expose userId directly; an
// update operator arrives as a Query and is resolved through its filter. (W4-D71)
function _ownerAad(doc) {
  if (!doc || typeof doc !== 'object') return null;
  if (typeof doc.getFilter === 'function') return _queryAad(doc);
  let owner = doc;
  if (typeof doc.ownerDocument === 'function') {
    try { owner = doc.ownerDocument() || doc; } catch { owner = doc; }
  }
  return _scalarId(owner ? owner.userId : null);
}

// Read a ciphertext whose owner is known: try the AAD-bound decrypt (current writes), fall back to
// no-AAD (legacy rows). Throws only when neither works. Exported for the fields that are encrypted
// EXPLICITLY (no setter to run) so they share one tolerant read instead of growing their own.
function decryptOwned(value, ownerId, parseJson = false) {
  const aad = _scalarId(ownerId);
  if (aad != null) {
    try { return decrypt(value, parseJson, aad); } catch { /* legacy no-AAD ciphertext → below */ }
  }
  return decrypt(value, parseJson);
}

function _decryptField(doc, v) {
  return decryptOwned(v, _ownerAad(doc));
}

// A decrypt that failed on a value that IS our ciphertext format is a real security event —
// tamper, wrong key, or an AAD owner-mismatch (row-swap). Log an alarm (userId + reason only,
// NEVER the value) and signal the caller to yield null rather than leak raw ciphertext / NaN.
function _alarm(doc) {
  const owner = _ownerAad(doc);
  console.error(
    `[crypto-alarm] encrypted field failed authentication (tamper / wrong-key / AAD owner-mismatch) owner=${owner ?? 'unknown'}`,
  );
}

// Read a possibly-encrypted STRING. Genuine legacy plaintext (not our format) passes through; a
// well-formed-but-unauthenticated blob raises an alarm and reads as null. (M1)
function _readString(doc, v) {
  try { return _decryptField(doc, v); }
  catch {
    if (isCiphertextFormat(v)) { _alarm(doc); return null; }
    return v; // genuine legacy plaintext
  }
}

// Read a possibly-encrypted NUMBER, with the same tamper-vs-legacy discrimination. (M1)
function _readNumber(doc, v) {
  try { return Number(_decryptField(doc, v)); }
  catch {
    if (isCiphertextFormat(v)) { _alarm(doc); return null; }
    return Number(v); // genuine legacy plaintext
  }
}

// Write path: bind to the owner when known, else write unbound (an update-operator context
// has no document; the tolerant read + next save migrate it forward).
function _encryptField(doc, v) {
  const aad = _ownerAad(doc);
  return aad != null ? encrypt(String(v), aad) : encrypt(String(v));
}

function encryptedString(opts = {}) {
  const field = {
    type: String,
    // A marker Mongoose carries through to `schema.path(p).options.encrypted`, so the update
    // plugin below (and the guard that polices it) can FIND the encrypted leaves of a schema
    // instead of being told about them. (W4-D71)
    encrypted: true,
    set(v) { return v == null ? v : _encryptField(this, v); },
    get(v) { return v == null ? v : _readString(this, v); },
  };
  if (opts.required) field.required = true;
  if (opts.default !== undefined) field.default = opts.default;
  return field;
}

function encryptedNumber(opts = {}) {
  const field = {
    type: String,
    encrypted: true, // see encryptedString
    set(v) { return v == null ? v : _encryptField(this, v); },
    get(v) { return v == null ? v : _readNumber(this, v); },
  };
  if (opts.required) field.required = true;
  if (opts.default !== undefined) field.default = opts.default;
  // Range validation must decrypt first (the stored value is ciphertext). (audit F3 preserves F-prior min/max)
  if (opts.min != null || opts.max != null) {
    field.validate = {
      validator(v) {
        if (v == null) return true;
        // A tampered/unauthenticated blob yields NaN → fails validation (never saved); genuine
        // legacy plaintext parses through.
        let n;
        try { n = Number(_decryptField(this, v)); }
        catch { n = isCiphertextFormat(v) ? NaN : Number(v); }
        if (Number.isNaN(n)) return false;
        if (opts.min != null && n < opts.min) return false;
        if (opts.max != null && n > opts.max) return false;
        return true;
      },
      message: opts.message || 'encrypted numeric value out of range',
    };
  }
  return field;
}

// ── Single-nested sub-documents: the one context with no owner (W4-D71) ─────────────────────
//
// Casting `$set: { night: {…} }` builds a DETACHED sub-document — `ownerDocument()` returns the
// sub-document itself and there is no link back to the Query — so a setter running there cannot
// know the owner no matter how hard it looks. Assigning the same leaves by DOTTED path
// (`'night.deep'`) is cast in the Query's context instead, which is where the owner is. So the
// plugin rewrites the former into the latter before Mongoose casts, and nothing else changes:
//   - `$set: {night: null}` is not an object — untouched;
//   - a leaf the caller OMITTED is `$unset`, because a whole-object $set replaces rather than
//     merges and dropping that would silently resurrect yesterday's value;
//   - `$setOnInsert` omissions are simply skipped (an insert has nothing to unset);
//   - keys the schema does not declare are dropped, exactly as Mongoose strict mode drops them.

const OPERATOR_UPDATE_OPS = ['findOneAndUpdate', 'updateOne', 'updateMany'];

const _isPlainObject = (v) => v != null
  && typeof v === 'object'
  && !Array.isArray(v)
  && !(v instanceof Date)
  && !Buffer.isBuffer(v)
  && typeof v.toHexString !== 'function';

/** Every terminal (non-sub-document) path of a schema, dotted, descending through sub-documents. */
function _leafPaths(schema, prefix = '') {
  const out = [];
  for (const [p, type] of Object.entries(schema.paths)) {
    if (p === '_id' || p === '__v') continue;
    const full = prefix ? `${prefix}.${p}` : p;
    if (type.$isSingleNested && type.schema) out.push(..._leafPaths(type.schema, full));
    else out.push(full);
  }
  return out;
}

const _isEncryptedLeaf = (schema, leaf) => {
  const type = schema.path(leaf);
  return !!(type && type.options && type.options.encrypted);
};

/** Sub-document paths of this schema that carry at least one encrypted leaf — the blind spots. */
function encryptedEmbeddedPaths(schema, prefix = '') {
  const out = [];
  for (const [p, type] of Object.entries(schema.paths)) {
    if (!type.$isSingleNested || !type.schema) continue;
    const full = prefix ? `${prefix}.${p}` : p;
    if (_leafPaths(type.schema).some((l) => _isEncryptedLeaf(type.schema, l))) out.push(full);
    out.push(...encryptedEmbeddedPaths(type.schema, full));
  }
  return out;
}

const _getAt = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

function _rewriteBlock(update, blockName, targets, leaves) {
  const block = update[blockName];
  let changed = false;

  for (const key of Object.keys(block)) {
    // Only assignments that COVER a blind spot — the sub-document itself or an ancestor of it.
    // A key already dotted THROUGH one (`night.deep`) is cast in the Query context already.
    if (!targets.some((t) => t === key || t.startsWith(`${key}.`))) continue;
    const value = block[key];
    if (!_isPlainObject(value)) continue;

    const declared = leaves.filter((l) => l.startsWith(`${key}.`));
    if (!declared.length) continue;

    delete block[key];
    changed = true;
    for (const leaf of declared) {
      const v = _getAt(value, leaf.slice(key.length + 1));
      if (v !== undefined) block[leaf] = v;
      else if (blockName === '$set') (update.$unset || (update.$unset = {}))[leaf] = '';
    }
  }
  return changed;
}

/**
 * Mongoose plugin. Required on any schema with an encrypted leaf inside a sub-document; the
 * `tests/wave4.aadUpdateBinding.test.js` guard fails the build for a schema that needs it and
 * does not install it, so this is a control rather than a convention.
 */
function bindEncryptedAadOnUpdate(schema) {
  schema.$encryptedAadBound = true;
  const targets = encryptedEmbeddedPaths(schema);
  if (!targets.length) return;
  const leaves = _leafPaths(schema);

  schema.pre(OPERATOR_UPDATE_OPS, function bindEncryptedAad() {
    const raw = this.getUpdate();
    if (!_isPlainObject(raw)) return; // an aggregation-pipeline update is an array — not ours
    const keys = Object.keys(raw);
    if (!keys.length) return;         // an empty update stays empty rather than becoming `{$set:{}}`

    // `{field: value}` is shorthand for `{$set: {field: value}}`. Normalise it so the rewrite has
    // one shape to reason about — and somewhere to put the $unset replace semantics need.
    const shorthand = !keys.some((k) => k.startsWith('$'));
    const update = shorthand ? { $set: { ...raw } } : raw;

    let changed = shorthand;
    for (const blockName of ['$set', '$setOnInsert']) {
      if (_isPlainObject(update[blockName])) {
        changed = _rewriteBlock(update, blockName, targets, leaves) || changed;
      }
    }
    if (changed) this.setUpdate(update);
  });
}

module.exports = {
  encryptedString,
  encryptedNumber,
  decryptOwned,
  bindEncryptedAadOnUpdate,
  encryptedEmbeddedPaths,
};
