'use strict';

// Wave-4 STATE row-clobber guard — `docs/plans/WAVE4_STATE.md`.
//
// WAVE4_STATE.md is declared "the SINGLE resume source": the task tables in it are the only record
// of what is done, what is owned, and what is left. A session that composes the whole file from a
// read taken earlier and writes it back wholesale silently reverts everything committed in between.
// That is not hypothetical — `ccecca3` reset W4-001 from `in_progress` back to `pending` moments
// after the owning session had set it (W4-D02). Nothing noticed, because nothing was looking.
//
// The rule already existed in prose ("re-read STATE immediately before writing, never downgrade a
// row you did not set") and did not help; a rule nobody can fail loudly is not a control. So this
// module is the ONE implementation of "did this STATE edit illegally regress a row?", used by both
// the session (before it commits STATE) and the loop (scripts/run-mission.ps1, after EVERY session,
// against the sha that session started from).
//
// What it flags:
//   · regressed      — a row moved DOWN the status ladder (in_progress → pending, done → anything…)
//   · removed        — a row that existed before is simply gone (the other half of a stale rewrite)
//   · unknown-status — a known status was replaced by something unrecognisable (garbled cell)
//
// What it deliberately allows: §2.5 R2 reopening. A rank decrease is fine when the row carries the
// literal uppercase token REOPENED. That is the whole difference between the two cases — a reopen
// is a decision someone made and wrote down, a clobber is a decision nobody made. The token is
// uppercase on purpose: STATE already contains the word "reopened" in ordinary prose (and uses
// uppercase tokens like DISCOVERED / RESOLVED for deliberate annotations), so a case-insensitive
// match would switch the guard off by accident rather than by choice.
//
// The engine is pure: two strings in, violations out — no clock, no randomness (mission §0.4 S9),
// no git. Git and the filesystem live in the CLI layer only.
//
// CLI:
//   node scripts/wave4/state-guard.js check [--base <ref>] [--root <dir>]
//   node scripts/wave4/state-guard.js check --before <file> --after <file>

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const STATE_RELPATH = 'docs/plans/WAVE4_STATE.md';

// `failed` sits level with `done`: both are terminal, and reviving either is a decision rather
// than a routine step forward. Only a STRICT decrease is a regression, so done → failed (a
// re-classification at the same rank) stays allowed.
const STATUS_RANK = Object.freeze({ pending: 0, in_progress: 1, done: 2, failed: 2 });

const REOPEN_TOKEN = 'REOPENED';

// A table is a TASK table iff its header carries both an `id` and a `status` column. That is what
// separates the two real task tables from the PR queue (status, but no id) and the reflection log
// (neither) — without it, every PR status change would read as a task regression.
const ID_HEADER = 'id';
const STATUS_HEADER = 'status';

const PLACEHOLDER_RE = /^[—–-]*$/;

function statePath(root) {
  return path.join(root, ...STATE_RELPATH.split('/'));
}

function splitRow(line) {
  const trimmed = String(line).trim();
  if (!trimmed.startsWith('|')) return null;
  let body = trimmed.slice(1);
  if (body.endsWith('|')) body = body.slice(0, -1);
  return body.split('|').map((cell) => cell.trim());
}

function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{1,}:?$/.test(cell));
}

// Strip the markdown a human may have wrapped the cell in (`**done**`, `_failed_`, `` `done` ``)
// and accept the spelling variants of in_progress that show up in hand-edited tables.
// Emphasis is trimmed at the EDGES only — stripping `_` everywhere would turn `in_progress` into
// `inprogress` and quietly break the ladder this whole guard rests on.
const stripEmphasis = (cell) => String(cell === undefined || cell === null ? '' : cell)
  .replace(/^[*_`\s]+/, '')
  .replace(/[*_`\s]+$/, '');

function normalizeStatus(cell) {
  return stripEmphasis(cell).toLowerCase().replace(/[\s-]+/g, '_');
}

function normalizeId(cell) {
  return stripEmphasis(cell);
}

