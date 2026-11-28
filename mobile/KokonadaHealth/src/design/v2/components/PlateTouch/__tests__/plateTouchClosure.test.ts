/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';

// RA-39 and RA-40 (QA-172, QA-156): the plate's taps never leave the page. PlateTouch takes callbacks only, so
// nothing it reaches may write the cold lane, open a socket, persist, prompt for a permission or reach a native
// module behind React Native's back. An import list cannot see that (RA-40: `{ View }` and `{ PermissionsAndroid }`
// share one specifier, and NativeModules needs none), so this walks the TypeScript syntax tree of every file in
// PlateTouch's import closure: each module it names, each name it takes from 'react-native', and each identifier.
// The planted sources below must fail, or the guard is blind.

const V2 = path.resolve(__dirname, '../../..');
const ENTRY = path.resolve(__dirname, '../PlateTouch.tsx');
/** PlateEntry, the plate's TalkBack node (ruling 9): it opens the list through a callback, so it is held to the same rule. */
const LIST_ENTRY = path.resolve(__dirname, '../PlateEntry.tsx');

/** Modules no file in the closure may name: stores, sockets, storage, sensors, health, permissions, native haptics. */
const BANNED_MODULES: readonly RegExp[] = [
  /socket\.io/,
  /react-native-mmkv/,
  /react-native-keychain/,
  /async-storage/,
  /react-native-ble-plx/,
  /react-native-health-connect/,
  /react-native-haptic-feedback/,
  /react-redux|@reduxjs|zustand/,
  /(^|\/)(state|net|storage|health|auth|app)(\/|$)/,
  /socketClient|emotionSlice|laneCommit|secureStore/,
];
/** Names no file may take from 'react-native': the permission prompt, raw native modules, the vibrator, deep links. */
const BANNED_RN_NAMES = new Set(['PermissionsAndroid', 'NativeModules', 'TurboModuleRegistry', 'Vibration', 'Linking']);
/** Identifiers no file may hold: the native back doors and the permission requests (RA-40). */
const BANNED_IDENTIFIERS = new Set(['NativeModules', 'TurboModuleRegistry', 'PermissionsAndroid', 'request', 'requestMultiple', 'requestPermission']);

interface Scan {
  readonly modules: string[];
  readonly rnNames: string[];
  readonly identifiers: string[];
}

function scan(source: string, fileName: string): Scan {
  const kind = fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const out: Scan = { modules: [], rnNames: [], identifiers: [] };
  const visit = (n: ts.Node) => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      const spec = n.moduleSpecifier.text;
      out.modules.push(spec);
      const bindings = ts.isImportDeclaration(n) ? n.importClause?.namedBindings : undefined;
      if (spec === 'react-native' && bindings && ts.isNamedImports(bindings)) {
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
    ts.forEachChild(n, visit);
  };
  visit(file);
  return out;
}

function offences(s: Scan): string[] {
  return [
    ...s.modules.filter((m) => BANNED_MODULES.some((re) => re.test(m))).map((m) => `module ${m}`),
    ...s.rnNames.filter((n) => BANNED_RN_NAMES.has(n)).map((n) => `react-native ${n}`),
    ...s.identifiers.filter((n) => BANNED_IDENTIFIERS.has(n)).map((n) => `identifier ${n}`),
  ];
}

/** Every file PlateTouch reaches by a relative import (type-only imports included: a coupling is a coupling). */
function closure(...entries: string[]): Map<string, Scan> {
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
      if (!fs.existsSync(target)) throw new Error(`${path.relative(V2, file)} names ${spec}, which does not exist`);
      queue.push(target);
    }
  }
  return seen;
}

const rel = (file: string) => path.relative(V2, file).split(path.sep).join('/');

describe('PlateTouch’s and PlateEntry’s closure keeps the taps on the page (RA-39, RA-40, QA-172)', () => {
  const files = closure(ENTRY, LIST_ENTRY);

  it('the walk sees the real closure: the component, its model, the plate geometry, the tokens and the field it reads', () => {
    expect([...files.keys()].map(rel)).toEqual(
      expect.arrayContaining([
        'components/PlateTouch/PlateTouch.tsx',
        'components/PlateTouch/PlateEntry.tsx',
        'components/PlateTouch/plateTouchModel.ts',
        'components/Plate/geometry.ts',
        'tokens/useTokens.ts',
        'tokens/tokens.generated.ts',
      ]),
    );
    const all = [...files.values()];
    expect(all.flatMap((s) => s.rnNames)).toEqual(expect.arrayContaining(['View', 'StyleSheet']));
    expect(all.flatMap((s) => s.identifiers).length).toBeGreaterThan(500);
  });

  it('no file in it names a store, socket, storage, sensor, health, permission or native-haptic module, or a native back door', () => {
    const found = [...files.entries()].flatMap(([file, s]) => offences(s).map((o) => `${rel(file)}: ${o}`));
    expect(found).toEqual([]);
  });

  // Each planted source is assembled at run time, so this file never trips its own walk.
  const q = String.fromCharCode(39);
  const from = (what: string, spec: string) => 'import ' + what + ' from ' + q + spec + q + ';';
  it.each([
    ['the permission prompt', from('{ PermissionsAndroid }', 'react-native'), 'react-native PermissionsAndroid'],
    ['a raw native module, with no specifier of its own', from('{ View }', 'react-native') + '\nconst m = NativeModules' + '.Haptics;', 'identifier NativeModules'],
    ['the vibrator', from('{ Vibration }', 'react-native'), 'react-native Vibration'],
    ['the socket', from('{ io }', 'socket.io' + '-client'), 'module socket.io-client'],
    ['the cold lane', from('{ addTap }', '../../../../state/cold/emotion' + 'Slice'), 'module ../../../../state/cold/emotionSlice'],
    ['storage, required', 'const s = require(' + q + 'react-native-' + 'mmkv' + q + ');', 'module react-native-mmkv'],
    ['a permission request, by name', 'export const ask = () => request' + 'Permission([]);', 'identifier requestPermission'],
  ])('flags a planted file that reaches %s', (_label, source, offence) => {
    expect(offences(scan(source, path.join(V2, 'components', 'PlateTouch', 'planted.ts')))).toContain(offence);
  });

  it('does not flag what the plate may use: views, styles, accessibility types, the frame clock', () => {
    const source = from('{ StyleSheet, View, type AccessibilityActionEvent }', 'react-native') + '\nrequestAnimationFrame(() => undefined);';
    expect(offences(scan(source, path.join(V2, 'components', 'PlateTouch', 'planted.ts')))).toEqual([]);
  });
});
