/// <reference types="node" />
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import ts from 'typescript';
import { APP_ROOT } from '../../../src/testing/guards/productionImports';
import { moduleSpecifiers, parseSource } from '../../../src/testing/guards/sourceFiles';

// QA-041 proper (OPS-412 part A), plan step 8: the real process. qa041.mjs runs under plain Node 24, outside
// jest and babel, so two things are checked here. First, statically, every module it loads (followed from
// its own source, import() included) imports only node: builtins and explicit .ts paths and keeps to the
// syntax Node can strip: a child process cannot catch a stray `typescript` import, because Node resolves it
// from node_modules. Second, the process itself, spawned with process.execPath on a planted app in
// os.tmpdir() (a git repository holding the real modules and planted data): its exit code and its stdout.
// stderr is never asserted empty: Node prints MODULE_TYPELESS_PACKAGE_JSON there for the app's .ts files.

const ENTRY = path.join(APP_ROOT, 'scripts', 'baselines', 'qa041.mjs');
const rel = (root: string, file: string) => path.relative(root, file).split(path.sep).join('/');

// ---- the modules qa041.mjs loads ---------------------------------------------------------------------

const BUILTIN = /^node:[a-z_/]+$/;
const FUNCTION_LIKE = new Set([ts.SyntaxKind.FunctionDeclaration, ts.SyntaxKind.FunctionExpression, ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration, ts.SyntaxKind.Constructor, ts.SyntaxKind.GetAccessor, ts.SyntaxKind.SetAccessor]);
const PARAMETER_PROPERTY = new Set([ts.SyntaxKind.PublicKeyword, ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.ProtectedKeyword, ts.SyntaxKind.ReadonlyKeyword]);

function topLevel(n: ts.Node): boolean {
  for (let p = n.parent; p; p = p.parent) if (FUNCTION_LIKE.has(p.kind)) return false;
  return true;
}

/** What Node 24's type stripping, or an ES module, cannot run. */
function syntaxProblems(source: string, file: string): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && !(n.arguments.length === 1 && ts.isStringLiteralLike(n.arguments[0]))) out.push('an import() of a computed specifier (it hides the module from this check)');
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'require') out.push('a require() (an ES module has none)');
    if (ts.isIdentifier(n) && (n.text === '__dirname' || n.text === '__filename') && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n) && topLevel(n)) out.push(`a top-level ${n.text} (an ES module has none)`);
    if (ts.isEnumDeclaration(n)) out.push('an enum (Node cannot strip it)');
    if (ts.isModuleDeclaration(n) && !(n.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)) out.push('a namespace (Node cannot strip it)');
    if (ts.isParameter(n) && ts.isConstructorDeclaration(n.parent) && (n.modifiers ?? []).some((m) => PARAMETER_PROPERTY.has(m.kind))) out.push('a parameter property (Node cannot strip it)');
    if (ts.isImportEqualsDeclaration(n)) out.push('an import = (Node cannot strip it)');
    if (ts.isExportAssignment(n) && n.isExportEquals) out.push('an export = (Node cannot strip it)');
    if (ts.isImportDeclaration(n) && n.importClause && !n.importClause.isTypeOnly && n.importClause.namedBindings
      && ts.isNamedImports(n.importClause.namedBindings) && n.importClause.namedBindings.elements.some((e) => e.isTypeOnly)) {
      out.push('a type named inside a value import (write it as `import type`)');
    }
    ts.forEachChild(n, visit);
  };
  visit(parseSource(source, file));
  return out;
}

interface Closure { files: string[]; builtins: string[]; problems: string[] }

/** Every module `entry` loads, followed from the sources: import and export declarations and import() alike. */
function closure(entry: string, read: (file: string) => string | null, root: string): Closure {
  const files = new Set<string>();
  const builtins = new Set<string>();
  const problems: string[] = [];
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (files.has(file)) continue;
    files.add(file);
    const source = read(file);
    if (source === null) { problems.push(`${rel(root, file)}: cannot be read`); continue; }
    problems.push(...syntaxProblems(source, file).map((p) => `${rel(root, file)}: ${p}`));
    for (const spec of moduleSpecifiers(source, file)) {
      if (BUILTIN.test(spec)) builtins.add(spec);
      else if (/^\.\.?\//.test(spec) && spec.endsWith('.ts')) queue.push(path.resolve(path.dirname(file), spec));
      else problems.push(`${rel(root, file)}: imports ${JSON.stringify(spec)}, neither a node: builtin nor an explicit .ts path`);
    }
  }
  return { files: [...files].map((f) => rel(root, f)).sort(), builtins: [...builtins].sort(), problems };
}

