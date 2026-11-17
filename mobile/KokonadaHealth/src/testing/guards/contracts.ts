/// <reference types="node" />
// QA-040 (Stage 0 Q1): every contract ID in src/__contracts__/manifest.ts has a running test. A
// contract lives inside a screen test that a rewrite can delete; the manifest names each one by file
// and full name, and this reads the tests statically, through the TypeScript parser, so a reference
// holds only when jest runs its file, the title is spelled out in the source and nothing skips it.

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import ts from 'typescript';
import { parseSource } from './sourceFiles';

/** A manifest reference: a file relative to the app (posix, case-exact) and a test's full name. */
export interface ContractRef { file: string; fullTitle: string }

export interface IndexedTest {
  /** jest's full name: the describe titles and the test title, joined by spaces. */
  fullName: string;
  /** under x*, .skip, .todo, or inside a skipped describe. */
  skipped: boolean;
  /** a title (its own or an ancestor's) the source does not spell out: a .each table, a template with an expression, any other expression. */
  dynamic: boolean;
  /** the test's call, for readers that need its body (the QA-118 pins). */
  call: ts.CallExpression;
}

export const DYNAMIC = '<dynamic>';
const DESCRIBES = new Set(['describe', 'xdescribe', 'fdescribe']);
const TESTS = new Set(['it', 'test', 'xit', 'xtest', 'fit']);
const SKIPPING_ROOTS = new Set(['xit', 'xtest', 'xdescribe']);

/** The callee chain of a test call: the root identifier and every property name on the way, outermost last. */
function calleeChain(e: ts.Expression): { root: string | null; names: string[]; each: boolean } {
  const names: string[] = [];
  let each = false;
  let x: ts.Expression = e;
  for (;;) {
    if (ts.isIdentifier(x)) return { root: x.text, names, each };
    if (ts.isPropertyAccessExpression(x)) { names.push(x.name.text); x = x.expression; }
    else if (ts.isCallExpression(x)) { each = true; x = x.expression; } // it.each(table)('title')
    else return { root: null, names, each };
  }
}

export const normalizeEol = (source: string): string => source.replace(/\r\n?/g, '\n');

/** Every test in a source with its full name, skip state and whether its name is resolvable. */
export function indexTests(source: string, fileName: string): IndexedTest[] {
  const out: IndexedTest[] = [];
  const visit = (n: ts.Node, titles: string[], skipped: boolean, dynamic: boolean): void => {
    if (ts.isCallExpression(n) && n.arguments.length > 0) {
      const { root, names, each } = calleeChain(n.expression);
      const isDescribe = root !== null && DESCRIBES.has(root);
      const isTest = root !== null && TESTS.has(root);
      if (isDescribe || isTest) {
        const arg = n.arguments[0];
        const literal = ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg);
        const ownDynamic = each || !literal;
        const title = ownDynamic ? DYNAMIC : (arg as ts.StringLiteralLike).text;
        const ownSkipped = SKIPPING_ROOTS.has(root as string) || names.includes('skip') || names.includes('todo');
        if (isTest) {
          out.push({ fullName: [...titles, title].join(' '), skipped: skipped || ownSkipped, dynamic: dynamic || ownDynamic, call: n });
          return;
        }
        for (const a of n.arguments.slice(1)) visit(a, [...titles, title], skipped || ownSkipped, dynamic || ownDynamic);
        return;
      }
    }
    ts.forEachChild(n, (c) => visit(c, titles, skipped, dynamic));
  };
  visit(parseSource(normalizeEol(source), fileName), [], false, false);
  return out;
}

const POSIX_REL = /^(?!\/)(?![A-Za-z]:)[^\\]+$/;

/** QA-040: one failure line per reference that does not hold; [] when every ID is matched. */
export function checkManifest(
  manifest: Readonly<Record<string, readonly ContractRef[]>>,
  listTests: readonly string[],
  read: (file: string) => string | null,
): string[] {
  const run = new Set(listTests);
  const failures: string[] = [];
  for (const [id, refs] of Object.entries(manifest)) {
    if (refs.length === 0) { failures.push(`${id}: no test reference`); continue; }
    for (const { file, fullTitle } of refs) {
      if (!POSIX_REL.test(file)) { failures.push(`${id}: ${file} is not a posix path relative to the app`); continue; }
      if (!run.has(file)) { failures.push(`${id}: ${file} is not among the files jest runs`); continue; }
      const source = read(file);
      if (source === null) { failures.push(`${id}: ${file} cannot be read`); continue; }
      const named = indexTests(source, file).filter((t) => !t.dynamic && t.fullName === fullTitle);
      if (named.length === 0) failures.push(`${id}: ${file} has no test named ${JSON.stringify(fullTitle)}`);
      else if (named.every((t) => t.skipped)) failures.push(`${id}: ${JSON.stringify(fullTitle)} in ${file} is skipped`);
    }
  }
  return failures;
}

export interface SpawnResult { status: number | null; stdout: string; stderr: string; error?: Error }

/** Validate a `jest --listTests --json` run: a real exit, a JSON array of existing absolute files. */
export function parseListTests(r: SpawnResult, appRoot: string): string[] {
  if (r.error) throw new Error(`jest --listTests did not run: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`jest --listTests exited ${r.status}: ${r.stderr.slice(0, 500)}`);
  let files: unknown;
  try { files = JSON.parse(r.stdout); } catch { throw new Error(`jest --listTests printed no JSON list: ${r.stdout.slice(0, 300)}`); }
  if (!Array.isArray(files) || files.some((f) => typeof f !== 'string' || !path.isAbsolute(f) || !fs.existsSync(f))) {
    throw new Error('jest --listTests printed something that is not a list of test files');
  }
  return (files as string[]).map((f) => path.relative(appRoot, f).split(path.sep).join('/')).sort();
}

/**
 * The files jest runs: `jest --listTests --json` across every project (no --selectProjects), spawned
 * with the repo's own jest through process.execPath, with a timeout (D8 rule 1).
 */
export function listJestTests(appRoot: string, timeoutMs = 120_000): string[] {
  const r = spawnSync(process.execPath, [path.join(appRoot, 'node_modules/jest/bin/jest.js'), '--listTests', '--json'], {
    cwd: appRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: timeoutMs,
  });
  return parseListTests({ status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error }, appRoot);
}
