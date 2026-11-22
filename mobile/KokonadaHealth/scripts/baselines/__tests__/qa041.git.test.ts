/// <reference types="node" />
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { TestCounts } from '../testCounts';
import { decide, type FloorList, type FloorTree, type Inputs, type Loaded, type HeadFacts, type RuleId } from '../qa041.ts';
import { floorTree, git, headFacts, locator, readResultFiles, runGit, type Git } from '../qa041Sources.ts';

// QA-041 proper (OPS-412 part A), plan steps 6 and 7: the git and fs adapters on real repositories made in
// os.tmpdir() (D8 rule 2), with git's own config isolated from the machine's. The tree at the floor SHA,
// its ancestry, a --depth 1 clone, a git missing from the PATH or slow, and HEAD's parents and commit time
// are all read by the real git; the verdicts come from the pure core. The repository mirrors the app's
// place in this one (mobile/KokonadaHealth), with a backend beside it.

const T_FLOOR = 1_790_000_000; // seconds
const T_LATER = T_FLOOR + 3_600;
const T_PR = T_FLOOR + 7_200;
const T_MAIN = T_FLOOR + 10_800;
const T_MERGE = T_FLOOR + 14_400;
const AFTER_MERGE = T_MERGE * 1000 + 60_000; // a run that started a minute after HEAD was committed

let tmp = '';
let repo = '';
let app = '';
let shallowApp = '';
const sha: Record<'floor' | 'later' | 'pr' | 'main' | 'merge' | 'side', string> = { floor: '', later: '', pr: '', main: '', merge: '', side: '' };

