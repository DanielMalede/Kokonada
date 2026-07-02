'use strict';

const {
  _genresFromTopicCategories,
  _subscriptionArtists,
} = require('../app/services/musicProfileService');

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
