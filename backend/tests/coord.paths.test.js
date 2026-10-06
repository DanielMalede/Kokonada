'use strict';

// OPS-151 · the coordinator's path engine.
//
// Two partners claim files before they touch them. Everything the coordinator decides about a
// collision comes down to three questions this module answers: is this a path we accept at all
// (normalised, relative, not so broad that it locks half the repo), does a pattern cover a file,
// and do two declared patterns meet. The engine is pure: strings in, data out, no git, no clock.
//
// The suite lives in backend/tests because jest is the repo's only harness; it reads repo-root
// tooling the way tests/wave4.stateGuard.test.js reads scripts/wave4/state-guard.js.

const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const {
  normalizePath,
  validateDeclared,
  isGlob,
  literalPrefix,
  tooBroadReason,
  matches,
  overlapClass,
  covers,
  DENY_LIST,
} = require(path.join(REPO_ROOT, 'scripts', 'coord', 'lib', 'paths.js'));

describe('OPS-151 · paths — normalisation', () => {
  test.each([
    ['backend\\app\\index.js', 'backend/app/index.js'],
    ['./backend/app/index.js', 'backend/app/index.js'],
    ['././AGENTS.md', 'AGENTS.md'],
    ['  docs/SCREENS.md  ', 'docs/SCREENS.md'],
    ['backend//tests/x.test.js', 'backend/tests/x.test.js'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizePath(input)).toBe(expected);
  });

  test.each([
    ['/etc/passwd', /absolute/],
    ['C:/Users/x.js', /absolute/],
    ['C:\\Users\\x.js', /absolute/],
    ['\\\\server\\share\\x', /absolute/],
    ['../outside.js', /\.\./],
    ['backend/../../x.js', /\.\./],
    ['', /empty/],
    ['   ', /empty/],
    ['project-explorer/', /\/\*\*/],
    ['a,b.js', /comma|backtick/],
    ['a`b.js', /comma|backtick/],
    ['docs/a\u0000b.md', /control/],
    ['docs/a\tb.md', /control/],
    ['docs/a\u007fb.md', /control/],
    ['docs/a\u2028b.md', /control/],
    ['docs/a\u2029b.md', /control/],
  ])('rejects %j', (input, reason) => {
    expect(() => normalizePath(input)).toThrow(reason);
  });

  test('validateDeclared normalises, de-duplicates case-insensitively, and collects every error', () => {
    const res = validateDeclared(['./AGENTS.md', 'agents.md', 'backend/**', '../x', 'scripts/coord/**']);
    expect(res.paths).toEqual(['AGENTS.md', 'scripts/coord/**']);
    expect(res.errors).toHaveLength(2);
    expect(res.errors.join('\n')).toMatch(/backend\/\*\*/);
    expect(res.errors.join('\n')).toMatch(/\.\./);
  });
});

describe('OPS-151 · paths — globs', () => {
  test('only * is a wildcard; everything else is literal', () => {
    expect(isGlob('scripts/coord/**')).toBe(true);
    expect(isGlob('backend/tests/coord.*.test.js')).toBe(true);
    expect(isGlob('mobile/app/[id].tsx')).toBe(false);
    expect(isGlob('AGENTS.md')).toBe(false);
  });

  test('literalPrefix stops at the first segment carrying a wildcard', () => {
    expect(literalPrefix('.github/workflows/**')).toEqual(['.github', 'workflows']);
    expect(literalPrefix('backend/tests/coord.*.test.js')).toEqual(['backend', 'tests']);
    expect(literalPrefix('**')).toEqual([]);
    expect(literalPrefix('backend/**')).toEqual(['backend']);
  });

  test('** crosses folders, * stays inside one segment', () => {
    expect(matches('scripts/coord/**', 'scripts/coord/lib/ledger.js')).toBe(true);
    expect(matches('scripts/coord/**', 'scripts/coordinate.js')).toBe(false);
    expect(matches('backend/tests/coord.*.test.js', 'backend/tests/coord.paths.test.js')).toBe(true);
    expect(matches('backend/tests/coord.*.test.js', 'backend/tests/sub/coord.x.test.js')).toBe(false);
    expect(matches('a/**/b.js', 'a/b.js')).toBe(true);
    expect(matches('a/**/b.js', 'a/x/y/b.js')).toBe(true);
  });

  test('matching is case-insensitive, like the file systems both partners use', () => {
    expect(matches('.GitHub/Workflows/**', '.github/workflows/ci.yml')).toBe(true);
    expect(matches('AGENTS.md', 'agents.md')).toBe(true);
  });

  test('regex metacharacters in a literal path are literal', () => {
    expect(matches('docs/a+b(1).md', 'docs/a+b(1).md')).toBe(true);
    expect(matches('docs/a.md', 'docs/aXmd')).toBe(false);
  });
});

