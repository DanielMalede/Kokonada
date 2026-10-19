'use strict';
// RA-2 (resilience-auditor, PR #265 at 4d084d4): the reference rules behind docsMap.test.js, pinned on
// fixtures so the guard is proved able to fail. A case marked "accepted at 4d084d4" is a dangling
// reference the guard lets through today. RED until backend/tests/helpers/docsMapRules.js holds these
// rules and docsMap.test.js calls it, so the sweep and its self-tests share one code path (the pattern
// of wave4.attributionGuard.test.js). Pure: no fs, no git, no environment.
const { createChecker, isStrict } = require('./helpers/docsMapRules');
const { frontMatterProblem, isNamedByRule } = require('./helpers/docsMapRules');

const LEDGER = [
  '## Moved',
  '',
  '| old path | new path | date | PR |',
  '|---|---|---|---|',
  '| `docs/VISION.md` | `docs/vision.md` | 2026-10-18 | fixture |',
  '',
  '## Deleted',
  '',
  '| path | what it was | era | last commit holding it | PR |',
  '|---|---|---|---|---|',
  '| `PLAN.md` | the founding prompt | 2026-06 | `0d9eaf3` | fixture |',
  '',
  '## Missing before this reorg',
  '',
  '| path as referenced | referrers | what we know | last commit holding it (if ever tracked) |',
  '|---|---|---|---|',
].join('\n');

const TRACKED = [
  'AGENTS.md', 'CLAUDE.md', 'README.md', 'TASKS.md', 'docs/ARCHIVE.md', 'docs/vision.md', 'docs/adr/0001-free.md',
  'docs/design-v2/DECISIONS.md', 'docs/design-v2/decisions/DEC-001.md', '.claude/agents/developer.md',
  '.claude/commands/page.md', 'backend/app/a.js',
];

const check = createChecker({ tracked: TRACKED, ledgerText: LEDGER });
const STRICT = { strict: true };

describe('docsMap reference rules (RA-2)', () => {
  it('reports a rooted path that exists nowhere (the control; rejected at 4d084d4 too)', () => {
    expect(check('docs/adr/0001-free.md', 'see docs/nope.md')).toEqual(['docs/adr/0001-free.md:1 -> docs/nope.md']);
  });
  it('resolves a link target against its referrer and reports one that resolves to nothing (accepted at 4d084d4)', () => {
    expect(check('docs/design-v2/DECISIONS.md', '[DEC-001](decisions/DEC-001.md)')).toEqual([]);
    expect(check('docs/design-v2/DECISIONS.md', '[DEC-999](decisions/DEC-999.md)')).toEqual(['docs/design-v2/DECISIONS.md:1 -> decisions/DEC-999.md']);
  });
  it('resolves ../ against the referrer instead of stripping it (accepted at 4d084d4)', () => {
    expect(check('docs/adr/0001-free.md', '[vision](../vision.md)')).toEqual([]);
    expect(check('docs/adr/0001-free.md', '[gone](../nope.md)')).toEqual(['docs/adr/0001-free.md:1 -> ../nope.md']);
  });
  it('leaves a prose path outside the repository folders unchecked', () => {
    expect(check('TASKS.md', 'the plan is in Kokonada-private/session-1/NOTES.md')).toEqual([]);
  });
  it('lets (future) exempt only the path it follows, not its whole line (accepted at 4d084d4)', () => {
    expect(check('CLAUDE.md', 'J16 | docs/nope.md, docs/later.md (future), .mcp.json (future)')).toEqual(['CLAUDE.md:1 -> docs/nope.md']);
  });
  it('does not let emphasis hide a path (accepted at 4d084d4), and skips globs, URL tails and placeholders', () => {
    expect(check('README.md', 'read **docs/nope.md** first')).toEqual(['README.md:1 -> docs/nope.md']);
    expect(check('README.md', 'read _docs/nope.md_ first')).toEqual(['README.md:1 -> docs/nope.md']);
    expect(check('CLAUDE.md', 'J8 | **/CLAUDE.md, **/AGENTS.md, **/CLAUDE.local.md (future)', STRICT)).toEqual([]);
    expect(check('README.md', 'https://example.invalid/blob/main/docs/nope.md, <dir>/row.md, ${X}/y.md', STRICT)).toEqual([]);
  });
  it('marks the instruction layer strict, and history and settings not', () => {
    const strict = ['CLAUDE.md', 'AGENTS.md', 'README.md', '.claude/agents/developer.md', '.claude/commands/page.md', '.agents/skills/coordinate/SKILL.md'];
    const lax = ['TASKS.md', 'docs/design-v2/DECISIONS.md', 'docs/plans/halts.md', '.claude/settings.json'];
    expect(strict.filter((rel) => !isStrict(rel))).toEqual([]);
    expect(lax.filter((rel) => isStrict(rel))).toEqual([]);
  });
  it('in the instruction layer, a moved or deleted path is dangling unless its line points at the ledger (accepted at 4d084d4)', () => {
    expect(check('.claude/agents/developer.md', 'build against docs/VISION.md.', STRICT)).toEqual(['.claude/agents/developer.md:1 -> docs/VISION.md']);
    expect(check('.claude/agents/developer.md', 'Authoritative: PLAN.md.', STRICT)).toEqual(['.claude/agents/developer.md:1 -> PLAN.md']);
    expect(check('.claude/agents/developer.md', '`PLAN.md` (deleted; see docs/ARCHIVE.md)', STRICT)).toEqual([]);
    expect(check('TASKS.md', 'was docs/VISION.md:12, and PLAN.md before it')).toEqual([]);
  });
  it('in the instruction layer, a bare name must name a tracked file (accepted at 4d084d4)', () => {
    expect(check('.claude/commands/page.md', 'read CLAUDE.md and TASKS.md', STRICT)).toEqual([]);
    expect(check('.claude/commands/page.md', 'read HANDOFF.md', STRICT)).toEqual(['.claude/commands/page.md:1 -> HANDOFF.md']);
    expect(check('.claude/commands/page.md', 'GRAPH_REPORT.md (future, OPS-165)', STRICT)).toEqual([]);
  });
});

