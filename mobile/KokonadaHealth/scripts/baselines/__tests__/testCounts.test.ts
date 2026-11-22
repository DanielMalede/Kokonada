/// <reference types="node" />
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { TEST_FLOOR } from '../../../src/__contracts__/testFloor.baseline';
import { loadMutant } from '../../../src/testing/mutant';
import { readTestCounts, testCountsPath, validateTestCounts, type FileCounts, type TestCounts } from '../testCounts';

// QA-042 (Stage 0 Q2): the real mobile and backend test counts, measured with `jest --ci --json` on a clean
// main at a recorded SHA, live in one file, scripts/baselines/test-counts.json, the one place QA-041 reads.
// This pins the file's shape: a malformed record fails here instead of feeding QA-041 a false floor.

const APP = path.resolve(__dirname, '../../..');
const MODULE = path.join(APP, 'scripts/baselines/testCounts.ts');

describe('QA-042 · the recorded jest baseline', () => {
  let recorded: TestCounts;
  beforeAll(() => { recorded = readTestCounts(testCountsPath(APP)); });

  it('is well formed: a 40-hex SHA, positive integer counts for both packages, the tools and the command', () => {
    expect(testCountsPath(APP)).toBe(path.join(APP, 'scripts', 'baselines', 'test-counts.json'));
    expect(validateTestCounts(recorded)).toBe(recorded);
    for (const pkg of ['mobile', 'backend'] as const) {
      const c = recorded[pkg];
      expect('numTotalTests' in c ? c.numTotalTests : 0).toBeGreaterThan(0);
    }
  });

  it('records the skipped (pending) and todo counts, measured at the SHA (numTotalTests counts them, so a .skip alone keeps the total)', () => {
    // jest --ci --json at 988bab3 (runs/q2-mobile-jest.json, q2-backend-jest.json), the same as CI run 44090925847.
    expect(recorded.mobile).toEqual({ numTotalTestSuites: 219, numTotalTests: 3209, numPendingTests: 1, numTodoTests: 0 });
    expect(recorded.backend).toEqual({ numTotalTestSuites: 357, numTotalTests: 6370, numPendingTests: 65, numTodoTests: 1 });
  });

  const planted: Array<[string, (c: TestCounts) => unknown, RegExp]> = [
    ['a short SHA', (c) => ({ ...c, sha: c.sha.slice(0, 7) }), /sha/],
    ['an upper-case SHA', (c) => ({ ...c, sha: c.sha.toUpperCase() }), /sha/],
    ['a zero test count', (c) => ({ ...c, mobile: { ...c.mobile, numTotalTests: 0 } }), /mobile\.numTotalTests/],
    ['a fractional suite count', (c) => ({ ...c, backend: { ...c.backend, numTotalTestSuites: 3.5 } }), /backend\.numTotalTestSuites/],
    ['a count given as a string', (c) => ({ ...c, mobile: { ...c.mobile, numTotalTests: '3209' } }), /mobile\.numTotalTests/],
    ['more suites than tests', (c) => ({ ...c, mobile: { numTotalTestSuites: 10, numTotalTests: 5 } }), /mobile/],
    ['a package missing with no reason', (c) => ({ ...c, backend: undefined }), /backend/],
    ['a package not measured with an empty reason', (c) => ({ ...c, backend: { notMeasured: ' ' } }), /backend/],
    ['no node version', (c) => ({ ...c, node: '' }), /node/],
    ['no jest version', (c) => ({ ...c, jest: undefined }), /jest/],
    ['no command', (c) => ({ ...c, command: {} }), /command/],
    ['a measuredAt that is not an ISO time', (c) => ({ ...c, measuredAt: 'yesterday' }), /measuredAt/],
    ['a package without its pending count', (c) => ({ ...c, mobile: { numTotalTestSuites: 219, numTotalTests: 3209, numTodoTests: 0 } }), /mobile\.numPendingTests/],
    ['a package without its todo count', (c) => ({ ...c, backend: { numTotalTestSuites: 357, numTotalTests: 6370, numPendingTests: 65 } }), /backend\.numTodoTests/],
    ['a negative pending count', (c) => ({ ...c, mobile: { ...c.mobile, numPendingTests: -1 } }), /mobile\.numPendingTests/],
    ['a fractional todo count', (c) => ({ ...c, backend: { ...c.backend, numTodoTests: 0.5 } }), /backend\.numTodoTests/],
    ['skipped and todo tests making up the whole total', (c) => ({ ...c, mobile: { numTotalTestSuites: 1, numTotalTests: 3, numPendingTests: 2, numTodoTests: 1 } }), /mobile/],
  ];
  it.each(planted)('planted (in memory): %s is refused', (_name, mutate, message) => {
    expect(() => validateTestCounts(mutate(recorded))).toThrow(message);
  });

  it('a package that could not be measured is accepted only with its recorded reason', () => {
    const reasoned = { ...recorded, backend: { notMeasured: 'MongoMemoryServer could not start on the measuring machine' } };
    expect(validateTestCounts(reasoned)).toBe(reasoned);
  });
});

