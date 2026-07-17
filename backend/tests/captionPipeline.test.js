'use strict';

// M1 (resilience audit) — the REAL features→caption→receipt integration seam.
//
// Every OTHER caption test injects `t.features` by hand, but a live discovery candidate has
// NO features until the REAL selection pipeline attaches them (pipeline.js:95 →
// featuresOf(featureMap.get(rk))), which is NULL when the catalog has no AudioFeature doc.
// So captioning silently no-ops for featureless tracks — and no test pinned the real
// selectPlaylist → biometricHandler caption-filter → receipt.caption contract. This does.
//
// Here the orchestrator + selection pipeline + captionService + buildReceipt/toClientTracks
// are ALL REAL. Only the data layer (audioFeatureRepo/serveLedger/vectorIndex/redis/
// targetsBuilder) and the ONE Groq call (llmClient.generateJson) are mocked. The featured
// discovery track gets its features from the REAL pipeline attach; the featureless one gets
// features:null the same way — proving the real filter, not a hand-set fixture.

process.env.NODE_ENV       = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET     = 'test-jwt-secret-for-tests-only';

// ── Mocks: data layer + upstream only. orchestrator + captionService stay REAL. ──

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
jest.mock('../app/services/youtube', () => ({
  getValidToken: jest.fn(), searchRecommendations: jest.fn(),
}));
jest.mock('../app/services/geminiEngine', () => ({
  buildEmotionPlaylist: jest.fn(), adjustBiometricPlaylist: jest.fn(), critiqueTrackVibe: jest.fn(),
}));
jest.mock('../app/services/playlistMixer', () => ({
  personalizeWhitelist: jest.fn((t) => t),
  generateFallbackPlaylist: jest.fn().mockReturnValue([]),
}));
jest.mock('../app/services/features/featureService', () => ({
  hydrate: jest.fn(), enqueueHydration: jest.fn().mockResolvedValue({ queued: true }),
}));
jest.mock('../app/services/discovery/discoveryFetch', () => ({
  vectorDiscoveryFetch: jest.fn(async () => []),
}));
jest.mock('../app/repositories/shadowBufferRepo', () => ({
  getBuffer: jest.fn().mockResolvedValue(null), setBuffer: jest.fn().mockResolvedValue(true),
}));
// A playback-capable (Spotify) user reaches the D-1 session-context attach; stub it so the seam
// under test (features→caption→receipt) never touches the real Spotify session-playlist API.
jest.mock('../app/services/spotifySessionPlaylist', () => ({
  writeSessionPlaylist: jest.fn().mockResolvedValue({ contextUri: 'spotify:playlist:session-test' }),
}));

// Selection-pipeline data layer (the REAL pipeline runs on top of these).
jest.mock('../app/config/redis', () => ({ getRedis: jest.fn(() => null), createConnection: jest.fn() }));
jest.mock('../app/services/ledger/serveLedger', () => ({
  recordServes: jest.fn().mockResolvedValue({ recorded: 0 }),
  hardExcluded: jest.fn().mockResolvedValue(new Set()),
  moodExcluded: jest.fn().mockResolvedValue(new Set()),
  getExposure:  jest.fn().mockResolvedValue(new Map()),
}));
jest.mock('../app/repositories/audioFeatureRepo', () => ({
  getMany: jest.fn().mockResolvedValue(new Map()), upsertMany: jest.fn(), missingKeys: jest.fn(),
}));
jest.mock('../app/services/vector/vectorIndex', () => ({
  getMany: jest.fn().mockResolvedValue(new Map()), upsertMany: jest.fn(), queryNear: jest.fn(), use: jest.fn(),
}));
// The ONLY biosonic model I/O — mocked to a permissive band so the crafted tracks survive the
// (un-relaxable) band; the pipeline's feature ATTACH + caption filter are exercised for real.
jest.mock('../app/services/generation/targetsBuilder', () => ({
  buildTargets: jest.fn().mockResolvedValue({}),
}));
// The ONE Groq call the REAL captionService makes.
jest.mock('../app/services/llmClient', () => ({
  generateJson: jest.fn(), isConfigured: jest.fn().mockReturnValue(true),
}));

