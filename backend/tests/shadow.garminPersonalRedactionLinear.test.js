'use strict';

// RA-1 (the resilience audit of #274 at d8428ec, S1). scrubEvent (app/config/sentry.js) passes every
// string of every Sentry event through redact.js, synchronously, on the API process, and a request's
// URL and headers are whatever the caller sent. The bare-JWT pattern
// /eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g tried a match at every `eyJ` and each try
// scanned to the next dot, so a run of `eyJeyJ…` with no dot cost time quadratic in its length.
// Measured at d8428ec: 4 KB 8.6 ms, 8 KB 35 ms, 16 KB 137 ms, 32 KB 553 ms, 64 KB 2254 ms, four times
// longer at every doubling, so 256 KB held the event loop for about 36 s.
//
// Every case below feeds 256 KB of the worst input one pattern can be given and must finish in well
// under a second. Linear work on 256 KB takes a few milliseconds, so the bound leaves a slow CI
// runner two orders of magnitude of room and still fails a quadratic pattern by two.

const fc = require('fast-check');
const { redactString } = require('../app/services/wearable/garminPersonal/redact');
const { scrubEvent } = require('../app/config/sentry');
const { SENTINEL_KEY, makeJwt, signatureOf } = require('./fixtures/garminPersonal/sentinels');

const JWT = makeJwt({ exp: 1793000000 });
const KB = 1024;
const LIMIT_MS = 500;

function timed(fn) {
  const start = process.hrtime.bigint();
  const value = fn();
  return { value, ms: Number(process.hrtime.bigint() - start) / 1e6 };
}

const eyjRun = (bytes) => 'eyJ'.repeat(Math.floor(bytes / 3));

describe('the bare-JWT pattern runs in linear time (RA-1)', () => {
  it('a 256 KB run of eyJ with no dot, then a real JWT: linear, and the JWT is still redacted', () => {
    const run = eyjRun(256 * KB);

    const { value, ms } = timed(() => redactString(`${run} ${JWT}`));

    expect(ms).toBeLessThan(LIMIT_MS);
    expect(value).toBe(`${run} [REDACTED]`);
  });

  it('a 256 KB run with one dot: linear, and two segments are not a JWT', () => {
    const half = eyjRun(128 * KB);
    const text = `${half}.${half}`;

    const { value, ms } = timed(() => redactString(text));

    expect(ms).toBeLessThan(LIMIT_MS);
    expect(value).toBe(text);
  });

  it('a 256 KB run of short dotted pieces that never complete a JWT is linear and left alone', () => {
    const text = 'eyJ..'.repeat(Math.floor((256 * KB) / 5));

    const { value, ms } = timed(() => redactString(text));

    expect(ms).toBeLessThan(LIMIT_MS);
    expect(value).toBe(text);
  });

  it('a URL-encoded Bearer (Authorization%3A%20Bearer%20<jwt>) is still redacted, the encoding kept', () => {
    const out = redactString(`Authorization%3A%20Bearer%20${JWT}`);

    expect(out).toBe('Authorization%3A%20Bearer%20[REDACTED]');
    expect(out).not.toContain(signatureOf(JWT));
  });
});

describe('the other three patterns stay linear on their worst input', () => {
  it.each([
    ['ApiKey, then 256 KB of whitespace and a quote', () => `ApiKey${' '.repeat(256 * KB)}"`],
    ['ApiKey with whitespace and a quote, repeated over 256 KB', () => `aPiKeY${' '.repeat(58)}'`.repeat(Math.floor((256 * KB) / 65))],
    ['ApiKey repeated with no whitespace over 256 KB', () => 'ApiKey'.repeat(Math.floor((256 * KB) / 6))],
    ['Bearer, then 256 KB of whitespace and a character outside token68', () => `Bearer${'\t'.repeat(256 * KB)}!`],
    ['Bearer with whitespace and a quote, repeated over 256 KB', () => `bEaReR${' '.repeat(58)}"`.repeat(Math.floor((256 * KB) / 65))],
    ['GCDC_ repeated over 256 KB', () => 'GCDC_'.repeat(Math.floor((256 * KB) / 5))],
    ['GCDC_ followed by a character outside the key, repeated over 256 KB', () => 'gcdc_!'.repeat(Math.floor((256 * KB) / 6))],
  ])('%s', (_label, build) => {
    const text = build();

    const { ms } = timed(() => redactString(text));

    expect(ms).toBeLessThan(LIMIT_MS);
  });
});

