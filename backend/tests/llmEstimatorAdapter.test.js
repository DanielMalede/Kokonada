'use strict';

process.env.NODE_ENV = 'test';

jest.mock('../app/services/llmClient', () => ({
  generateJson: jest.fn(),
  isConfigured: jest.fn().mockReturnValue(true),
}));
const llmClient = require('../app/services/llmClient');

const adapter = require('../app/services/features/llmEstimatorAdapter');

const yt = (id, title = `Song ${id}`, genres = ['pop']) =>
  ({ provider: 'youtube_music', id, title, artist: 'Artist', genres });

function estimatesResponse(estimates) {
  return JSON.stringify({ estimates });
}

beforeEach(() => {
  jest.clearAllMocks();
  llmClient.isConfigured.mockReturnValue(true);
  delete process.env.FEATURE_LLM_BATCH;
});

describe('llmEstimatorAdapter.getFeatures — engineered fallback', () => {
  it('estimates features joined by index, clamped, confidence hard-capped at 0.7', async () => {
    llmClient.generateJson.mockResolvedValue(estimatesResponse([
      { i: 0, bpm: 500, energy: 0.9, valence: 0.5, acousticness: 0.1, danceability: 0.8, loudness: -6, confidence: 0.99 },
    ]));

    const [r] = await adapter.getFeatures([yt('v1')]);

    expect(r.recordingKey).toBe('youtube:v1');
    expect(r.source).toBe('llm');
    expect(r.features.bpm).toBe(260);        // hallucinated 500 clamped
    expect(r.confidence).toBeLessThanOrEqual(0.7); // never trusted like a measurement
  });

  it('the prompt carries genre anchors + genre tags and the numbered list, NEVER the title', async () => {
    llmClient.generateJson.mockResolvedValue(estimatesResponse([]));

    await adapter.getFeatures([yt('v1', 'Midnight Drive', ['synthwave'])]);

    const prompt = llmClient.generateJson.mock.calls[0][0];
    expect(prompt).toMatch(/anchor/i);
    expect(prompt).toContain('synthwave');          // genre tag drives the estimate
    expect(prompt).not.toContain('Midnight Drive'); // title must not egress
    expect(prompt).toMatch(/"i"/); // index-joined output contract
  });

  // LLM-egress boundary guard: a track's title / artist must NEVER leave the process in the
  // outbound estimator request. Only its genre tags (+ the anchor table) may be sent.
  it('egress guard: track title / artist never appear in the outbound estimator prompt', async () => {
    llmClient.generateJson.mockResolvedValue(estimatesResponse([]));
    const SENTINEL_TITLE  = 'ZZ_TITLE_SENTINEL_7742';
    const SENTINEL_ARTIST = 'ZZ_ARTIST_SENTINEL_7742';

    await adapter.getFeatures([
      { provider: 'youtube_music', id: 'v1', title: SENTINEL_TITLE, artist: SENTINEL_ARTIST, genres: ['ambient'] },
    ]);

    const outbound = JSON.stringify(llmClient.generateJson.mock.calls);
    expect(outbound).not.toContain(SENTINEL_TITLE);
    expect(outbound).not.toContain(SENTINEL_ARTIST);
    expect(outbound).toContain('ambient'); // genre tags still drive the estimate
  });

  // Contract pin — featureService.js L85 calls llmEstimator.getFeatures(...) and Wave 1
  // depends on this exact shape. Signature + return shape must not drift.
  it('contract: exports and getFeatures return shape are unchanged', async () => {
    llmClient.generateJson.mockResolvedValue(estimatesResponse([
      { i: 0, bpm: 120, energy: 0.5, valence: 0.5, acousticness: 0.2, danceability: 0.6, loudness: -8, confidence: 0.5 },
    ]));

    expect(typeof adapter.supports).toBe('function');
    expect(typeof adapter.getFeatures).toBe('function');
    expect(adapter.CONFIDENCE_CAP).toBe(0.7);

    const results = await adapter.getFeatures([yt('v1')]);
    expect(Array.isArray(results)).toBe(true);
    expect(Object.keys(results[0]).sort()).toEqual(['confidence', 'features', 'recordingKey', 'source', 'track']);
    expect(results[0].source).toBe('llm');
  });

  it('malformed JSON from the model yields features:null for the batch — never throws', async () => {
    llmClient.generateJson.mockResolvedValue('BPM is probably around 120! {broken');

    const results = await adapter.getFeatures([yt('v1'), yt('v2')]);

    expect(results).toHaveLength(2);
    expect(results.every(r => r.features === null)).toBe(true);
  });

  it('tolerates code-fenced JSON despite json_object mode (defense in depth)', async () => {
    llmClient.generateJson.mockResolvedValue(
      '```json\n' + estimatesResponse([{ i: 0, bpm: 120, energy: 0.5, confidence: 0.5 }]) + '\n```'
    );

    const [r] = await adapter.getFeatures([yt('v1')]);

    expect(r.features.bpm).toBe(120);
  });

  it('ignores hallucinated indices and keeps the first estimate on duplicates', async () => {
    llmClient.generateJson.mockResolvedValue(estimatesResponse([
      { i: 7, bpm: 100, confidence: 0.5 },          // no such track
      { i: 0, bpm: 110, energy: 0.4, confidence: 0.5 },
      { i: 0, bpm: 999, energy: 1, confidence: 0.7 }, // duplicate — dropped
    ]));

    const [r] = await adapter.getFeatures([yt('v1')]);

    expect(r.features.bpm).toBe(110);
  });

  it('splits into FEATURE_LLM_BATCH-sized calls', async () => {
    process.env.FEATURE_LLM_BATCH = '2';
    llmClient.generateJson.mockResolvedValue(estimatesResponse([]));

    await adapter.getFeatures([yt('a'), yt('b'), yt('c')]);

    expect(llmClient.generateJson).toHaveBeenCalledTimes(2);
  });

  it('a model call that rejects degrades that batch to nulls', async () => {
    llmClient.generateJson.mockRejectedValue(new Error('Groq 503'));

    const results = await adapter.getFeatures([yt('v1')]);

    expect(results[0].features).toBeNull();
  });

  it('gives the bulk hydration path extra retry budget so rate-limited batches back off, not dropped', async () => {
    llmClient.generateJson.mockResolvedValue(estimatesResponse([]));

    await adapter.getFeatures([yt('v1')]);

    const opts = llmClient.generateJson.mock.calls[0][1];
    expect(opts.retries).toBeGreaterThanOrEqual(5);
  });

  it('short-circuits to nulls when no LLM is configured (no request made)', async () => {
    llmClient.isConfigured.mockReturnValue(false);

    const results = await adapter.getFeatures([yt('v1')]);

    expect(results[0].features).toBeNull();
    expect(llmClient.generateJson).not.toHaveBeenCalled();
  });
});

