'use strict';

// WORK_LEDGER.md — parse, edit, serialize. PURE: strings in, data out; no git, no clock.
//
// The file is markdown a human reads, and at the same time the record two partners write claims
// into from two branches that merge into `main` in any order. Both uses survive only if every edit
// is surgical. So the parser keeps the file as its own lines and an edit splices exactly the lines
// strictly between a `### Xnn` heading and the blank line before the next heading. The heading and
// that blank line are never rewritten: they are the unchanged context that lets git merge two fills
// of two different slots as two separate hunks (see backend/tests/coord.mergeSafety.test.js).
//
// Read tolerates CRLF and a BOM; write is always LF, UTF-8, no BOM.

const { normalizePath } = require('./paths');

const LEDGER_PATH = 'WORK_LEDGER.md';
const FREE = '_free_';
const SLOT_ID_RE = /^[A-Z]\d{2}$/;

function toLines(text) {
  return String(text === undefined || text === null ? '' : text)
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
}

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*$/;
const spans = (text) => [...String(text).matchAll(/`([^`]+)`/g)].map((m) => m[1]);

function splitRow(line) {
  const trimmed = String(line).trim();
  if (!trimmed.startsWith('|')) return null;
  let body = trimmed.slice(1);
  if (body.endsWith('|')) body = body.slice(0, -1);
  return body.split('|').map((cell) => cell.trim());
}

const isSeparatorRow = (cells) => cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));

// → [{ start, end, title }] for every `## ` heading: the lines of that section, heading excluded.
function level2Sections(lines) {
  const out = [];
  lines.forEach((line, i) => {
    const m = HEADING_RE.exec(line);
    if (m && m[1].length === 2) {
      if (out.length) out[out.length - 1].end = i;
      out.push({ title: m[2], start: i + 1, end: lines.length, headingIndex: i });
    }
  });
  return out;
}

function sectionLines(lines, sections, title) {
  const s = sections.find((x) => x.title.toLowerCase() === title.toLowerCase());
  return s ? lines.slice(s.start, s.end) : [];
}

// The first table in a block of lines → [{ header: cell }] keyed by lower-cased header.
function firstTable(block) {
  for (let i = 0; i < block.length - 1; i += 1) {
    const header = splitRow(block[i]);
    const sep = splitRow(block[i + 1]);
    if (!header || !sep || !isSeparatorRow(sep)) continue;
    const keys = header.map((h) => h.toLowerCase());
    const rows = [];
    for (let j = i + 2; j < block.length; j += 1) {
      const cells = splitRow(block[j]);
      if (!cells) break;
      const row = {};
      keys.forEach((k, idx) => { row[k] = cells[idx] === undefined ? '' : cells[idx]; });
      rows.push(row);
    }
    return rows;
  }
  return [];
}

// The one paragraph line of backticked items separated by ` · `.
function dottedList(block) {
  const re = /^`[^`]+`(?:\s+·\s+`[^`]+`)*\s*$/;
  const line = block.find((l) => re.test(l.trim()));
  return line ? spans(line) : [];
}

