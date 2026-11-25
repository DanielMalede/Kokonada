/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';
import * as law from '../../../field/fieldLaw.ts';
import * as bead from '../../Bead/beadModel.ts';

// F3 (the architect's F10 G8 findings): DEC-174's machine is pure. It runs in node-only tests and beside the field's
// worklets, so nothing it reaches may load React Native or a native library, and it takes nothing from the bead's view
// family (Bead/): its tint's hex comes from the field law (srgbHex, beside encodeSrgb8), its nodes from the field
// (nodeAt) and its placements from the ledger (LivePlacement, admittedLive). This walks ctaState.ts's import closure
// through the TypeScript syntax tree, type-only imports included (a coupling is a coupling). The planted sources below
// must fail, or the guard is blind.

const V2 = path.resolve(__dirname, '../../..');
const ENTRY = path.resolve(__dirname, '../ctaState.ts');

/** React Native itself, its subpaths, and every react-native-* library (Reanimated, Skia, …). */
const NATIVE = /(^|\/)react-native([-/]|$)/;

/** Every module `source` names: import and export declarations, require, dynamic import and jest.mock. */
function specifiers(source: string, fileName: string): string[] {
  const kind = fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) out.push(n.moduleSpecifier.text);
    if (ts.isCallExpression(n) && n.arguments.length > 0 && ts.isStringLiteral(n.arguments[0])) {
      const callee = n.expression;
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
      const isImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isMock = ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'jest';
      if (isRequire || isImport || isMock) out.push(n.arguments[0].text);
    }
    ts.forEachChild(n, visit);
  };
  visit(file);
  return out;
}

/** The files the entry reaches by relative imports, and the packages any of them names. `read` gives a file's text. */
function closure(entry: string, read: (file: string) => string): { files: string[]; packages: string[] } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    for (const spec of specifiers(read(file), file)) {
      if (!spec.startsWith('.')) {
        packages.add(spec);
        continue;
      }
      const target = path.resolve(path.dirname(file), spec);
      if (!fs.existsSync(target)) throw new Error(`${rel(file)} names ${spec}, which does not exist`);
      queue.push(target);
    }
  }
  return { files: [...files], packages: [...packages] };
}

const rel = (file: string) => path.relative(V2, file).split(path.sep).join('/');
const readReal = (file: string) => fs.readFileSync(file, 'utf8');

function offences(c: { files: string[]; packages: string[] }): string[] {
  return [
    ...c.packages.filter((p) => NATIVE.test(p)).map((p) => `package ${p}`),
    ...c.files.map(rel).filter((f) => f.startsWith('components/Bead/')).map((f) => `file ${f}`),
  ];
}

/** The closure with ctaState.ts's own text replaced by `planted`. */
const plantedClosure = (planted: string) => closure(ENTRY, (file) => (file === ENTRY ? planted : readReal(file)));

describe('ctaState’s import closure: pure, no React Native, nothing from Bead/ (F3)', () => {
  const real = closure(ENTRY, readReal);

  it('the walk sees the real closure: the machine, the ledger, the field law and frame, the colour law and the tokens', () => {
    expect(real.files.map(rel)).toEqual(
      expect.arrayContaining([
        'components/CommitCTA/ctaState.ts',
        'field/placementLedger.ts',
        'field/fieldLaw.ts',
        'field/fieldFrame.ts',
        'field/crossfade.ts',
        'color/mixSafe.ts',
        'tokens/tokens.generated.ts',
      ]),
    );
  });

  it('no file in it names React Native or a native library, and none lives under components/Bead/', () => {
    expect(offences(real)).toEqual([]);
  });

  // Each planted source is assembled at run time, so this file never trips its own walk.
  const q = String.fromCharCode(39);
  const from = (what: string, spec: string) => 'import ' + what + ' from ' + q + spec + q + ';';
  it.each([
    ['the bead’s model, as ctaState took srgbHex and readPoint from it', from('{ readPoint, srgbHex }', '../Bead/bead' + 'Model.ts'), ['file components/Bead/beadModel.ts', 'package react-native']],
    ['React Native itself', from('{ Easing }', 'react-' + 'native'), ['package react-native']],
    ['a native library, required', 'const r = require(' + q + 'react-native-' + 'reanimated' + q + ');', ['package react-native-reanimated']],
    ['a type from the bead family', from('type { BeadLook }', '../Bead/bead' + 'Model.ts'), ['file components/Bead/beadModel.ts']],
  ])('flags a planted ctaState that reaches %s', (_label, source, expected) => {
    expect(offences(plantedClosure(source))).toEqual(expect.arrayContaining(expected));
  });

  it('does not flag what the machine may use: the field, the colour law and the tokens', () => {
    const source = [from('{ mixSafe }', '../../color/mixSafe.ts'), from('{ srgbHex }', '../../field/fieldLaw.ts'), from('{ nodeAt }', '../../field/fieldFrame.ts')].join('\n');
    expect(offences(plantedClosure(source))).toEqual([]);
  });
});

// One home each (the architect's Q1 and F3): admittedLive is the ledger's, ctaState keeps no copy; srgbHex and hexLab are
// the field law's, and the bead's model re-exports them, so the CTA and the bead paint one hex for one colour.
describe('one definition each: admittedLive in the ledger, srgbHex and hexLab in the field law', () => {
  const sources = (dir: string, out: string[] = []): string[] => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__') sources(full, out);
      } else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
  };
  /** The v2 source files that declare a module-scope function (or a constant holding one) called `name`. */
  const homes = (name: string) =>
    sources(V2)
      .filter((file) => {
        const sf = ts.createSourceFile(file, readReal(file), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
        return sf.statements.some(
          (s) =>
            (ts.isFunctionDeclaration(s) && s.name?.text === name) ||
            (ts.isVariableStatement(s) && s.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === name)),
        );
      })
      .map(rel);

  it('admittedLive is declared once, in the ledger', () => {
    expect(homes('admittedLive')).toEqual(['field/placementLedger.ts']);
  });

  it('srgbHex and hexLab are declared once, in the field law, and the bead’s model hands out the same functions', () => {
    expect(homes('srgbHex')).toEqual(['field/fieldLaw.ts']);
    expect(homes('hexLab')).toEqual(['field/fieldLaw.ts']);
    expect(bead.srgbHex).toBe(law.srgbHex);
    expect(bead.hexLab).toBe(law.hexLab);
  });
});
