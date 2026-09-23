'use strict';

process.env.NODE_ENV = 'test';

// BE-015 / ADR-0015. The Art.9 consent notice promises, on the layer a reader cannot avoid,
// that withdrawing health consent "also erases what the app has learned about your taste".
// This is the module that makes that true: the two learned artifacts, deleted for ONE user.
//
// Deliberately NOT part of `purgeWearableData` — see the module header for why unpairing a
// watch must not reach these collections. That boundary is pinned by the negative guards in
// wearableErasure.test.js / wearableErasure.integration.test.js.

jest.mock('../app/models/RewardEvent', () => ({
  RewardEvent: { deleteMany: jest.fn() },
}));
jest.mock('../app/models/PersonalWeights', () => ({
  PersonalWeights: { deleteMany: jest.fn() },
}));

const { RewardEvent } = require('../app/models/RewardEvent');
const { PersonalWeights } = require('../app/models/PersonalWeights');
const { purgeLearnedPersonalization } = require('../app/services/privacy/learningErasure');

const USER = '507f1f77bcf86cd799439011';

beforeEach(() => jest.clearAllMocks());

describe('purgeLearnedPersonalization', () => {
  it('deletes both collections for exactly this user and returns the counts', async () => {
    // Distinct counts so a swapped mapping cannot pass.
    RewardEvent.deleteMany.mockResolvedValue({ deletedCount: 7 });
    PersonalWeights.deleteMany.mockResolvedValue({ deletedCount: 1 });

    const res = await purgeLearnedPersonalization(USER);

    // Scoped by userId and NOTHING else: these rows carry no `source` to narrow by (a scoring
    // weight has no provider), so the whole-user delete IS the contract at withdrawal scope.
    expect(RewardEvent.deleteMany).toHaveBeenCalledWith({ userId: USER });
    expect(PersonalWeights.deleteMany).toHaveBeenCalledWith({ userId: USER });
    expect(res).toEqual({ personalWeights: 1, rewardEvents: 7 });
  });
});
