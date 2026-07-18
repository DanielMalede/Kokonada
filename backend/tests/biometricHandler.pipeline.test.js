'use strict';

process.env.NODE_ENV       = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET     = 'test-jwt-secret-for-tests-only';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../app/models/User', () => ({
  findById: jest.fn(),
}));

jest.mock('../app/models/MusicProfile', () => ({
  findOne: jest.fn(),
}));

jest.mock('../app/models/BiometricLog', () => ({
  find: jest.fn(),
}));

jest.mock('../app/models/PlaylistSession', () => ({
  create:         jest.fn().mockResolvedValue({}),
  find:           jest.fn(),
  countDocuments: jest.fn().mockResolvedValue(0),
}));

jest.mock('../app/models/MedicalProfile', () => ({
  findOne: jest.fn().mockResolvedValue(null),
}));
jest.mock('../app/utils/biometricAudit', () => ({
  logBiometricAccess: jest.fn(),
  auditedDecrypt: jest.fn(),
}));

jest.mock('../app/services/spotify', () => ({
  getValidToken:        jest.fn(),
  getRecommendations:   jest.fn(),
  fetchVibeDiscovery:   jest.fn(),
  getArtistsGenres:     jest.fn(),
  artistGenresAvailable: jest.fn(() => true),
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
  personalizeWhitelist: jest.fn(),
  generateFallbackPlaylist: jest.fn().mockReturnValue([{ id: 'lib-1' }, { id: 'lib-2' }]),
}));

jest.mock('../app/services/features/featureService', () => ({
  hydrate: jest.fn(),
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

// Error monitor — mocked so a test can assert a swallowed generateV2 failure is reported (captured),
// not silently dropped. The real captureException is a no-op without a DSN, so this changes no behavior.
jest.mock('../app/config/sentry', () => ({
  initSentry:       jest.fn(),
  getSentry:        jest.fn(() => null),
  captureException: jest.fn(),
  scrubEvent:       jest.fn((e) => e),
}));

// Cross-platform translation (serve-time Spotify playback resolution). ONLY translateToSpotify is
// mocked so a test can drive a youtube→spotify resolution deterministically; the pure helpers
// (cleanYouTubeArtist / parseYouTubeTitle) stay REAL because trackIdentity.canonicalKey depends on
// them. Default = passthrough of the input tracks, which matches the real service's effective
// behavior for the native-Spotify fixtures the other tests use (their searchTrackUri is unmocked →
// every lookup misses → merged is left unchanged).
jest.mock('../app/services/crossPlatform', () => ({
  ...jest.requireActual('../app/services/crossPlatform'),
  translateToSpotify: jest.fn(async (tracks) => ({ tracks, translated: 0, missed: 0 })),
}));

// The anonymous, cross-user discovery catalog. Mocked so a test can assert the serve path NEVER
// caches a resolved spotify: URI back onto it (ADR-0011 containment / ADR-0010 Discovery ⊥ Resolver).
jest.mock('../app/repositories/trackCatalogRepo', () => ({
  updateResolvedUris:    jest.fn(async () => ({ updated: 0 })),
  invalidateResolvedUri: jest.fn(async () => ({ invalidated: false })),
  upsertMany:            jest.fn(async () => ({ upserted: 0 })),
  getMany:               jest.fn(async () => new Map()),
}));

jest.mock('../app/services/wearable/adapter', () => ({
  normalize: jest.fn((source, raw) => {
    const KNOWN = ['garmin', 'apple_watch', 'fitbit'];
    if (!KNOWN.includes(source)) throw new Error(`Unknown wearable source: ${source}`);
    const ACTIVITY_MAP = { 0: 'resting', 1: 'running', 2: 'cycling', 5: 'swimming', 6: 'walking', 13: 'strength_training' };
    return {
      heartRate: raw.heartRate,
      activity:  raw.activity || ACTIVITY_MAP[raw.activityType] || 'running',
      source,
    };
  }),
}));

// Art.9 consent gate for the socket biometric_push path (audit H-9 follow-up) — default granted so
// the pipeline tests are transparent to the gate; also keeps the real (mongoose) consent service out.
jest.mock('../app/services/privacy/consent', () => ({
  getConsentStatus:       jest.fn().mockResolvedValue({ granted: true, currentVersion: 1, staleVersion: false }),
  HEALTH_CONSENT_PURPOSE: 'health_biometric_processing',
}));

const User            = require('../app/models/User');
const MusicProfile    = require('../app/models/MusicProfile');
const BiometricLog    = require('../app/models/BiometricLog');
const MedicalProfile  = require('../app/models/MedicalProfile');
const { logBiometricAccess } = require('../app/utils/biometricAudit');
const PlaylistSession = require('../app/models/PlaylistSession');
const spotify         = require('../app/services/spotify');
const youtube         = require('../app/services/youtube');
const geminiEngine    = require('../app/services/geminiEngine');
const playlistMixer   = require('../app/services/playlistMixer');

const shadowBufferRepo = require('../app/repositories/shadowBufferRepo');
const captionService   = require('../app/services/discovery/captionService');
const crossPlatform    = require('../app/services/crossPlatform');
const trackCatalogRepo = require('../app/repositories/trackCatalogRepo');

const {
  registerBiometricHandler,
  generateAndEmitPlaylist,
  recalibrateForBand,
  resolveBiometricContext,
  _debounceMap,
} = require('../app/sockets/biometricHandler');

// ── Fixtures ───────────────────────────────────────────────────────────────────

function makeMusicProfile(overrides = {}) {
  return {
    userId: 'user-123',
    restingHeartRate: 60,
    tempoBaseline: 120,
    energy: 0.6,
    valence: 0.5,
    topGenres: ['pop', 'electronic'],
    topArtists: ['Artist A'],
    genreSet: ['pop', 'electronic'],
    knownArtistIds: ['artist-a'],
    library: [
      { id: 'lib-1', provider: 'spotify', tempo: 120, energy: 0.6, valence: 0.5, acousticness: 0.2, genres: ['pop'], artist: 'Artist A' },
      { id: 'lib-2', provider: 'spotify', tempo: 125, energy: 0.65, valence: 0.55, acousticness: 0.15, genres: ['electronic'], artist: 'Artist B' },
    ],
    ...overrides,
  };
}

// MusicProfile.findOne returns a Mongoose Query: it is awaited directly in the
// HR-resolver path and chained .lean() in the generation path (the .lean() keeps
// hydrated subdocuments out of candidatePool's JSON.stringify → prevents the heap
// OOM). This stub honours both usages, mirroring a real Query.
function musicProfileQuery(value) {
  const query = Promise.resolve(value);
  query.lean = () => Promise.resolve(value);
  return query;
}

const SPOTIFY_USER = {
  _id: 'user-123',
  spotifyToken:      { blob: 'encrypted-spotify' },
  youtubeMusicToken: null,
  getToken: jest.fn(),
  save:     jest.fn().mockResolvedValue(true),
};

const YOUTUBE_USER = {
  _id: 'user-123',
  spotifyToken:      null,
  youtubeMusicToken: { blob: 'encrypted-youtube' },
  getToken: jest.fn(),
  save:     jest.fn().mockResolvedValue(true),
};

const BOTH_PROVIDERS_USER = {
  _id: 'user-123',
  spotifyToken:      { blob: 'encrypted-spotify' },
  youtubeMusicToken: { blob: 'encrypted-youtube' },
  getToken: jest.fn(),
  save:     jest.fn().mockResolvedValue(true),
};

const AI_PARAMS = {
  target_bpm: 128, target_energy: 0.8, target_valence: 0.7,
  target_acousticness: 0.1, seed_genres: ['electronic'], seed_artists: [],
};

const DISCOVERY_TRACKS = [
  { id: 'd1', name: 'Discovery 1' },
  { id: 'd2', name: 'Discovery 2' },
];

const FAMILIAR_TRACKS  = [{ id: 'lib-1', name: 'Familiar 1' }];
const MERGED_TRACKS    = [...FAMILIAR_TRACKS, ...DISCOVERY_TRACKS];

function makeMixedPlaylist() {
  return { familiar: FAMILIAR_TRACKS, discovery: DISCOVERY_TRACKS, merged: MERGED_TRACKS };
}

// ── Socket mock ────────────────────────────────────────────────────────────────

function makeSocket(userId = 'user-123') {
  const handlers = {};
  return {
    id: `socket-${userId}-${Math.random()}`,
    data: { user: { _id: userId } },
    emit: jest.fn(),
    on:   (event, fn) => { handlers[event] = fn; },
    _trigger: (event, payload) => handlers[event]?.(payload),
  };
}

// ── State helper (mirrors biometricHandler internal state shape) ───────────────

function makeState(overrides = {}) {
  return {
    stableHR:         80,
    pendingHR:        null,
    latestActivity:   'running',
    timer:            null,
    consecutiveSkips: 0,
    lastEmotionTaps:  [],
    lastTextPrompt:   '',
    ...overrides,
  };
}

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();

  User.findById.mockResolvedValue(SPOTIFY_USER);
  MusicProfile.findOne.mockReturnValue(musicProfileQuery(makeMusicProfile()));
  spotify.getValidToken.mockResolvedValue('spotify-access-token');
  spotify.getRecommendations.mockResolvedValue(DISCOVERY_TRACKS);
  spotify.fetchVibeDiscovery.mockResolvedValue(DISCOVERY_TRACKS);
  spotify.getArtistsGenres.mockResolvedValue({});
  geminiEngine.adjustBiometricPlaylist.mockResolvedValue({ params: AI_PARAMS, tracks: DISCOVERY_TRACKS });
  geminiEngine.buildEmotionPlaylist.mockResolvedValue({ params: AI_PARAMS, tracks: DISCOVERY_TRACKS });
  geminiEngine.critiqueTrackVibe.mockImplementation(async ({ tracks }) => tracks);
  playlistMixer.personalizeWhitelist.mockImplementation((tracks) => tracks);
  BiometricLog.find.mockReturnValue({ sort: () => ({ limit: () => Promise.resolve([]) }) });
  PlaylistSession.countDocuments.mockResolvedValue(0); // default: no repeat → normal mode
  MedicalProfile.findOne.mockResolvedValue(null);
  shadowBufferRepo.getBuffer.mockResolvedValue(null); // default: cold buffer
  shadowBufferRepo.setBuffer.mockResolvedValue(true);
  captionService.captionDiscovery.mockResolvedValue(new Map());
  delete process.env.DISCOVERY_CAPTION_LLM; // caption path OFF by default (dark launch)
  mockRecentSessions([]);
});

function mockBiometricLogs(logs) {
  BiometricLog.find.mockReturnValue({ sort: () => ({ limit: () => Promise.resolve(logs) }) });
}

// Chainable session-query mock supporting BOTH cooldown reads:
//   recentTrackCooldown: find().sort().limit().select().lean()
//   recentMoodCooldown:  find().sort().select().lean()  (no .limit())
function mockRecentSessions(sessions) {
  const chain = {
    sort:   () => chain,
    limit:  () => chain,
    select: () => chain,
    lean:   () => Promise.resolve(sessions),
  };
  PlaylistSession.find.mockReturnValue(chain);
}

// ── toClientTrack — mix-receipt (Wave 2.8 payload; cover now sourced from the SDK) ──

describe('toClientTrack — receipt (no imageUrl)', () => {
  const { toClientTrack } = require('../app/sockets/biometricHandler');

  it('does NOT attach an imageUrl field — the Now Playing cover is resolved client-side from the App Remote SDK', () => {
    const t = {
      id: 's1', uri: 'spotify:track:s1', name: 'Song', artists: [{ name: 'A' }],
      album: { images: [{ url: 'https://img/cover', width: 640 }, { url: 'https://img/small', width: 64 }] },
    };
    const c = toClientTrack(t, 'spotify', { trigger: 'emotion', params: { target_bpm: 128 } });
    expect(c).not.toHaveProperty('imageUrl');
  });

  it('receipt.label is "New discovery" for a discovery track and "Familiar favorite" otherwise', () => {
    const disc = toClientTrack({ id: 'd1', uri: 'spotify:track:d1', isDiscovery: true }, 'spotify', { trigger: 'emotion' });
    const fam  = toClientTrack({ id: 'f1', uri: 'spotify:track:f1' }, 'spotify', { trigger: 'emotion' });
    expect(disc.receipt.label).toBe('New discovery');
    expect(fam.receipt.label).toBe('Familiar favorite');
  });

  it('receipt.detail reflects the mood trigger and the target BPM from aiResult.params', () => {
    const c = toClientTrack({ id: 'x', uri: 'spotify:track:x' }, 'spotify', { trigger: 'emotion', params: { target_bpm: 128 } });
    expect(c.receipt.detail).toContain('mood');
    expect(c.receipt.detail).toContain('128');
  });

  it('receipt.detail reflects a heart/biometric trigger', () => {
    const c = toClientTrack({ id: 'y', uri: 'spotify:track:y' }, 'spotify', { trigger: 'biometric', params: { target_bpm: 96 } });
    expect(c.receipt.detail).toContain('heart');
  });
});

// ── toClientTrack — recordingKey passthrough (Phase 2 self-heal reporting) ──
// A discovery track carries its native recordingKey (youtube:<id>) so the client can
// report a playback failure for THAT catalog entry; a familiar track has none → null.

describe('toClientTrack — recordingKey passthrough', () => {
  const { toClientTrack } = require('../app/sockets/biometricHandler');

  it('carries a discovery track\'s recordingKey through to the client payload', () => {
    const c = toClientTrack({ id: 'd1', uri: 'spotify:track:d1', recordingKey: 'youtube:abc', isDiscovery: true }, 'spotify', { trigger: 'emotion' });
    expect(c.recordingKey).toBe('youtube:abc');
  });

  it('emits recordingKey:null for a familiar track that has none', () => {
    const c = toClientTrack({ id: 'f1', uri: 'spotify:track:f1' }, 'spotify', { trigger: 'emotion' });
    expect(c.recordingKey).toBeNull();
  });
});

// ── buildReceipt — discovery caption ─────────────────────────────────────────
// A DISCOVERY track carrying an LLM caption emits receipt.caption. The deterministic
// anchor is GONE (Step 4) — a stray anchor field is never surfaced. Familiar tracks never get a caption.

describe('toClientTrack — receipt.caption (discovery caption)', () => {
  const { toClientTrack } = require('../app/sockets/biometricHandler');

  it('emits receipt.caption for a discovery track that carries a caption', () => {
    const c = toClientTrack(
      { id: 'd1', uri: 'spotify:track:d1', isDiscovery: true, caption: 'A slow, smoky burner' },
      'spotify', { trigger: 'emotion' });
    expect(c.receipt.caption).toBe('A slow, smoky burner');
  });

  it('trims the caption and omits an empty/whitespace one', () => {
    const c = toClientTrack(
      { id: 'd1', uri: 'spotify:track:d1', isDiscovery: true, caption: '   ' },
      'spotify', { trigger: 'emotion' });
    expect(c.receipt).not.toHaveProperty('caption');
  });

  it('never emits an anchor: a discovery track carrying a legacy anchor field surfaces only the caption', () => {
    const c = toClientTrack(
      { id: 'd1', uri: 'spotify:track:d1', isDiscovery: true, caption: 'Bright and driving', anchor: { title: 'Song', artist: 'Someone' } },
      'spotify', { trigger: 'emotion' });
    expect(c.receipt.caption).toBe('Bright and driving');
    expect(c.receipt).not.toHaveProperty('anchor');
  });

  it('a familiar track never receives a caption even if one is set', () => {
    const c = toClientTrack(
      { id: 'f1', uri: 'spotify:track:f1', caption: 'should be ignored' },
      'spotify', { trigger: 'emotion' });
    expect(c.receipt).not.toHaveProperty('caption');
  });
});

// ── toClientTrack — Spotify-URI reconstruction guard (recordingKey-shaped ids) ──
// The URI rebuild must fire ONLY from a bare track id. A discovery candidate carries an
// `id` = the FULL recordingKey (spotify:<trackId>) — already colon-bearing; rebuilding it
// would mint a malformed `spotify:track:spotify:<trackId>`. The guard drops it to null.

describe('toClientTrack — Spotify-URI reconstruction guard (recordingKey-shaped ids)', () => {
  const { toClientTrack } = require('../app/sockets/biometricHandler');

  it('drops a colon-bearing id with no uri instead of minting spotify:track:spotify:<id>', () => {
    const c = toClientTrack({ id: 'spotify:abc', provider: 'spotify' }, 'spotify', { trigger: 'emotion' });
    expect(c).toBeNull();
  });

  it('still reconstructs spotify:track:<id> from a normal bare id with no uri (regression)', () => {
    const c = toClientTrack({ id: 'abc' }, 'spotify', { trigger: 'emotion' });
    expect(c).toMatchObject({ id: 'abc', uri: 'spotify:track:abc' });
  });
});

// ── generateAndEmitPlaylist — biometric trigger ───────────────────────────────

describe('generateAndEmitPlaylist — biometric trigger', () => {
  it('calls adjustBiometricPlaylist with musicProfile and heartRate', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState({ stableHR: 95 }));

    expect(geminiEngine.adjustBiometricPlaylist).toHaveBeenCalledWith(
      expect.objectContaining({
        musicProfile: expect.objectContaining({ userId: 'user-123' }),
        biometric:    expect.objectContaining({ heartRate: 95 }),
        fetchTracks:  expect.any(Function),
      })
    );
  });

  it('emits playlist_ready with normalized merged tracks and trigger=biometric', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState());

    const call = socket.emit.mock.calls.find(c => c[0] === 'playlist_ready');
    expect(call[1].trigger).toBe('biometric');
    expect(call[1].tracks).toHaveLength(MERGED_TRACKS.length);
    // Library/discovery fixtures carry only id+name; the pipeline reconstructs the
    // Spotify uri from the id and maps name → title.
    expect(call[1].tracks[0]).toMatchObject({ id: 'lib-1', uri: 'spotify:track:lib-1', title: 'Familiar 1' });
    expect(call[1].tracks.every(t => typeof t.uri === 'string')).toBe(true);
  });

  it('every emitted track carries a real mix-receipt and NO imageUrl (cover comes from the SDK player state)', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({ lastEmotionTaps: [{ x: 0.1, y: 0.95 }] }));

    const call = socket.emit.mock.calls.find(c => c[0] === 'playlist_ready');
    // No Web-API album-art fetch happens at all — the dead /v1/tracks path is gone.
    expect(spotify.getTracksByIds).toBeUndefined();
    // Every emitted track carries a mix-receipt derived from real signals (isDiscovery + trigger/params)…
    expect(call[1].tracks.every(t => t.receipt && typeof t.receipt.label === 'string')).toBe(true);
    expect(call[1].tracks[0].receipt.detail).toContain('mood');
    // …and none carries an imageUrl — the cover is resolved on-device from App Remote.
    expect(call[1].tracks.every(t => !('imageUrl' in t))).toBe(true);
  });

  it('passes familiar and discovery counts in playlist_ready', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState());

    expect(socket.emit).toHaveBeenCalledWith('playlist_ready', expect.objectContaining({
      familiar:  FAMILIAR_TRACKS.length,
      discovery: DISCOVERY_TRACKS.length,
    }));
  });

  it('routes generation through orchestrator.generateV2 with the LLM aiParams (the flip)', async () => {
    const orchestrator = require('../app/services/generation/orchestrator');
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState());

    expect(orchestrator.generateV2).toHaveBeenCalledWith(
      expect.objectContaining({ aiParams: AI_PARAMS })
    );

  });

  it('passes crossPlatform=true to generateV2 when playing on Spotify with a token (familiar YouTube tracks get translated, not dropped)', async () => {
    const orchestrator = require('../app/services/generation/orchestrator');
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState());

    expect(orchestrator.generateV2).toHaveBeenCalledWith(
      expect.objectContaining({ crossPlatform: true })
    );
  });

  it('uses Spotify provider when user has Spotify token', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState());

    expect(spotify.getValidToken).toHaveBeenCalled();
    expect(youtube.getValidToken).not.toHaveBeenCalled();
  });
});

