// The evidence manifest (OPS-100; V1 plan section 7). One row per capture, validated before it is
// written: a row is evidence only if it states exactly what was on the device and from which build.
// The schema is strict: an unknown field is an error, so a typo cannot pass as a new fact.
// buildType is always "lab": these captures are V1 and G8 evidence, never G11 (QA-031).
// B8-5a: a row also states the scene facts (the shot's expect, F4), the render facts they imply, the GPU and display
// facts adb read (F5: a fact the harness could not read is null, and then its object says why), the Skia version of
// the lockfile at HEAD, READY's shader reason (UI-226) and READY's stage rect (UI-216). No tap coordinate and no emotion
// value is a manifest field (T1).
// UI-240: a row also carries READY's pixel ratio, the px per dp every report reads (rowPixelRatio); the row and the
// manifest are built here (buildRow, buildManifest) for the harness and the reports' fixtures alike, and the manifest's
// top level has its own validator (validateManifest).
// UI-276: a row also names its schema version and the Skia backend that drew it (skiaBackend, READY's:
// src/design/lab/skiaBackend.ts reads it from react-native-skia on the device), which a report reads through
// rowSkiaBackend and a model validated on one backend holds to through skiaBackendProblem. The field came with version 2;
// a row of version 1, or of no version, was written before it and stays valid as written (architect ruling A5).

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
const positive = check((v) => typeof v === 'number' && Number.isFinite(v) && v > 0, 'must be a finite number > 0');
const nullablePositive = check((v) => v === null || (typeof v === 'number' && Number.isFinite(v) && v > 0), 'must be a finite number > 0 or null');
const semver = check((v) => typeof v === 'string' && SEMVER.test(v), 'must be a semver version');
const iso = check((v) => typeof v === 'string' && ISO.test(v) && !Number.isNaN(Date.parse(v)), 'must be an ISO 8601 UTC timestamp');

// A schema node that may also be null.
const NULLABLE = Symbol('nullable');
const orNull = (schema) => ({ [NULLABLE]: schema });

const RECT = { x: int(0), y: int(0), width: int(1), height: int(1) };
const PX = { x: number(-Infinity), y: number(-Infinity), width: number(-Infinity), height: number(-Infinity) };

/** UI-276: the Skia backends a row may name (src/design/lab/skiaBackend.ts SKIA_BACKENDS, pinned equal by jest). */
export const SKIA_BACKENDS = Object.freeze(['ganesh-gl', 'graphite']);
/** UI-276: the row schema the harness writes, and every version a row may name (none is version 1). */
export const ROW_SCHEMA_VERSION = 2;
export const ROW_SCHEMA_VERSIONS = Object.freeze([1, 2]);

// The schema of the version the harness writes (ROW_SCHEMA_VERSION).
const SCHEMA = {
  schemaVersion: oneOf(ROW_SCHEMA_VERSIONS),
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
  // UI-276: READY's Skia backend and how the lab read it, or null and why (never refused at capture: a report decides).
  skiaBackend: { backend: nullableOneOf(SKIA_BACKENDS), readBy: nullableString, reason: nullableString },
  shaderReason: nullableString,
  // READY's stage probe in px (window coordinates, which the harness requires to be the screen's).
  stage: PX,
  // UI-240: READY's pixel ratio (PixelRatio.get(), Android's DisplayMetrics.density): the px per dp every report reads.
  pixelRatio: positive,
};

// A fact object whose facts may be null: then, and only then, its reason says why. The run's render facts are the first
// two (validateManifest); a row also has its Skia backend.
const RENDER_REASONED = ['gl', 'display'];
const REASONED = [...RENDER_REASONED, 'skiaBackend'];

// UI-276 (architect ruling A5): skiaBackend came with row schema version 2, and a version-2 row must carry it. A row of
// no version, or version 1, is one the harness wrote before (every session up to UI-276, the 91d6940 evidence among
// them): it is held to the fields it was written with (no skiaBackend, and no schemaVersion unless it names 1), so it
// stays valid as written and is never rewritten, and a reader names its backend SKIA_BACKEND_UNRECORDED. The harness
// writes version 2.
export const SKIA_BACKEND_UNRECORDED = 'recorded before UI-276';
const SCHEMA_V1 = Object.fromEntries(Object.entries(SCHEMA).filter(([key]) => key !== 'schemaVersion' && key !== 'skiaBackend'));
const SCHEMA_V1_NAMED = { schemaVersion: literal(1), ...SCHEMA_V1 };

