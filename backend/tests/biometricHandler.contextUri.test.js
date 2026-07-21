'use strict';

// D-1 (#87) CI guard: the session-playlist contextUri attach on `playlist_ready`.
// biometricHandler.pipeline.test.js asserts `playlist_ready` ~40x but NEVER asserts the
// contextUri seam — so a regression in attachSessionContext (missing attach, or a 403 that
// stops failing-open to track playback) would ship green. This closes that blind spot.
//
// The attach runs in a `.then()` that generateAndEmitPlaylist awaits in its `finally` via
// `readyEmitSettled`, so a plain `await generateAndEmitPlaylist(...)` deterministically
// settles the deferred, ACTUAL emitted payload (contextUri already attached or not) before
// these assertions read socket.emit. This is a SIBLING file (not the pipeline file) so the
// spotifySessionPlaylist mock's blast radius is exactly these three tests.

process.env.NODE_ENV       = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET     = 'test-jwt-secret-for-tests-only';

// ── Mocks (replicated from biometricHandler.pipeline.test.js — keep the heavy service graph
//     and every DB/network side effect out; only behavior under test stays real) ───────────

jest.mock('../app/models/User', () => ({ findById: jest.fn() }));
jest.mock('../app/models/MusicProfile', () => ({ findOne: jest.fn() }));
jest.mock('../app/models/BiometricLog', () => ({ find: jest.fn() }));
jest.mock('../app/models/PlaylistSession', () => ({
  create:         jest.fn().mockResolvedValue({}),
  find:           jest.fn(),
  countDocuments: jest.fn().mockResolvedValue(0),
}));
jest.mock('../app/models/MedicalProfile', () => ({ findOne: jest.fn().mockResolvedValue(null) }));
jest.mock('../app/utils/biometricAudit', () => ({
  logBiometricAccess: jest.fn(),
  auditedDecrypt:     jest.fn(),
}));

jest.mock('../app/services/spotify', () => ({
  getValidToken:            jest.fn(),
  getRecommendations:       jest.fn(),
  fetchVibeDiscovery:       jest.fn(),
  getArtistsGenres:         jest.fn(),
  artistGenresAvailable:    jest.fn(() => true),
  markDiscoveryUnavailable: jest.fn(),
}));
jest.mock('../app/services/youtube', () => ({
  getValidToken:         jest.fn(),
  searchRecommendations: jest.fn(),
}));
jest.mock('../app/services/geminiEngine', () => ({
  buildEmotionPlaylist:    jest.fn(),
  adjustBiometricPlaylist: jest.fn(),
  critiqueTrackVibe:       jest.fn(),
}));
jest.mock('../app/services/playlistMixer', () => ({
  personalizeWhitelist:     jest.fn(),
  generateFallbackPlaylist: jest.fn().mockReturnValue([{ id: 'lib-1' }, { id: 'lib-2' }]),
}));
jest.mock('../app/services/features/featureService', () => ({
  hydrate:          jest.fn(),
  enqueueHydration: jest.fn().mockResolvedValue({ queued: true }),
}));
jest.mock('../app/services/generation/orchestrator', () => ({
  generateV2: jest.fn(async () => ({
    familiar:  [{ id: 'lib-1', name: 'Familiar 1' }],
    discovery: [{ id: 'd1', name: 'Discovery 1' }, { id: 'd2', name: 'Discovery 2' }],
    merged:    [{ id: 'lib-1', name: 'Familiar 1' }, { id: 'd1', name: 'Discovery 1' }, { id: 'd2', name: 'Discovery 2' }],
    telemetry: { poolSize: 3, afterFilters: 3, relaxLevel: 0, stageMs: { total: 5 } },
    targets:   { bpmCenter: 120 },
  })),
  buildTargets: jest.fn(async () => ({ bpmCenter: 120 })),
}));
jest.mock('../app/services/discovery/discoveryFetch', () => ({
  vectorDiscoveryFetch: jest.fn(async () => []),
}));
jest.mock('../app/services/discovery/captionService', () => ({
  captionDiscovery: jest.fn(async () => new Map()),
}));
jest.mock('../app/services/ledger/serveLedger', () => ({
  recordServes: jest.fn().mockResolvedValue({ recorded: 0 }),
  hardExcluded: jest.fn().mockResolvedValue(new Set()),
  moodExcluded: jest.fn().mockResolvedValue(new Set()),
  getExposure:  jest.fn().mockResolvedValue(new Map()),
}));
jest.mock('../app/repositories/shadowBufferRepo', () => ({
  getBuffer: jest.fn().mockResolvedValue(null),
  setBuffer: jest.fn().mockResolvedValue(true),
}));
jest.mock('../app/config/sentry', () => ({
  initSentry:       jest.fn(),
  getSentry:        jest.fn(() => null),
  captureException: jest.fn(),
  scrubEvent:       jest.fn((e) => e),
}));
jest.mock('../app/services/crossPlatform', () => ({
  ...jest.requireActual('../app/services/crossPlatform'),
  translateToSpotify: jest.fn(async (tracks) => ({ tracks, translated: 0, missed: 0 })),
}));
jest.mock('../app/repositories/trackCatalogRepo', () => ({
  updateResolvedUris:    jest.fn(async () => ({ updated: 0 })),
  invalidateResolvedUri: jest.fn(async () => ({ invalidated: false })),
  upsertMany:            jest.fn(async () => ({ upserted: 0 })),
  getMany:               jest.fn(async () => new Map()),
}));
jest.mock('../app/services/wearable/adapter', () => ({
  normalize: jest.fn((source, raw) => ({ heartRate: raw.heartRate, activity: raw.activity || 'running', source })),
}));
jest.mock('../app/services/privacy/consent', () => ({
  getConsentStatus:       jest.fn().mockResolvedValue({ granted: true, currentVersion: 1, staleVersion: false }),
  HEALTH_CONSENT_PURPOSE: 'health_biometric_processing',
}));

