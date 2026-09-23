import path from 'node:path';
import {
  compareToBaseline, findRuleConfigComments, findUnjustifiedSuppressions, matchesGlob,
  missingFromLint, toPosix,
} from '../designSystemBaseline.mjs';

// The design-system rules are errors, but the codebase carries pre-existing violations
// (see scripts/lint/design-system-baseline.json for the live count) that are deliberately NOT
// fixed in the same change as the tooling. This ratchet is what lets the rules
// gate CI anyway: the committed baseline records today's count per file PER RULE, and the gate
// fails the moment any of those goes up — including a brand-new hex in an already-dirty file,
// which a file-level exemption list would have waved through.

const f = (file: string, rule: string, baseline: number, actual: number) => ({ file, rule, baseline, actual });

describe('compareToBaseline', () => {
  it('passes when there is nothing to report and nothing baselined', () => {
    const r = compareToBaseline({}, {});
    expect(r.ok).toBe(true);
    expect(r.regressions).toEqual([]);
    expect(r.improvements).toEqual([]);
  });

  it('passes when every file sits exactly on its baseline', () => {
    const counts = { 'src/a.tsx': { 'kokonada/no-color-literals': 4 } };
    expect(compareToBaseline(counts, counts).ok).toBe(true);
  });

  it('fails a NEW file that has violations', () => {
    const r = compareToBaseline({ 'src/new.tsx': { 'kokonada/no-color-literals': 1 } }, {});
    expect(r.ok).toBe(false);
    expect(r.regressions).toEqual([f('src/new.tsx', 'kokonada/no-color-literals', 0, 1)]);
  });

  it('fails a file that gained a violation — the case a file-level exemption would miss', () => {
    const r = compareToBaseline(
      { 'src/a.tsx': { 'kokonada/no-color-literals': 5 } },
      { 'src/a.tsx': { 'kokonada/no-color-literals': 4 } },
    );
    expect(r.ok).toBe(false);
    expect(r.regressions).toEqual([f('src/a.tsx', 'kokonada/no-color-literals', 4, 5)]);
  });

  // Counting PER RULE, not per file, is what catches this: the file total is unchanged, so a
  // whole-file count would call it clean.
  it('fails a swap that trades one rule for another inside the same file', () => {
    const r = compareToBaseline(
      { 'src/a.tsx': { 'kokonada/no-color-literals': 3, 'kokonada/no-scale-literals': 1 } },
      { 'src/a.tsx': { 'kokonada/no-color-literals': 4 } },
    );
    expect(r.ok).toBe(false);
    expect(r.regressions).toEqual([f('src/a.tsx', 'kokonada/no-scale-literals', 0, 1)]);
    expect(r.improvements).toEqual([f('src/a.tsx', 'kokonada/no-color-literals', 4, 3)]);
  });

  it('fails a file that IMPROVED, so the baseline cannot silently stay permissive', () => {
    const r = compareToBaseline(
      { 'src/a.tsx': { 'kokonada/no-color-literals': 2 } },
      { 'src/a.tsx': { 'kokonada/no-color-literals': 4 } },
    );
    expect(r.ok).toBe(false);
    expect(r.regressions).toEqual([]);
    expect(r.improvements).toEqual([f('src/a.tsx', 'kokonada/no-color-literals', 4, 2)]);
  });

  it('treats a fully cleaned file as an improvement to be locked in', () => {
    const r = compareToBaseline({}, { 'src/a.tsx': { 'kokonada/no-color-literals': 4 } });
    expect(r.ok).toBe(false);
    expect(r.improvements).toEqual([f('src/a.tsx', 'kokonada/no-color-literals', 4, 0)]);
  });

  it('reports both totals so the debt trend is visible at a glance', () => {
    const r = compareToBaseline(
      { 'src/a.tsx': { 'kokonada/no-color-literals': 2 }, 'src/b.tsx': { 'kokonada/no-scale-literals': 3 } },
      { 'src/a.tsx': { 'kokonada/no-color-literals': 4 }, 'src/b.tsx': { 'kokonada/no-scale-literals': 3 } },
    );
    expect(r.total).toBe(5);
    expect(r.baselineTotal).toBe(7);
  });

  it('ignores a zero entry in the baseline rather than calling it an improvement', () => {
    const r = compareToBaseline({}, { 'src/a.tsx': { 'kokonada/no-color-literals': 0 } });
    expect(r.ok).toBe(true);
    expect(r.improvements).toEqual([]);
  });

  it('sorts by file then rule, so the baseline diff is stable', () => {
    const r = compareToBaseline(
      { 'src/b.tsx': { 'kokonada/no-scale-literals': 1 }, 'src/a.tsx': { 'kokonada/no-scale-literals': 1, 'kokonada/no-color-literals': 1 } },
      {},
    );
    expect(r.regressions.map((x: { file: string; rule: string }) => `${x.file}:${x.rule}`)).toEqual([
      'src/a.tsx:kokonada/no-color-literals',
      'src/a.tsx:kokonada/no-scale-literals',
      'src/b.tsx:kokonada/no-scale-literals',
    ]);
  });
});

