'use strict';

// HX-1 — the owner-run, READ-ONLY production survivor count (regulatory brief §5.1, Q0–Q3), on a
// REAL MongoDB seeded with a known history. What is pinned:
//   • the counts, exactly, for a withdrawn, a re-granted and a default-profile account;
//   • STOP: an account with a withdrawal that is not the operator's → nothing counted, exit 2;
//   • it writes NOTHING: every collection, document and index is byte-identical afterwards;
//   • counts only: every line is a closed shape, and no id, value or time ever appears;
//   • the collection names and the "real vitals" field list cannot drift from the models.
// The script is also run as a real child process, so its exit codes are the ones the owner sees.

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
delete process.env.MONGO_DB_NAME;

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

const SCRIPT = path.resolve(__dirname, '../scripts/hx1SurvivorCount.js');
const survivorCount = require('../scripts/hx1SurvivorCount');

jest.setTimeout(120000);

const { ObjectId } = mongoose.Types;
const DAY = 24 * 3600_000;
const MIN = 60_000;
const NOW = new Date();
const ago = (ms) => new Date(NOW.getTime() - ms);
// An ObjectId whose embedded insertion time is `at` — unique per call.
let seq = 0;
const oidAt = (at) => new ObjectId(Math.floor(at.getTime() / 1000).toString(16).padStart(8, '0') + (++seq).toString(16).padStart(16, '0'));

const A = new ObjectId('5f0000000000000000000001'); // withdrew; latest status withdrawn
const B = new ObjectId('5f0000000000000000000002'); // withdrew, then granted again
const C = new ObjectId('5f0000000000000000000003'); // withdrew; only a default (BE-019) profile left
const D = new ObjectId('5f0000000000000000000004'); // granted, never withdrew — must not be listed
const HR = '131'; // a heart-rate value that must never reach the output

const DB_NAME = 'kokonada_hx1_survivor_count_it';
let mem;
let uri;
let db;

beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  uri = `${mem.getUri()}${DB_NAME}`;
  await mongoose.connect(mem.getUri(), { dbName: DB_NAME });
  db = mongoose.connection.db;
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(async () => { await db.dropDatabase(); });

const consentRow = (userId, status, at) => ({
  _id: oidAt(at), userId, purpose: 'health_biometric_processing', consentVersion: 1, status,
  ...(status === 'granted' ? { grantedAt: at } : { withdrawnAt: at }), createdAt: at, updatedAt: at,
});
const hrRow = (userId, insertedAt) => ({ _id: oidAt(insertedAt), userId, heartRate: HR, source: 'garmin', activity: 'unknown', recordedAt: ago(1 * DAY) });
const session = (userId, createdAt, heartRate) => ({ _id: oidAt(createdAt), userId, biometricSnapshot: { heartRate, activity: null }, createdAt, updatedAt: createdAt });

async function seedHistory() {
  const wA = ago(2 * DAY);
  await db.collection('consentrecords').insertMany([
    consentRow(A, 'granted', ago(10 * DAY)), consentRow(A, 'withdrawn', wA),
    consentRow(B, 'granted', ago(20 * DAY)), consentRow(B, 'withdrawn', ago(15 * DAY)), consentRow(B, 'granted', ago(14 * DAY)),
    consentRow(C, 'granted', ago(5 * DAY)), consentRow(C, 'withdrawn', ago(4 * DAY)),
    consentRow(D, 'granted', ago(3 * DAY)),
  ]);
  await db.collection('biometriclogs').insertMany([
    hrRow(A, ago(3 * DAY)), hrRow(A, ago(3 * DAY)), // inserted before the withdrawal: survivors
    hrRow(A, new Date(wA.getTime() + 1 * MIN)), // inside the 5-minute slack: still a survivor
    hrRow(A, new Date(wA.getTime() + 10 * MIN)), hrRow(A, ago(1 * DAY)), // after it: gate bypasses
    hrRow(B, ago(16 * DAY)), // before B's withdrawal: a survivor
    hrRow(B, ago(1 * DAY)), // after B's re-grant: consented, not counted
    hrRow(D, ago(1 * DAY)), // never withdrew: not listed at all
  ]);
  await db.collection('vitalsamples').insertMany([
    { _id: oidAt(ago(3 * DAY)), userId: A, metric: 'hrv', value: '48', source: 'garmin', recordedAt: ago(3 * DAY) },
  ]);
  await db.collection('medicalprofiles').insertMany([
    { userId: A, restingHeartRate: 'ciphertext-of-58', stateVector: { status: 'ciphertext', confidence: 0.7 } },
    { userId: B, restingHeartRate: null, stateVector: { status: 'ciphertext', confidence: 0.5 } },
    { userId: C, restingHeartRate: null, hrv: null, sleepStages: { rem: null }, stateVector: { status: 'ciphertext', confidence: 0.5 } },
  ]);
  await db.collection('morningstates').insertMany([{ userId: A, date: ago(1 * DAY) }]);
  await db.collection('playlistsessions').insertMany([
    session(A, ago(1 * DAY), HR), // after A's withdrawal, no grant since: heart rate used after withdrawal
    session(A, ago(1 * DAY), null), // no heart rate: not counted
    session(A, ago(5 * DAY), HR), // before the withdrawal, inside 30 days: declared (BE-016)
    session(A, ago(40 * DAY), HR), // before the first grant and older than 30 days: neither
    session(B, ago(14.5 * DAY), HR), // inside B's no-grant interval
    session(B, ago(17 * DAY), HR), // before B's withdrawal, inside 30 days: declared
    session(B, ago(1 * DAY), HR), // after B's re-grant: consented
    session(D, ago(1 * DAY), HR),
  ]);
}

