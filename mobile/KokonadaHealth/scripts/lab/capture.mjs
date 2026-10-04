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
// Exit codes: 0 passed · 1 the capture failed (or the phone was not fully restored) · 2 refused.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { findMarkers, readSentinel } from './assertLabExcluded.mjs';
import { createAdb } from './lib/adb.mjs';
import { applySession, applyShot, parseGfxFrames, parseSystemBars, readDeviceFacts, readPowerSave, restoreDevice, snapshotDevice } from './lib/device.mjs';
import { validateRow } from './lib/manifest.mjs';
import { appRegion, cropRegion, encodePng, parseRawScreencap, regionHash, requireSrgb } from './lib/png.mjs';
import { checkReady, classifyProbes, launchArgs, waitForLab } from './lib/protocol.mjs';
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

/** Every problem with a capture plan, as sentences. [] for a valid plan. */
export function validatePlan(plan) {
  const e = [];
  if (!isObject(plan)) return ['the plan must be an object'];
  if (!ID.test(plan.id ?? '')) e.push('id must be a short lowercase token');
  if (!isObject(plan.app) || !NAME.test(plan.app.package ?? '') || !NAME.test(plan.app.activity ?? '')) e.push('app.package and app.activity must be plain names');
  if (!intIn(plan.readyTimeoutMs, 100, 600000)) e.push('readyTimeoutMs must be an integer from 100 to 600000');
  if (!intIn(plan.settleMs, 0, 10000)) e.push('settleMs must be an integer from 0 to 10000');
  if (plan.session !== undefined && (!isObject(plan.session) || (plan.session.stayOn !== undefined && typeof plan.session.stayOn !== 'boolean'))) e.push('session.stayOn must be a boolean');
  if (!Array.isArray(plan.shots) || plan.shots.length === 0) return [...e, 'shots must be a non-empty list'];
  const seen = new Set();
  plan.shots.forEach((s, i) => {
    const at = `shots[${i}]`;
    if (!isObject(s)) { e.push(`${at} must be an object`); return; }
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
    }
    if (!Array.isArray(s.probes) || s.probes.length === 0 || !s.probes.every((p) => TOKEN.test(p))) e.push(`${at}.probes must be a non-empty list of probe ids`);
    if (s.proof !== undefined && !(isObject(s.proof) && s.proof.kind === 'zero-frames' && intIn(s.proof.seconds, 1, 120))) {
      e.push(`${at}.proof must be { kind: "zero-frames", seconds: 1 to 120 }`);
    }
  });
  return e;
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

async function captureShot({ plan, shot, repeat, adb, build, facts, outDir, sleep, now, signal }) {
  const observed = await applyShot(adb, shot.device);
  await adb.shell(['logcat', '-c']);
  const stream = adb.logcat();
  try {
    const run = `${shot.id}-${repeat}-${now().getTime().toString(36)}`.slice(0, 64);
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
    const problems = checkReady(payload, { sentinel: build.sentinel, scene: shot.scene, probes: shot.probes, seq: 0 });
    if (problems.length) throw new Error(`${shot.id}: ${problems.join('; ')}`);
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
      scene: shot.scene, direction: null, face: null,
      fontScale: { requested: shot.device.fontScale, observed: observed.fontScale },
      motion: { reduceMotionObserved: observed.animatorScales.transition === 0, powerSaveObserved: payload.powerSave === true, tier: payload.tier ?? null },
      locale: facts.locale,
      isRTL: typeof payload.isRTL === 'boolean' ? payload.isRTL : null,
      clock: { mode: payload.clock, t: payload.t ?? null, seq: payload.seq },
      shaderStatus: payload.shaderStatus ?? null,
      uimode: observed.night === 'yes' ? 'night' : 'day',
      animatorScales: observed.animatorScales,
      forceDark: facts.forceDark,
      colorSpace: first.colorSpace,
      region,
      probes: classifyProbes(payload.probes, screen, region),
      timestamps: { launched: launched.toISOString(), ready: readyAt.toISOString(), captured: captured.toISOString() },
    };
    const errors = validateRow(row);
    if (errors.length) throw new Error(`${shot.id}.${repeat}: the manifest row is not valid: ${errors.join('; ')}`);
    return row;
  } finally {
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
  const build = checkBuild({ appRoot, apkPath, git });

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

  // The original state goes to disk before the first change.
  fs.mkdirSync(outDir, { recursive: true });
  const snapshot = await snapshotDevice(adb);
  fs.writeFileSync(path.join(outDir, 'device-original-state.json'), `${JSON.stringify({ takenAt: now().toISOString(), snapshot }, null, 2)}\n`);

  const startedAt = now().toISOString();
  const rows = [];
  const determinism = [];
  const proofs = [];
  let failure = null;
  let restoreFailures = [];
  try {
    await applySession(adb, plan.session);
    for (const shot of plan.shots) {
      const hashes = [];
      for (let repeat = 1; repeat <= shot.repeat; repeat += 1) {
        if (signal?.aborted) throw new Error('interrupted');
        const row = await captureShot({ plan, shot, repeat, adb, build, facts, outDir, sleep, now, signal });
        rows.push(row);
        hashes.push(row.appRegionHash);
        log(`${shot.id}.${repeat}: ${row.appRegionHash.slice(0, 12)} (${row.probes.excluded.length} probe(s) excluded)`);
      }
      if (shot.repeat > 1) {
        const equal = hashes.every((h) => h === hashes[0]);
        determinism.push({ shot: shot.id, equal, hashes });
        if (!equal) throw new Error(`QA-078: ${shot.id} differs across ${shot.repeat} separate launches`);
      }
      if (shot.proof) {
        await adb.shell(['dumpsys', 'gfxinfo', plan.app.package, 'reset']);
        await sleep(shot.proof.seconds * 1000);
        const frames = parseGfxFrames(await adb.shell(['dumpsys', 'gfxinfo', plan.app.package]));
        proofs.push({ shot: shot.id, kind: shot.proof.kind, seconds: shot.proof.seconds, frames, passed: frames === 0 });
        if (frames !== 0) throw new Error(`${shot.id}: ${frames} frames rendered in ${shot.proof.seconds} s while it should be still (QA-034, QA-035)`);
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
    device: facts, startedAt, finishedAt: now().toISOString(),
    rows, determinism, proofs,
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