/** The schema a row is held to, by the version it names: none, or 1, is version 1; anything else is held to the current one. */
const rowSchema = (row) => {
  const version = isObject(row) ? row.schemaVersion : undefined;
  if (version === undefined) return SCHEMA_V1;
  return version === 1 ? SCHEMA_V1_NAMED : SCHEMA;
};

/** A row written before UI-276, as it was written: version 1 (named or not), and no skiaBackend. */
const recordedBeforeSkiaBackend = (row) => isObject(row) && (row.schemaVersion === undefined || row.schemaVersion === 1) && row.skiaBackend === undefined;

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
  walk(rowSchema(row), row, '', errors);
  if (!isObject(row)) return errors;
  for (const key of REASONED) errors.push(...reasonErrors(row[key], key, key));
  if (row.renderScale !== undefined && row.sampling !== undefined && (row.renderScale === null) !== (row.sampling === null)) {
    errors.push('renderScale and sampling are both null or both set');
  }
  // UI-276: a backend always says how it was read, and no backend never does (why is its reason).
  const backend = row.skiaBackend;
  if (isObject(backend) && backend.backend !== undefined && backend.readBy !== undefined && (backend.backend === null) !== (backend.readBy === null)) {
    errors.push('skiaBackend.backend and skiaBackend.readBy are both null or both set');
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

// ---- UI-276: the Skia backend that drew a row

/**
 * READY's skiaBackend as a row states it: a copy of its three facts, or, when READY names none, null and why. A fact out
 * of form is kept as it came, for validateRow to refuse, naming the field.
 */
function readySkiaBackend(fact) {
  if (fact === undefined || fact === null) return { backend: null, readBy: null, reason: 'READY names no Skia backend' };
  if (!isObject(fact)) return fact;
  return { backend: fact.backend, readBy: fact.readBy, reason: fact.reason };
}

/**
 * The Skia backend a report reads from a row: { backend, readBy, reason }, a copy of the row's own, or null and why. A row
 * written before UI-276 (version 1, named or not) says SKIA_BACKEND_UNRECORDED, and is not rewritten; a row that lacks
 * the field its version requires, names a version the harness never wrote, or holds a fact out of form (rows validateRow
 * refuses) is named so, never read as a backend.
 */
export function rowSkiaBackend(row) {
  const none = (reason) => ({ backend: null, readBy: null, reason });
  if (!isObject(row)) return none('not a row');
  if (recordedBeforeSkiaBackend(row)) return none(SKIA_BACKEND_UNRECORDED);
  const version = row.schemaVersion;
  if (version !== undefined && !ROW_SCHEMA_VERSIONS.includes(version)) return none(`the row's schema version ${JSON.stringify(version)} is not one the harness writes (validateRow refuses it)`);
  const fact = row.skiaBackend;
  if (fact === undefined) return none(`the row has no skiaBackend, though its schema version ${ROW_SCHEMA_VERSION} requires one (validateRow refuses it)`);
  const malformed = none('the row\'s skiaBackend is not one the harness writes (validateRow refuses it)');
  if (version !== ROW_SCHEMA_VERSION) return malformed;
  const errors = [];
  walk(SCHEMA.skiaBackend, fact, 'skiaBackend', errors);
  errors.push(...reasonErrors(fact, 'skiaBackend', 'skiaBackend'));
  if (errors.length > 0 || (fact.backend === null) !== (fact.readBy === null)) return malformed;
  return { backend: fact.backend, readBy: fact.readBy, reason: fact.reason };
}

/**
 * Why a model of the device's drawing validated on `validatedOn` (backend names) must not be applied to this row, or null
 * (UI-272's fallback twin: its ring coverage is the S22+'s Ganesh GL coverage). A row whose backend was not read is
 * refused with its reason. A row written before UI-276 names none either: it is refused unless the caller accepts those
 * rows by name ({ acceptRecordedBefore: true }), as a model validated on that very evidence may, saying so in its report.
 * It reads skiaBackend only: what else the model holds to (the Skia version, the GPU) is the caller's. A validatedOn that
 * is not a non-empty list of SKIA_BACKENDS is the caller's mistake: it throws.
 */
export function skiaBackendProblem(row, validatedOn, { acceptRecordedBefore = false } = {}) {
  if (!Array.isArray(validatedOn) || validatedOn.length === 0 || !validatedOn.every((b) => SKIA_BACKENDS.includes(b))) {
    throw new Error(`validatedOn must be a non-empty list of ${SKIA_BACKENDS.join(', ')}, got ${JSON.stringify(validatedOn ?? null)}`);
  }
  const only = `the model was validated on ${validatedOn.join(', ')} only`;
  const { backend, readBy, reason } = rowSkiaBackend(row);
  if (backend !== null) return validatedOn.includes(backend) ? null : `the row was drawn by ${backend} (${readBy}), and ${only}`;
  if (acceptRecordedBefore && recordedBeforeSkiaBackend(row)) return null;
  return `the row names no Skia backend (${reason}), and ${only}`;
}

// ---- UI-240: the builders, used by the harness (capture.mjs) and by the reports' fixtures (reports/__fixtures__/rows.ts)

/**
 * One manifest row from the sources the harness holds for a shot. Pure: it assembles, it does not judge (validateRow does).
 * @param {{ shot: any, repeat: number, file: string, sha256: string, appRegionHash: string, build: any, app: { package: string },
 *           facts: any, frame: { width: number, height: number, colorSpace: string }, observed: any, ready: any,
 *           region: any, probes: any, timestamps: { launched: Date, ready: Date, captured: Date },
 *           renderFacts: { renderScale: number|null, sampling: any }, render: { gl: any, display: any } }} s
 *   shot: the plan's shot; build: what checkBuild verified, with skiaVersion; facts: readDeviceFacts; frame: the first grab;
 *   observed: applyShot's settings; ready: READY's payload; probes: classifyProbes; renderFacts: capture.mjs renderFacts.
 */
export function buildRow({ shot, repeat, file, sha256, appRegionHash, build, app, facts, frame, observed, ready, region, probes, timestamps, renderFacts, render }) {
  const stage = ready.probes.stage.px;
  return {
    schemaVersion: ROW_SCHEMA_VERSION,
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
    skiaBackend: readySkiaBackend(ready.skiaBackend),
    shaderReason: typeof ready.shaderReason === 'string' && ready.shaderReason.length > 0 ? ready.shaderReason : null,
    stage: { x: stage.x, y: stage.y, width: stage.width, height: stage.height },
    pixelRatio: ready.pixelRatio,
  };
}

/**
 * The run's manifest around its rows. Pure. The run failed when a shot failed or a restore step did.
 * @param {{ planId: string, failure: Error|null, restoreFailures: string[], build: any, facts: any, render: any,
 *           startedAt: string, finishedAt: string, rows: any[], determinism: any[],
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
  if (isObject(m.render)) for (const key of RENDER_REASONED) errors.push(...reasonErrors(m.render[key], key, `render.${key}`));
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

// ---- UI-240: the px per dp

/**
 * Android's px per dp for a density: DisplayMetrics.density = densityDpi × DENSITY_DEFAULT_SCALE (1f / 160), computed in
 * float, which React Native's PixelRatio.get() returns as it is. At 411 dpi that is 2.5687501430511475, not 2.56875.
 */
export function androidDensity(dpi) {
  return Math.fround(Math.fround(dpi) * Math.fround(1 / 160));
}

/** How far READY's pixel ratio may be from Android's density for the row's dpi: float noise, never a second density. */
export const PIXEL_RATIO_AGREEMENT = 1e-6;

/**
 * A row's px per dp: READY's pixel ratio, held to Android's float density for the row's device.density within
 * PIXEL_RATIO_AGREEMENT, the density only a cross-check. { pixelRatio } or, naming the field, { field, why }.
 */
export function rowPixelRatio(row) {
  const k = isObject(row) ? row.pixelRatio : undefined;
  if (k === undefined) return { field: 'pixelRatio', why: "is missing: the px per dp is READY's pixel ratio, never one derived from the density" };
  if (!(typeof k === 'number' && Number.isFinite(k) && k > 0)) return { field: 'pixelRatio', why: `must be READY's pixel ratio, a finite number above 0, got ${JSON.stringify(k)}` };
  const dpi = isObject(row.device) ? row.device.density : undefined;
  if (!(typeof dpi === 'number' && Number.isFinite(dpi) && dpi > 0)) return { field: 'device.density', why: `must be a dpi above 0, got ${JSON.stringify(dpi ?? null)}` };
  const android = androidDensity(dpi);
  if (!(Math.abs(k - android) <= PIXEL_RATIO_AGREEMENT)) {
    return { field: 'pixelRatio', why: `is ${k}, not Android's density ${android} for device.density ${dpi} dpi: they must agree within ${PIXEL_RATIO_AGREEMENT.toExponential()}` };
  }
  return { pixelRatio: k };
}
