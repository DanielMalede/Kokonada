/// <reference types="node" />
import type { TestCounts } from '../testCounts';
import {
  asFloorList, asManifest, asRetire, checkInputs, decide, formatVerdict, isTestPath, parseArgs, RULES, USAGE,
  type Inputs, type ResultsFile, type RuleId, type Verdict,
} from '../qa041';

// QA-041 proper (OPS-412 part A), the pure core on in-memory inputs. A run is jest's `--ci --json` output
// as text; the package root, the files on disk, git's facts and the decision records are in memory too,
// so nothing here reads the tree. The RETIRE signature rule is the real one (the core imports it from
// src/testing/guards/retireRule.ts); only its decision statuses come from a stub (#291 audit RA-8).

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
    decStatus: stub,
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

// ---- plan step 5: the rules, on in-memory runs -------------------------------------------------------
// Each planted case exits 1 with its line, and exits 0 with its rule switched off in memory: that rule,
// and no other, is the one catching it.

const MOBILE_RULES: RuleId[] = ['floor', 'RA-5', 'RETIRE', 'RA-7', 'RA-9'];
const off = (...rules: RuleId[]): ReadonlySet<RuleId> => new Set(MOBILE_RULES.filter((r) => !rules.includes(r)));
const AT = FLOOR_SHA.slice(0, 12);
const D = 'src/d/D.test.ts';
type Row = readonly [string, Status];
const edit = (spec: Spec, file: string, f: (tests: Row[]) => Row[]): Spec => ({ ...spec, [file]: f([...(spec[file] ?? [])]) });
const without = (spec: Spec, file: string): Spec => Object.fromEntries(Object.entries(spec).filter(([f]) => f !== file));
const runOf = (spec: Spec): ResultsFile[] => [{ file: 'shard-1.json', text: jestJson(spec) }];
const retireFile = (target: string, dec = 'DEC-900') => ({ value: [{ kind: 'file' as const, target, dec, reason: 'planted' }] });
const nine = (prefix: string): Row[] => range(9).map((i) => [`${prefix} t${i}`, 'passed'] as const);
const failing = (name: string) => (t: Row[]): Row[] => t.map(([n, s]) => [n, n === name ? 'failed' : s] as const);
const pending = (name: string) => (t: Row[]): Row[] => t.map(([n, s]) => [n, n === name ? 'pending' : s] as const);
const dropped = (name: string) => (t: Row[]): Row[] => t.filter(([n]) => n !== name);

/** exit 1 with exactly `lines` under every rule, and exit 0 with `rule` switched off. */
function caughtBy(rule: RuleId, input: Inputs, lines: string[]): void {
  const v = decide(input);
  expect({ exit: v.exit, lines: v.lines }).toEqual({ exit: 1, lines });
  expect(decide(input, off(rule))).toEqual(expect.objectContaining({ exit: 0 }));
}

