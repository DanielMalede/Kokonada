'use strict';

// Verifies the two new legal Data-API ingestion sources: channel subscriptions and
// per-video topicDetails. axios is mocked; withRetry wraps the (resolved) mock calls.

jest.mock('axios');
const axios = require('axios');
const youtube = require('../app/services/youtube');

beforeEach(() => { axios.get.mockReset(); });

describe('paginateSubscriptions', () => {
  it('follows pagination and returns every subscription item', async () => {
    axios.get
      .mockResolvedValueOnce({ data: { items: [{ snippet: { title: 'Tame Impala - Topic' } }], nextPageToken: 'p2' } })
      .mockResolvedValueOnce({ data: { items: [{ snippet: { title: 'ColdplayVEVO' } }] } });

    const subs = await youtube.paginateSubscriptions('tok');

    expect(subs).toHaveLength(2);
    expect(axios.get).toHaveBeenCalledTimes(2);
    expect(axios.get.mock.calls[0][0]).toContain('/subscriptions');
    expect(axios.get.mock.calls[0][1].params).toMatchObject({ mine: true, part: 'snippet' });
    // second page must carry the pageToken
    expect(axios.get.mock.calls[1][1].params.pageToken).toBe('p2');
  });
});

describe('fetchVideoTopics', () => {
  it('batches IDs 50-per-request and returns topicCategories + tags', async () => {
    axios.get.mockResolvedValue({ data: { items: [
      { id: 'v1', topicDetails: { topicCategories: ['https://en.wikipedia.org/wiki/Rock_music'] }, snippet: { tags: ['rock'] } },
    ] } });

    const ids = Array.from({ length: 70 }, (_, i) => `v${i}`); // → 50 + 20 = 2 batches
    const topics = await youtube.fetchVideoTopics('tok', ids);

    expect(axios.get).toHaveBeenCalledTimes(2);
    expect(axios.get.mock.calls[0][1].params.part).toBe('topicDetails,snippet');
    expect(topics[0]).toMatchObject({
      id: 'v1',
      topicCategories: ['https://en.wikipedia.org/wiki/Rock_music'],
      tags: ['rock'],
    });
  });

  it('dedupes IDs and respects the cap', async () => {
    axios.get.mockResolvedValue({ data: { items: [] } });
    await youtube.fetchVideoTopics('tok', ['a', 'a', 'b', 'c'], { cap: 2 });
    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(axios.get.mock.calls[0][1].params.id).toBe('a,b'); // deduped + capped to 2
  });
});
