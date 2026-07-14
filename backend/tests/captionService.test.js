'use strict';

process.env.NODE_ENV = 'test';

jest.mock('../app/services/llmClient', () => ({
  generateJson: jest.fn(),
  isConfigured: jest.fn().mockReturnValue(true),
}));
const llmClient = require('../app/services/llmClient');

const captionService = require('../app/services/discovery/captionService');

// A discovery track as it exists post-selection: recordingKey + the slim audio-feature
// projection. Compliance sentinels (title/artist/genres) are attached so the guard test
// can prove they NEVER reach the Groq prompt.
function disco(rk, features = {}, extra = {}) {
  return {
    recordingKey: rk,
    isDiscovery: true,
    features: { bpm: 96, energy: 0.4, valence: 0.3, danceability: 0.5, acousticness: 0.6, ...features },
    ...extra,
  };
}

function captionsResponse(captions) {
  return JSON.stringify({ captions });
}

const SESSION = {
  moodKey: 'melancholy',
  activity: 'resting',
  hrBand: 'resting',
  emotionTaps: [{ x: -0.2, y: -0.5 }],
  targets: { bpmCenter: 92 },
};

beforeEach(() => {
  jest.clearAllMocks();
  llmClient.isConfigured.mockReturnValue(true);
  process.env.DISCOVERY_CAPTION_LLM = 'true';
  delete process.env.DISCOVERY_CAPTION_BUDGET_MS;
  delete process.env.DISCOVERY_CAPTION_MAX_LEN;
});

afterEach(() => {
  delete process.env.DISCOVERY_CAPTION_LLM;
});

describe('captionService.captionDiscovery — compliance guard (load-bearing)', () => {
  it('the Groq prompt carries audio features + session context but NO title/artist/genre for any track', async () => {
    llmClient.generateJson.mockResolvedValue(captionsResponse([{ i: 0, caption: 'A slow, smoky burner' }]));

    await captionService.captionDiscovery([
      disco('youtube:a', { bpm: 88 }, {
        title:   'ZZZ_SECRET_TITLE',
        name:    'ZZZ_SECRET_TITLE',
        artist:  'ZZZ_SECRET_ARTIST',
        artists: [{ name: 'ZZZ_SECRET_ARTIST' }],
        genres:  ['ZZZ_SECRET_GENRE'],
      }),
    ], SESSION, { budgetMs: 2000 });

    expect(llmClient.generateJson).toHaveBeenCalledTimes(1);
    const prompt = llmClient.generateJson.mock.calls[0][0];

    // Zero Spotify Content (title/artist/genre) reaches the model — §II ML-ingestion guard.
    expect(prompt).not.toContain('ZZZ_SECRET_TITLE');
    expect(prompt).not.toContain('ZZZ_SECRET_ARTIST');
    expect(prompt).not.toContain('ZZZ_SECRET_GENRE');

    // …but the sonic features + first-party mood context DO.
    expect(prompt).toContain('88bpm');       // the track's tempo
    expect(prompt).toMatch(/melancholy/i);   // the session mood
  });
});

describe('captionService.captionDiscovery — structured happy path', () => {
  it('returns a Map<recordingKey, caption> from the structured Groq response', async () => {
    llmClient.generateJson.mockResolvedValue(captionsResponse([
      { i: 0, caption: 'A slow burner your calm needed' },
      { i: 1, caption: 'Bright, driving, unmistakably awake' },
    ]));

    const map = await captionService.captionDiscovery(
      [disco('youtube:a'), disco('youtube:b')], SESSION, { budgetMs: 2000 });

    expect(map).toBeInstanceOf(Map);
    expect(map.get('youtube:a')).toBe('A slow burner your calm needed');
    expect(map.get('youtube:b')).toBe('Bright, driving, unmistakably awake');
  });

  it('drops captions that are empty, whitespace, non-string, or over the max length', async () => {
    process.env.DISCOVERY_CAPTION_MAX_LEN = '40';
    llmClient.generateJson.mockResolvedValue(captionsResponse([
      { i: 0, caption: '   ' },              // whitespace → dropped
      { i: 1, caption: 123 },                // non-string → dropped
      { i: 2, caption: 'x'.repeat(60) },     // too long → dropped
      { i: 3, caption: 'Smoky and slow' },   // valid
    ]));

    const map = await captionService.captionDiscovery(
      [disco('youtube:a'), disco('youtube:b'), disco('youtube:c'), disco('youtube:d')],
      SESSION, { budgetMs: 2000 });

    expect(map.has('youtube:a')).toBe(false);
    expect(map.has('youtube:b')).toBe(false);
    expect(map.has('youtube:c')).toBe(false);
    expect(map.get('youtube:d')).toBe('Smoky and slow');
  });

  it('trims a valid caption and ignores hallucinated / duplicate indices', async () => {
    llmClient.generateJson.mockResolvedValue(captionsResponse([
      { i: 9, caption: 'no such track' },              // out of range → ignored
      { i: 0, caption: '  Hazy after-hours drift  ' }, // trimmed
      { i: 0, caption: 'duplicate, dropped' },         // duplicate → dropped
    ]));

    const map = await captionService.captionDiscovery([disco('youtube:a')], SESSION, { budgetMs: 2000 });

    expect(map.get('youtube:a')).toBe('Hazy after-hours drift');
    expect(map.size).toBe(1);
  });

  it('tolerates code-fenced JSON despite json_object mode (defense in depth)', async () => {
    llmClient.generateJson.mockResolvedValue(
      '```json\n' + captionsResponse([{ i: 0, caption: 'Cool and collected' }]) + '\n```');

    const map = await captionService.captionDiscovery([disco('youtube:a')], SESSION, { budgetMs: 2000 });

    expect(map.get('youtube:a')).toBe('Cool and collected');
  });
});

