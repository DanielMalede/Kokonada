'use strict';

// BE-231 — Spotify receives no value derived from medical information, the sleep note's effect
// included; the health filtering happens here, after the results come back (the owner's ruling of
// 2026-10-28: "Spotify לא יקבל שום ערך שנגזר ממידע רפואי, כולל ההשפעה של הערת שינה. הסינון לפי
// בריאות יקרה אצלנו אחרי שהתוצאות חוזרות.").
//
// The REAL spotify.js runs under a mocked axios: a stateful fake Spotify that answers each endpoint
// from what it was asked (the same request always gets the same answer, so a byte-identical request
// log is a byte-identical run), and records every request. The socket handler's generate path, the
// generation core and the mood descriptors run for real too; the fake Groq of llmHealthEgress.test.js
// answers the emotion prompt. Every assertion reads the requests spotify.js actually produced.
//
// Three kinds of proof, each with /recommendations answering 200 and answering 403 (the fallback
// search path):
//   · invariance — the Spotify request log is byte-identical while the heart rate, the baseline
//     ratio, the state label, the watch activity, the kill switch, band-aware targets, the stored
//     health profile and a note about sleep vary. A request that does not change cannot carry what
//     changed.
//   · vocabulary — no request carries a target_*, min_* or max_* audio key.
//   · the local effect is kept — the params the run served still move with the band and with a
//     sleep note, so the health filtering moved here rather than disappearing.

process.env.NODE_ENV       = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET     = 'test-jwt-secret-for-tests-only';
process.env.LLM_API_KEY    = 'test-llm-key';
delete process.env.GROQ_API_KEY;
delete process.env.GEMINI_API_KEY;

jest.mock('axios');

// ── The handler's data layer and non-Spotify upstreams (spotify.js itself stays REAL) ─────────
jest.mock('../app/models/User', () => ({ findById: jest.fn() }));
jest.mock('../app/models/MusicProfile', () => ({ findOne: jest.fn() }));
jest.mock('../app/models/BiometricLog', () => ({ find: jest.fn() }));
jest.mock('../app/models/MedicalProfile', () => ({ findOne: jest.fn() }));
jest.mock('../app/models/PlaylistSession', () => ({
  create:         jest.fn().mockResolvedValue({}),
  find:           jest.fn(),
  countDocuments: jest.fn().mockResolvedValue(0),
}));
jest.mock('../app/services/youtube', () => ({ getValidToken: jest.fn(), searchRecommendations: jest.fn() }));
jest.mock('../app/services/playlistMixer', () => ({
  personalizeWhitelist: jest.fn((t) => t),
  generateFallbackPlaylist: jest.fn().mockReturnValue([]),
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
jest.mock('../app/services/biosonic/baselines', () => ({ peekBaselines: jest.fn().mockResolvedValue(null) }));
jest.mock('../app/repositories/sleepHistoryRepo', () => ({ readNightHistory: jest.fn(async () => []) }));
jest.mock('../app/services/biosonic/affectService', () => {
  const actual = jest.requireActual('../app/services/biosonic/affectService');
  actual.resolveAffect = jest.fn(async () => null);
  return actual;
});
jest.mock('../app/services/biosonic/translate', () => {
  const actual = jest.requireActual('../app/services/biosonic/translate');
  actual.translate = jest.fn(() => ({}));
  return actual;
});
jest.mock('../app/services/privacy/consent', () => ({
  getConsentStatus:       jest.fn().mockResolvedValue({ granted: true, currentVersion: 1, staleVersion: false }),
  HEALTH_CONSENT_PURPOSE: 'health_biometric_processing',
}));

const crypto = require('crypto');

const SPOTIFY_API = 'https://api.spotify.com/v1';
const DISCOVERY_PATH = /^\/(recommendations|search|artists|playlists\/[^/]+\/tracks)$/;

// The modules a world is made of. The main world is the real module graph; the isolated world of the
// fail-closed test swaps the generation core for one that forgets the query.
function loadWorld() {
  return {
    axios:          require('axios'),
    User:           require('../app/models/User'),
    MusicProfile:   require('../app/models/MusicProfile'),
    BiometricLog:   require('../app/models/BiometricLog'),
    MedicalProfile: require('../app/models/MedicalProfile'),
    spotify:        require('../app/services/spotify'),
    featureRepo:    require('../app/repositories/audioFeatureRepo'),
    baselines:      require('../app/services/biosonic/baselines'),
    sleepHistory:   require('../app/repositories/sleepHistoryRepo'),
    affectService:  require('../app/services/biosonic/affectService'),
    biosonic:       require('../app/services/biosonic/translate'),
    discoveryFetch: require('../app/services/discovery/discoveryFetch'),
    engine:         require('../app/services/geminiEngine'),
    handler:        require('../app/sockets/biometricHandler'),
  };
}
const W = loadWorld();

// ── The fake Groq (the emotion prompt's answer) ──────────────────────────────────────────────────

const PARAMS = {
  target_bpm: 110, target_energy: 0.6, target_valence: 0.5, target_acousticness: 0.3,
  seed_artists: [], seed_genres: ['electronic'], mood_keywords: ['calm', 'warm'],
};
function installFakeGroq(axios) {
  axios.post.mockImplementation(async (url) => {
    if (String(url).startsWith(SPOTIFY_API)) throw new Error(`unexpected Spotify POST ${url}`);
    return { status: 200, data: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(PARAMS) } }] } };
  });
}

