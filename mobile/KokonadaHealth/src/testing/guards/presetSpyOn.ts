/// <reference types="node" />
// QA-112: no jest.spyOn on a member the preset (or jest.setup.js) already mocks.
//
// jest.spyOn(obj, key) on a member that is ALREADY a mock function installs nothing: it returns the
// existing, shared mock (jest-mock 29.7, build/index.js:737). mockReturnValue then mutates the preset
// for every later test in the file, restoreAllMocks() does not undo it, and mockRestore() strips the
// preset's implementation (OPS-017, OPS-031). The fix is capture-and-restore (src/testing/faces.ts).
//
// The guard resolves each spyOn target statically (through the TypeScript parser) to a package and a
// member chain, then asks the module registry whether that member is already a mock. The registry
// is read in the unit project before any test runs, so the answer follows the preset and
// jest.setup.js as they are.

import * as path from 'path';
import ts from 'typescript';
import { APP_ROOT, TESTING_ROOT } from './productionImports';
import { parseSource, readSource } from './sourceFiles';

/**
 * The roots the guard enforces. Opt-in: v2 suites (src/design/v2) and pages (src/pages) join when
 * their trees are on main and their isolation rules admit src/testing (owed, see the OPS-067 report).
 */
export const SPYON_GUARD_ROOTS: string[] = [TESTING_ROOT];

export interface SpyOnSite {
  file: string;
  line: number;
  /** The package the target resolves to, or null (a global, a local, an unresolvable expression). */
  module: string | null;
  /** True when the target resolves to a relative (app) module: never a preset mock. */
  relative: boolean;
  /** The member chain from the module to the spied object ('default' = a default import). */
  chain: string[];
  member: string;
  text: string;
}

type Binding = { module: string; chain: string[] };

const unwrap = (e: ts.Expression): ts.Expression => {
  let x = e;
  while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isNonNullExpression(x) || ts.isTypeAssertionExpression(x)) x = x.expression;
  return x;
};

const requireOf = (e: ts.Expression): string | null => {
  const x = unwrap(e);
  return ts.isCallExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === 'require'
    && x.arguments.length === 1 && ts.isStringLiteralLike(x.arguments[0]) ? x.arguments[0].text : null;
};

function collectBindings(file: ts.SourceFile): Map<string, Binding> {
  const bindings = new Map<string, Binding>();
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.importClause) {
      const module = node.moduleSpecifier.text;
      const clause = node.importClause;
      if (clause.name) bindings.set(clause.name.text, { module, chain: ['default'] });
      const named = clause.namedBindings;
      if (named && ts.isNamespaceImport(named)) bindings.set(named.name.text, { module, chain: [] });
      if (named && ts.isNamedImports(named)) {
        for (const el of named.elements) bindings.set(el.name.text, { module, chain: [(el.propertyName ?? el.name).text] });
      }
    } else if (ts.isVariableDeclaration(node) && node.initializer) {
      const base = resolveTarget(node.initializer, bindings);
      if (base) {
        if (ts.isIdentifier(node.name)) bindings.set(node.name.text, base);
        else if (ts.isObjectBindingPattern(node.name)) {
          for (const el of node.name.elements) {
            if (!ts.isIdentifier(el.name)) continue;
            const key = el.propertyName && (ts.isIdentifier(el.propertyName) || ts.isStringLiteral(el.propertyName))
              ? el.propertyName.text : el.name.text;
            bindings.set(el.name.text, { module: base.module, chain: [...base.chain, key] });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return bindings;
}

function resolveTarget(expr: ts.Expression, bindings: Map<string, Binding>): Binding | null {
  const e = unwrap(expr);
  const required = requireOf(e);
  if (required !== null) return { module: required, chain: [] };
  if (ts.isIdentifier(e)) return bindings.get(e.text) ?? null;
  if (ts.isPropertyAccessExpression(e)) {
    const base = resolveTarget(e.expression, bindings);
    return base ? { module: base.module, chain: [...base.chain, e.name.text] } : null;
  }
  if (ts.isElementAccessExpression(e) && ts.isStringLiteralLike(e.argumentExpression)) {
    const base = resolveTarget(e.expression, bindings);
    return base ? { module: base.module, chain: [...base.chain, e.argumentExpression.text] } : null;
  }
  return null;
}

/** Every jest.spyOn(target, 'member') call in a source, with its target resolved where possible. */
export function spyOnSites(source: string, fileName: string): SpyOnSite[] {
  const file = parseSource(source, fileName);
  const bindings = collectBindings(file);
  const out: SpyOnSite[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'jest'
      && node.expression.name.text === 'spyOn' && node.arguments.length >= 2 && ts.isStringLiteralLike(node.arguments[1])) {
      const target = resolveTarget(node.arguments[0], bindings);
      out.push({
        file: fileName,
        line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
        module: target?.module ?? null,
        relative: !!target && target.module.startsWith('.'),
        chain: target?.chain ?? [],
        member: node.arguments[1].text,
        text: node.getText(file),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}

export function spyOnSitesIn(files: string[]): SpyOnSite[] {
  return files.flatMap((f) => spyOnSites(readSource(f), f));
}

/**
 * The sites whose member is already a mock function in the registry `load` reads (call it with the
 * guard's own `require`, in the unit project). A package the registry cannot load is an error, not a pass.
 */
export function presetMockedSpyOns(sites: SpyOnSite[], load: (id: string) => unknown): SpyOnSite[] {
  return sites.filter((site) => {
    if (site.module === null || site.relative) return false;
    let obj: any;
    try {
      obj = load(site.module);
    } catch (err) {
      throw new Error(`QA-112 guard cannot load ${site.module} for ${site.text} (${site.file}:${site.line}): ${(err as Error).message}`);
    }
    for (const key of site.chain) {
      if (obj == null) return false;
      obj = key === 'default' ? (obj.__esModule ? obj.default : obj) : obj[key];
    }
    return obj != null && jest.isMockFunction(obj[site.member]);
  });
}

export const relToApp = (f: string): string => path.relative(APP_ROOT, f).split(path.sep).join('/');
