'use strict';

// The coordinator's path engine. PURE: strings in, data out — no git, no file system, no clock.
//
// A claim is a list of repo-relative POSIX paths. Each is either a literal file or a glob, and the
// only wildcard is `*`: `**` crosses folders, a single `*` stays inside one segment. Everything else
// is literal, including `[`, `]` and `?`, which real file names in the mobile tree carry.
//
// Matching is case-insensitive on purpose. Both partners work on case-insensitive file systems
// (Windows, default macOS), where `AGENTS.md` and `agents.md` are the same file; a collision check
// that told them apart would pass exactly the edit that overwrites the other partner's work.

// Globs that would lock a whole surface. A glob whose literal prefix has fewer than two segments is
// refused by rule (`backend/**`, `docs/**`, `scripts/**`); these are refused even though their prefix
// is long enough, because each of them is still most of a product surface.
const DENY_LIST = Object.freeze([
  'mobile/KokonadaHealth/**',
  'mobile/KokonadaHealth/src/**',
  'backend/app/**',
  'backend/tests/**',
  'docs/design-v2/**',
]);

function badPath(message) {
  const err = new Error(message);
  err.code = 'BAD_PATH';
  return err;
}

// → the canonical spelling, or throws BAD_PATH with a reason a human can act on.
function normalizePath(input) {
  const raw = String(input === undefined || input === null ? '' : input).trim();
  if (raw === '') throw badPath('empty path');
  if (/[\u0000-\u001f\u007f\u2028\u2029]/.test(raw)) throw badPath(`${JSON.stringify(raw)}: a path may not contain a control or line-separator character`);
  if (/[,`]/.test(raw)) throw badPath(`"${raw}": a path may not contain a comma or a backtick`);

  let p = raw.replace(/\\/g, '/');
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) throw badPath(`"${raw}" is absolute; give a path relative to the repository root`);
  while (p.startsWith('./')) p = p.slice(2);
  p = p.replace(/\/{2,}/g, '/');
  if (p.endsWith('/')) throw badPath(`"${raw}" ends with a slash; claim a folder as "${p}**"`);
  const segments = p.split('/');
  if (segments.some((s) => s === '..')) throw badPath(`"${raw}" climbs out with ".."; give a path inside the repository`);
  if (segments.some((s) => s === '.' || s === '')) throw badPath(`"${raw}" is not a clean relative path`);
  return p;
}

function isGlob(p) {
  return String(p).includes('*');
}

// The folder segments a glob is anchored under: everything before the first segment with a `*`.
function literalPrefix(p) {
  const out = [];
  for (const segment of String(p).split('/')) {
    if (segment.includes('*')) break;
    out.push(segment);
  }
  return out;
}

const lower = (s) => String(s).toLowerCase();

function samePrefix(a, b) {
  return a.length === b.length && a.every((s, i) => lower(s) === lower(b[i]));
}

// → null when the pattern may be claimed, else the reason it may not.
function tooBroadReason(p) {
  if (!isGlob(p)) return null;
  const prefix = literalPrefix(p);
  if (prefix.length < 2) {
    return `"${p}" is too broad: a glob must sit under at least two folders (for example "scripts/coord/**")`;
  }
  if (String(p).includes('**')) {
    for (const denied of DENY_LIST) {
      if (samePrefix(prefix, literalPrefix(denied))) {
        return `"${p}" is too broad: it locks all of ${literalPrefix(denied).join('/')}/; claim the files or a narrower folder`;
      }
    }
  }
  return null;
}

// → { paths, errors }: canonical, de-duplicated (case-insensitively, first spelling wins), with every
// rejection collected so a human sees all problems in one run instead of one per attempt.
function validateDeclared(list) {
  const paths = [];
  const seen = new Set();
  const errors = [];
  for (const item of list || []) {
    let p;
    try {
      p = normalizePath(item);
    } catch (err) {
      errors.push(err.message);
      continue;
    }
    const broad = tooBroadReason(p);
    if (broad) { errors.push(broad); continue; }
    if (seen.has(lower(p))) continue;
    seen.add(lower(p));
    paths.push(p);
  }
  return { paths, errors };
}

const REGEX_CACHE = new Map();

function globToRegExp(glob) {
  if (REGEX_CACHE.has(glob)) return REGEX_CACHE.get(glob);
  let src = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        i += 1;
        if (glob[i + 1] === '/') { i += 1; src += '(?:.*/)?'; } else { src += '.*'; }
      } else {
        src += '[^/]*';
      }
    } else {
      src += ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  const re = new RegExp(`^${src}$`, 'i');
  REGEX_CACHE.set(glob, re);
  return re;
}

// Does a pattern (literal or glob) cover a concrete file?
function matches(pattern, file) {
  if (!isGlob(pattern)) return lower(pattern) === lower(file);
  return globToRegExp(pattern).test(file);
}

function prefixesNest(a, b) {
  const pa = literalPrefix(a);
  const pb = literalPrefix(b);
  const n = Math.min(pa.length, pb.length);
  for (let i = 0; i < n; i += 1) if (lower(pa[i]) !== lower(pb[i])) return false;
  return true;
}

// → 'exact' | 'glob' | null for two declared patterns.
function overlapClass(a, b) {
  const ga = isGlob(a);
  const gb = isGlob(b);
  if (!ga && !gb) return lower(a) === lower(b) ? 'exact' : null;
  if (ga && !gb) return matches(a, b) ? 'glob' : null;
  if (!ga && gb) return matches(b, a) ? 'glob' : null;
  return prefixesNest(a, b) ? 'glob' : null;
}

function covers(patterns, file) {
  return (patterns || []).some((p) => matches(p, file));
}

module.exports = {
  DENY_LIST,
  normalizePath,
  validateDeclared,
  isGlob,
  literalPrefix,
  tooBroadReason,
  globToRegExp,
  matches,
  overlapClass,
  covers,
};
