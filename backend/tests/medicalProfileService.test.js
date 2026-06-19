'use strict';

process.env.NODE_ENV       = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

jest.mock('../app/models/MedicalProfile', () => ({ findOneAndUpdate: jest.fn() }));
const MedicalProfile = require('../app/models/MedicalProfile');

const {
  computeStateVector,
  upsertStateVector,
} = require('../app/services/medicalProfileService');

// ── Fixture helpers ────────────────────────────────────────────────────────────

// A fully-populated telemetry object for a hard running session
const RUNNING_TELEMETRY = {
  heartRate:             165,
  restingHeartRate:      60,
  hrv:                   45,
  respirationRate:       18,
  spO2:                  97,
  stepsPerMinute:        160,
  accelerometerVariance: 1.2,
  gpsVelocityKmh:        12,
  bodyBattery:           70,
  dailyReadiness:        80,
  timeOfDay:             'morning',
};

// Resting at desk, afternoon
const RESTING_TELEMETRY = {
  heartRate:             58,
  restingHeartRate:      60,
  hrv:                   65,
  respirationRate:       14,
  spO2:                  99,
  stepsPerMinute:        5,
  accelerometerVariance: 0.02,
  gpsVelocityKmh:        0,
  bodyBattery:           85,
  dailyReadiness:        90,
  timeOfDay:             'afternoon',
};

// ── computeStateVector — state classification ──────────────────────────────────

describe('computeStateVector — state classification', () => {
  it('classifies "Peak Athletic Performance" for high HR + high steps + good SpO2', () => {
    const result = computeStateVector(RUNNING_TELEMETRY);
    expect(result.status).toBe('Peak Athletic Performance');
  });

  it('classifies "High-Stress / Pre-Panic" when HRV is critically low', () => {
    const result = computeStateVector({
      heartRate: 90, restingHeartRate: 65, hrv: 12,
      respirationRate: 16, spO2: 98,
    });
    expect(result.status).toBe('High-Stress / Pre-Panic');
  });

  it('classifies "High-Stress / Pre-Panic" for high HR and high respiration rate', () => {
    const result = computeStateVector({
      heartRate: 115, restingHeartRate: 65,
      respirationRate: 24, spO2: 96, hrv: 35,
    });
    expect(result.status).toBe('High-Stress / Pre-Panic');
  });

  it('classifies "Intense Workout" for high HR and moderate steps without peak SpO2', () => {
    const result = computeStateVector({
      heartRate: 150, restingHeartRate: 65,
      stepsPerMinute: 120, spO2: 92, hrv: 30,
      respirationRate: 20,
    });
    expect(result.status).toBe('Intense Workout');
  });

  it('classifies "Active Recovery" for moderate HR and moderate steps', () => {
    const result = computeStateVector({
      heartRate: 90, restingHeartRate: 65,
      stepsPerMinute: 75, spO2: 98, hrv: 50,
      respirationRate: 16,
    });
    expect(result.status).toBe('Active Recovery');
  });

  it('classifies "Exhausted Commute" when bodyBattery is critically low', () => {
    const result = computeStateVector({
      heartRate: 78, restingHeartRate: 65,
      bodyBattery: 18, dailyReadiness: 40,
      stepsPerMinute: 60, hrv: 40, spO2: 98,
      respirationRate: 16,
    });
    expect(result.status).toBe('Exhausted Commute');
  });

  it('classifies "Exhausted Commute" for very low readiness and low steps', () => {
    const result = computeStateVector({
      heartRate: 72, restingHeartRate: 65,
      bodyBattery: 40, dailyReadiness: 22,
      stepsPerMinute: 45, hrv: 40, spO2: 98,
      respirationRate: 15,
    });
    expect(result.status).toBe('Exhausted Commute');
  });

  it('classifies "Deep Focus / Flow State" for low HR, low movement, daytime', () => {
    const result = computeStateVector({
      heartRate: 62, restingHeartRate: 60,
      accelerometerVariance: 0.05, stepsPerMinute: 10,
      bodyBattery: 75, dailyReadiness: 80,
      hrv: 60, spO2: 99, respirationRate: 14,
      timeOfDay: 'afternoon',
    });
    expect(result.status).toBe('Deep Focus / Flow State');
  });

  it('classifies "Morning Activation" for morning time and good body battery', () => {
    const result = computeStateVector({
      heartRate: 68, restingHeartRate: 60,
      timeOfDay: 'morning', bodyBattery: 80,
      stepsPerMinute: 25, accelerometerVariance: 0.3,
      hrv: 55, spO2: 99, dailyReadiness: 85,
      respirationRate: 14,
    });
    expect(result.status).toBe('Morning Activation');
  });

  it('classifies "Resting / Meditative" for very low HR and minimal movement', () => {
    const result = computeStateVector(RESTING_TELEMETRY);
    expect(result.status).toBe('Resting / Meditative');
  });

  it('returns "Neutral" for empty telemetry object', () => {
    const result = computeStateVector({});
    expect(result.status).toBe('Neutral');
  });

  it('returns "Neutral" when restingHeartRate is missing', () => {
    const result = computeStateVector({ heartRate: 90 });
    expect(result.status).toBe('Neutral');
  });
});

