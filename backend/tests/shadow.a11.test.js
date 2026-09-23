'use strict';

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'a'.repeat(64);

// ─────────────────────────────────────────────────────────────────────────────
// SHADOW AUDIT — Sprint A11 (Intelligence). Unrestricted attack on the new REST
// surface: the two whitelist DTOs are the trust boundary between the encrypted
// health store and the wire, so we fuzz them directly — no hostile doc may ever
// widen the response shape or echo a decrypted vital that isn't owner-intended.
// ─────────────────────────────────────────────────────────────────────────────

const { toSessionDTO } = require('../app/controllers/sessionsController');
const { toPulseStateDTO } = require('../app/controllers/pulseController');
const { encrypt } = require('../app/utils/encryption');

const SECRET = 'TOP-SECRET-LEAK-CANARY';

describe('A11 shadow — sessions DTO is a hard whitelist (no leak, fixed shape)', () => {
  // D-3 added derived, non-sensitive display fields: title, source, activityLabel.
  const ALLOWED = ['activity', 'activityLabel', 'contextPrompt', 'createdAt', 'id', 'isFallback', 'moodKey', 'provider', 'skipCount', 'source', 'title', 'trackCount', 'tracks'];

  function hostileSession(i) {
    return {
      _id: `id-${i}`,
      createdAt: new Date(),
      moodKey: 'focus',
      musicProvider: 'spotify',
      contextPrompt: 'owner words',
      // Everything below MUST be dropped by the DTO:
      biometricSnapshot: { heartRate: 72, activity: 'working' },
      trackIds: ['t1', 't2'],
      trackKeys: ['isrc:AAA', SECRET],
      llmCacheKey: SECRET,
      externalPlaylistId: SECRET,
      targetBpm: 128,
      __proto__: { injected: SECRET },
      trackSummary: [{ id: 't1', title: 'A', artist: 'B', secretExtra: SECRET }],
    };
  }

  it('emits EXACTLY the allowed keys and never a sensitive value, across many hostile docs', () => {
    for (let i = 0; i < 200; i++) {
      const dto = toSessionDTO(hostileSession(i));
      expect(Object.keys(dto).sort()).toEqual(ALLOWED);
      // track summaries are re-projected to {id,title,artist} — no smuggled extras
      for (const t of dto.tracks) expect(Object.keys(t).sort()).toEqual(['artist', 'id', 'title']);
      const blob = JSON.stringify(dto);
      expect(blob).not.toContain(SECRET);
      expect(blob).not.toMatch(/heartRate|trackKeys|llmCacheKey|externalPlaylistId|targetBpm|isrc:/);
    }
  });

  it('a legacy session with no trackSummary yields tracks:[] + trackCount from ids', () => {
    const dto = toSessionDTO({ _id: 'x', createdAt: new Date(), musicProvider: 'spotify', trackIds: ['a', 'b', 'c'] });
    expect(dto.tracks).toEqual([]);
    expect(dto.trackCount).toBe(3);
  });
});

describe('A11 shadow — pulse DTO is a hard whitelist (owner vitals only)', () => {
  // DELIBERATE RE-PIN (W4-D43, §0.4 S14): the whitelist WIDENS by exactly two keys — `affect`
  // and `morning`, the coarse surfacing of the nightly consolidation. The property this test
  // exists to defend is unchanged and still enforced below: nothing outside the whitelist ships,
  // and the two new blocks are held to a STRICTER rule than the first five (no magnitude at all,
  // only buckets, counts and confidences — see wave4.pulseSuperset.test.js for that half).
  const TOP = ['affect', 'lastAnalyzed', 'morning', 'sampleCount', 'sleep', 'stateVector', 'vitals'];
  const VITALS = ['bodyBattery', 'dailyReadiness', 'hrv', 'restingHeartRate'];

  // Fixed timestamps, not `new Date()`: the leak scan below asserts on digit substrings, and a
  // live clock's milliseconds would eventually manufacture one of them and fail at random.
  const FIXED = new Date('2026-08-21T00:00:00.000Z');

  const hostileDoc = () => ({
    hrv: 60, bodyBattery: 70, dailyReadiness: 80, restingHeartRate: 50,
    spO2: 98, respirationRate: 14, gpsVelocityKmh: 9, stepsPerMinute: 88,
    accelerometerVariance: 0.3, maxHeartRate: 190, secret: SECRET,
    sleepStages: { rem: SECRET }, hrZones: { z: SECRET },
    lastNightSleep: { deep: 90, light: 200, rem: 80, date: FIXED },
    stateVector: { status: encrypt('Recovering'), confidence: 0.7, computedAt: FIXED },
    sampleCount: 10, lastAnalyzed: FIXED,
  });

  it('never widens beyond the whitelist even with a doc full of extra vitals', () => {
    const dto = toPulseStateDTO(hostileDoc());
    expect(Object.keys(dto).sort()).toEqual(TOP);
    expect(Object.keys(dto.vitals).sort()).toEqual(VITALS);
    const blob = JSON.stringify(dto);
    expect(blob).not.toContain(SECRET);
    expect(blob).not.toMatch(/spO2|respirationRate|gpsVelocityKmh|stepsPerMinute|accelerometerVariance|maxHeartRate|hrZones|sleepStages/);
    expect(dto.stateVector.status).toBe('Recovering'); // decrypted for the owner
  });

  it('a hostile MorningState row cannot widen or leak through the new block either', () => {
    const dto = toPulseStateDTO(hostileDoc(), {
      morning: {
        userId: SECRET,
        date: FIXED,
        readiness: 0.8, readinessConfidence: 0.9,
        sleepDebt: { debt: 420, ratio: 0.4, need: 500, ceiling: 900, nights: 9, confidence: 0.5, note: SECRET },
        night: { deep: 91, light: 201, rem: 81 },
        cosinor: { M: 61, A: 5.1, phi: 16.1, confidence: 0.8, source: 'fit', raw: SECRET },
        cusum: { rhr: { cPlus: 4.9, cMinus: 0, flagged: true, direction: 'up', referenceDays: 30, leak: SECRET }, hrv: {} },
        __proto__: { injected: SECRET },
        extraField: SECRET,
      },
    });
    expect(Object.keys(dto).sort()).toEqual(TOP);
    const blob = JSON.stringify(dto);
    expect(blob).not.toContain(SECRET);
    // Every physiological MAGNITUDE the row carried must be absent — only its bucket survives.
    for (const magnitude of ['420', '500', '900', '61', '5.1', '16.1', '4.9', '91', '201', '81']) {
      expect(blob).not.toContain(magnitude);
    }
    expect(dto.morning.readinessBucket).toBe('peak');
    expect(dto.morning.sleepDebt.bucket).toBe('mid');
  });

  it('a null profile is a full null-safe shape, never a crash', () => {
    const dto = toPulseStateDTO(null);
    expect(dto.stateVector.status).toBeNull();
    expect(dto.vitals).toEqual({ hrv: null, bodyBattery: null, dailyReadiness: null, restingHeartRate: null });
    expect(dto.sampleCount).toBe(0);
  });

  it('a forged/corrupt encrypted status degrades to null, never throws', () => {
    const dto = toPulseStateDTO({ stateVector: { status: 'garbage-not-ciphertext', confidence: 0.5, computedAt: null } });
    expect(dto.stateVector.status).toBeNull();
    expect(dto.stateVector.confidence).toBe(0.5);
  });
});
