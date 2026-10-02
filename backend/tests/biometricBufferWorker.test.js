'use strict';

process.env.NODE_ENV = 'test';

jest.mock('../app/services/generation/orchestrator', () => ({ generateV2: jest.fn() }));
jest.mock('../app/repositories/shadowBufferRepo', () => ({ setBuffer: jest.fn() }));
jest.mock('../app/models/MusicProfile', () => ({ findOne: jest.fn() }));
jest.mock('../app/services/ledger/serveLedger', () => ({ recordServes: jest.fn() }));

const orchestrator = require('../app/services/generation/orchestrator');
const shadowBufferRepo = require('../app/repositories/shadowBufferRepo');
const MusicProfile = require('../app/models/MusicProfile');
const serveLedger = require('../app/services/ledger/serveLedger');
const bufferWorker = require('../app/workers/biometricBuffer.worker');

const lean = (v) => ({ lean: () => Promise.resolve(v) });

beforeEach(() => {
  jest.clearAllMocks();
  MusicProfile.findOne.mockReturnValue(lean({ library: [{ id: 'a' }] }));
  orchestrator.generateV2.mockResolvedValue({
    merged: [{ uri: 'spotify:track:x' }], targets: { bpmCenter: 162 }, telemetry: {},
  });
  shadowBufferRepo.setBuffer.mockResolvedValue(true);
});

describe('biometricBuffer.worker', () => {
  it('precompiles via generateV2 (cached features, live HR/activity) and stores the buffer', async () => {
    const r = await bufferWorker.process({ data: { userId: 'u1', bioMoodKey: 'bio:peak:running', heartRate: 150, activity: 'running' } });

    expect(orchestrator.generateV2).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'u1',
      live: { heartRate: 150, activity: 'running' },
    }));
    expect(shadowBufferRepo.setBuffer).toHaveBeenCalledWith('u1', 'bio:peak:running',
      expect.objectContaining({ tracks: [{ uri: 'spotify:track:x' }] }));
    expect(r.stored).toBe(true);
  });

  it('records NO serves on precompile — serves happen only on play (§3.5)', async () => {
    await bufferWorker.process({ data: { userId: 'u1', bioMoodKey: 'bio:active:none', heartRate: 100 } });
    expect(serveLedger.recordServes).not.toHaveBeenCalled();
  });

  // HX-3 resilience NF1 (DEC-122, DEC-040): the worker loads the profile itself, so it reads the same
  // YouTube-free view generation reads (musicProfileService.withoutYoutube, real here). The worker has
  // no producer today; this keeps it from becoming the one generation path that sees YouTube rows.
  it('hands generateV2 the YouTube-free view of the profile: no YouTube row, genre or artist', async () => {
    MusicProfile.findOne.mockReturnValue(lean({
      userId: 'u1',
      topGenres: ['ytsentinelgenre', 'house'],
      topArtists: ['YTSENTINEL Channel', 'Spotify Artist'],
      genreSet: ['ytsentinelgenre', 'house'],
      library: [
        { id: 'vid1', provider: 'youtube_music', name: 'YTSENTINEL Song', artist: 'YTSENTINEL Channel', genres: ['ytsentinelgenre'] },
        { id: 'sp1', provider: 'spotify', uri: 'spotify:track:sp1', name: 'House One', artist: 'Spotify Artist', genres: ['house'] },
      ],
    }));

    await bufferWorker.process({ data: { userId: 'u1', bioMoodKey: 'bio:peak:running', heartRate: 150, activity: 'running' } });

    const { musicProfile } = orchestrator.generateV2.mock.calls[0][0];
    expect(musicProfile.library.map((t) => t.id)).toEqual(['sp1']);
    expect(JSON.stringify(musicProfile)).not.toMatch(/ytsentinel|vid1/i);
  });

  it('a profile with no YouTube row reaches generateV2 as the same object, and a missing one as {}', async () => {
    const spotifyOnly = { userId: 'u1', topGenres: ['house'], library: [{ id: 'sp1', provider: 'spotify', genres: ['house'] }] };
    MusicProfile.findOne.mockReturnValue(lean(spotifyOnly));
    await bufferWorker.process({ data: { userId: 'u1', bioMoodKey: 'bio:active:none', heartRate: 100 } });
    expect(orchestrator.generateV2.mock.calls[0][0].musicProfile).toBe(spotifyOnly);

    MusicProfile.findOne.mockReturnValue(lean(null));
    await bufferWorker.process({ data: { userId: 'u1', bioMoodKey: 'bio:active:none', heartRate: 100 } });
    expect(orchestrator.generateV2.mock.calls[1][0].musicProfile).toEqual({});
  });

  it('skips a job missing its user or bio-mood key (never generates)', async () => {
    const r = await bufferWorker.process({ data: { heartRate: 120 } });
    expect(r).toEqual({ skipped: 'missing-key' });
    expect(orchestrator.generateV2).not.toHaveBeenCalled();
    expect(shadowBufferRepo.setBuffer).not.toHaveBeenCalled();
  });
});
