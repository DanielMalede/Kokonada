'use strict';

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

jest.mock('../app/models/BiometricLog', () => ({ find: jest.fn() }));
// W4-004: computeBaselines now also pages VitalSample and reads the profile's maxHeartRate.
// Mocked here so this suite keeps exercising the REAL delegated path rather than a connection
// error — an unmocked model raises a CastError before any of the assertions below are reached.
jest.mock('../app/models/VitalSample', () => ({ find: jest.fn() }));
jest.mock('../app/models/MedicalProfile', () => ({ findOne: jest.fn() }));
jest.mock('../app/config/redis', () => ({ getRedis: jest.fn(), createConnection: jest.fn() }));
jest.mock('../app/utils/biometricAudit', () => {
  const { decrypt } = jest.requireActual('../app/utils/encryption');
  return {
    logBiometricAccess: jest.fn(),
    // Functional spy: performs the REAL audited decrypt so cache reads still work, while
    // letting tests assert the accessor was actually used.
    auditedDecrypt: jest.fn((userId, purpose, blob, opts = {}) =>
      decrypt(blob, opts.parseJson ?? false, userId == null ? null : String(userId))),
  };
});

const BiometricLog = require('../app/models/BiometricLog');
const { getRedis } = require('../app/config/redis');
const { logBiometricAccess, auditedDecrypt } = require('../app/utils/biometricAudit');
const { decrypt } = require('../app/utils/encryption');
const baselines = require('../app/services/biosonic/baselines');

// Re-establish the key before EACH test. The crypto assertions read
// process.env.ENCRYPTION_KEY at CALL time, so a sibling suite (e.g. worker.test) that
// mutates it could, under --runInBand reordering, leave a stale value here. Setting it
// per-test makes this suite order-independent. (QA4 Finding 7)
beforeEach(() => { process.env.ENCRYPTION_KEY = 'a'.repeat(64); });

// Pagination mock: each call to find() serves the next batch (already-decrypted
// plain values — in prod the mongoose getters decrypt inside the worker).
function mockBatches(...batches) {
  BiometricLog.find.mockReset();
  for (const batch of batches) {
    BiometricLog.find.mockImplementationOnce(() => ({
      sort: () => ({ limit: () => Promise.resolve(batch) }),
    }));
  }
  BiometricLog.find.mockImplementation(() => ({
    sort: () => ({ limit: () => Promise.resolve([]) }),
  }));
}

const hr = (heartRate, i, activity = 'resting') => ({ _id: `id${i}`, heartRate, activity });

const VitalSample = require('../app/models/VitalSample');
const MedicalProfile = require('../app/models/MedicalProfile');

beforeEach(() => {
  jest.clearAllMocks();
  getRedis.mockReturnValue(null);
  // No vitals and no profile: this suite is about the HEART-RATE half of the baseline.
  VitalSample.find.mockImplementation(() => ({ sort: () => ({ limit: () => Promise.resolve([]) }) }));
  MedicalProfile.findOne.mockImplementation(() => ({ select: () => ({ lean: () => Promise.resolve(null) }) }));
});

describe('robust statistics (pure)', () => {
  it('median handles odd/even lengths', () => {
    expect(baselines.median([3, 1, 2])).toBe(2);
    expect(baselines.median([1, 2, 3, 4])).toBe(2.5);
  });

  it('mad is the median absolute deviation', () => {
    expect(baselines.mad([1, 1, 2, 2, 4, 6, 9])).toBe(1);
    expect(baselines.mad([5, 5, 5])).toBe(0);
  });

  it('robustZ falls back to a sane MAD when the series is constant (never divides by zero)', () => {
    const z = baselines.robustZ(80, 60, 0);
    expect(Number.isFinite(z)).toBe(true);
    expect(z).toBeGreaterThan(0);
  });

  it('robustZ is null for non-finite inputs', () => {
    expect(baselines.robustZ(NaN, 60, 4)).toBeNull();
    expect(baselines.robustZ(70, null, 4)).toBeNull();
  });
});

// DELIBERATE RE-PIN (W4-004). These three pinned the arithmetic of the PRE-DELEGATION estimator:
// a plain median over every 'resting'-or-'unknown' row, with a hard MIN_SAMPLES=10 cliff. That
// estimator is exactly what D2/D3/D15 are about — it pools workouts with sleep because the batch
// lane labels every row 'unknown', and it returns null rather than a shrunk estimate on thin data.
//
// The estimator still EXISTS: it is what `WAVE4_BASELINE_ENGINE_DISABLED` restores, and a
// kill-switch nobody executes is a kill-switch that does not work. So rather than delete these
// assertions or weaken them, they now run against the fallback path with their arithmetic
// unchanged, and the delegated path's behaviour is pinned in wave4.baselineWiring.test.js
// (including the counterpart of each: spike robustness holds, and the sparse cliff is gone).
describe('computeBaselines — legacy estimator, behind the S11 kill-switch', () => {
  beforeEach(() => { process.env.WAVE4_BASELINE_ENGINE_DISABLED = '1'; });
  afterEach(() => { delete process.env.WAVE4_BASELINE_ENGINE_DISABLED; });

  it('computes resting-HR median/MAD from paged, decrypted logs', async () => {
    mockBatches(
      Array.from({ length: 12 }, (_, i) => hr(i % 2 === 0 ? 59 : 61, i)), // median 60
      []
    );

    const stats = await baselines.computeBaselines('u1');

    expect(stats.rhrMedian).toBe(60);
    expect(stats.rhrMAD).toBeGreaterThanOrEqual(0);
    expect(stats.sampleCount).toBe(12);
  });

  it('a violent spike cannot skew the robust baseline', async () => {
    mockBatches(
      [...Array.from({ length: 20 }, (_, i) => hr(60, i)), hr(250, 99)],
      []
    );

    const stats = await baselines.computeBaselines('u1');

    expect(stats.rhrMedian).toBe(60); // the 250-bpm spike is invisible to the median
  });

  it('sparse data (< 10 samples) yields null stats, never a fabricated baseline', async () => {
    mockBatches([hr(60, 1), hr(61, 2)], []);

    const stats = await baselines.computeBaselines('u1');

    expect(stats.rhrMedian).toBeNull();
    expect(stats.rhrMAD).toBeNull();
    expect(stats.sampleCount).toBe(2);
  });
});

