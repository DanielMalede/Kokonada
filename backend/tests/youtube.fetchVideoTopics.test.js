'use strict';

jest.mock('axios');
const axios = require('axios');
const youtube = require('../app/services/youtube');

describe('youtube.fetchVideoTopics — carries categoryId for classification', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns categoryId from snippet (and null when absent)', async () => {
    axios.get.mockResolvedValue({
      data: {
        items: [
          { id: 'v1', snippet: { categoryId: '10', tags: ['rock'] }, topicDetails: { topicCategories: ['https://en.wikipedia.org/wiki/Rock_music'] } },
          { id: 'v2', snippet: { tags: [] } }, // no categoryId, no topics
        ],
      },
    });

    const rows = await youtube.fetchVideoTopics('token', ['v1', 'v2']);

    expect(rows).toEqual([
      { id: 'v1', categoryId: '10', topicCategories: ['https://en.wikipedia.org/wiki/Rock_music'], tags: ['rock'] },
      { id: 'v2', categoryId: null, topicCategories: [], tags: [] },
    ]);
    // Must request snippet so categoryId is present in the response.
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining('/videos'),
      expect.objectContaining({ params: expect.objectContaining({ part: 'topicDetails,snippet' }) }),
    );
  });
});