const User            = require('../app/models/User');
const MusicProfile    = require('../app/models/MusicProfile');
const BiometricLog    = require('../app/models/BiometricLog');
const MedicalProfile  = require('../app/models/MedicalProfile');
const spotify         = require('../app/services/spotify');
const youtube         = require('../app/services/youtube');
const geminiEngine    = require('../app/services/geminiEngine');
const featureRepo     = require('../app/repositories/audioFeatureRepo');
const llmClient       = require('../app/services/llmClient');

const { generateAndEmitPlaylist } = require('../app/sockets/biometricHandler');

// ── Fixtures ─────────────────────────────────────────────────────────────────────

// A playback-capable (Spotify) user — the ONLY vehicle that reaches the discovery-caption
// pipeline in real semantics. A YouTube-only account (no Spotify sink) now short-circuits
// BEFORE the LLM + discovery (its corpus resolves to spotify: URIs only, #151), so it can
// never carry a discovery candidate here. The crafted discovery tracks carry their native
// youtube: recordingKey (matches the AudioFeature doc) resolved to a spotify: playback URI,
// so the cross-platform step is a native passthrough (no Spotify search) and toClientTracks
// keeps them unchanged.
const SPOTIFY_USER = {
  _id: 'user-123', spotifyToken: { blob: 'encrypted-spotify' }, youtubeMusicToken: null,
  getToken: jest.fn(), save: jest.fn().mockResolvedValue(true),
};

const AI_PARAMS = { target_bpm: 96, target_energy: 0.4, target_valence: 0.3, seed_genres: ['pop'], seed_artists: [] };

// One familiar library track (never captioned) …
const LIBRARY = [
  { id: 'fam1', provider: 'spotify', name: 'Familiar 1', artist: 'Fam Artist', genres: ['pop'], affinity: 10, uri: 'spotify:track:fam1' },
];
// … and two discovery candidates as buildEmotionPlaylist would emit them: recordingKey +
// title/artist, but crucially NO `features` (the real pipeline attaches those, or not).
const DISCO_FEATURED = {
  id: 'disco1', provider: 'spotify', recordingKey: 'youtube:disco1',
  title: 'Disco One', name: 'Disco One', artist: 'Disco Artist', genres: ['pop'], uri: 'spotify:track:disco1',
};
const DISCO_FEATURELESS = {
  id: 'disco2', provider: 'spotify', recordingKey: 'youtube:disco2',
  title: 'Disco Two', name: 'Disco Two', artist: 'Disco Artist Two', genres: ['pop'], uri: 'spotify:track:disco2',
};

// The AudioFeature doc the mocked repo returns for disco1 ONLY — disco2 stays featureless.
const DISCO1_FEATURES = { bpm: 96, energy: 0.4, valence: 0.3, acousticness: 0.6, danceability: 0.5 };
const CAPTION_TEXT = 'A slow, smoky burner your quiet needed';

function musicProfileQuery(value) {
  const query = Promise.resolve(value);
  query.lean = () => Promise.resolve(value);
  return query;
}

function makeSocket(userId = 'user-123') {
  return { id: `socket-${userId}`, data: { user: { _id: userId } }, emit: jest.fn(), on: jest.fn() };
}
function makeState(overrides = {}) {
  return {
    stableHR: 80, pendingHR: null, latestActivity: 'resting', timer: null,
    consecutiveSkips: 0, lastEmotionTaps: [{ x: 0.1, y: 0.2 }], lastTextPrompt: '', lastActivity: 'resting',
    ...overrides,
  };
}

