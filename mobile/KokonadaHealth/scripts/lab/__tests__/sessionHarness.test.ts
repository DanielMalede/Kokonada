/// <reference types="node" />
// B8-10: the evidence session end to end on one fake phone. The harness (scripts/lab/capture.mjs captureSession) runs the
// shipped session plan, capture-plans/v1.json, part by part on ONE stateful fake phone (one geometry, one install, as the
// owner's S22+ is), pausing where the session pauses for the owner and resuming on the same command; then every part's
// manifest, unmodified, goes through every report that judges it, as the runbook runs them. The phone draws what each
// scene draws: a field or fallback scene its law twin (rendered once here from the scene's own facts), a grain swatch its
// rest twin with its strips, the witness its own layout at the phone's density, a cost bench its RESULT, a storm its
// moving marker. If any report misread a row the harness wrote in a session folder, or the session dropped or mixed a
// part, a report here would not pass.

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { captureSession, loadSession } from '../capture.mjs';
import { encodePng } from '../lib/png.mjs';
import { makeStamp } from '../lib/stamp.mjs';
import { FakeDevice, rawFrame } from '../__fixtures__/fakeDevice';
import { zip } from '../__fixtures__/zipWriter';
import { renderScaleFor } from '../../../src/design/v2/field/fieldDriver';
import { fieldPixel } from '../../../src/design/v2/field/fieldLaw';
import { hexBytes } from '../../../src/design/v2/color/displayP3';
import { witnessLayout } from '../../../src/design/lab/witness/witnessLayout';
import { witnessProbeProblems } from '../../../src/design/lab/witness/witnessProbes';
import { noiseFree, w1bFrame } from '../../../src/design/lab/witness/witnessFrames';
import { STORM_MARKER_COLOURS, STORM_MARKER_DP } from '../../../src/design/lab/storm/stormMarker';

jest.setTimeout(900000);

const APP = path.resolve(__dirname, '../../..');
const REPORTS = path.join(APP, 'scripts/lab/reports');
const PLANS = path.join(APP, 'scripts/lab/capture-plans');
const TOKENS = fs.readFileSync(path.resolve(APP, '../../design-tokens/base.tokens.json'), 'utf8');
const SKIA_LOCK = JSON.stringify({ name: 'app', lockfileVersion: 3, packages: { '': {}, 'node_modules/@shopify/react-native-skia': { version: '2.6.9' } } });
const SHA = 'c'.repeat(40);
const SENTINEL = 'kokonada-design-lab-sentinel-testfixture1';
const HBC = Buffer.concat([Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f]), Buffer.from(`...${SENTINEL}...`)]);
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

// One phone for the whole session: the S22+ at a tenth of its size, 108 × 234 px at 42 dpi (Android's px per dp 0.2625,
// so 411 × 891 dp, the S22+'s own; its 6:13 shape is the one the storm plan's record size keeps), its status bar the top
// 6 rows and its navigation bar the bottom 6. READY's stage is the whole window (UI-216).
const W = 108;
const H = 234;
const BAR = 6;
const DPI = 42;
const K = Math.fround(Math.fround(DPI) * Math.fround(1 / 160));
const SURFACE_FLINGER = ['Device has wide color built-in display: 1', '    Current color mode: ColorMode::SRGB (7)', 'GLES: Qualcomm, Adreno (TM) 730, OpenGL ES 3.2 V@0615.65'].join('\n');

type Rect = { x: number; y: number; width: number; height: number };
type Shot = {
  id: string; scene: string; repeat: number; args: Record<string, string>; probes: string[];
  expect: { direction: string | null; face: string | null; hero: string | null; tier: string | null };
  proof?: { kind: string; seconds: number; band?: { min: number; max: number }; size?: { width: number; height: number } };
};
type Plan = { id: string; shots: Shot[] };

