/// <reference types="node" />
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';

// CI runs mobile jest split across ordinary runners (the owner's instruction of 2026-11-22: bring the check
// from about 25 minutes toward five). What holds, and is checked here:
//   · mobile-jest-shard runs `jest --ci --shard=<i>/8` on eight runners, and mobile-sweeps-shard runs
//     jest.sweeps.config.js on four, two workers each. jest deals a config's suites to its shards by a hash of
//     their path, so the shards of a config together run exactly the suites its unsharded run does, and none
//     twice. That is asked of jest itself (--listTests), never assumed from the flag.
//   · mobile-lab runs what followed the tests in the single job: the design-system lint and both Design Lab
//     exclusions.
//   · two gates keep the old jobs' names. "Mobile — jest", a required check of the ruleset on main, needs every
//     jest shard and the lab job; "Mobile — never-red sweeps at full resolution" needs sweeps-changes and every
//     sweep shard. Each passes only when every job it needs succeeded. A job skipped by its `if` reports success
//     to a required check, so "Mobile — jest" always runs: a failed, cancelled or skipped shard turns it red.
//   · the gates' script runs here under bash, the way the runner runs it, on each result GitHub can hand it.
//   · every runner repeats checkout and `npm ci`, so the caches matter, and they hold downloads only: npm's
//     (setup-node) and, for the Android compile check, Gradle's (setup-java). Nothing a check runs on is cached.

const APP = path.resolve(__dirname, '../../..');
const CI = path.resolve(APP, '../../.github/workflows/ci.yml');
const APP_DIR = 'mobile/KokonadaHealth';
const rel = (f: string) => path.relative(APP, f).split(path.sep).join('/');

/** The shard counts ci.yml runs, and the workers of each sweeps shard (its --maxWorkers). */
const JEST_SHARDS = 8;
const SWEEP_SHARDS = 4;
const SWEEP_WORKERS = 2;
const shardsOf = (count: number) => Array.from({ length: count }, (_, i) => i + 1);

// ci.yml read as YAML, through the js-yaml that eslint (a declared devDependency) depends on, not as lines.
const yaml = require(require.resolve('js-yaml', { paths: [path.dirname(require.resolve('eslint/package.json'))] })) as {
  load(text: string): unknown;
};

interface Step { name?: string; uses?: string; run?: string; env?: Record<string, unknown>; [key: string]: unknown }
interface Job { name?: string; needs?: string | string[]; if?: string; steps?: Step[]; [key: string]: unknown }
const jobs = (yaml.load(fs.readFileSync(CI, 'utf8')) as { jobs: Record<string, Job> }).jobs;

function job(id: string): Job {
  const found = jobs[id];
  if (!found) throw new Error(`ci.yml has no job ${id}`);
  return found;
}
function stepNamed(of: Job, name: string): Step {
  const found = (of.steps ?? []).find((s) => s.name === name);
  if (!found) throw new Error(`no step named "${name}"`);
  return found;
}
const gateStep = (id: string): Step => {
  const steps = job(id).steps ?? [];
  if (steps.length !== 1) throw new Error(`the gate ${id} has ${steps.length} steps, not one`);
  return steps[0];
};

const SETUP = [
  { uses: 'actions/checkout@v4' },
  { uses: 'actions/setup-node@v4', with: { 'node-version': '24', cache: 'npm', 'cache-dependency-path': `${APP_DIR}/package-lock.json` } },
  { name: 'Install dependencies', run: 'npm ci', 'working-directory': APP_DIR },
];
const GATE_RESULTS = "${{ join(needs.*.result, ' ') }}";
const SHARD_ENV = (count: number) => ({ SHARD: `\${{ matrix.shard }}/${count}` });

