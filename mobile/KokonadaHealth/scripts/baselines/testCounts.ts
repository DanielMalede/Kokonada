/// <reference types="node" />
// QA-042 (Stage 0 Q2): the shape of scripts/baselines/test-counts.json, the jest baseline QA-041 reads.
// The counts come from `jest --ci --json` (numTotalTestSuites, numTotalTests, numPendingTests,
// numTodoTests) on a clean main at `sha`.
// A package that could not be measured carries its reason instead of numbers, never a guess.
//
// OPS-412: the QA-041 CLI (qa041.mjs) loads this module in plain Node 24 through type stripping, and jest
// loads it through babel. So it imports only Node builtins (as node:*) and explicit .ts paths, and reads no
// __dirname (an ES module has none): the caller names the app root.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { TEST_FLOOR } from '../../src/__contracts__/testFloor.baseline.ts';

/** scripts/baselines/test-counts.json under the app root (mobile/KokonadaHealth) the caller names. */
export function testCountsPath(appRoot: string): string {
  return path.join(appRoot, 'scripts/baselines/test-counts.json');
}

/**
 * numTotalTests counts skipped (pending) and todo tests too, so a `.skip` alone keeps the total: QA-041
 * reads the pending and todo counts beside it.
 */
export type PackageCounts =
  | { numTotalTestSuites: number; numTotalTests: number; numPendingTests: number; numTodoTests: number }
  | { notMeasured: string };

/** One test file of the measured run: its tests (jest counts skipped and todo ones in them), pending, todo. */
export type FileCounts = readonly [tests: number, pending: number, todo: number];

export interface TestCounts {
  sha: string;
  measuredAt: string;
  node: string;
  jest: string;
  /** The exact command per measured package, run from that package's directory. */
  command: Partial<Record<'mobile' | 'backend', string>>;
  mobile: PackageCounts;
  backend: PackageCounts;
  /** Where the counts were cross-checked (a CI run on the same SHA), if anywhere. */
  crossCheck?: string;
  /**
   * The same mobile run per file (OPS-412): [tests, pending, todo] keyed by the path relative to the app,
   * posix, in code unit order; the keys are exactly TEST_FLOOR.paths, so a RETIRE `file` entry discounts its
   * own row.
   */
  files: { mobile: Readonly<Record<string, FileCounts>> };
}

const positiveInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;
const countInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * files.mobile: one [tests, pending, todo] row per test file of the mobile run, keyed exactly as TEST_FLOOR.paths
 * (posix, relative to the app, in code unit order), its rows and sums equal to the mobile totals. A mobile run
 * that was not measured has no per-file numbers either.
 */
function validateFileRecord(c: TestCounts): void {
  const files: unknown = c.files;
  const record = isObject(files) ? files.mobile : undefined;
  if (!isObject(record)) throw new Error('test counts: files.mobile is missing or not an object (one [tests, pending, todo] row per test file of the mobile run)');
  const keys = Object.keys(record);
  const sum = { tests: 0, pending: 0, todo: 0 };
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (key.includes('\\')) throw new Error(`test counts: files.mobile key ${key} has a backslash (keys are posix paths relative to the app)`);
    if (i > 0 && !(keys[i - 1] < key)) throw new Error(`test counts: files.mobile keys must be sorted in code unit order: ${keys[i - 1]} comes before ${key}`);
    const row: unknown = record[key];
    if (!Array.isArray(row) || row.length !== 3) throw new Error(`test counts: files.mobile ${key} must be a row [tests, pending, todo], got ${JSON.stringify(row)}`);
    const [tests, pending, todo]: unknown[] = row;
    if (!(countInt(tests) && countInt(pending) && countInt(todo))) throw new Error(`test counts: files.mobile ${key} counts must be integers of 0 or more, got ${JSON.stringify(row)}`);
    if (pending + todo > tests) throw new Error(`test counts: files.mobile ${key} has more pending + todo (${pending + todo}) than tests (${tests})`);
    sum.tests += tests;
    sum.pending += pending;
    sum.todo += todo;
  }
  const m = c.mobile;
  if ('notMeasured' in m) {
    if (keys.length > 0) throw new Error('test counts: mobile is not measured, so files.mobile must be empty (no per-file numbers without a measurement)');
    return;
  }
  const floor = new Set(TEST_FLOOR.paths);
  const named = new Set(keys);
  const missing = TEST_FLOOR.paths.filter((p) => !named.has(p));
  const extra = keys.filter((k) => !floor.has(k));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`test counts: files.mobile must name exactly the ${TEST_FLOOR.paths.length} files of TEST_FLOOR.paths (measured at ${TEST_FLOOR.sha.slice(0, 12)}): `
      + `${missing.length} missing ${JSON.stringify(missing.slice(0, 3))}, ${extra.length} not in it ${JSON.stringify(extra.slice(0, 3))}`);
  }
  if (keys.length !== m.numTotalTestSuites) throw new Error(`test counts: files.mobile has ${keys.length} rows, mobile.numTotalTestSuites is ${m.numTotalTestSuites}`);
  if (sum.tests !== m.numTotalTests) throw new Error(`test counts: files.mobile tests sum to ${sum.tests}, mobile.numTotalTests is ${m.numTotalTests}`);
  if (sum.pending !== m.numPendingTests) throw new Error(`test counts: files.mobile pending sum to ${sum.pending}, mobile.numPendingTests is ${m.numPendingTests}`);
  if (sum.todo !== m.numTodoTests) throw new Error(`test counts: files.mobile todo sum to ${sum.todo}, mobile.numTodoTests is ${m.numTodoTests}`);
}