describe('shadow audit — LLM output poisoning', () => {
  it('accepts sloppy string indices ("0") instead of silently dropping usable estimates', async () => {
    llmClient.generateJson.mockResolvedValue(estimatesResponse([
      { i: '0', bpm: 118, energy: 0.5, confidence: 0.5 },
    ]));

    const [r] = await adapter.getFeatures([yt('v1')]);

    expect(r.features.bpm).toBe(118);
  });

  it('a top-level array (schema violation) degrades to nulls, never crashes', async () => {
    llmClient.generateJson.mockResolvedValue(JSON.stringify([{ i: 0, bpm: 120 }]));

    const [r] = await adapter.getFeatures([yt('v1')]);

    expect(r.features).toBeNull();
  });

  it('non-numeric confidence ("high") falls to the conservative default, still capped', async () => {
    llmClient.generateJson.mockResolvedValue(estimatesResponse([
      { i: 0, bpm: 120, energy: 0.5, confidence: 'high' },
    ]));

    const [r] = await adapter.getFeatures([yt('v1')]);

    expect(r.confidence).toBeGreaterThan(0);
    expect(r.confidence).toBeLessThanOrEqual(0.7);
  });

  it('a zero/garbage FEATURE_LLM_BATCH cannot infinite-loop the adapter', async () => {
    process.env.FEATURE_LLM_BATCH = '0';
    llmClient.generateJson.mockResolvedValue(estimatesResponse([]));

    const results = await adapter.getFeatures([yt('a'), yt('b')]);

    expect(results).toHaveLength(2);
    delete process.env.FEATURE_LLM_BATCH;
  }, 2000);

  // Coercion fuzz: a model that emits out-of-domain numerics (JSON has no NaN/Infinity, but
  // 1e999 parses to Infinity) or a non-numeric confidence must NOT poison the store — every
  // surviving value is finite and in-range, confidence is a capped finite number, no throw.
  it('fuzz: Infinity/NaN feature values and a string confidence are clamped/coerced, never poisoned', async () => {
    llmClient.generateJson.mockResolvedValue(
      '{"estimates":[{"i":0,"bpm":1e999,"energy":-1e999,"valence":"NaN","acousticness":0.2,"danceability":0.6,"loudness":-8,"confidence":"abc"}]}'
    );

    const results = await adapter.getFeatures([yt('v1')]);

    const r = results[0];
    if (r.features) {
      for (const v of Object.values(r.features)) {
        expect(v === null || Number.isFinite(v)).toBe(true);
      }
      expect(r.features.acousticness).toBe(0.2); // the one usable value survives
      expect(r.features.bpm).toBeNull();          // Infinity → null
    }
    expect(r.confidence === null || (Number.isFinite(r.confidence) && r.confidence >= 0 && r.confidence <= 0.7)).toBe(true);
  });
});

