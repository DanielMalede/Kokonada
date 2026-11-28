'use strict';

// C-P4-0 (RA-91, S0 pre-existing; B2 round 2, fork P4-F A). The always-on `[gen.targets]` diagnostic
// in app/sockets/biometricHandler.js wrote the user's last emotion tap (`last=<JSON>`), the mood key
// derived from it, the activity, and the derived target vector (bpmCenter/bpmWidth, the energy window,
// valence, confidence) into the server log on every generation. On a heart run bpmCenter is a linear
// function of the heart rate (about 0.85·HR + 12.5), so the line was a vital by another name.
//
// The ruling: the line keeps only `tempoBand` (the coarse resting|active|peak class) and counts.
// This suite drives the REAL generation path (targetsBuilder and translate are real; only stores and
// network leaves are faked) and reads the line console.warn actually received.

process.env.NODE_ENV       = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET     = 'test-jwt-secret-for-tests-only';
process.env.LLM_API_KEY    = 'test-llm-key';
delete process.env.GROQ_API_KEY;

const fs   = require('fs');
const path = require('path');

jest.mock('axios');
jest.mock('../app/models/User', () => ({ findById: jest.fn() }));
jest.mock('../app/models/MusicProfile', () => ({ findOne: jest.fn() }));
jest.mock('../app/models/BiometricLog', () => ({ find: jest.fn() }));
jest.mock('../app/models/MedicalProfile', () => ({ findOne: jest.fn() }));
jest.mock('../app/models/PlaylistSession', () => ({
  create: jest.fn().mockResolvedValue({}), find: jest.fn(), countDocuments: jest.fn().mockResolvedValue(0),
}));
jest.mock('../app/services/spotify', () => ({
  getValidToken: jest.fn(), getRecommendations: jest.fn(), fetchVibeDiscovery: jest.fn(),
  getArtistsGenres: jest.fn(), artistGenresAvailable: jest.fn(() => true), markDiscoveryUnavailable: jest.fn(),
}));
jest.mock('../app/services/youtube', () => ({ getValidToken: jest.fn(), searchRecommendations: jest.fn() }));
jest.mock('../app/services/playlistMixer', () => ({
  personalizeWhitelist: jest.fn((t) => t), generateFallbackPlaylist: jest.fn().mockReturnValue([]),
}));
jest.mock('../app/services/features/featureService', () => ({
  hydrate: jest.fn(), enqueueHydration: jest.fn().mockResolvedValue({ queued: true }),
}));
jest.mock('../app/services/discovery/discoveryFetch', () => ({ vectorDiscoveryFetch: jest.fn(async () => []) }));
jest.mock('../app/repositories/shadowBufferRepo', () => ({
  getBuffer: jest.fn().mockResolvedValue(null), setBuffer: jest.fn().mockResolvedValue(true),
}));
jest.mock('../app/services/spotifySessionPlaylist', () => ({
  writeSessionPlaylist: jest.fn().mockResolvedValue({ contextUri: 'spotify:playlist:session-test' }),
}));
jest.mock('../app/config/redis', () => ({ getRedis: jest.fn(() => null), createConnection: jest.fn() }));
jest.mock('../app/services/ledger/serveLedger', () => ({
  recordServes: jest.fn().mockResolvedValue({ recorded: 0 }),
  hardExcluded: jest.fn().mockResolvedValue(new Set()),
  moodExcluded: jest.fn().mockResolvedValue(new Set()),
  getExposure:  jest.fn().mockResolvedValue(new Map()),
}));
jest.mock('../app/repositories/audioFeatureRepo', () => ({
  getMany: jest.fn().mockResolvedValue(new Map()), upsertMany: jest.fn(), missingKeys: jest.fn(),
  setVibeTags: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../app/services/vector/vectorIndex', () => ({
  getMany: jest.fn().mockResolvedValue(new Map()), upsertMany: jest.fn().mockResolvedValue(undefined),
  queryNear: jest.fn(), use: jest.fn(),
}));
// targetsBuilder and translate stay REAL: the line must be judged on the targets a run really builds.
jest.mock('../app/services/biosonic/baselines', () => ({ peekBaselines: jest.fn().mockResolvedValue(null) }));
jest.mock('../app/repositories/sleepHistoryRepo', () => ({ readNightHistory: jest.fn(async () => []) }));
jest.mock('../app/services/biosonic/affectService', () => {
  const actual = jest.requireActual('../app/services/biosonic/affectService');
  actual.resolveAffect = jest.fn(async () => null);
  return actual;
});
jest.mock('../app/services/privacy/consent', () => ({
  getConsentStatus: jest.fn().mockResolvedValue({ granted: true, currentVersion: 1, staleVersion: false }),
  HEALTH_CONSENT_PURPOSE: 'health_biometric_processing',
}));

