/// <reference types="node" />
// QA-043's loader (Stage 0 Q2, D8 rule 1). TypeScript has an in-process API, so the type checks use it
// and spawn nothing: no missing binary, no empty-output false green. The compiler options are parsed
// from the project's own tsconfig.json, its `extends` chain followed, never the API defaults (which
// leave strict off). One caching host is shared by every program the process builds, so the scoped
// and full programs and their planted controls parse the library .d.ts files once. A planted control
// is an in-memory overlay (path -> text): nothing is ever written under src.

import * as path from 'path';
import ts from 'typescript';
import { APP_ROOT } from './productionImports';

export const TSCONFIG = path.join(APP_ROOT, 'tsconfig.json');

/** An in-memory replacement for files' text, keyed by path (either separator). */
export type Overlay = Readonly<Record<string, string>>;

/** A path in one form: forward slashes, case-folded where the file system ignores case. */
export function canonical(p: string): string {
  const slashed = path.resolve(p).split(path.sep).join('/');
  return ts.sys.useCaseSensitiveFileNames ? slashed : slashed.toLowerCase();
}

/** The path relative to the app root, with forward slashes. */
export const relToApp = (p: string): string => path.relative(APP_ROOT, p).split(path.sep).join('/');

type CompilerApi = Partial<Pick<typeof ts, 'createProgram' | 'getParsedCommandLineOfConfigFile' | 'getPreEmitDiagnostics'>> & { version?: string };

/** Throws unless the TypeScript module carries the API these checks use; returns its version. */
export function assertCompilerApi(api: CompilerApi): string {
  const missing = (['createProgram', 'getParsedCommandLineOfConfigFile', 'getPreEmitDiagnostics'] as const)
    .filter((name) => typeof api[name] !== 'function');
  if (missing.length > 0 || typeof api.version !== 'string') {
    throw new Error(`the TypeScript module lacks ${missing.join(', ') || 'version'}: the type checks cannot run in-process`);
  }
  return api.version;
}

const formatHost: ts.FormatDiagnosticsHost = {
  getCanonicalFileName: (f) => f,
  getCurrentDirectory: () => APP_ROOT,
  getNewLine: () => '\n',
};

/** Diagnostics as tsc prints them, paths relative to the app root. */
export const formatDiagnostics = (diagnostics: readonly ts.Diagnostic[]): string => ts.formatDiagnostics(diagnostics, formatHost);

/** A tsconfig parse host on the real file system, with `overlay` files readable in its place. */
export function overlayParseHost(overlay: Overlay = {}): ts.ParseConfigFileHost {
  const texts = new Map(Object.entries(overlay).map(([p, text]) => [canonical(p), text]));
  return {
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
    getCurrentDirectory: () => APP_ROOT,
    readDirectory: ts.sys.readDirectory,
    fileExists: (p) => texts.has(canonical(p)) || ts.sys.fileExists(p),
    readFile: (p) => texts.get(canonical(p)) ?? ts.sys.readFile(p),
    onUnRecoverableConfigFileDiagnostic: (d) => { throw new Error(`tsconfig: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`); },
  };
}

/**
 * The project's compiler options and files, from `configPath` and its `extends` chain. Refused, never
 * patched: a config that does not parse cleanly, has no configFilePath, or does not turn strict on.
 */
export function loadTsConfig(configPath: string = TSCONFIG, host: ts.ParseConfigFileHost = overlayParseHost()): ts.ParsedCommandLine {
  assertCompilerApi(ts);
  if (!host.fileExists(configPath)) throw new Error(`tsconfig not found: ${configPath}`);
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, host);
  if (!parsed) throw new Error(`tsconfig did not parse: ${configPath}`);
  if (parsed.errors.length > 0) throw new Error(`tsconfig ${configPath} has errors:\n${formatDiagnostics(parsed.errors)}`);
  if (!parsed.options.configFilePath) throw new Error(`tsconfig ${configPath}: the parsed options carry no configFilePath`);
  if (parsed.options.strict !== true) throw new Error(`tsconfig ${configPath}: strict is ${String(parsed.options.strict)}, not true`);
  if (parsed.fileNames.length === 0) throw new Error(`tsconfig ${configPath} lists no files`);
  return parsed;
}

