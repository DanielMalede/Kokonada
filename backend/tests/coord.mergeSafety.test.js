'use strict';

// OPS-152 · the ledger and TASKS edits merge on their own — proven with real git.
//
// Claims ride inside each task's own PR, so two partners' claims always meet in a three-way merge:
// when the second PR merges main in, or when GitHub squashes them in turn. If two claims on two
// different slots (or two status lines on two neighbouring TASKS rows) conflicted, every pair of
// parallel tasks would end in a hand-resolved conflict inside the very file that is supposed to
// prevent collisions. The format is designed so they do not; this suite runs `git merge-file` on
// the bytes the engine actually writes, so a format change that breaks the property fails here.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const lib = (name) => require(path.join(REPO_ROOT, 'scripts', 'coord', 'lib', name));
const { parseLedger, setSlot } = lib('ledger.js');
const { statusLine, setStatusLine, findOpenRow } = lib('tasks.js');

const seed = fs.readFileSync(path.join(REPO_ROOT, 'WORK_LEDGER.md'), 'utf8');
// Every slot free except M01, which holds a claim whose branch has since landed and been deleted.
const base = (() => {
  let text = seed;
  for (const slot of parseLedger(seed).slots) text = setSlot(text, slot.id, null);
  return setSlot(text, 'M01', claim('chore/landed-long-ago', { task: 'OPS-152' }));
})();

function claim(branch, over = {}) {
  return {
    task: 'own:x', taskKind: 'own', title: `work on ${branch}`, branch, paths: [`docs/notes/${branch.replace(/\//g, '-')}.md`],
    resources: [], state: 'claimed', pr: null, started: '2026-10-06', ...over,
  };
}

let tmp;
beforeAll(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coord-merge-')); });
afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

// → { code, text }: code is the number of conflicts git reports (0 = clean merge).
function merge3(baseText, ours, theirs) {
  const files = ['base', 'ours', 'theirs'].map((n) => path.join(tmp, `${n}-${Math.random().toString(36).slice(2)}.md`));
  [baseText, ours, theirs].forEach((t, i) => fs.writeFileSync(files[i], t, 'utf8'));
  const res = spawnSync('git', ['merge-file', '-p', files[1], files[0], files[2]], { encoding: 'utf8', windowsHide: true });
  if (res.error) throw res.error;
  return { code: res.status, text: res.stdout };
}

describe('OPS-152 · merge safety — WORK_LEDGER.md', () => {
  test('two fills of two DIFFERENT slots in the same section merge cleanly, both kept', () => {
    const a = setSlot(base, 'M02', claim('feat/a'));
    const b = setSlot(base, 'M03', claim('feat/b'));
    const { code, text } = merge3(base, a, b);
    expect(code).toBe(0);
    const merged = parseLedger(text);
    expect(merged.slots.find((s) => s.id === 'M02').claim.branch).toBe('feat/a');
    expect(merged.slots.find((s) => s.id === 'M03').claim.branch).toBe('feat/b');
    expect(merged.slots.every((s) => s.malformed === null)).toBe(true);
  });

  test('a fill in each partner\'s section merges cleanly', () => {
    const { code, text } = merge3(base, setSlot(base, 'M02', claim('feat/m')), setSlot(base, 'B01', claim('feat/b')));
    expect(code).toBe(0);
    expect(parseLedger(text).slots.filter((s) => s.claim).map((s) => s.id)).toEqual(['M01', 'M02', 'B01']);
  });

  test('reusing a landed slot while the other branch fills the next one merges cleanly', () => {
    const { code, text } = merge3(base, setSlot(base, 'M01', claim('feat/reuse')), setSlot(base, 'M02', claim('feat/next')));
    expect(code).toBe(0);
    const merged = parseLedger(text);
    expect(merged.slots.find((s) => s.id === 'M01').claim.branch).toBe('feat/reuse');
    expect(merged.slots.find((s) => s.id === 'M02').claim.branch).toBe('feat/next');
  });

  test('ship (state → in-review) on one slot and a fill of the neighbouring slot merge cleanly', () => {
    const filled = setSlot(base, 'M02', claim('feat/a'));
    const shipped = setSlot(filled, 'M02', claim('feat/a', { state: 'in-review', pr: 231 }));
    const neighbour = setSlot(filled, 'M03', claim('feat/b'));
    const { code, text } = merge3(filled, shipped, neighbour);
    expect(code).toBe(0);
    const merged = parseLedger(text);
    expect(merged.slots.find((s) => s.id === 'M02').claim.pr).toBe(231);
    expect(merged.slots.find((s) => s.id === 'M03').claim.branch).toBe('feat/b');
  });

  test('two fills of the SAME slot conflict — git refuses to pick a winner', () => {
    const { code } = merge3(base, setSlot(base, 'M02', claim('feat/a')), setSlot(base, 'M02', claim('feat/b')));
    expect(code).toBeGreaterThan(0);
  });
});

describe('OPS-152 · merge safety — TASKS.md status lines', () => {
  const TASKS = `# TASKS

## Backend

- [ ] \`BE-010\` \`P1\` First row.
  - where: \`backend/app/a.js\` · done when: a · added: 2026-10-01
- [ ] \`BE-011\` \`P1\` Second row, right below.
  - where: \`backend/app/b.js\` · done when: b · added: 2026-10-01
  - status: fix in progress on branch \`fix/human\` — a human note.
- [ ] \`BE-012\` \`P2\` Third row.
  - where: \`backend/app/c.js\`
`;
  const line = (who, login, branch, slot) => statusLine({ name: who, login, branch, since: '2026-10-06', slot });

  test('status lines under two ADJACENT rows merge cleanly, each under its own row', () => {
    const a = setStatusLine(TASKS, 'BE-010', line('Malede', 'DanielMalede', 'fix/be010', 'M02'));
    const b = setStatusLine(TASKS, 'BE-011', line('Bedrack', 'DanielBedrack', 'fix/be011', 'B01'));
    const { code, text } = merge3(TASKS, a, b);
    expect(code).toBe(0);
    expect(findOpenRow(text, 'BE-010').block[0]).toMatch(/fix\/be010/);
    expect(findOpenRow(text, 'BE-011').block[0]).toMatch(/fix\/be011/);
    expect(findOpenRow(text, 'BE-011').block).toContain('  - status: fix in progress on branch `fix/human` — a human note.');
  });

  test('the same row marked by both conflicts', () => {
    const a = setStatusLine(TASKS, 'BE-012', line('Malede', 'DanielMalede', 'fix/x', 'M02'));
    const b = setStatusLine(TASKS, 'BE-012', line('Bedrack', 'DanielBedrack', 'fix/y', 'B01'));
    expect(merge3(TASKS, a, b).code).toBeGreaterThan(0);
  });
});
