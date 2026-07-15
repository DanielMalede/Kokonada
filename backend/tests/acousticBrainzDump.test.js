// backend/tests/acousticBrainzDump.test.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { readBatch } = require('../app/services/discovery/acousticBrainzDump');

let file;
beforeAll(() => {
  file = path.join(os.tmpdir(), `ab-dump-${Date.now()}.ndjson`);
  const lines = [
    JSON.stringify({ id: 1 }),
    JSON.stringify({ id: 2 }),
    '',                       // blank line (counted toward offset, yields no record)
    '{not valid json',        // malformed (counted, skipped)
    JSON.stringify({ id: 5 }),
    JSON.stringify({ id: 6 }),
  ];
  fs.writeFileSync(file, lines.join('\n'));
});
afterAll(() => { try { fs.unlinkSync(file); } catch { /* ignore */ } });

describe('acousticBrainzDump.readBatch', () => {
  it('reads the first N lines and reports the advanced offset', async () => {
    const { records, nextOffset, done } = await readBatch({ path: file, offset: 0, limit: 2 });
    expect(records).toEqual([{ id: 1 }, { id: 2 }]);
    expect(nextOffset).toBe(2);
    expect(done).toBe(false);
  });

  it('resumes from an offset, counting blank/malformed lines so resume stays stable', async () => {
    // lines 2 (blank) + 3 (malformed) + 4 ({id:5}) → only {id:5} parses, but offset advances by 3
    const { records, nextOffset } = await readBatch({ path: file, offset: 2, limit: 3 });
    expect(records).toEqual([{ id: 5 }]);
    expect(nextOffset).toBe(5);
  });

  it('signals done at EOF (fewer than limit consumed)', async () => {
    const { records, done } = await readBatch({ path: file, offset: 5, limit: 10 });
    expect(records).toEqual([{ id: 6 }]);
    expect(done).toBe(true);
  });

  it('a missing path or non-positive limit is a safe no-op', async () => {
    expect(await readBatch({ path: '/no/such/file.ndjson', offset: 3, limit: 5 })).toEqual({ records: [], nextOffset: 3, done: true });
    expect(await readBatch({ path: file, offset: 0, limit: 0 })).toEqual({ records: [], nextOffset: 0, done: true });
    expect(await readBatch({})).toEqual({ records: [], nextOffset: 0, done: true });
  });
});
