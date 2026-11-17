'use strict';

// HX-3 T6 — the DT-B5 seam test (option A, with the compliance-auditor's three additions).
//
// The claim (DEC-122, DEC-040; CMP-021, CMP-046): no YouTube-derived string reaches any Spotify
// request or any LLM prompt, on any generation branch. The mechanism is ONE seam: generation reads the
// taste profile through musicProfileService.withoutYoutube, right where it is loaded, for EVERY
// provider. So this test stores a profile on REAL MongoDB the way a pre-DEC-122 merged build left it —
// YouTube rows whose titles, channels and genres are unique sentinels, a YouTube-weighted footprint,
// and one YouTube genre ('nu-disco') that also sits in the energize mood's allow-list, so it would
// steer the mood's on-taste Spotify seed — and drives the REAL generateAndEmitPlaylist over:
//   • the emotion and heart branches, with VECTOR_DISCOVERY 'true' and unset,
//   • a forced fallback on each branch: the LLM transport fails on the emotion branch; the heart
//     branch makes no LLM call (BE-221), so there a Spotify discovery failure forces it,
//   • a YouTube token with no Spotify link (the addition for the unconditional strip).
// It asserts:
//   1. every consumer of the profile received the SAME YouTube-free view: generateV2,
//      buildEmotionPlaylist, adjustBiometricPlaylist, vectorDiscoveryFetch, buildDeterministicFallback,
//      personalizeWhitelist and buildMoodParams (addition 2);
//   2. no sentinel in any argument of any Spotify call (fetchVibeDiscovery, searchTrackUri,
//      getArtistsGenres, …) and the allow-listed YouTube genre in no discovery seed;
//   3. no sentinel in any LLM prompt, observed at the LOWEST shared LLM layer — the services/llmCall.js
//      `chatJson` export (a pass-through spy) AND its HTTP transport (axios), so a new prompt builder
//      cannot slip past (addition 1);
//   4. no sentinel in ANY outbound HTTP request at all;
//   5. the stored profile is untouched: the view is read-only.
// Each run also proves its instruments are live (the LLM was called on the emotion branch and NOT
// on the heart branch, which makes no LLM call since BE-221; Spotify was called; a playlist was
// served), so a branch that silently skipped the work cannot pass.
//
// Real: MongoDB (User with tokens encrypted by the real setToken, MusicProfile), the biometric handler,
// geminiEngine's prompt builders and LLM call, llmCall.chatJson, moodDescriptors, the deterministic
// fallback, playlistMixer, crossPlatform.translateToSpotify (with its DEC-040 gate), the youtube
// service. Faked at the boundary: the HTTP transport (axios: the LLM answers; nothing else is
// reachable), Spotify (a recording fake of the service), the vector corpus (one catalogue candidate),
// generateV2 (a pool echo: it returns the profile's library and the discovery it was handed, exactly
// the candidates the real pipeline would select from), and the side-effect stores.

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET = 'test-jwt-secret-for-tests-only';
process.env.LLM_API_KEY = 'test-llm-key'; // so geminiEngine reaches the shared LLM layer
process.env.LLM_MAX_RETRIES = '0';
delete process.env.LLM_BASE_URL;
delete process.env.DISCOVERY_BAND_AWARE;
delete process.env.DISCOVERY_CAPTION_LLM;
delete process.env.GENERATION_AI_BUDGET_MS;

jest.mock('../app/config/redis', () => ({ getRedis: () => null, connectRedis: jest.fn(), createConnection: jest.fn() }));
jest.mock('../app/config/sentry', () => ({ captureException: jest.fn(), initSentry: jest.fn() }));

// (1) The lowest shared LLM layer: observed at its export, real underneath.
jest.mock('../app/services/llmCall', () => {
  const actual = jest.requireActual('../app/services/llmCall');
  return { ...actual, chatJson: jest.fn(actual.chatJson) };
});