describe('computeBaselines (worker-only heavy path)', () => {
  it('non-finite decrypted values are dropped, not counted', async () => {
    mockBatches([hr(60, 1), hr(null, 2), hr(NaN, 3), hr(62, 4)], []);

    const stats = await baselines.computeBaselines('u1');

    expect(stats.sampleCount).toBe(2);
  });

  it('emits an audited biometric access (ADR-0005) with a sample count, never a value', async () => {
    mockBatches(Array.from({ length: 12 }, (_, i) => hr(60, i)), []);

    await baselines.computeBaselines('u1');

    expect(logBiometricAccess).toHaveBeenCalledWith(
      'u1', expect.any(String), expect.objectContaining({ count: expect.any(Number) }),
    );
  });
});

describe('getBaselines — encrypted Redis cache (zero-knowledge boundary)', () => {
  function fakeRedis(stored = null) {
    return {
      get: jest.fn().mockResolvedValue(stored),
      set: jest.fn().mockResolvedValue('OK'),
    };
  }

  it('caches ONLY an encrypted blob — no plaintext biometrics ever reach Redis', async () => {
    const redis = fakeRedis();
    getRedis.mockReturnValue(redis);
    mockBatches(Array.from({ length: 12 }, (_, i) => hr(60, i)), []);

    await baselines.getBaselines('u1');

    const [key, payload, ex, ttl] = redis.set.mock.calls[0];
    expect(key).toBe('bio:baseline:u1');
    expect(ex).toBe('EX');
    // DELIBERATE RE-PIN (W4-004): the blob is now RETAINED longer than it is considered FRESH.
    // That gap is stale-while-revalidate — the second half of D15. Pinned as the relationship
    // rather than as a literal, so the guarantee survives a future tuning of either number.
    expect(ttl).toBe(baselines.CACHE_TTL_S);
    expect(baselines.CACHE_TTL_S).toBeGreaterThan(baselines.FRESH_TTL_S);
    // The stored value is opaque base64 ciphertext — nothing else. This is stricter
    // than (and replaces) a substring check on the median: base64's alphabet includes
    // digits, so a random-IV ciphertext contains "60" by chance ~1.8% of runs, which
    // made the old `not.toContain('60')` assertion flaky. Any plaintext-JSON leak
    // (`{`, `"`, `:` …) would fail this regex, and the two checks below prove it stays
    // encrypted-at-rest yet decryptable only with the user-bound AAD.
    expect(payload).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);     // opaque base64, no plaintext in the clear
    expect(() => JSON.parse(payload)).toThrow();           // not plaintext JSON
    expect(decrypt(payload, false, 'u1')).toContain('60'); // but decryptable with the user-bound AAD
  });

  it('serves a cache hit without touching BiometricLog', async () => {
    const { encrypt } = require('../app/utils/encryption');
    const blob = encrypt(JSON.stringify({ rhrMedian: 61, rhrMAD: 3, sampleCount: 40 }), 'u1');
    getRedis.mockReturnValue(fakeRedis(blob));

    const stats = await baselines.getBaselines('u1');

    expect(stats.rhrMedian).toBe(61);
    expect(BiometricLog.find).not.toHaveBeenCalled();
  });

  it('routes the cached-blob decrypt through the audited accessor (ADR-0005, M2)', async () => {
    const { encrypt } = require('../app/utils/encryption');
    const blob = encrypt(JSON.stringify({ rhrMedian: 61 }), 'u1');
    getRedis.mockReturnValue(fakeRedis(blob));

    await baselines.getBaselines('u1');

    expect(auditedDecrypt).toHaveBeenCalledWith('u1', expect.any(String), blob, expect.objectContaining({ parseJson: true }));
  });

  it('a corrupt/tampered cache entry falls through to a fresh compute', async () => {
    getRedis.mockReturnValue(fakeRedis('tampered-garbage'));
    mockBatches(Array.from({ length: 12 }, (_, i) => hr(59, i)), []);

    const stats = await baselines.getBaselines('u1');

    // The claim is the FALL-THROUGH, not any particular number: a tampered blob must not be
    // served, and the heavy path must actually run. (Pinning the legacy median here would only
    // re-test the estimator, which wave4.baselineWiring.test.js covers on real timestamped data.)
    expect(BiometricLog.find).toHaveBeenCalled();
    expect(Number.isFinite(stats.rhrMedian)).toBe(true);
  });
});