// ── generateAndEmitPlaylist — Spotify resolver never recontaminates the catalog ─
// A Spotify-connected user's serve-time translation resolves youtube: discovery tracks to playable
// spotify: URIs for THIS playback (correct, and must stay). That resolution is per-user + market-
// specific and must NEVER be written back onto the anonymous cross-user TrackCatalog: persisting a
// resolved spotify: URI re-introduces Spotify Content into the shared corpus (ADR-0011 containment /
// ADR-0010 Discovery ⊥ Runtime-Resolver), where the leak monitor counts it and the purge deletes the
// whole row. youtube: discovery tracks therefore re-resolve on every serve, exactly like mbid: ones.
describe('generateAndEmitPlaylist — Spotify resolver never caches resolved URIs back to the catalog', () => {
  it('does NOT call trackCatalogRepo.updateResolvedUris even when translation resolves a youtube: track to a spotify: URI', async () => {
    const orchestrator = require('../app/services/generation/orchestrator');
    // Discovery track keyed by a native youtube: recordingKey — the exact shape whose serve-time
    // resolution the old code cached back onto the anonymous catalog. generateV2 returns it as merged.
    const ytDiscovery = { id: 'd1', uri: 'youtube:d1', recordingKey: 'youtube:d1', isDiscovery: true, name: 'Disc 1' };
    orchestrator.generateV2.mockResolvedValueOnce({
      familiar: [], discovery: [ytDiscovery], merged: [ytDiscovery],
      telemetry: { stageMs: {} }, targets: { bpmCenter: 120 },
    });
    // The (mocked) translation resolves the youtube: track to a playable, market-specific spotify: URI —
    // precisely the value the removed cache-back wrote onto the shared youtube: catalog row.
    crossPlatform.translateToSpotify.mockResolvedValueOnce({
      tracks: [{ ...ytDiscovery, uri: 'spotify:track:resolved1', provider: 'spotify', translatedFrom: 'youtube' }],
      translated: 1, missed: 0,
    });

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState());

    // Playback still resolves (a spotify: URI reaches the client) — the resolver itself is untouched …
    const ready = socket.emit.mock.calls.find(c => c[0] === 'playlist_ready');
    expect(ready).toBeTruthy();
    expect(ready[1].tracks[0].uri).toBe('spotify:track:resolved1');
    // … but the resolved URI is NEVER written back to the cross-user catalog (the containment guarantee).
    expect(trackCatalogRepo.updateResolvedUris).not.toHaveBeenCalled();
  });
});

// ── generateAndEmitPlaylist — emotion trigger ─────────────────────────────────

describe('generateAndEmitPlaylist — emotion trigger', () => {
  it('calls buildEmotionPlaylist with stored taps and textPrompt', async () => {
    const socket = makeSocket();
    const taps = [{ x: 0.2, y: 0.7 }, { x: -0.3, y: 0.5 }];
    await generateAndEmitPlaylist(socket, 'emotion', makeState({
      lastEmotionTaps: taps,
      lastTextPrompt:  'Focus music',
    }));

    expect(geminiEngine.buildEmotionPlaylist).toHaveBeenCalledWith(
      expect.objectContaining({
        musicProfile: expect.objectContaining({ userId: 'user-123' }),
        emotionTaps:  taps,
        textPrompt:   'Focus music',
        fetchTracks:  expect.any(Function),
      })
    );
  });

  it('emits playlist_ready with trigger=emotion and normalized tracks', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({
      lastEmotionTaps: [{ x: 0.5, y: 0.5 }],
    }));

    const call = socket.emit.mock.calls.find(c => c[0] === 'playlist_ready');
    expect(call[1].trigger).toBe('emotion');
    expect(call[1].tracks).toHaveLength(MERGED_TRACKS.length);
    expect(call[1].tracks.every(t => typeof t.uri === 'string')).toBe(true);
  });

  it('falls back to adjustBiometricPlaylist when emotion taps are empty', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({ lastEmotionTaps: [] }));

    expect(geminiEngine.adjustBiometricPlaylist).toHaveBeenCalled();
    expect(geminiEngine.buildEmotionPlaylist).not.toHaveBeenCalled();
  });

  it('passes the selected activity through to buildEmotionPlaylist', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({
      lastEmotionTaps: [{ x: 0.5, y: 0.5 }],
      lastActivity:    'Running',
    }));

    expect(geminiEngine.buildEmotionPlaylist).toHaveBeenCalledWith(
      expect.objectContaining({ activity: 'Running' })
    );
  });

  it('routes an activity-only request (no taps, no text) to the emotion pipeline', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({
      lastEmotionTaps: [],
      lastTextPrompt:  '',
      lastActivity:    'Cooking',
    }));

    expect(geminiEngine.buildEmotionPlaylist).toHaveBeenCalled();
    expect(geminiEngine.adjustBiometricPlaylist).not.toHaveBeenCalled();
  });

  it('passes a 24h biometric snapshot to buildEmotionPlaylist when a MedicalProfile exists', async () => {
    MedicalProfile.findOne.mockResolvedValue({
      restingHeartRate: 58, hrv: 22, bodyBattery: 70, dailyReadiness: 65,
      spO2: 98, respirationRate: 14, sleepStages: { deep: 50, light: 210, rem: 70 },
    });
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({
      lastEmotionTaps: [{ x: 0.5, y: 0.5 }],
      stableHR:        88,
    }));

    const arg = geminiEngine.buildEmotionPlaylist.mock.calls.at(-1)[0];
    expect(arg.biometricContext).toMatchObject({
      restingHeartRate: 58, heartRate: 88, bodyBattery: 70,
    });
  });

  it('passes biometricContext=null when the user has no MedicalProfile', async () => {
    MedicalProfile.findOne.mockResolvedValue(null);
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({
      lastEmotionTaps: [{ x: 0.5, y: 0.5 }],
    }));

    const arg = geminiEngine.buildEmotionPlaylist.mock.calls.at(-1)[0];
    expect(arg.biometricContext).toBeNull();
  });
});

// ── generateAndEmitPlaylist — discovery captions wiring (Step 2) ──────────────

