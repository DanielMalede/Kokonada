/// <reference types="node" />
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { capture, checkBuild, Refused, renderFacts, surfaceRule, tierProblem, validatePlan } from '../capture.mjs';
import { decodePng } from '../lib/png.mjs';
import { validateRow } from '../lib/manifest.mjs';
import { makeStamp } from '../lib/stamp.mjs';
import { FakeDevice, rawFrame, SCREEN, STATUS_BAR } from '../__fixtures__/fakeDevice';
import { zip } from '../__fixtures__/zipWriter';

// B8-5b: the phone also answers what the harness now reads, with real state: dumpsys SurfaceFlinger (the GPU and the
// display's colour mode, F5) and screenrecord's raw frames (the `record` proof, F6). Kept here, so the shared fixture
// stays as it is.
const SURFACE_FLINGER = [
  'Device has wide color built-in display: 1',
  'Display 4619827259835644672 color modes:',
  '    ColorMode::NATIVE (0)',
  '    ColorMode::SRGB (7)',
  '    Current color mode: ColorMode::SRGB (7)',
  'GLES: Qualcomm, Adreno (TM) 730, OpenGL ES 3.2 V@0615.65',
].join('\n');
class LabDevice extends FakeDevice {
  surfaceFlinger = SURFACE_FLINGER;
  // What screenrecord writes: an mp4 (its box `ftyp` at offset 4). The phone's own files, by path, with real state:
  // screenrecord writes one, pull reads it, rm removes it.
  recording: Buffer = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(52, 7)]);
  recorded: string[][] = [];
  files = new Map<string, Buffer>();
  // `log -t ReactNativeJS <words>` writes a line into the buffer logcat reads; logcat delivers lines in the order they
  // were logged, a little later.
  logDelayMs = 2;
  marksLost = false;
  async shell(args: string[]): Promise<string> {
    if (args.join(' ') === 'dumpsys SurfaceFlinger') { this.commands.push('dumpsys SurfaceFlinger'); return this.surfaceFlinger; }
    if (args[0] === 'screenrecord') {
      this.commands.push(args.join(' '));
      this.recorded.push(args);
      this.files.set(args[args.length - 1], this.recording);
      return '';
    }
    if (args[0] === 'rm' && args[1] === '-f') { this.commands.push(args.join(' ')); this.files.delete(args[2]); return ''; }
    if (args[0] === 'log' && args[1] === '-t' && args[2] === 'ReactNativeJS') {
      this.commands.push(args.join(' '));
      if (!this.marksLost) setTimeout(() => this.emit(args.slice(3).join(' ')), this.logDelayMs);
      return '';
    }
    return super.shell(args);
  }
  /** A line the lab logs now, which logcat delivers after `ms`. */
  logLater(line: string, ms = 1) { setTimeout(() => this.emit(line), ms); }
  async pull(remote: string, local: string): Promise<string> {
    const file = this.files.get(remote);
    if (file === undefined && remote.startsWith('/data/local/tmp/')) throw new Error(`adb pull ${remote} failed (exit 1): adb: error: remote object '${remote}' does not exist`);
    if (file === undefined) return super.pull(remote, local);
    this.commands.push(`pull ${remote}`);
    fs.writeFileSync(local, file);
    return '';
  }
}
const TOKENS = fs.readFileSync(path.resolve(__dirname, '../../../../../design-tokens/base.tokens.json'), 'utf8');
const TIERS = JSON.parse(TOKENS).field.tiers;
const SKIA_LOCK = JSON.stringify({ name: 'app', lockfileVersion: 3, packages: { '': {}, 'node_modules/@shopify/react-native-skia': { version: '2.6.9' } } });
const NO_SCENE = { direction: null, face: null, hero: null, tier: null };

// OPS-100. The capture harness end to end, on a stateful fake phone (__fixtures__/fakeDevice.ts):
//   · it refuses BEFORE touching the phone when the stamp chain, the installed APK, the plan, the
//     output folder or the OS force-dark setting is wrong;
//   · it writes the phone's original state to disk before its first change;
//   · a READY timeout, an ERROR, a grab that is not sRGB, a frame that does not settle, a launch
//     that differs from its twin (QA-078) or a still scene that draws frames fails the run;
//   · and on EVERY exit path, success, failure or Ctrl-C, the phone is restored exactly.

const SHA = 'c'.repeat(40);
const SENTINEL = 'kokonada-design-lab-sentinel-testfixture1';
const HBC = Buffer.concat([Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f]), Buffer.from(`...${SENTINEL}...`)]);
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

const PLAN = {
  id: 'smoke',
  app: { package: 'com.kokonadahealth.lab', activity: 'com.kokonadahealth.lab.DesignLabActivity' },
  readyTimeoutMs: 200,
  settleMs: 0,
  session: { stayOn: true },
  shots: [
    { id: 'smoke-fixed', repeat: 2, scene: 'smoke', args: { clock: 'fixed', t: '1500', frames: '3' },
      device: { fontScale: 1, night: 'yes', animatorScale: 1, powerSave: false }, probes: ['stage', 'mark'], expect: NO_SCENE },
    { id: 'smoke-still', repeat: 1, scene: 'smoke', args: { clock: 'realtime' },
      device: { fontScale: 1, night: 'yes', animatorScale: 0, powerSave: false }, probes: ['stage', 'mark'], expect: NO_SCENE,
      proof: { kind: 'zero-frames', seconds: 10 } },
  ],
};

// The app paints a gradient; the status bar shows a clock that changes on every grab.
const appPixel = (x: number, y: number) => [x * 5, y * 3, 77, 255];
const frameNo = { n: 0 };
const screen = (colorSpace = 1, app = appPixel) => () => {
  frameNo.n += 1;
  const tick = frameNo.n;
  return rawFrame((x, y) => (y < STATUS_BAR ? [tick % 256, 0, 0, 255] : app(x, y)), colorSpace);
};

function readyLine(run: string, extras: Record<string, string>, device: FakeDevice, override: Record<string, unknown> = {}) {
  return `I ReactNativeJS: KOKONADA_LAB READY ${JSON.stringify({
    run, seq: 0, scene: extras.scene, clock: extras.clock, t: extras.clock === 'fixed' ? Number(extras.t) : null,
    powerSave: device.settings.get('global/low_power') === '1', pixelRatio: 1,
    probes: {
      stage: { dp: { x: 0, y: 0, width: 40, height: 80 }, px: { x: 0, y: 0, width: 40, height: 80 } },
      mark: { dp: { x: 10, y: 30, width: 20, height: 20 }, px: { x: 10, y: 30, width: 20, height: 20 } },
      planted: { dp: { x: 35, y: 10, width: 10, height: 10 }, px: { x: 35, y: 10, width: 10, height: 10 } },
    },
    // The lab activity forces RTL, and the app reads the font scale the device was set to.
    isRTL: true, fontScale: Number(device.settings.get('system/font_scale')),
    sentinel: SENTINEL, ...override,
  })}`;
}

function world({ head = SHA, porcelain = '', installed = 'same' as 'same' | 'other' | 'none' } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-'));
  const repoRoot = path.join(tmp, 'repo');
  const appRoot = path.join(repoRoot, 'mobile', 'app');
  fs.mkdirSync(path.join(appRoot, 'src/design/lab'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, 'design-tokens'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'design-tokens/base.tokens.json'), TOKENS);
  fs.writeFileSync(path.join(appRoot, 'package-lock.json'), SKIA_LOCK);
  fs.writeFileSync(path.join(appRoot, 'src/design/lab/sentinel.ts'), `export const LAB_SENTINEL = '${SENTINEL}';\n`);
  const assets = path.join(appRoot, 'android/app/src/lab/assets');
  fs.mkdirSync(assets, { recursive: true });
  const stamp = makeStamp({ commit: SHA, porcelain: '', bundleSha256: sha(HBC), tokens: {}, entry: 'index.lab.js', createdAt: '2026-10-04T10:00:00.000Z' });
  fs.writeFileSync(path.join(assets, 'index.android.bundle'), HBC);
  fs.writeFileSync(path.join(assets, 'lab-stamp.json'), JSON.stringify(stamp, null, 2));
  const apk = zip([
    { name: 'AndroidManifest.xml', data: Buffer.from('binary xml') },
    { name: 'assets/index.android.bundle', data: HBC, deflate: true },
    { name: 'assets/lab-stamp.json', data: Buffer.from(JSON.stringify(stamp, null, 2)) },
  ]);
  const apkPath = path.join(tmp, 'app-lab.apk');
  fs.writeFileSync(apkPath, apk);

  const device = new LabDevice();
  device.installedApk = installed === 'same' ? apk : installed === 'other' ? Buffer.from('another apk') : null;
  device.frames = [screen()];
  device.scenario = (extras, d) => d.emit(readyLine(extras.run, extras, d));
  const outDir = path.join(tmp, 'evidence');
  const before = device.state();
  const run = (overrides: Record<string, unknown> = {}) => capture({
    plan: PLAN, appRoot, repoRoot, outDir, apkPath, adb: device,
    git: { head: () => head, porcelain: () => porcelain },
    sleep: async () => {}, log: () => {}, ...overrides,
  });
  const mutations = () => device.commands.filter((c) => /^(settings put|settings delete|cmd uimode night \w|svc |dumpsys battery|am start)/.test(c));
  return { tmp, repoRoot, appRoot, apkPath, device, outDir, before, run, mutations };
}

