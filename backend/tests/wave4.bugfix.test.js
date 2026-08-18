'use strict';

// Wave-4 W4-001 — the surgical bug backlog. One describe per confirmed ground-truth
// defect (see docs/plans/WAVE4_INTELLIGENCE_MISSION.md §0.1). Every block is a
// permanent regression pin: these are the exact behaviours the wave promised to kill.

process.env.NODE_ENV       = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET     = 'test-jwt-secret-for-tests-only';

const fs   = require('fs');
const path = require('path');

const { translate }           = require('../app/services/biosonic/translate');
const { _buildEmotionPrompt } = require('../app/services/geminiEngine');
const { isPhysiologicalHR, HR_MIN, HR_MAX } = require('../app/services/wearable/hrRange');
const {
  _shouldRecalibrate, _debounceMap, handleBiometricReading, HR_NOISE_FLOOR,
} = require('../app/sockets/biometricHandler');
const { _analyzeYouTubeTracks, _analyzeSpotifyProfile, SOURCE_WEIGHTS } =
  require('../app/services/musicProfileService');
const { applyHardFilters } = require('../app/services/selection/hardFilters');

const readSource = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const BASELINES = { rhrMedian: 60, rhrMAD: 4, hrvMedian: 45, hrvMAD: 8 };
const WRECKED = {
  live: { heartRate: 105, activity: 'walking' },
  baselines: BASELINES,
  sleep: { lastNight: { deep: 45, light: 150, rem: 45 } },
  state: { hrv: 25 },
  hourOfDay: 8,
  moodKey: null,
};

function makeSocket(id = 'w4-sock') {
  return { id, emit: jest.fn(), data: { user: { _id: 'u-w4' } } };
}
const events = (socket) => socket.emit.mock.calls.map((c) => c[0]);

// A garmin push carries a real timestamp; the adapter turns startTimeLocal into recordedAt.
const RAW = (heartRate, activityType = 0) => ({ heartRate, activityType, startTimeLocal: '2026-01-01T10:00:00' });

// ── D5 · LLM prompt axis swap ─────────────────────────────────────────────────
describe('D5 — the emotion prompt describes the axes the code actually uses', () => {
  const prompt = _buildEmotionPrompt({ topGenres: ['pop'] }, [{ x: 0.8, y: -0.4 }], '');

  it('declares x = valence, y = arousal (matching moodDescriptors MOODS)', () => {
    expect(prompt).toContain('x = valence, y = arousal');
  });

  it('no longer declares the swapped axes', () => {
    expect(prompt).not.toContain('x = arousal');
    expect(prompt).not.toContain('y = valence');
  });
});

// ── D9 · one HR validity gate ─────────────────────────────────────────────────
describe('D9 — a single shared physiological HR predicate (30–220)', () => {
  it('the shared predicate pins the range', () => {
    expect([HR_MIN, HR_MAX]).toEqual([30, 220]);
    expect(isPhysiologicalHR(30)).toBe(true);
    expect(isPhysiologicalHR(220)).toBe(true);
    expect(isPhysiologicalHR(29)).toBe(false);
    expect(isPhysiologicalHR(221)).toBe(false);
    expect(isPhysiologicalHR(0)).toBe(false);
    expect(isPhysiologicalHR(NaN)).toBe(false);
    expect(isPhysiologicalHR('120')).toBe(false);
  });

  it('the socket lane no longer ACCEPTS a reading the consumption gate would silently drop', () => {
    for (const hr of [25, 250, 299]) {
      const socket = makeSocket(`d9-${hr}`);
      handleBiometricReading(socket, 'garmin', RAW(hr));
      expect(events(socket)).toContain('connection_error');
      expect(events(socket)).not.toContain('biometric_ack');
      _debounceMap.delete(socket.id);
    }
  });

  it('still accepts a plausible reading', () => {
    const socket = makeSocket('d9-ok');
    handleBiometricReading(socket, 'garmin', RAW(72));
    expect(events(socket)).toContain('biometric_ack');
    _debounceMap.delete(socket.id);
  });

  it('the watch route delegates to the SAME predicate instead of its own 30–230 range', () => {
    const src = readSource('app/controllers/integrationsController.js');
    expect(src).not.toMatch(/heartRate\s*>\s*230/);
    expect(src).toContain('isPhysiologicalHR');
  });
});

