/// <reference types="node" />
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { bundleLab } from '../bundleLab.mjs';
import { buildLabApk, gradleSpawn, pickDriveLetter, relinkAutolinking } from '../buildLabApk.mjs';
import { Refused } from '../capture.mjs';
import { makeStamp } from '../lib/stamp.mjs';
import { zip } from '../__fixtures__/zipWriter';

// OPS-100. The lab's Windows build route (V1 plan F-2), as two scripts:
//   bundleLab    the JS: Metro and hermesc from the REAL path (Metro breaks under a subst drive),
//                into android/app/src/lab/assets, with lab-stamp.json (the head of the stamp chain);
//   buildLabApk  the APK: Gradle through a subst drive (CMake breaks on the long worktree path),
//                with autolinking pointed at that drive and put back afterwards, on every path.
// Each refuses rather than producing an APK whose provenance cannot be proven.

const SHA = 'e'.repeat(40);
const SENTINEL = 'kokonada-design-lab-sentinel-testfixture2';
const MAGIC = Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f]);
const HBC = Buffer.concat([MAGIC, Buffer.from(`code ${SENTINEL} code`)]);
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

function app() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-build-'));
  const appRoot = path.join(repoRoot, 'mobile', 'App');
  const write = (rel: string, data: Buffer | string) => {
    const full = path.join(appRoot, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, data);
  };
  write('src/design/lab/sentinel.ts', `export const LAB_SENTINEL = '${SENTINEL}';\n`);
  write('android/app/src/lab/res/values/strings.xml', '<resources/>');
  return { repoRoot, appRoot, write, read: (rel: string) => fs.readFileSync(path.join(appRoot, rel)), exists: (rel: string) => fs.existsSync(path.join(appRoot, rel)) };
}

// Stands in for Metro + hermesc: writes the outputs releaseBundle would, and one image asset.
const bundler = (hbc: Buffer = HBC) => async (_root: string, entry: string, platform: string, outDir: string, { assetsDest }: { assetsDest: string }) => {
  expect([entry, platform]).toEqual(['index.lab.js', 'android']);
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(path.join(assetsDest, 'drawable-mdpi'), { recursive: true });
  fs.writeFileSync(path.join(assetsDest, 'drawable-mdpi', 'mark.png'), 'png');
  const out = { bundle: path.join(outDir, 'b.js'), map: path.join(outDir, 'b.map'), hbc: path.join(outDir, 'b.hbc') };
  fs.writeFileSync(out.bundle, 'js');
  fs.writeFileSync(out.map, '{}');
  fs.writeFileSync(out.hbc, hbc);
  return out;
};
const cleanGit = { head: () => SHA, porcelain: () => '' };
const NOW = () => new Date('2026-10-04T09:00:00.000Z');

