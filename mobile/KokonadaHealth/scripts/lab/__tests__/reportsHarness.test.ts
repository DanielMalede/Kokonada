/// <reference types="node" />
// B8 squad θ (alignment): the reports read what the harness writes. Mechanically: the capture harness
// (scripts/lab/capture.mjs) runs the shipped plans end to end on its stateful fake phone, as capture.test.ts does for
// v1-field.json, and the manifest it writes is fed, unmodified, to every report under scripts/lab/reports/. Each must
// accept it (never exit 2), and judge it:
//   · v1-field.json on a phone whose screen IS the law: each scene's twin, rendered once here from the scene's own facts
//     (not from any manifest row), painted over the whole window, under a status bar that changes on every grab. If a
//     report misread any field of the harness's row (the density, the stage on the app region, the fixed clock's t, the
//     render scale, the expect), its twin would not be the screen and lawParity would not pass;
//   · v1-cost.json with the bench's RESULT lines, read where the harness keeps them (the manifest's `results`).
// The fixture builders (reports/__fixtures__/rows.ts and proofs.ts) write the manifest's top level with exactly the
// harness's fields, pinned here against the harness's own manifest.

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { capture } from '../capture.mjs';
import { validateRow } from '../lib/manifest.mjs';
import { makeStamp } from '../lib/stamp.mjs';
import { FakeDevice, rawFrame } from '../__fixtures__/fakeDevice';
import { zip } from '../__fixtures__/zipWriter';
import { manifest as fixtureManifest } from '../reports/__fixtures__/rows';
import { renderScaleFor } from '../../../src/design/v2/field/fieldDriver';

jest.setTimeout(600000);

const APP = path.resolve(__dirname, '../../..');
const REPORTS = path.join(APP, 'scripts/lab/reports');
const PLANS = path.join(APP, 'scripts/lab/capture-plans');
const TOKENS = fs.readFileSync(path.resolve(APP, '../../design-tokens/base.tokens.json'), 'utf8');
const SKIA_LOCK = JSON.stringify({ name: 'app', lockfileVersion: 3, packages: { '': {}, 'node_modules/@shopify/react-native-skia': { version: '2.6.9' } } });
const SHA = 'c'.repeat(40);
const SENTINEL = 'kokonada-design-lab-sentinel-testfixture1';
const HBC = Buffer.concat([Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f]), Buffer.from(`...${SENTINEL}...`)]);
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

// A small phone: 103 × 241 px at 40 dpi (Android's density 0.25, so 412 × 964 dp), its status bar the top 6 rows and its
// navigation bar the bottom 6. READY's stage is the app window: the whole screen (UI-216).
const W = 103;
const H = 241;
const BAR = 6;
const DPI = 40;
const K = 0.25;
const DUMPSYS_WINDOW = [
  'WINDOW MANAGER WINDOWS (dumpsys window windows)',
  `      InsetsSource id=3e4e0000 type=statusBars frame=[0,0][${W},${BAR}] visible=true mFlags=[]`,
  `      InsetsSource id=3e4e0005 type=navigationBars frame=[0,${H - BAR}][${W},${H}] visible=true mFlags=[]`,
].join('\n');
const SURFACE_FLINGER = [
  'Device has wide color built-in display: 1',
  '    Current color mode: ColorMode::SRGB (7)',
  'GLES: Qualcomm, Adreno (TM) 730, OpenGL ES 3.2 V@0615.65',
].join('\n');

class Phone extends FakeDevice {
  async shell(args: string[]): Promise<string> {
    const line = args.join(' ');
    if (line === 'wm size') { this.commands.push(line); return `Physical size: ${W}x${H}\n`; }
    if (line === 'wm density') { this.commands.push(line); return `Physical density: ${DPI}\n`; }
    if (line === 'dumpsys window') { this.commands.push(line); return DUMPSYS_WINDOW; }
    if (line === 'dumpsys SurfaceFlinger') { this.commands.push(line); return SURFACE_FLINGER; }
    if (args[0] === 'log' && args[1] === '-t' && args[2] === 'ReactNativeJS') {
      this.commands.push(line);
      setTimeout(() => this.emit(args.slice(3).join(' ')), 2);
      return '';
    }
    return super.shell(args);
  }
}

type Plan = { id: string; shots: Array<{ id: string; scene: string; repeat: number; expect: { direction: string | null; face: string | null; hero: string | null; tier: string | null } }> };
const loadPlan = (name: string) => JSON.parse(fs.readFileSync(path.join(PLANS, name), 'utf8')) as Plan & Record<string, unknown>;

