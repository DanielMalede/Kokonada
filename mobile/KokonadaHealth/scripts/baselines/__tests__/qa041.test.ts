/// <reference types="node" />
import { checkRetireEntries } from '../../../src/testing/guards/retire';
import type { TestCounts } from '../testCounts';
import { decide, type Inputs, type ResultsFile, type Verdict } from '../qa041';

// QA-041 proper (OPS-412 part A), the pure core on in-memory inputs. A run is jest's `--ci --json` output
// as text; the package root, the files on disk, git's facts and the decision records are in memory too,
// so nothing here reads the tree. The RETIRE signature rule is the real one (retire.ts re-exports the
// rule of src/testing/guards/retireRule.ts); only its decision statuses come from a stub (#291 audit RA-8).

const ROOT = '/planted/app';
const HEAD = 'a'.repeat(40);
const HEAD_P1 = 'b'.repeat(40);
const PR_HEAD = 'c'.repeat(40);
const FLOOR_SHA = '988bab3e44f214fd24ce11f6663431c6ffe2afa7';
const COMMIT_TIME = 1_795_000_000; // seconds, as git records a commit time
const START = COMMIT_TIME * 1000 + 60_000; // the run started a minute after HEAD was committed

const A = 'src/a/__tests__/A.test.ts';
const B = 'src/b/__tests__/B.test.tsx';
const C = 'src/c/C.test.ts';

type Status = 'passed' | 'failed' | 'pending' | 'todo';
type Spec = Record<string, ReadonlyArray<readonly [string, Status]>>;
const range = (n: number): number[] => Array.from({ length: n }, (_v, i) => i);

// The synthetic baseline mirrors the recorded one: 3209 tests, 1 pending, 0 todo, in three files.
const BASE: Spec = {
  [A]: range(3000).map((i) => [`A t${i}`, 'passed'] as const),
  [B]: range(200).map((i) => [`B t${i}`, i === 0 ? 'pending' : 'passed'] as const),
  [C]: range(9).map((i) => [`C t${i}`, 'passed'] as const),
};

/** jest's --json output for a spec, with consistent counts; `over` replaces top-level fields. */
function jestJson(spec: Spec, over: Record<string, unknown> = {}, startTime = START): string {
  const testResults = Object.entries(spec).map(([rel, tests]) => ({
    name: `${ROOT}/${rel}`,
    assertionResults: tests.map(([fullName, status]) => ({ ancestorTitles: [], fullName, status, title: fullName })),
    status: tests.some((t) => t[1] === 'failed') ? 'failed' : 'passed',
    message: '',
    startTime,
    endTime: startTime + 10,
  }));
  const all = testResults.flatMap((r) => r.assertionResults);
  const n = (s: Status) => all.filter((a) => a.status === s).length;
  return JSON.stringify({
    numFailedTestSuites: testResults.filter((r) => r.status === 'failed').length,
    numFailedTests: n('failed'),
    numPassedTestSuites: testResults.filter((r) => r.status !== 'failed').length,
    numPassedTests: n('passed'),
    numPendingTestSuites: 0,
    numPendingTests: n('pending'),
    numRuntimeErrorTestSuites: 0,
    numTodoTests: n('todo'),
    numTotalTestSuites: testResults.length,
    numTotalTests: all.length,
    openHandles: [],
    snapshot: {},
    startTime,
    success: n('failed') === 0,
    testResults,
    wasInterrupted: false,
    ...over,
  });
}

const COUNTS: TestCounts = {
  sha: FLOOR_SHA,
  measuredAt: '2026-11-17T15:12:06Z',
  node: 'v24.19.0',
  jest: '29.7.0',
  command: { mobile: './node_modules/.bin/jest --ci --json', backend: './node_modules/.bin/jest --ci --json --runInBand --forceExit' },
  mobile: { numTotalTestSuites: 3, numTotalTests: 3209, numPendingTests: 1, numTodoTests: 0 },
  backend: { numTotalTestSuites: 3, numTotalTests: 3209, numPendingTests: 1, numTodoTests: 0 },
  files: { mobile: { [A]: [3000, 0, 0], [B]: [200, 1, 0], [C]: [9, 0, 0] } },
};

