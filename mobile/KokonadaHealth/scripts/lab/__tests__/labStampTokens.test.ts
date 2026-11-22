/// <reference types="node" />
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { TOKENS_SOURCE } from '../../../src/design/v2/tokens/tokens.generated';
import { bundleLab } from '../bundleLab.mjs';
import { checkBuild } from '../capture.mjs';
import { buildManifest, buildRow, validateManifest, validateRow } from '../lib/manifest.mjs';
import { Refused } from '../lib/stamp.mjs';
import { tokenHashes } from '../lib/tokenHashes.mjs';
import { zip } from '../__fixtures__/zipWriter';

// UI-278. Every lab manifest recorded `stamp.tokens: {}`, because bundleLab wrote an empty map, so UI-119's check of the
// device evidence against the token files' hashes could not run. bundleLab now stamps the sha256 of every
// design-tokens/*.tokens.json (the token sources, at the repository root) and of every src/design/v2/tokens/*.generated.ts
// (the modules scripts/tokens/generate.mjs makes from them, which the lab bundle imports), each keyed by its path from the
// repository root with forward slashes, so a key reads the same on every machine. It refuses to stamp without them, and
// the stamp reaches the APK, checkBuild (capture.mjs --check), every manifest row and the manifest unchanged.

const SHA = 'e'.repeat(40);
const SENTINEL = 'kokonada-design-lab-sentinel-testfixture3';
const MAGIC = Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f]);
const HBC = Buffer.concat([MAGIC, Buffer.from(`code ${SENTINEL} code`)]);
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const NOW = () => new Date('2026-11-18T09:00:00.000Z');
const cleanGit = { head: () => SHA, porcelain: () => '' };

// The files the stamp names in the repository below, by their path from its root, in the stamp's order.
const STAMPED = [
  'design-tokens/base.tokens.json',
  'design-tokens/direction.abyss.tokens.json',
  'mobile/App/src/design/v2/tokens/tokens.extensions.generated.ts',
  'mobile/App/src/design/v2/tokens/tokens.generated.ts',
];

type Bundler = (root: string, entry: string, platform: string, outDir: string, options: { assetsDest: string }) => Promise<{ bundle: string; map: string; hbc: string }>;

// The stamp as these tests read it: its tokens are the path -> sha256 record lib/tokenHashes.mjs makes. bundleLab's JS
// types them from makeStamp's `tokens = {}` default as `{}`, which no path can index. run's result is declared this shape
// (an assignment the compiler checks, not a cast), and the tests below assert every hash's value.
interface Stamp {
  readonly bundleSha256: string;
  readonly tokens: Readonly<Record<string, string>>;
}
type Bundled = Promise<{ stamp: Stamp; bundlePath: string; stampPath: string }>;

// Stands in for Metro + hermesc: writes the outputs releaseBundle would. The bundle is the same whatever the token files
// hold, so a stamp that changes with a token file changed because of that file, never because of the bundle.
const bundler: Bundler = async (_root, _entry, _platform, outDir, { assetsDest }) => {
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(assetsDest, { recursive: true });
  const out = { bundle: path.join(outDir, 'b.js'), map: path.join(outDir, 'b.map'), hbc: path.join(outDir, 'b.hbc') };
  fs.writeFileSync(out.bundle, 'js');
  fs.writeFileSync(out.map, '{}');
  fs.writeFileSync(out.hbc, HBC);
  return out;
};

/**
 * A repository as bundleLab sees it, in a temporary folder: the token sources at its root, the app two levels down with
 * its generated modules, and beside them files that are neither, which the stamp leaves out: a note, a token file in a
 * subfolder, the hand-written token modules, a generated module in a subfolder, and a token file under the app's root.
 */
function repo() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-stamp-'));
  const appRoot = path.join(repoRoot, 'mobile', 'App');
  const write = (rel: string, data: string) => {
    const full = path.join(repoRoot, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, data);
  };
  write('mobile/App/src/design/lab/sentinel.ts', `export const LAB_SENTINEL = '${SENTINEL}';\n`);
  write('design-tokens/base.tokens.json', '{ "base": 1 }\n');
  write('design-tokens/direction.abyss.tokens.json', '{ "abyss": 1 }\n');
  write('mobile/App/src/design/v2/tokens/tokens.generated.ts', 'export const BASE = 1;\n');
  write('mobile/App/src/design/v2/tokens/tokens.extensions.generated.ts', 'export const EXTENSIONS = 1;\n');
  write('design-tokens/README.md', 'notes\n');
  write('design-tokens/archive/old.tokens.json', '{ "old": 1 }\n');
  write('mobile/App/src/design/v2/tokens/useTokens.ts', 'export {};\n');
  write('mobile/App/src/design/v2/tokens/__tests__/fixture.generated.ts', 'export {};\n');
  write('mobile/App/design-tokens/base.tokens.json', '{ "app": 1 }\n');
  const hashes = () => Object.fromEntries(STAMPED.map((rel) => [rel, sha(fs.readFileSync(path.join(repoRoot, rel)))]));
  const assets = path.join(appRoot, 'android/app/src/lab/assets');
  const run = (over: Record<string, unknown> = {}): Bundled => bundleLab({
    repoRoot, appRoot, git: cleanGit, bundle: bundler, now: NOW, realpath: (p: string) => p, ...over,
  });
  return { repoRoot, appRoot, assets, write, hashes, run };
}