// → [{ id, status, rank, table, reopened, raw }] in document order, DUPLICATES INCLUDED.
//
// This is the one parser; `parseTaskRows` is the keyed view of it. Keeping a single walk matters:
// a second copy of "what is a task row?" is how two readers of the same table start disagreeing
// (the defect class this wave keeps re-finding), and the duplicate check below is only meaningful
// if it sees exactly the rows the diff sees.
function taskRowList(markdown) {
  const rows = [];
  if (typeof markdown !== 'string' || markdown === '') return rows;

  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  let section = '(unlabelled)';
  let table = null; // { idIdx, statusIdx, section }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    const heading = /^#{1,6}\s+(.*)$/.exec(line.trim());
    if (heading) {
      section = heading[1].trim().toLowerCase();
      table = null;
      continue;
    }

    const cells = splitRow(line);
    if (!cells) { table = null; continue; }
    if (isSeparatorRow(cells)) continue;

    if (!table) {
      // Only a header immediately followed by a separator row opens a table — a stray pipe-line in
      // prose must not be mistaken for one.
      const next = splitRow(lines[i + 1] || '');
      if (!next || !isSeparatorRow(next)) continue;

      const headers = cells.map((cell) => cell.toLowerCase());
      const idIdx = headers.indexOf(ID_HEADER);
      const statusIdx = headers.indexOf(STATUS_HEADER);
      if (idIdx === -1 || statusIdx === -1) continue;

      table = { idIdx, statusIdx, section };
      continue;
    }

    const id = normalizeId(cells[table.idIdx]);
    if (!id || PLACEHOLDER_RE.test(id)) continue;

    rows.push({
      id,
      status: normalizeStatus(cells[table.statusIdx]),
      rank: STATUS_RANK[normalizeStatus(cells[table.statusIdx])],
      table: table.section,
      reopened: line.includes(REOPEN_TOKEN),
      raw: line,
    });
  }

  return rows;
}

// → Map<id, row> in document order. LAST row wins on a repeated id — see duplicateIdViolations
// for why that is a hazard rather than a convention, and W4-D54 for the time it bit.
function parseTaskRows(markdown) {
  const rows = new Map();
  for (const row of taskRowList(markdown)) rows.set(row.id, row);
  return rows;
}

// → [{ id, kind: 'duplicate-id', count, table, message }] — a property of ONE document.
//
// W4-D54: the backlog carried `W4-D48` twice, for two unrelated findings. Because every consumer
// reads the keyed view, the earlier row simply did not exist as far as this guard was concerned:
// it could not be reported `removed`, a rank decrease on it was invisible, and `OK <n> rows`
// quietly under-reported by one. An id is the only handle STATE gives a row, so one id must mean
// one row — across BOTH tables, since they share a single id space and a session resolving
// "W4-D48" does not know which table to look in.
function duplicateIdViolations(markdown) {
  const seen = new Map();
  for (const row of taskRowList(markdown)) {
    const prior = seen.get(row.id);
    if (prior) prior.rows.push(row);
    else seen.set(row.id, { rows: [row] });
  }

  const violations = [];
  for (const [id, { rows }] of seen) {
    if (rows.length < 2) continue;
    const tables = [...new Set(rows.map((r) => r.table))];
    violations.push({
      id,
      kind: 'duplicate-id',
      count: rows.length,
      table: tables.join(' + '),
      message: `${id} appears ${rows.length} times (${tables.join(', ')}) — one id must resolve to one row; `
        + 'renumber the LATER row to the next free id and note the change in the reflection log',
    });
  }

  return violations;
}