const axios          = require('axios');
const User           = require('../app/models/User');
const MusicProfile   = require('../app/models/MusicProfile');
const BiometricLog   = require('../app/models/BiometricLog');
const MedicalProfile = require('../app/models/MedicalProfile');
const spotify        = require('../app/services/spotify');
const { generateAndEmitPlaylist, formatGenTargetsLog } = require('../app/sockets/biometricHandler');

const HANDLER_SRC = fs.readFileSync(path.join(__dirname, '..', 'app', 'sockets', 'biometricHandler.js'), 'utf8');

const PARAMS = {
  target_bpm: 110, target_energy: 0.6, target_valence: 0.5, target_acousticness: 0.3,
  seed_artists: [], seed_genres: ['electronic'], mood_keywords: ['calm'],
};
const USER = { _id: 'user-zk', spotifyToken: { blob: 'x' }, youtubeMusicToken: null, getToken: jest.fn(), save: jest.fn().mockResolvedValue(true) };
const REQ_ID = 'req-zk';
const HR = 137;
// A distinctive planted tap: coordinates no target or count would ever print, plus a label and free
// text an older client (or a future field) could carry on the held tap.
const TAP = { x: 0.4321, y: -0.8765, label: 'zz-grief-label', text: 'zz my sister died today' };

function profileQuery(value) { const q = Promise.resolve(value); q.lean = () => Promise.resolve(value); return q; }
const socket = () => ({ id: 'socket-user-zk', data: { user: { _id: 'user-zk' } }, emit: jest.fn(), on: jest.fn() });

const genTargetsLines = () => console.warn.mock.calls
  .map((args) => args.map(String).join(' '))
  .filter((line) => line.startsWith('[gen.targets]'));

async function emotionRun() {
  const state = {
    stableHR: null, pendingHR: null, latestActivity: null, timer: null, consecutiveSkips: 0,
    lastEmotionTaps: [{ x: 0.1, y: 0.2 }, TAP], lastTextPrompt: 'zz free note', lastActivity: 'running',
    lastReqId: REQ_ID,
  };
  await generateAndEmitPlaylist(socket(), 'emotion', state);
  return genTargetsLines();
}

async function heartRun() {
  const state = {
    stableHR: HR, pendingHR: null, latestActivity: null, timer: null, consecutiveSkips: 0,
    lastEmotionTaps: [], lastTextPrompt: '', lastActivity: null, lastReqId: REQ_ID,
  };
  await generateAndEmitPlaylist(socket(), 'heart', state);
  return genTargetsLines();
}

// The ruled shape, whole: tag, reqId, a count, the coarse band. Nothing else may appear.
const RULED_SHAPE = /^\[gen\.targets\] reqId=req-zk taps=\d+ tempoBand=(resting|active|peak|null|undefined)$/;