// Spotify, at the service boundary: every call recorded with its arguments.
jest.mock('../app/services/spotify', () => {
  const calls = [];
  const rec = (name, impl) => jest.fn(async (...args) => { calls.push({ name, args }); return impl(...args); });
  // __fail.discovery: Spotify's discovery search fails, as a real 5xx does — the genre search under
  // fetchVibeDiscovery has no catch of its own on the heart branch (no playlist queries).
  const fail = { discovery: false };
  return {
    __calls: calls,
    __fail: fail,
    getValidToken: jest.fn(async () => 'spotify-access-token'),
    artistGenresAvailable: jest.fn(() => true),
    markDiscoveryUnavailable: jest.fn(),
    fetchVibeDiscovery: rec('fetchVibeDiscovery', () => {
      if (fail.discovery) throw Object.assign(new Error('Request failed with status code 503'), { response: { status: 503 } });
      return [
        { id: 'spd1', uri: 'spotify:track:spd1', name: 'Vibe Find', artists: [{ id: 'sp-artist-1', name: 'Spotify Artist' }] },
      ];
    }),
    getArtistsGenres: rec('getArtistsGenres', () => ({ 'sp-artist-1': ['house'] })),
    searchTrackUri: rec('searchTrackUri', (_tok, { title, artist }) => ({ id: `s-${title}`, uri: `spotify:track:s-${String(title).replace(/\W+/g, '')}`, name: title, artist })),
    withFreshToken: rec('withFreshToken', () => { throw new Error('no Spotify session playlist in tests'); }),
  };
});

// Consumers of the profile, observed (pass-through to the real code).
jest.mock('../app/services/geminiEngine', () => {
  const actual = jest.requireActual('../app/services/geminiEngine');
  return {
    ...actual,
    buildEmotionPlaylist: jest.fn(actual.buildEmotionPlaylist),
    adjustBiometricPlaylist: jest.fn(actual.adjustBiometricPlaylist),
  };
});
jest.mock('../app/services/generation/deterministicFallback', () => {
  const actual = jest.requireActual('../app/services/generation/deterministicFallback');
  return { ...actual, buildDeterministicFallback: jest.fn(actual.buildDeterministicFallback) };
});
jest.mock('../app/services/playlistMixer', () => {
  const actual = jest.requireActual('../app/services/playlistMixer');
  return { ...actual, personalizeWhitelist: jest.fn(actual.personalizeWhitelist) };
});
// Wrapped in place, not spread: the module exports a lazy getter (_STATE_TO_BAND) whose require is
// circular, and a spread would fire it mid-load.
jest.mock('../app/services/moodDescriptors', () => {
  const actual = jest.requireActual('../app/services/moodDescriptors');
  actual.buildMoodParams = jest.fn(actual.buildMoodParams);
  return actual;
});
// The vector corpus: one CC0 catalogue candidate, as discoveryVectorService emits it.
jest.mock('../app/services/discovery/discoveryFetch', () => ({
  vectorDiscoveryFetch: jest.fn(async () => [
    { id: 'mbid:cat1', recordingKey: 'mbid:cat1', canonicalKey: 'at:cc0 artist|catalogue find', uri: null, title: 'Catalogue Find', artist: 'CC0 Artist', genres: [], isDiscovery: true },
  ]),
}));
// generateV2 as a pool echo: the candidates are the profile's library plus the discovery it is handed.
jest.mock('../app/services/generation/orchestrator', () => ({
  generateV2: jest.fn(async ({ musicProfile, discoveryTracks = [] }) => {
    const familiar = (musicProfile?.library || []).map((t) => ({ ...t }));
    const discovery = (discoveryTracks || []).map((t) => ({ ...t, isDiscovery: true }));
    return { familiar, discovery, merged: [...familiar, ...discovery], telemetry: { featured: 1, stageMs: {} }, targets: { bpmCenter: 120 } };
  }),
  buildTargets: jest.fn(async () => ({ bpmCenter: 120, confidence: 0.5 })),
}));
// Side-effect stores (not egress).
jest.mock('../app/services/features/featureService', () => ({ enqueueHydration: jest.fn(async () => ({})), hydrate: jest.fn() }));
jest.mock('../app/services/ledger/serveLedger', () => ({ recordServes: jest.fn(async () => ({ recorded: 0 })) }));
jest.mock('../app/repositories/shadowBufferRepo', () => ({ getBuffer: jest.fn(async () => null), setBuffer: jest.fn(async () => true) }));
jest.mock('../app/services/biosonic/baselines', () => ({ peekBaselines: jest.fn(async () => null) }));
jest.mock('../app/repositories/sleepHistoryRepo', () => ({ readNightHistory: jest.fn(async () => []) }));
jest.mock('../app/services/discovery/captionService', () => ({ captionDiscovery: jest.fn(async () => new Map()) }));
jest.mock('../app/agents/runtime/physiology/liveStateAdapter', () => ({ onlineUpdate: jest.fn(async () => ({ regimeChanged: false })) }));
jest.mock('../app/services/spotifySessionPlaylist', () => ({
  writeSessionPlaylist: jest.fn(async () => { throw new Error('no Spotify session playlist in tests'); }),
}));

