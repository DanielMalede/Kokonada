// The token schema the designer signed (V1 addendum §2.1–§2.3, copy-check amendment §4).
//
// validateSources returns { errors, notes }. Every message starts "<file>: <token path>: ", so it
// says where to look. Notes are not failures: they list V0 hexes that sit one step off the colour
// core, which V0's own caveat allows ("accurate to about ±1 per channel") and the designer confirms.
//
// Colour maths comes from the v2 colour core itself (by its .ts path: Babel under jest, type
// stripping under Node), so the schema and the app can never disagree about a hex.

import { inSrgbGamut } from '../../../src/design/v2/color/gamut.ts';
import { oklabToSrgb, oklchToOklab } from '../../../src/design/v2/color/oklab.ts';
import { BASE_FILE, DIRECTION_FILE } from './sources.mjs';

const TYPES = new Set(['color', 'dimension', 'duration', 'number', 'string', 'fontFamily', 'fontWeight', 'cubicBezier', 'shadow']);
const LOCKS = new Set(['designer', 'owner:DEC-081', 'owner:DEC-084', 'generated']);
const HEX = /^#[0-9A-F]{6}$/;
export const ALIAS = /^\{([A-Za-z0-9_.-]+)\}$/;
/** DEC-081, as the designer worded it for the token file: a closed band, ends inclusive. */
export const NEVER_RED_RULE = 'red iff hue in [start,end] inclusive and C >= floor';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
export const isToken = (node) => isObject(node) && '$value' in node;
const kokonada = (node) => (isObject(node) && isObject(node.$extensions) && isObject(node.$extensions['com.kokonada']) ? node.$extensions['com.kokonada'] : {});

/** Every leaf in a tree as [path, node], in source order. A leaf that is not a token is kept too. */
export function flatten(tree, prefix = '', out = []) {
  for (const [key, node] of Object.entries(tree)) {
    if (key.startsWith('$')) {
      continue;
    }
    const path = prefix ? `${prefix}.${key}` : key;
    if (isToken(node) || !isObject(node)) {
      out.push([path, node]);
    } else {
      flatten(node, path, out);
    }
  }
  return out;
}

/** The 8-bit hex the colour core gives for OKLCh components. */
export function hexFor([L, C, h]) {
  const rgb = oklabToSrgb(oklchToOklab({ L, C, h }));
  return '#' + rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0').toUpperCase()).join('');
}

function checkColourValue(value, marker, say, note) {
  if (!isObject(value)) {
    return say('a colour is {colorSpace, components, alpha, hex}');
  }
  if (value.colorSpace !== 'oklch') {
    say(`colour space must be oklch, got ${JSON.stringify(value.colorSpace)}`);
  }
  const c = value.components;
  if (!(Array.isArray(c) && c.length === 3 && c.every(finite))) {
    return say('components must be three finite numbers [L, C, h]');
  }
  if (!(c[0] >= 0 && c[0] <= 1 && c[1] >= 0 && c[2] >= 0 && c[2] < 360)) {
    say(`components out of range: L in [0, 1], C >= 0, h in [0, 360), got [${c.join(', ')}]`);
    return undefined;
  }
  if (!(finite(value.alpha) && value.alpha >= 0 && value.alpha <= 1)) {
    say(`alpha must be in [0, 1], got ${value.alpha}`);
  }
  if (!(typeof value.hex === 'string' && HEX.test(value.hex))) {
    return say(`hex must be #RRGGBB in upper case, got ${JSON.stringify(value.hex)}`);
  }
  if (!inSrgbGamut(oklchToOklab({ L: c[0], C: c[1], h: c[2] }))) {
    return say(`oklch(${c.join(' ')}) is outside the sRGB gamut`);
  }
  const computed = hexFor(c);
  if (marker === 'generated') {
    if (value.hex !== computed) {
      say(`generated hex ${value.hex} should be ${computed}`);
    }
  } else if (marker === 'v0') {
    const steps = [1, 3, 5].map((i) => Math.abs(parseInt(value.hex.slice(i, i + 2), 16) - parseInt(computed.slice(i, i + 2), 16)));
    const worst = Math.max(...steps);
    if (worst > 1) {
      say(`V0 hex ${value.hex} is ${worst} steps off the colour core's ${computed}`);
    } else if (worst === 1) {
      note(`V0 hex ${value.hex} is one step off the colour core's ${computed}; kept as V0 gives it, for the designer to confirm`);
    }
  } else {
    say('a colour with a hex needs a hex marker: $extensions["com.kokonada"].hex is "generated" or "v0"');
  }
  return undefined;
}