// The shared cache: a parsed SourceFile depends only on its text and these parse settings, the same
// reuse TypeScript's own document registry makes between programs. Only files read from disk enter it.
const sourceCache = new Map<string, ts.SourceFile>();
const parseKey = (fileName: string, v: ts.ScriptTarget | ts.CreateSourceFileOptions): string => {
  const o = typeof v === 'object' ? v : { languageVersion: v };
  return `${canonical(fileName)}|${o.languageVersion}|${o.impliedNodeFormat ?? ''}|${o.jsDocParsingMode ?? ''}`;
};

export interface TsProgram {
  program: ts.Program;
  /** canonical file -> the canonical files its imports and `/// <reference path>` resolved to. */
  edges: Map<string, Set<string>>;
}

/**
 * A program over `roots` with the parsed options, every file read through the shared cache unless
 * `overlay` replaces it. Refuses an empty root set, a root that does not exist, and an overlay entry the
 * program never read (a planted control that plants nothing would pass for the wrong reason).
 */
export function createTsProgram(roots: readonly string[], parsed: ts.ParsedCommandLine, overlay: Overlay = {}): TsProgram {
  assertCompilerApi(ts);
  if (roots.length === 0) throw new Error('createTsProgram: no root files (a program over nothing reports nothing)');
  const options = parsed.options;
  const texts = new Map(Object.entries(overlay).map(([p, text]) => [canonical(p), text]));
  const missing = roots.filter((r) => !texts.has(canonical(r)) && !ts.sys.fileExists(r));
  if (missing.length > 0) throw new Error(`createTsProgram: root files not found: ${missing.map(relToApp).join(', ')}`);

  const read = new Set<string>();
  const base = ts.createCompilerHost(options, true);
  const edges = new Map<string, Set<string>>();
  const addEdge = (from: string, to: string) => {
    const key = canonical(from);
    if (!edges.has(key)) edges.set(key, new Set());
    edges.get(key)!.add(canonical(to));
  };
  const moduleHost: ts.ModuleResolutionHost = {
    fileExists: (p) => texts.has(canonical(p)) || base.fileExists(p),
    readFile: (p) => texts.get(canonical(p)) ?? base.readFile(p),
    directoryExists: base.directoryExists?.bind(base),
    realpath: base.realpath?.bind(base),
    getCurrentDirectory: () => APP_ROOT,
    getDirectories: base.getDirectories?.bind(base),
  };
  const resolutionCache = ts.createModuleResolutionCache(APP_ROOT, (f) => (ts.sys.useCaseSensitiveFileNames ? f : f.toLowerCase()), options);

  const host: ts.CompilerHost = {
    ...base,
    getCurrentDirectory: () => APP_ROOT,
    fileExists: moduleHost.fileExists,
    readFile: moduleHost.readFile,
    getSourceFile: (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
      const key = canonical(fileName);
      const planted = texts.get(key);
      if (planted !== undefined) {
        read.add(key);
        return ts.createSourceFile(fileName, planted, languageVersion, true);
      }
      const cacheKey = parseKey(fileName, languageVersion);
      const cached = shouldCreateNewSourceFile ? undefined : sourceCache.get(cacheKey);
      if (cached) return cached;
      const sf = base.getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
      if (sf) sourceCache.set(cacheKey, sf);
      return sf;
    },
    resolveModuleNameLiterals: (literals, containingFile, redirectedReference, opts, containingSourceFile) =>
      literals.map((literal) => {
        const mode = ts.getModeForUsageLocation(containingSourceFile, literal, opts);
        const r = ts.resolveModuleName(literal.text, containingFile, opts, moduleHost, resolutionCache, redirectedReference, mode);
        if (r.resolvedModule) addEdge(containingFile, r.resolvedModule.resolvedFileName);
        return r;
      }),
  };

  const program = ts.createProgram({ rootNames: [...roots], options, host, projectReferences: parsed.projectReferences });
  for (const sf of program.getSourceFiles()) {
    for (const ref of sf.referencedFiles) {
      const target = program.getSourceFile(path.resolve(path.dirname(sf.fileName), ref.fileName));
      if (target) addEdge(sf.fileName, target.fileName);
    }
  }
  const unread = [...texts.keys()].filter((k) => !read.has(k));
  if (unread.length > 0) throw new Error(`createTsProgram: overlay entries never read by the program: ${unread.join(', ')}`);
  return { program, edges };
}