describe('generateAndEmitPlaylist — discovery captions wiring', () => {
  const orchestrator = require('../app/services/generation/orchestrator');

  // A selection result whose discovery tracks carry the fields the caption path needs
  // (isDiscovery + recordingKey + features) and playable spotify: URIs (so the crossPlatform
  // pass-through preserves the same objects and the caption survives to the payload).
  function mockPlaylistWithDiscovery() {
    const familiar  = [{ id: 'lib-1', uri: 'spotify:track:lib-1' }];
    const discovery = [
      { id: 'd1', uri: 'spotify:track:d1', isDiscovery: true, recordingKey: 'youtube:d1', features: { bpm: 92, energy: 0.4, valence: 0.3 } },
      { id: 'd2', uri: 'spotify:track:d2', isDiscovery: true, recordingKey: 'youtube:d2', features: { bpm: 128, energy: 0.8, valence: 0.7 } },
    ];
    orchestrator.generateV2.mockResolvedValueOnce({
      familiar, discovery, merged: [...familiar, ...discovery],
      telemetry: { stageMs: {} }, targets: { bpmCenter: 100 },
    });
  }

  it('FLAG ON: attaches captions to the discovery tracks in the emitted payload; familiar tracks get none', async () => {
    process.env.DISCOVERY_CAPTION_LLM = 'true';
    mockPlaylistWithDiscovery();
    captionService.captionDiscovery.mockResolvedValue(new Map([
      ['youtube:d1', 'A slow burner your calm needed'],
      ['youtube:d2', 'Bright, driving, wide awake'],
    ]));

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({ lastEmotionTaps: [{ x: 0.1, y: 0.95 }] }));

    expect(captionService.captionDiscovery).toHaveBeenCalledTimes(1);
    const call = socket.emit.mock.calls.find(c => c[0] === 'playlist_ready');
    const byId = Object.fromEntries(call[1].tracks.map(t => [t.id, t]));
    expect(byId.d1.receipt.caption).toBe('A slow burner your calm needed');
    expect(byId.d2.receipt.caption).toBe('Bright, driving, wide awake');
    expect(byId['lib-1'].receipt).not.toHaveProperty('caption');
  });

  it('FLAG ON: passes ONLY features + first-party session context to the caption service', async () => {
    process.env.DISCOVERY_CAPTION_LLM = 'true';
    mockPlaylistWithDiscovery();

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({ lastEmotionTaps: [{ x: 0.1, y: 0.95 }], stableHR: 150, latestActivity: 'running' }));

    const [tracksArg, ctxArg] = captionService.captionDiscovery.mock.calls[0];
    expect(tracksArg.every(t => t.features && t.recordingKey)).toBe(true);
    expect(ctxArg).toEqual(expect.objectContaining({
      moodKey: expect.any(String),
      hrBand:  expect.any(String),
      activity: 'running',
    }));
  });

  it('FLAG OFF (default dark launch): never calls the caption service and emits no captions', async () => {
    mockPlaylistWithDiscovery();

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({ lastEmotionTaps: [{ x: 0.1, y: 0.95 }] }));

    expect(captionService.captionDiscovery).not.toHaveBeenCalled();
    const call = socket.emit.mock.calls.find(c => c[0] === 'playlist_ready');
    expect(call[1].tracks.every(t => !(t.receipt && 'caption' in t.receipt))).toBe(true);
  });

  it('FLAG ON: a caption-service failure never blocks generation — playlist_ready still emits', async () => {
    process.env.DISCOVERY_CAPTION_LLM = 'true';
    mockPlaylistWithDiscovery();
    captionService.captionDiscovery.mockRejectedValueOnce(new Error('caption boom'));

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({ lastEmotionTaps: [{ x: 0.1, y: 0.95 }] }));

    expect(socket.emit).toHaveBeenCalledWith('playlist_ready', expect.anything());
    expect(socket.emit).not.toHaveBeenCalledWith('playlist_error', expect.anything());
  });
});

// ── emotion_update handler — activity capture ─────────────────────────────────

describe('emotion_update handler', () => {
  it('caches the selected activity on socket state', () => {
    const socket = makeSocket();
    registerBiometricHandler(socket);
    socket._trigger('emotion_update', { taps: [{ x: 0.5, y: 0.5 }], textPrompt: 'x', activity: 'Cooking' });

    expect(_debounceMap.get(socket.id).lastActivity).toBe('Cooking');
  });

  it('normalizes a missing activity to null', () => {
    const socket = makeSocket();
    registerBiometricHandler(socket);
    socket._trigger('emotion_update', { taps: [], textPrompt: '' });

    expect(_debounceMap.get(socket.id).lastActivity).toBeNull();
  });
});

// ── resolveBiometricContext ───────────────────────────────────────────────────

describe('resolveBiometricContext', () => {
  it('returns a structured snapshot with a computed state label and HR ratio', async () => {
    MedicalProfile.findOne.mockResolvedValue({
      restingHeartRate: 60, hrv: 15, bodyBattery: 30, dailyReadiness: 40,
      spO2: 97, respirationRate: 22, sleepStages: { deep: 30, light: 180, rem: 50 },
    });

    const ctx = await resolveBiometricContext('user-123', 95);
    expect(ctx).toMatchObject({ heartRate: 95, restingHeartRate: 60, hrv: 15, bodyBattery: 30 });
    expect(ctx.hrRatio).toBeCloseTo(1.58, 2);
    expect(typeof ctx.stateLabel).toBe('string');
    expect(ctx.sleep).toEqual({ deep: 30, light: 180, rem: 50 });
  });

  it('returns null when the user has no MedicalProfile', async () => {
    MedicalProfile.findOne.mockResolvedValue(null);
    expect(await resolveBiometricContext('user-123', 80)).toBeNull();
  });

  it('returns null when the profile carries no usable scalar signal', async () => {
    MedicalProfile.findOne.mockResolvedValue({
      restingHeartRate: null, hrv: null, bodyBattery: null, dailyReadiness: null,
      spO2: null, respirationRate: null, sleepStages: { deep: null, light: null, rem: null },
    });
    expect(await resolveBiometricContext('user-123', 80)).toBeNull();
  });

  it('degrades to null when the MedicalProfile query throws', async () => {
    MedicalProfile.findOne.mockRejectedValue(new Error('db down'));
    expect(await resolveBiometricContext('user-123', 80)).toBeNull();
  });
});

// ── generateAndEmitPlaylist — skip_loop trigger ───────────────────────────────

describe('generateAndEmitPlaylist — skip_loop trigger', () => {
  it('emits playlist_ready with trigger=skip_loop', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'skip_loop', makeState());

    expect(socket.emit).toHaveBeenCalledWith('playlist_ready', expect.objectContaining({
      trigger: 'skip_loop',
    }));
  });

  it('calls adjustBiometricPlaylist (not emotion pipeline) on skip', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'skip_loop', makeState({ lastEmotionTaps: [] }));

    expect(geminiEngine.adjustBiometricPlaylist).toHaveBeenCalled();
    expect(geminiEngine.buildEmotionPlaylist).not.toHaveBeenCalled();
  });
});

// ── Provider selection ────────────────────────────────────────────────────────

describe('provider selection', () => {
  it('prefers Spotify over YouTube when both are connected', async () => {
    User.findById.mockResolvedValue(BOTH_PROVIDERS_USER);
    spotify.getValidToken.mockResolvedValue('spotify-token');

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState());

    expect(spotify.getValidToken).toHaveBeenCalled();
    expect(youtube.getValidToken).not.toHaveBeenCalled();
  });

  it('uses YouTube when only YouTube is connected', async () => {
    User.findById.mockResolvedValue(YOUTUBE_USER);
    youtube.getValidToken.mockResolvedValue('youtube-token');
    youtube.searchRecommendations.mockResolvedValue(DISCOVERY_TRACKS);
    geminiEngine.adjustBiometricPlaylist.mockResolvedValue({ params: AI_PARAMS, tracks: DISCOVERY_TRACKS });

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState());

    expect(youtube.getValidToken).toHaveBeenCalled();
    expect(spotify.getValidToken).not.toHaveBeenCalled();
  });
});

// ── YouTube-only user: discovery is short-circuited (guaranteed-empty), familiar-only served ──
// A YouTube-only account has no playback sink (Spotify is the only playback engine) and the shared
// mbid corpus resolves rows to SPOTIFY URIs only (its youtube: rows were removed for ToS containment,
// #151), so a discovery candidate can NEVER be playable for such a user. The generation path now
// short-circuits BEFORE the LLM + vector query (see the "no-playback short-circuit" suite) and builds
// familiar-only via generateV2 with zero discovery input. This pins the graceful-degradation property:
// an empty discovery pool + a deliverable library still yields a familiar-only playlist_ready, never a
// playlist_error, and never a per-generation search.list.
describe('YouTube-only discovery — short-circuit to familiar-only, no search.list', () => {
  const orchestrator = require('../app/services/generation/orchestrator');
  const { vectorDiscoveryFetch } = require('../app/services/discovery/discoveryFetch');
  // Captured at collection time (factory defaults) — global beforeEach never re-establishes
  // generateV2/vectorDiscoveryFetch implementations, so restore them so this block's passthrough
  // overrides don't leak into later tests.
  const DEFAULT_GEN_V2  = orchestrator.generateV2.getMockImplementation();
  const DEFAULT_VDF     = vectorDiscoveryFetch.getMockImplementation();

  beforeEach(() => {
    User.findById.mockResolvedValue(YOUTUBE_USER);
    youtube.getValidToken.mockResolvedValue('youtube-token');
  });

  afterEach(() => {
    orchestrator.generateV2.mockImplementation(DEFAULT_GEN_V2);
    vectorDiscoveryFetch.mockImplementation(DEFAULT_VDF);
  });

  it('graceful degradation: empty discovery + deliverable library ⇒ playlist_ready (familiar-only), never playlist_error', async () => {
    vectorDiscoveryFetch.mockResolvedValue([]); // corpus yields nothing playable
    const famYt = { id: 'lib-yt-1', uri: 'youtube:libyt1', name: 'Familiar YT', artist: 'A', provider: 'youtube_music' };
    orchestrator.generateV2.mockImplementation(async ({ discoveryTracks }) => {
      const d = Array.isArray(discoveryTracks) ? discoveryTracks : [];
      return { familiar: [famYt], discovery: d, merged: [famYt, ...d], telemetry: { poolSize: 1, afterFilters: 1, relaxLevel: 0, stageMs: { total: 5 } }, targets: { bpmCenter: 120 } };
    });

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState());

    expect(socket.emit).toHaveBeenCalledWith('playlist_ready', expect.objectContaining({ discovery: 0 }));
    expect(socket.emit).not.toHaveBeenCalledWith('playlist_error', expect.anything());
    expect(youtube.searchRecommendations).not.toHaveBeenCalled(); // no per-generation search.list
  });
});

// ── YouTube-only user — no playable provider (explicit, actionable failure) ────
// Playback is Spotify-only (native App Remote; no client has a YouTube player). A
// YouTube-only account (no Spotify token) resolves provider='youtube', so every
// familiar library entry (youtube_music, uri:null) drops at the client contract in
// toClientTracks (Spotify-URI reconstruction is gated on provider==='spotify') →
// clientTracks is empty. The OLD behaviour surfaced the generic "try again" (or a raw
// error message), which is misleading — retrying can NEVER help. These pin the fix:
// a distinct NO_PLAYABLE_PROVIDER reason + a calm, actionable Connect-Spotify message,
// while a genuine empty for a user WITH a playback engine keeps its existing handling.
describe('YouTube-only user — no playable provider surfaces a clear, actionable message', () => {
  const orchestrator = require('../app/services/generation/orchestrator');

  it('MAIN PATH: an empty playlist (whole uri:null library dropped) emits NO_PLAYABLE_PROVIDER + a calm Connect-Spotify message, not a generic "try again"', async () => {
    User.findById.mockResolvedValue(YOUTUBE_USER);
    youtube.getValidToken.mockResolvedValue('youtube-token');
    // Real-world familiar library: youtube_music entries stored WITHOUT a uri (the id is a
    // YouTube video id). generateV2 returns them as `merged`; toClientTracks drops every one
    // because provider==='youtube' → the Spotify-URI reconstruction never fires → empty.
    const famNoUri = { id: 'yt-vid-1', provider: 'youtube_music', name: 'Familiar YT', artist: 'A' };
    orchestrator.generateV2.mockResolvedValueOnce({
      familiar: [famNoUri], discovery: [], merged: [famNoUri],
      telemetry: { stageMs: {} }, targets: { bpmCenter: 120 },
    });

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState({ lastReqId: 101 }));

    const errCall = socket.emit.mock.calls.find(c => c[0] === 'playlist_error');
    expect(errCall).toBeTruthy();
    expect(socket.emit).not.toHaveBeenCalledWith('playlist_ready', expect.anything());
    expect(errCall[1].reason).toBe('NO_PLAYABLE_PROVIDER');
    // reqId MUST survive on this branch — both clients (mobile socketClient.ts, web useSocket.ts)
    // gate on reqId matching before showing ANY error, so a dropped reqId here would silently
    // swallow this exact message: the failure mode this fix exists to kill.
    expect(errCall[1].reqId).toBe(101);
    expect(errCall[1].message).toMatch(/spotify/i);        // names the actual fix
    expect(errCall[1].message).not.toMatch(/try again/i);  // NOT the misleading generic retry copy
  });

  it('FALLBACK PATH (AI threw): the library fallback also dropping to empty still emits NO_PLAYABLE_PROVIDER, not a raw error message', async () => {
    User.findById.mockResolvedValue(YOUTUBE_USER);
    youtube.getValidToken.mockResolvedValue('youtube-token');
    // The AI pipeline throws → recovery ladder. generateFallbackPlaylist yields library entries
    // with no uri; under provider='youtube' they all drop → fallbackTracks empty → the raw-error
    // emit. The default fallback fixture ([{id:'lib-1'},{id:'lib-2'}]) already drops here.
    geminiEngine.adjustBiometricPlaylist.mockRejectedValue(new Error('Gemini timeout'));

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState({ lastReqId: 102 }));

    const errCall = socket.emit.mock.calls.find(c => c[0] === 'playlist_error');
    expect(errCall).toBeTruthy();
    expect(socket.emit).not.toHaveBeenCalledWith('playlist_ready', expect.anything());
    expect(errCall[1].reason).toBe('NO_PLAYABLE_PROVIDER');
    expect(errCall[1].reqId).toBe(102);                       // reqId survives the AI-threw fallback branch too
    expect(errCall[1].message).toMatch(/spotify/i);
    expect(errCall[1].message).not.toMatch(/Gemini timeout/); // never leak the raw internal error
  });

  it('SPOTIFY USER: an empty result with NO personal history keeps the EXISTING generic handling — no NO_PLAYABLE_PROVIDER reason', async () => {
    // default beforeEach → SPOTIFY_USER (playback engine present). The deterministic fallback is scoped
    // to users WITH history (Fork 3); a no-history Spotify user still gets the soft generic error.
    MusicProfile.findOne.mockReturnValue(musicProfileQuery(makeMusicProfile({ library: [] })));
    orchestrator.generateV2.mockResolvedValueOnce({ familiar: [], discovery: [], merged: [], telemetry: { stageMs: {} } });

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({ lastEmotionTaps: [{ x: 0.5, y: 0.5 }], lastReqId: 103 }));

    const errCall = socket.emit.mock.calls.find(c => c[0] === 'playlist_error');
    expect(errCall).toBeTruthy();
    expect(errCall[1].reason).toBeUndefined();
    expect(errCall[1].reqId).toBe(103);                       // the generic path must still carry reqId
    expect(errCall[1].message).toEqual(expect.any(String));
  });
});