describe('QA-041 · the rules (plan step 5)', () => {
  it('the rule sets: mobile has five, the backend the totals and the pending bound only', () => {
    expect(RULES).toEqual({ mobile: MOBILE_RULES, backend: ['floor', 'RA-5'] });
  });

  it('planted: a deleted test exits 1 with "3208 < floor 3209", through the floor', () => {
    caughtBy('floor', inputs({ results: runOf(edit(BASE, A, dropped('A t2999'))) }), [
      `floor: mobile ran 3208 tests: 3208 < floor 3209 (the baseline's 3209 at ${AT})`,
    ]);
  });

  it('planted: a .skip added exits 1 through RA-5 only (the total keeps a skipped test)', () => {
    const input = inputs({ results: runOf(edit(BASE, A, pending('A t10'))) });
    caughtBy('RA-5', input, [`RA-5: mobile has 2 pending and todo tests (2 pending, 0 todo): 2 > bound 1 (the baseline's 1 at ${AT})`]);
    expect(decide(input, off('floor')).exit).toBe(1);
  });

  it('planted: a todo added exits 1 through RA-5 only (it raises the total)', () => {
    const input = inputs({ results: runOf(edit(BASE, A, (t) => [...t, ['A a todo', 'todo']])) });
    caughtBy('RA-5', input, [`RA-5: mobile has 2 pending and todo tests (1 pending, 1 todo): 2 > bound 1 (the baseline's 1 at ${AT})`]);
    expect(decide(input, off('floor')).exit).toBe(1);
  });

  it('planted: file C (9 tests) removed exits 1; a RETIRE file entry signed by a DECIDED DEC turns it 0', () => {
    caughtBy('floor', inputs({ results: runOf(without(BASE, C)) }), [`floor: mobile ran 3200 tests: 3200 < floor 3209 (the baseline's 3209 at ${AT})`]);
    expect(decide(inputs({ results: runOf(without(BASE, C)), retire: retireFile(C) }))).toEqual(expect.objectContaining({ exit: 0 }));
  });

  it('planted: C removed plus one more test, with C retired, exits 1: the floor drops by the row of C only', () => {
    caughtBy('floor', inputs({ results: runOf(edit(without(BASE, C), A, dropped('A t2999'))), retire: retireFile(C) }), [
      `floor: mobile ran 3199 tests: 3199 < floor 3200 (the baseline's 3209 at ${AT}, less 9 in 1 retired file)`,
    ]);
  });

  it('planted: a RETIRE entry signed by an OPEN DEC, by the rule itself (DEC-091) or by no record exits 1 through RETIRE', () => {
    // C removed and nine tests added in D, so the floor holds and only the signature is wrong.
    const spec = { ...without(BASE, C), [D]: nine('D') };
    caughtBy('RETIRE', inputs({ results: runOf(spec), retire: retireFile(C, 'DEC-901') }), [`RETIRE file ${C}: DEC-901 is OPEN, not DECIDED`]);
    caughtBy('RETIRE', inputs({ results: runOf(spec), retire: retireFile(C, 'DEC-091') }), [`RETIRE file ${C}: DEC-091 is the RETIRE rule itself, not a signature`]);
    caughtBy('RETIRE', inputs({ results: runOf(spec), retire: retireFile(C, 'DEC-950') }), [`RETIRE file ${C}: DEC-950 does not exist`]);
  });

  it('planted: an unsigned RETIRE entry lowers nothing, so a removed file still breaches the floor', () => {
    expect(decide(inputs({ results: runOf(without(BASE, C)), retire: retireFile(C, 'DEC-901') }))).toEqual({ exit: 1, lines: [
      `floor: mobile ran 3200 tests: 3200 < floor 3209 (the baseline's 3209 at ${AT})`,
      `RETIRE file ${C}: DEC-901 is OPEN, not DECIDED`,
    ] });
  });

  it('planted: a RETIRE target not in the per-file record, and one that still ran, exit 1 through RETIRE', () => {
    caughtBy('RETIRE', inputs({ retire: retireFile(D) }), [`RETIRE file ${D}: not in the per-file record of test-counts.json (only a file of the baseline run is retired)`]);
    caughtBy('RETIRE', inputs({ retire: retireFile(C) }), [`RETIRE file ${C}: it still ran in this run`]);
    caughtBy('RETIRE', inputs({ retire: retireFile('__proto__') }), ['RETIRE file __proto__: not in the per-file record of test-counts.json (only a file of the baseline run is retired)']);
  });

  it('planted: a RETIRE file entry named twice discounts its row once', () => {
    const twice = { value: [...retireFile(C).value, ...retireFile(C).value] };
    expect(decide(inputs({ results: runOf(edit(without(BASE, C), A, dropped('A t2999'))), retire: twice }))).toEqual({ exit: 1, lines: [
      `floor: mobile ran 3199 tests: 3199 < floor 3200 (the baseline's 3209 at ${AT}, less 9 in 1 retired file)`,
      `RETIRE file ${C}: named twice`,
    ] });
  });

  it('planted: a pin entry subtracts 0', () => {
    const pin = { value: [{ kind: 'pin' as const, target: C, dec: 'DEC-900', reason: 'planted' }] };
    caughtBy('floor', inputs({ results: runOf(without(BASE, C)), retire: pin }), [`floor: mobile ran 3200 tests: 3200 < floor 3209 (the baseline's 3209 at ${AT})`]);
    expect(decide(inputs({ retire: pin })).exit).toBe(0);
  });

  it('the pending and todo tests of a retired file leave the bound with it', () => {
    // B holds the baseline's one pending test; with B retired the bound is 0, so a new skip in A is red.
    const v = decide(inputs({ results: runOf(edit(without(BASE, B), A, pending('A t10'))), retire: retireFile(B), manifest: { value: { 'CON-1': MANIFEST['CON-1'] } } }));
    expect(v).toEqual({ exit: 1, lines: [`RA-5: mobile has 1 pending and todo test (1 pending, 0 todo): 1 > bound 0 (the baseline's 1 at ${AT}, less 1 in 1 retired file)`] });
  });

  describe('RA-7 · every manifest reference passed in this run', () => {
    it('all passed exits 0', () => {
      expect(decide(inputs()).exit).toBe(0);
    });

    it('planted: a manifest test that failed exits 1', () => {
      caughtBy('RA-7', inputs({ results: runOf(edit(BASE, A, failing('A t1'))) }), [`RA-7 CON-1: "A t1" in ${A} did not pass (failed)`]);
    });

    it('planted: a manifest test that is pending exits 1 (the bound kept by passing the baseline\'s own skip)', () => {
      const spec = edit(BASE, B, (t) => t.map(([n]) => [n, n === 'B t5' ? 'pending' : 'passed'] as const));
      caughtBy('RA-7', inputs({ results: runOf(spec) }), [`RA-7 CON-2: "B t5" in ${B} did not pass (pending)`]);
    });

    it('planted: a manifest test missing from its file exits 1', () => {
      const spec = edit(BASE, A, (t) => t.map(([n, s]) => [n === 'A t1' ? 'A t1 renamed' : n, s] as const));
      caughtBy('RA-7', inputs({ results: runOf(spec) }), [`RA-7 CON-1: ${A} ran no test named "A t1"`]);
    });

    it('planted: a manifest test whose file did not run exits 1 (the file retired, so the floor holds)', () => {
      caughtBy('RA-7', inputs({ results: runOf(without(BASE, B)), retire: retireFile(B) }), [
        `RA-7 CON-2: ${B} did not run, so "B t5" did not pass`,
        `RA-7 CON-2: ${B} did not run, so "B t6" did not pass`,
      ]);
    });

    it('planted: a duplicate title where one copy fails exits 1', () => {
      caughtBy('RA-7', inputs({ results: runOf(edit(BASE, A, (t) => [...t, ['A t1', 'failed']])) }), [`RA-7 CON-1: "A t1" in ${A} did not pass (passed, failed)`]);
    });

    it('planted: a manifest with no contract, or a contract with no reference, exits 1', () => {
      caughtBy('RA-7', inputs({ manifest: { value: {} } }), ['RA-7: the manifest names no contract']);
      caughtBy('RA-7', inputs({ manifest: { value: { ...MANIFEST, 'CON-3': [] } } }), ['RA-7 CON-3: no test reference']);
    });
  });

  describe('RA-9 · the floor list is the tree at its SHA (in memory; qa041.git.test.ts reads real trees)', () => {
    const E = 'src/e/__tests__/E.test.ts';
    it('a test file in the tree that the list leaves out exits 1', () => {
      caughtBy('RA-9', inputs({ floorTree: { state: 'ok', paths: [A, B, C, E] } }), [
        `RA-9: TEST_FLOOR.listTestsCount is 3, but the tree at ${AT} has 4 test files`,
        `RA-9: ${E} is a test file in the tree at ${AT}, but TEST_FLOOR.paths leaves it out`,
      ]);
    });

    it('a listed path that is no test file in the tree (fabricated) exits 1', () => {
      caughtBy('RA-9', inputs({ floorTree: { state: 'ok', paths: [A, B, 'src/c/C.ts'] } }), [
        `RA-9: TEST_FLOOR.listTestsCount is 3, but the tree at ${AT} has 2 test files`,
        `RA-9: TEST_FLOOR.paths names ${C}, which is no test file in the tree at ${AT}`,
      ]);
    });

    it('a list out of order, or with a count that is not its length, exits 1', () => {
      caughtBy('RA-9', inputs({ floor: { value: { ...FLOOR, paths: [B, A, C] } } }), ['RA-9: TEST_FLOOR.paths is not sorted and unique']);
      caughtBy('RA-9', inputs({ floor: { value: { ...FLOOR, listTestsCount: 4 } } }), [`RA-9: TEST_FLOOR.listTestsCount is 4, but the tree at ${AT} has 3 test files`]);
    });

    it('a per-file record that names other files than the list, or another SHA, exits 1', () => {
      const files = { mobile: { [A]: [3000, 0, 0], [B]: [200, 1, 0], [D]: [9, 0, 0] } } as const;
      caughtBy('RA-9', inputs({ counts: { value: { ...COUNTS, files } } }), [
        `RA-9: the per-file record of test-counts.json names ${D}, which TEST_FLOOR.paths does not`,
        `RA-9: TEST_FLOOR.paths names ${C}, which the per-file record of test-counts.json does not`,
      ]);
      caughtBy('RA-9', inputs({ counts: { value: { ...COUNTS, sha: 'e'.repeat(40) } } }), [`RA-9: test-counts.json was measured at eeeeeeeeeeee, TEST_FLOOR at ${AT}`]);
    });

    it('TEST_FLOOR.sha present but not an ancestor of HEAD exits 1; in a shallow clone it cannot be told: 2', () => {
      caughtBy('RA-9', inputs({ floorTree: { state: 'notAncestor', shallow: false } }), [`RA-9: TEST_FLOOR.sha ${FLOOR_SHA} is not an ancestor of HEAD`]);
      expect(decide(inputs({ floorTree: { state: 'notAncestor', shallow: true } }))).toEqual({ exit: 2, lines: [
        `RA-9: the clone is shallow, so whether TEST_FLOOR.sha ${AT} is an ancestor of HEAD cannot be told (check out with fetch-depth: 0)`,
      ] });
    });

    it('TEST_FLOOR.sha absent from the clone, or git failing, exits 2', () => {
      expect(decide(inputs({ floorTree: { state: 'absent', shallow: false } }))).toEqual({ exit: 2, lines: [`RA-9: TEST_FLOOR.sha ${AT} is not in this clone`] });
      expect(decide(inputs({ floorTree: { state: 'absent', shallow: true } }))).toEqual({ exit: 2, lines: [
        `RA-9: TEST_FLOOR.sha ${AT} is not in this clone, a shallow one (check out with fetch-depth: 0)`,
      ] });
      expect(decide(inputs({ floorTree: { state: 'error', reason: 'git timed out after 60000 ms' } }))).toEqual({ exit: 2, lines: ['RA-9: git timed out after 60000 ms'] });
    });
  });

  it('the walk rule of scripts/jest/__tests__/jestProjects.test.ts decides which paths are test files', () => {
    const yes = ['__tests__/App.test.tsx', 'src/__tests__/helper.ts', 'src/x/__tests__/deep/h.js', 'src/a.test.ts', 'src/a.spec.tsx',
      'src/a.test.mjs', 'src/a.test.cjs', 'src/a.spec.mts', 'src/a.test.jsx', 'src/__fixtures__/a.test.ts', 'src/__tests__/a.d.ts'];
    const no = ['src/a.ts', 'src/__tests__/data.json', 'src/__tests__/a.ts.snap', 'src/a.test.ts.orig', 'node_modules/p/__tests__/a.test.js',
      'modules/m/node_modules/p/a.test.js', '.git/a.test.js', 'src/__fixtures__/a.ts', 'src/x__tests__/a.ts', 'src/test.ts', 'src/a.tests.ts', 'src/__tests__'];
    expect(yes.filter((p) => !isTestPath(p))).toEqual([]);
    expect(no.filter((p) => isTestPath(p))).toEqual([]);
  });
});

