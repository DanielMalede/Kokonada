/// <reference types="node" />
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';
import { BUNDLED_FACES } from '../v2/typeface/faces.ts';

// The typeface provider's sources (F6): one Metro asset per bundled face, each the face's own file in assets/fonts. Jest
// does not load a font file (the preset transforms images only), so the module is read as Metro reads it: each key's
// require() specifier, resolved from the module's folder, and Metro's asset extensions, which must hold the fonts' own.

const APP = path.resolve(__dirname, '../../..');
const FILE = path.resolve(__dirname, '../v2FaceSources.ts');

/** Each property of V2_FACE_SOURCES with the specifier its value require()s; null where the value is no require of a string. */
function sourcesIn(source: string): Array<{ key: string; spec: string | null }> {
  const file = ts.createSourceFile(FILE, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: Array<{ key: string; spec: string | null }> = [];
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const d of statement.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || d.name.text !== 'V2_FACE_SOURCES' || !d.initializer || !ts.isObjectLiteralExpression(d.initializer)) continue;
      for (const p of d.initializer.properties) {
        if (!ts.isPropertyAssignment(p) || !(ts.isStringLiteral(p.name) || ts.isIdentifier(p.name))) continue;
        const v = p.initializer;
        const isRequire = ts.isCallExpression(v) && ts.isIdentifier(v.expression) && v.expression.text === 'require' && v.arguments.length === 1 && ts.isStringLiteral(v.arguments[0]);
        out.push({ key: p.name.text, spec: isRequire ? (v.arguments[0] as ts.StringLiteral).text : null });
      }
    }
  }
  return out;
}

describe('V2_FACE_SOURCES: each bundled face’s Metro asset', () => {
  const sources = sourcesIn(fs.readFileSync(FILE, 'utf8'));

  it('holds one source for each bundled face and no other', () => {
    expect(sources.map((s) => s.key).sort()).toEqual(BUNDLED_FACES.map((f) => f.id).sort());
  });

  it('each source requires its face’s own file in assets/fonts, a file the app holds', () => {
    for (const { key, spec } of sources) {
      expect(spec).not.toBeNull();
      const target = path.resolve(path.dirname(FILE), spec as string);
      expect([key, path.relative(APP, target).split(path.sep).join('/')]).toEqual([key, `assets/fonts/${key}.ttf`]);
      expect(fs.existsSync(target)).toBe(true);
    }
  });

  it('Metro bundles a font file as an asset, so each require is an asset id the provider can resolve', () => {
    // Read in Node itself, as Metro loads it: jest's transform does not take the config's modules.
    const script = "const c = require('./metro.config.js'); Promise.resolve(c).then((x) => process.stdout.write(JSON.stringify(x.resolver.assetExts)))";
    const assetExts = JSON.parse(execFileSync(process.execPath, ['-e', script], { cwd: APP, encoding: 'utf8' })) as string[];
    expect(assetExts).toContain('ttf');
    expect(assetExts).not.toContain('ts');
  });

  it('the reader bites: a swapped file, a missing face and a value that is no require are each seen', () => {
    const q = String.fromCharCode(39);
    const planted = `export const V2_FACE_SOURCES = { ${q}Heebo-Medium${q}: require(${q}../../assets/fonts/Heebo-Regular.ttf${q}), ${q}Bellefair-Regular${q}: 7 };`;
    expect(sourcesIn(planted)).toEqual([
      { key: 'Heebo-Medium', spec: '../../assets/fonts/Heebo-Regular.ttf' },
      { key: 'Bellefair-Regular', spec: null },
    ]);
  });
});
