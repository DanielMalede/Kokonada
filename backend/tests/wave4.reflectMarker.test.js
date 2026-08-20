'use strict';

// W4-D01 — the reflection close-out marker (`logs/wave4/last-reflect.txt`).
//
// WHY THIS IS RUN-STOPPING. MISSION §2 step 4 makes that one file the ONLY thing that clears the
// reflection trigger: "if it is missing, or >= REFLECT_INTERVAL_HOURS have passed ... this session
// is a REFLECTION session". Nothing but a session's voluntary compliance with §2.5 R7 ever wrote
// it, and `logs/` is gitignored, so a reflection that is killed, times out, or simply forgets R7
// leaves the trigger latched ON — every subsequent session reflects again and NO queue task can
// ever be picked. A 4-day autonomous run dies quietly.
//
// The repair therefore has two halves, and both are pinned here:
//   1. ONE tested implementation of the marker's format and staleness rule, shared by the loop and
//      by the session (scripts/wave4/reflect-marker.js) — so "is a reflection due?" stops being
//      re-derived by hand each session.
//   2. A MECHANICAL backstop in scripts/run-mission.ps1: after a session that reports REFLECT, the
//      loop itself verifies the marker was stamped and stamps it if the session didn't.
//
// This suite lives in backend/tests/ because jest is the repo's only harness; it reads repo-root
// tooling the same way tests/adr0012.tripwire.test.js reads app files. Nothing here touches the
// real logs/ directory — the engine is pure (`now` is a parameter, per mission §0.4 S9) and the
// CLI is exercised against a temp dir.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const MODULE_PATH = path.join(REPO_ROOT, 'scripts', 'wave4', 'reflect-marker.js');
const LOOP_SCRIPT = path.join(REPO_ROOT, 'scripts', 'run-mission.ps1');

const {
  MARKER_RELPATH,
  DEFAULT_INTERVAL_HOURS,
  FUTURE_SKEW_MS,
  formatMarker,
  parseMarker,
  reflectionDue,
  stampMarker,
} = require(MODULE_PATH);

const T0 = new Date('2026-08-19T12:00:00Z');
const SHA = '021657443f68d335466441be03bc578667c6c270';
const hoursAgo = (h) => new Date(T0.getTime() - h * 3600 * 1000);

describe('W4-D01 · reflect marker — contract', () => {
  test('the marker path is the one mission §2 step 4 reads', () => {
    expect(MARKER_RELPATH).toBe('logs/wave4/last-reflect.txt');
    expect(DEFAULT_INTERVAL_HOURS).toBe(4); // STATE: reflectIntervalHours
  });

  test('format is an ISO-8601 UTC timestamp on line 1 and the HEAD sha on line 2', () => {
    const text = formatMarker({ at: T0, sha: SHA });
    const lines = text.split('\n');

    // §2 step 4 describes the file as "a single ISO-8601 UTC timestamp", so line 1 stays bare and
    // machine-readable; §2.5 R7 wants "the current HEAD sha next to it" — line 2.
    expect(lines[0]).toBe('2026-08-19T12:00:00Z');
    expect(lines[1]).toBe(SHA);
    expect(text.endsWith('\n')).toBe(true);
  });

  test('format → parse round-trips', () => {
    const parsed = parseMarker(formatMarker({ at: T0, sha: SHA }));
    expect(parsed.at.toISOString()).toBe(T0.toISOString());
    expect(parsed.sha).toBe(SHA);
  });
});

