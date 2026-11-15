/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';

// UI-217 (RA-33): FieldFallback frees each picture in its effect's cleanup once it is replaced or unmounted (RA-31). That
// is safe only while no root mounts it under React's StrictMode, which runs every effect's cleanup once on mount while the
// memoised picture is still shown, or inside a hidden <Activity> (React Native wraps the root in one only when the app
// registers with useOffscreen), whose cleanups run while the tree is kept. The app uses neither today; this scan fails the
// day one appears in the app's entry, the lab's entry, App.tsx or anywhere under src/ (tests excluded).
//
// It reads the syntax tree (TypeScript's parser), never the text: a comment or a string that names StrictMode is not a
// use, and the Context Suite's own `Activity` type (src/experience/generate/activities.ts) is not React's.

const APP = path.resolve(__dirname, '../../../../..');
const ROOTS = ['index.js', 'index.lab.js', 'App.tsx'];
const SOURCE = /\.(ts|tsx|js|jsx)$/;
const KEEP_ALIVE = new Set(['StrictMode', 'unstable_Activity', 'useOffscreen', 'unstable_Offscreen', 'Offscreen']);

/** Every use of StrictMode, Activity or the offscreen option in one source file, as `<what> at line <n>`. */
function keepAliveUses(text: string, fileName: string): string[] {
  const kind = /\.tsx$/.test(fileName) ? ts.ScriptKind.TSX : /\.ts$/.test(fileName) ? ts.ScriptKind.TS : ts.ScriptKind.JSX;
  const file = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  const hits: string[] = [];
  const at = (node: ts.Node) => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
  const tagIsActivity = (tag: ts.JsxTagNameExpression) => {
    const name = tag.getText(file);
    return name === 'Activity' || name.endsWith('.Activity');
  };
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && KEEP_ALIVE.has(node.text)) hits.push(`${node.text} at line ${at(node)}`);
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && tagIsActivity(node.tagName)) hits.push(`<${node.tagName.getText(file)}> at line ${at(node)}`);
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'Activity' && node.expression.getText(file) === 'React') hits.push(`React.Activity at line ${at(node)}`);
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === 'react') {
      const named = node.importClause?.namedBindings;
      if (named && ts.isNamedImports(named)) {
        for (const spec of named.elements) if ((spec.propertyName ?? spec.name).text === 'Activity') hits.push(`Activity imported from react at line ${at(spec)}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return hits;
}

/** The app's source files: the roots, and every source under src/ outside the tests. */
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

describe('UI-217: no root mounts the fallback under StrictMode or a hidden <Activity>', () => {
  const files = appSources();
  const rel = (f: string) => path.relative(APP, f).split(path.sep).join('/');

  it('the scan sees the real tree: the three entries, FieldFallback and FieldView, and every source under src', () => {
    for (const root of ROOTS) expect(fs.existsSync(path.join(APP, root))).toBe(true);
    const names = files.map(rel);
    expect(names).toEqual(expect.arrayContaining([
      'index.js', 'index.lab.js', 'App.tsx',
      'src/design/v2/field/FieldFallback.tsx', 'src/design/v2/field/FieldView.tsx', 'src/design/lab/LabRoot.tsx',
    ]));
    expect(names.some((n) => n.includes('__tests__') || /\.test\./.test(n))).toBe(false);
    expect(files.length).toBeGreaterThan(200);
    // The parser reads the real files' JSX: FieldFallback is mounted by FieldView and by the lab's fallback scene.
    const mounts = files.filter((f) => {
      const src = ts.createSourceFile(f, fs.readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true, f.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      let found = false;
      const visit = (n: ts.Node) => {
        if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && n.tagName.getText(src) === 'FieldFallback') found = true;
        ts.forEachChild(n, visit);
      };
      visit(src);
      return found;
    }).map(rel);
    expect(mounts).toEqual(expect.arrayContaining(['src/design/v2/field/FieldView.tsx', 'src/design/lab/scenes/FallbackScene.tsx']));
  });

  it('the pattern bites: each form is found, and ActivityIndicator, the domain Activity type and a comment are not', () => {
    const bites: Array<[string, string]> = [
      ['<React.StrictMode><App /></React.StrictMode>', 'a.tsx'],
      ["import { StrictMode } from 'react';\nconst x = <StrictMode><App /></StrictMode>;", 'b.tsx'],
      ["import { Activity } from 'react';", 'c.tsx'],
      ['const x = <Activity mode="hidden"><App /></Activity>;', 'd.tsx'],
      ["import { unstable_Activity as Keep } from 'react';", 'e.tsx'],
      ['const x = React.Activity;', 'f.ts'],
      ["AppRegistry.registerComponent('k', () => App, { useOffscreen: true });", 'g.js'],
      // RA-45: the option named by a string literal or a computed key, or hidden in an options object the scan cannot read.
      ["AppRegistry.registerComponent('k', () => App, { 'useOffscreen': true });", 'g2.js'],
      ["AppRegistry.registerComponent('k', () => App, { ['useOffscreen']: true });", 'g3.js'],
      ["options['useOffscreen'] = true;", 'g4.js'],
      ["import { keepAlive } from './opts';\nAppRegistry.registerComponent('k', () => App, { ...keepAlive });", 'g5.js'],
      ["import { keepAlive } from './opts';\nAppRegistry.registerComponent('k', () => App, keepAlive);", 'g6.js'],
      ['AppRegistry.registerComponent(...registration);', 'g7.js'],
    ];
    for (const [text, name] of bites) expect([name, keepAliveUses(text, name).length > 0]).toEqual([name, true]);
    const quiet: Array<[string, string]> = [
      ["import { ActivityIndicator } from 'react-native';\nconst x = <ActivityIndicator />;", 'h.tsx'],
      ["import type { Activity } from './activities';\nconst list: Activity[] = [];\nconst [a] = useState<Activity | null>(null);", 'i.tsx'],
      ['export interface Activity { key: string }', 'j.ts'],
      ["// StrictMode would run each cleanup twice; <Activity> too.\nconst s = 'useOffscreen';", 'k.ts'],
      ["AppRegistry.registerComponent('k', () => App);\nconst o = { offscreen: 'useOffscreen' };", 'l.js'],
    ];
    for (const [text, name] of quiet) expect([name, keepAliveUses(text, name)]).toEqual([name, []]);
  });

  // RA-45: the three entries are where an app registers, so there the option is refused in any spelling, even in a
  // comment or a string built from parts: their text never names an offscreen anything.
  const OFFSCREEN = /off[^a-z0-9]{0,8}screen/i;
  it('the entries name no offscreen option in any spelling, and the two that register pass exactly two arguments', () => {
    for (const spelling of ['useOffscreen', 'useOffScreen', 'unstable_Offscreen', 'use_off_screen', "'use' + 'Off' + 'screen'"]) {
      expect([spelling, OFFSCREEN.test(spelling)]).toEqual([spelling, true]);
    }
    for (const root of ROOTS) {
      const text = fs.readFileSync(path.join(APP, root), 'utf8');
      expect([root, OFFSCREEN.exec(text)?.[0] ?? null]).toEqual([root, null]);
    }
    const registrations = ['index.js', 'index.lab.js'].map((r) => {
      const file = ts.createSourceFile(r, fs.readFileSync(path.join(APP, r), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
      const calls: number[] = [];
      const visit = (n: ts.Node) => {
        if (ts.isCallExpression(n) && n.expression.getText(file).endsWith('registerComponent')) calls.push(n.arguments.length);
        ts.forEachChild(n, visit);
      };
      visit(file);
      return [r, calls];
    });
    expect(registrations).toEqual([['index.js', [2]], ['index.lab.js', [2]]]);
  });

  it('nothing in the app or the lab uses StrictMode, Activity or the offscreen option', () => {
    const uses = files.flatMap((f) => keepAliveUses(fs.readFileSync(f, 'utf8'), f).map((u) => `${rel(f)}: ${u}`));
    expect(uses).toEqual([]);
  });
});