// OPS-412: the QA-041 CLI (scripts/baselines/qa041.mjs) loads this module in plain Node 24, through type
// stripping, without jest or babel. So the module takes its root from the caller (no __dirname, which an ES
// module does not have) and reads only the file it is given.
describe('OPS-412 · plain Node imports the module', () => {
  it('testCountsPath(appRoot) is scripts/baselines/test-counts.json under the root it is given', () => {
    const root = path.join(os.tmpdir(), 'planted-app-root');
    expect(testCountsPath(root)).toBe(path.join(root, 'scripts', 'baselines', 'test-counts.json'));
  });

  it('readTestCounts has no default file: called without one, it reads nothing and throws', () => {
    let thrown: unknown;
    try {
      (readTestCounts as unknown as (file?: string) => TestCounts)();
    } catch (e) {
      thrown = e;
    }
    expect((thrown as { code?: string } | undefined)?.code).toBe('ERR_INVALID_ARG_TYPE');
  });

  it('Node imports testCounts.ts by type stripping, from another directory, and reads the real record', () => {
    const script = [
      `const m = await import(${JSON.stringify(pathToFileURL(MODULE).href)});`,
      `const c = m.readTestCounts(m.testCountsPath(${JSON.stringify(APP)}));`,
      'const rows = Object.values(c.files.mobile);',
      'const sums = [0, 1, 2].map((i) => rows.reduce((n, r) => n + r[i], 0));',
      'console.log(JSON.stringify({ exports: Object.keys(m).sort(), mobile: c.mobile, rows: rows.length, sums }));',
    ].join('\n');
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: os.tmpdir(), encoding: 'utf8', timeout: 60_000 });
    // stderr is shown only when the import fails; a warning on a passing run is not asserted away.
    expect({ status: r.status, error: r.error, stderr: r.status === 0 ? '' : r.stderr }).toEqual({ status: 0, error: undefined, stderr: '' });
    expect(JSON.parse(r.stdout.trim())).toEqual({
      exports: ['readTestCounts', 'testCountsPath', 'validateTestCounts'],
      mobile: { numTotalTestSuites: 219, numTotalTests: 3209, numPendingTests: 1, numTodoTests: 0 },
      rows: 219,
      sums: [3209, 1, 0],
    });
  });
});

