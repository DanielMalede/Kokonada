// QA-041 proper (OPS-412 part A): the test-count floor, read from `jest --ci --json`. This is the pure
// core. It takes the run's JSON text, git's facts and the data the entry loaded, and decides an exit
// code: 0 verified, 1 a breach, 2 cannot verify (never a pass). It does no I/O: qa041Sources.ts gathers
// the facts and qa041.mjs loads the modules, so every check here runs on in-memory inputs in a test.
//
// The order of decision (plan decision 4):
//   1. exit 2 when the run itself cannot be trusted: a results file unread, not JSON, not jest's shape,
//      counts that disagree with its test results, an empty or interrupted run, a suite that failed
//      to run, a test file outside the package or in two results files, a shard count that differs
//      from --expect-shards, a head the results are not bound to, or a run older than HEAD;
//   2. otherwise exit 1 on any breach;
//   3. otherwise exit 2 when another input could not be checked;
//   4. otherwise exit 0.
//
// Node strips this file's types (qa041.mjs imports it): Node builtins and explicit .ts paths only, no
// top-level __dirname, no typescript, no enum, and type imports written as `import type`.

import type { TestCounts } from './testCounts.ts';

export type Pkg = 'mobile' | 'backend';
export type Exit = 0 | 1 | 2;
/** A data input the entry loaded, or why it could not. */
export type Loaded<T> = { value: T } | { error: string };

/** Structurally the entry of src/__contracts__/retire.ts (that file imports nothing). */
export interface RetireEntry { kind: 'file' | 'pin'; target: string; dec: string; reason: string }
export type DecStatus = (dec: string) => string | null;
/** checkRetireEntries of src/testing/guards/retireRule.ts: one failure line per entry that is not a valid signature. */
export type CheckRetireEntries = (entries: readonly RetireEntry[], decStatus: DecStatus) => string[];
/** The RETIRE signature rule and the decision records it reads. */
export interface Signatures { check: CheckRetireEntries; decStatus: DecStatus }
/** Structurally ContractRef of src/__contracts__/manifest.ts. */
export interface ContractRef { file: string; fullTitle: string }
export type Manifest = Readonly<Record<string, readonly ContractRef[]>>;
/** The part of TEST_FLOOR (src/__contracts__/testFloor.baseline.ts) RA-9 reads. */
export interface FloorList { sha: string; listTestsCount: number; paths: readonly string[] }

/** A --results file: its text, or why it could not be read. `file` is the path as given. */
export type ResultsFile = { file: string; text: string } | { file: string; error: string };
/** HEAD as git records it: its SHA, its parents in order, and its committer time in seconds. */
export interface HeadFacts { sha: string; parents: readonly string[]; commitTime: number }
/** The tree at TEST_FLOOR.sha: every blob under the app root (relative to it), or why it cannot be read. */
export type FloorTree =
  | { state: 'ok'; paths: readonly string[] }
  | { state: 'absent'; shallow: boolean }
  | { state: 'notAncestor'; shallow: boolean }
  | { state: 'error'; reason: string };

export interface Inputs {
  pkg: Pkg;
  /** --head: the commit the results must be bound to. */
  head: string;
  expectShards?: number;
  results: readonly ResultsFile[];
  /** A test file's absolute name -> its posix path relative to the package root, or null when it is not a file there. */
  locate: (name: string) => string | null;
  headFacts: Loaded<HeadFacts>;
  counts: Loaded<TestCounts>;
  // mobile only
  retire?: Loaded<readonly RetireEntry[]>;
  manifest?: Loaded<Manifest>;
  floor?: Loaded<FloorList>;
  floorTree?: FloorTree;
  signatures?: Loaded<Signatures>;
}

export interface Verdict { exit: Exit; lines: string[] }

export type TestStatus = 'passed' | 'failed' | 'pending' | 'todo';
export interface RanTest { fullName: string; status: TestStatus }
/** One run, merged over its results files. */
export interface Run {
  /** each test file (posix, relative to the package root) -> its tests, in jest's order */
  files: ReadonlyMap<string, readonly RanTest[]>;
  numTotalTests: number;
  numPendingTests: number;
  numTodoTests: number;
  resultsFiles: number;
}