beforeEach(() => { frameNo.n = 0; });

describe('a successful run', () => {
  it('captures every shot, keeps lossless app-region crops, and writes valid manifest rows', async () => {
    const w = world();
    const { manifest } = await w.run();
    expect(manifest.outcome).toBe('passed');
    expect(manifest.rows.map((r: { shot: string; repeat: number }) => `${r.shot}.${r.repeat}`)).toEqual(['smoke-fixed.1', 'smoke-fixed.2', 'smoke-still.1']);
    for (const row of manifest.rows) {
      expect(validateRow(row)).toEqual([]);
      const png = fs.readFileSync(path.join(w.outDir, row.file));
      expect(sha(png)).toBe(row.sha256);
      const decoded = await decodePng(png);
      expect([decoded.width, decoded.height]).toEqual([row.region.width, row.region.height]);
    }
    expect(manifest.rows[0].region).toEqual({ x: 0, y: STATUS_BAR, width: SCREEN.width, height: 70 });
    // The OS setting (adb) and the scale the app itself reported at READY, side by side.
    expect(manifest.rows[0].fontScale).toEqual({ requested: 1, observed: 1, app: 1 });
    expect(manifest.rows[0].isRTL).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(w.outDir, 'manifest.json'), 'utf8')).outcome).toBe('passed');
  });

  it('records the font scale the app reported, not the one requested, when the two agree within 0.01', async () => {
    const w = world();
    w.device.scenario = (extras, d) => d.emit(readyLine(extras.run, extras, d, { fontScale: 1.005 }));
    const { manifest } = await w.run();
    expect(manifest.rows.map((r: { fontScale: unknown }) => r.fontScale)).toEqual([
      { requested: 1, observed: 1, app: 1.005 }, { requested: 1, observed: 1, app: 1.005 }, { requested: 1, observed: 1, app: 1.005 },
    ]);
  });

  it('QA-078: the same shot from two separate launches has the same app-region hash, though the status-bar clock moved', async () => {
    const w = world();
    const { manifest } = await w.run();
    expect(manifest.determinism).toEqual([{ shot: 'smoke-fixed', equal: true, hashes: [manifest.rows[0].appRegionHash, manifest.rows[1].appRegionHash] }]);
    expect(manifest.rows[0].appRegionHash).toBe(manifest.rows[1].appRegionHash);
  });

  it('QA-038: excludes and reports the planted probe partly outside the screen, and the stage under the bars', async () => {
    const w = world();
    const { manifest } = await w.run();
    const row = manifest.rows[0];
    expect(Object.keys(row.probes.inside)).toEqual(['mark']);
    expect(row.probes.excluded.map((e: { id: string; reason: string }) => [e.id, e.reason])).toEqual([
      ['stage', 'partly under the system bars'],
      ['planted', 'partly outside the screen'],
    ]);
  });

  it('records a positive control that drew frames beside the still shot that drew none', async () => {
    const w = world();
    const shell = w.device.shell.bind(w.device);
    let movingShot = false;
    w.device.shell = async (args: string[]) => {
      const line = args.join(' ');
      if (line.startsWith('am start')) movingShot = line.includes('smoke-moving');
      const out = await shell(args);
      if (line.endsWith('gfxinfo com.kokonadahealth.lab reset') && movingShot) w.device.gfxFrames = 600;
      return out;
    };
    const moving = { ...PLAN.shots[1], id: 'smoke-moving', device: { ...PLAN.shots[1].device, animatorScale: 1 }, proof: { kind: 'draws-frames', seconds: 10 } };
    const { manifest } = await w.run({ plan: { ...PLAN, shots: [moving, PLAN.shots[1]] } });
    expect(manifest.proofs).toEqual([
      { shot: 'smoke-moving', kind: 'draws-frames', seconds: 10, frames: 600, passed: true },
      { shot: 'smoke-still', kind: 'zero-frames', seconds: 10, frames: 0, passed: true },
    ]);
  });

  it('records the zero-frames proof of the still shot', async () => {
    const w = world();
    const { manifest } = await w.run();
    expect(manifest.proofs).toEqual([{ shot: 'smoke-still', kind: 'zero-frames', seconds: 10, frames: 0, passed: true }]);
  });

  it('writes the phone\'s original state to disk before its first change, and restores it exactly', async () => {
    const w = world();
    let savedBeforeFirstChange: boolean | null = null;
    w.device.onCommand = (line) => {
      if (savedBeforeFirstChange === null && /^(settings put|cmd uimode night \w|svc |dumpsys battery)/.test(line)) {
        savedBeforeFirstChange = fs.existsSync(path.join(w.outDir, 'device-original-state.json'));
      }
    };
    await w.run();
    expect(savedBeforeFirstChange).toBe(true);
    expect(w.device.state()).toEqual(w.before);
    const saved = JSON.parse(fs.readFileSync(path.join(w.outDir, 'device-original-state.json'), 'utf8'));
    expect(saved.snapshot.settings['system/font_scale']).toBe('0.8');
  });
});

