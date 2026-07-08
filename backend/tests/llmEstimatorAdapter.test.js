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

  it('the prompt carries genre anchors and the numbered track list', async () => {
    llmClient.generateJson.mockResolvedValue(estimatesResponse([]));

    await adapter.getFeatures([yt('v1', 'Midnight Drive', ['synthwave'])]);

    const prompt = llmClient.generateJson.mock.calls[0][0];
    expect(prompt).toMatch(/anchor/i);
    expect(prompt).toContain('Midnight Drive');
    expect(prompt).toContain('synthwave');
    expect(prompt).toMatch(/"i"/); // index-joined output contract
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
});