const axios = require('axios');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const User = require('../app/models/User');
const MusicProfile = require('../app/models/MusicProfile');
const PlaylistSession = require('../app/models/PlaylistSession');
const spotify = require('../app/services/spotify');
const llmCall = require('../app/services/llmCall');
const geminiEngine = require('../app/services/geminiEngine');
const orchestrator = require('../app/services/generation/orchestrator');
const { buildDeterministicFallback } = require('../app/services/generation/deterministicFallback');
const { personalizeWhitelist } = require('../app/services/playlistMixer');
const { buildMoodParams } = require('../app/services/moodDescriptors');
const { vectorDiscoveryFetch } = require('../app/services/discovery/discoveryFetch');
const { isYoutubeContent } = require('../app/utils/youtubeContent');
const { generateAndEmitPlaylist, _resetDebounceState } = require('../app/sockets/biometricHandler');

jest.setTimeout(120000);

// Unique strings only a YouTube row carries. None may appear in any outbound payload.
const SENTINEL = /ytsentinel|ytvid/i;
// A YouTube-only genre that ALSO sits in the energize allow-list: it would become an on-taste seed.
const ALLOWED_YT_GENRE = 'nu-disco';
const ENERGIZE_TAP = { x: 0.6, y: 0.85 };
const LLM_URL = 'https://api.groq.com/openai/v1/chat/completions';
const LLM_PARAMS = {
  target_bpm: 124, target_energy: 0.8, target_valence: 0.7, target_acousticness: 0.1,
  seed_artists: [], seed_genres: [], mood_keywords: ['upbeat', 'driving'], tempo_category: 'peak',
};

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_youtube_egress_seam_it' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});

let http;      // every outbound HTTP request: { verb, url, body }
let llmFails;  // force the fallback by failing the LLM transport (emotion) or Spotify discovery (heart)
beforeEach(async () => {
  await Promise.all([User.deleteMany({}), MusicProfile.deleteMany({}), PlaylistSession.deleteMany({})]);
  jest.clearAllMocks();
  spotify.__calls.length = 0;
  spotify.__fail.discovery = false;
  http = [];
  llmFails = false;
  for (const level of ['log', 'info', 'warn', 'error']) jest.spyOn(console, level).mockImplementation(() => {});
  // (1) The transport under llmCall — and under everything else that could reach the network.
  jest.spyOn(axios, 'post').mockImplementation(async (url, body) => {
    http.push({ verb: 'post', url: String(url), body });
    if (String(url) === LLM_URL) {
      if (llmFails) throw Object.assign(new Error('Request failed with status code 500'), { response: { status: 500, data: {} } });
      return { status: 200, data: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(LLM_PARAMS) } }], usage: {} } };
    }
    throw new Error(`no network in tests: ${url}`);
  });
  for (const verb of ['get', 'put', 'delete', 'request']) {
    jest.spyOn(axios, verb).mockImplementation(async (...args) => {
      http.push({ verb, url: String(args[0]?.url ?? args[0]), body: args[1] ?? args[0]?.data });
      throw new Error('no network in tests');
    });
  }
});
afterEach(async () => {
  // Let the fire-and-forget serve writes settle before the next test clears the collections.
  await new Promise((r) => setTimeout(r, 50));
  jest.restoreAllMocks();
  _resetDebounceState();
  delete process.env.VECTOR_DISCOVERY;
  delete process.env.GENERATION_AI_BUDGET_MS;
});

