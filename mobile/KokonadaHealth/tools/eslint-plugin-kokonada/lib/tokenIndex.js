'use strict';

// Reads src/design/tokens.ts and indexes it BY VALUE, so a lint error can say
// "#0E1030 is dark.surface.base" instead of "no literals". A message that names the
// replacement gets fixed; one that does not gets a disable comment.
//
// This is a deliberately small scanner rather than a TS parser: tokens.ts is pure data
// (consts, object literals, interfaces - no functions), it is the LEAF of the design
// graph, and a lint rule must never be the thing that breaks a build. Anything it cannot
// parse degrades to an empty index, and the rules fall back to their generic message.

const fs = require('fs');

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const COLOR_FN = /^(?:rgba?|hsla?)\(/i;
const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Canonical form of a colour string, or null if the string is not a colour.
 *  Hex is lower-cased and shorthand-expanded (#FFF -> #ffffff); rgb()/hsl() lose whitespace. */
function normalizeColor(raw) {
  if (typeof raw !== 'string') { return null; }
  const s = raw.trim();
  if (HEX.test(s)) {
    let hex = s.slice(1).toLowerCase();
    if (hex.length === 3 || hex.length === 4) {
      hex = hex.split('').map((ch) => ch + ch).join('');
    }
    return '#' + hex;
  }
  if (COLOR_FN.test(s)) { return s.replace(/\s+/g, '').toLowerCase(); }
  return null;
}

/** a.b.c, bracketing any step that is not a bare identifier: space['2xl']. */
function formatPath(parts) {
  return parts.filter((p) => p != null).reduce((acc, p, i) => {
    if (i === 0) { return String(p); }
    return IDENT.test(p) ? acc + '.' + p : acc + "['" + p + "']";
  }, '');
}

// -- Tokenizer ---------------------------------------------------------------
// Emits { type: 'ident' | 'string' | 'number' | 'punct' }, or a single 'error' token
// when the source runs out mid-string - the parser stops there and keeps what it had.
function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') { i++; continue; }
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') { i++; }
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { i++; }
      if (i >= src.length) { out.push({ type: 'error' }); return out; }
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      let value = '';
      while (j < src.length && src[j] !== ch) {
        if (src[j] === '\\') { value += src[j + 1] || ''; j += 2; continue; }
        value += src[j];
        j++;
      }
      if (j >= src.length) { out.push({ type: 'error' }); return out; }
      out.push({ type: 'string', value });
      i = j + 1;
      continue;
    }
    // Every numeric form a token file may legally use. A partial match here would not throw —
    // it would silently read 1_000 as 1 and then name a confidently WRONG token in an error.
    const num = /^(?:0[xX][0-9a-fA-F][0-9a-fA-F_]*|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)/
      .exec(src.slice(i));
    if (num) {
      out.push({ type: 'number', value: Number(num[0].replace(/_/g, '')) });
      i += num[0].length;
      continue;
    }
    const ident = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(src.slice(i));
    if (ident) { out.push({ type: 'ident', value: ident[0] }); i += ident[0].length; continue; }
    out.push({ type: 'punct', value: ch });
    i++;
  }
  return out;
}

const isPunct = (t, v) => !!t && t.type === 'punct' && t.value === v;

// Which numeric scale each leaf path feeds, and the name screens import it under.
// `type` is exported as `type` and imported everywhere as `typography`, so a message has
// to say typography.size.body - the name at the CALL site, not at the declaration.
const SCALE_SOURCES = {
  space: { at: ['space'], as: ['space'] },
  radius: { at: ['radius'], as: ['radius'] },
  fontSize: { at: ['type', 'size'], as: ['typography', 'size'] },
  letterSpacing: { at: ['type', 'tracking'], as: ['typography', 'tracking'] },
  borderWidth: { at: ['stroke'], as: ['stroke'] },
};

/** True when `parts` is exactly `prefix` plus one trailing step (the scale's leaf key). */
function isStepOf(parts, prefix) {
  return prefix.length === parts.length - 1 && prefix.every((p, i) => parts[i] === p);
}

