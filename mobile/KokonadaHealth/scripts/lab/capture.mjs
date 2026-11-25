// The Design Lab capture harness (OPS-100).
//
//   node scripts/lab/capture.mjs --plan scripts/lab/capture-plans/smoke.json --out <folder outside the repo> [--serial <id>] [--apk <file>]
//   node scripts/lab/capture.mjs --plan scripts/lab/capture-plans/v1.json --out <folder>   a session plan: its parts in order (B8-10)
//   node scripts/lab/capture.mjs --check [--apk <file>]       the build's stamp chain only; no phone
//   node scripts/lab/capture.mjs --restore --out <folder> [--serial <id>]   put the phone back from that run's saved state
//
// Before it touches the phone it refuses unless: the plan is valid; the output folder is outside the
// repository (evidence never goes into git); the stamp chain holds (HEAD and an empty porcelain, the
// stamp, the bundle and the stamp inside the APK, Hermes bytecode carrying this tree's sentinel); the
// installed lab is exactly this APK; and the OS is not forcing dark mode onto apps.
// Then it writes the phone's original state to <out>/device-original-state.json, and only then
// changes anything. Every shot is launched fresh, waited for (READY, never a fixed sleep), grabbed
// raw twice (settle check), checked to be sRGB, cropped to the app region (the system bars excluded),
// hashed and kept as a lossless PNG, with a manifest row checked against its schema. A shot captured
// more than once must hash the same every time (QA-078). A still shot can prove it draws no frames.
// On every exit path, success, failure or Ctrl-C, the phone is restored, and manifest.json is written.
//
// B8-5b (the architect's B8 plan): every shot states its scene facts in `expect` {direction, face, hero, tier}, pinned to
// the lab's catalogue by jest (src/design/lab/__tests__/capturePlans.test.ts), and a row takes them from there, never
// from a lab line (F4, T1); the GPU and display facts come from adb (F5). The plan is strict: a key the harness does
// not read is an error (UI-215). A shot can ask for a pixel check (`checks.notFlat`) and one proof: zero-frames,
// draws-frames, rate (frames/s inside a band, UI-171), framestats (jank, informational), result (the bench's RESULT
// line) or record (screenrecord frames, F6). READY's stage must be the app window (UI-216), and an ERROR the lab sends
// after READY, up to the end of the shot, refuses it (UI-225).
//
// Exit codes: 0 passed · 1 the capture failed (or the phone was not fully restored) · 2 refused · 3 a session paused for
// the owner (run the same command again to go on).

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { findMarkers, readSentinel } from './assertLabExcluded.mjs';
import { createAdb } from './lib/adb.mjs';
import {
  applySession, applyShot, parseGfxFrames, parseJank, parseSystemBars, readDeviceFacts, readDisplayMode, readPowerSave, readRenderFacts, restoreDevice, snapshotDevice,
} from './lib/device.mjs';
import { androidDensity, buildManifest, buildRow, PIXEL_RATIO_AGREEMENT, readSkiaVersion, validateManifest, validateRow } from './lib/manifest.mjs';
import { appRegion, cropRegion, encodePng, parseRawScreencap, regionHash, requireSrgb } from './lib/png.mjs';
import { checkReady, checkResult, classifyProbes, collectLab, launchArgs, markArgs, PROBE_TOLERANCE_PX, waitForLab } from './lib/protocol.mjs';
import { Refused, verifyStampChain } from './lib/stamp.mjs';
import { readZipEntries } from './lib/zip.mjs';

// A refusal: nothing on the phone was changed (defined with the stamp chain, shared by the build scripts).
export { Refused };

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const HERMES_MAGIC = Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f]);
const LAB_ASSETS = 'android/app/src/lab/assets';
export const DEFAULT_APK = 'android/app/build/outputs/apk/lab/app-lab.apk';

// ---- the plan -----------------------------------------------------------------------------

const ID = /^[a-z0-9-]{1,40}$/;
const TOKEN = /^[A-Za-z0-9._-]+$/;
const NAME = /^[A-Za-z0-9._]+$/;
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const intIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const numIn = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

// zero-frames: a still shot draws nothing (QA-034, QA-035). draws-frames: its positive control, the
// same scene with motion allowed, must draw something, or the zero proves nothing.
// rate (UI-171): the frames gfxinfo counts per second, inside the plan's band (the tier's cap on the device).
// framestats: gfxinfo's jank summary, recorded and never judged (informational, DEC-082 is open).
// result: the bench's RESULT line for this run, held to the plan's contract (lib/protocol.mjs checkResult).
// record: the phone's mp4 from screenrecord at a reduced size (F6), kept beside the PNGs with its sha256; the storm
// report decodes it (this Android 16 build's screenrecord has no raw-frames output).
const PROOFS = ['zero-frames', 'draws-frames', 'rate', 'framestats', 'result', 'record'];
const PROOF_KEYS = {
  'zero-frames': ['kind', 'seconds'], 'draws-frames': ['kind', 'seconds'], rate: ['kind', 'seconds', 'band'],
  framestats: ['kind', 'seconds'], result: ['kind', 'seconds'], record: ['kind', 'seconds', 'size'],
};
// screenrecord's own limit.
const RECORD_MAX_SECONDS = 180;
// Where the phone's shell may write a file the harness then pulls and removes.
const RECORD_DIR = '/data/local/tmp';
// The keys the harness reads, by object: any other is an error, so a check it would ignore cannot look like one (UI-215).
const KEYS = {
  plan: ['id', 'app', 'readyTimeoutMs', 'settleMs', 'session', 'shots'],
  app: ['package', 'activity'],
  session: ['stayOn'],
  shot: ['id', 'repeat', 'scene', 'args', 'device', 'probes', 'expect', 'checks', 'proof'],
  device: ['fontScale', 'night', 'animatorScale', 'powerSave'],
  expect: ['direction', 'face', 'hero', 'tier'],
  checks: ['notFlat'],
  notFlat: ['probe', 'minRange'],
  band: ['min', 'max'],
  size: ['width', 'height'],
};
const FACES = ['dark', 'light'];
const TIERS = ['full', 'low', 'still'];
const DIRECTION = /^[a-z]+$/;
const evenIn = (v, lo, hi) => intIn(v, lo, hi) && v % 2 === 0;
const unknownKeys = (value, keys, at, e) => {
  for (const k of Object.keys(value)) if (!keys.includes(k)) e.push(`${at ? `${at}.` : ''}${k} is not a plan key`);
};

function validateExpect(x, at, e) {
  if (!isObject(x)) { e.push(`${at}.expect must be { direction, face, hero, tier }, each a value or null`); return; }
  unknownKeys(x, KEYS.expect, `${at}.expect`, e);
  if (!(x.direction === null || (typeof x.direction === 'string' && DIRECTION.test(x.direction)))) e.push(`${at}.expect.direction must be a direction id or null`);
  if (!(x.face === null || FACES.includes(x.face))) e.push(`${at}.expect.face must be dark, light or null`);
  if (!(x.hero === null || (typeof x.hero === 'string' && TOKEN.test(x.hero)))) e.push(`${at}.expect.hero must be a plain token or null`);
  if (!(x.tier === null || TIERS.includes(x.tier))) e.push(`${at}.expect.tier must be full, low, still or null`);
}

function validateChecks(s, at, e) {
  if (s.checks === undefined) return;
  if (!isObject(s.checks)) { e.push(`${at}.checks must be an object`); return; }
  unknownKeys(s.checks, KEYS.checks, `${at}.checks`, e);
  const nf = s.checks.notFlat;
  if (nf === undefined) return;
  if (!isObject(nf)) { e.push(`${at}.checks.notFlat must be { probe, minRange }`); return; }
  unknownKeys(nf, KEYS.notFlat, `${at}.checks.notFlat`, e);
  if (!(Array.isArray(s.probes) && s.probes.includes(nf.probe))) e.push(`${at}.checks.notFlat.probe must be one of the shot's probes`);
  if (!intIn(nf.minRange, 1, 255)) e.push(`${at}.checks.notFlat.minRange must be an integer from 1 to 255`);
}

