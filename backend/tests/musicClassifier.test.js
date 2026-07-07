'use strict';

jest.mock('../app/services/youtube', () => ({ fetchVideoTopics: jest.fn() }));
jest.mock('../app/services/llmClient', () => ({ generateJson: jest.fn(), isConfigured: jest.fn(() => true) }));

const youtube = require('../app/services/youtube');
const llmClient = require('../app/services/llmClient');
const { classifyByMetadata, classifyTracks } = require('../app/services/musicClassifier');

// A youtube_music library entry: { provider, name, artist, genres }.
const yt = (name, artist = 'Some Channel') => ({ provider: 'youtube_music', name, artist });

describe('classifyByMetadata — deterministic verdict', () => {
  describe('strong KEEP signals → music', () => {
    it('categoryId 10 (Music) keeps', () => {
      expect(classifyByMetadata(yt('Anything at all'), { categoryId: '10' })).toBe('music');
    });
    it('a Music/genre topicDetails topic keeps', () => {
      expect(classifyByMetadata(yt('Some Song'), { topicCategories: ['https://en.wikipedia.org/wiki/Rock_music'] })).toBe('music');
    });
    it('the generic /wiki/Music topic keeps', () => {
      expect(classifyByMetadata(yt('Some Song'), { topicCategories: ['https://en.wikipedia.org/wiki/Music'] })).toBe('music');
    });
    it('an auto-generated "- Topic" channel keeps', () => {
      expect(classifyByMetadata(yt('Track', 'Radiohead - Topic'))).toBe('music');
    });
    it('a VEVO channel keeps', () => {
      expect(classifyByMetadata(yt('Track', 'DuaLipaVEVO'))).toBe('music');
    });
  });

  describe('music-form allowlist overrides the junk lexicon → music', () => {
    it('a DJ set keeps even though "live" sits near junk words', () => {
      expect(classifyByMetadata(yt('Boris Brejcha — Sunset DJ Set (live)'))).toBe('music');
    });
    it('a guitar cover keeps', () => {
      expect(classifyByMetadata(yt('Wonderwall (Acoustic Guitar Cover)'))).toBe('music');
    });
    it('a mix keeps', () => {
      expect(classifyByMetadata(yt('Deep House Mix 2024'))).toBe('music');
    });
    it('a remix keeps', () => {
      expect(classifyByMetadata(yt('Song Title (Club Remix)'))).toBe('music');
    });
  });

  describe('junk lexicon / non-music category → non_music', () => {
    it('a vlog is non-music', () => {
      expect(classifyByMetadata(yt('my morning routine vlog'))).toBe('non_music');
    });
    it('a podcast episode is non-music', () => {
      expect(classifyByMetadata(yt('Joe Rogan Experience #2100 - full episode'))).toBe('non_music');
    });
    it('a tutorial is non-music', () => {
      expect(classifyByMetadata(yt('How to build a shed - tutorial'))).toBe('non_music');
    });
    it('a review/unboxing is non-music', () => {
      expect(classifyByMetadata(yt('iPhone 17 unboxing and review'))).toBe('non_music');
    });
    it('a gameplay category (20) with no keep-signal is non-music', () => {
      expect(classifyByMetadata(yt('Untitled clip'), { categoryId: '20' })).toBe('non_music');
    });
    it('a keep-signal beats a non-music category (topic wins over categoryId)', () => {
      expect(classifyByMetadata(yt('Live at Wembley', 'Queen - Topic'), { categoryId: '24' })).toBe('music');
    });
  });

  describe('scope + ambiguity', () => {
    it('a Spotify track is always music (never classified)', () => {
      expect(classifyByMetadata({ provider: 'spotify', name: 'talking heads interview vlog' })).toBe('music');
    });
    it('a bare title with no signal is ambiguous', () => {
      expect(classifyByMetadata(yt('Untitled 3', 'randomuser123'))).toBe('ambiguous');
    });
  });
});

describe('classifyTracks — 3-way partition', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    llmClient.isConfigured.mockReturnValue(true);
  });

  const ytt = (id, name, artist = 'ch') => ({ id, provider: 'youtube_music', name, artist });

  it('partitions deterministically with no token/LLM; ambiguous → unclassified', async () => {
    const tracks = [
      { id: 's1', provider: 'spotify', name: 'anything' },
      ytt('m1', 'Song (Official Video)'),
      ytt('j1', 'morning routine vlog'),
      ytt('a1', 'Untitled 3', 'randomuser'),
    ];
    const out = await classifyTracks(tracks, { useLLM: false });
    expect(out.music.map(t => t.id).sort()).toEqual(['m1', 's1']);
    expect(out.nonMusic.map(t => t.id)).toEqual(['j1']);
    expect(out.unclassified.map(t => t.id)).toEqual(['a1']);
    expect(youtube.fetchVideoTopics).not.toHaveBeenCalled();
    expect(llmClient.generateJson).not.toHaveBeenCalled();
  });

  it('enriches ambiguous tracks via videos.list and re-classifies (categoryId 20 → non_music)', async () => {
    youtube.fetchVideoTopics.mockResolvedValue([{ id: 'a1', categoryId: '20', topicCategories: [], tags: [] }]);
    const out = await classifyTracks([ytt('a1', 'clip', 'randomuser')], { youtubeToken: 'tok', useLLM: false });
    expect(youtube.fetchVideoTopics).toHaveBeenCalledWith('tok', ['a1'], expect.any(Object));
    expect(out.nonMusic.map(t => t.id)).toEqual(['a1']);
    expect(out.unclassified).toEqual([]);
  });

  it('sends the still-ambiguous residue to Groq and honors its non_music verdict', async () => {
    llmClient.generateJson.mockResolvedValue(JSON.stringify({ non_music: [0] }));
    const out = await classifyTracks(
      [ytt('a1', 'weird title', 'u'), ytt('a2', 'another weird', 'u')],
      { useLLM: true },
    );
    expect(llmClient.generateJson).toHaveBeenCalledTimes(1);
    expect(out.nonMusic.map(t => t.id)).toEqual(['a1']);
    expect(out.music.map(t => t.id)).toEqual(['a2']);
    expect(out.unclassified).toEqual([]);
  });

  it('a Groq outage sends the residue to unclassified, never nonMusic (safety floor)', async () => {
    llmClient.generateJson.mockRejectedValue(new Error('429 rate limited'));
    const out = await classifyTracks([ytt('a1', 'weird', 'u')], { useLLM: true });
    expect(out.unclassified.map(t => t.id)).toEqual(['a1']);
    expect(out.nonMusic).toEqual([]);
  });

  it('skips videos.list when metaById is supplied (ingest reuses already-fetched meta)', async () => {
    const out = await classifyTracks([ytt('a1', 'clip', 'u')], {
      youtubeToken: 'tok', useLLM: false, metaById: { a1: { categoryId: '10' } },
    });
    expect(youtube.fetchVideoTopics).not.toHaveBeenCalled();
    expect(out.music.map(t => t.id)).toEqual(['a1']);
  });
});
