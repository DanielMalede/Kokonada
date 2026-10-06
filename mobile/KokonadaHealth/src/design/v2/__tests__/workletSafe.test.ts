/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';

// A function marked 'worklet' runs on the UI thread. A module-scope binding such as
// `const { floor } = Math` or `const isFinite = Number.isFinite` is captured as a plain host
// function, and react-native-worklets then throws "Tried to synchronously call a non-worklet
// function" on the device. Jest mocks worklets, so only a static check can see this.
// Inline Math.* and Number.* are fine: the UI runtime has its own Math and Number. A constant
// such as Math.PI is copied as a number, so binding it is fine too.

const V2 = path.resolve(__dirname, '..');

/**
 * The modules whose functions B4 marks 'worklet': held to the rule before the directive lands. The
 * uniform builder and the packing join them (architect, B4 forks, adjacent finding 1): FieldView
 * derives the uniforms on the UI thread, so everything the builder calls runs there.
 */
const FUTURE_WORKLET_MODULES = [
  'motion/breathLaw.ts',
  'motion/breathPhaser.ts',
  'color/oklab.ts',
  'color/mixSafe.ts',
  'field/fieldFrame.ts',
  'field/uniforms.ts',
  'field/crossfade.ts',
];

const DESTRUCTURED = /\b(?:const|let|var)\s*\{[^}]*\}\s*=\s*(?:Math|Number)\b/;
/** `= Math.floor` or `= Number.isFinite` with no call: an alias of a host function. */
const ALIASED = /[=]\s*(?:Math|Number)\.[a-z][A-Za-z]*\s*(?:;|,|\n)/;
const WORKLET = /(['"])worklet\1/;

/** Module-scope functions (declarations, and constants holding an arrow or function expression), and whether each opens with the 'worklet' directive. */
function moduleFunctions(source: string, fileName: string): Array<{ name: string; worklet: boolean }> {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const opensWithWorklet = (body: ts.Node | undefined) =>
    body !== undefined && ts.isBlock(body) && body.statements.length > 0 && ts.isExpressionStatement(body.statements[0])
    && ts.isStringLiteral(body.statements[0].expression) && body.statements[0].expression.text === 'worklet';
  const out: Array<{ name: string; worklet: boolean }> = [];
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      out.push({ name: statement.name.text, worklet: opensWithWorklet(statement.body) });
    } else if (ts.isVariableStatement(statement)) {
      for (const d of statement.declarationList.declarations) {
        const init = d.initializer;
        if (ts.isIdentifier(d.name) && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          out.push({ name: d.name.text, worklet: opensWithWorklet(init.body) });
        }
      }
    }
  }
  return out;
}

function hostBindings(source: string): string[] {
  return source.split('\n').filter((line) => DESTRUCTURED.test(line) || ALIASED.test(`${line}\n`));
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      sourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !full.includes(`${path.sep}__tests__${path.sep}`)) {
      out.push(full);
    }
  }
  return out;
}

const rel = (file: string) => path.relative(V2, file).split(path.sep).join('/');

describe('worklet-safe maths', () => {
  it('the scan sees the real modules', () => {
    expect(sourceFiles(V2).map(rel)).toEqual(expect.arrayContaining(FUTURE_WORKLET_MODULES));
  });

  it('no file that contains a worklet binds a Math or Number function at module scope', () => {
    const offenders = sourceFiles(V2)
      .filter((file) => WORKLET.test(fs.readFileSync(file, 'utf8')))
      .flatMap((file) => hostBindings(fs.readFileSync(file, 'utf8')).map((line) => `${rel(file)}: ${line.trim()}`));
    expect(offenders).toEqual([]);
  });

  // sweepConvert binds Math for the sweeps' speed; UI-thread code must use oklab.ts instead.
  const importsSweepConvert = (source: string) => /from\s+['"][^'"]*sweepConvert(?:\.ts)?['"]/.test(source);

  it('no file that contains a worklet, and no future worklet module, imports sweepConvert', () => {
    const offenders = sourceFiles(V2)
      .filter((file) => {
        const source = fs.readFileSync(file, 'utf8');
        return (WORKLET.test(source) || FUTURE_WORKLET_MODULES.includes(rel(file))) && importsSweepConvert(source);
      })
      .map(rel);
    expect(offenders).toEqual([]);
    expect(importsSweepConvert(["import { sweepSrgbToOklab } from './sweepConvert", ".ts';"].join(''))).toBe(true);
  });

  it.each(FUTURE_WORKLET_MODULES)('%s, which will hold worklets, binds no Math or Number function', (file) => {
    expect(hostBindings(fs.readFileSync(path.join(V2, file), 'utf8'))).toEqual([]);
  });

  // The scanner on planted source text, so the rule is shown to bite.
  it.each([
    ['const { floor } = Math;'],
    ['const { abs, cos } = Math;'],
    ['const numberIsFinite = Number.isFinite;'],
    ['let f = Math.floor;'],
  ])('flags %s', (line) => {
    expect(hostBindings(`'worklet';\n${line}\n`)).toEqual([line]);
  });

  // A worklet that calls a plain JS function throws on the UI thread ("Tried to synchronously call a
  // non-worklet function"), and jest cannot see it. So in a module that holds worklets, every
  // module-scope function, a declaration or an arrow constant, is itself a worklet (resilience,
  // round 2: atWrap, assertN, clampStress, multiply, and assertClock, which advanceBreath calls).
  it.each(FUTURE_WORKLET_MODULES)('%s: every module-scope function is a worklet', (file) => {
    const functions = moduleFunctions(fs.readFileSync(path.join(V2, file), 'utf8'), file);
    expect(functions.length).toBeGreaterThan(0);
    expect(functions.filter((f) => !f.worklet).map((f) => f.name)).toEqual([]);
  });

  it('covers the helpers the review named, each a worklet', () => {
    const all = FUTURE_WORKLET_MODULES.flatMap((file) => moduleFunctions(fs.readFileSync(path.join(V2, file), 'utf8'), file));
    const named = ['atWrap', 'assertN', 'assertClock', 'clampStress', 'multiply'];
    expect(all.filter((f) => named.includes(f.name)).map((f) => [f.name, f.worklet]).sort()).toEqual(named.map((n) => [n, true]).sort());
  });

  it.each([
    ['function f(x: number) { return x; }', ['f']],
    ["function f(x: number) { 'worklet'; return x; }", []],
    ['const g = (x: number) => x + 1;', ['g']],
    ["const g = (x: number) => { 'worklet'; return x + 1; };", []],
    ['export const h = function (x: number) { return x; };', ['h']],
    ["const N = 3;\nfunction k() { const inner = () => 1; 'worklet'; return inner(); }", ['k']],
  ])('the scan flags the plain functions in %j', (source, plain) => {
    expect(moduleFunctions(source, 'planted.ts').filter((f) => !f.worklet).map((f) => f.name)).toEqual(plain);
  });

  it.each([['const DEG = 180 / Math.PI;'], ['return Math.floor(x);'], ['if (!Number.isFinite(t)) {'], ['const e = Number.EPSILON;']])(
    'does not flag %s',
    (line) => {
      expect(hostBindings(`${line}\n`)).toEqual([]);
    },
  );
});