// OPS-412 plan decision 1: files.mobile is the 988bab3 run per file, [tests, pending, todo] for each file of
// TEST_FLOOR.paths, so a RETIRE `file` entry discounts exactly its own file's tests. Its SHA-256 was computed by
// the step 1 measurement from the raw run (runs/q2-mobile-jest.json, itself SHA-256 4750eb85...), never from
// this file: one line per file, `path TAB tests TAB pending TAB todo`, joined by LF, in record order. A count,
// key or order changed by hand fails here.
const MEASURED_RECORD_SHA256 = 'da00ecaf03d86393827e400ee333ee3faa769ce46e9f55cbbb37990e65003a55';
const recordSha256 = (rows: Readonly<Record<string, FileCounts>>): string =>
  createHash('sha256').update(Object.entries(rows).map(([file, counts]) => [file, ...counts].join('\t')).join('\n')).digest('hex');

describe('OPS-412 · files.mobile, the 988bab3 run per file', () => {
  let recorded: TestCounts;
  beforeAll(() => { recorded = readTestCounts(testCountsPath(APP)); });

  it('is the measured record: its SHA-256 is the one derived from the raw run', () => {
    expect(recordSha256(recorded.files.mobile)).toBe(MEASURED_RECORD_SHA256);
  });

  it('names exactly the files of TEST_FLOOR.paths, in code unit order, and its rows sum to the mobile totals', () => {
    const rows = recorded.files.mobile;
    expect(Object.keys(rows)).toEqual([...TEST_FLOOR.paths]);
    const sum = (i: number) => Object.values(rows).reduce((n, r) => n + r[i], 0);
    expect([Object.keys(rows).length, sum(0), sum(1), sum(2)]).toEqual([219, 3209, 1, 0]);
    expect(rows['scripts/lab/__tests__/bundleAndBuild.test.ts']).toEqual([17, 1, 0]); // the run's one pending test
    expect(rows['src/experience/playback/__tests__/NowPlayingScreen.test.tsx']).toEqual([57, 0, 0]);
  });
});

// OPS-412 plan step 2: a malformed record is refused, each case by its own rule. Every planted record below
// breaks one rule and, where it can, keeps every other one (the sums kept by a compensating row). Each is then
// run once more against an in-memory mutant of testCounts.ts with that rule switched off (src/testing/mutant.ts:
// its `if (<condition>)` becomes `if (false)`); the outcome its row names, accepted or caught by another rule,
// shows which rule did the catching. Nothing planted is written to disk (D8 rule 2).
const RULES = {
  missing: 'if (!isObject(record))',
  backslash: "if (key.includes('\\\\'))",
  order: 'if (i > 0 && !(keys[i - 1] < key))',
  shape: 'if (!Array.isArray(row) || row.length !== 3)',
  integers: 'if (!(countInt(tests) && countInt(pending) && countInt(todo)))',
  rowBound: 'if (pending + todo > tests)',
  notMeasured: 'if (keys.length > 0)',
  keySet: 'if (missing.length > 0 || extra.length > 0)',
  suites: 'if (keys.length !== m.numTotalTestSuites)',
  testsSum: 'if (sum.tests !== m.numTotalTests)',
  pendingSum: 'if (sum.pending !== m.numPendingTests)',
  todoSum: 'if (sum.todo !== m.numTodoTests)',
} as const;
type Rule = keyof typeof RULES;
const REFUSAL: Record<Rule, RegExp> = {
  missing: /files\.mobile is missing/,
  backslash: /has a backslash/,
  order: /sorted in code unit order/,
  shape: /must be a row \[tests, pending, todo\]/,
  integers: /counts must be integers of 0 or more/,
  rowBound: /more pending \+ todo/,
  notMeasured: /mobile is not measured, so files\.mobile must be empty/,
  keySet: /must name exactly the 219 files of TEST_FLOOR\.paths/,
  suites: /rows, mobile\.numTotalTestSuites is/,
  testsSum: /tests sum to .*, mobile\.numTotalTests is 3209/,
  pendingSum: /pending sum to 2, mobile\.numPendingTests is 1/,
  todoSum: /todo sum to 1, mobile\.numTodoTests is 0/,
};

