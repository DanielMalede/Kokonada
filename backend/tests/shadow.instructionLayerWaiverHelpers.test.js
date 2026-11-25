'use strict';

// RA-31 and RA-34 (#307, the review at c10abaa). The helpers of instructionLayerWaiver.test.js run here as that file
// declares them: its top-level `function` declarations and its PREFIXES list are read from its text and run in a
// fresh context, so these cases pin the code the RA-18 guard and the ID invariant run, not a copy. A helper added
// to that file must stay a top-level `function` declaration to be read.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, 'instructionLayerWaiver.test.js'), 'utf8')
  .replace(/^﻿/, '').replace(/\r\n?/g, '\n');

function take(head) {
  const at = SRC.indexOf(`\n${head}`);
  if (at < 0) throw new Error(`instructionLayerWaiver.test.js has no top-level "${head}"`);
  const end = head.startsWith('const ') ? SRC.indexOf('\n', at + 1) : SRC.indexOf('\n}\n', at + 1) + 2;
  return SRC.slice(at + 1, end);
}

const NAMES = [...SRC.matchAll(/^function (\w+)\(/gm)].map((m) => m[1]);
const ctx = vm.createContext({});
vm.runInContext([take('const PREFIXES = '), ...NAMES.map((n) => take(`function ${n}(`))].join('\n'), ctx);

describe('RA-31 · declares() counts only a declaration that runs', () => {
  const title = 'a pinned case';

  test('the helpers were read from the file', () => {
    expect(NAMES).toEqual(expect.arrayContaining(['closeParen', 'declares', 'nextFreeNotAbove']));
    expect([typeof ctx.declares, typeof ctx.nextFreeNotAbove]).toEqual(['function', 'function']);
  });

  test('a live test( or it( declaration counts, inside a describe too', () => {
    expect(ctx.declares("test('a pinned case', () => {});", title)).toBe(true);
    expect(ctx.declares("describe('d', () => {\n  it('a pinned case', () => {});\n});", title)).toBe(true);
  });

  test.each([
    ['a line comment', "// test('a pinned case', () => {});"],
    ['a block comment', "/*\n  it('a pinned case', () => {});\n*/"],
    ['a commented test.each', "// test.each([[1]])('a pinned case', () => {});"],
    ['a describe.skip', "describe.skip('d', () => {\n  test('a pinned case', () => {});\n});"],
    ['an xdescribe', "xdescribe('d', () => {\n  it('a pinned case', () => {});\n});"],
  ])('%s declares nothing', (_kind, src) => {
    expect(ctx.declares(src, title)).toBe(false);
  });

  // The session's own cases beyond the auditor's: a skipped describe.each, a comment's quote that the string scan
  // must not read as a string, a regular expression's quote likewise (instructionLayerWaiver.test.js has
  // `/--jq '([^']*)'/g`), and a live case after a skipped block, which still counts.
  test.each([
    ['a describe.skip.each', "describe.skip.each([[1]])('d %s', () => {\n  test('a pinned case', () => {});\n});"],
    ['an xdescribe.each', "xdescribe.each([[1]])('d %s', () => {\n  it('a pinned case', () => {});\n});"],
    ['a block comment after an apostrophe in a line comment', "// the owner's words\n/* test('a pinned case', () => {}); */"],
    ['a comment after a regular expression that holds a quote', "const re = /'/; // test('a pinned case', () => {});"],
    ['a block comment after a regular expression that holds quotes', "x.match(/--jq '([^']*)'/g);\n/* it('a pinned case', () => {}); */"],
  ])('%s declares nothing', (_kind, src) => {
    expect(ctx.declares(src, title)).toBe(false);
  });

  test('a live case after a skipped block, beside a comment that quotes it, or after a string that quotes a skip, still counts', () => {
    expect(ctx.declares("xdescribe('d', () => {});\ntest('a pinned case', () => {});", title)).toBe(true);
    expect(ctx.declares("// test('a pinned case')\ntest.each([[1]])('a pinned case', () => {});", title)).toBe(true);
    expect(ctx.declares("const s = '// not a comment';\nit('a pinned case', () => {});", title)).toBe(true);
    expect(ctx.declares("const s = \"xdescribe('d', () => {\";\ntest('a pinned case', () => {});", title)).toBe(true);
  });
});

describe('RA-34 · the ID invariant reads the header list, never the parenthesis after it', () => {
  test('a prefix the list lacks is named although the parenthesis gives it a number above its rows', () => {
    const tasks = ['**Next free IDs:** `BE-10` · `MB-10` · `UI-10` · `OPS-10` · `DAN-10` (`ARCH-012` is a branch\'s)',
      '- [ ] `ARCH-011` `P3` **a row**'].join('\n');
    expect([...ctx.nextFreeNotAbove(tasks)]).toEqual(['ARCH']);
  });
});