describe('bundleLab', () => {
  it('writes the Hermes bundle and a stamp naming its sha256 and the commit, and clears what a previous bundle left', async () => {
    const a = app();
    a.write('android/app/src/lab/assets/stale.txt', 'old');
    a.write('android/app/src/lab/res/drawable-hdpi/old.png', 'old');
    const result = await bundleLab({ appRoot: a.appRoot, git: cleanGit, bundle: bundler(), now: NOW, realpath: (p: string) => p });
    expect(a.read('android/app/src/lab/assets/index.android.bundle').equals(HBC)).toBe(true);
    const stamp = JSON.parse(a.read('android/app/src/lab/assets/lab-stamp.json').toString());
    expect(stamp).toEqual({ commit: SHA, porcelainEmpty: true, bundleSha256: sha(HBC), tokens: {}, entry: 'index.lab.js', dev: false, createdAt: '2026-10-04T09:00:00.000Z' });
    expect(result.stamp).toEqual(stamp);
    expect(a.exists('android/app/src/lab/assets/stale.txt')).toBe(false);
    expect(a.exists('android/app/src/lab/res/drawable-hdpi/old.png')).toBe(false);
    expect(a.exists('android/app/src/lab/res/drawable-mdpi/mark.png')).toBe(true); // --assets-dest landed in src/lab/res
    expect(a.exists('android/app/src/lab/res/values/strings.xml')).toBe(true); // the lab's own name is source, kept
  });

  it('refuses to run from a subst drive: Metro resolves the drive back to C: and breaks', async () => {
    const a = app();
    await expect(bundleLab({ appRoot: a.appRoot, git: cleanGit, bundle: bundler(), now: NOW, realpath: () => 'C:\\somewhere\\else' }))
      .rejects.toThrow(/real path/);
    expect(a.exists('android/app/src/lab/assets')).toBe(false);
  });

  it('refuses a tree with uncommitted changes before touching the previous bundle or running Metro', async () => {
    const a = app();
    a.write('android/app/src/lab/assets/index.android.bundle', 'the previous, stamped bundle');
    let bundled = false;
    const spy = async (...args: Parameters<ReturnType<typeof bundler>>) => { bundled = true; return bundler()(...args); };
    await expect(bundleLab({ appRoot: a.appRoot, git: { head: () => SHA, porcelain: () => ' M index.lab.js' }, bundle: spy, now: NOW, realpath: (p: string) => p }))
      .rejects.toThrow(/uncommitted/);
    expect(bundled).toBe(false);
    expect(a.read('android/app/src/lab/assets/index.android.bundle').toString()).toBe('the previous, stamped bundle');
  });

  it.each([
    ['not Hermes bytecode', Buffer.from(`var x = "${SENTINEL}"`), /Hermes/],
    ['missing the sentinel', Buffer.concat([MAGIC, Buffer.from('no marker here')]), /sentinel/],
  ])('refuses a bundle that is %s, and leaves no bundle behind for Gradle to pack', async (_label, hbc, why) => {
    const a = app();
    await expect(bundleLab({ appRoot: a.appRoot, git: cleanGit, bundle: bundler(hbc), now: NOW, realpath: (p: string) => p })).rejects.toThrow(why);
    expect(a.exists('android/app/src/lab/assets/index.android.bundle')).toBe(false);
  });

  it('refuses when bundling left the tree dirty (an output that is not gitignored)', async () => {
    const a = app();
    let calls = 0;
    const git = { head: () => SHA, porcelain: () => (calls++ === 0 ? '' : '?? android/app/src/lab/assets/lab-stamp.json') };
    await expect(bundleLab({ appRoot: a.appRoot, git, bundle: bundler(), now: NOW, realpath: (p: string) => p })).rejects.toThrow(/dirty/);
  });
});

describe('the drive letter and the autolinking paths', () => {
  it('picks the first free letter, never W (other sessions use it), skipping letters in use', () => {
    expect(pickDriveLetter({ inUse: new Set(['L']), exists: () => false })).toBe('K');
    expect(pickDriveLetter({ inUse: new Set(), exists: (l: string) => l === 'L', preferred: ['L', 'W', 'K'] })).toBe('K');
    expect(() => pickDriveLetter({ inUse: new Set(['L', 'K']), exists: () => false, preferred: ['W', 'L', 'K'] })).toThrow(/no free drive letter/);
  });

  it('rewrites every absolute path in autolinking.json from the real root to the drive, and back', () => {
    const root = 'C:\\Users\\me\\repo';
    const json = JSON.stringify({ root: `${root}\\mobile\\App`, dependencies: { a: { platforms: { android: { sourceDir: `${root}\\mobile\\App\\node_modules\\a\\android` } } } } }, null, 2);
    const there = relinkAutolinking(json, root, 'L:');
    expect(there.count).toBe(2);
    expect(JSON.parse(there.text).dependencies.a.platforms.android.sourceDir).toBe('L:\\mobile\\App\\node_modules\\a\\android');
    expect(relinkAutolinking(there.text, 'L:', root).text).toBe(json);
    expect(() => relinkAutolinking(json, 'D:\\nowhere', 'L:')).toThrow(/no path/);
  });
});

