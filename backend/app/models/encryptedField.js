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
// WHICH FIELD NAMES THE OWNER (W4-D74). "Read `userId` off the owner" was hard-coded, and it is
// true of every collection here except the one that holds credentials: a `User` document has no
// `userId` — the owner id IS its `_id`. So the lookup resolved null and `garminUserId`,
// `pushTokens[].token` and the three OAuth token blobs were all written UNBOUND, i.e. a lifted
// `spotifyToken` was replayable into any other row. A schema whose owner sits elsewhere now
// DECLARES it via `declareEncryptedOwner`; the default stays `userId`, so nothing else changes.
// `tests/wave4.userAadBinding.test.js` fails the build for any schema with an encrypted leaf whose
// owner path does not resolve — a control rather than a convention, which is what this needed.
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
// DOCUMENT ARRAYS (W4-D75). The same plugin covers the array case, but by REFUSAL rather than
// rewrite: an array detaches its elements identically and there is no dotted form of "replace this
// array" or "append this element" to rewrite into, so `$set`/`$setOnInsert` on the array (or on one
// whole element), `$push`, `$push`+`$each` and `$addToSet` throw when the value carries an
// encrypted leaf, instead of silently storing it unbound. Writes dotted THROUGH to the leaf
// (`arr.$.x`, `arr.$[].x`, `arr.<i>.x`) and `.push()` + `.save()` bind and are untouched. Two
// bypasses stay outside every query hook and are therefore NOT covered here — `Model.bulkWrite`
// (no query middleware) and an aggregation-pipeline update (`updatePipeline: true`, which skips
// setters entirely and would write PLAINTEXT for any encrypted field, array or not).
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

const _getAt = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

// The document path naming the owner of this schema's encrypted values. `userId` for every
// collection keyed by one; `_id` for `User`, whose rows ARE the users. (W4-D74)
const DEFAULT_OWNER_PATH = 'userId';

/** Declare where a schema's owner id lives, when it is not the default `userId`. (W4-D74) */
function declareEncryptedOwner(schema, ownerPath) {
  schema.$encryptedOwnerPath = ownerPath;
  return schema;
}

function encryptedOwnerPath(schema) {
  return (schema && schema.$encryptedOwnerPath) || DEFAULT_OWNER_PATH;
}

// The owner of an UPDATE: its filter first (a keyed collection is normally queried by its owner),
// then $setOnInsert / $set for an upsert that keys on something else.
function _queryAad(query) {
  const schema = query.schema || (query.model && query.model.schema) || null;
  const ownerPath = encryptedOwnerPath(schema);

  let filter = null;
  try { filter = query.getFilter(); } catch { /* a query mid-construction has none */ }
  const fromFilter = _scalarId(filter && _getAt(filter, ownerPath));
  if (fromFilter != null) return fromFilter;

  let update = null;
  try { update = query.getUpdate(); } catch { /* ditto */ }
  if (!update || typeof update !== 'object') return null;
  return _scalarId(update.$setOnInsert && _getAt(update.$setOnInsert, ownerPath))
      ?? _scalarId(update.$set && _getAt(update.$set, ownerPath))
      ?? _scalarId(_getAt(update, ownerPath));
}

