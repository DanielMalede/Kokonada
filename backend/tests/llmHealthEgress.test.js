'use strict';

// BE-221 — no health information, and nothing derived from it, reaches Groq (the owner's ruling,
// class c, 2026-10-27). Every Groq request leaves through llmCall.chatJson → axios.post, so axios is
// the ONE thing mocked beneath the real clients: geminiEngine, llmClient, captionService, the feature
// estimator, the embedding worker and the socket handler's generate path all run for real, and every
// assertion reads the serialized request bodies they actually produced.
//
// Two kinds of proof:
//   · invariance — the joined outbound body is byte-identical while the heart rate, the baseline
//     ratio, the state label, the watch-detected activity, the stored health profile and the
//     band-aware targets vary. A body that does not change cannot carry what changed.
//   · vocabulary — no body names a health concept. `resting|active|peak` are NOT banned: the emotion
//     prompt lists them as the tempo_category enum, which is static text.

process.env.NODE_ENV       = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET     = 'test-jwt-secret-for-tests-only';
process.env.LLM_API_KEY    = 'test-llm-key';
delete process.env.GROQ_API_KEY;
delete process.env.GEMINI_API_KEY;

jest.mock('axios');

// ── The handler's data layer and upstreams (the LLM clients above stay REAL) ──────────────────
jest.mock('../app/models/User', () => ({ findById: jest.fn() }));
jest.mock('../app/models/MusicProfile', () => ({ findOne: jest.fn() }));
jest.mock('../app/models/BiometricLog', () => ({ find: jest.fn() }));
jest.mock('../app/models/MedicalProfile', () => ({ findOne: jest.fn() }));
jest.mock('../app/models/PlaylistSession', () => ({
  create:         jest.fn().mockResolvedValue({}),
  find:           jest.fn(),
  countDocuments: jest.fn().mockResolvedValue(0),
}));
jest.mock('../app/services/spotify', () => ({
  getValidToken: jest.fn(), getRecommendations: jest.fn(), fetchVibeDiscovery: jest.fn(),
  getArtistsGenres: jest.fn(), artistGenresAvailable: jest.fn(() => true), markDiscoveryUnavailable: jest.fn(),
}));
jest.mock('../app/services/youtube', () => ({ getValidToken: jest.fn(), searchRecommendations: jest.fn() }));
jest.mock('../app/services/playlistMixer', () => ({
  personalizeWhitelist: jest.fn((t) => t),
  generateFallbackPlaylist: jest.fn().mockReturnValue([]),
}));
jest.mock('../app/services/features/featureService', () => ({
  hydrate: jest.fn(), enqueueHydration: jest.fn().mockResolvedValue({ queued: true }),
}));
jest.mock('../app/services/discovery/discoveryFetch', () => ({ vectorDiscoveryFetch: jest.fn(async () => []) }));
jest.mock('../app/repositories/shadowBufferRepo', () => ({
  getBuffer: jest.fn().mockResolvedValue(null), setBuffer: jest.fn().mockResolvedValue(true),
}));
jest.mock('../app/services/spotifySessionPlaylist', () => ({
  writeSessionPlaylist: jest.fn().mockResolvedValue({ contextUri: 'spotify:playlist:session-test' }),
}));
jest.mock('../app/config/redis', () => ({ getRedis: jest.fn(() => null), createConnection: jest.fn() }));
jest.mock('../app/services/ledger/serveLedger', () => ({
  recordServes: jest.fn().mockResolvedValue({ recorded: 0 }),
  hardExcluded: jest.fn().mockResolvedValue(new Set()),
  moodExcluded: jest.fn().mockResolvedValue(new Set()),
  getExposure:  jest.fn().mockResolvedValue(new Map()),
}));
jest.mock('../app/repositories/audioFeatureRepo', () => ({
  getMany: jest.fn().mockResolvedValue(new Map()), upsertMany: jest.fn(), missingKeys: jest.fn(),
  setVibeTags: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../app/services/vector/vectorIndex', () => ({
  getMany: jest.fn().mockResolvedValue(new Map()), upsertMany: jest.fn().mockResolvedValue(undefined),
  queryNear: jest.fn(), use: jest.fn(),
}));
// targetsBuilder stays REAL (RA-3 on #279): what it reads is exactly what the caption guard must see.
// Only its leaves are faked — the cached baselines, the night history, the affect layer and
// translate, which returns a neutral window so the discovery track stays selectable and the guard,
// not a band, decides. (MedicalProfile is mocked above.)
jest.mock('../app/services/biosonic/baselines', () => ({ peekBaselines: jest.fn().mockResolvedValue(null) }));
jest.mock('../app/repositories/sleepHistoryRepo', () => ({ readNightHistory: jest.fn(async () => []) }));
jest.mock('../app/services/biosonic/affectService', () => {
  const actual = jest.requireActual('../app/services/biosonic/affectService');
  actual.resolveAffect = jest.fn(async () => null);
  return actual;
});
jest.mock('../app/services/biosonic/translate', () => {
  const actual = jest.requireActual('../app/services/biosonic/translate');
  actual.translate = jest.fn(() => ({}));
  return actual;
});
jest.mock('../app/services/privacy/consent', () => ({
  getConsentStatus:       jest.fn().mockResolvedValue({ granted: true, currentVersion: 1, staleVersion: false }),
  HEALTH_CONSENT_PURPOSE: 'health_biometric_processing',
}));