// The baseline is recorded on Windows and compared on a Linux CI runner. If these two produce
// different keys for the same file, every file reads as "new" and the gate is nonsense.
describe('toPosix — the Windows/Linux key parity the whole ratchet rests on', () => {
  it('normalises a win32 absolute path to a posix-relative key', () => {
    expect(toPosix('C:\\repo\\app\\src\\a.tsx', 'C:\\repo\\app', path.win32)).toBe('src/a.tsx');
  });
  it('produces the SAME key from the posix form of the same file', () => {
    expect(toPosix('/repo/app/src/a.tsx', '/repo/app', path.posix)).toBe('src/a.tsx');
  });
  it('handles a nested path on both platforms identically', () => {
    const win = toPosix('C:\\repo\\app\\src\\design\\system\\EmptyState.tsx', 'C:\\repo\\app', path.win32);
    const nix = toPosix('/repo/app/src/design/system/EmptyState.tsx', '/repo/app', path.posix);
    expect(win).toBe('src/design/system/EmptyState.tsx');
    expect(win).toBe(nix);
  });
});

// A disable comment is the ONE escape hatch and it must carry a reason. ESLint applies the
// directive before the gate ever sees the finding, so a silenced violation vanishes from
// `messages` and the file lands on its baseline looking clean. Reading `suppressedMessages` is
// what closes that — including `/* eslint-disable */` on line 1, which suppresses even the rule
// whose job is to complain about it.
describe('findUnjustifiedSuppressions', () => {
  const sup = (justification: string) => [{ kind: 'directive', justification }];

  it('flags a design-system finding silenced with no reason', () => {
    const rows = [{ file: 'src/a.tsx', line: 2, ruleId: 'kokonada/no-color-literals', suppressions: sup('') }];
    expect(findUnjustifiedSuppressions(rows)).toEqual([
      { file: 'src/a.tsx', line: 2, ruleId: 'kokonada/no-color-literals' },
    ]);
  });

  it('allows the escape hatch when a reason is written', () => {
    const rows = [{ file: 'src/a.tsx', line: 2, ruleId: 'kokonada/no-color-literals', suppressions: sup('vendor SDK wants a raw hex') }];
    expect(findUnjustifiedSuppressions(rows)).toEqual([]);
  });

  it('catches the line-1 blanket disable that the rule itself cannot report', () => {
    const rows = [
      { file: 'src/a.tsx', line: 2, ruleId: 'kokonada/require-disable-reason', suppressions: sup('') },
      { file: 'src/a.tsx', line: 2, ruleId: 'kokonada/no-color-literals', suppressions: sup('') },
    ];
    expect(findUnjustifiedSuppressions(rows)).toHaveLength(2);
  });

  it('ignores suppressions of rules outside the design system', () => {
    const rows = [{ file: 'src/a.tsx', line: 9, ruleId: 'react-hooks/exhaustive-deps', suppressions: sup('') }];
    expect(findUnjustifiedSuppressions(rows)).toEqual([]);
  });

  it('requires EVERY applied suppression to carry a reason, not just one of them', () => {
    const rows = [{
      file: 'src/a.tsx',
      line: 2,
      ruleId: 'kokonada/no-color-literals',
      suppressions: [{ kind: 'directive', justification: 'a good reason' }, { kind: 'directive', justification: '' }],
    }];
    expect(findUnjustifiedSuppressions(rows)).toHaveLength(1);
  });

  it('treats whitespace as no reason at all', () => {
    const rows = [{ file: 'src/a.tsx', line: 2, ruleId: 'kokonada/no-color-literals', suppressions: sup('   ') }];
    expect(findUnjustifiedSuppressions(rows)).toHaveLength(1);
  });

  it('survives a row with no suppressions array', () => {
    const rows = [{ file: 'src/a.tsx', line: 2, ruleId: 'kokonada/no-color-literals' }];
    expect(findUnjustifiedSuppressions(rows)).toHaveLength(1);
  });
});

