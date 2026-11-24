/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { CopyError, createCopyPort, type CopySpec } from '../CopyPort.ts';

// The copy port (F7; Stage 0 D2-A "copy is a port"): pages and components get every string by key,
// and each key is classed N (neutral, it ships in the batch) or R (regulated, T11: it waits on the
// held branch, F3-B). These tests drive the real port over small real catalogues; nothing is mocked.

const SPEC = {
  'shell.offline.title': { class: 'N' },
  'shell.offline.retry': { class: 'N' },
  'signIn.tagline': { class: 'R', budget: { chars: 48, lines: 2 } },
} as const satisfies CopySpec;

const EN = { 'shell.offline.title': 'You are offline', 'shell.offline.retry': 'Try again' };

const strict = () => createCopyPort({ spec: SPEC, catalogs: { en: EN }, mode: 'strict' });

/** The CopyError `fn` throws; anything else (or nothing) fails the test. */
function copyErrorOf(fn: () => unknown): CopyError {
  try {
    fn();
  } catch (error) {
    if (error instanceof CopyError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected a CopyError, and nothing was thrown');
}

describe('the copy port: an N key is text, an R key is reserved', () => {
  it('an N key resolves to its catalogue text, through resolve() and text()', () => {
    expect(strict().resolve('shell.offline.title')).toEqual({ kind: 'text', text: 'You are offline' });
    expect(strict().text('shell.offline.retry')).toBe('Try again');
  });

  it('an R key resolves to a reserved result that carries its budget and no text', () => {
    const result = strict().resolve('signIn.tagline');
    expect(result).toEqual({ kind: 'reserved', reason: 'regulated', budget: { chars: 48, lines: 2 } });
    expect(Object.keys(result).sort()).toEqual(['budget', 'kind', 'reason']);
  });

  it('an R key asked for as text is a typed failure, never text', () => {
    // @ts-expect-error text() takes N keys only, so an R key is a type error before it is a throw.
    const error = copyErrorOf(() => strict().text('signIn.tagline'));
    expect(error.code).toBe('regulated-key');
    expect(error.key).toBe('signIn.tagline');
  });

  it('a missing key is a typed failure in dev and test, through resolve() and text()', () => {
    for (const ask of [(k: string) => strict().resolve(k as never), (k: string) => strict().text(k as never)]) {
      const error = copyErrorOf(() => ask('shell.offline.body'));
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('CopyError');
      expect(error.code).toBe('missing-key');
      expect(error.key).toBe('shell.offline.body');
      expect(error.message).toContain('shell.offline.body');
    }
  });

  it('reports the locale it resolves in, which is en when none is given', () => {
    expect(strict().locale).toBe('en');
  });
});

// D2-A, fail closed: a release build never throws at a screen, and never paints '' or the raw key.
// A key with no text resolves to a reserved slot with no budget; text() gives one ellipsis, U+2026.
describe('a release build fails closed', () => {
  const release = (en: Record<string, string> = EN) => createCopyPort({ spec: SPEC, catalogs: { en }, mode: 'release' });
  const ELLIPSIS = '…';

  it('a missing key resolves to an unavailable slot, and text() to an ellipsis: never empty, never the key', () => {
    expect(release().resolve('shell.offline.body' as never)).toEqual({ kind: 'reserved', reason: 'unavailable', budget: null });
    const shown = release().text('shell.offline.body' as never);
    expect(shown).toBe(ELLIPSIS);
    expect(shown).not.toBe('');
    expect(shown).not.toContain('shell');
  });

  it('an N key whose catalogue has no text is unavailable the same way', () => {
    const withoutRetry = { 'shell.offline.title': 'You are offline' };
    expect(release(withoutRetry).resolve('shell.offline.retry')).toEqual({ kind: 'reserved', reason: 'unavailable', budget: null });
    expect(release(withoutRetry).text('shell.offline.retry')).toBe(ELLIPSIS);
    expect(release(withoutRetry).text('shell.offline.title')).toBe('You are offline');
  });

  it('an R key stays reserved, and text() of it gives the ellipsis, never text', () => {
    expect(release().resolve('signIn.tagline')).toEqual({ kind: 'reserved', reason: 'regulated', budget: { chars: 48, lines: 2 } });
    expect(release().text('signIn.tagline' as never)).toBe(ELLIPSIS);
  });

  it('keys named like Object.prototype members are missing keys, not crashes or functions', () => {
    for (const key of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
      expect(copyErrorOf(() => strict().resolve(key as never)).code).toBe('missing-key');
      expect(release().resolve(key as never)).toEqual({ kind: 'reserved', reason: 'unavailable', budget: null });
      expect(release().text(key as never)).toBe(ELLIPSIS);
    }
  });
});

// The mode is read from __DEV__ when the port is built: the jest preset sets it true, a release bundle's
// prelude declares it false, and a script with no React Native has none, which stays strict.
describe('the default mode follows __DEV__', () => {
  const g = globalThis as { __DEV__?: unknown };
  const had = Object.prototype.hasOwnProperty.call(g, '__DEV__');
  const saved = g.__DEV__;
  afterEach(() => {
    if (had) {
      g.__DEV__ = saved;
    } else {
      delete g.__DEV__;
    }
  });
  const built = () => createCopyPort({ spec: SPEC, catalogs: { en: EN } });

  it('is strict under jest, where __DEV__ is true', () => {
    expect(g.__DEV__).toBe(true);
    expect(copyErrorOf(() => built().resolve('shell.offline.body' as never)).code).toBe('missing-key');
  });

  it('is release when __DEV__ is false, as in a release bundle', () => {
    g.__DEV__ = false;
    expect(built().text('shell.offline.body' as never)).toBe('…');
  });

  it('stays strict when __DEV__ is not defined at all', () => {
    delete g.__DEV__;
    expect('__DEV__' in g).toBe(false);
    expect(copyErrorOf(() => built().text('shell.offline.body' as never)).code).toBe('missing-key');
  });

  it('is decided once, when the port is built', () => {
    g.__DEV__ = false;
    const port = built();
    g.__DEV__ = true;
    expect(port.text('shell.offline.body' as never)).toBe('…');
  });
});

// "Pure TS, no React Native import in CopyPort.ts": the port is plain logic that any root, test or
// script can build; React lives in useCopy.ts. Read from the files themselves, with planted sources.
describe('CopyPort.ts is pure TypeScript', () => {
  const COPY = path.resolve(__dirname, '..');
  const SPECIFIER =
    /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/g;
  const specifiers = (source: string) => Array.from(source.matchAll(SPECIFIER), (m) => m[2]);

  it('imports nothing at all: no react-native, no react, no other module', () => {
    const source = fs.readFileSync(path.join(COPY, 'CopyPort.ts'), 'utf8');
    expect(source.length).toBeGreaterThan(0);
    expect(specifiers(source)).toEqual([]);
  });

  it('the scan bites on planted imports of every form', () => {
    expect(specifiers("import { Platform } from 'react-native';")).toEqual(['react-native']);
    expect(specifiers("const React = require('react');")).toEqual(['react']);
    expect(specifiers("export * from './other.ts';")).toEqual(['./other.ts']);
    expect(specifiers("const lazy = import('react-native');")).toEqual(['react-native']);
    expect(specifiers("import 'react-native';")).toEqual(['react-native']);
    expect(specifiers('const a = 1;')).toEqual([]);
  });
});
