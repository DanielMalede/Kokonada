// Builds the Design Lab APK (OPS-100; V1 plan F-2, the Windows route).
//
//   node scripts/lab/buildLabApk.mjs       (after node scripts/lab/bundleLab.mjs)
//
// It refuses unless the stamp chain holds (HEAD and an empty porcelain are what bundleLab stamped,
// and the bundle on disk is the stamped one). Then:
//   1. it regenerates React Native's autolinking.json from the REAL path (Gradle's own settings
//      plugin writes it, and the lockfile hashes beside it);
//   2. on Windows it maps the repository to a free drive letter with subst (never W:, which other
//      sessions use), because the native CMake build fails on the long worktree path ("build.ninja
//      still dirty"), and points autolinking.json at that drive; otherwise the RN CLI would
//      regenerate it under the drive and drop the local spotify-remote module;
//   3. it runs :app:assembleLab for arm64-v8a through the drive;
//   4. ALWAYS, success or failure: it puts autolinking.json back byte for byte and removes the drive;
//   5. it checks the APK carries the stamped bundle and stamp, and that it is signed with the one shared
//      debug keystore (the main checkout's android/app/debug.keystore, read in place, never copied), so a
//      lab APK from any worktree installs over another with adb install -r.
// It never installs anything: that is a separate, explicit `adb install -r`.
//
// Exit codes: 0 built · 1 the build or its check failed · 2 refused.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Refused, verifyStampChain } from './lib/stamp.mjs';
import { readZipEntries } from './lib/zip.mjs';

const LAB_ASSETS = 'android/app/src/lab/assets';
const APK = 'android/app/build/outputs/apk/lab/app-lab.apk';
const AUTOLINKING = 'android/build/generated/autolinking/autolinking.json';
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

/** Letters to try for the subst drive. W is left out on purpose: other sessions map it. */
export const DEFAULT_DRIVES = ['L', 'K', 'J', 'M', 'N', 'P', 'Q', 'R', 'T', 'U', 'V', 'X', 'Y', 'Z'];

export function pickDriveLetter({ inUse, exists, preferred = DEFAULT_DRIVES }) {
  for (const letter of preferred) {
    if (letter.toUpperCase() === 'W' || inUse.has(letter) || exists(letter)) continue;
    return letter;
  }
  throw new Error('no free drive letter for subst');
}

/** Rewrites every absolute path under `from` to `to` in an autolinking.json, which stays valid JSON. */
export function relinkAutolinking(text, from, to) {
  const escaped = (s) => JSON.stringify(s).slice(1, -1);
  const parts = text.split(escaped(from));
  if (parts.length === 1) throw new Error(`no path under ${from} in autolinking.json`);
  const out = parts.join(escaped(to));
  JSON.parse(out);
  return { text: out, count: parts.length - 1 };
}

/**
 * @param {{ repoRoot: string, appRoot: string, git: { head(): string, porcelain(): string },
 *           gradle: (run: { cwd: string, args: string[] }) => unknown,
 *           subst: { list(): string, add(letter: string, target: string): unknown, remove(letter: string): unknown },
 *           exists: (letter: string) => boolean, platform?: string, log?: (message: string) => void,
 *           keystore: string,
 *           signer: { apkCertificate(apk: string): { dn: string, sha256: string },
 *                     keystoreCertificate(keystore: string): { sha256: string } } }} options
 */
