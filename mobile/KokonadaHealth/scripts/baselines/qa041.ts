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

import { checkRetireEntries } from '../../src/testing/guards/retireRule.ts';
import type { DecStatus, RetireEntry } from '../../src/testing/guards/retireRule.ts';
import type { FileCounts, TestCounts } from './testCounts.ts';

export type { DecStatus, RetireEntry };
export type Pkg = 'mobile' | 'backend';
export type Exit = 0 | 1 | 2;
/** A data input the entry loaded, or why it could not. */
export type Loaded<T> = { value: T } | { error: string };

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
  /** The status of a decision record (DECIDED, OPEN, …), or null when there is none: what the RETIRE signature rule reads. */
  decStatus?: DecStatus;
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

// ---- the rules (plan decisions 3, 5 and 6) ----------------------------------------------------------

export type RuleId = 'floor' | 'RA-5' | 'RETIRE' | 'RA-7' | 'RA-9';
/** Each package's rules, in the order they report. The backend has no RETIRE path (OPS-473), no manifest (OPS-413) and no floor list. */
export const RULES: Readonly<Record<Pkg, readonly RuleId[]>> = {
  mobile: ['floor', 'RA-5', 'RETIRE', 'RA-7', 'RA-9'],
  backend: ['floor', 'RA-5'],
};

const COUNTS_FILE = 'scripts/baselines/test-counts.json';
const RETIRE_FILE = 'src/__contracts__/retire.ts';
const MANIFEST_FILE = 'src/__contracts__/manifest.ts';
const FLOOR_FILE = 'src/__contracts__/testFloor.baseline.ts';

interface Outcome { breaches: string[]; cannot: string[]; notes: string[] }
const outcome = (o: Partial<Outcome>): Outcome => ({ breaches: [], cannot: [], notes: [], ...o });
interface Measured { numTotalTests: number; numPendingTests: number; numTodoTests: number }
/** What the valid RETIRE `file` entries take off the floor and the bound, and the entries that break the rule. */
interface Retired { tests: number; pendingTodo: number; files: number; entries: number; breaches: string[] }
interface Context { pkg: Pkg; inputs: Inputs; run: Run; base: Loaded<{ counts: Measured; sha: string }>; retired: () => Loaded<Retired> }

function need<T>(x: Loaded<T> | undefined, label: string): Loaded<T> {
  if (x === undefined) return { error: `${label}: not loaded` };
  return 'error' in x ? { error: `${label}: ${x.error}` } : x;
}

function baseline(inputs: Inputs): Context['base'] {
  if ('error' in inputs.counts) return { error: `${COUNTS_FILE}: ${inputs.counts.error}` };
  const p = inputs.counts.value[inputs.pkg];
  if ('notMeasured' in p) return { error: `test-counts.json records ${inputs.pkg} as not measured: ${p.notMeasured}` };
  return { value: { counts: p, sha: inputs.counts.value.sha } };
}

/** The mobile per-file record, or why it cannot be read: a mobile run that was not measured has none (testCounts.ts keeps it empty). */
function mobileRecord(counts: TestCounts): Loaded<Readonly<Record<string, FileCounts>>> {
  if ('notMeasured' in counts.mobile) return { error: `test-counts.json records mobile as not measured: ${counts.mobile.notMeasured}` };
  const record = counts.files?.mobile;
  return record === undefined ? { error: 'test-counts.json has no per-file record (files.mobile)' } : { value: record };
}

