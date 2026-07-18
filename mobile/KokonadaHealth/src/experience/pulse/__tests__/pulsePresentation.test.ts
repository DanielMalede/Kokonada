import {
  FILL_MAX_BY_METRIC,
  GAUGE_FILL_HEIGHT,
  GAUGE_TILE_MIN_H,
  AURA_HERO_SCALE,
  HR_AURA_HUE_CAP,
  fillFraction,
  hrAuraColor,
  honestNote,
  statusQuadrant,
  GAUGES,
} from '../pulsePresentation';
import { emotionAnchors, space } from '../../../design/tokens';
import type { SyncCounts } from '../../../health/healthSync';

const zero: SyncCounts = { heartRate: 0, hrv: 0, sleep: 0, restingHeartRate: 0 };
const some: SyncCounts = { heartRate: 14087, hrv: 0, sleep: 53, restingHeartRate: 18 };

describe('pulsePresentation — named constants (tokens only, no magic numbers)', () => {
  it('exports display-normalization ranges, NOT medical thresholds', () => {
    expect(FILL_MAX_BY_METRIC.hrv).toEqual({ min: 0, max: 150 });
    expect(FILL_MAX_BY_METRIC.restingHeartRate).toEqual({ min: 40, max: 100 });
    expect(FILL_MAX_BY_METRIC.bodyBattery).toEqual({ min: 0, max: 100 });
    expect(FILL_MAX_BY_METRIC.dailyReadiness).toEqual({ min: 0, max: 100 });
    expect(FILL_MAX_BY_METRIC.deep).toEqual({ min: 0, max: 120 });
    expect(FILL_MAX_BY_METRIC.rem).toEqual({ min: 0, max: 120 });
  });

  it('derives fill height, tile min-height and aura scale from tokens', () => {
    expect(GAUGE_FILL_HEIGHT).toBe(space.sm);
    expect(GAUGE_TILE_MIN_H).toBe(space['4xl'] * 2);
    expect(AURA_HERO_SCALE).toBe(2);
  });

  it('caps the HR aura hue at coral — never peak red (regulator ethic)', () => {
    expect(HR_AURA_HUE_CAP).toBe(emotionAnchors.coral);
    expect(HR_AURA_HUE_CAP).not.toBe(emotionAnchors.peak);
  });
});

describe('fillFraction — calm normalization, clamp01, never a good/bad ramp', () => {
  it('normalizes by the metric range and clamps to [0,1]', () => {
    expect(fillFraction('hrv', 75)).toBeCloseTo(0.5);
    expect(fillFraction('restingHeartRate', 40)).toBe(0);
    expect(fillFraction('restingHeartRate', 100)).toBe(1);
    expect(fillFraction('bodyBattery', 200)).toBe(1); // clamp high
    expect(fillFraction('hrv', -10)).toBe(0); // clamp low
  });

  it('returns 0 for a non-finite value (never NaN into a native transform)', () => {
    expect(fillFraction('hrv', NaN)).toBe(0);
    expect(fillFraction('hrv', Infinity)).toBe(1);
  });
});

describe('hrAuraColor — HUE carries HR, hard-capped at coral', () => {
  it('no live HR → calm brand hue', () => {
    expect(hrAuraColor(null)).toBe(emotionAnchors.calm);
  });

  it('resting → calm, elevated → warm, high → coral (capped, never peak)', () => {
    expect(hrAuraColor(60)).toBe(emotionAnchors.calm);
    expect(hrAuraColor(110)).toBe(emotionAnchors.warm);
    expect(hrAuraColor(190)).toBe(HR_AURA_HUE_CAP);
    expect(hrAuraColor(190)).not.toBe(emotionAnchors.peak);
  });
});

