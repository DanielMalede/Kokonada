'use strict';

// BE-016 (DEC-111, DEC-118) — the store-facing declarations say what the session-health erasure does,
// word for word with the code (the regulatory brief's §12). Pure filesystem and source parsing:
//   • every field the erasure clears (sessionHealthPolicy.erasedFields) is named in the Retention
//     section on its model's row, and that row says withdrawal removes it;
//   • the exception text BE-016 replaces is gone, with its markers;
//   • the free text has its own row and is declared kept on withdrawal (C1);
//   • the tokens an operator checks are named, and the three timings are stated;
//   • P1's over-inclusion and DT-1b′'s chip rule are disclosed, with the chip words the code keeps;
//   • the user-scoped cache row names every registered namespace with the window the code sets;
//   • the learning rows and the Art. 9 section say what withdrawal removes and what it does not.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '../..');
const PRIVACY_DOC = path.join(REPO_ROOT, 'docs/PRIVACY_DECLARATIONS.md');
const APP = path.join(__dirname, '../app');

const { erasedFields, CHIP_ONLY_ACTIVITIES } = require('../app/services/privacy/sessionHealthPolicy');
const { USER_KEY_NAMESPACES } = require('../app/utils/userRedisPurge');
const { GENERAL_SESSION_TITLE } = require('../app/services/sessionLabels');

const doc = () => fs.readFileSync(PRIVACY_DOC, 'utf8');
function section(markdown, title) {
  const start = markdown.indexOf(`## ${title}`);
  if (start === -1) return null;
  const rest = markdown.slice(start + 3);
  const next = rest.indexOf('\n## ');
  return next === -1 ? rest : rest.slice(0, next);
}
const retentionRows = () => section(doc(), 'Retention').split('\n').filter((l) => l.startsWith('|'));
const art9 = () => section(doc(), 'GDPR Art.9 consent');
const withdrawalBullet = () => art9().split('\n').find((l) => l.includes('`withdrawn` row'));

// An affirmative removal: "They stay … after health-data consent is withdrawn" must never read as one.
const WITHDRAWAL_REMOVES = /(?:removed|deleted|erased) when health-data consent is withdrawn|withdrawing health-data consent removes/i;
const namesField = (line, model, field) => line.includes(`\`${field}\``) || line.includes(`\`${model}.${field}\``);
const namesModel = (line, model) => line.includes(`\`${model}\``) || line.includes(`\`${model}.`);

describe('every field the erasure clears is declared on its model\'s row, as removed by withdrawal', () => {
  const fields = Object.entries(erasedFields()).flatMap(([model, list]) => list.map((field) => [model, field]));

  it('the policy lists fields for both models (the check is not vacuous)', () => {
    expect(fields.length).toBeGreaterThanOrEqual(10);
  });

  it.each(fields)('%s.%s', (model, field) => {
    const row = retentionRows().find((l) => namesModel(l, model) && namesField(l, model, field) && WITHDRAWAL_REMOVES.test(l));
    expect(row).toBeTruthy();
  });
});

describe('the exception BE-016 closes is gone, with its markers', () => {
  it('no BE-016 marker and no "does not clear" for the session fields remain', () => {
    expect(doc()).not.toContain('<!-- BE-016 -->');
    expect(doc()).not.toMatch(/does not (?:yet )?clear/i);
    expect(doc()).not.toMatch(/stay after[^|]*health-data consent is withdrawn/i);
  });
});

describe('the heart-rate snapshot and the free text are two rows (C1)', () => {
  it('no Retention row names both; the free text row says withdrawal does not remove it', () => {
    const rows = retentionRows();
    expect(rows.filter((l) => l.includes('biometricSnapshot.heartRate') && l.includes('contextPrompt'))).toEqual([]);
    const note = rows.find((l) => l.includes('`PlaylistSession.contextPrompt`'));
    expect(note).toMatch(/Withdrawing health-data consent does not remove it/);
    expect(note).toMatch(/before the session is 31 days old\*\* \(default; `SESSION_SENSITIVE_RETENTION_DAYS`\)/);
  });

  it('the heart-rate row states the three timings and its clock in the 31-day form', () => {
    const hr = retentionRows().find((l) => l.includes('`PlaylistSession.biometricSnapshot.heartRate`'));
    expect(hr).toMatch(/before the withdrawal answers/);
    expect(hr).toMatch(/once it lands/);
    expect(hr).toMatch(/daily `sessionTrim` job \(`healthErasures=`\)/);
    expect(hr).toMatch(/before the session is 31 days old\*\* \(default; `SESSION_SENSITIVE_RETENTION_DAYS`\)/);
    expect(hr).toMatch(/`trimmed=`/);
    expect(hr).toMatch(/`sessionHealth=`/);
  });
});

describe('the session row discloses how far the erasure reaches', () => {
  const sessionRow = () => retentionRows().find((l) => l.startsWith('| The session itself'));

  it('P1: the app does not record which sessions health data shaped, so every earlier session loses its targets', () => {
    expect(sessionRow()).toMatch(/does not record which sessions health data shaped/);
  });

  it('DT-1b′: the activities kept on a session past the trim are exactly the code\'s chip-only words', () => {
    const word = (key) => (key === 'winding down' ? 'Winding down' : key.charAt(0).toUpperCase() + key.slice(1));
    for (const key of CHIP_ONLY_ACTIVITIES) expect(sessionRow()).toContain(word(key));
    for (const shared of ['Running', 'Resting', 'Walking']) expect(sessionRow()).not.toContain(shared);
  });

  it('History lists an erased heart-rate session with the server\'s general title', () => {
    expect(sessionRow()).toContain(`"${GENERAL_SESSION_TITLE}" (Live)`);
  });
});

