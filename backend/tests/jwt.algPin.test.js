'use strict';

process.env.JWT_SECRET = 'test-jwt-secret-for-tests-only';

const jwt = require('jsonwebtoken');
const { signToken, verifyToken, signOauthState, verifyOauthState } = require('../app/utils/jwt');

// Pinning verify to HS256 blocks algorithm-substitution attacks (alg:none, RS/HS
// confusion, or a downgraded/upgraded HMAC variant). Without the pin, jsonwebtoken
// accepts any HMAC family member (HS256/384/512) the secret can validate. (audit T2.3)
describe('jwt algorithm pin (audit T2.3)', () => {
  it('verifyToken accepts a normally-signed HS256 token', () => {
    expect(verifyToken(signToken({ userId: 'u1' })).userId).toBe('u1');
  });

  it('verifyToken rejects a token signed with a non-HS256 algorithm (HS512)', () => {
    const forged = jwt.sign({ userId: 'attacker' }, process.env.JWT_SECRET, { algorithm: 'HS512' });
    expect(() => verifyToken(forged)).toThrow(/invalid algorithm/);
  });

  it('verifyOauthState accepts a normally-signed HS256 state', () => {
    expect(verifyOauthState(signOauthState('u1', 'spotify')).uid).toBe('u1');
  });

  it('verifyOauthState rejects a non-HS256 (HS512) state token', () => {
    const forged = jwt.sign(
      { uid: 'attacker', provider: 'spotify', purpose: 'oauth-state' },
      process.env.JWT_SECRET,
      { algorithm: 'HS512' },
    );
    expect(() => verifyOauthState(forged)).toThrow(/invalid algorithm/);
  });
});