describe('W4-D01 · reflect marker — parsing is tolerant, never throws', () => {
  // A marker that cannot be read must degrade to "reflect again" (safe), never to a crash that
  // takes the session down, and never to "fresh" (which would suppress reflections forever).
  test.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['whitespace only', '   \n\t\n'],
    ['prose instead of a timestamp', 'no reflection has run yet\n'],
    ['a number', 12345],
  ])('%s parses to an empty marker without throwing', (_label, input) => {
    const parsed = parseMarker(input);
    expect(parsed.at).toBeNull();
    expect(parsed.sha).toBeNull();
  });

  test('tolerates CRLF, blank lines and trailing whitespace', () => {
    const parsed = parseMarker(`\r\n  2026-08-19T12:00:00Z  \r\n\r\n${SHA}\r\n`);
    expect(parsed.at.toISOString()).toBe(T0.toISOString());
    expect(parsed.sha).toBe(SHA);
  });

  test('accepts a timestamp with no sha (sha is evidence, not the trigger)', () => {
    const parsed = parseMarker('2026-08-19T12:00:00Z\n');
    expect(parsed.at.toISOString()).toBe(T0.toISOString());
    expect(parsed.sha).toBeNull();
  });

  test('accepts the sha alongside the timestamp on one line', () => {
    const parsed = parseMarker(`2026-08-19T12:00:00Z ${SHA}\n`);
    expect(parsed.at.toISOString()).toBe(T0.toISOString());
    expect(parsed.sha).toBe(SHA);
  });
});

describe('W4-D01 · reflect marker — the staleness rule (mission §2 step 4)', () => {
  const due = (text, now = T0) => reflectionDue({ text, now, intervalHours: DEFAULT_INTERVAL_HOURS });

  test('missing marker → due (this is the documented cold-start case)', () => {
    expect(due(null)).toMatchObject({ due: true, reason: 'missing' });
    expect(due('')).toMatchObject({ due: true, reason: 'missing' });
  });

  test('unreadable marker → due, and says so (fail toward reflecting, never toward silence)', () => {
    expect(due('garbage\n')).toMatchObject({ due: true, reason: 'unparseable' });
  });

  test('fresh marker → NOT due', () => {
    expect(due(formatMarker({ at: hoursAgo(1), sha: SHA }))).toMatchObject({ due: false, reason: 'fresh' });
  });

  test('exactly at the interval → due (§2 says ">= REFLECT_INTERVAL_HOURS")', () => {
    expect(due(formatMarker({ at: hoursAgo(4), sha: SHA }))).toMatchObject({ due: true, reason: 'stale' });
  });

  test('past the interval → due', () => {
    expect(due(formatMarker({ at: hoursAgo(9.5), sha: SHA }))).toMatchObject({ due: true, reason: 'stale' });
  });

  test('a marker stamped in the FUTURE is rejected, not trusted', () => {
    // A clock skew or a bad hand-edit could otherwise park the timestamp years ahead and suppress
    // every future reflection — the same trap mission §0.4 S6 pins for biometric recordedAt.
    const far = new Date(T0.getTime() + 48 * 3600 * 1000);
    expect(due(formatMarker({ at: far, sha: SHA }))).toMatchObject({ due: true, reason: 'future' });
  });

  test('tolerates small clock skew without declaring the marker invalid', () => {
    const nudge = new Date(T0.getTime() + Math.floor(FUTURE_SKEW_MS / 2));
    expect(due(formatMarker({ at: nudge, sha: SHA }))).toMatchObject({ due: false, reason: 'fresh' });
  });

  test('the interval is a parameter, not a constant baked into the rule', () => {
    const text = formatMarker({ at: hoursAgo(3), sha: SHA });
    expect(reflectionDue({ text, now: T0, intervalHours: 4 }).due).toBe(false);
    expect(reflectionDue({ text, now: T0, intervalHours: 2 }).due).toBe(true);
  });
});