const MANIFEST = {
  'CON-1': [{ file: A, fullTitle: 'A t1' }],
  'CON-2': [{ file: B, fullTitle: 'B t5' }, { file: B, fullTitle: 'B t6' }],
};
const FLOOR = { sha: FLOOR_SHA, listTestsCount: 3, paths: [A, B, C] };
const stub = (dec: string) => (dec === 'DEC-900' ? 'DECIDED' : dec === 'DEC-901' ? 'OPEN' : null);

/** The files on disk under ROOT, in memory: a name resolves only when it is one of them. */
const onDisk = new Set([A, B, C, 'src/d/D.test.ts', 'src/a/A.ts']);
const locate = (name: string): string | null =>
  name.startsWith(`${ROOT}/`) && onDisk.has(name.slice(ROOT.length + 1)) ? name.slice(ROOT.length + 1) : null;

function inputs(over: Partial<Inputs> = {}): Inputs {
  return {
    pkg: 'mobile',
    head: HEAD,
    results: [{ file: 'shard-1.json', text: jestJson(BASE) }],
    locate,
    headFacts: { value: { sha: HEAD, parents: [HEAD_P1], commitTime: COMMIT_TIME } },
    counts: { value: COUNTS },
    retire: { value: [] },
    manifest: { value: MANIFEST },
    floor: { value: FLOOR },
    floorTree: { state: 'ok', paths: [A, B, C, 'src/a/A.ts', 'package.json'] },
    signatures: { value: { check: checkRetireEntries, decStatus: stub } },
    ...over,
  };
}

const text = (v: Verdict) => v.lines.join('\n');