const readReal = (file: string): string | null => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
const CODE_MODULES = ['scripts/baselines/qa041.mjs', 'scripts/baselines/qa041.ts', 'scripts/baselines/qa041Sources.ts', 'scripts/baselines/testCounts.ts', 'src/testing/guards/retireRule.ts'];
const DATA_MODULES = ['src/__contracts__/manifest.ts', 'src/__contracts__/retire.ts', 'src/__contracts__/testFloor.baseline.ts'];

describe('QA-041 · the modules qa041.mjs loads (Node strips their types, outside jest)', () => {
  const real = closure(ENTRY, readReal, APP_ROOT);

  it('are exactly the CLI, its core and adapters, the baseline reader, the signature rule and the three data modules', () => {
    expect(real.files).toEqual([...CODE_MODULES, ...DATA_MODULES].sort());
  });

  it('import only node: builtins and explicit .ts paths, by literal specifiers, in syntax Node can strip', () => {
    expect(real.problems).toEqual([]);
    expect(real.builtins).toEqual(['node:child_process', 'node:fs', 'node:path', 'node:url']);
  });

  const PLANTED_ROOT = path.join(os.tmpdir(), 'qa041-planted-closure');
  const at = (r: string) => path.join(PLANTED_ROOT, ...r.split('/'));
  const plantedEntry = (body: string, more: Record<string, string> = {}) => {
    const sources: Record<string, string> = { 'cli.mjs': body, 'ok.ts': 'export const ok = 1;\n', ...more };
    return closure(at('cli.mjs'), (f) => sources[rel(PLANTED_ROOT, f)] ?? null, PLANTED_ROOT).problems;
  };
  it.each([
    ['an import of typescript', "import ts from 'typescript';\n", 'cli.mjs: imports "typescript", neither a node: builtin nor an explicit .ts path'],
    ['a builtin by its bare name', "import fs from 'fs';\n", 'cli.mjs: imports "fs", neither a node: builtin nor an explicit .ts path'],
    ['an extensionless relative import', "import { ok } from './ok';\n", 'cli.mjs: imports "./ok", neither a node: builtin nor an explicit .ts path'],
    ['an export-from typescript', "export { version } from 'typescript';\n", 'cli.mjs: imports "typescript", neither a node: builtin nor an explicit .ts path'],
    ['a computed import()', "const name = 'ok';\nawait import('./' + name + '.ts');\n", 'cli.mjs: an import() of a computed specifier (it hides the module from this check)'],
    ['a require()', "const fs = require('node:fs');\n", 'cli.mjs: a require() (an ES module has none)'],
    ['a top-level __dirname', 'const here = __dirname;\n', 'cli.mjs: a top-level __dirname (an ES module has none)'],
    ['a module reached by import() that imports typescript', "await import('./ok.ts');\n", 'ok.ts: imports "typescript", neither a node: builtin nor an explicit .ts path', { 'ok.ts': "import ts from 'typescript';\nexport const ok = ts;\n" }],
    ['an enum two imports deep', "import { ok } from './ok.ts';\n", 'deep.ts: an enum (Node cannot strip it)', { 'ok.ts': "export { deep as ok } from './deep.ts';\n", 'deep.ts': 'export enum deep { A }\n' }],
    ['a namespace', "import { ok } from './ok.ts';\n", 'ok.ts: a namespace (Node cannot strip it)', { 'ok.ts': 'export namespace ok { export const a = 1; }\n' }],
    ['a parameter property', "import { ok } from './ok.ts';\n", 'ok.ts: a parameter property (Node cannot strip it)', { 'ok.ts': 'export class ok { constructor(private a: number) {} }\n' }],
    ['a type named inside a value import', "import { ok } from './ok.ts';\n", 'ok.ts: a type named inside a value import (write it as `import type`)', { 'ok.ts': "import { type T, v } from './t.ts';\nexport const ok: T = v;\n", 't.ts': 'export type T = number;\nexport const v = 1;\n' }],
    ['a module that is not there', "import { ok } from './gone.ts';\n", 'gone.ts: cannot be read'],
  ] as Array<[string, string, string, Record<string, string>?]>)('planted: %s is refused', (_name, body, problem, more = {}) => {
    // `more` has a default, so jest does not count it and never mistakes it for a done callback on a 3-item row.
    expect(plantedEntry(body, more)).toEqual([problem]);
  });

  it('a __dirname inside a function, an `import type` and a declared namespace are allowed (they strip or never run at load)', () => {
    expect(plantedEntry("import { ok } from './ok.ts';\n", {
      'ok.ts': "import type { T } from './t.ts';\nexport function ok(): T { return __dirname.length; }\ndeclare namespace N { const a: number; }\n",
      't.ts': 'export type T = number;\n',
    })).toEqual([]);
  });
});

