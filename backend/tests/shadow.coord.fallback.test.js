'use strict';

// RA-2 (#257) · shadow guard for the open list's fallback (OPS-221, option o5): at the open list's
// limit, a partner's open PR that only his own `--author` list carries still keeps his branch in
// view. The engine runs in process (`status --json`, as coord.e2e test 16 runs `main`) over a fake
// origin and a fake GitHub with gh's list semantics (newest first, --state, --author, --limit). Every
// function of the git and gh adapters is replaced for the test: nothing is spawned, no host is called.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LIB = path.join(REPO_ROOT, 'scripts', 'coord', 'lib');
const git = require(path.join(LIB, 'git.js'));
const gh = require(path.join(LIB, 'gh.js'));
const C = require(path.join(LIB, 'collide.js'));
const { main } = require(path.join(REPO_ROOT, 'scripts', 'coord', 'coord.js'));

const LEDGER = fs.readFileSync(path.join(REPO_ROOT, 'WORK_LEDGER.md'), 'utf8');
const DAY = 86400;
const BRANCH = 'feat/fallback-only';
const BRANCH_REF = `refs/remotes/origin/${BRANCH}`;
const TIP = 'f'.repeat(40);
const HIS = { name: 'DanielBedrack', email: '111690772+DanielBedrack@users.noreply.github.com' };

const original = { git: { ...git }, gh: { ...gh } };
afterEach(() => {
  Object.assign(git, original.git);
  Object.assign(gh, original.gh);
});

// GitHub as gh lists it: newest first, by state and author, cut at --limit.
const lister = (prs) => ({ state, author = null, limit }) => prs
  .filter((p) => state === 'all' || p.state === 'OPEN')
  .filter((p) => !author || p.author.login.toLowerCase() === author.toLowerCase())
  .sort((a, b) => b.number - a.number)
  .slice(0, limit);

// Origin holds main and one branch of his: cut from main, one commit 40 days old, its ledger
// untouched. The clone was made after his push, so nothing says it saw the branch move.
function world(prs) {
  for (const k of Object.keys(git)) if (typeof git[k] === 'function') git[k] = () => { throw new Error(`unexpected git.${k}`); };
  for (const k of Object.keys(gh)) if (typeof gh[k] === 'function') gh[k] = () => { throw new Error(`unexpected gh.${k}`); };
  const now = Math.floor(Date.now() / 1000);
  Object.assign(git, {
    topLevel: () => '/fake/repo',
    isShallow: () => false,
    fetch: () => ({ code: 0, stdout: '', stderr: '' }),
    showFile: (_cwd, _ref, rel) => (rel === 'WORK_LEDGER.md' ? LEDGER : null),
    commonDir: () => '/fake/repo/.git',
    cloneBirth: () => null,
    reflogTime: () => null,
    remoteBranches: () => [
      { name: 'main', tipTime: now, author: HIS, committer: HIS, sha: 'a'.repeat(40) },
      { name: BRANCH, tipTime: now - 40 * DAY, author: HIS, committer: HIS, sha: TIP },
    ],
    mergeBase: () => 'b'.repeat(40),
    diffNames: () => ['docs/fallback/x.md'],
    isAncestor: () => false,
    treeBlobs: (_cwd, ref) => (ref === BRANCH_REF ? { 'WORK_LEDGER.md': 'l', 'docs/fallback/x.md': 'x' } : { 'WORK_LEDGER.md': 'l' }),
  });
  const list = lister(prs);
  Object.assign(gh, {
    prListOpen: () => list({ state: 'open', limit: gh.OPEN_LIMIT }),
    prList: () => list({ state: 'all', limit: gh.ALL_LIMIT }),
    prListOpenBy: (_cwd, login) => list({ state: 'open', author: login, limit: gh.OPEN_LIMIT }),
  });
}