/** The keys of `after` whose hash is not the one `before` holds. */
const changed = (before: Record<string, string>, after: Record<string, string>) => Object.keys(after).filter((k) => before[k] !== after[k]);

describe('the token hashes bundleLab stamps (UI-278)', () => {
  it('stamps the sha256 of every design-tokens/*.tokens.json and src/design/v2/tokens/*.generated.ts, keyed by its path from the repository root, and nothing else', async () => {
    const r = repo();
    const { stamp } = await r.run();
    const written = JSON.parse(fs.readFileSync(path.join(r.assets, 'lab-stamp.json'), 'utf8'));
    expect(Object.keys(written.tokens)).toEqual(STAMPED);
    expect(written.tokens).toEqual(r.hashes());
    expect(stamp).toEqual(written);
  });

  it('stamps a token source added to design-tokens/ as well: every file there, never a fixed list', async () => {
    const r = repo();
    r.write('design-tokens/direction.fixture.tokens.json', '{ "fixture": 1 }\n');
    const { stamp } = await r.run();
    expect(Object.keys(stamp.tokens)).toEqual([...STAMPED.slice(0, 2), 'design-tokens/direction.fixture.tokens.json', ...STAMPED.slice(2)]);
    expect(stamp.tokens['design-tokens/direction.fixture.tokens.json']).toBe(sha('{ "fixture": 1 }\n'));
  });

  it('a changed token file changes the stamp: that file\'s hash, and no other', async () => {
    const r = repo();
    const before = (await r.run()).stamp;
    r.write('design-tokens/direction.abyss.tokens.json', '{ "abyss": 2 }\n');
    const source = (await r.run()).stamp;
    r.write('mobile/App/src/design/v2/tokens/tokens.generated.ts', 'export const BASE = 2;\n');
    const generated = (await r.run()).stamp;
    expect(changed(before.tokens, source.tokens)).toEqual(['design-tokens/direction.abyss.tokens.json']);
    expect(source.tokens['design-tokens/direction.abyss.tokens.json']).toBe(sha('{ "abyss": 2 }\n'));
    expect(changed(source.tokens, generated.tokens)).toEqual(['mobile/App/src/design/v2/tokens/tokens.generated.ts']);
    expect(generated.tokens['mobile/App/src/design/v2/tokens/tokens.generated.ts']).toBe(sha('export const BASE = 2;\n'));
    // The bundle was the same every time: each change is the token file's own.
    expect(new Set([before.bundleSha256, source.bundleSha256, generated.bundleSha256]).size).toBe(1);
  });

  it.each([
    ['no token source in design-tokens/ (only files that are not one)', ['design-tokens/base.tokens.json', 'design-tokens/direction.abyss.tokens.json'], /no design-tokens\/\*\.tokens\.json/],
    ['no design-tokens/ folder at all', ['design-tokens'], /no design-tokens\/\*\.tokens\.json/],
    ['no generated token module', ['mobile/App/src/design/v2/tokens/tokens.generated.ts', 'mobile/App/src/design/v2/tokens/tokens.extensions.generated.ts'], /no src\/design\/v2\/tokens\/\*\.generated\.ts/],
  ])('refuses with %s, before it clears the previous bundle or runs Metro, so no stamp is ever written without them', async (_label, removed, why) => {
    const r = repo();
    for (const rel of removed) fs.rmSync(path.join(r.repoRoot, rel), { recursive: true, force: true });
    r.write('mobile/App/android/app/src/lab/assets/index.android.bundle', 'the previous, stamped bundle');
    let bundled = false;
    const spy: Bundler = async (...args) => { bundled = true; return bundler(...args); };
    const error = await r.run({ bundle: spy }).then(() => null, (e: Error) => e);
    expect(error).toBeInstanceOf(Refused);
    expect(error?.message).toMatch(why);
    expect(bundled).toBe(false);
    expect(fs.readFileSync(path.join(r.assets, 'index.android.bundle'), 'utf8')).toBe('the previous, stamped bundle');
    expect(fs.existsSync(path.join(r.assets, 'lab-stamp.json'))).toBe(false);
  });
});