describe('QA-041 · the order of decision (plan decision 4)', () => {
  const deleted = runOf(edit(BASE, A, dropped('A t2999')));

  it('a run that cannot be trusted outranks a breach: 2', () => {
    const stale = [{ file: 'old.json', text: jestJson(edit(BASE, A, dropped('A t2999')), {}, COMMIT_TIME * 1000 - 1) }];
    expect(decide(inputs({ results: stale })).exit).toBe(2);
  });

  it('a breach outranks an input that could not be checked: 1, and the unchecked input is named', () => {
    expect(decide(inputs({ results: deleted, floorTree: { state: 'absent', shallow: true } }))).toEqual({ exit: 1, lines: [
      `floor: mobile ran 3208 tests: 3208 < floor 3209 (the baseline's 3209 at ${AT})`,
      `not checked: RA-9: TEST_FLOOR.sha ${AT} is not in this clone, a shallow one (check out with fetch-depth: 0)`,
    ] });
    expect(decide(inputs({ results: runOf(edit(BASE, A, failing('A t1'))), retire: { error: 'SyntaxError: Unexpected token' } }))).toEqual({ exit: 1, lines: [
      `RA-7 CON-1: "A t1" in ${A} did not pass (failed)`,
      'not checked: src/__contracts__/retire.ts: SyntaxError: Unexpected token',
    ] });
  });

  it.each([
    ['test-counts.json that will not load', { counts: { error: 'test counts: sha must be 40 lower-case hex characters, got 988bab3' } }, 'scripts/baselines/test-counts.json: test counts: sha must be 40 lower-case hex characters, got 988bab3'],
    ['mobile recorded as not measured', { counts: { value: { ...COUNTS, mobile: { notMeasured: 'jest could not start' } } } }, 'test-counts.json records mobile as not measured: jest could not start'],
    ['RETIRE that will not load', { retire: { error: 'boom' } }, 'src/__contracts__/retire.ts: boom'],
    ['a manifest that will not load', { manifest: { error: 'boom' } }, 'src/__contracts__/manifest.ts: boom'],
    ['TEST_FLOOR that will not load', { floor: { error: 'boom' } }, 'src/__contracts__/testFloor.baseline.ts: boom'],
  ] as Array<[string, Partial<Inputs>, string]>)('with no breach, %s exits 2 and names it', (_name, over, line) => {
    const v = decide(inputs(over));
    expect(v.exit).toBe(2);
    expect(v.lines).toContain(line);
    expect(v.lines).toEqual([...new Set(v.lines)]); // one line per unchecked input, however many rules read it
  });

  it('mobile not measured, with the empty per-file record testCounts.ts requires then, exits 2: no record rule reads it as a breach', () => {
    const unmeasured = { ...COUNTS, mobile: { notMeasured: 'jest could not start' }, files: { mobile: {} } };
    for (const retire of [{ value: [] }, retireFile(C)]) {
      expect(decide(inputs({ counts: { value: unmeasured }, retire }))).toEqual({ exit: 2, lines: ['test-counts.json records mobile as not measured: jest could not start'] });
    }
  });

  it('a mobile record without its per-file rows (files.mobile) cannot be checked: 2', () => {
    const v = decide(inputs({ counts: { value: { ...COUNTS, files: undefined } as unknown as TestCounts } }));
    expect(v.exit).toBe(2);
    expect(v.lines).toContain('test-counts.json has no per-file record (files.mobile)');
  });
});