// The owning id (string) for AAD, or null when unknown. Subdocuments climb to the owner
// document via ownerDocument(); top-level documents expose the owner at their schema's owner
// path; an update operator arrives as a Query and is resolved through its filter. (W4-D71/D74)
function _ownerAad(doc) {
  if (!doc || typeof doc !== 'object') return null;
  if (typeof doc.getFilter === 'function') return _queryAad(doc);
  let owner = doc;
  if (typeof doc.ownerDocument === 'function') {
    try { owner = doc.ownerDocument() || doc; } catch { owner = doc; }
  }
  if (!owner) return null;
  return _scalarId(_getAt(owner, encryptedOwnerPath(owner.schema)));
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

/**
 * Every ENCRYPTED leaf of a schema, dotted, descending through sub-documents AND document arrays.
 * Unlike `_leafPaths` (which serves the $set rewrite and therefore only walks the sub-documents
 * that rewrite touches), this is the inventory question — "what does this schema encrypt?" — and a
 * `pushTokens[].token` is exactly the kind of leaf that must not fall outside it. Array segments
 * are reported unsubscripted (`pushTokens.token`), the shape `schema.path()` accepts. (W4-D74)
 */
function encryptedLeafPaths(schema, prefix = '') {
  const out = [];
  for (const [p, type] of Object.entries(schema.paths)) {
    if (p === '_id' || p === '__v') continue;
    const full = prefix ? `${prefix}.${p}` : p;
    if ((type.$isSingleNested || type.$isMongooseDocumentArray) && type.schema) {
      out.push(...encryptedLeafPaths(type.schema, full));
    } else if (type.options && type.options.encrypted) {
      out.push(full);
    }
  }
  return out;
}

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

// ── Document arrays: the blind spot with no rewrite (W4-D75) ────────────────────────────────
//
// A document ARRAY detaches its elements exactly like a single-nested `$set` does — measured
// against real Mongo, the element handed to the leaf setter is an `EmbeddedDocument` whose
// `parentArray().$parent()` is `undefined` — but there is nothing to rewrite it INTO. No dotted
// path replaces an array or appends to one, and `$set: {arr: […]}` cannot be combined with
// `$set: {'arr.0.x': …}` in a single update (Mongo rejects the conflicting prefix). Measured
// verdict per shape, which is what the enumeration below encodes:
//
//   UNBOUND  $set/$setOnInsert on the array (`arr`) or on one whole element (`arr.0`, `arr.$`),
//            $push, $push+$each, $addToSet
//   BOUND    a write dotted THROUGH to the leaf (`arr.0.x`, `arr.$.x`, `arr.$[].x`, `arr.$[el].x`)
//            — cast in the Query context like any other path — and `.push()` + `.save()`
//
// So the unbindable half fails CLOSED rather than silently storing a secret with no owner. It
// costs nothing today (the only such leaf in this repo is `User.pushTokens[].token`, and its one
// writer — `authController` enrolling a device — is already on the bound path), and it costs a
// named error rather than a silent downgrade the day a second writer appears. That asymmetry is
// the whole point: "no caller does that today" is what this family of rows keeps disproving.

const ARRAY_APPEND_OPS = ['$push', '$addToSet'];

// `arr.0.x`, `arr.$.x`, `arr.$[].x` and `arr.$[el].x` all address the schema path `arr.x`.
// Stripping the subscript is what lets one comparison tell "assigns the element" from
// "assigns through to the leaf" without enumerating positional syntaxes at every call site.
const _unsubscript = (key) => key.replace(/\.(?:\d+|\$|\$\[[^\]]*\])(?=\.|$)/g, '');

/** The element value(s) an append operator would add, `$each` unwrapped. */
function _appendedElements(value) {
  if (_isPlainObject(value) && Array.isArray(value.$each)) return value.$each;
  return Array.isArray(value) ? value : [value];
}

const _carriesEncrypted = (elements, leaves) => elements.some(
  (el) => _isPlainObject(el) && leaves.some((l) => _getAt(el, l) != null),
);

function _refuseUnbindableArrayWrite(arrayPath, where) {
  throw new Error(
    `[encryptedField] refusing \`${where}\`: it writes an encrypted value into the document array `
    + `\`${arrayPath}\`, whose elements an update operator casts as detached sub-documents — the `
    + 'ciphertext would be stored with NO owner AAD and be replayable into another user row '
    + `(W4-D75). Write it through the document (\`doc.${arrayPath}.push(…)\` then \`save()\`), or `
    + `address the leaf itself (\`${arrayPath}.$.<leaf>\`, \`${arrayPath}.$[].<leaf>\`, `
    + `\`${arrayPath}.<i>.<leaf>\`) — those are cast in the query context and DO bind.`,
  );
}