/** Each field and fallback scene's law twin over the whole window, rendered from the scene's facts in a child node. */
function twinsOf(plan: Plan, dir: string): Map<string, Buffer> {
  const jobs = [...new Map(plan.shots.filter((s) => /^(field|fallback)\./.test(s.scene)).map((s) => [twinKey(s.scene, s.expect.tier), s])).values()].map((s, i) => ({
    i, key: twinKey(s.scene, s.expect.tier), field: s.scene.startsWith('field.'),
    shot: s.scene.startsWith('field.')
      ? { name: s.scene, scene: s.scene, direction: s.expect.direction, face: s.expect.face, hero: s.expect.hero, tier: s.expect.tier, renderScale: renderScaleFor(s.expect.tier as never), pxPerDp: K, fontScale: 1, tMs: 11000, stage: { x: 0, y: 0, width: W, height: H } }
      : { name: s.scene, scene: s.scene, direction: s.expect.direction, face: s.expect.face, fallbackScene: s.scene.split('.').slice(3).join('.'), pxPerDp: K, fontScale: 1, stage: { x: 0, y: 0, width: W, height: H } },
  }));
  const code = `const E = await import(${JSON.stringify(pathToFileURL(path.join(REPORTS, 'lib/evidence.mts')).href)});
const fs = await import('node:fs');
for (const j of JSON.parse(process.env.TWIN_JOBS)) {
  const t = j.field ? await E.renderFieldTwin(j.shot) : await E.renderFallbackTwin(j.shot);
  if (t.width !== ${W} || t.height !== ${H}) throw new Error('twin size ' + t.width + 'x' + t.height);
  fs.writeFileSync(process.env.TWIN_DIR + '/' + j.i + '.rgba', t.rgba);
}`;
  const r = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', code], {
    cwd: APP, encoding: 'utf8', env: { ...process.env, TWIN_JOBS: JSON.stringify(jobs), TWIN_DIR: dir }, maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`the twins were not rendered (exit ${r.status}): ${r.stderr}`);
  return new Map(jobs.map((j) => [j.key, fs.readFileSync(path.join(dir, `${j.i}.rgba`))]));
}

function world(tmp: string) {
  const repoRoot = path.join(tmp, 'repo');
  const appRoot = path.join(repoRoot, 'mobile', 'app');
  fs.mkdirSync(path.join(appRoot, 'src/design/lab'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, 'design-tokens'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'design-tokens/base.tokens.json'), TOKENS);
  fs.writeFileSync(path.join(appRoot, 'package-lock.json'), SKIA_LOCK);
  fs.writeFileSync(path.join(appRoot, 'src/design/lab/sentinel.ts'), `export const LAB_SENTINEL = '${SENTINEL}';\n`);
  const assets = path.join(appRoot, 'android/app/src/lab/assets');
  fs.mkdirSync(assets, { recursive: true });
  const stamp = makeStamp({ commit: SHA, porcelain: '', bundleSha256: sha(HBC), tokens: {}, entry: 'index.lab.js', createdAt: '2026-11-15T10:00:00.000Z' });
  fs.writeFileSync(path.join(assets, 'index.android.bundle'), HBC);
  fs.writeFileSync(path.join(assets, 'lab-stamp.json'), JSON.stringify(stamp, null, 2));
  const apk = zip([
    { name: 'AndroidManifest.xml', data: Buffer.from('binary xml') },
    { name: 'assets/index.android.bundle', data: HBC, deflate: true },
    { name: 'assets/lab-stamp.json', data: Buffer.from(JSON.stringify(stamp, null, 2)) },
  ]);
  const apkPath = path.join(tmp, 'app-lab.apk');
  fs.writeFileSync(apkPath, apk);
  const device = new Phone();
  device.installedApk = apk;
  return { repoRoot, appRoot, apkPath, device };
}

/** READY for a launch, as the lab sends it: the stage the app window, the surface by the scene's kind. */
/** A twin's key: the scene and the tier it is drawn at (a policy scene is drawn at several). */
const twinKey = (scene: string, tier: string | null) => `${scene}|${tier}`;

/**
 * The tier the lab draws a scene at: its id's, or for a policy scene (B8-6) the motion policy's for the device: reduced
 * motion (animator scale 0) is still, battery saver alone is low, neither is full. A fallback scene has none.
 */
