'use strict';

// The Garmin personal lane's secrets are the personal API key (Garmin prefixes it GCDC_) and the
// 24-hour JWT the key is exchanged for. Either one in a log line, an error or a Sentry event is a
// disclosure under the Supplemental Terms §1 and means deleting the key in Garmin Connect. redact.js
// is the one definition of what a secret looks like, used by the Sentry scrubber and by any caller
// that logs.

const { redactString, redactSecrets, redactSecretsInPlace } = require('../app/services/wearable/garminPersonal/redact');
const { SENTINEL_KEY, makeJwt, signatureOf } = require('./fixtures/garminPersonal/sentinels');

const JWT = makeJwt({ exp: 1793000000 });

describe('redactString: the Garmin personal key', () => {
  it('removes the key wherever it sits in a string, every time it occurs', () => {
    const text = `${SENTINEL_KEY} at the start, ${SENTINEL_KEY} in the middle and at the end ${SENTINEL_KEY}`;

    const out = redactString(text);

    expect(out).not.toContain(SENTINEL_KEY);
    expect(out).not.toMatch(/GCDC_/i);
    expect(out).toBe('[REDACTED] at the start, [REDACTED] in the middle and at the end [REDACTED]');
  });

  it('removes it inside a URL query and keeps the rest of the URL', () => {
    expect(redactString(`https://x.example/p?key=${SENTINEL_KEY}&day=2026-10-25`))
      .toBe('https://x.example/p?key=[REDACTED]&day=2026-10-25');
  });

  it('matches the prefix in any case', () => {
    expect(redactString(`lower ${SENTINEL_KEY.replace('GCDC', 'gcdc')}`)).toBe('lower [REDACTED]');
  });
});

describe('redactString: the ApiKey and Bearer credentials and a bare JWT', () => {
  it('removes whatever follows ApiKey, in any case, and keeps the text after it', () => {
    expect(redactString(`Authorization: ApiKey ${SENTINEL_KEY}`)).toBe('Authorization: ApiKey [REDACTED]');
    expect(redactString('apikey   some.other-secret+value=, then text')).toBe('apikey [REDACTED] then text');
  });

  it('removes a Bearer token, in any case', () => {
    expect(redactString(`Authorization: Bearer ${JWT}`)).toBe('Authorization: Bearer [REDACTED]');
    expect(redactString('bearer opaque-token_123~+/= next')).toBe('bearer [REDACTED] next');
  });

  it('removes a bare JWT, also inside a URL-encoded line', () => {
    expect(redactString(`token=${JWT}&x=1`)).toBe('token=[REDACTED]&x=1');
    expect(redactString(`Authorization%3A%20Bearer%20${JWT}`)).not.toContain(signatureOf(JWT));
  });

  it('is idempotent and leaves a line with no credential untouched', () => {
    const benign = [
      'okhttp/4.12',
      'GET /hrv-service/hrv/2026-10-25',
      'garmin_personal_unauthorized',
      'garmin_personal_forbidden (403)',
      'a Bearer',
      'ApiKey',
      '',
    ];
    for (const text of benign) expect(redactString(text)).toBe(text);
    const once = redactString(`ApiKey ${SENTINEL_KEY} Bearer ${JWT} ${SENTINEL_KEY} ${JWT}`);
    expect(redactString(once)).toBe(once);
  });
});

describe('redactSecrets: a redacted copy for logging', () => {
  it('copies objects and arrays deeply with every string redacted and never mutates its input', () => {
    const input = {
      code: 'garmin_personal_paused',
      status: 429,
      ok: false,
      none: null,
      nested: { header: `Bearer ${JWT}`, list: [`ApiKey ${SENTINEL_KEY}`, 7, { deeper: SENTINEL_KEY }] },
    };
    const before = JSON.stringify(input);

    const out = redactSecrets(input);

    expect(out).toEqual({
      code: 'garmin_personal_paused',
      status: 429,
      ok: false,
      none: null,
      nested: { header: 'Bearer [REDACTED]', list: ['ApiKey [REDACTED]', 7, { deeper: '[REDACTED]' }] },
    });
    expect(JSON.stringify(input)).toBe(before);
  });

  it('survives a cycle', () => {
    const input = { note: SENTINEL_KEY };
    input.self = input;

    expect(redactSecrets(input)).toEqual({ note: '[REDACTED]', self: '[Circular]' });
  });

  it('turns an Error into a plain record whose name, message, code, status and stack are redacted', () => {
    const err = Object.assign(new Error(`failed with ApiKey ${SENTINEL_KEY}`), { code: 'x_code', status: 500 });

    const out = redactSecrets(err);

    expect(out).toMatchObject({ name: 'Error', message: 'failed with ApiKey [REDACTED]', code: 'x_code', status: 500 });
    expect(typeof out.stack).toBe('string');
    expect(JSON.stringify(out)).not.toContain(SENTINEL_KEY);
  });
});

describe('redactSecretsInPlace: rewriting an event the caller owns', () => {
  it('rewrites every string in plain objects and arrays in place', () => {
    const event = { message: `Bearer ${JWT}`, extra: { list: [SENTINEL_KEY, 3] } };

    redactSecretsInPlace(event);

    expect(event).toEqual({ message: 'Bearer [REDACTED]', extra: { list: ['[REDACTED]', 3] } });
  });

  it('skips the root keys it is told to skip and never walks into a class instance', () => {
    class Opaque {
      constructor() { this.held = SENTINEL_KEY; }
    }
    const metadata = {};
    Object.defineProperty(metadata, 'scope', { enumerable: true, get() { throw new Error('walked into skipped metadata'); } });
    const instance = new Opaque();
    const event = { sdkProcessingMetadata: metadata, kept: instance, message: SENTINEL_KEY };

    expect(() => redactSecretsInPlace(event, { skipKeys: ['sdkProcessingMetadata'] })).not.toThrow();
    expect(event.message).toBe('[REDACTED]');
    expect(instance.held).toBe(SENTINEL_KEY); // not walked: the caller decides what an instance is
  });

  it('throws when a string it must rewrite cannot be written, so a caller can fail closed', () => {
    const event = { breadcrumbs: [Object.freeze({ message: `ApiKey ${SENTINEL_KEY}` })] };

    expect(() => redactSecretsInPlace(event)).toThrow(TypeError);
  });

  it('leaves a frozen object with nothing to redact alone', () => {
    const event = { frozen: Object.freeze({ message: 'nothing secret here' }) };

    expect(() => redactSecretsInPlace(event)).not.toThrow();
  });
});