export async function buildLabApk({ repoRoot, appRoot, git, gradle, subst, exists, platform = process.platform, log = () => {}, keystore, signer }) {
  const repo = path.resolve(repoRoot);
  const app = path.resolve(appRoot);
  const stampFile = path.join(app, LAB_ASSETS, 'lab-stamp.json');
  const bundleFile = path.join(app, LAB_ASSETS, 'index.android.bundle');
  if (!fs.existsSync(stampFile) || !fs.existsSync(bundleFile)) throw new Refused('no lab bundle or stamp: run node scripts/lab/bundleLab.mjs first');
  const stamp = JSON.parse(fs.readFileSync(stampFile, 'utf8'));
  const head = git.head();
  const problems = verifyStampChain({ head, porcelain: git.porcelain(), stamp });
  if (stamp.bundleSha256 !== sha256(fs.readFileSync(bundleFile))) problems.push('the bundle on disk is not the stamped one: run node scripts/lab/bundleLab.mjs');
  if (problems.length) throw new Refused(`the lab cannot be built:\n  ${problems.join('\n  ')}`);
  if (!keystore || !fs.existsSync(keystore)) {
    throw new Refused(`the shared debug keystore is missing (${keystore}): every worktree signs the lab with that one key, so adb install -r keeps working`);
  }

  const androidDir = path.join(app, 'android');
  const autolinking = path.join(app, AUTOLINKING);
  log('regenerating autolinking.json from the real path');
  fs.rmSync(autolinking, { force: true });
  gradle({ cwd: androidDir, args: ['help', '--console=plain', '-q'] });
  if (!fs.existsSync(autolinking)) throw new Error('Gradle did not write autolinking.json');
  const original = fs.readFileSync(autolinking);

  let letter = null;
  let cwd = androidDir;
  if (platform === 'win32') {
    const inUse = new Set([...subst.list().matchAll(/^([A-Z]):\\:/gm)].map((m) => m[1]));
    letter = pickDriveLetter({ inUse, exists });
    log(`mapping ${letter}: to ${repo}`);
    subst.add(letter, repo);
  }
  try {
    if (letter) {
      const relinked = relinkAutolinking(original.toString('utf8'), repo, `${letter}:`);
      fs.writeFileSync(autolinking, relinked.text);
      cwd = `${letter}:\\${path.relative(repo, androidDir)}`;
      log(`autolinking.json: ${relinked.count} paths now under ${letter}:`);
    }
    // The shared keystore reaches build.gradle as the project property kokonadaDebugKeystore.
    gradle({
      cwd,
      args: [':app:assembleLab', '-PreactNativeArchitectures=arm64-v8a', '--console=plain'],
      env: { ORG_GRADLE_PROJECT_kokonadaDebugKeystore: keystore },
    });
  } finally {
    if (letter) {
      fs.writeFileSync(autolinking, original);
      subst.remove(letter);
      log(`restored autolinking.json and removed ${letter}:`);
    }
  }

  const apkPath = path.join(app, APK);
  if (!fs.existsSync(apkPath)) throw new Error(`Gradle reported success but there is no ${APK}`);
  const apkBytes = fs.readFileSync(apkPath);
  const entries = readZipEntries(apkBytes);
  const bundle = entries.find((x) => x.name === 'assets/index.android.bundle');
  const stampEntry = entries.find((x) => x.name === 'assets/lab-stamp.json');
  const apkProblems = verifyStampChain({
    head, porcelain: git.porcelain(), stamp,
    apk: { bundleSha256: bundle ? sha256(bundle.data) : null, stamp: stampEntry ? JSON.parse(stampEntry.data.toString('utf8')) : null },
  });
  if (apkProblems.length) throw new Error(`the built APK fails the stamp chain:\n  ${apkProblems.join('\n  ')}`);
  const cert = signer.apkCertificate(apkPath);
  if (!/CN=Android Debug\b/.test(cert.dn)) throw new Error(`the lab APK is signed by ${cert.dn}, not the debug key`);
  if (cert.sha256 !== signer.keystoreCertificate(keystore).sha256) throw new Error('the lab APK is not signed with the shared debug keystore');
  return { apk: apkPath, apkSha256: sha256(apkBytes), signer: cert };
}

// ---- the real tools --------------------------------------------------------------------

