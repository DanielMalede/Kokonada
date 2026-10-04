// Bundles the Design Lab (OPS-100; V1 plan F-2, step 7).
//
//   node scripts/lab/bundleLab.mjs
//
// From a CLEAN commit, and from the REAL path (Metro resolves a subst drive back to C: and breaks),
// it bundles index.lab.js exactly as the release Gradle task bundles index.js (Metro --dev false,
// then hermesc -O), and writes:
//   android/app/src/lab/assets/index.android.bundle   the Hermes bytecode Gradle packs into the lab APK
//   android/app/src/lab/assets/lab-stamp.json         the head of the stamp chain: commit, empty
//                                                     porcelain, the bundle's sha256, the token hashes
//   android/app/src/lab/res/drawable-*, raw/          the JS assets (--assets-dest)
// All of these are gitignored, and it refuses if bundling left the tree dirty. Token hashes are {}
// until the token pipeline (UI-067) exists. Never set ENTRY_FILE: the lab has its own entry here.
//
// Exit codes: 0 bundled · 1 the bundle failed a check · 2 refused (dirty tree, subst path).

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { findMarkers, readSentinel, releaseBundle } from './assertLabExcluded.mjs';
import { makeStamp, Refused } from './lib/stamp.mjs';

const LAB_ASSETS = 'android/app/src/lab/assets';
const LAB_RES = 'android/app/src/lab/res';
const GENERATED_RES = /^(drawable|raw)(-|$)/; // what --assets-dest writes; res/values is source
const HERMES_MAGIC = Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f]);
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

/**
 * @param {{ appRoot: string, git: { head(): string, porcelain(): string },
 *           bundle?: (appRoot: string, entry: string, platform: string, outDir: string, options: { assetsDest: string }) => any,
 *           now?: () => Date, realpath?: (p: string) => string, log?: (message: string) => void }} options
 */
export async function bundleLab({
  appRoot, git, bundle = releaseBundle, now = () => new Date(), realpath = fs.realpathSync.native, log = () => {},
}) {
  const root = path.resolve(appRoot);
  const real = realpath(root);
  if (real.toLowerCase() !== root.toLowerCase()) {
    throw new Refused(`Metro must run from the real path, not ${root}, which resolves to ${real} (a subst drive): run it from ${real}`);
  }
  const head = git.head();
  const porcelain = git.porcelain();
  if (porcelain.trim() !== '') throw new Refused(`the tree has uncommitted changes; the lab is bundled only from a clean commit:\n${porcelain}`);

  // What a previous bundle left must not ride into this APK.
  const assets = path.join(root, LAB_ASSETS);
  const res = path.join(root, LAB_RES);
  fs.rmSync(assets, { recursive: true, force: true });
  if (fs.existsSync(res)) {
    for (const dir of fs.readdirSync(res)) if (GENERATED_RES.test(dir)) fs.rmSync(path.join(res, dir), { recursive: true, force: true });
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-bundle-'));
  try {
    log('bundling index.lab.js (Metro --dev false, then hermesc -O)');
    const out = await bundle(root, 'index.lab.js', 'android', tmp, { assetsDest: res });
    const hbc = fs.readFileSync(out.hbc);
    if (!hbc.subarray(0, 8).equals(HERMES_MAGIC)) throw new Error('the lab bundle is not Hermes bytecode');
    if (findMarkers([readSentinel(root)], hbc).length === 0) {
      throw new Error('the lab bundle does not carry the sentinel, so no check could tell it apart from the app');
    }
    const stamp = makeStamp({ commit: head, porcelain, bundleSha256: sha256(hbc), tokens: {}, entry: 'index.lab.js', createdAt: now().toISOString() });
    fs.mkdirSync(assets, { recursive: true });
    const bundlePath = path.join(assets, 'index.android.bundle');
    const stampPath = path.join(assets, 'lab-stamp.json');
    fs.writeFileSync(bundlePath, hbc);
    fs.writeFileSync(stampPath, `${JSON.stringify(stamp, null, 2)}\n`);
    const after = git.porcelain();
    if (after.trim() !== '') throw new Error(`bundling left the tree dirty; the lab outputs must all be gitignored:\n${after}`);
    return { stamp, bundlePath, stampPath };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function gitIn(cwd) {
  const git = (args) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (r.status !== 0) throw new Refused(`git ${args.join(' ')} failed: ${r.stderr}`);
    return r.stdout;
  };
  return { head: () => git(['rev-parse', 'HEAD']).trim(), porcelain: () => git(['status', '--porcelain']) };
}

if (process.argv[1] && /bundleLab\.mjs$/.test(process.argv[1])) {
  const appRoot = path.resolve(path.dirname(process.argv[1]), '../..');
  bundleLab({ appRoot, git: gitIn(appRoot), log: (m) => console.log(m) })
    .then(({ stamp, bundlePath }) => {
      console.log(`bundled ${path.relative(appRoot, bundlePath)}: sha256 ${stamp.bundleSha256}, commit ${stamp.commit}`);
    })
    .catch((e) => {
      console.error(e.message);
      process.exitCode = e instanceof Refused ? 2 : 1;
    });
}