// ── No-playback short-circuit: skip the guaranteed-empty discovery work ────────
// A YouTube-only account (no Spotify token → resolvePlaybackProvider falsy) can NEVER
// receive a playable discovery track: the shared mbid corpus resolves rows to spotify:
// URIs only (its youtube: rows were removed for ToS containment, #151) and the sole
// serve-time URI backfill is gated to Spotify-token users, so the isYoutubePlayable gate
// (#143/#150) filters discovery to EMPTY by construction — the request is 100% guaranteed
// to reach NO_PLAYABLE_PROVIDER. These pin the fix: the Groq LLM generation AND the vector-
// discovery service are SKIPPED (no wasted spend) on the way there, going straight to the
// familiar-only build (if the library is playable) or the honest NO_PLAYABLE_PROVIDER emit.
// The short-circuit is orthogonal to a Spotify user whose pool is empty for another reason —
// they keep the full LLM/vector path and the generic empty-playlist handling (proven below).
describe('generateAndEmitPlaylist — no-playback short-circuit (skip wasted LLM/vector)', () => {
  const orchestrator = require('../app/services/generation/orchestrator');
  const { vectorDiscoveryFetch } = require('../app/services/discovery/discoveryFetch');
  // Restore factory defaults (clearAllMocks keeps custom implementations) so this block's
  // persistent generateV2/vectorDiscoveryFetch overrides never leak into later suites.
  const DEFAULT_GEN_V2 = orchestrator.generateV2.getMockImplementation();
  const DEFAULT_VDF    = vectorDiscoveryFetch.getMockImplementation();

  afterEach(() => {
    orchestrator.generateV2.mockImplementation(DEFAULT_GEN_V2);
    vectorDiscoveryFetch.mockImplementation(DEFAULT_VDF);
    delete process.env.VECTOR_DISCOVERY;
  });

  // Wire the LLM mocks so that IF they ran they would invoke fetchTracks → vectorDiscoveryFetch,
  // making a leaked discovery call observable (the assertions below prove neither ever fires).
  function armLeakDetectors() {
    geminiEngine.adjustBiometricPlaylist.mockImplementation(async ({ fetchTracks }) => ({ params: AI_PARAMS, tracks: await fetchTracks(AI_PARAMS) }));
    geminiEngine.buildEmotionPlaylist.mockImplementation(async ({ fetchTracks }) => ({ params: AI_PARAMS, tracks: await fetchTracks(AI_PARAMS) }));
  }

  it('GUARD 1a: YouTube-only user with a deliverable library — skips the Groq LLM AND the vector-discovery service, delivering familiar-only', async () => {
    User.findById.mockResolvedValue(YOUTUBE_USER);
    youtube.getValidToken.mockResolvedValue('youtube-token');
    armLeakDetectors();
    vectorDiscoveryFetch.mockResolvedValue([{ id: 'c-yt', uri: 'youtube:yt1', recordingKey: 'youtube:yt1', isDiscovery: true }]);
    // A youtube_music familiar entry that IS playable (carries a native youtube: uri) so the
    // familiar-only build returns a track; generateV2 does no discovery (discoveryTracks:[]).
    const famYt = { id: 'lib-yt-1', uri: 'youtube:libyt1', name: 'Familiar YT', artist: 'A', provider: 'youtube_music' };
    orchestrator.generateV2.mockImplementation(async ({ discoveryTracks }) => {
      const d = Array.isArray(discoveryTracks) ? discoveryTracks : [];
      return { familiar: [famYt], discovery: d, merged: [famYt, ...d], telemetry: { stageMs: {} }, targets: { bpmCenter: 120 } };
    });

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState({ lastReqId: 201 }));

    // The NEW property: the expensive calls never fire.
    expect(geminiEngine.adjustBiometricPlaylist).not.toHaveBeenCalled();
    expect(geminiEngine.buildEmotionPlaylist).not.toHaveBeenCalled();
    expect(vectorDiscoveryFetch).not.toHaveBeenCalled();
    // …and the flow still delivers a familiar-only playlist (discovery:0), never an error.
    const ready = socket.emit.mock.calls.find(c => c[0] === 'playlist_ready');
    expect(ready).toBeTruthy();
    expect(ready[1].discovery).toBe(0);
    expect(ready[1].tracks.length).toBeGreaterThan(0);
    expect(socket.emit).not.toHaveBeenCalledWith('playlist_error', expect.anything());
  });

  it('GUARD 1b: YouTube-only user with an unplayable library — skips the Groq LLM AND vector-discovery, emitting NO_PLAYABLE_PROVIDER with reqId', async () => {
    User.findById.mockResolvedValue(YOUTUBE_USER);
    youtube.getValidToken.mockResolvedValue('youtube-token');
    armLeakDetectors();
    vectorDiscoveryFetch.mockResolvedValue([]);
    // Real-world youtube_music familiar entries carry NO uri → all drop at the client contract.
    const famNoUri = { id: 'yt-vid-1', provider: 'youtube_music', name: 'Familiar YT', artist: 'A' };
    orchestrator.generateV2.mockResolvedValue({ familiar: [famNoUri], discovery: [], merged: [famNoUri], telemetry: { stageMs: {} }, targets: { bpmCenter: 120 } });

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState({ lastReqId: 202 }));

    expect(geminiEngine.adjustBiometricPlaylist).not.toHaveBeenCalled();
    expect(geminiEngine.buildEmotionPlaylist).not.toHaveBeenCalled();
    expect(vectorDiscoveryFetch).not.toHaveBeenCalled();
    const errCall = socket.emit.mock.calls.find(c => c[0] === 'playlist_error');
    expect(errCall).toBeTruthy();
    expect(errCall[1].reason).toBe('NO_PLAYABLE_PROVIDER');
    expect(errCall[1].reqId).toBe(202);
    expect(socket.emit).not.toHaveBeenCalledWith('playlist_ready', expect.anything());
  });

  it('GUARD 2a: Spotify user with an EMPTY pool + NO history — the LLM STILL runs and generic empty handling is unchanged (not conflated with no-playback)', async () => {
    // default beforeEach → SPOTIFY_USER (playback engine present); a legitimate no-tracks case. Empty
    // history (Fork 3) so the deterministic fallback is a no-op and the generic soft error still surfaces.
    MusicProfile.findOne.mockReturnValue(musicProfileQuery(makeMusicProfile({ library: [] })));
    orchestrator.generateV2.mockResolvedValueOnce({ familiar: [], discovery: [], merged: [], telemetry: { stageMs: {} } });

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({ lastEmotionTaps: [{ x: 0.5, y: 0.5 }], lastReqId: 203 }));

    // The short-circuit MUST NOT trip for a playback-capable user — the LLM fires as normal…
    expect(geminiEngine.buildEmotionPlaylist).toHaveBeenCalled();
    // …and the empty result keeps the EXISTING generic handling (no NO_PLAYABLE_PROVIDER reason).
    const errCall = socket.emit.mock.calls.find(c => c[0] === 'playlist_error');
    expect(errCall).toBeTruthy();
    expect(errCall[1].reason).toBeUndefined();
    expect(errCall[1].reqId).toBe(203);
  });

  it('GUARD 2b: Spotify user — the vector-discovery service STILL fires (VECTOR_DISCOVERY on); the short-circuit never trips for a playback-capable user', async () => {
    process.env.VECTOR_DISCOVERY = 'true';
    geminiEngine.buildEmotionPlaylist.mockImplementation(async ({ fetchTracks }) => ({ params: AI_PARAMS, tracks: await fetchTracks(AI_PARAMS) }));
    vectorDiscoveryFetch.mockResolvedValue([{ id: 'sv1', uri: 'spotify:track:sv1', isDiscovery: true }]);

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({ lastEmotionTaps: [{ x: 0.5, y: 0.5 }], lastReqId: 204 }));

    expect(vectorDiscoveryFetch).toHaveBeenCalled();
  });

  // GUARD 3 — side-effect parity. When the short-circuit actually DELIVERS a playlist_ready (a
  // deliverable familiar row survives toClientTracks — e.g. a legacy Spotify library entry left on
  // a since-disconnected account, which carries a real spotify: uri), the served tracks MUST record
  // the SAME session/ledger/hydration side effects the normal playlist_ready path records, or
  // anti-repetition + history silently diverge for this user class (they did NOT before this fix).
  it('GUARD 3: a delivered short-circuit playlist records the SAME serve side-effects as the normal path (session, ledger, hydration)', async () => {
    const serveLedger  = require('../app/services/ledger/serveLedger');
    const featureService = require('../app/services/features/featureService');
    User.findById.mockResolvedValue(YOUTUBE_USER);
    youtube.getValidToken.mockResolvedValue('youtube-token');
    // A deliverable familiar entry (legacy Spotify row with a real uri) that survives toClientTracks.
    const famDeliverable = { id: 'legacy-1', uri: 'spotify:track:legacy1', name: 'Legacy', artist: 'A', canonicalKey: 'at:a|legacy' };
    orchestrator.generateV2.mockResolvedValue({
      familiar: [famDeliverable], discovery: [], merged: [famDeliverable],
      telemetry: { stageMs: {} }, targets: { bpmCenter: 120 },
    });

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState({ lastReqId: 205 }));

    const ready = socket.emit.mock.calls.find(c => c[0] === 'playlist_ready');
    expect(ready).toBeTruthy();
    // The served tracks are recorded — exactly as the normal playlist_ready path does.
    expect(serveLedger.recordServes).toHaveBeenCalledTimes(1);
    expect(PlaylistSession.create).toHaveBeenCalledTimes(1);
    expect(featureService.enqueueHydration).toHaveBeenCalledWith([famDeliverable]);
  });

  // GUARD 4 — observability. A systemic generateV2 failure for no-playback users must NOT masquerade
  // as a plain empty playlist with zero signal: it is always-on warned AND captured (the file's
  // standard), while the user still gets the honest NO_PLAYABLE_PROVIDER (never a raw error / crash).
  it('GUARD 4: a generateV2 failure in the short-circuit is OBSERVABLE (warn + captureException), not silently swallowed', async () => {
    const { captureException } = require('../app/config/sentry');
    User.findById.mockResolvedValue(YOUTUBE_USER);
    youtube.getValidToken.mockResolvedValue('youtube-token');
    orchestrator.generateV2.mockRejectedValue(new Error('selection pipeline boom'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState({ lastReqId: 206 }));

    // Always-on warn (NOT a DEBUG-gated log) + Sentry capture.
    expect(warnSpy.mock.calls.flat().join(' ')).toMatch(/no-playback familiar-only build failed/);
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ scope: 'generate.noPlayback' }));
    warnSpy.mockRestore();
    // …and the user still gets the honest NO_PLAYABLE_PROVIDER (no raw error leaked, no crash).
    const errCall = socket.emit.mock.calls.find(c => c[0] === 'playlist_error');
    expect(errCall).toBeTruthy();
    expect(errCall[1].reason).toBe('NO_PLAYABLE_PROVIDER');
  });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe('error handling', () => {
  it('emits playlist_error when no music provider is connected', async () => {
    User.findById.mockResolvedValue({
      _id: 'user-123',
      spotifyToken:      null,
      youtubeMusicToken: null,
      getToken: jest.fn(),
      save:     jest.fn(),
    });

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState());

    expect(socket.emit).toHaveBeenCalledWith('playlist_error', expect.objectContaining({
      message: expect.any(String),
    }));
    expect(geminiEngine.adjustBiometricPlaylist).not.toHaveBeenCalled();
  });

  it('emits playlist_building (NOT a hard error) when MusicProfile does not exist yet — onboarding D-6', async () => {
    MusicProfile.findOne.mockReturnValue(musicProfileQuery(null));

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState());

    expect(socket.emit).toHaveBeenCalledWith('playlist_building', expect.objectContaining({
      message: expect.any(String),
    }));
    expect(socket.emit).not.toHaveBeenCalledWith('playlist_error', expect.anything());
  });

  it('emits playlist_ready with fallback:true when Gemini fails and library is non-empty', async () => {
    geminiEngine.adjustBiometricPlaylist.mockRejectedValue(new Error('Gemini timeout'));

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState());

    expect(socket.emit).toHaveBeenCalledWith('playlist_ready', expect.objectContaining({
      trigger:   'biometric',
      fallback:  true,
      tracks:    expect.any(Array),
      discovery: 0,
    }));
    expect(socket.emit).not.toHaveBeenCalledWith('playlist_error', expect.anything());
  });

  it('fallback playlist_ready carries library tracks and familiar count', async () => {
    geminiEngine.adjustBiometricPlaylist.mockRejectedValue(new Error('Gemini timeout'));

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState());

    const call = socket.emit.mock.calls.find(c => c[0] === 'playlist_ready');
    expect(call[1].tracks.length).toBeGreaterThan(0);
    expect(call[1].familiar).toBe(call[1].tracks.length);
  });

  // L1: the generic double-failure fallback is an off-vibe top-affinity dump — its receipt
  // must NOT overclaim a mood/heart match it never targeted (honest data, VISION).
  it('L1: generic library-fallback receipts make NO mood/heart claim (honest degradation)', async () => {
    geminiEngine.adjustBiometricPlaylist.mockRejectedValue(new Error('Gemini timeout'));

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState()); // no taps ⇒ generic (not mood) fallback

    const call = socket.emit.mock.calls.find(c => c[0] === 'playlist_ready');
    expect(call[1].fallback).toBe(true);
    for (const t of call[1].tracks) {
      const detail = t.receipt?.detail ?? '';
      expect(detail).not.toMatch(/mood/i);
      expect(detail).not.toMatch(/heart rate/i);
    }
  });

  it('emits playlist_error (not playlist_ready) when Gemini fails and there is NO personal history', async () => {
    geminiEngine.adjustBiometricPlaylist.mockRejectedValue(new Error('Gemini timeout'));
    // Fork 3: the deterministic fallback is scoped to users WITH history — an empty library keeps the soft error.
    MusicProfile.findOne.mockReturnValue(musicProfileQuery(makeMusicProfile({ library: [] })));

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState());

    expect(socket.emit).toHaveBeenCalledWith('playlist_error', expect.objectContaining({
      message: expect.any(String),
    }));
    expect(socket.emit).not.toHaveBeenCalledWith('playlist_ready', expect.anything());
  });

  it('G-2: an empty mixed playlist WITH history falls back to a personal playlist_ready (never a bare empty error)', async () => {
    const orchestrator = require('../app/services/generation/orchestrator');
    // Main path resolves to empty ONCE; the deterministic fallback then reruns selection over the
    // (non-empty) personal library and delivers — a user with history is never left empty (G-2).
    orchestrator.generateV2.mockResolvedValueOnce({ familiar: [], discovery: [], merged: [], telemetry: { stageMs: {} } });

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({ lastEmotionTaps: [{ x: 0.5, y: 0.5 }] }));

    const ready = socket.emit.mock.calls.find(c => c[0] === 'playlist_ready');
    expect(ready).toBeTruthy();
    expect(ready[1].fallback).toBe(true);
    expect(socket.emit).not.toHaveBeenCalledWith('playlist_error', expect.anything());
  });
});