/** The RETIRE discount: a `file` entry takes its row off when it is signed, in the record and did not run; a `pin` entry takes nothing. */
function retiredOf(inputs: Inputs, run: Run): Loaded<Retired> {
  if (inputs.pkg === 'backend') return { value: { tests: 0, pendingTodo: 0, files: 0, entries: 0, breaches: [] } };
  if ('error' in inputs.counts) return { error: `${COUNTS_FILE}: ${inputs.counts.error}` };
  const retire = need(inputs.retire, RETIRE_FILE);
  if ('error' in retire) return retire;
  const decStatus = inputs.decStatus;
  if (decStatus === undefined) return { error: 'the decision records (docs/design-v2/decisions) were not read' };
  const rec = mobileRecord(inputs.counts.value);
  if ('error' in rec) return rec;
  const record = rec.value;
  const out: Retired = { tests: 0, pendingTodo: 0, files: 0, entries: retire.value.length, breaches: checkRetireEntries(retire.value, decStatus) };
  const seen = new Set<string>();
  for (const e of retire.value) {
    if (e.kind !== 'file' || seen.has(e.target)) continue; // a second entry is "named twice" above
    seen.add(e.target);
    if (!Object.hasOwn(record, e.target)) { out.breaches.push(`RETIRE file ${e.target}: not in the per-file record of test-counts.json (only a file of the baseline run is retired)`); continue; }
    if (run.files.has(e.target)) { out.breaches.push(`RETIRE file ${e.target}: it still ran in this run`); continue; }
    if (checkRetireEntries([e], decStatus).length > 0) continue; // unsigned: a breach above, and it lowers nothing
    const [tests, pendingCount, todoCount] = record[e.target];
    out.tests += tests;
    out.pendingTodo += pendingCount + todoCount;
    out.files += 1;
  }
  return { value: out };
}

const less = (n: number, files: number): string => (files === 0 ? '' : `, less ${n} in ${plural(files, 'retired file', 'retired files')}`);

/** QA-041: the run has at least the baseline's tests, less the rows of the retired files. */
function floorRule(ctx: Context): Outcome {
  const b = ctx.base;
  if ('error' in b) return outcome({ cannot: [b.error] });
  const r = ctx.retired();
  if ('error' in r) return outcome({ cannot: [r.error] });
  const total = ctx.run.numTotalTests;
  const floor = b.value.counts.numTotalTests - r.value.tests;
  const why = `(the baseline's ${b.value.counts.numTotalTests} at ${b.value.sha.slice(0, 12)}${less(r.value.tests, r.value.files)})`;
  return total < floor
    ? outcome({ breaches: [`floor: ${ctx.pkg} ran ${total} tests: ${total} < floor ${floor} ${why}`] })
    : outcome({ notes: [`floor: ${ctx.pkg} ran ${total} tests: ${total} >= floor ${floor} ${why}`] });
}

/** RA-5: skipped and todo tests stay within the baseline's, less those of the retired files (numTotalTests counts them). */
function pendingRule(ctx: Context): Outcome {
  const b = ctx.base;
  if ('error' in b) return outcome({ cannot: [b.error] });
  const r = ctx.retired();
  if ('error' in r) return outcome({ cannot: [r.error] });
  const { numPendingTests: p, numTodoTests: t } = ctx.run;
  const was = b.value.counts.numPendingTests + b.value.counts.numTodoTests;
  const bound = was - r.value.pendingTodo;
  const head = `RA-5: ${ctx.pkg} has ${plural(p + t, 'pending and todo test', 'pending and todo tests')} (${p} pending, ${t} todo)`;
  const why = `(the baseline's ${was} at ${b.value.sha.slice(0, 12)}${less(r.value.pendingTodo, r.value.files)})`;
  return p + t > bound
    ? outcome({ breaches: [`${head}: ${p + t} > bound ${bound} ${why}`] })
    : outcome({ notes: [`${head}: ${p + t} <= bound ${bound} ${why}`] });
}

/** The RETIRE rule: every entry signed by a DECIDED DEC that is not the rule itself; a file entry names a baseline file that did not run. */
function retireRule(ctx: Context): Outcome {
  const r = ctx.retired();
  if ('error' in r) return outcome({ cannot: [r.error] });
  if (r.value.breaches.length > 0) return outcome({ breaches: r.value.breaches });
  return outcome({ notes: [`RETIRE: ${plural(r.value.entries, 'entry', 'entries')}, every one signed; ${plural(r.value.files, 'test file', 'test files')} retired`] });
}