describe('QA-041 · the results reader (plan step 4: a run that cannot be trusted exits 2, never 0)', () => {
  it('a synthetic run that matches the record exits 0', () => {
    const v = decide(inputs());
    expect(v.lines).toEqual(expect.any(Array));
    expect(v.exit).toBe(0);
  });

  const shift = (spec: Spec, over: Record<string, unknown>) => jestJson(spec, over);
  const planted: Array<[string, ResultsFile[], RegExp]> = [
    ['a results file that cannot be read', [{ file: 'gone.json', error: 'ENOENT: no such file or directory' }], /^gone\.json: cannot be read \(ENOENT/],
    ['a results file that is not JSON', [{ file: 'bad.json', text: '{"numTotalTests": 3209,' }], /^bad\.json: is not JSON/],
    ['JSON that is not an object', [{ file: 'arr.json', text: '[]' }], /^arr\.json: is not a jest --json result \(not an object\)/],
    ['a count given as a string', [{ file: 's.json', text: shift(BASE, { numTotalTests: '3209' }) }], /^s\.json: is not a jest --json result: numTotalTests is not a count/],
    ['no testResults', [{ file: 's.json', text: shift(BASE, { testResults: undefined }) }], /^s\.json: is not a jest --json result: testResults is not a list/],
    ['no startTime', [{ file: 's.json', text: shift(BASE, { startTime: 'now' }) }], /^s\.json: is not a jest --json result: startTime is not a time in ms/],
    ['wasInterrupted missing', [{ file: 's.json', text: shift(BASE, { wasInterrupted: undefined }) }], /^s\.json: is not a jest --json result: wasInterrupted is not true or false/],
    ['numTotalTests not the sum of the test results', [{ file: 's.json', text: shift(BASE, { numTotalTests: 3210 }) }], /^s\.json: numTotalTests is 3210 but it holds 3209 test results$/],
    ['numPendingTests not the pending results', [{ file: 's.json', text: shift(BASE, { numPendingTests: 0 }) }], /^s\.json: numPendingTests is 0 but 1 test result is pending$/],
    ['numTodoTests not the todo results', [{ file: 's.json', text: shift(BASE, { numTodoTests: 2 }) }], /^s\.json: numTodoTests is 2 but 0 test results are todo$/],
    ['numPassedTests not the passed results', [{ file: 's.json', text: shift(BASE, { numPassedTests: 3207 }) }], /^s\.json: numPassedTests is 3207 but 3208 test results are passed$/],
    ['numFailedTests not the failed results', [{ file: 's.json', text: shift(BASE, { numFailedTests: 1 }) }], /^s\.json: numFailedTests is 1 but 0 test results are failed$/],
    ['an empty run', [{ file: 'e.json', text: jestJson({}) }], /^e\.json: an empty run \(0 test files, 0 tests\)$/],
    ['a suite that failed to run', [{ file: 's.json', text: shift(BASE, { numRuntimeErrorTestSuites: 1 }) }], /^s\.json: 1 test suite failed to run, so its tests were never counted \(numRuntimeErrorTestSuites\)$/],
    ['an interrupted run', [{ file: 's.json', text: shift(BASE, { wasInterrupted: true }) }], /^s\.json: the run was interrupted \(wasInterrupted\)$/],
    ['numTotalTestSuites not the number of test files', [{ file: 's.json', text: shift(BASE, { numTotalTestSuites: 4 }) }], /^s\.json: numTotalTestSuites is 4 but it holds 3 test file results$/],
  ];

  it.each(planted)('planted: %s exits 2 with its reason', (_name, results, reason) => {
    const v = decide(inputs({ results }));
    expect(v.exit).toBe(2);
    expect(v.lines.filter((l) => reason.test(l))).toHaveLength(1);
  });

  it('planted: a test result with a status jest never writes is refused, with where it is', () => {
    const run = JSON.parse(jestJson(BASE)) as { testResults: Array<{ assertionResults: Array<{ status: string }> }> };
    run.testResults[1].assertionResults[3].status = 'skipped';
    const v = decide(inputs({ results: [{ file: 's.json', text: JSON.stringify(run) }] }));
    expect(v.exit).toBe(2);
    expect(text(v)).toMatch(/^s\.json: is not a jest --json result: testResults\[1\]\.assertionResults\[3\] has status "skipped", not passed, failed, pending or todo$/m);
  });

  it('planted: a test result without a fullName, and a test file without a name, are refused', () => {
    const run = JSON.parse(jestJson(BASE)) as { testResults: Array<{ name?: string; assertionResults: Array<{ fullName?: string }> }> };
    delete run.testResults[0].assertionResults[0].fullName;
    delete run.testResults[2].name;
    const v = decide(inputs({ results: [{ file: 's.json', text: JSON.stringify(run) }] }));
    expect(v.exit).toBe(2);
    expect(text(v)).toMatch(/^s\.json: is not a jest --json result: testResults\[0\]\.assertionResults\[0\] has no fullName$/m);
    expect(text(v)).toMatch(/^s\.json: is not a jest --json result: testResults\[2\] has no name$/m);
  });

  it('planted: a result file outside the package, and one missing on disk, exit 2', () => {
    const outside = JSON.parse(jestJson(BASE)) as { testResults: Array<{ name: string }> };
    outside.testResults[0].name = `/elsewhere/${A}`;
    outside.testResults[1].name = `${ROOT}/src/b/__tests__/Gone.test.tsx`;
    const v = decide(inputs({ results: [{ file: 's.json', text: JSON.stringify(outside) }] }));
    expect(v.exit).toBe(2);
    expect(v.lines).toEqual(expect.arrayContaining([
      `s.json: /elsewhere/${A} is not a test file under the package root`,
      `s.json: ${ROOT}/src/b/__tests__/Gone.test.tsx is not a test file under the package root`,
    ]));
  });

  it('planted: a test file in two shards, or twice in one, exits 2 (its tests would count twice)', () => {
    const two = decide(inputs({ results: [
      { file: 'shard-1.json', text: jestJson({ [A]: BASE[A], [B]: BASE[B] }) },
      { file: 'shard-2.json', text: jestJson({ [B]: BASE[B], [C]: BASE[C] }) },
    ] }));
    expect(two.exit).toBe(2);
    expect(two.lines).toContain(`${B} is in shard-1.json and in shard-2.json`);

    const once = JSON.parse(jestJson(BASE)) as { testResults: unknown[]; numTotalTestSuites: number; numTotalTests: number; numPassedTests: number };
    once.testResults.push(once.testResults[2]);
    Object.assign(once, { numTotalTestSuites: 4, numTotalTests: 3218, numPassedTests: 3217 });
    const twice = decide(inputs({ results: [{ file: 'shard-1.json', text: JSON.stringify(once) }] }));
    expect(twice.exit).toBe(2);
    expect(twice.lines).toEqual([`${C} is twice in shard-1.json`]);
  });

  it('shards that split the files between them read as one run (0); --expect-shards must match the files given', () => {
    const shards: ResultsFile[] = [
      { file: 'shard-1.json', text: jestJson({ [A]: BASE[A] }) },
      { file: 'shard-2.json', text: jestJson({ [B]: BASE[B], [C]: BASE[C] }) },
    ];
    expect(decide(inputs({ results: shards })).exit).toBe(0);
    expect(decide(inputs({ results: shards, expectShards: 2 })).exit).toBe(0);
    const v = decide(inputs({ results: shards, expectShards: 8 }));
    expect(v.exit).toBe(2);
    expect(v.lines).toEqual(['--expect-shards 8, but 2 results files were given']);
  });

  it('no results file at all exits 2', () => {
    const v = decide(inputs({ results: [] }));
    expect(v.exit).toBe(2);
    expect(v.lines).toEqual(['no --results file was given']);
  });
});

describe('QA-041 · binding the results to the head (plan decision 4, in memory)', () => {
  const merge = { value: { sha: HEAD, parents: [HEAD_P1, PR_HEAD], commitTime: COMMIT_TIME } };

  it('accepts --head equal to HEAD, or to the second parent of a merge HEAD (the pull-request merge ref)', () => {
    expect(decide(inputs({ head: HEAD })).exit).toBe(0);
    expect(decide(inputs({ head: PR_HEAD, headFacts: merge })).exit).toBe(0);
  });

  it.each([
    ['HEAD^1 of the merge', HEAD_P1, /^--head b{40} is neither HEAD \(a{40}\) nor HEAD's second parent \(c{40}\): the results are bound to no commit$/],
    ['a random 40-hex value', 'd'.repeat(40), /^--head d{40} is neither HEAD/],
    ['a 7-character SHA', PR_HEAD.slice(0, 7), /^--head "ccccccc" is not a full 40-hex commit SHA$/],
    ['an upper-case SHA', PR_HEAD.toUpperCase(), /is not a full 40-hex commit SHA$/],
  ])('planted: %s exits 2', (_name, head, reason) => {
    const v = decide(inputs({ head, headFacts: merge }));
    expect(v.exit).toBe(2);
    expect(v.lines.filter((l) => reason.test(l))).toHaveLength(1);
  });

  it('planted: a second parent named when HEAD is not a merge exits 2', () => {
    const v = decide(inputs({ head: PR_HEAD }));
    expect(v.exit).toBe(2);
    expect(v.lines).toEqual([`--head ${PR_HEAD} is neither HEAD (${HEAD}) nor HEAD's second parent (HEAD is not a merge): the results are bound to no commit`]);
  });

  it('planted: results that started before HEAD was committed are stale and exit 2; at the commit second they are fresh', () => {
    const before = COMMIT_TIME * 1000 - 1;
    const stale = decide(inputs({ results: [{ file: 'old.json', text: jestJson(BASE, {}, before) }] }));
    expect(stale.exit).toBe(2);
    expect(stale.lines).toEqual([`old.json: the run started at ${new Date(before).toISOString()}, before HEAD was committed (${new Date(COMMIT_TIME * 1000).toISOString()}): stale results`]);
    expect(decide(inputs({ results: [{ file: 'new.json', text: jestJson(BASE, {}, COMMIT_TIME * 1000) }] })).exit).toBe(0);
  });

  it('planted: git facts that could not be read (git missing) leave the results unbound: exit 2', () => {
    const v = decide(inputs({ headFacts: { error: 'git is not on the PATH (spawnSync git ENOENT)' } }));
    expect(v.exit).toBe(2);
    expect(v.lines).toEqual(['cannot bind the results to a commit: git is not on the PATH (spawnSync git ENOENT)']);
  });
});