// ── Deterministic emotion-fallback playlist (§5 Fork 4B) — G-1/G-2/G-4 wiring ──
// When normal generation FAILS or yields an EMPTY PLAYABLE set, the backend must ALWAYS
// return a playlist built ONLY from the user's personal history, honoring the emotion tap —
// never random, never the global corpus — and record the SAME serve side-effects.
describe('deterministic emotion-fallback (§5 Fork 4B)', () => {
  const orchestrator = require('../app/services/generation/orchestrator');

  it('G-1: LLM throw + library>0 + Spotify sink → playlist_ready{fallback:true}, never playlist_error', async () => {
    geminiEngine.buildEmotionPlaylist.mockRejectedValue(new Error('Groq 500'));

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({ lastEmotionTaps: [{ x: 0.1, y: 0.95 }], lastReqId: 301 }));

    const ready = socket.emit.mock.calls.find(c => c[0] === 'playlist_ready');
    expect(ready).toBeTruthy();
    expect(ready[1].fallback).toBe(true);
    expect(ready[1].discovery).toBe(0);                     // library-only, zero discovery
    expect(ready[1].tracks.length).toBeGreaterThan(0);
    expect(typeof ready[1].fallbackTier).toBe('number');   // telemetry surfaces the reached tier
    expect(socket.emit).not.toHaveBeenCalledWith('playlist_error', expect.anything());
  });

  it('G-2: main success but 0 client-playable + library>0 → playlist_ready{fallback:true} (the empty-playable guard)', async () => {
    // The main path returns a track the client contract DROPS (youtube_music, no uri on a Spotify
    // sink) → clientTracks empty. Pre-fix this emitted a bare playlist_error; now it falls back.
    orchestrator.generateV2.mockResolvedValueOnce({
      familiar: [{ id: 'yt-x', provider: 'youtube_music', name: 'YT' }], discovery: [],
      merged:   [{ id: 'yt-x', provider: 'youtube_music', name: 'YT' }],
      telemetry: { stageMs: {} }, targets: { bpmCenter: 120 },
    });

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({ lastEmotionTaps: [{ x: 0.1, y: 0.95 }], lastReqId: 302 }));

    const ready = socket.emit.mock.calls.find(c => c[0] === 'playlist_ready');
    expect(ready).toBeTruthy();
    expect(ready[1].fallback).toBe(true);
    expect(ready[1].tracks.length).toBeGreaterThan(0);
    expect(socket.emit).not.toHaveBeenCalledWith('playlist_error', expect.anything());
  });

  it('Fork 3: zero personal history → a soft, retryable playlist_error (never the global corpus)', async () => {
    MusicProfile.findOne.mockReturnValue(musicProfileQuery(makeMusicProfile({ library: [] })));
    orchestrator.generateV2.mockResolvedValueOnce({ familiar: [], discovery: [], merged: [], telemetry: { stageMs: {} } });

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({ lastEmotionTaps: [{ x: 0.1, y: 0.95 }], lastReqId: 303 }));

    const errCall = socket.emit.mock.calls.find(c => c[0] === 'playlist_error');
    expect(errCall).toBeTruthy();
    expect(errCall[1].reqId).toBe(303);
    expect(errCall[1].reason).toBeUndefined(); // Spotify user → generic soft error, NOT NO_PLAYABLE_PROVIDER
    expect(socket.emit).not.toHaveBeenCalledWith('playlist_ready', expect.anything());
  });

  it('sink semantics intact: a YouTube-only user with an unplayable library still emits NO_PLAYABLE_PROVIDER', async () => {
    User.findById.mockResolvedValue(YOUTUBE_USER);
    youtube.getValidToken.mockResolvedValue('youtube-token');

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({ lastEmotionTaps: [{ x: 0.1, y: 0.95 }], lastReqId: 304 }));

    const errCall = socket.emit.mock.calls.find(c => c[0] === 'playlist_error');
    expect(errCall).toBeTruthy();
    expect(errCall[1].reason).toBe('NO_PLAYABLE_PROVIDER');
  });

  it('parity: a delivered fallback records the SAME serve side-effects (PlaylistSession + serveLedger + hydration)', async () => {
    const serveLedger    = require('../app/services/ledger/serveLedger');
    const featureService = require('../app/services/features/featureService');
    geminiEngine.buildEmotionPlaylist.mockRejectedValue(new Error('Groq 500'));

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({ lastEmotionTaps: [{ x: 0.1, y: 0.95 }], lastReqId: 305 }));

    expect(socket.emit.mock.calls.find(c => c[0] === 'playlist_ready')).toBeTruthy();
    expect(PlaylistSession.create).toHaveBeenCalledTimes(1);
    expect(serveLedger.recordServes).toHaveBeenCalledTimes(1);
    expect(featureService.enqueueHydration).toHaveBeenCalled();
  });

  it('LOW-1: the serve ledger records EXACTLY the served (post-resolve) tracks by their true identity — a candidate dropped at resolution is NOT ledgered', async () => {
    const serveLedger  = require('../app/services/ledger/serveLedger');
    geminiEngine.buildEmotionPlaylist.mockRejectedValue(new Error('Groq 500')); // → deterministic fallback
    // The fallback's generateV2 (discoveryTracks:[]) surfaces one playable spotify track (ISRC-keyed,
    // so an at:artist|title recompute would MISS its true identity) and one youtube_music track with
    // NO uri that the Spotify sink DROPS at the client contract.
    const served  = { id: 'keep-1', provider: 'spotify', name: 'Keep', artist: 'A', isrc: 'USRC17607839', canonicalKey: 'isrc:USRC17607839' };
    const dropped = { id: 'yt-drop', provider: 'youtube_music', name: 'Drop', artist: 'B', canonicalKey: 'at:b|drop' };
    orchestrator.generateV2.mockResolvedValueOnce({
      familiar: [served, dropped], discovery: [], merged: [served, dropped],
      telemetry: { stageMs: {} }, targets: { bpmCenter: 120 },
    });

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({ lastEmotionTaps: [{ x: 0.1, y: 0.95 }], lastReqId: 320 }));

    const ready = socket.emit.mock.calls.find(c => c[0] === 'playlist_ready');
    expect(ready).toBeTruthy();
    expect(ready[1].tracks.map(t => t.id)).toEqual(['keep-1']); // only the playable track reaches the client
    // The serve ledger records EXACTLY the served track, by its true (ISRC) identity, and NOT the dropped candidate.
    const arg = serveLedger.recordServes.mock.calls.at(-1)[0];
    const keys = arg.entries.map(e => e.canonicalKey);
    expect(keys).toEqual(['isrc:USRC17607839']);
    expect(keys).not.toContain('at:b|drop');
  });

  it('LOW-3: a throw inside the fallback ladder (affinity terminal) degrades to playlist_error, never crashes generation', async () => {
    geminiEngine.buildEmotionPlaylist.mockRejectedValue(new Error('Groq 500')); // → deterministic fallback
    // Both selection tiers throw so the ladder reaches the T2 affinity terminal (one generateV2 call
    // per tier)…
    orchestrator.generateV2.mockRejectedValueOnce(new Error('t0 down')).mockRejectedValueOnce(new Error('t1 down'));
    // …where generateFallbackPlaylist ALSO throws — the previously-unwrapped call LOW-3 guards. Pre-fix
    // this rejected emitDeterministicFallback and voided generation with NO playlist_error emitted.
    playlistMixer.generateFallbackPlaylist.mockImplementationOnce(() => { throw new Error('affinity boom'); });

    const socket = makeSocket();
    await expect(
      generateAndEmitPlaylist(socket, 'emotion', makeState({ lastEmotionTaps: [{ x: 0.1, y: 0.95 }], lastReqId: 330 })),
    ).resolves.toBeUndefined(); // never rejects/crashes

    const errCall = socket.emit.mock.calls.find(c => c[0] === 'playlist_error');
    expect(errCall).toBeTruthy();
    expect(errCall[1].reqId).toBe(330);
    expect(socket.emit).not.toHaveBeenCalledWith('playlist_ready', expect.anything());
  });

  it('G-4: a heart-path throw honors the HR via the synthetic bio moodKey (not an emotion-blind dump)', async () => {
    geminiEngine.adjustBiometricPlaylist.mockRejectedValue(new Error('Groq 500'));

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState({ stableHR: 150, latestActivity: 'running', lastReqId: 306 }));

    // The fallback's selection ran under the deterministic HR-derived bio moodKey, library-only.
    const bioCall = orchestrator.generateV2.mock.calls.find(
      c => c[0].moodKey === 'bio:peak:running' && Array.isArray(c[0].discoveryTracks) && c[0].discoveryTracks.length === 0);
    expect(bioCall).toBeTruthy();
    const ready = socket.emit.mock.calls.find(c => c[0] === 'playlist_ready');
    expect(ready[1].fallback).toBe(true);
  });
});

// ── "Listen to your heart" (request_heart_playlist) ───────────────────────────

