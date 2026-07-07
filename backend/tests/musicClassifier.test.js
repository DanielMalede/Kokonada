'use strict';

const { classifyByMetadata } = require('../app/services/musicClassifier');

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
