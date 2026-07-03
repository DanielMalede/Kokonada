import { fetchSessions } from '../sessionsApi';

jest.mock('../../../net/apiClient', () => ({ apiGet: jest.fn() }));
import { apiGet } from '../../../net/apiClient';

describe('sessionsApi.fetchSessions', () => {
  beforeEach(() => jest.clearAllMocks());

  it('requests the first page with a limit and no cursor params', async () => {
    (apiGet as jest.Mock).mockResolvedValue({ ok: true, data: { items: [], nextCursor: null } });
    await fetchSessions(null, 20);
    const path = (apiGet as jest.Mock).mock.calls[0][0];
    expect(path).toContain('/api/sessions?');
    expect(path).toContain('limit=20');
    expect(path).not.toContain('before=');
  });

  it('encodes the cursor for the next page', async () => {
    (apiGet as jest.Mock).mockResolvedValue({ ok: true, data: { items: [], nextCursor: null } });
    await fetchSessions({ before: '2026-07-03T12:00:00.000Z', beforeId: 'abc' }, 10);
    const path = (apiGet as jest.Mock).mock.calls[0][0];
    expect(path).toContain('limit=10');
    expect(path).toContain('beforeId=abc');
    expect(path).toMatch(/before=2026-07-03T12%3A00%3A00.000Z/);
  });

  it('passes the typed result straight through (never throws)', async () => {
    (apiGet as jest.Mock).mockResolvedValue({ ok: false, status: 401, error: 'unauthorized' });
    await expect(fetchSessions()).resolves.toEqual({ ok: false, status: 401, error: 'unauthorized' });
  });
});
