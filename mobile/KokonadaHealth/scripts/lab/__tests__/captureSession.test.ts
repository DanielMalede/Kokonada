/// <reference types="node" />
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { captureSession, isSessionPlan, loadSession, Refused, restoreFolder, sessionOutcome, validatePlan } from '../capture.mjs';
import { makeStamp } from '../lib/stamp.mjs';
import { FakeDevice, rawFrame, STATUS_BAR } from '../__fixtures__/fakeDevice';
import { zip } from '../__fixtures__/zipWriter';

// B8-10 (the architect's B8 plan, "The device session's order"): the evidence session is one run of the harness over a
// session plan, capture-plans/v1.json, that lists the part plans in the order they run. Each part is a plan of its own,
// checked by validatePlan as strictly as when it runs alone, all of them before the phone is touched; each part writes
// its own folder and manifest (so every report reads the manifest of the plan it was written for). The session stops
// for the owner where a part names a pause, and a second run of the same command skips every part already captured
// at this build, so a pause, a refusal or a dropped USB connection never costs a finished part.

const PLANS_DIR = path.resolve(__dirname, '../capture-plans');
const SHA = 'c'.repeat(40);
const OTHER_SHA = 'd'.repeat(40);
const SENTINEL = 'kokonada-design-lab-sentinel-testfixture1';
const HBC = Buffer.concat([Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f]), Buffer.from(`...${SENTINEL}...`)]);
const TOKENS = fs.readFileSync(path.resolve(__dirname, '../../../../../design-tokens/base.tokens.json'), 'utf8');
const SKIA_LOCK = JSON.stringify({ name: 'app', lockfileVersion: 3, packages: { '': {}, 'node_modules/@shopify/react-native-skia': { version: '2.6.9' } } });
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const APP = { package: 'com.kokonadahealth.lab', activity: 'com.kokonadahealth.lab.DesignLabActivity' };
const NO_SCENE = { direction: null, face: null, hero: null, tier: null };

// RA-53: during a pause, an edit in this checkout refuses the resume, and a commit forces a rebuild and a full re-capture.
const KEEP_STILL = 'write nothing in this checkout until the session passes: a change or a commit here captures every part again; record notes in another worktree';

// ---- v1.json, the session the owner runs ------------------------------------------------------------------------------

describe('capture-plans/v1.json, the evidence session', () => {
  const session = JSON.parse(fs.readFileSync(path.join(PLANS_DIR, 'v1.json'), 'utf8'));
  const loaded = loadSession(session, PLANS_DIR);

  it('is a session plan, valid, every part valid by validatePlan', () => {
    expect(isSessionPlan(session)).toBe(true);
    expect(loaded.errors).toEqual([]);
    for (const part of loaded.parts) expect([part.file, validatePlan(part.plan)]).toEqual([part.file, []]);
  });

  it('runs the parts in the plan\'s order: smoke, the grain swatch, field (with fallback), near, witness, policy, cost, storm', () => {
    expect(loaded.parts.map((p: { file: string }) => p.file)).toEqual([
      'smoke.json', 'v1-grain.json', 'v1-field.json', 'v1-near.json', 'v1-witness.json', 'v1-policy.json', 'v1-cost.json', 'v1-storm.json',
    ]);
  });

  it('names every part plan in capture-plans/, so a new part cannot be left out of the session', () => {
    const plans = fs.readdirSync(PLANS_DIR).filter((f) => f.endsWith('.json') && !isSessionPlan(JSON.parse(fs.readFileSync(path.join(PLANS_DIR, f), 'utf8'))));
    expect(loaded.parts.map((p: { file: string }) => p.file).sort()).toEqual(plans.sort());
  });

  it('pauses for the owner after the grain swatch (UI-092) and after the field (the light face, UI-244), nowhere else', () => {
    const pauses = loaded.parts.filter((p: { pause: string | null }) => p.pause !== null).map((p: { file: string; pause: string }) => [p.file, p.pause]);
    expect(pauses.map(([f]: string[]) => f)).toEqual(['v1-grain.json', 'v1-field.json']);
    expect(pauses[0][1]).toContain('UI-092');
    expect(pauses[1][1]).toContain('UI-244');
  });

  it('RA-53: every pause tells the owner to write nothing in this checkout until the session passes', () => {
    for (const p of loaded.parts.filter((x: { pause: string | null }) => x.pause !== null)) expect([p.file, p.pause.includes(KEEP_STILL)]).toEqual([p.file, true]);
  });
});

