/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';

// UI-232 (RA-43) and UI-233: two contexts carry what FieldView and FieldFallback know to the Design Lab, and the app
// never listens to either (REG-066: nothing about the field is reported anywhere in the app):
//   · FieldFallbackReport (fallbackReport.ts): why the field fell back. Named only by the lab, by its own module and by
//     FieldFallback, which hands the reason on;
//   · FieldFirstFrameReport (firstFrameReport.ts): that FieldView drew its first frame. Named only by the lab, by its
//     own module and by FieldView, which tells it.
// A comment once said so; this scan holds it. It reads the syntax tree (TypeScript's parser) of the app's three entries
// and every source under src/ outside the tests: a file names a context when an identifier is the context's name, or a
// module specifier (import, export … from, require, import()) resolves to the context's module, in any alias. Both
// modules import nothing but react, so neither reaches the lab.

const APP = path.resolve(__dirname, '../../../..');
const ROOTS = ['index.js', 'index.lab.js', 'App.tsx'];
const SOURCE = /\.(ts|tsx|js|jsx)$/;
const LAB = 'src/design/lab/';

type Context = { readonly name: string; readonly module: string; readonly file: string; readonly users: readonly string[] };
const CONTEXTS: readonly Context[] = [
  { name: 'FieldFallbackReport', module: 'fallbackReport', file: 'src/design/v2/field/fallbackReport.ts', users: ['src/design/v2/field/FieldFallback.tsx'] },
  { name: 'FieldFirstFrameReport', module: 'firstFrameReport', file: 'src/design/v2/field/firstFrameReport.ts', users: ['src/design/v2/field/FieldView.tsx'] },
];

const parse = (text: string, fileName: string) => {
  const kind = /\.tsx$/.test(fileName) ? ts.ScriptKind.TSX : /\.ts$/.test(fileName) ? ts.ScriptKind.TS : ts.ScriptKind.JSX;
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
};

/** Every module specifier in a file: import and export declarations, require(…) and import(…). */
function specifiers(file: ts.SourceFile): Array<{ text: string; node: ts.Node }> {
  const out: Array<{ text: string; node: ts.Node }> = [];
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      out.push({ text: node.moduleSpecifier.text, node });
    }
    if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0])
      && ((ts.isIdentifier(node.expression) && node.expression.text === 'require') || node.expression.kind === ts.SyntaxKind.ImportKeyword)) {
      out.push({ text: node.arguments[0].text, node });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}

const moduleName = (spec: string) => spec.split('/').pop()!.replace(/\.(ts|tsx|js|jsx)$/, '');

/** Where one source file names the context, as `<what> at line <n>`. */
function namesOf(text: string, fileName: string, ctx: Context): string[] {
  const file = parse(text, fileName);
  const at = (node: ts.Node) => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
  const hits: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === ctx.name) hits.push(`${ctx.name} at line ${at(node)}`);
    ts.forEachChild(node, visit);
  };
  visit(file);
  for (const s of specifiers(file)) if (moduleName(s.text) === ctx.module) hits.push(`'${s.text}' at line ${at(s.node)}`);
  return hits;
}

function appSources(): string[] {
  const out = ROOTS.map((r) => path.join(APP, r));
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__' && entry.name !== 'node_modules') walk(full);
      } else if (entry.isFile() && SOURCE.test(entry.name) && !/\.test\.[jt]sx?$/.test(entry.name)) {
        out.push(full);
      }
    }
  };
  walk(path.join(APP, 'src'));
  return out;
}
const rel = (f: string) => path.relative(APP, f).split(path.sep).join('/');

describe('the lab-only field contexts: the app never listens (REG-066; UI-232, UI-233)', () => {
  const files = appSources();

  it('the scan sees the real tree: the three entries and every source under src, no test', () => {
    const names = files.map(rel);
    expect(names).toEqual(expect.arrayContaining([...ROOTS, ...CONTEXTS.flatMap((c) => [c.file, ...c.users]), 'src/design/lab/scenes/FieldScene.tsx']));
    expect(names.some((n) => n.includes('__tests__') || /\.test\./.test(n))).toBe(false);
    expect(files.length).toBeGreaterThan(200);
  });

  it('the pattern bites: a use, an alias, a require, a re-export and a dynamic import; a comment or a plain string does not', () => {
    const [fallback, first] = CONTEXTS;
    const bites: Array<[string, string, Context]> = [
      ["import { FieldFallbackReport } from '../v2/field/fallbackReport';", 'a.tsx', fallback],
      ["import { FieldFallbackReport as Quiet } from './fallbackReport.ts';", 'b.tsx', fallback],
      ["const reports = require('../field/fallbackReport');", 'c.js', fallback],
      ["export * from './design/v2/field/fallbackReport';", 'd.ts', fallback],
      ["const m = import('./fallbackReport');", 'e.ts', fallback],
      ['const listen = React.useContext(ctx.FieldFallbackReport);', 'f.tsx', fallback],
      ["import { FieldFirstFrameReport } from '../v2/field/firstFrameReport';", 'g.tsx', first],
      ["export { FieldFirstFrameReport as Told } from './firstFrameReport.ts';", 'h.ts', first],
      ['const x = <FieldFirstFrameReport.Provider value={f}><App /></FieldFirstFrameReport.Provider>;', 'i.tsx', first],
    ];
    for (const [text, name, ctx] of bites) expect([name, namesOf(text, name, ctx).length > 0]).toEqual([name, true]);
    const quiet: Array<[string, string, Context]> = [
      ["// FieldFallbackReport and fallbackReport.ts are the lab's.\nconst why = 'FieldFallbackReport';", 'j.ts', fallback],
      ["import { fallbackPlan } from './fallbackModel';\nconst s = 'firstFrameReport';", 'k.ts', first],
      ["import { FieldFallbackReport } from './fallbackReport';", 'l.ts', first],
    ];
    for (const [text, name, ctx] of quiet) expect([name, namesOf(text, name, ctx)]).toEqual([name, []]);
  });

  it.each(CONTEXTS.map((c) => [c.name, c] as const))('%s: named only under src/design/lab/, by its own module and by the file that tells it', (_, ctx) => {
    const named = files.filter((f) => namesOf(fs.readFileSync(f, 'utf8'), f, ctx).length > 0).map(rel);
    const outside = named.filter((n) => !n.startsWith(LAB) && n !== ctx.file && !ctx.users.includes(n));
    expect(outside).toEqual([]);
    // The control: the real users are seen, so an empty list above is not a blind scan.
    expect(named).toEqual(expect.arrayContaining([ctx.file, ...ctx.users, 'src/design/lab/scenes/FieldScene.tsx']));
  });

  it.each(CONTEXTS.map((c) => [c.file, c] as const))('%s imports nothing but react: it never reaches the lab', (_, ctx) => {
    const file = parse(fs.readFileSync(path.join(APP, ctx.file), 'utf8'), ctx.file);
    expect(specifiers(file).map((s) => s.text)).toEqual(['react']);
  });
});