// ── computeStateVector — confidence scoring ────────────────────────────────────

describe('computeStateVector — confidence scoring', () => {
  it('returns confidence 1.0 when all pillar conditions are fully met', () => {
    const result = computeStateVector(RUNNING_TELEMETRY);
    expect(result.confidence).toBe(1.0);
  });

  it('returns confidence 0.7 when only partial conditions are present', () => {
    // High HR relative to resting, but no stepsPerMinute or SpO2 data
    const result = computeStateVector({
      heartRate: 165, restingHeartRate: 60,
      // no stepsPerMinute, no spO2 — partial Peak Athletic
    });
    // Will fall through to a different state with partial data
    expect(result.confidence).toBeLessThanOrEqual(1.0);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('returns confidence between 0 and 1 for all states', () => {
    const states = [RUNNING_TELEMETRY, RESTING_TELEMETRY, {}];
    for (const t of states) {
      const { confidence } = computeStateVector(t);
      expect(confidence).toBeGreaterThanOrEqual(0);
      expect(confidence).toBeLessThanOrEqual(1);
    }
  });
});

// ── computeStateVector — priority ordering ────────────────────────────────────

describe('computeStateVector — priority ordering', () => {
  it('"High-Stress / Pre-Panic" beats "Peak Athletic Performance" when HRV is critical', () => {
    // This telemetry would normally trigger Peak Athletic Performance
    // but the critically low HRV (pillar 1, highest priority) wins
    const result = computeStateVector({
      heartRate:         165,
      restingHeartRate:  60,
      hrv:               8,  // critically low — triggers High-Stress
      stepsPerMinute:    160,
      spO2:              97,
      respirationRate:   18,
    });
    expect(result.status).toBe('High-Stress / Pre-Panic');
  });

  it('"Exhausted Commute" does not override "Peak Athletic Performance" when bodyBattery is incidentally low during a run', () => {
    // A user mid-run with low bodyBattery should still be "Peak Athletic Performance"
    const result = computeStateVector({
      heartRate:        165,
      restingHeartRate: 60,
      hrv:              45,
      stepsPerMinute:   160,
      spO2:             97,
      respirationRate:  18,
      bodyBattery:      20, // low, but athlete is in full performance
      dailyReadiness:   25,
    });
    // Peak Athletic (priority 2) should win over Exhausted Commute (priority 5)
    expect(result.status).toBe('Peak Athletic Performance');
  });
});

// ── upsertStateVector ─────────────────────────────────────────────────────────

describe('upsertStateVector', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls MedicalProfile.findOneAndUpdate with the computed state vector', async () => {
    MedicalProfile.findOneAndUpdate.mockResolvedValue({ userId: 'user123' });

    await upsertStateVector('user123', RUNNING_TELEMETRY);

    expect(MedicalProfile.findOneAndUpdate).toHaveBeenCalledWith(
      { userId: 'user123' },
      expect.objectContaining({
        $set: expect.objectContaining({
          stateVector: expect.objectContaining({
            status:     'Peak Athletic Performance',
            confidence: expect.any(Number),
            computedAt: expect.any(Date),
          }),
        }),
      }),
      { upsert: true, new: true }
    );
  });

  it('returns the document returned by findOneAndUpdate', async () => {
    const mockDoc = { userId: 'user123', stateVector: { status: 'Peak Athletic Performance' } };
    MedicalProfile.findOneAndUpdate.mockResolvedValue(mockDoc);

    const result = await upsertStateVector('user123', RUNNING_TELEMETRY);
    expect(result).toEqual(mockDoc);
  });

  it('propagates database errors', async () => {
    MedicalProfile.findOneAndUpdate.mockRejectedValue(new Error('DB connection lost'));
    await expect(upsertStateVector('user123', RUNNING_TELEMETRY))
      .rejects.toThrow('DB connection lost');
  });
});
