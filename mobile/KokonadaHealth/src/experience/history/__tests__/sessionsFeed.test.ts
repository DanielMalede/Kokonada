import { SessionsFeed } from '../sessionsFeed';
import type { SessionItem } from '../sessionsApi';

const item = (id: string): SessionItem => ({
  id, createdAt: '2026-07-03T12:00:00.000Z', moodKey: 'focus', provider: 'spotify',
  activity: null, contextPrompt: '', isFallback: false, skipCount: 0, trackCount: 1,
  tracks: [{ id: 't', title: 'T', artist: 'A' }],
});
const ok = (items: SessionItem[], nextCursor: any = null) => ({ ok: true as const, data: { items, nextCursor } });

describe('SessionsFeed — pagination', () => {
  it('appends pages and follows the cursor to the end', async () => {
    const fetchPage = jest.fn()
      .mockResolvedValueOnce(ok([item('a')], { before: 'x', beforeId: 'a' }))
      .mockResolvedValueOnce(ok([item('b')], null));
    const feed = new SessionsFeed(fetchPage);
    await feed.loadMore();
    expect(feed.getState().items.map((i) => i.id)).toEqual(['a']);
    expect(feed.getState().reachedEnd).toBe(false);
    await feed.loadMore();
    expect(feed.getState().items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(feed.getState().reachedEnd).toBe(true);
    expect(fetchPage).toHaveBeenNthCalledWith(2, { before: 'x', beforeId: 'a' });
  });

  it('is SINGLE-FLIGHT: a burst of loadMore during one in-flight request fires ONE fetch', async () => {
    let resolve!: (v: any) => void;
    const fetchPage = jest.fn().mockImplementation(() => new Promise((r) => { resolve = r; }));
    const feed = new SessionsFeed(fetchPage);
    feed.loadMore(); feed.loadMore(); feed.loadMore();
    expect(fetchPage).toHaveBeenCalledTimes(1);
    resolve(ok([item('a')], null));
    await Promise.resolve();
  });

  it('does not fetch once the end is reached', async () => {
    const fetchPage = jest.fn().mockResolvedValue(ok([item('a')], null));
    const feed = new SessionsFeed(fetchPage);
    await feed.loadMore();
    await feed.loadMore();
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});

describe('SessionsFeed — refresh + errors', () => {
  it('refresh reloads page 1 from scratch', async () => {
    const fetchPage = jest.fn()
      .mockResolvedValueOnce(ok([item('a')], { before: 'x', beforeId: 'a' }))
      .mockResolvedValueOnce(ok([item('z')], null));
    const feed = new SessionsFeed(fetchPage);
    await feed.loadMore();
    await feed.refresh();
    expect(feed.getState().items.map((i) => i.id)).toEqual(['z']);
    expect(fetchPage).toHaveBeenNthCalledWith(2, null); // refresh ignores the cursor
  });

  it('a failed load surfaces an error and does not wedge future loads', async () => {
    const fetchPage = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 500, error: 'boom' })
      .mockResolvedValueOnce(ok([item('a')], null));
    const feed = new SessionsFeed(fetchPage);
    await feed.loadMore();
    expect(feed.getState().error).toBe('boom');
    expect(feed.getState().loading).toBe(false);
    await feed.loadMore(); // recovers
    expect(feed.getState().items.map((i) => i.id)).toEqual(['a']);
    expect(feed.getState().error).toBeNull();
  });

  it('a 401 mid-pagination (logout race) surfaces cleanly, no retry storm', async () => {
    const fetchPage = jest.fn().mockResolvedValue({ ok: false, status: 401, error: 'unauthorized' });
    const feed = new SessionsFeed(fetchPage);
    await feed.loadMore();
    await feed.loadMore();
    expect(fetchPage).toHaveBeenCalledTimes(2); // each is a deliberate user action, not a loop
    expect(feed.getState().items).toEqual([]);
  });
});