describe('OPS-151 · paths — too broad to claim', () => {
  test.each([
    '**',
    'backend/**',
    'docs/**',
    'scripts/**',
    'project-explorer/**',
    '*.md',
    '.github/*',
    'mobile/KokonadaHealth/**',
    'mobile/KokonadaHealth/src/**',
    'backend/app/**',
    'backend/tests/**',
    'docs/design-v2/**',
    'Backend/App/**',
    'backend/app/**/*.js',
    'mobile/KokonadaHealth/*/**',
  ])('%s is rejected', (glob) => {
    expect(tooBroadReason(glob)).toEqual(expect.any(String));
  });

  test.each([
    'scripts/coord/**',
    'backend/tests/coord.*.test.js',
    '.github/workflows/**',
    'project-explorer/src/**',
    'backend/app/*.js',
    'mobile/KokonadaHealth/src/navigation/**',
    'AGENTS.md',
  ])('%s is accepted', (glob) => {
    expect(tooBroadReason(glob)).toBeNull();
  });

  test('the deny list is the one the coordination rules name', () => {
    expect(DENY_LIST).toEqual([
      'mobile/KokonadaHealth/**',
      'mobile/KokonadaHealth/src/**',
      'backend/app/**',
      'backend/tests/**',
      'docs/design-v2/**',
    ]);
  });
});

describe('OPS-151 · paths — overlap classes', () => {
  test('the same file, whatever its case, is an exact overlap', () => {
    expect(overlapClass('AGENTS.md', 'agents.md')).toBe('exact');
    expect(overlapClass('backend/app/index.js', 'backend/app/index.js')).toBe('exact');
  });

  test('a file under a claimed glob is a glob overlap, in either order', () => {
    expect(overlapClass('.github/workflows/**', '.github/workflows/ci.yml')).toBe('glob');
    expect(overlapClass('.github/workflows/ci.yml', '.github/workflows/**')).toBe('glob');
  });

  test('two globs whose literal prefixes nest overlap', () => {
    expect(overlapClass('scripts/coord/**', 'scripts/coord/lib/*.js')).toBe('glob');
    expect(overlapClass('project-explorer/src/**', 'project-explorer/src/**')).toBe('glob');
  });

  test('disjoint paths do not overlap', () => {
    expect(overlapClass('scripts/coord/**', 'scripts/wave4/state-guard.js')).toBeNull();
    expect(overlapClass('scripts/coord/**', 'scripts/wave4/**')).toBeNull();
    expect(overlapClass('AGENTS.md', 'CLAUDE.md')).toBeNull();
    expect(overlapClass('backend/tests/coord.*.test.js', 'backend/tests/health.test.js')).toBeNull();
  });

  test('covers() answers drift: a changed file is covered by a literal or a glob', () => {
    const declared = ['project-explorer/src/**', 'AGENTS.md'];
    expect(covers(declared, 'project-explorer/src/app.js')).toBe(true);
    expect(covers(declared, 'agents.md')).toBe(true);
    expect(covers(declared, 'backend/app/index.js')).toBe(false);
  });
});