// Header rows that do not parse are collected, never dropped: a silently missing exclusive row or
// person is a rule nobody enforces. Callers stop with "cannot verify" when `errors` is not empty.
function parsePeople(rows, errors) {
  return rows.map((row, index) => {
    const numbers = spans(row['tasks ids'] || '').filter((s) => /^\d+$/.test(s)).map(Number);
    const plain = (cell) => (spans(cell)[0] || String(cell || '').trim());
    if (!plain(row.login) || !plain(row.section) || !String(row.name || '').trim()) {
      errors.push(`People row ${index + 1} needs a login, a name and a section`);
    }
    return {
      login: plain(row.login),
      name: String(row.name || '').replace(/`/g, '').trim(),
      section: plain(row.section),
      gitAuthors: spans(row['git author'] || ''),
      idBlock: numbers.length >= 2 ? { min: Math.min(numbers[0], numbers[1]), max: Math.max(numbers[0], numbers[1]) } : null,
      isOwner: index === 0,
    };
  });
}

function parseExclusive(rows, errors) {
  return rows.map((row, index) => {
    const patterns = [];
    if (!spans(row.path || '').length) errors.push(`Exclusive files row ${index + 1} has no backticked path: "${row.path}"`);
    for (const raw of spans(row.path || '').concat(spans(row['also claims'] || ''))) {
      let p;
      try {
        p = normalizePath(raw);
      } catch (err) {
        errors.push(`Exclusive files row ${index + 1}: ${err.message}`);
        continue;
      }
      if (!patterns.some((q) => q.toLowerCase() === p.toLowerCase())) patterns.push(p);
    }
    return { index, label: patterns[0] || `row ${index + 1}`, patterns };
  });
}

const LINE_RES = [
  ['task', /^- task: `([^`]+)` \((TASKS|own)\)$/],
  ['title', /^- title: (\S.*)$/],
  ['branch', /^- branch: `([^`]+)`$/],
  ['paths', /^- paths: (`[^`]+`(?:, `[^`]+`)*)$/],
  ['resources', /^- resources: (none|`[^`]+`(?:, `[^`]+`)*)$/],
  ['state', /^- state: (claimed|in-review · PR #(\d+))$/],
  ['started', /^- started: (\d{4}-\d{2}-\d{2})$/],
];

// → { free, claim, malformed } for the lines of one slot body.
function parseSlotBody(body) {
  const lines = body || [];
  if (lines.length === 1 && lines[0] === FREE) return { free: true, claim: null, malformed: null };
  if (lines.length !== LINE_RES.length) {
    return { free: false, claim: null, malformed: `expected "${FREE}" or ${LINE_RES.length} claim lines, found ${lines.length} line(s)` };
  }
  const got = {};
  for (let i = 0; i < LINE_RES.length; i += 1) {
    const [key, re] = LINE_RES[i];
    const m = re.exec(lines[i]);
    if (!m) return { free: false, claim: null, malformed: `line ${i + 1} should be "- ${key}: …" in the contract's format, found "${lines[i]}"` };
    got[key] = m;
  }
  const inReview = got.state[1] !== 'claimed';
  return {
    free: false,
    malformed: null,
    claim: {
      task: got.task[1],
      taskKind: got.task[2],
      title: got.title[1],
      branch: got.branch[1],
      paths: spans(got.paths[1]),
      resources: got.resources[1] === 'none' ? [] : spans(got.resources[1]),
      state: inReview ? 'in-review' : 'claimed',
      pr: inReview ? Number(got.state[2]) : null,
      started: got.started[1],
    },
  };
}

// A title is one line of plain text: every control character and both Unicode line separators
// (U+2028, U+2029 — JavaScript's `.` does not match them) become a space.
const oneLine = (s) => String(s === undefined || s === null ? '' : s)
  .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
  .replace(/\s{2,}/g, ' ')
  .trim();

// The characters a branch name in a slot may carry: no spaces, separators, backticks or commas.
const BRANCH_RE = /^[A-Za-z0-9._/-]+$/;
const ticks = (list) => list.map((x) => `\`${x}\``).join(', ');

function renderSlotBody(claim) {
  const state = claim.state === 'in-review' ? `in-review · PR #${claim.pr}` : 'claimed';
  return [
    `- task: \`${claim.task}\` (${claim.taskKind})`,
    `- title: ${oneLine(claim.title)}`,
    `- branch: \`${claim.branch}\``,
    `- paths: ${ticks(claim.paths)}`,
    `- resources: ${claim.resources && claim.resources.length ? ticks(claim.resources) : 'none'}`,
    `- state: ${state}`,
    `- started: ${claim.started}`,
  ];
}

const canonicalClaim = (c) => JSON.stringify([
  c.task, c.taskKind, c.title, c.branch, c.paths || [], c.resources || [], c.state, c.pr === undefined ? null : c.pr, c.started,
]);

// What the ledger writes it must read back as the same claim. start, ship and rescope check this
// before writing anything, so an input the format cannot hold is refused instead of half-written.
function claimRoundTrips(claim) {
  const back = parseSlotBody(renderSlotBody(claim));
  return !back.malformed && back.claim !== null && canonicalClaim(back.claim) === canonicalClaim(claim);
}

function parseLedger(text) {
  const lines = toLines(text);
  const sections = level2Sections(lines);
  const errors = [];
  const people = parsePeople(firstTable(sectionLines(lines, sections, 'People')), errors);
  const byName = new Map(people.map((p) => [p.name.toLowerCase(), p]));

  const personSections = sections.filter((s) => byName.has(s.title.toLowerCase()));
  const sectionStart = personSections.length ? personSections[0].headingIndex : lines.length;

  const slots = [];
  for (const sec of personSections) {
    const letter = byName.get(sec.title.toLowerCase()).section;
    for (let i = sec.start; i < sec.end; i += 1) {
      const m = HEADING_RE.exec(lines[i]);
      if (!m || m[1].length !== 3 || !SLOT_ID_RE.test(m[2])) continue;
      let next = i + 1;
      while (next < lines.length && !HEADING_RE.test(lines[next])) next += 1;
      let end = next;
      while (end > i + 1 && lines[end - 1] === '') end -= 1;
      const body = lines.slice(i + 1, end);
      const parsed = parseSlotBody(body);
      slots.push({
        id: m[2],
        section: letter,
        headingIndex: i,
        bodyStart: i + 1,
        bodyEnd: end,
        body,
        free: parsed.free,
        claim: parsed.claim,
        malformed: parsed.malformed,
      });
    }
  }

  return {
    lines,
    people,
    exclusive: parseExclusive(firstTable(sectionLines(lines, sections, 'Exclusive files')), errors),
    errors,
    shared: dottedList(sectionLines(lines, sections, 'Shared files')),
    ownerOnly: dottedList(sectionLines(lines, sections, 'Owner-only paths')),
    resources: dottedList(sectionLines(lines, sections, 'Resources')),
    sectionStart,
    slots,
  };
}

function serializeLedger(ledger) {
  return ledger.lines.join('\n');
}

// → new text with one slot's body replaced; `claim === null` frees it.
function setSlot(text, slotId, claim) {
  const ledger = parseLedger(text);
  const slot = ledger.slots.find((s) => s.id === slotId);
  if (!slot) throw new Error(`no slot ${slotId} in ${LEDGER_PATH}`);
  const body = claim ? renderSlotBody(claim) : [FREE];
  const lines = ledger.lines.slice();
  lines.splice(slot.bodyStart, slot.bodyEnd - slot.bodyStart, ...body);
  return lines.join('\n');
}

const lower = (s) => String(s || '').toLowerCase();

function personByLogin(ledger, login) {
  return (ledger && ledger.people.find((p) => lower(p.login) === lower(login))) || null;
}

function personBySection(ledger, letter) {
  return (ledger && ledger.people.find((p) => p.section === letter)) || null;
}

function otherPerson(ledger, person) {
  return (ledger && person && ledger.people.find((p) => p.section !== person.section)) || null;
}

// The first slot of my section that on `main` is free, or still records a branch that no longer
// exists on origin (its claim landed or was dropped), and that none of my own live claims uses.
function pickSlot({ mainLedger, section, remoteBranches, busySlots }) {
  if (!mainLedger) return null;
  for (const slot of mainLedger.slots) {
    if (slot.section !== section || busySlots.has(slot.id)) continue;
    if (slot.free) return slot.id;
    if (slot.claim && !remoteBranches.has(slot.claim.branch)) return slot.id;
  }
  return null;
}

// The text of the section area with every slot body collapsed to a marker: headings and the blank
// separators are what must never change.
function skeleton(ledger) {
  const out = [];
  const starts = new Map(ledger.slots.map((s) => [s.bodyStart, s]));
  for (let i = ledger.sectionStart; i < ledger.lines.length; i += 1) {
    const slot = starts.get(i);
    if (slot) {
      out.push('<slot body>');
      i = Math.max(i, slot.bodyEnd - 1);
      continue;
    }
    out.push(ledger.lines[i]);
  }
  return out.join('\n');
}

// → [{ kind, slot?, message }]: every change a branch made to the ledger that it may not make.
// Only lines inside slots of the author's own section whose branch is this branch may change; the
// header may change only for the owner; the section structure may not change for anyone.
function ledgerGuard({ baseText, headText, branch, login }) {
  const head = parseLedger(headText);
  const base = baseText === null || baseText === undefined ? null : parseLedger(baseText);
  const person = personByLogin(base || head, login);
  const out = [];
  if (!person) return [{ kind: 'unknown author', message: `@${login} is not in the People table` }];

  const headerOf = (l) => (l ? l.lines.slice(0, l.sectionStart).join('\n') : '');
  if (headerOf(head) !== headerOf(base) && !person.isOwner) {
    out.push({ kind: 'header', message: `only the owner changes the ledger header; ${person.name} changed it on ${branch}` });
  }
  if (base && skeleton(base) !== skeleton(head)) {
    out.push({ kind: 'structure', message: 'a section or slot heading, or a separating blank line, was added, removed or moved' });
  }

  const before = new Map(base ? base.slots.map((s) => [s.id, s.body.join('\n')]) : []);
  for (const slot of head.slots) {
    const prior = base ? before.get(slot.id) : FREE;
    if (prior === undefined || slot.body.join('\n') === prior) continue;
    if (slot.section !== person.section) {
      out.push({ kind: 'foreign section', slot: slot.id, message: `${slot.id} is not in ${person.name}'s section` });
      continue;
    }
    if (slot.malformed) {
      out.push({ kind: 'malformed slot', slot: slot.id, message: `${slot.id}: ${slot.malformed}` });
      continue;
    }
    const priorClaim = parseSlotBody(prior.split('\n')).claim;
    const mine = slot.claim ? slot.claim.branch === branch : Boolean(priorClaim && priorClaim.branch === branch);
    if (!mine) {
      out.push({ kind: 'foreign slot', slot: slot.id, message: `${slot.id} belongs to another branch, not ${branch}` });
    }
  }

  const named = head.slots.filter((s) => s.claim && s.claim.branch === branch);
  if (named.length > 1) {
    out.push({ kind: 'duplicate branch', slot: named.map((s) => s.id).join(', '), message: `${named.map((s) => s.id).join(' and ')} all name ${branch}` });
  }
  return out;
}

module.exports = {
  LEDGER_PATH,
  FREE,
  toLines,
  parseLedger,
  serializeLedger,
  setSlot,
  renderSlotBody,
  parseSlotBody,
  personByLogin,
  personBySection,
  otherPerson,
  pickSlot,
  skeleton,
  ledgerGuard,
  oneLine,
  claimRoundTrips,
  BRANCH_RE,
};