/** RA-7: every test the manifest names ran in its file and passed, every copy of its name. */
function manifestRule(ctx: Context): Outcome {
  const m = need(ctx.inputs.manifest, MANIFEST_FILE);
  if ('error' in m) return outcome({ cannot: [m.error] });
  const ids = Object.keys(m.value);
  if (ids.length === 0) return outcome({ breaches: ['RA-7: the manifest names no contract'] });
  const breaches: string[] = [];
  let refs = 0;
  for (const id of ids) {
    const list = m.value[id];
    if (list.length === 0) { breaches.push(`RA-7 ${id}: no test reference`); continue; }
    for (const { file, fullTitle } of list) {
      refs += 1;
      const title = JSON.stringify(fullTitle);
      const tests = ctx.run.files.get(file);
      if (tests === undefined) { breaches.push(`RA-7 ${id}: ${file} did not run, so ${title} did not pass`); continue; }
      const named = tests.filter((t) => t.fullName === fullTitle);
      if (named.length === 0) breaches.push(`RA-7 ${id}: ${file} ran no test named ${title}`);
      else if (named.some((t) => t.status !== 'passed')) breaches.push(`RA-7 ${id}: ${title} in ${file} did not pass (${named.map((t) => t.status).join(', ')})`);
    }
  }
  return breaches.length > 0
    ? outcome({ breaches })
    : outcome({ notes: [`RA-7: ${plural(refs, 'test', 'tests')} of ${plural(ids.length, 'contract', 'contracts')} in the manifest passed`] });
}

const TEST_EXT = /\.[mc]?[jt]sx?$/;
const TEST_NAME = /\.(test|spec)\.[mc]?[jt]sx?$/;

/** The disk-walk rule of scripts/jest/__tests__/jestProjects.test.ts, on a posix path relative to the app root. */
export function isTestPath(rel: string): boolean {
  const parts = rel.split('/');
  if (parts.some((p) => p === 'node_modules' || p === '.git')) return false;
  const name = parts[parts.length - 1];
  return TEST_EXT.test(name) && (parts.slice(0, -1).includes('__tests__') || TEST_NAME.test(name));
}

/** RA-9: TEST_FLOOR.paths is the tree at TEST_FLOOR.sha (an ancestor of HEAD), and the per-file record names the same files. */
function floorListRule(ctx: Context): Outcome {
  const f = need(ctx.inputs.floor, FLOOR_FILE);
  if ('error' in f) return outcome({ cannot: [f.error] });
  const floor = f.value;
  const at = floor.sha.slice(0, 12);
  const o = outcome({});
  const counts = ctx.inputs.counts;
  if ('error' in counts) o.cannot.push(`${COUNTS_FILE}: ${counts.error}`);
  else {
    if (counts.value.sha !== floor.sha) o.breaches.push(`RA-9: test-counts.json was measured at ${counts.value.sha.slice(0, 12)}, TEST_FLOOR at ${at}`);
    const rec = mobileRecord(counts.value);
    if ('error' in rec) o.cannot.push(rec.error);
    else {
      const record = rec.value;
      const listed = new Set(floor.paths);
      for (const k of Object.keys(record)) if (!listed.has(k)) o.breaches.push(`RA-9: the per-file record of test-counts.json names ${k}, which TEST_FLOOR.paths does not`);
      for (const p of floor.paths) if (!Object.hasOwn(record, p)) o.breaches.push(`RA-9: TEST_FLOOR.paths names ${p}, which the per-file record of test-counts.json does not`);
    }
  }
  const tree = ctx.inputs.floorTree;
  if (tree === undefined) o.cannot.push('RA-9: the tree at TEST_FLOOR.sha was not read');
  else if (tree.state === 'error') o.cannot.push(`RA-9: ${tree.reason}`);
  else if (tree.state === 'absent') o.cannot.push(`RA-9: TEST_FLOOR.sha ${at} is not in this clone${tree.shallow ? ', a shallow one (check out with fetch-depth: 0)' : ''}`);
  else if (tree.state === 'notAncestor') {
    if (tree.shallow) o.cannot.push(`RA-9: the clone is shallow, so whether TEST_FLOOR.sha ${at} is an ancestor of HEAD cannot be told (check out with fetch-depth: 0)`);
    else o.breaches.push(`RA-9: TEST_FLOOR.sha ${floor.sha} is not an ancestor of HEAD`);
  } else {
    const derived = [...new Set(tree.paths.filter(isTestPath))].sort();
    const inTree = new Set(derived);
    const listed = new Set(floor.paths);
    if (floor.listTestsCount !== derived.length) o.breaches.push(`RA-9: TEST_FLOOR.listTestsCount is ${floor.listTestsCount}, but the tree at ${at} has ${derived.length} test files`);
    for (const p of derived) if (!listed.has(p)) o.breaches.push(`RA-9: ${p} is a test file in the tree at ${at}, but TEST_FLOOR.paths leaves it out`);
    for (const p of floor.paths) if (!inTree.has(p)) o.breaches.push(`RA-9: TEST_FLOOR.paths names ${p}, which is no test file in the tree at ${at}`);
    if (!floor.paths.every((p, i) => i === 0 || floor.paths[i - 1] < p)) o.breaches.push('RA-9: TEST_FLOOR.paths is not sorted and unique');
    if (o.breaches.length === 0) o.notes.push(`RA-9: TEST_FLOOR.paths is the ${derived.length} test files of the tree at ${at}, and the per-file record names the same files`);
  }
  return o;
}

