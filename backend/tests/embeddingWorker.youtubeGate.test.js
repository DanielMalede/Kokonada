'use strict';

process.env.NODE_ENV = 'test';

jest.mock('../app/repositories/audioFeatureRepo', () => ({ getMany: jest.fn(), setVibeTags: jest.fn() }));
jest.mock('../app/services/vector/vectorIndex', () => ({ upsertMany: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../app/services/vector/embedding', () => ({ buildVector: jest.fn(() => [0.1, 0.2]) }));
jest.mock('../app/services/llmClient', () => ({ isConfigured: jest.fn(() => false), generateJson: jest.fn() }));

const featureRepo = require('../app/repositories/audioFeatureRepo');
const vectorIndex = require('../app/services/vector/vectorIndex');
const worker = require('../app/workers/embedding.worker');

describe('embedding.worker — YouTube-ToS containment (defense-in-depth)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('skips a youtube: recordingKey even if it slips through upstream — embeds only mbid', async () => {
    featureRepo.getMany.mockResolvedValue(new Map([
      ['youtube:x', { canonicalKey: 'c1', bpm: 120 }],
      ['mbid:y', { canonicalKey: 'c2', bpm: 90 }],
    ]));

    const out = await worker.process({ data: { recordingKeys: ['youtube:x', 'mbid:y'] } });

    expect(out.embedded).toBe(1);
    const upserted = vectorIndex.upsertMany.mock.calls[0][0];
    expect(upserted.map(d => d.recordingKey)).toEqual(['mbid:y']);
  });

  it('a youtube-only batch upserts nothing', async () => {
    featureRepo.getMany.mockResolvedValue(new Map([['youtube:x', { canonicalKey: 'c1', bpm: 120 }]]));

    const out = await worker.process({ data: { recordingKeys: ['youtube:x'] } });

    expect(out.embedded).toBe(0);
    expect(vectorIndex.upsertMany).not.toHaveBeenCalled();
  });
});