// ── The fake Spotify: deterministic per request, stateful in what it records ────────────────────

const fake = { recommendationsStatus: 200 };
const tag = (v) => crypto.createHash('md5').update(JSON.stringify(v)).digest('hex').slice(0, 8);
const track = (id) => ({ id, uri: `spotify:track:${id}`, name: `Track ${id}`, artists: [{ id: `art-${id}`, name: `Artist ${id}` }] });
function httpError(status) {
  return Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, headers: {} } });
}
function installFakeSpotify(axios) {
  axios.get.mockImplementation(async (url, config = {}) => {
    const u = String(url);
    if (!u.startsWith(SPOTIFY_API)) throw new Error(`unexpected GET ${u}`);
    const p = config.params || {};
    const route = u.slice(SPOTIFY_API.length);
    if (route === '/recommendations') {
      if (fake.recommendationsStatus !== 200) throw httpError(fake.recommendationsStatus);
      return { data: { tracks: [1, 2, 3].map((i) => track(`rec-${tag(p)}-${i}`)) } };
    }
    if (route === '/search' && p.type === 'track') return { data: { tracks: { items: [1, 2].map((i) => track(`s-${tag(p.q)}-${i}`)) } } };
    if (route === '/search' && p.type === 'playlist') return { data: { playlists: { items: [{ id: `pl-${tag(p.q)}` }] } } };
    const pl = route.match(/^\/playlists\/([^/]+)\/tracks$/);
    if (pl) return { data: { items: [1, 2].map((i) => ({ track: track(`p-${pl[1]}-${i}`) })) } };
    if (route === '/artists') return { data: { artists: String(p.ids).split(',').map((id) => ({ id, genres: ['pop'] })) } };
    throw httpError(404);
  });
  axios.put.mockImplementation(async (url) => { throw new Error(`unexpected PUT ${url}`); });
}

// Every Spotify GET, in call order, as `route {params}` with the params' keys sorted. Headers carry
// only the fixed test token, so they add nothing a comparison could miss.
function spotifyRequests(axios) {
  return axios.get.mock.calls
    .filter(([url]) => String(url).startsWith(SPOTIFY_API))
    .map(([url, config = {}]) => {
      const p = config.params || {};
      const sorted = Object.fromEntries(Object.keys(p).sort().map((k) => [k, p[k]]));
      return `${String(url).slice(SPOTIFY_API.length)} ${JSON.stringify(sorted)}`;
    });
}
const discoveryRequests = (axios) => spotifyRequests(axios).filter((line) => DISCOVERY_PATH.test(line.split(' ')[0]));
const AUDIO_KEY = /"(?:target|min|max)_[a-z_]+"/;