/** git for building the planted repositories: the machine's config, hooks and signing kept out. */
function build(cwd: string, args: string[], at?: number): string {
  const date = at === undefined ? {} : { GIT_AUTHOR_DATE: new Date(at * 1000).toISOString(), GIT_COMMITTER_DATE: new Date(at * 1000).toISOString() };
  const r = spawnSync('git', ['-c', `core.hooksPath=${path.join(tmp, 'no-hooks')}`, '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', '-c', 'init.defaultBranch=main', ...args], {
    cwd, encoding: 'utf8', timeout: 60_000, windowsHide: true,
    env: { ...process.env, ...date, GIT_CONFIG_GLOBAL: path.join(tmp, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'planted', GIT_AUTHOR_EMAIL: 'planted@example.invalid', GIT_COMMITTER_NAME: 'planted', GIT_COMMITTER_EMAIL: 'planted@example.invalid' },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed (${r.status}): ${r.stderr}${r.error ? r.error.message : ''}`);
  return r.stdout.trim();
}
const put = (rel: string, text = 'planted\n') => {
  const file = path.join(app, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const commit = (message: string, at: number): string => {
  build(repo, ['add', '-A']);
  build(repo, ['commit', '-q', '--allow-empty', '-m', message], at);
  return build(repo, ['rev-parse', 'HEAD']);
};

// The test files at the floor SHA, as the jestProjects walk sees them: under __tests__ or named *.test.* /
// *.spec.*, never under node_modules. src/a/A.ts and the backend's test are no test files of the app.
const FLOOR_PATHS = ['__tests__/App.test.tsx', 'src/__tests__/helper.ts', 'src/a/__tests__/A.test.ts', 'src/b/B.spec.js'];

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qa041-git-'));
  fs.mkdirSync(path.join(tmp, 'no-hooks'));
  fs.writeFileSync(path.join(tmp, 'gitconfig'), '');
  repo = path.join(tmp, 'repo');
  app = path.join(repo, 'mobile', 'KokonadaHealth');
  fs.mkdirSync(app, { recursive: true });
  build(repo, ['init', '-q']);
  for (const p of FLOOR_PATHS) put(p);
  put('src/a/A.ts');
  put('node_modules/p/__tests__/n.test.js');
  put('package.json', '{}\n');
  fs.mkdirSync(path.join(repo, 'backend', 'tests'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'backend', 'tests', 'x.test.js'), 'planted\n');
  sha.floor = commit('floor', T_FLOOR);
  put('src/c/C.test.ts');
  sha.later = commit('a test file added after the floor', T_LATER);
  build(repo, ['checkout', '-q', '-b', 'pr']);
  put('src/d/D.test.ts');
  sha.pr = commit('the pull request', T_PR);
  build(repo, ['checkout', '-q', 'main']);
  fs.writeFileSync(path.join(repo, 'README.md'), 'main moved\n');
  sha.main = commit('main moves on', T_MAIN);
  build(repo, ['merge', '-q', '--no-ff', '-m', 'the pull-request merge ref', 'pr'], T_MERGE);
  sha.merge = build(repo, ['rev-parse', 'HEAD']);
  build(repo, ['checkout', '-q', '-b', 'side', sha.floor]);
  put('src/e/E.test.ts');
  sha.side = commit('a branch never merged', T_LATER);
  build(repo, ['checkout', '-q', 'main']);
  build(tmp, ['clone', '-q', '--depth', '1', pathToFileURL(repo).href, 'shallow']);
  shallowApp = path.join(tmp, 'shallow', 'mobile', 'KokonadaHealth');
}, 120_000);

afterAll(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

/**
 * The real git lookup with a PATH that holds no git: the child's environment is passed, because jest gives
 * a test file its own copy of process.env and child_process spawns with the worker's real one.
 */
const noGit: Git = (args, cwd) => runGit(args, cwd, { env: { PATH: fs.mkdtempSync(path.join(tmp, 'empty-bin-')) } });
const hanging = (cwd: string) => runGit(['-c', 'alias.hang=!sleep 5', 'hang'], cwd, { timeoutMs: 300 });

// An in-memory run of the files at HEAD (two passing tests each) that the real locator finds on disk.
const HEAD_FILES = [...FLOOR_PATHS, 'src/c/C.test.ts', 'src/d/D.test.ts'];
function runText(startTime = AFTER_MERGE, root = app): string {
  const testResults = HEAD_FILES.map((rel) => ({
    name: path.join(root, ...rel.split('/')),
    assertionResults: [0, 1].map((i) => ({ fullName: `${rel} t${i}`, status: 'passed', title: `t${i}`, ancestorTitles: [] })),
  }));
  const n = testResults.length * 2;
  return JSON.stringify({
    numTotalTestSuites: testResults.length, numTotalTests: n, numPassedTests: n, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0,
    numRuntimeErrorTestSuites: 0, wasInterrupted: false, startTime, success: true, testResults,
  });
}

function counts(floor: FloorList): TestCounts {
  const files = Object.fromEntries(floor.paths.map((p) => [p, [2, 0, 0] as const]));
  const measured = { numTotalTestSuites: floor.paths.length, numTotalTests: floor.paths.length * 2, numPendingTests: 0, numTodoTests: 0 };
  return {
    sha: floor.sha, measuredAt: '2026-11-17T15:12:06Z', node: 'v24.19.0', jest: '29.7.0',
    command: { mobile: './node_modules/.bin/jest --ci --json', backend: './node_modules/.bin/jest --ci --json --runInBand --forceExit' },
    mobile: measured, backend: measured, files: { mobile: files },
  };
}

const FLOOR = (): FloorList => ({ sha: sha.floor, listTestsCount: FLOOR_PATHS.length, paths: FLOOR_PATHS });

function mobile(over: { floor?: FloorList; tree?: FloorTree; head?: string; facts?: Loaded<HeadFacts>; startTime?: number } = {}): Inputs {
  const floor = over.floor ?? FLOOR();
  return {
    pkg: 'mobile',
    head: over.head ?? sha.pr,
    results: [{ file: 'jest.json', text: runText(over.startTime) }],
    locate: locator(app),
    headFacts: over.facts ?? headFacts(app),
    counts: { value: counts(floor) },
    retire: { value: [] },
    manifest: { value: { 'CON-1': [{ file: 'src/a/__tests__/A.test.ts', fullTitle: 'src/a/__tests__/A.test.ts t0' }] } },
    floor: { value: floor },
    floorTree: over.tree ?? floorTree(app, floor.sha),
    decStatus: () => null,
  };
}
const only = (rule: RuleId): ReadonlySet<RuleId> => new Set([rule]);

describe('QA-041 · RA-9 on real trees (plan step 6)', () => {
  it('the tree at the floor SHA is every blob under the app, relative to it; the walk keeps the test files', () => {
    const tree = floorTree(app, sha.floor);
    expect(tree).toEqual({ state: 'ok', paths: expect.arrayContaining([...FLOOR_PATHS, 'src/a/A.ts', 'package.json', 'node_modules/p/__tests__/n.test.js']) });
    expect(tree.state === 'ok' && tree.paths.filter((p) => p.startsWith('..') || p.includes('backend'))).toEqual([]);
  });

  it('a floor list equal to the tree at its SHA exits 0, every rule on', () => {
    const v = decide(mobile());
    expect(v.lines.filter((l) => l.startsWith('RA-9'))).toEqual([`RA-9: TEST_FLOOR.paths is the 4 test files of the tree at ${sha.floor.slice(0, 12)}, and the per-file record names the same files`]);
    expect(v.exit).toBe(0);
  });

  it('planted: a test file of the tree missing from the data exits 1', () => {
    const floor = { ...FLOOR(), listTestsCount: 3, paths: FLOOR_PATHS.filter((p) => p !== 'src/b/B.spec.js') };
    const v = decide(mobile({ floor }), only('RA-9'));
    expect(v).toEqual({ exit: 1, lines: [
      `RA-9: TEST_FLOOR.listTestsCount is 3, but the tree at ${sha.floor.slice(0, 12)} has 4 test files`,
      `RA-9: src/b/B.spec.js is a test file in the tree at ${sha.floor.slice(0, 12)}, but TEST_FLOOR.paths leaves it out`,
    ] });
    expect(decide(mobile({ floor }), new Set<RuleId>()).exit).toBe(0);
  });

  it('planted: a fabricated path in the data exits 1', () => {
    const floor = { ...FLOOR(), listTestsCount: 5, paths: [...FLOOR_PATHS, 'src/z/Z.test.ts'].sort() };
    expect(decide(mobile({ floor }), only('RA-9'))).toEqual({ exit: 1, lines: [
      `RA-9: TEST_FLOOR.listTestsCount is 5, but the tree at ${sha.floor.slice(0, 12)} has 4 test files`,
      `RA-9: TEST_FLOOR.paths names src/z/Z.test.ts, which is no test file in the tree at ${sha.floor.slice(0, 12)}`,
    ] });
  });

  it('planted: a floor SHA absent from the clone exits 2', () => {
    const floor = { ...FLOOR(), sha: 'f'.repeat(40) };
    expect(floorTree(app, floor.sha)).toEqual({ state: 'absent', shallow: false });
    expect(decide(mobile({ floor }))).toEqual({ exit: 2, lines: ['RA-9: TEST_FLOOR.sha ffffffffffff is not in this clone'] });
  });

  it('planted: a floor SHA present but not an ancestor of HEAD exits 1', () => {
    expect(floorTree(app, sha.side)).toEqual({ state: 'notAncestor', shallow: false });
    const floor = { ...FLOOR(), sha: sha.side };
    expect(decide(mobile({ floor }), only('RA-9'))).toEqual({ exit: 1, lines: [`RA-9: TEST_FLOOR.sha ${sha.side} is not an ancestor of HEAD`] });
  });

  it('planted: a --depth 1 clone exits 2 (the floor SHA is not in it)', () => {
    expect(floorTree(shallowApp, sha.floor)).toEqual({ state: 'absent', shallow: true });
    const v = decide({ ...mobile({ tree: floorTree(shallowApp, sha.floor) }), locate: locator(shallowApp), results: [{ file: 'jest.json', text: runText(AFTER_MERGE, shallowApp) }], headFacts: headFacts(shallowApp) });
    expect(v).toEqual({ exit: 2, lines: [`RA-9: TEST_FLOOR.sha ${sha.floor.slice(0, 12)} is not in this clone, a shallow one (check out with fetch-depth: 0)`] });
  });

  it('planted: git not on the PATH exits 2, for the tree and for HEAD', () => {
    const tree = floorTree(app, sha.floor, noGit);
    const facts = headFacts(app, noGit);
    expect(tree).toEqual({ state: 'error', reason: expect.stringMatching(/^git is not on the PATH/) });
    expect(facts).toEqual({ error: expect.stringMatching(/^git is not on the PATH/) });
    expect(decide(mobile({ tree })).exit).toBe(2);
    expect(decide(mobile({ facts }))).toEqual({ exit: 2, lines: [expect.stringMatching(/^cannot bind the results to a commit: git is not on the PATH/)] });
  });

  it('planted: a git that hangs is killed at its timeout and exits 2, never read as an absent or foreign SHA', () => {
    expect(hanging(repo)).toEqual({ error: 'git -c alias.hang=!sleep 5 hang: timed out after 300 ms' });
    for (const slow of ['cat-file', 'merge-base', 'ls-tree']) {
      const run: Git = (args, cwd) => (args[0] === slow ? hanging(cwd) : git(args, cwd));
      const tree = floorTree(app, sha.floor, run);
      expect([slow, tree]).toEqual([slow, { state: 'error', reason: 'git -c alias.hang=!sleep 5 hang: timed out after 300 ms' }]);
      expect(decide(mobile({ tree })).exit).toBe(2);
    }
  }, 60_000);

  it('a SHA that is not 40 hex characters is never passed to git', () => {
    const seen: string[][] = [];
    const run: Git = (args, cwd) => { seen.push([...args]); return git(args, cwd); };
    expect(floorTree(app, '--output=planted', run)).toEqual({ state: 'error', reason: 'TEST_FLOOR.sha "--output=planted" is not 40 lower-case hex characters' });
    expect(seen).toEqual([]);
  });
});

describe('QA-041 · binding to the head on real commits (plan step 7)', () => {
  it('reads HEAD, its parents in order and its commit time from the commit itself', () => {
    expect(headFacts(app)).toEqual({ value: { sha: sha.merge, parents: [sha.main, sha.pr], commitTime: T_MERGE } });
  });

  it('accepts --head equal to HEAD, or to HEAD^2 of the pull-request merge ref', () => {
    expect(decide(mobile({ head: sha.merge })).exit).toBe(0);
    expect(decide(mobile({ head: sha.pr })).exit).toBe(0);
  });

  it.each([
    ['HEAD^1', () => sha.main],
    ['a random 40-hex value', () => '0123456789abcdef0123456789abcdef01234567'],
    ['a 7-character SHA', () => sha.pr.slice(0, 7)],
  ])('planted: --head as %s exits 2', (_name, head) => {
    const v = decide(mobile({ head: head() }));
    expect(v.exit).toBe(2);
    expect(v.lines).toHaveLength(1);
    expect(v.lines[0]).toMatch(/^--head .* (is neither HEAD|is not a full 40-hex commit SHA)/);
  });

  it('planted: results that started before HEAD was committed exit 2', () => {
    const v = decide(mobile({ startTime: T_MERGE * 1000 - 1_000 }));
    expect(v).toEqual({ exit: 2, lines: [`jest.json: the run started at ${new Date(T_MERGE * 1000 - 1_000).toISOString()}, before HEAD was committed (${new Date(T_MERGE * 1000).toISOString()}): stale results`] });
  });

  it('in a --depth 1 clone HEAD keeps both parents: the commit records them, though the clone hides them from rev-list', () => {
    const revList = spawnSync('git', ['rev-list', '--parents', '-n', '1', 'HEAD'], { cwd: shallowApp, encoding: 'utf8', windowsHide: true });
    expect(revList.stdout.trim()).toBe(sha.merge); // the shallow graft drops the parents here
    expect(headFacts(shallowApp)).toEqual({ value: { sha: sha.merge, parents: [sha.main, sha.pr], commitTime: T_MERGE } });
  });

  it('the backend binds to HEAD^2 in a --depth 1 clone (it needs no history) and exits 0', () => {
    const backendRoot = path.join(tmp, 'shallow', 'backend');
    const name = path.join(backendRoot, 'tests', 'x.test.js');
    const text = JSON.stringify({
      numTotalTestSuites: 1, numTotalTests: 2, numPassedTests: 2, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0,
      numRuntimeErrorTestSuites: 0, wasInterrupted: false, startTime: AFTER_MERGE, success: true,
      testResults: [{ name, assertionResults: [{ fullName: 'x a', status: 'passed' }, { fullName: 'x b', status: 'passed' }] }],
    });
    const measured = { numTotalTestSuites: 1, numTotalTests: 2, numPendingTests: 0, numTodoTests: 0 };
    const v = decide({
      pkg: 'backend', head: sha.pr, results: [{ file: 'jest-backend.json', text }], locate: locator(backendRoot), headFacts: headFacts(shallowApp),
      counts: { value: { ...counts(FLOOR()), backend: measured } },
    });
    expect(v.exit).toBe(0);
    expect(v.lines[0]).toBe(`head: ${sha.pr} is HEAD's second parent (HEAD ${sha.merge} is the pull-request merge ref)`);
  });

  it('a HEAD that is not a merge binds only to itself', () => {
    const facts = headFacts(path.join(tmp, 'shallow'));
    expect(facts).toEqual({ value: expect.objectContaining({ sha: sha.merge }) });
    build(repo, ['checkout', '-q', 'pr']);
    try {
      const pr = headFacts(app);
      expect(pr).toEqual({ value: { sha: sha.pr, parents: [sha.later], commitTime: T_PR } });
      expect(decide(mobile({ head: sha.pr, facts: pr })).exit).toBe(0);
      expect(decide(mobile({ head: sha.later, facts: pr })).exit).toBe(2);
    } finally {
      build(repo, ['checkout', '-q', 'main']);
    }
  });
});