const axios          = require('axios');
const User           = require('../app/models/User');
const MusicProfile   = require('../app/models/MusicProfile');
const BiometricLog   = require('../app/models/BiometricLog');
const MedicalProfile = require('../app/models/MedicalProfile');
const spotify        = require('../app/services/spotify');
const featureRepo    = require('../app/repositories/audioFeatureRepo');
const baselines      = require('../app/services/biosonic/baselines');
const sleepHistory   = require('../app/repositories/sleepHistoryRepo');
const affectService  = require('../app/services/biosonic/affectService');
const biosonic       = require('../app/services/biosonic/translate');
const { vectorDiscoveryFetch } = require('../app/services/discovery/discoveryFetch');

const { buildEmotionPlaylist, adjustBiometricPlaylist, inferArtistGenres } = require('../app/services/geminiEngine');
const captionService = require('../app/services/discovery/captionService');
const llmEstimator   = require('../app/services/features/llmEstimatorAdapter');
const embeddingWorker = require('../app/workers/embedding.worker');
const { MOOD_DESCRIPTORS } = require('../app/services/moodDescriptors');
const { generateAndEmitPlaylist } = require('../app/sockets/biometricHandler');

// ── The fake Groq: answers each caller in its own schema, records every request ───────────────

const PARAMS = {
  target_bpm: 110, target_energy: 0.6, target_valence: 0.5, target_acousticness: 0.3,
  seed_artists: [], seed_genres: ['electronic'], mood_keywords: ['calm', 'warm'],
};

function answerFor(prompt) {
  if (prompt.includes('"captions"')) return { captions: [{ i: 0, caption: 'A slow, smoky burner' }] };
  if (prompt.includes('audio-analysis estimator')) return { estimates: [{ i: 0, bpm: 100, energy: 0.5, valence: 0.5, acousticness: 0.3, danceability: 0.5, loudness: -8, confidence: 0.5 }] };
  if (prompt.includes('vibe tags')) return { tags: [{ i: 0, vibeTags: ['warm'] }] };
  if (prompt.includes('music genre expert')) return { Artist: ['indie pop'] };
  return PARAMS;
}

function installFakeGroq() {
  axios.post.mockImplementation(async (_url, request) => {
    const prompt = request.messages.map((m) => m.content).join('\n');
    return { status: 200, data: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(answerFor(prompt)) } }] } };
  });
}

// Every message of every outbound call, joined, in call order.
function outbound() {
  return axios.post.mock.calls.flatMap(([, request]) => (request.messages || []).map((m) => m.content)).join('\n---\n');
}