let warnSpy;
beforeEach(() => {
  jest.clearAllMocks();
  User.findById.mockResolvedValue(SPOTIFY_USER);
  MusicProfile.findOne.mockReturnValue(musicProfileQuery({
    userId: 'user-123', restingHeartRate: 60, library: LIBRARY, lastAnalyzed: new Date('2026-07-01'),
    topGenres: ['pop'], genreSet: ['pop'], knownArtistIds: [],
  }));
  MedicalProfile.findOne.mockResolvedValue(null);
  BiometricLog.find.mockReturnValue({ sort: () => ({ limit: () => Promise.resolve([]) }) });
  spotify.getValidToken.mockResolvedValue('spotify-access-token');
  // buildEmotionPlaylist is the source of the discovery candidates fed into the REAL pipeline.
  geminiEngine.buildEmotionPlaylist.mockResolvedValue({ params: AI_PARAMS, tracks: [DISCO_FEATURED, DISCO_FEATURELESS] });
  // The REAL pipeline attaches features from THIS repo — disco1 has a doc, disco2 does not.
  featureRepo.getMany.mockResolvedValue(new Map([['youtube:disco1', DISCO1_FEATURES]]));
  llmClient.isConfigured.mockReturnValue(true);
  llmClient.generateJson.mockResolvedValue(JSON.stringify({ captions: [{ i: 0, caption: CAPTION_TEXT }] }));
  process.env.DISCOVERY_CAPTION_LLM = 'true';
  delete process.env.DISCOVERY_BAND_AWARE;
  delete process.env.VECTOR_DISCOVERY;
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.DISCOVERY_CAPTION_LLM;
});

function readyPayload(socket) {
  const call = socket.emit.mock.calls.find((c) => c[0] === 'playlist_ready');
  return call ? call[1] : null;
}

describe('real features→caption→receipt pipeline (M1: no hand-set fixtures)', () => {
  it('a REAL-pipeline discovery track with an AudioFeature doc reaches the caption filter and emits receipt.caption', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState());

    // The real pipeline ran (features were loaded), not a mocked orchestrator.
    expect(featureRepo.getMany).toHaveBeenCalled();

    const payload = readyPayload(socket);
    expect(payload).not.toBeNull();
    const byId = Object.fromEntries(payload.tracks.map((t) => [t.id, t]));

    // Featured discovery track → caption survived selection → filter → captionService → receipt.
    expect(byId.disco1).toBeDefined();
    expect(byId.disco1.receipt.caption).toBe(CAPTION_TEXT);

    // The Groq prompt was built from the REAL attached features (96bpm) — never the title/artist.
    expect(llmClient.generateJson).toHaveBeenCalledTimes(1);
    const prompt = llmClient.generateJson.mock.calls[0][0];
    expect(prompt).toContain('96bpm');
    expect(prompt).not.toContain('Disco One');
    expect(prompt).not.toContain('Disco Artist');
  });

  it('the reciprocal: a FEATURELESS discovery track (features:null) is filtered out of captioning — no caption, no throw', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState());

    const payload = readyPayload(socket);
    expect(payload).not.toBeNull();
    const byId = Object.fromEntries(payload.tracks.map((t) => [t.id, t]));

    expect(byId.disco2).toBeDefined();               // it still made the playlist
    expect(byId.disco2.receipt).not.toHaveProperty('caption'); // …just no caption
    // Only the ONE featured track was sent to the model — the featureless one never was.
    expect(llmClient.generateJson).toHaveBeenCalledTimes(1);
  });

  it('a familiar (non-discovery) track never receives a caption', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState());

    const byId = Object.fromEntries(readyPayload(socket).tracks.map((t) => [t.id, t]));
    expect(byId.fam1).toBeDefined();
    expect(byId.fam1.receipt).not.toHaveProperty('caption');
  });

  it('emits an always-on captionedDiscovery=<N>/<total> telemetry line carrying NO track data', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState());

    // 1 of the 2 discovery tracks got a caption (disco1 featured, disco2 featureless).
    const line = warnSpy.mock.calls.map((c) => String(c[0])).find((s) => s.includes('[discovery.caption]'));
    expect(line).toBeDefined();
    expect(line).toMatch(/captionedDiscovery=1\/2\b/);
    // Compliance: the counter line must never leak a title/artist/genre.
    expect(line).not.toContain('Disco One');
    expect(line).not.toContain('Disco Artist');
    expect(line).not.toContain('Disco Two');
  });

  it('FLAG OFF: no caption path runs and no captionedDiscovery telemetry is emitted', async () => {
    process.env.DISCOVERY_CAPTION_LLM = 'false';
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState());

    expect(llmClient.generateJson).not.toHaveBeenCalled();
    const line = warnSpy.mock.calls.map((c) => String(c[0])).find((s) => s.includes('[discovery.caption]'));
    expect(line).toBeUndefined();
    const byId = Object.fromEntries(readyPayload(socket).tracks.map((t) => [t.id, t]));
    expect(byId.disco1.receipt).not.toHaveProperty('caption');
  });
});
