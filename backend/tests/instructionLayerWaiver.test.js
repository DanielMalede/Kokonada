'use strict';

// OPS-244 (PR #259) — the owner's waiver of the restart after a non-zero L check
// (CLAUDE.md session start step 2). CLAUDE.md wins over every other file, and a file that
// disagrees with it is the defect to fix. Reading a diff refreshes what a running session knows,
// not what it was started with: its permission lists and hook registration (.claude/settings.json),
// an agent's tool grant, model and effort (an agent file's front matter), or the waiver's own text.
// These cases pin the text that holds those back (the resilience, security and architect reviews of
// #259). Conduct under a waiver is OPS-246's, not this file's.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8')
  .replace(/^\uFEFF/, '')
  .replace(/\r\n?/g, '\n');

function section(text, title) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`## ${title}`));
  if (start < 0) return [];
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith('## ')) { end = i; break; }
  }
  return lines.slice(start + 1, end);
}

const step2 = section(read('CLAUDE.md'), 'Session start').find((l) => l.startsWith('2. ')) || '';
const from = step2.indexOf('may waive the restart');
const to = step2.indexOf('A main checkout that could not be fast-forwarded');
const waiver = from < 0 ? '' : step2.slice(from, to > from ? to : undefined);
const record = waiver.includes('states the waiver') ? waiver.slice(waiver.indexOf('states the waiver')) : '';

describe('OPS-244 · the L-check waiver in CLAUDE.md session start step 2', () => {
  test('the waiver and the record it leaves are both there', () => {
    expect(waiver).not.toBe('');
    expect(record).not.toBe('');
  });

  test('only the owner\'s own message in the session gives it', () => {
    expect(waiver).toMatch(/message he sends to this session/);
    expect(waiver).toMatch(/never a PR comment/);
  });

  test('it is an allow-list bound to W, the HEAD when he gives it', () => {
    expect(waiver).toMatch(/allow-list/);
    expect(waiver).toMatch(/\bW\b/);
  });

  test('an agent file\'s front matter, settings.json, .mcp.json and this step are never allowed', () => {
    expect(waiver).toMatch(/front matter/);
    expect(waiver).toMatch(/`tools:`/);
    expect(waiver).toMatch(/`\.claude\/settings\.json`/);
    expect(waiver).toMatch(/`\.mcp\.json`/);
    expect(waiver).toMatch(/this step/);
  });

  test('it is re-tested at every repeat of the check and lapses at the first change after W', () => {
    expect(waiver).toMatch(/every repeat/);
    expect(waiver).toMatch(/lapses/);
  });

  test('an unknown L, an uncomputable diff or a stuck checkout means a restart', () => {
    expect(waiver).toMatch(/unknown L/);
    expect(waiver).toMatch(/never a waiver/);
  });

  test('agents run as their own registered type, never through wider tools', () => {
    expect(waiver).toMatch(/own registered type/);
    expect(waiver).toMatch(/wider tools/);
  });

  test('its record names L, W, HEAD and the changed files, on every PR it reviews, sweeps or merges', () => {
    expect(record).toMatch(/\bL\b/);
    expect(record).toMatch(/--name-only/);
    expect(record).toMatch(/review/);
  });
});

describe('OPS-244 · each command that restates the L-check stop names the waiver', () => {
  test.each([
    '.claude/commands/review-pr.md',
    '.claude/commands/merge.md',
  ])('%s', (rel) => {
    const parts = read(rel).split(/(?<=[.;])\s+/);
    const stops = parts
      .map((text, i) => ({ text, i }))
      .filter(({ text }) => /until it restarts|must restart/.test(text));
    expect(stops.length).toBeGreaterThan(0);
    for (const { text, i } of stops) {
      expect(`${text} ${parts[i + 1] || ''}`).toMatch(/waive/);
    }
  });
});