describe('honestNote — the honest-empty SENTENCE table (never a bare dash)', () => {
  it('Garmin-proprietary metrics get a source-truth note and NEVER a try-again', () => {
    for (const m of ['bodyBattery', 'dailyReadiness'] as const) {
      const n = honestNote(m, null, 'none');
      expect(n.text).toBe('Garmin-only');
      expect(n.subnote).toBe('Not shared by Health Connect');
      expect(n.garminOnly).toBe(true);
      // Even with a live Health Connect source + fresh counts, a data-source boundary
      // can't be fixed by re-syncing — so it must never suggest one (D-4b).
      const n2 = honestNote(m, { heartRate: 1, hrv: 1, sleep: 1, restingHeartRate: 1 }, 'health-connect');
      expect(n2.text).toBe('Garmin-only');
      expect(`${n2.text} ${n2.subnote}`).not.toMatch(/sync|refresh|try again/i);
    }
  });

  it('Health-Connect-capable: 0 read → "not shared"; >0 read → "not in your profile yet"', () => {
    expect(honestNote('hrv', zero, 'health-connect').text).toBe('Not shared by your watch');
    expect(honestNote('restingHeartRate', some, 'health-connect').text).toBe('Not in your profile yet — pull to refresh');
    expect(honestNote('deep', some, 'health-connect').text).toBe('Not in your profile yet — pull to refresh');
  });

  it('no sync evidence: source none → connect; any live source → pull to sync', () => {
    expect(honestNote('hrv', null, 'none').text).toBe('Connect a wearable');
    expect(honestNote('hrv', null, 'health-connect').text).toBe('Pull down to sync');
    expect(honestNote('hrv', null, 'ble').text).toBe('Pull down to sync');
  });

  it('sleep metrics carry the "updates each morning" subnote', () => {
    expect(honestNote('deep', zero, 'health-connect').subnote).toBe('Sleep updates each morning');
    expect(honestNote('rem', null, 'none').subnote).toBe('Sleep updates each morning');
  });

  it('never returns a bare dash for any metric / state combination', () => {
    const countCombos: (SyncCounts | null)[] = [null, zero, some];
    const sources = ['none', 'health-connect', 'ble'] as const;
    for (const g of GAUGES) {
      for (const counts of countCombos) {
        for (const src of sources) {
          const n = honestNote(g.key, counts, src);
          expect(n.text).not.toBe('—');
          expect(n.text.length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('statusQuadrant — body state → decorative wash (violet never red)', () => {
  it('maps classifier statuses to non-alarming quadrants', () => {
    expect(statusQuadrant('High-Stress / Pre-Panic')).toBe('intense'); // violet, never red
    expect(statusQuadrant('Peak Athletic Performance')).toBe('joyful');
    expect(statusQuadrant('Intense Workout')).toBe('joyful');
    expect(statusQuadrant('Morning Activation')).toBe('joyful');
    expect(statusQuadrant('Deep Focus / Flow State')).toBe('reflective');
    expect(statusQuadrant('Exhausted Commute')).toBe('reflective');
    expect(statusQuadrant('Active Recovery')).toBe('calm');
    expect(statusQuadrant('Resting / Meditative')).toBe('calm');
    expect(statusQuadrant('Balanced')).toBe('calm');
  });

  it('null / unknown → calm (the brand default)', () => {
    expect(statusQuadrant(null)).toBe('calm');
    expect(statusQuadrant(undefined)).toBe('calm');
    expect(statusQuadrant('Something Brand New')).toBe('calm');
  });
});

describe('GAUGES catalog — the six real DTO-backed gauges (no invented data)', () => {
  it('has exactly the six gauges the DTO returns, in three groups', () => {
    expect(GAUGES.map((g) => g.key)).toEqual(['hrv', 'restingHeartRate', 'deep', 'rem', 'bodyBattery', 'dailyReadiness']);
    expect(GAUGES.filter((g) => g.group === 'vitals').map((g) => g.key)).toEqual(['hrv', 'restingHeartRate']);
    expect(GAUGES.filter((g) => g.group === 'lastNight').map((g) => g.key)).toEqual(['deep', 'rem']);
    expect(GAUGES.filter((g) => g.group === 'recovery').map((g) => g.key)).toEqual(['bodyBattery', 'dailyReadiness']);
  });
});