// apksigner from the Android SDK that android/local.properties names (or ANDROID_HOME), newest build-tools.
function apksignerCommand(appRoot, args) {
  const props = path.join(appRoot, 'android/local.properties');
  const line = fs.existsSync(props) ? /^sdk\.dir=(.*)$/m.exec(fs.readFileSync(props, 'utf8')) : null;
  const sdk = (line ? line[1].replace(/\\(.)/g, '$1').trim() : '') || process.env.ANDROID_HOME;
  if (!sdk) throw new Error('no Android SDK: set sdk.dir in android/local.properties, or ANDROID_HOME');
  const tools = path.join(sdk, 'build-tools');
  const version = fs.readdirSync(tools).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
  const bin = path.join(tools, version, process.platform === 'win32' ? 'apksigner.bat' : 'apksigner');
  return process.platform === 'win32' ? ['cmd.exe', ['/d', '/s', '/c', bin, ...args]] : [bin, args];
}

function realTools(appRoot) {
  const git = (args) => {
    const r = spawnSync('git', args, { cwd: appRoot, encoding: 'utf8' });
    if (r.status !== 0) throw new Refused(`git ${args.join(' ')} failed: ${r.stderr}`);
    return r.stdout;
  };
  const run = (command, args, options) => {
    const r = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, ...options });
    if (r.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (exit ${r.status})${r.stderr ? `: ${r.stderr}` : ''}`);
    return r.stdout ?? '';
  };
  return {
    repoRoot: git(['rev-parse', '--show-toplevel']).trim(),
    git: { head: () => git(['rev-parse', 'HEAD']).trim(), porcelain: () => git(['status', '--porcelain']) },
    subst: {
      list: () => run('subst', []),
      add: (letter, target) => run('subst', [`${letter}:`, target]),
      remove: (letter) => run('subst', [`${letter}:`, '/D']),
    },
    exists: (letter) => fs.existsSync(`${letter}:\\`),
    // The main checkout is the first entry of `git worktree list`; its debug keystore signs every lab.
    keystore: path.join(
      git(['worktree', 'list', '--porcelain']).split(/\r?\n/)[0].replace(/^worktree /, ''),
      'mobile/KokonadaHealth/android/app/debug.keystore',
    ),
    signer: {
      apkCertificate: (apk) => {
        const [command, args] = apksignerCommand(appRoot, ['verify', '--print-certs', apk]);
        const out = run(command, args);
        const dn = /Signer #1 certificate DN: (.*)/.exec(out);
        const digest = /Signer #1 certificate SHA-256 digest: ([0-9a-f]+)/.exec(out);
        if (!dn || !digest) throw new Error(`apksigner printed no signer for ${apk}`);
        return { dn: dn[1].trim(), sha256: digest[1] };
      },
      // The standard debug keystore's public password; this reads the certificate, not the key.
      keystoreCertificate: (keystore) => {
        const out = run('keytool', ['-list', '-v', '-keystore', keystore, '-storepass', 'android', '-alias', 'androiddebugkey']);
        const digest = /SHA256: ([0-9A-F:]+)/.exec(out);
        if (!digest) throw new Error(`keytool printed no SHA256 for ${keystore}`);
        return { sha256: digest[1].replace(/:/g, '').toLowerCase() };
      },
    },
    // Fixed arguments only, never user input; gradlew.bat needs cmd on Windows.
    gradle: ({ cwd, args, env = {} }) => (process.platform === 'win32'
      ? run('cmd.exe', ['/d', '/s', '/c', `gradlew.bat ${args.join(' ')}`], { cwd, stdio: 'inherit', env: { ...process.env, ...env } })
      : run('sh', ['./gradlew', ...args], { cwd, stdio: 'inherit', env: { ...process.env, ...env } })),
  };
}

if (process.argv[1] && /buildLabApk\.mjs$/.test(process.argv[1])) {
  const appRoot = path.resolve(path.dirname(process.argv[1]), '../..');
  Promise.resolve()
    .then(() => {
      const tools = realTools(appRoot);
      return buildLabApk({ ...tools, appRoot, log: (m) => console.log(m) });
    })
    .then(({ apk, apkSha256, signer }) => console.log(`built ${apk}\nsha256 ${apkSha256}\nsigned by ${signer.dn} (certificate sha256 ${signer.sha256})`))
    .catch((e) => {
      console.error(e.message);
      process.exitCode = e instanceof Refused ? 2 : 1;
    });
}
