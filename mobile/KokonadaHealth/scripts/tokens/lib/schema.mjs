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
  if (kokonada(json.field?.tiers).status !== 'decided') {
    errors.push(`${file}: field.tiers: DEC-084 is decided for the tier table: status must be "decided"`);
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

/** A number token's value, through its aliases; undefined when the token is missing or not a finite number. */
function numberAt(tokens, path) {
  if (!tokens.has(path)) {
    return undefined;
  }
  const value = resolveAlias(tokens, path).token?.$value;
  return finite(value) ? value : undefined;
}

/**
 * UI-112 (the owner's option (b)): field.rest's lobes are one table for both faces, or one per face,
 * exactly { dark, light }. A table is a non-empty list of [x, y] finite centres, × R.
 *
 * DEC-172, G4 (the designer's corrected bound and the architect's re-rule): the lobes are runtime statics, so
 * each table holds at most two, which keeps one shared slot free for a leaving placement, and each centre lies
 * within field.lobe.centreAlpha + centreBeta of the plate centre, the direction's own lobe rule (+1e-9).
 */
const FACES = ['dark', 'light'];
const MAX_REST_LOBES = 2;
const LOBE_BOUND_SLACK = 1e-9;
function checkRestLobes(file, json, tokens, errors) {
  const say = (message) => errors.push(`${file}: field.rest: ${message}`);
  const lobes = kokonada(json.field?.rest).lobes;
  const alpha = numberAt(tokens, 'field.lobe.centreAlpha');
  const beta = numberAt(tokens, 'field.lobe.centreBeta');
  const bound = alpha !== undefined && beta !== undefined ? alpha + beta : undefined;
  if (bound === undefined) {
    say('the rest lobes are bounded by field.lobe.centreAlpha + field.lobe.centreBeta, and this file has no such numbers');
  }
  const table = (t, where) => {
    if (!(Array.isArray(t) && t.length > 0)) {
      return say(`${where}: the rest lobes are a non-empty list of [x, y], got ${JSON.stringify(t)}`);
    }
    if (t.length > MAX_REST_LOBES) {
      say(`${where}: at most ${MAX_REST_LOBES} rest lobes, so one shared slot stays free for a leaving placement (DEC-172), got ${t.length}`);
    }
    t.forEach((lobe, i) => {
      if (!(Array.isArray(lobe) && lobe.length === 2 && lobe.every(finite))) {
        say(`${where}[${i}]: a rest lobe is [x, y], two finite numbers, got ${JSON.stringify(lobe)}`);
      } else if (bound !== undefined && !(Math.hypot(lobe[0], lobe[1]) <= bound + LOBE_BOUND_SLACK)) {
        say(`${where}[${i}]: a rest lobe lies within centreAlpha + centreBeta = ${bound} of the centre (DEC-172), got |c| = ${Math.hypot(lobe[0], lobe[1])}`);
      }
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

/**
 * DEC-172, G4: the base file's runtime statics, which tokens.statics.generated.ts holds. The drift tables name the
 * same slots, lobe0, lobe1 …, with whole harmonics of at least 1 and finite phases; the fallback's stops rise
 * strictly from 0 to 1, with weights in [0, 1] that never rise; the blend graph joins every pair of its nodes
 * exactly once, and gives each face a node tier, core or deep.
 */
function checkDrift(file, json, errors) {
  const say = (message) => errors.push(`${file}: field.clock: ${message}`);
  const drift = kokonada(json.field?.clock).drift;
  if (!(isObject(drift) && isObject(drift.harmonics) && isObject(drift.phases))) {
    return say(`drift: the drift tables { harmonics, phases } are runtime statics (DEC-172), got ${JSON.stringify(drift ?? null)}`);
  }
  const slots = Object.keys(drift.harmonics);
  const named = new Set(slots.map((_, i) => `lobe${i}`));
  if (slots.length === 0 || !slots.every((slot) => named.has(slot))) {
    say(`drift.harmonics: the slots are lobe0, lobe1 …, got ${JSON.stringify(slots)}`);
  }
  const phaseSlots = Object.keys(drift.phases);
  if (!(phaseSlots.length === slots.length && phaseSlots.every((slot) => slots.includes(slot)))) {
    say(`drift.phases: the same slots as drift.harmonics (${slots.join(', ')}), got ${JSON.stringify(phaseSlots)}`);
  }
  for (const [slot, pair] of Object.entries(drift.harmonics)) {
    if (!(Array.isArray(pair) && pair.length === 2 && pair.every((k) => Number.isInteger(k) && k >= 1))) {
      say(`drift.harmonics.${slot}: [kx, ky], two whole harmonics of 1/T, each at least 1, got ${JSON.stringify(pair)}`);
    }
  }
  for (const [slot, pair] of Object.entries(drift.phases)) {
    if (!(Array.isArray(pair) && pair.length === 2 && pair.every(finite))) {
      say(`drift.phases.${slot}: [φx, φy], two finite phases in radians, got ${JSON.stringify(pair)}`);
    }
  }
  return undefined;
}

function checkFallbackStops(file, json, errors) {
  const say = (message) => errors.push(`${file}: field.fallback: ${message}`);
  const stops = kokonada(json.field?.fallback).stops;
  const list = (v) => Array.isArray(v) && v.length >= 2 && v.every(finite);
  if (!(isObject(stops) && list(stops.position) && list(stops.weight))) {
    return say(`stops: { position, weight }, two lists of at least two finite numbers, are runtime statics (DEC-172), got ${JSON.stringify(stops ?? null)}`);
  }
  const { position, weight } = stops;
  if (position.length !== weight.length) {
    say(`stops: position and weight are as long as each other, got ${position.length} and ${weight.length}`);
  }
  if (position[0] !== 0 || position[position.length - 1] !== 1) {
    say(`stops.position: runs from 0 to 1, got ${position[0]} to ${position[position.length - 1]}`);
  }
  position.forEach((p, i) => {
    if (i > 0 && !(p > position[i - 1])) say(`stops.position[${i}]: rises strictly, got ${p} after ${position[i - 1]}`);
  });
  weight.forEach((w, i) => {
    if (!(w >= 0 && w <= 1)) say(`stops.weight[${i}]: lies in [0, 1], got ${w}`);
    if (i > 0 && w > weight[i - 1]) say(`stops.weight[${i}]: never rises, got ${w} after ${weight[i - 1]}`);
  });
  return undefined;
}

const TIERS = new Set(['core', 'deep']);
function checkBlendGraph(file, json, errors) {
  const say = (message) => errors.push(`${file}: field.graph: ${message}`);
  const graph = kokonada(json.field?.graph);
  const nodes = isObject(graph.nodes) ? Object.keys(graph.nodes) : [];
  if (nodes.length < 2) {
    say(`nodes: the blend graph names at least two nodes, got ${JSON.stringify(graph.nodes ?? null)}`);
  }
  const tier = graph.nodeTier;
  if (!(isObject(tier) && Object.keys(tier).sort().join() === FACES.join())) {
    say(`nodeTier: one tier per face, exactly ${FACES.join(' and ')}, a runtime static (DEC-172), got ${JSON.stringify(tier ?? null)}`);
  } else {
    for (const face of FACES) if (!TIERS.has(tier[face])) say(`nodeTier.${face}: core or deep, got ${JSON.stringify(tier[face])}`);
  }
  const edges = graph.edges;
  if (!(isObject(edges) && Array.isArray(edges.straight) && Array.isArray(edges.waypoint))) {
    return say(`edges: { straight, waypoint, restIntense } are runtime statics (DEC-172), got ${JSON.stringify(edges ?? null)}`);
  }
  const listed = [
    ...edges.straight.map((edge, i) => [`edges.straight[${i}]`, edge]),
    ...edges.waypoint.map((edge, i) => [`edges.waypoint[${i}]`, edge]),
    ['edges.restIntense', edges.restIntense],
  ];
  const joined = new Map();
  for (const [where, edge] of listed) {
    if (!(Array.isArray(edge) && edge.length === 2 && edge.every((n) => typeof n === 'string'))) {
      say(`${where}: an edge is a pair of node names, got ${JSON.stringify(edge ?? null)}`);
      continue;
    }
    const unknown = edge.filter((n) => !nodes.includes(n));
    if (unknown.length > 0) {
      say(`${where}: ${unknown.join(' and ')} is not a node of the graph (${nodes.join(', ')})`);
      continue;
    }
    if (edge[0] === edge[1]) {
      say(`${where}: joins ${edge[0]} to itself`);
      continue;
    }
    const pair = [...edge].sort().join('–');
    if (joined.has(pair)) say(`${where}: joins ${pair} again, as ${joined.get(pair)} does`);
    else joined.set(pair, where);
  }
  // topTwoSoft can pick any two nodes, so every pair needs exactly one edge.
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const pair = [nodes[i], nodes[j]].sort().join('–');
      if (!joined.has(pair)) say(`edges: ${pair} is never joined; every pair of nodes is joined exactly once`);
    }
  }
  return undefined;
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
    checkDrift(base.name, base.json, errors);
    checkFallbackStops(base.name, base.json, errors);
    checkBlendGraph(base.name, base.json, errors);
  }
  for (const source of sources.filter((s) => DIRECTION_FILE.test(s.name))) {
    const tokens = checkFile(source.name, source.json, errors, notes);
    checkLightShadows(source.name, tokens, errors);
    checkRestLobes(source.name, source.json, tokens, errors);
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
