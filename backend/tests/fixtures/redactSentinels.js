'use strict';

// Synthetic credentials for the redaction tests (redact.test.js, shadow.redactLinear.test.js and
// sentryScrub.test.js). Nothing here is or was ever a real key or token. Each value is assembled at run time so that no line of the repository holds a string
// shaped like a credential: the CI secret scan (gitleaks' jwt and generic-api-key rules) reads lines,
// and a literal sentinel would be a finding even though it is fake.

// The GCDC_ prefix the redaction matches, then an obviously synthetic body. The '.' and '-'
// exercise every character class the redaction pattern covers.
const SENTINEL_KEY = ['GCDC', 'TESTSENTINEL', 'K3Y.v4lue-0001'].join('_');

const base64url = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

/**
 * A JWT with the given `exp` (seconds). The signature segment is a recognisable synthetic marker, so
 * a test can look for it on its own: a leak of the signature is a leak of the token.
 */
function makeJwt({ exp, sub = 'sentinel-subject', marker = 'SENTINEL-SIGNATURE' }) {
  return [base64url({ alg: 'HS256', typ: 'JWT' }), base64url({ exp, sub }), base64url(marker)].join('.');
}

const signatureOf = (jwt) => jwt.split('.')[2];

module.exports = { SENTINEL_KEY, makeJwt, signatureOf, base64url };
