// The evidence manifest (OPS-100; V1 plan section 7). One row per capture, validated before it is
// written: a row is evidence only if it states exactly what was on the device and from which build.
// The schema is strict: an unknown field is an error, so a typo cannot pass as a new fact.
// buildType is always "lab": these captures are V1 and G8 evidence, never G11 (QA-031).

const HEX64 = /^[0-9a-f]{64}$/;
const SHA1 = /^[0-9a-f]{40}$/;
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
const iso = check((v) => typeof v === 'string' && ISO.test(v) && !Number.isNaN(Date.parse(v)), 'must be an ISO 8601 UTC timestamp');

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
  fontScale: { requested: number(0.1), observed: number(0.1) },
  motion: { reduceMotionObserved: boolean, powerSaveObserved: boolean, tier: nullableString },
  locale: string,
  // From READY when the lab reports it; null when this lab build does not (see the OPS-100 report).
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
};

function walk(schema, value, path, errors) {
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
  return errors;
}