beforeEach(() => {
  jest.clearAllMocks();
  axios.post.mockResolvedValue({ status: 200, data: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(PARAMS) } }] } });
  for (const l of ['warn', 'info', 'error', 'log']) jest.spyOn(console, l).mockImplementation(() => {});
  User.findById.mockResolvedValue(USER);
  MusicProfile.findOne.mockReturnValue(profileQuery({
    userId: 'user-zk', library: [{ id: 'fam1', provider: 'spotify', name: 'F', artist: 'A', genres: ['pop'], affinity: 10, uri: 'spotify:track:fam1' }],
    lastAnalyzed: new Date('2026-07-01'), topGenres: ['pop'], genreSet: ['pop'], knownArtistIds: [],
  }));
  MedicalProfile.findOne.mockResolvedValue(null);
  BiometricLog.find.mockReturnValue({ sort: () => ({ limit: () => Promise.resolve([]) }) });
  spotify.getValidToken.mockResolvedValue('tok');
});
afterEach(() => { jest.restoreAllMocks(); });

describe('[gen.targets] on the real generation path writes only tempoBand and counts (C-P4-0)', () => {
  it('a mood run: none of the tap, the note, the mood key, the activity or the target numbers reach the line', async () => {
    const lines = await emotionRun();
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line).toMatch(RULED_SHAPE);
    expect(line).toContain('taps=2');
    expect(line).toMatch(/tempoBand=(resting|active|peak)/);
    for (const banned of ['zz-grief-label', 'zz my sister', 'zz free note', '0.4321', '-0.8765', 'last=',
      'moodKey=', 'activity=', 'running', 'bpmCenter', 'bpmWidth', 'energy', 'valence', 'conf']) {
      expect(line).not.toContain(banned);
    }
  });

  it('a heart run at HR 137: no number within 2 of 0.85*137 + 12.5 (bpmCenter is the vital by another name)', async () => {
    const lines = await heartRun();
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line).toMatch(RULED_SHAPE);
    expect(line).toContain('taps=0');
    const derived = 0.85 * HR + 12.5;
    const numbers = (line.match(/-?\d+(\.\d+)?/g) || []).map(Number);
    expect(numbers.filter((n) => Math.abs(n - derived) <= 2)).toEqual([]);
    expect(numbers).not.toContain(HR);
    expect(line).not.toMatch(/bio:/); // the synthetic bio:<band>:<activity> mood key stays out too
  });
});

describe('formatGenTargetsLog (the one place the line is built)', () => {
  const TARGETS = { bpmCenter: 128.95, bpmWidth: 14.5, energyFloor: 0.61, energyCeiling: 0.93, valenceTarget: 0.17, confidence: 0.77, tempoBand: 'active' };

  it('keeps reqId, the tap count and tempoBand, and reads nothing else off the taps or targets', () => {
    const line = formatGenTargetsLog({ reqId: 'r1', taps: [{ x: 0.1, y: 0.2 }, TAP], targets: TARGETS });
    expect(line).toBe('[gen.targets] reqId=r1 taps=2 tempoBand=active');
  });

  it('a run with no taps and no targets still prints a well-formed line', () => {
    expect(formatGenTargetsLog({ reqId: 'r2', taps: undefined, targets: undefined }))
      .toBe('[gen.targets] reqId=r2 taps=0 tempoBand=null');
  });

  it('a tempoBand outside the closed vocabulary is not echoed (no free-form value reaches the line)', () => {
    expect(formatGenTargetsLog({ reqId: 'r3', taps: [], targets: { tempoBand: 'zz my sister died today' } }))
      .toBe('[gen.targets] reqId=r3 taps=0 tempoBand=null');
  });
});

describe('TRIPWIRE: the [gen.targets] call site is the formatter, nothing interpolated beside it', () => {
  it('the source builds the line only through formatGenTargetsLog', () => {
    const sites = HANDLER_SRC.split('\n').filter((t) => t.includes('[gen.targets]') && /console\.|log\(/.test(t));
    expect(sites).toEqual([]); // the tag lives in the formatter's return, not in a console call
    const calls = HANDLER_SRC.split('\n').filter((t) => /console\.\w+\(\s*formatGenTargetsLog\(/.test(t));
    expect(calls).toHaveLength(1);
    expect(HANDLER_SRC).not.toMatch(/last=\$\{JSON\.stringify\(_lastTap\)\}/);
  });
});