describe('restore runs on every exit path', () => {
  const fails = async (w: ReturnType<typeof world>, why: RegExp, overrides: Record<string, unknown> = {}) => {
    await expect(w.run(overrides)).rejects.toThrow(why);
    expect(w.device.state()).toEqual(w.before);
  };

  it('a READY timeout', async () => {
    const w = world();
    w.device.scenario = () => {};
    await fails(w, /no READY/);
  });

  it('an ERROR line from the lab', async () => {
    const w = world();
    w.device.scenario = (extras, d) => d.emit(`KOKONADA_LAB ERROR ${JSON.stringify({ run: extras.run, errors: ['scene "smoke" is not a lab scene'] })}`);
    await fails(w, /refused/);
  });

  it('a READY from another build (sentinel)', async () => {
    const w = world();
    w.device.scenario = (extras, d) => d.emit(readyLine(extras.run, extras, d, { sentinel: 'kokonada-design-lab-sentinel-0ld0ld0ld0ld' }));
    await fails(w, /sentinel/);
  });

  it('a READY that is not right to left (F-13)', async () => {
    const w = world();
    w.device.scenario = (extras, d) => d.emit(readyLine(extras.run, extras, d, { isRTL: false }));
    await fails(w, /right to left/);
  });

  it('a READY whose font scale is not the one the harness set (the setting did not take effect)', async () => {
    const w = world();
    w.device.scenario = (extras, d) => d.emit(readyLine(extras.run, extras, d, { fontScale: 0.8 }));
    await fails(w, /font scale 0\.8 /);
  });

  it('a grab that is not sRGB', async () => {
    const w = world();
    w.device.frames = [screen(2)];
    await fails(w, /not sRGB/);
  });

  it('a READY whose power-save state the device contradicts (a change the lab never heard)', async () => {
    const w = world();
    w.device.scenario = (extras, d) => d.emit(readyLine(extras.run, extras, d, { powerSave: true }));
    await fails(w, /power save/);
  });

  it('a battery-saver change between READY and the grabs', async () => {
    const w = world();
    const execOut = w.device.execOut.bind(w.device);
    w.device.execOut = async (args: string[]) => {
      const out = await execOut(args);
      w.device.settings.set('global/low_power', '1'); // switched on while the screen was being read
      return out;
    };
    await fails(w, /power save changed/);
  });

  it('a first grab that is not sRGB, even when the settle grab is: and no PNG is kept in the wrong colour space', async () => {
    const w = world();
    let n = 0;
    w.device.frames = [() => { n += 1; return screen(n === 1 ? 2 : 1)(); }];
    await fails(w, /not sRGB/);
    expect(fs.readdirSync(w.outDir).filter((f) => f.endsWith('.png'))).toEqual([]);
  });

  it('a frame that does not settle between two grabs', async () => {
    const w = world();
    w.device.frames = [() => { frameNo.n += 1; const n = frameNo.n; return rawFrame((x, y) => [x, y, n % 256, 255]); }];
    await fails(w, /did not settle/);
  });

  it('two launches of the same shot that differ (QA-078), with the manifest still written as failed', async () => {
    const w = world();
    let launch = 0;
    const base = w.device.scenario;
    w.device.scenario = (extras, d) => { launch += 1; const n = launch; d.frames = [screen(1, (x, y) => [x, y, n, 255])]; base(extras, d); };
    await fails(w, /QA-078/);
    expect(JSON.parse(fs.readFileSync(path.join(w.outDir, 'manifest.json'), 'utf8')).outcome).toBe('failed');
  });

  it('a still shot that draws frames', async () => {
    const w = world();
    const shell = w.device.shell.bind(w.device);
    w.device.shell = async (args: string[]) => {
      const out = await shell(args);
      if (args.join(' ').endsWith('gfxinfo com.kokonadahealth.lab reset')) w.device.gfxFrames = 37;
      return out;
    };
    await fails(w, /37 frames/);
  });

  it('a positive control that draws no frame: the zero-frames proof beside it would prove nothing', async () => {
    const w = world();
    const moving = { ...PLAN.shots[1], id: 'smoke-moving', device: { ...PLAN.shots[1].device, animatorScale: 1 }, proof: { kind: 'draws-frames', seconds: 10 } };
    await fails(w, /positive control.*drew no frame/, { plan: { ...PLAN, shots: [moving, PLAN.shots[1]] } });
  });

  it('an interruption (Ctrl-C) while waiting for READY', async () => {
    const w = world();
    const controller = new AbortController();
    w.device.scenario = () => { controller.abort(); };
    await fails(w, /interrupted/, { signal: controller.signal });
  });

  it('a restore step that fails is reported, and the other steps still run', async () => {
    const w = world();
    w.device.onCommand = (line) => { if (line === 'settings put system font_scale 0.8') w.device.failOn = /settings put system font_scale 0\.8/; };
    w.device.failOn = null;
    await expect(w.run()).rejects.toThrow(/not fully restored.*font_scale/s);
    expect(w.device.night).toBe('yes');
    expect(w.device.settings.get('global/transition_animation_scale')).toBe('1.0');
  });
});

describe('it refuses before touching the phone', () => {
  it.each([
    ['HEAD moved since the bundle was stamped', { head: 'd'.repeat(40) }, /HEAD is d{40}/],
    ['the tree has uncommitted changes', { porcelain: ' M src/x.ts' }, /uncommitted/],
    ['the installed lab is another APK', { installed: 'other' as const }, /installed lab is not this APK/],
    ['the lab is not installed', { installed: 'none' as const }, /not installed/],
  ])('%s', async (_label, setup, why) => {
    const w = world(setup);
    await expect(w.run()).rejects.toThrow(why);
    await expect(w.run()).rejects.toBeInstanceOf(Refused);
    expect(w.mutations()).toEqual([]);
  });

  it('the OS forces dark mode onto apps (debug.hwui.force_dark)', async () => {
    const w = world();
    w.device.props['debug.hwui.force_dark'] = 'true';
    await expect(w.run()).rejects.toThrow(/force-dark/);
    expect(w.mutations()).toEqual([]);
  });

  it('the output folder is inside the repository (evidence never goes into git)', async () => {
    const w = world();
    await expect(w.run({ outDir: path.join(w.repoRoot, 'evidence') })).rejects.toThrow(/inside the repository/);
    expect(w.mutations()).toEqual([]);
  });

  it('the plan is not valid', async () => {
    const w = world();
    await expect(w.run({ plan: { ...PLAN, shots: [] } })).rejects.toThrow(/plan/);
    expect(w.mutations()).toEqual([]);
  });
});

describe('checkBuild (the stamp chain on disk and in the APK, no phone needed)', () => {
  it('passes the stamped build, and reports what it verified', () => {
    const w = world();
    const build = checkBuild({ appRoot: w.appRoot, apkPath: w.apkPath, git: { head: () => SHA, porcelain: () => '' } });
    expect(build).toMatchObject({ head: SHA, sentinel: SENTINEL, hermes: true });
    expect(build.apkSha256).toBe(sha(fs.readFileSync(w.apkPath)));
  });

  it('refuses an APK whose bundle is not Hermes bytecode, or does not carry this tree\'s sentinel', () => {
    const w = world();
    fs.writeFileSync(path.join(w.appRoot, 'src/design/lab/sentinel.ts'), "export const LAB_SENTINEL = 'kokonada-design-lab-sentinel-someoneelse1';\n");
    expect(() => checkBuild({ appRoot: w.appRoot, apkPath: w.apkPath, git: { head: () => SHA, porcelain: () => '' } })).toThrow(/sentinel/);
  });
});

describe('the shipped smoke plan', () => {
  it('is a valid plan with the OPS-100 smoke shots: a fixed shot twice (QA-078) and a still real-time shot under reduced motion', () => {
    const plan = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../capture-plans/smoke.json'), 'utf8'));
    expect(validatePlan(plan)).toEqual([]);
    expect(plan.shots.some((s: { repeat: number; args: { clock: string } }) => s.repeat >= 2 && s.args.clock === 'fixed')).toBe(true);
    expect(plan.shots.some((s: { args: { clock: string }; device: { animatorScale: number }; proof?: { kind: string; seconds: number } }) =>
      s.args.clock === 'realtime' && s.device.animatorScale === 0 && s.proof?.kind === 'zero-frames' && s.proof.seconds === 10)).toBe(true);
  });

  it('has the positive control beside the still shot: the same scene in real time with motion on, which must draw frames', () => {
    const plan = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../capture-plans/smoke.json'), 'utf8'));
    const still = plan.shots.find((s: { proof?: { kind: string } }) => s.proof?.kind === 'zero-frames');
    const control = plan.shots.find((s: { proof?: { kind: string } }) => s.proof?.kind === 'draws-frames');
    expect(control).toBeDefined();
    expect(control.scene).toBe(still.scene);
    expect(control.args.clock).toBe('realtime');
    expect(control.device.animatorScale).toBeGreaterThan(0);
    expect(control.proof.seconds).toBe(still.proof.seconds);
  });

  it('validatePlan names what is wrong', () => {
    expect(validatePlan({ ...PLAN, readyTimeoutMs: 5 }).join()).toMatch(/readyTimeoutMs/);
    expect(validatePlan({ ...PLAN, shots: [{ ...PLAN.shots[0], args: { clock: 'fixed; reboot' } }] }).join()).toMatch(/args\.clock/);
    expect(validatePlan({ ...PLAN, shots: [PLAN.shots[0], PLAN.shots[0]] }).join()).toMatch(/twice/);
    expect(validatePlan({ ...PLAN, shots: [{ ...PLAN.shots[0], device: { ...PLAN.shots[0].device, night: 'auto' } }] }).join()).toMatch(/night/);
  });
});

