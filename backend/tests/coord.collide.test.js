'use strict';

// OPS-152 · the collision engine.
//
// Given what I am about to touch and what the other partner is touching on every branch of origin,
// decide CLEAR / WARN / HALT and say exactly why: the person, the branch, the slot, the files and
// the class (exact / glob / exclusive group / resource / task / coupling). It is the one place the
// rules of WORK_LEDGER.md become decisions, so `check`, `start`, `--merge` and `ci` all call it.
//
// Pure: data in, data out; the clock is a parameter. The rules come from the REAL ledger header, so
// these tests are also a pin on the real exclusive groups (ci.yml and the workflow-permission test
// are one group, and must stay one).

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const lib = (name) => require(path.join(REPO_ROOT, 'scripts', 'coord', 'lib', name));
const { parseLedger, setSlot, personByLogin } = lib('ledger.js');
const { statusLine, setStatusLine } = lib('tasks.js');
const {
  expandCoupled,
  ownerOfAuthor,
  ownerOfCommit,
  liveClaimsOn,
  deriveFootprints,
  overlaps,
  assess,
  mergeAdvice,
  ciEvaluate,
  firstClaimWins,
  mergedByContent,
  dropSelf,
  prDoneFor,
  prOpenFor,
  prAuthorFor,
  actualPaths,
  ageText,
  prListsUsable,
  mergePrLists,
  RECENCY_NOTE,
  exitCodeOf,
  STALE_DAYS,
  RELEASE_DAYS,
  RECENT_DAYS,
} = lib('collide.js');

const DAY = 86400;
const NOW = 1791300000; // 2026-10-06, fixed: the engine never reads a clock
const realText = fs.readFileSync(path.join(REPO_ROOT, 'WORK_LEDGER.md'), 'utf8');
const rules = parseLedger(realText);
const malede = personByLogin(rules, 'DanielMalede');
const bedrack = personByLogin(rules, 'DanielBedrack');

// A ledger with every slot free, built from the real header.
const freeText = (() => {
  let text = realText;
  for (const slot of rules.slots) if (!slot.free) text = setSlot(text, slot.id, null);
  return text;
})();

const MAIN_TASKS = `# TASKS

## Backend

- [ ] \`BE-001\` \`P1\` First open row.
  - where: \`backend/app/a.js\`
- [ ] \`BE-002\` \`P1\` Second open row.
  - where: \`backend/app/b.js\`
  - status: fix in progress on branch \`fix/human-branch\` — awaiting review.
- [x] \`BE-003\` \`P1\` Closed row.
  - where: x
- [ ] \`DAN-061\` \`P1\` Owner row.
  - where: the owner's desk
`;

const fp = (over = {}) => ({
  kind: 'claim',
  branch: 'feat/b',
  slot: 'B01',
  person: bedrack,
  task: null,
  title: 'his task',
  state: 'claimed',
  pr: null,
  declared: [],
  actual: [],
  resources: [],
  tipTime: NOW - 3600,
  ...over,
});

const mine = (over = {}) => ({ declared: [], resources: [], task: null, taskKind: null, branch: 'feat/m', ...over });

const run = (me, mineOver, footprints, extra = {}) => assess({
  rules,
  me,
  mine: mine(mineOver),
  footprints,
  mainTasks: MAIN_TASKS,
  // every branch these tests name exists on origin; whether it is LIVE is the footprints' call (N10)
  remoteBranches: new Set(['main', 'feat/b', 'feat/m', 'fix/human-branch']),
  testMentions: {},
  now: NOW,
  ...extra,
});

const classes = (res) => res.reasons.map((r) => `${r.level} ${r.class}`).sort();

describe('OPS-152 · collide — coupled expansion', () => {
  test('a workflow file claims its whole exclusive row', () => {
    const { patterns, groups } = expandCoupled(['.github/workflows/ci.yml'], rules.exclusive);
    // Row 0 directly; row 1 (the Dockerfile) through nodeRuntimePin.test.js, which both rows hold.
    expect(groups.sort()).toEqual([0, 1]);
    expect(patterns).toEqual(expect.arrayContaining([
      '.github/workflows/ci.yml',
      '.github/workflows/**',
      'backend/tests/ciWorkflowPermissions.test.js',
      'backend/tests/secretScanGates.test.js',
      'backend/tests/nodeRuntimePin.test.js',
    ]));
  });

  test('expansion is transitive through a shared member (nodeRuntimePin pins both the Dockerfile and the workflows)', () => {
    expect(expandCoupled(['backend/Dockerfile'], rules.exclusive).groups.sort()).toEqual([0, 1]);
  });

  test('a path in no group expands to itself', () => {
    expect(expandCoupled(['scripts/coord/coord.js'], rules.exclusive)).toEqual({ patterns: ['scripts/coord/coord.js'], groups: [] });
  });
});

describe('OPS-152 · collide — whose branch is it', () => {
  test('the noreply email maps to a login', () => {
    expect(ownerOfAuthor(rules.people, { name: 'Anything', email: '111690772+DanielBedrack@users.noreply.github.com' })).toBe(bedrack);
    expect(ownerOfAuthor(rules.people, { name: 'x', email: 'DanielMalede@users.noreply.github.com' })).toBe(malede);
  });

  test('fallback: the author name equals a People git author', () => {
    expect(ownerOfAuthor(rules.people, { name: 'Full Stack Developer', email: 'someone@example.com' })).toBe(malede);
  });

  test('a first name alone maps to nobody', () => {
    expect(ownerOfAuthor(rules.people, { name: 'Daniel', email: 'someone-else@example.com' })).toBeNull();
  });

  test('a git author value written as "Name <email>" maps by the email only', () => {
    // the real People row lists Malede's local commit identity this way
    expect(ownerOfAuthor(rules.people, { name: 'Daniel', email: 'danielmalede@gmail.com' })).toBe(malede);
    expect(ownerOfAuthor(rules.people, { name: 'Anyone', email: 'DanielMalede@Gmail.com' })).toBe(malede);
    const people = [{ ...malede, gitAuthors: ['Daniel <danielmalede@gmail.com>'] }];
    expect(ownerOfAuthor(people, { name: 'Daniel', email: 'x@example.com' })).toBeNull();
  });

  test('a bare email value maps by email', () => {
    const people = [{ ...bedrack, gitAuthors: ['bedrack@example.com'] }];
    expect(ownerOfAuthor(people, { name: 'Whoever', email: 'Bedrack@Example.com' })).toBe(people[0]);
  });
});