const isLength = (v) => isObject(v) && finite(v.value) && v.unit === 'px';

function checkValue(token, say, note) {
  const value = token.$value;
  const marker = kokonada(token).hex;
  switch (token.$type) {
    case 'color':
      return checkColourValue(value, marker, say, note);
    case 'dimension':
      return isLength(value) ? undefined : say('a dimension is {value: number, unit: "px"}');
    case 'duration':
      return isObject(value) && finite(value.value) && value.value >= 0 && value.unit === 'ms' ? undefined : say('a duration is {value: number >= 0, unit: "ms"}');
    case 'number':
      return finite(value) ? undefined : say(`a number must be finite, got ${JSON.stringify(value)}`);
    case 'string':
      return typeof value === 'string' ? undefined : say(`a string must be a string, got ${JSON.stringify(value)}`);
    case 'fontFamily':
      return typeof value === 'string' && value.length > 0 ? undefined : say('a font family is a non-empty string');
    case 'fontWeight':
      return Number.isInteger(value) && value >= 100 && value <= 900 && value % 100 === 0 ? undefined : say(`a font weight is 100, 200 … 900, got ${value}`);
    case 'cubicBezier':
      return Array.isArray(value) && value.length === 4 && value.every(finite) && value[0] >= 0 && value[0] <= 1 && value[2] >= 0 && value[2] <= 1
        ? undefined
        : say(`a cubic Bézier is [x1, y1, x2, y2] with x1 and x2 in [0, 1], got ${JSON.stringify(value)}`);
    case 'shadow':
      if (!Array.isArray(value)) {
        return say('a shadow is a list of layers');
      }
      value.forEach((layer, i) => {
        const sayLayer = (m) => say(`layer ${i}: ${m}`);
        if (!isObject(layer) || !isObject(layer.color)) {
          return sayLayer('a layer needs a colour');
        }
        checkColourValue(layer.color, marker, sayLayer, note);
        for (const key of ['offsetX', 'offsetY', 'blur', 'spread']) {
          if (!isLength(layer[key])) {
            sayLayer(`${key} is {value: number, unit: "px"}`);
          }
        }
        if (typeof layer.inset !== 'boolean') {
          sayLayer('inset is true or false');
        }
        return undefined;
      });
      return undefined;
    default:
      return say(`unknown $type ${JSON.stringify(token.$type)}`);
  }
}

/** Follow an alias chain to a value token, or explain why it cannot be followed. */
export function resolveAlias(tokens, path) {
  const seen = [path];
  let token = tokens.get(path);
  while (typeof token.$value === 'string' && ALIAS.test(token.$value)) {
    const target = token.$value.match(ALIAS)[1];
    if (seen.includes(target)) {
      return { error: `alias cycle: ${[...seen, target].join(' -> ')}` };
    }
    if (!tokens.has(target) || !isToken(tokens.get(target))) {
      return { error: `alias {${target}} points at no token` };
    }
    seen.push(target);
    token = tokens.get(target);
  }
  return { token };
}

