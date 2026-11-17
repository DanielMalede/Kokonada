'use strict';

// RA-5 (#257) · shadow guard: the two invariants OPS-221 and OPS-222 rest on, as properties.
// D1 · gh lists newest first, so a cut all-states list is the newest k PRs. With the open list whole,
//      a decision on the cut list can only turn "finished" into "not finished": prDoneFor on the cut
//      list implies prDoneFor on the whole list, and prOpenFor is the same on both.
// F  · a PR from another repository, or one that does not say which it is, changes no helper's answer.

const path = require('path');
const fc = require('fast-check');

const C = require(path.join(__dirname, '..', '..', 'scripts', 'coord', 'lib', 'collide.js'));

const HEADS = ['feat/a', 'feat/b', 'docs/c'];
const SHAS = ['1'.repeat(40), '2'.repeat(40), '3'.repeat(40)];

const arbPr = fc.record({
  state: fc.constantFrom('OPEN', 'CLOSED', 'MERGED'),
  headRefName: fc.constantFrom(...HEADS),
  headRefOid: fc.constantFrom(...SHAS),
  login: fc.constantFrom('DanielMalede', 'DanielBedrack', 'stranger'),
  cross: fc.constantFrom(false, true, undefined),
});

const build = (specs, first = 1) => specs.map((s, i) => {
  const p = { number: first + i, state: s.state, headRefName: s.headRefName, headRefOid: s.headRefOid, isDraft: false, author: { login: s.login } };
  if (s.cross !== undefined) p.isCrossRepository = s.cross;
  return p;
});
const newestFirst = (prs) => prs.slice().sort((a, b) => b.number - a.number);

// The case D1 is about, checked on every run: two finished PRs of this repository on one head, the
// newer one at the tip and the older one not, with the cut between them. Random generation reaches it
// in about four cases in a thousand, so 500 runs alone let forHead sorting oldest first pass about one
// run in six (5 of 30, measured 2026-10-18).
const CUT_BETWEEN_TWO_FINISHED = [[
  { state: 'CLOSED', headRefName: 'feat/a', headRefOid: SHAS[0], login: 'DanielMalede', cross: false },
  { state: 'CLOSED', headRefName: 'feat/a', headRefOid: SHAS[2], login: 'DanielMalede', cross: false },
], 1, SHAS[2]];

describe('RA-5 · shadow · the PR-list invariants of OPS-221 and OPS-222', () => {
  test('D1 · with the open list whole, a cut all-states list never finishes a branch the whole list does not', () => {
    fc.assert(fc.property(fc.array(arbPr, { maxLength: 40 }), fc.nat({ max: 40 }), fc.constantFrom(...SHAS), (specs, k, tip) => {
      const all = build(specs);
      const open = newestFirst(all.filter((p) => p.state === 'OPEN'));
      const whole = C.mergePrLists(all, open);
      const cut = C.mergePrLists(newestFirst(all).slice(0, k), open);
      for (const b of HEADS) {
        if (C.prDoneFor(cut, b, tip)) expect(C.prDoneFor(whole, b, tip)).toBe(true);
        expect(C.prOpenFor(cut, b)).toBe(C.prOpenFor(whole, b));
      }
    }), { numRuns: 500, examples: [CUT_BETWEEN_TWO_FINISHED] });
  });

  test('F · PRs from another repository, or that do not say, change no helper\'s answer', () => {
    fc.assert(fc.property(fc.array(arbPr, { maxLength: 25 }), fc.array(arbPr, { maxLength: 25 }), fc.constantFrom(...SHAS), (own, other, tip) => {
      const mine = build(own.map((s) => ({ ...s, cross: false })));
      const theirs = build(other.map((s) => ({ ...s, cross: s.cross === false ? true : s.cross })), 1000);
      const both = mine.concat(theirs);
      for (const b of HEADS) {
        expect(C.prDoneFor(both, b, tip)).toBe(C.prDoneFor(mine, b, tip));
        expect(C.prOpenFor(both, b)).toBe(C.prOpenFor(mine, b));
        expect(C.prAuthorFor(both, b, tip)).toBe(C.prAuthorFor(mine, b, tip));
        expect(C.newestPr(both, b)).toBe(C.newestPr(mine, b));
      }
    }), { numRuns: 500 });
  });
});
