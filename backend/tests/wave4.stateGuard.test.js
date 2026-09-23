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
  taskRowList,
  duplicateIdViolations,
  archiveViolations,
  archiveSections,
  ARCHIVE_RELPATH,
  ARCHIVE_POINTER_RE,
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

// ---------------------------------------------------------------------------------------------
// W4-D54 — an id that resolves to two different rows.
//
// The backlog carried `W4-D48` TWICE: session 49's "a pending queue job is user data that no
// erasure path can reach" and session 55's "`TrackEmbedding.vector` never rejects a missing
// vector". Unrelated findings, one id.
//
// The reason this went unnoticed for a session is INSIDE this guard. `parseTaskRows` returns a
// Map keyed by id, so a repeat `rows.set(id, …)` silently overwrites — the first row stops
// existing as far as every consumer is concerned. That is not a cosmetic clash:
//   · the shadowed row can never be reported `removed`, because it was never in the map to begin
//     with — delete it and the guard says OK;
//   · a rank decrease on the shadowed row is invisible for the same reason;
//   · the `OK <n> rows` line under-reports by one per duplicate, so the count cannot catch it.
// A guard blind to a row is worse than no guard on that row, because the OK line reads as
// coverage. So the repair is the W4-D01/W4-D02 shape once more: not just fix the instance,
// but make the class fail loudly.
//
// The check is a property of ONE document, not of a diff, so it runs on the AFTER document — and
// it has to run BEFORE the no-baseline early return, or the loop's first check on a fresh clone
// would be exactly the one that skips it.
// ---------------------------------------------------------------------------------------------
describe('W4-D54 · state guard — one id, one row', () => {
  const dupBacklog = '| W4-D02 | improve | A DIFFERENT finding that reused the id | SHOULD | S | — | pending | session 55 | unrelated work |\n';

  test('a clean document has no duplicate ids', () => {
    expect(duplicateIdViolations(state())).toEqual([]);
  });

  test('an id used twice in the SAME table is a violation naming the id and the count', () => {
    const violations = duplicateIdViolations(state({ extraBacklogRows: dupBacklog }));
    expect(idsOf(violations)).toEqual(['W4-D02']);
    expect(violations[0].kind).toBe('duplicate-id');
    expect(violations[0].count).toBe(2);
    expect(violations[0].message).toMatch(/W4-D02/);
  });

  test('an id reused ACROSS the two tables is caught too — the tables share one id space', () => {
    const violations = duplicateIdViolations(state({
      extraBacklogRows: '| W4-001 | improve | Reused a §3 task id | SHOULD | S | — | pending | session 55 | oops |\n',
    }));
    expect(idsOf(violations)).toEqual(['W4-001']);
  });

  test('THE MECHANISM: a duplicate SHADOWS the earlier row, so the guard goes blind to it', () => {
    // This is why W4-D54 existed at all. Pinned so the reason survives the fix.
    const withDup = state({ extraBacklogRows: dupBacklog });
    const rows = parseTaskRows(withDup);

    expect(rows.get('W4-D02').raw).toMatch(/A DIFFERENT finding/); // last write wins
    expect(taskRowList(withDup).filter((r) => r.id === 'W4-D02')).toHaveLength(2);
    expect(rows.size).toBe(taskRowList(withDup).length - 1); // the OK line under-reports by one

    // …and the concrete consequence: deleting the SHADOWED row is not reported as `removed`.
    expect(diffTaskRows(withDup, state({ extraBacklogRows: dupBacklog.replace('W4-D02', 'W4-D99') }))).toEqual([]);
  });

  test('the real WAVE4_STATE.md has exactly one row per id', () => {
    // The live pin: W4-D54's instance, and any future repeat of it.
    const real = fs.readFileSync(path.join(REPO_ROOT, STATE_RELPATH), 'utf8');
    expect(duplicateIdViolations(real)).toEqual([]);
    expect(parseTaskRows(real).size).toBe(taskRowList(real).length);
  });

  test('formatViolations renders it like every other violation, so one log line covers all kinds', () => {
    const line = formatViolations(duplicateIdViolations(state({ extraBacklogRows: dupBacklog })));
    expect(line).toMatch(/^VIOLATION W4-D02 duplicate-id: /);
  });
});