function validateProof(p, at, e) {
  if (p === undefined) return;
  if (!isObject(p) || !PROOFS.includes(p.kind)) { e.push(`${at}.proof.kind must be one of ${PROOFS.join(', ')}`); return; }
  unknownKeys(p, PROOF_KEYS[p.kind], `${at}.proof`, e);
  const most = p.kind === 'record' ? RECORD_MAX_SECONDS : 120;
  if (!intIn(p.seconds, 1, most)) e.push(`${at}.proof.seconds must be an integer from 1 to ${most}`);
  if (p.kind === 'rate') {
    const b = p.band;
    if (!isObject(b) || !numIn(b.min, 0, 1000) || !numIn(b.max, 0, 1000) || b.min > b.max) e.push(`${at}.proof.band must be { min, max } with 0 <= min <= max <= 1000`);
    else unknownKeys(b, KEYS.band, `${at}.proof.band`, e);
  }
  if (p.kind === 'record') {
    const z = p.size;
    if (!isObject(z) || !evenIn(z.width, 2, 4096) || !evenIn(z.height, 2, 4096)) e.push(`${at}.proof.size must be { width, height }, even integers from 2 to 4096`);
    else unknownKeys(z, KEYS.size, `${at}.proof.size`, e);
  }
}

/** Every problem with a capture plan, as sentences. [] for a valid plan. */
export function validatePlan(plan) {
  const e = [];
  if (!isObject(plan)) return ['the plan must be an object'];
  unknownKeys(plan, KEYS.plan, '', e);
  if (!ID.test(plan.id ?? '')) e.push('id must be a short lowercase token');
  if (!isObject(plan.app) || !NAME.test(plan.app.package ?? '') || !NAME.test(plan.app.activity ?? '')) e.push('app.package and app.activity must be plain names');
  else unknownKeys(plan.app, KEYS.app, 'app', e);
  if (!intIn(plan.readyTimeoutMs, 100, 600000)) e.push('readyTimeoutMs must be an integer from 100 to 600000');
  if (!intIn(plan.settleMs, 0, 10000)) e.push('settleMs must be an integer from 0 to 10000');
  if (plan.session !== undefined && (!isObject(plan.session) || (plan.session.stayOn !== undefined && typeof plan.session.stayOn !== 'boolean'))) e.push('session.stayOn must be a boolean');
  else if (plan.session !== undefined) unknownKeys(plan.session, KEYS.session, 'session', e);
  if (!Array.isArray(plan.shots) || plan.shots.length === 0) return [...e, 'shots must be a non-empty list'];
  const seen = new Set();
  plan.shots.forEach((s, i) => {
    const at = `shots[${i}]`;
    if (!isObject(s)) { e.push(`${at} must be an object`); return; }
    unknownKeys(s, KEYS.shot, at, e);
    if (!ID.test(s.id ?? '')) e.push(`${at}.id must be a short lowercase token`);
    else if (seen.has(s.id)) e.push(`${at}.id ${s.id} is used twice`);
    seen.add(s.id);
    if (!intIn(s.repeat, 1, 10)) e.push(`${at}.repeat must be an integer from 1 to 10`);
    else if (s.repeat !== 1 && isObject(s.args) && isObject(s.device) && isObject(s.expect) && movingReason(s)) {
      e.push(`${at}.repeat must be 1 for a shot allowed to move: its frames differ by design, so two launches never hash the same`);
    }
    if (!TOKEN.test(s.scene ?? '')) e.push(`${at}.scene must be a plain token`);
    if (!isObject(s.args)) e.push(`${at}.args must be an object`);
    else for (const [k, v] of Object.entries(s.args)) {
      if (k === 'run' || k === 'scene') e.push(`${at}.args.${k} is set by the harness`);
      else if (!TOKEN.test(k) || typeof v !== 'string' || !TOKEN.test(v)) e.push(`${at}.args.${k} "${v}" is not a plain token`);
    }
    const d = s.device;
    if (!isObject(d)) e.push(`${at}.device must be an object`);
    else {
      if (!numIn(d.fontScale, 0.5, 3)) e.push(`${at}.device.fontScale must be a number from 0.5 to 3`);
      if (d.night !== 'yes' && d.night !== 'no') e.push(`${at}.device.night must be yes or no`);
      if (!numIn(d.animatorScale, 0, 10)) e.push(`${at}.device.animatorScale must be a number from 0 to 10`);
      if (typeof d.powerSave !== 'boolean') e.push(`${at}.device.powerSave must be a boolean`);
      unknownKeys(d, KEYS.device, `${at}.device`, e);
    }
    if (!Array.isArray(s.probes) || s.probes.length === 0 || !s.probes.every((p) => TOKEN.test(p))) e.push(`${at}.probes must be a non-empty list of probe ids`);
    validateExpect(s.expect, at, e);
    validateChecks(s, at, e);
    validateProof(s.proof, at, e);
  });
  return e;
}

// ---- the render facts an expect implies (F4) ---------------------------------------------------

/** The field image's upscale sampling (FIELD_SAMPLING in src/design/v2/field/fieldImage.tsx), pinned by capturePlans.test.ts. */
export const SAMPLING = Object.freeze({ filter: 'linear', mipmap: 'none' });
const TOKENS_FILE = 'design-tokens/base.tokens.json';

/**
 * The field canvas's render scale and its sampling for an expect tier, from the token file's field.tiers: low reads the
 * low tier; full and still read the full tier (the still is the full tier's law drawn once, designer 2.8, as
 * renderScaleFor in fieldDriver.ts, which capturePlans.test.ts pins this to). A scene with no tier has neither.
 */
export function renderFacts(tier, tiers) {
  if (tier === null) return { renderScale: null, sampling: null };
  const key = tier === 'low' ? 'low' : 'full';
  const value = tiers?.[key]?.renderScale?.$value;
  if (!(typeof value === 'number' && Number.isFinite(value) && value > 0)) throw new Refused(`${TOKENS_FILE} has no field.tiers.${key}.renderScale`);
  return { renderScale: value, sampling: { ...SAMPLING } };
}

/** field.tiers from the token file at HEAD (the stamp chain has proved the tree clean). Throws Refused. */
function readTiers(repoRoot) {
  const file = path.join(repoRoot, TOKENS_FILE);
  if (!fs.existsSync(file)) throw new Refused(`no ${TOKENS_FILE}: the render facts are read from it`);
  let tiers;
  try { tiers = JSON.parse(fs.readFileSync(file, 'utf8'))?.field?.tiers; } catch { throw new Refused(`${TOKENS_FILE} is not JSON`); }
  for (const tier of TIERS) renderFacts(tier, tiers);
  return tiers;
}

/** Skia's version from the lockfile at HEAD (the stamp chain has proved the tree clean). Throws Refused. */
function readSkia(appRoot) {
  const file = path.join(appRoot, 'package-lock.json');
  if (!fs.existsSync(file)) throw new Refused(`no package-lock.json in ${appRoot}: the Skia version is read from the lockfile at HEAD`);
  const { version, reason } = readSkiaVersion(fs.readFileSync(file, 'utf8'));
  if (version === null) throw new Refused(`the Skia version cannot be read: ${reason}`);
  return version;
}

// ---- the build (no phone needed) -----------------------------------------------------------