function statusJson() {
  const chunks = [];
  const write = process.stdout.write;
  process.stdout.write = (s) => { chunks.push(String(s)); return true; };
  let code;
  try {
    code = main(['status', '--json'], '/fake/repo');
  } finally {
    process.stdout.write = write;
  }
  return { code, view: JSON.parse(chunks.join('')) };
}

const pr = (number, over = {}) => ({
  number, state: 'CLOSED', headRefName: `old/${number}`, headRefOid: String(number).padStart(40, '0'),
  isDraft: false, author: { login: 'DanielMalede' }, isCrossRepository: false, ...over,
});
// 300 closed PRs of this repository, then 100 open PRs from a stranger's fork: both windows full.
const flood = () => [
  ...Array.from({ length: 300 }, (_, i) => pr(2000 + i)),
  ...Array.from({ length: 100 }, (_, i) => pr(3000 + i, { state: 'OPEN', headRefName: `patch-${i}`, author: { login: 'stranger' }, isCrossRepository: true })),
];
// the open PR on his branch, older than every PR in either window
const onHisBranch = (over = {}) => pr(1500, { state: 'OPEN', headRefName: BRANCH, headRefOid: TIP, author: { login: 'DanielBedrack' }, ...over });

describe('RA-2 · shadow · at the open list\'s limit, his own --author list keeps his branch in view', () => {
  test('his open PR is in neither window, only in his own list: his 40-day-old branch is still his live work', () => {
    world([...flood(), onHisBranch()]);
    expect(gh.prListOpen()).toHaveLength(gh.OPEN_LIMIT);
    expect(gh.prListOpen().map((p) => p.number)).not.toContain(1500);
    expect(gh.prList().map((p) => p.number)).not.toContain(1500);
    expect(gh.prListOpenBy('/fake/repo', 'DanielBedrack').map((p) => p.number)).toEqual([1500]);

    const { code, view } = statusJson();
    expect(code).toBe(0);
    expect(view.people.find((p) => p.login === 'DanielBedrack').unclaimed.map((u) => u.branch)).toEqual([BRANCH]);
    expect(view.notes).toEqual([C.PR_FALLBACK_NOTE]);
  });

  test('the residual the note names: the same PR opened by someone outside People is in no list, and the branch drops on its dates', () => {
    world([...flood(), onHisBranch({ author: { login: 'someone-else' } })]);
    const { code, view } = statusJson();
    expect(code).toBe(0);
    expect(view.people.flatMap((p) => p.unclaimed.map((u) => u.branch))).toEqual([]);
    expect(view.unknown).toEqual([]);
    expect(view.notes).toEqual([C.RECENCY_NOTE, C.PR_FALLBACK_NOTE]);
  });
});

// RA-10 (#257) · below the open list's limit, the open list is the only list that carries an open
// PR older than the newest 300 PRs (the all-states list may now be cut), so gather must merge it
// into the PR set (scripts/coord/coord.js:214). Passes at H; fails against
// `prs = C.mergePrLists(all, ...Object.values(byAuthor || {}))`, and if any per-person list is
// asked for below the limit.
describe('RA-10 · shadow · below the open list\'s limit, the open list keeps an open PR the all-states window has cut', () => {
  test('his open PR is older than the newest 300 PRs: only the open list carries it, and his 40-day-old branch stays in view', () => {
    world([...Array.from({ length: 300 }, (_, i) => pr(2000 + i)), onHisBranch()]);
    gh.prListOpenBy = () => { throw new Error('unexpected gh.prListOpenBy below the open list\'s limit'); };
    expect(gh.prListOpen().map((p) => p.number)).toEqual([1500]);
    expect(gh.prList()).toHaveLength(gh.ALL_LIMIT);
    expect(gh.prList().map((p) => p.number)).not.toContain(1500);

    const { code, view } = statusJson();
    expect(code).toBe(0);
    expect(view.people.find((p) => p.login === 'DanielBedrack').unclaimed.map((u) => u.branch)).toEqual([BRANCH]);
    expect(view.notes).toEqual([]);
  });
});
