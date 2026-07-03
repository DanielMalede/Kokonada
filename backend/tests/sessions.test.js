'use strict';

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'a'.repeat(64);

// A11 Task 2 — GET /api/sessions history feed. Controller-direct tests (mocked
// model), matching the repo's accountDeletion.test.js style. The hard requirement:
// an explicit whitelist DTO — a naive res.json(doc) would leak the DECRYPTED
// contextPrompt getter AND the encrypted heartRate. The prompt is owner-facing and
// intended; the HR snapshot must never appear.

jest.mock('../app/models/PlaylistSession');
const PlaylistSession = require('../app/models/PlaylistSession');
const ctrl = require('../app/controllers/sessionsController');

function buildRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

// Chainable find() mock: captures the filter/sort/limit and resolves to `docs`.
function mockFind(docs) {
  const calls = {};
  PlaylistSession.find.mockImplementation((filter) => {
    calls.filter = filter;
    return {
      sort(s) { calls.sort = s; return this; },
      limit(n) { calls.limit = n; return Promise.resolve(docs); },
    };
  });
  return calls;
}

function sessionDoc(overrides = {}) {
  return {
    _id: overrides._id || '650000000000000000000001',
    createdAt: overrides.createdAt || new Date('2026-07-03T12:00:00Z'),
    moodKey: 'focus',
    musicProvider: 'spotify',
    biometricSnapshot: { heartRate: 72, activity: 'working' }, // getter would decrypt HR
    contextPrompt: 'late night coding vibe',                    // getter-decrypted on real docs
    isFallback: false,
    skipCount: 2,
    trackIds: ['t1', 't2', 't3'],
    trackKeys: ['isrc:AAA', 'isrc:BBB', 'isrc:CCC'],
    llmCacheKey: 'cache:secret',
    trackSummary: [{ id: 't1', title: 'Song A', artist: 'Artist A' }],
    ...overrides,
  };
}

beforeEach(() => jest.clearAllMocks());

describe('GET /api/sessions — DTO whitelist', () => {
  it('exposes the decrypted contextPrompt but NEVER the HR snapshot, trackKeys, or llmCacheKey', async () => {
    mockFind([sessionDoc()]);
    const res = buildRes();
    await ctrl.listSessions({ user: { _id: 'u1' }, query: {} }, res, jest.fn());

    const item = res.body.items[0];
    expect(item.contextPrompt).toBe('late night coding vibe');
    expect(item.moodKey).toBe('focus');
    expect(item.provider).toBe('spotify');
    expect(item.activity).toBe('working');
    expect(item.trackCount).toBe(3);
    expect(item.tracks).toEqual([{ id: 't1', title: 'Song A', artist: 'Artist A' }]);

    const blob = JSON.stringify(res.body);
    expect(blob).not.toMatch(/heartRate/);
    expect(blob).not.toContain('72');          // the raw HR value never leaks
    expect(blob).not.toMatch(/trackKeys|isrc:/);
    expect(blob).not.toMatch(/llmCacheKey|cache:secret/);
    expect(item).not.toHaveProperty('biometricSnapshot');
  });
});

describe('GET /api/sessions — pagination cursor', () => {
  it('returns a nextCursor when a full page + 1 is available, and stable keyset order', async () => {
    const docs = Array.from({ length: 3 }, (_, i) => sessionDoc({
      _id: `65000000000000000000000${i + 1}`,
      createdAt: new Date(Date.UTC(2026, 6, 3, 12, 0, i)),
    }));
    const calls = mockFind(docs); // limit+1 = 3 fetched for a limit of 2
    const res = buildRes();
    await ctrl.listSessions({ user: { _id: 'u1' }, query: { limit: '2' } }, res, jest.fn());

    expect(calls.limit).toBe(3); // limit + 1
    expect(calls.sort).toEqual({ createdAt: -1, _id: -1 });
    expect(res.body.items).toHaveLength(2); // trimmed to the page size
    expect(res.body.nextCursor).toEqual({
      before: docs[1].createdAt.toISOString(),
      beforeId: '650000000000000000000002',
    });
  });

  it('no nextCursor on the last page', async () => {
    mockFind([sessionDoc()]);
    const res = buildRes();
    await ctrl.listSessions({ user: { _id: 'u1' }, query: { limit: '20' } }, res, jest.fn());
    expect(res.body.nextCursor).toBeNull();
  });

  it('applies the keyset filter for a valid cursor and scopes to the caller', async () => {
    const calls = mockFind([]);
    const res = buildRes();
    await ctrl.listSessions({
      user: { _id: 'u1' },
      query: { before: '2026-07-03T12:00:00Z', beforeId: '650000000000000000000009' },
    }, res, jest.fn());
    expect(calls.filter.userId).toBe('u1'); // cross-user isolation
    expect(calls.filter.$or).toHaveLength(2);
  });

  it('ignores a malformed cursor (falls back to first page) but keeps the user scope', async () => {
    const calls = mockFind([]);
    const res = buildRes();
    await ctrl.listSessions({ user: { _id: 'u1' }, query: { before: 'not-a-date', beforeId: 'xx' } }, res, jest.fn());
    expect(calls.filter.$or).toBeUndefined();
    expect(calls.filter.userId).toBe('u1');
  });
});

describe('GET /api/sessions — limit clamps + legacy sessions', () => {
  it.each([['0', 1], ['500', 50], ['abc', 20], [undefined, 20]])('limit=%p clamps the fetch to %p (+1)', async (raw, expected) => {
    const calls = mockFind([]);
    await ctrl.listSessions({ user: { _id: 'u1' }, query: { limit: raw } }, buildRes(), jest.fn());
    expect(calls.limit).toBe(expected + 1);
  });

  it('a pre-A11 session with no trackSummary yields tracks:[] and trackCount from trackIds', async () => {
    mockFind([sessionDoc({ trackSummary: undefined })]);
    const res = buildRes();
    await ctrl.listSessions({ user: { _id: 'u1' }, query: {} }, res, jest.fn());
    expect(res.body.items[0].tracks).toEqual([]);
    expect(res.body.items[0].trackCount).toBe(3);
  });

  it('empty history → {items:[], nextCursor:null}', async () => {
    mockFind([]);
    const res = buildRes();
    await ctrl.listSessions({ user: { _id: 'u1' }, query: {} }, res, jest.fn());
    expect(res.body).toEqual({ items: [], nextCursor: null });
  });
});