function tierOf(scene: string, d: FakeDevice): string | null {
  if (!scene.startsWith('field.')) return null;
  if (!scene.endsWith('.policy')) return scene.split('.').pop()!;
  if (d.settings.get('global/animator_duration_scale') === '0' || d.settings.get('global/animator_duration_scale') === '0.0') return 'still';
  return d.settings.get('global/low_power') === '1' ? 'low' : 'full';
}

function ready(extras: Record<string, string>, d: FakeDevice) {
  const px = { x: 0, y: 0, width: W, height: H };
  return `I ReactNativeJS: KOKONADA_LAB READY ${JSON.stringify({
    run: extras.run, seq: 0, scene: extras.scene, clock: extras.clock, t: extras.clock === 'fixed' ? Number(extras.t) : null,
    powerSave: d.settings.get('global/low_power') === '1', pixelRatio: K,
    probes: { stage: { dp: { x: 0, y: 0, width: W / K, height: H / K }, px } },
    isRTL: true, fontScale: Number(d.settings.get('system/font_scale')), sentinel: SENTINEL, tier: tierOf(extras.scene, d),
    shaderStatus: extras.scene.startsWith('fallback.') ? 'fallback-scene' : 'ready', shaderReason: null,
  })}`;
}

/** The screen: the scene's picture over the whole window, a status-bar clock that changes on every grab. */
function screenOf(picture: Buffer | null) {
  let tick = 0;
  return () => {
    tick += 1;
    const n = tick;
    return rawFrame((x, y) => {
      if (y < BAR) return [n % 256, 0, 0, 255];
      if (picture === null) return [40, 44, 52, 255];
      const i = (y * W + x) * 4;
      return [picture[i], picture[i + 1], picture[i + 2], 255];
    }, 1, W, H);
  };
}

async function captureRun(plan: Record<string, unknown>, tmp: string, scenario: (extras: Record<string, string>, d: FakeDevice) => void, onShell?: (line: string, d: FakeDevice) => void) {
  const w = world(tmp);
  w.device.scenario = scenario;
  if (onShell) {
    const shell = w.device.shell.bind(w.device);
    w.device.shell = async (args: string[]) => {
      const out = await shell(args);
      onShell(args.join(' '), w.device);
      return out;
    };
  }
  const outDir = path.join(tmp, 'evidence');
  const result = await capture({
    plan: { ...plan, readyTimeoutMs: 400, settleMs: 0 }, appRoot: w.appRoot, repoRoot: w.repoRoot, outDir, apkPath: w.apkPath, adb: w.device,
    git: { head: () => SHA, porcelain: () => '' }, sleep: async () => {}, log: () => {},
  });
  return { ...result, outDir };
}

/**
 * gfxinfo's frame count for each launch, as the plan's proofs ask the lab to draw: a draws-frames control 1200 frames in
 * its window, a rate shot the middle of its band, anything else (a still) none.
 */
function drawsAsPlanned(plan: Plan) {
  type Proofed = { id: string; proof?: { kind: string; seconds: number; band?: { min: number; max: number } } };
  let frames = 0;
  return (line: string, d: FakeDevice) => {
    if (line.startsWith('am start')) {
      const run = /--es run (\S+)/.exec(line)?.[1] ?? '';
      const shot = (plan.shots as unknown as Proofed[]).filter((s) => run.startsWith(`${s.id}-`)).sort((a, b) => b.id.length - a.id.length)[0];
      const p = shot?.proof;
      frames = p?.kind === 'draws-frames' ? 1200 : p?.kind === 'rate' ? Math.round(((p.band!.min + p.band!.max) / 2) * p.seconds) : 0;
    }
    if (line.endsWith('gfxinfo com.kokonadahealth.lab reset')) d.gfxFrames = frames;
  };
}