// The forms the sweep meets in the tree, each with a case that must fail (OPS-278, the #265 review).
describe('docsMap reference rules, the markers and the forms around them (OPS-278)', () => {
  const DEV = '.claude/agents/developer.md';

  it('lets a (was …) parenthetical carry an old path in the instruction layer, and only the tokens inside it', () => {
    expect(check(DEV, 'build against docs/vision.md (was docs/VISION.md).', STRICT)).toEqual([]);
    expect(check(DEV, 'read `docs/vision.md` (was `docs/VISION.md`; before it `PLAN.md`)', STRICT)).toEqual([]);
    expect(check(DEV, 'build against docs/VISION.md (was a draft)', STRICT)).toEqual([`${DEV}:1 -> docs/VISION.md`]);
    expect(check(DEV, 'build against docs/vision.md, was docs/VISION.md', STRICT)).toEqual([`${DEV}:1 -> docs/VISION.md`]);
    expect(check(DEV, 'build against docs/vision.md (was docs/nope.md)', STRICT)).toEqual([`${DEV}:1 -> docs/nope.md`]);
  });

  it('takes a relative link to the ledger as its note, and never lets the note cover a path the ledger lacks', () => {
    expect(check(DEV, 'PLAN.md is gone: [the ledger](../../docs/ARCHIVE.md)', STRICT)).toEqual([]);
    expect(check('docs/vision.md', 'PLAN.md is gone: [the ledger](ARCHIVE.md)', STRICT)).toEqual([]);
    expect(check('docs/vision.md', 'PLAN.md is gone: [a page](adr/0001-free.md)', STRICT)).toEqual(['docs/vision.md:1 -> PLAN.md']);
    expect(check(DEV, '`HANDOFF.md` (deleted; see docs/ARCHIVE.md)', STRICT)).toEqual([`${DEV}:1 -> HANDOFF.md`]);
    expect(check(DEV, 'docs/nope.md (deleted; see docs/ARCHIVE.md)', STRICT)).toEqual([`${DEV}:1 -> docs/nope.md`]);
  });

  it('lets a path the ledger records as missing carry (future) in the instruction layer, and a moved or deleted one not', () => {
    const missingRow = '| `docs/planned.md` | TASKS.md | planned, not written yet (future) | never tracked |';
    const withMissing = createChecker({ tracked: TRACKED, ledgerText: `${LEDGER}\n${missingRow}` });
    expect(withMissing(DEV, 'the ledger will be docs/planned.md (future)', STRICT)).toEqual([]);
    expect(withMissing(DEV, 'the ledger is docs/planned.md', STRICT)).toEqual([`${DEV}:1 -> docs/planned.md`]);
    expect(withMissing('TASKS.md', 'the ledger is docs/planned.md')).toEqual([]);
    expect(check(DEV, 'build against docs/VISION.md (future)', STRICT)).toEqual([`${DEV}:1 -> docs/VISION.md`]);
  });

  it('normalises backslashes to / before tokenising (accepted at 4d084d4: a backslash path fell to a bare name)', () => {
    expect(check('README.md', 'see docs\\vision.md, then docs\\nope.md')).toEqual(['README.md:1 -> docs/nope.md']);
    expect(check(DEV, 'open docs\\VISION.md', STRICT)).toEqual([`${DEV}:1 -> docs/VISION.md`]);
  });

  it('takes (future with a suffix, and only right after its path', () => {
    expect(check('CLAUDE.md', '`docs/later.md` (future, OPS-1); **docs/soon.md** (future)')).toEqual([]);
    expect(check('CLAUDE.md', '(future) docs/later.md')).toEqual(['CLAUDE.md:1 -> docs/later.md']);
    expect(check('CLAUDE.md', 'docs/later.md is planned (future)')).toEqual(['CLAUDE.md:1 -> docs/later.md']);
    expect(check('.claude/commands/graph.md', 'read HANDOFF.md, then GRAPH_REPORT.md (future, OPS-165)', STRICT))
      .toEqual(['.claude/commands/graph.md:1 -> HANDOFF.md']);
  });

  it('reads *p* and __p__ as emphasis, a star inside a code span as a glob, and {a} as a placeholder', () => {
    expect(check('README.md', 'read *docs/nope.md* first')).toEqual(['README.md:1 -> docs/nope.md']);
    expect(check('README.md', 'read __docs/nope.md__ first')).toEqual(['README.md:1 -> docs/nope.md']);
    // CLAUDE.md:10's git pathspecs: the stars are literal inside a code span.
    expect(check('CLAUDE.md', "run `git diff -- ':(icase)*CLAUDE.md' ':(icase)*CLAUDE.local.md'`", STRICT)).toEqual([]);
    expect(check('README.md', 'docs/{page}/row.md and docs/*/row.md', STRICT)).toEqual([]);
  });

  it('reads a fenced block as code: its stars are literal, it shows a link rather than making one, and it ends at its fence', () => {
    const text = ['```sh', "git diff -- ':(icase)*CLAUDE.local.md'", '[DEC-001](decisions/DEC-001.md)', '```', 'read *docs/nope.md* first'];
    expect(check(DEV, text.join('\n'), STRICT)).toEqual([`${DEV}:5 -> docs/nope.md`]);
  });

  it('skips a URL tail past its query string and a placeholder glued to a name, and reads a hyphen-glued path as the path', () => {
    expect(check('README.md', 'https://example.invalid/search?path=docs/nope.md and github.com/o/r/blob/main?path=docs/nope.md')).toEqual([]);
    expect(check('.claude/commands/page.md', 'write <page>-notes.md, ${X}-y.md and {a}-z.md', STRICT)).toEqual([]);
    // A Hebrew prefix glues to a path with a hyphen (`ב-docs/x.md`); no path starts with `-`.
    expect(check('docs/vision.md', 'ראו ב-docs/nope.md')).toEqual(['docs/vision.md:1 -> docs/nope.md']);
  });

  it('resolves a prose ./ or ../ path against its referrer (accepted at 4d084d4: ../ was stripped), and leaves one that climbs out unchecked', () => {
    expect(check('docs/adr/0001-free.md', 'see ../vision.md and ./0001-free.md')).toEqual([]);
    expect(check('docs/adr/0001-free.md', 'see ../nope.md')).toEqual(['docs/adr/0001-free.md:1 -> ../nope.md']);
    expect(check('README.md', 'notes live in ../Kokonada-private/NOTES.md')).toEqual([]);
  });

  it('skips a link that is a URL or an anchor, drops the anchor of a path, reads no link inside a code span, and reports one that climbs out', () => {
    expect(check('docs/design-v2/DECISIONS.md', '[a](decisions/DEC-001.md#why) [b](https://example.invalid/x.md) [c](#top)')).toEqual([]);
    expect(check('docs/design-v2/DECISIONS.md', '[a](decisions/DEC-999.md#why)')).toEqual(['docs/design-v2/DECISIONS.md:1 -> decisions/DEC-999.md']);
    expect(check('TASKS.md', 'the index writes `[DEC-001](decisions/DEC-001.md)`')).toEqual([]);
    expect(check('docs/vision.md', '[x](../../outside.md)')).toEqual(['docs/vision.md:1 -> ../../outside.md']);
  });

  it('outside the instruction layer, leaves a bare name unchecked (scratch and private names) and lets history resolve', () => {
    expect(check('TASKS.md', 'see HANDOFF.md and pr-body.md; docs/VISION.md moved')).toEqual([]);
  });

  it('reports every dangling reference once per occurrence, in reading order, with its line', () => {
    expect(check('README.md', 'docs/a.md\nfine: docs/vision.md\r\ndocs/b.md and [c](docs/c.md)')).toEqual([
      'README.md:1 -> docs/a.md', 'README.md:3 -> docs/b.md', 'README.md:3 -> docs/c.md']);
  });

  it('counts the files and the references it read, so an empty sweep can be told from a clean one', () => {
    const counted = createChecker({ tracked: TRACKED, ledgerText: LEDGER });
    expect(counted.scanned).toEqual({ files: 0, tokens: 0 });
    counted('README.md', 'docs/vision.md and [x](docs/vision.md)\nno path here; **/x.md is a glob');
    counted('TASKS.md', '');
    expect(counted.scanned).toEqual({ files: 2, tokens: 2 });
  });
});

