/// <reference types="node" />
// The import closure of a v2 component, read from the TypeScript syntax tree of every file it reaches by a relative import
// (type-only imports included: a coupling is a coupling), as PlateTouch's closure test reads its own. For each file: every
// module it names (import and export declarations, require, dynamic import, jest.mock), every name it takes from
// 'react-native', and every identifier and string literal in it. Test-only: the closure tests of InlineNotice and
// LegalReader hold their components to it, each with planted sources of its own.

import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';

export interface Scan {
  readonly modules: string[];
  readonly rnNames: string[];
  readonly identifiers: string[];
  readonly strings: string[];
}

export function scan(source: string, fileName: string): Scan {
  const kind = fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const out: Scan = { modules: [], rnNames: [], identifiers: [], strings: [] };
  const visit = (n: ts.Node) => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      const spec = n.moduleSpecifier.text;
      out.modules.push(spec);
      const bindings = ts.isImportDeclaration(n) ? n.importClause?.namedBindings : n.exportClause;
      if (spec === 'react-native' && bindings && (ts.isNamedImports(bindings) || ts.isNamedExports(bindings))) {
        for (const e of bindings.elements) out.rnNames.push((e.propertyName ?? e.name).text);
      }
    }
    if (ts.isCallExpression(n) && n.arguments.length > 0 && ts.isStringLiteral(n.arguments[0])) {
      const callee = n.expression;
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
      const isImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isMock = ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'jest';
      if (isRequire || isImport || isMock) out.modules.push(n.arguments[0].text);
    }
    if (ts.isIdentifier(n)) out.identifiers.push(n.text);
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.strings.push(n.text);
    ts.forEachChild(n, visit);
  };
  visit(file);
  return out;
}

/** Every file the entries reach by relative imports, each with its scan. A specifier that names no file is an Error. */
export function closure(root: string, ...entries: string[]): Map<string, Scan> {
  const seen = new Map<string, Scan>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    const s = scan(fs.readFileSync(file, 'utf8'), file);
    seen.set(file, s);
    for (const spec of s.modules) {
      if (!spec.startsWith('.')) continue;
      const target = path.resolve(path.dirname(file), spec);
      if (!fs.existsSync(target)) throw new Error(`${path.relative(root, file)} names ${spec}, which does not exist`);
      queue.push(target);
    }
  }
  return seen;
}

export interface Bans {
  readonly modules: readonly RegExp[];
  readonly rnNames: ReadonlySet<string>;
  readonly identifiers: ReadonlySet<string>;
}

export function offences(s: Scan, bans: Bans): string[] {
  return [
    ...s.modules.filter((m) => bans.modules.some((re) => re.test(m))).map((m) => `module ${m}`),
    ...s.rnNames.filter((n) => bans.rnNames.has(n)).map((n) => `react-native ${n}`),
    ...s.identifiers.filter((n) => bans.identifiers.has(n)).map((n) => `identifier ${n}`),
  ];
}

export const relTo = (root: string) => (file: string) => path.relative(root, file).split(path.sep).join('/');