const EXPECTED_ALL_OPERATOR = [
  'hx1-survivor-count read-only counts-only',
  'Q0 withdrawn-accounts=3',
  'Q0 account-1 operator=yes',
  'Q0 account-2 operator=yes',
  'Q0 account-3 operator=yes',
  'Q1 account-1 biometriclogs survivors=3 after-withdrawal=2',
  'Q1 account-1 vitalsamples survivors=1 after-withdrawal=0',
  'Q1 account-2 biometriclogs survivors=1 after-withdrawal=n/a',
  'Q1 account-2 vitalsamples survivors=0 after-withdrawal=n/a',
  'Q1 account-3 biometriclogs survivors=0 after-withdrawal=0',
  'Q1 account-3 vitalsamples survivors=0 after-withdrawal=0',
  'Q2 account-1 medicalprofiles default-only=0 with-vitals=1 morningstates=1',
  'Q2 account-2 medicalprofiles=n/a morningstates=n/a',
  'Q2 account-3 medicalprofiles default-only=1 with-vitals=0 morningstates=0',
  'Q3 account-1 playlistsessions hr-in-no-grant-interval=1 hr-before-withdrawal-within-30d=1',
  'Q3 account-2 playlistsessions hr-in-no-grant-interval=1 hr-before-withdrawal-within-30d=1',
  'Q3 account-3 playlistsessions hr-in-no-grant-interval=0 hr-before-withdrawal-within-30d=0',
  'RESULT non-zero',
];

const CLOSED_LINES = [
  /^hx1-survivor-count read-only counts-only$/,
  /^Q0 withdrawn-accounts=\d+$/,
  /^Q0 account-\d+ operator=(?:yes|no)$/,
  /^Q1 account-\d+ (?:biometriclogs|vitalsamples) survivors=\d+ after-withdrawal=(?:\d+|n\/a)$/,
  /^Q2 account-\d+ (?:medicalprofiles default-only=\d+ with-vitals=\d+ morningstates=\d+|medicalprofiles=n\/a morningstates=n\/a)$/,
  /^Q3 account-\d+ playlistsessions hr-in-no-grant-interval=\d+ hr-before-withdrawal-within-30d=\d+$/,
  /^RESULT (?:all-zero|non-zero)$/,
  /^STOP an account with a withdrawal is not the operator's: nothing was counted and nothing was erased\. Take this result to counsel\.$/,
  /^ERROR [A-Za-z0-9_ ,:()./-]+$/,
];

function assertCountsOnly(lines, extraSecrets = []) {
  for (const line of lines) expect(CLOSED_LINES.some((re) => re.test(line))).toBe(true);
  const text = lines.join('\n');
  expect(text).not.toMatch(/[0-9a-f]{24}/i); // no id
  expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}|\d{2}:\d{2}/); // no date or time
  expect(text).not.toMatch(/\b1[5-9]\d{8,}\b/); // no epoch seconds or milliseconds
  for (const secret of [HR, '48', 'ciphertext', ...extraSecrets]) expect(text).not.toContain(secret);
}

async function snapshot() {
  const out = {};
  for (const { name } of await db.listCollections().toArray()) {
    const c = db.collection(name);
    out[name] = { docs: await c.find({}).sort({ _id: 1 }).toArray(), indexes: await c.indexes() };
  }
  return JSON.stringify(out);
}

// `undefined` in `env` REMOVES that variable from the child's environment.
function runProcess(env) {
  const childEnv = { ...process.env, MONGO_DB_NAME: '', ...env };
  for (const [k, v] of Object.entries(childEnv)) if (v === undefined) delete childEnv[k];
  return spawnSync(process.execPath, [SCRIPT], { cwd: path.resolve(__dirname, '..'), env: childEnv, encoding: 'utf8', timeout: 60000 });
}
const stdoutLines = (r) => r.stdout.split(/\r?\n/).filter(Boolean);

