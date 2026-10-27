'use strict';

// TASKS.md — the rows a claim reads and marks. PURE: strings in, data out.
//
// A row is a top-level `- [ ] \`ID\`` (open) or `- [x] \`ID\`` (closed) line outside a code fence;
// its block is the indented sub-bullets under it. The fence matters: the file's own "Row format"
// section shows an example row with a real id (`BE-004`) inside a ``` block, and marking that
// example instead of the real row would leave the real row looking free.
//
// The coordinator writes exactly one line per claim, directly under the row line:
//   "  - status: taken by <Name> (@<login>) on branch `<b>` since <date>, ledger slot <Xnn>"
// A one-line insertion right under the row keeps two claims on two neighbouring rows mergeable
// (backend/tests/coord.mergeSafety.test.js). Human-written status lines are never touched.

const TASKS_PATH = 'TASKS.md';

const ROW_RE = /^- \[( |x|X)\] `([A-Z][A-Z0-9]*-\d+)`/;
const COORD_STATUS_RE = /^\s+- status: taken by .+ \(@[^)\s]+\) on branch `[^`]+` since \d{4}-\d{2}-\d{2}, ledger slot [A-Z]\d{2}\s*$/;
const STATUS_RE = /^\s+- status:/;

const toLines = (text) => String(text === undefined || text === null ? '' : text)
  .replace(/^﻿/, '')
  .replace(/\r\n?/g, '\n')
  .split('\n');

function rowsOfLines(lines) {
  const rows = [];
  let fenced = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const m = ROW_RE.exec(line);
    if (!m) continue;
    let end = i + 1;
    while (end < lines.length && /^\s+\S/.test(lines[end])) end += 1;
    rows.push({
      id: m[2],
      open: m[1] === ' ',
      index: i,
      text: line,
      blockEnd: end,
      block: lines.slice(i + 1, end),
    });
  }
  return rows;
}

function parseTaskRows(text) {
  return rowsOfLines(toLines(text));
}

function findOpenRow(text, id) {
  return parseTaskRows(text).find((r) => r.id === id && r.open) || null;
}

function statusLine({ name, login, branch, since, slot }) {
  return `  - status: taken by ${name} (@${login}) on branch \`${branch}\` since ${since}, ledger slot ${slot}`;
}

function isCoordStatusLine(line) {
  return COORD_STATUS_RE.test(String(line));
}

// → new text: `line` sits directly under the open row `id`, replacing an earlier coordinator line
// of that row. Throws when there is no such open row.
function setStatusLine(text, id, line) {
  const lines = toLines(text);
  const row = rowsOfLines(lines).find((r) => r.id === id && r.open);
  if (!row) throw new Error(`no open row ${id} in ${TASKS_PATH}`);
  const kept = row.block.filter((l) => !isCoordStatusLine(l));
  lines.splice(row.index + 1, row.block.length, line, ...kept);
  return lines.join('\n');
}

// Every backticked token on the row's status lines — human or coordinator. Callers keep the ones
// that are live branches on origin.
function branchesInStatus(row) {
  const out = [];
  for (const line of (row && row.block) || []) {
    if (!STATUS_RE.test(line)) continue;
    for (const m of line.matchAll(/`([^`]+)`/g)) if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

function addedIds(baseText, headText) {
  const before = new Set(parseTaskRows(baseText).map((r) => r.id));
  const out = [];
  for (const r of parseTaskRows(headText)) if (!before.has(r.id) && !out.includes(r.id)) out.push(r.id);
  return out;
}

function idNumber(id) {
  const m = /^[A-Z][A-Z0-9]*-(\d+)$/.exec(String(id));
  return m ? Number(m[1]) : null;
}

module.exports = {
  TASKS_PATH,
  parseTaskRows,
  findOpenRow,
  statusLine,
  isCoordStatusLine,
  setStatusLine,
  branchesInStatus,
  addedIds,
  idNumber,
};
