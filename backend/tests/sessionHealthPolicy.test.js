'use strict';

// BE-016 (DEC-111, DEC-118) — the session-health policy: which rows a withdrawal of health-data
// consent reaches, and what it removes from them. Pure: no Mongo, no Redis. The same rule serves the
// withdrawal, the daily sweep and the read-only count, so it is pinned here once, including the
// consent histories whose order is decided inside one millisecond.

process.env.NODE_ENV = 'test';

const fs = require('fs');
const path = require('path');
const fc = require('fast-check');

const POLICY_PATH = path.join(__dirname, '../app/services/privacy/sessionHealthPolicy.js');
const policy = require('../app/services/privacy/sessionHealthPolicy');
const { syntheticBioMoodKey } = require('../app/services/moodDescriptors');
const { CHIP_ACTIVITY_KEYS } = require('../app/services/chipActivities');

const {
  ERASED_LIVE_MARK, BIO_KEY_WITH_BAND, CHIP_ONLY_ACTIVITIES, TIE_SCAN_LIMIT,
  latestIsWithdrawn, eraseWindows, windowsFor, erasureSteps, erasedFields,
} = policy;

// ObjectId-shaped hex: 4-byte seconds | 5-byte writer | 3-byte counter. The middle field is what
// ConsentRecord.latestFor reads as "the same process wrote both".
const hexId = (sec, writer, counter) => sec.toString(16).padStart(8, '0')
  + writer.toString(16).padStart(10, '0') + counter.toString(16).padStart(6, '0');
const T0 = Date.UTC(2026, 8, 1);
let counter = 0;
const row = (status, ms, writer = 1) => ({
  _id: hexId(Math.floor(ms / 1000), writer, ++counter), status, createdAt: new Date(ms),
});
const NOW = new Date(T0 + 30 * 86400_000);
const at = (minutes) => T0 + minutes * 60_000;

describe('the Live mark and the bio-key patterns', () => {
  it('the mark is "bio:" and names no band', () => {
    expect(ERASED_LIVE_MARK).toBe('bio:');
    expect(BIO_KEY_WITH_BAND.test(ERASED_LIVE_MARK)).toBe(false);
  });

  it('every key syntheticBioMoodKey can return names a band, and none is the mark (property)', () => {
    fc.assert(fc.property(
      fc.oneof(fc.double({ noNaN: false }), fc.integer({ min: -50, max: 400 }), fc.constantFrom(null, undefined, '', '131')),
      fc.oneof(fc.string(), fc.constantFrom(null, undefined, 'running', 'unknown', ' ', 'RESTING')),
      (hr, activity) => {
        const key = syntheticBioMoodKey(hr, activity);
        if (key === null) return true;
        return key !== ERASED_LIVE_MARK && BIO_KEY_WITH_BAND.test(key);
      },
    ), { numRuns: 2000 });
  });

  it('preset keys and the mark are never treated as a heart-rate key', () => {
    for (const key of ['calm', 'focus', 'energize', 'unwind', 'uplift', 'intense', 'bio:', '', 'BIO:peak']) {
      expect(BIO_KEY_WITH_BAND.test(key)).toBe(false);
    }
    expect(BIO_KEY_WITH_BAND.test('bio:peak:running')).toBe(true);
  });
});

describe('DT-1b′ O1 — an activity is kept on a trimmed mood row only when it is provably a chip', () => {
  const WATCH_VOCABULARY = require('../app/models/BiometricLog').schema.path('activity').enumValues;

  it('no chip-only value is one a watch lane can write', () => {
    expect(WATCH_VOCABULARY.length).toBeGreaterThan(0);
    for (const value of CHIP_ONLY_ACTIVITIES) expect(WATCH_VOCABULARY).not.toContain(value);
  });

  it('every value the adapters produce is in that vocabulary, so the list above is the whole watch side', () => {
    const { normalize } = require('../app/services/wearable/adapter');
    const recordedAt = new Date().toISOString();
    const seen = new Set();
    for (let t = -2; t <= 60; t += 1) seen.add(normalize('garmin', { heartRate: 70, activityType: t, startTimeLocal: recordedAt }).activity);
    for (const w of ['HKWorkoutActivityTypeRunning', 'HKWorkoutActivityTypeCycling', 'HKWorkoutActivityTypeSwimming',
      'HKWorkoutActivityTypeWalking', 'HKWorkoutActivityTypeTraditionalStrengthTraining', 'HKWorkoutActivityTypeYoga', null]) {
      seen.add(normalize('apple_health', { heartRate: 70, workoutType: w, startDate: recordedAt }).activity);
    }
    for (const s of ['RUNNING', 'CYCLING', 'SWIMMING', 'WALKING', 'GYM', 'DIVING', null]) {
      seen.add(normalize('suunto', { heartRate: 70, sport: s, timestamp: recordedAt }).activity);
    }
    for (const value of seen) expect(WATCH_VOCABULARY).toContain(value);
  });

  it('every chip-only value is a chip the app offers or once offered (the retired Working and Focus)', () => {
    const everOffered = new Set([...CHIP_ACTIVITY_KEYS, 'working', 'focus']);
    for (const value of CHIP_ONLY_ACTIVITIES) expect(everOffered.has(value)).toBe(true);
    // the three values a chip and a watch share are NOT proof of a chip
    for (const shared of ['running', 'resting', 'walking']) expect(CHIP_ONLY_ACTIVITIES).not.toContain(shared);
  });
});