function report(script: string, args: string[], out: string) {
  const r = spawnSync(process.execPath, ['--no-warnings', path.join(REPORTS, script), ...args, '--out', out], { cwd: APP, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return { status: r.status, stderr: r.stderr, report: fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : null };
}
const last = (text: string | null) => (text ?? '').trimEnd().split(/\r?\n/).pop();

let tmp: string;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reports-harness-'));
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('the harness\'s v1-field run, fed unmodified to every report', () => {
  const plan = loadPlan('v1-field.json');
  let run: Awaited<ReturnType<typeof captureRun>>;
  let fed: string;
  beforeAll(async () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'field-'));
    const twins = twinsOf(plan, fs.mkdtempSync(path.join(tmp, 'twins-')));
    let moving = false;
    run = await captureRun(plan, dir, (extras, d) => {
      d.frames = [screenOf(twins.get(twinKey(extras.scene, tierOf(extras.scene, d))) ?? null)];
      d.emit(ready(extras, d));
    }, (line, d) => {
      if (line.startsWith('am start')) moving = line.includes('--es run dark-three-full-moving-control-');
      if (line.endsWith('gfxinfo com.kokonadahealth.lab reset') && moving) d.gfxFrames = 1200;
    });
    fed = run.manifestPath;
  });

  it('the harness passed the plan, every row valid by its own validator, and the fed manifest is the one it wrote', () => {
    expect(run.manifest.outcome).toBe('passed');
    expect(run.manifest.rows).toHaveLength(plan.shots.reduce((n, s) => n + s.repeat, 0));
    for (const row of run.manifest.rows) expect(validateRow(row)).toEqual([]);
    expect(fed).toBe(path.join(run.outDir, 'manifest.json'));
    expect(JSON.parse(fs.readFileSync(fed, 'utf8'))).toEqual(run.manifest);
  });

  it('the stage is the window and the PNG the app region: the stage\'s rows under the bars are not in the PNG', () => {
    const row = run.manifest.rows[0];
    expect(row.stage).toEqual({ x: 0, y: 0, width: W, height: H });
    expect(row.region).toEqual({ x: 0, y: BAR, width: W, height: H - 2 * BAR });
    expect(row.device.density).toBe(DPI);
  });

  it('the fixtures\' manifest has exactly the harness\'s top-level fields', () => {
    expect(Object.keys(fixtureManifest([])).sort()).toEqual(Object.keys(run.manifest).sort());
  });

  // The counts are the plan's, so a plan that grows (more fallback stills) keeps this test honest.
  const launches = (pick: (s: Plan['shots'][number]) => boolean) => plan.shots.filter(pick).reduce((n, s) => n + s.repeat, 0);
  const fixedField = () => launches((s) => s.scene.startsWith('field.') && (s as unknown as { args: { clock: string } }).args.clock === 'fixed');
  const fallbacks = () => launches((s) => s.scene.startsWith('fallback.'));

  it('the guard: the plan has fixed field rows, fallback rows and the two real-time rows', () => {
    expect(fixedField()).toBeGreaterThanOrEqual(48);
    expect(fallbacks()).toBeGreaterThanOrEqual(24);
    expect(launches((s) => (s as unknown as { args: { clock: string } }).args.clock === 'realtime')).toBe(2);
  });

  it('lawParity accepts it and holds every fixed field and fallback row to its twin: PASS, the two real-time rows named', () => {
    const r = report('lawParity.mts', ['--manifest', fed], path.join(tmp, 'field-parity.txt'));
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: '' });
    expect(r.report).toContain(`manifest: ${fed} sha256 ${sha(fs.readFileSync(fed))}`);
    expect(r.report).toContain('not compared: dark-three-full-moving-control.1 field.abyss.dark.three.full (clock realtime: no fixed frame time, so no twin)');
    expect(r.report).toContain('not compared: dark-three-still-reduced-motion.1 field.abyss.dark.three.still (clock realtime: no fixed frame time, so no twin)');
    const n = fixedField() + fallbacks();
    expect(r.report!.split(/\r?\n/).filter((l) => / px compared, max \|Δ\| 0, over 1: 0$/.test(l))).toHaveLength(n);
    expect(last(r.report)).toBe(`PASS: ${n} rows within ±1 of their twins (${fixedField()} field, ${fallbacks()} fallback); 2 rows not compared, named above`);
  });

  it('neverRed accepts it: every row judged in full, none in the check band', () => {
    const r = report('neverRed.mts', ['--manifest', fed], path.join(tmp, 'field-never-red.txt'));
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: '' });
    expect(r.report).toContain(`manifest: ${fed} sha256 ${sha(fs.readFileSync(fed))}`);
    const rows = launches(() => true);
    expect(last(r.report)).toBe(`PASS: ${rows} rows, ${rows * W * (H - 2 * BAR)} px, none in the check band`);
  });

  it('motion accepts it with the plan that ran: the determinism pairs, the still proof and its control', () => {
    const r = report('motion.mts', ['--plan', path.join(PLANS, 'v1-field.json'), '--manifest', fed], path.join(tmp, 'field-motion.txt'));
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: '' });
    const kinds = (k: string) => plan.shots.filter((s) => (s as unknown as { proof?: { kind: string } }).proof?.kind === k).length;
    expect(last(r.report)).toBe(`PASS: ${plan.shots.filter((s) => s.repeat > 1).length} determinism pairs equal, ${kinds('zero-frames')} zero-frames, ${kinds('draws-frames')} draws-frames, ${kinds('rate')} rate proofs; framestats informational`);
  });
});