/** Throw on any update shape that would write an encrypted array leaf without its owner AAD. */
function _assertBindableArrayWrites(update, arrayTargets) {
  for (const { path, leaves } of arrayTargets) {
    for (const blockName of ['$set', '$setOnInsert']) {
      const block = update[blockName];
      if (!_isPlainObject(block)) continue;
      for (const key of Object.keys(block)) {
        const norm = _unsubscript(key);
        let value;
        if (norm === path) value = block[key];              // the array, or one whole element
        else if (path.startsWith(`${norm}.`)) value = _getAt(block[key], path.slice(norm.length + 1));
        else continue;                                      // dotted through to a leaf → binds
        if (value == null) continue;                        // clearing writes no ciphertext
        if (_carriesEncrypted(Array.isArray(value) ? value : [value], leaves)) {
          _refuseUnbindableArrayWrite(path, `${blockName}.${key}`);
        }
      }
    }
    for (const blockName of ARRAY_APPEND_OPS) {
      const block = update[blockName];
      if (!_isPlainObject(block)) continue;
      for (const key of Object.keys(block)) {
        if (_unsubscript(key) !== path) continue;
        if (_carriesEncrypted(_appendedElements(block[key]), leaves)) {
          _refuseUnbindableArrayWrite(path, `${blockName}.${key}`);
        }
      }
    }
  }
}

/**
 * Document-array paths of this schema that carry at least one encrypted leaf, each with the
 * ELEMENT-relative dotted paths of those leaves. Descends through sub-documents and through
 * arrays, so an array nested under either is found too. (W4-D75)
 */
function _encryptedDocumentArrays(schema, prefix = '') {
  const out = [];
  for (const [p, type] of Object.entries(schema.paths)) {
    if (p === '_id' || p === '__v' || !type.schema) continue;
    const full = prefix ? `${prefix}.${p}` : p;
    if (type.$isMongooseDocumentArray) {
      const leaves = encryptedLeafPaths(type.schema);
      if (leaves.length) out.push({ path: full, leaves });
    }
    if (type.$isMongooseDocumentArray || type.$isSingleNested) {
      out.push(..._encryptedDocumentArrays(type.schema, full));
    }
  }
  return out;
}

/** Document-array paths of this schema that carry at least one encrypted leaf. (W4-D75) */
function encryptedDocumentArrayPaths(schema) {
  return _encryptedDocumentArrays(schema).map((a) => a.path);
}

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

// ── W4-D76 · aggregation-pipeline updates ───────────────────────────────────────────────────
//
// An update pipeline runs SERVER-SIDE, so no setter executes and the literal value is what lands
// in the collection: `[{$set: {garminUserId: 'x'}}]` stores the three characters, not a blob. That
// is worse than the unbound ciphertext W4-D71/D75 chase, and it hits every encrypted leaf — the
// top-level ones the query-context cast otherwise handles included. There is no dotted form to
// rewrite it into, so the only repair is a refusal.
//
// MongoDB permits exactly six stages in an update pipeline. Three assign values, two replace the
// whole document, one only removes:
const PIPELINE_ASSIGN_STAGES = ['$set', '$addFields', '$project'];
const PIPELINE_REPLACE_STAGES = ['$replaceRoot', '$replaceWith'];
const PIPELINE_SAFE_STAGES = ['$unset']; // removing a field writes no ciphertext
const PIPELINE_KNOWN_STAGES = [
  ...PIPELINE_ASSIGN_STAGES, ...PIPELINE_REPLACE_STAGES, ...PIPELINE_SAFE_STAGES,
];

// `{$project: {f: 1}}` / `{f: 0}` select an existing value rather than assigning a new one, so
// they leave the stored ciphertext alone. Anything else in that position is an expression.
const _isProjectionFlag = (v) => v === 1 || v === 0 || v === true || v === false;

/** Does an update-pipeline key assign into (or over) one of these encrypted leaves? */
const _touchesEncryptedLeaf = (key, leaves) => {
  const k = _unsubscript(key);
  return leaves.some((l) => l === k || l.startsWith(`${k}.`) || k.startsWith(`${l}.`));
};

function _refuseEncryptedPipelineWrite(what, why) {
  throw new Error(
    `[encryptedField] refusing an aggregation-pipeline update: ${what} ${why}. A pipeline update `
    + 'runs server-side, so no encrypting setter ever executes and the value would be stored as '
    + 'READABLE PLAINTEXT (W4-D76). Use an ordinary update operator (`$set`), which is cast in the '
    + 'query context and both encrypts and binds the owner AAD, or write through the document '
    + '(`doc.save()`).',
  );
}