const PENDING_FILE = 'scripts/lab/__tests__/bundleAndBuild.test.ts'; // [17, 1, 0]
const BIG_FILE = 'src/experience/playback/__tests__/NowPlayingScreen.test.tsx'; // [57, 0, 0]
const LAST_FILE = 'tools/eslint-plugin-kokonada/__tests__/tokenIndex.test.js'; // [23, 0, 0]

const entriesOf = (c: TestCounts): Array<[string, unknown]> => Object.entries(c.files.mobile);
const withRows = (c: TestCounts, entries: Array<[string, unknown]>): unknown => ({ ...c, files: { mobile: Object.fromEntries(entries) } });
/** The record with the given rows replaced in place; a key that is not a row fails, so nothing is planted silently. */
const patch = (c: TestCounts, rows: Record<string, unknown>): unknown => {
  for (const k of Object.keys(rows)) if (!Object.hasOwn(c.files.mobile, k)) throw new Error(`planted: ${k} is not a row of the record`);
  return withRows(c, entriesOf(c).map(([k, v]) => [k, Object.hasOwn(rows, k) ? rows[k] : v]));
};
const renamed = (c: TestCounts, from: string, to: string): unknown => withRows(c, entriesOf(c).map(([k, v]) => [k === from ? to : k, v]));
const withoutFiles = (c: TestCounts): unknown => {
  const copy: Partial<TestCounts> = { ...c };
  delete copy.files;
  return copy;
};

type Outcome = 'accepted' | RegExp | typeof TypeError;
const PLANTS: Array<[name: string, rule: Rule, mutate: (c: TestCounts) => unknown, off: Outcome]> = [
  ['a backslash in a key (still in code unit order)', 'backslash', (c) => renamed(c, LAST_FILE, LAST_FILE.split('/').join('\\')), REFUSAL.keySet],
  ['two keys out of code unit order', 'order', (c) => { const e = entriesOf(c); return withRows(c, [e[1], e[0], ...e.slice(2)]); }, 'accepted'],
  ['keys sorted by localeCompare, not code unit order', 'order', (c) => withRows(c, [...entriesOf(c)].sort(([a], [b]) => a.localeCompare(b))), 'accepted'],
  ['a fractional count (the sums kept)', 'integers', (c) => patch(c, { [BIG_FILE]: [57.5, 0, 0], [LAST_FILE]: [22.5, 0, 0] }), 'accepted'],
  ['a negative count (the sums kept)', 'integers', (c) => patch(c, { [PENDING_FILE]: [17, -1, 0], [BIG_FILE]: [57, 2, 0] }), 'accepted'],
  ['a count written as a string', 'integers', (c) => patch(c, { [BIG_FILE]: ['57', 0, 0] }), REFUSAL.testsSum],
  ['a row of four numbers', 'shape', (c) => patch(c, { [BIG_FILE]: [57, 0, 0, 0] }), 'accepted'],
  ['a row of two numbers', 'shape', (c) => patch(c, { [BIG_FILE]: [57, 0] }), REFUSAL.integers],
  ['pending + todo above its tests (the sums kept)', 'rowBound', (c) => patch(c, { [PENDING_FILE]: [0, 1, 0], [BIG_FILE]: [74, 0, 0] }), 'accepted'],
  ['tests that sum to 3210', 'testsSum', (c) => patch(c, { [BIG_FILE]: [58, 0, 0] }), 'accepted'],
  ['pending tests that sum to 2', 'pendingSum', (c) => patch(c, { [BIG_FILE]: [57, 1, 0] }), 'accepted'],
  ['todo tests that sum to 1', 'todoSum', (c) => patch(c, { [BIG_FILE]: [57, 0, 1] }), 'accepted'],
  ['a suite total the rows do not match (218)', 'suites', (c) => ({ ...c, mobile: { ...c.mobile, numTotalTestSuites: 218 } }), 'accepted'],
  ['a floor file renamed (the count and sums kept)', 'keySet', (c) => renamed(c, LAST_FILE, LAST_FILE.replace('tokenIndex', 'tokenIndex2')), 'accepted'],
  ['a floor file dropped, its tests moved to another row', 'keySet', (c) => withRows(c, entriesOf(c).filter(([k]) => k !== LAST_FILE).map(([k, v]) => [k, k === BIG_FILE ? [80, 0, 0] : v])), REFUSAL.suites],
  ['a file outside the floor added, with no tests', 'keySet', (c) => withRows(c, [...entriesOf(c), ['tools/zz/__tests__/planted.test.js', [0, 0, 0]]]), REFUSAL.suites],
  ['no files.mobile', 'missing', (c) => ({ ...c, files: {} }), TypeError],
  ['no files at all', 'missing', withoutFiles, TypeError],
  ['files.mobile given as a list', 'missing', (c) => ({ ...c, files: { mobile: [] } }), REFUSAL.keySet],
  ['mobile not measured, with per-file numbers', 'notMeasured', (c) => ({ ...c, mobile: { notMeasured: 'planted: the run could not start' } }), 'accepted'],
];

