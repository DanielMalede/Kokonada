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

/** A REASONED fact object (SCHEMA[key]) at `path`: a null fact needs its reason, and a reason needs a null fact. */
function reasonErrors(facts, key, path) {
  if (!isObject(facts)) return [];
  const unread = Object.keys(SCHEMA[key]).filter((k) => k !== 'reason' && facts[k] === null);
  if (unread.length > 0 && !(typeof facts.reason === 'string' && facts.reason.length > 0)) return [`${path}.reason must say why a fact is null (${unread.join(', ')})`];
  if (unread.length === 0 && facts.reason !== null && facts.reason !== undefined) return [`${path}.reason must be null when every fact is read`];
  return [];
}

/** Every way a row departs from the schema, each naming its field path. [] for a valid row. */
export function validateRow(row) {
  const errors = [];
  walk(SCHEMA, row, '', errors);
  if (!isObject(row)) return errors;
  for (const key of REASONED) errors.push(...reasonErrors(row[key], key, key));
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

// ---- UI-240: the builders, used by the harness (capture.mjs) and by the reports' fixtures (reports/__fixtures__/rows.ts)

/**
 * One manifest row from the sources the harness holds for a shot. Pure: it assembles, it does not judge (validateRow does).
 * @param {{ shot: any, repeat: number, file: string, sha256: string, appRegionHash: string, build: any, app: { package: string },
 *           facts: any, frame: { width: number, height: number, colorSpace: string }, observed: any, ready: any,
 *           region: any, probes: any, timestamps: { launched: Date, ready: Date, captured: Date },
 *           renderFacts: { renderScale: number|null, sampling: object|null }, render: { gl: any, display: any } }} s
 *   shot: the plan's shot; build: what checkBuild verified, with skiaVersion; facts: readDeviceFacts; frame: the first grab;
 *   observed: applyShot's settings; ready: READY's payload; probes: classifyProbes; renderFacts: capture.mjs renderFacts.
 */
export function buildRow({ shot, repeat, file, sha256, appRegionHash, build, app, facts, frame, observed, ready, region, probes, timestamps, renderFacts, render }) {
  const stage = ready.probes.stage.px;
  return {
    shot: shot.id, repeat, file, sha256, appRegionHash,
    commit: { sha: build.head, porcelainEmpty: true },
    stamp: { bundleSha256: build.stamp.bundleSha256, tokens: build.stamp.tokens ?? {} },
    device: { model: facts.model, fingerprint: facts.fingerprint, width: frame.width, height: frame.height, density: facts.density, refreshRate: facts.refreshRate },
    app: { package: app.package, apkSha256: build.apkSha256, buildType: 'lab', hermes: build.hermes, dev: build.stamp.dev },
    scene: shot.scene, direction: shot.expect.direction, face: shot.expect.face,
    fontScale: { requested: shot.device.fontScale, observed: observed.fontScale, app: ready.fontScale },
    motion: { reduceMotionObserved: observed.animatorScales.transition === 0, powerSaveObserved: ready.powerSave === true, tier: ready.tier ?? null },
    locale: facts.locale,
    isRTL: ready.isRTL, // checkReady refused anything but true
    clock: { mode: ready.clock, t: ready.t ?? null, seq: ready.seq },
    shaderStatus: ready.shaderStatus ?? null,
    uimode: observed.night === 'yes' ? 'night' : 'day',
    animatorScales: observed.animatorScales,
    forceDark: facts.forceDark,
    colorSpace: frame.colorSpace,
    region,
    probes,
    timestamps: { launched: timestamps.launched.toISOString(), ready: timestamps.ready.toISOString(), captured: timestamps.captured.toISOString() },
    // F4: the scene facts are the shot's expect (pinned to the catalogue by jest), never a lab line's.
    expect: { direction: shot.expect.direction, face: shot.expect.face, hero: shot.expect.hero, tier: shot.expect.tier },
    renderScale: renderFacts.renderScale,
    sampling: renderFacts.sampling,
    gl: render.gl,
    display: render.display,
    skiaVersion: build.skiaVersion,
    shaderReason: typeof ready.shaderReason === 'string' && ready.shaderReason.length > 0 ? ready.shaderReason : null,
    stage: { x: stage.x, y: stage.y, width: stage.width, height: stage.height },
  };
}

/**
 * The run's manifest around its rows. Pure. The run failed when a shot failed or a restore step did.
 * @param {{ planId: string, failure: Error|null, restoreFailures: string[], build: any, facts: any, render: any,
 *           startedAt: string, finishedAt: string, rows: object[], determinism: object[],
 *           out: { proofs: any[], checks: any[], results: any[], records: any[], moving: any[], settleFailures: any[] } }} p
 */
export function buildManifest({ planId, failure, restoreFailures, build, facts, render, startedAt, finishedAt, rows, determinism, out }) {
  return {
    plan: planId,
    outcome: failure || restoreFailures.length ? 'failed' : 'passed',
    failure: failure ? failure.message : null,
    restoreFailures,
    commit: build.head, stamp: build.stamp, apkSha256: build.apkSha256,
    device: facts, render, skiaVersion: build.skiaVersion, startedAt, finishedAt,
    rows, determinism, proofs: out.proofs, checks: out.checks, results: out.results, records: out.records,
    moving: out.moving, settleFailures: out.settleFailures,
  };
}

const object = check(isObject, 'must be an object');
const objects = [object];

// The top level: the run's facts, strict like a row. A row is judged by validateRow where it is read (the harness before it
// keeps the row, every report's reader before it reads one); here a row is only an object in the list. So is an entry of
// the other lists: each report that reads one holds it to its own reader (reports/lib/proofs.mts, recordBinding.mjs).
const MANIFEST = {
  plan: string,
  outcome: oneOf(['passed', 'failed']),
  failure: nullableString,
  restoreFailures: [string],
  commit: sha1,
  // The lab stamp (lib/stamp.mjs makeStamp), as checkBuild verified it.
  stamp: { commit: sha1, porcelainEmpty: literal(true), bundleSha256: hex64, tokens: { '*': hex64 }, entry: string, dev: literal(false), createdAt: iso },
  apkSha256: hex64,
  // lib/device.mjs readDeviceFacts.
  device: { model: string, fingerprint: string, width: int(1), height: int(1), density: int(1), refreshRate: nullableNumber(1), forceDark: boolean, locale: string },
  // lib/device.mjs readRenderFacts: a fact adb did not give is null, and then its object says why.
  render: { gl: SCHEMA.gl, display: SCHEMA.display },
  skiaVersion: semver,
  startedAt: iso,
  finishedAt: iso,
  rows: objects,
  determinism: objects,
  proofs: objects,
  checks: objects,
  results: objects,
  records: objects,
  moving: objects,
  settleFailures: objects,
};

/** Every way a manifest's top level departs from what the harness writes, each naming its field path. [] for a valid one. */
export function validateManifest(manifest) {
  const errors = [];
  walk(MANIFEST, manifest, '', errors);
  if (!isObject(manifest)) return errors;
  const m = manifest;
  if (isObject(m.render)) for (const key of REASONED) errors.push(...reasonErrors(m.render[key], key, `render.${key}`));
  if (isObject(m.stamp) && typeof m.stamp.commit === 'string' && typeof m.commit === 'string' && m.stamp.commit !== m.commit) {
    errors.push(`stamp.commit must be the manifest's commit ${m.commit}, got ${m.stamp.commit}`);
  }
  const failed = (m.failure !== null && m.failure !== undefined) || (Array.isArray(m.restoreFailures) && m.restoreFailures.length > 0);
  if (m.outcome === 'passed' && failed) errors.push('outcome is "passed", but failure is not null or restoreFailures is not empty');
  if (m.outcome === 'failed' && !failed) errors.push('outcome is "failed", but failure is null and restoreFailures is empty');
  if (typeof m.startedAt === 'string' && typeof m.finishedAt === 'string' && ISO.test(m.startedAt) && ISO.test(m.finishedAt)
    && Date.parse(m.finishedAt) < Date.parse(m.startedAt)) {
    errors.push('finishedAt must not be before startedAt');
  }
  return errors;
}
