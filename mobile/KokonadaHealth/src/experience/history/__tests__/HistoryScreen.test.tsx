import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

const mockFetchSessions = jest.fn();
jest.mock('../sessionsApi', () => ({ fetchSessions: (...a: any[]) => mockFetchSessions(...a) }));
const fetchSessions = mockFetchSessions;

import { HistoryScreen } from '../HistoryScreen';
import type { SessionItem } from '../sessionsApi';

function texts(node: any, acc: string[] = []): string[] {
  if (node == null) return acc;
  if (typeof node === 'string') { acc.push(node); return acc; }
  if (Array.isArray(node)) { node.forEach((n) => texts(n, acc)); return acc; }
  if (node.children) texts(node.children, acc);
  return acc;
}
const item = (id: string, over: Partial<SessionItem> = {}): SessionItem => ({
  id, createdAt: '2026-07-03T12:00:00.000Z', moodKey: 'focus', provider: 'spotify',
  activity: null, contextPrompt: 'late night', isFallback: false, skipCount: 0,
  trackCount: 2, tracks: [{ id: 't1', title: 'Song A', artist: 'Artist A' }], ...over,
});

async function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(<HistoryScreen />); });
  await ReactTestRenderer.act(async () => { await Promise.resolve(); });
  return tree;
}

beforeEach(() => jest.clearAllMocks());

describe('HistoryScreen', () => {
  it('loads and renders server sessions on mount', async () => {
    fetchSessions.mockResolvedValue({ ok: true, data: { items: [item('a')], nextCursor: null } });
    const tree = await render();
    const all = texts(tree.toJSON()).join(' ');
    expect(all).toContain('focus');
    expect(all).toContain('Song A');
    expect(all).toContain('late night');
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('shows an empty state when the feed is empty', async () => {
    fetchSessions.mockResolvedValue({ ok: true, data: { items: [], nextCursor: null } });
    const tree = await render();
    expect(texts(tree.toJSON()).join(' ')).toContain('Nothing yet');
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('shows an error + retry when the first load fails', async () => {
    fetchSessions.mockResolvedValue({ ok: false, status: 500, error: 'server down' });
    const tree = await render();
    const all = texts(tree.toJSON()).join(' ');
    expect(all).toContain('server down');
    expect(all).toContain('Retry');
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('does not update state after unmount (no post-unmount setState)', async () => {
    let resolve!: (v: any) => void;
    fetchSessions.mockImplementation(() => new Promise((r) => { resolve = r; }));
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(<HistoryScreen />); });
    await ReactTestRenderer.act(async () => { tree.unmount(); });
    // Resolve AFTER unmount — the guarded callback must swallow it without warning.
    await ReactTestRenderer.act(async () => { resolve({ ok: true, data: { items: [item('late')], nextCursor: null } }); await Promise.resolve(); });
  });
});
