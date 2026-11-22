/// <reference types="node" />
// QA-116 (Stage 0 Q1b): every production function a test pins has a production caller. A green test over
// a function nothing calls reads as protection and protects nothing (MB-018's signOut, OPS-024).
//
// "Pinned": a callable export (a call or a construct signature: functions, components, hooks, classes)
//   of a production module that a test file names through an import (named, default or namespace),
//   `require('<literal>').name`, `jest.requireActual('<literal>').name` or `const { name } =
//   require('<literal>')`, followed through barrels and renamed re-exports to its declaration by the type
//   checker. A type-only import pins nothing. Object members (`api.method`) are out of scope: only a
//   module's own exports are pins.
// "Production caller": a reference to that same declaration, in value position (a call, `new`, a JSX
//   tag, a value passed on, a shorthand property), from a production file that the release entry
//   (index.js, App.tsx) reaches through its imports. A caller in the Design Lab (index.lab.js,
//   src/design/lab/**, absent from every uploadable build, MB-084) or in an orphan module does not count:
//   that code never ships. Not a caller either: an import or re-export on its own, `export default x`,
//   `typeof x` or any other type position, and a reference inside any of the export's own declarations
//   (self-recursion, overloads included).
// One hop only: a caller inside another function that itself has no caller still counts, so a chain
//   of dead functions is reported at its head only.
// Known blind spots, and the side each errs on:
//   - a production caller reached only through require() (as src/testing/stores.ts loads stores), or by
//     destructuring a namespace, is untyped and missed, and an import edge TypeScript does not resolve
//     (a jest moduleNameMapper alias) leaves its target outside the release closure: the export is
//     reported uncalled (errs red);
//   - a test that reaches a production function only through a src/testing helper does not pin it, so
//     an uncalled one is not reported (errs green, OPS-438).
// Production files are productionFiles()' set (src outside tests, App.tsx, index*.js, modules/*/src)
// minus src/__contracts__ (this check's own data) and the Design Lab.

import * as path from 'path';
import ts from 'typescript';
import { APP_ROOT, productionFiles } from './productionImports';
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
  /** The test files that name it, relative to the app root, sorted. */
  tests: string[];
  /** The production files in the release closure that reference it in value position, sorted. */
  callers: string[];
}

export interface PinScan {
  pinned: PinnedExport[];
  testFiles: number;
  productionFiles: number;
  /** Production files the release entry reaches. */
  releaseFiles: number;
}

const ENTRY = /^(App\.tsx|index(\.[a-z]+)?\.js)$/;
const NOT_PRODUCTION = /^(src\/(testing|__contracts__|design\/lab)\/|index\.lab\.js$)/;
/** The release build's entry files; everything they reach through resolved imports ships. */
export const RELEASE_ENTRIES = ['index.js', 'App.tsx'].map((f) => path.join(APP_ROOT, f));

/** Whether `file` is production source: productionFiles()' set minus src/__contracts__ and the Design Lab. */
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

/** Every canonical file reachable from `entries` through `edges`. */
export function reachable(edges: ReadonlyMap<string, ReadonlySet<string>>, entries: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const queue = entries.map(canonical);
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const next of edges.get(file) ?? []) if (!seen.has(next)) queue.push(next);
  }
  return seen;
}

/**
 * Throws unless every relative import or re-export of each overlay file resolved to a file. A planted
 * import that resolves to nothing (a directory that does not exist on disk, OPS-436) would otherwise
 * plant nothing and let a control pass for the wrong reason. require() is not resolved by TypeScript in
 * a .ts file, so only import and export declarations are held to this.
 */
export function assertOverlayResolved(overlay: Overlay, edges: ReadonlyMap<string, ReadonlySet<string>>): void {
  const unresolved: string[] = [];
  for (const [file, text] of Object.entries(overlay)) {
    const targets = [...(edges.get(canonical(file)) ?? [])];
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : undefined);
    for (const st of sf.statements) {
      if (!(ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) || !st.moduleSpecifier || !ts.isStringLiteral(st.moduleSpecifier)) continue;
      const spec = st.moduleSpecifier.text;
      if (!spec.startsWith('.')) continue;
      const base = canonical(path.resolve(path.dirname(file), spec));
      if (!targets.some((t) => t === base || t.startsWith(`${base}.`) || t.startsWith(`${base}/index.`))) {
        unresolved.push(`${relToApp(file)} -> ${spec}`);
      }
    }
  }
  if (unresolved.length > 0) throw new Error(`planted imports that do not resolve to a file: ${unresolved.join(', ')}`);
}

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

/** The module literal of `require('<literal>')` or `jest.requireActual('<literal>')`, else undefined. */
function requiredModule(node: ts.Node | undefined): string | undefined {
  if (!node || !ts.isCallExpression(node) || node.arguments.length !== 1 || !ts.isStringLiteralLike(node.arguments[0])) return undefined;
  const callee = node.expression;
  const isRequire = (ts.isIdentifier(callee) && callee.text === 'require')
    || (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'jest'
      && callee.name.text === 'requireActual');
  return isRequire ? node.arguments[0].text : undefined;
}

