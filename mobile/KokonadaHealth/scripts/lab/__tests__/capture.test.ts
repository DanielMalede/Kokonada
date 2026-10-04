/// <reference types="node" />
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { capture, checkBuild, Refused, validatePlan } from '../capture.mjs';
import { decodePng } from '../lib/png.mjs';
import { validateRow } from '../lib/manifest.mjs';
import { makeStamp } from '../lib/stamp.mjs';
import { FakeDevice, rawFrame, SCREEN, STATUS_BAR } from '../__fixtures__/fakeDevice';
import { zip } from '../__fixtures__/zipWriter';

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
      device: { fontScale: 1, night: 'yes', animatorScale: 1, powerSave: false }, probes: ['stage', 'mark'] },
    { id: 'smoke-still', repeat: 1, scene: 'smoke', args: { clock: 'realtime' },
      device: { fontScale: 1, night: 'yes', animatorScale: 0, powerSave: false }, probes: ['stage', 'mark'],
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
    sentinel: SENTINEL, ...override,
  })}`;
}

function world({ head = SHA, porcelain = '', installed = 'same' as 'same' | 'other' | 'none' } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-'));
  const repoRoot = path.join(tmp, 'repo');
  const appRoot = path.join(repoRoot, 'mobile', 'app');
  fs.mkdirSync(path.join(appRoot, 'src/design/lab'), { recursive: true });
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

  const device = new FakeDevice();
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
    expect(JSON.parse(fs.readFileSync(path.join(w.outDir, 'manifest.json'), 'utf8')).outcome).toBe('passed');
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

  it('validatePlan names what is wrong', () => {
    expect(validatePlan({ ...PLAN, readyTimeoutMs: 5 }).join()).toMatch(/readyTimeoutMs/);
    expect(validatePlan({ ...PLAN, shots: [{ ...PLAN.shots[0], args: { clock: 'fixed; reboot' } }] }).join()).toMatch(/args\.clock/);
    expect(validatePlan({ ...PLAN, shots: [PLAN.shots[0], PLAN.shots[0]] }).join()).toMatch(/twice/);
    expect(validatePlan({ ...PLAN, shots: [{ ...PLAN.shots[0], device: { ...PLAN.shots[0].device, night: 'auto' } }] }).join()).toMatch(/night/);
  });
});
