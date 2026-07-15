// backend/tests/ingestCursorRepo.test.js
'use strict';

jest.mock('../app/models/IngestCursor', () => ({ findOne: jest.fn(), updateOne: jest.fn() }));
const IngestCursor = require('../app/models/IngestCursor');
const repo = require('../app/repositories/ingestCursorRepo');

beforeEach(() => {
  jest.clearAllMocks();
  IngestCursor.findOne.mockReturnValue({ lean: async () => ({ name: 'global-seed', offset: 7 }) });
  IngestCursor.updateOne.mockResolvedValue({});
});

describe('ingestCursorRepo', () => {
  it('reads a stored offset', async () => {
    expect(await repo.getOffset('global-seed')).toBe(7);
  });

  it('returns 0 when no cursor row exists yet', async () => {
    IngestCursor.findOne.mockReturnValue({ lean: async () => null });
    expect(await repo.getOffset('global-seed')).toBe(0);
  });

  it('upserts the offset', async () => {
    expect(await repo.setOffset('global-seed', 42)).toBe(true);
    expect(IngestCursor.updateOne).toHaveBeenCalledWith({ name: 'global-seed' }, { $set: { offset: 42 } }, { upsert: true });
  });

  it('degrades to 0 / false on a DB error, never throws', async () => {
    IngestCursor.findOne.mockImplementation(() => { throw new Error('db'); });
    expect(await repo.getOffset('global-seed')).toBe(0);
    IngestCursor.updateOne.mockRejectedValue(new Error('db'));
    expect(await repo.setOffset('global-seed', 1)).toBe(false);
  });
});