describe('buildLabApk', () => {
  const DEBUG_CERT = { dn: 'CN=Android Debug, O=Android, C=US', sha256: 'a'.repeat(64) };
  function rig({ gradleFails = false, apkBundle = HBC, keystorePresent = true, apkCert = DEBUG_CERT } = {}) {
    const a = app();
    const stamp = makeStamp({ commit: SHA, porcelain: '', bundleSha256: sha(HBC), tokens: {}, entry: 'index.lab.js', createdAt: NOW().toISOString() });
    a.write('android/app/src/lab/assets/index.android.bundle', HBC);
    a.write('android/app/src/lab/assets/lab-stamp.json', JSON.stringify(stamp, null, 2));
    const autolinking = path.join(a.appRoot, 'android/build/generated/autolinking/autolinking.json');
    const real = JSON.stringify({ root: path.join(a.repoRoot, 'mobile', 'App'), project: { android: { packageName: 'x' } } }, null, 2);
    const drives = new Map<string, string>();
    const calls: Array<{ cwd: string; args: string[]; env?: Record<string, string>; autolinking: string | null }> = [];
    const keystore = path.join(a.repoRoot, 'shared-debug.keystore');
    if (keystorePresent) fs.writeFileSync(keystore, 'keystore bytes');
    const signer = { apkCertificate: () => apkCert, keystoreCertificate: () => ({ sha256: DEBUG_CERT.sha256 }) };
    const subst = {
      list: () => [...drives.entries()].map(([l, t]) => `${l}:\\: => ${t}`).join('\n'),
      add: (letter: string, target: string) => { drives.set(letter, target); },
      remove: (letter: string) => { drives.delete(letter); },
    };
    const gradle = ({ cwd, args, env }: { cwd: string; args: string[]; env?: Record<string, string> }) => {
      calls.push({ cwd, args, env, autolinking: fs.existsSync(autolinking) ? fs.readFileSync(autolinking, 'utf8') : null });
      if (args[0] === 'help') {
        fs.mkdirSync(path.dirname(autolinking), { recursive: true });
        fs.writeFileSync(autolinking, real);
        return;
      }
      if (gradleFails) throw new Error('gradle :app:assembleLab failed (exit 1)');
      const apk = path.join(a.appRoot, 'android/app/build/outputs/apk/lab/app-lab.apk');
      fs.mkdirSync(path.dirname(apk), { recursive: true });
      fs.writeFileSync(apk, zip([
        { name: 'assets/index.android.bundle', data: apkBundle, deflate: true },
        { name: 'assets/lab-stamp.json', data: Buffer.from(JSON.stringify(stamp, null, 2)) },
      ]));
    };
    const run = (git = cleanGit) => buildLabApk({
      repoRoot: a.repoRoot, appRoot: a.appRoot, git, gradle, subst, exists: () => false, platform: 'win32', log: () => {}, keystore, signer,
    });
    return { ...a, autolinking, real, drives, calls, run, keystore };
  }

  it('builds under a free drive with autolinking pointed at it, then restores the file byte for byte and removes the drive', async () => {
    const r = rig();
    const result = await r.run();
    const [regen, assemble] = r.calls;
    expect(regen.args[0]).toBe('help');
    expect(regen.cwd).toBe(path.join(r.appRoot, 'android')); // regenerated from the real path
    expect(assemble.args).toEqual([':app:assembleLab', '-PreactNativeArchitectures=arm64-v8a', '--console=plain']);
    expect(assemble.cwd).toBe(`L:\\${path.join('mobile', 'App', 'android')}`);
    // relinkAutolinking swaps the repository root for the drive and keeps the rest of each path in this
    // platform's separators (L:\mobile\App on Windows, L:/mobile/App on Linux), JSON-escaped in the file.
    expect(assemble.autolinking).toContain(JSON.stringify(path.join(`L:${path.sep}`, 'mobile', 'App')).slice(1, -1));
    expect(fs.readFileSync(r.autolinking, 'utf8')).toBe(r.real);
    expect(r.drives.size).toBe(0);
    expect(result.apkSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('restores autolinking.json and removes the drive when Gradle fails too', async () => {
    const r = rig({ gradleFails: true });
    await expect(r.run()).rejects.toThrow(/assembleLab failed/);
    expect(fs.readFileSync(r.autolinking, 'utf8')).toBe(r.real);
    expect(r.drives.size).toBe(0);
  });

  it('refuses before any drive or Gradle when the stamp does not match HEAD or the tree', async () => {
    const r = rig();
    await expect(r.run({ head: () => 'f'.repeat(40), porcelain: () => '' })).rejects.toBeInstanceOf(Refused);
    await expect(r.run({ head: () => SHA, porcelain: () => '?? x' })).rejects.toThrow(/uncommitted/);
    expect(r.calls).toEqual([]);
    expect(r.drives.size).toBe(0);
  });

  it('refuses an APK that does not carry the stamped bundle', async () => {
    const r = rig({ apkBundle: Buffer.concat([MAGIC, Buffer.from(`another ${SENTINEL}`)]) });
    await expect(r.run()).rejects.toThrow(/another bundle/);
    expect(r.drives.size).toBe(0);
  });

  it('signs with the one shared debug keystore (the main checkout one), passed to Gradle as a project property', async () => {
    const r = rig();
    const result = await r.run();
    expect(r.calls[1].env).toEqual({ ORG_GRADLE_PROJECT_kokonadaDebugKeystore: r.keystore });
    expect(result.signer).toEqual(DEBUG_CERT);
  });

  it('refuses before any drive or Gradle when the shared debug keystore is missing', async () => {
    const r = rig({ keystorePresent: false });
    await expect(r.run()).rejects.toThrow(/shared debug keystore/);
    expect(r.calls).toEqual([]);
    expect(r.drives.size).toBe(0);
  });

  it('refuses an APK signed by any other certificate than the shared debug key', async () => {
    await expect(rig({ apkCert: { dn: 'CN=Kokonada Health, O=Kokonada', sha256: 'b'.repeat(64) } }).run()).rejects.toThrow(/not the debug key/);
    await expect(rig({ apkCert: { dn: 'CN=Android Debug, O=Android, C=US', sha256: 'c'.repeat(64) } }).run()).rejects.toThrow(/not signed with the shared debug keystore/);
  });
});

describe('the real Gradle wrapper call', () => {
  // Found on the first real run: with NoDefaultCurrentDirectoryInExePath set (it is in some shells),
  // cmd.exe does not look in the current directory, so a bare `gradlew.bat` "is not recognized". The
  // wrapper is named by its absolute path, quoted, and the call runs through the real cmd.exe here.
  const onWindows = process.platform === 'win32' ? it : it.skip;
  onWindows('runs the wrapper in cwd by its absolute path, even where cmd.exe does not search the current directory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab gradle '));
    fs.writeFileSync(path.join(dir, 'gradlew.bat'), '@echo off\r\necho WRAPPER %* KEY=%ORG_GRADLE_PROJECT_kokonadaDebugKeystore%\r\n');
    const keystore = String.raw`C:\k\debug.keystore`;
    const [command, args, options] = gradleSpawn({ cwd: dir, args: [':app:assembleLab', '-PreactNativeArchitectures=arm64-v8a'], env: { ORG_GRADLE_PROJECT_kokonadaDebugKeystore: keystore } });
    const r = spawnSync(command, args, { ...options, env: { ...options.env, NoDefaultCurrentDirectoryInExePath: '1' }, encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.stdout.trim()).toBe(`WRAPPER :app:assembleLab -PreactNativeArchitectures=arm64-v8a KEY=${keystore}`);
    expect(r.status).toBe(0);
  });

  const elsewhere = process.platform === 'win32' ? it.skip : it;
  elsewhere('runs ./gradlew in cwd through sh', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab gradle '));
    fs.writeFileSync(path.join(dir, 'gradlew'), 'echo "WRAPPER $* KEY=$ORG_GRADLE_PROJECT_kokonadaDebugKeystore"\n');
    const [command, args, options] = gradleSpawn({ cwd: dir, args: [':app:assembleLab'], env: { ORG_GRADLE_PROJECT_kokonadaDebugKeystore: '/k/debug.keystore' } });
    const r = spawnSync(command, args, { ...options, encoding: 'utf8' });
    expect(r.stdout.trim()).toBe('WRAPPER :app:assembleLab KEY=/k/debug.keystore');
    expect(r.status).toBe(0);
  });
});