// Health vocabulary that must never appear in a request. The mood descriptors' genre names are
// first-party music vocabulary (one exclude list names the genre "sleep"), so they are blanked
// first — but only as an item of a comma-separated genre list, sourced from MOOD_DESCRIPTORS
// itself, so the mask can hide a listed genre and never the same word in a sentence.
const HEALTH_VOCAB = /heart|intensity band|physiolog|hrv|sleep|stress|bio:|bpmCenter/i;
const GENRES = [...new Set(Object.values(MOOD_DESCRIPTORS).flatMap((d) => [...d.allow_genres, ...d.exclude_genres]))];
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const GENRE_ALT = GENRES.sort((a, b) => b.length - a.length).map(escapeRe).join('|');
const GENRE_ITEM = new RegExp(`(?<=[:,] )(?:${GENRE_ALT})(?=[,.>\\n]|$)`, 'gm');
function withoutGenres(body) {
  return body.replace(GENRE_ITEM, '<genre>');
}

const MUSIC_PROFILE = {
  userId: 'user-123', topGenres: ['electronic', 'indie', 'ambient'], genreSet: ['electronic'],
  tempoBaseline: 118, energy: 0.6, valence: 0.5, acousticness: 0.3, knownArtistIds: [],
};

// The health contexts every invariance test sweeps. Each is a different body, a different baseline
// and a different taxonomy state; the request must not be able to tell them apart.
const HEALTH_CONTEXTS = [
  null,
  { heartRate: 50, activity: 'resting', stateLabel: null, hrRatio: null },
  { heartRate: 180, activity: 'running', stateLabel: 'Exertion', hrRatio: 2.4, restingHeartRate: 75, hrv: 22, bodyBattery: 12, sleep: { deep: 30, light: 200, rem: 40 } },
  { heartRate: 72, activity: 'cycling', stateLabel: 'Resting / Meditative', hrRatio: 1.05, restingHeartRate: 68, hrv: 88, bodyBattery: 95 },
];

beforeEach(() => {
  jest.clearAllMocks();
  installFakeGroq();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
});

// ── 1 · The emotion generation prompt ─────────────────────────────────────────────────────────

describe('buildEmotionPlaylist — the request ignores every health input', () => {
  async function bodyFor(biometricContext) {
    axios.post.mockClear();
    await buildEmotionPlaylist({
      musicProfile: MUSIC_PROFILE, emotionTaps: [{ x: 0.45, y: -0.55 }], activity: 'running',
      biometricContext, fetchTracks: jest.fn().mockResolvedValue([]),
    });
    return outbound();
  }

  it('is byte-identical across heart rate, ratio, state label, watch activity and stored profile', async () => {
    const bodies = [];
    for (const ctx of HEALTH_CONTEXTS) bodies.push(await bodyFor(ctx));
    expect(bodies[0]).not.toBe('');
    for (const b of bodies) expect(b).toBe(bodies[0]);
  });

  it('the genre mask hides a listed genre and never the same word in a sentence', () => {
    expect(withoutGenres('never include them: ambient, sleep, drone.')).toBe('never include them: <genre>, <genre>, <genre>.');
    expect(withoutGenres('music for a night of sleep')).toMatch(HEALTH_VOCAB);
  });

  it('names no health concept, for any mood', async () => {
    for (const taps of [[{ x: 0.45, y: -0.55 }], [{ x: 0.1, y: 0.95 }], [{ x: 0.6, y: 0.85 }], [{ x: 0.2, y: -0.35 }]]) {
      axios.post.mockClear();
      await buildEmotionPlaylist({
        musicProfile: MUSIC_PROFILE, emotionTaps: taps, activity: 'running',
        biometricContext: HEALTH_CONTEXTS[2], fetchTracks: jest.fn().mockResolvedValue([]),
      });
      expect(withoutGenres(outbound())).not.toMatch(HEALTH_VOCAB);
    }
  });
});

// ── 1b · A note about sleep (BE-229) ──────────────────────────────────────────────────────────
// The owner's ruling of 2026-10-28: "זה אכן נחשב מידע רפואי אז נטפל בזה" — a sleep intent the user
// writes is medical information, so nothing a note about sleep produces may reach Groq: not the
// `Current activity` line, not the activity directive, not a keyword. Its effect on the music is
// applied after the model returns. Every word and phrase of the lexicon's sleep row is swept, with
// no chip, under the calm mood (whose genre lists name no sleep genre; the mask runs anyway).

