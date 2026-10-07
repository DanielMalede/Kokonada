'use strict';

// OPS-152 · WORK_LEDGER.md — the parser contract.
//
// Two partners write claims into ONE markdown file, each on his own task branch, and those branches
// merge into `main` in any order. That only works if an edit is surgical: filling a slot rewrites the
// lines strictly inside that slot and nothing else, so two fills of two different slots are two
// disjoint hunks git merges on its own (coord.mergeSafety.test.js proves that with real git). A
// serializer that re-renders the whole file would turn every pair of claims into a merge conflict.
//
// The engine is pure: strings in, data out. The live pin at the bottom parses the real ledger.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const {
  LEDGER_PATH,
  FREE,
  parseLedger,
  serializeLedger,
  setSlot,
  renderSlotBody,
  parseSlotBody,
  personByLogin,
  personBySection,
  otherPerson,
  pickSlot,
  ledgerGuard,
  oneLine,
  claimRoundTrips,
  BRANCH_RE,
} = require(path.join(REPO_ROOT, 'scripts', 'coord', 'lib', 'ledger.js'));

const HEADER = `# Work ledger

Intro prose.

## Rules

1. A rule.

## People

| login | name | role | section | git author | TASKS ids |
|---|---|---|---|---|---|
| \`DanielMalede\` | Malede | owner | \`M\` | \`Full Stack Developer\` | the "Next free IDs" header |
| \`DanielBedrack\` | Bedrack | partner | \`B\` | \`DanielBedrack\` | \`900\` to \`999\` in every prefix |

## Exclusive files

Only one live claim may hold a row at a time.

| path | also claims |
|---|---|
| \`.github/workflows/**\` | \`backend/tests/ciWorkflowPermissions.test.js\`, \`backend/tests/nodeRuntimePin.test.js\` |
| \`backend/Dockerfile\` | \`backend/tests/nodeRuntimePin.test.js\` |
| \`backend/package.json\`, \`backend/package-lock.json\` | |
| \`AGENTS.md\` | |

## Shared files

Both partners may edit these at the same time.

\`TASKS.md\` · \`WORK_LEDGER.md\` · \`docs/SCREENS.md\` · \`docs/design-v2/DECISIONS.md\`

## Owner-only paths

Only Malede changes these.

\`.claude/**\` · \`docs/design-v2/pages/**\` · \`docs/plans/WAVE4_STATE.md\`

## Resources

Things that are not files.

\`res:atlas-prod\` · \`res:railway-vars\` · \`res:secrets\`
`;

// bodies: { M01: ['- task: ...', ...] } — every other slot is free.
function ledgerText(bodies = {}) {
  const slot = (id) => `### ${id}\n${(bodies[id] || [FREE]).join('\n')}\n`;
  const ids = (letter, n) => Array.from({ length: n }, (_, i) => `${letter}${String(i + 1).padStart(2, '0')}`);
  return `${HEADER}\n## Malede\n\n${ids('M', 12).map(slot).join('\n')}\n## Bedrack\n\n${ids('B', 6).map(slot).join('\n')}`;
}

const claim = (over = {}) => ({
  task: 'BE-120',
  taskKind: 'TASKS',
  title: 'Health reports the served sha',
  branch: 'fix/be120-health-sha',
  paths: ['backend/app/index.js', 'backend/tests/health.test.js'],
  resources: [],
  state: 'claimed',
  pr: null,
  started: '2026-10-06',
  ...over,
});