describe('QA-041 · the backend (totals and the pending bound only)', () => {
  const backend = (over: Partial<Inputs> = {}): Inputs => ({
    pkg: 'backend', head: HEAD, results: runOf(BASE), locate,
    headFacts: { value: { sha: HEAD, parents: [HEAD_P1], commitTime: COMMIT_TIME } },
    counts: { value: COUNTS }, ...over,
  });

  it('a run that meets the totals exits 0 and says RA-7 has no backend manifest; no RETIRE, manifest or floor list is read', () => {
    const v = decide(backend());
    expect(v.exit).toBe(0);
    expect(v.lines).toContain('RA-7: the backend has no contract manifest (OPS-413), so no contract test was checked');
  });

  it('planted: a deleted backend test exits 1 through the floor; a .skip through RA-5', () => {
    const deleted = backend({ results: runOf(edit(BASE, A, dropped('A t2999'))) });
    expect(decide(deleted)).toEqual({ exit: 1, lines: [`floor: backend ran 3208 tests: 3208 < floor 3209 (the baseline's 3209 at ${AT})`] });
    expect(decide(deleted, new Set<RuleId>(['RA-5'])).exit).toBe(0);
    const skipped = backend({ results: runOf(edit(BASE, A, pending('A t10'))) });
    expect(decide(skipped)).toEqual({ exit: 1, lines: [`RA-5: backend has 2 pending and todo tests (2 pending, 0 todo): 2 > bound 1 (the baseline's 1 at ${AT})`] });
    expect(decide(skipped, new Set<RuleId>(['floor'])).exit).toBe(0);
  });

  it('a RETIRE entry does not lower the backend floor (the backend has no RETIRE path, OPS-473)', () => {
    expect(decide(backend({ results: runOf(without(BASE, C)), retire: retireFile(C), decStatus: stub })).exit).toBe(1);
  });

  it('the backend recorded as not measured exits 2', () => {
    expect(decide(backend({ counts: { value: { ...COUNTS, backend: { notMeasured: 'MongoMemoryServer could not start' } } } }))).toEqual({
      exit: 2, lines: ['test-counts.json records backend as not measured: MongoMemoryServer could not start'],
    });
  });
});

