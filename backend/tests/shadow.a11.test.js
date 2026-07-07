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
  const TOP = ['lastAnalyzed', 'sampleCount', 'sleep', 'stateVector', 'vitals'];
  const VITALS = ['bodyBattery', 'dailyReadiness', 'hrv', 'restingHeartRate'];

  it('never widens beyond the whitelist even with a doc full of extra vitals', () => {
    const doc = {
      hrv: 60, bodyBattery: 70, dailyReadiness: 80, restingHeartRate: 50,
      spO2: 98, respirationRate: 14, gpsVelocityKmh: 9, stepsPerMinute: 88,
      accelerometerVariance: 0.3, maxHeartRate: 190, secret: SECRET,
      sleepStages: { rem: SECRET }, hrZones: { z: SECRET },
      lastNightSleep: { deep: 90, light: 200, rem: 80, date: new Date() },
      stateVector: { status: encrypt('Recovering'), confidence: 0.7, computedAt: new Date() },
      sampleCount: 10, lastAnalyzed: new Date(),
    };
    const dto = toPulseStateDTO(doc);
    expect(Object.keys(dto).sort()).toEqual(TOP);
    expect(Object.keys(dto.vitals).sort()).toEqual(VITALS);
    const blob = JSON.stringify(dto);
    expect(blob).not.toContain(SECRET);
    expect(blob).not.toMatch(/spO2|respirationRate|gpsVelocityKmh|stepsPerMinute|accelerometerVariance|maxHeartRate|hrZones|sleepStages/);
    expect(dto.stateVector.status).toBe('Recovering'); // decrypted for the owner
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