describe('captionService.captionDiscovery — budget timeout', () => {
  it('a Groq call that hangs past the budget returns {} within budget and never throws', async () => {
    llmClient.generateJson.mockReturnValue(new Promise(() => {})); // never resolves

    const start = Date.now();
    const map = await captionService.captionDiscovery([disco('youtube:a')], SESSION, { budgetMs: 60 });
    const elapsed = Date.now() - start;

    expect(map).toBeInstanceOf(Map);
    expect(map.size).toBe(0);
    expect(elapsed).toBeLessThan(1000);
  }, 2000);

  // L1 (Node-24 async hygiene): the real danger isn't a hang — it's the Groq promise
  // REJECTING *after* the budget timer already won the race. Promise.race attaches a
  // rejection reaction to BOTH racers, so the late reject is HANDLED (no 'unhandledRejection').
  // This locks that guarantee; a regression would need a .catch(()=>{}) on the losing promise.
  it('a Groq call that REJECTS after the budget already fired returns {} and never unhandled-rejects', async () => {
    const budgetMs = 40;
    llmClient.generateJson.mockImplementation(() => new Promise((_, reject) => {
      const t = setTimeout(() => reject(new Error('Groq 503 after budget')), budgetMs + 50);
      t.unref?.();
    }));

    const seen = [];
    const onUnhandled = (reason) => seen.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const start = Date.now();
      const map = await captionService.captionDiscovery([disco('youtube:a')], SESSION, { budgetMs });
      expect(map).toBeInstanceOf(Map);
      expect(map.size).toBe(0);
      expect(Date.now() - start).toBeLessThan(1000); // resolved on the budget, not the late reject

      // Let the loser rejection actually fire, then flush the micro/macrotask queue so a
      // dangling unhandled rejection (if the race left the loser unhandled) would surface.
      await new Promise((r) => setTimeout(r, budgetMs + 140));
      await Promise.resolve();
      expect(seen.find((r) => r instanceof Error && /after budget/.test(r.message))).toBeUndefined();
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  }, 3000);
});

describe('captionService.captionDiscovery — error / parse / empty never throw', () => {
  it('a rejected Groq call yields {}', async () => {
    llmClient.generateJson.mockRejectedValue(new Error('Groq 503'));
    const map = await captionService.captionDiscovery([disco('youtube:a')], SESSION, { budgetMs: 500 });
    expect(map.size).toBe(0);
  });

  it('malformed JSON yields {}', async () => {
    llmClient.generateJson.mockResolvedValue('captions are: {broken');
    const map = await captionService.captionDiscovery([disco('youtube:a')], SESSION, { budgetMs: 500 });
    expect(map.size).toBe(0);
  });

  it('a top-level array (schema violation) yields {}', async () => {
    llmClient.generateJson.mockResolvedValue(JSON.stringify([{ i: 0, caption: 'x' }]));
    const map = await captionService.captionDiscovery([disco('youtube:a')], SESSION, { budgetMs: 500 });
    expect(map.size).toBe(0);
  });

  it('an empty model response yields {}', async () => {
    llmClient.generateJson.mockResolvedValue('');
    const map = await captionService.captionDiscovery([disco('youtube:a')], SESSION, { budgetMs: 500 });
    expect(map.size).toBe(0);
  });
});

describe('captionService.captionDiscovery — flag OFF and no-op guards', () => {
  it('FLAG OFF: skips entirely — returns {} and makes ZERO Groq calls', async () => {
    process.env.DISCOVERY_CAPTION_LLM = 'false';
    const map = await captionService.captionDiscovery([disco('youtube:a')], SESSION, { budgetMs: 500 });
    expect(map.size).toBe(0);
    expect(llmClient.generateJson).not.toHaveBeenCalled();
  });

  it('makes no Groq call when there are no discovery tracks', async () => {
    const map = await captionService.captionDiscovery([], SESSION, { budgetMs: 500 });
    expect(map.size).toBe(0);
    expect(llmClient.generateJson).not.toHaveBeenCalled();
  });

  it('makes no Groq call when the LLM is not configured', async () => {
    llmClient.isConfigured.mockReturnValue(false);
    const map = await captionService.captionDiscovery([disco('youtube:a')], SESSION, { budgetMs: 500 });
    expect(map.size).toBe(0);
    expect(llmClient.generateJson).not.toHaveBeenCalled();
  });

  it('skips tracks lacking features or a recordingKey — never sends them to the model', async () => {
    llmClient.generateJson.mockResolvedValue(captionsResponse([{ i: 0, caption: 'Warm and low' }]));

    const map = await captionService.captionDiscovery([
      disco('youtube:a'),
      { recordingKey: 'youtube:b' },   // no features → skipped
      { features: { bpm: 100 } },      // no recordingKey → skipped
    ], SESSION, { budgetMs: 500 });

    expect(map.get('youtube:a')).toBe('Warm and low');
    expect(map.size).toBe(1);
  });
});