// §II Spotify-Content lock (compliance): a Spotify recording's genres are Spotify Content and
// must not reach the estimation model. A spotify: recordingKey is gated OUT of the prompt and
// returns features:null (featureService then retries it via the measured API path).
describe('§II — Spotify recordings are gated out of the estimator', () => {
  const spot = (id = 'sp1', genres = ['rock']) => ({ provider: 'spotify', id, title: `S ${id}`, artist: 'A', genres });

  it('a spotify: track is never sent to the LLM and returns features:null', async () => {
    llmClient.generateJson.mockResolvedValue(estimatesResponse([{ i: 0, bpm: 120, energy: 0.5, confidence: 0.5 }]));

    const results = await adapter.getFeatures([spot()]);

    expect(llmClient.generateJson).not.toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(results[0].recordingKey).toMatch(/^spotify:/i);
    expect(results[0].features).toBeNull();
  });

  it('mixed batch: youtube is estimated, spotify is withheld and its genres never reach the prompt', async () => {
    llmClient.generateJson.mockResolvedValue(estimatesResponse([{ i: 0, bpm: 120, energy: 0.5, confidence: 0.5 }]));

    const results = await adapter.getFeatures([spot('sp1', ['rock']), yt('v1', 'Song v1', ['pop'])]);

    expect(llmClient.generateJson).toHaveBeenCalledTimes(1);
    const prompt = llmClient.generateJson.mock.calls[0][0];
    expect(prompt).toContain('pop');
    expect(prompt).not.toContain('rock'); // spotify genres withheld
    const spotRes = results.find(r => /^spotify:/i.test(r.recordingKey));
    const ytRes   = results.find(r => /^youtube:/i.test(r.recordingKey));
    expect(spotRes.features).toBeNull();
    expect(ytRes.features).not.toBeNull();
  });

  it('an all-spotify batch makes ZERO LLM calls', async () => {
    llmClient.generateJson.mockResolvedValue(estimatesResponse([]));

    const results = await adapter.getFeatures([spot('s1'), spot('s2')]);

    expect(llmClient.generateJson).not.toHaveBeenCalled();
    expect(results).toHaveLength(2);
    expect(results.every(r => r.features === null)).toBe(true);
  });
});