describe('docsMap names and front matter (OPS-278)', () => {
  it('lets the /page record keep the names /page gives it, and holds every other file under docs/ to the rule', () => {
    expect(isNamedByRule('docs/design-v2/pages/pulse/verdicts/0001-G3-designer-r1-0123456789ab.md')).toBe(true);
    expect(isNamedByRule('docs/plans/0001-G3-designer-r1-0123456789ab.md')).toBe(false);
    expect(isNamedByRule('docs/plans/Halts.md')).toBe(false);
    expect(isNamedByRule('docs/plans/halts.md')).toBe(true);
    expect(isNamedByRule('docs/design-v2/decisions/DEC-155.md')).toBe(true);
    expect(isNamedByRule('docs/ARCHIVE.md')).toBe(true);
  });

  it('wants front matter closed by ---, a known status and a real verified date not after today', () => {
    const TODAY = '2026-10-19';
    const fm = (...lines) => ['---', ...lines, '---', '', '# Title'].join('\n');
    expect(frontMatterProblem(fm('status: living', 'verified: 2026-10-18'), TODAY)).toBeNull();
    expect(frontMatterProblem(fm('status: frozen', 'verified: 2026-10-19').replace(/\n/g, '\r\n'), TODAY)).toBeNull();
    expect(frontMatterProblem('# Title\n', TODAY)).toMatch(/front matter/);
    expect(frontMatterProblem('---\nstatus: living\nverified: 2026-10-18\n\n# Title\n', TODAY)).toMatch(/closing/);
    expect(frontMatterProblem(fm('status: draft', 'verified: 2026-10-18'), TODAY)).toMatch(/status/);
    expect(frontMatterProblem(fm('status: living'), TODAY)).toMatch(/verified/);
    expect(frontMatterProblem(fm('status: living', 'verified: 2026-02-30'), TODAY)).toMatch(/verified/);
    expect(frontMatterProblem(fm('status: living', 'verified: 2026-13-01'), TODAY)).toMatch(/verified/);
    expect(frontMatterProblem(fm('status: living', 'verified: 2026-10-20'), TODAY)).toMatch(/verified/);
    // A caller that passes no date must not switch the after-today check off.
    expect(() => frontMatterProblem(fm('status: living', 'verified: 2099-01-01'), undefined)).toThrow(TypeError);
  });
});