// What one shot's row is built from, as the harness holds it (lib/manifest.mjs buildRow), around a build checkBuild verified.
const STAGE = { x: 0, y: 0, width: 1080, height: 2340 };
const FACTS = { model: 'SM-S906B', fingerprint: 'samsung/g0s:16/x/1:user/release-keys', width: 1080, height: 2340, density: 420, refreshRate: 120, forceDark: false, locale: 'he-IL' };
const RENDER = {
  gl: { renderer: 'Adreno (TM) 730', gles: 'OpenGL ES 3.2', reason: null },
  display: { colorMode: 'ColorMode::SRGB (7)', wideColor: true, refreshMode: 'render 120 Hz, vsync 120 Hz', reason: null },
};
const rowSources = (build: unknown) => ({
  shot: { id: 'smoke-fixed', scene: 'smoke', device: { fontScale: 1 }, expect: { direction: null, face: null, hero: null, tier: null } },
  repeat: 1,
  file: 'smoke-fixed.1.png',
  sha256: sha('png'),
  appRegionHash: sha('region'),
  build,
  app: { package: 'com.kokonadahealth.lab' },
  facts: FACTS,
  frame: { width: 1080, height: 2340, colorSpace: 'sRGB' },
  observed: { fontScale: 1, night: 'yes', animatorScales: { window: 1, transition: 1, animator: 1 } },
  ready: { clock: 'fixed', t: 1500, seq: 0, isRTL: true, fontScale: 1, powerSave: false, pixelRatio: 2.625, probes: { stage: { px: STAGE } } },
  region: { x: 0, y: 84, width: 1080, height: 2130 },
  probes: { inside: {}, excluded: [] },
  timestamps: { launched: new Date('2026-11-18T10:00:00.000Z'), ready: new Date('2026-11-18T10:00:01.000Z'), captured: new Date('2026-11-18T10:00:01.500Z') },
  renderFacts: { renderScale: null, sampling: null },
  render: RENDER,
});

describe('the stamp chain with the token hashes (UI-278)', () => {
  it('holds from the stamp bundleLab writes, through the APK and checkBuild (capture.mjs --check), into a row validateRow accepts and a manifest validateManifest accepts', async () => {
    const r = repo();
    const { stamp, bundlePath, stampPath } = await r.run();
    // Gradle packs the bundle and the stamp into the APK as they are (buildLabApk checks that it did).
    const apkPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lab-apk-')), 'app-lab.apk');
    fs.writeFileSync(apkPath, zip([
      { name: 'assets/index.android.bundle', data: fs.readFileSync(bundlePath), deflate: true },
      { name: 'assets/lab-stamp.json', data: fs.readFileSync(stampPath) },
    ]));
    const build = { ...checkBuild({ appRoot: r.appRoot, apkPath, git: cleanGit }), skiaVersion: '2.6.9' };
    expect(build.stamp).toEqual(stamp);

    const row = buildRow(rowSources(build));
    expect(row.stamp).toEqual({ bundleSha256: stamp.bundleSha256, tokens: r.hashes() });
    expect(validateRow(row)).toEqual([]);

    const manifest = JSON.parse(JSON.stringify(buildManifest({
      planId: 'smoke', failure: null, restoreFailures: [], build, facts: FACTS, render: RENDER,
      startedAt: '2026-11-18T10:00:00.000Z', finishedAt: '2026-11-18T10:01:00.000Z', rows: [row], determinism: [],
      out: { proofs: [], checks: [], results: [], records: [], moving: [], settleFailures: [] },
    })));
    expect(manifest.stamp.tokens).toEqual(r.hashes());
    expect(manifest.rows[0].stamp.tokens).toEqual(r.hashes());
    expect(validateManifest(manifest)).toEqual([]);
  });
});

// The real tree: the files the stamp names are the ones git tracks under the two globs, and each token source's hash is
// the one the token generator recorded for it in the committed module, which is what UI-119's check reads against.
describe('the token files of this tree (UI-278)', () => {
  const APP = path.resolve(__dirname, '../../..');
  const REPO = path.resolve(APP, '../..');
  const app = path.relative(REPO, APP).split(path.sep).join('/');

  it('are every tracked design-tokens/*.tokens.json and src/design/v2/tokens/*.generated.ts, as git lists them, with the sha256 of its bytes', () => {
    const r = spawnSync('git', ['-C', REPO, 'ls-files', '-z', '--', ':(glob)design-tokens/*.tokens.json', `:(glob)${app}/src/design/v2/tokens/*.generated.ts`], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    const tracked = r.stdout.split('\0').filter(Boolean).sort();
    expect(tracked).toEqual(expect.arrayContaining([
      'design-tokens/base.tokens.json',
      'design-tokens/direction.abyss.tokens.json',
      `${app}/src/design/v2/tokens/tokens.generated.ts`,
      `${app}/src/design/v2/tokens/tokens.extensions.generated.ts`,
    ]));
    const hashes = tokenHashes({ repoRoot: REPO, appRoot: APP });
    expect(Object.keys(hashes)).toEqual(tracked);
    for (const file of tracked) expect(hashes[file]).toBe(sha(fs.readFileSync(path.join(REPO, file))));
  });

  it('hashes each token source as the generated module records it (TOKENS_SOURCE, written by scripts/tokens/generate.mjs)', () => {
    const hashes = tokenHashes({ repoRoot: REPO, appRoot: APP });
    const sources = Object.entries(hashes).filter(([file]) => file.startsWith('design-tokens/'));
    expect(Object.fromEntries(sources.map(([file, hash]) => [path.posix.basename(file, '.tokens.json'), hash]))).toEqual(TOKENS_SOURCE);
  });
});