/** The suites jest would run for these arguments, relative to the app, sorted. */
function listTests(args: string[]): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const what = `jest --ci --listTests --json ${args.join(' ')}`;
    const child = spawn(process.execPath, [path.join(APP, 'node_modules/jest/bin/jest.js'), '--ci', '--listTests', '--json', ...args], {
      cwd: APP, windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    // Decoded by the stream, so a character split across two chunks still reads whole.
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (text: string) => { stdout += text; });
    child.stderr.on('data', (text: string) => { stderr += text; });
    child.on('error', reject);
    child.on('close', (code: number | null) => {
      if (code !== 0) { reject(new Error(`${what} exited ${code}: ${stderr}`)); return; }
      let files: unknown;
      try { files = JSON.parse(stdout); } catch { reject(new Error(`${what} printed no JSON list: ${stdout.slice(0, 300)}`)); return; }
      // Anything that is not a list of existing absolute paths is refused rather than read as test files.
      if (!Array.isArray(files) || files.some((f) => typeof f !== 'string' || !path.isAbsolute(f) || !fs.existsSync(f))) {
        reject(new Error(`${what} printed something that is not a list of test files`));
        return;
      }
      resolve((files as string[]).map(rel).sort());
    });
  });
}

/** Runs the tasks, at most `size` at a time, and keeps their order. */
async function inPool<T>(tasks: Array<() => Promise<T>>, size: number): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next;
      next += 1;
      out[i] = await tasks[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, tasks.length) }, worker));
  return out;
}

describe('the shards of each config run exactly the suites its unsharded run does (asked of jest)', () => {
  const SWEEPS = ['--config', 'jest.sweeps.config.js'];
  let lists: { jest: string[]; jestShards: string[][]; sweeps: string[]; sweepShards: string[][] } | null = null;

  beforeAll(async () => {
    const [jest, sweeps, ...shards] = await inPool<string[]>([
      () => listTests([]),
      () => listTests(SWEEPS),
      ...shardsOf(JEST_SHARDS).map((i) => () => listTests([`--shard=${i}/${JEST_SHARDS}`])),
      ...shardsOf(SWEEP_SHARDS).map((i) => () => listTests([...SWEEPS, `--shard=${i}/${SWEEP_SHARDS}`])),
    ], 4);
    lists = { jest, sweeps, jestShards: shards.slice(0, JEST_SHARDS), sweepShards: shards.slice(JEST_SHARDS) };
  }, 300000);

  const got = () => {
    if (!lists) throw new Error('the listings did not run');
    return lists;
  };

  it('the listings see the real suites (a list that finds nothing must fail, not pass)', () => {
    expect(got().jest.length).toBeGreaterThan(300);
    expect(got().jest).toContain('scripts/jest/__tests__/ciShards.test.ts');
    expect(got().jest).toContain('src/design/lab/__tests__/grainFrames.skia.test.ts');
    expect(got().sweeps).toContain('src/design/v2/tokens/__tests__/neverRed.full.abyss.sweeps.test.ts');
  });

  it.each([
    ['the default config (mobile-jest-shard)', JEST_SHARDS, 'jest' as const, 'jestShards' as const],
    ['jest.sweeps.config.js (mobile-sweeps-shard)', SWEEP_SHARDS, 'sweeps' as const, 'sweepShards' as const],
  ])('%s over its %i shards: no shard empty, no suite in two shards, no suite in none', (_label, count, allKey, shardsKey) => {
    const all = got()[allKey];
    const shards = got()[shardsKey];
    expect(shards).toHaveLength(count);
    expect(shards.map((s) => s.length > 0)).toEqual(shardsOf(count).map(() => true));
    // Equal as multisets: every suite lands in some shard, and in one only.
    expect(shards.flat().sort()).toEqual(all);
  });

  it('gives every sweep file a worker of its own: no sweeps shard holds more files than its two workers', () => {
    expect(Math.max(...got().sweepShards.map((s) => s.length))).toBeLessThanOrEqual(SWEEP_WORKERS);
    expect(Math.ceil(got().sweeps.length / SWEEP_SHARDS)).toBeLessThanOrEqual(SWEEP_WORKERS);
  });
});