function checkFile(file, json, errors, notes) {
  const say = (path) => (message) => errors.push(`${file}: ${path}: ${message}`);
  const note = (path) => (message) => notes.push(`${file}: ${path}: ${message}`);
  const leaves = flatten(json);
  const tokens = new Map(leaves.filter(([, node]) => isToken(node)));

  for (const [path, node] of leaves) {
    if (!isToken(node)) {
      say(path)('neither a token (no $value) nor a group');
      continue;
    }
    if (!TYPES.has(node.$type)) {
      say(path)(`unknown $type ${JSON.stringify(node.$type)}`);
      continue;
    }
    if (typeof node.$value === 'string' && ALIAS.test(node.$value) && node.$type !== 'string') {
      const { token, error } = resolveAlias(tokens, path);
      if (error) {
        say(path)(error);
      } else if (token.$type !== node.$type) {
        say(path)(`alias resolves to a ${token.$type}, but this token is a ${node.$type}`);
      }
      continue;
    }
    checkValue(node, say(path), note(path));
  }

  // Locks: every top-level group carries one, and every lock is one the schema knows.
  for (const [key, node] of Object.entries(json)) {
    if (key.startsWith('$') || isToken(node) || !isObject(node)) {
      continue;
    }
    if (!LOCKS.has(kokonada(node).lock)) {
      say(key)(`a top-level group needs a lock, one of ${[...LOCKS].join(', ')}`);
    }
  }
  return tokens;
}

function checkOwnerDecisions(file, json, errors) {
  const neverRed = kokonada(json.neverRed);
  if (neverRed.lock !== 'owner:DEC-081') {
    errors.push(`${file}: neverRed: the never-red band is the owner's: lock must be owner:DEC-081`);
  }
  if (neverRed.status !== 'decided') {
    errors.push(`${file}: neverRed: DEC-081 is decided: status must be "decided"`);
  }
  if (neverRed.rule !== NEVER_RED_RULE) {
    errors.push(`${file}: neverRed: the rule sentence must be DEC-081's, the one the code applies: "${NEVER_RED_RULE}"`);
  }
  if (kokonada(json.field?.tiers).lock !== 'owner:DEC-084') {
    errors.push(`${file}: field.tiers: the tiers are the owner's: lock must be owner:DEC-084`);
  }
}

/** Key-set and type parity: a path in most directions must be in all; a rarer one in none. */
function checkParity(directions, errors) {
  const types = directions.map(({ tokens }) => new Map([...tokens].map(([path, token]) => [path, token.$type])));
  const paths = new Set(types.flatMap((map) => [...map.keys()]));
  for (const path of paths) {
    const having = directions.filter((_, i) => types[i].has(path));
    if (having.length * 2 > directions.length) {
      for (let i = 0; i < directions.length; i++) {
        if (!types[i].has(path)) {
          errors.push(`${directions[i].file}: ${path}: missing here, present in ${having.map((d) => d.file).join(', ')}`);
        }
      }
    } else if (having.length < directions.length) {
      for (const d of having) {
        errors.push(`${d.file}: ${path}: not in the other direction files; every direction has the same keys`);
      }
      continue;
    }
    const counts = new Map();
    for (const map of types) {
      if (map.has(path)) {
        counts.set(map.get(path), (counts.get(map.get(path)) ?? 0) + 1);
      }
    }
    const usual = [...counts].sort((a, b) => b[1] - a[1])[0][0];
    types.forEach((map, i) => {
      if (map.has(path) && map.get(path) !== usual) {
        errors.push(`${directions[i].file}: ${path}: $type ${map.get(path)} here, ${usual} in the other directions`);
      }
    });
  }
}

/**
 * DSN-035's change limit: the phaser implements exactly one step per wrap when slowing, and a
 * whole number of wraps per step when speeding up. Any other value would be silently unenforced.
 */
function checkChangeLimit(file, base, errors) {
  const slower = base.get('breath.changeLimit.slowerStepsPerWrap')?.$value;
  const faster = base.get('breath.changeLimit.fasterWrapsPerStep')?.$value;
  if (slower !== 1) {
    errors.push(`${file}: breath.changeLimit.slowerStepsPerWrap: must be 1, the only value the phaser implements, got ${slower}`);
  }
  if (!(Number.isInteger(faster) && faster >= 1)) {
    errors.push(`${file}: breath.changeLimit.fasterWrapsPerStep: must be a whole number of at least 1, got ${faster}`);
  }
}

/**
 * Designer edge-ink gaps §a: on the light face, every shadow colour that is not black or white is
 * that face's text.primary (components equal), so shadows follow the ink if it changes again.
 */