/** The stamp chain on disk and inside the APK. Throws Refused; returns what was verified. */
export function checkBuild({ appRoot, apkPath, git }) {
  const stampFile = path.join(appRoot, LAB_ASSETS, 'lab-stamp.json');
  const bundleFile = path.join(appRoot, LAB_ASSETS, 'index.android.bundle');
  if (!fs.existsSync(stampFile) || !fs.existsSync(bundleFile)) throw new Refused('no lab bundle or stamp: run node scripts/lab/bundleLab.mjs');
  if (!fs.existsSync(apkPath)) throw new Refused(`no lab APK at ${apkPath}: run node scripts/lab/buildLabApk.mjs`);
  const stamp = JSON.parse(fs.readFileSync(stampFile, 'utf8'));
  const apkBytes = fs.readFileSync(apkPath);
  const entries = readZipEntries(apkBytes);
  const bundle = entries.find((x) => x.name === 'assets/index.android.bundle');
  const stampEntry = entries.find((x) => x.name === 'assets/lab-stamp.json');
  const head = git.head();
  const problems = verifyStampChain({
    head, porcelain: git.porcelain(), stamp,
    apk: { bundleSha256: bundle ? sha256(bundle.data) : null, stamp: stampEntry ? JSON.parse(stampEntry.data.toString('utf8')) : null },
  });
  if (stamp.bundleSha256 !== sha256(fs.readFileSync(bundleFile))) problems.push('the bundle on disk is not the stamped one: run node scripts/lab/bundleLab.mjs');
  if (stamp.dev !== false) problems.push('the stamp does not record a --dev false bundle');
  const sentinel = readSentinel(appRoot);
  if (!bundle) problems.push('the APK carries no JS bundle');
  else {
    if (!bundle.data.subarray(0, 8).equals(HERMES_MAGIC)) problems.push('the APK bundle is not Hermes bytecode');
    if (findMarkers([sentinel], bundle.data).length === 0) problems.push("the APK bundle does not carry this tree's sentinel");
  }
  if (problems.length) throw new Refused(`the build cannot be captured:\n  ${problems.join('\n  ')}`);
  return { head, stamp, sentinel, hermes: true, apkSha256: sha256(apkBytes) };
}

// ---- one shot ---------------------------------------------------------------------------

// UI-223 (RA-36): the surface a shot must have been drawn by, by its scene's prefix. The lab's READY says which surface
// drew the scene (src/design/lab/shaderReport.ts): a field.* shot drawn by anything but the field shader (an effect that
// did not compile, a builder throw, or a READY that names no surface) is a picture of the fallback, never evidence of the
// field; a fallback.* shot is FieldFallback mounted by design. B8: the bench scenes (witness, grain, cost, storm) and
// the policy-tier field scenes draw the field through its surface, so each must say ready. F10 G8: a hero scene draws
// the field under the plate (FieldView), so it must say ready too. The smoke scene and the fonts scenes draw no field and
// are held to nothing. A scene that matches no rule is refused: nothing says what must have drawn it.
const SURFACES = [
  { prefix: 'field.', suffix: '.policy', status: 'ready', drawn: 'by the field shader, at the tier the motion policy chose' },
  { prefix: 'field.', status: 'ready', drawn: 'by the field shader, never its fallback' },
  { prefix: 'fallback.', status: 'fallback-scene', drawn: 'by the lab fallback scene' },
  { prefix: 'witness.', status: 'ready', drawn: 'by the field shader through its surface, never its fallback' },
  { prefix: 'grain.', status: 'ready', drawn: 'by the field shader through its surface, never its fallback' },
  { prefix: 'cost.', status: 'ready', drawn: 'by the field shader, never its fallback' },
  { prefix: 'storm.', status: 'ready', drawn: 'by the field shader, never its fallback' },
  { prefix: 'hero.', status: 'ready', drawn: 'by the field shader under the plate, never its fallback' },
  { prefix: 'fonts.', status: undefined, drawn: 'without the field' },
  { prefix: 'smoke', whole: true, status: undefined, drawn: 'without the field' },
];

/** The surface rule a scene id is held to, or null when none matches. */
export function surfaceRule(scene) {
  return SURFACES.find((r) => (r.whole ? scene === r.prefix : scene.startsWith(r.prefix) && (r.suffix === undefined || scene.endsWith(r.suffix)))) ?? null;
}

/** Why READY's surface is not the one the shot's scene must be drawn by, or null. */
export function surfaceProblem(scene, ready) {
  const rule = surfaceRule(scene);
  if (!rule) return `scene ${scene} has no surface rule: the harness cannot tell what must have drawn it (UI-223)`;
  if (rule.status === undefined) return null;
  const status = ready.shaderStatus ?? null;
  if (status === rule.status) return null;
  const why = typeof ready.shaderReason === 'string' && ready.shaderReason.length > 0 ? ` (${ready.shaderReason})` : '';
  return `READY says shaderStatus ${JSON.stringify(status)}${why}: a ${rule.prefix}* shot must be drawn ${rule.drawn} (UI-223)`;
}

// B8-6: a policy scene (`field.<direction>.<face>.<hero>.policy`) draws at the tier the device's motion policy gives,
// and READY says the tier it observed; the shot's expect.tier is the tier its device state implies. A READY whose tier
// differs means the policy did not give that tier. A READY that names no tier is held only on a policy scene: a scene
// whose id names its tier, or one that draws no field, may not report one.
/** Why READY's observed tier is not the shot's expect.tier, or null. */
export function tierProblem(scene, ready, expectTier) {
  const tier = ready.tier ?? null;
  if (tier === null && !scene.endsWith('.policy')) return null;
  if (tier === expectTier) return null;
  return `READY says tier ${JSON.stringify(tier)} but the shot's expect.tier is ${JSON.stringify(expectTier)} (the motion policy did not give the tier the device state implies)`;
}

// The settle check (two grabs settleMs apart must hash the same) is what proves a still shot still. A shot allowed to
// move differs between its grabs by design (the moving controls, the cost and storm benches), so it is not
// settle-checked: it is listed as moving instead, and its own proof (draws-frames, rate, a RESULT, a recording) is what
// it shows. A shot is allowed to move only when ALL of these hold: its clock is real time, motion is on (animatorScale
// above 0) and its expect.tier is not still. So every still shot keeps the check: a fixed or stepped clock, reduced
// motion, or a still tier each make the shot still, and a still shot that moves is refused.
/** Why a shot is allowed to move (not settle-checked), or null for a still shot. */
export function movingReason(shot) {
  // RA-46: a storm scene changes its taps and marker on its own JS timer, whatever the motion setting, so even its
  // still-tier shots differ between grabs; a recorded shot's evidence is its recording. Neither claims to be still.
  if (typeof shot.scene === 'string' && shot.scene.startsWith('storm.')) return 'a scene that changes on its own script (storm.*): not settle-checked';
  if (shot.proof?.kind === 'record') return 'a recorded shot (its recording is the evidence): not settle-checked';
  if (shot.args.clock !== 'realtime' || !(shot.device.animatorScale > 0) || shot.expect.tier === 'still') return null;
  return `a real-time clock with motion on at ${shot.expect.tier === null ? 'no fixed tier' : `the ${shot.expect.tier} tier`}: not settle-checked`;
}