describe('OPS-152 · collide — which claims are live', () => {
  const claim = (branch, over = {}) => ({
    task: 'own:x', taskKind: 'own', title: 't', branch, paths: ['project-explorer/app.js'], resources: [], state: 'claimed', pr: null, started: '2026-10-06', ...over,
  });
  const main = parseLedger(freeText);

  test('a slot that differs from the merge-base and names this branch is live, owned by its section', () => {
    const head = parseLedger(setSlot(freeText, 'B01', claim('feat/b')));
    const live = liveClaimsOn({ branch: 'feat/b', headLedger: head, baseLedger: main, mainLedger: main });
    expect(live.map((s) => s.id)).toEqual(['B01']);
  });

  test('an unchanged slot, a slot naming another branch, and a claim already on main are not live', () => {
    const filled = setSlot(freeText, 'B01', claim('feat/b'));
    expect(liveClaimsOn({ branch: 'feat/b', headLedger: parseLedger(filled), baseLedger: parseLedger(filled), mainLedger: main })).toEqual([]);
    expect(liveClaimsOn({ branch: 'feat/other', headLedger: parseLedger(filled), baseLedger: main, mainLedger: main })).toEqual([]);
    expect(liveClaimsOn({ branch: 'feat/b', headLedger: parseLedger(filled), baseLedger: main, mainLedger: parseLedger(filled) })).toEqual([]);
  });

  test('deriveFootprints: live claims, unclaimed recent branches, and what it ignores', () => {
    const changedCalls = [];
    const branch = (name, over = {}) => ({
      name,
      headLedgerText: freeText,
      baseLedgerText: freeText,
      changed: () => { changedCalls.push(name); return [`${name}.txt`]; },
      merged: () => false,
      tipTime: NOW - DAY,
      author: { name: 'DanielBedrack', email: '111690772+DanielBedrack@users.noreply.github.com' },
      firstLedgerTime: () => NOW - DAY,
      ...over,
    });
    const fps = deriveFootprints({
      mainLedger: main,
      rules,
      now: NOW,
      branches: [
        branch('main'),
        branch('HEAD'),
        branch('feat/claimed', { headLedgerText: setSlot(freeText, 'B02', claim('feat/claimed', { task: 'own:y' })) }),
        branch('feat/claimed-pr-done', {
          headLedgerText: setSlot(freeText, 'B02', claim('feat/claimed-pr-done')),
          prDone: () => true,
        }),
        branch('feat/claimed-pr-done-malformed', {
          headLedgerText: setSlot(freeText, 'B02', claim('feat/claimed-pr-done-malformed', { paths: ['../escape.js'] })),
          prDone: () => true,
        }),
        branch('feat/landed', { headLedgerText: setSlot(freeText, 'B03', claim('feat/landed')) }),
        branch('feat/recent'),
        branch('feat/no-ledger', { headLedgerText: null, baseLedgerText: null }),
        branch('feat/old', { tipTime: NOW - (RECENT_DAYS + 1) * DAY }),
        branch('feat/merged', { merged: () => true }),
        branch('feat/unknown', { author: { name: 'Daniel', email: 'someone-else@example.com' } }),
        branch('feat/pr-merged', { prDone: () => true }),
        branch('feat/content-merged', { contentMerged: () => true }),
      ],
      mainLedgerBranches: undefined,
    });
    const byBranch = Object.fromEntries(fps.map((f) => [f.branch, f]));

    expect(Object.keys(byBranch).sort()).toEqual(['feat/claimed', 'feat/claimed-pr-done-malformed', 'feat/landed', 'feat/no-ledger', 'feat/recent', 'feat/unknown']);
    expect(byBranch['feat/claimed']).toMatchObject({ kind: 'claim', slot: 'B02', task: 'own:y', declared: ['project-explorer/app.js'], actual: ['feat/claimed.txt'] });
    expect(byBranch['feat/claimed'].person).toBe(bedrack);
    expect(byBranch['feat/claimed-pr-done-malformed']).toMatchObject({ kind: 'claim', malformed: true, dropped: ['../escape.js'] });
    expect(byBranch['feat/recent']).toMatchObject({ kind: 'unclaimed', slot: null, declared: [], actual: ['feat/recent.txt'] });
    expect(byBranch['feat/recent'].person).toBe(bedrack);
    expect(byBranch['feat/unknown'].person).toBeNull();
    // the old branch was never diffed: expensive reads are lazy
    expect(changedCalls).not.toContain('feat/old');
  });

  test('mergedByContent: every changed file already has the same blob on main', () => {
    const files = ['a.js', 'gone.js'];
    expect(mergedByContent(files, { 'a.js': 'x1' }, { 'a.js': 'x1' })).toBe(true); // both deleted gone.js
    expect(mergedByContent(files, { 'a.js': 'x1' }, { 'a.js': 'x2' })).toBe(false); // main moved on
    expect(mergedByContent(files, { 'a.js': 'x1' }, { 'a.js': 'x1', 'gone.js': 'g' })).toBe(false); // branch deletes it, main keeps it
    // A branch with no changed files proves nothing: an unreadable diff must never read as "merged".
    expect(mergedByContent([], {}, {})).toBe(false);
  });

  test('a squash-merged branch is dropped by its PR state or by content, without diffing more than needed', () => {
    const base = {
      headLedgerText: null, baseLedgerText: null, merged: () => false, tipTime: NOW - DAY, changed: ['x/y/z.js'],
      author: { name: 'DanielBedrack', email: '111690772+DanielBedrack@users.noreply.github.com' },
    };
    const fps = deriveFootprints({
      mainLedger: main,
      rules,
      now: NOW,
      branches: [
        { ...base, name: 'feat/open', prDone: () => false, contentMerged: () => false },
        { ...base, name: 'feat/merged-pr', prDone: () => true, contentMerged: () => { throw new Error('not needed'); } },
        { ...base, name: 'feat/closed-pr', prDone: () => true },
        { ...base, name: 'feat/squashed', prDone: () => false, contentMerged: () => true },
      ],
    });
    expect(fps.map((f) => f.branch)).toEqual(['feat/open']);
  });

  test('an OPEN PR keeps a branch however old its commits; without gh, a recently fetched ref counts as recent', () => {
    const base = {
      headLedgerText: null, baseLedgerText: null, merged: false, contentMerged: false, prDone: false, changed: ['x/y/z.js'],
      tipTime: NOW - 40 * DAY, author: { name: 'DanielBedrack', email: '111690772+DanielBedrack@users.noreply.github.com' },
    };
    const fps = deriveFootprints({
      mainLedger: main,
      rules,
      now: NOW,
      branches: [
        { ...base, name: 'feat/old-open-pr', prOpen: true },
        { ...base, name: 'feat/revived', prOpen: false, seenTime: NOW - 3600 },
        { ...base, name: 'feat/really-old', prOpen: false, seenTime: NOW - 30 * DAY },
      ],
    });
    expect(fps.map((f) => f.branch)).toEqual(['feat/old-open-pr', 'feat/revived']);
  });

  test('PR state counts only for the commit the PR was about (headRefOid == branch tip)', () => {
    const prs = [
      { number: 5, headRefName: 'feat/x', state: 'MERGED', headRefOid: 'aaa', author: { login: 'DanielBedrack' } },
      { number: 9, headRefName: 'feat/y', state: 'OPEN', headRefOid: 'bbb', author: { login: 'DanielBedrack' } },
      { number: 3, headRefName: 'feat/y', state: 'CLOSED', headRefOid: 'ccc', author: { login: 'DanielMalede' } },
    ];
    expect(prDoneFor(prs, 'feat/x', 'aaa')).toBe(true);
    expect(prDoneFor(prs, 'feat/x', 'new-commit-after-merge')).toBe(false);
    expect(prDoneFor(prs, 'feat/y', 'bbb')).toBe(false);
    expect(prDoneFor(null, 'feat/x', 'aaa')).toBe(false);
    expect(prOpenFor(prs, 'feat/y')).toBe(true);
    expect(prOpenFor(prs, 'feat/x')).toBe(false);
    expect(prAuthorFor(prs, 'feat/y')).toBe('DanielBedrack'); // the newest PR's author
    expect(prAuthorFor(prs, 'feat/none')).toBeNull();
  });

  test('N1 · a stale PR author never decides who owns a reused branch name', () => {
    const merged = { number: 20, headRefName: 'docs/reused', state: 'MERGED', headRefOid: 'old-tip', author: { login: 'DanielMalede' } };
    // a merged PR about an older commit says nothing about the work on the tip now
    expect(prAuthorFor([merged], 'docs/reused', 'new-tip')).toBeNull();
    expect(prAuthorFor([merged], 'docs/reused', 'old-tip')).toBe('DanielMalede');
    // ANY open PR for the head counts, even when a newer PR on that name is closed
    const open = { number: 7, headRefName: 'docs/reused', state: 'OPEN', headRefOid: 'new-tip', author: { login: 'DanielBedrack' } };
    expect(prOpenFor([merged, open], 'docs/reused')).toBe(true);
    expect(prAuthorFor([merged, open], 'docs/reused', 'new-tip')).toBe('DanielBedrack');
    expect(prDoneFor([merged, open], 'docs/reused', 'old-tip')).toBe(false);

    const fps = deriveFootprints({
      mainLedger: main,
      rules,
      now: NOW,
      branches: [{
        name: 'docs/reused', headLedgerText: null, baseLedgerText: null, merged: false, contentMerged: false, prDone: false,
        changed: ['backend/app/services/alpha.js'], tipTime: NOW - DAY,
        author: { name: 'DanielBedrack', email: '111690772+DanielBedrack@users.noreply.github.com' },
        prAuthor: () => prAuthorFor([merged], 'docs/reused', 'new-tip'),
      }],
    });
    expect(fps[0].person).toBe(bedrack);
    const res = run(malede, { declared: ['backend/app/services/alpha.js'] }, fps);
    expect(res.verdict).toBe('HALT');
    expect(res.reasons[0].person).toBe('Bedrack');
  });

  test('N2 · a slot that does not parse and names no path HALTs — it is never a claim on nothing', () => {
    const broken = freeText.replace('### B02\n_free_\n', '### B02\n- task: `own:x` (own)\n- branch: `feat/empty`\n');
    const fps = deriveFootprints({
      mainLedger: main,
      rules,
      now: NOW,
      branches: [{
        name: 'feat/empty', headLedgerText: broken, baseLedgerText: freeText, merged: false, contentMerged: false, prDone: false,
        changed: ['WORK_LEDGER.md'], tipTime: NOW - DAY, author: { name: 'DanielBedrack', email: '111690772+DanielBedrack@users.noreply.github.com' },
      }],
    });
    expect(fps[0]).toMatchObject({ malformed: true, declared: [] });
    const res = run(malede, { declared: ['x/y/z.js'] }, fps);
    expect(classes(res)).toEqual(['HALT malformed']);
    expect(res.reasons[0].message).toMatch(/names no path/);
  });

  test('N19 · a claimed folder with a trailing slash is a folder claim; a path that cannot normalise marks the claim malformed', () => {
    const derive = (paths) => deriveFootprints({
      mainLedger: main,
      rules,
      now: NOW,
      branches: [{
        name: 'feat/slash', headLedgerText: setSlot(freeText, 'B04', claim('feat/slash', { paths })), baseLedgerText: freeText,
        merged: false, contentMerged: false, prDone: false, changed: ['WORK_LEDGER.md'], tipTime: NOW - DAY,
        author: { name: 'DanielBedrack', email: '111690772+DanielBedrack@users.noreply.github.com' },
      }],
    })[0];
    expect(derive(['project-explorer/src/'])).toMatchObject({ declared: ['project-explorer/src/**'], malformed: false });
    expect(derive(['../escape.js', 'docs/ok.md'])).toMatchObject({ declared: ['docs/ok.md'], malformed: true });
  });

  test('N4 · a branch dropped by commit-date age with no reflog evidence is reported, so the CLI can say so', () => {
    const b = {
      headLedgerText: null, baseLedgerText: null, merged: false, contentMerged: false, prDone: false, prOpen: false, changed: ['x/y/z.js'],
      tipTime: NOW - 40 * DAY, author: { name: 'DanielBedrack', email: '111690772+DanielBedrack@users.noreply.github.com' },
    };
    const stats = {};
    deriveFootprints({
      mainLedger: main,
      rules,
      now: NOW,
      stats,
      branches: [{ ...b, name: 'feat/no-evidence', seenTime: null }, { ...b, name: 'feat/seen-long-ago', seenTime: NOW - 30 * DAY }],
    });
    expect(stats.ageOnly).toEqual(['feat/no-evidence']);
    // M1: the residual's true scope, said once
    expect(RECENCY_NOTE).toBe('note: a branch this clone first saw in its initial fetch, with commits older than 14 days and no open PR, is not checked');
  });

  describe('OPS-221 · the PR lists: the all-states list may be cut, the open list must be whole', () => {
    // A PR as gh lists it, with every field the adapter asks for.
    const ghPr = (number, over = {}) => ({
      number, state: 'CLOSED', headRefName: `b/${number}`, headRefOid: String(number).padStart(40, '0'), isDraft: false,
      author: { login: 'DanielMalede' }, isCrossRepository: false, ...over,
    });
    const many = (n, over = {}) => Array.from({ length: n }, (_, i) => ghPr(i + 1, over));
    const usable = (over) => prListsUsable({ open: [], all: [], byAuthor: null, openLimit: 100, ...over });
    const forks = () => many(100, { state: 'OPEN', author: { login: 'stranger' }, isCrossRepository: true });

    test('(1, 2) an all-states list at its limit, or far past it, still decides: gh lists newest first, so a cut drops only the oldest PRs', () => {
      // allLimit is what #239's stop read; passing it proves nothing reads it any more
      expect(usable({ all: many(300), allLimit: 300 })).toEqual({ ok: true, reason: null });
      expect(usable({ all: many(1000), allLimit: 300 })).toEqual({ ok: true, reason: null });
    });

    test('(3) an open list at its limit cannot decide alone: its raw length counts, a stranger\'s fork PRs included', () => {
      expect(usable({ open: forks() })).toEqual({ ok: false, reason: expect.stringMatching(/listed 100 open PRs, its limit/) });
    });

    test('(4) at the limit, each partner\'s own open list decides when none of them is cut', () => {
      expect(usable({ open: forks(), byAuthor: { DanielMalede: [], DanielBedrack: [] } })).toEqual({ ok: true, reason: null });
    });

    test('(5) a partner\'s own open list at its limit cannot decide, naming him', () => {
      const his = many(100, { state: 'OPEN', author: { login: 'DanielBedrack' } });
      expect(usable({ open: forks(), byAuthor: { DanielMalede: [], DanielBedrack: his } }))
        .toEqual({ ok: false, reason: expect.stringMatching(/100 open PRs by @DanielBedrack, its limit/) });
    });

    test('(6) a partner\'s own open list that failed cannot decide, naming him and --author', () => {
      const res = usable({ open: forks(), byAuthor: { DanielMalede: null, DanielBedrack: [] } });
      expect(res.ok).toBe(false);
      expect(res.reason).toMatch(/@DanielMalede/);
      expect(res.reason).toMatch(/--author/);
    });

    test('(7) a list that did not come back cannot decide', () => {
      expect(usable({ open: null }).ok).toBe(false);
      expect(usable({ all: null }).ok).toBe(false);
    });

    test('(8) an entry without isCrossRepository, in any list, cannot decide: a fork\'s PR could not be told apart', () => {
      const bare = (number) => { const p = ghPr(number); delete p.isCrossRepository; return p; };
      expect(usable({ open: [bare(1)] })).toEqual({ ok: false, reason: expect.stringMatching(/isCrossRepository/) });
      expect(usable({ all: [ghPr(2), bare(3)] })).toEqual({ ok: false, reason: expect.stringMatching(/isCrossRepository/) });
      expect(usable({ open: forks(), byAuthor: { DanielMalede: [bare(4)], DanielBedrack: [] } }))
        .toEqual({ ok: false, reason: expect.stringMatching(/isCrossRepository/) });
      // a value that is not a boolean says nothing either
      expect(usable({ open: [ghPr(5, { isCrossRepository: 'false' })] }).ok).toBe(false);
    });

    test('(9) mergePrLists: a PR OPEN in any list stays OPEN, whichever list comes first', () => {
      const closed = ghPr(7, { state: 'CLOSED' });
      const open = ghPr(7, { state: 'OPEN' });
      expect(mergePrLists([closed], [open])).toEqual([open]);
      expect(mergePrLists([open], [closed])).toEqual([open]);
    });

    test('(10) mergePrLists: one entry per PR number across every list; a list that did not come back is skipped', () => {
      const merged = mergePrLists([ghPr(1), ghPr(2)], null, [ghPr(2), ghPr(3, { state: 'OPEN' })], [ghPr(4, { state: 'MERGED' })]);
      expect(merged.map((p) => p.number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
      expect(merged.find((p) => p.number === 3).state).toBe('OPEN');
      // no list at all is no answer, as when gh is missing: never an empty list of PRs
      expect(mergePrLists(null, null)).toBeNull();
      expect(mergePrLists([], null)).toEqual([]);
    });
  });

  test('an unmapped commit author is resolved through the PR author login first', () => {
    const fps = deriveFootprints({
      mainLedger: main,
      rules,
      now: NOW,
      branches: [{
        name: 'feat/odd-author', headLedgerText: null, baseLedgerText: null, merged: false, contentMerged: false, prDone: false,
        changed: ['a/b/c.js'], tipTime: NOW - DAY, author: { name: 'Laptop', email: 'root@laptop' }, prAuthor: () => 'DanielBedrack',
      }],
    });
    expect(fps[0].person).toBe(bedrack);
  });

  test('a slot that changed but does not parse is never silently unclaimed: its backticked paths become a claim', () => {
    const broken = freeText.replace('### B02\n_free_\n', '### B02\n- task: `own:x` (own)\n- branch: `feat/broken`\n- paths: `project-explorer/src/**`, `AGENTS.md`\n');
    const fps = deriveFootprints({
      mainLedger: main,
      rules,
      now: NOW,
      branches: [{
        name: 'feat/broken', headLedgerText: broken, baseLedgerText: freeText, merged: false, contentMerged: false, prDone: false,
        changed: ['WORK_LEDGER.md'], tipTime: NOW - DAY, author: { name: 'DanielBedrack', email: '111690772+DanielBedrack@users.noreply.github.com' },
      }],
    });
    expect(fps).toHaveLength(1);
    expect(fps[0]).toMatchObject({ kind: 'claim', malformed: true, slot: 'B02', declared: ['project-explorer/src/**', 'AGENTS.md'] });
    expect(fps[0].person).toBe(bedrack);
    const res = run(malede, { declared: ['AGENTS.md'] }, fps);
    expect(res.verdict).toBe('HALT');
    expect(res.reasons[0].message).toMatch(/does not parse/);
  });

  test('ACTUAL changed files are never dropped by declaration rules: a comma in a file name still collides', () => {
    const file = 'mobile/KokonadaHealth/assets/bootsplash/logo@1,5x.png';
    expect(actualPaths([file, '.\\docs\\x.md'])).toEqual([file, 'docs/x.md']);
    const fps = deriveFootprints({
      mainLedger: main,
      rules,
      now: NOW,
      branches: [{
        name: 'feat/splash', headLedgerText: null, baseLedgerText: null, merged: false, contentMerged: false, prDone: false,
        changed: [file], tipTime: NOW - DAY, author: { name: 'DanielBedrack', email: '111690772+DanielBedrack@users.noreply.github.com' },
      }],
    });
    expect(fps[0].actual).toEqual([file]);
    expect(classes(run(malede, { declared: ['mobile/KokonadaHealth/assets/bootsplash/**'] }, fps))).toEqual(['HALT glob']);
  });

  test('landed means main holds the byte-identical slot; work after the landing is still visible', () => {
    const landed = setSlot(freeText, 'B03', claim('feat/landed'));
    const branch = (over) => ({
      name: 'feat/landed', headLedgerText: landed, baseLedgerText: freeText, changed: ['x/y/z.js'], merged: false, prDone: false,
      tipTime: NOW - DAY, author: { name: 'DanielBedrack', email: '111690772+DanielBedrack@users.noreply.github.com' }, ...over,
    });
    const derive = (mainText, b) => deriveFootprints({ mainLedger: parseLedger(mainText), rules, now: NOW, branches: [b] });

    // squash-merged and nothing since: history
    expect(derive(landed, branch({ contentMerged: true }))).toEqual([]);
    // landed, but the branch carries more work: unclaimed, visible
    expect(derive(landed, branch({ contentMerged: false })).map((f) => f.kind)).toEqual(['unclaimed']);
    // main records the same NAME with a different body (a reused name): the branch's claim is live
    const other = setSlot(freeText, 'B03', claim('feat/landed', { title: 'an older task under the same name' }));
    expect(derive(other, branch({ contentMerged: false })).map((f) => f.kind)).toEqual(['claim']);
  });
});

describe('OPS-152 · collide — check: HALT classes', () => {
  test('ci.yml against his workflow-permission test is ONE exclusive group → HALT', () => {
    const res = run(malede, { declared: ['.github/workflows/ci.yml'] }, [fp({ declared: ['backend/tests/ciWorkflowPermissions.test.js'] })]);
    expect(res.verdict).toBe('HALT');
    expect(classes(res)).toEqual(['HALT exclusive group']);
    const reason = res.reasons[0];
    expect(reason).toMatchObject({ person: 'Bedrack', branch: 'feat/b', slot: 'B01' });
    expect(reason.message).toMatch(/\.github\/workflows\/\*\*/);
    expect(reason.files).toEqual(expect.arrayContaining(['.github/workflows/ci.yml', 'backend/tests/ciWorkflowPermissions.test.js']));
  });

  test('the same file, case aside → exact; a file under his glob → glob', () => {
    expect(classes(run(malede, { declared: ['agents.md'] }, [fp({ declared: ['AGENTS.md'] })]))).toEqual(['HALT exact', 'HALT exclusive group']);
    expect(classes(run(malede, { declared: ['project-explorer/src/a.js'] }, [fp({ declared: ['project-explorer/src/**'] })]))).toEqual(['HALT glob']);
  });

  test('his ACTUAL changed files count, not only what he declared', () => {
    const res = run(malede, { declared: ['backend/app/routes/x.js'] }, [fp({ declared: ['project-explorer/app.js'], actual: ['backend/app/routes/x.js'] })]);
    expect(classes(res)).toEqual(['HALT exact']);
  });

  test('the same resource → HALT', () => {
    expect(classes(run(malede, { declared: ['a/b/c.js'], resources: ['res:atlas-prod'] }, [fp({ declared: ['x/y/z.js'], resources: ['res:atlas-prod'] })])))
      .toEqual(['HALT resource']);
  });

  test('both claiming the same TASKS row → HALT', () => {
    const res = run(malede, { declared: ['a/b/c.js'], task: 'BE-001', taskKind: 'TASKS' }, [fp({ declared: ['x/y/z.js'], task: 'BE-001' })]);
    expect(classes(res)).toEqual(['HALT task']);
  });

  test('Bedrack claiming a DAN- row → HALT, even with nobody else around', () => {
    const res = run(bedrack, { declared: ['a/b/c.js'], task: 'DAN-061', taskKind: 'TASKS' }, []);
    expect(classes(res)).toEqual(['HALT task']);
    expect(res.reasons[0].message).toMatch(/DAN-/);
    expect(run(malede, { declared: ['a/b/c.js'], task: 'DAN-061', taskKind: 'TASKS' }, []).verdict).toBe('CLEAR');
  });

  test('Bedrack declaring an owner-only path → HALT; the owner may', () => {
    expect(classes(run(bedrack, { declared: ['.claude/agents/x.md'] }, []))).toEqual(['HALT owner-only']);
    expect(run(malede, { declared: ['.claude/agents/x.md'] }, []).verdict).toBe('CLEAR');
  });

  test('a TASKS id with no open row on main → HALT', () => {
    expect(classes(run(malede, { declared: ['a/b/c.js'], task: 'BE-003', taskKind: 'TASKS' }, []))).toEqual(['HALT task']);
    expect(classes(run(malede, { declared: ['a/b/c.js'], task: 'BE-404', taskKind: 'TASKS' }, []))).toEqual(['HALT task']);
  });

  test('a row whose status line names a different LIVE branch → HALT; a dead branch or my own does not', () => {
    const live = fp({ kind: 'unclaimed', slot: null, branch: 'fix/human-branch', actual: ['x/y/z.js'] });
    expect(classes(run(malede, { declared: ['a/b/c.js'], task: 'BE-002', taskKind: 'TASKS' }, [live]))).toEqual(['HALT task']);
    const dead = run(malede, { declared: ['a/b/c.js'], task: 'BE-002', taskKind: 'TASKS' }, []);
    expect(dead.verdict).toBe('CLEAR');
    const own = run(malede, { declared: ['a/b/c.js'], task: 'BE-002', taskKind: 'TASKS', branch: 'fix/human-branch' }, []);
    expect(own.verdict).toBe('CLEAR');
    // a local checkout of HIS branch name (gh pr checkout) does not make his row mine
    const his = run(malede, { declared: ['a/b/c.js'], task: 'BE-002', taskKind: 'TASKS', branch: 'fix/human-branch' }, [fp({ branch: 'fix/human-branch', declared: ['x/y/z.js'] })]);
    expect(classes(his)).toEqual(['HALT task']);
  });

  test('N10 · a status line names a LIVE branch only when that branch has a live footprint: a landed but undeleted branch does not hold the row', () => {
    const task = { declared: ['a/b/c.js'], task: 'BE-002', taskKind: 'TASKS' };
    // fix/human-branch still exists on origin, but its work landed: no claim, no unclaimed footprint
    expect(run(malede, task, []).verdict).toBe('CLEAR');
    // my own live claim on that branch, while I stand on another one, is the same task twice
    const myOther = fp({ person: malede, slot: 'M03', branch: 'fix/human-branch', declared: ['x/y/z.js'] });
    expect(classes(run(malede, task, [myOther]))).toEqual(['HALT task']);
  });

  test('dropSelf drops only MY footprint on the current branch, never his under the same name', () => {
    const mineFp = fp({ branch: 'feat/x', person: malede, slot: 'M01' });
    const unknownFp = fp({ branch: 'feat/x', person: null, kind: 'unclaimed', slot: null });
    const hisFp = fp({ branch: 'feat/x', person: bedrack });
    const elsewhere = fp({ branch: 'feat/y', person: malede });
    // N9: only MY section's footprint is dropped; an unmapped one on my branch stays, as a WARN
    expect(dropSelf([mineFp, unknownFp, hisFp, elsewhere], 'feat/x', malede)).toEqual([unknownFp, hisFp, elsewhere]);
    expect(dropSelf([hisFp], null, malede)).toEqual([hisFp]);
    const onMine = fp({ branch: 'feat/x', person: null, kind: 'unclaimed', slot: null, actual: ['AGENTS.md'] });
    const res = run(malede, { declared: ['AGENTS.md'], branch: 'feat/x' }, dropSelf([onMine], 'feat/x', malede));
    expect(classes(res)).toEqual(['WARN owner unknown']);
  });

  test('N16 · own:<slug> tasks are never "the same task"; TASKS ids are', () => {
    const a = { declared: ['a/b/c.js'], actual: [], resources: [] };
    const b = { declared: ['x/y/z.js'], actual: [], resources: [] };
    expect(overlaps({ ...a, task: 'own:x' }, { ...b, task: 'own:x' }, rules)).toEqual([]);
    expect(overlaps({ ...a, task: 'BE-001' }, { ...b, task: 'BE-001' }, rules).map((o) => o.class)).toEqual(['task']);
  });
});

describe('OPS-152 · collide — check: WARN and CLEAR', () => {
  test('TASKS.md and WORK_LEDGER.md overlap is ignored entirely', () => {
    const res = run(malede, { declared: ['TASKS.md', 'WORK_LEDGER.md'] }, [fp({ actual: ['TASKS.md', 'WORK_LEDGER.md'] })]);
    expect(res.verdict).toBe('CLEAR');
    expect(res.reasons).toEqual([]);
  });

  test('docs/SCREENS.md and DECISIONS.md overlap is a WARN, never a HALT', () => {
    const res = run(malede, { declared: ['docs/SCREENS.md', 'docs/design-v2/DECISIONS.md'] }, [fp({ declared: ['docs/SCREENS.md', 'docs/design-v2/DECISIONS.md'] })]);
    expect(res.verdict).toBe('WARN');
    expect(classes(res)).toEqual(['WARN shared', 'WARN shared']);
  });

  test('a test on main that names my file, sitting in his footprint → WARN coupling', () => {
    const res = run(
      malede,
      { declared: ['backend/app/services/foo.js'] },
      [fp({ actual: ['backend/tests/foo.test.js'] })],
      { testMentions: { 'backend/app/services/foo.js': ['backend/tests/foo.test.js'] } },
    );
    expect(classes(res)).toEqual(['WARN coupling']);
    expect(res.reasons[0].files).toEqual(['backend/app/services/foo.js', 'backend/tests/foo.test.js']);
  });

  test('coupling already covered by a HALT on the same branch is not repeated; the rest is ONE line per branch', () => {
    const mentions = { '.github/workflows/ci.yml': ['backend/tests/ciWorkflowPermissions.test.js', 'backend/tests/nodeRuntimePin.test.js', 'backend/tests/secretScanGates.test.js'] };
    const covered = run(malede, { declared: ['.github/workflows/ci.yml'] }, [fp({ kind: 'unclaimed', slot: null, actual: ['.github/workflows/ci.yml', 'backend/tests/ciWorkflowPermissions.test.js'] })], { testMentions: mentions });
    expect(classes(covered)).toEqual(['HALT exact', 'HALT exclusive group']);

    const two = run(
      malede,
      { declared: ['backend/app/services/foo.js', 'backend/app/services/bar.js'] },
      [fp({ actual: ['backend/tests/foo.test.js', 'backend/tests/bar.test.js'] })],
      { testMentions: { 'backend/app/services/foo.js': ['backend/tests/foo.test.js'], 'backend/app/services/bar.js': ['backend/tests/bar.test.js'] } },
    );
    expect(classes(two)).toEqual(['WARN coupling']);
    expect(two.reasons[0].files.sort()).toEqual(['backend/app/services/bar.js', 'backend/app/services/foo.js', 'backend/tests/bar.test.js', 'backend/tests/foo.test.js']);
  });

  test('his stale live claim is a WARN; at ten days it says to ask him to release it', () => {
    const six = run(malede, { declared: ['a/b/c.js'] }, [fp({ declared: ['x/y/z.js'], tipTime: NOW - (STALE_DAYS + 1) * DAY })]);
    expect(classes(six)).toEqual(['WARN stale']);
    expect(six.reasons[0].message).not.toMatch(/release/);
    const eleven = run(malede, { declared: ['a/b/c.js'] }, [fp({ declared: ['x/y/z.js'], tipTime: NOW - (RELEASE_DAYS + 1) * DAY })]);
    expect(eleven.reasons[0].message).toMatch(/ask him to release it/);
  });

  test('my own other branches are never collisions', () => {
    const res = run(malede, { declared: ['AGENTS.md'] }, [fp({ person: malede, slot: 'M03', declared: ['AGENTS.md'] })]);
    expect(res.verdict).toBe('CLEAR');
  });

  test('unclaimed branches nobody can be mapped to HALT (fail closed), folded into ONE line naming them', () => {
    const unknown = (branch) => fp({ kind: 'unclaimed', slot: null, person: null, branch, actual: ['AGENTS.md', '.github/workflows/ci.yml'], author: { name: 'X', email: 'x@example.com' } });
    const res = run(malede, { declared: ['AGENTS.md', '.github/workflows/ci.yml'] }, [unknown('feat/u1'), unknown('feat/u2'), fp({ kind: 'unclaimed', slot: null, person: null, branch: 'feat/u3', actual: ['elsewhere/x.js'] })]);
    expect(res.verdict).toBe('HALT');
    expect(classes(res)).toEqual(['HALT owner unknown']);
    expect(res.reasons[0].message).toMatch(/WORK_LEDGER\.md/);
    expect(res.reasons[0].message).toMatch(/feat\/u1/);
    expect(res.reasons[0].message).toMatch(/feat\/u2/);
    expect(res.reasons[0].message).not.toMatch(/feat\/u3/); // it meets nothing of mine
    expect(res.reasons[0].branches).toEqual(['feat/u1', 'feat/u2']);
  });

  test('my own UNCLAIMED branch — authored as "Daniel <danielmalede@gmail.com>" — is never a collision for me, and HALTs him', () => {
    const fps = deriveFootprints({
      mainLedger: parseLedger(freeText),
      rules,
      now: NOW,
      branches: [{
        name: 'fix/ci-workflow-list-pin', headLedgerText: null, baseLedgerText: null, merged: false, prDone: false, contentMerged: false,
        tipTime: NOW - DAY, changed: ['.github/workflows/ci.yml'], author: { name: 'Daniel', email: 'danielmalede@gmail.com' },
      }],
    });
    expect(fps[0].person).toBe(malede);
    expect(run(malede, { declared: ['.github/workflows/ci.yml'] }, fps)).toEqual({ verdict: 'CLEAR', reasons: [] });
    const his = run(bedrack, { declared: ['.github/workflows/ci.yml'] }, fps);
    expect(his.verdict).toBe('HALT');
    expect(his.reasons[0].message).toMatch(/fix\/ci-workflow-list-pin/);
  });

  test('a long file list is cut to six plus "+N more" in the message; the files array stays whole', () => {
    const many = Array.from({ length: 10 }, (_, i) => `docs/notes/n${i}.md`);
    const res = run(malede, { declared: many }, [fp({ declared: many })]);
    expect(res.reasons).toHaveLength(1);
    expect(res.reasons[0].files).toHaveLength(10);
    expect(res.reasons[0].message).toMatch(/\+4 more/);
    expect(res.reasons[0].message).not.toMatch(/n9\.md/);
  });

  test('his unclaimed recent branch HALTs like a claim, and says it is unclaimed', () => {
    const res = run(malede, { declared: ['.github/workflows/ci.yml'] }, [fp({ kind: 'unclaimed', slot: null, branch: 'feat/project-explorer-ci', actual: ['.github/workflows/ci.yml'] })]);
    expect(res.verdict).toBe('HALT');
    expect(classes(res)).toEqual(['HALT exact', 'HALT exclusive group']);
    expect(res.reasons[0].message).toMatch(/unclaimed/);
    expect(res.reasons[0].message).toMatch(/feat\/project-explorer-ci/);
  });

  test('disjoint work is CLEAR, and the exit codes are 0 / 3 / 1', () => {
    expect(run(malede, { declared: ['a/b/c.js'] }, [fp({ declared: ['x/y/z.js'] })]).verdict).toBe('CLEAR');
    expect([exitCodeOf('CLEAR'), exitCodeOf('WARN'), exitCodeOf('HALT')]).toEqual([0, 3, 1]);
  });
});

describe('OPS-152 · collide — overlaps() is shared by check, start, --merge and ci', () => {
  test('lists every class between two footprints', () => {
    const out = overlaps(
      { declared: ['AGENTS.md', 'project-explorer/src/a.js'], actual: [], resources: ['res:secrets'], task: 'BE-001' },
      { declared: ['AGENTS.md', 'project-explorer/src/**'], actual: [], resources: ['res:secrets'], task: 'BE-001' },
      rules,
    );
    expect(out.map((o) => o.class).sort()).toEqual(['exact', 'exclusive group', 'glob', 'resource', 'task']);
  });
});

describe('OPS-152 · collide — check --merge', () => {
  const pr = { number: 230, author: { login: 'DanielMalede' }, headRefName: 'feat/m', files: [{ path: 'AGENTS.md' }] };

  test('merging someone else\'s PR → HALT', () => {
    const res = mergeAdvice({ rules, me: malede, pr: { ...pr, author: { login: 'DanielBedrack' } }, runs: [], footprints: [] });
    expect(classes(res)).toEqual(['HALT merge']);
    expect(res.reasons[0].message).toMatch(/merge only your own PRs/);
  });

  test('a push run on main still going → HALT "a deploy is in flight"', () => {
    const res = mergeAdvice({ rules, me: malede, pr, runs: [{ status: 'completed' }, { status: 'in_progress' }], footprints: [] });
    expect(classes(res)).toEqual(['HALT deploy']);
    expect(res.reasons[0].message).toMatch(/a deploy is in flight — wait/);
  });

  const done = [{ status: 'completed' }];
  const mineFp = fp({ branch: 'feat/m', person: malede, slot: 'M02', declared: ['docs/m.md'], firstLedgerTime: NOW - 100 });

  test('N6 · the PR meets his live claim\'s DECLARED paths and his claim came first, or tied → HALT', () => {
    const his = (t) => fp({ declared: ['AGENTS.md'], firstLedgerTime: t });
    const first = mergeAdvice({ rules, me: malede, pr, runs: done, footprints: [mineFp, his(NOW - 5000)], now: NOW });
    expect(classes(first)).toEqual(['HALT merge-order']);
    expect(first.reasons[0].message).toMatch(/was claimed first/);
    const tied = mergeAdvice({ rules, me: malede, pr, runs: done, footprints: [mineFp, his(NOW - 100)], now: NOW });
    expect(classes(tied)).toEqual(['HALT merge-order']);
    expect(tied.reasons[0].message).toMatch(/within ten minutes of yours/);
    const later = mergeAdvice({ rules, me: malede, pr, runs: done, footprints: [mineFp, his(NOW + 5000)], now: NOW });
    expect(classes(later)).toEqual(['WARN needs-main']);
    expect(later.reasons[0].message).toMatch(/he will need main merged in after this lands/);
  });

  test('N6 · his unclaimed branch, or files he changed outside his claim, stay a WARN', () => {
    const unclaimed = fp({ kind: 'unclaimed', slot: null, actual: ['AGENTS.md'] });
    expect(classes(mergeAdvice({ rules, me: malede, pr, runs: done, footprints: [mineFp, unclaimed], now: NOW }))).toEqual(['WARN needs-main']);
    const drifted = fp({ declared: ['x/y/z.js'], actual: ['AGENTS.md'], firstLedgerTime: NOW - 500 });
    expect(classes(mergeAdvice({ rules, me: malede, pr, runs: done, footprints: [mineFp, drifted], now: NOW }))).toEqual(['WARN needs-main']);
  });

  test('L4 · --merge prints real ages', () => {
    const old = fp({ kind: 'unclaimed', slot: null, actual: ['AGENTS.md'], tipTime: NOW - 10 * DAY });
    expect(mergeAdvice({ rules, me: malede, pr, runs: done, footprints: [old], now: NOW }).reasons[0].message).toMatch(/10 days old/);
  });

  test('a PR whose head is HIS branch is not mine to merge, whoever opened it → HALT', () => {
    const onHisBranch = { ...pr, headRefName: 'feat/b' }; // I opened it; the branch carries his claim
    const his = fp({ branch: 'feat/b', declared: ['docs/his.md'], actual: ['docs/his.md'] });
    const res = mergeAdvice({ rules, me: malede, pr: onHisBranch, runs: done, footprints: [his], now: NOW });
    expect(classes(res)).toEqual(['HALT merge']);
    expect(res.reasons[0]).toMatchObject({ person: 'Bedrack', branch: 'feat/b', slot: 'B01' });
    expect(res.reasons[0].message).toMatch(/PR #230's head feat\/b carries Bedrack's work/);
    // his unclaimed work on that branch counts as much as his claim
    const unclaimed = fp({ kind: 'unclaimed', slot: null, branch: 'feat/b', actual: ['docs/his.md'] });
    expect(classes(mergeAdvice({ rules, me: malede, pr: onHisBranch, runs: done, footprints: [unclaimed], now: NOW }))).toEqual(['HALT merge']);
    // my own footprint on my head is what I am merging
    expect(mergeAdvice({ rules, me: malede, pr, runs: done, footprints: [mineFp], now: NOW }).verdict).toBe('CLEAR');
  });

  test('nothing in the way → CLEAR', () => {
    expect(mergeAdvice({ rules, me: malede, pr, runs: [{ status: 'completed' }], footprints: [] }).verdict).toBe('CLEAR');
  });
});

describe('res:prod-deploy · collide — a production freeze stops every merge to main', () => {
  const { FREEZE_RESOURCE, freezeHolders } = lib('collide.js');
  const { renderStatus } = lib('render.js');
  const pr = { number: 231, author: { login: 'DanielMalede' }, headRefName: 'feat/m', files: [{ path: 'docs/m.md' }] };
  const done = [{ status: 'completed' }];
  const mineFp = fp({ branch: 'feat/m', person: malede, slot: 'M02', declared: ['docs/m.md'], firstLedgerTime: NOW - 100 });
  // A claim holding the freeze: disjoint paths, so nothing but the freeze can meet the PR.
  const hold = (over = {}) => fp({ declared: ['docs/recount.md'], resources: ['res:prod-deploy'], task: 'OPS-300', firstLedgerTime: NOW - 5000, ...over });
  const ownHold = (over = {}) => hold({ branch: 'chore/recount', person: malede, slot: 'M03', ...over });
  const merge = (footprints, over = {}) => mergeAdvice({ rules, me: malede, pr: { ...pr, ...over }, runs: done, footprints, now: NOW });

  test('the resource the engine reads is the one the ledger lists', () => {
    expect(FREEZE_RESOURCE).toBe('res:prod-deploy');
    expect(rules.resources).toContain(FREEZE_RESOURCE);
  });

  test('my OWN claim on another branch holding it HALTs --merge, unlike every other collision', () => {
    const res = merge([mineFp, ownHold()]);
    expect(classes(res)).toEqual(['HALT freeze']);
    expect(res.reasons[0]).toMatchObject({ person: 'Malede', login: 'DanielMalede', branch: 'chore/recount', slot: 'M03' });
    expect(res.reasons[0].message).toBe('Malede (@DanielMalede): live claim M03 on branch chore/recount for OPS-300 holds `res:prod-deploy` — production is frozen, and a merge to main deploys: PR #231 waits until that claim lands or its branch is deleted');
  });

  test('his claim holding it HALTs --merge, naming him, the branch, the slot and the task', () => {
    const res = merge([mineFp, hold()]);
    expect(classes(res)).toEqual(['HALT freeze']);
    expect(res.reasons[0]).toMatchObject({ person: 'Bedrack', login: 'DanielBedrack', branch: 'feat/b', slot: 'B01' });
    expect(res.reasons[0].message).toMatch(/^Bedrack \(@DanielBedrack\): live claim B01 on branch feat\/b for OPS-300 holds `res:prod-deploy`/);
  });

  test('a claim whose owner maps to nobody, or written in another case, still holds it: the freeze fails closed', () => {
    const unknown = hold({ person: null, branch: 'chore/who', slot: null, author: { name: 'x', email: 'x@y.z' }, resources: ['RES:Prod-Deploy'] });
    const res = merge([mineFp, unknown]);
    expect(classes(res)).toEqual(['HALT freeze']);
    expect(res.reasons[0].message).toMatch(/^owner unknown — author x <x@y\.z>: live claim on branch chore\/who for OPS-300 holds `res:prod-deploy`/);
  });

  test('the PR\'s own branch holding it does not block itself: the freeze ends when that work lands', () => {
    expect(merge([ownHold({ branch: 'feat/m', slot: 'M02' })]).verdict).toBe('CLEAR');
    expect(merge([hold({ branch: 'feat/m' })], { headRefName: 'feat/m' }).reasons.map((r) => r.class)).not.toContain('freeze');
  });

  test('no freeze → --merge is unchanged', () => {
    expect(merge([mineFp, ownHold({ resources: ['res:atlas-prod'] })]).verdict).toBe('CLEAR');
    expect(merge([mineFp, hold({ resources: ['res:atlas-prod'] })]).verdict).toBe('CLEAR');
    expect(merge([mineFp, fp({ kind: 'unclaimed', slot: null, actual: ['docs/other.md'] })]).verdict).toBe('CLEAR');
  });

  test('check and start keep the normal resource rules for a claim that declares it', () => {
    // his claim holds it and mine declares it: the ordinary resource collision, not a freeze
    expect(classes(run(malede, { declared: ['a/b/c.js'], resources: ['res:prod-deploy'] }, [hold()]))).toEqual(['HALT resource']);
    // my own other claim holding it: my own section never collides with me, as for every resource
    expect(run(malede, { declared: ['a/b/c.js'], resources: ['res:prod-deploy'] }, [ownHold()]).verdict).toBe('CLEAR');
    // a check that does not declare it is not stopped by his freeze: only a merge is
    expect(run(malede, { declared: ['a/b/c.js'] }, [hold()]).verdict).toBe('CLEAR');
  });

  test('ci is unchanged: a freeze held elsewhere, his or the author\'s own, adds nothing', () => {
    const headText = setSlot(freeText, 'B01', {
      task: 'own:pe', taskKind: 'own', title: 't', branch: 'feat/b', paths: ['project-explorer/src/**'], resources: [], state: 'claimed', pr: null, started: '2026-10-06',
    });
    const selfFp = fp({ declared: ['project-explorer/src/**'], actual: ['project-explorer/src/app.js', 'WORK_LEDGER.md'], firstLedgerTime: NOW - 100 });
    const res = ciEvaluate({
      rules,
      author: bedrack,
      branch: 'feat/b',
      headLedgerText: headText,
      baseLedgerText: freeText,
      baseTasks: MAIN_TASKS,
      headTasks: MAIN_TASKS,
      footprints: [selfFp, ownHold(), hold({ branch: 'feat/b2', slot: 'B02' })],
      mode: 'fail',
      now: NOW,
    });
    expect(res).toEqual({ verdict: 'CLEAR', reasons: [] });
  });

  test('freezeHolders: every live claim holding it, except on the branch named', () => {
    const fps = [mineFp, ownHold(), hold(), fp({ kind: 'unclaimed', branch: 'feat/u', slot: null, actual: ['docs/u.md'] })];
    expect(freezeHolders(fps).map((f) => f.branch)).toEqual(['chore/recount', 'feat/b']);
    expect(freezeHolders(fps, 'feat/b').map((f) => f.branch)).toEqual(['chore/recount']);
    expect(freezeHolders([mineFp])).toEqual([]);
  });

  test('status puts an active freeze at the top; with none it says nothing about one', () => {
    const view = {
      people: [{ name: 'Malede', login: 'DanielMalede', section: 'M', claims: [], unclaimed: [] }],
      unknown: [],
      freeze: [
        { person: 'Malede', login: 'DanielMalede', slot: 'M03', branch: 'chore/recount', task: 'OPS-300' },
        { person: null, login: null, slot: null, branch: 'chore/who', task: null },
      ],
    };
    const lines = renderStatus(view).split('\n');
    expect(lines[0]).toBe('production freeze: held by Malede (@DanielMalede) on chore/recount (M03, OPS-300) — check --merge refuses every merge to main while it is held');
    expect(lines[1]).toBe('production freeze: held by owner unknown on chore/who (no slot, no task) — check --merge refuses every merge to main while it is held');
    expect(lines[2]).toBe('');
    expect(lines[3]).toBe('== Malede (@DanielMalede) — section M ==');
    expect(renderStatus({ ...view, freeze: [] })).not.toMatch(/production freeze/);
    expect(renderStatus({ people: view.people, unknown: [] })).not.toMatch(/production freeze/);
  });
});

describe('OPS-152 · collide — ci', () => {
  const claim = (branch, over = {}) => ({
    task: 'own:pe', taskKind: 'own', title: 't', branch, paths: ['project-explorer/src/**'], resources: [], state: 'claimed', pr: null, started: '2026-10-06', ...over,
  });
  const headText = setSlot(freeText, 'B01', claim('feat/b'));
  const selfFp = fp({ declared: ['project-explorer/src/**'], actual: ['project-explorer/src/app.js', 'WORK_LEDGER.md'], firstLedgerTime: NOW - 100 });

  const ci = (over = {}) => ciEvaluate({
    rules,
    author: bedrack,
    branch: 'feat/b',
    headLedgerText: headText,
    baseLedgerText: freeText,
    baseTasks: MAIN_TASKS,
    headTasks: MAIN_TASKS,
    footprints: [selfFp],
    mode: 'fail',
    ...over,
  });
  const ciClasses = (res) => res.reasons.map((r) => `${r.level} ${r.class}`).sort();

  test('a clean claimed branch passes', () => {
    expect(ci().verdict).toBe('CLEAR');
  });

  test('(1) a branch with no live claim in the author\'s section fails', () => {
    expect(ciClasses(ci({ footprints: [] }))).toEqual(['FAIL unclaimed']);
    expect(ciClasses(ci({ footprints: [{ ...selfFp, person: malede }] }))).toEqual(['FAIL unclaimed']);
  });

  test('(2) the ledger guard: editing the other section fails', () => {
    const res = ci({ headLedgerText: setSlot(headText, 'M02', claim('feat/b')) });
    expect(ciClasses(res)).toEqual(expect.arrayContaining(['FAIL ledger']));
  });

  test('(3) TASKS ids: Bedrack adds only 900–999; Malede never takes 900–999', () => {
    const add = (id) => `${MAIN_TASKS}- [ ] \`${id}\` \`P2\` new.\n  - where: x\n`;
    expect(ci({ headTasks: add('BE-905') }).verdict).toBe('CLEAR');
    expect(ciClasses(ci({ headTasks: add('BE-120') }))).toEqual(['FAIL tasks-id']);

    const malHead = setSlot(freeText, 'M02', claim('feat/m'));
    const malFp = fp({ branch: 'feat/m', person: malede, slot: 'M02', declared: ['project-explorer/src/**'], actual: [] });
    const asMalede = (id) => ci({ author: malede, branch: 'feat/m', headLedgerText: malHead, footprints: [malFp], headTasks: add(id) });
    expect(asMalede('BE-120').verdict).toBe('CLEAR');
    expect(ciClasses(asMalede('BE-950'))).toEqual(['FAIL tasks-id']);
  });

  test('(4) a changed file outside the declared paths is drift; shared files and coupled rows are covered', () => {
    const res = ci({ footprints: [{ ...selfFp, actual: ['project-explorer/src/app.js', 'backend/app/index.js', 'TASKS.md'] }] });
    expect(ciClasses(res)).toEqual(['FAIL drift']);
    expect(res.reasons[0].files).toEqual(['backend/app/index.js']);

    const coupled = ci({ footprints: [{ ...selfFp, declared: ['.github/workflows/ci.yml'], actual: ['.github/workflows/ci.yml', 'backend/tests/ciWorkflowPermissions.test.js'] }] });
    expect(coupled.verdict).toBe('CLEAR');
  });

  test('(5) overlap with his live claim: the earlier first ledger commit wins', () => {
    const his = fp({ person: malede, slot: 'M02', branch: 'feat/m', declared: ['project-explorer/src/app.js'], firstLedgerTime: NOW - 5000 });
    const lost = ci({ footprints: [selfFp, his] });
    expect(ciClasses(lost)).toEqual(['FAIL overlap']);
    expect(lost.reasons[0].message).toMatch(/his claim was committed first/);
    const later = { ...his, firstLedgerTime: NOW + 5000 };
    expect(ci({ footprints: [selfFp, later] }).verdict).toBe('CLEAR');
  });

  test('N14 · two claims first committed within ten minutes of each other are a tie: both fail', () => {
    for (const t of [NOW - 100 - 600, NOW - 100 + 600, NOW - 100]) {
      const his = fp({ person: malede, slot: 'M02', branch: 'feat/m', declared: ['project-explorer/src/app.js'], firstLedgerTime: t });
      const res = ci({ footprints: [selfFp, his] });
      expect({ t, classes: ciClasses(res) }).toEqual({ t, classes: ['FAIL overlap'] });
      expect(res.reasons[0].message).toMatch(/within ten minutes/);
    }
  });

  test('L4 · ci prints real ages', () => {
    const his = fp({ kind: 'unclaimed', slot: null, person: malede, branch: 'feat/m', actual: ['project-explorer/src/app.js'], tipTime: NOW - 10 * DAY });
    expect(ci({ footprints: [selfFp, his], now: NOW }).reasons[0].message).toMatch(/10 days old/);
  });

  test('(5) overlap with his unclaimed branch is a WARN', () => {
    const his = fp({ kind: 'unclaimed', slot: null, person: malede, branch: 'feat/m', actual: ['project-explorer/src/app.js'] });
    expect(ciClasses(ci({ footprints: [selfFp, his] }))).toEqual(['WARN overlap']);
  });

  test('(6) Bedrack changing an owner-only path fails', () => {
    const res = ci({ footprints: [{ ...selfFp, declared: ['project-explorer/src/**', '.claude/agents/x.md'], actual: ['.claude/agents/x.md'] }] });
    expect(ciClasses(res)).toEqual(['FAIL owner-only']);
  });

  test('--mode warn turns every FAIL into a WARN', () => {
    const res = ci({ footprints: [], mode: 'warn' });
    expect(res.verdict).toBe('WARN');
    expect(ciClasses(res)).toEqual(['WARN unclaimed']);
  });
});

describe('OPS-152 · collide — the race rule', () => {
  test('the earlier first ledger commit wins; a tie is nobody\'s win', () => {
    expect(firstClaimWins(100, 100 + 3600)).toBe('mine');
    expect(firstClaimWins(100 + 3600, 100)).toBe('theirs');
    expect(firstClaimWins(200, 200)).toBe('tie');
    // N14: committer dates come from two local clocks; ten minutes apart or less cannot be ordered
    expect(firstClaimWins(1000, 1000 + 600)).toBe('tie');
    expect(firstClaimWins(1000 + 600, 1000)).toBe('tie');
    expect(firstClaimWins(1000, 1000 + 601)).toBe('mine');
    expect(firstClaimWins(1000 + 601, 1000)).toBe('theirs');
    // an unknown time on EITHER side is nobody's win
    expect(firstClaimWins(null, 200)).toBe('tie');
    expect(firstClaimWins(100, null)).toBe('tie');
  });

  test('age reads as English', () => {
    expect(ageText(NOW - 3600, NOW)).toBe('less than a day old');
    expect(ageText(NOW - DAY - 5, NOW)).toBe('1 day old');
    expect(ageText(NOW - 3 * DAY, NOW)).toBe('3 days old');
  });
});

describe('OPS-152 · collide — a status line a real claim writes is read back as taken', () => {
  test('the coordinator\'s own status line on main names a live branch → the next claimant HALTs', () => {
    const line = statusLine({ name: 'Bedrack', login: 'DanielBedrack', branch: 'feat/b', since: '2026-10-06', slot: 'B01' });
    const tasks = setStatusLine(MAIN_TASKS, 'BE-001', line);
    const hisClaim = fp({ branch: 'feat/b', declared: ['x/y/z.js'] }); // N10: the branch is live because his claim is
    const res = run(malede, { declared: ['a/b/c.js'], task: 'BE-001', taskKind: 'TASKS' }, [hisClaim], { mainTasks: tasks });
    expect(classes(res)).toEqual(['HALT task']);
  });
});

describe('OPS-155 · collide — a claim is never half-read or hidden', () => {
  const HIS = { name: 'DanielBedrack', email: '111690772+DanielBedrack@users.noreply.github.com' };
  const MINE = { name: 'Full Stack Developer', email: '102303436+DanielMalede@users.noreply.github.com' };
  const main = parseLedger(freeText);
  const claim = (branch, over = {}) => ({
    task: 'own:x', taskKind: 'own', title: 't', branch, paths: ['AGENTS.md'], resources: [], state: 'claimed', pr: null, started: '2026-10-06', ...over,
  });
  const branch = (name, over = {}) => ({
    name, headLedgerText: null, baseLedgerText: freeText, merged: false, contentMerged: false, prDone: false,
    changed: ['WORK_LEDGER.md'], tipTime: NOW - DAY, author: HIS, ...over,
  });
  const derive = (b, extra = {}) => deriveFootprints({ mainLedger: main, rules, now: NOW, branches: [b], ...extra });

  test('A5 · a hand-written Windows folder with a trailing backslash is a folder claim', () => {
    const fps = derive(branch('feat/slash', { headLedgerText: setSlot(freeText, 'B04', claim('feat/slash', { paths: ['project-explorer\\src\\'] })) }));
    expect(fps[0]).toMatchObject({ declared: ['project-explorer/src/**'], malformed: false });
    expect(classes(run(malede, { declared: ['project-explorer/src/a.js'] }, fps))).toEqual(['HALT glob']);
  });

  test('A6 · a partly broken claim warns on its own, naming the tokens it dropped', () => {
    const fps = derive(branch('feat/half', { headLedgerText: setSlot(freeText, 'B04', claim('feat/half', { paths: ['../escape.js', 'docs/ok.md'] })) }));
    expect(fps[0]).toMatchObject({ declared: ['docs/ok.md'], malformed: true, dropped: ['../escape.js'] });
    const res = run(malede, { declared: ['x/y/z.js'] }, fps);
    expect(classes(res)).toEqual(['WARN malformed']);
    expect(res.reasons[0]).toMatchObject({ person: 'Bedrack', branch: 'feat/half', slot: 'B04' });
    expect(res.reasons[0].message).toMatch(/`\.\.\/escape\.js`/);
    expect(res.reasons[0].message).toMatch(/not checked/);
    // and it still collides on what it does name
    expect(classes(run(malede, { declared: ['docs/ok.md'] }, fps))).toEqual(['HALT exact', 'WARN malformed']);
  });

  test('A6 · a slot that does not parse warns too; a token it cannot read is named', () => {
    const broken = freeText.replace('### B02\n_free_\n', '### B02\n- task: `own:x` (own)\n- branch: `feat/broken`\n- paths: `../up.js`, `AGENTS.md`\n');
    const fps = derive(branch('feat/broken', { headLedgerText: broken }));
    expect(fps[0]).toMatchObject({ malformed: true, declared: ['AGENTS.md'], dropped: ['../up.js'] });
    const res = run(malede, { declared: ['x/y/z.js'] }, fps);
    expect(classes(res)).toEqual(['WARN malformed']);
    expect(res.reasons[0].message).toMatch(/`\.\.\/up\.js`/);
  });

  describe('N8 · a branch\'s ledger is read with main\'s People table and section headings', () => {
    const filled = setSlot(freeText, 'B02', claim('feat/hid'));
    const hidden = (text) => {
      const fps = derive(branch('feat/hid', { headLedgerText: text }));
      expect(fps).toHaveLength(1);
      expect(fps[0]).toMatchObject({ kind: 'claim', malformed: true, slot: 'B02', declared: ['AGENTS.md'], task: 'own:x' });
      expect(fps[0].person).toBe(bedrack);
      const res = run(malede, { declared: ['AGENTS.md'] }, fps);
      expect(res.verdict).toBe('HALT');
      expect(res.reasons.map((r) => r.message).join('\n')).toMatch(/does not parse/);
      return fps[0];
    };

    test('a renamed section heading does not hide the claim under it', () => {
      expect(filled).toMatch(/\n## Bedrack\n/);
      const fp0 = hidden(filled.replace('\n## Bedrack\n', '\n## Bedrack (away)\n'));
      expect(fp0.malformedWhy).toMatch(/## Bedrack/);
    });

    test('a branch that renames its own People row and heading does not hide the claim', () => {
      const text = filled.replace('| `DanielBedrack` | Bedrack |', '| `DanielBedrack` | Bedrack D. |').replace('\n## Bedrack\n', '\n## Bedrack D.\n');
      expect(text).not.toMatch(/\| Bedrack \|/);
      hidden(text);
    });

    test('fewer slots than main is malformed, and the claim is salvaged', () => {
      const fewer = filled.replace('### B05\n_free_\n\n', '');
      expect(fewer).not.toBe(filled);
      expect(hidden(fewer).malformedWhy).toMatch(/B05/);
    });

    test('a renamed heading with no claim under it still counts: it names no path, so it HALTs', () => {
      const fps = derive(branch('feat/renamed', { headLedgerText: freeText.replace('\n## Bedrack\n', '\n## Bedrack (away)\n') }));
      expect(fps).toHaveLength(1);
      expect(fps[0]).toMatchObject({ kind: 'claim', malformed: true, declared: [] });
      expect(fps[0].person).toBe(bedrack); // no slot names him, so the branch's committer decides
      expect(classes(run(malede, { declared: ['x/y/z.js'] }, fps))).toEqual(['HALT malformed']);
    });

    test('M3 · a broken ledger stacked on my branch is salvaged from HIS claim — the block naming his branch — and is his', () => {
      // feat/his is cut from my feat/mine (my claim in M03, not yet on main) and claims B02; then its
      // section heading is renamed. Read against main, both M03 and B02 changed.
      const mine = setSlot(freeText, 'M03', claim('feat/mine', { paths: ['docs/mine/a.md'] }));
      const stacked = setSlot(mine, 'B02', claim('feat/his', { paths: ['docs/his/b.md'] })).replace('\n## Bedrack\n', '\n## Bedrack (away)\n');
      const fps = derive(branch('feat/his', { headLedgerText: stacked }));
      expect(fps).toHaveLength(1);
      expect(fps[0]).toMatchObject({ kind: 'claim', malformed: true, slot: 'B02', declared: ['docs/his/b.md'] });
      expect(fps[0].person).toBe(bedrack);
      expect(classes(run(malede, { declared: ['docs/his/b.md'] }, fps))).toEqual(['HALT exact', 'WARN malformed']);
    });

    test('M3 · the branch\'s owner decides over a slot letter: his claim written into an M slot is still his', () => {
      const misplaced = setSlot(freeText, 'M04', claim('feat/his', { paths: ['docs/his/c.md'] })).replace('\n## Bedrack\n', '\n## Bedrack (away)\n');
      const fps = derive(branch('feat/his', { headLedgerText: misplaced, committer: HIS }));
      expect(fps[0]).toMatchObject({ slot: 'M04', declared: ['docs/his/c.md'] });
      expect(fps[0].person).toBe(bedrack);
      expect(run(malede, { declared: ['docs/his/c.md'] }, fps).verdict).toBe('HALT');
      // with no owner to be had from the commit or a PR, the slot letter still names one
      const anon = derive(branch('feat/his', { headLedgerText: misplaced, author: { name: 'Laptop', email: 'root@laptop' } }));
      expect(anon[0].person).toBe(malede);
    });

    test('a slot main added after the branch forked is not a missing slot', () => {
      const grown = `${freeText}\n### B07\n_free_\n`;
      const fps = deriveFootprints({ mainLedger: parseLedger(grown), rules: parseLedger(grown), now: NOW, branches: [branch('feat/old-base', { headLedgerText: setSlot(freeText, 'B02', claim('feat/old-base')) })] });
      expect(fps).toHaveLength(1);
      expect(fps[0]).toMatchObject({ kind: 'claim', slot: 'B02', malformed: false });
    });

    test('a branch that never touched its ledger is judged as before, whatever main did since', () => {
      const grown = `${freeText}\n### B07\n_free_\n`;
      const fps = deriveFootprints({ mainLedger: parseLedger(grown), rules: parseLedger(grown), now: NOW, branches: [branch('feat/plain', { headLedgerText: freeText, changed: ['docs/a/b.md'] })] });
      expect(fps.map((f) => [f.kind, f.malformed || false])).toEqual([['unclaimed', false]]);
    });
  });

  test('N12 · the owner of an unclaimed branch is its committer first, then its author; GitHub\'s web-flow committer is skipped', () => {
    const webFlow = { name: 'GitHub', email: 'noreply@github.com' };
    const unknown = { name: 'Laptop', email: 'root@laptop' };
    expect(ownerOfCommit(rules.people, { committer: HIS, author: MINE })).toBe(bedrack); // he cherry-picked my commit
    expect(ownerOfCommit(rules.people, { committer: webFlow, author: HIS })).toBe(bedrack); // a merge made in GitHub's web UI
    expect(ownerOfCommit(rules.people, { committer: unknown, author: MINE })).toBe(malede); // an unmapped committer falls back
    expect(ownerOfCommit(rules.people, { author: MINE })).toBe(malede);
    // web-flow is skipped by its email, whatever name it carries
    const people = rules.people.map((p) => (p.login === 'DanielMalede' ? { ...p, gitAuthors: [...p.gitAuthors, 'GitHub'] } : p));
    expect(ownerOfCommit(people, { committer: webFlow, author: HIS }).login).toBe('DanielBedrack');
    const fps = derive(branch('feat/cherry', { headLedgerText: null, baseLedgerText: null, changed: ['docs/cherry/x.md'], author: MINE, committer: HIS }));
    expect(fps[0].person).toBe(bedrack);
    expect(classes(run(malede, { declared: ['docs/cherry/x.md'] }, fps))).toEqual(['HALT exact']);
  });
});