// ── Fixtures ─────────────────────────────────────────────────────────────────────────────────────

const SPOTIFY_USER = {
  _id: 'user-123', spotifyToken: { blob: 'encrypted-spotify' }, youtubeMusicToken: null,
  getToken: jest.fn(), save: jest.fn().mockResolvedValue(true),
};
const LIBRARY = [{ id: 'fam1', provider: 'spotify', name: 'Familiar 1', artist: 'Fam Artist', genres: ['pop'], affinity: 10, uri: 'spotify:track:fam1' }];
const VECTOR_DISCO = {
  id: 'disco1', provider: 'spotify', recordingKey: 'youtube:disco1',
  title: 'Disco One', name: 'Disco One', artist: 'Disco Artist', genres: ['pop'], uri: 'spotify:track:disco1',
};
const HEALTH_PROFILE = { restingHeartRate: 70, hrv: 40, bodyBattery: 30, dailyReadiness: 45, sleepStages: { deep: 50, light: 200, rem: 60 } };
const CALM = [{ x: 0.45, y: -0.55 }];
const TOP_GENRES = ['pop', 'indie', 'ambient'];

function musicProfileQuery(value) {
  const q = Promise.resolve(value);
  q.lean = () => Promise.resolve(value);
  return q;
}
const socket = () => ({ id: 'socket-user-123', data: { user: { _id: 'user-123' } }, emit: jest.fn(), on: jest.fn() });
const state = (overrides = {}) => ({
  stableHR: null, pendingHR: null, latestActivity: null, timer: null, consecutiveSkips: 0,
  lastEmotionTaps: CALM, lastTextPrompt: '', lastActivity: null,
  ...overrides,
});
const readyOf = (s) => s.emit.mock.calls.find((c) => c[0] === 'playlist_ready')?.[1];

const ENV_KEYS = ['VECTOR_DISCOVERY', 'DISCOVERY_BAND_AWARE', 'WAVE4_LLM_BAND_FROM_STATE_DISABLED', 'DISCOVERY_CAPTION_LLM', 'VIBE_PLAYLIST_SOURCING'];

function arrange(m) {
  jest.clearAllMocks();
  installFakeGroq(m.axios);
  installFakeSpotify(m.axios);
  m.spotify._resetArtistGenresCache();
  jest.spyOn(m.spotify, 'getValidToken').mockResolvedValue('spotify-access-token');
  m.User.findById.mockResolvedValue(SPOTIFY_USER);
  m.MusicProfile.findOne.mockReturnValue(musicProfileQuery({
    userId: 'user-123', library: LIBRARY, lastAnalyzed: new Date('2026-07-01'),
    topGenres: TOP_GENRES, genreSet: ['pop'], knownArtistIds: [],
  }));
  m.MedicalProfile.findOne.mockResolvedValue(null);
  m.BiometricLog.find.mockReturnValue({ sort: () => ({ limit: () => Promise.resolve([]) }) });
  m.discoveryFetch.vectorDiscoveryFetch.mockImplementation(async () => [{ ...VECTOR_DISCO }]);
  m.featureRepo.getMany.mockResolvedValue(new Map());
  m.biosonic.translate.mockReturnValue({});
  m.baselines.peekBaselines.mockResolvedValue(null);
  m.sleepHistory.readNightHistory.mockResolvedValue([]);
  m.affectService.resolveAffect.mockResolvedValue(null);
  for (const k of ENV_KEYS) delete process.env[k];
}

