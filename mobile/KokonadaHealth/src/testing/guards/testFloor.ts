/// <reference types="node" />
// The interim QA-041 floor (D8 rule 6), until QA-041 proper (numTotalTests from `jest --ci --json` in
// CI) has its CI step: every test file `jest --listTests` returned at the baseline is still returned,
// or is named by a RETIRE entry, the count of skip and todo markers
// (.skip, xit, xtest, xdescribe, .todo) never rises above its baseline, and nothing is focused
// (.only, fit, fdescribe). Markers are read as calls and references through the TypeScript parser, so
// a planted source spelled inside a string is never counted. The baseline is never raised by this
// check (no ratchet); src/__contracts__/testFloor.baseline.ts records where it was measured.

import ts from 'typescript';
import { normalizeEol } from './contracts';
import { checkRetireEntries, type DecStatus, type RetireEntry } from './retire';
import { parseSource } from './sourceFiles';

/** Structurally TEST_FLOOR in src/__contracts__/testFloor.baseline.ts. */
export interface FloorBaseline {
  sha: string;
  listTestsCount: number;
  skipCount: number;
  measuredAt: string;
  command: string;
  /** every test file jest listed at sha: sorted, posix, relative to the app. */
  paths: readonly string[];
}

const TEST_ROOTS = new Set(['it', 'test', 'describe']);
const SKIP_PROPS = new Set(['skip', 'todo', 'failing']); // .failing holds nothing while it passes (#291 audit RA-3)
const SKIP_IDS = new Set(['xit', 'xtest', 'xdescribe']);
const ONLY_IDS = new Set(['fit', 'fdescribe']);

function rootIdentifier(e: ts.Expression): string | null {
  let x: ts.Expression = e;
  for (;;) {
    if (ts.isIdentifier(x)) return x.text;
    if (ts.isPropertyAccessExpression(x)) x = x.expression;
    else if (ts.isCallExpression(x)) x = x.expression;
    else return null;
  }
}

/** An identifier in a position that names something else: a property, a key, a declaration. */
function isNameSlot(id: ts.Identifier): boolean {
  const p = id.parent;
  if (ts.isPropertyAccessExpression(p)) return p.name === id;
  return (ts.isPropertyAssignment(p) || ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isBindingElement(p)
    || ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p)
    || ts.isImportSpecifier(p) || ts.isExportSpecifier(p)) && p.name === id;
}

/** The skip/todo and focus markers in one source. */
export function countMarkers(source: string, fileName: string): { skip: number; only: number } {
  let skip = 0;
  let only = 0;
  const visit = (n: ts.Node): void => {
    if (ts.isPropertyAccessExpression(n) && TEST_ROOTS.has(rootIdentifier(n.expression) ?? '')) {
      if (SKIP_PROPS.has(n.name.text)) skip += 1;
      else if (n.name.text === 'only') only += 1;
    } else if (ts.isIdentifier(n) && !isNameSlot(n)) {
      if (SKIP_IDS.has(n.text)) skip += 1;
      else if (ONLY_IDS.has(n.text)) only += 1;
    }
    ts.forEachChild(n, visit);
  };
  visit(parseSource(normalizeEol(source), fileName));
  return { skip, only };
}

export interface FloorMeasure { listTestsCount: number; skipCount: number; onlyCount: number; onlyFiles: string[]; unreadable: string[] }

/** The counts the floor compares, over the files jest runs. */
export function measureFloor(listTests: readonly string[], read: (file: string) => string | null): FloorMeasure {
  const m: FloorMeasure = { listTestsCount: listTests.length, skipCount: 0, onlyCount: 0, onlyFiles: [], unreadable: [] };
  for (const f of listTests) {
    const source = read(f);
    if (source === null) { m.unreadable.push(f); continue; }
    const c = countMarkers(source, f);
    m.skipCount += c.skip;
    m.onlyCount += c.only;
    if (c.only > 0) m.onlyFiles.push(f);
  }
  return m;
}

/** QA-041 interim floor: one failure line per breach; [] when the floor holds. */
export function checkFloor(
  baseline: FloorBaseline,
  listTests: readonly string[],
  read: (file: string) => string | null,
  retire: readonly RetireEntry[],
  decStatus: DecStatus,
): string[] {
  const entries = retire.filter((e) => e.kind === 'file');
  const run = new Set(listTests);
  const inBaseline = new Set(baseline.paths);
  const at = baseline.sha.slice(0, 12);
  const failures = checkRetireEntries(entries, decStatus);
  const retired = new Set<string>();
  for (const e of entries) {
    if (!inBaseline.has(e.target)) failures.push(`RETIRE file ${e.target}: not in the baseline at ${at} (only a baseline test file is retired)`);
    else if (run.has(e.target)) failures.push(`RETIRE file ${e.target}: jest still runs it`);
    else if (checkRetireEntries([e], decStatus).length === 0) retired.add(e.target);
  }
  const m = measureFloor(listTests, read);
  for (const f of m.unreadable) failures.push(`${f} is listed by jest but cannot be read`);
  // Each baseline file, not a count: new files never stand in for a deleted one (#291 audit RA-1).
  for (const f of baseline.paths) {
    if (!run.has(f) && !retired.has(f)) failures.push(`${f}: in the baseline at ${at}, jest no longer runs it, and no RETIRE entry names it`);
  }
  if (m.skipCount > baseline.skipCount) {
    failures.push(`${m.skipCount} skip/todo markers (.skip, x*, .todo); the floor allows ${baseline.skipCount} (baseline at ${at})`);
  }
  if (m.onlyCount > 0) {
    failures.push(`${m.onlyCount} focused marker${m.onlyCount === 1 ? '' : 's'} (.only, fit, fdescribe), the floor allows none: ${m.onlyFiles.join(', ')}`);
  }
  return failures;
}