describe('ci.yml: mobile jest on eight runners, behind the gate "Mobile — jest"', () => {
  it('mobile-jest-shard runs `jest --ci --shard=<i>/8` for every i from 1 to 8, and a red shard cancels no other', () => {
    const shard = job('mobile-jest-shard');
    expect(shard.name).toBe(`Mobile — jest shard \${{ matrix.shard }}/${JEST_SHARDS}`);
    expect(shard.strategy).toEqual({ 'fail-fast': false, matrix: { shard: shardsOf(JEST_SHARDS) } });
    expect(stepNamed(shard, 'Run tests')).toEqual({
      name: 'Run tests', env: SHARD_ENV(JEST_SHARDS), run: './node_modules/.bin/jest --ci --shard="$SHARD"', 'working-directory': APP_DIR,
    });
  });

  it('mobile-lab runs the design-system lint and both Design Lab exclusions, the steps that followed the tests in the single job', () => {
    const lab = job('mobile-lab');
    expect(lab.name).toBe('Mobile — design-system lint and Design Lab exclusion');
    expect((lab.steps ?? []).slice(SETUP.length)).toEqual([
      { name: 'Design-system lint', run: 'npm run lint:design-system', 'working-directory': APP_DIR },
      { name: 'Design Lab exclusion', run: 'node scripts/lab/assertLabExcluded.mjs', 'working-directory': APP_DIR },
      { name: 'Design Lab exclusion (iOS bundle)', run: 'node scripts/lab/assertLabExcluded.mjs --platform ios', 'working-directory': APP_DIR },
    ]);
  });

  it('every jest shard and the lab job set up as the single job did, always start, and cannot skip or soften a step', () => {
    for (const id of ['mobile-jest-shard', 'mobile-lab']) {
      const j = job(id);
      expect([id, j['runs-on']]).toEqual([id, 'ubuntu-24.04']);
      // No job-level permissions: they keep the workflow's contents: read.
      for (const key of ['if', 'needs', 'continue-on-error', 'permissions']) expect([id, key, j[key]]).toEqual([id, key, undefined]);
      expect([id, Number.isInteger(j['timeout-minutes']) && (j['timeout-minutes'] as number) > 0]).toEqual([id, true]);
      expect((j.steps ?? []).slice(0, SETUP.length)).toEqual(SETUP);
      for (const s of j.steps ?? []) {
        for (const key of ['if', 'continue-on-error']) expect([id, s.name ?? s.uses, key, s[key]]).toEqual([id, s.name ?? s.uses, key, undefined]);
      }
    }
  });

  it('"Mobile — jest" is a gate: it needs every jest shard and the lab job, always runs, holds no token scope, and checks every result', () => {
    const gate = job('mobile');
    expect(gate.name).toBe('Mobile — jest');
    expect(gate['runs-on']).toBe('ubuntu-24.04');
    expect(gate.needs).toEqual(['mobile-jest-shard', 'mobile-lab']);
    expect(gate.if).toBe('always()');
    expect(gate.permissions).toEqual({});
    expect(gate['continue-on-error']).toBeUndefined();
    const step = gateStep('mobile');
    expect(step.uses).toBeUndefined();
    expect(step.env).toEqual({ RESULTS: GATE_RESULTS, NEEDED: String((gate.needs as string[]).length) });
  });

  it('the gate needs every job that runs the default jest config or the lab checks, and the shard job is the only one that runs that config', () => {
    const LAB_RUNS = ['npm run lint:design-system', 'node scripts/lab/assertLabExcluded.mjs', 'node scripts/lab/assertLabExcluded.mjs --platform ios'];
    const runs = (id: string) => (jobs[id].steps ?? []).map((s) => (s.run ?? '').trim());
    const defaultJest = (r: string) => /node_modules\/\.bin\/jest\b/.test(r) && !/jest\.sweeps\.config\.js/.test(r);
    const owners = Object.keys(jobs).filter((id) => runs(id).some((r) => defaultJest(r) || LAB_RUNS.includes(r))).sort();
    expect(owners).toEqual(['mobile-jest-shard', 'mobile-lab']);
    expect([...(job('mobile').needs as string[])].sort()).toEqual(owners);
    expect(Object.keys(jobs).filter((id) => runs(id).some(defaultJest))).toEqual(['mobile-jest-shard']);
  });
});