// UI-223 (RA-36): a field shot says which surface drew it. The lab's READY carries the field effect's status, and the
// harness refuses, loudly and with the phone restored, a field.* shot that was not drawn by the field shader (a shader
// that did not compile, a builder throw, or a READY that names no status), and a fallback.* shot that is not the fallback
// scene by design. The status is kept in the manifest row.
describe('UI-223: the surface that drew a field shot', () => {
  const shotOf = (id: string, scene: string) => ({
    id, repeat: 1, scene, args: { clock: 'fixed', t: '11000', frames: '3' },
    device: { fontScale: 1, night: 'yes', animatorScale: 1, powerSave: false }, probes: ['stage'],
    expect: scene.startsWith('field.') ? { direction: 'abyss', face: 'dark', hero: 'three', tier: 'full' } : { direction: 'abyss', face: 'dark', hero: null, tier: null },
  });
  const FIELD = { ...PLAN, id: 'field', shots: [shotOf('field-dark-three', 'field.abyss.dark.three.full')] };
  const FALLBACK = { ...PLAN, id: 'fallback', shots: [shotOf('fallback-dark-three', 'fallback.abyss.dark.three')] };
  const saying = (w: ReturnType<typeof world>, status: Record<string, unknown>) => {
    w.device.scenario = (extras, d) => d.emit(readyLine(extras.run, extras, d, status));
  };
  const refused = async (w: ReturnType<typeof world>, plan: unknown, why: RegExp) => {
    await expect(w.run({ plan })).rejects.toThrow(why);
    expect(w.device.state()).toEqual(w.before);
    const manifest = JSON.parse(fs.readFileSync(path.join(w.outDir, 'manifest.json'), 'utf8'));
    expect(manifest.outcome).toBe('failed');
    expect(manifest.failure).toMatch(why);
    expect(manifest.rows).toEqual([]);
    expect(fs.readdirSync(w.outDir).filter((f) => f.endsWith('.png'))).toEqual([]);
  };

  it('a field shot drawn by the field shader passes, and its row says ready', async () => {
    const w = world();
    saying(w, { shaderStatus: 'ready', shaderReason: null });
    const { manifest } = await w.run({ plan: FIELD });
    expect(manifest.outcome).toBe('passed');
    expect(manifest.rows.map((r: { shaderStatus: unknown }) => r.shaderStatus)).toEqual(['ready']);
  });

  it.each([
    ['the effect fell back (the shader did not compile)', { shaderStatus: 'fallback', shaderReason: 'the field shader did not compile' }, /field-dark-three: READY says shaderStatus "fallback" \(the field shader did not compile\)/],
    ['the builder threw on the UI thread', { shaderStatus: 'fallback', shaderReason: 'RangeError: over-demand' }, /field-dark-three: READY says shaderStatus "fallback" \(RangeError: over-demand\)/],
    ['READY names no status', {}, /field-dark-three: READY says shaderStatus null/],
    ['READY names the fallback scene', { shaderStatus: 'fallback-scene', shaderReason: 'x' }, /field-dark-three: READY says shaderStatus "fallback-scene"/],
  ])('a field shot whose READY says the field did not draw it is refused: %s', async (_label, status, why) => {
    const w = world();
    saying(w, status);
    await refused(w, FIELD, why);
  });

  it('a fallback shot is the fallback scene by design: it passes saying so, and is refused saying anything else', async () => {
    const ok = world();
    saying(ok, { shaderStatus: 'fallback-scene', shaderReason: 'the lab fallback scene' });
    const { manifest } = await ok.run({ plan: FALLBACK });
    expect(manifest.rows.map((r: { shaderStatus: unknown }) => r.shaderStatus)).toEqual(['fallback-scene']);
    for (const status of [{ shaderStatus: 'ready' }, { shaderStatus: 'fallback' }, {}]) {
      const w = world();
      saying(w, status);
      await refused(w, FALLBACK, /fallback-dark-three: READY says shaderStatus/);
    }
  });

  it('a scene that draws no field (smoke) is held to nothing, and its row says null', async () => {
    const w = world();
    const { manifest } = await w.run();
    expect(manifest.rows.map((r: { shaderStatus: unknown }) => r.shaderStatus)).toEqual([null, null, null]);
  });
});

// ---- B8-5b ------------------------------------------------------------------------------------------------------
// The architect's B8 plan, B8-5b: every row states its scene facts (the shot's expect, F4) and the facts adb read (F5);
// the plan format is strict (UI-215) and can ask for a pixel check (notFlat) and four new proofs (rate for UI-171,
// framestats, result, record); an ERROR after READY refuses the shot (UI-225); READY's stage must be the app window
// (UI-216); and every scene prefix of the plan has a surface rule.

// A shot as a plan file holds it: the harness takes plain JSON, and validatePlan is what types it.
type Shot = Record<string, unknown>;
const FIELD_EXPECT = { direction: 'abyss', face: 'dark', hero: 'three', tier: 'full' };
const fieldShot = (id: string, scene: string, extra: Record<string, unknown> = {}): Shot => ({
  id, repeat: 1, scene, args: { clock: 'fixed', t: '11000', frames: '3' },
  device: { fontScale: 1, night: 'yes', animatorScale: 1, powerSave: false }, probes: ['stage'], expect: FIELD_EXPECT, ...extra,
}) as Shot;
const planOf = (...shots: Shot[]) => ({ ...PLAN, id: 'b8', shots });
const readyAs = (w: ReturnType<typeof world>, override: Record<string, unknown>) => {
  w.device.scenario = (extras, d) => d.emit(readyLine(extras.run, extras, d, override));
};
const refusedRun = async (w: ReturnType<typeof world>, plan: unknown, why: RegExp) => {
  await expect(w.run({ plan })).rejects.toThrow(why);
  expect(w.device.state()).toEqual(w.before);
  const manifest = JSON.parse(fs.readFileSync(path.join(w.outDir, 'manifest.json'), 'utf8'));
  expect(manifest.outcome).toBe('failed');
  expect(manifest.failure).toMatch(why);
  return manifest;
};

describe('B8-5a/5b: the facts each row states', () => {
  it('a smoke row: no scene and no render facts, the GPU and display from adb, Skia from the lockfile, READY\'s stage and reason', async () => {
    const w = world();
    const { manifest } = await w.run();
    const row = manifest.rows[0];
    expect(validateRow(row)).toEqual([]);
    expect(row.expect).toEqual(NO_SCENE);
    expect([row.direction, row.face, row.renderScale, row.sampling]).toEqual([null, null, null, null]);
    expect(row.gl).toEqual({ renderer: 'Qualcomm, Adreno (TM) 730', gles: 'OpenGL ES 3.2 V@0615.65', reason: null });
    expect(row.display).toEqual({ colorMode: 'ColorMode::SRGB (7)', wideColor: true, refreshMode: 'renderFrameRate 120 Hz, vsyncRate 120 Hz', reason: null });
    expect(row.skiaVersion).toBe('2.6.9');
    expect(row.stage).toEqual({ x: 0, y: 0, width: SCREEN.width, height: SCREEN.height });
    expect(row.shaderReason).toBeNull();
  });

  it.each([
    ['full', TIERS.full.renderScale.$value],
    ['low', TIERS.low.renderScale.$value],
    ['still', TIERS.full.renderScale.$value], // the still is the full tier's law drawn once (designer 2.8)
  ])('a field row at the %s tier: its expect, and the render scale and sampling the tier implies', async (tier, scale) => {
    const w = world();
    readyAs(w, { shaderStatus: 'ready', shaderReason: null });
    const expectation = { ...FIELD_EXPECT, tier };
    const { manifest } = await w.run({ plan: planOf(fieldShot('f', `field.abyss.dark.three.${tier}`, { expect: expectation })) });
    const row = manifest.rows[0];
    expect(validateRow(row)).toEqual([]);
    expect(row.expect).toEqual(expectation);
    expect([row.direction, row.face]).toEqual(['abyss', 'dark']);
    expect(row.renderScale).toBe(scale);
    expect(row.sampling).toEqual({ filter: 'linear', mipmap: 'none' });
  });

  it('records READY\'s shader reason (UI-226)', async () => {
    const w = world();
    readyAs(w, { shaderStatus: 'fallback-scene', shaderReason: 'the lab fallback scene: FieldFallback mounted directly' });
    const shot = fieldShot('fb', 'fallback.abyss.dark.three', { expect: { direction: 'abyss', face: 'dark', hero: null, tier: null } });
    const { manifest } = await w.run({ plan: planOf(shot) });
    expect(manifest.rows[0].shaderReason).toBe('the lab fallback scene: FieldFallback mounted directly');
  });

  it('a GPU the device does not name is null with its reason in the row, never a guess, and the run still passes', async () => {
    const w = world();
    w.device.surfaceFlinger = 'RenderEngine: skiavk';
    const { manifest } = await w.run();
    expect(manifest.rows[0].gl).toMatchObject({ renderer: null, gles: null, reason: expect.stringMatching(/no GLES line/) });
    expect(validateRow(manifest.rows[0])).toEqual([]);
  });

  it('carries no tap coordinate and no emotion value: a row has exactly the schema\'s fields, whatever READY adds', async () => {
    const w = world();
    readyAs(w, { taps: [[0.1, 0.2]], emotion: 'joy' });
    const { manifest } = await w.run();
    expect(JSON.stringify(manifest.rows)).not.toMatch(/taps|emotion|joy/);
  });

  it.each([
    ['a lockfile without Skia', (w: ReturnType<typeof world>) => fs.writeFileSync(path.join(w.appRoot, 'package-lock.json'), '{"lockfileVersion":3,"packages":{}}'), /Skia.*@shopify\/react-native-skia is not in the lockfile/],
    ['no lockfile', (w: ReturnType<typeof world>) => fs.rmSync(path.join(w.appRoot, 'package-lock.json')), /package-lock\.json/],
    ['no token file', (w: ReturnType<typeof world>) => fs.rmSync(path.join(w.repoRoot, 'design-tokens/base.tokens.json')), /base\.tokens\.json/],
    ['tokens without the tier render scales', (w: ReturnType<typeof world>) => fs.writeFileSync(path.join(w.repoRoot, 'design-tokens/base.tokens.json'), '{"field":{"tiers":{}}}'), /renderScale/],
  ])('refuses before touching the phone: %s', async (_label, setup, why) => {
    const w = world();
    setup(w);
    await expect(w.run()).rejects.toThrow(why);
    await expect(w.run()).rejects.toBeInstanceOf(Refused);
    expect(w.mutations()).toEqual([]);
  });
});