describe('latestIsWithdrawn — the same tie rule as ConsentRecord.latestFor', () => {
  it('reads the newest row', () => {
    expect(latestIsWithdrawn([])).toBe(false);
    expect(latestIsWithdrawn([row('granted', at(0)), row('withdrawn', at(5))])).toBe(true);
    expect(latestIsWithdrawn([row('granted', at(0)), row('withdrawn', at(5)), row('granted', at(9))])).toBe(false);
  });

  it('a same-millisecond tie from ONE writer is ordered by the id counter', () => {
    const g = row('granted', at(5), 7);
    const w = row('withdrawn', at(5), 7); // generated after g by the same writer
    expect(latestIsWithdrawn([w, g])).toBe(true);
    const w2 = row('withdrawn', at(6), 7);
    const g2 = row('granted', at(6), 7);
    expect(latestIsWithdrawn([g2, w2])).toBe(false);
  });

  it('a same-millisecond tie across writers fails closed: withdrawn', () => {
    expect(latestIsWithdrawn([row('withdrawn', at(5), 1), row('granted', at(5), 2)])).toBe(true);
    expect(latestIsWithdrawn([row('granted', at(5), 2), row('withdrawn', at(5), 1)])).toBe(true);
  });

  it('a tie group that fills the scan window is answered by "is any of it a withdrawal"', () => {
    expect(TIE_SCAN_LIMIT).toBe(require('../app/models/ConsentRecord').TIE_SCAN_LIMIT);
    const rows = Array.from({ length: TIE_SCAN_LIMIT }, () => row('granted', at(5), 3));
    rows.splice(2, 0, row('withdrawn', at(5) , 3)); // generated mid-group, not the newest id
    rows.push(row('granted', at(5), 3));
    expect(latestIsWithdrawn(rows)).toBe(true);
  });
});