const TOKENS = (tag) => ({ accessToken: `${tag}-access`, refreshToken: `${tag}-refresh`, expiresAt: Date.now() + 3_600_000 });

async function account(tag, { spotifyLinked = true, youtubeLinked = true } = {}) {
  const user = new User({ ssoProvider: 'google', ssoId: `sso-${tag}`, email: `${tag}@example.com` });
  if (spotifyLinked) user.setToken('spotifyToken', TOKENS('sp'));
  if (youtubeLinked) user.setToken('youtubeMusicToken', TOKENS('yt'));
  user.musicProvider = youtubeLinked ? 'youtube' : 'spotify';
  await user.save();
  const spotifyRows = spotifyLinked ? [
    { id: 'sp1', provider: 'spotify', uri: 'spotify:track:sp1', name: 'House One', artist: 'Spotify Artist', genres: ['house'], affinity: 3, canonicalKey: 'at:spotify artist|house one' },
    { id: 'sp2', provider: 'spotify', uri: 'spotify:track:sp2', name: 'House Two', artist: 'Spotify Artist', genres: ['house', 'electronic'], affinity: 2, canonicalKey: 'at:spotify artist|house two' },
  ] : [];
  // What a pre-DEC-122 merged build stored: YouTube rows ranked ABOVE Spotify in the footprint.
  await MusicProfile.create({
    userId: user._id,
    topGenres: ['ytsentinelgenre', ALLOWED_YT_GENRE, 'house', 'electronic'],
    topArtists: ['YTSENTINEL Channel', 'Spotify Artist'],
    genreSet: ['ytsentinelgenre', ALLOWED_YT_GENRE, 'house', 'electronic'],
    knownArtistIds: spotifyLinked ? ['sp-artist-1'] : [],
    library: [
      { id: 'ytvid1', provider: 'youtube_music', name: 'YTSENTINEL Title One (Official Video)', artist: 'YTSENTINEL Channel', genres: ['ytsentinelgenre', ALLOWED_YT_GENRE], affinity: 9, canonicalKey: 'at:ytsentinel channel|ytsentinel title one' },
      ...spotifyRows,
      { id: 'ytvid2', provider: 'youtube_music', name: 'YTSENTINEL Title Two', artist: 'YTSENTINEL Channel', genres: [ALLOWED_YT_GENRE], affinity: 9, canonicalKey: 'at:ytsentinel channel|ytsentinel title two' },
    ],
  });
  return user;
}

function makeSocket(user) {
  return { id: `sock-${user._id}`, data: { user: { _id: user._id } }, emit: jest.fn(), on: jest.fn() };
}
function makeState(branch) {
  return branch === 'emotion'
    ? { stableHR: null, latestActivity: null, lastEmotionTaps: [ENERGIZE_TAP], lastTextPrompt: '', lastActivity: null, lastMode: 'live', lastReqId: 1, consecutiveSkips: 0 }
    : { stableHR: 128, latestActivity: 'running', lastEmotionTaps: [], lastTextPrompt: '', lastActivity: null, lastMode: 'live', lastReqId: 1, consecutiveSkips: 0 };
}

// Every profile object each consumer was handed, by consumer.
function profilesHandedOut() {
  const seen = [];
  const take = (consumer, profile) => { if (profile !== undefined) seen.push({ consumer, profile }); };
  for (const [a] of orchestrator.generateV2.mock.calls) take('generateV2', a.musicProfile);
  for (const [a] of geminiEngine.buildEmotionPlaylist.mock.calls) take('buildEmotionPlaylist', a.musicProfile);
  for (const [a] of geminiEngine.adjustBiometricPlaylist.mock.calls) take('adjustBiometricPlaylist', a.musicProfile);
  for (const [a] of vectorDiscoveryFetch.mock.calls) take('vectorDiscoveryFetch', a.musicProfile);
  for (const [a] of buildDeterministicFallback.mock.calls) take('buildDeterministicFallback', a.musicProfile);
  for (const [, p] of buildMoodParams.mock.calls) take('buildMoodParams', p);
  for (const [, opts] of personalizeWhitelist.mock.calls) take('personalizeWhitelist', opts);
  return seen;
}

