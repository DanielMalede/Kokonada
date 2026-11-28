import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { ApiClient } from '../../net/apiClient';
import { HistoryRow } from '../../experience/history/HistoryRow';
import { relativeTime } from '../../experience/history/historyFormat';
import { FakeApi, sameRequest } from '../api';
import { installFakeClock, negativeAges, renderedTexts, type FakeClock } from '../clock';
import { createFaceGuard } from '../faces';

// QA-047: a fake API client scripts latency, status, body and failure per request, and a fake clock
// (including non-monotonic wall-clock jumps) drives loading, slow, timeout, error and stale tests.
// Today each suite hand-rolls jest.fn fetchers (apiClient.test.ts:13-90). The fake is a real fetch
// shape injected into the REAL ApiClient; the clock is jest's modern fake timers, where Date.now can
// jump either way while performance.now stays monotonic and pending timers keep their due times
// (the same split as on a device: the wall clock is set by the user or NTP, the monotonic one is not).
// Pass rule: QA-001/003/005/008/009 run on it (each page at G9, owed); a −1 h Date.now jump leaves
// displayed ages non-negative.

let clock: FakeClock;
beforeEach(() => { clock = installFakeClock({ now: Date.UTC(2026, 9, 7, 9, 0) }); });
afterEach(() => { clock.restore(); });

const client = (api: FakeApi, refresh: () => Promise<string | null> = async () => null) =>
  new ApiClient({ baseUrl: 'https://api.test', getAccessToken: () => 'acc-1', refresh, fetchImpl: api.fetch });

describe('QA-047 · the scriptable fake API under the real ApiClient', () => {
  it('scripted latency: the request is pending until the clock reaches it, then resolves', async () => {
    const api = new FakeApi();
    api.on('GET', '/api/sessions').reply(200, { items: [1] }, { latencyMs: 300 });
    let settled: unknown = null;
    void client(api).get('/api/sessions').then((r) => { settled = r; });
    await clock.advanceAsync(299);
    expect(settled).toBeNull();
    expect(api.pending()).toBe(1);
    await clock.advanceAsync(1);
    expect(settled).toEqual({ ok: true, data: { items: [1] } });
    expect(api.pending()).toBe(0);
  });

  it.each([
    ['500', (r: ReturnType<FakeApi['on']>) => r.reply(500, { error: 'boom' }), { ok: false, status: 500 }],
    ['429', (r: ReturnType<FakeApi['on']>) => r.reply(429, { error: 'slow down' }), { ok: false, status: 429 }],
    ['401 with a dead refresh', (r: ReturnType<FakeApi['on']>) => r.reply(401, { error: 'expired' }), { ok: false, status: 401 }],
    ['a network throw', (r: ReturnType<FakeApi['on']>) => r.networkError(), { ok: false }],
    ['malformed JSON', (r: ReturnType<FakeApi['on']>) => r.malformedJson(200), { ok: false }],
  ] as const)('QA-003\'s failure script %s becomes {ok:false}', async (_name, script, expected) => {
    const api = new FakeApi();
    script(api.on('GET', '/api/sessions'));
    const res = await client(api).get('/api/sessions');
    expect(res).toMatchObject(expected);
  });

  it('a sequence per request: 401, the single refresh, then 200 with the fresh token (the log shows both)', async () => {
    const api = new FakeApi();
    api.on('GET', '/api/pulse/state').replies([{ status: 401, body: { error: 'expired' } }, { status: 200, body: { ok: 1 } }]);
    const res = await client(api, async () => 'acc-2').get('/api/pulse/state');
    expect(res).toEqual({ ok: true, data: { ok: 1 } });
    expect(api.log.map((r) => r.headers.Authorization)).toEqual(['Bearer acc-1', 'Bearer acc-2']);
  });

  // QA-009's driver: a fetch that never settles. The real ApiClient bounds each request at 15 s (B1 C1,
  // MB-223), so the caller sees it pending until then and a network error at 15 000 ms, while the fake's
  // fetch itself, which ignores the abort as a hung native call may, stays pending.
  it('a never-resolving request is pending until 15 s, then settles as a network error (QA-009\'s driver)', async () => {
    const api = new FakeApi();
    api.on('GET', '/api/sessions').never();
    let settled: unknown = null;
    void client(api).get('/api/sessions').then((r) => { settled = r; });
    await clock.advanceAsync(14_999);
    expect(settled).toBeNull();
    await clock.advanceAsync(1);
    expect(settled).toEqual({ ok: false, error: 'network error' });
    expect(api.pending()).toBe(1);
  });

  it('an unscripted request fails loudly rather than answering something', async () => {
    const api = new FakeApi();
    await expect(api.fetch('https://api.test/api/unknown', { method: 'GET' })).rejects.toThrow(/unscripted request GET \/api\/unknown/);
  });

  it('sameRequest tells a faithful retry from a changed one (QA-008: Retry re-issues the identical request)', async () => {
    const api = new FakeApi();
    api.on('POST', '/api/x').reply(500, {}).reply(200, {});
    const c = client(api);
    await c.post('/api/x', { a: 1 });
    await c.post('/api/x', { a: 1 });
    await c.post('/api/x', { a: 2 });
    expect(sameRequest(api.log[0], api.log[1])).toBe(true);
    expect(sameRequest(api.log[0], api.log[2])).toBe(false);
  });

  it('the last scripted answer repeats for every later request', async () => {
    const api = new FakeApi();
    api.on('GET', '/api/x').reply(500, { n: 1 }).reply(200, { n: 2 });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) statuses.push((await api.fetch('https://api.test/api/x', { method: 'GET' })).status);
    expect(statuses).toEqual([500, 200, 200, 200]);
  });

  it('scripted headers are readable case-insensitively, as the Headers of fetch are (Retry-After, Content-Type)', async () => {
    const api = new FakeApi();
    api.on('GET', '/api/x')
      .reply(429, { error: 'slow down' }, { headers: { 'Retry-After': '30', 'content-type': 'application/json' } })
      .replies([{ status: 200, body: {}, headers: { 'X-Next': 'b' } }]);
    const first = await api.fetch('https://api.test/api/x', { method: 'GET' });
    expect(first.headers.get('retry-after')).toBe('30');
    expect(first.headers.get('RETRY-AFTER')).toBe('30');
    expect(first.headers.get('Content-Type')).toBe('application/json');
    expect(first.headers.has('retry-after')).toBe(true);
    expect(first.headers.get('X-Absent')).toBeNull();
    const second = await api.fetch('https://api.test/api/x', { method: 'GET' });
    expect(second.headers.get('x-next')).toBe('b');
    expect(second.headers.get('retry-after')).toBeNull();
  });

  it('a malformed-JSON answer carries its scripted headers too', async () => {
    const api = new FakeApi();
    api.on('GET', '/api/x').malformedJson(502, { headers: { 'Content-Type': 'text/html' } });
    const res = await api.fetch('https://api.test/api/x', { method: 'GET' });
    expect(res.headers.get('content-type')).toBe('text/html');
  });
});

