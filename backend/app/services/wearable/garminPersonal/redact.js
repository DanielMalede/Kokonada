'use strict';

/**
 * What a secret looks like, defined once (T3).
 *
 * The Garmin personal lane holds two secrets: the personal API key, which Garmin prefixes GCDC_, and
 * the 24-hour JWT the key is exchanged for. Under the Supplemental Terms §1 a key that reaches a log
 * line, an error or a Sentry event has been disclosed, and the only cure is deleting it in Garmin
 * Connect. These patterns remove, from any string:
 *   · `ApiKey <anything up to whitespace or a quote>`, the scheme the key travels in;
 *   · `Bearer <token68>`, the scheme the JWT travels in (RFC 6750 token syntax);
 *   · a bare key, `GCDC_` and what follows it;
 *   · a bare JWT, three base64url segments whose first begins `eyJ` (the encoding of `{"`).
 * The scheme names match in any case. A credential is replaced by [REDACTED]; the text around it is
 * kept, so a line stays readable. Object KEYS are never rewritten, only values.
 *
 * Strict mode is load-bearing in redactSecretsInPlace: writing a redacted string onto a frozen or
 * read-only property THROWS here instead of failing silently, so a caller such as the Sentry
 * scrubber can drop the event rather than send it with the secret still on it.
 *
 * LINEAR TIME. The Sentry scrubber runs this over every string of every event, synchronously, and a
 * request's URL and headers are the caller's to fill, so no pattern may cost more than one pass over
 * its input. The first three are linear as written: each try either fails within a few characters or
 * consumes a run that no other try reads again. The bare JWT is not matched by a regex (see below).
 *
 * No dependencies, so app/config/sentry.js can require this file without a cycle.
 */

const PATTERNS = Object.freeze([
  [/(ApiKey)\s+[^\s"'`]+/gi, (_match, scheme) => `${scheme} [REDACTED]`],
  [/(Bearer)\s+[A-Za-z0-9\-._~+/]+=*/gi, (_match, scheme) => `${scheme} [REDACTED]`],
  [/GCDC_[A-Za-z0-9._-]+/gi, () => '[REDACTED]'],
]);

// The bare JWT. The regex /eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g tried a match at every
// `eyJ` and each try scanned to the next dot, so a run of `eyJeyJ…` with no dot cost time quadratic in
// its length (RA-1: 64 KB held the event loop for 2.3 s). Every character such a match can hold is in
// [A-Za-z0-9_.-], so each maximal run of those is read ONCE and split on its dots: segment i holds a
// JWT when it contains `eyJ`, segment i+1 is not empty, and a segment i+2 exists. The match runs from
// segment i's first `eyJ` to the end of segment i+2, which is exactly what the regex matched, so the
// text before the `eyJ` stays (`%20eyJ…`, a URL-encoded Bearer, keeps its `20` and loses the token).
const JWT_RUN = /[A-Za-z0-9_.-]+/g;
const JWT_START = 'eyJ';

function redactJwtsInRun(run) {
  if (!run.includes(JWT_START)) return run;
  const segments = run.split('.');
  const out = [];
  for (let i = 0; i < segments.length; i += 1) {
    const at = segments[i].indexOf(JWT_START);
    if (at !== -1 && i + 2 < segments.length && segments[i + 1] !== '') {
      out.push(`${segments[i].slice(0, at)}[REDACTED]`);
      i += 2;
    } else {
      out.push(segments[i]);
    }
  }
  return out.join('.');
}

// Deeper than any event or log record this backend builds; past it, a copy is truncated and an
// in-place walk throws, so nothing deeper can slip through unread.
const MAX_DEPTH = 64;

/** @param {string} text */
function redactString(text) {
  let out = text;
  for (const [pattern, replace] of PATTERNS) out = out.replace(pattern, replace);
  // A JWT's first segment always begins `eyJ`: a string without one holds no JWT and is not walked.
  return out.includes(JWT_START) ? out.replace(JWT_RUN, redactJwtsInRun) : out;
}

const isPlainObject = (value) => {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

function copyRedacted(value, path, depth) {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (path.has(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[Truncated]';
  if (value instanceof Date) return new Date(value.getTime());
  path.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => copyRedacted(item, path, depth + 1));
    if (value instanceof Error) {
      const record = { name: copyRedacted(value.name, path, depth + 1), message: copyRedacted(value.message, path, depth + 1) };
      if (value.code !== undefined) record.code = copyRedacted(value.code, path, depth + 1);
      if (value.status !== undefined) record.status = copyRedacted(value.status, path, depth + 1);
      record.stack = copyRedacted(value.stack, path, depth + 1);
      return record;
    }
    const out = {};
    for (const key of Object.keys(value)) out[key] = copyRedacted(value[key], path, depth + 1);
    return out;
  } finally {
    path.delete(value);
  }
}

/**
 * A deep copy of `value` with every string redacted, for a log line. The input is never mutated.
 * An Error becomes a plain record of its name, message, code, status and stack.
 */
function redactSecrets(value) {
  return copyRedacted(value, new Set(), 0);
}

/**
 * Redacts every string in `root` in place, walking plain objects and arrays only (a class instance is
 * the caller's to judge, and is left alone). `skipKeys` names ROOT keys that are never read at all.
 * Throws if a string that needs rewriting cannot be written, or if the tree is deeper than MAX_DEPTH.
 * @returns {object} root
 */
function redactSecretsInPlace(root, { skipKeys = [] } = {}) {
  const skip = new Set(skipKeys);
  const seen = new WeakSet();
  const visit = (node, depth, atRoot) => {
    if (seen.has(node)) return;
    if (depth > MAX_DEPTH) throw new RangeError('redactSecretsInPlace: tree too deep');
    seen.add(node);
    const keys = Array.isArray(node) ? [...node.keys()] : Object.keys(node);
    for (const key of keys) {
      if (atRoot && skip.has(key)) continue;
      const value = node[key];
      if (typeof value === 'string') {
        const redacted = redactString(value);
        if (redacted !== value) node[key] = redacted;
      } else if (Array.isArray(value) || isPlainObject(value)) {
        visit(value, depth + 1, false);
      }
    }
  };
  if (Array.isArray(root) || isPlainObject(root)) visit(root, 0, true);
  return root;
}

module.exports = { redactString, redactSecrets, redactSecretsInPlace };