const RULE_FNS: Readonly<Record<RuleId, (ctx: Context) => Outcome>> = {
  floor: floorRule, 'RA-5': pendingRule, RETIRE: retireRule, 'RA-7': manifestRule, 'RA-9': floorListRule,
};

/**
 * The verdict, in the order of decision of the header. `active` switches rules off in memory (a planted
 * case run with its rule off shows which rule catches it); the CLI always runs every rule of the package.
 */
export function decide(inputs: Inputs, active: ReadonlySet<RuleId> = new Set(RULES[inputs.pkg])): Verdict {
  const read = readRun(inputs.results, inputs.locate, inputs.expectShards);
  const bind = bindHead(inputs.head, inputs.headFacts, read.startTimes);
  const untrusted = [...read.problems, ...bind.problems];
  if (untrusted.length > 0 || read.run === null) return { exit: 2, lines: untrusted };
  const run = read.run;
  let retired: Loaded<Retired> | undefined;
  const ctx: Context = {
    pkg: inputs.pkg, inputs, run, base: baseline(inputs),
    retired: () => { if (retired === undefined) retired = retiredOf(inputs, run); return retired; },
  };
  const all = outcome({ notes: [
    bind.note,
    `run: ${run.numTotalTests} tests in ${plural(run.files.size, 'test file', 'test files')} from ${plural(run.resultsFiles, 'results file', 'results files')} (${run.numPendingTests} pending, ${run.numTodoTests} todo)`,
  ] });
  for (const id of RULES[inputs.pkg]) {
    if (!active.has(id)) continue;
    const o = RULE_FNS[id](ctx);
    all.breaches.push(...o.breaches);
    all.cannot.push(...o.cannot);
    all.notes.push(...o.notes);
  }
  if (inputs.pkg === 'backend') all.notes.push('RA-7: the backend has no contract manifest (OPS-413), so no contract test was checked');
  const unchecked = [...new Set(all.cannot)];
  if (all.breaches.length > 0) return { exit: 1, lines: [...all.breaches, ...unchecked.map((c) => `not checked: ${c}`)] };
  if (unchecked.length > 0) return { exit: 2, lines: unchecked };
  return { exit: 0, lines: all.notes };
}

// ---- the command line and the data modules ----------------------------------------------------------

export type Args =
  | { mode: 'check'; pkg: Pkg; results: string[]; head: string; expectShards?: number }
  | { mode: 'inputs' };

