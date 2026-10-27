'use strict';

// RA-1 / BE-227: a mood-only run whose targets generateV2 built from stored health inputs
// (baselines, nights) must send NO caption request. RED at 90e5dfe: the handler's guard cannot see
// what buildTargets read. targetsBuilder is REAL; only its leaf stores are faked, and translate
// returns a neutral window so the discovery track stays selectable (the guard, not a band, decides).

process.env.NODE_ENV       = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET     = 'test-jwt-secret-for-tests-only';
process.env.LLM_API_KEY    = 'test-llm-key';
delete process.env.GROQ_API_KEY;

jest.mock('axios');
jest.mock('../app/models/User', () => ({ findById: jest.fn() }));
jest.mock('../app/models/MusicProfile', () => ({ findOne: jest.fn() }));
jest.mock('../app/models/BiometricLog', () => ({ find: jest.fn() }));
jest.mock('../app/models/MedicalProfile', () => ({ findOne: jest.fn() }));
jest.mock('../app/models/PlaylistSession', () => ({
  create: jest.fn().mockResolvedValue({}), find: jest.fn(), countDocuments: jest.fn().mockResolvedValue(0),
}));
jest.mock('../app/services/spotify', () => ({
  getValidToken: jest.fn(), getRecommendations: jest.fn(), fetchVibeDiscovery: jest.fn(),
  getArtistsGenres: jest.fn(), artistGenresAvailable: jest.fn(() => true), markDiscoveryUnavailable: jest.fn(),
}));
jest.mock('../app/services/youtube', () => ({ getValidToken: jest.fn(), searchRecommendations: jest.fn() }));
jest.mock('../app/services/playlistMixer', () => ({
  personalizeWhitelist: jest.fn((t) => t), generateFallbackPlaylist: jest.fn().mockReturnValue([]),
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
// targetsBuilder stays REAL. Its leaves:
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
  getConsentStatus: jest.fn().mockResolvedValue({ granted: true, currentVersion: 1, staleVersion: false }),
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
const { vectorDiscoveryFetch } = require('../app/services/discovery/discoveryFetch');
const { generateAndEmitPlaylist } = require('../app/sockets/biometricHandler');

const PARAMS = {
  target_bpm: 110, target_energy: 0.6, target_valence: 0.5, target_acousticness: 0.3,
  seed_artists: [], seed_genres: ['electronic'], mood_keywords: ['calm'],
};
const DISCO = {
  id: 'disco1', provider: 'spotify', recordingKey: 'youtube:disco1',
  title: 'Disco One', name: 'Disco One', artist: 'Disco Artist', genres: ['pop'], uri: 'spotify:track:disco1',
};
const USER = { _id: 'user-123', spotifyToken: { blob: 'x' }, youtubeMusicToken: null, getToken: jest.fn(), save: jest.fn().mockResolvedValue(true) };

const captionRequests = () => axios.post.mock.calls.filter(([, r]) => (r.messages || []).some((m) => m.content.includes('"captions"')));
const socket = () => ({ id: 'socket-user-123', data: { user: { _id: 'user-123' } }, emit: jest.fn(), on: jest.fn() });
const moodOnly = () => ({
  stableHR: null, pendingHR: null, latestActivity: null, timer: null, consecutiveSkips: 0,
  lastEmotionTaps: [{ x: 0.45, y: -0.55 }], lastTextPrompt: '', lastActivity: 'running',
});
function profileQuery(value) { const q = Promise.resolve(value); q.lean = () => Promise.resolve(value); return q; }

async function run() {
  const s = socket();
  await generateAndEmitPlaylist(s, 'emotion', moodOnly());
  const ready = s.emit.mock.calls.find((c) => c[0] === 'playlist_ready');
  expect(ready).toBeDefined();
  expect(ready[1].discovery).toBeGreaterThan(0); // a discovery track WAS selected: the guard decides
  return ready;
}

beforeEach(() => {
  jest.clearAllMocks();
  axios.post.mockImplementation(async (_u, req) => {
    const p = req.messages.map((m) => m.content).join('\n');
    const body = p.includes('"captions"') ? { captions: [{ i: 0, caption: 'A slow burner' }] } : PARAMS;
    return { status: 200, data: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(body) } }] } };
  });
  for (const l of ['warn', 'info', 'error', 'log']) jest.spyOn(console, l).mockImplementation(() => {});
  User.findById.mockResolvedValue(USER);
  MusicProfile.findOne.mockReturnValue(profileQuery({
    userId: 'user-123', library: [{ id: 'fam1', provider: 'spotify', name: 'F', artist: 'A', genres: ['pop'], affinity: 10, uri: 'spotify:track:fam1' }],
    lastAnalyzed: new Date('2026-07-01'), topGenres: ['pop'], genreSet: ['pop'], knownArtistIds: [],
  }));
  MedicalProfile.findOne.mockResolvedValue(null); // no stored profile: profileShaped stays false
  BiometricLog.find.mockReturnValue({ sort: () => ({ limit: () => Promise.resolve([]) }) });
  spotify.getValidToken.mockResolvedValue('tok');
  vectorDiscoveryFetch.mockImplementation(async () => [{ ...DISCO }]);
  featureRepo.getMany.mockResolvedValue(new Map([['youtube:disco1', { bpm: 96, energy: 0.4, valence: 0.3, acousticness: 0.6, danceability: 0.5 }]]));
  baselines.peekBaselines.mockResolvedValue(null);
  sleepHistory.readNightHistory.mockResolvedValue([]);
  process.env.DISCOVERY_CAPTION_LLM = 'true';
  process.env.VECTOR_DISCOVERY = 'true';
  delete process.env.DISCOVERY_BAND_AWARE;
});
afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.DISCOVERY_CAPTION_LLM;
  delete process.env.VECTOR_DISCOVERY;
});

describe('RA-1 / BE-227: targets generateV2 built from stored health inputs never caption', () => {
  it('control: no health input anywhere → exactly one caption request (the instrument is live)', async () => {
    await run();
    expect(captionRequests()).toHaveLength(1);
  });

  it('stored baselines, no profile, no heart rate → no caption request', async () => {
    baselines.peekBaselines.mockResolvedValue({ rhrMedian: 52, hrvMedian: 61 });
    await run();
    expect(baselines.peekBaselines).toHaveBeenCalledWith('user-123'); // buildTargets read them
    expect(captionRequests()).toHaveLength(0);
  });

  it('a stored night history, no profile, no baselines → no caption request', async () => {
    sleepHistory.readNightHistory.mockResolvedValue([{ date: '2026-10-26', totalMin: 290 }]);
    await run();
    expect(sleepHistory.readNightHistory).toHaveBeenCalled();
    expect(captionRequests()).toHaveLength(0);
  });
});
