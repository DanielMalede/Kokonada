'use strict';
// The rules of the documentation map (README.md at the repository root, OPS-270) as pure functions.
// docsMap.test.js runs them over the tracked tree and shadow.docsMap.rules.test.js pins them on fixtures,
// so the sweep and its self-tests share one code path (the pattern of wave4.attributionGuard.test.js).
// No fs, no git, no environment: the caller hands in the tracked paths, the ledger's text and today.
//
// A reference is a path ending in `.md`, in prose or as a markdown link target `](...)`:
//   1. a link target resolves against its referrer (`../` included) and must be tracked or in the ledger;
//   2. a prose path rooted in a top-level folder of the tree (or a `./`, `../` path, which resolves
//      against its referrer) must be tracked or in the ledger; one outside the repository's folders
//      (Kokonada-private/…, scratch folders, `~/`, `C:/`) is not this repository's to check;
//   3. `(future` exempts only the path it directly follows (`docs/x.md (future, OPS-1)`);
//   4. emphasis (`**p**`, `_p_`, `*p*`) does not hide a path; a glob (`**/x.md`), a URL tail (`://`,
//      `blob/`) or a placeholder (`<dir>/x.md`, `${X}/x.md`, `{a}`) is not one; `\` is read as `/`;
//   5. in the instruction layer (isStrict), a Moved-from, Deleted or Missing path dangles unless its line
//      names docs/ARCHIVE.md or the token sits inside a `(was …)` parenthetical, a Missing path may also
//      carry `(future` (it is planned; a moved or deleted one existed), and a bare name must be the
//      basename of a tracked file unless `(future` follows it. Elsewhere a ledger path resolves (history
//      keeps resolving) and a bare name is not checked (scratch and private names the tree cannot verify).
const path = require('path');

const posix = path.posix;

const LEDGER = 'docs/ARCHIVE.md';

// The instruction layer (CLAUDE.md's rule on where a markdown file is born): what it tells an agent to
// open must exist, so an old path there carries its `(was …)` or `(deleted; see docs/ARCHIVE.md)` marker.
const INSTRUCTION_FILES = new Set([
  'CLAUDE.md', 'AGENTS.md', 'README.md', 'docs/orchestrator-fable.md', 'docs/vision.md', 'docs/plans/design-v2-plan.md',
]);