/** Where two grabs differ inside a region: the pixel count and the bounding box in screen px (null when equal). */
export function regionDifference(a, b, region) {
  let pixels = 0;
  let x0 = Infinity; let y0 = Infinity; let x1 = -1; let y1 = -1;
  for (let y = region.y; y < region.y + region.height; y += 1) {
    for (let x = region.x; x < region.x + region.width; x += 1) {
      const i = (y * a.width + x) * 4;
      if (a.rgba[i] === b.rgba[i] && a.rgba[i + 1] === b.rgba[i + 1] && a.rgba[i + 2] === b.rgba[i + 2] && a.rgba[i + 3] === b.rgba[i + 3]) continue;
      pixels += 1;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  return { pixels, box: pixels === 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 } };
}

// UI-216: the scenes lay themselves out from the top of the window (heroLayout), and the harness reads probe rects in
// window coordinates as screen coordinates (classifyProbes). So READY's stage must be the app window, at 0,0, and the
// window the whole screen; a pixel absorbs the layout's rounding to the pixel grid.
const STAGE_TOLERANCE_PX = 1;

/** Why READY's stage is not the app window, or null. */
export function stageProblem(ready, screen) {
  const px = ready.probes?.stage?.px;
  if (!isObject(px) || ![px.x, px.y, px.width, px.height].every((v) => typeof v === 'number' && Number.isFinite(v))) {
    return 'READY has no stage rect: the scene\'s layout cannot be checked against the app window (UI-216)';
  }
  const off = Math.max(Math.abs(px.x), Math.abs(px.y), Math.abs(px.width - screen.width), Math.abs(px.height - screen.height));
  if (off <= STAGE_TOLERANCE_PX) return null;
  return `READY's stage ${px.x},${px.y} ${px.width}x${px.height} px is not the app window 0,0 ${screen.width}x${screen.height} within ${STAGE_TOLERANCE_PX} px: the scene's layout would be offset (UI-216)`;
}

// ---- the witness row check (the designer's witness BLOCK, 2026-11-15; the witness developer's spec) ------------------
// A witness shot's Views are laid out by React Native, which can mirror them under RTL, while the field canvas draws at
// the layout's own coordinates; and its patches must sit inside what the capture keeps. So the harness rebuilds the
// witness layout from READY and refuses the row unless READY's probes show it and every sample square is in the app
// region. The layout and the probe check are the lab's own TypeScript (src/design/lab/witness/), never restated here:
// jest passes them in, and the CLI loads them through scripts/lab/reports/lib/tsResolve.mjs (loadWitness).

const WITNESS_PROBED = /^(W1a|W3)\./;

/** The lab's witness modules for node: witnessLayout and witnessProbeProblems. */
export async function loadWitness(appRoot) {
  const { pathToFileURL } = await import('node:url');
  const { registerTsResolve } = await import(pathToFileURL(path.join(appRoot, 'scripts/lab/reports/lib/tsResolve.mjs')).href);
  registerTsResolve();
  const { witnessLayout } = await import(pathToFileURL(path.join(appRoot, 'src/design/lab/witness/witnessLayout.ts')).href);
  const { witnessProbeProblems } = await import(pathToFileURL(path.join(appRoot, 'src/design/lab/witness/witnessProbes.ts')).href);
  return { witnessLayout, witnessProbeProblems };
}

const insideWithin = (r, region, t) => r.x >= region.x - t && r.y >= region.y - t
  && r.x + r.width <= region.x + region.width + t && r.y + r.height <= region.y + region.height + t;

/** Every sample square of the layout (each patch's and W1b's) that lies outside the app region, in screen px. */
export function witnessSampleProblems(layout, stage, region) {
  const k = layout.pxPerDp;
  const samples = [['W1b', layout.w1b.sample], ...layout.patches.map((p) => [`${p.kind}.${p.colour}`, p.sample])];
  const problems = [];
  for (const [id, s] of samples) {
    const px = { x: stage.px.x + s.x * k, y: stage.px.y + s.y * k, width: s.width * k, height: s.height * k };
    if (!insideWithin(px, region, 0)) problems.push(`the ${id} sample square is outside the app region`);
  }
  return problems;
}

/**
 * Why READY's pixel ratio (PixelRatio.get()) is not the device's, or null: it must be Android's float density for the
 * dpi the harness read (wm density: the override when one is set, else the physical density) within
 * PIXEL_RATIO_AGREEMENT (UI-240). On the owner's phone, an override of 420 over 450 is 2.625.
 */
export function pixelRatioProblem(ready, dpi) {
  const k = ready.pixelRatio;
  if (!(typeof k === 'number' && Number.isFinite(k) && k > 0)) {
    return `READY has no pixelRatio (PixelRatio.get()), so its px per dp cannot be checked against wm density ${dpi} dpi (got ${JSON.stringify(k ?? null)})`;
  }
  const android = androidDensity(dpi);
  if (Math.abs(k - android) <= PIXEL_RATIO_AGREEMENT) return null;
  return `READY's pixelRatio ${k} is not Android's density ${android} for wm density ${dpi} dpi: they must agree within ${PIXEL_RATIO_AGREEMENT.toExponential()}`;
}

/**
 * The insets the witness laid out in, from READY: the region probe's dp edges against the stage's, each rounded to whole
 * px over the pixel ratio (the scene's StatusBar.currentHeight is a float32: 74 px reads 73.99999…).
 */
export function witnessInsetsFromReady(ready) {
  const k = ready.pixelRatio;
  const stage = ready.probes.stage.dp;
  const box = ready.probes.region.dp;
  const whole = (dp) => Math.round(dp * k) / k;
  return {
    top: whole(box.y - stage.y),
    right: whole(stage.x + stage.width - (box.x + box.width)),
    bottom: whole(stage.y + stage.height - (box.y + box.height)),
    left: whole(box.x - stage.x),
  };
}

/**
 * Why a witness row's READY does not show its layout inside the app region, or []. The layout is rebuilt from READY: the
 * stage in dp, READY's pixel ratio and font scale, and the insets the region probe leaves inside the stage, each rounded
 * to whole px (the scene's StatusBar.currentHeight is a float32: 74 px reads 73.99999…).
 */
export function witnessProblems({ face, ready, region, witness }) {
  const k = ready.pixelRatio;
  if (!(typeof k === 'number' && Number.isFinite(k) && k > 0)) return ['READY has no pixelRatio: the witness layout cannot be rebuilt'];
  const stage = ready.probes?.stage;
  const box = ready.probes?.region;
  if (!stage || !box) return [`READY has no ${stage ? 'region' : 'stage'} probe: the witness layout cannot be rebuilt`];
  const insets = witnessInsetsFromReady(ready);
  let layout;
  try {
    layout = witness.witnessLayout(face, stage.dp.width, stage.dp.height, k, ready.fontScale, insets);
  } catch (e) {
    return [`the witness layout cannot be rebuilt from READY: ${e.message}`];
  }
  const problems = [...witness.witnessProbeProblems(layout, ready.probes)];
  for (const [id, probe] of Object.entries(ready.probes)) {
    if ((id === 'region' || WITNESS_PROBED.test(id)) && !insideWithin(probe.px, region, PROBE_TOLERANCE_PX)) {
      problems.push(`probe ${id} is not inside the app region within ${PROBE_TOLERANCE_PX} px`);
    }
  }
  return [...problems, ...witnessSampleProblems(layout, stage, region)];
}

/** The whole pixels of a probe's rect inside the app region, or null when it has none. */
function probeCrop(px, region) {
  const x0 = Math.max(Math.floor(px.x), region.x);
  const y0 = Math.max(Math.floor(px.y), region.y);
  const x1 = Math.min(Math.ceil(px.x + px.width), region.x + region.width);
  const y1 = Math.min(Math.ceil(px.y + px.height), region.y + region.height);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

/** UI-215: the largest spread of any of R, G and B over a rect of the frame; 0 for flat ground. */
export function colourRange(frame, rect) {
  const lo = [255, 255, 255];
  const hi = [0, 0, 0];
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      const i = (y * frame.width + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        const v = frame.rgba[i + c];
        if (v < lo[c]) lo[c] = v;
        if (v > hi[c]) hi[c] = v;
      }
    }
  }
  return Math.max(0, ...hi.map((h, c) => h - lo[c]));
}

/**
 * UI-225: the run's lab lines up to now, judged only once they are all read. logcat delivers a line some time after
 * the lab logs it, so the harness logs its own marker into the same buffer and waits for it to come back: every line
 * logged before it has then been delivered. Throws on an ERROR (or an unreadable lab line) for the run, or a marker
 * that does not come back.
 */
async function judgeLines({ adb, lab, token, shot, plan, signal }) {
  const back = lab.marked(token, { timeoutMs: plan.readyTimeoutMs, signal });
  try {
    await adb.shell(markArgs(token));
    await back;
  } catch (e) {
    back.catch(() => {});
    throw new Error(`${shot.id}: ${e.message}`);
  }
  const problems = lab.problems();
  if (problems.length) throw new Error(`${shot.id}: ${problems.join('; ')}`);
}

/** The display mode now, as a rate proof records it ({ refreshHz, mode, key, reason }); a dumpsys that fails is its reason. */
async function readDisplayDuring(adb) {
  try {
    return readDisplayMode(await adb.shell(['dumpsys', 'display']));
  } catch (e) {
    return { refreshHz: null, mode: null, key: null, reason: `dumpsys display: ${e.message}` };
  }
}

/**
 * RA-52: a full-tier rate band can only show the tier's cap when the display runs at least as fast as the band's
 * minimum; a display held at 60 Hz (Standard mode, or battery saver) never could. Why a plan's full-tier rate band cannot
 * pass on this display, or null. Low-tier bands are left to the proof, which records the display it ran under.
 */