describe('QA-041 · what the CLI prints', () => {
  it('a header with the verdict, then one line per finding', () => {
    expect(formatVerdict('mobile', { exit: 0, lines: ['a', 'b'] })).toBe('QA-041 mobile: VERIFIED (exit 0)\n  - a\n  - b\n');
    expect(formatVerdict('backend', { exit: 1, lines: ['x'] })).toBe('QA-041 backend: BREACH (exit 1)\n  - x\n');
    expect(formatVerdict(null, { exit: 2, lines: ['y'] })).toBe('QA-041: CANNOT VERIFY (exit 2, never a pass)\n  - y\n');
  });

  it('planted: a title that spells a workflow command on a new line stays inside its own line', () => {
    const title = 'A t1\n::add-mask::planted\r::error::planted';
    const out = formatVerdict('mobile', decide(inputs({ results: runOf(edit(BASE, A, failing('A t1'))), manifest: { value: { 'CON-1': [{ file: A, fullTitle: title }] } } })));
    expect(out.split('\n').filter((l) => l.startsWith('::'))).toEqual([]);
    expect(formatVerdict('mobile', { exit: 1, lines: ['p\nq\u2028r\u0007'] })).toBe('QA-041 mobile: BREACH (exit 1)\n  - p\\u000aq\\u2028r\\u0007\n');
  });
});

