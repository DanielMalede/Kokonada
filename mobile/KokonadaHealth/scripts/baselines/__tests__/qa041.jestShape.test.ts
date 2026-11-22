/// <reference types="node" />
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { APP_ROOT } from '../../../src/testing/guards/productionImports';
import { readRun, type ResultsFile, type Run } from '../qa041.ts';
import { locator, readResultFiles } from '../qa041Sources.ts';

// QA-041 proper (OPS-412 part A), plan step 9: the reader against jest's real output, not a synthetic one.
// The repo's own jest runs `--ci --json --outputFile --watchman=false` on planted projects in os.tmpdir(),
// outside the repository, so the repo's jest never collects them. The projects carry a skip, a todo, an
// .each of two rows and a failing test; a suite that cannot load; and a focused test. The planted sources
// are text: no marker in them is a call in this file.

const JEST = path.join(APP_ROOT, 'node_modules', 'jest', 'bin', 'jest.js');
let tmp = '';

const PROJECT: Record<string, string> = {
  'a.test.js': [
    "describe('a', () => {",
    "  it('passes', () => { expect(1).toBe(1); });",
    "  it.skip('is skipped', () => { expect(1).toBe(2); });",
    "  it.todo('is to do');",
    "  it.each([[1], [2]])('row %i', (n) => { expect(n).toBeGreaterThan(0); });",
    '});',
  ].join('\n'),
  'b.test.js': "test('b fails', () => { expect(1).toBe(2); });\ntest('b passes', () => {});\n",
  'sub/c.test.js': "describe.skip('c block', () => { it('is skipped with its block', () => {}); });\nit('c passes', () => {});\n",
  'sub/d.test.js': "test('d passes', () => {});\n",
};

function plant(name: string, files: Record<string, string>): string {
  const root = path.join(tmp, name);
  for (const [file, text] of Object.entries(files)) {
    const abs = path.join(root, ...file.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
  }
  // A minimal config: no transform (the planted tests are plain CommonJS), node's environment, its own cache.
  fs.writeFileSync(path.join(root, 'jest.config.js'), `module.exports = ${JSON.stringify({
    testEnvironment: 'node', transform: {}, testMatch: ['**/*.test.js'], cacheDirectory: path.join(tmp, `cache-${name}`),
  })};\n`);
  return root;
}

/** The repo's jest on a planted project; the JSON goes to `out`. A failing test exits 1, as in CI. */
function jest(root: string, out: string, extra: string[] = []) {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  return spawnSync(process.execPath, [JEST, '--ci', '--json', '--outputFile', out, '--watchman=false', '--config', path.join(root, 'jest.config.js'), '--rootDir', root, ...extra], {
    cwd: root, encoding: 'utf8', timeout: 180_000, env, windowsHide: true,
  });
}

const statuses = (run: Run): Record<string, string> =>
  Object.fromEntries([...run.files.entries()].flatMap(([file, list]) => list.map((t) => [`${file} :: ${t.fullName}`, t.status])));
const shape = (run: Run) => ({
  files: [...run.files.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([file, list]) => [file, list.map((t) => `${t.fullName} = ${t.status}`).sort()]),
  numTotalTests: run.numTotalTests,
  numPendingTests: run.numPendingTests,
  numTodoTests: run.numTodoTests,
});

let project = '';
let whole: ResultsFile[] = [];
let shards: ResultsFile[] = [];
let wholeStatus: number | null = null;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qa041-jest-'));
  project = plant('project', PROJECT);
  const out = path.join(tmp, 'whole.json');
  wholeStatus = jest(project, out).status;
  whole = readResultFiles([out]);
  const s1 = path.join(tmp, 'shard-1.json');
  const s2 = path.join(tmp, 'shard-2.json');
  jest(project, s1, ['--shard=1/2']);
  jest(project, s2, ['--shard=2/2']);
  shards = readResultFiles([s1, s2]);
}, 600_000);