const llmPrompts = () => llmCall.chatJson.mock.calls.map(([a]) => a.prompt);
const discoverySeeds = () => [
  ...spotify.__calls.filter((c) => c.name === 'fetchVibeDiscovery').map((c) => c.args[1]?.seed_genres),
  ...vectorDiscoveryFetch.mock.calls.map(([a]) => a.aiParams?.seed_genres),
].map((g) => g || []);

async function run(branch, { vector = false, fallback = false, user }) {
  if (vector) process.env.VECTOR_DISCOVERY = 'true';
  llmFails = fallback;
  // BE-221: the heart branch makes no LLM call, so a failing LLM cannot force its fallback. Without
  // vector discovery a Spotify discovery failure forces it; with vector discovery (which never
  // throws) a stalled corpus query overruns the AI budget instead (RA-8 on #279).
  spotify.__fail.discovery = fallback && branch === 'heart' && !vector;
  if (fallback && branch === 'heart' && vector) {
    process.env.GENERATION_AI_BUDGET_MS = '25';
    const stalled = vectorDiscoveryFetch.getMockImplementation();
    vectorDiscoveryFetch.mockImplementationOnce(async (...args) => {
      await new Promise((r) => setTimeout(r, 250));
      return stalled(...args);
    });
  }
  const socket = makeSocket(user);
  await generateAndEmitPlaylist(socket, branch, makeState(branch));
  return socket.emit.mock.calls;
}

const leaksIn = (value) => (JSON.stringify(value).match(new RegExp(SENTINEL.source, 'gi')) || []);

function expectNoYoutubeEgress() {
  // The claim first. 2. Spotify: no sentinel in any argument of any call; the allow-listed YouTube
  // genre seeds no discovery.
  expect({ spotifyCalls: leaksIn(spotify.__calls) }).toEqual({ spotifyCalls: [] });
  for (const seeds of discoverySeeds()) expect({ discoverySeed: seeds }).toEqual({ discoverySeed: expect.not.arrayContaining([ALLOWED_YT_GENRE]) });
  // 3. The LLM, at the export and at the transport.
  expect({ llmPrompts: leaksIn(llmPrompts()) }).toEqual({ llmPrompts: [] });
  // 4. Anything at all that left over HTTP.
  expect({ http: leaksIn(http) }).toEqual({ http: [] });
  // Then the mechanism. 1. Every consumer got the YouTube-free view — the same object everywhere.
  const handed = profilesHandedOut();
  expect(handed.length).toBeGreaterThan(0);
  for (const { consumer, profile } of handed) {
    const rows = profile.library ?? [];
    expect({ consumer, youtubeRows: rows.filter(isYoutubeContent).length }).toEqual({ consumer, youtubeRows: 0 });
    expect({ consumer, leak: leaksIn(profile) }).toEqual({ consumer, leak: [] });
    expect({ consumer, allowListedYoutubeGenre: JSON.stringify(profile).includes(ALLOWED_YT_GENRE) }).toEqual({ consumer, allowListedYoutubeGenre: false });
  }
  const views = new Set(handed.filter((h) => h.consumer !== 'personalizeWhitelist').map((h) => h.profile));
  expect(views.size).toBe(1);
}

async function expectStoredProfileUntouched(user) {
  const stored = await MusicProfile.findOne({ userId: user._id }).lean();
  expect(stored.library.filter((t) => t.provider === 'youtube_music').map((t) => t.id)).toEqual(['ytvid1', 'ytvid2']);
  expect(stored.topGenres[0]).toBe('ytsentinelgenre');
}

