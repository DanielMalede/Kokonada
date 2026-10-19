'use strict';
// RA-1 (resilience-auditor, PR #265 at 4d084d4): what the instruction layer tells an agent to open must
// exist. docs/ARCHIVE.md keeps an old path readable for history, and docsMap.test.js accepts any ledger
// path in any file, so six agent and command lines kept a moved or deleted path with CI green. Here a
// Moved-from or Deleted path, or a bare name only the ledger knows, is allowed on a line of the
// instruction layer only when that line also names docs/ARCHIVE.md (the "(deleted; see
// docs/ARCHIVE.md)" form compliance-auditor.md:16 and custodian.md:49 already use).
// fs reads only: no git, no network, no environment, no writes.
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const NOTE = 'docs/ARCHIVE.md';
const ROOT_FILES = ['CLAUDE.md', 'AGENTS.md', 'README.md'];
const DIRS = ['.claude/agents', '.claude/commands', '.agents'];
const J16_DOCS = ['docs/orchestrator-fable.md', 'docs/vision.md', 'docs/plans/design-v2-plan.md'];

const abs = (rel) => path.join(REPO_ROOT, rel);
const exists = (rel) => fs.existsSync(abs(rel));
const read = (rel) => fs.readFileSync(abs(rel), 'utf8');

function walkMd(rel, out = []) {
  if (!exists(rel)) return out;
  for (const e of fs.readdirSync(abs(rel), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'worktrees') continue;
    const child = `${rel}/${e.name}`;
    if (e.isDirectory()) walkMd(child, out);
    else if (e.isFile() && e.name.endsWith('.md')) out.push(child);
  }
  return out;
}

// The first backticked cell of each row of the Moved and Deleted tables: paths that are gone.
function gonePaths(text) {
  const gone = new Set();
  let inTable = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^## /.test(line)) {
      inTable = /^## (?:Moved|Deleted)\b/.test(line);
      continue;
    }
    if (!inTable || !line.startsWith('| `')) continue;
    const cell = line.split('|')[1].trim().replace(/^`|`$/g, '').trim();
    gone.add(cell.split(' ')[0].split('#')[0]);
  }
  return gone;
}

const TOKEN = /(?:\.\.\/)*(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.md\b/g;

// The spans of a line's `(was …)` parentheticals, nested parentheses included. CLAUDE.md's rule on where
// a markdown file is born lets one name an old path on purpose (docsMap rule 5): a token inside it
// passes, and the rest of its line is still checked.
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

// Path tokens of a line, minus URL tails, placeholders and globs (the skip rule docsMap.test.js:83 held
// at 4d084d4), and minus the tokens inside a `(was …)` parenthetical.
function tokensOf(line) {
  const out = [];
  const was = wasSpans(line);
  for (const m of line.matchAll(TOKEN)) {
    const before = line.slice(0, m.index);
    const word = before.slice(before.search(/\S*$/));
    if (/:\/\/|blob\//.test(word) || /[$<{*]/.test(word)) continue;
    if (was.some(([open, close]) => m.index > open && m.index < close)) continue;
    out.push(m[0]);
  }
  return out;
}

describe('the instruction layer names live paths (RA-1)', () => {
  const gone = gonePaths(read('docs/ARCHIVE.md'));
  const goneBase = new Set([...gone].map((p) => path.posix.basename(p)));
  const layer = [...ROOT_FILES, ...J16_DOCS, ...DIRS.flatMap((d) => walkMd(d))].filter(exists);
  const liveBase = new Set(
    [...layer, 'TASKS.md', 'WORK_LEDGER.md', 'WEAKNESSES_AND_FAILURES.md', ...walkMd('docs')]
      .filter(exists)
      .map((p) => path.posix.basename(p)),
  );

  const stale = (rel, lines) => lines.flatMap((line, i) => (line.includes(NOTE) ? [] : tokensOf(line)
    .filter((t) => gone.has(t) || (!t.includes('/') && goneBase.has(t) && !liveBase.has(t)))
    .map((t) => `${rel}:${i + 1} -> ${t}`)));

  it('read the ledger and the layer (an empty corpus would be a false green)', () => {
    expect(gone.size).toBeGreaterThan(50);
    expect(gone.has('docs/plans/DESIGN_V2_PLAN.md')).toBe(true);
    expect(layer).toEqual(expect.arrayContaining(['CLAUDE.md', '.claude/agents/developer.md', '.claude/commands/page.md']));
  });

  // The pin proved able to fail on every run, on lines planted in memory (no tracked file is touched):
  // an old path is caught, and only the ledger note or a (was …) parenthetical excuses it (OPS-278).
  it('has teeth: a planted stale line is caught, and only the two markers excuse it', () => {
    expect(stale('planted.md', ['build against docs/VISION.md.', 'Authoritative: PLAN.md.'])).toEqual([
      'planted.md:1 -> docs/VISION.md', 'planted.md:2 -> PLAN.md']);
    expect(stale('planted.md', ['build against docs/vision.md, was docs/VISION.md', 'docs/VISION.md (was a draft)'])).toEqual([
      'planted.md:1 -> docs/VISION.md', 'planted.md:2 -> docs/VISION.md']);
    expect(stale('planted.md', [
      'build against docs/vision.md (was docs/VISION.md).',
      'read `docs/vision.md` (was `docs/VISION.md`; before it `PLAN.md`)',
      '`PLAN.md` (deleted; see docs/ARCHIVE.md)',
    ])).toEqual([]);
  });

  it('no agent, command or rule file names a moved or deleted path unless its line points at the ledger', () => {
    expect(layer.flatMap((rel) => stale(rel, read(rel).split(/\r?\n/))).sort()).toEqual([]);
  });

  it("the coordinator's header tables in WORK_LEDGER.md name no moved or deleted path", () => {
    const lines = read('WORK_LEDGER.md').split(/\r?\n/);
    const end = lines.findIndex((l) => /^## Malede\b/.test(l));
    expect(end).toBeGreaterThan(0);
    expect(stale('WORK_LEDGER.md', lines.slice(0, end))).toEqual([]);
  });
});