// ---- the session's own checks, before the phone is touched ------------------------------------------------------------

function shot(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, repeat: 1, scene: 'smoke', args: { clock: 'fixed', t: '1500', frames: '3' },
    device: { fontScale: 1, night: 'yes', animatorScale: 1, powerSave: false }, probes: ['stage', 'mark'], expect: NO_SCENE, ...extra,
  };
}
const part = (id: string, shots = [shot(`${id}-a`)], app = APP) => ({ id, app, readyTimeoutMs: 400, settleMs: 0, session: { stayOn: true }, shots });

function planDir(files: Record<string, unknown>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-plans-'));
  for (const [name, doc] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), typeof doc === 'string' ? doc : JSON.stringify(doc));
  return dir;
}

describe('loadSession: a strict session plan over strict part plans', () => {
  const dir = planDir({ 'a.json': part('a'), 'b.json': part('b') });
  const errors = (session: unknown, d = dir) => loadSession(session, d).errors;

  it('a valid session loads its parts in order, each with its pause or null', () => {
    const r = loadSession({ id: 's', parts: [{ plan: 'a.json', pause: 'look at it' }, { plan: 'b.json' }] }, dir);
    expect(r.errors).toEqual([]);
    expect(r.parts.map((p: { file: string; plan: { id: string }; pause: string | null }) => [p.file, p.plan.id, p.pause])).toEqual([['a.json', 'a', 'look at it'], ['b.json', 'b', null]]);
  });

  it('a key the session does not read is an error, at the top and in a part (UI-215)', () => {
    expect(errors({ id: 's', parts: [{ plan: 'a.json' }], repeat: 2 })).toEqual(['repeat is not a session key']);
    expect(errors({ id: 's', parts: [{ plan: 'a.json', skip: true }] })).toEqual(['parts[0].skip is not a session key']);
  });

  it('the id, the list and the part file names are checked; a part plan is a file beside the session, never a path', () => {
    expect(errors({ id: 'S P', parts: [{ plan: 'a.json' }] })).toEqual(['id must be a short lowercase token']);
    expect(errors({ id: 's', parts: [] })).toEqual(['parts must be a non-empty list']);
    expect(errors({ id: 's', parts: [{ plan: '../a.json' }] })).toEqual(['parts[0].plan must be a plan file beside the session (a lowercase name ending .json)']);
    expect(errors({ id: 's', parts: [{ plan: 'sub/a.json' }] })).toEqual(['parts[0].plan must be a plan file beside the session (a lowercase name ending .json)']);
    expect(errors({ id: 's', parts: [{ plan: 'a.json' }, { plan: 'a.json' }] })).toEqual(['parts[1].plan a.json is listed twice']);
  });

  it('a pause is one line of text', () => {
    expect(errors({ id: 's', parts: [{ plan: 'a.json', pause: '' }] })).toEqual(['parts[0].pause must be one line of text, 1 to 600 characters']);
    expect(errors({ id: 's', parts: [{ plan: 'a.json', pause: 'two\nlines' }] })).toEqual(['parts[0].pause must be one line of text, 1 to 600 characters']);
    expect(errors({ id: 's', parts: [{ plan: 'a.json', pause: 3 }] })).toEqual(['parts[0].pause must be one line of text, 1 to 600 characters']);
  });

  it('a part that is missing, not JSON, itself a session, or an invalid plan is named with its own errors', () => {
    const d = planDir({
      'a.json': part('a'), 'bad.json': '{ not json', 'nested.json': { id: 'n', parts: [{ plan: 'a.json' }] },
      'broken.json': { ...part('broken'), settleMs: -1, shots: [shot('x', { extra: 1 })] },
    });
    expect(errors({ id: 's', parts: [{ plan: 'gone.json' }] }, d)).toEqual(['parts[0] gone.json cannot be read']);
    expect(errors({ id: 's', parts: [{ plan: 'bad.json' }] }, d)).toEqual(['parts[0] bad.json is not JSON']);
    expect(errors({ id: 's', parts: [{ plan: 'nested.json' }] }, d)).toEqual(['parts[0] nested.json is a session plan: a session lists plans of shots only']);
    expect(errors({ id: 's', parts: [{ plan: 'broken.json' }] }, d)).toEqual([
      'parts[0] broken.json: settleMs must be an integer from 0 to 10000',
      'parts[0] broken.json: shots[0].extra is not a plan key',
    ]);
  });

  it('two parts with one id would share a folder; two apps would need two installs: both refused', () => {
    const d = planDir({ 'a.json': part('a'), 'a2.json': part('a'), 'c.json': part('c', undefined, { ...APP, package: 'com.other.lab' }) });
    expect(errors({ id: 's', parts: [{ plan: 'a.json' }, { plan: 'a2.json' }] }, d)).toEqual(['parts[1] a2.json: the plan id a is used by another part (each part has its own folder)']);
    expect(errors({ id: 's', parts: [{ plan: 'a.json' }, { plan: 'c.json' }] }, d)).toEqual(['parts[1] c.json: app must be the first part\'s (one lab APK serves the session)']);
  });

  it('isSessionPlan: a plan with parts is a session; a plan of shots is not', () => {
    expect(isSessionPlan({ id: 's', parts: [] })).toBe(true);
    expect(isSessionPlan(part('a'))).toBe(false);
    expect(isSessionPlan(null)).toBe(false);
  });
});