describe('buildEmotionPlaylist — a note about sleep sends nothing about sleep (BE-229)', () => {
  const CALM = [{ x: 0.45, y: -0.55 }];
  // The lexicon's sleep row (moodDescriptors._ACTIVITY_LEXICON): its words, its phrases, and notes
  // that reach it through them; plus an insomnia note that the lexicon does not map at all.
  const SLEEP_NOTES = [
    'sleep', 'sleeping', 'bedtime', 'bed', 'wind down', 'winding down', 'before bed',
    "can't sleep", 'music before bed', 'getting ready for bed', 'help me sleep tonight', 'insomnia again',
  ];
  const SLEEP_VOCAB = /sleep|\bbed|insomn|wind(?:ing)?[\s-]?down|getting ready|current activity/i;

  async function run(textPrompt, activity = null) {
    axios.post.mockClear();
    const result = await buildEmotionPlaylist({
      musicProfile: MUSIC_PROFILE, emotionTaps: CALM, textPrompt, activity,
      biometricContext: null, fetchTracks: jest.fn().mockResolvedValue([]),
    });
    expect(axios.post).toHaveBeenCalledTimes(1); // the request left: an empty body is not a pass
    return { body: outbound(), params: result.params };
  }

  it.each(SLEEP_NOTES)('note %p, no chip: the body names no sleep token and no activity', async (note) => {
    const { body } = await run(note);
    expect(withoutGenres(body)).not.toMatch(SLEEP_VOCAB);
    expect(withoutGenres(body)).not.toMatch(HEALTH_VOCAB);
  });

  it('the body for "music before bed" is byte-identical to the body for an empty note', async () => {
    const { body: empty } = await run('');
    const { body: beforeBed } = await run('music before bed');
    expect(empty).not.toBe('');
    expect(beforeBed).toBe(empty);
  });

  it.each(SLEEP_NOTES)('note %p is byte-identical to an empty note', async (note) => {
    const { body: empty } = await run('');
    const { body } = await run(note);
    expect(body).toBe(empty);
  });

  it('only the sleep part of a note is withheld: "calm music before bed" sends what "calm music" sends', async () => {
    const { body: calm } = await run('calm music');
    const { body: calmBeforeBed } = await run('calm music before bed');
    expect(calm).toContain('Derived listener intent');
    expect(calmBeforeBed).toBe(calm);
  });

  it('"before bed" still yields calm, resting-tempo music, applied after the model returns', async () => {
    const { params: plain } = await run('');
    const { params: beforeBed } = await run('music before bed');
    // The fake model answers both prompts alike (they are byte-identical), so every difference
    // below is the deterministic post-return step: the targets blend half-way toward the resting
    // band (bpm 88, energy 0.2, acousticness 0.8), and the tempo band is resting.
    expect(plain.target_bpm).toBe(PARAMS.target_bpm);
    expect(beforeBed.tempo_category).toBe('resting');
    expect(beforeBed.target_bpm).toBe(Math.round(0.5 * PARAMS.target_bpm + 0.5 * 88));
    expect(beforeBed.target_energy).toBeCloseTo(0.5 * PARAMS.target_energy + 0.5 * 0.2, 10);
    expect(beforeBed.target_acousticness).toBeCloseTo(0.5 * PARAMS.target_acousticness + 0.5 * 0.8, 10);
    expect(beforeBed.target_bpm).toBeLessThan(plain.target_bpm);
    expect(beforeBed.target_energy).toBeLessThan(plain.target_energy);
  });

  it('a chip the user picked is unaffected: it is sent, and the note does not change the body', async () => {
    const { body: chipOnly } = await run('', 'running');
    const { body: chipAndNote } = await run('music before bed', 'running');
    expect(chipOnly).toContain('Current activity: running');
    expect(chipAndNote).toBe(chipOnly);
  });
});

// ── 2 · The heart-rate branch makes no LLM call at all ────────────────────────────────────────