describe('W4-D01 · reflect marker — stamping', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'w4-reflect-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  test('stampMarker creates the logs/wave4 path if it does not exist', () => {
    // The very first stamp of a fresh clone has no logs/wave4 directory; a stamp that throws
    // ENOENT there would re-open the exact hole this task closes.
    const file = stampMarker({ root: tmp, at: T0, sha: SHA });

    expect(file).toBe(path.join(tmp, 'logs', 'wave4', 'last-reflect.txt'));
    expect(parseMarker(fs.readFileSync(file, 'utf8'))).toMatchObject({ sha: SHA });
    expect(reflectionDue({ text: fs.readFileSync(file, 'utf8'), now: T0, intervalHours: 4 }).due).toBe(false);
  });

  test('stamping clears a due trigger — the run can move on', () => {
    const before = reflectionDue({ text: null, now: T0, intervalHours: 4 });
    expect(before.due).toBe(true);

    stampMarker({ root: tmp, at: T0, sha: SHA });
    const text = fs.readFileSync(path.join(tmp, 'logs', 'wave4', 'last-reflect.txt'), 'utf8');
    expect(reflectionDue({ text, now: T0, intervalHours: 4 }).due).toBe(false);
  });

  test('the CLI stamps and reports, so the loop and the session share ONE implementation', () => {
    const out = execFileSync(process.execPath, [MODULE_PATH, 'stamp', '--sha', SHA, '--at', T0.toISOString()], {
      cwd: tmp, encoding: 'utf8',
    });
    expect(out).toMatch(/last-reflect\.txt/);

    const check = execFileSync(process.execPath, [MODULE_PATH, 'check', '--now', T0.toISOString()], {
      cwd: tmp, encoding: 'utf8',
    });
    expect(check).toMatch(/^NOT-DUE\b/);

    const later = new Date(T0.getTime() + 5 * 3600 * 1000).toISOString();
    const stale = execFileSync(process.execPath, [MODULE_PATH, 'check', '--now', later], {
      cwd: tmp, encoding: 'utf8',
    });
    expect(stale).toMatch(/^DUE\b/);
  });

  test('check on a repo with no marker at all reports DUE instead of crashing', () => {
    const out = execFileSync(process.execPath, [MODULE_PATH, 'check', '--now', T0.toISOString()], {
      cwd: tmp, encoding: 'utf8',
    });
    expect(out).toMatch(/^DUE missing/);
  });
});

// ---------------------------------------------------------------------------------------------
// The guard the W4-D01 DoD asks for: "a guard asserts it exists after a reflection".
//
// It cannot be a file-existence assertion — logs/ is gitignored, so the marker legitimately does
// not exist on a fresh clone or in CI. What must be guaranteed is the INVARIANT: a session that
// reports REFLECT does not get to leave the trigger latched. That is enforced in the loop, so the
// guard pins the loop's backstop and proves the detector can still fail.
// ---------------------------------------------------------------------------------------------
describe('W4-D01 · guard — the loop stamps the marker after a reflection session', () => {
  const loopSrc = () => fs.readFileSync(LOOP_SCRIPT, 'utf8');

  // (a) the backstop is defined, (b) it is invoked on a REFLECT result, (c) it actually touches
  // the marker file. Gutting any one of the three re-opens the hole.
  const definesBackstop = (src) => /function\s+Assert-ReflectMarkerStamped\b/.test(src);
  const invokesOnReflect = (src) =>
    /WAVE4_SESSION_RESULT:[^\n]*REFLECT[\s\S]{0,400}?Assert-ReflectMarkerStamped\b/.test(src);
  const touchesMarker = (src) => /last-reflect\.txt/.test(src);
  const hasBackstop = (src) => definesBackstop(src) && invokesOnReflect(src) && touchesMarker(src);

  test('detector self-test — the guard must be able to fail', () => {
    expect(hasBackstop('# a loop with no backstop at all')).toBe(false);
    expect(hasBackstop(loopSrc().replace(/function\s+Assert-ReflectMarkerStamped/g, 'function Unrelated-Thing')))
      .toBe(false);
    expect(hasBackstop(loopSrc().replace(/last-reflect\.txt/g, 'something-else.txt'))).toBe(false);
  });

  test('run-mission.ps1 defines the backstop and runs it on a REFLECT result', () => {
    const src = loopSrc();
    expect(definesBackstop(src)).toBe(true);
    expect(invokesOnReflect(src)).toBe(true);
    expect(touchesMarker(src)).toBe(true);
  });

  test('the loop reuses the shared implementation rather than re-inventing the format', () => {
    expect(loopSrc()).toMatch(/reflect-marker\.js/);
  });
});