// ---- the session on the stateful fake phone -------------------------------------------------------------------------

const SURFACE_FLINGER = ['Device has wide color built-in display: 1', '    Current color mode: ColorMode::SRGB (7)', 'GLES: Qualcomm, Adreno (TM) 730, OpenGL ES 3.2 V@0615.65'].join('\n');
class Phone extends FakeDevice {
  async shell(args: string[]): Promise<string> {
    const line = args.join(' ');
    if (line === 'dumpsys SurfaceFlinger') { this.onCommand(line); this.commands.push(line); return SURFACE_FLINGER; }
    if (args[0] === 'log' && args[1] === '-t' && args[2] === 'ReactNativeJS') {
      this.onCommand(line);
      this.commands.push(line);
      if (this.failOn && this.failOn.test(line)) throw new Error(`adb shell ${line} failed (exit 1): fake failure`);
      setTimeout(() => this.emit(args.slice(3).join(' ')), 2);
      return '';
    }
    return super.shell(args);
  }
}

function readyLine(extras: Record<string, string>, d: FakeDevice) {
  return `I ReactNativeJS: KOKONADA_LAB READY ${JSON.stringify({
    run: extras.run, seq: 0, scene: extras.scene, clock: extras.clock, t: extras.clock === 'fixed' ? Number(extras.t) : null,
    // PixelRatio.get() on the fake phone: Android's density for its 450 dpi (UI-240).
    powerSave: d.settings.get('global/low_power') === '1', pixelRatio: 2.8125,
    probes: { stage: { dp: { x: 0, y: 0, width: 40, height: 80 }, px: { x: 0, y: 0, width: 40, height: 80 } }, mark: { dp: { x: 10, y: 30, width: 20, height: 20 }, px: { x: 10, y: 30, width: 20, height: 20 } } },
    isRTL: true, fontScale: Number(d.settings.get('system/font_scale')), sentinel: SENTINEL,
  })}`;
}