// ---- the real process ----------------------------------------------------------------------------------

/** Plain Node: no flag or loader inherited from the parent, so a pass means the default type stripping. */
function plainEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  return env;
}
function node(args: string[], cwd: string, env: NodeJS.ProcessEnv = plainEnv()): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 90_000, env, windowsHide: true });
}
const outcome = (r: SpawnSyncReturns<string>) => ({ status: r.status, stdout: r.stdout });

describe('QA-041 · --check-inputs on the real tree', () => {
  it('every data module loads through plain Node: exit 0, each part named', () => {
    const r = node([ENTRY, '--check-inputs'], APP_ROOT);
    expect(outcome(r)).toEqual({ status: 0, stdout: expect.stringMatching(/^QA-041 inputs: VERIFIED \(exit 0\)\n/) });
    expect(r.stdout).toMatch(/^ {2}- scripts\/baselines\/test-counts\.json: measured at [0-9a-f]{12}; mobile \d+ tests in \d+ files \(\d+ pending, \d+ todo\); backend \d+ tests/m);
    expect(r.stdout).toMatch(/^ {2}- src\/__contracts__\/retire\.ts: \d+ RETIRE entr(y|ies)$/m);
    expect(r.stdout).toMatch(/^ {2}- src\/__contracts__\/manifest\.ts: \d+ contracts, \d+ test references$/m);
    expect(r.stdout).toMatch(/^ {2}- src\/__contracts__\/testFloor\.baseline\.ts: \d+ paths at [0-9a-f]{12}$/m);
  }, 90_000);
});

// The planted app: a repository whose mobile/KokonadaHealth holds the real code modules (copied) and planted
// data, with a backend beside it and the decision records the RETIRE rule reads.
const T_FLOOR = 1_790_000_000;
const T_HEAD = T_FLOOR + 3_600;
let tmp = '';
let repo = '';
let app = '';
let backend = '';
const sha = { floor: '', head: '', side: '' };
const A = 'src/a/__tests__/A.test.ts';
const B = 'src/b/__tests__/B.test.ts';
const C = 'src/c/C.test.ts';
const D = 'src/d/D.test.ts';