function checkLightShadows(file, tokens, errors) {
  const primaryPath = 'color.light.text.primary';
  if (!tokens.has(primaryPath)) {
    return;
  }
  const primary = resolveAlias(tokens, primaryPath).token?.$value?.components;
  if (!Array.isArray(primary)) {
    return;
  }
  const allowed = (c) =>
    (c[0] === 0 && c[1] === 0) || (c[0] === 1 && c[1] === 0) || (c[0] === primary[0] && c[1] === primary[1] && c[2] === primary[2]);
  const say = (path, c) =>
    errors.push(`${file}: ${path}: a light-face shadow is black, white or text.primary [${primary.join(', ')}], got [${c.join(', ')}]`);
  for (const [path, token] of tokens) {
    if (path === 'color.light.bead.shadow' && isObject(token.$value) && Array.isArray(token.$value.components)) {
      if (!allowed(token.$value.components)) say(path, token.$value.components);
    }
    if (/^elevation\.[^.]+\.light$/.test(path) && Array.isArray(token.$value)) {
      for (const layer of token.$value) {
        const c = layer?.color?.components;
        if (Array.isArray(c) && !allowed(c)) say(path, c);
      }
    }
  }
}

/** Copy-check §4: nRest at most nMax, nStress at least nMin. */
function checkBreathBounds(base, directions, errors) {
  const nMax = base.get('field.clock.breath.nMax')?.$value;
  const nMin = base.get('field.clock.breath.nMin')?.$value;
  for (const { file, tokens } of directions) {
    const nRest = tokens.get('field.breath.nRest')?.$value;
    const nStress = tokens.get('field.breath.nStress')?.$value;
    if (!(nRest <= nMax)) {
      errors.push(`${file}: field.breath.nRest: ${nRest} is above field.clock.breath.nMax ${nMax}`);
    }
    if (!(nStress >= nMin)) {
      errors.push(`${file}: field.breath.nStress: ${nStress} is below field.clock.breath.nMin ${nMin}`);
    }
  }
}

/**
 * Designer B2 review: a weight of 300 only where the size is at least 20 (base sizes, direction
 * weights for title and display), Hebrew tracking never negative, and motion.placement.easing
 * naming a motion the base file has.
 */
function checkTypeAndMotion(baseFile, base, directions, errors) {
  const size = (role, script) => base.get(`type.ui.${role}.${script}.size`)?.$value?.value;
  for (const [path, token] of base) {
    const match = path.match(/^type\.ui\.([^.]+)\.(latin|hebrew)\.weight$/);
    if (match && token.$value === 300 && !(size(match[1], match[2]) >= 20)) {
      errors.push(`${baseFile}: ${path}: a weight of 300 needs a size of at least 20, got ${size(match[1], match[2])}`);
    }
  }
  for (const { file, tokens } of directions) {
    for (const [path, token] of tokens) {
      const match = path.match(/^type\.ui\.([^.]+)\.weight$/);
      if (match && token.$value === 300) {
        const sizes = ['latin', 'hebrew'].map((script) => size(match[1], script));
        if (!sizes.every((s) => s >= 20)) {
          errors.push(`${file}: ${path}: a weight of 300 needs a size of at least 20; base type.ui.${match[1]} sizes are ${sizes.join(' and ')}`);
        }
      }
    }
    const easing = tokens.get('motion.placement.easing')?.$value;
    if (easing !== undefined && !(typeof easing === 'string' && base.has(`${easing}.duration`) && base.has(`${easing}.easing`))) {
      errors.push(`${file}: motion.placement.easing: ${JSON.stringify(easing)} names no motion in ${baseFile}`);
    }
  }
  for (const { file, tokens } of [{ file: baseFile, tokens: base }, ...directions]) {
    for (const [path, token] of tokens) {
      if (/\.hebrew\.tracking$/.test(path) && token.$value < 0) {
        errors.push(`${file}: ${path}: Hebrew tracking is never negative, got ${token.$value}`);
      }
    }
  }
}