describe('DT-B5 seam: no YouTube sentinel leaves through generation, on any branch (HX-3 T6)', () => {
  describe.each([
    ['emotion', false],
    ['emotion', true],
    ['heart', false],
    ['heart', true],
  ])('%s branch, VECTOR_DISCOVERY=%s', (branch, vector) => {
    it('serves a playlist with no YouTube-derived string in any Spotify call, LLM prompt or HTTP request', async () => {
      const user = await account(`${branch}-${vector}`);
      const emitted = await run(branch, { vector, user });

      // The instruments were live on this branch. BE-221: the heart branch makes no LLM call at all,
      // so there the live instrument is its absence.
      if (branch === 'heart') {
        expect(geminiEngine.adjustBiometricPlaylist).toHaveBeenCalled();
        expect(llmCall.chatJson).not.toHaveBeenCalled();
        expect(http.some((h) => h.url === LLM_URL)).toBe(false);
      } else {
        expect(llmCall.chatJson).toHaveBeenCalled();
        expect(http.some((h) => h.url === LLM_URL)).toBe(true);
      }
      if (vector) {
        expect(vectorDiscoveryFetch).toHaveBeenCalled();
        expect(spotify.__calls.some((c) => c.name === 'searchTrackUri' && c.args[1].title === 'Catalogue Find')).toBe(true);
      } else {
        expect(spotify.__calls.some((c) => c.name === 'fetchVibeDiscovery')).toBe(true);
      }
      expectNoYoutubeEgress();
      // …and nothing YouTube-derived reaches the client either (the served params carry the seeds).
      const ready = emitted.find(([e]) => e === 'playlist_ready');
      expect(ready).toBeTruthy();
      expect(ready[1].tracks.length).toBeGreaterThan(0);
      expect({ served: leaksIn(ready[1]) }).toEqual({ served: [] });
      await expectStoredProfileUntouched(user);
    });
  });

  // BE-221: the heart branch makes no LLM call, so its forced fallback is a Spotify discovery
  // failure (VECTOR_DISCOVERY=false) or a vector query that overruns the AI budget (=true, RA-8).
  it.each([
    ['emotion', false],
    ['heart', false],
    ['heart', true],
  ])('a forced fallback on the %s branch (VECTOR_DISCOVERY=%s): the library-only ladder sees no YouTube row', async (branch, vector) => {
    const user = await account(`fallback-${branch}`);
    const emitted = await run(branch, { vector, fallback: true, user });

    expect(buildDeterministicFallback).toHaveBeenCalled();
    if (branch === 'heart') {
      if (vector) {
        expect(vectorDiscoveryFetch).toHaveBeenCalled(); // the corpus was queried, and stalled past the budget
        expect(spotify.markDiscoveryUnavailable).toHaveBeenCalled(); // the gen_budget path, not another error
      } else {
        expect(spotify.__calls.some((c) => c.name === 'fetchVibeDiscovery')).toBe(true); // discovery was tried, and failed
      }
      expect(http.some((h) => h.url === LLM_URL)).toBe(false); // and no LLM was ever asked
    } else {
      expect(http.some((h) => h.url === LLM_URL)).toBe(true); // the LLM was tried, and failed
    }
    expectNoYoutubeEgress();
    const ready = emitted.find(([e]) => e === 'playlist_ready');
    expect(ready).toBeTruthy();
    expect(ready[1]).toEqual(expect.objectContaining({ fallback: true }));
    expect({ served: leaksIn(ready[1]) }).toEqual({ served: [] });
    await expectStoredProfileUntouched(user);
  });

  it.each(['emotion', 'heart'])('a YouTube token and no Spotify link (%s): the strip is unconditional — no YouTube row reaches generation, nothing leaves', async (branch) => {
    const user = await account(`yt-only-${branch}`, { spotifyLinked: false });
    const emitted = await run(branch, { user });

    expect(orchestrator.generateV2).toHaveBeenCalled();
    expectNoYoutubeEgress();
    expect(llmCall.chatJson).not.toHaveBeenCalled();
    expect(spotify.__calls).toEqual([]);
    expect(http).toEqual([]);
    expect(emitted.find(([e]) => e === 'playlist_ready')).toBeUndefined();
    await expectStoredProfileUntouched(user);
  });
});