// ---- plan step 8: what the entry needs from the core ---------------------------------------------------

describe('QA-041 \u00b7 the command line (plan "CLI usage")', () => {
  it('reads the mobile form (shards), the backend form and --check-inputs alone', () => {
    expect(parseArgs(['--package', 'mobile', '--results', 'a.json', '--results', 'b.json', '--expect-shards', '2', '--head', HEAD]))
      .toEqual({ args: { mode: 'check', pkg: 'mobile', results: ['a.json', 'b.json'], expectShards: 2, head: HEAD } });
    expect(parseArgs(['--package', 'backend', '--results', '/runner/temp/jest-backend.json', '--head', HEAD]))
      .toEqual({ args: { mode: 'check', pkg: 'backend', results: ['/runner/temp/jest-backend.json'], head: HEAD } });
    expect(parseArgs(['--check-inputs'])).toEqual({ args: { mode: 'inputs' } });
    expect(USAGE).toMatch(/--package mobile\|backend --results <file>/);
  });

  it.each([
    [[], 'no --package'],
    [['--package', 'web', '--results', 'a', '--head', HEAD], '--package must be mobile or backend, got "web"'],
    [['--package', 'mobile', '--head', HEAD], 'no --results file'],
    [['--package', 'mobile', '--results', 'a'], 'no --head'],
    [['--package', 'mobile', '--results', 'a', '--head', 'abc1234'], '--head must be a full 40-hex commit SHA, got "abc1234"'],
    [['--package', 'mobile', '--results', '--head', HEAD], '--results needs a value'],
    [['--package'], '--package needs a value'],
    [['--package', 'mobile', '--package', 'backend', '--results', 'a', '--head', HEAD], '--package is given twice'],
    [['--package', 'mobile', '--results', 'a', '--head', HEAD, '--head', HEAD], '--head is given twice'],
    [['--package', 'mobile', '--results', 'a', '--head', HEAD, '--expect-shards', '0'], '--expect-shards must be a whole number of 1 or more, got "0"'],
    [['--package', 'mobile', '--results', 'a', '--head', HEAD, '--expect-shards', '8x'], '--expect-shards must be a whole number of 1 or more, got "8x"'],
    [['--check-inputs', '--package', 'mobile'], '--check-inputs takes no other argument'],
    [['--package', 'mobile', '--results', 'a', '--head', HEAD, '--verbose'], 'unknown argument "--verbose"'],
  ] as Array<[string[], string]>)('refuses %j: %s', (argv, usage) => {
    expect(parseArgs(argv)).toEqual({ usage });
  });
});