export const USAGE = 'usage: node scripts/baselines/qa041.mjs --package mobile|backend --results <file> [--results <file>...] '
  + '[--expect-shards <n>] --head <40-hex SHA>, or --check-inputs alone';

const FLAGS = ['--package', '--results', '--head', '--expect-shards'];

/** The arguments of plan "CLI usage", or the first thing wrong with them. The head comes in only as --head. */
export function parseArgs(argv: readonly string[]): { args: Args } | { usage: string } {
  if (argv.includes('--check-inputs')) return argv.length === 1 ? { args: { mode: 'inputs' } } : { usage: '--check-inputs takes no other argument' };
  let pkg: string | undefined;
  let head: string | undefined;
  let shards: string | undefined;
  const results: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (!FLAGS.includes(flag)) return { usage: `unknown argument ${JSON.stringify(flag)}` };
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) return { usage: `${flag} needs a value` };
    i += 1;
    if (flag === '--results') { results.push(value); continue; }
    if ((flag === '--package' ? pkg : flag === '--head' ? head : shards) !== undefined) return { usage: `${flag} is given twice` };
    if (flag === '--package') pkg = value;
    else if (flag === '--head') head = value;
    else shards = value;
  }
  if (pkg === undefined) return { usage: 'no --package' };
  if (pkg !== 'mobile' && pkg !== 'backend') return { usage: `--package must be mobile or backend, got ${JSON.stringify(pkg)}` };
  if (results.length === 0) return { usage: 'no --results file' };
  if (head === undefined) return { usage: 'no --head' };
  if (!SHA40.test(head)) return { usage: `--head must be a full 40-hex commit SHA, got ${JSON.stringify(head)}` };
  if (shards !== undefined && !/^[1-9]\d*$/.test(shards)) return { usage: `--expect-shards must be a whole number of 1 or more, got ${JSON.stringify(shards)}` };
  return { args: { mode: 'check', pkg, results, head, ...(shards === undefined ? {} : { expectShards: Number(shards) }) } };
}

/** RETIRE (src/__contracts__/retire.ts) by shape; the signature rule judges each entry later. */
export function asRetire(v: unknown): RetireEntry[] {
  if (!Array.isArray(v)) throw new Error('RETIRE is not a list');
  return v.map((e: unknown, i: number) => {
    const where = `RETIRE[${i}]`;
    if (!isRecord(e)) throw new Error(`${where}: not an object`);
    if (e.kind !== 'file' && e.kind !== 'pin') throw new Error(`${where}: kind must be file or pin, got ${JSON.stringify(e.kind)}`);
    if (typeof e.target !== 'string' || e.target === '') throw new Error(`${where}: target must be text that is not empty`);
    if (typeof e.dec !== 'string') throw new Error(`${where}: dec must be text`);
    if (typeof e.reason !== 'string') throw new Error(`${where}: reason must be text`);
    return { kind: e.kind, target: e.target, dec: e.dec, reason: e.reason };
  });
}

/** CONTRACTS (src/__contracts__/manifest.ts) by shape. */
export function asManifest(v: unknown): Manifest {
  if (!isRecord(v)) throw new Error('CONTRACTS is not an object');
  for (const [id, refs] of Object.entries(v)) {
    if (!Array.isArray(refs)) throw new Error(`CONTRACTS ${id} is not a list`);
    refs.forEach((r: unknown, i: number) => {
      if (!isRecord(r) || typeof r.file !== 'string' || typeof r.fullTitle !== 'string') throw new Error(`CONTRACTS ${id}[${i}] needs a file and a fullTitle`);
    });
  }
  return v as Manifest;
}

