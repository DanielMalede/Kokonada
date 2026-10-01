'use strict';

// HX-3 T6 — the C6 negative pin (compliance brief C6; CMP-046; BE-035's "third flow").
//
// featureService.hydrate NEVER hands a YouTube track to llmEstimator.getFeatures, so a YouTube
// track's genre tags (the only thing that estimator's prompt carries) never reach Groq. The drop
// happens at hydrate's entry choke (_dropRestricted, via the ONE shared isYoutubeContent predicate),
// before the measured API and before the estimator. That is why the "third flow" recorded on BE-035
// is not a flow, and this test is what keeps it so.
//
// Real: featureService, the llmEstimatorAdapter (observed by a pass-through spy on getFeatures),
// llmClient, llmCall.chatJson (observed by a pass-through spy — the lowest shared LLM layer), the
// ReccoBeats adapter. Faked: the HTTP transport (axios; the LLM answers, nothing else is reachable),
// the AudioFeature store (an in-memory map with the repository's contract) and the job queue.

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.LLM_API_KEY = 'test-llm-key';
process.env.LLM_MAX_RETRIES = '0';
process.env.FEATURE_LLM_RETRIES = '0';
delete process.env.LLM_BASE_URL;

jest.mock('../app/services/llmCall', () => {
  const actual = jest.requireActual('../app/services/llmCall');
  return { ...actual, chatJson: jest.fn(actual.chatJson) };
});
jest.mock('../app/services/features/llmEstimatorAdapter', () => {
  const actual = jest.requireActual('../app/services/features/llmEstimatorAdapter');
  return { ...actual, getFeatures: jest.fn(actual.getFeatures) };
});
jest.mock('../app/repositories/audioFeatureRepo', () => {
  const store = new Map();
  return {
    __store: store,
    getMany: jest.fn(async (keys = []) => new Map(keys.filter((k) => store.has(k)).map((k) => [k, store.get(k)]))),
    upsertMany: jest.fn(async (docs = []) => { for (const d of docs) store.set(d.recordingKey, d); return { upserted: docs.length }; }),
    missingKeys: jest.fn(async (keys = []) => keys.filter((k) => !store.has(k))),
  };
});
jest.mock('../app/queues/queue', () => ({ enqueue: jest.fn(async () => ({ id: 'job' })) }));

const axios = require('axios');
const featureService = require('../app/services/features/featureService');
const llmEstimator = require('../app/services/features/llmEstimatorAdapter');
const llmCall = require('../app/services/llmCall');
const repo = require('../app/repositories/audioFeatureRepo');
const { isYoutubeContent } = require('../app/utils/youtubeContent');

const LLM_URL = 'https://api.groq.com/openai/v1/chat/completions';
const SENTINEL = /ytsentinel/i;

// Every shape a YouTube recording can reach hydrate in: the library row, a youtube: uri, a youtube:
// recordingKey (discovery), a youtube: canonicalKey.
const YOUTUBE_TRACKS = [
  { id: 'vid1', provider: 'youtube_music', name: 'Video One', artist: 'YTSENTINEL Channel', genres: ['ytsentinel-topic-genre'] },
  { id: 'vid2', provider: 'youtube_music', uri: 'youtube:vid2', title: 'Video Two', artist: 'YTSENTINEL Channel', genres: ['ytsentinel-tag'] },
  { recordingKey: 'youtube:vid3', title: 'Video Three', artist: 'YTSENTINEL Channel', genres: ['ytsentinel-discovery'] },
  { recordingKey: 'mbid:shadow', canonicalKey: 'youtube:vid4', title: 'Video Four', artist: 'YTSENTINEL Channel', genres: ['ytsentinel-canonical'] },
];
const CATALOGUE_TRACK = { recordingKey: 'mbid:cat1', title: 'Catalogue One', artist: 'CC0 Artist', genres: ['cc0-genre-marker'] };

let http;
beforeEach(() => {
  jest.clearAllMocks();
  repo.__store.clear();
  http = [];
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(axios, 'post').mockImplementation(async (url, body) => {
    http.push({ url: String(url), body });
    if (String(url) !== LLM_URL) throw new Error(`no network in tests: ${url}`);
    const n = (String(body?.messages?.[0]?.content).match(/^\d+\. genres:/gm) || []).length;
    const estimates = Array.from({ length: n }, (_, i) => ({ i, bpm: 120, energy: 0.6, valence: 0.5, acousticness: 0.2, danceability: 0.6, loudness: -8, confidence: 0.5 }));
    return { status: 200, data: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ estimates }) } }], usage: {} } };
  });
  jest.spyOn(axios, 'get').mockImplementation(async (url) => { http.push({ url: String(url) }); throw new Error('no network in tests'); });
});
afterEach(() => jest.restoreAllMocks());

const tracksHandedToEstimator = () => llmEstimator.getFeatures.mock.calls.flatMap(([tracks]) => tracks);
const prompts = () => llmCall.chatJson.mock.calls.map(([a]) => a.prompt);

describe('C6 · featureService.hydrate never hands a YouTube track to llmEstimator.getFeatures (HX-3 T6)', () => {
  it('a mixed batch: only the catalogue track reaches the estimator and the LLM; no YouTube tag leaves', async () => {
    const summary = await featureService.hydrate([...YOUTUBE_TRACKS, CATALOGUE_TRACK]);

    expect(tracksHandedToEstimator()).toEqual([CATALOGUE_TRACK]);
    expect(tracksHandedToEstimator().filter(isYoutubeContent)).toEqual([]);
    // The instruments are live: the catalogue track's tags DID reach the model, at the export and
    // at the transport, and its estimate was stored.
    expect(prompts().some((p) => p.includes('cc0-genre-marker'))).toBe(true);
    expect(http.some((h) => h.url === LLM_URL)).toBe(true);
    expect([...repo.__store.keys()]).toEqual(['mbid:cat1']);
    expect(summary.llm).toBe(1);
    // …and nothing YouTube-derived did.
    for (const p of prompts()) expect(SENTINEL.test(p)).toBe(false);
    expect(SENTINEL.test(JSON.stringify(http))).toBe(false);
  });

  it.each(YOUTUBE_TRACKS.map((t, i) => [i, t]))('YouTube shape #%s alone: the estimator, the LLM and the store are never reached', async (_i, track) => {
    await featureService.hydrate([track]);

    expect(llmEstimator.getFeatures).not.toHaveBeenCalled();
    expect(llmCall.chatJson).not.toHaveBeenCalled();
    expect(http).toEqual([]);
    expect(repo.upsertMany).not.toHaveBeenCalled();
  });
});
