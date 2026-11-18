/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';

// v2 starts clean (plan §1, F-4): nothing under src/design/v2 may import v1 code, or anything
// else in the app outside v2. Packages are fine; a relative path that climbs out of v2 is not.

const V2 = path.resolve(__dirname, '..');

// Every way a module names another: import/export … from, bare import, require, dynamic import,
// and jest.mock (a mocked v1 module is still a dependency on v1).
const SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|\bjest\.(?:mock|requireActual|doMock)\s*\(\s*)(['"])([^'"\n]+)\1/g;

function moduleSpecifiers(source: string): string[] {
  return Array.from(source.matchAll(SPECIFIER), (m) => m[2]);
}

/** The relative specifiers in `source` (a file at `file`) that resolve outside `root`. */
function importsLeavingV2(source: string, file: string, root: string): string[] {
  return moduleSpecifiers(source).filter((spec) => {
    if (!spec.startsWith('.')) {
      return false;
    }
    const target = path.relative(root, path.resolve(path.dirname(file), spec));
    return target.startsWith('..') || path.isAbsolute(target);
  });
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      sourceFiles(full, out);
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const FILES = sourceFiles(V2);
const rel = (file: string) => path.relative(V2, file).split(path.sep).join('/');

// The one exception, by file and specifier: the close-out's fixture directions are built by the real
// token generator and schema (scripts/tokens/lib), test-only, from inside __tests__/__fixtures__.
const ALLOWED_LEAVING: Record<string, readonly string[]> = {
  '__tests__/__fixtures__/fixtureTokens.ts': ['../../../../../scripts/tokens/lib/emit.mjs', '../../../../../scripts/tokens/lib/schema.mjs'],
};
const isAllowed = (file: string, spec: string) => (ALLOWED_LEAVING[rel(file)] ?? []).includes(spec);

/** The specifiers in `source` that name a __fixtures__ folder. */
const fixtureImports = (source: string) => moduleSpecifiers(source).filter((spec) => spec.split('/').includes('__fixtures__'));
const underTests = (file: string) => rel(file).split('/').includes('__tests__');

describe('src/design/v2 imports nothing from outside v2', () => {
  it('the scan sees the real tree (a walk that finds nothing must fail, not pass)', () => {
    const seen = FILES.map(rel);
    expect(seen).toEqual(expect.arrayContaining(['color/oklab.ts', 'color/blendSpace.ts', '__tests__/isolation.test.ts']));
    const specifiers = FILES.flatMap((f) => moduleSpecifiers(fs.readFileSync(f, 'utf8')));
    expect(specifiers).toEqual(expect.arrayContaining(['./oklab.ts', '../redBand.ts']));
  });

  it('every relative import resolves inside src/design/v2', () => {
    const leaving = FILES.flatMap((file) =>
      importsLeavingV2(fs.readFileSync(file, 'utf8'), file, V2)
        .filter((spec) => !isAllowed(file, spec))
        .map((spec) => `${rel(file)} -> ${spec}`),
    );
    expect(leaving).toEqual([]);
  });

  it('the exception is exactly the fixture builder’s two generator imports, both still there, and no other file', () => {
    for (const [file, specs] of Object.entries(ALLOWED_LEAVING)) {
      expect(importsLeavingV2(fs.readFileSync(path.join(V2, file), 'utf8'), path.join(V2, file), V2)).toEqual(specs);
    }
    expect(isAllowed(path.join(V2, 'field', 'fieldFrame.ts'), '../../../../../scripts/tokens/lib/emit.mjs')).toBe(false);
  });

  it('nothing outside a __tests__ folder imports the test-only __fixtures__ folder', () => {
    expect(FILES.filter((f) => !underTests(f) && fixtureImports(fs.readFileSync(f, 'utf8')).length > 0).map(rel)).toEqual([]);
    expect(FILES.filter((f) => underTests(f) && fixtureImports(fs.readFileSync(f, 'utf8')).length > 0).map(rel)).toContain('__tests__/fixtureDirections.test.ts');
    const q = String.fromCharCode(39);
    expect(fixtureImports('import { a } from ' + q + '../__tests__/__fixtures__/fixtureTokens.ts' + q + ';')).toEqual(['../__tests__/__fixtures__/fixtureTokens.ts']);
    expect(fixtureImports('jest.mock(' + q + '../a.ts' + q + ', () => require(' + q + '../../__tests__/__fixtures__/fixtureTokens.ts' + q + '));')).toEqual(['../../__tests__/__fixtures__/fixtureTokens.ts']);
    expect(fixtureImports('import { b } from ' + q + './fixtures.ts' + q + ';')).toEqual([]);
  });

  // Planted: the same scanner on source text that reaches back into v1. Each source is assembled
  // at run time, not written out, so this file never matches its own scan.
  it.each([
    ['import { colors } from ', '../../tokens', ';'],
    ['import { contrastRatio } from ', '../../contrast', ';'],
    ['export { theme } from ', '../../theme', ';'],
    ['const t = require(', '../../emotionAccent', ');'],
    ['jest.mock(', '../../../experience/aura/auraBreath', ');'],
    ['const lazy = import(', '../../system/EmptyState', ');'],
    ['import ', '../../../legal/legalCopy', ';'],
  ])('flags a planted import that climbs out of v2: %s%s', (before, spec, after) => {
    const quote = String.fromCharCode(39);
    const source = before + quote + spec + quote + after;
    expect(importsLeavingV2(source, path.join(V2, 'color', 'planted.ts'), V2)).toEqual([spec]);
  });

  // v2 and the lab start at zero design-system violations, so the ratchet's baseline must never
  // hold a key for them: one there would let a violation in v2 be recorded as accepted debt.
  it('the design-system baseline holds no key under src/design/v2/ or src/design/lab/', () => {
    const baseline = JSON.parse(fs.readFileSync(path.resolve(V2, '../../../scripts/lint/design-system-baseline.json'), 'utf8'));
    const keys = Object.keys(baseline.files);
    expect(keys.length).toBeGreaterThan(0);
    const exempt = (k: string) => k.startsWith('src/design/v2/') || k.startsWith('src/design/lab/');
    expect(keys.filter(exempt)).toEqual([]);
    expect([...keys, 'src/design/v2/color/planted.ts'].filter(exempt)).toEqual(['src/design/v2/color/planted.ts']);
  });

  it('does not flag a package or a path that stays inside v2', () => {
    const source = "import React from 'react';\nimport { a } from './oklab.ts';\nimport { b } from '../motion/ports.ts';";
    expect(importsLeavingV2(source, path.join(V2, 'color', 'x.ts'), V2)).toEqual([]);
  });
});

// One spelling for a relative import (architect round 1, a nit made a rule): it names its file,
// `./oklab.ts`, never `./oklab`, as the rest of v2 writes it.
function extensionlessImports(source: string, fileName: string): string[] {
  const kind = fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const out: string[] = [];
  for (const statement of file.statements) {
    if (!(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))) continue;
    const spec = statement.moduleSpecifier;
    if (spec && ts.isStringLiteral(spec) && spec.text.startsWith('.') && !/\.(tsx?|json|[mc]?js)$/.test(spec.text)) out.push(spec.text);
  }
  return out;
}

describe('every relative import in src/design/v2 names its file', () => {
  it('no import or re-export leaves out the extension', () => {
    const offenders = FILES.filter((f) => /\.tsx?$/.test(f)).flatMap((f) => extensionlessImports(fs.readFileSync(f, 'utf8'), f).map((spec) => `${rel(f)} -> ${spec}`));
    expect(offenders).toEqual([]);
  });

  it('bites on planted sources, and passes a package, a named file and a type-only import that names its file', () => {
    const planted = "import { a } from './oklab';\nexport { b } from '../motion/ports';\nimport React from 'react';\nimport { c } from './mixSafe.ts';\nimport type { D } from './redBand.ts';\n";
    expect(extensionlessImports(planted, path.join(V2, 'color', 'planted.ts'))).toEqual(['./oklab', '../motion/ports']);
  });
});