afterAll(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

describe('QA-041 · the reader on real jest --ci --json output (plan step 9)', () => {
  it('jest really ran the planted project: a failing test exits 1 and the JSON was written', () => {
    expect(wholeStatus).toBe(1);
    expect('text' in whole[0]).toBe(true);
  });

  it('returns jest\'s real counts and statuses: a skip and a skipped block are pending, a todo is todo, .each gives a test per row', () => {
    const read = readRun(whole, locator(project));
    expect(read.problems).toEqual([]);
    const raw = JSON.parse((whole[0] as { text: string }).text) as Record<string, number>;
    expect({ total: read.run?.numTotalTests, pending: read.run?.numPendingTests, todo: read.run?.numTodoTests })
      .toEqual({ total: raw.numTotalTests, pending: raw.numPendingTests, todo: raw.numTodoTests });
    expect(statuses(read.run as Run)).toEqual({
      'a.test.js :: a passes': 'passed',
      'a.test.js :: a is skipped': 'pending',
      'a.test.js :: a is to do': 'todo',
      'a.test.js :: a row 1': 'passed',
      'a.test.js :: a row 2': 'passed',
      'b.test.js :: b fails': 'failed',
      'b.test.js :: b passes': 'passed',
      'sub/c.test.js :: c block is skipped with its block': 'pending',
      'sub/c.test.js :: c passes': 'passed',
      'sub/d.test.js :: d passes': 'passed',
    });
    expect([raw.numTotalTests, raw.numPendingTests, raw.numTodoTests, raw.numFailedTests, raw.numPassedTests]).toEqual([10, 2, 1, 1, 6]);
  });

  it('--shard=1/2 plus --shard=2/2 merge to exactly the unsharded run', () => {
    const merged = readRun(shards, locator(project), 2);
    expect(merged.problems).toEqual([]);
    const each = shards.map((s) => readRun([s], locator(project)).run as Run);
    expect(each.map((r) => r.files.size)).toEqual([2, 2]); // both shards carry files: the split is real
    expect(shape(merged.run as Run)).toEqual(shape(readRun(whole, locator(project)).run as Run));
  });

  it('planted on real output: one shard alone, or one shard given twice, is refused (2)', () => {
    expect(readRun([shards[0]], locator(project), 2).problems).toEqual(['--expect-shards 2, but 1 results file was given']);
    const twice = readRun([shards[0], { ...shards[0], file: 'again.json' }], locator(project), 2).problems;
    expect(twice.length).toBeGreaterThan(0);
    expect(twice.every((p) => / is in .*shard-1\.json and in again\.json$/.test(p))).toBe(true);
  });

  it('planted on real output: one test result removed is refused, since numTotalTests no longer adds up', () => {
    const raw = JSON.parse((whole[0] as { text: string }).text) as { testResults: Array<{ assertionResults: unknown[] }> };
    raw.testResults[0].assertionResults.pop();
    expect(readRun([{ file: 'cut.json', text: JSON.stringify(raw) }], locator(project)).problems)
      .toEqual(expect.arrayContaining([expect.stringMatching(/^cut\.json: numTotalTests is 10 but it holds 9 test results$/)]));
  });

  it('a suite that cannot load is counted by jest as a runtime error, and the run is refused (2)', () => {
    const broken = plant('broken', { 'ok.test.js': "test('ok', () => {});\n", 'broken.test.js': "test('never', () => {\n" });
    const out = path.join(tmp, 'broken.json');
    expect(jest(broken, out).status).toBe(1);
    const read = readRun(readResultFiles([out]), locator(broken));
    expect(read.problems).toEqual([`${out}: 1 test suite failed to run, so its tests were never counted (numRuntimeErrorTestSuites)`]);
  }, 180_000);

  it('a focused test makes jest report the rest of its file as pending, so RA-5 sees it', () => {
    const focused = plant('focused', { 'f.test.js': "test.only('one', () => {});\ntest('two', () => {});\n" });
    const out = path.join(tmp, 'focused.json');
    expect(jest(focused, out).status).toBe(0);
    const read = readRun(readResultFiles([out]), locator(focused));
    expect(read.problems).toEqual([]);
    expect(statuses(read.run as Run)).toEqual({ 'f.test.js :: one': 'passed', 'f.test.js :: two': 'pending' });
    expect(read.run?.numPendingTests).toBe(1);
  }, 180_000);
});