// B8-6's policy scenes: the tier is the motion policy's on the device, READY reports it, the twin is that tier's sibling.
describe('the harness\'s v1-policy run, fed unmodified to lawParity and motion', () => {
  const plan = loadPlan('v1-policy.json');
  let run: Awaited<ReturnType<typeof captureRun>>;
  beforeAll(async () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'policy-'));
    const twins = twinsOf(plan, fs.mkdtempSync(path.join(tmp, 'policy-twins-')));
    run = await captureRun(plan, dir, (extras, d) => {
      d.frames = [screenOf(twins.get(twinKey(extras.scene, tierOf(extras.scene, d))) ?? null)];
      d.emit(ready(extras, d));
    }, drawsAsPlanned(plan));
  });

  it('every row records the tier the policy picked, which is its expect\'s', () => {
    expect(run.manifest.outcome).toBe('passed');
    for (const row of run.manifest.rows) expect([row.shot, row.motion.tier]).toEqual([row.shot, row.expect.tier]);
    expect(new Set(run.manifest.rows.map((r: { motion: { tier: string } }) => r.motion.tier))).toEqual(new Set(['full', 'low', 'still']));
  });

  it('lawParity holds every fixed policy row to its tier\'s twin: PASS, the real-time rows named', () => {
    const fixed = plan.shots.filter((s) => (s as unknown as { args: { clock: string } }).args.clock === 'fixed');
    const n = fixed.reduce((k, s) => k + s.repeat, 0);
    const rt = plan.shots.length - fixed.length;
    expect(n).toBeGreaterThanOrEqual(14);
    const r = report('lawParity.mts', ['--manifest', run.manifestPath], path.join(tmp, 'policy-parity.txt'));
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: '' });
    expect(r.report!.split(/\r?\n/).filter((l) => /^row \S+ field\.abyss\.(dark|light)\.[\w.]+\.policy: field twin, \d+ px compared, max \|Δ\| 0, over 1: 0$/.test(l))).toHaveLength(n);
    expect(last(r.report)).toBe(`PASS: ${n} rows within ±1 of their twins (${n} field, 0 fallback); ${rt} rows not compared, named above`);
  });

  it('motion accepts it: the still proofs and their controls', () => {
    const r = report('motion.mts', ['--plan', path.join(PLANS, 'v1-policy.json'), '--manifest', run.manifestPath], path.join(tmp, 'policy-motion.txt'));
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: '' });
    expect(r.report).toContain('dark-three-policy-reduced-still: 0 frames in 10 s (PASS)');
    // RA-48: the policy run's rate shots are judged against their bands.
    const rates = plan.shots.filter((s) => (s as unknown as { proof?: { kind: string } }).proof?.kind === 'rate');
    expect(rates.length).toBeGreaterThanOrEqual(2);
    for (const s of rates) expect(r.report).toMatch(new RegExp(`^ {2}${s.id}: \\d+ frames in 10 s = [\\d.]+ fps, band [\\d.]+ to [\\d.]+ \\(PASS\\)$`, 'm'));
    expect(last(r.report)).toMatch(new RegExp(`, ${rates.length} rate proofs; framestats informational$`));
  });
});

