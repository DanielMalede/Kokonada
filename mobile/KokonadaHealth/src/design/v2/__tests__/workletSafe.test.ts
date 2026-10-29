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
  'field/placementLedger.ts',
  'clock/frameDt.ts',
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

/** The names a module imports by value from relative modules, each with its specifier (type-only imports skipped). */
function valueImports(source: string, fileName: string): Array<{ spec: string; name: string }> {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: Array<{ spec: string; name: string }> = [];
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const spec = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (!spec.startsWith('.') || clause === undefined || clause.isTypeOnly) continue;
    if (clause.name) out.push({ spec, name: 'default' });
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) out.push({ spec, name: '*' });
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) if (!element.isTypeOnly) out.push({ spec, name: (element.propertyName ?? element.name).text });
    }
  }
  return out;
}

/** Where a module re-exports a name from another module (`export { name } from './x'`), that module's specifier. */
function reExportOf(source: string, fileName: string, name: string): string | null {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const statement of file.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = statement.exportClause;
    if (clause && ts.isNamedExports(clause) && clause.elements.some((e) => e.name.text === name)) {
      const element = clause.elements.find((e) => e.name.text === name)!;
      return element.propertyName ? null : statement.moduleSpecifier.text;
    }
  }
  return null;
}

/**
 * The functions `importer` imports by value from relative modules that are not worklets in their own
 * source, followed through re-exports; constants and types are not functions and pass. `read` returns
 * a file's text, or null where there is no such file.
 */
function plainImportedFunctions(importer: string, source: string, read: (file: string) => string | null): string[] {
  const resolve = (from: string, spec: string) => {
    const base = path.resolve(path.dirname(from), spec);
    return [base, `${base}.ts`, `${base}.tsx`].find((f) => /\.tsx?$/.test(f) && read(f) !== null);
  };
  const offenders: string[] = [];
  for (const { spec, name } of valueImports(source, importer)) {
    let target = resolve(importer, spec);
    for (let hops = 0; target !== undefined && hops < 4; hops++) {
      const text = read(target)!;
      const functions = moduleFunctions(text, target);
      if (name === '*') {
        offenders.push(...functions.filter((f) => !f.worklet).map((f) => `${f.name} from ${spec}`));
        break;
      }
      const found = functions.find((f) => f.name === name);
      if (found) {
        if (!found.worklet) offenders.push(`${name} from ${spec}`);
        break;
      }
      const next = reExportOf(text, target, name);
      target = next === null ? undefined : resolve(target, next);
    }
    if (resolve(importer, spec) === undefined) offenders.push(`${name} from ${spec}: no such module`);
  }
  return offenders;
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

  // A worklet that calls a plain function from another module throws on the UI thread just the same,
  // and the list above cannot see it (fieldLaw.ts also holds the Node-side law, so it can never join).
  // So every function a listed module imports by value from another v2 module is a worklet in its own
  // source (architect round 1 G-a, resilience round 1 F11).
  const readIfExists = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);

  it.each(FUTURE_WORKLET_MODULES)('%s: every function it imports by value from another v2 module is a worklet', (file) => {
    const full = path.join(V2, file);
    expect(plainImportedFunctions(full, fs.readFileSync(full, 'utf8'), readIfExists)).toEqual([]);
  });

  it('the import rule bites on planted sources, follows a re-export, and passes constants and types', () => {
    const at = (name: string) => path.join(V2, 'planted', name);
    const planted: Record<string, string> = {
      [at('importer.ts')]: "import { plain, works, LIMIT } from './lib.ts';\nimport type { Shape } from './lib.ts';\nimport { again } from './barrel';\n",
      [at('lib.ts')]: "export const LIMIT = 3;\nexport function plain() { return 1; }\nexport const works = () => { 'worklet'; return 2; };\nexport type Shape = number;\n",
      [at('barrel.ts')]: "export { again } from './deep.ts';\n",
      [at('deep.ts')]: 'export function again() { return 3; }\n',
    };
    const read = (f: string) => planted[f] ?? null;
    expect(plainImportedFunctions(at('importer.ts'), planted[at('importer.ts')], read)).toEqual(['plain from ./lib.ts', 'again from ./barrel']);
    // The real ledger: its import of clampFrameDt is checked in clock/frameDt.ts, where it is a worklet.
    const ledger = path.join(V2, 'field/placementLedger.ts');
    expect(valueImports(fs.readFileSync(ledger, 'utf8'), ledger).map((i) => i.name)).toEqual(expect.arrayContaining(['clampFrameDt', 'nodeAt', 'crossfade', 'progress']));
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