describe('Q0–Q3 counts on a seeded history (real Mongo)', () => {
  it('counts exactly what §5.1 asks for, per account, and flags the result non-zero', async () => {
    await seedHistory();
    const { lines, exitCode } = await survivorCount.countSurvivors(db, { operatorIds: [A, B, C].map(String), now: NOW });
    expect(lines).toEqual(EXPECTED_ALL_OPERATOR);
    expect(exitCode).toBe(0);
    assertCountsOnly(lines, [A, B, C, D].map(String));
  });

  it('as a real process: the same lines, exit 0, and nothing in the database changed', async () => {
    await seedHistory();
    const before = await snapshot();
    const r = runProcess({ MONGO_URI: uri, [survivorCount.OPERATOR_ENV]: [A, B, C].map(String).join(',') });
    expect(r.status).toBe(0);
    expect(stdoutLines(r)).toEqual(EXPECTED_ALL_OPERATOR);
    expect(r.stderr).toBe('');
    expect(await snapshot()).toBe(before);
  });

  it('no withdrawal anywhere: zero accounts, all-zero, exit 0', async () => {
    await db.collection('consentrecords').insertOne(consentRow(D, 'granted', ago(3 * DAY)));
    const { lines, exitCode } = await survivorCount.countSurvivors(db, { operatorIds: [String(A)], now: NOW });
    expect(lines).toEqual(['hx1-survivor-count read-only counts-only', 'Q0 withdrawn-accounts=0', 'RESULT all-zero']);
    expect(exitCode).toBe(0);
  });
});

describe('STOP — an account with a withdrawal that is not the operator\'s', () => {
  it('prints STOP after Q0, counts nothing, erases nothing, and exits non-zero', async () => {
    await seedHistory();
    const before = await snapshot();
    const r = runProcess({ MONGO_URI: uri, [survivorCount.OPERATOR_ENV]: String(A) });
    expect(r.status).toBe(2);
    expect(stdoutLines(r)).toEqual([
      'hx1-survivor-count read-only counts-only',
      'Q0 withdrawn-accounts=3',
      'Q0 account-1 operator=yes',
      'Q0 account-2 operator=no',
      'Q0 account-3 operator=no',
      "STOP an account with a withdrawal is not the operator's: nothing was counted and nothing was erased. Take this result to counsel.",
    ]);
    assertCountsOnly(stdoutLines(r), [A, B, C, D].map(String));
    expect(await snapshot()).toBe(before);
  });
});

describe('usage — the operator list is required, and never echoed', () => {
  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['not an id', 'my-account'],
    ['one bad id among good ones', `${A},zz0000000000000000000001`],
  ])('%s: exit 1 before any database connection, and the value is not printed', (_label, value) => {
    const r = runProcess({ MONGO_URI: 'mongodb://127.0.0.1:1/never-connected', [survivorCount.OPERATOR_ENV]: value });
    expect(r.status).toBe(1);
    const lines = stdoutLines(r);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^ERROR /);
    expect(lines[0]).toContain(survivorCount.OPERATOR_ENV);
    if (value) expect(r.stdout + r.stderr).not.toContain(value.split(',').pop());
    expect(r.stdout + r.stderr).not.toMatch(/[0-9a-f]{24}/i);
  });

  it('MONGO_URI unset: exit 1 with a closed ERROR line', () => {
    const r = runProcess({ MONGO_URI: '', [survivorCount.OPERATOR_ENV]: String(A) });
    expect(r.status).toBe(1);
    expect(stdoutLines(r)).toEqual(['ERROR MONGO_URI is not set: run it through railway run']);
  });
});

describe('structure — read-only by construction, and no drift from the models', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');

  it('calls no write, delete, index or drop method, and loads no model (a model builds indexes)', () => {
    const writes = source.match(/\.(?:insert\w*|update\w*|replace\w*|delete\w*|remove\w*|findOneAnd\w+|bulkWrite|drop\w*|create(?:Index\w*|Collection)?|save|rename|collMod)\s*\(/g);
    expect(writes).toBeNull();
    expect(source).not.toMatch(/require\([^)]*models/);
    expect(source).toMatch(/autoIndex:\s*false/);
    expect(source).toMatch(/autoCreate:\s*false/);
  });

  it('the collection names are the models\' own', () => {
    const models = {
      consent: require('../app/models/ConsentRecord'),
      biometricLogs: require('../app/models/BiometricLog'),
      vitalSamples: require('../app/models/VitalSample'),
      medicalProfiles: require('../app/models/MedicalProfile'),
      morningStates: require('../app/models/MorningState'),
      playlistSessions: require('../app/models/PlaylistSession'),
    };
    const actual = Object.fromEntries(Object.entries(models).map(([k, m]) => [k, (m.collection || m[Object.keys(m)[0]].collection).collectionName]));
    expect(survivorCount.COLLECTIONS).toEqual(actual);
  });

  it('"real vitals" is exactly MedicalProfile\'s encrypted fields', () => {
    const encrypted = [];
    require('../app/models/MedicalProfile').schema.eachPath((p, t) => { if (t.options && t.options.encrypted) encrypted.push(p); });
    expect([...survivorCount.MEDICAL_PROFILE_VITAL_PATHS].sort()).toEqual(encrypted.sort());
  });
});