// The seam under test: the hidden Session-playlist writer. attachSessionContext lazy-requires it,
// so this mock intercepts that require. Default jest.fn() → resolves undefined → the destructure
// `const { contextUri } = ...` throws → the fail-open catch returns the payload unchanged (no
// contextUri) — exactly the "attach did nothing" baseline each test overrides per case.
jest.mock('../app/services/spotifySessionPlaylist', () => ({
  writeSessionPlaylist: jest.fn(),
}));

const User               = require('../app/models/User');
const MusicProfile       = require('../app/models/MusicProfile');
const BiometricLog       = require('../app/models/BiometricLog');
const MedicalProfile     = require('../app/models/MedicalProfile');
const PlaylistSession    = require('../app/models/PlaylistSession');
const spotify            = require('../app/services/spotify');
const geminiEngine       = require('../app/services/geminiEngine');
const playlistMixer      = require('../app/services/playlistMixer');
const orchestrator       = require('../app/services/generation/orchestrator');
const shadowBufferRepo   = require('../app/repositories/shadowBufferRepo');
const sessionPlaylist    = require('../app/services/spotifySessionPlaylist');

const { generateAndEmitPlaylist } = require('../app/sockets/biometricHandler');

// ── Fixtures ────────────────────────────────────────────────────────────────────

function makeMusicProfile(overrides = {}) {
  return {
    userId: 'user-123',
    restingHeartRate: 60, tempoBaseline: 120, energy: 0.6, valence: 0.5,
    topGenres: ['pop', 'electronic'], topArtists: ['Artist A'],
    genreSet: ['pop', 'electronic'], knownArtistIds: ['artist-a'],
    library: [
      { id: 'lib-1', provider: 'spotify', tempo: 120, energy: 0.6, valence: 0.5, acousticness: 0.2, genres: ['pop'], artist: 'Artist A' },
      { id: 'lib-2', provider: 'spotify', tempo: 125, energy: 0.65, valence: 0.55, acousticness: 0.15, genres: ['electronic'], artist: 'Artist B' },
    ],
    ...overrides,
  };
}

// Mirrors a Mongoose Query: awaited directly (HR resolver) and via .lean() (generation path).
function musicProfileQuery(value) {
  const query = Promise.resolve(value);
  query.lean = () => Promise.resolve(value);
  return query;
}

// A Spotify user with the playlist-modify-private scope — the D-1 happy path. spotifySessionPlaylistId
// present so writeSessionPlaylist's create-branch is irrelevant (the mock owns the result anyway).
const SPOTIFY_USER_WITH_SCOPE = {
  _id: 'user-123',
  spotifyToken:            { blob: 'encrypted-spotify' },
  spotifyScopes:           'user-read-email playlist-modify-private playlist-read-private',
  spotifySessionPlaylistId: 'existing-session-playlist',
  youtubeMusicToken:       null,
  getToken: jest.fn(),
  save:     jest.fn().mockResolvedValue(true),
};

const AI_PARAMS = {
  target_bpm: 128, target_energy: 0.8, target_valence: 0.7,
  target_acousticness: 0.1, seed_genres: ['electronic'], seed_artists: [],
};
const DISCOVERY_TRACKS = [{ id: 'd1', name: 'Discovery 1' }, { id: 'd2', name: 'Discovery 2' }];

function makeSocket(userId = 'user-123') {
  return {
    id:   `socket-${userId}-${Math.random()}`,
    data: { user: { _id: userId } },
    emit: jest.fn(),
    on:   () => {},
  };
}

