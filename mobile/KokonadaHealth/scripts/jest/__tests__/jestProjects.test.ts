/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

// MB-086. Mobile jest runs two projects:
//   · unit — the existing configuration, with the global stubs (jest.setup.js), every test except
//     *.skia.test.*;
//   · skia — Skia's CanvasKit environment, *.skia.test.* only, and never the Skia stub.
//   · sweeps — UI-073's full-resolution never-red pass and E3's full ledger-storm grid (QA-068),
//     *.sweeps.test.* only, in its own config
//     (jest.sweeps.config.js), so `jest` and `jest --ci` never run it. CI runs it in its own job,
//     gated by a pinned paths filter, so a PR that cannot change a sweep result skips it.
//   · sweeps-skia — the real-Skia checks too slow for every PR (the never-red scenes),
//     *.sweeps.skia.test.* only, in jest.sweeps.config.js beside sweeps, with the skia project's
//     environment, setup and transforms; the skia project leaves these files out.
// Splitting a jest config is how suites silently stop running: a narrowed pattern runs fewer files
// and still reports green. So this asks jest itself which files each project runs, and compares the
// union with an independent walk of the disk.

const APP = path.resolve(__dirname, '../../..');
const rel = (f: string) => path.relative(APP, f).split(path.sep).join('/');

function listTests(project: string, config?: string): string[] {
  const configArgs = config ? ['--config', config] : [];
  const r = spawnSync(process.execPath, [path.join(APP, 'node_modules/jest/bin/jest.js'), '--listTests', '--json', ...configArgs, '--selectProjects', project], {
    cwd: APP, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`jest --listTests --selectProjects ${project} failed (${r.status}): ${r.stderr}`);
  // An unknown project name still exits 0, with warnings instead of a list: anything that is not a
  // JSON array of existing absolute paths is refused rather than read as test files.
  let files: unknown;
  try { files = JSON.parse(r.stdout); } catch { throw new Error(`jest --listTests --selectProjects ${project} printed no JSON list: ${r.stdout.slice(0, 300)}`); }
  if (!Array.isArray(files) || files.some((f) => typeof f !== 'string' || !path.isAbsolute(f) || !fs.existsSync(f))) {
    throw new Error(`jest --listTests --selectProjects ${project} printed something that is not a list of test files`);
  }
  return (files as string[]).map(rel).sort();
}

// jest's default testMatch, walked by hand: a file under __tests__/, or named *.test.* / *.spec.*,
// with a js/ts extension, outside node_modules.
const TEST_EXT = /\.[mc]?[jt]sx?$/;
function testsOnDisk(): string[] {
  const out: string[] = [];
  const walk = (dir: string, underTests: boolean) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, underTests || e.name === '__tests__');
      else if (TEST_EXT.test(e.name) && (underTests || /\.(test|spec)\.[mc]?[jt]sx?$/.test(e.name))) out.push(rel(full));
    }
  };
  walk(APP, false);
  return out.sort();
}

const SKIA_TEST = /\.skia\.test\.[mc]?[jt]sx?$/;
/** The CanvasKit sweeps (law round 2, item 8): *.sweeps.skia.test.*, run only by jest.sweeps.config.js. */
const SWEEPS_SKIA_TEST = /\.sweeps\.skia\.test\.[mc]?[jt]sx?$/;

// ci.yml, as lines, and a job's block within it (from its key to the next job's key).
const ciLines = () => fs.readFileSync(path.resolve(APP, '../../.github/workflows/ci.yml'), 'utf8').split(/\r?\n/);
function jobBlock(lines: string[], id: string): string[] {
  const start = lines.indexOf(`  ${id}:`);
  if (start < 0) return [];
  const end = lines.findIndex((l, i) => i > start && /^ {2}[\w-]+:\s*$/.test(l));
  return lines.slice(start, end < 0 ? lines.length : end);
}
/** The globs listed under a paths-filter output name inside a job block. */
function filterGlobs(block: string[], output: string): string[] {
  const at = block.findIndex((l) => l.trim() === `${output}:`);
  if (at < 0) return [];
  const out: string[] = [];
  for (const line of block.slice(at + 1)) {
    const t = line.trim();
    if (!t.startsWith("- '")) break;
    out.push(t.slice(3, -1));
  }
  return out;
}
// A glob as paths-filter reads it: ** crosses folders, * does not.
const globRegExp = (glob: string) =>
  new RegExp(`^${glob.split('**').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('.*')}$`);
const matchesAny = (globs: string[]) => (file: string) => globs.some((g) => globRegExp(g).test(file));