describe('QA-041 · the fs adapters', () => {
  it('locator: a test file under the package root by its real path, posix and relative; anything else is null', () => {
    const at = locator(app);
    expect(at(path.join(app, 'src', 'a', '__tests__', 'A.test.ts'))).toBe('src/a/__tests__/A.test.ts');
    expect(at(path.join(repo, 'backend', 'tests', 'x.test.js'))).toBeNull(); // outside the package
    expect(at(path.join(app, 'src', 'gone.test.ts'))).toBeNull(); // missing on disk
    expect(at(path.join(app, 'src'))).toBeNull(); // a folder
    expect(at(app)).toBeNull();
    expect(at('src/a/__tests__/A.test.ts')).toBeNull(); // jest names a test file by its absolute path
  });

  it('locator: a second name for the same file (a junction) resolves to the same path, so the run counts it once', () => {
    const alias = path.join(tmp, 'alias');
    fs.symlinkSync(app, alias, 'junction');
    try {
      expect(locator(app)(path.join(alias, 'src', 'a', '__tests__', 'A.test.ts'))).toBe('src/a/__tests__/A.test.ts');
      const twice = JSON.parse(runText()) as { testResults: Array<{ name: string }>; numTotalTestSuites: number; numTotalTests: number; numPassedTests: number };
      twice.testResults.push({ ...twice.testResults[2], name: path.join(alias, 'src', 'a', '__tests__', 'A.test.ts') });
      Object.assign(twice, { numTotalTestSuites: 7, numTotalTests: 14, numPassedTests: 14 });
      expect(decide({ ...mobile(), results: [{ file: 'jest.json', text: JSON.stringify(twice) }] })).toEqual({ exit: 2, lines: ['src/a/__tests__/A.test.ts is twice in jest.json'] });
    } finally {
      fs.rmSync(alias, { recursive: false, force: true });
    }
  });

  it('readResultFiles: the text of each file as given, or why it could not be read', () => {
    const file = path.join(tmp, 'results.json');
    fs.writeFileSync(file, '{"x":1}');
    const read = readResultFiles([file, path.join(tmp, 'missing.json'), tmp]);
    expect(read[0]).toEqual({ file, text: '{"x":1}' });
    expect(read[1]).toEqual({ file: path.join(tmp, 'missing.json'), error: expect.stringMatching(/ENOENT/) });
    expect(read[2]).toEqual({ file: tmp, error: expect.stringMatching(/EISDIR|illegal operation on a directory/) });
  });
});
