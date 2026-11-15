// The evidence manifest (OPS-100; V1 plan section 7). One row per capture, validated before it is
// written: a row is evidence only if it states exactly what was on the device and from which build.
// The schema is strict: an unknown field is an error, so a typo cannot pass as a new fact.
// buildType is always "lab": these captures are V1 and G8 evidence, never G11 (QA-031).
// B8-5a: a row also states the scene facts (the shot's expect, F4), the render facts they imply, the GPU and display
// facts adb read (F5: a fact the harness could not read is null, and then its object says why), the Skia version of
// the lockfile at HEAD, READY's shader reason (UI-226) and READY's stage rect (UI-216). No tap coordinate and no emotion
// value is a manifest field (T1).

const HEX64 = /^[0-9a-f]{64}$/;
const SHA1 = /^[0-9a-f]{40}$/;
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const check = (test, says) => (v) => (test(v) ? null : says);
const string = check((v) => typeof v === 'string' && v.length > 0, 'must be a non-empty string');
const nullableString = check((v) => v === null || (typeof v === 'string' && v.length > 0), 'must be a string or null');
const boolean = check((v) => typeof v === 'boolean', 'must be a boolean');
const nullableBoolean = check((v) => v === null || typeof v === 'boolean', 'must be a boolean or null');
const int = (min) => check((v) => Number.isInteger(v) && v >= min, `must be an integer >= ${min}`);
const number = (min) => check((v) => typeof v === 'number' && Number.isFinite(v) && v >= min, `must be a finite number >= ${min}`);
const nullableNumber = (min) => check((v) => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= min), `must be a finite number >= ${min} or null`);
const hex64 = check((v) => typeof v === 'string' && HEX64.test(v), 'must be 64 lowercase hex characters (sha256)');
const sha1 = check((v) => typeof v === 'string' && SHA1.test(v), 'must be 40 lowercase hex characters (a full git sha)');
const literal = (x) => check((v) => v === x, `must be ${JSON.stringify(x)}`);
const oneOf = (list) => check((v) => list.includes(v), `must be one of ${list.join(', ')}`);
const nullableOneOf = (list) => check((v) => v === null || list.includes(v), `must be one of ${list.join(', ')} or null`);
const nullablePositive = check((v) => v === null || (typeof v === 'number' && Number.isFinite(v) && v > 0), 'must be a finite number > 0 or null');
const semver = check((v) => typeof v === 'string' && SEMVER.test(v), 'must be a semver version');
const iso = check((v) => typeof v === 'string' && ISO.test(v) && !Number.isNaN(Date.parse(v)), 'must be an ISO 8601 UTC timestamp');

// A schema node that may also be null.
const NULLABLE = Symbol('nullable');
const orNull = (schema) => ({ [NULLABLE]: schema });

const RECT = { x: int(0), y: int(0), width: int(1), height: int(1) };
const PX = { x: number(-Infinity), y: number(-Infinity), width: number(-Infinity), height: number(-Infinity) };

const SCHEMA = {
  shot: string,
  repeat: int(1),
  file: string,
  sha256: hex64,
  appRegionHash: hex64,
  commit: { sha: sha1, porcelainEmpty: literal(true) },
  stamp: { bundleSha256: hex64, tokens: { '*': hex64 } },
  device: { model: string, fingerprint: string, width: int(1), height: int(1), density: int(1), refreshRate: nullableNumber(1) },
  app: { package: string, apkSha256: hex64, buildType: literal('lab'), hermes: literal(true), dev: literal(false) },
  scene: string,
  direction: nullableString,
  face: nullableString,
  // requested: the plan; observed: the OS setting (adb); app: what the app reported at READY.
  fontScale: { requested: number(0.1), observed: number(0.1), app: number(0.1) },
  motion: { reduceMotionObserved: boolean, powerSaveObserved: boolean, tier: nullableString },
  locale: string,
  // From READY. The harness refuses a shot unless it is true (F-13), so a written row says true.
  isRTL: nullableBoolean,
  clock: { mode: oneOf(['fixed', 'stepped', 'realtime']), t: nullableNumber(0), seq: int(0) },
  shaderStatus: nullableString,
  uimode: oneOf(['night', 'day']),
  animatorScales: { window: number(0), transition: number(0), animator: number(0) },
  forceDark: boolean,
  colorSpace: literal('sRGB'),
  region: RECT,
  probes: { inside: { '*': RECT }, excluded: [{ id: string, reason: string, px: PX }] },
  timestamps: { launched: iso, ready: iso, captured: iso },
  // F4: what the scene is, from the shot's expect (pinned to the catalogue by jest), never from a lab line.
  expect: { direction: nullableString, face: nullableOneOf(['dark', 'light']), hero: nullableString, tier: nullableOneOf(['full', 'low', 'still']) },
  // The field canvas's render scale and the upscale's sampling the expect's tier implies; both null for a scene with no tier.
  renderScale: nullablePositive,
  sampling: orNull({ filter: oneOf(['linear', 'nearest']), mipmap: oneOf(['none', 'nearest', 'linear']) }),
  // F5, from adb: null only with a reason.
  gl: { renderer: nullableString, gles: nullableString, reason: nullableString },
  display: { colorMode: nullableString, wideColor: nullableBoolean, refreshMode: nullableString, reason: nullableString },
  skiaVersion: semver,
  shaderReason: nullableString,
  // READY's stage probe in px (window coordinates, which the harness requires to be the screen's).
  stage: PX,
};