describe('OPS-152 · ledger — the slot body format', () => {
  test('a filled slot is exactly seven bullet lines in a fixed order', () => {
    expect(renderSlotBody(claim())).toEqual([
      '- task: `BE-120` (TASKS)',
      '- title: Health reports the served sha',
      '- branch: `fix/be120-health-sha`',
      '- paths: `backend/app/index.js`, `backend/tests/health.test.js`',
      '- resources: none',
      '- state: claimed',
      '- started: 2026-10-06',
    ]);
  });

  test('own tasks, resources and the in-review state render as the contract says', () => {
    const body = renderSlotBody(claim({
      task: 'own:project-explorer-ci', taskKind: 'own', resources: ['res:atlas-prod', 'res:secrets'], state: 'in-review', pr: 223,
    }));
    expect(body[0]).toBe('- task: `own:project-explorer-ci` (own)');
    expect(body[4]).toBe('- resources: `res:atlas-prod`, `res:secrets`');
    expect(body[5]).toBe('- state: in-review · PR #223');
  });

  test('a title can never break the slot onto a second line', () => {
    expect(renderSlotBody(claim({ title: 'one\r\ntwo\nthree' }))[1]).toBe('- title: one two three');
  });

  test('parse is the inverse of render', () => {
    for (const c of [claim(), claim({ task: 'own:x', taskKind: 'own', resources: ['res:secrets'], state: 'in-review', pr: 7 })]) {
      expect(parseSlotBody(renderSlotBody(c))).toEqual({ free: false, claim: c, malformed: null });
    }
    expect(parseSlotBody([FREE])).toEqual({ free: true, claim: null, malformed: null });
  });

  test('a body out of order, short, or empty is malformed — never silently half-read', () => {
    const body = renderSlotBody(claim());
    expect(parseSlotBody([body[1], body[0], ...body.slice(2)]).malformed).toEqual(expect.any(String));
    expect(parseSlotBody(body.slice(0, 6)).malformed).toEqual(expect.any(String));
    expect(parseSlotBody([]).malformed).toEqual(expect.any(String));
    expect(parseSlotBody(['_free_ ']).malformed).toEqual(expect.any(String));
  });
});

