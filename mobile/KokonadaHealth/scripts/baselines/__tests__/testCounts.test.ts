/// <reference types="node" />
import { spawnSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { readTestCounts, testCountsPath, validateTestCounts, type TestCounts } from '../testCounts';

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
      'console.log(JSON.stringify({ exports: Object.keys(m).sort(), mobile: c.mobile }));',
    ].join('\n');
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: os.tmpdir(), encoding: 'utf8', timeout: 60_000 });
    // stderr is shown only when the import fails; a warning on a passing run is not asserted away.
    expect({ status: r.status, error: r.error, stderr: r.status === 0 ? '' : r.stderr }).toEqual({ status: 0, error: undefined, stderr: '' });
    expect(JSON.parse(r.stdout.trim())).toEqual({
      exports: ['readTestCounts', 'testCountsPath', 'validateTestCounts'],
      mobile: { numTotalTestSuites: 219, numTotalTests: 3209, numPendingTests: 1, numTodoTests: 0 },
    });
  });
});
