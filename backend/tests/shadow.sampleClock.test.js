'use strict';

// RA-9 (the second resilience audit of #256). ingestV2Batch refuses a sample that ended more than 90
// days before its `now` (healthSampleRepository.js, applyUpsert), so a test that writes a literal
// sample date and leaves `now` to the real clock turns red on a known day, and waits out its timeout
// first when the refused write was the one it held. A test file that calls ingestV2Batch passes `now`
// in every call, or writes no literal sample date. Sources are read as text, never executed.

const fs = require('fs');
const path = require('path');

// Each exception names the row that removes it.
const KNOWN = new Map([
  ['healthStoreV2.integration.test.js', 'BE-138'],
]);

const LITERAL_SAMPLE_DATE = /\b(?:startDate|endDate)\s*:\s*['"`]\d{4}-\d{2}-\d{2}/;

function ingestCalls(src) {
  const calls = [];
  const opener = /\bingestV2Batch\s*\(/g;
  let match = opener.exec(src);
  while (match !== null) {
    let depth = 0;
    let end = match.index + match[0].length - 1;
    for (; end < src.length; end += 1) {
      if (src[end] === '(') depth += 1;
      else if (src[end] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    calls.push(src.slice(match.index, end + 1));
    match = opener.exec(src);
  }
  return calls;
}

function clockSafe(src) {
  const calls = ingestCalls(src);
  if (calls.length === 0 || !LITERAL_SAMPLE_DATE.test(src)) return true;
  return calls.every((call) => /\bnow\s*:/.test(call));
}

const read = (file) => fs.readFileSync(path.join(__dirname, file), 'utf8');
const self = path.basename(__filename);
const testFiles = fs.readdirSync(__dirname)
  .filter((file) => file.endsWith('.test.js') && file !== self);

describe('no v2 ingest test waits on the real clock (RA-9, BE-138)', () => {
  it('every file that calls ingestV2Batch pins `now` or writes no literal sample date', () => {
    const offenders = testFiles.filter((file) => !KNOWN.has(file) && !clockSafe(read(file)));
    expect(offenders).toEqual([]);
  });

  it('each named exception still needs its entry', () => {
    const stale = [...KNOWN.keys()].filter((file) => clockSafe(read(file)));
    expect(stale).toEqual([]);
  });

  it('is not vacuous: it flags the banned shape and passes both safe ones', () => {
    const dated = "[{ startDate: '2026-10-06T06:30:00.000Z', endDate: '2026-10-06T06:31:00.000Z' }]";
    expect(clockSafe(`ingestV2Batch(id, 'healthkit', ${dated});`)).toBe(false);
    expect(clockSafe(`ingestV2Batch(id, 'healthkit', ${dated}, { now: NOW });`)).toBe(true);
    expect(clockSafe("ingestV2Batch(id, 'healthkit', [{ endDate: ago(HOUR).toISOString() }]);")).toBe(true);
  });
});