describe('OPS-152 · ledger — N2 · what the ledger writes it reads back, for any input it accepts', () => {
  const { normalizePath } = require(path.join(REPO_ROOT, 'scripts', 'coord', 'lib', 'paths.js'));

  test('oneLine strips every line separator and control character', () => {
    expect(oneLine('a\u2028b\u2029c\u0000d\u007fe\r\nf\tg')).toBe('a b c d e f g');
  });

  test('the branch rule is a plain character set', () => {
    expect(BRANCH_RE.test('fix/be120-health_sha.v2')).toBe(true);
    for (const bad of ['feat/a b', 'feat/`x`', 'feat/x,y', 'feat/\u2028', 'feat/é']) expect(BRANCH_RE.test(bad)).toBe(false);
  });

  test('the round-trip guard can fail: a title the parser would read back differently is caught', () => {
    expect(claimRoundTrips(claim())).toBe(true);
    expect(claimRoundTrips(claim({ title: 'two\nlines' }))).toBe(false);
    expect(claimRoundTrips(claim({ paths: ['a`b.js'] }))).toBe(false);
  });

  test('property: generated titles, paths and branches are either refused or round-trip exactly', () => {
    const alphabet = ['a', 'Z', '0', ' ', '·', '`', ',', '|', '\n', '\r', '\t', '\u2028', '\u2029', '\u0000', '\u007f', '-', '/', '.', '*', 'é', '_', '\\', ':'];
    let seed = 42;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const str = (n) => Array.from({ length: 1 + Math.floor(rnd() * n) }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join('');
    const accepted = { title: 0, path: 0, branch: 0 };
    for (let i = 0; i < 600; i += 1) {
      const title = oneLine(str(30));
      if (title) {
        expect({ title, ok: claimRoundTrips(claim({ title })) }).toEqual({ title, ok: true });
        accepted.title += 1;
      }
      let p = null;
      try { p = normalizePath(`docs/${str(10)}`); } catch { /* refused: fine */ }
      if (p) {
        expect(p).not.toMatch(/[\u0000-\u001f\u007f\u2028\u2029`,]/);
        expect({ p, ok: claimRoundTrips(claim({ paths: [p] })) }).toEqual({ p, ok: true });
        accepted.path += 1;
      }
      const b = `feat/${str(10)}`;
      if (BRANCH_RE.test(b)) {
        expect({ b, ok: claimRoundTrips(claim({ branch: b })) }).toEqual({ b, ok: true });
        accepted.branch += 1;
      }
    }
    expect(accepted.title).toBeGreaterThan(200);
    expect(accepted.path).toBeGreaterThan(10);
    expect(accepted.branch).toBeGreaterThan(10);
  });
});

describe('OPS-152 · ledger — parsing the header tables', () => {
  const ledger = parseLedger(ledgerText());

  test('People: login, name, section, git author, and the partner ID block', () => {
    expect(ledger.people.map((p) => [p.login, p.name, p.section])).toEqual([
      ['DanielMalede', 'Malede', 'M'],
      ['DanielBedrack', 'Bedrack', 'B'],
    ]);
    expect(ledger.people[0].gitAuthors).toEqual(['Full Stack Developer']);
    expect(ledger.people[0].isOwner).toBe(true);
    expect(ledger.people[1].isOwner).toBe(false);
    expect(ledger.people[0].idBlock).toBeNull();
    expect(ledger.people[1].idBlock).toEqual({ min: 900, max: 999 });
  });

  test('Exclusive files: each row is one group of every path in both columns', () => {
    expect(ledger.exclusive.map((g) => g.patterns)).toEqual([
      ['.github/workflows/**', 'backend/tests/ciWorkflowPermissions.test.js', 'backend/tests/nodeRuntimePin.test.js'],
      ['backend/Dockerfile', 'backend/tests/nodeRuntimePin.test.js'],
      ['backend/package.json', 'backend/package-lock.json'],
      ['AGENTS.md'],
    ]);
    expect(ledger.exclusive[0].label).toBe('.github/workflows/**');
  });

  test('the dotted lists: shared, owner-only, resources', () => {
    expect(ledger.shared).toEqual(['TASKS.md', 'WORK_LEDGER.md', 'docs/SCREENS.md', 'docs/design-v2/DECISIONS.md']);
    expect(ledger.ownerOnly).toEqual(['.claude/**', 'docs/design-v2/pages/**', 'docs/plans/WAVE4_STATE.md']);
    expect(ledger.resources).toEqual(['res:atlas-prod', 'res:railway-vars', 'res:secrets']);
  });

  test('sections and slots, each slot owned by the section it sits in', () => {
    expect(ledger.slots.map((s) => s.id)).toEqual([
      'M01', 'M02', 'M03', 'M04', 'M05', 'M06', 'M07', 'M08', 'M09', 'M10', 'M11', 'M12',
      'B01', 'B02', 'B03', 'B04', 'B05', 'B06',
    ]);
    expect(ledger.slots.every((s) => s.free)).toBe(true);
    expect(ledger.slots.find((s) => s.id === 'B03').section).toBe('B');
  });

  test('people lookups are by login, case-insensitively — never by first name', () => {
    expect(personByLogin(ledger, 'danielbedrack').name).toBe('Bedrack');
    expect(personByLogin(ledger, 'Daniel')).toBeNull();
    expect(personBySection(ledger, 'M').login).toBe('DanielMalede');
    expect(otherPerson(ledger, personByLogin(ledger, 'DanielMalede')).login).toBe('DanielBedrack');
  });

  test('git author may list several values (a name or an email), one backtick span each', () => {
    const text = ledgerText().replace('`Full Stack Developer`', '`Full Stack Developer`, `danielmalede@gmail.com`');
    expect(parseLedger(text).people[0].gitAuthors).toEqual(['Full Stack Developer', 'danielmalede@gmail.com']);
    const dotted = ledgerText().replace('`Full Stack Developer`', '`Full Stack Developer` · `Daniel <danielmalede@gmail.com>`');
    expect(parseLedger(dotted).people[0].gitAuthors).toEqual(['Full Stack Developer', 'Daniel <danielmalede@gmail.com>']);
    expect(serializeLedger(parseLedger(dotted))).toBe(dotted);
  });
});

describe('OPS-155 · ledger — N15 · the owner is named by an explicit role, never by row order', () => {
  const MALEDE_ROW = '| `DanielMalede` | Malede | owner | `M` | `Full Stack Developer` | the "Next free IDs" header |';
  const BEDRACK_ROW = '| `DanielBedrack` | Bedrack | partner | `B` | `DanielBedrack` | `900` to `999` in every prefix |';
  const sorted = ledgerText().replace(`${MALEDE_ROW}\n${BEDRACK_ROW}`, `${BEDRACK_ROW}\n${MALEDE_ROW}`);

  test('sorting the People table changes nobody\'s role', () => {
    expect(sorted).not.toBe(ledgerText());
    const parsed = parseLedger(sorted);
    expect(parsed.errors).toEqual([]);
    expect(parsed.people.map((p) => p.login)).toEqual(['DanielBedrack', 'DanielMalede']);
    expect(personByLogin(parsed, 'DanielMalede').isOwner).toBe(true);
    expect(personByLogin(parsed, 'DanielBedrack').isOwner).toBe(false);
    expect(serializeLedger(parsed)).toBe(sorted);
  });

  test('the owner-only header rule follows the role, whatever the row order', () => {
    const head = sorted.replace('1. A rule.', '1. A different rule.');
    expect(ledgerGuard({ baseText: sorted, headText: head, branch: 'feat/m', login: 'DanielMalede' })).toEqual([]);
    expect(ledgerGuard({ baseText: sorted, headText: head, branch: 'feat/b', login: 'DanielBedrack' }).map((v) => v.kind)).toEqual(['header']);
  });

  test('two owners, no owner, an unknown role, or no role column at all is an error', () => {
    const twoOwners = ledgerText().replace('| Bedrack | partner |', '| Bedrack | owner |');
    expect(parseLedger(twoOwners).errors.join('\n')).toMatch(/exactly one owner/);
    const noOwner = ledgerText().replace('| Malede | owner |', '| Malede | partner |');
    expect(parseLedger(noOwner).errors.join('\n')).toMatch(/exactly one owner/);
    const unknown = ledgerText().replace('| Bedrack | partner |', '| Bedrack | admin |');
    expect(parseLedger(unknown).errors.join('\n')).toMatch(/People row 2 .*role/);
    const noColumn = ledgerText()
      .replace('| login | name | role | section |', '| login | name | section |')
      .replace('|---|---|---|---|---|---|', '|---|---|---|---|---|')
      .replace('| Malede | owner |', '| Malede |')
      .replace('| Bedrack | partner |', '| Bedrack |');
    expect(parseLedger(noColumn).errors.join('\n')).toMatch(/role/);
    expect(parseLedger(noColumn).people.some((p) => p.isOwner)).toBe(false);
  });

  test('a role may be written plain or in backticks, in any case', () => {
    const ticked = ledgerText().replace('| Malede | owner |', '| Malede | `Owner` |');
    const parsed = parseLedger(ticked);
    expect(parsed.errors).toEqual([]);
    expect(personByLogin(parsed, 'DanielMalede').isOwner).toBe(true);
  });
});

describe('OPS-152 · ledger — a header row that does not parse is an error, never a silent drop', () => {
  test('a bad path or an empty cell in Exclusive files, and a People row with no login, are reported', () => {
    const bad = ledgerText()
      .replace('| `AGENTS.md` | |', '| `AGENTS.md` | |\n| `../outside.js` | |\n| no backticks here | |')
      .replace('| `DanielBedrack` | Bedrack |', '| | Bedrack |');
    const parsed = parseLedger(bad);
    expect(parsed.errors.join('\n')).toMatch(/outside\.js/);
    expect(parsed.errors.join('\n')).toMatch(/no backticks here/);
    expect(parsed.errors.join('\n')).toMatch(/People/);
    expect(parseLedger(ledgerText()).errors).toEqual([]);
  });
});

describe('OPS-152 · ledger — byte-stable edits', () => {
  test('parse then serialize returns an untouched file unchanged', () => {
    const text = ledgerText({ M01: renderSlotBody(claim()) });
    expect(serializeLedger(parseLedger(text))).toBe(text);
  });

  test('CRLF is tolerated on read; the write is LF', () => {
    const text = ledgerText({ M01: renderSlotBody(claim()) });
    const crlf = text.replace(/\n/g, '\r\n');
    const parsed = parseLedger(crlf);
    expect(parsed.slots.find((s) => s.id === 'M01').claim).toEqual(claim());
    expect(serializeLedger(parsed)).toBe(text);
  });

  test('a BOM is dropped on read and never written', () => {
    const text = ledgerText();
    expect(serializeLedger(parseLedger(`﻿${text}`))).toBe(text);
  });

  test('filling a slot rewrites ONLY the lines strictly inside it', () => {
    const before = ledgerText();
    const after = setSlot(before, 'M02', claim());
    const a = before.split('\n');
    const b = after.split('\n');
    const heading = a.indexOf('### M02');

    // everything up to and including the heading is identical
    expect(b.slice(0, heading + 1)).toEqual(a.slice(0, heading + 1));
    // the body is the seven claim lines, and the separating blank line and next heading follow intact
    expect(b.slice(heading + 1, heading + 8)).toEqual(renderSlotBody(claim()));
    expect(b.slice(heading + 8)).toEqual(a.slice(heading + 2));
    expect(b[heading + 8]).toBe('');
    expect(b[heading + 9]).toBe('### M03');
  });

  test('freeing a filled slot gives the original bytes back', () => {
    const before = ledgerText();
    expect(setSlot(setSlot(before, 'M05', claim()), 'M05', null)).toBe(before);
  });

  test('the last slot of the file keeps exactly one trailing newline', () => {
    const after = setSlot(ledgerText(), 'B06', claim());
    expect(after.endsWith('- started: 2026-10-06\n')).toBe(true);
    expect(after.endsWith('\n\n')).toBe(false);
    expect(parseLedger(after).slots.find((s) => s.id === 'B06').claim).toEqual(claim());
  });

  test('an unknown slot is an error, not a silent no-op', () => {
    expect(() => setSlot(ledgerText(), 'M13', claim())).toThrow(/M13/);
  });
});

describe('OPS-152 · ledger — picking a slot', () => {
  const remote = new Set(['main', 'feat/live-one']);

  test('the first free slot of my section', () => {
    const main = parseLedger(ledgerText());
    expect(pickSlot({ mainLedger: main, section: 'M', remoteBranches: remote, busySlots: new Set() })).toBe('M01');
    expect(pickSlot({ mainLedger: main, section: 'B', remoteBranches: remote, busySlots: new Set() })).toBe('B01');
  });

  test('a slot one of my own live claims uses is skipped', () => {
    const main = parseLedger(ledgerText());
    expect(pickSlot({ mainLedger: main, section: 'M', remoteBranches: remote, busySlots: new Set(['M01', 'M02']) })).toBe('M03');
  });

  test('a slot on main whose branch is gone from origin is reusable; one whose branch lives is not', () => {
    const main = parseLedger(ledgerText({
      M01: renderSlotBody(claim({ branch: 'feat/live-one' })),
      M02: renderSlotBody(claim({ branch: 'feat/landed-and-deleted' })),
    }));
    expect(pickSlot({ mainLedger: main, section: 'M', remoteBranches: remote, busySlots: new Set() })).toBe('M02');
  });

  test('all slots busy → null', () => {
    const all = new Set(['B01', 'B02', 'B03', 'B04', 'B05', 'B06']);
    expect(pickSlot({ mainLedger: parseLedger(ledgerText()), section: 'B', remoteBranches: remote, busySlots: all })).toBeNull();
  });
});

describe('OPS-152 · ledger — the CI guard on a branch\'s ledger edit', () => {
  const malede = 'DanielMalede';
  const bedrack = 'DanielBedrack';
  const base = ledgerText();
  const kinds = (v) => v.map((x) => x.kind).sort();

  test('filling my own slot for my own branch is clean', () => {
    const head = setSlot(base, 'B01', claim({ branch: 'feat/b' }));
    expect(ledgerGuard({ baseText: base, headText: head, branch: 'feat/b', login: bedrack })).toEqual([]);
  });

  test('editing the other partner\'s section fails', () => {
    const head = setSlot(base, 'M02', claim({ branch: 'feat/b' }));
    expect(kinds(ledgerGuard({ baseText: base, headText: head, branch: 'feat/b', login: bedrack }))).toEqual(['foreign section']);
  });

  test('editing a slot in my section that belongs to another branch fails', () => {
    const head = setSlot(setSlot(base, 'M01', claim({ branch: 'feat/m' })), 'M03', claim({ branch: 'feat/other' }));
    expect(kinds(ledgerGuard({ baseText: base, headText: head, branch: 'feat/m', login: malede }))).toEqual(['foreign slot']);
  });

  test('removing a slot heading fails, even for the owner', () => {
    const head = base.replace('### M05\n_free_\n\n', '');
    expect(kinds(ledgerGuard({ baseText: base, headText: head, branch: 'feat/m', login: malede }))).toEqual(['structure']);
  });

  test('a header change fails for the partner and passes for the owner', () => {
    const head = base.replace('1. A rule.', '1. A different rule.');
    expect(kinds(ledgerGuard({ baseText: base, headText: head, branch: 'feat/b', login: bedrack }))).toEqual(['header']);
    expect(ledgerGuard({ baseText: base, headText: head, branch: 'feat/m', login: malede })).toEqual([]);
  });

  test('two slots naming the same branch fail', () => {
    const head = setSlot(setSlot(base, 'B01', claim({ branch: 'feat/b' })), 'B02', claim({ branch: 'feat/b' }));
    expect(kinds(ledgerGuard({ baseText: base, headText: head, branch: 'feat/b', login: bedrack }))).toEqual(['duplicate branch']);
  });

  test('a malformed body in my own slot fails', () => {
    const head = base.replace('### B01\n_free_\n', '### B01\n- task: `own:x` (own)\n- branch: `feat/b`\n');
    expect(kinds(ledgerGuard({ baseText: base, headText: head, branch: 'feat/b', login: bedrack }))).toEqual(['malformed slot']);
  });

  test('a ledger new on this branch: the owner may create it; the partner may not', () => {
    const head = setSlot(base, 'M01', claim({ branch: 'chore/work-ledger' }));
    expect(ledgerGuard({ baseText: null, headText: head, branch: 'chore/work-ledger', login: malede })).toEqual([]);
    expect(kinds(ledgerGuard({ baseText: null, headText: head, branch: 'chore/work-ledger', login: bedrack })))
      .toEqual(['foreign section', 'header']);
  });
});

describe('OPS-152 · ledger — live pin on the real WORK_LEDGER.md', () => {
  const real = fs.readFileSync(path.join(REPO_ROOT, LEDGER_PATH), 'utf8');
  const ledger = parseLedger(real);
  const { tooBroadReason, normalizePath } = require(path.join(REPO_ROOT, 'scripts', 'coord', 'lib', 'paths.js'));

  test('is LF, has no BOM, and ends with exactly one newline', () => {
    expect(real.includes('\r')).toBe(false);
    expect(real.charCodeAt(0)).not.toBe(0xfeff);
    expect(real.endsWith('\n')).toBe(true);
    expect(real.endsWith('\n\n')).toBe(false);
  });

  test('round-trips byte for byte', () => {
    expect(serializeLedger(ledger)).toBe(real);
  });

  test('two people, twelve Malede slots, six Bedrack slots', () => {
    expect(ledger.people.map((p) => p.login)).toEqual(['DanielMalede', 'DanielBedrack']);
    // N15: the owner is named by the role column, and there is exactly one
    expect(real).toMatch(/^\| login \| name \| role \| section \| git author \| TASKS ids \|$/m);
    expect(ledger.people.map((p) => [p.login, p.isOwner])).toEqual([['DanielMalede', true], ['DanielBedrack', false]]);
    expect(ledger.slots.filter((s) => s.section === 'M')).toHaveLength(12);
    expect(ledger.slots.filter((s) => s.section === 'B')).toHaveLength(6);
  });

  test('every slot is free or a well-formed claim', () => {
    for (const slot of ledger.slots) expect({ id: slot.id, malformed: slot.malformed }).toEqual({ id: slot.id, malformed: null });
  });

  test('every header table row parses: groups == table rows, no errors', () => {
    expect(ledger.errors).toEqual([]);
    const lines = real.split('\n');
    const start = lines.indexOf('## Exclusive files');
    const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
    const rows = lines.slice(start, end).filter((l) => l.startsWith('| `'));
    expect(rows.length).toBeGreaterThanOrEqual(10);
    expect(ledger.exclusive).toHaveLength(rows.length);
  });

  test('every exclusive pattern is canonical and claimable', () => {
    expect(ledger.exclusive.length).toBeGreaterThanOrEqual(10);
    for (const group of ledger.exclusive) {
      for (const p of group.patterns) {
        expect(normalizePath(p)).toBe(p);
        expect(tooBroadReason(p)).toBeNull();
      }
    }
  });

  test('the shared list carries the two files every task edits', () => {
    expect(ledger.shared).toEqual(expect.arrayContaining(['TASKS.md', 'WORK_LEDGER.md']));
  });

  test('the resources list carries res:prod-deploy, the production freeze the engine reads, and says what it does', () => {
    const { FREEZE_RESOURCE } = require(path.join(REPO_ROOT, 'scripts', 'coord', 'lib', 'collide.js'));
    expect(FREEZE_RESOURCE).toBe('res:prod-deploy');
    expect(ledger.resources).toContain(FREEZE_RESOURCE);
    const lines = real.split('\n');
    const start = lines.indexOf('## Resources');
    const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
    expect(lines.slice(start, end)).toContain('Hold `res:prod-deploy` while production must not change (a recount, a migration, an incident): claim it on the branch doing that work; while anyone holds it, `check --merge` refuses every merge to `main`, since a merge deploys.');
  });
});