describe('adjustBiometricPlaylist — no request leaves the process', () => {
  it('calls axios.post zero times for every health context, and still returns {params, tracks}', async () => {
    for (const ctx of HEALTH_CONTEXTS.filter(Boolean)) {
      const fetchTracks = jest.fn().mockResolvedValue([{ id: 't1' }]);
      const result = await adjustBiometricPlaylist({ musicProfile: MUSIC_PROFILE, biometric: ctx, fetchTracks });
      expect(result.tracks).toEqual([{ id: 't1' }]);
      expect(fetchTracks).toHaveBeenCalledWith(result.params);
      expect(Number.isFinite(result.params.target_bpm)).toBe(true);
    }
    expect(axios.post).toHaveBeenCalledTimes(0);
  });

  it('makes no request even with no vetted key configured (nothing to fail closed on)', async () => {
    const saved = process.env.LLM_API_KEY;
    delete process.env.LLM_API_KEY;
    try {
      const { params } = await adjustBiometricPlaylist({
        musicProfile: MUSIC_PROFILE, biometric: { heartRate: 150, activity: 'running' }, fetchTracks: jest.fn().mockResolvedValue([]),
      });
      expect(params.seed_genres.length).toBeGreaterThan(0);
    } finally {
      process.env.LLM_API_KEY = saved;
    }
    expect(axios.post).not.toHaveBeenCalled();
  });
});

// ── 3 · The caption prompt, called directly with everything a caller could hand it ────────────

describe('captionService.captionDiscovery — only the allow-listed session context is sent', () => {
  beforeEach(() => { process.env.DISCOVERY_CAPTION_LLM = 'true'; });
  afterEach(() => { delete process.env.DISCOVERY_CAPTION_LLM; });

  const TRACK = { recordingKey: 'mbid:1', features: { bpm: 96, energy: 0.4, valence: 0.3, danceability: 0.5, acousticness: 0.6 } };

  it('drops a heart-rate band, a tempo target and a bio: mood key, so the body does not vary with them', async () => {
    const variants = [
      { moodKey: 'calm', emotionTaps: [{ x: 0.45, y: -0.55 }], activity: 'running' },
      { moodKey: 'calm', emotionTaps: [{ x: 0.45, y: -0.55 }], activity: 'running', hrBand: 'peak', targets: { bpmCenter: 162 } },
      { moodKey: 'calm', emotionTaps: [{ x: 0.45, y: -0.55 }], activity: 'running', hrBand: 'resting', targets: { bpmCenter: 74, stateId: 'x' } },
    ];
    const bodies = [];
    for (const ctx of variants) {
      axios.post.mockClear();
      await captionService.captionDiscovery([TRACK], ctx, { budgetMs: 2000 });
      bodies.push(outbound());
    }
    expect(bodies[0]).toContain('mood=calm');
    expect(bodies[0]).toContain('activity=running');
    for (const b of bodies) expect(b).toBe(bodies[0]);
    expect(bodies[0]).not.toMatch(HEALTH_VOCAB);
  });

  it('never sends a synthetic bio: key as the mood', async () => {
    await captionService.captionDiscovery([TRACK], { moodKey: 'bio:peak:running' }, { budgetMs: 2000 });
    const body = outbound();
    expect(body).not.toMatch(/bio:|peak:running/);
    expect(body).not.toMatch(HEALTH_VOCAB);
  });
});

// ── 4 · The socket handler's generate path, end to end ────────────────────────────────────────