describe('eraseWindows — who is erased, and up to when', () => {
  const windows = (history) => windowsFor(history, NOW);

  it('no withdrawal on file: nothing is owed', () => {
    expect(windows([])).toBeNull();
    expect(windows([row('granted', at(0))])).toBeNull();
  });

  it('G3: a withdrawal with no grant before it is never erased (DAN-016 keeps those rows)', () => {
    expect(windows([row('withdrawn', at(0))])).toBeNull();
    expect(windows([row('withdrawn', at(0)), row('withdrawn', at(3))])).toBeNull();
    expect(windows([row('withdrawn', at(0)), row('granted', at(3))])).toBeNull();
  });

  it('latest status withdrawn: heart rates up to now, targets up to the withdrawal', () => {
    expect(windows([row('granted', at(0)), row('withdrawn', at(10))])).toEqual({
      heartRateBefore: NOW, targetsBefore: new Date(at(10)),
    });
  });

  it('a repeat withdrawal keeps the earlier grant on file, so it re-runs the erasure (the retry path)', () => {
    expect(windows([row('granted', at(0)), row('withdrawn', at(10)), row('withdrawn', at(20))])).toEqual({
      heartRateBefore: NOW, targetsBefore: new Date(at(20)),
    });
  });

  it('re-granted: heart rates before the first grant after the latest withdrawal, targets before that withdrawal', () => {
    expect(windows([row('granted', at(0)), row('withdrawn', at(10)), row('granted', at(15)), row('granted', at(18))])).toEqual({
      heartRateBefore: new Date(at(15)), targetsBefore: new Date(at(10)),
    });
    expect(windows([
      row('granted', at(0)), row('withdrawn', at(10)), row('granted', at(15)), row('withdrawn', at(20)), row('granted', at(25)),
    ])).toEqual({ heartRateBefore: new Date(at(25)), targetsBefore: new Date(at(20)) });
  });

  it('same millisecond, one writer: a grant generated after the withdrawal is the re-grant', () => {
    const history = [row('granted', at(0), 4), row('withdrawn', at(10), 4), row('granted', at(10), 4)];
    expect(windows(history)).toEqual({ heartRateBefore: new Date(at(10)), targetsBefore: new Date(at(10)) });
  });

  it('same millisecond, one writer: a grant generated BEFORE the withdrawal is not a re-grant', () => {
    const history = [row('granted', at(10), 4), row('withdrawn', at(10), 4), row('granted', at(30), 4)];
    expect(windows(history)).toEqual({ heartRateBefore: new Date(at(30)), targetsBefore: new Date(at(10)) });
  });

  it('same millisecond, two writers: unordered, so it reads as withdrawn and erases up to now', () => {
    const history = [row('granted', at(0), 1), row('withdrawn', at(10), 1), row('granted', at(10), 2)];
    expect(windows(history)).toEqual({ heartRateBefore: NOW, targetsBefore: new Date(at(10)) });
  });

  it('a history and a status that disagree erase up to now, never past it', () => {
    const history = [row('granted', at(0)), row('withdrawn', at(10))];
    expect(eraseWindows({ history, latestIsWithdrawn: false, now: NOW })).toEqual({
      heartRateBefore: NOW, targetsBefore: new Date(at(10)),
    });
  });

  it('rejects a missing clock rather than guessing one', () => {
    expect(() => eraseWindows({ history: [row('granted', at(0)), row('withdrawn', at(1))], latestIsWithdrawn: true, now: undefined }))
      .toThrow(TypeError);
  });

  // Properties over arbitrary histories, with timestamps drawn from a few milliseconds so ties are common.
  const historyArb = fc.array(fc.record({
    status: fc.constantFrom('granted', 'withdrawn'),
    minute: fc.integer({ min: 0, max: 6 }),
    writer: fc.integer({ min: 1, max: 3 }),
  }), { maxLength: 12 }).map((specs) => specs.map((s) => row(s.status, at(s.minute), s.writer)));

  it('owed exactly when a grant is on file before the latest withdrawal (property)', () => {
    fc.assert(fc.property(historyArb, (history) => {
      const out = windows(history);
      const sorted = [...history].sort((a, b) => (a.createdAt - b.createdAt) || a._id.localeCompare(b._id));
      const withdrawals = sorted.filter((r) => r.status === 'withdrawn');
      if (!withdrawals.length) return out === null;
      const w = withdrawals[withdrawals.length - 1];
      const sameWriter = (a, b) => a._id.slice(8, 18) === b._id.slice(8, 18);
      const grantBefore = sorted.some((r) => r.status === 'granted' && (r.createdAt < w.createdAt
        || (r.createdAt.getTime() === w.createdAt.getTime() && !(sameWriter(r, w) && r._id > w._id))));
      return grantBefore ? out !== null : out === null;
    }), { numRuns: 3000 });
  });

  it('targets ≤ heart rates ≤ now, and a withdrawn latest status always erases heart rates up to now (property)', () => {
    fc.assert(fc.property(historyArb, (history) => {
      const out = windows(history);
      if (out === null) return true;
      const ordered = out.targetsBefore <= out.heartRateBefore && out.heartRateBefore <= NOW;
      return ordered && (!latestIsWithdrawn(history) || out.heartRateBefore.getTime() === NOW.getTime());
    }), { numRuns: 3000 });
  });

  it('a re-granted account is never erased at or after its re-grant (property)', () => {
    fc.assert(fc.property(historyArb, (history) => {
      const out = windows(history);
      if (out === null || latestIsWithdrawn(history)) return true;
      const sorted = [...history].sort((a, b) => (a.createdAt - b.createdAt) || a._id.localeCompare(b._id));
      const lastW = sorted.filter((r) => r.status === 'withdrawn').pop();
      const regrants = sorted.filter((r) => r.status === 'granted' && r.createdAt > lastW.createdAt);
      return regrants.every((g) => out.heartRateBefore <= g.createdAt);
    }), { numRuns: 3000 });
  });
});