// A fact object whose facts may be null: then, and only then, its reason says why.
const REASONED = ['gl', 'display'];

function walk(schema, value, path, errors) {
  if (schema !== null && typeof schema === 'object' && NULLABLE in schema) {
    if (value === null) return;
    schema = schema[NULLABLE];
  }
  if (typeof schema === 'function') {
    const says = schema(value);
    if (says) errors.push(`${path} ${says}`);
    return;
  }
  if (Array.isArray(schema)) {
    if (!Array.isArray(value)) { errors.push(`${path} must be a list`); return; }
    value.forEach((item, i) => walk(schema[0], item, `${path}[${i}]`, errors));
    return;
  }
  if (!isObject(value)) { errors.push(`${path} must be an object`); return; }
  const at = (key) => (path ? `${path}.${key}` : key);
  if ('*' in schema) {
    for (const [key, item] of Object.entries(value)) walk(schema['*'], item, at(key), errors);
    return;
  }
  for (const key of Object.keys(schema)) {
    if (value[key] === undefined) errors.push(`${at(key)} is required`);
    else walk(schema[key], value[key], at(key), errors);
  }
  for (const key of Object.keys(value)) if (!(key in schema)) errors.push(`${at(key)} is not a manifest field`);
}

/** Every way a row departs from the schema, each naming its field path. [] for a valid row. */
export function validateRow(row) {
  const errors = [];
  walk(SCHEMA, row, '', errors);
  if (!isObject(row)) return errors;
  for (const key of REASONED) {
    const facts = row[key];
    if (!isObject(facts)) continue;
    const unread = Object.keys(SCHEMA[key]).filter((k) => k !== 'reason' && facts[k] === null);
    if (unread.length > 0 && !(typeof facts.reason === 'string' && facts.reason.length > 0)) errors.push(`${key}.reason must say why a fact is null (${unread.join(', ')})`);
    if (unread.length === 0 && facts.reason !== null && facts.reason !== undefined) errors.push(`${key}.reason must be null when every fact is read`);
  }
  if (row.renderScale !== undefined && row.sampling !== undefined && (row.renderScale === null) !== (row.sampling === null)) {
    errors.push('renderScale and sampling are both null or both set');
  }
  return errors;
}

const SKIA = '@shopify/react-native-skia';

/**
 * The Skia version the lockfile installs: { version, reason } — the version and null, or null and why. Never a guess.
 * @param {string} text the package-lock.json at HEAD
 */
export function readSkiaVersion(text) {
  let lock;
  try { lock = JSON.parse(text); } catch { return { version: null, reason: 'the lockfile is not JSON' }; }
  if (!isObject(lock) || !isObject(lock.packages)) return { version: null, reason: 'the lockfile has no packages (lockfileVersion 2 or 3)' };
  const entry = lock.packages[`node_modules/${SKIA}`];
  if (!isObject(entry)) return { version: null, reason: `${SKIA} is not in the lockfile` };
  if (typeof entry.version !== 'string' || !SEMVER.test(entry.version)) return { version: null, reason: `${SKIA} has no semver version in the lockfile` };
  return { version: entry.version, reason: null };
}
