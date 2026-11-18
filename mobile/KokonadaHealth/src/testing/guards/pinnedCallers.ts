/// <reference types="node" />
// QA-116 (Stage 0 Q1b): every production function a test pins has a production caller. A green test over
// a function nothing calls reads as protection and protects nothing (MB-018's signOut, OPS-024).
//
// "Pinned": a callable export of a production module that a test file imports (a named, default or
//   namespace import), followed through barrels and renamed re-exports to its declaration by the type
//   checker. A type-only import pins nothing.
// "Production caller": a reference to that same declaration from a production file, in value position:
//   a call, a JSX tag, a value passed on, a shorthand property. Not a caller: an import or re-export on
//   its own, `export default x`, `typeof x` or any other type position, and a reference inside the
//   declaration itself (self-recursion).
// Known blind spots, and the side each errs on:
//   - a caller reached only through require() (as src/testing/stores.ts loads stores), or by
//     destructuring a namespace, is untyped and missed: the export is reported uncalled (errs red);
//   - a test that reaches a production function only through require(), jest.requireActual or a
//     src/testing helper does not pin it, so an uncalled one is not reported (errs green).
// Production files are productionFiles()' set (src outside tests, App.tsx, index*.js, modules/*/src)
// minus src/__contracts__, which holds this check's own data.

import * as path from 'path';
import ts from 'typescript';
import { productionFiles } from './productionImports';
import { isTestFile } from './sourceFiles';
import { canonical, createTsProgram, relToApp, type Overlay } from './tsProgram';

export interface DeadEntry {
  /** The declaring file, relative to the app root. */
  readonly file: string;
  /** The declared name (`default` for an anonymous default export). */
  readonly name: string;
  /** The TASKS.md row that schedules the export's removal or its caller. */
  readonly row: string;
}

export interface PinnedExport {
  /** `file#name`. */
  key: string;
  file: string;
  name: string;
  /** The test files that import it, relative to the app root, sorted. */
  tests: string[];
  /** The production files that reference it in value position, sorted. */
  callers: string[];
}

export interface PinScan {
  pinned: PinnedExport[];
  testFiles: number;
  productionFiles: number;
}

const ENTRY = /^(App\.tsx|index(\.[a-z]+)?\.js)$/;
const NOT_PRODUCTION = /^src\/(testing|__contracts__)\//;

/** Whether `file` is production source: the same set as productionFiles(), minus src/__contracts__. */
export function isProductionPath(file: string): boolean {
  const rel = relToApp(file);
  if (rel.startsWith('..') || path.isAbsolute(rel) || /(^|\/)node_modules\//.test(rel)) return false;
  if (isTestFile(rel) || NOT_PRODUCTION.test(rel)) return false;
  return rel.startsWith('src/') || ENTRY.test(rel) || /^modules\/[^/]+\/src\//.test(rel);
}

const isOwnTestFile = (file: string): boolean => {
  const rel = relToApp(file);
  return !rel.startsWith('..') && !/(^|\/)node_modules\//.test(rel) && isTestFile(rel);
};

// eslint-disable-next-line no-bitwise -- TypeScript's SymbolFlags is a bit set; this is its only test here
const isAlias = (symbol: ts.Symbol): boolean => (symbol.flags & ts.SymbolFlags.Alias) !== 0;

/** The symbol an import or a chain of re-exports finally names (the symbol itself when it is no alias). */
const resolveAlias = (checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol =>
  isAlias(symbol) ? checker.getAliasedSymbol(symbol) : symbol;

/** The declaration an import, re-export chain or local reference finally names. */
function declarationOf(checker: ts.TypeChecker, symbol: ts.Symbol | undefined): ts.Declaration | undefined {
  if (!symbol) return undefined;
  const resolved = resolveAlias(checker, symbol);
  return resolved.valueDeclaration ?? resolved.declarations?.[0];
}

const declaredName = (decl: ts.Declaration): string => {
  const name = ts.getNameOfDeclaration(decl);
  return name && ts.isIdentifier(name) ? name.text : 'default';
};

const isModuleAlias = (checker: ts.TypeChecker, id: ts.Expression): boolean => {
  if (!ts.isIdentifier(id)) return false;
  const symbol = checker.getSymbolAtLocation(id);
  if (!symbol || !isAlias(symbol)) return false;
  const target = resolveAlias(checker, symbol);
  return !!target.valueDeclaration && ts.isSourceFile(target.valueDeclaration);
};

/** The identifiers by which a test file imports production values. */
function pinningIdentifiers(checker: ts.TypeChecker, sf: ts.SourceFile): ts.Identifier[] {
  const out: ts.Identifier[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      if (!clause || clause.isTypeOnly) return;
      if (clause.name) out.push(clause.name);
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const el of clause.namedBindings.elements) if (!el.isTypeOnly) out.push(el.name);
      }
      return;
    }
    if (ts.isImportEqualsDeclaration(node)) {
      if (!node.isTypeOnly) out.push(node.name);
      return;
    }
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name) && isModuleAlias(checker, node.expression)) {
      out.push(node.name);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Every value-position reference in a production file, each with the declaration it names. */
function productionReferences(checker: ts.TypeChecker, sf: ts.SourceFile, names: ReadonlySet<string>): [ts.Identifier, ts.Declaration][] {
  // A local alias (`import { a as b }`, a default import) makes its local name worth resolving too.
  const local = new Set(names);
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause) continue;
    if (st.importClause.name) local.add(st.importClause.name.text);
    const nb = st.importClause.namedBindings;
    if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) local.add(el.name.text);
  }
  const out: [ts.Identifier, ts.Declaration][] = [];
  const add = (id: ts.Identifier, symbol: ts.Symbol | undefined) => {
    const decl = declarationOf(checker, symbol);
    if (decl) out.push([id, decl]);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isExportAssignment(node) && ts.isIdentifier(node.expression)) return;
    if (ts.isTypeNode(node) && !ts.isExpressionWithTypeArguments(node)) return;
    if (ts.isShorthandPropertyAssignment(node)) {
      if (local.has(node.name.text)) add(node.name, checker.getShorthandAssignmentValueSymbol(node));
      if (node.objectAssignmentInitializer) visit(node.objectAssignmentInitializer);
      return;
    }
    if (ts.isPropertyAccessExpression(node)) {
      visit(node.expression);
      if (ts.isIdentifier(node.name) && isModuleAlias(checker, node.expression)) add(node.name, checker.getSymbolAtLocation(node.name));
      return;
    }
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const isDeclName = parent && ts.getNameOfDeclaration(parent as ts.Declaration) === node;
      const isPropertyName = parent && (ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent)
        || ts.isPropertyDeclaration(parent) || ts.isJsxAttribute(parent)) && parent.name === node;
      if (!isDeclName && !isPropertyName && local.has(node.text)) add(node, checker.getSymbolAtLocation(node));
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const within = (node: ts.Node, decl: ts.Declaration): boolean =>
  node.getSourceFile() === decl.getSourceFile() && node.pos >= decl.pos && node.end <= decl.end;

