'use strict';

// W4-D02 — the STATE row-clobber guard.
//
// WHAT WENT WRONG. `ccecca3` reset W4-001 from `in_progress` (written moments earlier by the
// session that owned it) back to `pending`, because it composed the whole of WAVE4_STATE.md from a
// read taken BEFORE that commit and wrote the file back wholesale. No code was lost that time. The
// bug class is worse than the instance: WAVE4_STATE.md is declared "the SINGLE resume source", so a
// stale full-file rewrite can silently erase queue truth — re-running finished work, or stranding a
// task nobody owns — and nothing anywhere notices.
//
// The W4-D01 lesson applies verbatim: the backlog row's DoD ("reflection sessions re-read STATE
// immediately before writing and never downgrade a row they did not set") is a RULE, and a rule
// that lives only in prose is exactly what failed here. Sessions already believed they should not
// clobber STATE. So the repair is mechanical, in the same two halves:
//   1. ONE tested implementation of "did this STATE edit illegally regress a row?"
//      (scripts/wave4/state-guard.js), run by the session before it commits STATE.
//   2. A backstop in scripts/run-mission.ps1: after EVERY session, the loop re-checks the same
//      invariant against the sha the session started from, so a session that skipped the check —
//      or died before running it — still cannot regress a row silently.
//
// Deliberate reopening stays possible (§2.5 R2 explicitly reopens a task whose claim does not
// hold): a rank decrease is allowed when the row carries the literal uppercase token `REOPENED`.
// That is the difference between the two cases — R2 is a decision someone makes and writes down,
// a clobber is a decision nobody made.
//
// This suite lives in backend/tests/ because jest is the repo's only harness; it reads repo-root
// tooling the way tests/wave4.reflectMarker.test.js does. The engine is pure (two strings in,
// violations out — no clock, no git, mission §0.4 S9); the CLI is exercised against temp files.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const MODULE_PATH = path.join(REPO_ROOT, 'scripts', 'wave4', 'state-guard.js');
const LOOP_SCRIPT = path.join(REPO_ROOT, 'scripts', 'run-mission.ps1');

const {
  STATE_RELPATH,
  STATUS_RANK,
  REOPEN_TOKEN,
  parseTaskRows,
  diffTaskRows,
  formatViolations,
} = require(MODULE_PATH);

// A miniature STATE with the two real table shapes. They differ on purpose: `status` is column 6
// in the task table and column 7 in the discovered backlog, so anything that parses by fixed
// position instead of by header name reads the wrong cell.
const state = ({ w001 = 'in_progress', d01 = '**done**', extraTaskRows = '', extraBacklogRows = '' } = {}) => `# WAVE4_STATE

## Run header

- phase: execute

## Task table

| id | title | tier | size | deps | status | owner-session | notes |
|----|-------|------|------|------|--------|---------------|-------|
| W4-000 | Bootstrap | MUST | S | — | done | 1,3 | landed |
| W4-001 | Surgical bug backlog | MUST | M | 000 | ${w001} | 5 | ten fixes |
| W4-002 | Simulator | MUST | L | 000 | pending | — | |
${extraTaskRows}
## Discovered backlog

| id | class | title | tier | size | deps | status | found | DoD / justification |
|----|-------|-------|------|------|------|--------|-------|---------------------|
| W4-D01 | repair | Reflect marker | MUST | S | — | ${d01} | session 5 | fixed |
| W4-D02 | repair | Row clobber | SHOULD | S | — | pending | session 5 | this task |
${extraBacklogRows}
## PR queue

| PR | cluster(s) | url | status |
|----|-----------|-----|--------|
| #179 | W4-000 | https://example.invalid/pull/179 | open — running PR |

## Reflection log

| # | at | interval covered | suite | verified / reopened / queued | headline |
|---|----|------------------|-------|------------------------------|----------|
| — | — | — | — | — | (no reflection has run yet) |
`;

const idsOf = (violations) => violations.map((v) => v.id).sort();

