'use strict';
// The documentation map (README.md at the repository root, OPS-270). A markdown file that moves or dies
// gets a row in docs/ARCHIVE.md in the same commit and every live reference to it is rewritten; this
// test proves it, so the tree cannot drift back into dangling pointers, root sprawl or unnamed files.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const LEDGER = 'docs/ARCHIVE.md';

const ROOT_ALLOWLIST = [
  'AGENTS.md',
  'CLAUDE.md',
  'HANDOFF_2026-10-08_BEDRACK.md', // kept as history under DEC-185, on the owner's words (OPS-272)
  'README.md',
  'TASKS.md',
  'WEAKNESSES_AND_FAILURES.md',
  'WORK_LEDGER.md',
];

// Records nobody edits after the fact: their old references resolve through the ledger (README.md).
const FROZEN = [
  'docs/design-v2/decisions/',
  'docs/design-v2/registry/',
  'docs/plans/WAVE4_STATE.md',
  'docs/plans/WAVE4_ARCHIVE.md',
  'WEAKNESSES_AND_FAILURES.md',
];

// Test fixtures name paths that never existed on purpose.
const NOT_SCANNED = [LEDGER, 'backend/tests/', '.claude/hooks/merge-guard-trigger.test.mjs', 'scripts/coord/'];

const TEXT_EXT = new Set([
  '.md', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.json', '.yml', '.yaml', '.py', '.ps1', '.sh', '.gradle',
  '.kt', '.swift', '.txt', '.html', '.xml', '.plist', '.toml', '.cfg', '.properties',
]);

// Folders whose markdown is "living" and carries front matter (README.md § Names and front matter).
const FRONT_MATTER_DIRS = ['docs/architecture/', 'docs/design-v1/', 'docs/plans/'];
const FRONT_MATTER_EXEMPT = new Set(['docs/plans/WAVE4_STATE.md', 'docs/plans/WAVE4_ARCHIVE.md']);

const UPPER_NAMES = new Set(['ARCHIVE.md', 'DECISIONS.md', 'INDEX.md', 'README.md', 'WAVE4_STATE.md', 'WAVE4_ARCHIVE.md']);
const NUMBERED = /^(?:DEC|QA|CMP|REG)-\d+\.md$/;
const KEBAB = /^[a-z0-9][a-z0-9.-]*\.md$/;

function tracked() {
  return execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
}

function read(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
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

const TOKEN = /(?:\.\.\/)*(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.md\b/g;

// Every markdown path a line names, except the tails of URLs, placeholders, and lines marked (future).
function tokensOf(line) {
  if (/\(future\b/.test(line) || line.includes('docs/design-v2/pages/')) return [];
  const found = [];
  let m;
  while ((m = TOKEN.exec(line))) {
    const before = line.slice(0, m.index);
    const word = before.slice(before.search(/\S*$/));
    if (/:\/\/|blob\//.test(word) || /[$<{*]/.test(word)) continue;
    found.push(m[0].replace(/^(\.\.\/)+/, ''));
  }
  return found;
}

describe('the documentation map (README.md, docs/ARCHIVE.md)', () => {
  const files = tracked();
  const set = new Set(files);
  const byBase = new Map();
  for (const f of files) {
    const b = path.posix.basename(f);
    if (!byBase.has(b)) byBase.set(b, []);
    byBase.get(b).push(f);
  }
  const ledger = parseLedger(read(LEDGER));
  const archived = new Set();
  for (const { from, to } of ledger.moved) { archived.add(from); archived.add(to.split('#')[0]); }
  for (const p of ledger.deleted) archived.add(p.split(' ')[0]);
  for (const p of ledger.missing) archived.add(p);
  const archivedBase = new Set([...archived].map((p) => path.posix.basename(p)));

  // A repository path (it has a `/`) must exist or be in the ledger. A bare file name is checked only
  // when it names a tracked or archived file; otherwise it is a scratch or private-repository name the
  // tree cannot verify (PR-body drafts, Kokonada-private notes), and paths under Kokonada-private/
  // are outside this repository by design.
  const topLevel = new Set(files.filter((f) => f.includes('/')).map((f) => f.split('/')[0]));
  function resolves(token, referrer) {
    if (set.has(token) || archived.has(token)) return true;
    if (!token.includes('/')) return true;
    // A link relative to the referring file (DECISIONS.md -> decisions/DEC-001.md).
    const rel = path.posix.normalize(path.posix.join(path.posix.dirname(referrer), token));
    if (set.has(rel) || archived.has(rel)) return true;
    // Only a path rooted in one of this repository's top-level folders is ours to verify; the rest
    // (Kokonada-private/, session scratch folders, page templates like D/row.md) live elsewhere.
    return !topLevel.has(token.split('/')[0]);
  }

  it('actually read the repository', () => {
    expect(files.length).toBeGreaterThan(500);
    expect(ledger.moved.length).toBeGreaterThan(0);
    expect(ledger.deleted.length).toBeGreaterThan(0);
  });

  it('leaves no markdown reference dangling outside the ledger', () => {
    const dangling = [];
    for (const rel of files) {
      if (NOT_SCANNED.some((p) => rel.startsWith(p)) || rel.includes('/__tests__/')) continue;
      if (FROZEN.some((p) => rel.startsWith(p))) continue;
      if (!TEXT_EXT.has(path.posix.extname(rel))) continue;
      const lines = read(rel).split(/\r?\n/);
      lines.forEach((line, i) => {
        for (const t of tokensOf(line)) if (!resolves(t, rel)) dangling.push(`${rel}:${i + 1} -> ${t}`);
      });
    }
    expect(dangling).toEqual([]);
  });

  it('keeps the root to the allow-list', () => {
    const root = files.filter((f) => !f.includes('/') && f.endsWith('.md')).sort();
    expect(root).toEqual(ROOT_ALLOWLIST);
  });

  it('names every markdown file under docs/ by the rule', () => {
    const bad = files.filter((f) => f.startsWith('docs/') && f.endsWith('.md')).filter((f) => {
      const b = path.posix.basename(f);
      return !(UPPER_NAMES.has(b) || NUMBERED.test(b) || KEBAB.test(b));
    });
    expect(bad).toEqual([]);
  });

  it('gives every living document its front matter', () => {
    const living = files.filter((f) => f.endsWith('.md') && !FRONT_MATTER_EXEMPT.has(f) && (
      (f.startsWith('docs/') && !f.slice(5).includes('/')) || FRONT_MATTER_DIRS.some((d) => f.startsWith(d))));
    const missing = living.filter((f) => {
      const head = read(f).split(/\r?\n/, 12);
      if (head[0] !== '---') return true;
      const end = head.indexOf('---', 1);
      const fm = end > 0 ? head.slice(1, end) : head.slice(1);
      return !(fm.some((l) => /^status: (living|reference|frozen)$/.test(l)) && fm.some((l) => /^verified: \d{4}-\d{2}-\d{2}$/.test(l)));
    });
    expect(missing).toEqual([]);
  });

  it('keeps every ledger row true: moved targets exist, deleted and missing paths do not', () => {
    const broken = [];
    for (const { from, to } of ledger.moved) {
      if (!set.has(to.split('#')[0])) broken.push(`moved target gone: ${to}`);
      if (set.has(from)) broken.push(`moved source still tracked: ${from}`);
    }
    for (const p of ledger.deleted) if (set.has(p.split(' ')[0])) broken.push(`deleted path still tracked: ${p}`);
    for (const p of ledger.missing) if (set.has(p)) broken.push(`missing path now tracked, drop its row: ${p}`);
    expect(broken).toEqual([]);
  });
});