function world() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'session-'));
  const repoRoot = path.join(tmp, 'repo');
  const appRoot = path.join(repoRoot, 'mobile', 'app');
  fs.mkdirSync(path.join(appRoot, 'src/design/lab'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, 'design-tokens'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'design-tokens/base.tokens.json'), TOKENS);
  fs.writeFileSync(path.join(appRoot, 'package-lock.json'), SKIA_LOCK);
  fs.writeFileSync(path.join(appRoot, 'src/design/lab/sentinel.ts'), `export const LAB_SENTINEL = '${SENTINEL}';\n`);
  const assets = path.join(appRoot, 'android/app/src/lab/assets');
  fs.mkdirSync(assets, { recursive: true });
  const build = (commit: string) => {
    const stamp = makeStamp({ commit, porcelain: '', bundleSha256: sha(HBC), tokens: {}, entry: 'index.lab.js', createdAt: '2026-11-17T10:00:00.000Z' });
    fs.writeFileSync(path.join(assets, 'index.android.bundle'), HBC);
    fs.writeFileSync(path.join(assets, 'lab-stamp.json'), JSON.stringify(stamp, null, 2));
    const apk = zip([
      { name: 'AndroidManifest.xml', data: Buffer.from('binary xml') },
      { name: 'assets/index.android.bundle', data: HBC, deflate: true },
      { name: 'assets/lab-stamp.json', data: Buffer.from(JSON.stringify(stamp, null, 2)) },
    ]);
    fs.writeFileSync(path.join(tmp, 'app-lab.apk'), apk);
    return apk;
  };
  const device = new Phone();
  const state = { head: SHA };
  device.installedApk = build(SHA);
  let tick = 0;
  device.frames = [() => { tick += 1; return rawFrame((x, y) => (y < STATUS_BAR ? [tick % 256, 0, 0, 255] : [x * 5, y * 3, 77, 255])); }];
  device.scenario = (extras, d) => d.emit(readyLine(extras, d));
  const outDir = path.join(tmp, 'evidence');
  const plans = planDir({ 'one.json': part('one'), 'two.json': part('two'), 'three.json': part('three') });
  const run = (session: unknown = { id: 's', parts: [{ plan: 'one.json' }, { plan: 'two.json' }, { plan: 'three.json' }] }) => captureSession({
    session, planDir: plans, appRoot, repoRoot, outDir, apkPath: path.join(tmp, 'app-lab.apk'), adb: device,
    git: { head: () => state.head, porcelain: () => '' }, sleep: async () => {}, log: () => {},
  });
  /** A new commit's build, installed: what a token change after the grain verdict is. */
  const rebuild = (commit: string) => { state.head = commit; device.installedApk = build(commit); };
  const launches = () => device.commands.filter((c) => c.startsWith('am start')).map((c) => /--es run (\S+?)-\d/.exec(c)?.[1] ?? c);
  const readSession = () => JSON.parse(fs.readFileSync(path.join(outDir, 'session.json'), 'utf8'));
  return { tmp, repoRoot, outDir, device, run, rebuild, launches, readSession, plans };
}