describe('W4-D02 · state guard — contract', () => {
  test('guards the one file mission §2 calls the SINGLE resume source', () => {
    expect(STATE_RELPATH).toBe('docs/plans/WAVE4_STATE.md');
  });

  test('the status ladder orders progress, and terminal states sit at the top', () => {
    expect(STATUS_RANK.pending).toBeLessThan(STATUS_RANK.in_progress);
    expect(STATUS_RANK.in_progress).toBeLessThan(STATUS_RANK.done);
    // `failed` is terminal like `done`: reviving either is a decision, not a routine step.
    expect(STATUS_RANK.failed).toBe(STATUS_RANK.done);
  });

  test('the reopen escape hatch is a deliberate uppercase token, not a common word', () => {
    expect(REOPEN_TOKEN).toBe('REOPENED');
  });
});

describe('W4-D02 · state guard — parsing the task tables', () => {
  test('reads both tables and keys them by id', () => {
    const rows = parseTaskRows(state());
    expect([...rows.keys()].sort()).toEqual(['W4-000', 'W4-001', 'W4-002', 'W4-D01', 'W4-D02']);
  });

  test('finds `status` by header name — the two tables put it in different columns', () => {
    const rows = parseTaskRows(state());
    // Task table: status is the 6th column. Discovered backlog: the 7th (an extra `class`).
    expect(rows.get('W4-001').status).toBe('in_progress');
    expect(rows.get('W4-D02').status).toBe('pending');
    expect(rows.get('W4-D02').table).toBe('discovered backlog');
  });

  test('strips markdown emphasis from the status cell', () => {
    expect(parseTaskRows(state({ d01: '**done**' })).get('W4-D01').status).toBe('done');
    expect(parseTaskRows(state({ d01: '_failed_' })).get('W4-D01').status).toBe('failed');
  });

  test('normalises spelling variants of in_progress', () => {
    expect(parseTaskRows(state({ w001: 'in progress' })).get('W4-001').status).toBe('in_progress');
    expect(parseTaskRows(state({ w001: 'IN-PROGRESS' })).get('W4-001').status).toBe('in_progress');
  });

  test('ignores tables that are not task tables', () => {
    const rows = parseTaskRows(state());
    // The PR queue HAS a `status` column but no `id`; the reflection log has neither. Picking
    // either one up would make every PR status change look like a task regression.
    expect(rows.has('#179')).toBe(false);
    expect([...rows.keys()].some((k) => k.startsWith('#'))).toBe(false);
    expect(rows.size).toBe(5);
  });

  test('skips separator rows and em-dash placeholders', () => {
    const rows = parseTaskRows(state());
    expect(rows.has('—')).toBe(false);
    expect(rows.has('----')).toBe(false);
  });

  test('an empty or malformed document parses to nothing instead of throwing', () => {
    expect(parseTaskRows('').size).toBe(0);
    expect(parseTaskRows(null).size).toBe(0);
    expect(parseTaskRows('| just | a | stray | row |').size).toBe(0);
  });
});

describe('W4-D02 · state guard — the regression that created this task', () => {
  test('in_progress → pending is caught (the exact ccecca3 clobber)', () => {
    const before = state({ w001: 'in_progress' });
    const after = state({ w001: 'pending' });

    const violations = diffTaskRows(before, after);

    expect(idsOf(violations)).toEqual(['W4-001']);
    expect(violations[0]).toMatchObject({ id: 'W4-001', kind: 'regressed', before: 'in_progress', after: 'pending' });
  });

  test('the message names the row and both statuses, so a log line is actionable', () => {
    const text = formatViolations(diffTaskRows(state({ w001: 'in_progress' }), state({ w001: 'pending' })));
    expect(text).toMatch(/W4-001/);
    expect(text).toMatch(/in_progress/);
    expect(text).toMatch(/pending/);
  });
});