describe('QA-041 \u00b7 the data modules, read by shape (a module of the wrong shape cannot be checked: 2)', () => {
  it('accepts the shapes of RETIRE, CONTRACTS and TEST_FLOOR', () => {
    expect(asRetire([{ kind: 'file', target: A, dec: 'DEC-900', reason: 'r' }])).toEqual([{ kind: 'file', target: A, dec: 'DEC-900', reason: 'r' }]);
    expect(asManifest(MANIFEST)).toBe(MANIFEST);
    expect(asFloorList({ ...FLOOR, skipCount: 2, measuredAt: 'x', command: 'y' })).toEqual(expect.objectContaining(FLOOR));
  });

  it.each([
    ['RETIRE not a list', () => asRetire({}), 'RETIRE is not a list'],
    ['a RETIRE kind of its own', () => asRetire([{ kind: 'moved', target: A, dec: 'DEC-900', reason: 'r' }]), 'RETIRE[0]: kind must be file or pin, got "moved"'],
    ['a RETIRE entry with no target', () => asRetire([{ kind: 'file', target: '', dec: 'DEC-900', reason: 'r' }]), 'RETIRE[0]: target must be text that is not empty'],
    ['a RETIRE dec that is not text', () => asRetire([{ kind: 'pin', target: 'p', dec: 900, reason: 'r' }]), 'RETIRE[0]: dec must be text'],
    ['a RETIRE entry with no reason', () => asRetire([{ kind: 'pin', target: 'p', dec: 'DEC-900' }]), 'RETIRE[0]: reason must be text'],
    ['CONTRACTS not an object', () => asManifest([]), 'CONTRACTS is not an object'],
    ['a contract that is not a list', () => asManifest({ X: 'A t1' }), 'CONTRACTS X is not a list'],
    ['a reference without its title', () => asManifest({ X: [{ file: A }] }), 'CONTRACTS X[0] needs a file and a fullTitle'],
    ['a floor SHA that is not 40 hex', () => asFloorList({ ...FLOOR, sha: 'HEAD' }), 'TEST_FLOOR.sha must be 40 lower-case hex characters, got "HEAD"'],
    ['a floor count that is not a whole number', () => asFloorList({ ...FLOOR, listTestsCount: 2.5 }), 'TEST_FLOOR.listTestsCount must be a whole number of 0 or more'],
    ['floor paths that are not a list of text', () => asFloorList({ ...FLOOR, paths: [A, 7] }), 'TEST_FLOOR.paths must be a list of paths'],
  ] as Array<[string, () => unknown, string]>)('refuses %s', (_name, read, message) => {
    expect(read).toThrow(message);
  });
});

describe('QA-041 \u00b7 --check-inputs (the data loads, or it says which part does not)', () => {
  const loaded = { counts: { value: COUNTS }, retire: { value: [] }, manifest: { value: MANIFEST }, floor: { value: FLOOR } };

  it('exits 0 and says what it loaded', () => {
    expect(checkInputs(loaded)).toEqual({ exit: 0, lines: [
      `scripts/baselines/test-counts.json: measured at ${AT}; mobile 3209 tests in 3 files (1 pending, 0 todo); backend 3209 tests (1 pending, 0 todo)`,
      'src/__contracts__/retire.ts: 0 RETIRE entries',
      'src/__contracts__/manifest.ts: 2 contracts, 3 test references',
      `src/__contracts__/testFloor.baseline.ts: 3 paths at ${AT}`,
    ] });
  });

  it('exits 2 and names every part that did not load', () => {
    expect(checkInputs({ ...loaded, retire: { error: 'did not load: SyntaxError' }, floor: { error: 'TEST_FLOOR.paths must be a list of paths' } })).toEqual({ exit: 2, lines: [
      'src/__contracts__/retire.ts: did not load: SyntaxError',
      'src/__contracts__/testFloor.baseline.ts: TEST_FLOOR.paths must be a list of paths',
    ] });
  });

  it('a package recorded as not measured still loads: it is named, not refused', () => {
    const v = checkInputs({ ...loaded, counts: { value: { ...COUNTS, mobile: { notMeasured: 'jest could not start' }, files: { mobile: {} } } } });
    expect(v.exit).toBe(0);
    expect(v.lines[0]).toBe(`scripts/baselines/test-counts.json: measured at ${AT}; mobile not measured (jest could not start); backend 3209 tests (1 pending, 0 todo)`);
  });
});