describe('the user-scoped cache row is the registry, with the windows the code sets', () => {
  const src = (rel) => fs.readFileSync(path.join(APP, rel), 'utf8');
  // A key window in the words the declaration uses: whole hours, else minutes (24 hours, never "1 day").
  const words = (seconds) => (seconds % 3600 === 0 ? `${seconds / 3600} hours` : `${seconds / 60} minutes`);
  const defaultOf = (rel, re) => {
    const m = src(rel).match(re);
    expect(m).toBeTruthy();
    return m[1];
  };
  // A default written as a product in the source (`12 * 3600`).
  const product = (expr) => expr.split('*').map((s) => Number(s.trim())).reduce((a, b) => a * b, 1);
  // The prefix a namespace's keys start with, as the declaration names it.
  const prefix = (ns) => ns.pattern('<user>').split('<user>')[0];
  const WINDOWS = {
    'serve-ledger': () => `${Number(defaultOf('services/ledger/serveLedger.js', /LEDGER_HOT_DAYS \|\| '(\d+)'/))} days after its last write (default; \`LEDGER_HOT_DAYS\`)`,
    'candidate-pool': () => `${words(product(defaultOf('services/selection/candidatePool.js', /SELECTION_POOL_TTL_S \|\| String\(([\d *]+)\)/)))} (default; \`SELECTION_POOL_TTL_S\`)`,
    'live-buffer': () => `${words(Number(defaultOf('repositories/shadowBufferRepo.js', /SHADOW_BUFFER_TTL_S \|\| '(\d+)'/)))} (default; \`SHADOW_BUFFER_TTL_S\`)`,
    'bio-baseline': () => words(require('../app/services/biosonic/baselines').CACHE_TTL_S),
    'bio-affect': () => words(require('../app/services/biosonic/affectCache').AFFECT_TTL_S),
  };
  const cacheRow = () => retentionRows().find((l) => l.startsWith('| User-scoped cache (Redis)'));

  it('every registered namespace has a declared window (a new namespace forces a declaration)', () => {
    expect(USER_KEY_NAMESPACES.map((ns) => ns.name).sort()).toEqual(Object.keys(WINDOWS).sort());
  });

  it.each(USER_KEY_NAMESPACES.map((ns) => [ns.name, ns]))('%s: its prefix and its window, from the code', (name, ns) => {
    expect(cacheRow()).toContain(`\`${prefix(ns)}\` ${WINDOWS[name]()}`);
  });

  it('is erased on account deletion, Spotify disconnect and withdrawal, and names the in-flight window', () => {
    const row = cacheRow();
    expect(row).toMatch(/account deletion/);
    expect(row).toMatch(/\*\*Disconnect Spotify\*\*/);
    expect(row).toMatch(WITHDRAWAL_REMOVES);
    expect(row).toMatch(/`redisKeys=`/);
    expect(row).toMatch(/already being processed[^|]*`bio:affect:`[^|]*within 2 hours/);
  });

  it('never claims the whole of the user\'s Redis data: the job queue is outside the registry', () => {
    expect(cacheRow()).not.toMatch(/all (?:of the )?user-scoped Redis/i);
    expect(cacheRow()).toMatch(/job queue/);
  });

  it('stands after the ServeEvent row, so the TTL guard still reads that model\'s own row first', () => {
    const rows = retentionRows();
    expect(rows.indexOf(cacheRow())).toBeGreaterThan(rows.findIndex((l) => l.includes('`ServeEvent`')));
  });
});

describe('the learning rows and the Art. 9 section', () => {
  it.each(['RewardEvent', 'PersonalWeights'])('the %s row says a withdrawal erases it when a grant was on file', (model) => {
    const row = retentionRows().find((l) => l.includes(`(\`${model}\`)`));
    expect(row).toMatch(/erased when a user who had granted health-data consent withdraws it/);
  });

  it('the Art. 9 withdrawal sentence lists what is erased, both later paths, and what withdrawal does not remove', () => {
    const bullet = withdrawalBullet();
    for (const phrase of [
      'Before it answers', 'when a grant was on file', 'heart-rate snapshot', 'serve event', 'user-scoped cache',
      'once it lands', 'daily `sessionTrim` job (`healthErasures=`)', 'History keeps each session (see **Retention** for what it keeps)',
      'free text', 'tracks', 'Live', '`bull:reward-ingest:`', '`bio:affect:`', 'logs', 'backups',
    ]) expect(bullet).toContain(phrase);
  });

  it('no erasure statement claims completeness', () => {
    const statements = [...retentionRows().filter((l) => /health-data consent/.test(l)), withdrawalBullet()];
    for (const line of statements) {
      expect(line).not.toMatch(/\b(?:erases?|removes?|deletes?|deleted|removed|erased)\s+(?:all|everything)\b|every trace|permanent(?:ly)?|nothing is kept|anonymi[sz]/i);
    }
  });
});