/**
 * The close-out: the base file's per-direction data names only directions that have a file. Every
 * `directions` list, and every key of a `sample` map, anywhere in the base file.
 */
function checkDirectionRefs(file, json, ids, errors) {
  const say = (path, id) => errors.push(`${file}: ${path}: names direction ${JSON.stringify(id)}, which has no direction file`);
  const walk = (node, path) => {
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, `${path}[${i}]`));
      return;
    }
    if (!isObject(node)) {
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      const at = path ? `${path}.${key}` : key;
      if (key === 'directions' && Array.isArray(child)) {
        for (const id of child) if (!ids.has(id)) say(at, id);
      } else if (key === 'sample' && isObject(child)) {
        for (const id of Object.keys(child)) if (!ids.has(id)) say(at, id);
      }
      walk(child, at);
    }
  };
  walk(json, '');
}

/**
 * UI-112 (the owner's option (b)): field.rest's lobes are one table for both faces, or one per face,
 * exactly { dark, light }. A table is a non-empty list of [x, y] finite centres, × R.
 */
const FACES = ['dark', 'light'];
function checkRestLobes(file, json, errors) {
  const say = (message) => errors.push(`${file}: field.rest: ${message}`);
  const lobes = kokonada(json.field?.rest).lobes;
  const table = (t, where) => {
    if (!(Array.isArray(t) && t.length > 0)) {
      return say(`${where}: the rest lobes are a non-empty list of [x, y], got ${JSON.stringify(t)}`);
    }
    t.forEach((lobe, i) => {
      if (!(Array.isArray(lobe) && lobe.length === 2 && lobe.every(finite))) say(`${where}[${i}]: a rest lobe is [x, y], two finite numbers, got ${JSON.stringify(lobe)}`);
    });
    return undefined;
  };
  if (Array.isArray(lobes)) {
    table(lobes, 'lobes');
  } else if (isObject(lobes)) {
    const keys = Object.keys(lobes).sort();
    if (keys.join() !== FACES.join()) {
      say(`lobes: a per-face table has exactly the keys ${FACES.join(' and ')}, got ${JSON.stringify(keys)}`);
    }
    for (const face of FACES) if (face in lobes) table(lobes[face], `lobes.${face}`);
  } else {
    say(`lobes: one table [[x, y], …] for both faces, or { dark, light }, got ${JSON.stringify(lobes ?? null)}`);
  }
}

/** sources: [{ name, json }]. */
export function validateSources(sources) {
  const errors = [];
  const notes = [];
  const base = sources.find((s) => s.name === BASE_FILE);
  if (!base) {
    errors.push(`${BASE_FILE}: missing: the schema needs one base file`);
  }
  const directions = [];
  for (const source of sources) {
    if (source.name !== BASE_FILE && !DIRECTION_FILE.test(source.name)) {
      errors.push(`${source.name}: not a file the schema knows (base.tokens.json or direction.<id>.tokens.json)`);
    }
  }
  const baseTokens = base ? checkFile(base.name, base.json, errors, notes) : new Map();
  if (base) {
    checkOwnerDecisions(base.name, base.json, errors);
  }
  for (const source of sources.filter((s) => DIRECTION_FILE.test(s.name))) {
    const tokens = checkFile(source.name, source.json, errors, notes);
    checkLightShadows(source.name, tokens, errors);
    checkRestLobes(source.name, source.json, errors);
    directions.push({ file: source.name, tokens });
  }
  if (directions.length === 0) {
    errors.push('direction.<id>.tokens.json: missing: the schema needs at least one direction file');
  }
  checkParity(directions, errors);
  if (base) {
    const ids = new Set(sources.filter((s) => DIRECTION_FILE.test(s.name)).map((s) => s.name.match(DIRECTION_FILE)[1]));
    checkDirectionRefs(base.name, base.json, ids, errors);
    checkBreathBounds(baseTokens, directions, errors);
    checkChangeLimit(base.name, baseTokens, errors);
    checkTypeAndMotion(base.name, baseTokens, directions, errors);
  }
  return { errors, notes };
}