describe('QA-047 · the fake clock: a non-monotonic wall clock over a monotonic one', () => {
  it('a −1 h wall jump moves Date.now back, leaves performance.now and pending timers alone', () => {
    const fired = jest.fn();
    setTimeout(fired, 500);
    const wall = Date.now();
    const mono = performance.now();
    clock.jumpWall(-60 * 60_000);
    expect(Date.now()).toBe(wall - 60 * 60_000);
    expect(performance.now()).toBe(mono);
    clock.advance(499);
    expect(fired).not.toHaveBeenCalled();
    clock.advance(1);
    expect(fired).toHaveBeenCalledTimes(1);
  });

  it('after a −1 h jump, the real History row still shows a non-negative age', () => {
    const faces = createFaceGuard();
    faces.install();
    try {
      faces.set('dark');
      const created = new Date(Date.now() - 5 * 60_000).toISOString(); // five minutes ago
      const item = { id: 's1', createdAt: created, moodKey: 'calm', title: 'Evening', source: 'manual' } as any;
      const texts = () => { let t!: ReactTestRenderer.ReactTestRenderer; act(() => { t = ReactTestRenderer.create(<HistoryRow item={item} now={new Date()} onPress={() => {}} />); }); const out = renderedTexts(t); act(() => { t.unmount(); }); return out; };
      expect(texts()).toContain('5m ago');
      clock.jumpWall(-60 * 60_000);
      const after = texts();
      expect(negativeAges(after)).toEqual([]);
      expect(relativeTime(created, new Date())).toBe('Just now');
    } finally {
      faces.restore();
    }
  });

  it('planted: a naive age formatter shows a negative age after the jump, and the check names it', () => {
    const naive = (iso: string) => `${Math.floor((Date.now() - Date.parse(iso)) / 60_000)}m ago`;
    const created = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(negativeAges([naive(created)])).toEqual([]);
    clock.jumpWall(-60 * 60_000);
    expect(negativeAges([naive(created), 'Just now', 'in 55 minutes'])).toEqual(['-55m ago', 'in 55 minutes']);
  });

  it.each([['NaNm ago'], ['Infinityh ago'], ['−55m ago'], ['− 1 h ago'], ['-Infinity min ago'], ['in NaN minutes'], ['Updated −3 hours ago']])('flags %s', (t) => {
    expect(negativeAges([t])).toEqual([t]);
  });

  it('leaves honest ages and hyphenated copy alone (negative control for the minus rule)', () => {
    expect(negativeAges(['5m ago', 'Just now', '2h ago', '5-10 min ago', 'Check-in 5m ago', 'Re-synced 2 hours ago', 'Mid-session · 3m ago', 'Top-5 mins ago', 'Yesterday'])).toEqual([]);
  });

  it('a JSX-interpolated negative age ({age}m ago) is read as rendered and flagged', () => {
    const Row = ({ age }: { age: number }) => <Text>{age}m ago</Text>;
    let t!: ReactTestRenderer.ReactTestRenderer;
    act(() => { t = ReactTestRenderer.create(<><Row age={-55} /><Row age={NaN} /><Row age={5} /></>); });
    const texts = renderedTexts(t);
    act(() => { t.unmount(); });
    expect(texts).toEqual(['-55m ago', 'NaNm ago', '5m ago']);
    expect(negativeAges(texts)).toEqual(['-55m ago', 'NaNm ago']);
  });

  it('restore() returns to real timers and the preset performance.now', () => {
    clock.restore();
    expect(jest.isMockFunction(performance.now)).toBe(true);
    clock = installFakeClock();
  });
});