/** Every input that can change a sweep result: the CI-cost fix's filter, pinned. */
const SWEEPS_FILTER = [
  'design-tokens/**',
  'mobile/KokonadaHealth/src/design/v2/color/**',
  'mobile/KokonadaHealth/src/design/v2/tokens/**',
  'mobile/KokonadaHealth/src/design/v2/field/**',
  'mobile/KokonadaHealth/src/design/v2/clock/**',
  'mobile/KokonadaHealth/src/design/v2/motion/**',
  'mobile/KokonadaHealth/jest.sweeps.config.js',
  'mobile/KokonadaHealth/jest.config.js',
  'mobile/KokonadaHealth/package-lock.json',
  '.github/workflows/ci.yml',
];
const SWEEPS_TEST = /\.sweeps\.test\.[mc]?[jt]sx?$/;

describe('the two jest projects (MB-086)', () => {
  const unit = listTests('unit');
  const skia = listTests('skia');
  const sweeps = listTests('sweeps', 'jest.sweeps.config.js');
  const disk = testsOnDisk();
  // Lazily, so a missing project fails its own tests rather than the whole file.
  let sweepsSkiaList: string[] | null = null;
  const sweepsSkia = () => (sweepsSkiaList ??= listTests('sweeps-skia', 'jest.sweeps.config.js'));

  it('the walk sees the real suite (a list that finds nothing must fail, not pass)', () => {
    expect(disk.length).toBeGreaterThan(180);
    expect(disk).toContain('src/design/v2/__tests__/skiaSmoke.skia.test.ts');
    expect(unit).toContain('scripts/jest/__tests__/jestProjects.test.ts');
  });

  it('the skia project runs every *.skia.test.* file but the CanvasKit sweeps, and only those', () => {
    expect(skia).toEqual(disk.filter((f) => SKIA_TEST.test(f) && !SWEEPS_SKIA_TEST.test(f)));
    expect(skia.length).toBeGreaterThan(0);
  });

  it('the sweeps-skia project runs every *.sweeps.skia.test.* file, and only those', () => {
    expect(sweepsSkia()).toEqual(disk.filter((f) => SWEEPS_SKIA_TEST.test(f)));
    expect(sweepsSkia()).toContain('src/design/v2/field/__tests__/fieldScenes.sweeps.skia.test.ts');
  });

  it('the sweeps project runs every *.sweeps.test.* file, and only those (UI-073)', () => {
    expect(sweeps).toEqual(disk.filter((f) => SWEEPS_TEST.test(f)));
    expect(sweeps.length).toBeGreaterThan(0);
  });

  it('the unit project runs every other test, and no *.skia.test.* or *.sweeps.test.* file', () => {
    expect(unit).toEqual(disk.filter((f) => !SKIA_TEST.test(f) && !SWEEPS_TEST.test(f)));
  });

  it('no suite is lost or run twice: unit, skia, sweeps and sweeps-skia together are exactly the tests on disk', () => {
    const all = [unit, skia, sweeps, sweepsSkia()];
    for (const [i, a] of all.entries()) for (const b of all.slice(i + 1)) expect(a.filter((f) => b.includes(f))).toEqual([]);
    expect(all.flat().sort()).toEqual(disk);
  });

  it('the default config has no sweeps project, so `jest` and `jest --ci` keep the coarse grids', () => {
    const config = require('../../../jest.config.js') as { projects: Array<{ displayName: string }> };
    expect(config.projects.map((p) => p.displayName)).toEqual(['unit', 'skia']);
    const sweepsConfig = require('../../../jest.sweeps.config.js') as { projects: Array<{ displayName: string }> };
    expect(sweepsConfig.projects.map((p) => p.displayName)).toEqual(['sweeps', 'sweeps-skia']);
  });

  it('the sweeps-skia project is the skia project’s environment, setup and transforms, by reference', () => {
    const config = require('../../../jest.config.js') as { projects: Array<Record<string, unknown>> };
    const sweepsConfig = require('../../../jest.sweeps.config.js') as { projects: Array<Record<string, unknown>> };
    const skiaProject = config.projects.find((p) => p.displayName === 'skia')!;
    const derived = sweepsConfig.projects.find((p) => p.displayName === 'sweeps-skia')!;
    expect(derived).toBeDefined();
    for (const key of ['testEnvironment', 'setupFiles', 'transform', 'transformIgnorePatterns', 'preset']) expect([key, derived[key]]).toEqual([key, skiaProject[key]]);
    expect(derived.setupFiles).not.toContain('<rootDir>/jest.setup.js');
  });

  it('the skia project does not load the global stubs, and the unit project does', () => {
    const config = require('../../../jest.config.js') as { projects: Array<{ displayName: string; setupFiles?: string[]; testEnvironment?: string }> };
    const byName = Object.fromEntries(config.projects.map((p) => [p.displayName, p]));
    expect(byName.unit.setupFiles).toContain('<rootDir>/jest.setup.js');
    expect(byName.skia.setupFiles ?? []).not.toContain('<rootDir>/jest.setup.js');
    expect(byName.skia.testEnvironment).toBe('@shopify/react-native-skia/jestEnv.js');
  });

  it('lives with the tooling it guards, not in src/design/v2 (whose relative imports must stay inside v2)', () => {
    expect(fs.existsSync(path.join(APP, 'src/design/v2/__tests__/jestProjects.test.ts'))).toBe(false);
  });


  it('CI runs jest as `jest --ci` (no --selectProjects and no paths, so unit and skia always run), and the sweeps with two workers in their own job', () => {
    const runs = ciLines().filter((line) => /node_modules\/\.bin\/jest\b/.test(line)).map((line) => line.trim());
    expect(runs).toEqual(['run: ./node_modules/.bin/jest --ci', 'run: ./node_modules/.bin/jest --ci --config jest.sweeps.config.js --maxWorkers=2']);
  });

  // The CI-cost fix: the full pass never runs inside the always-run mobile job. It has its own job,
  // gated like iOS: skipped (not silently green) on a PR its filter does not match.
  it('the sweeps job is gated by the pinned filter: needs and if on sweeps-changes, read-only token, and the only place the sweeps run', () => {
    const lines = ciLines();
    const job = jobBlock(lines, 'mobile-sweeps').map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith('#'));
    expect(job).toContain('needs: sweeps-changes');
    expect(job).toContain("if: needs.sweeps-changes.outputs.sweeps == 'true'");
    const perms = job.indexOf('permissions:');
    expect(perms).toBeGreaterThan(-1);
    expect(job.slice(perms + 1, perms + 3)).toEqual(['contents: read', 'steps:']);
    expect(job).toContain('run: ./node_modules/.bin/jest --ci --config jest.sweeps.config.js --maxWorkers=2');
    const mobile = jobBlock(lines, 'mobile').join('\n');
    expect(mobile).toContain('run: ./node_modules/.bin/jest --ci');
    expect(mobile).not.toContain('jest.sweeps.config.js');
    const changes = jobBlock(lines, 'sweeps-changes').map((l) => l.trim());
    expect(changes).toContain('sweeps: ${{ steps.filter.outputs.sweeps }}');
    expect(changes).toContain('uses: dorny/paths-filter@v3');
  });

  it('the sweeps filter is exactly the pinned list of every input to a sweep result', () => {
    expect(filterGlobs(jobBlock(ciLines(), 'sweeps-changes'), 'sweeps')).toEqual(SWEEPS_FILTER);
  });

  // Positive control: every file a sweep test actually loads (its relative import closure), the
  // token sources, both jest configs, the lockfile and ci.yml match the filter, and an app screen
  // does not. A sweep module added outside color/, tokens/, field/, clock/ or motion/ would fail here.
  it('the filter covers every file the sweeps load, and only design files', () => {
    const matches = matchesAny(filterGlobs(jobBlock(ciLines(), 'sweeps-changes'), 'sweeps'));
    const { importClosure } = require('../../lab/importGraph.mjs') as { importClosure(entry: string): string[] };
    const repoRel = (f: string) => path.relative(path.resolve(APP, '../..'), f).split(path.sep).join('/');
    const sweepsFiles = testsOnDisk().filter((f) => SWEEPS_TEST.test(f) || SWEEPS_SKIA_TEST.test(f));
    expect(sweepsFiles.length).toBeGreaterThan(0);
    const loaded = [...new Set(sweepsFiles.flatMap((f) => importClosure(path.join(APP, f)).map(repoRel)))].sort();
    expect(loaded).toContain('mobile/KokonadaHealth/src/design/v2/tokens/neverRedSweeps.ts');
    expect(loaded).toContain('mobile/KokonadaHealth/src/design/v2/color/blendSpace.ts');
    expect(loaded).toContain('mobile/KokonadaHealth/src/design/v2/field/placementLedger.ts');
    expect(loaded).toContain('mobile/KokonadaHealth/src/design/v2/field/fieldScenes.ts');
    const tokens = fs.readdirSync(path.resolve(APP, '../../design-tokens')).map((f) => `design-tokens/${f}`);
    expect(tokens.length).toBeGreaterThan(0);
    const inputs = [...loaded, ...tokens, 'mobile/KokonadaHealth/jest.config.js', 'mobile/KokonadaHealth/jest.sweeps.config.js',
      'mobile/KokonadaHealth/package-lock.json', '.github/workflows/ci.yml'];
    expect(inputs.filter((f) => !matches(f))).toEqual([]);
    expect(matches('mobile/KokonadaHealth/src/experience/wheel/wheelGeometry.ts')).toBe(false);
  });

  // The macOS job costs real minutes, so a change to the jest split must never start it.
  it('the iOS paths filter matches neither jest config nor ci.yml', () => {
    const globs = filterGlobs(jobBlock(ciLines(), 'ios-changes'), 'ios');
    const matches = matchesAny(globs);
    expect(matches('mobile/KokonadaHealth/ios/Podfile')).toBe(true); // the parse sees the real filter
    expect(['mobile/KokonadaHealth/jest.config.js', 'mobile/KokonadaHealth/jest.sweeps.config.js', '.github/workflows/ci.yml'].filter(matches)).toEqual([]);
  });
});