// An inline ESLint CONFIG comment is not a disable DIRECTIVE: it never reaches
// suppressedMessages, require-disable-reason cannot match it, and the rule simply never runs —
// so the file reports zero and reads as clean. One such comment took a fresh #3A5CCC straight
// through the gate. A comment cannot switch off a script, which is why this check lives here.
describe('findRuleConfigComments', () => {
  it('finds a config comment that switches a design-system rule off', () => {
    const src = ['/* eslint kokonada/no-color-literals: off */', "export const c = '#BADA55';"].join('\n');
    expect(findRuleConfigComments(src).map((c) => c.line)).toEqual([1]);
  });

  it('finds one further down the file, with the right line', () => {
    const src = ['const a = 1;', 'const b = 2;', '/* eslint kokonada/no-scale-literals: off */'].join('\n');
    expect(findRuleConfigComments(src).map((c) => c.line)).toEqual([3]);
  });

  it('finds one split across lines', () => {
    const src = ['/* eslint', '   kokonada/no-color-literals: off */'].join('\n');
    expect(findRuleConfigComments(src)).toHaveLength(1);
  });

  it('finds one that names our rule alongside others', () => {
    expect(findRuleConfigComments('/* eslint no-void: off, kokonada/no-color-literals: off */')).toHaveLength(1);
  });

  // `eslint-disable` is a DIRECTIVE, handled by suppressedMessages — double-reporting it here
  // would just be noise. The whitespace after `eslint` is what separates the two forms.
  it('ignores eslint-disable directives, which are a different mechanism', () => {
    expect(findRuleConfigComments('/* eslint-disable kokonada/no-color-literals */')).toEqual([]);
    expect(findRuleConfigComments('// eslint-disable-next-line kokonada/no-color-literals')).toEqual([]);
  });

  it('ignores config comments for unrelated rules', () => {
    expect(findRuleConfigComments('/* eslint no-console: off */')).toEqual([]);
  });

  it('ignores a file with no comments at all', () => {
    expect(findRuleConfigComments('export const a = 1;')).toEqual([]);
  });
});

// A file ESLint never visits reports zero violations and is indistinguishable from a clean one.
// That makes .eslintignore, ignorePatterns, a dot-directory and a stray extension into silent
// bypasses that leave no trace in the gate's output.
describe('missingFromLint', () => {
  it('names a source file the lint run never visited', () => {
    expect(missingFromLint(['src/a.ts', 'src/b.ts'], ['src/a.ts'])).toEqual(['src/b.ts']);
  });

  it('is quiet when every file was visited', () => {
    expect(missingFromLint(['src/a.ts'], ['src/a.ts', 'App.tsx'])).toEqual([]);
  });

  it('sorts, so the failure output is stable', () => {
    expect(missingFromLint(['src/z.ts', 'src/a.ts'], [])).toEqual(['src/a.ts', 'src/z.ts']);
  });
});

// The exemption globs are the only thing standing between "tokens.ts may define colour" and
// "anything filed under src/design may". The semantics that decides which is which is whether
// `*` crosses a directory boundary, so it is pinned here rather than inherited from a library.
describe('matchesGlob', () => {
  it('matches a file in the exact directory', () => {
    expect(matchesGlob('src/design/tokens.ts', 'src/design/*.ts')).toBe(true);
  });

  it('does NOT let a single star cross a directory boundary', () => {
    expect(matchesGlob('src/design/system/EmptyState.ts', 'src/design/*.ts')).toBe(false);
    expect(matchesGlob('src/design/components/Badge.ts', 'src/design/*.ts')).toBe(false);
  });

  it('respects the extension', () => {
    expect(matchesGlob('src/design/theme.tsx', 'src/design/*.ts')).toBe(false);
  });

  it('lets a double star cross any number of boundaries', () => {
    expect(matchesGlob('src/design/__tests__/tokens.test.ts', 'src/design/__tests__/**')).toBe(true);
    expect(matchesGlob('src/design/__tests__/deep/a/b.ts', 'src/design/__tests__/**')).toBe(true);
  });

  it('does not match a sibling directory with a similar name', () => {
    expect(matchesGlob('src/design/__tests__x/a.ts', 'src/design/__tests__/**')).toBe(false);
  });

  it('anchors both ends — a glob is not a substring search', () => {
    expect(matchesGlob('other/src/design/tokens.ts', 'src/design/*.ts')).toBe(false);
    expect(matchesGlob('src/design/tokens.ts.bak', 'src/design/*.ts')).toBe(false);
  });

  it('treats regex metacharacters in the glob as literals', () => {
    expect(matchesGlob('src/a.b.ts', 'src/a.b.ts')).toBe(true);
    expect(matchesGlob('src/axbxts', 'src/a.b.ts')).toBe(false);
  });
});