describe('W4-D02 · state guard — what counts as a regression', () => {
  const shift = (from, to) => diffTaskRows(state({ w001: from }), state({ w001: to }));

  test.each([
    ['done → pending', 'done', 'pending'],
    ['done → in_progress', 'done', 'in_progress'],
    ['in_progress → pending', 'in_progress', 'pending'],
    ['failed → pending', 'failed', 'pending'],
  ])('%s is a violation', (_label, from, to) => {
    expect(idsOf(shift(from, to))).toEqual(['W4-001']);
  });

  test.each([
    ['unchanged', 'in_progress', 'in_progress'],
    ['pending → in_progress (§2 step 6)', 'pending', 'in_progress'],
    ['in_progress → done (§2 step 8)', 'in_progress', 'done'],
    ['in_progress → failed (rule of 2 / S4)', 'in_progress', 'failed'],
    ['pending → done (a task finished without a separate in_progress commit)', 'pending', 'done'],
  ])('%s is allowed', (_label, from, to) => {
    expect(shift(from, to)).toEqual([]);
  });

  test('a brand-new row is not a violation — that is R6 queueing work', () => {
    const after = state({ extraBacklogRows: '| W4-D05 | improve | Something found | SHOULD | S | — | pending | session 7 | new |\n' });
    expect(diffTaskRows(state(), after)).toEqual([]);
    expect(parseTaskRows(after).has('W4-D05')).toBe(true);
  });

  test('a row that VANISHES is a violation — the other half of a stale full-file rewrite', () => {
    const before = state({ extraBacklogRows: '| W4-D05 | improve | Something found | SHOULD | S | — | pending | session 7 | new |\n' });
    const violations = diffTaskRows(before, state());
    expect(idsOf(violations)).toEqual(['W4-D05']);
    expect(violations[0].kind).toBe('removed');
  });

  test('a status garbled into something unrecognisable is a violation', () => {
    // A bad merge or a typo that leaves `donee` must not read as "no rank decrease, all fine".
    const violations = diffTaskRows(state({ w001: 'done' }), state({ w001: 'donee' }));
    expect(idsOf(violations)).toEqual(['W4-001']);
    expect(violations[0].kind).toBe('unknown-status');
  });

  test('the real WAVE4_STATE.md parses cleanly and is self-consistent', () => {
    // A live pin: if a future session garbles a status cell or breaks a table's shape, this fails.
    const real = fs.readFileSync(path.join(REPO_ROOT, STATE_RELPATH), 'utf8');
    const rows = parseTaskRows(real);

    expect(rows.size).toBeGreaterThanOrEqual(16); // W4-000..W4-015 plus the discovered backlog
    for (const id of ['W4-000', 'W4-001', 'W4-015', 'W4-D01', 'W4-D02']) expect(rows.has(id)).toBe(true);
    for (const [id, row] of rows) {
      expect({ id, status: row.status }).toEqual({ id, status: expect.stringMatching(/^(pending|in_progress|done|failed)$/) });
    }
    expect(diffTaskRows(real, real)).toEqual([]);
  });
});

describe('W4-D02 · state guard — deliberate reopening stays possible (§2.5 R2)', () => {
  const reopened = (status, note) =>
    state({ extraBacklogRows: `| W4-D09 | repair | Reopened thing | MUST | S | — | ${status} | session 7 | ${note} |\n` });

  test('REOPENED on the row allows the decrease R2 asks for', () => {
    const before = reopened('done', 'claim held');
    const after = reopened('pending', 'REOPENED: the DoD did not actually hold');
    expect(diffTaskRows(before, after)).toEqual([]);
  });

  test('lowercase prose does NOT suppress it — the token has to be deliberate', () => {
    // STATE already contains the word "reopened" in ordinary prose; if that suppressed the guard,
    // the guard would be off by accident rather than by decision.
    const after = reopened('pending', 'this was reopened because the claim did not hold');
    expect(idsOf(diffTaskRows(reopened('done', 'claim held'), after))).toEqual(['W4-D09']);
  });

  test('REOPENED on a DIFFERENT row does not license this one', () => {
    const withToken = (w001) => state({
      w001,
      extraBacklogRows: '| W4-D09 | repair | Other thing | MUST | S | — | pending | session 7 | REOPENED: unrelated |\n',
    });
    expect(idsOf(diffTaskRows(withToken('done'), withToken('pending')))).toEqual(['W4-001']);
  });

  test('REOPENED can never resurrect a DELETED row', () => {
    const before = state({ extraBacklogRows: '| W4-D05 | improve | Something | SHOULD | S | — | pending | session 7 | REOPENED |\n' });
    expect(idsOf(diffTaskRows(before, state()))).toEqual(['W4-D05']);
  });
});