describe('scrubEvent on an event full of eyJ runs (RA-1)', () => {
  it('a transaction with 8 KB eyJ runs in its name, request.url, two headers, trace data and 120 extra keys: linear, the event kept', () => {
    const run = eyjRun(8 * KB);
    const extra = Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`k${i}`, run]));
    extra.k119 = `pulled with ${JWT}`;
    const event = {
      type: 'transaction',
      transaction: run,
      request: { url: `https://api.kokonada.app/${run}`, headers: { 'user-agent': run, 'x-request-id': run } },
      contexts: { trace: { op: 'http.server', data: { 'http.url': `https://api.kokonada.app/${run}`, 'http.route': run } } },
      extra,
    };

    const { value: out, ms } = timed(() => scrubEvent(event));

    expect(ms).toBeLessThan(LIMIT_MS);
    expect(out).not.toBeNull();
    expect(out.transaction).toBe(run);
    expect(out.request.url).toBe(`https://api.kokonada.app/${run}`);
    expect(out.request.headers).toEqual({ 'user-agent': run, 'x-request-id': run });
    expect(out.contexts.trace.data['http.route']).toBe(run);
    expect(out.extra.k0).toBe(run);
    expect(out.extra.k119).toBe('pulled with [REDACTED]');
  });
});

// The linear matcher must redact exactly what the old pattern redacted: same matches, same text kept
// around them. The old patterns are the oracle, on strings short enough that their cost does not
// matter, built from the pieces that move a match boundary.
describe('the linear matcher redacts exactly what the old pattern did', () => {
  const OLD_PATTERNS = [
    [/(ApiKey)\s+[^\s"'`]+/gi, (_match, scheme) => `${scheme} [REDACTED]`],
    [/(Bearer)\s+[A-Za-z0-9\-._~+/]+=*/gi, (_match, scheme) => `${scheme} [REDACTED]`],
    [/GCDC_[A-Za-z0-9._-]+/gi, () => '[REDACTED]'],
    [/eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, () => '[REDACTED]'],
  ];
  const oracle = (text) => OLD_PATTERNS.reduce((out, [pattern, replace]) => out.replace(pattern, replace), text);
  const PIECES = ['eyJ', 'ey', 'J', '.', '..', 'a', 'Z9', '-', '_', '%20', '20', ' ', '"', '=', '/', 'GCDC_', 'Bearer ', 'ApiKey ', '[REDACTED]'];

  it('on any string made of the pieces that move a boundary', () => {
    fc.assert(fc.property(
      fc.array(fc.constantFrom(...PIECES), { maxLength: 40 }).map((pieces) => pieces.join('')),
      (text) => redactString(text) === oracle(text),
    ), { numRuns: 5000 });
  });

  it('on real credentials in their real contexts', () => {
    const cases = [
      `token=${JWT}&x=1`,
      `Authorization: Bearer ${JWT}`,
      `x.${JWT}.y`,
      `${JWT}.${JWT}`,
      `${JWT.split('.').slice(0, 2).join('.')}.`,
      `20${JWT}`,
      `ApiKey ${SENTINEL_KEY} then ${JWT} and ${SENTINEL_KEY}`,
    ];
    for (const text of cases) expect({ text, out: redactString(text) }).toEqual({ text, out: oracle(text) });
  });
});