describe('request_heart_playlist', () => {
  async function fireHeart(socket, payload) {
    registerBiometricHandler(socket);
    socket._trigger('request_heart_playlist', payload);
    await new Promise(r => setTimeout(r, 50));
  }

  it('uses the averaged HR from the last 30 min of logs when available', async () => {
    mockBiometricLogs([
      { heartRate: 120, activity: 'running' },
      { heartRate: 100, activity: 'running' },
    ]);
    const socket = makeSocket();
    await fireHeart(socket, { mode: 'live', reqId: 1 });

    expect(geminiEngine.adjustBiometricPlaylist).toHaveBeenCalledWith(
      expect.objectContaining({ biometric: expect.objectContaining({ heartRate: 110 }) }),
    );
  });

  it('falls back to the client-reported current HR when there is no logged data', async () => {
    mockBiometricLogs([]);
    const socket = makeSocket();
    await fireHeart(socket, { mode: 'live', reqId: 2, heartRate: 88 });

    expect(geminiEngine.adjustBiometricPlaylist).toHaveBeenCalledWith(
      expect.objectContaining({ biometric: expect.objectContaining({ heartRate: 88 }) }),
    );
  });

  it('falls back to resting HR from the encrypted MedicalProfile when no logs or current HR exist (T3.3)', async () => {
    mockBiometricLogs([]);
    MedicalProfile.findOne.mockResolvedValue({ restingHeartRate: 60 }); // resting baseline now lives here
    const socket = makeSocket();
    await fireHeart(socket, { mode: 'live', reqId: 3 }); // no client HR, fresh state → no stableHR

    expect(geminiEngine.adjustBiometricPlaylist).toHaveBeenCalledWith(
      expect.objectContaining({ biometric: expect.objectContaining({ heartRate: 60 }) }), // MedicalProfile.restingHeartRate
    );
    // ADR-0005 (M2): decrypting the resting-HR baseline is an audited special-category access.
    expect(logBiometricAccess).toHaveBeenCalledWith('user-123', expect.any(String));
  });

  it('emits playlist_ready with trigger=heart (immediate, not queued)', async () => {
    mockBiometricLogs([{ heartRate: 95, activity: 'walking' }]);
    const socket = makeSocket();
    await fireHeart(socket, { mode: 'live', reqId: 4 });

    expect(socket.emit).toHaveBeenCalledWith('playlist_ready', expect.objectContaining({ trigger: 'heart', reqId: 4 }));
  });

  it('emits playlist_error when there is no heart data of any kind', async () => {
    mockBiometricLogs([]);
    MedicalProfile.findOne.mockResolvedValue(null); // no resting baseline anywhere
    const socket = makeSocket();
    await fireHeart(socket, { mode: 'live', reqId: 5 });

    expect(socket.emit).toHaveBeenCalledWith('playlist_error', expect.objectContaining({ message: expect.any(String) }));
  });
});

// ── mode + reqId threading (Bugs 1-3: export mode survives, stale results dropped) ─

describe('mode + reqId threading', () => {
  it('echoes the chosen mode and reqId back in playlist_ready', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({
      lastEmotionTaps: [{ x: 0.5, y: 0.5 }],
      lastMode:  'export',
      lastReqId: 7,
    }));

    expect(socket.emit).toHaveBeenCalledWith('playlist_ready', expect.objectContaining({
      mode:  'export',
      reqId: 7,
    }));
  });

  it('in-flight guard prevents a second overlapping generation on the same state', async () => {
    const socket = makeSocket();
    const state = makeState({ lastEmotionTaps: [{ x: 0.5, y: 0.5 }] });

    // Fire two without awaiting the first — the second must be collapsed.
    const p1 = generateAndEmitPlaylist(socket, 'emotion', state);
    const p2 = generateAndEmitPlaylist(socket, 'emotion', state);
    await Promise.all([p1, p2]);

    const readyCalls = socket.emit.mock.calls.filter(c => c[0] === 'playlist_ready');
    expect(readyCalls).toHaveLength(1);
  });
});

// ── Agent 1: Bug 8 routing, session honesty, HR validation, mood fallback ─────

describe('Bug 8 — strict branch routing', () => {
  it('routes a custom-text-only request (no taps) to the emotion pipeline, not HR', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({
      lastEmotionTaps: [],
      lastTextPrompt:  'rainy day jazz',
    }));
    expect(geminiEngine.buildEmotionPlaylist).toHaveBeenCalled();
    expect(geminiEngine.adjustBiometricPlaylist).not.toHaveBeenCalled();
  });
});

describe('session-history honesty (records what actually drove the generation)', () => {
  it('records the emotion taps + prompt for an emotion generation', async () => {
    const socket = makeSocket();
    const taps = [{ x: 0.1, y: 0.95 }];
    await generateAndEmitPlaylist(socket, 'emotion', makeState({ lastEmotionTaps: taps, lastTextPrompt: 'gym' }));
    expect(PlaylistSession.create).toHaveBeenCalledWith(expect.objectContaining({
      emotionTaps: taps, contextPrompt: 'gym',
    }));
  });

  it('does NOT record stale emotion context for a heart/biometric generation', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState({
      lastEmotionTaps: [{ x: 0.9, y: 0.9 }],
      lastTextPrompt:  'stale mood',
    }));
    expect(PlaylistSession.create).toHaveBeenCalledWith(expect.objectContaining({
      emotionTaps: [{ x: 0, y: 0 }], contextPrompt: '',
    }));
  });

  it('records canonical trackKeys alongside trackIds (variance engine, Phase 1)', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({ lastEmotionTaps: [{ x: 0.1, y: 0.95 }] }));

    expect(PlaylistSession.create).toHaveBeenCalledWith(expect.objectContaining({
      trackIds:  ['lib-1', 'd1', 'd2'],
      trackKeys: ['at:|familiar 1', 'at:|discovery 1', 'at:|discovery 2'],
    }));
  });

  it('enqueues feature hydration for the served tracks after emitting (dark launch)', async () => {
    const featureService = require('../app/services/features/featureService');
    const socket = makeSocket();

    await generateAndEmitPlaylist(socket, 'emotion', makeState({ lastEmotionTaps: [{ x: 0.1, y: 0.95 }] }));

    expect(featureService.enqueueHydration).toHaveBeenCalledWith(MERGED_TRACKS);
    expect(socket.emit).toHaveBeenCalledWith('playlist_ready', expect.anything());
  });

  it('a hydration enqueue failure never breaks the playlist emit', async () => {
    const featureService = require('../app/services/features/featureService');
    featureService.enqueueHydration.mockRejectedValueOnce(new Error('redis exploded'));
    const socket = makeSocket();

    await generateAndEmitPlaylist(socket, 'emotion', makeState({ lastEmotionTaps: [{ x: 0.1, y: 0.95 }] }));

    expect(socket.emit).toHaveBeenCalledWith('playlist_ready', expect.anything());
  });
});

describe('serve ledger wiring (variance engine, Phase 3)', () => {
  const serveLedger = require('../app/services/ledger/serveLedger');

  it('the HR branch closes the blacklist bypass: sessions get a synthetic bio:* moodKey', async () => {
    const socket = makeSocket();

    await generateAndEmitPlaylist(socket, 'biometric', makeState({ stableHR: 150, latestActivity: 'running' }));

    expect(PlaylistSession.create).toHaveBeenCalledWith(expect.objectContaining({
      moodKey: 'bio:peak:running',
    }));
  });

  it('records every served track in the ledger with the mood context (emotion branch)', async () => {
    const socket = makeSocket();

    await generateAndEmitPlaylist(socket, 'emotion', makeState({ lastEmotionTaps: [{ x: 0.1, y: 0.95 }] }));

    const arg = serveLedger.recordServes.mock.calls.at(-1)[0];
    expect(arg.userId).toBe('user-123');
    expect(arg.entries).toHaveLength(MERGED_TRACKS.length);
    expect(arg.entries[0]).toEqual(expect.objectContaining({
      canonicalKey: expect.stringMatching(/^at:/),
      moodKey: 'intense',
    }));
  });

  it('records HR-branch serves under the synthetic bio moodKey', async () => {
    const socket = makeSocket();

    await generateAndEmitPlaylist(socket, 'biometric', makeState({ stableHR: 150, latestActivity: 'running' }));

    const arg = serveLedger.recordServes.mock.calls.at(-1)[0];
    expect(arg.entries[0].moodKey).toBe('bio:peak:running');
    expect(arg.entries[0].bioState).toEqual(expect.objectContaining({ tempoBand: 'peak', activity: 'running' }));
  });

  it('a ledger write failure never breaks the playlist emit', async () => {
    serveLedger.recordServes.mockRejectedValueOnce(new Error('mongo down'));
    const socket = makeSocket();

    await generateAndEmitPlaylist(socket, 'biometric', makeState());

    expect(socket.emit).toHaveBeenCalledWith('playlist_ready', expect.anything());
  });

  it('HR-branch generations flow through v2 under the synthetic bio moodKey (bypass structurally closed)', async () => {
    const orchestrator = require('../app/services/generation/orchestrator');
    const socket = makeSocket();

    await generateAndEmitPlaylist(socket, 'biometric', makeState({ stableHR: 150, latestActivity: 'running' }));

    expect(orchestrator.generateV2).toHaveBeenCalledWith(expect.objectContaining({
      moodKey: 'bio:peak:running',
    }));
  });
});

describe('HR physiological validation (Bug: HR=0 / garbage / stale)', () => {
  it('rejects a non-physiological logged HR and falls back to resting', async () => {
    mockBiometricLogs([{ heartRate: 0, activity: 'x' }]);
    MedicalProfile.findOne.mockResolvedValue({ restingHeartRate: 60 }); // resting baseline (T3.3)
    const socket = makeSocket();
    registerBiometricHandler(socket);
    socket._trigger('request_heart_playlist', { mode: 'live', reqId: 11 });
    await new Promise(r => setTimeout(r, 50));
    expect(geminiEngine.adjustBiometricPlaylist).toHaveBeenCalledWith(
      expect.objectContaining({ biometric: expect.objectContaining({ heartRate: 60 }) }),
    );
  });
});

describe('mood-aware fallback when the LLM fails (zero-tolerance holds without AI)', () => {
  it('builds a strictly on-vibe playlist instead of off-vibe library tracks', async () => {
    const orchestrator = require('../app/services/generation/orchestrator');
    geminiEngine.buildEmotionPlaylist.mockRejectedValue(new Error('Groq 429'));
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({ lastEmotionTaps: [{ x: 0.1, y: 0.95 }] }));

    // The v2 fallback carried the strict mood exclude_genres (never a plain top-affinity dump).
    const call = orchestrator.generateV2.mock.calls.find(c => c[0].aiParams && c[0].aiParams.exclude_genres);
    expect(call).toBeDefined();
    expect(call[0].discoveryTracks).toEqual([]); // library-only, never a failing Spotify dependency
    expect(socket.emit).toHaveBeenCalledWith('playlist_ready', expect.objectContaining({
      trigger: 'emotion', fallback: true,
    }));
  });
});

// ── Layer 1: vibe sourcing + personalization (the critic left the hot path) ───

describe('vibe pipeline wiring (Spotify)', () => {
  it('Spotify fetchTracks closure sources from vibe playlists and personalizes — the critic NEVER runs in the hot path', async () => {
    spotify.fetchVibeDiscovery.mockResolvedValue([{ id: 'r1', artists: [{ id: 'a1' }] }]);
    spotify.getArtistsGenres.mockResolvedValue({ a1: ['afrobeat'] });

    let captured;
    geminiEngine.buildEmotionPlaylist.mockImplementation(async ({ fetchTracks }) => {
      captured = fetchTracks;
      return { params: AI_PARAMS, tracks: [] };
    });

    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({ lastEmotionTaps: [{ x: 0.1, y: 0.95 }] }));

    const result = await captured({ ...AI_PARAMS, mood_keywords: ['heavy'], playlist_queries: ['beast mode'] });

    expect(spotify.fetchVibeDiscovery).toHaveBeenCalledWith(
      'spotify-access-token',
      expect.objectContaining({ playlist_queries: ['beast mode'] }),
      { limit: 60 },
    );
    expect(playlistMixer.personalizeWhitelist).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 'r1', genres: ['afrobeat'] })]),
      expect.objectContaining({ genreSet: expect.anything(), knownArtistIds: expect.anything() }),
    );
    // Phase 7: vibe judgment is worker-side enrichment now — zero LLM in the closure.
    expect(geminiEngine.critiqueTrackVibe).not.toHaveBeenCalled();
    expect(result).toEqual([{ id: 'r1', artists: [{ id: 'a1' }], provider: 'spotify', artistIds: ['a1'], genres: ['afrobeat'] }]);
  });
});

// ── Socket event dispatch wiring ──────────────────────────────────────────────
// Verify that socket events route to the correct trigger.
// Uses fake timers only for the 60s debounce test.