describe('W4-D02 · state guard — CLI', () => {
  let tmp;
  const run = (args) => {
    try {
      const stdout = execFileSync(process.execPath, [MODULE_PATH, ...args], { cwd: tmp, encoding: 'utf8' });
      return { code: 0, stdout };
    } catch (err) {
      return { code: err.status, stdout: `${err.stdout || ''}${err.stderr || ''}` };
    }
  };

  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'w4-stateguard-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  const write = (name, text) => {
    const p = path.join(tmp, name);
    fs.writeFileSync(p, text, 'utf8');
    return p;
  };

  test('a clean edit exits 0 and says OK', () => {
    const before = write('before.md', state({ w001: 'in_progress' }));
    const after = write('after.md', state({ w001: 'done' }));
    const res = run(['check', '--before', before, '--after', after]);
    expect(res.code).toBe(0);
    expect(res.stdout).toMatch(/^OK\b/m);
  });

  test('a clobber exits NON-ZERO and names the row — so a shell/loop check actually trips', () => {
    const before = write('before.md', state({ w001: 'in_progress' }));
    const after = write('after.md', state({ w001: 'pending' }));
    const res = run(['check', '--before', before, '--after', after]);
    expect(res.code).not.toBe(0);
    expect(res.stdout).toMatch(/VIOLATION/);
    expect(res.stdout).toMatch(/W4-001/);
  });

  test('no baseline to compare against is OK, not a crash', () => {
    // A base ref older than the STATE file (or a fresh clone) must not wedge the loop.
    const after = write('after.md', state());
    const res = run(['check', '--before', path.join(tmp, 'does-not-exist.md'), '--after', after]);
    expect(res.code).toBe(0);
    expect(res.stdout).toMatch(/no-baseline/);
  });

  test('an unreadable AFTER file is a hard error, not a silent pass', () => {
    const before = write('before.md', state());
    const res = run(['check', '--before', before, '--after', path.join(tmp, 'missing.md')]);
    expect(res.code).not.toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// The other half of the repair: the loop re-checks the invariant after EVERY session, so a session
// that never ran the guard — or died before it could — still cannot regress a row silently.
// Same shape as the W4-D01 backstop pin: assert the mechanism, and prove the detector can fail.
// ---------------------------------------------------------------------------------------------
describe('W4-D02 · guard — the loop re-checks STATE after every session', () => {
  const loopSrc = () => fs.readFileSync(LOOP_SCRIPT, 'utf8');

  const definesBackstop = (src) => /function\s+Assert-StateRowsNotClobbered\b/.test(src);
  const capturesBaseSha = (src) => /\$sessionStartSha\s*=/.test(src);
  const invokesWithBase = (src) => /Assert-StateRowsNotClobbered\s+-BaseSha\s+\$sessionStartSha\b/.test(src);
  const usesSharedTool = (src) => /state-guard\.js/.test(src);
  const hasBackstop = (src) => definesBackstop(src) && capturesBaseSha(src) && invokesWithBase(src) && usesSharedTool(src);

  test('detector self-test — the guard must be able to fail', () => {
    expect(hasBackstop('# a loop with no backstop at all')).toBe(false);
    expect(hasBackstop(loopSrc().replace(/function\s+Assert-StateRowsNotClobbered/g, 'function Unrelated-Thing'))).toBe(false);
    expect(hasBackstop(loopSrc().replace(/state-guard\.js/g, 'something-else.js'))).toBe(false);
    expect(hasBackstop(loopSrc().replace(/\$sessionStartSha\s*=/g, () => '$unrelatedVar ='))).toBe(false);
  });

  test('run-mission.ps1 captures the pre-session sha and re-checks STATE against it', () => {
    const src = loopSrc();
    expect(definesBackstop(src)).toBe(true);
    expect(capturesBaseSha(src)).toBe(true);
    expect(invokesWithBase(src)).toBe(true);
    expect(usesSharedTool(src)).toBe(true);
  });

  test('the check runs on EVERY outcome, not only on a clean exit', () => {
    // A session that crashed or timed out may still have committed a clobbered STATE. Gating the
    // backstop behind the success branch would miss exactly the sessions most likely to have made
    // a mess, so the call must sit before the outcome classification.
    const src = loopSrc();
    const call = src.indexOf('Assert-StateRowsNotClobbered -BaseSha');
    const classification = src.indexOf('# 5. classify the outcome');
    expect(call).toBeGreaterThan(-1);
    expect(classification).toBeGreaterThan(-1);
    expect(call).toBeLessThan(classification);
  });
});
