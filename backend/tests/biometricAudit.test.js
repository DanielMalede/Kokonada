'use strict';

// ADR-0005 audit-trail requirement: every decryption of special-category biometric data must
// be auditable — logged with userId + purpose + timestamp — while biometrics themselves are
// NEVER logged. This pins that the accessor records the access but never the plaintext value.
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

const { encrypt } = require('../app/utils/encryption');
const { logBiometricAccess, auditedDecrypt } = require('../app/utils/biometricAudit');

const USER = '507f1f77bcf86cd799439011';

let logSpy;
// Freeze time so the ISO timestamp is deterministic and can never coincidentally contain a
// test value substring (millis could otherwise collide with "72"/"58").
beforeAll(() => jest.useFakeTimers().setSystemTime(new Date('2026-07-16T00:00:00.000Z')));
afterAll(() => jest.useRealTimers());
beforeEach(() => { logSpy = jest.spyOn(console, 'info').mockImplementation(() => {}); });
afterEach(() => { logSpy.mockRestore(); });

function allLogText() {
  return logSpy.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
}

describe('logBiometricAccess', () => {
  it('records userId + purpose + ISO timestamp', () => {
    const rec = logBiometricAccess(USER, 'baseline-aggregation');
    expect(rec.userId).toBe(USER);
    expect(rec.purpose).toBe('baseline-aggregation');
    expect(new Date(rec.at).toISOString()).toBe(rec.at);
    const text = allLogText();
    expect(text).toContain(USER);
    expect(text).toContain('baseline-aggregation');
  });

  it('logs a sample count but NEVER a plaintext biometric value', () => {
    logBiometricAccess(USER, 'baseline-aggregation', { count: 3, value: 72 });
    const text = allLogText();
    expect(text).toContain('count=3');
    // 72 is a plaintext HR — it must never reach the log even if a caller leaks it into meta.
    expect(text).not.toContain('72');
    expect(text).not.toContain('value');
  });
});

describe('auditedDecrypt', () => {
  it('decrypts an AAD-bound biometric ciphertext and logs the access, never the value', () => {
    const blob = encrypt('58', USER); // AAD-bound to the owner
    const plain = auditedDecrypt(USER, 'live-heart-context', blob);
    expect(plain).toBe('58');
    const text = allLogText();
    expect(text).toContain('live-heart-context');
    expect(text).not.toContain('58'); // the decrypted vital never appears in the audit log
  });

  it('supports JSON payloads', () => {
    const blob = encrypt({ rhrMedian: 60 }, USER);
    expect(auditedDecrypt(USER, 'baseline-read', blob, { parseJson: true })).toEqual({ rhrMedian: 60 });
  });
});
