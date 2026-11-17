'use strict';

// RA-3 (#257) · shadow guard: the open-list fallback's note must say what the engine does with a
// branch whose open PR no list carries. It is judged as if it had no open PR: a newer PR of this
// repository on the same name, merged or closed at the branch's tip, finishes it however recent its
// commits are, so "judged by its dates alone" is not what happens. RED until the note says so.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const lib = (name) => require(path.join(REPO_ROOT, 'scripts', 'coord', 'lib', name));
const { parseLedger } = lib('ledger.js');
const C = lib('collide.js');

const NOW = 1791300000; // fixed: the engine never reads a clock
const DAY = 86400;
const TIP = 'c'.repeat(40);
const BRANCH = 'feat/two-prs';

test('RA-3 · a day-old branch whose open PR is missing, with a newer PR of this repository closed at its tip, drops out, and the note does not promise "dates alone"', () => {
  const rules = parseLedger(fs.readFileSync(path.join(REPO_ROOT, 'WORK_LEDGER.md'), 'utf8'));
  const listed = [{
    number: 600, state: 'CLOSED', headRefName: BRANCH, headRefOid: TIP, isDraft: false,
    author: { login: 'DanielBedrack' }, isCrossRepository: false,
  }];
  const fps = C.deriveFootprints({
    mainLedger: rules,
    rules,
    now: NOW,
    branches: [{
      name: BRANCH, sha: TIP, tipTime: NOW - DAY, seenTime: null, headLedgerText: null, baseLedgerText: null,
      changed: ['docs/two/x.md'], merged: false, contentMerged: false,
      author: { name: 'DanielBedrack', email: '111690772+DanielBedrack@users.noreply.github.com' },
      prDone: () => C.prDoneFor(listed, BRANCH, TIP),
      prOpen: () => C.prOpenFor(listed, BRANCH),
      prAuthor: () => C.prAuthorFor(listed, BRANCH, TIP),
    }],
  });
  expect(fps).toEqual([]);
  expect(C.PR_FALLBACK_NOTE).not.toMatch(/dates alone/);
});