// One generate run through the real handler. Returns the Spotify discovery request log, the full
// Spotify request log and what the run served.
async function run(m, trigger, st) {
  m.axios.get.mockClear();
  m.axios.post.mockClear();
  const s = socket();
  await m.handler.generateAndEmitPlaylist(s, trigger, st);
  const ready = readyOf(s);
  expect(ready).toBeDefined(); // the run served a playlist: a silent failure is not a pass
  return { log: discoveryRequests(m.axios).join('\n'), all: spotifyRequests(m.axios), ready };
}

beforeEach(() => {
  arrange(W);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
  for (const k of ENV_KEYS) delete process.env[k];
});

describe.each([200, 403])('with /recommendations answering %i', (status) => {
  beforeEach(() => { fake.recommendationsStatus = status; });

  // A log that is identical across runs proves nothing if nothing was asked: every comparison
  // below first checks that discovery reached Spotify and that its tracks were served.
  function expectLive(r) {
    expect(r.log).not.toBe('');
    expect(r.log).toMatch(status === 200 ? /^\/recommendations /m : /^\/search .*"type":"track"/m);
    expect(r.ready.discovery).toBeGreaterThan(0);
    expect(r.log).not.toMatch(AUDIO_KEY);
  }

  // ── The heart-rate branch ──────────────────────────────────────────────────────────────────────

  describe('the heart-rate branch', () => {
    const heart = (hr, activity, extra = {}) => state({ stableHR: hr, latestActivity: activity, lastEmotionTaps: [], ...extra });

    it('sends a byte-identical request log at heart rate 50, 95 and 180, whatever the watch detected', async () => {
      const runs = [];
      for (const [hr, act] of [[50, 'resting'], [95, 'walking'], [180, 'running'], [130, null]]) runs.push(await run(W, 'biometric', heart(hr, act)));
      expectLive(runs[0]);
      for (const r of runs) expect(r.log).toBe(runs[0].log);
    });

    it('sends the same log when a baseline ratio, a state label or band-aware targets steer the band', async () => {
      const plain = await run(W, 'biometric', heart(100, 'walking'));
      expectLive(plain);

      W.baselines.peekBaselines.mockResolvedValue({ rhrMedian: 50 }); // ratio 2.0 → peak
      const ratio = await run(W, 'biometric', heart(100, 'walking'));

      process.env.DISCOVERY_BAND_AWARE = 'true';
      W.biosonic.translate.mockReturnValue({ stateId: 'exertion', bpmCenter: 160, bpmWidth: 200, energyFloor: 0, energyCeiling: 1, confidence: 0.9 });
      const label = await run(W, 'biometric', heart(100, 'walking'));

      W.biosonic.translate.mockReturnValue({ stateId: 'stress', bpmCenter: 70, bpmWidth: 200, energyFloor: 0, energyCeiling: 1, confidence: 0.9 });
      const other = await run(W, 'biometric', heart(100, 'walking'));

      for (const r of [ratio, label, other]) expect(r.log).toBe(plain.log);
    });

    it('sends the same log with the W4-016 kill switch on', async () => {
      const off = await run(W, 'biometric', heart(180, 'running'));
      process.env.WAVE4_LLM_BAND_FROM_STATE_DISABLED = 'true';
      W.baselines.peekBaselines.mockResolvedValue({ rhrMedian: 50 });
      const on = await run(W, 'biometric', heart(60, 'resting'));
      expectLive(off);
      expect(on.log).toBe(off.log);
    });

    it('asks only for the user\'s first two top genres: no band keyword', async () => {
      const r = await run(W, 'biometric', heart(180, 'running'));
      expectLive(r);
      expect(r.log).not.toMatch(/energetic|driving|high-energy|calm|mellow|soft|upbeat|groovy|steady/);
      if (status === 200) expect(r.log).toMatch(/"seed_genres":"pop,indie"/);
      expect(r.log).not.toMatch(/ambient/);
    });

    it('keeps the local effect: the served params still follow the band', async () => {
      const low  = await run(W, 'biometric', heart(50, 'resting'));
      const high = await run(W, 'biometric', heart(180, 'running'));
      expect(low.ready.params.target_bpm).toBe(88);
      expect(high.ready.params.target_bpm).toBe(151);
      expect(low.ready.params.target_energy).toBeLessThan(high.ready.params.target_energy);
      expect(low.log).toBe(high.log);
    });
  });

  // ── The emotion branch ─────────────────────────────────────────────────────────────────────────

  describe('the emotion branch', () => {
    it('sends a byte-identical log across heart rates, stored health and band-aware targets', async () => {
      const plain = await run(W, 'emotion', state());
      expectLive(plain);
      expect(plain.log).toMatch(/"type":"playlist"/); // the mood's vibe-playlist sourcing ran

      const hrs = [];
      for (const hr of [50, 180]) hrs.push(await run(W, 'emotion', state({ stableHR: hr, latestActivity: 'running' })));

      W.MedicalProfile.findOne.mockResolvedValue(HEALTH_PROFILE);
      const stored = await run(W, 'emotion', state({ stableHR: 150 }));

      process.env.DISCOVERY_BAND_AWARE = 'true';
      W.biosonic.translate.mockReturnValue({ stateId: 'exertion', bpmCenter: 160, bpmWidth: 200, energyFloor: 0, energyCeiling: 1, confidence: 0.9 });
      const banded = await run(W, 'emotion', state({ stableHR: 150 }));

      for (const r of [...hrs, stored, banded]) expect(r.log).toBe(plain.log);
    });

    it('keeps the local effect: stored vitals still move the served targets', async () => {
      const plain = await run(W, 'emotion', state());
      W.MedicalProfile.findOne.mockResolvedValue(HEALTH_PROFILE);
      const shaped = await run(W, 'emotion', state({ stableHR: 180 }));
      expect(shaped.ready.params.target_bpm).not.toBe(plain.ready.params.target_bpm);
      expect(shaped.log).toBe(plain.log);
    });

    // The lexicon's sleep row: its words, its phrases, and notes that reach it through them.
    const SLEEP_NOTES = [
      'sleep', 'sleeping', 'bedtime', 'bed', 'wind down', 'winding down', 'before bed',
      "can't sleep", 'music before bed', 'getting ready for bed', 'help me sleep tonight',
    ];

    it.each(SLEEP_NOTES)('note %p, no chip: the log is byte-identical to an empty note\'s', async (note) => {
      const empty = await run(W, 'emotion', state());
      const sleep = await run(W, 'emotion', state({ lastTextPrompt: note }));
      expectLive(empty);
      expect(sleep.log).toBe(empty.log);
    });

    it('"calm music before bed" sends what "calm music" sends', async () => {
      const calm = await run(W, 'emotion', state({ lastTextPrompt: 'calm music' }));
      const calmBeforeBed = await run(W, 'emotion', state({ lastTextPrompt: 'calm music before bed' }));
      expectLive(calm);
      expect(calmBeforeBed.log).toBe(calm.log);
    });

    it('keeps the local effect: a sleep note still serves resting, lower-tempo params', async () => {
      const empty = await run(W, 'emotion', state());
      const beforeBed = await run(W, 'emotion', state({ lastTextPrompt: 'music before bed' }));
      expect(beforeBed.ready.params.tempo_category).toBe('resting');
      expect(beforeBed.ready.params.target_bpm).toBeLessThan(empty.ready.params.target_bpm);
      expect(beforeBed.ready.params.target_energy).toBeLessThan(empty.ready.params.target_energy);
      expect(beforeBed.log).toBe(empty.log);
    });

    it('a note that is not about sleep still reaches the query (the fence withholds health, not intent)', async () => {
      const empty = await run(W, 'emotion', state());
      const energetic = await run(W, 'emotion', state({ lastTextPrompt: 'something energetic' }));
      expect(energetic.log).not.toBe(empty.log);
    });
  });

  // ── Vector discovery, and a caller that forgets the query ──────────────────────────────────────

  it('VECTOR_DISCOVERY=true: no Spotify discovery request on either branch, and the local params still differ', async () => {
    process.env.VECTOR_DISCOVERY = 'true';
    const heartLow  = await run(W, 'biometric', state({ stableHR: 50, latestActivity: 'resting', lastEmotionTaps: [] }));
    const heartHigh = await run(W, 'biometric', state({ stableHR: 180, latestActivity: 'running', lastEmotionTaps: [] }));
    const mood      = await run(W, 'emotion', state({ lastTextPrompt: 'music before bed' }));
    for (const r of [heartLow, heartHigh, mood]) {
      expect(r.log).toBe('');
      expect(r.ready.discovery).toBeGreaterThan(0); // the vector corpus served: the run was live
    }
    const aiParams = W.discoveryFetch.vectorDiscoveryFetch.mock.calls.map(([a]) => a.aiParams.target_bpm);
    expect(aiParams).toEqual([88, 151, expect.any(Number)]);
  });

  it('every request of every run carries no target_*, min_* or max_* key', async () => {
    const lines = [];
    for (const st of [
      ['biometric', state({ stableHR: 180, latestActivity: 'running', lastEmotionTaps: [] })],
      ['emotion', state({ stableHR: 50, lastTextPrompt: 'calm music before bed' })],
    ]) lines.push(...(await run(W, ...st)).all);
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).not.toMatch(AUDIO_KEY);
  });
});

