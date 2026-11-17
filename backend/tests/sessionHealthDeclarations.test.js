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

// DAN-015 (the regulatory brief at ae394f2): the declarations re-anchored on what the code does now.
// Each statement is pinned with the code fact it rests on, so neither can drift alone.
describe('DAN-015: the declarations re-anchored at ae394f2', () => {
  const src = (rel) => fs.readFileSync(path.join(APP, rel), 'utf8');
  const cacheRow = () => retentionRows().find((l) => l.startsWith('| User-scoped cache (Redis)'));

  it('D-1: the cache row says every playlist generation writes `bio:affect:`, with no consent check on that path', () => {
    expect(cacheRow()).toContain('that key expires within 2 hours. Every playlist generation also writes `bio:affect:` for every user, including one with no current health-data grant');
    expect(cacheRow()).toContain('Nothing is written while `WAVE4_AFFECT_DISABLED` is set (`affectService.js` `affectDisabled`) or while the cache cannot be reached.');
    expect(cacheRow()).toContain('Whether an estimate made without health data is health-derived data is an owner decision (NF-A, DAN015-Q3); the policy discloses it either way.');
    const targets = src('services/generation/targetsBuilder.js');
    expect(targets).toContain('const affect = await resolveAffect({');
    // RA-5: no consent check anywhere on the path that writes the estimate: the builder, the service and the cache.
    const CONSENT_CHECK = /healthWriteFence|healthConsentGate|getConsentStatus|privacy\/consent|consentState|getConsentState/;
    expect(targets).not.toMatch(CONSENT_CHECK);
    const affect = src('services/biosonic/affectService.js');
    expect(affect).not.toMatch(CONSENT_CHECK);
    expect(src('services/biosonic/affectCache.js')).not.toMatch(CONSENT_CHECK);
    expect(affect).toContain('const affectDisabled = () => disabled(process.env.WAVE4_AFFECT_DISABLED);');
    expect(affect).toContain("tzOffsetMinutes = 0, now, persist = 'background',"); // saved without waiting
  });

  it('OPS-173: the MorningState row names the withdrawal and the HealthKit lane among what re-applies the profile rule', () => {
    const row = retentionRows().find((l) => l.includes('(`MorningState`)'));
    expect(row).toContain('erased with the account and (all-or-nothing, alongside `MedicalProfile`) by per-wearable disconnect, by a withdrawal of health-data consent, and when the HealthKit lane\'s refusal or repair pass re-applies that rule');
    // The withdrawal runs the per-wearable erasure for every provider (consent.js → wearableErasure.js).
    const consent = src('services/privacy/consent.js');
    expect(consent).toMatch(/for \(const provider of WEARABLE_PROVIDERS\) \{\s*try \{\s*await eraseWearableProvider\(user, provider\);/);
  });

  it('OPS-173 (update of 2026-10-18): the two HealthKit journal rows say what the repair pass clears and when it keeps the journal', () => {
    const batches = retentionRows().find((l) => l.includes('(`healthingestbatches`)'));
    expect(batches).toContain('terminal record: until the request or a five-minute repair pass removes it; a pass that cannot read the consent store, or whose re-application of the all-or-nothing profile rule fails, keeps it for the next pass');
    expect(batches).not.toContain('next five-minute repair pass removes it |');
    const cleanups = retentionRows().find((l) => l.includes('(`healthprojectioncleanups`)'));
    expect(cleanups).toContain('and clears the Apple-provenance values (resting heart rate and sleep) of a medical profile whose account no longer passes the consent and connection check, keeping the profile\'s fields that carry no Apple provenance.');
    expect(cleanups).not.toContain('clears stale Apple-owned medical-profile provenance without deleting unrelated legacy or manual fields');
    // A fence that cannot be read decides nothing; a failing rule propagates (the journal stays).
    expect(src('services/wearable/healthStoreV2.js')).toContain("if (fence.reason === 'consent_read_error') return false;");
    expect(src('services/wearable/healthSampleReconciliation.js')).toContain("if (fence.reason === 'consent_read_error' || fence.admitted) continue;");
  });

  it('the three sample rows name the withdrawal, which erases them whether or not a grant was on file', () => {
    const rows = retentionRows();
    const bio = rows.find((l) => l.includes('(`BiometricLog`)'));
    const health = rows.find((l) => l.includes('(`HealthSample`)'));
    const vital = rows.find((l) => l.includes('(`VitalSample`)'));
    expect(bio).toMatch(/ Deleted with the account, by per-wearable disconnect, and by a withdrawal of health-data consent\. \|$/);
    expect(health).toMatch(/ Deleted with the account, by the disconnect of the provider that sent it, and by a withdrawal of health-data consent\. \|$/);
    expect(vital).toContain('erased with the account, by per-wearable disconnect and by a withdrawal of health-data consent, and included in the subject\'s export');
    // G3: these rows are not "removed when withdrawn by a user who had granted it" — the wearable erasure
    // on a withdrawal runs for any account (consent.js: before, and outside, the hadGrantOnFile gate).
    for (const row of [bio, health, vital]) expect(row).not.toMatch(WITHDRAWAL_REMOVES);
    const consent = src('services/privacy/consent.js');
    expect(consent.indexOf('await eraseWearableProvider(user, provider);')).toBeGreaterThan(-1);
    expect(consent.indexOf('await eraseWearableProvider(user, provider);')).toBeLessThan(consent.indexOf('if (hadGrantOnFile) {'));
  });

  it('BE-122: the Art. 9 bullet says which failed steps the daily job completes and which are only reported', () => {
    const bullet = withdrawalBullet();
    expect(bullet).toContain('A failed step of the session, serve-event or user-scoped-cache erasure is recorded as owed (`User.healthErasurePendingAt`) and completed by the daily `sessionTrim` job (`healthErasures=`).');
    expect(bullet).toContain('is reported in the `[consent-withdrawal]` line (`providerErasureFailures=`, `learning=failed`, `learningJobs=failed`, `stateJobs=failed`) and is not retried automatically');
    expect(bullet).toContain('The withdrawal still answers success, and the user has no retry path in the app.');
    expect(bullet).not.toContain('and a step that did not finish is completed by the daily');
    const consent = src('services/privacy/consent.js');
    for (const token of ['providerErasureFailures=${providerErasureFailures}', 'learning=${learning}', 'learningJobs=${learningJobs}', 'stateJobs=${stateJobs}']) {
      expect(consent).toContain(token);
    }
    // The daily sweep finishes only the session-health erasure; it never retries the other steps.
    expect(src('services/privacy/sessionHealthSweep.js')).not.toMatch(/eraseWearableProvider|purgeLearnedPersonalization|purgeUserJobs/);
    // The withdrawal answers with the consent status, whatever the erasure reported.
    // RA-4: the call is a bare statement (its result is not read), and the handler's next answer is the
    // consent status, with no error status in between.
    const ctrl = src('controllers/consentController.js');
    const call = ctrl.match(/^\s+await withdrawConsent\(req\.user\._id, purpose\);$/m);
    expect(call).toBeTruthy();
    const rest = ctrl.slice(call.index + call[0].length, ctrl.indexOf('\n};', call.index));
    const answer = rest.indexOf('res.json(await getConsentStatus(');
    expect(answer).toBeGreaterThan(-1);
    expect(rest.slice(0, answer)).not.toContain('res.status(');
    // The app offers the withdrawal only while a grant is on file, so a second withdrawal is not offered.
    const vault = fs.readFileSync(path.join(REPO_ROOT, 'mobile/KokonadaHealth/src/experience/profile/VaultConsentPanel.tsx'), 'utf8');
    const button = vault.indexOf('accessibilityLabel="withdraw-consent"');
    const section = vault.lastIndexOf('{/* Withdrawal', button);
    const gate = vault.indexOf('{consentGranted ? (', section);
    expect(section).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(section);
    expect(gate).toBeLessThan(button);
  });

  it('OPS-172: the Health and fitness answer, here and in the Play declaration, waits on the NF-A decision', () => {
    const NOTE = '<!-- NEEDS VERIFICATION: the state estimate (bio:affect:, Retention, the user-scoped cache row) is written for every user who generates a playlist and kept 2 hours, which is not ephemeral processing; if the owner\'s NF-A decision (DAN015-Q3) classes it as health data, Health info is collected from every such user and "Optional" no longer holds. File no Health and fitness answer before that decision. -->';
    const line = doc().split('\n').find((l) => l.startsWith('  - **Health and fitness** → **Health info**'));
    expect(line).toBeTruthy();
    expect(line.endsWith(` ${NOTE}`)).toBe(true);
    const store = fs.readFileSync(path.join(REPO_ROOT, 'docs/store/play-health-connect-declaration.md'), 'utf8');
    const row = store.split('\n').find((l) => l.startsWith('| Is data collection optional?'));
    expect(row).toBe(`| Is data collection optional? | **Yes** for health/fitness — the app has a "mood only" path that works without any wearable. ${NOTE} |`);
  });

  it('BE-097: the Play Personal info answer declares the User IDs the account is keyed by, as required', () => {
    const line = doc().split('\n').find((l) => l.includes('Personal info →'));
    expect(line).toBe('  - Personal info → **Email address**, **Name** (optional), **User IDs** (the account ID, the sign-in provider\'s subject or, for a password account, the normalized email, and the Garmin user ID when Garmin is connected). Purpose: Account management. Linked to user. Optional/required: required (email, User IDs).');
    const user = fs.readFileSync(path.join(APP, 'models/User.js'), 'utf8');
    expect(user).toContain('ssoId:       { type: String, required: true },');
    expect(user).toContain('garminUserId:      encryptedString({ default: null }),');
    // R287-4, C287-5: a password account's ssoId is its normalized email; the export names the account ID and the Garmin ID.
    const signup = src('services/auth/passwordAuth.js');
    expect(signup).toContain('const email = normalizeEmail(rawEmail);');
    expect(signup).toContain("const user = await User.create({ ssoProvider: 'password', ssoId: email, email });");
    const exporter = src('services/privacy/userDataExport.js');
    expect(exporter).toContain('subjectId:  String(userId),');
    expect(exporter).toContain('garminUserId:     u.garminUserId,');
    expect(src('controllers/integrationsController.js')).toContain('user.garminUserId = garminUserId;');
    // C287-2, R287-2: the Play declaration's Data safety row declares the same User IDs.
    const store = fs.readFileSync(path.join(REPO_ROOT, 'docs/store/play-health-connect-declaration.md'), 'utf8');
    expect(store.split('\n').find((l) => l.startsWith('| Other data types collected |'))).toBe('| Other data types collected | Personal info → Email (required), Name (optional), User IDs (required: the account ID and the sign-in identifier); App activity → user-generated music/taste content + in-app actions; Device or other IDs → push token. |');
  });

  it('C287-1: the holds on the store answers are visible, not only in comments', () => {
    const store = fs.readFileSync(path.join(REPO_ROOT, 'docs/store/play-health-connect-declaration.md'), 'utf8');
    const start = store.indexOf('> **Do not submit until:**');
    expect(start).toBeGreaterThan(-1);
    const hold = store.slice(start, store.indexOf('\n\n', start)).replace(/\n> /g, ' ');
    expect(hold).toContain('the owner\'s NF-A decision (DAN015-Q3) and a re-check of every Health and fitness answer; `DAN-050`\'s sweep record (the \'within a day\' answers and the `MedicalProfile` E-3 count); the sub-processor list complete (Sentry, `DAN-018`; the Atlas region).');
    const gate = section(store, '6. Pre-submission gate').split('\n');
    expect(gate).toContain('- [ ] The owner\'s NF-A decision (DAN015-Q3) made, and every Health and fitness answer re-checked against it.');
    expect(gate).toContain('- [ ] `DAN-050`\'s sweep record on file (the \'within a day\' answers and the `MedicalProfile` E-3 count).');
    expect(gate).toContain('- [ ] The sub-processor list complete (Sentry, `DAN-018`; the Atlas region).');
    expect(section(doc(), 'Cross-store consistency checklist').split('\n')).toContain('- [ ] No Health and fitness Data safety answer filed before NF-A (DAN015-Q3) is decided; sub-processor list complete (Sentry/DAN-018, Atlas region/DAN-018).');
  });

  it('C287-8: the Sub-processors lead sentence excepts the hosting and database providers, which hold the raw values', () => {
    const lead = section(doc(), 'Sub-processors (who touches the data, and what they receive)').split('\n').find((l) => l.startsWith('Kokonada uses the following processors.'));
    expect(lead).toBe('Kokonada uses the following processors. None is an advertiser. Apart from the hosting and database providers, which run and store the service on Kokonada\'s behalf, none receives raw biometric values or free text. All processing is on Kokonada\'s behalf to deliver the feature the user requested.');
  });

  it('hosting: Railway names its region and the cache it keeps on disk; Vercel, torn down, is no longer a row', () => {
    const lines = doc().split('\n');
    expect(lines.find((l) => l.startsWith('| **Railway**'))).toBe('| **Railway** | Application/API hosting, and the cache and job queue (Redis, kept on a disk volume as a snapshot written every 60 seconds when a key changed), in Railway\'s US West region (California, United States) | All application traffic (encrypted in transit), and what the cache and job-queue rows of **Retention** list | — <!-- verified: Railway service config read by the coordinator on 2026-11-17 (region `sfo` in the service config, Railway\'s US West (California) region; Redis 8.2.9, persistent volume, --save 60 1); not code, re-read before each store submission. Whether Railway backs up that volume, and for how long, is unrecorded. --> |');
    expect(lines.filter((l) => l.startsWith('| **Vercel**'))).toEqual([]);
    const atlas = lines.findIndex((l) => l.startsWith('| **MongoDB Atlas**'));
    expect(lines[atlas + 1]).toBe('<!-- NEEDS VERIFICATION: the MongoDB Atlas region is unrecorded (DAN-018); Railway per the coordinator\'s read of 2026-11-17; Vercel was torn down on 2026-09-23 (DAN-002) and its row removed. Sentry: `SENTRY_DSN` is defined on production (`BE-020`, `DAN-018`); until its value is read and Sentry is listed here with its region and what it receives, or the variable is removed (owner (b)), this list is incomplete and no store answer or policy recipient list may be filed from it. -->'); // C287-3
    expect(lines).toContain('- [ ] Re-verify inventory after Web Sunset removes web-only surfaces (drops the Vercel sub-processor). (Vercel torn down 2026-09-23, `DAN-002`)');
  });

  it('W: the website and the privacy mailbox have their own section, between the Sub-processors and Retention', () => {
    const TITLE = 'Website and privacy mailbox (outside the app)';
    const d = doc();
    const w = section(d, TITLE);
    expect(w).toBeTruthy();
    expect(d.indexOf(`## ${TITLE}`)).toBeGreaterThan(d.indexOf('> ZDR is not documented to disable prompt caching; no copy may say Groq retains nothing.'));
    expect(d.indexOf(`## ${TITLE}`)).toBeLessThan(d.indexOf('\n## Retention'));
    // R287-1 (b): the section's placement is the brief's recommendation, not yet the owner's ruling.
    const MARKER = '<!-- OWNER DECISION (DAN-015, decision 1): these recipients sit in their own section, outside Sub-processors, so the Data safety answers stay about the app only. This is the brief\'s recommendation, not yet a ruling. If they move into Sub-processors, its lead sentence that no processor receives raw biometric values or free text no longer holds, because Cloudflare receives the whole message. -->';
    expect(d).toContain(`## ${TITLE}\n${MARKER}\n`);
    for (const phrase of [
      '`privacy@kokonada.com`',
      'DNS only, not proxied',
      'GitHub\'s words: "When a GitHub Pages site is visited, the visitor\'s IP address is logged and stored for security purposes, regardless of whether the visitor has signed into GitHub or not."',
      '<!-- NEEDS VERIFICATION: true once the Pages custom domain is set and the pages are published (DAN-104); until then nothing is served at the domain. GitHub\'s text: docs.github.com "About GitHub Pages", Data collection, fetched 2026-11-17. -->',
      'The app sends them nothing. The recipients below see the site\'s visitors and the mail, not the app\'s data.',
      '| ⟨OWNER FACT: the personal mailbox\'s provider⟩ |',
      '⟨OWNER DECISION: period⟩',
      '⟨OWNER DECISION: and to keep a record of a privacy request⟩',
    ]) expect(w).toContain(phrase);
    // R287-3, C287-7: Cloudflare's own words, and the routing record it keeps, with its query window.
    const routing = w.split('\n').find((l) => l.startsWith('| **Cloudflare** (Email Routing for `privacy@kokonada.com`)'));
    expect(routing).toContain('health information included; Cloudflare states that it "will not store or access the emails", and keeps a record of each routed message (sender, recipient, subject, message ID and what it did with the message), which can be queried for 31 days <!-- NEEDS VERIFICATION: Cloudflare developer docs, Email Routing analytics, fetched 2026-11-17; whether Cloudflare keeps the record longer than the query window is not in that page (Cloudflare DPA and privacy policy: UNRETRIEVED). --> | Forwarded to the owner\'s personal mailbox |');
    expect(w).not.toContain('Cloudflare keeps a record of the routing activity');
    // C287-7: the app opens the policy page in the device's browser and sends the site nothing.
    expect(w).toContain('The app\'s privacy link opens this page in the device\'s browser (`PrivacyPolicyLink.tsx`); the app itself sends the site nothing.');
    const link = fs.readFileSync(path.join(REPO_ROOT, 'mobile/KokonadaHealth/src/legal/PrivacyPolicyLink.tsx'), 'utf8');
    expect(link).toContain('.then(() => Linking.openURL(PRIVACY_POLICY_URL))');
    expect(link).not.toMatch(/\bfetch\(|WebView/);
    // The app's sub-processors stay app-only: none of the site's recipients is listed there.
    expect(section(d, 'Sub-processors (who touches the data, and what they receive)')).not.toMatch(/kokonada\.com|Cloudflare|GitHub Pages/);
  });

  it('H-9: the Art. 9 section names the Suunto webhook as the fourth consent-gated ingestion route', () => {
    const bullet = art9().split('\n').find((l) => l.startsWith('- **H-9 is now fully closed'));
    expect(bullet).toContain('All four special-category ingestion routes are consent-gated: `/apple/push` and `/health/batch` via the session-authed `requireConsent` middleware; `POST /integrations/suunto/webhook` (session-authed) via the same check made inline in its handler, before the signature is verified or the payload handled;');
    // R287-5: the watch lane's clause, and the live socket event under the same check.
    expect(bullet).toContain('`POST /integrations/watch/hr` (the device-token-authed live BLE heart-rate lane, which has no session req.user) via an inline check');
    expect(bullet).toContain('running BEFORE any body validation or socket delivery. The live socket event biometric_push applies the same current-grant check and drops a reading without one. <!-- verified:');
    expect(bullet).not.toContain('before any parsing or write;');
    expect(bullet).not.toContain('previously the one gap');
    const bh = src('sockets/biometricHandler.js');
    const push = bh.slice(bh.indexOf("socket.on('biometric_push', async (payload) => {"), bh.indexOf("socket.on('biometric_push', async (payload) => {") + 600);
    expect(push).toMatch(/if \(!\(await admitHealthProcessing\(uid\)\)\) \{[\s\S]*?return;\s*\}\s*handleBiometricReading\(socket, source, raw\);/);
    expect(bullet).toContain('backend/app/controllers/integrationsController.js suuntoWebhook');
    expect(bullet).toContain('backend/tests/suuntoConsentGate.test.js');
    expect(bullet).not.toContain('All three special-category ingestion routes');
    // The route is session-authed (below router.use(auth)), and its handler reads consent before the write.
    const routes = src('routes/integrations.js');
    expect(routes.indexOf("router.post('/suunto/webhook',       suuntoWebhook);")).toBeGreaterThan(routes.indexOf('router.use(auth);'));
    const ctrl = src('controllers/integrationsController.js');
    const handler = ctrl.slice(ctrl.indexOf('exports.suuntoWebhook = async'), ctrl.indexOf('exports.wearableStatus'));
    expect(handler).toContain('const reason = denialReason(await getConsentStatus(req.user._id, HEALTH_CONSENT_PURPOSE));');
    expect(handler.indexOf('getConsentStatus')).toBeLessThan(handler.indexOf('suunto.handleWebhook('));
  });

  // A line citation is evidence only while the cited lines still hold what it names.
  it('the line citations re-anchored at ae394f2 point at the code they name', () => {
    const lines = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').split('\n');
    const span = (rel, from, to = from) => lines(rel).slice(from - 1, to).join('\n');
    const EXPORT = 'backend/app/services/privacy/userDataExport.js';
    const ERASURE = 'backend/app/services/privacy/erasure.js';
    const ROUTES = 'backend/app/routes/integrations.js';
    const d = doc();
    const cites = [
      [`${EXPORT}:43 `, () => expect(span(EXPORT, 43)).toContain("redact: ['passwordHash']")],
      [`${EXPORT}:49-51;`, () => expect(span(EXPORT, 49, 51)).toContain('Deliberately excludes OAuth token blobs\n// (spotifyToken/youtubeMusicToken/wearableToken)')],
      [`exported ${EXPORT}:25,46 `, () => { expect(span(EXPORT, 25)).toContain("require('../../models/ConsentRecord')"); expect(span(EXPORT, 46)).toContain('{ model: ConsentRecord },'); }],
      [`erased ${ERASURE}:22,99;`, () => { expect(span(ERASURE, 22)).toContain("require('../../models/ConsentRecord')"); expect(span(ERASURE, 99)).toContain('await ConsentRecord.deleteMany({ userId });'); }],
      [`${EXPORT}:31-47,66-87`, () => { expect(span(EXPORT, 31, 47)).toMatch(/^const COLLECTIONS = \[[\s\S]*\{ model: ConsentRecord \}[\s\S]*\];$/); expect(span(EXPORT, 66, 87)).toMatch(/^async function exportUserData\(userId\) \{/); }],
      [`${ROUTES}:84,88 (requireConsent`, () => { expect(span(ROUTES, 84)).toContain('requireConsent(HEALTH_CONSENT), appleHealthPush'); expect(span(ROUTES, 88)).toContain('requireConsent(HEALTH_CONSENT), healthBatchIngest'); }],
      [`${ROUTES}:22,84,88;`, () => expect(span(ROUTES, 22)).toContain("const requireConsent = require('../middleware/requireConsent');")],
    ];
    for (const [cite, holds] of cites) {
      expect(d).toContain(cite);
      holds();
    }
    expect(d.split(`${EXPORT}:31-47,66-87`)).toHaveLength(3); // the Export bullet and the Play access answer
    for (const stale of [`${EXPORT}:32 `, `${EXPORT}:38-40`, `${EXPORT}:23,41`, `${ERASURE}:21,96`, `${EXPORT}:26-79`, `${ROUTES}:79,83`, `${ROUTES}:21-24,79,83`]) {
      expect(d).not.toContain(stale);
    }
    // R287-6, C287-4: the Play declaration's citations, re-anchored on the same code.
    const AUTH = 'backend/app/controllers/authController.js';
    const store = fs.readFileSync(path.join(REPO_ROOT, 'docs/store/play-health-connect-declaration.md'), 'utf8');
    const storeCites = [
      [`${ROUTES}:88 (medical-profile backfill)`, () => expect(span(ROUTES, 88)).toContain('requireConsent(HEALTH_CONSENT), healthBatchIngest')],
      [`${AUTH}:216-240;`, () => { expect(span(AUTH, 216)).toBe('exports.deleteAccount = async (req, res, next) => {'); expect(span(AUTH, 240)).toBe('};'); }],
      [`${ERASURE}:43-99 `, () => { expect(span(ERASURE, 43)).toBe('async function eraseUserChildData(userId) {'); expect(span(ERASURE, 99)).toContain('await ConsentRecord.deleteMany({ userId });'); }],
      [`${EXPORT}:31-47,66-87;`, () => { expect(span(EXPORT, 31)).toBe('const COLLECTIONS = ['); expect(span(EXPORT, 66)).toBe('async function exportUserData(userId) {'); }],
    ];
    for (const [cite, holds] of storeCites) {
      expect(store).toContain(cite);
      holds();
    }
    for (const stale of [`${ROUTES}:81`, `${AUTH}:220-245`, `${ERASURE}:33-49`, `${EXPORT}:26-79`]) {
      expect(store).not.toContain(stale);
    }
  });
});