/** The part of TEST_FLOOR (src/__contracts__/testFloor.baseline.ts) RA-9 reads, by shape: its SHA reaches git only through here. */
export function asFloorList(v: unknown): FloorList {
  if (!isRecord(v)) throw new Error('TEST_FLOOR is not an object');
  if (typeof v.sha !== 'string' || !SHA40.test(v.sha)) throw new Error(`TEST_FLOOR.sha must be 40 lower-case hex characters, got ${JSON.stringify(v.sha)}`);
  if (!isCount(v.listTestsCount)) throw new Error('TEST_FLOOR.listTestsCount must be a whole number of 0 or more');
  if (!Array.isArray(v.paths) || v.paths.some((p: unknown) => typeof p !== 'string')) throw new Error('TEST_FLOOR.paths must be a list of paths');
  return { sha: v.sha, listTestsCount: v.listTestsCount, paths: v.paths as string[] };
}

/** The data the CLI loads through Node, each part or why it did not load. */
export interface Data {
  counts: Loaded<TestCounts>;
  retire: Loaded<readonly RetireEntry[]>;
  manifest: Loaded<Manifest>;
  floor: Loaded<FloorList>;
}

function describePackage(pkg: Pkg, c: TestCounts): string {
  const p = c[pkg];
  if ('notMeasured' in p) return `${pkg} not measured (${p.notMeasured})`;
  const files = pkg === 'mobile' ? ` in ${Object.keys(c.files?.mobile ?? {}).length} files` : '';
  return `${pkg} ${p.numTotalTests} tests${files} (${p.numPendingTests} pending, ${p.numTodoTests} todo)`;
}

/** --check-inputs: 0 when every data part loaded through Node (each named), 2 naming each part that did not. */
export function checkInputs(d: Data): Verdict {
  const errors: string[] = [];
  const lines: string[] = [];
  if ('error' in d.counts) errors.push(`${COUNTS_FILE}: ${d.counts.error}`);
  else lines.push(`${COUNTS_FILE}: measured at ${d.counts.value.sha.slice(0, 12)}; ${describePackage('mobile', d.counts.value)}; ${describePackage('backend', d.counts.value)}`);
  if ('error' in d.retire) errors.push(`${RETIRE_FILE}: ${d.retire.error}`);
  else lines.push(`${RETIRE_FILE}: ${plural(d.retire.value.length, 'RETIRE entry', 'RETIRE entries')}`);
  if ('error' in d.manifest) errors.push(`${MANIFEST_FILE}: ${d.manifest.error}`);
  else {
    const refs = Object.values(d.manifest.value).reduce((n, r) => n + r.length, 0);
    lines.push(`${MANIFEST_FILE}: ${plural(Object.keys(d.manifest.value).length, 'contract', 'contracts')}, ${plural(refs, 'test reference', 'test references')}`);
  }
  if ('error' in d.floor) errors.push(`${FLOOR_FILE}: ${d.floor.error}`);
  else lines.push(`${FLOOR_FILE}: ${plural(d.floor.value.paths.length, 'path', 'paths')} at ${d.floor.value.sha.slice(0, 12)}`);
  return errors.length > 0 ? { exit: 2, lines: errors } : { exit: 0, lines };
}

// ---- what the CLI prints ----------------------------------------------------------------------------

const HEADERS: Readonly<Record<Exit, string>> = { 0: 'VERIFIED (exit 0)', 1: 'BREACH (exit 1)', 2: 'CANNOT VERIFY (exit 2, never a pass)' };

/** A finding on one line: a control character or a line separator is written as \uXXXX, so no title starts a line (or a runner command). */
function oneLine(s: string): string {
  return Array.from(s, (c) => {
    const code = c.charCodeAt(0);
    return code < 0x20 || code === 0x7f || code === 0x2028 || code === 0x2029 ? `\\u${code.toString(16).padStart(4, '0')}` : c;
  }).join('');
}

/** The report: a header with the verdict (for a package, `inputs`, or nothing yet), then one indented line per finding. */
export function formatVerdict(label: Pkg | 'inputs' | null, v: Verdict): string {
  return `${[`QA-041${label === null ? '' : ` ${label}`}: ${HEADERS[v.exit]}`, ...v.lines.map((l) => `  - ${oneLine(l)}`)].join('\n')}\n`;
}