describe('captureSession on the stateful fake phone', () => {
  it('runs every part in order, each into its own folder with its own passed manifest, and writes session.json', async () => {
    const w = world();
    const before = w.device.state();
    const r = await w.run();
    expect(r.status).toBe('passed');
    expect(w.launches()).toEqual(['one-a', 'two-a', 'three-a']);
    for (const id of ['one', 'two', 'three']) {
      const m = JSON.parse(fs.readFileSync(path.join(w.outDir, id, 'manifest.json'), 'utf8'));
      expect([id, m.plan, m.outcome, m.commit]).toEqual([id, id, 'passed', SHA]);
    }
    const s = w.readSession();
    expect({ session: s.session, status: s.status, commit: s.commit, pause: s.pause, failure: s.failure }).toEqual({ session: 's', status: 'passed', commit: SHA, pause: null, failure: null });
    expect(s.parts.map((p: { id: string; state: string; manifest: string }) => [p.id, p.state, p.manifest])).toEqual([
      ['one', 'captured', path.join('one', 'manifest.json')], ['two', 'captured', path.join('two', 'manifest.json')], ['three', 'captured', path.join('three', 'manifest.json')],
    ]);
    expect(w.device.state()).toEqual(before);
  });

  it('stops after a part that names a pause, with the later parts not run; the same command again resumes after it', async () => {
    const w = world();
    const session = { id: 's', parts: [{ plan: 'one.json' }, { plan: 'two.json', pause: 'judge it' }, { plan: 'three.json' }] };
    const first = await w.run(session);
    expect([first.status, first.pause]).toEqual(['paused', 'judge it']);
    expect(w.launches()).toEqual(['one-a', 'two-a']);
    expect(w.readSession().parts.map((p: { state: string }) => p.state)).toEqual(['captured', 'captured', 'not run']);
    expect(w.readSession().status).toBe('paused');
    const second = await w.run(session);
    expect([second.status, second.pause]).toEqual(['passed', null]);
    expect(w.launches()).toEqual(['one-a', 'two-a', 'three-a']);
    expect(w.readSession().parts.map((p: { state: string }) => p.state)).toEqual(['captured earlier', 'captured earlier', 'captured']);
  });

  it('a failed part stops the session; the next run keeps the parts before it, moves the failed folder aside and captures it again', async () => {
    const w = world();
    let failTwo = true;
    w.device.scenario = (extras, d) => {
      if (failTwo && extras.scene === 'smoke' && extras.run.startsWith('two-a')) d.emit(`I ReactNativeJS: KOKONADA_LAB ERROR ${JSON.stringify({ run: extras.run, errors: ['boom'] })}`);
      else d.emit(readyLine(extras, d));
    };
    await expect(w.run()).rejects.toThrow(/two-a/);
    expect(w.launches()).toEqual(['one-a', 'two-a']);
    const failed = w.readSession();
    expect([failed.status, failed.parts.map((p: { state: string }) => p.state)]).toEqual(['failed', ['captured', 'failed', 'not run']]);
    expect(failed.failure).toMatch(/two-a/);
    failTwo = false;
    const r = await w.run();
    expect(r.status).toBe('passed');
    expect(w.launches()).toEqual(['one-a', 'two-a', 'two-a', 'three-a']);
    expect(JSON.parse(fs.readFileSync(path.join(w.outDir, 'two.old-1', 'manifest.json'), 'utf8')).outcome).toBe('failed');
    expect(JSON.parse(fs.readFileSync(path.join(w.outDir, 'two', 'manifest.json'), 'utf8')).outcome).toBe('passed');
  });

  it('a new build (another commit and APK) re-captures every part: evidence at an older build is moved aside, never mixed in', async () => {
    const w = world();
    await w.run();
    w.rebuild(OTHER_SHA);
    const r = await w.run();
    expect(r.status).toBe('passed');
    expect(w.launches()).toEqual(['one-a', 'two-a', 'three-a', 'one-a', 'two-a', 'three-a']);
    for (const id of ['one', 'two', 'three']) {
      expect(JSON.parse(fs.readFileSync(path.join(w.outDir, id, 'manifest.json'), 'utf8')).commit).toBe(OTHER_SHA);
      expect(JSON.parse(fs.readFileSync(path.join(w.outDir, `${id}.old-1`, 'manifest.json'), 'utf8')).commit).toBe(SHA);
    }
  });

  it('a dropped connection: the part fails, the phone is left changed; the next run puts the phone back from that part\'s saved state first', async () => {
    const w = world();
    const before = w.device.state();
    // The cable is pulled during part two's shot: every command from then on fails, the restore included.
    w.device.scenario = (extras, d) => {
      if (extras.run.startsWith('two-a')) { d.failOn = /./; return; }
      d.emit(readyLine(extras, d));
    };
    await expect(w.run()).rejects.toThrow(/not fully restored/);
    expect(w.device.state()).not.toEqual(before);
    // Plugged back in.
    w.device.failOn = null;
    w.device.scenario = (extras, d) => d.emit(readyLine(extras, d));
    const order: string[] = [];
    w.device.onCommand = (line) => { if (/^(settings put|settings delete|cmd uimode night \w|am start)/.test(line)) order.push(line.startsWith('am start') ? 'launch' : 'restore-or-apply'); };
    const r = await w.run();
    expect(r.status).toBe('passed');
    expect(order.indexOf('restore-or-apply')).toBeLessThan(order.indexOf('launch'));
    expect(w.device.state()).toEqual(before);
    expect(w.launches().slice(-2)).toEqual(['two-a', 'three-a']);
    expect(w.readSession().parts.map((p: { state: string }) => p.state)).toEqual(['captured earlier', 'captured', 'captured']);
  });

  it('a process killed mid-part (its saved state on disk, no manifest): the next run restores the phone from it before anything else', async () => {
    const w = world();
    await w.run({ id: 's', parts: [{ plan: 'one.json' }] });
    const dir = path.join(w.outDir, 'two');
    fs.mkdirSync(dir);
    const snapshot = { settings: { 'system/font_scale': '0.8', 'global/window_animation_scale': '1.0', 'global/transition_animation_scale': '1.0', 'global/animator_duration_scale': '1.0', 'global/low_power': '0', 'global/stay_on_while_plugged_in': null }, night: 'yes' };
    fs.writeFileSync(path.join(dir, 'device-original-state.json'), JSON.stringify({ takenAt: 'x', snapshot }));
    w.device.settings.set('system/font_scale', '1.3');
    w.device.night = 'no';
    const firstFontPut: string[] = [];
    w.device.onCommand = (line) => { if (line.startsWith('settings put system font_scale') && firstFontPut.length === 0) firstFontPut.push(line); };
    await w.run();
    expect(firstFontPut).toEqual(['settings put system font_scale 0.8']);
    expect(w.device.settings.get('system/font_scale')).toBe('0.8');
    expect(w.device.night).toBe('yes');
    expect(fs.existsSync(path.join(w.outDir, 'two.old-1', 'device-original-state.json'))).toBe(true);
  });

  it('refuses before the phone is touched: an invalid part, an output folder inside the repository, another session\'s folder', async () => {
    const w = world();
    const bad = planDir({ 'one.json': { ...part('one'), settleMs: -1 } });
    await expect(captureSession({
      session: { id: 's', parts: [{ plan: 'one.json' }] }, planDir: bad, appRoot: path.join(w.repoRoot, 'mobile', 'app'), repoRoot: w.repoRoot, outDir: w.outDir,
      apkPath: path.join(w.tmp, 'app-lab.apk'), adb: w.device, git: { head: () => SHA, porcelain: () => '' }, sleep: async () => {}, log: () => {},
    })).rejects.toThrow(Refused);
    await expect(captureSession({
      session: { id: 's', parts: [{ plan: 'one.json' }] }, planDir: w.plans, appRoot: path.join(w.repoRoot, 'mobile', 'app'), repoRoot: w.repoRoot, outDir: path.join(w.repoRoot, 'evidence'),
      apkPath: path.join(w.tmp, 'app-lab.apk'), adb: w.device, git: { head: () => SHA, porcelain: () => '' }, sleep: async () => {}, log: () => {},
    })).rejects.toThrow(/inside the repository/);
    expect(w.device.commands).toEqual([]);
    await w.run({ id: 's', parts: [{ plan: 'one.json' }] });
    const n = w.device.commands.length;
    await expect(w.run({ id: 'other', parts: [{ plan: 'one.json' }] })).rejects.toThrow(/session s, not other/);
    expect(w.device.commands.length).toBe(n);
  });
});