describe('socket event dispatch wiring', () => {
  it('emotion_update stores taps without triggering generation', () => {
    const socket = makeSocket();
    registerBiometricHandler(socket);

    socket._trigger('emotion_update', { taps: [{ x: 0.5, y: 0.5 }], textPrompt: 'chill' });

    expect(geminiEngine.buildEmotionPlaylist).not.toHaveBeenCalled();
    expect(geminiEngine.adjustBiometricPlaylist).not.toHaveBeenCalled();
  });

  it('request_playlist calls generateAndEmitPlaylist with emotion trigger', async () => {
    const socket = makeSocket();
    registerBiometricHandler(socket);

    const taps = [{ x: 0.3, y: 0.6 }];
    socket._trigger('emotion_update', { taps, textPrompt: 'study' });
    socket._trigger('request_playlist');

    // Wait for the async pipeline to settle
    await new Promise(r => setTimeout(r, 50));

    expect(geminiEngine.buildEmotionPlaylist).toHaveBeenCalledWith(
      expect.objectContaining({ emotionTaps: taps, textPrompt: 'study' })
    );
  });

  it('2 consecutive track_skipped events trigger the pipeline', async () => {
    const socket = makeSocket();
    registerBiometricHandler(socket);

    socket._trigger('track_skipped');
    socket._trigger('track_skipped');

    await new Promise(r => setTimeout(r, 50));

    expect(geminiEngine.adjustBiometricPlaylist).toHaveBeenCalled();
  });

  it('biometric_push debounce fires pipeline after 60s', async () => {
    jest.useFakeTimers();

    const socket = makeSocket();
    registerBiometricHandler(socket);
    socket._trigger('live_mode', { enabled: true }); // band transitions auto-drive only in Live mode

    await socket._trigger('biometric_push', { source: 'garmin', raw: { heartRate: 65 } });
    await socket._trigger('biometric_push', { source: 'garmin', raw: { heartRate: 80 } });

    jest.advanceTimersByTime(60_000);

    jest.useRealTimers();

    // Give real async time to settle
    await new Promise(r => setTimeout(r, 50));

    expect(geminiEngine.adjustBiometricPlaylist).toHaveBeenCalledWith(
      expect.objectContaining({ biometric: expect.objectContaining({ heartRate: 80 }) })
    );
  });
});

// ── handleBiometricReading (direct call, bypasses socket event) ───────────────

describe('handleBiometricReading (direct)', () => {
  it('is exported and callable without a socket event', () => {
    const { handleBiometricReading } = require('../app/sockets/biometricHandler');
    expect(typeof handleBiometricReading).toBe('function');
  });

  it('emits biometric_ack on a valid garmin reading', () => {
    const { handleBiometricReading } = require('../app/sockets/biometricHandler');
    const socket = { id: 'direct-test-1', emit: jest.fn(), data: { user: { _id: 'u1' } } };
    const raw = { heartRate: 90, activityType: 6, startTimeLocal: '2026-06-21T10:00:00' };

    handleBiometricReading(socket, 'garmin', raw);

    expect(socket.emit).toHaveBeenCalledWith('biometric_ack', {
      normalized: expect.objectContaining({ heartRate: 90, activity: 'walking', source: 'garmin' }),
    });
  });

  it('emits connection_error on unknown source', () => {
    const { handleBiometricReading } = require('../app/sockets/biometricHandler');
    const socket = { id: 'direct-test-2', emit: jest.fn(), data: { user: { _id: 'u2' } } };

    handleBiometricReading(socket, 'unknown_device', {});

    expect(socket.emit).toHaveBeenCalledWith('connection_error', expect.objectContaining({ message: expect.any(String) }));
  });
});

// ── handleBiometricReading — immediate (5-min watch) mode ─────────────────────

describe('handleBiometricReading immediate mode', () => {
  const { handleBiometricReading, _debounceMap } = require('../app/sockets/biometricHandler');

  it('still emits biometric_ack', () => {
    const socket = makeSocket();
    handleBiometricReading(socket, 'garmin', { heartRate: 100 }, { immediate: true });
    expect(socket.emit).toHaveBeenCalledWith('biometric_ack',
      expect.objectContaining({ normalized: expect.objectContaining({ heartRate: 100 }) }));
  });

  it('triggers generation on the first reading (no prior baseline)', async () => {
    const socket = makeSocket();
    registerBiometricHandler(socket);
    socket._trigger('live_mode', { enabled: true }); // band transitions auto-drive only in Live mode
    handleBiometricReading(socket, 'garmin', { heartRate: 140 }, { immediate: true });
    await new Promise(r => setTimeout(r, 50));
    expect(geminiEngine.adjustBiometricPlaylist).toHaveBeenCalledTimes(1);
  });

  it('does NOT re-trigger when the change is < 25 bpm', async () => {
    const socket = makeSocket();
    handleBiometricReading(socket, 'garmin', { heartRate: 100 }, { immediate: true });
    await new Promise(r => setTimeout(r, 50));
    geminiEngine.adjustBiometricPlaylist.mockClear();
    handleBiometricReading(socket, 'garmin', { heartRate: 120 }, { immediate: true }); // delta 20
    await new Promise(r => setTimeout(r, 50));
    expect(geminiEngine.adjustBiometricPlaylist).not.toHaveBeenCalled();
  });

  it('re-triggers when the change is >= 25 bpm', async () => {
    const socket = makeSocket();
    registerBiometricHandler(socket);
    socket._trigger('live_mode', { enabled: true });
    handleBiometricReading(socket, 'garmin', { heartRate: 100 }, { immediate: true });
    await new Promise(r => setTimeout(r, 50));
    geminiEngine.adjustBiometricPlaylist.mockClear();
    handleBiometricReading(socket, 'garmin', { heartRate: 130 }, { immediate: true }); // delta 30
    await new Promise(r => setTimeout(r, 50));
    expect(geminiEngine.adjustBiometricPlaylist).toHaveBeenCalledTimes(1);
  });

  it('never starts the 60s debounce (no recalibration_pending, timer stays null)', () => {
    const socket = makeSocket();
    handleBiometricReading(socket, 'garmin', { heartRate: 100 }, { immediate: true });
    handleBiometricReading(socket, 'garmin', { heartRate: 130 }, { immediate: true });
    const events = socket.emit.mock.calls.map(c => c[0]);
    expect(events).not.toContain('recalibration_pending');
    expect(_debounceMap.get(socket.id).timer).toBeNull();
  });
});

// ── Activity-mode change trigger (Bug 4) ──────────────────────────────────────

describe('activity-mode change triggers regeneration', () => {
  const { handleBiometricReading } = require('../app/sockets/biometricHandler');

  it('immediate: re-triggers on a new activity even when HR is flat', async () => {
    const socket = makeSocket();
    registerBiometricHandler(socket);
    socket._trigger('live_mode', { enabled: true });
    handleBiometricReading(socket, 'garmin', { heartRate: 100, activityType: 0 }, { immediate: true }); // resting
    await new Promise(r => setTimeout(r, 50));
    geminiEngine.adjustBiometricPlaylist.mockClear();

    handleBiometricReading(socket, 'garmin', { heartRate: 100, activityType: 1 }, { immediate: true }); // running, same HR
    await new Promise(r => setTimeout(r, 50));

    expect(geminiEngine.adjustBiometricPlaylist).toHaveBeenCalledTimes(1);
  });

  it('immediate: does NOT re-trigger when activity is unchanged and HR delta < 25', async () => {
    const socket = makeSocket();
    handleBiometricReading(socket, 'garmin', { heartRate: 100, activityType: 0 }, { immediate: true });
    await new Promise(r => setTimeout(r, 50));
    geminiEngine.adjustBiometricPlaylist.mockClear();

    handleBiometricReading(socket, 'garmin', { heartRate: 110, activityType: 0 }, { immediate: true }); // delta 10, same activity
    await new Promise(r => setTimeout(r, 50));

    expect(geminiEngine.adjustBiometricPlaylist).not.toHaveBeenCalled();
  });

  it('streaming: starts recalibration on an activity change with a small HR delta', () => {
    const socket = makeSocket();
    handleBiometricReading(socket, 'garmin', { heartRate: 100, activityType: 0 }); // baseline resting
    handleBiometricReading(socket, 'garmin', { heartRate: 103, activityType: 1 }); // delta 3, resting→running

    const events = socket.emit.mock.calls.map(c => c[0]);
    expect(events).toContain('recalibration_pending');
  });
});

// ── THE FLIP (variance engine, Phase 6): v2 serves; legacy is the frozen rollback ──

describe('the sealed engine — v2 is the only serving path', () => {
  const orchestrator = require('../app/services/generation/orchestrator');
  const INTENSE = [{ x: 0.1, y: 0.95 }];

  it('generateV2 gets the mood, LLM params, discovery and live biometrics — unconditionally', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({ lastEmotionTaps: INTENSE }));

    expect(orchestrator.generateV2).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-123',
      moodKey: 'intense',
      aiParams: AI_PARAMS,
      discoveryTracks: DISCOVERY_TRACKS,
      live: expect.objectContaining({ heartRate: 80 }),
    }));

    expect(socket.emit).toHaveBeenCalledWith('playlist_ready', expect.anything());
  });

  it('a stale SELECTION_V2 env var changes nothing (the flag is dead)', async () => {
    process.env.SELECTION_V2 = 'false';
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({ lastEmotionTaps: INTENSE }));

    expect(orchestrator.generateV2).toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('playlist_ready', expect.anything());
    delete process.env.SELECTION_V2;
  });

  it('records the resolved moodKey on the session (synthetic bio:* for the HR branch)', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'emotion', makeState({ lastEmotionTaps: INTENSE }));
    expect(PlaylistSession.create).toHaveBeenCalledWith(expect.objectContaining({ moodKey: 'intense' }));

    PlaylistSession.create.mockClear();
    await generateAndEmitPlaylist(makeSocket(), 'biometric', makeState());
    expect(PlaylistSession.create).toHaveBeenCalledWith(
      expect.objectContaining({ moodKey: expect.stringMatching(/^bio:/) })
    );
  });
});

// ── Generation timeout (hard wall-clock bound) ────────────────────────────────
// A generation must never hold the in-flight lock indefinitely: a Spotify 429 storm
// (withRetry waits out each Retry-After) or an LLM outage could otherwise wedge the
// socket for minutes, so every later request_playlist hits the guard and the user
// gets no reply. We hang the pipeline at its first await and drive the fake clock.

describe('generation timeout (hard wall-clock bound)', () => {
  afterEach(() => { jest.useRealTimers(); });

  it('times out a hung generation: releases the lock and emits playlist_error for a user trigger', () => {
    User.findById.mockReturnValue(new Promise(() => {})); // never resolves → pipeline hangs
    jest.useFakeTimers();
    const socket = makeSocket();
    const state  = makeState({ lastEmotionTaps: [{ x: 0.5, y: 0.5 }], lastReqId: 42 });

    generateAndEmitPlaylist(socket, 'emotion', state); // do NOT await — it never resolves
    expect(state.generating).toBe(true);               // lock claimed synchronously

    jest.advanceTimersByTime(31_000);                  // fire the wall-clock timeout

    expect(state.generating).toBe(false);              // lock released by the timeout
    expect(socket.emit).toHaveBeenCalledWith('playlist_error', expect.objectContaining({
      reqId:   42,
      message: expect.stringMatching(/tim(e|ed)\s?out/i),
    }));
  });

  it('a background (biometric) timeout releases the lock WITHOUT a spurious playlist_error', () => {
    User.findById.mockReturnValue(new Promise(() => {}));
    jest.useFakeTimers();
    const socket = makeSocket();
    const state  = makeState();

    generateAndEmitPlaylist(socket, 'biometric', state);
    jest.advanceTimersByTime(31_000);

    expect(state.generating).toBe(false);              // lock still released
    expect(socket.emit).not.toHaveBeenCalledWith('playlist_error', expect.anything());
  });

  it('a hung generation that later resolves does NOT emit a stale playlist after it timed out', async () => {
    let resolveUser;
    User.findById.mockReturnValue(new Promise(r => { resolveUser = r; }));
    jest.useFakeTimers();
    const socket = makeSocket();
    const state  = makeState({ lastEmotionTaps: [{ x: 0.5, y: 0.5 }] });

    generateAndEmitPlaylist(socket, 'emotion', state);
    jest.advanceTimersByTime(31_000);                  // timeout: error emitted, lock freed, epoch bumped
    socket.emit.mockClear();                           // ignore the timeout error; watch for a stale emit

    jest.useRealTimers();
    resolveUser(SPOTIFY_USER);                         // the abandoned pipeline resumes...
    await new Promise(r => setTimeout(r, 50));         // ...and runs to completion

    // ...but every emit in the superseded run is epoch-guarded → no stale playlist reaches the client.
    expect(socket.emit).not.toHaveBeenCalledWith('playlist_ready', expect.anything());
  });
});

// ── Live-mode band recalibration (Part 2b, slice 4) ───────────────────────────
// In Live mode a CONFIRMED band transition SERVES the precompiled buffer for the new
// band instead of generating fresh (§3.4). Manual users are never auto-driven (the
// mode-gate). Serves are recorded ONLY when a buffer is actually PLAYED (§3.5).

