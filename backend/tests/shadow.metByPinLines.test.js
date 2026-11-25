'use strict';

// RA-32 (#307, the review at c10abaa): a "met by #307 … pinned at `<file>`:<a>[-<b>], case "<title>"" line of
// TASKS.md names lines that hold that case. The RA-18 guard checks the file and the title, never the lines, so a
// shift of the test file leaves the row citing another line. A citation without a line number is not read here.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');

describe('RA-32 · each "met by #307" citation that names lines names the lines of its case', () => {
  test('the cited lines hold the cited case', () => {
    const tasks = read('TASKS.md');
    expect((tasks.match(/met by #307 at /g) || []).length).toBeGreaterThanOrEqual(2);
    const wrong = [...tasks.matchAll(/met by #307 at [^\n]*?, pinned at `([^`]+)`:(\d+)(?:-(\d+))?, case "([^"\n]+)"/g)]
      .filter(([, file, a, b, title]) => !read(file).split('\n').slice(Number(a) - 1, Number(b || a)).join('\n').includes(title))
      .map(([, file, a, b]) => `${file}:${a}${b ? `-${b}` : ''}`);
    expect(wrong).toEqual([]);
  });
});