// ---- the CLI: --plan takes a session plan too ------------------------------------------------------------------------

describe('the CLI with a session plan', () => {
  it('an invalid session is refused (exit 2) before any phone is looked for, naming the part and its error', () => {
    const dir = planDir({ 'one.json': { ...part('one'), settleMs: -1 }, 's.json': { id: 's', parts: [{ plan: 'one.json' }] } });
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'session-cli-')), 'evidence');
    const r = spawnSync(process.execPath, [path.resolve(__dirname, '../capture.mjs'), '--plan', path.join(dir, 's.json'), '--out', out, '--serial', 'no-such-phone'], { encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('the session plan is not valid');
    expect(r.stderr).toContain('parts[0] one.json: settleMs must be an integer from 0 to 10000');
    expect(fs.existsSync(out)).toBe(false);
  });

  it('the outcome: passed is exit 0 with each part\'s manifest; paused is exit 3 with the pause and how to resume', () => {
    const E = path.join(os.tmpdir(), 'E');
    const parts = [{ id: 'one', state: 'captured earlier', manifest: path.join('one', 'manifest.json') }, { id: 'two', state: 'captured', manifest: path.join('two', 'manifest.json') }];
    const passed = sessionOutcome({ status: 'passed', pause: null, sessionPath: path.join(E, 'session.json'), parts }, E);
    expect(passed.code).toBe(0);
    expect(passed.message).toBe([
      `passed: ${path.join(E, 'session.json')}`,
      `  one (captured earlier): ${path.join(E, 'one', 'manifest.json')}`,
      `  two (captured): ${path.join(E, 'two', 'manifest.json')}`,
    ].join('\n'));
    const paused = sessionOutcome({ status: 'paused', pause: 'judge it', sessionPath: path.join(E, 'session.json'), parts: [parts[1], { id: 'three', state: 'not run', manifest: null }] }, E);
    expect(paused.code).toBe(3);
    expect(paused.message).toBe([
      'paused after two: judge it',
      'the parts captured so far are kept: run the same command again to go on from three',
      KEEP_STILL,
    ].join('\n'));
  });
});