type TestCountsModule = typeof import('../testCounts');
const MUTANT_TIMEOUT_MS = 30_000; // the first mutant loads @babel/core (src/testing/__tests__/mutant.test.ts)
const mutants = new Map<Rule | 'none', TestCountsModule>();
const moduleWithRuleOff = (rule: Rule | 'none'): TestCountsModule => {
  let m = mutants.get(rule);
  if (!m) {
    m = loadMutant<TestCountsModule>(MODULE, rule === 'none' ? [] : [{ find: RULES[rule], replace: 'if (false)' }], require);
    mutants.set(rule, m);
  }
  return m;
};

describe('OPS-412 · a malformed files.mobile is refused, each case by its own rule', () => {
  let recorded: TestCounts;
  beforeAll(() => { recorded = readTestCounts(testCountsPath(APP)); });

  it('every rule has a planted record, and the locale-order plant is not vacuous', () => {
    expect([...new Set(PLANTS.map(([, rule]) => rule))].sort()).toEqual(Object.keys(RULES).sort());
    const keys = Object.keys(recorded.files.mobile);
    expect([...keys].sort((a, b) => a.localeCompare(b))).not.toEqual(keys);
  });

  it.each(PLANTS)('planted (in memory): %s is refused (rule: %s)', (_name, rule, mutate) => {
    expect(() => validateTestCounts(mutate(recorded))).toThrow(REFUSAL[rule]);
  });

  it.each(PLANTS)('planted (in memory): %s, with rule %s switched off in a mutant, gets the outcome its row names', (_name, rule, mutate, off) => {
    const planted = mutate(recorded);
    const mutant = moduleWithRuleOff(rule);
    if (off === 'accepted') {
      expect(mutant.validateTestCounts(planted)).toBe(planted);
    } else {
      expect(() => mutant.validateTestCounts(planted)).toThrow(off);
      expect(() => mutant.validateTestCounts(planted)).not.toThrow(REFUSAL[rule]); // that rule is really off
    }
  }, MUTANT_TIMEOUT_MS);

  it('the in-memory copy with no rule switched off accepts the real record and refuses every plant as the module does', () => {
    const copy = moduleWithRuleOff('none');
    expect(copy.validateTestCounts(recorded)).toBe(recorded);
    for (const [, rule, mutate] of PLANTS) expect(() => copy.validateTestCounts(mutate(recorded))).toThrow(REFUSAL[rule]);
  }, MUTANT_TIMEOUT_MS);

  it('mobile not measured is accepted with an empty files.mobile: no per-file numbers without a measurement', () => {
    const unmeasured = { ...recorded, mobile: { notMeasured: 'planted: the run could not start' }, files: { mobile: {} } };
    expect(validateTestCounts(unmeasured)).toBe(unmeasured);
  });
});