/** Throw on any pipeline update that could write a plaintext value into an encrypted leaf. */
function _assertNoEncryptedPipelineWrite(pipeline, leaves) {
  for (const stage of pipeline) {
    if (!_isPlainObject(stage)) continue;
    for (const name of Object.keys(stage)) {
      if (PIPELINE_SAFE_STAGES.includes(name)) continue;
      if (PIPELINE_REPLACE_STAGES.includes(name)) {
        _refuseEncryptedPipelineWrite(`\`${name}\``, 'can assign every leaf of this schema, including its encrypted ones');
      }
      if (!PIPELINE_KNOWN_STAGES.includes(name)) {
        // Not one of the six MongoDB documents. Conservative by design: an unrecognised stage
        // means this enumeration is stale, and the fields behind it are Art.9 health values and
        // device secrets. Widening the list is a deliberate edit, not a silent pass.
        _refuseEncryptedPipelineWrite(`the unrecognised stage \`${name}\``, 'is not one of the six update-pipeline stages this guard can reason about');
      }
      const block = stage[name];
      if (!_isPlainObject(block)) continue;
      for (const key of Object.keys(block)) {
        if (name === '$project' && _isProjectionFlag(block[key])) continue;
        if (_touchesEncryptedLeaf(key, leaves)) {
          _refuseEncryptedPipelineWrite(`\`${name}.${key}\``, 'assigns an encrypted leaf');
        }
      }
    }
  }
}

/**
 * Mongoose plugin. Required on any schema with an encrypted leaf inside a sub-document OR inside
 * a document array; the `tests/wave4.aadUpdateBinding.test.js` guard fails the build for a schema
 * that needs it and does not install it, so this is a control rather than a convention.
 * W4-D76 widened that requirement to ANY schema with ANY encrypted leaf, because the pipeline
 * refusal it also installs protects top-level leaves that need no rewrite.
 */
function bindEncryptedAadOnUpdate(schema) {
  schema.$encryptedAadBound = true;
  const targets = encryptedEmbeddedPaths(schema);
  const arrayTargets = _encryptedDocumentArrays(schema);
  const encryptedLeaves = encryptedLeafPaths(schema);
  if (!targets.length && !arrayTargets.length && !encryptedLeaves.length) return;
  const leaves = _leafPaths(schema);

  schema.pre(OPERATOR_UPDATE_OPS, function bindEncryptedAad() {
    const raw = this.getUpdate();
    // Measured on Mongoose 9.7.1: query middleware DOES fire for `updatePipeline: true`, and
    // `getUpdate()` hands back the stage array — so the shape no setter can reach is refusable
    // here, at the same seam as the array refusal below. (W4-D76)
    if (Array.isArray(raw)) {
      if (encryptedLeaves.length) _assertNoEncryptedPipelineWrite(raw, encryptedLeaves);
      return;
    }
    if (!_isPlainObject(raw)) return;
    const keys = Object.keys(raw);
    if (!keys.length) return;         // an empty update stays empty rather than becoming `{$set:{}}`

    // `{field: value}` is shorthand for `{$set: {field: value}}`. Normalise it so the rewrite has
    // one shape to reason about — and somewhere to put the $unset replace semantics need. The
    // test is PER KEY, not per update: a schema with `timestamps: true` has Mongoose append its
    // own `$set: {updatedAt}` before this hook runs, so a caller-shorthand update arrives MIXED
    // and an update-level "does any key start with $" reads it as fully-operator form and leaves
    // the bare key — the very one carrying the value — unexamined. (W4-D75)
    const bare = keys.filter((k) => !k.startsWith('$'));
    let update = raw;
    if (bare.length) {
      update = { ...raw, $set: { ...(_isPlainObject(raw.$set) ? raw.$set : {}) } };
      for (const k of bare) { update.$set[k] = raw[k]; delete update[k]; }
    }

    // Refuse before rewriting: an unbindable array write has no repair, and the query must abort
    // with the update untouched rather than half-normalised.
    if (arrayTargets.length) _assertBindableArrayWrites(update, arrayTargets);

    let changed = bare.length > 0;
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
  declareEncryptedOwner,
  encryptedOwnerPath,
  encryptedLeafPaths,
  bindEncryptedAadOnUpdate,
  encryptedEmbeddedPaths,
  encryptedDocumentArrayPaths,
};