describe('ci.yml: the never-red sweeps on four runners, gated by sweeps-changes as before', () => {
  it('mobile-sweeps-shard runs jest.sweeps.config.js with two workers for every shard from 1 to 4, only when sweeps-changes fired', () => {
    const shard = job('mobile-sweeps-shard');
    expect(shard.name).toBe(`Mobile — never-red sweeps shard \${{ matrix.shard }}/${SWEEP_SHARDS}`);
    expect(shard['runs-on']).toBe('ubuntu-24.04');
    expect(shard.needs).toBe('sweeps-changes');
    expect(shard.if).toBe("needs.sweeps-changes.outputs.sweeps == 'true'");
    expect(shard.permissions).toEqual({ contents: 'read' });
    expect(shard.strategy).toEqual({ 'fail-fast': false, matrix: { shard: shardsOf(SWEEP_SHARDS) } });
    expect(Number.isInteger(shard['timeout-minutes']) && (shard['timeout-minutes'] as number) > 0).toBe(true);
    expect((shard.steps ?? []).slice(0, SETUP.length)).toEqual(SETUP);
    expect((shard.steps ?? []).slice(SETUP.length)).toEqual([{
      name: 'Never-red sweeps at full resolution',
      env: SHARD_ENV(SWEEP_SHARDS),
      run: `./node_modules/.bin/jest --ci --config jest.sweeps.config.js --maxWorkers=${SWEEP_WORKERS} --shard="$SHARD"`,
      'working-directory': APP_DIR,
    }]);
  });

  it('"Mobile — never-red sweeps at full resolution" is a gate on sweeps-changes and every sweep shard, run whenever the filter fired and skipped, not green, when it did not', () => {
    const gate = job('mobile-sweeps');
    expect(gate.name).toBe('Mobile — never-red sweeps at full resolution');
    expect(gate['runs-on']).toBe('ubuntu-24.04');
    expect(gate.needs).toEqual(['sweeps-changes', 'mobile-sweeps-shard']);
    expect(gate.if).toBe("always() && needs.sweeps-changes.outputs.sweeps == 'true'");
    expect(gate.permissions).toEqual({});
    const step = gateStep('mobile-sweeps');
    expect(step.env).toEqual({ RESULTS: GATE_RESULTS, NEEDED: String((gate.needs as string[]).length) });
    expect(step.run).toBe(gateStep('mobile').run);
  });
});

// The runners cache downloads only: npm's tarballs (setup-node, keyed by a lockfile) and Gradle's dependencies and
// distribution (setup-java, keyed by the files that decide them). Neither holds node_modules, a jest cache or a
// build output, so every check still installs, transforms and compiles what the checkout holds.
const GRADLE_KEY = [
  'mobile/KokonadaHealth/android/**/*.gradle*',
  'mobile/KokonadaHealth/android/gradle.properties',
  'mobile/KokonadaHealth/android/gradle/wrapper/gradle-wrapper.properties',
  'mobile/KokonadaHealth/package-lock.json',
];

