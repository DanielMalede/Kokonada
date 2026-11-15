// The Design Lab capture harness (OPS-100).
//
//   node scripts/lab/capture.mjs --plan scripts/lab/capture-plans/smoke.json --out <folder outside the repo> [--serial <id>] [--apk <file>]
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
// Exit codes: 0 passed · 1 the capture failed (or the phone was not fully restored) · 2 refused.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { findMarkers, readSentinel } from './assertLabExcluded.mjs';
import { createAdb } from './lib/adb.mjs';
import {
  applySession, applyShot, parseGfxFrames, parseJank, parseSystemBars, readDeviceFacts, readPowerSave, readRenderFacts, restoreDevice, snapshotDevice,
} from './lib/device.mjs';
import { readSkiaVersion, validateRow } from './lib/manifest.mjs';
import { appRegion, cropRegion, encodePng, parseRawScreencap, regionHash, requireSrgb } from './lib/png.mjs';
import { checkReady, checkResult, classifyProbes, collectLab, launchArgs, markArgs, waitForLab } from './lib/protocol.mjs';
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
// the policy-tier field scenes draw the field through its surface, so each must say ready. The smoke scene draws no
// field and is held to nothing. A scene that matches no rule is refused: nothing says what must have drawn it.
const SURFACES = [
  { prefix: 'field.', suffix: '.policy', status: 'ready', drawn: 'by the field shader, at the tier the motion policy chose' },
  { prefix: 'field.', status: 'ready', drawn: 'by the field shader, never its fallback' },
  { prefix: 'fallback.', status: 'fallback-scene', drawn: 'by the lab fallback scene' },
  { prefix: 'witness.', status: 'ready', drawn: 'by the field shader through its surface, never its fallback' },
  { prefix: 'grain.', status: 'ready', drawn: 'by the field shader through its surface, never its fallback' },
  { prefix: 'cost.', status: 'ready', drawn: 'by the field shader, never its fallback' },
  { prefix: 'storm.', status: 'ready', drawn: 'by the field shader, never its fallback' },
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
    try {
      await adb.shell(['screenrecord', '--size', `${width}x${height}`, '--time-limit', String(proof.seconds), remote], { timeoutMs: (proof.seconds + 30) * 1000 });
      await adb.pull(remote, local);
    } catch (e) {
      throw new Error(`${shot.id}: the recording could not be taken: ${e.message}`);
    } finally {
      await adb.shell(['rm', '-f', remote]);
    }
    const bytes = fs.readFileSync(local);
    if (bytes.length === 0) throw new Error(`${shot.id}: screenrecord wrote no video in ${proof.seconds} s`);
    if (bytes.length < 12 || bytes.subarray(4, 8).toString('latin1') !== 'ftyp') throw new Error(`${shot.id}: the recording is not an mp4 (no ftyp box at its start)`);
    out.records.push({ shot: shot.id, file, format: 'mp4', bytes: bytes.length, sha256: sha256(bytes), seconds: proof.seconds, size: { width, height } });
    out.proofs.push({ shot: shot.id, kind: 'record', seconds: proof.seconds, passed: true });
    return;
  }
  await adb.shell(['dumpsys', 'gfxinfo', pkg, 'reset']);
  await sleep(proof.seconds * 1000);
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
    out.proofs.push({ shot: shot.id, kind: 'rate', seconds: proof.seconds, frames, fps, band: { min, max }, passed });
    if (!passed) throw new Error(`${shot.id}: ${fps} frames/s in ${proof.seconds} s is outside the band ${min} to ${max} (UI-171)`);
    return;
  }
  const still = proof.kind === 'zero-frames';
  out.proofs.push({ shot: shot.id, kind: proof.kind, seconds: proof.seconds, frames, passed: still ? frames === 0 : frames > 0 });
  if (still && frames !== 0) throw new Error(`${shot.id}: ${frames} frames rendered in ${proof.seconds} s while it should be still (QA-034, QA-035)`);
  if (!still && frames === 0) throw new Error(`${shot.id}: the positive control drew no frame in ${proof.seconds} s, so a zero-frames proof beside it would prove nothing`);
}