export const SHA40 = /^[0-9a-f]{40}$/;
const STATUSES: readonly TestStatus[] = ['passed', 'failed', 'pending', 'todo'];
const STATUS_FIELD: Readonly<Record<TestStatus, string>> = {
  passed: 'numPassedTests', failed: 'numFailedTests', pending: 'numPendingTests', todo: 'numTodoTests',
};
const COUNT_FIELDS = ['numTotalTestSuites', 'numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests', 'numTodoTests', 'numRuntimeErrorTestSuites'];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const iso = (ms: number): string => new Date(ms).toISOString();
const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).split('\n')[0];

interface ReadFile { file: string; startTime: number; files: Array<[string, RanTest[]]>; pending: number; todo: number; total: number }

/** jest's shape, field by field: every problem, or [] when the value is a jest --json result. */
function shapeProblems(v: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const f of COUNT_FIELDS) if (!isCount(v[f])) out.push(`${f} is not a count`);
  if (!(typeof v.startTime === 'number' && Number.isInteger(v.startTime) && v.startTime > 0)) out.push('startTime is not a time in ms');
  if (typeof v.wasInterrupted !== 'boolean') out.push('wasInterrupted is not true or false');
  if (!Array.isArray(v.testResults)) { out.push('testResults is not a list'); return out; }
  v.testResults.forEach((r: unknown, i: number) => {
    if (!isRecord(r)) { out.push(`testResults[${i}] is not an object`); return; }
    if (typeof r.name !== 'string' || r.name === '') out.push(`testResults[${i}] has no name`);
    if (!Array.isArray(r.assertionResults)) { out.push(`testResults[${i}] has no assertionResults list`); return; }
    r.assertionResults.forEach((a: unknown, j: number) => {
      const where = `testResults[${i}].assertionResults[${j}]`;
      if (!isRecord(a)) { out.push(`${where} is not an object`); return; }
      if (typeof a.fullName !== 'string') out.push(`${where} has no fullName`);
      if (!STATUSES.includes(a.status as TestStatus)) out.push(`${where} has status ${JSON.stringify(a.status)}, not passed, failed, pending or todo`);
    });
  });
  return out;
}

function readOne(r: ResultsFile, locate: Inputs['locate']): { problems: string[]; read?: ReadFile } {
  if ('error' in r) return { problems: [`${r.file}: cannot be read (${r.error})`] };
  let v: unknown;
  try { v = JSON.parse(r.text); } catch (e) { return { problems: [`${r.file}: is not JSON (${errorText(e)})`] }; }
  if (!isRecord(v)) return { problems: [`${r.file}: is not a jest --json result (not an object)`] };
  const shape = shapeProblems(v);
  if (shape.length > 0) return { problems: shape.map((p) => `${r.file}: is not a jest --json result: ${p}`) };

  const n = (f: string) => v[f] as number;
  const results = v.testResults as Array<{ name: string; assertionResults: Array<{ fullName: string; status: TestStatus }> }>;
  const all = results.flatMap((t) => t.assertionResults);
  const problems: string[] = [];
  if (n('numRuntimeErrorTestSuites') > 0) {
    const k = n('numRuntimeErrorTestSuites');
    problems.push(`${r.file}: ${plural(k, 'test suite', 'test suites')} failed to run, so ${k === 1 ? 'its' : 'their'} tests were never counted (numRuntimeErrorTestSuites)`);
  }
  if (v.wasInterrupted === true) problems.push(`${r.file}: the run was interrupted (wasInterrupted)`);
  if (results.length === 0 || n('numTotalTests') === 0) problems.push(`${r.file}: an empty run (${plural(results.length, 'test file', 'test files')}, ${plural(n('numTotalTests'), 'test', 'tests')})`);
  if (n('numTotalTestSuites') !== results.length) problems.push(`${r.file}: numTotalTestSuites is ${n('numTotalTestSuites')} but it holds ${plural(results.length, 'test file result', 'test file results')}`);
  if (n('numTotalTests') !== all.length) problems.push(`${r.file}: numTotalTests is ${n('numTotalTests')} but it holds ${plural(all.length, 'test result', 'test results')}`);
  for (const s of STATUSES) {
    const k = all.filter((a) => a.status === s).length;
    if (n(STATUS_FIELD[s]) !== k) problems.push(`${r.file}: ${STATUS_FIELD[s]} is ${n(STATUS_FIELD[s])} but ${k} test result${k === 1 ? ' is' : 's are'} ${s}`);
  }
  const files: Array<[string, RanTest[]]> = [];
  for (const t of results) {
    const rel = locate(t.name);
    if (rel === null) problems.push(`${r.file}: ${t.name} is not a test file under the package root`);
    else files.push([rel, t.assertionResults.map((a) => ({ fullName: a.fullName, status: a.status }))]);
  }
  return {
    problems,
    read: { file: r.file, startTime: n('startTime'), files, total: all.length, pending: n('numPendingTests'), todo: n('numTodoTests') },
  };
}