// ── D7 · silent drift ─────────────────────────────────────────────────────────
describe('D7 — sub-threshold readings can no longer walk the confirmed HR', () => {
  afterEach(() => { _debounceMap.clear(); });

  it('9 bpm steps do NOT silently move stableHR from 60 to 150', () => {
    const socket = makeSocket('d7-drift');
    handleBiometricReading(socket, 'garmin', RAW(60)); // first reading = baseline
    handleBiometricReading(socket, 'garmin', RAW(69)); // +9, below the 10 bpm floor

    expect(_debounceMap.get(socket.id).stableHR).toBe(60);
  });

  it('feeds an EWMA observation instead, so the signal is not thrown away', () => {
    const socket = makeSocket('d7-ewma');
    handleBiometricReading(socket, 'garmin', RAW(60));
    handleBiometricReading(socket, 'garmin', RAW(69));
    const { hrEwma, stableHR } = _debounceMap.get(socket.id);

    expect(stableHR).toBe(60);
    expect(hrEwma).toBeGreaterThan(60);
    expect(hrEwma).toBeLessThan(69); // smoothed, not latched
  });

  it('the accumulated drift eventually CROSSES the gate and arms a real recalibration', () => {
    const socket = makeSocket('d7-accum');
    handleBiometricReading(socket, 'garmin', RAW(60));
    handleBiometricReading(socket, 'garmin', RAW(69)); // Δ9 vs 60 → noise
    handleBiometricReading(socket, 'garmin', RAW(78)); // Δ18 vs the CONFIRMED 60 → armed

    expect(events(socket)).toContain('recalibration_pending');
  });
});

// ── D8 · stale debounce snapshot ──────────────────────────────────────────────
describe('D8 — the debounce confirms the LATEST reading, not a stale snapshot', () => {
  beforeEach(() => { jest.useFakeTimers(); _debounceMap.clear(); });
  afterEach(() => { jest.useRealTimers(); _debounceMap.clear(); });

  it('refreshes the pending value on every reading inside the window', () => {
    const socket = makeSocket('d8-refresh');
    handleBiometricReading(socket, 'garmin', RAW(70));
    handleBiometricReading(socket, 'garmin', RAW(85));  // arms, pending = 85
    handleBiometricReading(socket, 'garmin', RAW(130)); // mid-window, must not be discarded

    expect(_debounceMap.get(socket.id).pendingHR).toBe(130);
  });

  it('confirms that latest value when the timer fires', () => {
    const socket = makeSocket('d8-confirm');
    handleBiometricReading(socket, 'garmin', RAW(70));
    handleBiometricReading(socket, 'garmin', RAW(85));
    handleBiometricReading(socket, 'garmin', RAW(130));

    jest.advanceTimersByTime(60_000);

    expect(_debounceMap.get(socket.id).stableHR).toBe(130); // was 85 — the stale snapshot
  });

  it('still arms exactly one timer per window', () => {
    const socket = makeSocket('d8-one-timer');
    handleBiometricReading(socket, 'garmin', RAW(70));
    handleBiometricReading(socket, 'garmin', RAW(85));
    handleBiometricReading(socket, 'garmin', RAW(130));

    expect(events(socket).filter((e) => e === 'recalibration_pending')).toHaveLength(1);
  });
});

// ── D11 · trigger/key mismatch (interim fix; full fix in W4-009) ───────────────
describe('D11 — recalibration triggers on the BAND, which is what the buffer is keyed by', () => {
  const call = (prevHR, nextHR, activityChanged = false) =>
    _shouldRecalibrate({ prevHR, nextHR, activityChanged });

  it('fires on a band crossing the old ±25 watch gate missed', () => {
    expect(call(115, 125)).toBe(true); // active → peak, Δ10
    expect(call(100, 120)).toBe(true); // active → peak, Δ20
    expect(call(85, 95)).toBe(true);   // resting → active, Δ10
  });

  it('does NOT fire on a large jump that stays inside one band (the false recalibration)', () => {
    expect(call(60, 85)).toBe(false);   // resting → resting, Δ25
    expect(call(95, 119)).toBe(false);  // active → active, Δ24
    expect(call(130, 190)).toBe(false); // peak → peak, Δ60
  });

  it('keeps the delta guard as a NOISE FLOOR so boundary jitter cannot flap the band', () => {
    expect(HR_NOISE_FLOOR).toBeGreaterThan(0);
    expect(call(119, 120)).toBe(false); // 1 bpm across the 120 cut — sensor noise
    expect(call(89, 91)).toBe(false);   // 2 bpm across the 90 cut
  });

  it('an activity change always fires, whatever the HR did', () => {
    expect(call(100, 100, true)).toBe(true);
    expect(call(60, 61, true)).toBe(true);
  });

  it('is total: a missing or unusable heart rate never throws', () => {
    expect(call(null, 120)).toBe(true);   // no confirmed serve state yet
    expect(call(120, null)).toBe(false);  // unusable reading → never a trigger
    expect(call(null, null)).toBe(false);
  });
});