const scanCache = new WeakMap<ts.ParsedCommandLine, PinScan>();

/**
 * Every pinned production export, with the tests that pin it and its production callers, over the whole
 * tsconfig project plus the production entry files. `overlay` replaces files' text in memory; an overlay
 * path that is not a project file joins the program as a root (a planted file under src, never written).
 * The scan with no overlay is cached per parsed config.
 */
export function scanPinnedExports(parsed: ts.ParsedCommandLine, overlay: Overlay = {}): PinScan {
  const planted = Object.keys(overlay).length > 0;
  if (!planted && scanCache.has(parsed)) return scanCache.get(parsed)!;

  const roots = new Map<string, string>();
  for (const f of [...parsed.fileNames, ...productionFiles(), ...Object.keys(overlay)]) roots.set(canonical(f), f);
  const { program } = createTsProgram([...roots.values()], parsed, overlay);
  const checker = program.getTypeChecker();
  const files = program.getSourceFiles();
  const tests = files.filter((sf) => isOwnTestFile(sf.fileName));
  const production = files.filter((sf) => isProductionPath(sf.fileName));

  const pins = new Map<ts.Declaration, PinnedExport>();
  for (const sf of tests) {
    for (const id of pinningIdentifiers(checker, sf)) {
      const symbol = checker.getSymbolAtLocation(id);
      const decl = declarationOf(checker, symbol);
      if (!symbol || !decl || ts.isSourceFile(decl)) continue;
      const declFile = decl.getSourceFile();
      if (declFile.isDeclarationFile || !isProductionPath(declFile.fileName)) continue;
      const callable = checker.getTypeOfSymbolAtLocation(resolveAlias(checker, symbol), decl).getCallSignatures().length > 0;
      if (!callable) continue;
      let pin = pins.get(decl);
      if (!pin) {
        const file = relToApp(declFile.fileName);
        const name = declaredName(decl);
        pin = { key: `${file}#${name}`, file, name, tests: [], callers: [] };
        pins.set(decl, pin);
      }
      const test = relToApp(sf.fileName);
      if (!pin.tests.includes(test)) pin.tests.push(test);
    }
  }

  const names = new Set([...pins.values()].map((p) => p.name));
  for (const sf of production) {
    if (sf.isDeclarationFile) continue;
    for (const [id, decl] of productionReferences(checker, sf, names)) {
      const pin = pins.get(decl);
      if (!pin || within(id, decl)) continue;
      const caller = relToApp(sf.fileName);
      if (!pin.callers.includes(caller)) pin.callers.push(caller);
    }
  }

  const pinned = [...pins.values()]
    .map((p) => ({ ...p, tests: [...p.tests].sort(), callers: [...p.callers].sort() }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const scan: PinScan = { pinned, testFiles: tests.length, productionFiles: production.length };
  if (!planted) scanCache.set(parsed, scan);
  return scan;
}

/**
 * Every pinned export with no production caller that the dead list does not name, and every dead-list
 * entry that no longer belongs there: listed twice, pinned by no test, or called from production now.
 */
export function pinFailures(scan: PinScan, dead: readonly DeadEntry[]): string[] {
  const out: string[] = [];
  const byKey = new Map(scan.pinned.map((p) => [p.key, p]));
  const listed = new Set<string>();
  for (const entry of dead) {
    const key = `${entry.file}#${entry.name}`;
    if (listed.has(key)) {
      out.push(`dead list: ${key} (${entry.row}) is listed twice`);
      continue;
    }
    listed.add(key);
    const pin = byKey.get(key);
    if (!pin) out.push(`dead list: ${key} (${entry.row}): no test pins it any more; remove the entry (the list only shrinks)`);
    else if (pin.callers.length > 0) {
      out.push(`dead list: ${key} (${entry.row}) has a production caller now (${pin.callers.join(', ')}); remove the entry`);
    }
  }
  for (const pin of scan.pinned) {
    if (pin.callers.length > 0 || listed.has(pin.key)) continue;
    out.push(`${pin.key}: pinned by ${pin.tests.join(', ')} but no production file calls it; call it, delete it with its test, `
      + 'or list it in src/__contracts__/deadList.ts citing the TASKS row that schedules it');
  }
  return out;
}