// ---------------------------------------------------------------------------------------------
// W4-D16 — archival is not a stale rewrite.
//
// §2.5 R1.5 tells a reflection past 150KB to move closed backlog rows into WAVE4_ARCHIVE.md and
// DELETE them from STATE. §2 step 6 requires this guard to pass, and it reports every deleted row
// as `removed` — deliberately not suppressible, because there is no legitimate reason to drop a
// task row. Two binding rules, in direct contradiction; sessions 23, 33, 39, 43, 47, 52, 58 and 64
// each hit it, each deferred, and STATE grew from 175KB to 399KB while they did.
//
// The ruling (reflection #10's design, endorsed by #11 and #12): the guard is RIGHT to be strict,
// so R1.5 gives up literal deletion. An archival leaves a STUB row — same id, same status, plus a
// pointer — and moves the long evidence prose verbatim into the archive. The bulk leaves, the row
// never stops existing, and the guard needs no exception at all.
//
// What the guard DOES gain is the half a stub cannot self-enforce: that the archive actually
// received the prose. Without it, "stub the row and forget the archive write" loses the evidence
// silently, which is the same class of failure the guard was built for. So a pointer must resolve.
// The engine stays pure — two strings in, violations out; the CLI owns the file read.
// ---------------------------------------------------------------------------------------------
describe('W4-D16 · state guard — archival is not a stale rewrite', () => {
  const FULL_ROW = '| W4-D07 | improve | Adapter mock semantics | SHOULD | S | — | done | session 12 | many KB of evidence prose |\n';
  const STUB_ROW = '| W4-D07 | improve | Adapter mock semantics | SHOULD | S | — | done | session 12 | ARCHIVED -> WAVE4_ARCHIVE.md#2026-08-22 |\n';

  const archive = (body = 'W4-D07 — the full evidence prose, moved verbatim.') => `# WAVE4_ARCHIVE

## Archived 2026-08-22 (session 65)

${body}

## Archived 2026-08-19 (reflection #4, session 23)

Something older.
`;

  test('the pointer names the archive file the mission names', () => {
    expect(ARCHIVE_RELPATH).toBe('docs/plans/WAVE4_ARCHIVE.md');
  });

  test('THE CONTRADICTION: deleting a closed row outright is still `removed`, exactly as before', () => {
    // R1.5's literal instruction, run through the guard. This is the failure every deferring
    // reflection saw, and it must keep failing — otherwise the stale-rewrite hole reopens.
    const before = state({ extraBacklogRows: FULL_ROW });
    const after = state();
    const violations = diffTaskRows(before, after);
    expect(idsOf(violations)).toEqual(['W4-D07']);
    expect(violations[0].kind).toBe('removed');
  });

  test('THE RULING: the same archival done as a STUB row passes the diff clean', () => {
    // Same evidence moved to the same place, same bytes off STATE — but the row still exists, so
    // there is nothing for the guard to object to. No exception, no new suppression token.
    expect(diffTaskRows(state({ extraBacklogRows: FULL_ROW }), state({ extraBacklogRows: STUB_ROW }))).toEqual([]);
  });

  test('a stub whose prose really did reach the archive is clean', () => {
    expect(archiveViolations(state({ extraBacklogRows: STUB_ROW }), archive())).toEqual([]);
  });

  test('a document with no stubs at all needs no archive', () => {
    expect(archiveViolations(state(), '')).toEqual([]);
  });

  test('a stub pointing at an archive section that does not exist is a violation', () => {
    const violations = archiveViolations(state({ extraBacklogRows: STUB_ROW }), archive().replace('2026-08-22', '2026-08-21'));
    expect(idsOf(violations)).toEqual(['W4-D07']);
    expect(violations[0].kind).toBe('archive-missing');
    expect(violations[0].anchor).toBe('2026-08-22');
    expect(violations[0].message).toMatch(/2026-08-22/);
  });

  test('THE HOLE THE STUB CANNOT CLOSE: a stub whose section exists but never mentions the row', () => {
    // Stub written, archive write forgotten. The row looks archived and the evidence is gone.
    const violations = archiveViolations(state({ extraBacklogRows: STUB_ROW }), archive('Some other row entirely.'));
    expect(idsOf(violations)).toEqual(['W4-D07']);
    expect(violations[0].kind).toBe('archive-unbacked');
    expect(violations[0].message).toMatch(/W4-D07/);
  });

  test('the heading LINE does not back a row — only the body does', () => {
    // A heading like `## Archived 2026-08-22 (W4-D16, session 65)` names the task that did the
    // archiving. Counting that as evidence would let the row that ordered the move back itself.
    const violations = archiveViolations(
      state({ extraBacklogRows: STUB_ROW }),
      '# A\n\n## Archived 2026-08-22 (W4-D07, session 65)\n\nunrelated body\n',
    );
    expect(violations[0].kind).toBe('archive-unbacked');
  });

  test('the ARCHIVED token without a resolvable pointer is a violation, not a silent pass', () => {
    const vague = FULL_ROW.replace('many KB of evidence prose', 'ARCHIVED (see the archive)');
    const violations = archiveViolations(state({ extraBacklogRows: vague }), archive());
    expect(idsOf(violations)).toEqual(['W4-D07']);
    expect(violations[0].kind).toBe('archive-pointer');
  });

  test('an unreadable/absent archive fails every stub rather than passing them', () => {
    const violations = archiveViolations(state({ extraBacklogRows: STUB_ROW }), '');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('archive-missing');
  });

  test('the pointer is matched as a substring of the heading, so re-titling a section is safe', () => {
    const retitled = archive().replace('## Archived 2026-08-22 (session 65)', '## Archived 2026-08-22 — backlog sweep (W4-D16)');
    expect(archiveViolations(state({ extraBacklogRows: STUB_ROW }), retitled)).toEqual([]);
  });

  test('ARCHIVE_POINTER_RE tolerates the spacing a human types and stops at the cell wall', () => {
    expect('ARCHIVED->WAVE4_ARCHIVE.md#2026-08-22'.match(ARCHIVE_POINTER_RE)[1]).toBe('2026-08-22');
    expect('ARCHIVED  ->  WAVE4_ARCHIVE.md#2026-08-22 |'.match(ARCHIVE_POINTER_RE)[1]).toBe('2026-08-22');
    expect(ARCHIVE_POINTER_RE.test('archived -> wave4_archive.md#2026-08-22')).toBe(false); // uppercase on purpose
  });

  test('formatViolations renders archive kinds like every other kind', () => {
    const line = formatViolations(archiveViolations(state({ extraBacklogRows: STUB_ROW }), ''));
    expect(line).toMatch(/^VIOLATION W4-D07 archive-missing: /);
  });

  test('THE LIVE PIN: every stub in the real WAVE4_STATE.md is backed by the real archive', () => {
    const realState = fs.readFileSync(path.join(REPO_ROOT, STATE_RELPATH), 'utf8');
    const realArchive = fs.readFileSync(path.join(REPO_ROOT, ARCHIVE_RELPATH), 'utf8');
    expect(archiveViolations(realState, realArchive)).toEqual([]);
  });

  test('detector self-test — the live pin must be able to fail', () => {
    // A pin that cannot go red is decoration. Point a stub at a section that is not there.
    const realArchive = fs.readFileSync(path.join(REPO_ROOT, ARCHIVE_RELPATH), 'utf8');
    const sabotaged = state({
      extraBacklogRows: '| W4-D999 | improve | fake | SHOULD | S | — | done | session 65 | ARCHIVED -> WAVE4_ARCHIVE.md#no-such-section |\n',
    });
    expect(archiveViolations(sabotaged, realArchive)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
// W4-D77 — the archive sectioniser closed a `##` the moment a `###` opened.
//
// `archiveSections` popped open sections with `level <= level`, so a level-3 heading popped its
// level-2 parent instead of nesting inside it — the exact inverse of that function's own comment
// ("Sub-headings therefore stay INSIDE their section"). The consequence is a FALSE POSITIVE in the
// direction that hurts most: `archiveViolations` backs a row by `section.body.includes(row.id)`,
// so evidence filed under `### Discovered backlog rows` left the matched `##` body EMPTY and a
// correctly-performed R1.5 archival failed as `archive-unbacked`. Reflection #14 hit it on seven
// stubs at once and only got them through by repeating the ids in the `##`-level intro prose;
// reflection #13's single stubbed row passed by luck, because its id happened to be named there.
//
// That matters beyond tidiness: R1.5 is a mission-mandated step, this made it fail on CORRECT
// input, and a guard that cries wolf on good archivals is how the real signal — a stub whose
// evidence never landed — gets buried.
//
// The repair is the pop condition: `>= level` (same level or deeper closes; strictly shallower
// stays open). The boundary tests below are what make it the RIGHT fix rather than merely a
// passing one — dropping the pop entirely would satisfy the first test and destroy the isolation
// between sibling sections, which is the property the guard actually trades on.
// ---------------------------------------------------------------------------------------------
describe('W4-D77 · state guard — sub-headings nest inside their section', () => {
  const STUB_ROW = '| W4-D07 | improve | Adapter mock semantics | SHOULD | S | — | done | session 12 | ARCHIVED -> WAVE4_ARCHIVE.md#2026-08-22 |\n';

  test('THE REPAIR: evidence filed ONLY under a `###` backs the stub', () => {
    // The exact shape R1.5 prescribes and reflection #14 wrote: one dated `##`, the prose under a
    // `###` detail heading, and NOTHING naming the row at the `##` level. Red before the fix.
    const archive = [
      '# WAVE4_ARCHIVE',
      '',
      '## Archived 2026-08-22 (session 65)',
      '',
      'Rows archived in this sweep:',
      '',
      '### Discovered backlog rows',
      '',
      'W4-D07 — the full evidence prose, moved verbatim.',
      '',
    ].join('\n');
    expect(archiveViolations(state({ extraBacklogRows: STUB_ROW }), archive)).toEqual([]);
  });

  test('BOUNDARY: a later sibling `##` still closes the previous one', () => {
    // Without this, "never pop" passes the test above while making every section back every row.
    const archive = [
      '# WAVE4_ARCHIVE',
      '',
      '## Archived 2026-08-22 (session 65)',
      '',
      'nothing relevant here',
      '',
      '## Archived 2026-08-19 (reflection #4, session 23)',
      '',
      'W4-D07 — prose that landed under the WRONG heading.',
      '',
    ].join('\n');
    const violations = archiveViolations(state({ extraBacklogRows: STUB_ROW }), archive);
    expect(idsOf(violations)).toEqual(['W4-D07']);
    expect(violations[0].kind).toBe('archive-unbacked');
  });

  test('BOUNDARY: sibling `###`s do not bleed into each other', () => {
    // This is what separates `>= level` from `> level`: under `>`, a second `###` would nest
    // inside the first, and the first sub-section would swallow the rest of the archive.
    const archive = [
      '# WAVE4_ARCHIVE',
      '',
      '## Archived 2026-08-22 (session 65)',
      '',
      '### Session log rows',
      '',
      'sessions 40-57, verbatim.',
      '',
      '### Discovered backlog rows',
      '',
      'W4-D07 — the full evidence prose, moved verbatim.',
      '',
    ].join('\n');
    const sections = archiveSections(archive);
    const byHeading = (needle) => sections.find((s) => s.heading.includes(needle));

    expect(byHeading('Session log rows').body).not.toMatch(/W4-D07/);
    expect(byHeading('Discovered backlog rows').body).toMatch(/W4-D07/);
    // and the parent carries BOTH, which is what makes the anchor-matches-the-`##` case work
    expect(byHeading('Archived 2026-08-22').body).toMatch(/sessions 40-57/);
    expect(byHeading('Archived 2026-08-22').body).toMatch(/W4-D07/);
  });

  test('a nested heading LINE still does not back a row — only body prose does', () => {
    // The existing rule at the `##` level (a heading names the task that DID the archiving) is not
    // quietly widened by nesting: heading lines are appended to no body, at any depth.
    const archive = [
      '# WAVE4_ARCHIVE',
      '',
      '## Archived 2026-08-22 (session 65)',
      '',
      '### W4-D07',
      '',
      'prose that never names the row',
      '',
    ].join('\n');
    expect(archiveViolations(state({ extraBacklogRows: STUB_ROW }), archive)[0].kind).toBe('archive-unbacked');
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

  test('W4-D54 · a duplicate id in AFTER exits NON-ZERO and names the id', () => {
    const before = write('before.md', state());
    const after = write('after.md', state({
      extraBacklogRows: '| W4-D02 | improve | A DIFFERENT finding | SHOULD | S | — | pending | session 55 | unrelated |\n',
    }));
    const res = run(['check', '--before', before, '--after', after]);
    expect(res.code).not.toBe(0);
    expect(res.stdout).toMatch(/VIOLATION W4-D02 duplicate-id/);
  });

  test('W4-D54 · a duplicate is caught even with NO baseline — the early return must not skip it', () => {
    // The no-baseline branch returns OK before any diff runs. A duplicate is a property of the
    // document alone, so on a fresh clone (or a base ref older than the file) it is precisely the
    // check that would otherwise never fire.
    const after = write('after.md', state({
      extraBacklogRows: '| W4-D02 | improve | A DIFFERENT finding | SHOULD | S | — | pending | session 55 | unrelated |\n',
    }));
    const res = run(['check', '--before', path.join(tmp, 'does-not-exist.md'), '--after', after]);
    expect(res.code).not.toBe(0);
    expect(res.stdout).toMatch(/duplicate-id/);
    expect(res.stdout).not.toMatch(/^OK\b/m);
  });

  test('W4-D16 · an unbacked archival stub exits NON-ZERO — the CLI is what §2 step 6 runs', () => {
    const stub = '| W4-D07 | improve | Adapter mock | SHOULD | S | — | done | session 12 | ARCHIVED -> WAVE4_ARCHIVE.md#2026-08-22 |\n';
    const before = write('before.md', state());
    const after = write('after.md', state({ extraBacklogRows: stub }));
    const archive = write('archive.md', '# A\n\n## Archived 2026-08-22\n\nsomething unrelated\n');
    const res = run(['check', '--before', before, '--after', after, '--archive', archive]);
    expect(res.code).not.toBe(0);
    expect(res.stdout).toMatch(/VIOLATION W4-D07 archive-unbacked/);
  });

  test('W4-D16 · the same stub with the evidence really archived exits 0', () => {
    const stub = '| W4-D07 | improve | Adapter mock | SHOULD | S | — | done | session 12 | ARCHIVED -> WAVE4_ARCHIVE.md#2026-08-22 |\n';
    const before = write('before.md', state());
    const after = write('after.md', state({ extraBacklogRows: stub }));
    const archive = write('archive.md', '# A\n\n## Archived 2026-08-22\n\nW4-D07 — the evidence prose.\n');
    const res = run(['check', '--before', before, '--after', after, '--archive', archive]);
    expect(res.code).toBe(0);
    expect(res.stdout).toMatch(/^OK\b/m);
  });

  test('W4-D16 · an unbacked stub is caught with NO baseline too', () => {
    const stub = '| W4-D07 | improve | Adapter mock | SHOULD | S | — | done | session 12 | ARCHIVED -> WAVE4_ARCHIVE.md#nope |\n';
    const after = write('after.md', state({ extraBacklogRows: stub }));
    const res = run(['check', '--before', path.join(tmp, 'does-not-exist.md'), '--after', after]);
    expect(res.code).not.toBe(0);
    expect(res.stdout).toMatch(/archive-missing/);
    expect(res.stdout).not.toMatch(/^OK\b/m);
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