// ── D3 · a workout is not maximal stress ──────────────────────────────────────
describe('D3 — an unlabelled workout no longer reads as maximal stress', () => {
  const workout = (activity) => translate({
    live: { heartRate: 165, activity },
    baselines: BASELINES,
    hourOfDay: 15,
  });

  it('does not fire restingElevation on a high HR labelled "unknown"', () => {
    const out = workout('unknown');
    expect(out.state.stress).toBeLessThanOrEqual(0.3);
    expect(out.bpmWidth).toBe(20);          // not the S≥0.6 narrowing
    expect(out.acousticnessBias).toBe(0);   // not forced acoustic
    expect(out.instrumentalBias).toBe(0);   // not forced instrumental
  });

  it('treats an ABSENT activity label the same way', () => {
    expect(workout(null).state.stress).toBeLessThanOrEqual(0.3);
  });

  it('still detects a genuinely elevated RESTING heart rate as stress', () => {
    const out = translate({
      live: { heartRate: 95, activity: 'resting' },
      baselines: BASELINES,
      hourOfDay: 15,
    });
    expect(out.state.stress).toBeGreaterThan(0.5);
  });

  it('still detects a mildly elevated unlabelled HR below the exertion cut', () => {
    const out = translate({
      live: { heartRate: 95, activity: 'unknown' },
      baselines: BASELINES,
      hourOfDay: 15,
    });
    expect(out.state.stress).toBeGreaterThan(0.5);
  });
});

// ── D4 · regulator, not mirror ────────────────────────────────────────────────
describe('D4 — high stress never FORCES happier music (VISION §6)', () => {
  it('a low-valence mood is not lifted to a cheerful target under stress', () => {
    jest.isolateModules(() => {
      jest.doMock('../app/services/moodDescriptors', () => ({
        MOOD_DESCRIPTORS: { blue: { energy_floor: 0.2, valence_hint: 0.15 } },
        moodCoords: () => ({ energy: 0.5, valence: 0.5 }),
      }));
      const { translate: t } = require('../app/services/biosonic/translate');
      const out = t({ ...WRECKED, moodKey: 'blue' });

      expect(out.state.stress).toBeGreaterThanOrEqual(0.6); // the stressed branch IS taken
      expect(out.valenceTarget).toBeLessThanOrEqual(0.25);  // 0.15 + a ≤0.1 comfort bias
    });
    jest.dontMock('../app/services/moodDescriptors');
  });

  it('applies a bounded comfort bias instead of a floor, for every mood and stress level', () => {
    const { MOOD_DESCRIPTORS, moodCoords } = require('../app/services/moodDescriptors');
    const moods = [null, 'bio:peak:running', ...Object.keys(MOOD_DESCRIPTORS)];
    for (const moodKey of moods) {
      for (const hrv of [10, 25, 45, 70]) {
        const out = translate({ ...WRECKED, moodKey, state: { hrv } });
        const desc = MOOD_DESCRIPTORS[moodKey];
        const base = desc ? desc.valence_hint : moodCoords(moodKey).valence;
        const lift = out.valenceTarget - base;
        expect(lift).toBeGreaterThanOrEqual(-1e-9);
        expect(lift).toBeLessThanOrEqual(0.1 + 1e-9);
      }
    }
  });
});

// ── D14 · fixed anchors / unreachable confidence floor ────────────────────────
describe('D14 — the confidence floor is reachable', () => {
  it('a cold start with zero inputs lands exactly on the 0.3 floor', () => {
    expect(translate({}).confidence).toBe(0.3);
  });

  it('steps down monotonically, one step per missing input group', () => {
    const steps = [
      translate(WRECKED).confidence,
      translate({ ...WRECKED, sleep: {} }).confidence,
      translate({ ...WRECKED, sleep: {}, state: {} }).confidence,
      translate({ ...WRECKED, sleep: {}, state: {}, live: {} }).confidence,
      translate({}).confidence,
    ];
    expect(steps[0]).toBe(1);
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeLessThanOrEqual(steps[i - 1]);
    expect(steps[steps.length - 1]).toBe(0.3);
  });

  it('the widest band tolerance is now reachable from a real translate() output', () => {
    const { tolerance } = require('../app/services/selection/biosonicBand');
    const wMax = parseFloat(process.env.BAND_W_MAX ?? '3.0');
    const coldest = tolerance(translate({}).confidence);
    expect(coldest).toBeGreaterThan(tolerance(0.4)); // the old unreachable minimum
    expect(coldest).toBeLessThanOrEqual(wMax);
    expect(wMax - coldest).toBeLessThan(0.15);       // effectively at the ceiling
  });
});

