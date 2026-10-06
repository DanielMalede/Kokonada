'use strict';

// OPS-152 · TASKS.md — the row a claim marks as taken.
//
// `start` writes one line directly under the task's own row: "taken by <Name> (@login) on branch
// `b` since <date>, ledger slot <Xnn>". It must land under the REAL row — TASKS.md's "Row format"
// section carries an example row with a real id (`BE-004`) inside a code fence, and a naive search
// would mark the example instead. It must also leave every human-written `- status:` line alone,
// and it must stay a one-line insertion so two partners marking two adjacent rows merge cleanly.
//
// Pure: strings in, data out.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const {
  TASKS_PATH,
  parseTaskRows,
  findOpenRow,
  statusLine,
  isCoordStatusLine,
  setStatusLine,
  branchesInStatus,
  addedIds,
  idNumber,
} = require(path.join(REPO_ROOT, 'scripts', 'coord', 'lib', 'tasks.js'));

const TASKS = `# TASKS

**Next free IDs:** \`BE-120\` · \`DAN-063\`

### Row format

\`\`\`
- [ ] \`BE-004\` \`P2\` One sentence — what is wrong or what must exist.
  - where: \`path/to/file.js:41\` · done when: the observable condition
\`\`\`

## Backend

- [x] \`BE-001\` \`P0\` Closed row.
  - where: somewhere
- [ ] \`BE-004\` \`P1\` The real row.
  - where: \`backend/app/x.js\`
  - status: fix in progress on branch \`fix/h2-ble-consent-gate\` — awaiting review.
- [ ] \`BE-005\` \`P2\` The next row.
  - where: \`backend/app/y.js\`

- [ ] \`DAN-061\` \`P1\` An owner row.
  - where: the owner's desk
`;

describe('OPS-152 · tasks — reading rows', () => {
  test('rows inside a code fence are not rows', () => {
    const rows = parseTaskRows(TASKS).filter((r) => r.id === 'BE-004');
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toMatch(/The real row/);
  });

  test('findOpenRow finds open rows only', () => {
    expect(findOpenRow(TASKS, 'BE-004').open).toBe(true);
    expect(findOpenRow(TASKS, 'BE-001')).toBeNull();
    expect(findOpenRow(TASKS, 'BE-999')).toBeNull();
  });

  test('a row\'s block is its indented sub-bullets, ending at a blank or the next row', () => {
    const row = findOpenRow(TASKS, 'BE-004');
    expect(row.block).toEqual([
      '  - where: `backend/app/x.js`',
      '  - status: fix in progress on branch `fix/h2-ble-consent-gate` — awaiting review.',
    ]);
    expect(findOpenRow(TASKS, 'BE-005').block).toEqual(['  - where: `backend/app/y.js`']);
  });

  test('branchesInStatus reads every backticked token on the row\'s status lines', () => {
    expect(branchesInStatus(findOpenRow(TASKS, 'BE-004'))).toEqual(['fix/h2-ble-consent-gate']);
    expect(branchesInStatus(findOpenRow(TASKS, 'BE-005'))).toEqual([]);
  });

  test('idNumber reads the numeric part', () => {
    expect(idNumber('BE-905')).toBe(905);
    expect(idNumber('own:x')).toBeNull();
  });
});

describe('OPS-152 · tasks — the status line', () => {
  const line = statusLine({ name: 'Bedrack', login: 'DanielBedrack', branch: 'fix/be005-y', since: '2026-10-06', slot: 'B02' });

  test('its exact wording', () => {
    expect(line).toBe('  - status: taken by Bedrack (@DanielBedrack) on branch `fix/be005-y` since 2026-10-06, ledger slot B02');
    expect(isCoordStatusLine(line)).toBe(true);
    expect(isCoordStatusLine('  - status: fix in progress on branch `x`')).toBe(false);
  });

  test('is inserted directly under the real row — not the fenced example, not the neighbour', () => {
    const after = setStatusLine(TASKS, 'BE-005', line);
    const a = TASKS.split('\n');
    const b = after.split('\n');
    const row = a.findIndex((l) => l.startsWith('- [ ] `BE-005`'));
    expect(b).toEqual([...a.slice(0, row + 1), line, ...a.slice(row + 1)]);
  });

  test('keeps a human status line and puts the coordinator\'s line above it', () => {
    const after = setStatusLine(TASKS, 'BE-004', line);
    const row = findOpenRow(after, 'BE-004');
    expect(row.block[0]).toBe(line);
    expect(row.block).toContain('  - status: fix in progress on branch `fix/h2-ble-consent-gate` — awaiting review.');
    // the fenced example is byte-identical
    expect(after.split('```')[1]).toBe(TASKS.split('```')[1]);
  });

  test('replaces an earlier coordinator line for the same row instead of stacking a second one', () => {
    const first = setStatusLine(TASKS, 'BE-005', line);
    const second = setStatusLine(first, 'BE-005', line.replace('B02', 'B03'));
    const block = findOpenRow(second, 'BE-005').block;
    expect(block.filter(isCoordStatusLine)).toEqual([line.replace('B02', 'B03')]);
    expect(second.split('\n')).toHaveLength(TASKS.split('\n').length + 1);
  });

  test('CRLF in, LF out; a missing or closed row is an error', () => {
    expect(setStatusLine(TASKS.replace(/\n/g, '\r\n'), 'BE-005', line)).toBe(setStatusLine(TASKS, 'BE-005', line));
    expect(() => setStatusLine(TASKS, 'BE-001', line)).toThrow(/BE-001/);
    expect(() => setStatusLine(TASKS, 'BE-777', line)).toThrow(/BE-777/);
  });
});

describe('OPS-152 · tasks — IDs a branch adds', () => {
  test('only ids that did not exist on the base count as added', () => {
    const head = `${TASKS}- [ ] \`BE-905\` \`P2\` Partner row.\n  - where: x\n- [ ] \`OPS-152\` \`P1\` Owner row.\n  - where: y\n`;
    expect(addedIds(TASKS, head).sort()).toEqual(['BE-905', 'OPS-152']);
    expect(addedIds(TASKS, TASKS)).toEqual([]);
  });

  test('an id inside a code fence is not an added row', () => {
    const head = `${TASKS}\n\`\`\`\n- [ ] \`BE-950\` example\n\`\`\`\n`;
    expect(addedIds(TASKS, head)).toEqual([]);
  });
});

describe('OPS-152 · tasks — live pin on the real TASKS.md', () => {
  const real = fs.readFileSync(path.join(REPO_ROOT, TASKS_PATH), 'utf8');

  test('parses into many rows, and the fenced BE-004 example is not one of them', () => {
    const rows = parseTaskRows(real);
    expect(rows.length).toBeGreaterThan(300);
    expect(rows.filter((r) => r.id === 'BE-004')).toHaveLength(1);
  });

  test('inserting a status line changes exactly one line count and nothing else', () => {
    const row = parseTaskRows(real).find((r) => r.open);
    const line = statusLine({ name: 'Malede', login: 'DanielMalede', branch: 'x/y', since: '2026-10-06', slot: 'M02' });
    const after = setStatusLine(real, row.id, line);
    const lf = real.replace(/\r\n?/g, '\n');
    expect(after.split('\n')).toHaveLength(lf.split('\n').length + 1);
    expect(after.replace(`${line}\n`, '')).toBe(lf);
  });
});
