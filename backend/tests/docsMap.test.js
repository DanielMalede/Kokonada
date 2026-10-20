'use strict';
// The documentation map (README.md at the repository root, OPS-270). A markdown file that moves or dies
// gets a row in docs/ARCHIVE.md in the same commit and every live reference to it is rewritten; this
// test proves it, so the tree cannot drift back into dangling pointers, root sprawl or unnamed files.
// The rules live in helpers/docsMapRules.js, pinned on fixtures by shadow.docsMap.rules.test.js: the
// sweep below and those self-tests run one code path.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { LEDGER, createChecker, frontMatterProblem, isNamedByRule, isStrict, parseLedger } = require('./helpers/docsMapRules');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const ROOT_ALLOWLIST = [
  'AGENTS.md',
  'CLAUDE.md',
  'HANDOFF_2026-10-08_BEDRACK.md', // kept as history under DEC-185, on the owner's words (OPS-280)
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

// Floors under the sweep: an empty or cut-short listing must fail, never pass as clean. On 2026-10-19 it
// read 647 files and 2580 references, 35 of the files the instruction layer; each floor sits near half.
const MIN_SCANNED_FILES = 300;
const MIN_SCANNED_REFERENCES = 1200;
const MIN_STRICT_FILES = 20;
const INSTRUCTION_CORE = [
  'CLAUDE.md', 'AGENTS.md', 'README.md', 'docs/orchestrator-fable.md', 'docs/vision.md', 'docs/plans/design-v2-plan.md',
  '.claude/agents/developer.md', '.claude/commands/page.md', '.agents/skills/coordinate/SKILL.md',
];

// The latest date that is today anywhere (UTC+14): a `verified:` stamped with the local date just after
// midnight east of Greenwich is not "after today" by the clock of a machine in UTC.
const TODAY = new Date(Date.now() + 14 * 60 * 60 * 1000).toISOString().slice(0, 10);

function tracked() {
  return execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    .split('\0')
    .filter(Boolean);
}

function read(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

describe('the documentation map (README.md, docs/ARCHIVE.md)', () => {
  const files = tracked();
  const set = new Set(files);
  const ledgerText = read(LEDGER);
  const ledger = parseLedger(ledgerText);

  it('actually read the repository', () => {
    expect(files.length).toBeGreaterThan(500);
    expect(ledger.moved.length).toBeGreaterThan(0);
    expect(ledger.deleted.length).toBeGreaterThan(0);
  });

  it('leaves no markdown reference dangling outside the ledger, and no old path unmarked in the instruction layer', () => {
    const check = createChecker({ tracked: files, ledgerText });
    const strictScanned = [];
    const dangling = [];
    for (const rel of files) {
      if (NOT_SCANNED.some((p) => rel.startsWith(p)) || rel.includes('/__tests__/')) continue;
      if (FROZEN.some((p) => rel.startsWith(p))) continue;
      if (!TEXT_EXT.has(path.posix.extname(rel))) continue;
      const strict = isStrict(rel);
      if (strict) strictScanned.push(rel);
      dangling.push(...check(rel, read(rel), { strict }));
    }
    expect(check.scanned.files).toBeGreaterThan(MIN_SCANNED_FILES);
    expect(check.scanned.tokens).toBeGreaterThan(MIN_SCANNED_REFERENCES);
    expect(strictScanned.length).toBeGreaterThan(MIN_STRICT_FILES);
    expect(strictScanned).toEqual(expect.arrayContaining(INSTRUCTION_CORE));
    expect(dangling).toEqual([]);
  });

  it('keeps the root to the allow-list', () => {
    const root = files.filter((f) => !f.includes('/') && f.endsWith('.md')).sort();
    expect(root).toEqual(ROOT_ALLOWLIST);
  });

  it('names every markdown file under docs/ by the rule', () => {
    const bad = files.filter((f) => f.startsWith('docs/') && f.endsWith('.md')).filter((f) => !isNamedByRule(f));
    expect(bad).toEqual([]);
  });

  it('gives every living document its front matter', () => {
    const living = files.filter((f) => f.endsWith('.md') && !FRONT_MATTER_EXEMPT.has(f) && (
      (f.startsWith('docs/') && !f.slice(5).includes('/')) || FRONT_MATTER_DIRS.some((d) => f.startsWith(d))));
    expect(living.length).toBeGreaterThan(0);
    const missing = living.map((f) => [f, frontMatterProblem(read(f), TODAY)]).filter(([, problem]) => problem)
      .map(([f, problem]) => `${f}: ${problem}`);
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
