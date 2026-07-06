'use strict';

process.env.NODE_ENV = 'test';

jest.mock('../app/config/redis', () => ({ getRedis: jest.fn() }));
const { getRedis } = require('../app/config/redis');
const repo = require('../app/repositories/shadowBufferRepo');
const { QUEUES, QUEUE_NAMES } = require('../app/queues/definitions');

beforeEach(() => jest.clearAllMocks());

describe('queue registration', () => {
  it('registers the biometric-buffer queue', () => {
    expect(QUEUES.BIOMETRIC_BUFFER).toBe('biometric-buffer');
    expect(QUEUE_NAMES.has('biometric-buffer')).toBe(true);
  });
});

describe('shadowBufferRepo', () => {
  it('stores a playlist under buffer:{user}:{bioMoodKey} with the 30-min TTL', async () => {
    const set = jest.fn().mockResolvedValue('OK');
    getRedis.mockReturnValue({ set, get: jest.fn() });

    const ok = await repo.setBuffer('u1', 'bio:peak:running', { tracks: [{ uri: 'spotify:track:x' }] });

    expect(ok).toBe(true);
    const [key, val, mode, ttl] = set.mock.calls[0];
    expect(key).toBe('buffer:u1:bio:peak:running');
    expect(JSON.parse(val).tracks[0].uri).toBe('spotify:track:x');
    expect(mode).toBe('EX');
    expect(ttl).toBe(1800);
  });

  it('reads back a stored buffer, parsed', async () => {
    getRedis.mockReturnValue({ get: jest.fn().mockResolvedValue(JSON.stringify({ tracks: [1, 2] })), set: jest.fn() });
    const b = await repo.getBuffer('u1', 'bio:active:none');
    expect(b.tracks).toEqual([1, 2]);
  });

  it('returns null on a cold buffer (miss)', async () => {
    getRedis.mockReturnValue({ get: jest.fn().mockResolvedValue(null), set: jest.fn() });
    expect(await repo.getBuffer('u1', 'bio:resting:none')).toBeNull();
  });

  it('degrades safely without Redis and never throws', async () => {
    getRedis.mockReturnValue(null);
    expect(await repo.setBuffer('u1', 'k', {})).toBe(false);
    expect(await repo.getBuffer('u1', 'k')).toBeNull();
  });

  it('a corrupt cached blob yields null, not a crash', async () => {
    getRedis.mockReturnValue({ get: jest.fn().mockResolvedValue('{not json'), set: jest.fn() });
    expect(await repo.getBuffer('u1', 'k')).toBeNull();
  });
});