/** The phone: its geometry, the lab's log line, and screenrecord writing a small mp4 stand-in per run on the phone. */
class Phone extends FakeDevice {
  recorded = new Map<string, Buffer>();
  async shell(args: string[]): Promise<string> {
    const line = args.join(' ');
    const mine = (out: string) => { this.commands.push(line); return out; };
    if (line === 'wm size') return mine(`Physical size: ${W}x${H}\n`);
    if (line === 'wm density') return mine(`Physical density: ${DPI}\n`);
    if (line === 'dumpsys window') {
      return mine([
        'WINDOW MANAGER WINDOWS (dumpsys window windows)',
        `      InsetsSource id=3e4e0000 type=statusBars frame=[0,0][${W},${BAR}] visible=true mFlags=[]`,
        `      InsetsSource id=3e4e0005 type=navigationBars frame=[0,${H - BAR}][${W},${H}] visible=true mFlags=[]`,
      ].join('\n'));
    }
    if (line === 'dumpsys SurfaceFlinger') return mine(SURFACE_FLINGER);
    if (args[0] === 'log' && args[1] === '-t' && args[2] === 'ReactNativeJS') {
      this.commands.push(line);
      setTimeout(() => this.emit(args.slice(3).join(' ')), 2);
      return '';
    }
    if (args[0] === 'screenrecord') {
      const remote = args[args.length - 1];
      this.recorded.set(remote, Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom', 'latin1'), Buffer.alloc(12), Buffer.from(`stand-in ${remote}`, 'latin1')]));
      return mine('');
    }
    if (args[0] === 'rm' && args[1] === '-f') { this.recorded.delete(args[2]); return mine(''); }
    return super.shell(args);
  }
  async pull(remote: string, local: string): Promise<string> {
    const bytes = this.recorded.get(remote);
    if (bytes === undefined) return super.pull(remote, local);
    this.commands.push(`pull ${remote}`);
    fs.writeFileSync(local, bytes);
    return '';
  }
}

/** The lab's build, its stamp and the APK installed on the phone. */
function world(tmp: string, device: FakeDevice) {
  const repoRoot = path.join(tmp, 'repo');
  const appRoot = path.join(repoRoot, 'mobile', 'app');
  fs.mkdirSync(path.join(appRoot, 'src/design/lab'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, 'design-tokens'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'design-tokens/base.tokens.json'), TOKENS);
  fs.writeFileSync(path.join(appRoot, 'package-lock.json'), SKIA_LOCK);
  fs.writeFileSync(path.join(appRoot, 'src/design/lab/sentinel.ts'), `export const LAB_SENTINEL = '${SENTINEL}';\n`);
  const assets = path.join(appRoot, 'android/app/src/lab/assets');
  fs.mkdirSync(assets, { recursive: true });
  const tokens = { 'design-tokens/base.tokens.json': sha(Buffer.from(TOKENS)) }; // UI-278: the stamp names the token files
  const stamp = makeStamp({ commit: SHA, porcelain: '', bundleSha256: sha(HBC), tokens, entry: 'index.lab.js', createdAt: '2026-11-17T10:00:00.000Z' });
  fs.writeFileSync(path.join(assets, 'index.android.bundle'), HBC);
  fs.writeFileSync(path.join(assets, 'lab-stamp.json'), JSON.stringify(stamp, null, 2));
  const apk = zip([
    { name: 'AndroidManifest.xml', data: Buffer.from('binary xml') },
    { name: 'assets/index.android.bundle', data: HBC, deflate: true },
    { name: 'assets/lab-stamp.json', data: Buffer.from(JSON.stringify(stamp, null, 2)) },
  ]);
  const apkPath = path.join(tmp, 'app-lab.apk');
  fs.writeFileSync(apkPath, apk);
  device.installedApk = apk;
  return { repoRoot, appRoot, apkPath };
}

// ---- what the lab draws, by scene -----------------------------------------------------------------------------------

const twinKey = (scene: string, tier: string | null) => `${scene}|${tier}`;

/** The tier the lab draws a field scene at: its id's, or for a policy scene the motion policy's on the device (B8-6). */
function tierOf(scene: string, d: FakeDevice): string | null {
  if (!scene.startsWith('field.')) return null;
  if (!scene.endsWith('.policy')) return scene.split('.').pop()!;
  if (d.settings.get('global/animator_duration_scale') === '0' || d.settings.get('global/animator_duration_scale') === '0.0') return 'still';
  return d.settings.get('global/low_power') === '1' ? 'low' : 'full';
}

/** Each field and fallback scene's law twin over the whole window (and each grain swatch's rest twin), in a child node. */
function twinsOf(shots: Shot[], dir: string): Map<string, Buffer> {
  const asField = (s: Shot) => (s.scene.startsWith('grain.') ? { ...s, scene: `field.abyss.${s.expect.face}.rest.${s.expect.tier}`, expect: { ...s.expect, hero: 'rest' } } : s);
  const wanted = shots.map(asField).filter((s) => /^(field|fallback)\./.test(s.scene));
  // A policy scene is drawn at the tier its device state gives, which its expect states (pinned by capturePlans.test.ts).
  const jobs = [...new Map(wanted.map((s) => [twinKey(s.scene, s.expect.tier), s])).values()].map((s, i) => ({
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

/** A screen from a painter, under a status-bar clock that changes on every grab. */
function screenFrom(paint: (x: number, y: number, grab: number) => number[]) {
  let tick = 0;
  return () => {
    tick += 1;
    const n = tick;
    return rawFrame((x, y) => (y < BAR ? [n % 256, 0, 0, 255] : paint(x, y, n)), 1, W, H);
  };
}
const pictureScreen = (picture: Uint8Array | Buffer | null) => screenFrom((x, y) => {
  if (picture === null) return [40, 44, 52, 255];
  const i = (y * W + x) * 4;
  return [picture[i], picture[i + 1], picture[i + 2], 255];
});

const scaled = (r: Rect): Rect => ({ x: r.x * K, y: r.y * K, width: r.width * K, height: r.height * K });
const both = (px: Rect) => ({ dp: { x: px.x / K, y: px.y / K, width: px.width / K, height: px.height / K }, px });

/** READY for a launch: the stage the whole window, the scene's other probes in screen px, the surface by its kind. */
function ready(extras: Record<string, string>, d: FakeDevice, probes: Record<string, Rect> = {}) {
  return `I ReactNativeJS: KOKONADA_LAB READY ${JSON.stringify({
    run: extras.run, seq: 0, scene: extras.scene, clock: extras.clock, t: extras.clock === 'fixed' ? Number(extras.t) : null,
    powerSave: d.settings.get('global/low_power') === '1', pixelRatio: K,
    probes: Object.fromEntries([['stage', { x: 0, y: 0, width: W, height: H }], ...Object.entries(probes)].map(([id, px]) => [id, both(px as Rect)])),
    isRTL: true, fontScale: Number(d.settings.get('system/font_scale')), sentinel: SENTINEL, tier: tierOf(extras.scene, d),
    shaderStatus: extras.scene.startsWith('fallback.') ? 'fallback-scene' : 'ready', shaderReason: null,
  })}`;
}

// The witness at the phone's density: WitnessScene's layout inside the insets (the measured top, the 48 dp bound below).
type Face = 'dark' | 'light';
const INSETS_DP = { top: BAR / K, right: 0, bottom: 48, left: 0 };
const witnessOf = (face: Face) => witnessLayout(face, W / K, H / K, K, 1, INSETS_DP);
function witnessPicture(face: Face) {
  const layout = witnessOf(face);
  const frame = noiseFree(w1bFrame(face, layout.field, K, layout.renderScale).frame);
  const rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) rgba.set([...fieldPixel(frame, (x + 0.5) * layout.renderScale, (y + 0.5) * layout.renderScale), 255], (y * W + x) * 4);
  for (const p of layout.patches) {
    const r = scaled(p.rect);
    const bytes = p.paint === null ? p.token : hexBytes(p.paint);
    for (let y = 0; y < H; y++) {
      if (y + 0.5 < r.y || y + 0.5 >= r.y + r.height) continue;
      for (let x = 0; x < W; x++) if (x + 0.5 >= r.x && x + 0.5 < r.x + r.width) rgba.set([...bytes, 255], (y * W + x) * 4);
    }
  }
  return rgba;
}
function witnessProbes(face: Face) {
  const layout = witnessOf(face);
  const probes: Record<string, Rect> = { region: scaled(layout.region) };
  for (const p of layout.patches) if (p.kind === 'W1a' || p.kind === 'W3') probes[`${p.kind}.${p.colour}`] = scaled(p.rect);
  return probes;
}

// The grain swatch's three strips, the storm's marker and the cell its taps change, in screen px.
const STRIPS: Record<string, Rect> = {
  'grain.x1.00': { x: 4, y: 40, width: 30, height: 60 }, 'grain.x0.71': { x: 37, y: 40, width: 30, height: 60 }, 'grain.x0.50': { x: 70, y: 40, width: 30, height: 60 },
};
const MARKER: Rect = scaled({ x: STORM_MARKER_DP.left, y: STORM_MARKER_DP.top, width: STORM_MARKER_DP.size, height: STORM_MARKER_DP.size });
const CELL: Rect = scaled({ x: 152, y: 380, width: 32, height: 32 });
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const GROUND = hex(STORM_MARKER_COLOURS[0]);
const MARKS = STORM_MARKER_COLOURS.map(hex);
const inside = (r: Rect, x: number, y: number) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;
const GPU: Record<string, number> = { '': 800, storm: 950, heavy: 3000, empty: 100 };

function report(script: string, args: string[], out: string) {
  const r = spawnSync(process.execPath, ['--no-warnings', path.join(REPORTS, script), ...args, '--out', out], { cwd: APP, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return { status: r.status, stderr: r.stderr, report: fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : null };
}
const last = (text: string | null) => (text ?? '').trimEnd().split(/\r?\n/).pop();

// ---- the session ----------------------------------------------------------------------------------------------------

const SESSION = JSON.parse(fs.readFileSync(path.join(PLANS, 'v1.json'), 'utf8'));
const PARTS = loadSession(SESSION, PLANS).parts as Array<{ file: string; plan: Plan; pause: string | null }>;
const ALL_SHOTS = PARTS.flatMap((p) => p.plan.shots);

let tmp: string;
let outDir: string;
const results: Array<{ status: string; pause: string | null }> = [];
const launchesPerRun: number[] = [];
const manifestOf = (id: string) => path.join(outDir, id, 'manifest.json');
const planFile = (id: string) => path.join(PLANS, PARTS.find((p) => p.plan.id === id)!.file);

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'session-harness-'));
  const device = new Phone();
  const w = world(tmp, device);
  const twins = twinsOf(ALL_SHOTS, fs.mkdtempSync(path.join(tmp, 'twins-')));
  const pictures = { dark: witnessPicture('dark'), light: witnessPicture('light') };

  device.scenario = (extras, d) => {
    const scene = extras.scene;
    if (scene === 'smoke') {
      d.frames = [pictureScreen(null)];
      d.emit(ready(extras, d, { mark: { x: 40, y: 100, width: 20, height: 20 } }));
    } else if (scene.startsWith('field.') || scene.startsWith('fallback.')) {
      d.frames = [pictureScreen(twins.get(twinKey(scene, tierOf(scene, d))) ?? null)];
      d.emit(ready(extras, d));
    } else if (scene.startsWith('grain.')) {
      const [, , face, tier] = scene.split('.');
      d.frames = [pictureScreen(twins.get(twinKey(`field.abyss.${face}.rest.${tier}`, tier)) ?? null)];
      d.emit(ready(extras, d, STRIPS));
    } else if (scene.startsWith('witness.')) {
      const face = scene.split('.')[2] as Face;
      d.frames = [pictureScreen(pictures[face])];
      d.emit(ready(extras, d, witnessProbes(face)));
    } else if (scene.startsWith('cost.')) {
      d.frames = [pictureScreen(null)];
      d.emit(ready(extras, d));
      const g = GPU[/\.(storm|heavy|empty)$/.exec(scene)?.[1] ?? ''];
      const result = {
        run: extras.run, seq: 0, kind: 'cost', scene, frames: 1200, displayHz: 120,
        stepUs: { p50: 210, p95: 340, max: 900 }, renderUs: { p50: 1500, p95: 2100, max: 4000 }, gpuProxyUs: { p50: g, p95: g + 200, max: g + 900 }, clock: 'performance.now',
      };
      setTimeout(() => d.emit(`I ReactNativeJS: KOKONADA_LAB RESULT ${JSON.stringify(result)}`), 5);
    } else if (scene.startsWith('storm.')) {
      // The storm's own timeline: every grab is a later moment, its marker and a tapped cell changed.
      d.frames = [screenFrom((x, y, grab) => {
        if (inside(MARKER, x, y)) return [...MARKS[grab % 2], 255];
        if (inside(CELL, x, y)) return grab % 2 === 0 ? [60, 64, 72, 255] : [...GROUND, 255];
        return [...GROUND, 255];
      })];
      d.emit(ready(extras, d, { marker: MARKER }));
    } else {
      throw new Error(`the fake lab draws no scene ${scene}`);
    }
  };

  // gfxinfo's frame count for each launch, as its proof asks the lab to draw: a draws-frames control 1200 frames, a rate
  // shot the middle of its band, anything else (a still) none. The shot is the one this launch's scene and run name.
  let frames = 0;
  const shell = device.shell.bind(device);
  device.shell = async (args: string[]) => {
    const line = args.join(' ');
    if (line.startsWith('am start')) {
      const run = /--es run (\S+)/.exec(line)?.[1] ?? '';
      const scene = /--es scene (\S+)/.exec(line)?.[1] ?? '';
      const shot = ALL_SHOTS.filter((s) => s.scene === scene && run.startsWith(`${s.id}-`)).sort((a, b) => b.id.length - a.id.length)[0];
      const p = shot?.proof;
      frames = p?.kind === 'draws-frames' ? 1200 : p?.kind === 'rate' ? Math.round(((p.band!.min + p.band!.max) / 2) * p.seconds) : 0;
    }
    const out = await shell(args);
    if (line.endsWith('gfxinfo com.kokonadahealth.lab reset')) device.gfxFrames = frames;
    return out;
  };

  outDir = path.join(tmp, 'evidence');
  const launches = () => device.commands.filter((c) => c.startsWith('am start')).length;
  // The owner's sitting: the same command until it passes (it pauses twice for his judgements).
  for (let i = 0; i < 4 && results[results.length - 1]?.status !== 'passed'; i++) {
    const before = launches();
    results.push(await captureSession({
      session: SESSION, planDir: PLANS, appRoot: w.appRoot, repoRoot: w.repoRoot, outDir, apkPath: w.apkPath, adb: device,
      git: { head: () => SHA, porcelain: () => '' }, sleep: async () => {}, log: () => {}, witness: { witnessLayout, witnessProbeProblems },
    }));
    launchesPerRun.push(launches() - before);
  }
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('the v1 session on one fake phone', () => {
  it('pauses after the grain swatch and after the field, then passes; no part is launched twice', () => {
    expect(results.map((r) => r.status)).toEqual(['paused', 'paused', 'passed']);
    expect(results[0].pause).toContain('UI-092');
    expect(results[1].pause).toContain('UI-244');
    const launchesOf = (ids: string[]) => PARTS.filter((p) => ids.includes(p.plan.id)).reduce((n, p) => n + p.plan.shots.reduce((k, s) => k + s.repeat, 0), 0);
    expect(launchesPerRun).toEqual([launchesOf(['smoke', 'v1-grain']), launchesOf(['v1-field']), launchesOf(['v1-near', 'v1-witness', 'v1-policy', 'v1-cost', 'v1-storm'])]);
  });

  // RA-57: the final session.json keeps the record that the owner's two pauses happened, carried across the resumes.
  it('the final session.json still names each pause and when it happened; a part that never paused names none', () => {
    const s = JSON.parse(fs.readFileSync(path.join(outDir, 'session.json'), 'utf8'));
    const byId = Object.fromEntries(s.parts.map((p: { id: string; pause: string | null; pausedAt: string | null }) => [p.id, p]));
    expect(byId['v1-grain'].pause).toContain('UI-092');
    expect(byId['v1-field'].pause).toContain('UI-244');
    for (const id of ['v1-grain', 'v1-field']) expect([id, Number.isNaN(Date.parse(byId[id].pausedAt))]).toEqual([id, false]);
    for (const p of s.parts.filter((x: { id: string }) => !['v1-grain', 'v1-field'].includes(x.id))) expect([p.id, p.pause, p.pausedAt]).toEqual([p.id, null, null]);
  });

  it('every part has its own folder and a passed manifest of its own plan, every planned launch a row', () => {
    for (const { plan } of PARTS) {
      const m = JSON.parse(fs.readFileSync(manifestOf(plan.id), 'utf8'));
      expect([plan.id, m.plan, m.outcome, m.commit]).toEqual([plan.id, plan.id, 'passed', SHA]);
      expect([plan.id, m.rows.length]).toEqual([plan.id, plan.shots.reduce((n, s) => n + s.repeat, 0)]);
    }
    const s = JSON.parse(fs.readFileSync(path.join(outDir, 'session.json'), 'utf8'));
    expect(s.status).toBe('passed');
    expect(s.parts.map((p: { id: string }) => p.id)).toEqual(PARTS.map((p) => p.plan.id));
  });
});

// Which reports read which part, as the runbook runs them. Every part is read by neverRed; each other report by the parts
// it judges. A part added to the session without a line here fails the guard below.
const PART_REPORTS: Record<string, string[]> = {
  smoke: ['neverRed', 'motion'],
  'v1-grain': ['neverRed', 'motion'],
  'v1-field': ['lawParity', 'neverRed', 'motion'],
  'v1-near': ['lawParity', 'neverRed'],
  'v1-witness': ['colourPath', 'neverRed'],
  'v1-policy': ['lawParity', 'neverRed', 'motion'],
  'v1-cost': ['fieldCost', 'neverRed', 'motion'],
  'v1-storm': ['flashTrace', 'neverRed'],
};

describe('every part\'s manifest, fed unmodified to every report that judges it', () => {
  it('the guard: every part of the session has its reports, and every report reads some part', () => {
    expect(Object.keys(PART_REPORTS)).toEqual(PARTS.map((p) => p.plan.id));
    const reports = fs.readdirSync(REPORTS).filter((f) => f.endsWith('.mts')).map((f) => f.replace(/\.mts$/, '')).sort();
    expect([...new Set(Object.values(PART_REPORTS).flat())].sort()).toEqual(reports);
  });

  const cases = Object.entries(PART_REPORTS).flatMap(([part, reps]) => reps.filter((r) => r !== 'flashTrace').map((r) => [part, r] as const));
  it.each(cases)('%s through %s: exit 0, PASS', (part, rep) => {
    const needsPlan = rep === 'motion' || rep === 'fieldCost';
    const args = [...(needsPlan ? ['--plan', planFile(part)] : []), '--manifest', manifestOf(part)];
    const r = report(`${rep}.mts`, args, path.join(tmp, `${part}-${rep}.txt`));
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: '' });
    expect(r.report).toContain(`manifest: ${manifestOf(part)}`);
    expect(last(r.report)).toMatch(/^PASS/);
  });

  /** The frames a decoder writes from a storm shot's recording: the storm at the record's size, frames.json naming the mp4. */
  async function framesOf(shot: string) {
    const m = JSON.parse(fs.readFileSync(manifestOf('v1-storm'), 'utf8'));
    const rec = m.records.find((r: { shot: string }) => r.shot === shot);
    const { width, height } = rec.size;
    const s = width / W;
    const dir = fs.mkdtempSync(path.join(tmp, `frames-${shot}-`));
    const frames = [];
    for (let i = 0; i < 12; i++) {
      const rgba = new Uint8Array(width * height * 4);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const sx = (x + 0.5) / s;
          const sy = (y + 0.5) / s;
          let c = GROUND;
          if (inside(MARKER, sx, sy)) c = MARKS[i >= 6 ? 1 : 0];
          else if (i >= 7 && inside(CELL, sx, sy)) c = [60, 64, 72];
          rgba.set([...c, 255], (y * width + x) * 4);
        }
      }
      const file = `f${String(i).padStart(3, '0')}.png`;
      fs.writeFileSync(path.join(dir, file), await encodePng({ width, height, rgba }));
      frames.push({ file, tMs: i * 100 });
    }
    fs.writeFileSync(path.join(dir, 'frames.json'), JSON.stringify({ source: { mp4Sha256: rec.sha256, size: { width, height } }, frames }));
    return dir;
  }

  it('v1-storm through flashTrace: every shot\'s recording bound to the session\'s manifest, PASS', async () => {
    const plan = PARTS.find((p) => p.plan.id === 'v1-storm')!.plan;
    for (const s of plan.shots) {
      const r = report('flashTrace.mts', ['--frames', await framesOf(s.id), '--manifest', manifestOf('v1-storm'), '--shot', s.id], path.join(tmp, `storm-${s.id}.txt`));
      expect([s.id, r.status, r.stderr]).toEqual([s.id, 0, '']);
      expect(r.report).toContain(`shot ${s.id}.1, record ${s.id}.mp4`);
      expect(last(r.report)).toMatch(/^PASS: .* 1 marker change read$/);
    }
  });
});