function makeState(overrides = {}) {
  return {
    stableHR: 80, pendingHR: null, latestActivity: 'running', timer: null,
    consecutiveSkips: 0, lastEmotionTaps: [], lastTextPrompt: '', ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  User.findById.mockResolvedValue(SPOTIFY_USER_WITH_SCOPE);
  MusicProfile.findOne.mockReturnValue(musicProfileQuery(makeMusicProfile()));
  spotify.getValidToken.mockResolvedValue('spotify-access-token');
  spotify.fetchVibeDiscovery.mockResolvedValue(DISCOVERY_TRACKS);
  spotify.getArtistsGenres.mockResolvedValue({});
  geminiEngine.adjustBiometricPlaylist.mockResolvedValue({ params: AI_PARAMS, tracks: DISCOVERY_TRACKS });
  geminiEngine.buildEmotionPlaylist.mockResolvedValue({ params: AI_PARAMS, tracks: DISCOVERY_TRACKS });
  playlistMixer.personalizeWhitelist.mockImplementation((tracks) => tracks);
  BiometricLog.find.mockReturnValue({ sort: () => ({ limit: () => Promise.resolve([]) }) });
  MedicalProfile.findOne.mockResolvedValue(null);
  shadowBufferRepo.getBuffer.mockResolvedValue(null);
  const chain = { sort: () => chain, limit: () => chain, select: () => chain, lean: () => Promise.resolve([]) };
  PlaylistSession.find.mockReturnValue(chain);
  // Reset the seam to the fail-open baseline (undefined → destructure throws → no contextUri) so a
  // per-case implementation never leaks between tests (clearAllMocks does NOT clear implementations).
  sessionPlaylist.writeSessionPlaylist.mockReset();
});

// ── D-1: session-playlist contextUri attach on playlist_ready ─────────────────────

describe('D-1 contextUri attach', () => {
  it('attaches the session-playlist contextUri to playlist_ready when the write resolves (>=2 spotify: URIs, modify-private scope)', async () => {
    sessionPlaylist.writeSessionPlaylist.mockResolvedValue({ playlistId: 'abc', contextUri: 'spotify:playlist:abc' });

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState());

    // The write was actually driven by the >=2 spotify:track: URIs the pipeline emits.
    expect(sessionPlaylist.writeSessionPlaylist).toHaveBeenCalledTimes(1);
    const [userArg, urisArg] = sessionPlaylist.writeSessionPlaylist.mock.calls[0];
    expect(userArg).toBe(SPOTIFY_USER_WITH_SCOPE);
    expect(urisArg.length).toBeGreaterThanOrEqual(2);
    expect(urisArg.every((u) => u.startsWith('spotify:track:'))).toBe(true);

    // The DEFERRED, post-attach payload the client actually receives carries the contextUri.
    const ready = socket.emit.mock.calls.find((c) => c[0] === 'playlist_ready');
    expect(ready).toBeTruthy();
    expect(ready[1].contextUri).toBe('spotify:playlist:abc');
    expect(ready[1].tracks.length).toBeGreaterThanOrEqual(2); // tracks still delivered
  });

  it('fails OPEN to track playback on a 403: playlist_ready STILL emits, WITHOUT a contextUri', async () => {
    const err403 = Object.assign(new Error('403'), { statusCode: 403, op: 'PUT /playlists/.../tracks' });
    sessionPlaylist.writeSessionPlaylist.mockRejectedValue(err403);

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState());

    expect(sessionPlaylist.writeSessionPlaylist).toHaveBeenCalledTimes(1);
    // The playlist is still delivered — a 403 on the session-playlist write must NEVER fail generation.
    const ready = socket.emit.mock.calls.find((c) => c[0] === 'playlist_ready');
    expect(ready).toBeTruthy();
    expect(socket.emit).not.toHaveBeenCalledWith('playlist_error', expect.anything());
    // …and the client falls back to loose track URIs — no contextUri attached.
    expect(ready[1]).not.toHaveProperty('contextUri');
    expect(ready[1].tracks.length).toBeGreaterThanOrEqual(2);
  });

  it('does NOT call writeSessionPlaylist and attaches no contextUri when fewer than 2 track URIs exist', async () => {
    // A single-track playlist: a context buys nothing for 0-1 tracks, so the write is skipped.
    const solo = { id: 'solo', name: 'Solo' };
    orchestrator.generateV2.mockResolvedValueOnce({
      familiar: [solo], discovery: [], merged: [solo],
      telemetry: { stageMs: {} }, targets: { bpmCenter: 120 },
    });

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState());

    expect(sessionPlaylist.writeSessionPlaylist).not.toHaveBeenCalled();
    const ready = socket.emit.mock.calls.find((c) => c[0] === 'playlist_ready');
    expect(ready).toBeTruthy();
    expect(ready[1].tracks).toHaveLength(1);
    expect(ready[1]).not.toHaveProperty('contextUri');
  });
});