function build(cwd: string, args: string[], at?: number): string {
  const date = at === undefined ? {} : { GIT_AUTHOR_DATE: new Date(at * 1000).toISOString(), GIT_COMMITTER_DATE: new Date(at * 1000).toISOString() };
  const r = spawnSync('git', ['-c', `core.hooksPath=${path.join(tmp, 'no-hooks')}`, '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', '-c', 'init.defaultBranch=main', ...args], {
    cwd, encoding: 'utf8', timeout: 60_000, windowsHide: true,
    env: { ...process.env, ...date, GIT_CONFIG_GLOBAL: path.join(tmp, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'planted', GIT_AUTHOR_EMAIL: 'planted@example.invalid', GIT_COMMITTER_NAME: 'planted', GIT_COMMITTER_EMAIL: 'planted@example.invalid' },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed (${r.status}): ${r.stderr}${r.error ? r.error.message : ''}`);
  return r.stdout.trim();
}
function put(root: string, file: string, text: string): void {
  const abs = path.join(root, ...file.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}
const tsData = (name: string, value: unknown) => `// planted data (imports nothing)\nexport const ${name} = ${JSON.stringify(value, null, 2)};\n`;

interface Planted { floorSha?: string; countsSha?: string; retire?: unknown[]; manifest?: Record<string, unknown> }
/** The planted data modules and baseline; every test starts from the defaults. */
function plantData(p: Planted = {}): void {
  const floorSha = p.floorSha ?? sha.floor;
  put(app, 'src/__contracts__/testFloor.baseline.ts', tsData('TEST_FLOOR', { sha: floorSha, listTestsCount: 3, skipCount: 0, measuredAt: '2026-11-17T18:28:22Z', command: 'planted', paths: [A, B, C] }));
  put(app, 'src/__contracts__/retire.ts', tsData('RETIRE', p.retire ?? []));
  put(app, 'src/__contracts__/manifest.ts', tsData('CONTRACTS', p.manifest ?? { 'CON-1': [{ file: A, fullTitle: 'A t1' }] }));
  put(app, 'scripts/baselines/test-counts.json', `${JSON.stringify({
    sha: p.countsSha ?? floorSha, measuredAt: '2026-11-17T15:12:06Z', node: 'v24.19.0', jest: '29.7.0',
    command: { mobile: './node_modules/.bin/jest --ci --json', backend: './node_modules/.bin/jest --ci --json --runInBand --forceExit' },
    mobile: { numTotalTestSuites: 3, numTotalTests: 12, numPendingTests: 1, numTodoTests: 0 },
    backend: { numTotalTestSuites: 1, numTotalTests: 3, numPendingTests: 0, numTodoTests: 0 },
    files: { mobile: { [A]: [5, 0, 0], [B]: [4, 1, 0], [C]: [3, 0, 0] } },
  }, null, 2)}\n`);
}

type Status = 'passed' | 'failed' | 'pending' | 'todo';
type Spec = Record<string, Array<[string, Status]>>;
const tests = (prefix: string, n: number, status: (i: number) => Status = () => 'passed'): Array<[string, Status]> =>
  Array.from({ length: n }, (_v, i) => [`${prefix} t${i}`, status(i)]);
/** At HEAD: A 5, B 4 (one pending), C 3 as in the baseline, and D (2) added since: 14 tests. */
const RUN = (): Spec => ({ [A]: tests('A', 5), [B]: tests('B', 4, (i) => (i === 0 ? 'pending' : 'passed')), [C]: tests('C', 3), [D]: tests('D', 2) });
/** One test of A deleted and D not run: 11 tests, under the floor of 12. */
const DELETED = (): Spec => {
  const run = Object.fromEntries(Object.entries(RUN()).filter(([file]) => file !== D));
  return { ...run, [A]: tests('A', 5).slice(1) };
};

/** jest's --json output for a spec, written to a results file; its names are the planted files' absolute paths. */
function writeRun(name: string, spec: Spec, root = app, startTime = Date.now()): string {
  const testResults = Object.entries(spec).map(([file, list]) => ({
    name: path.join(root, ...file.split('/')),
    assertionResults: list.map(([fullName, status]) => ({ ancestorTitles: [], fullName, status, title: fullName })),
    status: 'passed', message: '', startTime, endTime: startTime + 5,
  }));
  const all = testResults.flatMap((t) => t.assertionResults);
  const n = (s: Status) => all.filter((a) => a.status === s).length;
  const file = path.join(tmp, 'results', `${name}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    numFailedTestSuites: 0, numFailedTests: n('failed'), numPassedTestSuites: testResults.length, numPassedTests: n('passed'),
    numPendingTestSuites: 0, numPendingTests: n('pending'), numRuntimeErrorTestSuites: 0, numTodoTests: n('todo'),
    numTotalTestSuites: testResults.length, numTotalTests: all.length, openHandles: [], snapshot: {}, startTime,
    success: n('failed') === 0, testResults, wasInterrupted: false,
  }));
  return file;
}

const cli = () => path.join(app, 'scripts', 'baselines', 'qa041.mjs');
const mobile = (results: string[], extra: string[] = [], env?: NodeJS.ProcessEnv) =>
  node([cli(), '--package', 'mobile', ...results.flatMap((r) => ['--results', r]), ...extra, '--head', sha.head], app, env);

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qa041-cli-'));
  fs.mkdirSync(path.join(tmp, 'no-hooks'));
  fs.writeFileSync(path.join(tmp, 'gitconfig'), '');
  repo = path.join(tmp, 'repo');
  app = path.join(repo, 'mobile', 'KokonadaHealth');
  backend = path.join(repo, 'backend');
  for (const m of CODE_MODULES) put(app, m, fs.readFileSync(path.join(APP_ROOT, ...m.split('/')), 'utf8'));
  for (const f of [A, B, C]) put(app, f, '// planted test file\n');
  put(backend, 'tests/b1.test.js', '// planted backend test\n');
  put(repo, 'docs/design-v2/decisions/DEC-900.md', '---\nid: DEC-900\nstatus: DECIDED\n---\n');
  put(repo, 'docs/design-v2/decisions/DEC-901.md', '---\nid: DEC-901\nstatus: OPEN\n---\n');
  put(repo, 'docs/design-v2/decisions/DEC-091.md', '---\nid: DEC-091\nstatus: DECIDED\n---\n');
  build(repo, ['init', '-q']);
  plantData({ floorSha: '0'.repeat(40) }); // the data files exist at the floor commit too; their SHA is set below
  build(repo, ['add', '-A']);
  build(repo, ['commit', '-q', '-m', 'floor'], T_FLOOR);
  sha.floor = build(repo, ['rev-parse', 'HEAD']);
  build(repo, ['checkout', '-q', '-b', 'side']);
  put(app, 'src/e/E.test.ts', '// never merged\n');
  build(repo, ['add', '-A']);
  build(repo, ['commit', '-q', '-m', 'side'], T_FLOOR + 60);
  sha.side = build(repo, ['rev-parse', 'HEAD']);
  build(repo, ['checkout', '-q', 'main']);
  put(app, D, '// a test file added since the floor\n');
  build(repo, ['add', '-A']);
  build(repo, ['commit', '-q', '-m', 'head'], T_HEAD);
  sha.head = build(repo, ['rev-parse', 'HEAD']);
}, 120_000);

beforeEach(() => plantData());

afterAll(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

describe('QA-041 · the real process on a planted app (plan step 8)', () => {
  it('exit 0: a run that meets the record, bound to HEAD, every rule held', () => {
    const r = mobile([writeRun('ok', RUN())]);
    expect(outcome(r)).toEqual({ status: 0, stdout: expect.stringMatching(/^QA-041 mobile: VERIFIED \(exit 0\)\n/) });
    expect(r.stdout).toContain(`  - head: ${sha.head} is HEAD\n`);
    expect(r.stdout).toContain(`  - floor: mobile ran 14 tests: 14 >= floor 12 (the baseline's 12 at ${sha.floor.slice(0, 12)})\n`);
    expect(r.stdout).toContain(`  - RA-9: TEST_FLOOR.paths is the 3 test files of the tree at ${sha.floor.slice(0, 12)}, and the per-file record names the same files\n`);
  }, 90_000);

  it('exit 0: two shards that split the files, with --expect-shards 2', () => {
    const { [A]: a, [B]: b, ...rest } = RUN();
    const r = mobile([writeRun('shard-1', { [A]: a, [B]: b }), writeRun('shard-2', rest)], ['--expect-shards', '2']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('  - run: 14 tests in 4 test files from 2 results files (1 pending, 0 todo)\n');
  }, 90_000);

  it('exit 1 on each breach: a deleted test, a skip, a failed manifest test', () => {
    const deleted = mobile([writeRun('deleted', DELETED())]);
    expect(outcome(deleted)).toEqual({ status: 1, stdout: expect.stringContaining(`  - floor: mobile ran 11 tests: 11 < floor 12 (the baseline's 12 at ${sha.floor.slice(0, 12)})\n`) });
    const skipped = mobile([writeRun('skipped', { ...RUN(), [B]: tests('B', 4, (i) => (i < 2 ? 'pending' : 'passed')) })]);
    expect(outcome(skipped)).toEqual({ status: 1, stdout: expect.stringContaining('  - RA-5: mobile has 2 pending and todo tests (2 pending, 0 todo): 2 > bound 1') });
    const failed = mobile([writeRun('failed', { ...RUN(), [A]: tests('A', 5, (i) => (i === 1 ? 'failed' : 'passed')) })]);
    expect(outcome(failed)).toEqual({ status: 1, stdout: expect.stringContaining(`  - RA-7 CON-1: "A t1" in ${A} did not pass (failed)\n`) });
    expect(failed.stdout.split('\n')[0]).toBe('QA-041 mobile: BREACH (exit 1)');
  }, 90_000);

  it('the RETIRE rule reads the planted decision records: DECIDED lowers the floor, OPEN and DEC-091 are breaches', () => {
    const withoutC = writeRun('without-c', { [A]: tests('A', 5), [B]: tests('B', 4, (i) => (i === 0 ? 'pending' : 'passed')), [D]: tests('D', 2) });
    plantData({ retire: [{ kind: 'file', target: C, dec: 'DEC-900', reason: 'planted' }] });
    expect(mobile([withoutC]).status).toBe(0);
    plantData({ retire: [{ kind: 'file', target: C, dec: 'DEC-901', reason: 'planted' }] });
    expect(outcome(mobile([withoutC]))).toEqual({ status: 1, stdout: expect.stringContaining(`  - RETIRE file ${C}: DEC-901 is OPEN, not DECIDED\n`) });
    plantData({ retire: [{ kind: 'file', target: C, dec: 'DEC-091', reason: 'planted' }] });
    expect(outcome(mobile([withoutC]))).toEqual({ status: 1, stdout: expect.stringContaining(`  - RETIRE file ${C}: DEC-091 is the RETIRE rule itself, not a signature\n`) });
  }, 90_000);

  it('exit 1 on RA-9: a floor SHA present but not an ancestor of HEAD', () => {
    plantData({ floorSha: sha.side });
    expect(outcome(mobile([writeRun('ok', RUN())]))).toEqual({ status: 1, stdout: expect.stringContaining(`  - RA-9: TEST_FLOOR.sha ${sha.side} is not an ancestor of HEAD\n`) });
  }, 90_000);

  it('a breach together with a floor SHA missing from the clone: the breach outranks (1), the SHA is named', () => {
    plantData({ floorSha: 'e'.repeat(40) });
    const r = mobile([writeRun('deleted', DELETED())]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('  - floor: mobile ran 11 tests: 11 < floor 12');
    expect(r.stdout).toContain('  - not checked: RA-9: TEST_FLOOR.sha eeeeeeeeeeee is not in this clone\n');
    expect(outcome(mobile([writeRun('ok', RUN())]))).toEqual({ status: 2, stdout: expect.stringContaining('  - RA-9: TEST_FLOOR.sha eeeeeeeeeeee is not in this clone\n') });
  }, 90_000);

  it('exit 2: a missing results file, malformed JSON, a stale head', () => {
    expect(outcome(mobile([path.join(tmp, 'results', 'gone.json')]))).toEqual({ status: 2, stdout: expect.stringMatching(/^ {2}- .*gone\.json: cannot be read \(ENOENT/m) });
    const bad = path.join(tmp, 'results', 'bad.json');
    fs.writeFileSync(bad, '{"numTotalTests": 14,');
    expect(outcome(mobile([bad]))).toEqual({ status: 2, stdout: expect.stringMatching(/^ {2}- .*bad\.json: is not JSON/m) });
    const stale = node([cli(), '--package', 'mobile', '--results', writeRun('ok', RUN()), '--head', sha.floor], app);
    expect(outcome(stale)).toEqual({ status: 2, stdout: expect.stringContaining(`  - --head ${sha.floor} is neither HEAD (${sha.head}) nor HEAD's second parent (HEAD is not a merge): the results are bound to no commit\n`) });
    const old = mobile([writeRun('old', RUN(), app, T_HEAD * 1000 - 1)]);
    expect(outcome(old)).toEqual({ status: 2, stdout: expect.stringContaining('stale results') });
  }, 90_000);

  it('exit 2: an unknown --package, no --results, no --head', () => {
    const ok = writeRun('ok', RUN());
    expect(outcome(node([cli(), '--package', 'web', '--results', ok, '--head', sha.head], app)))
      .toEqual({ status: 2, stdout: expect.stringContaining('  - --package must be mobile or backend, got "web"\n') });
    expect(outcome(node([cli(), '--package', 'mobile', '--head', sha.head], app))).toEqual({ status: 2, stdout: expect.stringContaining('  - no --results file\n') });
    expect(outcome(node([cli(), '--package', 'mobile', '--results', ok], app))).toEqual({ status: 2, stdout: expect.stringMatching(/^QA-041: CANNOT VERIFY \(exit 2, never a pass\)\n {2}- no --head\n {2}- usage: /) });
  }, 90_000);

  it('exit 2: a Node that does not strip types (node --no-experimental-strip-types)', () => {
    const r = node(['--no-experimental-strip-types', cli(), '--package', 'mobile', '--results', writeRun('ok', RUN()), '--head', sha.head], app);
    expect(outcome(r)).toEqual({ status: 2, stdout: expect.stringMatching(/^QA-041: CANNOT VERIFY \(exit 2, never a pass\)\n {2}- this Node \(v[\d.]+\) cannot strip TypeScript types/) });
  }, 90_000);

  it('exit 2: git not on the PATH (the results cannot be bound to a commit)', () => {
    const env = plainEnv();
    for (const k of Object.keys(env)) if (/^path$/i.test(k)) delete env[k];
    env.PATH = fs.mkdtempSync(path.join(tmp, 'empty-bin-'));
    const r = mobile([writeRun('ok', RUN())], [], env);
    expect(outcome(r)).toEqual({ status: 2, stdout: expect.stringContaining('  - cannot bind the results to a commit: git is not on the PATH') });
  }, 90_000);

  it('exit 2: a data module that will not load, with no breach; --check-inputs names it too', () => {
    put(app, 'src/__contracts__/retire.ts', "import { RETIRE as R } from './nowhere';\nexport const RETIRE = R;\n");
    const r = mobile([writeRun('ok', RUN())]);
    expect(outcome(r)).toEqual({ status: 2, stdout: expect.stringMatching(/^ {2}- src\/__contracts__\/retire\.ts: did not load: /m) });
    expect(outcome(node([cli(), '--check-inputs'], app))).toEqual({ status: 2, stdout: expect.stringMatching(/^QA-041 inputs: CANNOT VERIFY \(exit 2, never a pass\)\n {2}- src\/__contracts__\/retire\.ts: did not load: /) });
    plantData();
    expect(node([cli(), '--check-inputs'], app).status).toBe(0);
  }, 90_000);

  it('exit 2: a data module that loads but exports no RETIRE is never read as an empty RETIRE', () => {
    put(app, 'src/__contracts__/retire.ts', tsData('RETIRES', []));
    expect(outcome(mobile([writeRun('ok', RUN())]))).toEqual({ status: 2, stdout: expect.stringContaining('  - src/__contracts__/retire.ts: RETIRE is not a list\n') });
  }, 90_000);

  it('a manifest title that spells a workflow command never starts a line of stdout', () => {
    plantData({ manifest: { 'CON-1': [{ file: A, fullTitle: 'A t1\n::error::planted' }] } });
    const r = mobile([writeRun('ok', RUN())]);
    expect(r.status).toBe(1);
    expect(r.stdout.split('\n').filter((l) => l.startsWith('::'))).toEqual([]);
  }, 90_000);

  it('the backend, run from backend/ with the path of plan "CLI usage": exit 0, and 1 on a deleted test', () => {
    const entry = path.join('..', 'mobile', 'KokonadaHealth', 'scripts', 'baselines', 'qa041.mjs');
    const run = (n: number) => {
      const results = writeRun(`backend-${n}`, { 'tests/b1.test.js': tests('b1', n) }, backend);
      return node([entry, '--package', 'backend', '--results', results, '--head', sha.head], backend);
    };
    const ok = run(3);
    expect(outcome(ok)).toEqual({ status: 0, stdout: expect.stringContaining('  - RA-7: the backend has no contract manifest (OPS-413), so no contract test was checked\n') });
    expect(outcome(run(2))).toEqual({ status: 1, stdout: expect.stringContaining(`  - floor: backend ran 2 tests: 2 < floor 3 (the baseline's 3 at ${sha.floor.slice(0, 12)})\n`) });
  }, 90_000);
});