// ── D17 · cross-provider affinity scale collision ─────────────────────────────
describe('D17 — Spotify and YouTube affinities live on ONE scale', () => {
  const ytVideos = (n, prefix = 'v') => Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i}`,
    snippet: { title: `Video ${i}`, channelTitle: `Chan ${i}`, tags: ['pop'] },
  }));

  const spotifyMax = () => {
    const tracks = Array.from({ length: 50 }, (_, i) => ({
      id: `s${i}`, name: `S${i}`, uri: `spotify:track:s${i}`,
      artists: [{ id: 'a1', name: 'A' }], external_ids: {},
    }));
    const { library } = _analyzeSpotifyProfile({
      trackSources: [
        { tracks, weight: SOURCE_WEIGHTS.topShort },
        { tracks, weight: SOURCE_WEIGHTS.saved },
        { tracks, weight: SOURCE_WEIGHTS.playlist },
      ],
      artistLists: [], artistGenres: {},
    });
    return library[0].affinity;
  };

  it('a 500-video YouTube library no longer produces 500-point affinities', () => {
    const { library } = _analyzeYouTubeTracks(ytVideos(500));
    const max = Math.max(...library.map((t) => t.affinity));
    expect(max).toBeLessThanOrEqual(SOURCE_WEIGHTS.saved + 1);
  });

  it('the two providers land in comparable ranges (Spotify taste can no longer collapse to 0)', () => {
    const yt = _analyzeYouTubeTracks(ytVideos(500));
    const ytMax = Math.max(...yt.library.map((t) => t.affinity));
    const spMax = spotifyMax();
    const ratio = Math.max(ytMax, spMax) / Math.min(ytMax, spMax);
    expect(ratio).toBeLessThan(5); // was ~500 / ~15
  });

  it('scores a playlist item with the playlist weight and a liked video with the saved weight', () => {
    const liked = ytVideos(2, 'L');
    const fromPlaylists = ytVideos(2, 'P');
    const likedIds = new Set(liked.map((v) => v.id));
    const { library } = _analyzeYouTubeTracks([...liked, ...fromPlaylists], { likedIds });

    const byId = Object.fromEntries(library.map((t) => [t.id, t.affinity]));
    expect(byId.L0).toBeGreaterThanOrEqual(SOURCE_WEIGHTS.saved);
    expect(byId.L0).toBeLessThanOrEqual(SOURCE_WEIGHTS.saved + 1);
    expect(byId.P0).toBeGreaterThanOrEqual(SOURCE_WEIGHTS.playlist);
    expect(byId.P0).toBeLessThanOrEqual(SOURCE_WEIGHTS.playlist + 1);
  });

  it('preserves rank order within each source', () => {
    const { library } = _analyzeYouTubeTracks(ytVideos(10));
    const byId = Object.fromEntries(library.map((t) => [t.id, t.affinity]));
    expect(byId.v0).toBeGreaterThan(byId.v5);
    expect(byId.v5).toBeGreaterThan(byId.v9);
  });
});

// ── W8/W9 · selection hygiene ─────────────────────────────────────────────────
describe('W8/W9 — the documented relaxation ladder is the executed one', () => {
  const lib = (id) => ({
    id, canonicalKey: `k-${id}`, provider: 'spotify', uri: `spotify:track:${id}`,
    name: id, artist: 'A', genres: ['pop'], features: { energy: 0.95 },
  });

  it('the header no longer documents an energy-ceiling rung the ladder does not have', () => {
    const src = readSource('app/services/selection/pipeline.js');
    expect(src).not.toContain('L1 drop energy ceiling');
    expect(src).toMatch(/L1 drop genre excludes/);
  });

  it('the pipeline hands hardFilters no energy ceiling at either call site (the band owns energy)', () => {
    const src = readSource('app/services/selection/pipeline.js');
    expect(src.match(/energyCeiling: null/g) || []).toHaveLength(2);
  });

  it('the dead energy gate is annotated as inert where it is defined', () => {
    const src = readSource('app/services/selection/hardFilters.js');
    expect(src).toMatch(/INERT/);
  });

  it('hardFilters is energy-inert as the pipeline actually calls it', () => {
    const out = applyHardFilters([lib('a'), lib('b')], {
      energyCeiling: null, targetConfidence: 1,
    });
    expect(out.map((t) => t.id)).toEqual(['a', 'b']);
  });
});