// → [{ id, kind, before, after, table, message }]
function diffTaskRows(beforeMarkdown, afterMarkdown) {
  const before = parseTaskRows(beforeMarkdown);
  const after = parseTaskRows(afterMarkdown);
  const violations = [];

  for (const [id, prev] of before) {
    const next = after.get(id);

    if (!next) {
      violations.push({
        id,
        kind: 'removed',
        before: prev.status,
        after: null,
        table: prev.table,
        // Not suppressible by REOPENED: there is no legitimate reason to delete a task row, and
        // STATE's own header says to keep the task table authoritative and never drop history.
        message: `${id} was '${prev.status}' in the ${prev.table} and is now GONE — a stale rewrite dropped the row`,
      });
      continue;
    }

    const prevRank = STATUS_RANK[prev.status];
    if (prevRank === undefined) continue; // nothing trustworthy to compare against

    const nextRank = STATUS_RANK[next.status];
    if (nextRank === undefined) {
      violations.push({
        id,
        kind: 'unknown-status',
        before: prev.status,
        after: next.status,
        table: next.table,
        message: `${id} went from '${prev.status}' to unrecognised status '${next.status}'`,
      });
      continue;
    }

    if (nextRank < prevRank && !next.reopened) {
      violations.push({
        id,
        kind: 'regressed',
        before: prev.status,
        after: next.status,
        table: next.table,
        message: `${id} regressed '${prev.status}' -> '${next.status}' with no ${REOPEN_TOKEN} note`,
      });
    }
  }

  return violations;
}

function formatViolations(violations) {
  if (!violations || violations.length === 0) return '';
  return violations.map((v) => `VIOLATION ${v.id} ${v.kind}: ${v.message}`).join('\n');
}

function readStateAt(root, ref) {
  try {
    return execFileSync('git', ['show', `${ref}:${STATE_RELPATH}`], {
      cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null; // ref predates the file, shallow clone, no git — treat as "no baseline"
  }
}

function readStateWorktree(root) {
  try {
    return fs.readFileSync(statePath(root), 'utf8');
  } catch {
    return null;
  }
}

module.exports = {
  STATE_RELPATH,
  STATUS_RANK,
  REOPEN_TOKEN,
  statePath,
  splitRow,
  isSeparatorRow,
  normalizeStatus,
  taskRowList,
  parseTaskRows,
  duplicateIdViolations,
  diffTaskRows,
  formatViolations,
  readStateAt,
  readStateWorktree,
};

// --- CLI ------------------------------------------------------------------------------------
if (require.main === module) {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const root = flag('root') || process.cwd();

  if (argv[0] !== 'check') {
    process.stderr.write('usage: state-guard.js check [--base ref] [--root dir] [--before file] [--after file]\n');
    process.exit(2);
  }

  const afterFile = flag('after');
  const after = afterFile ? (() => { try { return fs.readFileSync(afterFile, 'utf8'); } catch { return null; } })()
    : readStateWorktree(root);

  if (after === null) {
    // The file we are supposed to be validating is unreadable. Passing here would make the guard
    // vacuous exactly when something is already wrong.
    process.stderr.write(`ERROR cannot read the STATE file to check (${afterFile || statePath(root)})\n`);
    process.exit(2);
  }

  // Duplicate ids are a property of the AFTER document alone, so this runs BEFORE the no-baseline
  // branch: on a fresh clone (or against a base ref older than the file) that branch returns OK
  // without reading a single row, which is exactly when a silent duplicate would sail through.
  const duplicates = duplicateIdViolations(after);

  const beforeFile = flag('before');
  const before = beforeFile ? (() => { try { return fs.readFileSync(beforeFile, 'utf8'); } catch { return null; } })()
    : readStateAt(root, flag('base') || 'HEAD');

  if (before === null && duplicates.length === 0) {
    process.stdout.write('OK no-baseline (no earlier STATE to compare against)\n');
    process.exit(0);
  }

  const violations = duplicates.concat(before === null ? [] : diffTaskRows(before, after));
  if (violations.length === 0) {
    process.stdout.write(`OK ${parseTaskRows(after).size} rows, no regressions\n`);
    process.exit(0);
  }

  process.stdout.write(`${formatViolations(violations)}\n`);
  process.stdout.write(`FAILED ${violations.length} STATE row violation(s) — re-read WAVE4_STATE.md and re-apply your edit on top of it (W4-D02); a duplicate-id needs the LATER row renumbered (W4-D54)\n`);
  process.exit(1);
}