describe('ci.yml caches downloads only, never what a check runs on', () => {
  const allSteps = Object.entries(jobs).flatMap(([id, j]) => (j.steps ?? []).map((s) => ({ id, s })));
  const uses = (re: RegExp) => allSteps.filter(({ s }) => re.test(s.uses ?? ''));

  it('no job uses actions/cache: the only caches are the setup actions\' own', () => {
    expect(uses(/^actions\/cache\b/)).toEqual([]);
    expect(uses(/^actions\/setup-node@/).length).toBeGreaterThan(0);
  });

  it('every setup-node caches npm by a lockfile that exists', () => {
    for (const { id, s } of uses(/^actions\/setup-node@/)) {
      const w = (s.with ?? {}) as Record<string, unknown>;
      expect([id, w.cache]).toEqual([id, 'npm']);
      expect([id, w['cache-dependency-path']]).toEqual([id, expect.stringMatching(/(^|\/)package-lock\.json$/)]);
      expect([id, fs.existsSync(path.resolve(APP, '../..', String(w['cache-dependency-path'])))]).toEqual([id, true]);
    }
  });

  it('the Android compile check caches Gradle through setup-java, keyed by the Gradle files, its properties, the wrapper and the app lockfile', () => {
    const java = uses(/^actions\/setup-java@/);
    expect(java.map(({ id }) => id)).toEqual(['mobile-android-compile']);
    expect(java[0].s.with).toEqual({
      distribution: 'temurin', 'java-version': '17', cache: 'gradle', 'cache-dependency-path': `${GRADLE_KEY.join('\n')}\n`,
    });
    // setup-java fails the job when a key pattern matches nothing, so each must match a tracked file.
    const repo = path.resolve(APP, '../..');
    const gradleFiles = fs.readdirSync(path.join(APP, 'android')).filter((f) => /\.gradle/.test(f));
    expect(gradleFiles).toEqual(expect.arrayContaining(['build.gradle', 'settings.gradle']));
    for (const file of GRADLE_KEY.slice(1)) expect([file, fs.existsSync(path.join(repo, file))]).toEqual([file, true]);
  });
});

// GitHub runs a `run:` script that names no shell as `bash -e {0}`. On Windows the bash that ships with git is
// used: a bare `bash` there can resolve to the WSL launcher, which cannot see these paths.
function bashPath(): string {
  if (process.platform !== 'win32') return 'bash';
  const execPath = spawnSync('git', ['--exec-path'], { encoding: 'utf8' }).stdout.trim();
  const gitRoot = path.resolve(execPath, '..', '..', '..');
  return [path.join(gitRoot, 'usr', 'bin', 'bash.exe'), path.join(gitRoot, 'bin', 'bash.exe')].find((p) => fs.existsSync(p)) ?? 'bash';
}

describe("the gates' script, run under bash, on each result GitHub can hand it", () => {
  const BASH = bashPath();

  function gate(results: string, needed: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci gate '));
    try {
      const file = path.join(dir, 'gate.sh');
      fs.writeFileSync(file, `${gateStep('mobile').run}\n`, 'utf8');
      const r = spawnSync(BASH, ['-e', file.split(path.sep).join('/')], {
        env: { ...process.env, RESULTS: results, NEEDED: needed }, encoding: 'utf8', windowsHide: true,
      });
      if (r.error) throw r.error;
      return { code: r.status, out: `${r.stdout}${r.stderr}` };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it.each([
    ['every needed job succeeded', 'success success', '2', 0],
    ['a jest shard failed', 'failure success', '2', 1],
    ['the lab job failed', 'success failure', '2', 1],
    ['a shard was cancelled', 'cancelled success', '2', 1],
    ['a shard was skipped', 'success skipped', '2', 1],
    ['no result at all (a misspelt expression reads as nothing)', '', '2', 1],
    ['a result fewer than the jobs needed', 'success', '2', 1],
    ['a result more than the jobs needed', 'success success success', '2', 1],
    ['a result that is not exactly success', 'Success success', '2', 1],
    ['no count to hold the results to', 'success success', '', 1],
    ['a count of none, so nothing would be checked', '', '0', 1],
  ])('%s: RESULTS "%s", NEEDED "%s" → exit %i', (_case, results, needed, code) => {
    const r = gate(results, needed);
    expect(r.code).toBe(code);
    expect(/::error::/.test(r.out)).toBe(code !== 0);
  });
});