describe('erasureSteps — what each step clears, in order', () => {
  const userId = 'u1';
  const w = { heartRateBefore: new Date(at(100)), targetsBefore: new Date(at(50)) };
  const steps = erasureSteps(userId, w);
  const byName = Object.fromEntries(steps.map((s) => [s.name, s]));

  it('runs the session steps, then the serve steps, in a fixed order', () => {
    expect(steps.map((s) => [s.name, s.model, s.count])).toEqual([
      ['heartSessions', 'PlaylistSession', 'sessions'],
      ['heartRates', 'PlaylistSession', 'sessions'],
      ['trimmedActivities', 'PlaylistSession', 'sessions'],
      ['targets', 'PlaylistSession', 'sessionTargets'],
      ['serveBioKeys', 'ServeEvent', 'serveEvents'],
      ['serveBands', 'ServeEvent', 'serveEvents'],
    ]);
  });

  it('every filter is scoped to the user and bounded by a strict cutoff', () => {
    for (const s of steps) {
      expect(s.filter.userId).toBe(userId);
      const clock = s.model === 'ServeEvent' ? s.filter.servedAt : s.filter.createdAt;
      expect(Object.keys(clock)).toEqual(['$lt']);
    }
    // The targets and the trimmed sessions' activities are bounded by the latest withdrawal (B1, round 1):
    // after it the server holds no watch activity, so an activity on a later session is the listener's chip.
    for (const name of ['targets', 'trimmedActivities']) expect(byName[name].filter.createdAt.$lt).toBe(w.targetsBefore);
    for (const name of ['heartSessions', 'heartRates']) expect(byName[name].filter.createdAt.$lt).toBe(w.heartRateBefore);
    for (const name of ['serveBioKeys', 'serveBands']) expect(byName[name].filter.servedAt.$lt).toBe(w.heartRateBefore);
  });

  it('a heart session keeps only the Live mark, its tracks and its own record', () => {
    expect(byName.heartSessions.set).toEqual({
      moodKey: 'bio:',
      'biometricSnapshot.heartRate': null,
      'biometricSnapshot.activity': null,
      targetBpm: null,
      targetEnergy: null,
      targetValence: null,
      targetGenres: [],
    });
  });

  it('a mood session with a heart rate loses it, its activity and its targets — never its moodKey, genres or note', () => {
    expect(byName.heartRates.set).toEqual({
      'biometricSnapshot.heartRate': null, 'biometricSnapshot.activity': null,
      targetBpm: null, targetEnergy: null, targetValence: null,
    });
    expect(byName.heartRates.filter['biometricSnapshot.heartRate']).toEqual({ $ne: null });
  });

  it('a trimmed mood session loses an activity that is not provably a chip, and nothing else', () => {
    const f = byName.trimmedActivities.filter;
    expect(byName.trimmedActivities.set).toEqual({ 'biometricSnapshot.activity': null });
    expect(f['biometricSnapshot.heartRate']).toBeNull();
    expect(f.contextPrompt).toBeNull(); // the trim's own fingerprint: only sessionTrim writes it
    expect(f['biometricSnapshot.activity']).toEqual({ $ne: null, $nin: CHIP_ONLY_ACTIVITIES });
  });

  it('the heart-rate steps never reach the mark or each other (idempotent, counted once)', () => {
    expect(byName.heartSessions.filter.moodKey).toBe(BIO_KEY_WITH_BAND);
    for (const name of ['heartRates', 'trimmedActivities']) expect(byName[name].filter.moodKey).toEqual({ $not: BIO_KEY_WITH_BAND });
  });

  it('serve rows lose the band, the activity and a bio moodKey, and keep the track and the time', () => {
    expect(byName.serveBioKeys.set).toEqual({ moodKey: null, 'bioState.tempoBand': null, 'bioState.activity': null });
    expect(byName.serveBands.set).toEqual({ 'bioState.tempoBand': null, 'bioState.activity': null });
    for (const s of [byName.serveBioKeys, byName.serveBands]) {
      expect(Object.keys(s.set)).not.toEqual(expect.arrayContaining(['canonicalKey']));
      expect(Object.keys(s.set)).not.toContain('servedAt');
      expect(Object.keys(s.set)).not.toContain('sessionId');
    }
  });

  it('erasedFields lists every field any step clears, per model (the declarations test reads it)', () => {
    expect(erasedFields()).toEqual({
      PlaylistSession: ['moodKey', 'biometricSnapshot.heartRate', 'biometricSnapshot.activity', 'targetBpm', 'targetEnergy', 'targetValence', 'targetGenres'],
      ServeEvent: ['moodKey', 'bioState.tempoBand', 'bioState.activity'],
    });
  });

  it('never clears the free text, the taps, the provider or the tracks (C1, T1)', () => {
    const cleared = Object.values(erasedFields()).flat();
    for (const kept of ['contextPrompt', 'emotionTaps', 'musicProvider', 'trackIds', 'trackKeys', 'trackSummary', 'externalPlaylistId', 'skipCount', 'createdAt']) {
      expect(cleared).not.toContain(kept);
    }
  });
});

describe('the policy loads no model (the read-only count script requires it)', () => {
  it('requires nothing at all', () => {
    const src = fs.readFileSync(POLICY_PATH, 'utf8');
    expect(src).not.toMatch(/require\(/);
  });

  it('registers no Mongoose model when loaded alone', () => {
    jest.isolateModules(() => {
      require(POLICY_PATH);
      expect(require('mongoose').modelNames()).toEqual([]);
    });
  });
});
