'use strict';

process.env.NODE_ENV = 'test';

jest.mock('../app/services/privacy/userDataExport', () => ({
  exportUserData: jest.fn().mockResolvedValue({ subjectId: 'u1', collections: {}, user: { email: 'a@b.c' } }),
}));

const { exportUserData } = require('../app/services/privacy/userDataExport');
const { exportAccountData } = require('../app/controllers/gdprExportController');

function buildRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
  };
}

beforeEach(() => jest.clearAllMocks());

describe('GET /auth/account/export', () => {
  it('exports the caller\'s own data as a JSON attachment', async () => {
    const req = { user: { _id: 'u1' } };
    const res = buildRes();
    await exportAccountData(req, res, jest.fn());
    expect(exportUserData).toHaveBeenCalledWith('u1'); // scoped to the caller, no arbitrary id
    expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', expect.stringMatching(/attachment/));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ subjectId: 'u1' }));
  });

  it('forwards errors to next()', async () => {
    exportUserData.mockRejectedValueOnce(new Error('db down'));
    const next = jest.fn();
    await exportAccountData({ user: { _id: 'u1' } }, buildRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});