export function rateDisplayProblem(shot, refreshRate) {
  if (shot.proof?.kind !== 'rate' || shot.expect?.tier !== 'full') return null;
  const { min } = shot.proof.band;
  const why = refreshRate === null || refreshRate === undefined ? 'its rate cannot be read' : refreshRate >= min ? null : `it runs at ${refreshRate} Hz`;
  return why === null ? null : `${shot.id}: a full-tier rate band from ${min} frames/s needs the display at ${min} Hz or more, but ${why} (set the screen's motion smoothness to its high rate, battery saver off, and capture again)`;
}

async function runProof({ plan, shot, adb, lab, run, outDir, sleep, out }) {
  const { proof } = shot;
  const pkg = plan.app.package;
  if (proof.kind === 'result') {
    const result = await lab.nextResult({ timeoutMs: proof.seconds * 1000 }).catch((e) => { throw new Error(`${shot.id}: ${e.message}`); });
    const problems = checkResult(result, { run, seq: 0, scene: shot.scene });
    if (problems.length) throw new Error(`${shot.id}: the RESULT is not valid: ${problems.join('; ')}`);
    out.results.push({ shot: shot.id, repeat: shot.repeat, result });
    out.proofs.push({ shot: shot.id, kind: 'result', seconds: proof.seconds, passed: true });
    return;
  }
  if (proof.kind === 'record') {
    // The S22+ dry run (Android 16, screenrecord v1.4): no --output-format, so screenrecord writes only an mp4, and its
    // mp4 muxer needs a seekable file, so not stdout. The harness records to the phone's /data/local/tmp, pulls the file
    // beside the PNGs and always removes it from the phone. The frames are decoded by the storm report, not here.
    const { width, height } = proof.size;
    const remote = `${RECORD_DIR}/kokonada-lab-${run}.mp4`;
    const file = `${shot.id}.mp4`;
    const local = path.join(outDir, file);
    // RA-51: removing the phone's copy is always tried, and a failure there never replaces the recording's own error
    // nor refuses a good recording: the record names the file left on the phone instead.
    let leftover = null;
    const removeRemote = async () => {
      try { await adb.shell(['rm', '-f', remote]); } catch (e) { leftover = { remote, reason: e.message }; }
    };
    try {
      await adb.shell(['screenrecord', '--size', `${width}x${height}`, '--time-limit', String(proof.seconds), remote], { timeoutMs: (proof.seconds + 30) * 1000 });
      await adb.pull(remote, local);
    } catch (e) {
      await removeRemote();
      throw new Error(`${shot.id}: the recording could not be taken: ${e.message}`);
    }
    await removeRemote();
    const bytes = fs.readFileSync(local);
    if (bytes.length === 0) throw new Error(`${shot.id}: screenrecord wrote no video in ${proof.seconds} s`);
    if (bytes.length < 12 || bytes.subarray(4, 8).toString('latin1') !== 'ftyp') throw new Error(`${shot.id}: the recording is not an mp4 (no ftyp box at its start)`);
    out.records.push({ shot: shot.id, file, format: 'mp4', bytes: bytes.length, sha256: sha256(bytes), seconds: proof.seconds, size: { width, height }, leftover });
    out.proofs.push({ shot: shot.id, kind: 'record', seconds: proof.seconds, passed: true });
    return;
  }
  await adb.shell(['dumpsys', 'gfxinfo', pkg, 'reset']);
  await sleep(proof.seconds * 1000);
  // RA-52: the display mode the proof ran under, read during it (battery saver holds the display at 60 Hz).
  const display = proof.kind === 'rate' ? await readDisplayDuring(adb) : null;
  const text = await adb.shell(['dumpsys', 'gfxinfo', pkg]);
  if (proof.kind === 'framestats') {
    out.proofs.push({ shot: shot.id, kind: 'framestats', seconds: proof.seconds, ...parseJank(text), passed: null });
    return;
  }
  const frames = parseGfxFrames(text);
  if (proof.kind === 'rate') {
    const fps = frames / proof.seconds;
    const { min, max } = proof.band;
    const passed = fps >= min && fps <= max;
    out.proofs.push({ shot: shot.id, kind: 'rate', seconds: proof.seconds, frames, fps, band: { min, max }, passed, display });
    if (!passed) throw new Error(`${shot.id}: ${fps} frames/s in ${proof.seconds} s is outside the band ${min} to ${max} (UI-171)`);
    return;
  }
  const still = proof.kind === 'zero-frames';
  out.proofs.push({ shot: shot.id, kind: proof.kind, seconds: proof.seconds, frames, passed: still ? frames === 0 : frames > 0 });
  if (still && frames !== 0) throw new Error(`${shot.id}: ${frames} frames rendered in ${proof.seconds} s while it should be still (QA-034, QA-035)`);
  if (!still && frames === 0) throw new Error(`${shot.id}: the positive control drew no frame in ${proof.seconds} s, so a zero-frames proof beside it would prove nothing`);
}

