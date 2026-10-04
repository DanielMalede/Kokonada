/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

// MB-086. Mobile jest runs two projects:
//   · unit — the existing configuration, with the global stubs (jest.setup.js), every test except
//     *.skia.test.*;
//   · skia — Skia's CanvasKit environment, *.skia.test.* only, and never the Skia stub.
//   · sweeps — UI-073's full-resolution never-red pass, *.sweeps.test.* only, in its own config
//     (jest.sweeps.config.js), so `jest` and `jest --ci` never run it; CI runs it serially, in its
//     own step after the default run.
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
const SWEEPS_TEST = /\.sweeps\.test\.[mc]?[jt]sx?$/;

describe('the two jest projects (MB-086)', () => {
  const unit = listTests('unit');
  const skia = listTests('skia');
  const sweeps = listTests('sweeps', 'jest.sweeps.config.js');
  const disk = testsOnDisk();

  it('the walk sees the real suite (a list that finds nothing must fail, not pass)', () => {
    expect(disk.length).toBeGreaterThan(180);
    expect(disk).toContain('src/design/v2/__tests__/skiaSmoke.skia.test.ts');
    expect(unit).toContain('scripts/jest/__tests__/jestProjects.test.ts');
  });

  it('the skia project runs every *.skia.test.* file, and only those', () => {
    expect(skia).toEqual(disk.filter((f) => SKIA_TEST.test(f)));
    expect(skia.length).toBeGreaterThan(0);
  });

  it('the sweeps project runs every *.sweeps.test.* file, and only those (UI-073)', () => {
    expect(sweeps).toEqual(disk.filter((f) => SWEEPS_TEST.test(f)));
    expect(sweeps.length).toBeGreaterThan(0);
  });

  it('the unit project runs every other test, and no *.skia.test.* or *.sweeps.test.* file', () => {
    expect(unit).toEqual(disk.filter((f) => !SKIA_TEST.test(f) && !SWEEPS_TEST.test(f)));
  });

  it('no suite is lost or run twice: unit, skia and sweeps together are exactly the tests on disk', () => {
    expect(unit.filter((f) => skia.includes(f) || sweeps.includes(f))).toEqual([]);
    expect(skia.filter((f) => sweeps.includes(f))).toEqual([]);
    expect([...unit, ...skia, ...sweeps].sort()).toEqual(disk);
  });

  it('the default config has no sweeps project, so `jest` and `jest --ci` keep the coarse grids', () => {
    const config = require('../../../jest.config.js') as { projects: Array<{ displayName: string }> };
    expect(config.projects.map((p) => p.displayName)).toEqual(['unit', 'skia']);
    const sweepsConfig = require('../../../jest.sweeps.config.js') as { projects: Array<{ displayName: string }> };
    expect(sweepsConfig.projects.map((p) => p.displayName)).toEqual(['sweeps']);
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


  it('CI runs jest as `jest --ci` (no --selectProjects and no paths, so unit and skia always run), then the sweeps serially in their own step', () => {
    const ci = fs.readFileSync(path.resolve(APP, '../../.github/workflows/ci.yml'), 'utf8');
    const runs = ci.split(/\r?\n/).filter((line) => /node_modules\/\.bin\/jest\b/.test(line)).map((line) => line.trim());
    expect(runs).toEqual(['run: ./node_modules/.bin/jest --ci', 'run: ./node_modules/.bin/jest --ci --config jest.sweeps.config.js --runInBand']);
  });

  it('both jest steps are in the mobile job, the sweeps right after the default run', () => {
    const ci = fs.readFileSync(path.resolve(APP, '../../.github/workflows/ci.yml'), 'utf8').split(/\r?\n/);
    const job = ci.slice(ci.indexOf('  mobile:'), ci.indexOf('  mobile-android-compile:'))
      .map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith('#'));
    const start = job.indexOf('run: ./node_modules/.bin/jest --ci');
    expect(start).toBeGreaterThan(-1);
    expect(job.slice(start, start + 4)).toEqual([
      'run: ./node_modules/.bin/jest --ci',
      'working-directory: mobile/KokonadaHealth',
      '- name: Never-red sweeps at full resolution (UI-073)',
      'run: ./node_modules/.bin/jest --ci --config jest.sweeps.config.js --runInBand',
    ]);
  });

  // The macOS job costs real minutes, so a change to the jest split must never start it.
  it('the iOS paths filter matches neither jest config nor ci.yml', () => {
    const ci = fs.readFileSync(path.resolve(APP, '../../.github/workflows/ci.yml'), 'utf8').split(/\r?\n/);
    const job = ci.slice(ci.indexOf('  ios-changes:'), ci.indexOf('  mobile-ios-build:'));
    const globs = job.slice(job.findIndex((l) => l.trim() === 'ios:') + 1)
      .map((l) => l.trim()).filter((l) => l.startsWith("- '")).map((l) => l.slice(3, -1));
    // A glob as paths-filter reads it: ** crosses folders, * does not.
    const toRegExp = (glob: string) =>
      new RegExp(`^${glob.split('**').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('.*')}$`);
    const matches = (file: string) => globs.some((g) => toRegExp(g).test(file));
    expect(matches('mobile/KokonadaHealth/ios/Podfile')).toBe(true); // the parse sees the real filter
    expect(['mobile/KokonadaHealth/jest.config.js', 'mobile/KokonadaHealth/jest.sweeps.config.js', '.github/workflows/ci.yml'].filter(matches)).toEqual([]);
  });
});