// RA-54: --restore with a session folder: a session keeps each part's saved state in <out>/<part>/, so the phone is put
// back from the part that has a saved state but no passed manifest (or one whose restore failed).
describe("restoreFolder (the CLI's --restore)", () => {
  const SNAPSHOT = { settings: { 'system/font_scale': '0.8', 'global/window_animation_scale': '1.0', 'global/transition_animation_scale': '1.0', 'global/animator_duration_scale': '1.0', 'global/low_power': '0', 'global/stay_on_while_plugged_in': null }, night: 'yes' };

  it("--restore given a session folder restores the killed part's saved state", async () => {
    const w = world();
    await w.run({ id: 's', parts: [{ plan: 'one.json' }] });
    const before = w.device.state();
    fs.mkdirSync(path.join(w.outDir, 'two'));
    fs.writeFileSync(path.join(w.outDir, 'two', 'device-original-state.json'), JSON.stringify({ takenAt: 'x', snapshot: SNAPSHOT }));
    w.device.settings.set('system/font_scale', '1.3');
    w.device.night = 'no';
    const r = await restoreFolder({ outDir: w.outDir, adb: w.device });
    expect(r).toEqual({ from: path.join(w.outDir, 'two', 'device-original-state.json'), failures: [] });
    expect(w.device.state()).toEqual(before);
  });

  it('a part whose restore failed is restored again; a passed part is not', async () => {
    const w = world();
    await w.run({ id: 's', parts: [{ plan: 'one.json' }, { plan: 'two.json' }] });
    const manifest = path.join(w.outDir, 'two', 'manifest.json');
    fs.writeFileSync(manifest, JSON.stringify({ ...JSON.parse(fs.readFileSync(manifest, 'utf8')), outcome: 'failed', restoreFailures: ['restore x: boom'] }));
    expect((await restoreFolder({ outDir: w.outDir, adb: w.device })).from).toBe(path.join(w.outDir, 'two', 'device-original-state.json'));
  });

  it('a session folder with no part that left the phone changed is refused, naming the folder', async () => {
    const w = world();
    await w.run({ id: 's', parts: [{ plan: 'one.json' }] });
    await expect(restoreFolder({ outDir: w.outDir, adb: w.device })).rejects.toThrow(/no part of the session .* left a saved state without a passed manifest/);
    await expect(restoreFolder({ outDir: w.outDir, adb: w.device })).rejects.toBeInstanceOf(Refused);
  });

  it("a single run's folder still restores from its own saved state", async () => {
    const w = world();
    const out = path.join(w.tmp, 'single');
    fs.mkdirSync(out);
    fs.writeFileSync(path.join(out, 'device-original-state.json'), JSON.stringify({ takenAt: 'x', snapshot: SNAPSHOT }));
    w.device.night = 'no';
    expect(await restoreFolder({ outDir: out, adb: w.device })).toEqual({ from: path.join(out, 'device-original-state.json'), failures: [] });
    expect(w.device.night).toBe('yes');
  });
});

// RA-58: on Windows a part folder cannot be moved aside while a file in it is open (EPERM, EBUSY): a refusal that says so,
// with session.json written, never an unrecorded crash.
describe('RA-58: a part folder held open', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each(['EPERM', 'EBUSY'])('%s moving an earlier attempt aside refuses, records session.json, and the next run goes on', async (code) => {
    const w = world();
    fs.mkdirSync(path.join(w.outDir, 'one'), { recursive: true });
    jest.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw Object.assign(new Error(`${code}: resource busy or locked, rename`), { code }); });
    const err = await w.run().then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(Refused);
    expect((err as Error).message).toMatch(new RegExp(`one: close what holds .*one open and run again \\(${code}\\)`));
    const s = w.readSession();
    expect([s.status, s.failure]).toEqual(['refused', expect.stringMatching(/close what holds/)]);
    expect(w.launches()).toEqual([]);
    jest.restoreAllMocks();
    expect((await w.run()).status).toBe('passed');
  });

  it('another rename error is not taken for an open file', async () => {
    const w = world();
    fs.mkdirSync(path.join(w.outDir, 'one'), { recursive: true });
    jest.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw Object.assign(new Error('ENOSPC: no space left'), { code: 'ENOSPC' }); });
    await expect(w.run()).rejects.toThrow(/ENOSPC/);
    expect(w.readSession().status).toBe('failed');
  });
});
