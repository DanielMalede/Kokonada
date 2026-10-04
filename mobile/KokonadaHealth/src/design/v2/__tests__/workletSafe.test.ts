/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';

// A function marked 'worklet' runs on the UI thread. A module-scope binding such as
// `const { floor } = Math` or `const isFinite = Number.isFinite` is captured as a plain host
// function, and react-native-worklets then throws "Tried to synchronously call a non-worklet
// function" on the device. Jest mocks worklets, so only a static check can see this.
// Inline Math.* and Number.* are fine: the UI runtime has its own Math and Number. A constant
// such as Math.PI is copied as a number, so binding it is fine too.

const V2 = path.resolve(__dirname, '..');

/** The modules whose functions B4 marks 'worklet': held to the rule before the directive lands. */
const FUTURE_WORKLET_MODULES = ['motion/breathLaw.ts', 'motion/breathPhaser.ts', 'color/oklab.ts', 'color/mixSafe.ts'];

const DESTRUCTURED = /\b(?:const|let|var)\s*\{[^}]*\}\s*=\s*(?:Math|Number)\b/;
/** `= Math.floor` or `= Number.isFinite` with no call: an alias of a host function. */
const ALIASED = /[=]\s*(?:Math|Number)\.[a-z][A-Za-z]*\s*(?:;|,|\n)/;
const WORKLET = /(['"])worklet\1/;

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

  it.each([['const DEG = 180 / Math.PI;'], ['return Math.floor(x);'], ['if (!Number.isFinite(t)) {'], ['const e = Number.EPSILON;']])(
    'does not flag %s',
    (line) => {
      expect(hostBindings(`${line}\n`)).toEqual([]);
    },
  );
});