async function captureShot({ plan, shot, repeat, adb, build, facts, render, tiers, outDir, sleep, now, signal, out }) {
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
    if (regionHash(second, region) !== appRegionHash) {
      throw new Error(`${shot.id}: the frame did not settle: two grabs ${plan.settleMs} ms apart differ in the app region`);
    }
    // UI-225: an ERROR the lab sent after READY (a fallback that landed after it) makes the grabs a picture of nothing READY named.
    await judgeLines({ adb, lab, token: `${run}-grabs`, shot, plan, signal });
    const stage = stageProblem(payload, screen);
    if (stage) throw new Error(`${shot.id}: ${stage}`);
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
    const row = {
      shot: shot.id, repeat, file, sha256: sha256(png), appRegionHash,
      commit: { sha: build.head, porcelainEmpty: true },
      stamp: { bundleSha256: build.stamp.bundleSha256, tokens: build.stamp.tokens ?? {} },
      device: { model: facts.model, fingerprint: facts.fingerprint, width: first.width, height: first.height, density: facts.density, refreshRate: facts.refreshRate },
      app: { package: plan.app.package, apkSha256: build.apkSha256, buildType: 'lab', hermes: build.hermes, dev: build.stamp.dev },
      scene: shot.scene, direction: shot.expect.direction, face: shot.expect.face,
      fontScale: { requested: shot.device.fontScale, observed: observed.fontScale, app: payload.fontScale },
      motion: { reduceMotionObserved: observed.animatorScales.transition === 0, powerSaveObserved: payload.powerSave === true, tier: payload.tier ?? null },
      locale: facts.locale,
      isRTL: payload.isRTL, // checkReady refused anything but true
      clock: { mode: payload.clock, t: payload.t ?? null, seq: payload.seq },
      shaderStatus: payload.shaderStatus ?? null,
      uimode: observed.night === 'yes' ? 'night' : 'day',
      animatorScales: observed.animatorScales,
      forceDark: facts.forceDark,
      colorSpace: first.colorSpace,
      region,
      probes: classifyProbes(payload.probes, screen, region),
      timestamps: { launched: launched.toISOString(), ready: readyAt.toISOString(), captured: captured.toISOString() },
      // F4: the scene facts are the shot's expect (pinned to the catalogue by jest), never a lab line's.
      expect: { direction: shot.expect.direction, face: shot.expect.face, hero: shot.expect.hero, tier: shot.expect.tier },
      ...renderFacts(shot.expect.tier, tiers),
      gl: render.gl,
      display: render.display,
      skiaVersion: build.skiaVersion,
      shaderReason: typeof payload.shaderReason === 'string' && payload.shaderReason.length > 0 ? payload.shaderReason : null,
      stage: { x: payload.probes.stage.px.x, y: payload.probes.stage.px.y, width: payload.probes.stage.px.width, height: payload.probes.stage.px.height },
    };
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
 * and manifest.json written on every exit path.
 * @param {{ plan: any, appRoot: string, repoRoot: string, outDir: string, apkPath: string, adb: any,
 *           git: { head(): string, porcelain(): string }, sleep?: (ms: number) => Promise<unknown>,
 *           now?: () => Date, signal?: AbortSignal, log?: (message: string) => void }} options
 */
export async function capture({
  plan, appRoot, repoRoot, outDir, apkPath, adb, git,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => new Date(), signal, log = console.log,
}) {
  const planErrors = validatePlan(plan);
  if (planErrors.length) throw new Refused(`the capture plan is not valid:\n  ${planErrors.join('\n  ')}`);
  if (!path.isAbsolute(outDir) || isInside(repoRoot, outDir)) {
    throw new Refused(`the output folder ${outDir} is inside the repository (or not absolute): evidence never goes into git`);
  }
  const build = { ...checkBuild({ appRoot, apkPath, git }), skiaVersion: readSkia(appRoot) };
  const tiers = readTiers(repoRoot);

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
  // F5: the GPU and the display's colour facts, read once; a fact adb does not give is null with its reason, never refused.
  const render = await readRenderFacts(adb);

  // The original state goes to disk before the first change.
  fs.mkdirSync(outDir, { recursive: true });
  const snapshot = await snapshotDevice(adb);
  fs.writeFileSync(path.join(outDir, 'device-original-state.json'), `${JSON.stringify({ takenAt: now().toISOString(), snapshot }, null, 2)}\n`);

  const startedAt = now().toISOString();
  const rows = [];
  const determinism = [];
  /** @type {{ proofs: any[], checks: any[], results: any[], records: any[] }} */
  const out = { proofs: [], checks: [], results: [], records: [] };
  let failure = null;
  let restoreFailures = [];
  try {
    await applySession(adb, plan.session);
    for (const shot of plan.shots) {
      const hashes = [];
      for (let repeat = 1; repeat <= shot.repeat; repeat += 1) {
        if (signal?.aborted) throw new Error('interrupted');
        const row = await captureShot({ plan, shot, repeat, adb, build, facts, render, tiers, outDir, sleep, now, signal, out });
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

  const manifest = {
    plan: plan.id,
    outcome: failure || restoreFailures.length ? 'failed' : 'passed',
    failure: failure ? failure.message : null,
    restoreFailures,
    commit: build.head, stamp: build.stamp, apkSha256: build.apkSha256,
    device: facts, render, skiaVersion: build.skiaVersion, startedAt, finishedAt: now().toISOString(),
    rows, determinism, proofs: out.proofs, checks: out.checks, results: out.results, records: out.records,
  };
  const manifestPath = path.join(outDir, 'manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  if (failure) {
    if (restoreFailures.length) failure.message += `\nand the phone was not fully restored: ${restoreFailures.join('; ')}`;
    throw failure;
  }
  if (restoreFailures.length) throw new Error(`the phone was not fully restored: ${restoreFailures.join('; ')}`);
  return { manifestPath, manifest };
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
      const saved = JSON.parse(fs.readFileSync(path.join(outDir, 'device-original-state.json'), 'utf8'));
      const failures = await restoreDevice(adb, saved.snapshot);
      if (failures.length) { console.error(`not fully restored:\n  ${failures.join('\n  ')}`); return 1; }
      console.log('the phone is restored');
      return 0;
    }
    if (!args.plan) { console.error('--plan <capture plan> is required'); return 2; }
    const controller = new AbortController();
    process.once('SIGINT', () => { console.error('interrupted: restoring the phone'); controller.abort(); });
    const plan = JSON.parse(fs.readFileSync(path.resolve(args.plan), 'utf8'));
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