async function captureShot({ plan, shot, repeat, adb, build, facts, render, tiers, witness, outDir, sleep, now, signal, out }) {
  const observed = await applyShot(adb, shot.device);
  await adb.shell(['logcat', '-c']);
  const stream = adb.logcat();
  const run = `${shot.id}-${repeat}-${now().getTime().toString(36)}`.slice(0, 64);
  // Every lab line of this run, from before its launch to the end of the shot (UI-225).
  const lab = collectLab({ source: stream, run });
  try {
    const launched = now();
    const ready = waitForLab({ source: stream, run, seq: 0, timeoutMs: plan.readyTimeoutMs, signal });
    try {
      await adb.run(launchArgs(plan.app, run, { scene: shot.scene, ...shot.args }));
    } catch (e) {
      ready.catch(() => {});
      throw e;
    }
    const payload = await ready;
    const readyAt = now();
    const problems = checkReady(payload, { sentinel: build.sentinel, scene: shot.scene, probes: shot.probes, seq: 0, fontScale: shot.device.fontScale });
    if (problems.length) throw new Error(`${shot.id}: ${problems.join('; ')}`);
    // UI-240: a ratio the device's density contradicts fails here, before a screen is read, never later in a report.
    const ratio = pixelRatioProblem(payload, facts.density);
    if (ratio) throw new Error(`${shot.id}: ${ratio}`);
    const surface = surfaceProblem(shot.scene, payload);
    if (surface) throw new Error(`${shot.id}: ${surface}`);
    const tier = tierProblem(shot.scene, payload, shot.expect.tier);
    if (tier) throw new Error(`${shot.id}: ${tier}`);
    // The lab hears battery saver through an event that can be lost before React is ready, so its
    // READY is checked against the device itself, here and again after the grabs.
    const powerSaveAtReady = await readPowerSave(adb);
    if (payload.powerSave !== powerSaveAtReady) {
      throw new Error(`${shot.id}: READY says power save ${payload.powerSave} but the device says ${powerSaveAtReady}`);
    }

    const first = requireSrgb(parseRawScreencap(await adb.execOut(['screencap'])));
    await sleep(plan.settleMs);
    const second = requireSrgb(parseRawScreencap(await adb.execOut(['screencap'])));
    const captured = now();
    if ((await readPowerSave(adb)) !== powerSaveAtReady) throw new Error(`${shot.id}: power save changed while the screen was being read`);
    if (first.width !== second.width || first.height !== second.height) throw new Error(`${shot.id}: the screen changed size between grabs`);
    const screen = { width: first.width, height: first.height };
    const region = appRegion(screen, parseSystemBars(await adb.shell(['dumpsys', 'window'])));
    const appRegionHash = regionHash(first, region);
    const motion = movingReason(shot);
    if (motion) out.moving.push({ shot: shot.id, repeat, reason: motion });
    else if (regionHash(second, region) !== appRegionHash) {
      // Keep what was seen: both grabs (the app region) and where they differ, so a refusal can be looked at.
      const diff = regionDifference(first, second, region);
      const files = [1, 2].map((n) => `${shot.id}.${repeat}.settle-${n}.png`);
      for (const [i, frame] of [first, second].entries()) {
        fs.writeFileSync(path.join(outDir, files[i]), await encodePng({ width: region.width, height: region.height, rgba: cropRegion(frame, region) }));
      }
      out.settleFailures.push({ shot: shot.id, repeat, files, region, box: diff.box, pixels: diff.pixels });
      const where = diff.box ? ` in ${diff.pixels} pixels inside x ${diff.box.x}, y ${diff.box.y}, ${diff.box.width} × ${diff.box.height}` : '';
      throw new Error(`${shot.id}: the frame did not settle: two grabs ${plan.settleMs} ms apart differ${where} (both kept: ${files.join(', ')})`);
    }
    // UI-225: an ERROR the lab sent after READY (a fallback that landed after it) makes the grabs a picture of nothing READY named.
    await judgeLines({ adb, lab, token: `${run}-grabs`, shot, plan, signal });
    const stage = stageProblem(payload, screen);
    if (stage) throw new Error(`${shot.id}: ${stage}`);
    if (shot.scene.startsWith('witness.')) {
      const seen = witnessProblems({ face: shot.expect.face, ready: payload, region, witness });
      if (seen.length) throw new Error(`${shot.id}: the witness row does not show its layout: ${seen.join('; ')}`);
    }
    const checks = [];
    const notFlat = shot.checks?.notFlat;
    if (notFlat) {
      const crop = probeCrop(payload.probes[notFlat.probe].px, region);
      if (!crop) throw new Error(`${shot.id}.${repeat}: the probe ${notFlat.probe} has no pixel in the app region, so its ground cannot be judged`);
      const range = colourRange(first, crop);
      if (range < notFlat.minRange) throw new Error(`${shot.id}.${repeat}: the probe ${notFlat.probe} is flat ground: range ${range}, under the plan's ${notFlat.minRange} (UI-215)`);
      checks.push({ shot: shot.id, repeat, kind: 'notFlat', probe: notFlat.probe, minRange: notFlat.minRange, range, passed: true });
    }

    const png = await encodePng({ width: region.width, height: region.height, rgba: cropRegion(first, region) });
    const file = `${shot.id}.${repeat}.png`;
    fs.writeFileSync(path.join(outDir, file), png);
    if (observed.night !== 'yes' && observed.night !== 'no') throw new Error(`${shot.id}: night mode ${observed.night} is not explicit`);
    const row = buildRow({
      shot, repeat, file, sha256: sha256(png), appRegionHash, build, app: plan.app, facts, frame: first, observed, ready: payload, region,
      probes: classifyProbes(payload.probes, screen, region), timestamps: { launched, ready: readyAt, captured },
      renderFacts: renderFacts(shot.expect.tier, tiers), render,
    });
    const errors = validateRow(row);
    if (errors.length) throw new Error(`${shot.id}.${repeat}: the manifest row is not valid: ${errors.join('; ')}`);
    // The proof runs on the shot's last launch, while its lab lines are still read; an ERROR during it refuses the shot too.
    if (shot.proof && repeat === shot.repeat) {
      await runProof({ plan, shot, adb, lab, run, outDir, sleep, out });
      await judgeLines({ adb, lab, token: `${run}-proof`, shot, plan, signal });
    }
    out.checks.push(...checks);
    return row;
  } finally {
    lab.stop();
    await stream.close();
  }
}

// ---- the run ---------------------------------------------------------------------------

const isInside = (parent, child) => {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/**
 * Runs a capture plan. Throws Refused before the phone is touched; otherwise the phone is restored
 * and manifest.json written on every exit path, unless its top level is not valid (validateManifest): then nothing is
 * written and the error says why.
 * @param {{ plan: any, appRoot: string, repoRoot: string, outDir: string, apkPath: string, adb: any,
 *           git: { head(): string, porcelain(): string }, sleep?: (ms: number) => Promise<unknown>,
 *           now?: () => Date, signal?: AbortSignal, log?: (message: string) => void,
 *           witness?: { witnessLayout: Function, witnessProbeProblems: Function } }} options
 */
export async function capture({
  plan, appRoot, repoRoot, outDir, apkPath, adb, git, witness = undefined,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => new Date(), signal, log = console.log,
}) {
  const planErrors = validatePlan(plan);
  if (planErrors.length) throw new Refused(`the capture plan is not valid:\n  ${planErrors.join('\n  ')}`);
  if (!path.isAbsolute(outDir) || isInside(repoRoot, outDir)) {
    throw new Refused(`the output folder ${outDir} is inside the repository (or not absolute): evidence never goes into git`);
  }
  const build = { ...checkBuild({ appRoot, apkPath, git }), skiaVersion: readSkia(appRoot) };
  const tiers = readTiers(repoRoot);
  // The witness modules, before the phone is touched: given (tests) or loaded from the lab's TypeScript (the CLI).
  let witnessModules = witness;
  if (!witnessModules && plan.shots.some((s) => s.scene.startsWith('witness.'))) {
    try { witnessModules = await loadWitness(appRoot); } catch (e) { throw new Refused(`the witness modules cannot be loaded: ${e.message}`); }
  }

  // Read-only checks on the phone.
  const installedPath = (await adb.shell(['pm', 'path', plan.app.package])).split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith('package:'));
  if (!installedPath) throw new Refused(`${plan.app.package} is not installed: install the built APK (adb install -r)`);
  const pulled = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lab-installed-')), 'base.apk');
  await adb.pull(installedPath.slice('package:'.length), pulled);
  const installedSha = sha256(fs.readFileSync(pulled));
  fs.rmSync(path.dirname(pulled), { recursive: true, force: true });
  const installProblems = verifyStampChain({ head: build.head, porcelain: '', stamp: build.stamp, builtApkSha256: build.apkSha256, installedApkSha256: installedSha });
  if (installProblems.length) throw new Refused(installProblems.join('\n'));
  const facts = await readDeviceFacts(adb);
  if (facts.forceDark) throw new Refused('force-dark is on: the OS repaints apps dark (debug.hwui.force_dark=true). Switch it off and capture again.');
  const rateProblems = plan.shots.map((s) => rateDisplayProblem(s, facts.refreshRate)).filter((p) => p !== null);
  if (rateProblems.length) throw new Refused(rateProblems.join('\n'));
  // F5: the GPU and the display's colour facts, read once; a fact adb does not give is null with its reason, never refused.
  const render = await readRenderFacts(adb);

  // The original state goes to disk before the first change.
  fs.mkdirSync(outDir, { recursive: true });
  const snapshot = await snapshotDevice(adb);
  fs.writeFileSync(path.join(outDir, 'device-original-state.json'), `${JSON.stringify({ takenAt: now().toISOString(), snapshot }, null, 2)}\n`);

  const startedAt = now().toISOString();
  const rows = [];
  const determinism = [];
  /** @type {{ proofs: any[], checks: any[], results: any[], records: any[], moving: any[], settleFailures: any[] }} */
  const out = { proofs: [], checks: [], results: [], records: [], moving: [], settleFailures: [] };
  let failure = null;
  let restoreFailures = [];
  try {
    await applySession(adb, plan.session);
    for (const shot of plan.shots) {
      const hashes = [];
      for (let repeat = 1; repeat <= shot.repeat; repeat += 1) {
        if (signal?.aborted) throw new Error('interrupted');
        const row = await captureShot({ plan, shot, repeat, adb, build, facts, render, tiers, witness: witnessModules, outDir, sleep, now, signal, out });
        rows.push(row);
        hashes.push(row.appRegionHash);
        log(`${shot.id}.${repeat}: ${row.appRegionHash.slice(0, 12)} (${row.probes.excluded.length} probe(s) excluded)`);
      }
      if (shot.repeat > 1) {
        const equal = hashes.every((h) => h === hashes[0]);
        determinism.push({ shot: shot.id, equal, hashes });
        if (!equal) throw new Error(`QA-078: ${shot.id} differs across ${shot.repeat} separate launches`);
      }
    }
  } catch (e) {
    failure = e;
  } finally {
    restoreFailures = await restoreDevice(adb, snapshot);
  }

  const manifest = buildManifest({
    planId: plan.id, failure, restoreFailures, build, facts, render, startedAt, finishedAt: now().toISOString(), rows, determinism, out,
  });
  // UI-240: a top level no reader would accept is never written; the run's own failure and restore stay in the error.
  const topLevel = validateManifest(manifest);
  if (topLevel.length) {
    const run = [failure?.message, restoreFailures.length ? `the phone was not fully restored: ${restoreFailures.join('; ')}` : null].filter(Boolean);
    throw new Error([`the manifest is not valid, so it was not written: ${topLevel.join('; ')}`, ...run].join('\n'));
  }
  const manifestPath = path.join(outDir, 'manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  if (failure) {
    if (restoreFailures.length) failure.message += `\nand the phone was not fully restored: ${restoreFailures.join('; ')}`;
    throw failure;
  }
  if (restoreFailures.length) throw new Error(`the phone was not fully restored: ${restoreFailures.join('; ')}`);
  return { manifestPath, manifest };
}

