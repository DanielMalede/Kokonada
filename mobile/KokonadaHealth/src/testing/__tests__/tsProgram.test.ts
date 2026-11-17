/// <reference types="node" />
import * as path from 'path';
import ts from 'typescript';
import { APP_ROOT } from '../guards/productionImports';
import { assertCompilerApi, canonical, createTsProgram, loadTsConfig, overlayParseHost, TSCONFIG } from '../guards/tsProgram';

// QA-043's loader (D8 rule 1): TypeScript runs in-process with the options parsed from the project's
// own tsconfig (its `extends` chain followed), never the API defaults, which turn strict off. Planted
// configs and sources live in memory only; nothing is written under src.

const at = (rel: string) => path.join(APP_ROOT, rel);
const PLANTED_CONFIG = at('tsconfig.planted.json');
const CONTRAST = at('src/design/contrast.ts');
const BACKDROP = at('src/testing/backdrop.ts');
const TIMEOUT = 60_000;

describe('the compiler API check', () => {
  it('accepts the real TypeScript module and returns its version', () => {
    const version = assertCompilerApi(ts);
    expect(version).toBe(ts.version);
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
    console.log(`tsProgram: TypeScript ${version}`);
  });

  it('planted: a module without createProgram fails loudly, never a silent pass', () => {
    const planted = { version: ts.version, getParsedCommandLineOfConfigFile: ts.getParsedCommandLineOfConfigFile, getPreEmitDiagnostics: ts.getPreEmitDiagnostics };
    expect(() => assertCompilerApi(planted)).toThrow(/createProgram/);
  });
});

describe('the tsconfig loader', () => {
  it('reads the real tsconfig through its extends chain: strict on, configFilePath set, the project files listed', () => {
    const parsed = loadTsConfig();
    expect(parsed.options.strict).toBe(true);
    expect(canonical(String(parsed.options.configFilePath))).toBe(canonical(TSCONFIG));
    expect(parsed.options.types).toEqual(['jest']); // the project's override over @react-native/typescript-config
    expect(parsed.options.moduleResolution).toBe(ts.ModuleResolutionKind.Bundler); // inherited from the base config
    expect(parsed.fileNames.length).toBeGreaterThan(300);
    expect(parsed.fileNames.map(canonical)).toContain(canonical(CONTRAST));
  });

  it.each([
    ['strict turned off', '{ "extends": "./tsconfig.json", "compilerOptions": { "strict": false } }', /strict/],
    ['an unknown compiler option', '{ "extends": "./tsconfig.json", "compilerOptions": { "plantedOption": true } }', /plantedOption/],
    ['an extends that does not resolve', '{ "extends": "./no-such-base.json" }', /no-such-base/],
    ['an include that matches nothing', '{ "extends": "./tsconfig.json", "include": ["no-such-dir/**/*.ts"] }', /No inputs were found/],
  ])('planted config (in memory) with %s is refused', (_name, text, message) => {
    expect(() => loadTsConfig(PLANTED_CONFIG, overlayParseHost({ [PLANTED_CONFIG]: text }))).toThrow(message);
  }, TIMEOUT);

  it('planted config (in memory) that parses cleanly with strict on but lists no files (a solution-style config) is refused', () => {
    // TypeScript accepts `files: []` without error when the config has references, so only the loader's
    // own empty-files guard stands between this config and a program over nothing.
    const text = '{ "compilerOptions": { "strict": true }, "files": [], "references": [{ "path": "./tsconfig.json" }] }';
    expect(() => loadTsConfig(PLANTED_CONFIG, overlayParseHost({ [PLANTED_CONFIG]: text }))).toThrow(/lists no files/);
  });

  it('a config file that does not exist is refused', () => {
    expect(() => loadTsConfig(at('tsconfig.absent.json'))).toThrow(/tsconfig\.absent\.json/);
  });
});

describe('the in-process program', () => {
  const parsed = loadTsConfig();
  const diagnosticsOf = (program: ts.Program, file: string) =>
    ts.getPreEmitDiagnostics(program).filter((d) => d.file && canonical(d.file.fileName) === canonical(file));

  it('an empty root set is refused (zero roots would report zero diagnostics)', () => {
    expect(() => createTsProgram([], parsed)).toThrow(/no root files/);
  });

  it('a root that does not exist is refused', () => {
    expect(() => createTsProgram([at('src/no-such-file.ts')], parsed)).toThrow(/no-such-file/);
  });

  it('sees an overlay: a planted type error in memory is reported, and the disk file is clean', () => {
    const clean = createTsProgram([CONTRAST], parsed);
    expect(diagnosticsOf(clean.program, CONTRAST)).toEqual([]);
    const text = ts.sys.readFile(CONTRAST)!;
    // The overlay key is matched on the canonical path, so a non-normalised spelling of the same file
    // works. The key must really differ from the plain path, or this proves nothing.
    // Forward slashes and a `..` segment: a separator on every OS. (A backslash is a separator only on
    // Windows; on Linux it is a filename character, so a backslash key names another file there.)
    const key = [...APP_ROOT.split(path.sep), 'src', 'design', '..', 'design', 'contrast.ts'].join('/');
    expect(key).not.toBe(CONTRAST);
    expect(canonical(key)).toBe(canonical(CONTRAST));
    const planted = createTsProgram([CONTRAST], parsed, { [key]: `${text}\nexport const planted: number = 'not a number';\n` });
    expect(diagnosticsOf(planted.program, CONTRAST).map((d) => d.code)).toEqual([2322]);
  }, TIMEOUT);

  it('an overlay entry the program never reads is refused (a planted control that plants nothing)', () => {
    expect(() => createTsProgram([CONTRAST], parsed, { [at('src/testing/never-read.ts')]: 'export {};' })).toThrow(/never-read\.ts/);
  }, TIMEOUT);

  it('shares parsed library files between programs, but never an overlaid file, and an overlay never leaks', () => {
    const text = ts.sys.readFile(CONTRAST)!;
    const a = createTsProgram([CONTRAST], parsed);
    const b = createTsProgram([CONTRAST], parsed, { [CONTRAST]: `${text}\n// overlaid\n` });
    const c = createTsProgram([CONTRAST], parsed);
    const lib = a.program.getSourceFiles().find((f) => /[\\/]typescript[\\/]lib[\\/]lib\.es5\.d\.ts$/.test(f.fileName));
    expect(lib).toBeDefined();
    expect(b.program.getSourceFile(lib!.fileName)).toBe(lib);
    expect(b.program.getSourceFile(CONTRAST)!.text).toContain('// overlaid');
    expect(b.program.getSourceFile(CONTRAST)).not.toBe(a.program.getSourceFile(CONTRAST));
    expect(c.program.getSourceFile(CONTRAST)!.text).toBe(text);
    expect(c.program.getSourceFile(CONTRAST)).toBe(a.program.getSourceFile(CONTRAST));
  }, TIMEOUT);

  it('records the import edges TypeScript resolved (backdrop.ts -> design/contrast.ts)', () => {
    const { edges } = createTsProgram([BACKDROP], parsed);
    expect([...(edges.get(canonical(BACKDROP)) ?? [])]).toContain(canonical(CONTRAST));
  }, TIMEOUT);
});