export function validateTestCounts(value: unknown): TestCounts {
  const c = value as TestCounts;
  if (!c || typeof c !== 'object') throw new Error('test counts: not an object');
  if (typeof c.sha !== 'string' || !/^[0-9a-f]{40}$/.test(c.sha)) throw new Error(`test counts: sha must be 40 lower-case hex characters, got ${String(c.sha)}`);
  if (!text(c.measuredAt) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(c.measuredAt)) throw new Error('test counts: measuredAt must be an ISO UTC time');
  if (!text(c.node) || !/^v\d+\.\d+\.\d+$/.test(c.node)) throw new Error('test counts: node must be a version like v24.19.0');
  if (!text(c.jest) || !/^\d+\.\d+\.\d+$/.test(c.jest)) throw new Error('test counts: jest must be a version');
  if (!c.command || typeof c.command !== 'object') throw new Error('test counts: command must name the command per package');
  for (const pkg of ['mobile', 'backend'] as const) {
    const p = c[pkg] as Record<string, unknown> | undefined;
    if (!p || typeof p !== 'object') throw new Error(`test counts: ${pkg} is missing (record its counts or why it was not measured)`);
    if ('notMeasured' in p) {
      if (!text(p.notMeasured)) throw new Error(`test counts: ${pkg}.notMeasured must give the reason`);
      continue;
    }
    if (!positiveInt(p.numTotalTestSuites)) throw new Error(`test counts: ${pkg}.numTotalTestSuites must be a positive integer`);
    if (!positiveInt(p.numTotalTests)) throw new Error(`test counts: ${pkg}.numTotalTests must be a positive integer`);
    if (p.numTotalTests < p.numTotalTestSuites) throw new Error(`test counts: ${pkg} has fewer tests than suites`);
    if (!countInt(p.numPendingTests)) throw new Error(`test counts: ${pkg}.numPendingTests must be an integer of 0 or more`);
    if (!countInt(p.numTodoTests)) throw new Error(`test counts: ${pkg}.numTodoTests must be an integer of 0 or more`);
    if (p.numPendingTests + p.numTodoTests >= p.numTotalTests) throw new Error(`test counts: ${pkg} has no test that runs (pending + todo >= total)`);
    if (!text(c.command[pkg])) throw new Error(`test counts: command.${pkg} is missing`);
  }
  validateFileRecord(c); // after the package counts, so a malformed total is named first
  return c;
}

/** Reads and validates the given file; there is no default (testCountsPath(appRoot) names the real one). */
export function readTestCounts(file: string): TestCounts {
  return validateTestCounts(JSON.parse(fs.readFileSync(file, 'utf8')));
}