describe('UI-216: READY\'s stage is the app window', () => {
  it.each([
    ['offset below the top of the window', { x: 0, y: 4, width: SCREEN.width, height: SCREEN.height - 4 }],
    ['shorter than the window', { x: 0, y: 0, width: SCREEN.width, height: SCREEN.height - 6 }],
    ['narrower than the window', { x: 0, y: 0, width: SCREEN.width - 2, height: SCREEN.height }],
    ['shifted sideways', { x: 2, y: 0, width: SCREEN.width, height: SCREEN.height }],
  ])('a stage %s is refused, and no row is written', async (_label, px) => {
    const w = world();
    readyAs(w, { shaderStatus: 'ready', shaderReason: null, probes: { stage: { dp: px, px } } });
    const manifest = await refusedRun(w, planOf(fieldShot('f', 'field.abyss.dark.three.full')), /f: READY's stage .* is not the app window .*UI-216/);
    expect(manifest.rows).toEqual([]);
  });

  it('a READY without a stage rect is refused', async () => {
    const w = world();
    readyAs(w, { shaderStatus: 'ready', shaderReason: null, probes: { mark: { dp: { x: 10, y: 30, width: 20, height: 20 }, px: { x: 10, y: 30, width: 20, height: 20 } } } });
    await refusedRun(w, planOf(fieldShot('f', 'field.abyss.dark.three.full', { probes: ['mark'] })), /f: READY has no stage rect/);
  });

  it('a stage within a pixel of the window (layout rounding) passes', async () => {
    const w = world();
    const px = { x: 0.4, y: -0.4, width: SCREEN.width + 0.9, height: SCREEN.height - 0.9 };
    readyAs(w, { shaderStatus: 'ready', shaderReason: null, probes: { stage: { dp: px, px } } });
    const { manifest } = await w.run({ plan: planOf(fieldShot('f', 'field.abyss.dark.three.full')) });
    expect(manifest.rows[0].stage).toEqual(px);
  });
});

describe('UI-225: an ERROR the lab sends after READY refuses the shot', () => {
  const lateError = (w: ReturnType<typeof world>, when: 'grab' | 'proof') => {
    let run = '';
    w.device.scenario = (extras, d) => { run = extras.run; d.emit(readyLine(extras.run, extras, d, { shaderStatus: 'ready', shaderReason: null })); };
    const late = () => w.device.emit(`I ReactNativeJS: KOKONADA_LAB ERROR ${JSON.stringify({ run, errors: ['the surface changed after READY: READY said ready, now fallback (RangeError: over-demand)'] })}`);
    if (when === 'grab') {
      const execOut = w.device.execOut.bind(w.device);
      let grabs = 0;
      w.device.execOut = async (args: string[]) => { grabs += 1; if (grabs === 1) late(); return execOut(args); };
    }
    return late;
  };

  it('an ERROR while the screen is read', async () => {
    const w = world();
    lateError(w, 'grab');
    const manifest = await refusedRun(w, planOf(fieldShot('f', 'field.abyss.dark.three.full')), /f: the lab sent an ERROR for run .*the surface changed after READY/);
    expect(manifest.rows).toEqual([]);
    expect(fs.readdirSync(w.outDir).filter((f) => f.endsWith('.png'))).toEqual([]);
  });

  it('an ERROR during a proof, after the shot was grabbed', async () => {
    const w = world();
    const late = lateError(w, 'proof');
    const shot = fieldShot('f', 'field.abyss.dark.three.full', { args: { clock: 'realtime', frames: '3' }, proof: { kind: 'draws-frames', seconds: 10 } });
    const shell = w.device.shell.bind(w.device);
    w.device.shell = async (args: string[]) => {
      const out = await shell(args);
      if (args.join(' ').endsWith('gfxinfo com.kokonadahealth.lab reset')) { w.device.gfxFrames = 600; late(); }
      return out;
    };
    await refusedRun(w, planOf(shot), /f: the lab sent an ERROR for run .*the surface changed after READY/);
  });

  it('a lab line it cannot read after READY (it could be an ERROR)', async () => {
    const w = world();
    w.device.scenario = (extras, d) => d.emit(readyLine(extras.run, extras, d, { shaderStatus: 'ready', shaderReason: null }));
    const execOut = w.device.execOut.bind(w.device);
    w.device.execOut = async (args: string[]) => { w.device.emit('KOKONADA_LAB ERROR {"run":"'); return execOut(args); };
    await refusedRun(w, planOf(fieldShot('f', 'field.abyss.dark.three.full')), /f: cannot read a lab line/);
  });

  // logcat delivers a line some time after the lab logs it: an ERROR logged during the grabs can arrive after them. The
  // harness logs its own marker into the same buffer after the grabs, and judges the run's lines only once the marker is
  // back, so every line logged before it has been read.
  it('an ERROR logged during the grabs that logcat delivers after them', async () => {
    const w = world();
    w.device.scenario = (extras, d) => d.emit(readyLine(extras.run, extras, d, { shaderStatus: 'ready', shaderReason: null }));
    const execOut = w.device.execOut.bind(w.device);
    let grabs = 0;
    w.device.execOut = async (args: string[]) => {
      grabs += 1;
      if (grabs === 2) {
        const launched = w.device.commands.filter((c) => c.startsWith('am start')).pop() ?? '';
        const id = /--es run (\S+)/.exec(launched)?.[1];
        w.device.logLater(`I ReactNativeJS: KOKONADA_LAB ERROR ${JSON.stringify({ run: id, errors: ['the surface changed after READY: READY said ready, now fallback'] })}`, 1);
      }
      return execOut(args);
    };
    await refusedRun(w, planOf(fieldShot('f', 'field.abyss.dark.three.full')), /f: the lab sent an ERROR for run .*the surface changed after READY/);
    expect(w.device.commands.some((c) => /^log -t ReactNativeJS KOKONADA_HARNESS MARK f-1-/.test(c))).toBe(true);
  });

  it('a marker that never comes back: the lines after READY cannot be proved read, so the shot is refused', async () => {
    const w = world();
    readyAs(w, { shaderStatus: 'ready', shaderReason: null });
    w.device.marksLost = true;
    await refusedRun(w, planOf(fieldShot('f', 'field.abyss.dark.three.full')), /f: the harness's logcat marker did not come back within 200 ms/);
  });

  it('another run\'s ERROR is not this shot\'s', async () => {
    const w = world();
    w.device.scenario = (extras, d) => d.emit(readyLine(extras.run, extras, d, { shaderStatus: 'ready', shaderReason: null }));
    const execOut = w.device.execOut.bind(w.device);
    w.device.execOut = async (args: string[]) => { w.device.emit(`KOKONADA_LAB ERROR ${JSON.stringify({ run: 'old-run', errors: ['x'] })}`); return execOut(args); };
    const { manifest } = await w.run({ plan: planOf(fieldShot('f', 'field.abyss.dark.three.full')) });
    expect(manifest.outcome).toBe('passed');
  });
});

describe('the surface rules of the B8 scene prefixes (UI-223)', () => {
  it.each([
    'witness.abyss.dark', 'grain.abyss.light.low', 'cost.abyss.dark.three.full.storm', 'storm.abyss.dark.burst', 'field.abyss.dark.three.policy',
  ])('%s must be drawn by the field shader: ready passes, a fallback is refused', async (scene) => {
    const ok = world();
    readyAs(ok, { shaderStatus: 'ready', shaderReason: null });
    const shot = fieldShot('s', scene, { expect: NO_SCENE });
    expect((await ok.run({ plan: planOf(shot) })).manifest.outcome).toBe('passed');
    const bad = world();
    readyAs(bad, { shaderStatus: 'fallback', shaderReason: 'the field shader did not compile' });
    await refusedRun(bad, planOf(shot), /s: READY says shaderStatus "fallback" \(the field shader did not compile\)/);
  });

  it('a scene with no surface rule is refused: the harness cannot tell what must have drawn it', async () => {
    const w = world();
    readyAs(w, { shaderStatus: 'ready', shaderReason: null });
    await refusedRun(w, planOf(fieldShot('n', 'near.abyss.dark.ne', { expect: NO_SCENE })), /n: scene near\.abyss\.dark\.ne has no surface rule/);
  });

  it('a prefix is a whole segment: smoke is held to nothing, smokey and witnessx have no rule', () => {
    expect(surfaceRule('smoke')).toMatchObject({ status: undefined });
    expect(surfaceRule('smokey')).toBeNull();
    expect(surfaceRule('witnessx.abyss.dark')).toBeNull();
    expect(surfaceRule('field.abyss.dark.three.policy')).toMatchObject({ status: 'ready' });
  });
});

describe('the new proofs', () => {
  const moving = (proof: Record<string, unknown>, extra: Record<string, unknown> = {}) => fieldShot('m', 'field.abyss.dark.three.low', {
    args: { clock: 'realtime', frames: '3' }, expect: { ...FIELD_EXPECT, tier: 'low' }, proof, ...extra,
  });
  const drawing = (w: ReturnType<typeof world>, frames: number) => {
    readyAs(w, { shaderStatus: 'ready', shaderReason: null });
    const shell = w.device.shell.bind(w.device);
    w.device.shell = async (args: string[]) => {
      const out = await shell(args);
      if (args.join(' ').endsWith('gfxinfo com.kokonadahealth.lab reset')) w.device.gfxFrames = frames;
      return out;
    };
  };

  describe('rate (UI-171): frames per second inside a band', () => {
    const RATE = { kind: 'rate', seconds: 10, band: { min: 55, max: 62 } };

    it('passes inside the band, and records the rate', async () => {
      const w = world();
      drawing(w, 600);
      const { manifest } = await w.run({ plan: planOf(moving(RATE)) });
      expect(manifest.proofs).toEqual([{ shot: 'm', kind: 'rate', seconds: 10, frames: 600, fps: 60, band: { min: 55, max: 62 }, passed: true }]);
    });

    it.each([
      ['above the band (the cap did not hold)', 1200, /m: 120 frames\/s in 10 s is outside the band 55 to 62/],
      ['below the band', 300, /m: 30 frames\/s in 10 s is outside the band 55 to 62/],
      ['no frame at all', 0, /m: 0 frames\/s/],
    ])('refuses a rate %s', async (_label, frames, why) => {
      const w = world();
      drawing(w, frames);
      await refusedRun(w, planOf(moving(RATE)), why);
    });

    it('the band\'s edges are inside it', async () => {
      for (const frames of [550, 620]) {
        const w = world();
        drawing(w, frames);
        expect((await w.run({ plan: planOf(moving(RATE)) })).manifest.proofs[0].passed).toBe(true);
      }
    });
  });

  describe('framestats: the jank summary, informational', () => {
    it('records the frames and the jank, and asserts nothing', async () => {
      const w = world();
      drawing(w, 1200);
      const { manifest } = await w.run({ plan: planOf(moving({ kind: 'framestats', seconds: 10 })) });
      expect(manifest.outcome).toBe('passed');
      expect(manifest.proofs).toEqual([{ shot: 'm', kind: 'framestats', seconds: 10, frames: 1200, janky: 0, jankPercent: 0, reason: null, passed: null }]);
    });

    it('output it cannot read is null with a reason, and the run still passes', async () => {
      const w = world();
      readyAs(w, { shaderStatus: 'ready', shaderReason: null });
      const shell = w.device.shell.bind(w.device);
      w.device.shell = async (args: string[]) => (args.join(' ') === 'dumpsys gfxinfo com.kokonadahealth.lab' ? 'No process found' : shell(args));
      const { manifest } = await w.run({ plan: planOf(moving({ kind: 'framestats', seconds: 10 })) });
      expect(manifest.proofs[0]).toMatchObject({ frames: null, janky: null, jankPercent: null, reason: expect.stringMatching(/Total frames rendered/), passed: null });
    });
  });

  describe('result: the bench\'s RESULT line', () => {
    const STATS = { p50: 400, p95: 900, max: 2000 };
    const result = (run: string, scene: string, extra: Record<string, unknown> = {}) => ({
      run, seq: 0, kind: 'cost', scene, frames: 1200, displayHz: 120, stepUs: STATS, renderUs: STATS, gpuProxyUs: STATS, clock: 'performance.now', ...extra,
    });
    const COST = 'cost.abyss.dark.three.full';
    const costShot = () => fieldShot('c', COST, { proof: { kind: 'result', seconds: 1 } });
    const benching = (w: ReturnType<typeof world>, extra: Record<string, unknown> = {}, before = false) => {
      w.device.scenario = (extras, d) => {
        const res = `I ReactNativeJS: KOKONADA_LAB RESULT ${JSON.stringify(result(extras.run, extras.scene, extra))}`;
        if (before) d.emit(res);
        d.emit(readyLine(extras.run, extras, d, { shaderStatus: 'ready', shaderReason: null }));
        if (!before) setTimeout(() => d.emit(res), 5);
      };
    };

    it('records a valid RESULT after READY', async () => {
      const w = world();
      benching(w);
      const { manifest } = await w.run({ plan: planOf(costShot()) });
      expect(manifest.results).toEqual([{ shot: 'c', repeat: 1, result: expect.objectContaining({ kind: 'cost', scene: COST, frames: 1200 }) }]);
      expect(manifest.proofs).toEqual([{ shot: 'c', kind: 'result', seconds: 1, passed: true }]);
    });

    it('records a RESULT that came before READY', async () => {
      const w = world();
      benching(w, {}, true);
      const { manifest } = await w.run({ plan: planOf(costShot()) });
      expect(manifest.results).toHaveLength(1);
    });

    it.each([
      ['a key the contract does not name', { taps: [[0.1, 0.2]] }, /c: the RESULT is not valid: taps is not a RESULT field/],
      ['a Date clock', { clock: 'Date.now' }, /c: the RESULT is not valid: clock must be "performance\.now"/],
    ])('refuses a RESULT with %s, and keeps none', async (_label, extra, why) => {
      const w = world();
      benching(w, extra);
      const manifest = await refusedRun(w, planOf(costShot()), why);
      expect(manifest.results).toEqual([]);
    });

    it('refuses a shot whose RESULT never comes', async () => {
      const w = world();
      readyAs(w, { shaderStatus: 'ready', shaderReason: null });
      await refusedRun(w, planOf(costShot()), /c: no RESULT for run .* within 1000 ms/);
    });
  });

  // The S22+ dry run: this build's screenrecord (v1.4) has no --output-format, so it writes only an mp4, and an mp4 is
  // written to a seekable file, never to stdout. So the harness records to the phone's /data/local/tmp, pulls the file,
  // and removes it; the storm report decodes the frames (a PNG directory, or the mp4 through an ffmpeg path it is given).
  describe('record: the phone\'s mp4 (F6)', () => {
    const RECORD = { kind: 'record', seconds: 5, size: { width: 360, height: 780 } };

    it('records an mp4 at the plan\'s reduced size on the phone, pulls it beside the PNGs, hashes it and removes it from the phone', async () => {
      const w = world();
      readyAs(w, { shaderStatus: 'ready', shaderReason: null });
      const { manifest } = await w.run({ plan: planOf(moving(RECORD)) });
      expect(w.device.recorded).toHaveLength(1);
      const [args] = w.device.recorded;
      expect(args.slice(0, 5)).toEqual(['screenrecord', '--size', '360x780', '--time-limit', '5']);
      expect(args[5]).toMatch(/^\/data\/local\/tmp\/kokonada-lab-m-1-[a-z0-9]+\.mp4$/);
      expect(args).not.toContain('--output-format=frames');
      const bytes = fs.readFileSync(path.join(w.outDir, 'm.mp4'));
      expect(bytes.equals(w.device.recording)).toBe(true);
      expect(manifest.records).toEqual([{ shot: 'm', file: 'm.mp4', format: 'mp4', bytes: w.device.recording.length, sha256: sha(bytes), seconds: 5, size: { width: 360, height: 780 } }]);
      expect(manifest.proofs).toEqual([{ shot: 'm', kind: 'record', seconds: 5, passed: true }]);
      expect(w.device.files.size).toBe(0);
      expect(w.device.commands).toContain(`rm -f ${args[5]}`);
    });

    it.each([
      ['an empty recording', Buffer.alloc(0), /m: screenrecord wrote no video/],
      ['a file that is not an mp4', Buffer.from('not a video at all, just text'), /m: the recording is not an mp4/],
    ])('refuses %s, and still removes the phone\'s file', async (_label, recording, why) => {
      const w = world();
      readyAs(w, { shaderStatus: 'ready', shaderReason: null });
      w.device.recording = recording;
      await refusedRun(w, planOf(moving(RECORD)), why);
      expect(w.device.files.size).toBe(0);
    });

    it('refuses a recording the phone never wrote: there is nothing to pull', async () => {
      const w = world();
      readyAs(w, { shaderStatus: 'ready', shaderReason: null });
      const shell = w.device.shell.bind(w.device);
      w.device.shell = async (args: string[]) => (args[0] === 'screenrecord' ? '' : shell(args));
      await refusedRun(w, planOf(moving(RECORD)), /m: .*does not exist/);
    });
  });
});

describe('notFlat (UI-215): a plan can assert the ground is not flat', () => {
  const NOT_FLAT = { notFlat: { probe: 'mark', minRange: 8 } };
  const smokeShot = { ...PLAN.shots[0], repeat: 1, checks: NOT_FLAT } as Shot;

  it('the gradient under the probe is not flat: it passes, and the check is recorded', async () => {
    const w = world();
    const { manifest } = await w.run({ plan: { ...PLAN, shots: [smokeShot] } });
    expect(manifest.checks).toEqual([{ shot: 'smoke-fixed', repeat: 1, kind: 'notFlat', probe: 'mark', minRange: 8, range: expect.any(Number), passed: true }]);
    expect(manifest.checks[0].range).toBeGreaterThanOrEqual(8);
  });

  it('a flat ground under the probe is refused, though the rest of the app region varies', async () => {
    const w = world();
    // flat inside the mark probe (10..30 x 30..50), a gradient elsewhere
    w.device.frames = [screen(1, (x, y) => (x >= 10 && x < 30 && y >= 30 && y < 50 ? [20, 20, 20, 255] : [x * 5, y * 3, 77, 255]))];
    const manifest = await refusedRun(w, { ...PLAN, shots: [smokeShot] }, /smoke-fixed\.1: the probe mark is flat ground: range 0, under the plan's 8 \(UI-215\)/);
    expect(manifest.rows).toEqual([]);
  });

  it('a range one under the minimum is refused, the minimum itself passes', async () => {
    for (const [spread, ok] of [[7, false], [8, true]] as const) {
      const w = world();
      w.device.frames = [screen(1, (x, y) => (x >= 10 && x < 30 && y >= 30 && y < 50 ? [20 + (x === 10 ? spread : 0), 20, 20, 255] : [x * 5, y * 3, 77, 255]))];
      if (ok) expect((await w.run({ plan: { ...PLAN, shots: [smokeShot] } })).manifest.checks[0]).toMatchObject({ range: 8, passed: true });
      else await refusedRun(w, { ...PLAN, shots: [smokeShot] }, /range 7, under the plan's 8/);
    }
  });

  it('a probe with no pixel in the app region cannot be judged, and is refused', async () => {
    const w = world();
    readyAs(w, { probes: { stage: { dp: { x: 0, y: 0, width: 40, height: 80 }, px: { x: 0, y: 0, width: 40, height: 80 } }, mark: { dp: { x: 0, y: 0, width: 40, height: 4 }, px: { x: 0, y: 0, width: 40, height: 4 } } } });
    await refusedRun(w, { ...PLAN, shots: [smokeShot] }, /smoke-fixed\.1: the probe mark has no pixel in the app region/);
  });
});

describe('validatePlan is strict (UI-215)', () => {
  const shot = PLAN.shots[0];
  const errs = (plan: unknown) => validatePlan(plan).join('\n');

  it.each([
    ['the plan', { ...PLAN, pixelCheck: true }, /pixelCheck is not a plan key/],
    ['the app', { ...PLAN, app: { ...PLAN.app, flavour: 'x' } }, /app\.flavour is not a plan key/],
    ['the session', { ...PLAN, session: { stayOn: true, brightness: 1 } }, /session\.brightness is not a plan key/],
    ['a shot', { ...PLAN, shots: [{ ...shot, notFlat: true }] }, /shots\[0\]\.notFlat is not a plan key/],
    ['a device', { ...PLAN, shots: [{ ...shot, device: { ...shot.device, brightness: 0.5 } }] }, /shots\[0\]\.device\.brightness is not a plan key/],
    ['an expect', { ...PLAN, shots: [{ ...shot, expect: { ...NO_SCENE, taps: 'x' } }] }, /shots\[0\]\.expect\.taps is not a plan key/],
    ['a proof', { ...PLAN, shots: [{ ...shot, proof: { kind: 'zero-frames', seconds: 10, band: { min: 1, max: 2 } } }] }, /shots\[0\]\.proof\.band is not a plan key/],
    ['the checks', { ...PLAN, shots: [{ ...shot, checks: { notFlat: { probe: 'mark', minRange: 8 }, contrast: 4.5 } }] }, /shots\[0\]\.checks\.contrast is not a plan key/],
    ['a notFlat check', { ...PLAN, shots: [{ ...shot, checks: { notFlat: { probe: 'mark', minRange: 8, region: 'x' } } }] }, /shots\[0\]\.checks\.notFlat\.region is not a plan key/],
    ['a rate band', { ...PLAN, shots: [{ ...shot, proof: { kind: 'rate', seconds: 10, band: { min: 1, max: 2, target: 1 } } }] }, /shots\[0\]\.proof\.band\.target is not a plan key/],
    ['a record size', { ...PLAN, shots: [{ ...shot, proof: { kind: 'record', seconds: 5, size: { width: 360, height: 780, bitRate: 1 } } }] }, /shots\[0\]\.proof\.size\.bitRate is not a plan key/],
  ])('refuses a key it does not read in %s', (_label, plan, why) => {
    expect(errs(plan)).toMatch(why);
  });

  it.each([
    ['a shot without expect', { ...PLAN, shots: [(() => { const s: Record<string, unknown> = { ...shot }; delete s.expect; return s; })()] }, /shots\[0\]\.expect must be/],
    ['an expect without its tier', { ...PLAN, shots: [{ ...shot, expect: { direction: null, face: null, hero: null } }] }, /shots\[0\]\.expect\.tier must be/],
    ['an expect tier that is not a tier', { ...PLAN, shots: [{ ...shot, expect: { ...NO_SCENE, tier: 'medium' } }] }, /shots\[0\]\.expect\.tier must be/],
    ['an expect face that is not a face', { ...PLAN, shots: [{ ...shot, expect: { ...NO_SCENE, face: 'dusk' } }] }, /shots\[0\]\.expect\.face must be/],
    ['an expect hero that is not a token', { ...PLAN, shots: [{ ...shot, expect: { ...NO_SCENE, hero: 'one joy' } }] }, /shots\[0\]\.expect\.hero must be/],
    ['an expect direction that is not a token', { ...PLAN, shots: [{ ...shot, expect: { ...NO_SCENE, direction: 3 } }] }, /shots\[0\]\.expect\.direction must be/],
    ['a notFlat on a probe the shot does not declare', { ...PLAN, shots: [{ ...shot, checks: { notFlat: { probe: 'plate', minRange: 8 } } }] }, /notFlat\.probe must be one of the shot's probes/],
    ['a notFlat minimum out of range', { ...PLAN, shots: [{ ...shot, checks: { notFlat: { probe: 'mark', minRange: 0 } } }] }, /notFlat\.minRange must be an integer from 1 to 255/],
    ['a rate band upside down', { ...PLAN, shots: [{ ...shot, proof: { kind: 'rate', seconds: 10, band: { min: 70, max: 50 } } }] }, /proof\.band must be { min, max } with 0 <= min <= max <= 1000/],
    ['a rate without its band', { ...PLAN, shots: [{ ...shot, proof: { kind: 'rate', seconds: 10 } }] }, /proof\.band must be/],
    ['a record over screenrecord\'s 180 s', { ...PLAN, shots: [{ ...shot, proof: { kind: 'record', seconds: 181, size: { width: 360, height: 780 } } }] }, /proof\.seconds must be an integer from 1 to 180/],
    ['a record without its size', { ...PLAN, shots: [{ ...shot, proof: { kind: 'record', seconds: 5 } }] }, /proof\.size must be/],
    ['a record size that is odd', { ...PLAN, shots: [{ ...shot, proof: { kind: 'record', seconds: 5, size: { width: 361, height: 780 } } }] }, /proof\.size must be/],
    ['a proof kind it does not know', { ...PLAN, shots: [{ ...shot, proof: { kind: 'contrast', seconds: 5 } }] }, /proof\.kind must be one of zero-frames, draws-frames, rate, framestats, result, record/],
  ])('refuses %s', (_label, plan, why) => {
    expect(errs(plan)).toMatch(why);
  });

  it('takes each new proof and the notFlat check in their documented shape', () => {
    for (const proof of [
      { kind: 'rate', seconds: 10, band: { min: 55, max: 62 } }, { kind: 'framestats', seconds: 10 }, { kind: 'result', seconds: 30 },
      { kind: 'record', seconds: 5, size: { width: 360, height: 780 } },
    ]) expect(validatePlan({ ...PLAN, shots: [{ ...shot, proof }] })).toEqual([]);
    expect(validatePlan({ ...PLAN, shots: [{ ...shot, checks: { notFlat: { probe: 'mark', minRange: 8 } } }] })).toEqual([]);
  });
});

describe('renderFacts: the render scale and sampling an expect tier implies', () => {
  it('reads the tiers from the tokens, the still at the full tier\'s scale, and nothing for a scene with no tier', () => {
    expect(renderFacts('full', TIERS)).toEqual({ renderScale: TIERS.full.renderScale.$value, sampling: { filter: 'linear', mipmap: 'none' } });
    expect(renderFacts('low', TIERS)).toEqual({ renderScale: TIERS.low.renderScale.$value, sampling: { filter: 'linear', mipmap: 'none' } });
    expect(renderFacts('still', TIERS)).toEqual({ renderScale: TIERS.full.renderScale.$value, sampling: { filter: 'linear', mipmap: 'none' } });
    expect(renderFacts(null, TIERS)).toEqual({ renderScale: null, sampling: null });
  });
});

// The session's emulator dry run of v1-field (the B8 plan's "done" for B8-5b) runs this same path on a real phone. Here
// the shipped plan runs end to end on the stateful fake: every shot launched, waited for, grabbed twice, judged after its
// marker, its row valid with its catalogue facts, both proofs held, and the phone restored.
describe('the shipped v1-field plan, end to end on the fake phone', () => {
  it('passes every shot with a valid row, and restores the phone', async () => {
    const plan = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../capture-plans/v1-field.json'), 'utf8'));
    const w = world();
    w.device.scenario = (extras, d) => d.emit(readyLine(extras.run, extras, d, {
      shaderStatus: extras.scene.startsWith('fallback.') ? 'fallback-scene' : 'ready', shaderReason: null,
    }));
    const shell = w.device.shell.bind(w.device);
    let moving = false;
    w.device.shell = async (args: string[]) => {
      const line = args.join(' ');
      if (line.startsWith('am start')) moving = line.includes('--es run dark-three-full-moving-control-');
      const out = await shell(args);
      if (line.endsWith('gfxinfo com.kokonadahealth.lab reset') && moving) w.device.gfxFrames = 1200;
      return out;
    };
    const { manifest } = await w.run({ plan: { ...plan, readyTimeoutMs: 200, settleMs: 0 } });
    expect(manifest.outcome).toBe('passed');
    const launches = plan.shots.reduce((n: number, s: { repeat: number }) => n + s.repeat, 0);
    expect(manifest.rows).toHaveLength(launches);
    for (const row of manifest.rows) {
      expect(validateRow(row)).toEqual([]);
      const shot = plan.shots.find((s: { id: string }) => s.id === row.shot);
      expect(row.expect).toEqual(shot.expect);
    }
    expect(manifest.proofs.map((p: { kind: string; passed: boolean }) => [p.kind, p.passed])).toEqual([['draws-frames', true], ['zero-frames', true]]);
    expect(manifest.determinism.every((d: { equal: boolean }) => d.equal)).toBe(true);
    expect(w.device.state()).toEqual(w.before);
  });
});

// B8-6: a policy scene's tier comes from the device's motion policy, and READY says the tier it observed; a shot's
// expect.tier is the tier its device state implies. A READY whose tier differs means the policy did not give that tier:
// the shot is refused. A scene whose id names its tier is held the same way when READY names a tier; a READY with no
// tier (a scene that draws no policy field) is held only on a policy scene.
describe('B8-6: READY\'s observed tier against the shot\'s expect.tier', () => {
  const policyShot = (tier: string, device: Record<string, unknown>) => fieldShot('p', 'field.abyss.dark.three.policy', {
    expect: { ...FIELD_EXPECT, tier }, device: { fontScale: 1, night: 'yes', animatorScale: 1, powerSave: false, ...device },
  });

  it('a policy shot whose READY tier is the one its device state implies passes, and its row records the tier', async () => {
    const w = world();
    readyAs(w, { shaderStatus: 'ready', shaderReason: null, tier: 'still' });
    const { manifest } = await w.run({ plan: planOf(policyShot('still', { animatorScale: 0 })) });
    expect(manifest.outcome).toBe('passed');
    expect(manifest.rows[0].motion).toMatchObject({ tier: 'still', reduceMotionObserved: true });
    expect(manifest.rows[0].expect.tier).toBe('still');
  });

  it.each([
    ['another tier', 'low', /p: READY says tier "low" but the shot's expect\.tier is "still" \(the motion policy did not give the tier the device state implies\)/],
    ['no tier at all', undefined, /p: READY says tier null but the shot's expect\.tier is "still"/],
  ])('a policy shot whose READY names %s is refused, and no row is written', async (_label, tier, why) => {
    const w = world();
    readyAs(w, { shaderStatus: 'ready', shaderReason: null, ...(tier === undefined ? {} : { tier }) });
    const manifest = await refusedRun(w, planOf(policyShot('still', { animatorScale: 0 })), why);
    expect(manifest.rows).toEqual([]);
  });

  it('an id-tier field shot whose READY tier equals its expect passes; one READY contradicts is refused', async () => {
    const ok = world();
    readyAs(ok, { shaderStatus: 'ready', shaderReason: null, tier: 'full' });
    expect((await ok.run({ plan: planOf(fieldShot('f', 'field.abyss.dark.three.full')) })).manifest.outcome).toBe('passed');
    const bad = world();
    readyAs(bad, { shaderStatus: 'ready', shaderReason: null, tier: 'low' });
    await refusedRun(bad, planOf(fieldShot('f', 'field.abyss.dark.three.full')), /f: READY says tier "low" but the shot's expect\.tier is "full"/);
  });

  it('a READY with no tier is held only on a policy scene', () => {
    expect(tierProblem('field.abyss.dark.three.full', {}, 'full')).toBeNull();
    expect(tierProblem('smoke', {}, null)).toBeNull();
    expect(tierProblem('smoke', { tier: null }, null)).toBeNull();
    expect(tierProblem('field.abyss.dark.three.policy', {}, 'full')).toMatch(/READY says tier null/);
    expect(tierProblem('field.abyss.dark.three.policy', { tier: 'full' }, 'full')).toBeNull();
    expect(tierProblem('smoke', { tier: 'full' }, null)).toMatch(/READY says tier "full" but the shot's expect\.tier is null/);
  });

  it('reduced motion reaches React Native through transition_animation_scale: animatorScale 0 sets it, and battery saver through low_power', async () => {
    const w = world();
    readyAs(w, { shaderStatus: 'ready', shaderReason: null, tier: 'still', powerSave: true });
    await w.run({ plan: planOf(policyShot('still', { animatorScale: 0, powerSave: true })) });
    expect(w.device.commands).toContain('settings put global transition_animation_scale 0');
    expect(w.device.commands).toContain('settings put global low_power 1');
  });
});