// ── The query against a prompt-sensitive model ───────────────────────────────────────────────────
// The fake Groq above answers the same PARAMS whatever it is asked, so a sleep intent that re-entered
// the prompt would change nothing it returns, and an equality of two queries could hold vacuously.
// Here the model's answer is a function of the prompt itself (a sha256 of it picks the genres, a
// keyword carrying the digest, and the tempo), so two queries are equal only if the two prompts were.
// The generation core runs for real; fetchTracks records the DiscoveryQuery it is handed.

describe('the DiscoveryQuery against a prompt-sensitive model (RA-2)', () => {
  const GENRE_POOL   = ['ambient', 'jazz', 'folk', 'classical', 'soul', 'lo-fi', 'indie', 'pop'];
  const KEYWORD_POOL = ['dreamy', 'warm', 'airy', 'bright', 'dusky', 'gentle', 'lush', 'sparse'];
  const PROFILE = { topGenres: TOP_GENRES, tempoBaseline: 110, energy: 0.5, valence: 0.5, acousticness: 0.4 };
  const prompts = [];

  function installPromptSensitiveGroq(axios) {
    axios.post.mockImplementation(async (url, body) => {
      if (String(url).startsWith(SPOTIFY_API)) throw new Error(`unexpected Spotify POST ${url}`);
      const prompt = body.messages[0].content;
      prompts.push(prompt);
      const h = crypto.createHash('sha256').update(prompt).digest();
      const answer = {
        target_bpm: 60 + (h[0] % 120), target_energy: (h[1] % 100) / 100,
        target_valence: (h[2] % 100) / 100, target_acousticness: (h[3] % 100) / 100,
        seed_artists: [],
        seed_genres: [GENRE_POOL[h[4] % 8], GENRE_POOL[(h[5] % 7 + 1 + h[4]) % 8]],
        mood_keywords: [`p-${h.toString('hex').slice(0, 8)}`, KEYWORD_POOL[h[6] % 8]],
      };
      return { status: 200, data: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(answer) } }] } };
    });
  }

  beforeEach(() => {
    prompts.length = 0;
    installPromptSensitiveGroq(W.axios);
  });

  // One real generation run; returns the query the provider would be handed and the local params.
  // `live`: the model's answer must reach the query. A mood with no note is the strict mode, whose
  // lists come from the mood descriptor alone, so there the model's answer is overridden by design.
  async function gen({ taps = [], note = null, ctx = null, live = true } = {}) {
    const fetchTracks = jest.fn(async () => []);
    const { params } = await W.engine.buildEmotionPlaylist({
      musicProfile: PROFILE, emotionTaps: taps, textPrompt: note, activity: null, biometricContext: ctx, fetchTracks,
    });
    expect(fetchTracks).toHaveBeenCalledTimes(1);
    const query = fetchTracks.mock.calls[0][1];
    expect(query).toBeDefined();
    expect(query.mood_keywords.some((k) => k.startsWith('p-'))).toBe(live);
    return { query: JSON.stringify(query), params };
  }

  it('control: the fake is prompt-sensitive, and a non-sleep note change changes the query', async () => {
    const calm    = await gen({ taps: CALM, note: 'calm music' });
    const upbeat  = await gen({ taps: CALM, note: 'upbeat music' });
    expect(upbeat.query).not.toBe(calm.query);
    const plain   = await gen({ note: 'help me tonight' });
    const running = await gen({ note: 'going for a run tonight' });
    expect(running.query).not.toBe(plain.query);
    expect(new Set(prompts).size).toBe(4);
  });

  it('merge mode: "calm music before bed" hands the provider what "calm music" does', async () => {
    const calm          = await gen({ taps: CALM, note: 'calm music' });
    const calmBeforeBed = await gen({ taps: CALM, note: 'calm music before bed' });
    expect(calmBeforeBed.query).toBe(calm.query);
    expect(calmBeforeBed.params.tempo_category).toBe('resting');
  });

  it.each(['help me sleep tonight', 'music before bed', 'winding down', "can't sleep"])(
    'note only, no taps: %p hands the provider what "help me tonight" does, and stays resting locally',
    async (note) => {
      const plain = await gen({ note: 'help me tonight' });
      const sleep = await gen({ note });
      expect(sleep.query).toBe(plain.query);
      expect(sleep.params.tempo_category).toBe('resting');
    },
  );

  // BE-261 (SEC-293-1 on #293): a sleep word beside a relaxing word used to mask the relaxing row,
  // so the prompt — and with it the model's own seed_genres and mood_keywords — differed from the
  // relaxing word's alone. Every sleep-row term (from the lexicon) beside every relaxing-row word.
  const { _ACTIVITY_LEXICON } = require('../app/services/moodDescriptors');
  const rowOf = (activity) => _ACTIVITY_LEXICON.find((r) => r.activity === activity);
  const SLEEP_TERMS = [...rowOf('sleep').words, ...rowOf('sleep').phrases];
  const RELAX_PAIRS = rowOf('relaxing').words.flatMap((r) => SLEEP_TERMS.map((s) => [r, s]));

  it.each(RELAX_PAIRS)('BE-261: %p with %p hands the provider what the relaxing word alone does, with and without a mood', async (relax, sleep) => {
    for (const taps of [[], CALM]) {
      const alone  = await gen({ taps, note: relax });
      const after  = await gen({ taps, note: `${relax} ${sleep}` });
      const before = await gen({ taps, note: `${sleep} ${relax}` });
      expect(after.query).toBe(alone.query);
      expect(before.query).toBe(alone.query);
      expect(after.params.tempo_category).toBe('resting');
    }
  });

  it.each(RELAX_PAIRS)('BE-261: %p with %p, through the real handler: the Spotify log is the relaxing word\'s own', async (relax, sleep) => {
    fake.recommendationsStatus = 200;
    const alone = await run(W, 'emotion', state({ lastTextPrompt: relax }));
    const both  = await run(W, 'emotion', state({ lastTextPrompt: `${relax} ${sleep}` }));
    expect(alone.log).not.toBe('');
    expect(alone.ready.discovery).toBeGreaterThan(0);
    expect(both.log).toBe(alone.log);
    expect(both.ready.params.tempo_category).toBe('resting');
  });

  it.each([
    ['a mood and a note (merge)', CALM, 'calm music', true],
    ['a mood, no note (strict)', CALM, null, false],
    ['no mood, no note', [], null, true],
    ['no mood, a note', [], 'help me tonight', true],
  ])('stored vitals never move the query but do move the local target_bpm: %s', async (_name, taps, note, live) => {
    const none = await gen({ taps, note, live });
    const low  = await gen({ taps, note, live, ctx: { heartRate: 50 } });
    const high = await gen({ taps, note, live, ctx: { heartRate: 180, hrRatio: 2 } });
    expect(low.query).toBe(none.query);
    expect(high.query).toBe(none.query);
    expect(low.params.target_bpm).toBeLessThan(high.params.target_bpm);
  });
});

