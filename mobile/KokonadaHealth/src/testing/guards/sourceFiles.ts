/// <reference types="node" />
// Shared reading for the static guards under src/testing/guards: walk a tree of JS/TS sources and
// read what each file names, through the TypeScript parser rather than a regex, so a string that
// merely looks like an import (a planted source inside a test, a comment) is never mistaken for one.

import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';

const SKIP_DIRS = new Set(['node_modules', '.git', 'build', 'android', 'ios', 'Pods', '.gradle', '.bundle']);
const SOURCE = /\.(ts|tsx|js|jsx)$/;

/** Every .ts/.tsx/.js/.jsx file under `dir`. Symbolic links and junctions are not followed. */
export function walkSources(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walkSources(full, out);
    } else if (entry.isFile() && SOURCE.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** jest's default test match: a file under __tests__/, or named *.test.* / *.spec.*. */
export function isTestFile(file: string): boolean {
  return /[\\/]__tests__[\\/]/.test(file) || /\.(test|spec)\.[jt]sx?$/.test(file);
}

export function parseSource(source: string, fileName: string): ts.SourceFile {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX
    : fileName.endsWith('.jsx') ? ts.ScriptKind.JSX
      : /\.[cm]?js$/.test(fileName) ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
}

const JEST_MODULE_CALLS = new Set(['mock', 'doMock', 'unmock', 'requireActual', 'requireMock', 'createMockFromModule']);

/**
 * Every module a source names, in order: import/export … from, a bare import, `import x = require()`,
 * require(), dynamic import(), and jest.mock and its kin (a mocked module is still a dependency).
 */
export function moduleSpecifiers(source: string, fileName: string): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      out.push(node.moduleSpecifier.text);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
      && ts.isStringLiteral(node.moduleReference.expression)) {
      out.push(node.moduleReference.expression.text);
    } else if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0])) {
      const callee = node.expression;
      const named = (ts.isIdentifier(callee) && callee.text === 'require')
        || callee.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'jest'
          && JEST_MODULE_CALLS.has(callee.name.text));
      if (named) out.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(parseSource(source, fileName));
  return out;
}

export const readSource = (file: string): string => fs.readFileSync(file, 'utf8');