// ---- the session plan (B8-10) -----------------------------------------------------------------
//
// The evidence session is one run over a session plan (capture-plans/v1.json): { id, parts: [{ plan, pause? }] }, the
// part plans by file name, beside it, in the order they run. A part is a plan of shots as strict as when it runs alone:
// every part is loaded and checked by validatePlan before the phone is touched. A session copies no shot, so a part and
// the session can never drift apart, and each part keeps its own folder and manifest, the one its reports read.
// A part that names a pause stops the session after it is captured (the owner judges something on the phone); the same
// command again skips every part already captured at this build (a passed manifest at this commit and APK), so neither
// a pause nor a failure, a refusal or a dropped connection costs a finished part. A part folder left by a failed or older
// attempt is moved aside to <id>.old-<n>, never mixed in, and when that attempt left the phone changed (its saved state
// on disk and no restore recorded) the phone is put back from that saved state first.

const SESSION_KEYS = { session: ['id', 'parts'], part: ['plan', 'pause'] };
/** RA-53: during a pause an edit here refuses the resume, and a commit forces a rebuild and a full re-capture. */
export const KEEP_STILL = 'write nothing in this checkout until the session passes: a change or a commit here captures every part again; record notes in another worktree';
const PART_FILE = /^[a-z0-9-]{1,40}\.json$/;
const PAUSE_MAX = 600;

/** True when a capture-plans document is a session plan (it lists part plans), not a plan of shots. */
export function isSessionPlan(doc) {
  return isObject(doc) && Object.prototype.hasOwnProperty.call(doc, 'parts');
}

const unknownSessionKeys = (value, keys, at, e) => {
  for (const k of Object.keys(value)) if (!keys.includes(k)) e.push(`${at ? `${at}.` : ''}${k} is not a session key`);
};

/**
 * A session plan and the part plans it names, read from planDir. Returns every problem as sentences ([] when valid) and
 * the parts loaded, in order: { file, plan, pause } (pause null when the part names none).
 */
export function loadSession(session, planDir) {
  const e = [];
  const parts = [];
  if (!isObject(session)) return { errors: ['the session plan must be an object'], parts };
  unknownSessionKeys(session, SESSION_KEYS.session, '', e);
  if (!ID.test(session.id ?? '')) e.push('id must be a short lowercase token');
  if (!Array.isArray(session.parts) || session.parts.length === 0) return { errors: [...e, 'parts must be a non-empty list'], parts };
  const files = new Set();
  const ids = new Set();
  let app = null;
  session.parts.forEach((p, i) => {
    const at = `parts[${i}]`;
    if (!isObject(p)) { e.push(`${at} must be { plan, pause? }`); return; }
    unknownSessionKeys(p, SESSION_KEYS.part, at, e);
    if (p.pause !== undefined && !(typeof p.pause === 'string' && p.pause.length >= 1 && p.pause.length <= PAUSE_MAX && !/[\r\n\u0000-\u001f]/.test(p.pause))) {
      e.push(`${at}.pause must be one line of text, 1 to ${PAUSE_MAX} characters`);
    }
    if (typeof p.plan !== 'string' || !PART_FILE.test(p.plan)) { e.push(`${at}.plan must be a plan file beside the session (a lowercase name ending .json)`); return; }
    if (files.has(p.plan)) { e.push(`${at}.plan ${p.plan} is listed twice`); return; }
    files.add(p.plan);
    let text;
    try { text = fs.readFileSync(path.join(planDir, p.plan), 'utf8'); } catch { e.push(`${at} ${p.plan} cannot be read`); return; }
    let plan;
    try { plan = JSON.parse(text); } catch { e.push(`${at} ${p.plan} is not JSON`); return; }
    if (isSessionPlan(plan)) { e.push(`${at} ${p.plan} is a session plan: a session lists plans of shots only`); return; }
    const planErrors = validatePlan(plan);
    for (const pe of planErrors) e.push(`${at} ${p.plan}: ${pe}`);
    if (planErrors.length) return;
    if (ids.has(plan.id)) e.push(`${at} ${p.plan}: the plan id ${plan.id} is used by another part (each part has its own folder)`);
    ids.add(plan.id);
    if (app === null) app = plan.app;
    else if (JSON.stringify(plan.app) !== JSON.stringify(app)) e.push(`${at} ${p.plan}: app must be the first part's (one lab APK serves the session)`);
    parts.push({ file: p.plan, plan, pause: p.pause ?? null });
  });
  return { errors: e, parts };
}

const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
};

/** The first free <dir>.old-<n>. */
function asideName(dir) {
  for (let n = 1; ; n += 1) if (!fs.existsSync(`${dir}.old-${n}`)) return `${dir}.old-${n}`;
}

/**
 * Runs a session plan: each part through capture(), into <outDir>/<part id>/, in order. Throws Refused before the phone
 * is touched (the session, a part, the output folder or the build), and rethrows a part's failure or refusal after
 * writing <outDir>/session.json; returns { status: 'passed' | 'paused', pause, sessionPath, parts }.
 * @param {{ session: any, planDir: string, appRoot: string, repoRoot: string, outDir: string, apkPath: string, adb: any,
 *           git: { head(): string, porcelain(): string }, sleep?: (ms: number) => Promise<unknown>, now?: () => Date,
 *           signal?: AbortSignal, log?: (message: string) => void,
 *           witness?: { witnessLayout: Function, witnessProbeProblems: Function } }} options
 */