function isStrict(rel) {
  return INSTRUCTION_FILES.has(rel) || (/^\.(?:claude|agents)\//.test(rel) && rel.endsWith('.md'));
}

// The three tables of the ledger, by their `## ` headings; the first backticked cell of a row is its path.
function parseLedger(text) {
  const out = { moved: [], deleted: [], missing: [] };
  let table = null;
  for (const line of text.split(/\r?\n/)) {
    if (/^## Moved\b/.test(line)) table = 'moved';
    else if (/^## Deleted\b/.test(line)) table = 'deleted';
    else if (/^## Missing before this reorg\b/.test(line)) table = 'missing';
    else if (/^## /.test(line)) table = null;
    if (!table || !line.startsWith('| `')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    const cell = (i) => (cells[i] || '').replace(/^`|`$/g, '').trim();
    if (table === 'moved') out.moved.push({ from: cell(0), to: cell(1) });
    else out[table].push(cell(0));
  }
  return out;
}

// A cell's path: the Deleted table words some rows (`X.md §0 "…", §4`), and a Moved target carries an anchor.
const cellPath = (cell) => cell.split(' ')[0].split('#')[0];

// A path ending in `.md`. `.md` may be followed by an emphasis marker or punctuation, never by a name
// character (`x.mdx`, `x.md5`, `x.md-old`, `x.md.bak` are not markdown references).
const TOKEN = /(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.md(?![A-Za-z0-9-]|\.[A-Za-z0-9])/g;

// An inline link `[text](target "title")`; the target may sit in angle brackets.
const LINK = /\]\(\s*(<[^<>\n]*>|[^\s()<>]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^()]*\)))?\s*\)/g;

// What a path is glued to on its left stops at white space and the quoting and bracketing marks.
const GLUED_LEFT = /[^\s`"'()[\]|,;]*$/;

// `(future` right after a path: past its anchor or line number and its closing marks, then white space.
const FUTURE_AFTER = /^(?:#[\w.%-]*|:\d+(?:[-–]\d+)?)?[`*_)\]>"']*\s*\(future\b/;

// A fenced code block opens with three or more backticks or tildes (CommonMark).
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

const escapes = (p) => p === '..' || p.startsWith('../');

// The spans of a line's code spans: a run of backticks opens one and the next run of the same length
// closes it (CommonMark); an unmatched run is literal.
function codeSpans(line) {
  const runs = [...line.matchAll(/`+/g)];
  const spans = [];
  for (let i = 0; i < runs.length; i += 1) {
    const close = runs.findIndex((r, k) => k > i && r[0].length === runs[i][0].length);
    if (close < 0) continue;
    spans.push([runs[i].index + runs[i][0].length, runs[close].index]);
    i = close;
  }
  return spans;
}

// The spans of a line's `(was …)` parentheticals, nested parentheses included.
function wasSpans(line) {
  const spans = [];
  for (const m of line.matchAll(/\(was\b/g)) {
    let depth = 0;
    for (let i = m.index; i < line.length; i += 1) {
      if (line[i] === '(') depth += 1;
      else if (line[i] === ')' && (depth -= 1) === 0) {
        spans.push([m.index, i]);
        break;
      }
    }
  }
  return spans;
}

// Not a path: a URL tail, a placeholder, a glob, or the tail of a path rooted elsewhere (`~/`, `C:/`).
// Outside code, a run of `*` or `_` glued to the left of a path is an emphasis opener (`**docs/x.md**`)
// unless a `/` or another marker follows it (`**/x.md` is a glob); inside code every star is literal.
function notAPath(glued, token, inCode) {
  const left = inCode ? glued : glued.replace(/^[*_]+(?![/*_])/, '');
  if (/:\/\//.test(left + token) || /(?:^|\/)blob\//.test(left + token)) return true;
  if (/[<>{}$]/.test(left) || left.includes('*')) return true;
  return left.endsWith('/') && left !== '/';
}

// Every reference on one line (backslashes already read as `/`), in reading order:
// { kind: 'link' | 'prose', token (as written, for the report), index, end, target (links) }.
function referencesOf(line, inFence) {
  const code = inFence ? [[0, line.length]] : codeSpans(line);
  const inCode = (i) => code.some(([open, close]) => i >= open && i < close);
  const refs = [];
  let prose = line;
  for (const m of line.matchAll(LINK)) {
    if (inCode(m.index)) continue; // a code span shows a link; it is not one
    const angled = m[1].startsWith('<');
    const raw = angled ? m[1].slice(1, -1) : m[1];
    const at = m.index + m[0].indexOf(m[1]) + (angled ? 1 : 0);
    prose = prose.slice(0, at) + ' '.repeat(raw.length) + prose.slice(at + raw.length);
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) continue; // a URL or a mailto
    const token = raw.split(/[#?]/)[0];
    if (!token.endsWith('.md') || /[<>{}$*]/.test(token)) continue;
    let target = token;
    try {
      target = decodeURI(token);
    } catch {
      // a malformed escape: check the target as written
    }
    refs.push({ kind: 'link', token, index: at, end: at + token.length, target });
  }
  for (const m of prose.matchAll(TOKEN)) {
    let token = m[0];
    let index = m.index;
    const inside = inCode(index);
    // No path starts with `-` (`ב-docs/x.md`, `[-space.md`), and outside code a leading `_` is emphasis.
    const lead = (inside ? /^-+/ : /^[-_]+/).exec(token);
    if (lead) {
      token = token.slice(lead[0].length);
      index += lead[0].length;
    }
    if (token === '.md' || token.endsWith('/.md')) continue;
    const glued = prose.slice(0, index).match(GLUED_LEFT)[0];
    if (notAPath(glued, token, inside)) continue;
    refs.push({ kind: 'prose', token, index, end: index + token.length });
  }
  return refs.sort((a, b) => a.index - b.index);
}

function createChecker({ tracked, ledgerText }) {
  const files = new Set(tracked);
  const bases = new Set(tracked.map((f) => posix.basename(f)));
  const topLevel = new Set(tracked.filter((f) => f.includes('/')).map((f) => f.split('/')[0]));
  const ledger = parseLedger(ledgerText);
  const gone = new Set([...ledger.moved.map((m) => cellPath(m.from)), ...ledger.deleted.map(cellPath)]);
  const missing = new Set(ledger.missing.map(cellPath));
  const goneBase = new Set([...gone].map((p) => posix.basename(p)));
  const missingBase = new Set([...missing].map((p) => posix.basename(p)));
  const stateOf = (p) => {
    if (files.has(p)) return 'tracked';
    if (gone.has(p)) return 'gone';
    return missing.has(p) ? 'missing' : null;
  };

  // Where a reference points: { paths } to look up, the first of them the one rule 2 roots; or
  // { outside } when it leaves the repository; or { bare } for a name with no folder.
  function locate(ref, referrer) {
    const here = posix.dirname(referrer);
    if (ref.kind === 'link') {
      const p = ref.target.startsWith('/') ? posix.normalize(ref.target.slice(1)) : posix.join(here, ref.target);
      return escapes(p) ? { outside: true, link: true } : { paths: [p], link: true };
    }
    if (!ref.token.includes('/')) return { bare: ref.token };
    if (/^\.\.?\//.test(ref.token)) {
      const p = posix.join(here, ref.token);
      return escapes(p) ? { outside: true } : { paths: [p] };
    }
    const p = posix.normalize(ref.token);
    return escapes(p) ? { outside: true } : { paths: [p, posix.join(here, ref.token)] };
  }

  // One reference's verdict: true when it resolves (or is not this repository's to check).
  function holds(where, { strict, noted, future }) {
    if (where.outside) return !where.link;
    if (where.bare !== undefined) {
      if (!strict || bases.has(where.bare)) return true;
      if (goneBase.has(where.bare)) return noted;
      return missingBase.has(where.bare) ? noted || future : future;
    }
    const states = where.paths.map(stateOf);
    if (states.includes('tracked')) return true;
    if (states.includes('gone')) return !strict || noted;
    if (states.includes('missing')) return !strict || noted || future;
    const root = where.paths[0];
    const rooted = where.link || !root.includes('/') || topLevel.has(root.split('/')[0]);
    return !rooted || future;
  }

  function check(referrer, text, { strict = false } = {}) {
    check.scanned.files += 1;
    const dangling = [];
    let fence = null;
    text.split(/\r?\n/).forEach((raw, i) => {
      const line = raw.replace(/\\+/g, '/');
      const mark = FENCE.exec(line);
      const rest = mark ? line.slice(mark[0].length) : '';
      let inFence = fence !== null;
      if (fence === null && mark && !(mark[1][0] === '`' && rest.includes('`'))) {
        fence = mark[1];
        inFence = true;
      } else if (fence !== null && mark && mark[1][0] === fence[0] && mark[1].length >= fence.length && !rest.trim()) {
        fence = null;
      }
      const refs = referencesOf(line, inFence);
      if (refs.length === 0) return;
      check.scanned.tokens += refs.length;
      const placed = refs.map((ref) => ({ ref, where: locate(ref, referrer) }));
      const noted = line.includes(LEDGER) || placed.some(({ where }) => where.paths && where.paths[0] === LEDGER);
      const was = wasSpans(line);
      for (const { ref, where } of placed) {
        const inWas = was.some(([open, close]) => ref.index > open && ref.index < close);
        const future = FUTURE_AFTER.test(line.slice(ref.end));
        if (!holds(where, { strict, noted: noted || inWas, future })) dangling.push(`${referrer}:${i + 1} -> ${ref.token}`);
      }
    });
    return dangling;
  }
  check.scanned = { files: 0, tokens: 0 };
  return check;
}

// The naming rule under docs/ (README.md § Names and front matter). The /page record keeps the names
// .claude/commands/page.md gives it (`verdicts/<seq>-G<k>-<agent>-r<round>-<sha12>.md`).
const UPPER_NAMES = new Set(['ARCHIVE.md', 'DECISIONS.md', 'INDEX.md', 'README.md', 'WAVE4_STATE.md', 'WAVE4_ARCHIVE.md']);
const NUMBERED = /^(?:DEC|QA|CMP|REG)-\d+\.md$/;
const KEBAB = /^[a-z0-9][a-z0-9.-]*\.md$/;
const PAGE_RECORD = 'docs/design-v2/pages/';

function isNamedByRule(rel) {
  if (rel.startsWith(PAGE_RECORD)) return true;
  const b = posix.basename(rel);
  return UPPER_NAMES.has(b) || NUMBERED.test(b) || KEBAB.test(b);
}

// The front matter of a living document: `---`, a `status:` and a `verified:` line, and its closing `---`
// within the first lines. Returns null when it holds, else what is wrong. `today` is YYYY-MM-DD.
const FRONT_MATTER_LINES = 12;
const STATUS = /^status: (?:living|reference|frozen)$/;
const VERIFIED = /^verified: (\d{4})-(\d{2})-(\d{2})$/;

function isCalendarDate(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function frontMatterProblem(text, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(today))) throw new TypeError(`frontMatterProblem: today must be YYYY-MM-DD, got ${today}`);
  const head = text.split(/\r?\n/, FRONT_MATTER_LINES);
  if (head[0] !== '---') return 'no front matter: the first line is not ---';
  const end = head.indexOf('---', 1);
  if (end < 0) return `the front matter has no closing --- in its first ${FRONT_MATTER_LINES} lines`;
  const fm = head.slice(1, end);
  if (!fm.some((l) => STATUS.test(l))) return 'status: is missing, or not living, reference or frozen';
  const v = fm.map((l) => VERIFIED.exec(l)).find(Boolean);
  if (!v) return 'verified: is missing, or not a YYYY-MM-DD date';
  const date = `${v[1]}-${v[2]}-${v[3]}`;
  if (!isCalendarDate(Number(v[1]), Number(v[2]), Number(v[3]))) return `verified: ${date} is not a calendar date`;
  return date > today ? `verified: ${date} is after today (${today})` : null;
}

module.exports = { LEDGER, createChecker, frontMatterProblem, isNamedByRule, isStrict, parseLedger };
