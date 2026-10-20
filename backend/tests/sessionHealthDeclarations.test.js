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
const PRIVACY_DOC = path.join(REPO_ROOT, 'docs/privacy-declarations.md');
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

// Round 1 (regulatory 1-4, compliance N1, N2 and N4, resilience B1 and N5): each statement says only
// what the code does.
describe('round 1: G3, the activity rule after B1, the in-flight pool and the job queue', () => {
  it('G3: every Retention row that states a removal on withdrawal names the user who had granted it', () => {
    const removalRows = retentionRows().filter((l) => WITHDRAWAL_REMOVES.test(l));
    expect(removalRows.length).toBeGreaterThanOrEqual(4); // serve events, the session, the heart rate, the cache
    for (const row of removalRows) expect(row).toMatch(/(?:for|by) a user who had granted it/);
    expect(withdrawalBullet()).toContain('for a user who granted health-data consent before the withdrawal');
  });

  it('B1: the session row removes the activity where the heart rate is still held, and past the trim only before the withdrawal', () => {
    const row = retentionRows().find((l) => l.startsWith('| The session itself'));
    expect(row).toContain('the activity of any session that still holds its heart rate');
    expect(row).toContain('the activity of a session made before the withdrawal whose heart rate and free text the daily job has already removed');
    expect(row).toContain('any activity on a session made after the withdrawal that holds no heart rate');
    expect(row).not.toContain('any session that carried a heart rate');
    expect(withdrawalBullet()).toContain('any activity on a session made after the withdrawal that holds no heart rate');
    expect(withdrawalBullet()).not.toContain('an activity chip chosen on a session that carried no heart rate;');
  });

  it('the in-flight candidate pool is named, with its window, in the cache row and the Art. 9 sentence', () => {
    const cache = retentionRows().find((l) => l.startsWith('| User-scoped cache (Redis)'));
    expect(cache).toMatch(/fails after the withdrawal can leave its candidate pool \(`pool:`\), which expires within 12 hours/);
    expect(cache).toMatch(/if that deletion did not finish, by the daily `sessionTrim` job \(`healthErasures=`\)/);
    expect(withdrawalBullet()).toMatch(/a candidate pool \(`pool:`\) left by a playlist generation already running that then fails \(it expires within 12 hours by default\)/);
  });

  it('account deletion erases the job queue\'s waiting learning jobs, and logs and backups keep their own retention', () => {
    expect(doc()).not.toContain('Deleting the account erases all of it');
    // Round 1 follow-up (regulatory, MUST NOT 3): naming the job queue as the only exception would imply
    // that deletion also reaches the values derived from health data in logs and backups.
    const healthLine = doc().split('\n').find((l) => l.includes('Deleting the account erases it'));
    expect(healthLine).toContain('application logs and any database backups follow their own retention');
    const deletionLine = doc().split('\n').find((l) => l.includes('Users can request data deletion'));
    expect(deletionLine).toContain('the account\'s learning jobs waiting in the job queue (`bull:reward-ingest:`)');
    expect(deletionLine).not.toMatch(/not yet deleted/);
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

// J1 (BE-074, DEC-125): the learning jobs in the job queue. Each statement is what the code does: the
// removal options (queues/queue.js, workers/index.js, rewardDispatch.js), the purge on account deletion
// and on a withdrawal with a grant on file (queues/userJobPurge.js), and the token the withdrawal line prints.
describe('J1: the learning jobs in the job queue', () => {
  const jobsRow = () => retentionRows().find((l) => l.startsWith('| Learning jobs waiting to be written'));

  it('have their own Retention row: deleted once run, with the options and the token, health-derived, never a heart-rate value', () => {
    const row = jobsRow();
    expect(row).toBeDefined();
    for (const phrase of [
      '`bull:reward-ingest:`', '**Deleted as soon as the job has run**', '`removeOnComplete`', '`removeOnFail`',
      'never a heart-rate value', '**health-derived data**', 'names only the error\'s type', 'Deleted with the account',
      'when a user who had granted health-data consent withdraws it, deleted before the withdrawal answers', '`learningJobs=`',
    ]) expect(row).toContain(phrase);
  });

  // J1 round 1 (R3, R4): the whole payload and the whole step, including the shared count that names no user.
  it('names every field the job carries and what the step writes besides the learned preferences', () => {
    const row = jobsRow();
    expect(row).toContain('one job is queued for the step that writes `RewardEvent` and `PersonalWeights` and, for an open-catalogue recording, adds the play\'s outcome to a shared count for that recording that names no user.');
    expect(row).toContain('a change to the four ranking coefficients, whether a track picked as new to the listener paid off, and, for an open-catalogue (CC0) recording, its identifier and whether the play counted for or against it; never a heart-rate value.');
  });

  it('names what a deletion or a withdrawal does not reach: the running job, a play that ends meanwhile, an unreachable queue', () => {
    const row = jobsRow();
    expect(row).toContain('A job already running when the account is deleted or the consent is withdrawn, queued by a play that ends while either request is processed, or waiting while the job queue cannot be reached or does not answer in time, is deleted once it has run');
    expect(row).toContain('what it writes to the learned preferences is not removed by that request: after a withdrawal it follows the `RewardEvent` and `PersonalWeights` rows above, and for a deleted account it stays under the deleted account\'s ID until the daily sweep of deleted accounts\' data removes it, within a day (`BE-028`, `BE-094`).');
  });

  // J1 round 1 (R5): the health bullet points at Retention for every job deletion does not reach, not only a running one.
  it('the health-data bullet points at Retention for the jobs deletion does not reach and what they write', () => {
    const healthLine = doc().split('\n').find((l) => l.includes('Deleting the account erases it'));
    expect(healthLine).toContain('the learning jobs waiting in the job queue (`bull:reward-ingest:`; see **Retention** for the jobs it does not reach and what they write)');
  });

  it('stands right after the PersonalWeights row', () => {
    const rows = retentionRows();
    expect(rows.indexOf(jobsRow())).toBe(rows.findIndex((l) => l.includes('(`PersonalWeights`)')) + 1);
  });

  it('the token the row names is the one the withdrawal line prints', () => {
    const src = fs.readFileSync(path.join(APP, 'services/privacy/consent.js'), 'utf8');
    expect(src).toMatch(/learningJobs=\$\{learningJobs\}/);
  });

  it('the cache row points at the jobs\' own row', () => {
    const cache = retentionRows().find((l) => l.startsWith('| User-scoped cache (Redis)'));
    expect(cache).toContain('The job queue (`bull:`) is not part of this cache; its learning jobs have their own row above.');
  });

  it('the Play deletion answer says deletion erases the waiting jobs, and no longer that it does not', () => {
    const line = doc().split('\n').find((l) => l.includes('Users can request data deletion'));
    expect(line).toContain('user-scoped Redis state and the account\'s learning jobs waiting in the job queue (`bull:reward-ingest:`)');
    expect(line).toContain('Once a learning job has run, the job queue deletes it.');
    expect(line).toContain('but what it writes to the learned preferences is not deleted with the account: it stays under the deleted account\'s ID until the daily sweep of deleted accounts\' data removes it, within a day (see **Retention**; `BE-028`, `BE-094`).');
    expect(line).not.toContain('keeps no job'); // J1 round 1 (R6′): no completeness word
    expect(line).not.toMatch(/not yet deleted|J1\) lands/);
  });

  it('the Art. 9 bullet names the jobs among what withdrawal erases, and not among what it does not remove', () => {
    const bullet = withdrawalBullet();
    const keeps = bullet.indexOf('Withdrawal does not remove');
    expect(keeps).toBeGreaterThan(-1);
    expect(bullet.indexOf('`bull:reward-ingest:`')).toBeGreaterThan(-1);
    expect(bullet.indexOf('`bull:reward-ingest:`')).toBeLessThan(keeps);
    expect(bullet.slice(keeps)).not.toContain('`bull:reward-ingest:`');
    expect(bullet.slice(keeps)).toContain('a learning job already running when the withdrawal is made, queued by a play that ends while it is processed, or waiting while the job queue cannot be reached or does not answer in time, each deleted by the job queue once it has run, and what such a job writes to the learned preferences, which then follows their own retention (see **Retention**);');
  });

  it('no statement still says the jobs wait for J1', () => {
    expect(doc()).not.toMatch(/until BE-074 \(J1\) lands|not yet deleted with the account|completed learning jobs the job queue keeps/);
  });
});

// J2 (T14): the state recompute jobs, the daily trim of their event log and the sweep of deleted accounts'
// data. The texts are the set compliance and regulatory reconciled (j2-T14-declarations-final-draft.md),
// pinned verbatim; the numbers the row gives are read from the code here, so neither can drift alone.
describe('J2: the state recompute jobs and the sweep of deleted accounts\' data', () => {
  const stateRow = () => retentionRows().find((l) => l.startsWith('| State recompute jobs'));
  const jobsRow = () => retentionRows().find((l) => l.startsWith('| Learning jobs waiting to be written'));
  const playLine = () => doc().split('\n').find((l) => l.includes('Users can request data deletion'));
  const GATE = '<!-- NEEDS VERIFICATION: "within a day" holds only once DAN-050 records the sweep armed (the opsmarkers arming) and a sweep run: a [sessionTrim] line with orphanErasures= a number, not refused or disabled, orphanBacklog=0, stateEvents= a number, and failures=0; until then no store answer may rely on it. -->';

  it('has its own Retention row, right after the learning jobs row', () => {
    const rows = retentionRows();
    expect(stateRow()).toBeDefined();
    expect(rows.indexOf(stateRow())).toBe(rows.indexOf(jobsRow()) + 1);
  });

  it('R-a: the limits that rest on the daily job, and the line that is the check that it ran', () => {
    expect(stateRow()).toContain('The limits in this row that rest on the daily `sessionTrim` job hold only on a day it runs in full, with its sweep armed, neither refused nor disabled, and leaving no backlog. Each run logs one `[sessionTrim]` line, which is the check that it ran: `orphanErasures=` gives the deleted accounts erased, or reads `disabled` when the sweep is not armed and `refused` when it would not or could not run; `orphanBacklog=` gives the deleted accounts left, or `unknown` when they could not be counted; `stateEvents=` gives the event-log entries deleted, or `failed`; and `failures=0` shows that no step failed.');
  });

  it('the row\'s own NEEDS VERIFICATION comment gates it on DAN-050 and the arming', () => {
    expect(stateRow()).toContain('<!-- NEEDS VERIFICATION: not yet run. Change to "were removed by <date>, after a count taken on <date>" only when DAN-050 records the pre-merge count, the deploy, the 48-hour recount with the deployed commit, and the sweep armed (DAN-050 records the `opsmarkers` arming and a `[sessionTrim]` line whose `orphanErasures=` is a number, with `orphanBacklog=0` and `failures=0`); until then no store answer may rely on this row. -->');
  });

  it('the tokens the row names are the ones the code prints', () => {
    for (const token of ['`stateJobs=`', '`stateEvents=`', '`orphanErasures=`', '`orphanBacklog=`', '`failures=0`']) expect(stateRow()).toContain(token);
    expect(fs.readFileSync(path.join(APP, 'services/privacy/consent.js'), 'utf8')).toMatch(/stateJobs=\$\{stateJobs\}/);
    const trim = fs.readFileSync(path.join(APP, 'workers/sessionTrim.worker.js'), 'utf8');
    expect(trim).toContain("[['orphanErasures', 'orphanBacklog'],");
    expect(trim).toContain("['stateEvents', () => trimStateEvents()]");
  });

  it('the bounds the row states are the code\'s: the log size, its 24 hours, and the two delays', () => {
    const { QUEUE_EVENTS_MAX_LEN } = require('../app/queues/queue');
    const { STATE_EVENTS_MAX_AGE_MS } = require('../app/queues/stateVectorJob');
    const n = QUEUE_EVENTS_MAX_LEN['state-vector-recompute'];
    expect(stateRow()).toContain(`keeps only about its last ${n} to ${2 * n} entries`);
    expect(stateRow()).toContain(`deletes every entry more than ${STATE_EVENTS_MAX_AGE_MS / 3600000} hours old`);
    const delay = (file) => Number(fs.readFileSync(path.join(APP, file), 'utf8').match(/stateVectorJobOptions\(userId, ([\d_]+)\)/)[1].replace(/_/g, '')) / 1000;
    expect(stateRow()).toContain(`(the job runs ${delay('services/wearable/metricStore.js')} seconds later)`);
    expect(stateRow()).toContain(`(${delay('services/biosonic/baselines.js')} seconds later)`);
  });

  it('the gate comment stands twice: after the learning jobs row\'s deleted-account sentence and after the deletion line\'s sweep sentence', () => {
    expect(doc().split(GATE)).toHaveLength(3);
    expect(jobsRow()).toContain(`${'what it writes to the learned preferences is not removed by that request: after a withdrawal it follows the `RewardEvent` and `PersonalWeights` rows above, and for a deleted account it stays under the deleted account\'s ID until the daily sweep of deleted accounts\' data removes it, within a day (`BE-028`, `BE-094`).'} ${GATE}`);
    expect(playLine()).toContain(`${'Rows that a request already in progress writes for the account after the deletion, such as a health-data sync, are removed by the same daily sweep, within a day (`BE-028`, `BE-094`).'} ${GATE}`);
  });

  it('(d2): both deletion doors try the job purge, then the consent withdrawal, before anything else', () => {
    expect(playLine()).toContain('Account deletion, in the app and in the script, first tries to delete the account\'s waiting jobs and then, if the latest consent record is a grant, tries to record a withdrawal of the account\'s health-data consent before it deletes anything else, so that the steps that check consent stop processing the account\'s health data while it is deleted; if the deletion stops before it has erased the account\'s data, the account stays, with that consent withdrawn if the withdrawal was recorded.');
  });

  it('(g): the consent records row says what a deletion that stops part-way leaves', () => {
    const row = retentionRows().find((l) => l.startsWith('| Consent records'));
    expect(row).toContain('Account deletion first tries to add a withdrawal row when the latest row is a grant; if the deletion stops before it erases this history, a row it added stays and the account reads as withdrawn until the user grants consent again.');
  });
});