function buildIndex(numberLeaves, colorsByValue) {
  const scales = {};
  for (const id of Object.keys(SCALE_SOURCES)) {
    const src = SCALE_SOURCES[id];
    const steps = [];
    for (const leaf of numberLeaves) {
      if (isStepOf(leaf.parts, src.at)) {
        steps.push({
          name: formatPath(src.as.concat(leaf.parts[leaf.parts.length - 1])),
          value: leaf.value,
        });
      }
    }
    if (steps.length) { scales[id] = steps; }
  }
  return {
    /** Dotted path of the token declaring this colour, or null if none does. */
    colorPath(value) {
      const key = normalizeColor(value);
      return (key && colorsByValue.get(key)) || null;
    },
    /** Token name for an exact on-scale value, e.g. space.lg - else null. */
    scaleName(scale, value) {
      const steps = scales[scale];
      if (!steps) { return null; }
      const hit = steps.find((s) => s.value === value);
      return hit ? hit.name : null;
    },
    /** The closest step to an off-scale value, so the message can suggest one. */
    nearestScaleStep(scale, value) {
      const steps = scales[scale];
      if (!steps || !steps.length) { return null; }
      return steps.reduce((best, s) =>
        (Math.abs(s.value - value) < Math.abs(best.value - value) ? s : best));
    },
    /** Every step name on a scale, in declaration order. */
    scaleSteps(scale) {
      const steps = scales[scale];
      return steps ? steps.map((s) => s.name) : null;
    },
  };
}

function emptyIndex() {
  return buildIndex([], new Map());
}

/** Index a tokens-file SOURCE STRING. Never throws - unparseable input yields an empty index. */
function parseTokenIndex(source) {
  let tokens;
  try {
    tokens = tokenize(String(source));
  } catch (e) {
    return emptyIndex();
  }

  const colorsByValue = new Map(); // first declaration of a colour wins
  const numberLeaves = [];
  const stack = [];
  let pendingDecl = null;

  const record = (key, value) => {
    const parts = stack.concat(key);
    if (typeof value === 'number') {
      numberLeaves.push({ parts, value });
      return;
    }
    const color = normalizeColor(value);
    if (color && !colorsByValue.has(color)) { colorsByValue.set(color, formatPath(parts)); }
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'error') { break; }

    if (isPunct(t, '{')) { stack.push(pendingDecl); pendingDecl = null; continue; }
    if (isPunct(t, '}')) { stack.pop(); continue; }

    // `const NAME` / `export const NAME` - the name has to survive `: SomeType =` before the brace.
    if (t.type === 'ident' && t.value === 'const' && tokens[i + 1] && tokens[i + 1].type === 'ident') {
      pendingDecl = tokens[i + 1].value;
      i += 1;
      continue;
    }

    // `key:` - an object key, or an interface member (whose "value" is a type, not a literal).
    if ((t.type === 'ident' || t.type === 'string') && isPunct(tokens[i + 1], ':')) {
      const key = String(t.value);
      const v = tokens[i + 2];
      if (isPunct(v, '{')) { pendingDecl = key; i += 1; continue; }
      if (v && v.type === 'string') { record(key, v.value); i += 2; continue; }
      if (v && v.type === 'number') { record(key, v.value); i += 2; continue; }
      if (isPunct(v, '-') && tokens[i + 3] && tokens[i + 3].type === 'number') {
        record(key, -tokens[i + 3].value);
        i += 3;
        continue;
      }
      i += 1;
      continue;
    }
  }

  return buildIndex(numberLeaves, colorsByValue);
}

const cache = new Map();

/** Index the tokens file at `filePath`, cached per path. A missing or broken file yields an
 *  empty index rather than an exception - lint must not be what breaks the build. */
function loadTokenIndex(filePath) {
  if (cache.has(filePath)) { return cache.get(filePath); }
  let index;
  try {
    index = parseTokenIndex(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    index = emptyIndex();
  }
  cache.set(filePath, index);
  return index;
}

module.exports = { parseTokenIndex, loadTokenIndex, normalizeColor, formatPath };