describe('generateAndEmitPlaylist — the requests the real generate path sends', () => {
  const SPOTIFY_USER = {
    _id: 'user-123', spotifyToken: { blob: 'encrypted-spotify' }, youtubeMusicToken: null,
    getToken: jest.fn(), save: jest.fn().mockResolvedValue(true),
  };
  const DISCO = {
    id: 'disco1', provider: 'spotify', recordingKey: 'youtube:disco1',
    title: 'Disco One', name: 'Disco One', artist: 'Disco Artist', genres: ['pop'], uri: 'spotify:track:disco1',
  };
  const LIBRARY = [{ id: 'fam1', provider: 'spotify', name: 'Familiar 1', artist: 'Fam Artist', genres: ['pop'], affinity: 10, uri: 'spotify:track:fam1' }];
  const HEALTH_PROFILE = { restingHeartRate: 70, hrv: 40, bodyBattery: 30, dailyReadiness: 45, sleepStages: { deep: 50, light: 200, rem: 60 } };

  function musicProfileQuery(value) {
    const q = Promise.resolve(value);
    q.lean = () => Promise.resolve(value);
    return q;
  }
  const socket = () => ({ id: 'socket-user-123', data: { user: { _id: 'user-123' } }, emit: jest.fn(), on: jest.fn() });
  const state = (overrides = {}) => ({
    stableHR: null, pendingHR: null, latestActivity: null, timer: null, consecutiveSkips: 0,
    lastEmotionTaps: [{ x: 0.45, y: -0.55 }], lastTextPrompt: '', lastActivity: 'running',
    ...overrides,
  });
  const ready = (s) => s.emit.mock.calls.find((c) => c[0] === 'playlist_ready');
  const captionRequests = () => axios.post.mock.calls.filter(([, r]) => r.messages.some((m) => m.content.includes('"captions"')));

  async function run(trigger, st) {
    axios.post.mockClear();
    const s = socket();
    await generateAndEmitPlaylist(s, trigger, st);
    expect(ready(s)).toBeDefined(); // the run served a playlist: a silent failure is not a pass
    return outbound();
  }

  beforeEach(() => {
    User.findById.mockResolvedValue(SPOTIFY_USER);
    MusicProfile.findOne.mockReturnValue(musicProfileQuery({
      userId: 'user-123', library: LIBRARY, lastAnalyzed: new Date('2026-07-01'),
      topGenres: ['pop'], genreSet: ['pop'], knownArtistIds: [],
    }));
    MedicalProfile.findOne.mockResolvedValue(null);
    BiometricLog.find.mockReturnValue({ sort: () => ({ limit: () => Promise.resolve([]) }) });
    spotify.getValidToken.mockResolvedValue('spotify-access-token');
    vectorDiscoveryFetch.mockImplementation(async () => [{ ...DISCO }]);
    featureRepo.getMany.mockResolvedValue(new Map([['youtube:disco1', { bpm: 96, energy: 0.4, valence: 0.3, acousticness: 0.6, danceability: 0.5 }]]));
    biosonic.translate.mockReturnValue({});
    baselines.peekBaselines.mockResolvedValue(null);
    sleepHistory.readNightHistory.mockResolvedValue([]);
    affectService.resolveAffect.mockResolvedValue(null);
    process.env.DISCOVERY_CAPTION_LLM = 'true';
    process.env.VECTOR_DISCOVERY = 'true';
    delete process.env.DISCOVERY_BAND_AWARE;
  });
  afterEach(() => {
    delete process.env.DISCOVERY_CAPTION_LLM;
    delete process.env.VECTOR_DISCOVERY;
    delete process.env.DISCOVERY_BAND_AWARE;
  });

  it('a mood-only run sends the emotion request and one caption request, with the chosen chip only', async () => {
    const body = await run('emotion', state());
    expect(captionRequests()).toHaveLength(1);
    expect(body).toContain('activity=running');
    expect(withoutGenres(body)).not.toMatch(HEALTH_VOCAB);
  });

  it('a mood-only run with a chip is byte-identical whatever the watch detected', async () => {
    const a = await run('emotion', state({ latestActivity: null }));
    const b = await run('emotion', state({ latestActivity: 'cycling' }));
    const c = await run('emotion', state({ latestActivity: 'swimming' }));
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(a).not.toMatch(/cycling|swimming/);
  });

  it('with no chip, a watch-detected activity shapes the run, so no caption request is sent', async () => {
    await run('emotion', state({ lastActivity: null, latestActivity: 'cycling' }));
    expect(captionRequests()).toHaveLength(0);
    expect(outbound()).not.toMatch(/cycling/);
  });

  it('a heart rate at 50 or at 180 on the mood branch: no caption request, and the emotion request is unchanged', async () => {
    const moodOnly = await run('emotion', state());
    const emotionOnly = moodOnly.split('\n---\n')[0];
    for (const hr of [50, 180]) {
      const body = await run('emotion', state({ stableHR: hr, latestActivity: 'running' }));
      expect(captionRequests()).toHaveLength(0);
      expect(body).toBe(emotionOnly);
    }
  });

  it('a stored health profile on the mood branch: no caption request, and the emotion request is unchanged', async () => {
    const emotionOnly = (await run('emotion', state())).split('\n---\n')[0];
    MedicalProfile.findOne.mockResolvedValue(HEALTH_PROFILE);
    const body = await run('emotion', state());
    expect(captionRequests()).toHaveLength(0);
    expect(body).toBe(emotionOnly);
  });

  it('band-aware targets on the mood branch: no caption request, and the emotion request is unchanged', async () => {
    const emotionOnly = (await run('emotion', state())).split('\n---\n')[0];
    process.env.DISCOVERY_BAND_AWARE = 'true';
    // A window wide enough to admit the discovery track, so the guard — not the band — is what
    // keeps the caption request from leaving (a narrow band would empty the captionable set and
    // pass for the wrong reason).
    biosonic.translate.mockReturnValue({ bpmCenter: 96, bpmWidth: 60, energyFloor: 0, energyCeiling: 1, valenceTarget: 0.3, stateId: 'exertion', confidence: 0.9 });
    const body = await run('emotion', state());
    expect(captionRequests()).toHaveLength(0);
    expect(body).toBe(emotionOnly);
  });

  // BE-227 (RA-1 on #279): generateV2 builds its own targets when band-aware discovery is off, and
  // those read stored health inputs the handler never sees. Each one alone stops the caption request.
  it.each([
    ['cached baselines', () => baselines.peekBaselines.mockResolvedValue({ rhrMedian: 52, hrvMedian: 61 })],
    ['a stored night', () => sleepHistory.readNightHistory.mockResolvedValue([{ date: '2026-10-26', totalMin: 290 }])],
    ['an affect state', () => affectService.resolveAffect.mockResolvedValue({ label: 'calm', confidence: 0.2, axes: {} })],
  ])('targets generateV2 built from %s alone: no caption request, and the emotion request is unchanged', async (_name, arrange) => {
    const emotionOnly = (await run('emotion', state())).split('\n---\n')[0];
    expect(captionRequests()).toHaveLength(1); // the control captioned: the instrument is live
    arrange();
    const body = await run('emotion', state());
    expect(captionRequests()).toHaveLength(0);
    expect(body).toBe(emotionOnly);
  });

  it('the heart branch sends nothing at all — any heart rate, ratio, state or watch activity', async () => {
    process.env.DISCOVERY_BAND_AWARE = 'true';
    for (const [hr, rhr, stateId, activity] of [[50, 60, null, 'resting'], [180, 55, 'exertion', 'running'], [120, null, 'stress', 'cycling']]) {
      baselines.peekBaselines.mockResolvedValue(rhr ? { rhrMedian: rhr } : null);
      biosonic.translate.mockReturnValue(stateId ? { stateId, bpmCenter: 140 } : {});
      const body = await run('biometric', state({ stableHR: hr, latestActivity: activity, lastEmotionTaps: [], lastActivity: null }));
      expect(body).toBe('');
    }
    expect(axios.post).toHaveBeenCalledTimes(0);
  });
});

// ── 5 · The callers that take no health input still name no health concept ────────────────────

describe('the other Groq callers', () => {
  it('inferArtistGenres', async () => {
    await inferArtistGenres(['Artist', 'Another Artist']);
    expect(axios.post).toHaveBeenCalled();
    expect(outbound()).not.toMatch(HEALTH_VOCAB);
  });

  it('the feature estimator (llmEstimatorAdapter.getFeatures)', async () => {
    await llmEstimator.getFeatures([{ recordingKey: 'mbid:1', title: 'x', genres: ['indie pop'] }]);
    expect(axios.post).toHaveBeenCalled();
    expect(outbound()).not.toMatch(HEALTH_VOCAB);
  });

  it('the embedding worker\'s vibe-tag enrichment', async () => {
    featureRepo.getMany.mockResolvedValue(new Map([['mbid:1', { bpm: 100, energy: 0.5, valence: 0.5, acousticness: 0.3 }]]));
    const out = await embeddingWorker.process({ data: { recordingKeys: ['mbid:1'] } });
    expect(out.embedded).toBe(1);
    expect(axios.post).toHaveBeenCalled();
    expect(outbound()).not.toMatch(HEALTH_VOCAB);
  });
});