/** The symbols by which a test file names production values. */
function pinningSymbols(checker: ts.TypeChecker, sf: ts.SourceFile, requiredExport: (spec: string, name: string) => ts.Symbol | undefined): ts.Symbol[] {
  const out: ts.Symbol[] = [];
  const push = (symbol: ts.Symbol | undefined) => { if (symbol) out.push(symbol); };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      if (!clause || clause.isTypeOnly) return;
      if (clause.name) push(checker.getSymbolAtLocation(clause.name));
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const el of clause.namedBindings.elements) if (!el.isTypeOnly) push(checker.getSymbolAtLocation(el.name));
      }
      return;
    }
    if (ts.isImportEqualsDeclaration(node)) {
      if (!node.isTypeOnly) push(checker.getSymbolAtLocation(node.name));
      return;
    }
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)) {
      const spec = requiredModule(node.expression);
      if (spec !== undefined) push(requiredExport(spec, node.name.text));
      else if (isModuleAlias(checker, node.expression)) push(checker.getSymbolAtLocation(node.name));
    }
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name)) {
      const spec = requiredModule(node.initializer);
      if (spec !== undefined) {
        for (const el of node.name.elements) {
          const key = el.propertyName ?? el.name;
          if (ts.isIdentifier(key)) push(requiredExport(spec, key.text));
        }
      }
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
      // A declaration's own name is no reference. This also excludes `export default x`: TypeScript names
      // an export assignment by its identifier expression, so `x` there is the assignment's name.
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

const within = (node: ts.Node, decls: readonly ts.Declaration[]): boolean =>
  decls.some((decl) => node.getSourceFile() === decl.getSourceFile() && node.pos >= decl.pos && node.end <= decl.end);

const scanCache = new WeakMap<ts.ParsedCommandLine, PinScan>();

/**
 * Every pinned production export, with the tests that pin it and its production callers, over the whole
 * tsconfig project plus the production entry files. `overlay` replaces files' text in memory; an overlay
 * path that is not a project file joins the program as a root (a planted file under src, never written),
 * and each of its relative imports must resolve. The scan with no overlay is cached per parsed config.
 */
export function scanPinnedExports(parsed: ts.ParsedCommandLine, overlay: Overlay = {}): PinScan {
  const planted = Object.keys(overlay).length > 0;
  if (!planted && scanCache.has(parsed)) return scanCache.get(parsed)!;

  const roots = new Map<string, string>();
  for (const f of [...parsed.fileNames, ...productionFiles(), ...Object.keys(overlay)]) roots.set(canonical(f), f);
  const { program, edges } = createTsProgram([...roots.values()], parsed, overlay);
  if (planted) assertOverlayResolved(overlay, edges);
  const checker = program.getTypeChecker();
  const files = program.getSourceFiles();
  const tests = files.filter((sf) => isOwnTestFile(sf.fileName));
  const production = files.filter((sf) => isProductionPath(sf.fileName));
  const release = reachable(edges, RELEASE_ENTRIES);
  const shipped = production.filter((sf) => release.has(canonical(sf.fileName)));

  const resolutionHost: ts.ModuleResolutionHost = {
    fileExists: (p) => program.getSourceFile(p) !== undefined || ts.sys.fileExists(p),
    readFile: (p) => program.getSourceFile(p)?.text ?? ts.sys.readFile(p),
  };
  const requiredExport = (from: ts.SourceFile) => (spec: string, name: string): ts.Symbol | undefined => {
    const resolved = ts.resolveModuleName(spec, from.fileName, parsed.options, resolutionHost).resolvedModule;
    const target = resolved && program.getSourceFile(resolved.resolvedFileName);
    const moduleSymbol = target && checker.getSymbolAtLocation(target);
    return moduleSymbol && checker.getExportsOfModule(moduleSymbol).find((s) => s.name === name);
  };

  const pins = new Map<ts.Declaration, { pin: PinnedExport; decls: readonly ts.Declaration[] }>();
  for (const sf of tests) {
    for (const symbol of pinningSymbols(checker, sf, requiredExport(sf))) {
      const target = resolveAlias(checker, symbol);
      const decl = declarationOf(checker, symbol);
      if (!decl || ts.isSourceFile(decl)) continue;
      const declFile = decl.getSourceFile();
      if (declFile.isDeclarationFile || !isProductionPath(declFile.fileName)) continue;
      const type = checker.getTypeOfSymbolAtLocation(target, decl);
      if (type.getCallSignatures().length === 0 && type.getConstructSignatures().length === 0) continue;
      let entry = pins.get(decl);
      if (!entry) {
        const file = relToApp(declFile.fileName);
        const name = declaredName(decl);
        entry = { pin: { key: `${file}#${name}`, file, name, tests: [], callers: [] }, decls: target.declarations ?? [decl] };
        pins.set(decl, entry);
      }
      const test = relToApp(sf.fileName);
      if (!entry.pin.tests.includes(test)) entry.pin.tests.push(test);
    }
  }

  const names = new Set([...pins.values()].map((e) => e.pin.name));
  for (const sf of shipped) {
    if (sf.isDeclarationFile) continue;
    for (const [id, decl] of productionReferences(checker, sf, names)) {
      const entry = pins.get(decl);
      if (!entry || within(id, entry.decls)) continue;
      const caller = relToApp(sf.fileName);
      if (!entry.pin.callers.includes(caller)) entry.pin.callers.push(caller);
    }
  }

  const pinned = [...pins.values()]
    .map(({ pin }) => ({ ...pin, tests: [...pin.tests].sort(), callers: [...pin.callers].sort() }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const scan: PinScan = { pinned, testFiles: tests.length, productionFiles: production.length, releaseFiles: shipped.length };
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
    out.push(`${pin.key}: pinned by ${pin.tests.join(', ')} but no shipped production file calls it; call it, delete it with its `
      + 'test, or list it in src/__contracts__/deadList.ts citing the TASKS row that schedules it');
  }
  return out;
}