// ── spotify.fetchVibeDiscovery itself: no query, no request ─────────────────────────────────────

describe('spotify.fetchVibeDiscovery fails closed', () => {
  it.each([
    ['no query', undefined],
    ['a null query', null],
    ['targets only', { target_bpm: 151, target_energy: 0.9, target_acousticness: 0.1, tempo_category: 'peak' }],
    ['inherited lists only', Object.create({ seed_genres: ['pop'], playlist_queries: ['beast mode'] })],
  ])('%s → no request and no tracks', async (_name, query) => {
    for (const status of [200, 403]) {
      fake.recommendationsStatus = status;
      W.axios.get.mockClear();
      expect(await W.spotify.fetchVibeDiscovery('tok', query, { limit: 10 })).toEqual([]);
      expect(W.axios.get).not.toHaveBeenCalled();
    }
  });

  it('a query with targets beside its lists sends the lists only', async () => {
    for (const status of [200, 403]) {
      fake.recommendationsStatus = status;
      W.axios.get.mockClear();
      await W.spotify.fetchVibeDiscovery('tok', { seed_genres: ['pop'], mood_keywords: ['calm'], target_bpm: 88, target_energy: 0.2 }, { limit: 10 });
      const log = discoveryRequests(W.axios);
      expect(log.length).toBeGreaterThan(0);
      for (const l of log) expect(l).not.toMatch(AUDIO_KEY);
    }
  });
});

