'use strict';

const {
  _genresFromTopicCategories,
  _subscriptionArtists,
  _videoIdOf,
  _deduplicateById,
} = require('../app/services/musicProfileService');

describe('_videoIdOf (canonical video id across shapes)', () => {
  it('uses item.id for a liked video', () => {
    expect(_videoIdOf({ id: 'vid1', snippet: {} })).toBe('vid1');
  });
  it('uses snippet.resourceId.videoId for a playlist item (not the playlist-item id)', () => {
    expect(_videoIdOf({ id: 'plItem99', snippet: { resourceId: { videoId: 'vid2' } } })).toBe('vid2');
  });
  it('returns null when neither is present', () => {
    expect(_videoIdOf({})).toBeNull();
    expect(_videoIdOf(null)).toBeNull();
  });
});

describe('_deduplicateById with the video-id key', () => {
  it('collapses the same song appearing in likes AND a playlist', () => {
    const liked    = { id: 'v1', snippet: {} };
    const inList   = { id: 'plItem1', snippet: { resourceId: { videoId: 'v1' } } }; // same video
    const other    = { id: 'plItem2', snippet: { resourceId: { videoId: 'v2' } } };
    const deduped  = _deduplicateById([liked, inList, other], _videoIdOf);
    expect(deduped.map(_videoIdOf)).toEqual(['v1', 'v2']);
  });
});

describe('_genresFromTopicCategories (YouTube video topicDetails → genres)', () => {
  it('maps Wikipedia music-topic URLs to canonical genres', () => {
    expect(_genresFromTopicCategories([
      'https://en.wikipedia.org/wiki/Rock_music',
      'https://en.wikipedia.org/wiki/Hip_hop_music',
      'https://en.wikipedia.org/wiki/Electronic_dance_music',
    ])).toEqual(['rock', 'hip-hop', 'electronic']);
  });

  it('drops the generic /wiki/Music topic and unmapped topics', () => {
    expect(_genresFromTopicCategories([
      'https://en.wikipedia.org/wiki/Music',      // too coarse
      'https://en.wikipedia.org/wiki/Association_football', // non-music
    ])).toEqual([]);
  });

  it('tolerates empty/missing input', () => {
    expect(_genresFromTopicCategories(undefined)).toEqual([]);
    expect(_genresFromTopicCategories([])).toEqual([]);
  });
});

describe('_subscriptionArtists (subscribed channels → artist signals)', () => {
  const sub = (title) => ({ snippet: { title } });

  it('keeps only high-confidence music channels and cleans their names', () => {
    const subs = [
      sub('Tame Impala - Topic'),
      sub('ColdplayVEVO'),
      sub('Radiohead - Official Artist Channel'),
      sub('Some News Network'),   // not music → excluded
      sub('MrBeast'),             // not music → excluded
    ];
    expect(_subscriptionArtists(subs)).toEqual(['Tame Impala', 'Coldplay', 'Radiohead']);
  });

  it('tolerates empty/missing input', () => {
    expect(_subscriptionArtists(undefined)).toEqual([]);
    expect(_subscriptionArtists([{}])).toEqual([]);
  });
});