export async function captureSession({ session, planDir, outDir, log = console.log, now = () => new Date(), ...rest }) {
  const { errors, parts } = loadSession(session, planDir);
  if (errors.length) throw new Refused(`the session plan is not valid:\n  ${errors.join('\n  ')}`);
  const { appRoot, repoRoot, apkPath, adb, git } = rest;
  if (!path.isAbsolute(outDir) || isInside(repoRoot, outDir)) {
    throw new Refused(`the output folder ${outDir} is inside the repository (or not absolute): evidence never goes into git`);
  }
  const sessionPath = path.join(outDir, 'session.json');
  const earlier = fs.existsSync(sessionPath) ? readJson(sessionPath) : null;
  if (earlier !== null && earlier.session !== session.id) throw new Refused(`${outDir} holds session ${earlier.session}, not ${session.id}: use another folder`);
  const build = checkBuild({ appRoot, apkPath, git });

  const states = parts.map((p) => ({ file: p.file, id: p.plan.id, dir: p.plan.id, state: 'not run', manifest: null, pause: null, pausedAt: null }));
  const earlierPause = (id) => {
    const e = Array.isArray(earlier?.parts) ? earlier.parts.find((x) => x?.id === id) : undefined;
    return typeof e?.pause === 'string' ? { pause: e.pause, pausedAt: typeof e.pausedAt === 'string' ? e.pausedAt : null } : null;
  };
  const record = (status, { pause = null, failure = null } = {}) => {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(sessionPath, `${JSON.stringify({
      session: session.id, status, pause, failure, commit: build.head, apkSha256: build.apkSha256, updatedAt: now().toISOString(), parts: states,
    }, null, 2)}\n`);
  };

  for (const [i, part] of parts.entries()) {
    const st = states[i];
    const dir = path.join(outDir, part.plan.id);
    const manifestFile = path.join(dir, 'manifest.json');
    const done = fs.existsSync(manifestFile) ? readJson(manifestFile) : null;
    if (done && done.outcome === 'passed' && done.plan === part.plan.id && done.commit === build.head && done.apkSha256 === build.apkSha256) {
      Object.assign(st, { state: 'captured earlier', manifest: path.join(part.plan.id, 'manifest.json') }, earlierPause(part.plan.id) ?? {});
      log(`part ${i + 1}/${parts.length} ${part.plan.id}: captured earlier at this build, kept`);
      continue;
    }
    if (fs.existsSync(dir)) {
      // An earlier attempt: a phone it left changed is put back from that attempt's saved state before anything else.
      const saved = readJson(path.join(dir, 'device-original-state.json'));
      if (saved?.snapshot && (done === null || (Array.isArray(done.restoreFailures) && done.restoreFailures.length > 0))) {
        const failures = await restoreDevice(adb, saved.snapshot);
        if (failures.length) {
          const failure = new Error(`${part.plan.id}: the phone could not be put back from the earlier attempt's saved state: ${failures.join('; ')}`);
          Object.assign(st, { state: 'failed' });
          record('failed', { failure: failure.message });
          throw failure;
        }
        log(`part ${i + 1}/${parts.length} ${part.plan.id}: the phone is put back from the earlier attempt's saved state`);
      }
      const aside = asideName(dir);
      try {
        fs.renameSync(dir, aside);
      } catch (e) {
        const held = e?.code === 'EPERM' || e?.code === 'EBUSY';
        const message = held ? `${part.plan.id}: close what holds ${dir} open and run again (${e.code})` : `${part.plan.id}: the earlier attempt cannot be moved aside: ${e.message}`;
        Object.assign(st, { state: 'failed' });
        record(held ? 'refused' : 'failed', { failure: message });
        throw held ? new Refused(message) : new Error(message);
      }
      log(`part ${i + 1}/${parts.length} ${part.plan.id}: the earlier attempt is kept at ${path.basename(aside)}`);
    }
    log(`part ${i + 1}/${parts.length} ${part.plan.id}: capturing`);
    try {
      await capture({ ...rest, plan: part.plan, outDir: dir, log, now });
    } catch (err) {
      Object.assign(st, { state: 'failed', manifest: fs.existsSync(manifestFile) ? path.join(part.plan.id, 'manifest.json') : null });
      record(err instanceof Refused ? 'refused' : 'failed', { failure: `${part.plan.id}: ${err.message}` });
      throw err;
    }
    Object.assign(st, { state: 'captured', manifest: path.join(part.plan.id, 'manifest.json') });
    if (part.pause !== null) {
      Object.assign(st, { pause: part.pause, pausedAt: now().toISOString() });
      record('paused', { pause: part.pause });
      return { status: 'paused', pause: part.pause, sessionPath, parts: states };
    }
  }
  record('passed');
  return { status: 'passed', pause: null, sessionPath, parts: states };
}

/**
 * RA-54: the saved state --restore puts the phone back from. A single run's folder holds it at the top; a session's keeps
 * it in each part's folder, so the part restored is the one with a saved state and no passed manifest (a killed or failed
 * part), or a manifest whose restore failed. Returns { from, failures }; throws Refused when there is none.
 */
export async function restoreFolder({ outDir, adb }) {
  let from = path.join(outDir, 'device-original-state.json');
  if (!fs.existsSync(from) && fs.existsSync(path.join(outDir, 'session.json'))) {
    const changed = fs.readdirSync(outDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).filter((name) => {
      if (!fs.existsSync(path.join(outDir, name, 'device-original-state.json'))) return false;
      const m = readJson(path.join(outDir, name, 'manifest.json'));
      return m === null || m.outcome !== 'passed' || (Array.isArray(m.restoreFailures) && m.restoreFailures.length > 0);
    });
    if (changed.length === 0) throw new Refused(`no part of the session in ${outDir} left a saved state without a passed manifest: nothing to restore`);
    if (changed.length > 1) throw new Refused(`parts ${changed.join(', ')} in ${outDir} each left a saved state: run --restore --out on the one to put back`);
    from = path.join(outDir, changed[0], 'device-original-state.json');
  }
  const saved = readJson(from);
  if (!saved?.snapshot) throw new Refused(`no saved state to restore from in ${outDir}`);
  return { from, failures: await restoreDevice(adb, saved.snapshot) };
}

/** What the CLI prints and exits with for a session that returned: 0 passed (each part's manifest), 3 paused. */
export function sessionOutcome(result, outDir) {
  if (result.status === 'paused') {
    const captured = result.parts.filter((p) => p.state !== 'not run');
    const next = result.parts.find((p) => p.state === 'not run');
    return {
      code: 3,
      message: [
        `paused after ${captured[captured.length - 1].id}: ${result.pause}`,
        `the parts captured so far are kept: run the same command again to go on from ${next ? next.id : 'the end'}`,
        KEEP_STILL,
      ].join('\n'),
    };
  }
  return {
    code: 0,
    message: [`passed: ${result.sessionPath}`, ...result.parts.map((p) => `  ${p.id} (${p.state}): ${path.join(outDir, p.manifest)}`)].join('\n'),
  };
}

// ---- the CLI --------------------------------------------------------------------------

function gitIn(cwd) {
  const git = (args) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (r.status !== 0) throw new Refused(`git ${args.join(' ')} failed: ${r.stderr}`);
    return r.stdout;
  };
  return { head: () => git(['rev-parse', 'HEAD']).trim(), porcelain: () => git(['status', '--porcelain']), root: () => git(['rev-parse', '--show-toplevel']).trim() };
}

async function main(argv) {
  const appRoot = path.resolve(path.dirname(process.argv[1]), '../..');
  const args = { serial: null, apk: path.join(appRoot, DEFAULT_APK) };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--plan' || a === '--out' || a === '--serial' || a === '--apk') args[a.slice(2)] = argv[++i];
    else if (a === '--check' || a === '--restore') args[a.slice(2)] = true;
    else { console.error(`unknown argument: ${a}`); return 2; }
  }
  const git = gitIn(appRoot);
  const adb = createAdb({ serial: args.serial });
  try {
    if (args.check) {
      const build = checkBuild({ appRoot, apkPath: path.resolve(args.apk), git });
      console.log(`the stamp chain holds: commit ${build.head}, bundle ${build.stamp.bundleSha256}, APK ${build.apkSha256}`);
      return 0;
    }
    if (!args.out) { console.error('--out <folder outside the repository> is required'); return 2; }
    const outDir = path.resolve(args.out);
    if (args.restore) {
      const { from, failures } = await restoreFolder({ outDir, adb });
      if (failures.length) { console.error(`not fully restored from ${from}:\n  ${failures.join('\n  ')}`); return 1; }
      console.log(`the phone is restored from ${from}`);
      return 0;
    }
    if (!args.plan) { console.error('--plan <capture plan> is required'); return 2; }
    const controller = new AbortController();
    process.once('SIGINT', () => { console.error('interrupted: restoring the phone'); controller.abort(); });
    const plan = JSON.parse(fs.readFileSync(path.resolve(args.plan), 'utf8'));
    if (isSessionPlan(plan)) {
      const result = await captureSession({
        session: plan, planDir: path.dirname(path.resolve(args.plan)), appRoot, repoRoot: git.root(), outDir, apkPath: path.resolve(args.apk), adb, git,
        signal: controller.signal,
      });
      const { code, message } = sessionOutcome(result, outDir);
      console.log(message);
      return code;
    }
    const { manifestPath } = await capture({
      plan, appRoot, repoRoot: git.root(), outDir, apkPath: path.resolve(args.apk), adb, git, signal: controller.signal,
    });
    console.log(`passed: ${manifestPath}`);
    return 0;
  } catch (e) {
    console.error(e.message);
    return e instanceof Refused ? 2 : 1;
  }
}

if (process.argv[1] && /capture\.mjs$/.test(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