// ── The handler's Spotify closure, called without a query ────────────────────────────────────────
// An isolated module graph whose generation core forgets the second argument — the mistake the
// positional contract exists to catch. The closure must send nothing, and the run must still serve.

describe('the handler\'s Spotify closure fails closed without a query', () => {
  let iso;
  beforeAll(() => {
    jest.isolateModules(() => {
      jest.doMock('../app/services/geminiEngine', () => {
        const forgetful = async ({ fetchTracks }) => {
          const params = { ...PARAMS, seed_genres: ['pop'], playlist_queries: ['peaceful piano'], target_bpm: 151 };
          return { params, tracks: await fetchTracks(params) };
        };
        return { buildEmotionPlaylist: forgetful, adjustBiometricPlaylist: forgetful, inferArtistGenres: async () => ({}) };
      });
      iso = loadWorld();
    });
    jest.dontMock('../app/services/geminiEngine');
  });
  beforeEach(() => arrange(iso));

  it.each([200, 403])('with /recommendations answering %i: no Spotify discovery request on either branch', async (status) => {
    fake.recommendationsStatus = status;
    const heart = await run(iso, 'biometric', state({ stableHR: 180, latestActivity: 'running', lastEmotionTaps: [] }));
    const mood  = await run(iso, 'emotion', state());
    expect(heart.log).toBe('');
    expect(mood.log).toBe('');
  });

  it('control: the same forgetful core with VECTOR_DISCOVERY=true still reaches the vector port', async () => {
    process.env.VECTOR_DISCOVERY = 'true';
    await run(iso, 'emotion', state());
    expect(iso.discoveryFetch.vectorDiscoveryFetch).toHaveBeenCalledTimes(1);
  });
});
