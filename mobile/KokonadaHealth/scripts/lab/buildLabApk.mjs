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
//   5. it checks the APK carries the stamped bundle and stamp.
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
 *           exists: (letter: string) => boolean, platform?: string, log?: (message: string) => void }} options
 */
export async function buildLabApk({ repoRoot, appRoot, git, gradle, subst, exists, platform = process.platform, log = () => {} }) {
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
    gradle({ cwd, args: [':app:assembleLab', '-PreactNativeArchitectures=arm64-v8a', '--console=plain'] });
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
  return { apk: apkPath, apkSha256: sha256(apkBytes) };
}

// ---- the real tools --------------------------------------------------------------------

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
    // Fixed arguments only, never user input; gradlew.bat needs cmd on Windows.
    gradle: ({ cwd, args }) => (process.platform === 'win32'
      ? run('cmd.exe', ['/d', '/s', '/c', `gradlew.bat ${args.join(' ')}`], { cwd, stdio: 'inherit' })
      : run('sh', ['./gradlew', ...args], { cwd, stdio: 'inherit' })),
  };
}

if (process.argv[1] && /buildLabApk\.mjs$/.test(process.argv[1])) {
  const appRoot = path.resolve(path.dirname(process.argv[1]), '../..');
  Promise.resolve()
    .then(() => {
      const tools = realTools(appRoot);
      return buildLabApk({ ...tools, appRoot, log: (m) => console.log(m) });
    })
    .then(({ apk, apkSha256 }) => console.log(`built ${apk}\nsha256 ${apkSha256}`))
    .catch((e) => {
      console.error(e.message);
      process.exitCode = e instanceof Refused ? 2 : 1;
    });
}