/** Plan step 4: read the results files as one run, or say why the run cannot be trusted. */
export function readRun(results: readonly ResultsFile[], locate: Inputs['locate'], expectShards?: number): { run: Run | null; problems: string[]; startTimes: Array<{ file: string; startTime: number }> } {
  const problems: string[] = [];
  if (results.length === 0) problems.push('no --results file was given');
  if (expectShards !== undefined && expectShards !== results.length) {
    problems.push(`--expect-shards ${expectShards}, but ${plural(results.length, 'results file was', 'results files were')} given`);
  }
  const files = new Map<string, readonly RanTest[]>();
  const from = new Map<string, string>();
  const startTimes: Array<{ file: string; startTime: number }> = [];
  let total = 0; let pending = 0; let todo = 0;
  for (const r of results) {
    const one = readOne(r, locate);
    problems.push(...one.problems);
    if (!one.read) continue;
    startTimes.push({ file: one.read.file, startTime: one.read.startTime });
    total += one.read.total; pending += one.read.pending; todo += one.read.todo;
    for (const [rel, tests] of one.read.files) {
      const first = from.get(rel);
      if (first !== undefined) { problems.push(first === r.file ? `${rel} is twice in ${r.file}` : `${rel} is in ${first} and in ${r.file}`); continue; }
      from.set(rel, r.file);
      files.set(rel, tests);
    }
  }
  if (problems.length > 0) return { run: null, problems, startTimes };
  return { run: { files, numTotalTests: total, numPendingTests: pending, numTodoTests: todo, resultsFiles: results.length }, problems, startTimes };
}

/** Plan decision 4: the results belong to --head only when HEAD is it, or HEAD is a merge whose second parent is it, and they are not older than HEAD. */
export function bindHead(head: string, facts: Loaded<HeadFacts>, startTimes: ReadonlyArray<{ file: string; startTime: number }>): { problems: string[]; note: string } {
  if (!SHA40.test(head)) return { problems: [`--head ${JSON.stringify(head)} is not a full 40-hex commit SHA`], note: '' };
  if ('error' in facts) return { problems: [`cannot bind the results to a commit: ${facts.error}`], note: '' };
  const f = facts.value;
  const merge = f.parents.length >= 2;
  let note: string;
  if (head === f.sha) note = `head: ${head} is HEAD`;
  else if (merge && f.parents[1] === head) note = `head: ${head} is HEAD's second parent (HEAD ${f.sha} is the pull-request merge ref)`;
  else {
    return { problems: [`--head ${head} is neither HEAD (${f.sha}) nor HEAD's second parent (${merge ? f.parents[1] : 'HEAD is not a merge'}): the results are bound to no commit`], note: '' };
  }
  const committed = f.commitTime * 1000;
  const problems = startTimes.filter((s) => s.startTime < committed)
    .map((s) => `${s.file}: the run started at ${iso(s.startTime)}, before HEAD was committed (${iso(committed)}): stale results`);
  return { problems, note };
}

/** The verdict: the order of decision of the header. */
export function decide(inputs: Inputs): Verdict {
  const read = readRun(inputs.results, inputs.locate, inputs.expectShards);
  const bind = bindHead(inputs.head, inputs.headFacts, read.startTimes);
  const untrusted = [...read.problems, ...bind.problems];
  if (untrusted.length > 0 || read.run === null) return { exit: 2, lines: untrusted };
  return { exit: 0, lines: [bind.note] };
}