// UI-210's near.* scenes are field scenes of the catalogue: a near capture must be comparable with its twin too.
describe('the harness\'s v1-near run, fed unmodified to lawParity and neverRed', () => {
  const plan = loadPlan('v1-near.json');
  let run: Awaited<ReturnType<typeof captureRun>>;
  beforeAll(async () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'near-'));
    const twins = twinsOf(plan, fs.mkdtempSync(path.join(tmp, 'near-twins-')));
    run = await captureRun(plan, dir, (extras, d) => {
      d.frames = [screenOf(twins.get(twinKey(extras.scene, tierOf(extras.scene, d))) ?? null)];
      d.emit(ready(extras, d));
    });
  });

  it('lawParity holds every near.* row to its twin: PASS, all 16', () => {
    expect(run.manifest.outcome).toBe('passed');
    expect(plan.shots.every((s) => s.scene.includes('.near.'))).toBe(true);
    const r = report('lawParity.mts', ['--manifest', run.manifestPath], path.join(tmp, 'near-parity.txt'));
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: '' });
    expect(r.report!.split(/\r?\n/).filter((l) => /^row \S+ field\.abyss\.(dark|light)\.near\.\w+\.full: field twin, \d+ px compared, max \|Δ\| 0, over 1: 0$/.test(l))).toHaveLength(16);
    expect(last(r.report)).toBe('PASS: 16 rows within ±1 of their twins (16 field, 0 fallback)');
  });

  it('neverRed judges them in full: none in the check band', () => {
    const r = report('neverRed.mts', ['--manifest', run.manifestPath], path.join(tmp, 'near-never-red.txt'));
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: '' });
    expect(last(r.report)).toBe(`PASS: 16 rows, ${16 * W * (H - 2 * BAR)} px, none in the check band`);
  });
});

describe('the harness\'s v1-cost run, fed unmodified to the reports', () => {
  const plan = loadPlan('v1-cost.json');
  let run: Awaited<ReturnType<typeof captureRun>>;
  const GPU: Record<string, number> = { '': 800, storm: 950, heavy: 3000, empty: 100 };
  beforeAll(async () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'cost-'));
    run = await captureRun(plan, dir, (extras, d) => {
      d.frames = [screenOf(null)];
      d.emit(ready(extras, d));
      const variant = /\.(storm|heavy|empty)$/.exec(extras.scene)?.[1] ?? '';
      const g = GPU[variant];
      const result = {
        run: extras.run, seq: 0, kind: 'cost', scene: extras.scene, frames: 1200, displayHz: 120,
        stepUs: { p50: 210, p95: 340, max: 900 }, renderUs: { p50: 1500, p95: 2100, max: 4000 }, gpuProxyUs: { p50: g, p95: g + 200, max: g + 900 }, clock: 'performance.now',
      };
      setTimeout(() => d.emit(`I ReactNativeJS: KOKONADA_LAB RESULT ${JSON.stringify(result)}`), 5);
    });
  });

  it('the harness passed it and kept every RESULT in the manifest\'s results', () => {
    expect(run.manifest.outcome).toBe('passed');
    expect(run.manifest.results.map((r: { shot: string }) => r.shot)).toEqual(plan.shots.map((s) => s.id));
  });

  it('fieldCost accepts it: every RESULT read, the calibration sound, no threshold', () => {
    const r = report('fieldCost.mts', ['--plan', path.join(PLANS, 'v1-cost.json'), '--manifest', run.manifestPath], path.join(tmp, 'cost.txt'));
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: '' });
    expect(last(r.report)).toBe('PASS: 12 RESULT lines, calibration sound; no threshold asserted on any cost (informational, DEC-082 OPEN)');
  });

  it('neverRed accepts the cost rows and judges them in full; lawParity accepts them and names them, comparing none', () => {
    const nr = report('neverRed.mts', ['--manifest', run.manifestPath], path.join(tmp, 'cost-never-red.txt'));
    expect({ status: nr.status, stderr: nr.stderr }).toEqual({ status: 0, stderr: '' });
    expect(last(nr.report)).toBe(`PASS: 12 rows, ${12 * W * (H - 2 * BAR)} px, none in the check band`);
    const lp = report('lawParity.mts', ['--manifest', run.manifestPath], path.join(tmp, 'cost-parity.txt'));
    expect({ status: lp.status, stderr: lp.stderr }).toEqual({ status: 1, stderr: '' });
    expect(lp.report).toContain('not compared: cost-dark-full-idle.1 cost.abyss.dark.three.full (not a field.* or fallback.* scene)');
    expect(last(lp.report)).toBe('FAIL: no field.* or fallback.* row to compare');
  });

  it('motion accepts it and leaves the result proofs to fieldCost', () => {
    const r = report('motion.mts', ['--plan', path.join(PLANS, 'v1-cost.json'), '--manifest', run.manifestPath], path.join(tmp, 'cost-motion.txt'));
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: '' });
    expect(r.report).toContain('not read here (other reports\' proofs): cost-dark-full-idle (result)');
  });
});