describe('Live-mode band recalibration (slice 4)', () => {
  const serveLedger  = require('../app/services/ledger/serveLedger');
  const orchestrator = require('../app/services/generation/orchestrator');

  const BUFFER_TRACKS = [
    { id: 'b1', uri: 'spotify:track:b1', title: 'Buffered One', artist: 'Artist X' },
    { id: 'b2', uri: 'spotify:track:b2', title: 'Buffered Two', artist: 'Artist Y' },
  ];
  function warmBuffer() {
    shadowBufferRepo.getBuffer.mockResolvedValue({
      tracks: BUFFER_TRACKS, familiar: 1, discovery: 1, targets: { bpmCenter: 150 }, builtAt: Date.now(),
    });
  }

  it('mode-gate: a Manual-mode socket is never auto-driven on a band transition', async () => {
    const socket = makeSocket();
    await recalibrateForBand(socket, makeState({ liveMode: false, stableHR: 150, latestActivity: 'running' }));

    expect(shadowBufferRepo.getBuffer).not.toHaveBeenCalled();
    expect(orchestrator.generateV2).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalledWith('playlist_ready', expect.anything());
  });

  it('warm buffer: serves the precompiled buffer instantly, without a fresh generation', async () => {
    warmBuffer();
    const socket = makeSocket();
    await recalibrateForBand(socket, makeState({ liveMode: true, stableHR: 150, latestActivity: 'running' }));

    const call = socket.emit.mock.calls.find(c => c[0] === 'playlist_ready');
    expect(call).toBeDefined();
    expect(call[1]).toMatchObject({ trigger: 'biometric', buffered: true, familiar: 1, discovery: 1 });
    expect(call[1].tracks).toHaveLength(BUFFER_TRACKS.length);
    expect(shadowBufferRepo.getBuffer).toHaveBeenCalledWith('user-123', 'bio:peak:running');
    expect(orchestrator.generateV2).not.toHaveBeenCalled(); // served from buffer — zero Groq spend
  });

  it('§3.5 serve-on-play: serving a warm buffer records serves for the played tracks under the bio moodKey', async () => {
    warmBuffer();
    const socket = makeSocket();
    await recalibrateForBand(socket, makeState({ liveMode: true, stableHR: 150, latestActivity: 'running' }));

    expect(serveLedger.recordServes).toHaveBeenCalledTimes(1);
    const arg = serveLedger.recordServes.mock.calls.at(-1)[0];
    expect(arg.entries).toHaveLength(BUFFER_TRACKS.length);
    expect(arg.entries[0]).toEqual(expect.objectContaining({
      canonicalKey: expect.stringMatching(/^at:/),
      moodKey: 'bio:peak:running',
      bioState: expect.objectContaining({ tempoBand: 'peak', activity: 'running' }),
    }));
  });

  it('§3.5 precompile records NO serves: warming the buffer store never triggers recordServes', async () => {
    // A biometric generation warms the buffer (setBuffer) AND emits the play. recordServes
    // must fire exactly once — for the emitted PLAY — never a second time for the STORE.
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState({ stableHR: 150, latestActivity: 'running' }));

    expect(shadowBufferRepo.setBuffer).toHaveBeenCalledTimes(1); // the precompile store happened
    expect(serveLedger.recordServes).toHaveBeenCalledTimes(1);   // ...but it recorded ZERO extra serves
  });

  it('cold buffer: shows the assembling loader, then falls back to a one-time live generation', async () => {
    shadowBufferRepo.getBuffer.mockResolvedValue(null); // cold — no buffer for this band yet
    const socket = makeSocket();
    await recalibrateForBand(socket, makeState({ liveMode: true, stableHR: 150, latestActivity: 'running' }));

    expect(socket.emit).toHaveBeenCalledWith('live_assembling', expect.objectContaining({
      message: expect.stringMatching(/assembling your live biometric soundscape/i),
    }));
    expect(orchestrator.generateV2).toHaveBeenCalled(); // the one-time live fallback ran
  });
});

describe('live_mode socket event', () => {
  it('sets the per-socket liveMode flag (default is Manual/false)', () => {
    const socket = makeSocket();
    registerBiometricHandler(socket);

    socket._trigger('live_mode', { enabled: true });
    expect(_debounceMap.get(socket.id).liveMode).toBe(true);

    socket._trigger('live_mode', { enabled: false });
    expect(_debounceMap.get(socket.id).liveMode).toBe(false);
  });
});

// ── D-6 v2: warmup heartbeat architecture (no hard error on first-gen) ─────────
// A fresh library generates slowly but healthily; the old 30s wall-clock voided the
// run (discarding its work) and the in-flight guard silently dropped retries — an
// infinite timeout loop on cold accounts. Warmup now heartbeats; retries are adopted.

describe('D-6 v2 — warmup heartbeat + reqId adoption', () => {
  const orchestrator = require('../app/services/generation/orchestrator');

  afterEach(() => { jest.useRealTimers(); });

  it('a retry landing mid-generation gets a playlist_building heartbeat, never a silent drop', async () => {
    const socket = makeSocket();
    const state  = makeState({ generating: true, lastReqId: 7, lastEmotionTaps: [{ x: 0.5, y: 0.5 }] });

    await generateAndEmitPlaylist(socket, 'emotion', state);

    expect(socket.emit).toHaveBeenCalledWith('playlist_building', expect.objectContaining({ reqId: 7 }));
    expect(User.findById).not.toHaveBeenCalled(); // guard returned — no second pipeline
  });

  it('a background trigger hitting the in-flight guard stays silent (no spurious building)', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState({ generating: true, lastReqId: 7 }));
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('the completed generation replies to the ADOPTED (newest) reqId', async () => {
    let resolveUser;
    User.findById.mockReturnValue(new Promise((r) => { resolveUser = r; }));
    const socket = makeSocket();
    const state  = makeState({ lastEmotionTaps: [{ x: 0.5, y: 0.5 }], lastReqId: 1 });

    const run = generateAndEmitPlaylist(socket, 'emotion', state);
    state.lastReqId = 2;          // a retry arrives mid-run; the handler adopted its reqId
    resolveUser(SPOTIFY_USER);    // pipeline proceeds and completes
    await run;

    const ready = socket.emit.mock.calls.find(([e]) => e === 'playlist_ready');
    expect(ready).toBeDefined();
    expect(ready[1].reqId).toBe(2); // NOT the stale 1 — the client's gate keeps its loader honest
  });

  it('WARMUP (fresh profile): the 30s wall-clock heartbeats playlist_building and the run keeps working', async () => {
    MusicProfile.findOne.mockReturnValue(musicProfileQuery(makeMusicProfile({ createdAt: new Date() })));
    spotify.getValidToken.mockReturnValue(new Promise(() => {})); // hang AFTER the profile loads
    jest.useFakeTimers();
    const socket = makeSocket();
    const state  = makeState({ lastEmotionTaps: [{ x: 0.5, y: 0.5 }], lastReqId: 5 });

    generateAndEmitPlaylist(socket, 'emotion', state); // never resolves — hung downstream
    await jest.advanceTimersByTimeAsync(0);            // let the pre-hang awaits settle
    await jest.advanceTimersByTimeAsync(31_000);       // first wall-clock tick

    expect(socket.emit).toHaveBeenCalledWith('playlist_building', expect.objectContaining({
      reqId: 5, message: expect.stringMatching(/warming/i),
    }));
    expect(socket.emit).not.toHaveBeenCalledWith('playlist_error', expect.anything());
    expect(state.generating).toBe(true);               // the run was NOT voided

    await jest.advanceTimersByTimeAsync(31_000);       // second tick — still heartbeating
    expect(socket.emit).not.toHaveBeenCalledWith('playlist_error', expect.anything());

    await jest.advanceTimersByTimeAsync(130_000);      // past the 180s hard ceiling
    expect(state.generating).toBe(false);              // NOW the wedge-abort fires
    expect(socket.emit).toHaveBeenCalledWith('playlist_error', expect.objectContaining({
      message: expect.stringMatching(/tim(e|ed)\s?out/i),
    }));
  });

  it('NON-warmup (established profile): the 30s hard timeout behavior is unchanged', async () => {
    spotify.getValidToken.mockReturnValue(new Promise(() => {})); // hang after profile load
    jest.useFakeTimers();
    const socket = makeSocket();
    const state  = makeState({ lastEmotionTaps: [{ x: 0.5, y: 0.5 }], lastReqId: 9 });

    generateAndEmitPlaylist(socket, 'emotion', state); // default profile has no createdAt → not warmup
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(31_000);

    expect(state.generating).toBe(false);
    expect(socket.emit).toHaveBeenCalledWith('playlist_error', expect.objectContaining({ reqId: 9 }));
    expect(socket.emit).not.toHaveBeenCalledWith('playlist_building', expect.anything());
  });
});

// ── Generation AI budget: a stalled discovery/LLM step must NOT become a hard timeout ──
// Root cause of the on-device "Generation timed out" after a fresh deploy: the module-level
// artistGenresAvailable() gate resets on restart, so the first generation attempts Spotify
// discovery, hits a 429 Retry-After storm, and buildEmotionPlaylist blocks to the 30s
// wall-clock (which VOIDS the run into a hard error). The AI budget bounds that step below
// the wall-clock so the existing library fallback serves a REAL playlist instead.
describe('generation AI budget (stall → library fallback, not hard timeout)', () => {
  afterEach(() => { jest.useRealTimers(); });

  it('an AI/discovery stall falls back to a real playlist and trips the discovery-skip gate', async () => {
    geminiEngine.buildEmotionPlaylist.mockReturnValue(new Promise(() => {})); // hang the AI/discovery step
    jest.useFakeTimers();
    const socket = makeSocket();
    const state  = makeState({ lastEmotionTaps: [{ x: 0.5, y: 0.5 }], lastReqId: 4 });

    generateAndEmitPlaylist(socket, 'emotion', state); // established profile → 18s AI budget
    await jest.advanceTimersByTimeAsync(0);            // settle getValidToken + biometric context
    await jest.advanceTimersByTimeAsync(19_000);       // trip the 18s AI budget, before the 30s wall-clock
    await jest.advanceTimersByTimeAsync(0);            // settle the fallback's generateV2 emit

    const ready = socket.emit.mock.calls.find(([e]) => e === 'playlist_ready');
    expect(ready).toBeDefined();                        // a REAL playlist, not a hard error
    expect(ready[1].fallback).toBe(true);
    expect(socket.emit).not.toHaveBeenCalledWith('playlist_error', expect.anything());
    expect(spotify.markDiscoveryUnavailable).toHaveBeenCalled(); // next gen skips the stalled discovery
  });

  it('a healthy generation well under budget is unaffected (no fallback, no gate trip)', async () => {
    const socket = makeSocket();
    const state  = makeState({ lastEmotionTaps: [{ x: 0.5, y: 0.5 }], lastReqId: 6 });

    await generateAndEmitPlaylist(socket, 'emotion', state);

    const ready = socket.emit.mock.calls.find(([e]) => e === 'playlist_ready');
    expect(ready).toBeDefined();
    expect(ready[1].fallback).toBeFalsy();              // primary path served it
    expect(spotify.markDiscoveryUnavailable).not.toHaveBeenCalled();
  });
});

// ── Band-aware discovery threading (DISCOVERY_BAND_AWARE) ─────────────────────
// The biosonic band is computed ONCE and shared by BOTH vector discovery (so its
// candidates survive the pipeline's un-relaxable band) and generateV2 (so the pipeline
// enforces the identical band) — no double translate, no drift.
describe('band-aware discovery threading (DISCOVERY_BAND_AWARE)', () => {
  const orchestrator   = require('../app/services/generation/orchestrator');
  const { vectorDiscoveryFetch } = require('../app/services/discovery/discoveryFetch');
  const BAND = { bpmCenter: 150, bpmWidth: 12, energyFloor: 0.4, energyCeiling: 0.8, confidence: 0.85, activityDriven: true };

  beforeEach(() => {
    process.env.VECTOR_DISCOVERY     = 'true'; // route the closure to vector discovery
    process.env.DISCOVERY_BAND_AWARE = 'true';
    orchestrator.buildTargets.mockResolvedValue(BAND);
    // Capture + invoke the fetchTracks closure so the discovery forward actually fires.
    geminiEngine.adjustBiometricPlaylist.mockImplementation(async ({ fetchTracks }) => {
      await fetchTracks(AI_PARAMS);
      return { params: AI_PARAMS, tracks: DISCOVERY_TRACKS };
    });
  });
  afterEach(() => { delete process.env.VECTOR_DISCOVERY; delete process.env.DISCOVERY_BAND_AWARE; });

  it('computes the band ONCE via buildTargets (no double translate)', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState());
    expect(orchestrator.buildTargets).toHaveBeenCalledTimes(1);
  });

  it('threads the SAME band object into vector discovery', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState());
    expect(vectorDiscoveryFetch).toHaveBeenCalledWith(expect.objectContaining({ targets: BAND }));
  });

  it('threads the SAME band object into generateV2 (pipeline + discovery agree)', async () => {
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState());
    const call = orchestrator.generateV2.mock.calls.find(c => c[0].targets);
    expect(call[0].targets).toBe(BAND);
  });

  it('flag OFF: buildTargets is never called and generateV2 gets no precomputed band', async () => {
    delete process.env.DISCOVERY_BAND_AWARE;
    const socket = makeSocket();
    await generateAndEmitPlaylist(socket, 'biometric', makeState());
    expect(orchestrator.buildTargets).not.toHaveBeenCalled();
    expect(orchestrator.generateV2).toHaveBeenCalledWith(expect.objectContaining({ targets: null }));
  });
});
