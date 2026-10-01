'use strict';

// HX-3 T7 (DEC-040; CMP-046) — the profile build's LLM genre backfill sends no YouTube artist name.
//
// When a library carries no genres, buildProfile asks the LLM (Groq) for its artists' genres. The
// allowlist that decides WHOSE artists may be named was `youtube_music` only (Spotify Content is
// banned from the LLM); under DEC-040 YouTube data may not reach an LLM either, so the allowlist is
// empty while YOUTUBE_EGRESS_ENABLED is false and the backfill names nobody — and with no names,
// inferArtistGenres returns before any call.
//
// This runs the REAL buildProfile and the REAL geminiEngine.inferArtistGenres, and observes the LLM
// at the lowest shared layer: the services/llmCall.js `chatJson` export (pass-through) and its HTTP
// transport (axios). The YouTube and Spotify APIs are data fakes (what they return is not under test),
// as are the stores the build writes to.

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.LLM_API_KEY = 'test-llm-key'; // so a backfill, if one were made, would reach the LLM layer
process.env.LLM_MAX_RETRIES = '0';
delete process.env.LLM_BASE_URL;

jest.mock('../app/services/llmCall', () => {
  const actual = jest.requireActual('../app/services/llmCall');
  return { ...actual, chatJson: jest.fn(actual.chatJson) };
});
jest.mock('../app/config/redis', () => ({ getRedis: () => null }));
jest.mock('../app/models/MusicProfile', () => ({
  findOneAndUpdate: jest.fn(async (_q, update) => ({ ...update.$set })),
  deleteOne: jest.fn(),
}));
jest.mock('../app/models/User', () => ({
  findById: () => ({ select: () => ({ lean: async () => ({ spotifyToken: { blob: 'linked' } }) }) }),
}));
jest.mock('../app/services/youtube', () => ({
  paginateLikedVideos: jest.fn(),
  paginatePlaylistItems: jest.fn(async () => []),
  paginateSubscriptions: jest.fn(async () => []),
  fetchVideoTopics: jest.fn(async () => []), // no topic genres → the library has none
}));
jest.mock('../app/services/spotify', () => ({
  getTopTracks: jest.fn(async () => []),
  getTopArtists: jest.fn(async () => []),
  paginateLikedSongs: jest.fn(async () => []),
  getRecentlyPlayed: jest.fn(async () => []),
  paginatePlaylistTracks: jest.fn(async () => []),
  getArtistsGenres: jest.fn(async () => ({})), // Spotify serves no artist genres
}));
jest.mock('../app/services/musicClassifier', () => ({
  classifyTracks: jest.fn(async (tracks) => ({ music: tracks, nonMusic: [], unclassified: [] })),
}));
jest.mock('../app/repositories/unclassifiedRepo', () => ({ addMany: jest.fn(async () => 0) }));
jest.mock('../app/services/features/featureService', () => ({ enqueueHydration: jest.fn(async () => ({})), hydrate: jest.fn() }));
jest.mock('../app/services/discovery/corpusIngest', () => ({ ingestLibrary: jest.fn(async () => ({})) }));

const axios = require('axios');
const llmCall = require('../app/services/llmCall');
const youtube = require('../app/services/youtube');
const spotify = require('../app/services/spotify');
const MusicProfile = require('../app/models/MusicProfile');
const { buildProfile } = require('../app/services/musicProfileService');
const { inferArtistGenres } = require('../app/services/geminiEngine');
const { YOUTUBE_EGRESS_ENABLED } = require('../app/config/youtubeSeal');

const LLM_URL = 'https://api.groq.com/openai/v1/chat/completions';

let http;
beforeEach(() => {
  jest.clearAllMocks();
  http = [];
  for (const level of ['info', 'warn']) jest.spyOn(console, level).mockImplementation(() => {});
  jest.spyOn(axios, 'post').mockImplementation(async (url, body) => {
    http.push({ url: String(url), body });
    if (String(url) !== LLM_URL) throw new Error(`no network in tests: ${url}`);
    const asked = [...String(body?.messages?.[0]?.content).matchAll(/^- (.+)$/gm)].map((m) => m[1]);
    return { status: 200, data: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(Object.fromEntries(asked.map((n) => [n, ['lo-fi']]))) } }], usage: {} } };
  });
  jest.spyOn(axios, 'get').mockImplementation(async (url) => { http.push({ url: String(url) }); throw new Error('no network in tests'); });
  youtube.paginateLikedVideos.mockResolvedValue([
    { id: 'v1', snippet: { title: 'YTSENTINEL Song One', channelTitle: 'YTSENTINEL Artist', tags: [] } },
    { id: 'v2', snippet: { title: 'YTSENTINEL Song Two', channelTitle: 'YTSENTINEL Second Artist', tags: [] } },
  ]);
});
afterEach(() => jest.restoreAllMocks());

const user = ({ spotifyLinked = false } = {}) => ({
  getToken: (key) => {
    if (key === 'youtubeMusicToken') return { accessToken: 'yt-token' };
    if (key === 'spotifyToken' && spotifyLinked) return { accessToken: 'sp-token' };
    return null;
  },
});
const saved = () => MusicProfile.findOneAndUpdate.mock.calls[0][1].$set;
const llmText = () => JSON.stringify([llmCall.chatJson.mock.calls, http]);

describe('the profile build sends no YouTube artist name to the LLM backfill (HX-3 T7)', () => {
  it('runs against the real seal', () => {
    expect(YOUTUBE_EGRESS_ENABLED).toBe(false);
  });

  it('control: the instruments are live — a name asked of inferArtistGenres reaches chatJson and the transport', async () => {
    const out = await inferArtistGenres(['Probe Artist']);
    expect(out).toEqual({ 'Probe Artist': ['lo-fi'] });
    expect(llmCall.chatJson).toHaveBeenCalledTimes(1);
    expect(llmText()).toContain('Probe Artist');
  });

  it('a YouTube-only library with an empty genreSet: no LLM call, no YouTube name, no LLM genre', async () => {
    await buildProfile('user-yt', user());

    expect(saved().library.map((t) => t.provider)).toEqual(['youtube_music', 'youtube_music']); // the backfill had YouTube rows to name
    expect(llmCall.chatJson).not.toHaveBeenCalled();
    expect(http).toEqual([]);
    expect(llmText()).not.toMatch(/YTSENTINEL/i);
    expect(saved().genreSet).toEqual([]);
  });

  it('a mixed library with no genres anywhere: neither the YouTube nor the Spotify artists are named', async () => {
    spotify.getTopTracks.mockImplementation(async (_t, range) => (range === 'short_term'
      ? [{ id: 't1', name: 'Spotify Song', uri: 'spotify:track:t1', popularity: 50, artists: [{ id: 'a1', name: 'Spotify Only Artist' }] }]
      : []));
    await buildProfile('user-mixed', user({ spotifyLinked: true }));

    expect(saved().library.map((t) => t.provider).sort()).toEqual(['spotify', 'youtube_music', 'youtube_music']);
    expect(llmCall.chatJson).not.toHaveBeenCalled();
    expect(http).toEqual([]);
    expect(llmText()).not.toMatch(/YTSENTINEL|Spotify Only Artist/i);
  });
});
