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

// THE SWEEP (T3, acceptance 5). The client is driven through every failure Garmin can hand it — a
// 401 twice, a refused key, a 403, three 429s, five 5xx, five timeouts, malformed JSON and a token
// body that is not a JWT — with a sentinel key, against the stateful fake Garmin whose error bodies
// echo the Authorization header back. Each error it throws is then handled the way a careless caller
// would: logged every way a console can print it, and captured by a real Sentry client with the
// integrations that serialise the most (linked causes, every error property). The event is read
// twice: RAW, as the SDK built it before any scrubbing (so the error itself must carry nothing), and
// SENT, as the transport received it after the app's scrubber. Neither the key nor any JWT the fake
// issued may appear in the error's message, stack or JSON, in the console, or in either view.
describe('the sweep: no failure path lets the key or the JWT out of the client', () => {
  const util = require('util');
  const SentryNode = require('@sentry/node');
  const { scrubEvent } = require('../app/config/sentry');
  const { startFakeGarmin, TOKEN_PATH } = require('./fixtures/garminPersonal/fakeGarminServer');
  const { fakeClock } = require('./fixtures/garminPersonal/clock');
  let createGarminPersonalClient;
  beforeAll(() => {
    ({ createGarminPersonalClient } = require('../app/services/wearable/garminPersonal/client'));
  });

  const HRV = '/hrv-service/hrv/2026-10-25';
  const times = (n, step) => Array.from({ length: n }, () => ({ ...step }));
  const WRONG_KEY = `${SENTINEL_KEY}-REVOKED`;

  const SCENARIOS = [
    { name: '401, then 401 again after the one re-exchange', code: 'garmin_personal_unauthorized', script: (g) => g.script(HRV, ...times(2, { status: 401 })) },
    { name: 'a key the token endpoint refuses (401)', code: 'garmin_personal_unauthorized', key: WRONG_KEY },
    { name: '403', code: 'garmin_personal_forbidden', script: (g) => g.script(HRV, { status: 403 }) },
    { name: 'three 429s', code: 'garmin_personal_paused', script: (g) => g.script(HRV, { status: 429 }, { status: 429, headers: { 'Retry-After': '61' } }, { status: 429 }) },
    { name: 'five 500s', code: 'garmin_personal_unavailable', script: (g) => g.script(HRV, ...times(5, { status: 500 })) },
    { name: 'five timeouts', code: 'garmin_personal_timeout', timeoutMs: 150, script: (g) => g.script(HRV, ...times(5, { hang: true })) },
    { name: 'malformed JSON that quotes the Authorization header', code: 'garmin_personal_malformed_response', script: (g) => g.script(HRV, { status: 200, echo: true }) },
    { name: 'a token body that quotes the key instead of a JWT', code: 'garmin_personal_token_invalid', script: (g) => g.script(TOKEN_PATH, { status: 200, echo: true }) },
  ];

  // One capture, two views. The SDK marks an error it has captured and skips it the next time, so the
  // same error cannot be captured twice; instead beforeSend records the event exactly as the SDK
  // built it from the error (RAW: before any scrubbing, sdkProcessingMetadata aside, which is never
  // sent), then hands it to the production scrubber, and the transport keeps what would be SENT.
  async function captureWithSentry(err) {
    const raw = [];
    const sent = [];
    const client = new SentryNode.NodeClient({
      dsn: 'https://public@o0.ingest.sentry.io/0',
      integrations: [SentryNode.linkedErrorsIntegration(), SentryNode.extraErrorDataIntegration({ depth: 10 })],
      transport: () => ({ send: async (envelope) => { sent.push(envelope); return {}; }, flush: async () => true }),
      stackParser: SentryNode.defaultStackParser,
      sendDefaultPii: false,
      beforeSend: (event, hint) => {
        const { sdkProcessingMetadata: _internal, ...transmitted } = event;
        raw.push(JSON.stringify(transmitted));
        return scrubEvent(event, hint);
      },
    });
    try {
      client.init();
      const scope = new SentryNode.Scope();
      scope.setClient(client);
      client.captureException(err, {}, scope);
      await client.flush(2000);
    } finally {
      await client.close(100);
    }
    expect(raw).toHaveLength(1); // the SDK really built an event from the error…
    expect(sent).toHaveLength(1); // …and it really reached the transport
    return { raw: raw[0], sent: JSON.stringify(sent) };
  }

  it.each(SCENARIOS)('$name', async ({ code, script, key = SENTINEL_KEY, timeoutMs = 5000 }) => {
    const printed = [];
    const methods = ['log', 'info', 'warn', 'error', 'debug'];
    const spies = methods.map((m) => jest.spyOn(console, m).mockImplementation((...args) => { printed.push(util.format(...args)); }));
    const clock = fakeClock('2026-10-26T06:00:00.000Z');
    const garmin = await startFakeGarmin({ apiKey: SENTINEL_KEY, now: clock.now });
    try {
      if (script) script(garmin);
      const client = createGarminPersonalClient({
        getApiKey: () => key, httpsAgent: garmin.agent, now: clock.now, sleep: clock.sleep, random: () => 0.5, timeoutMs,
      });

      const err = await client.get('hrv', { date: '2026-10-25' }).then(() => null, (e) => e);
      expect(err).toMatchObject({ code });

      // A careless caller prints the error every way it can.
      console.error(err);
      console.log(`${err}`);
      console.log(JSON.stringify(err));
      console.log(util.inspect(err, { showHidden: true, depth: null }));
      const sentry = await captureWithSentry(err);
      expect(sentry.raw).toContain(code); // the event is about this error

      // Preconditions: the secrets really went through the client to the (echoing) server.
      expect(garmin.tokenRequests()[0].authorization).toBe(`ApiKey ${key}`);
      const tokens = garmin.state.issuedTokens;
      for (const request of garmin.dataRequests()) expect(tokens.map((t) => `Bearer ${t}`)).toContain(request.authorization);

      const where = {
        message: err.message,
        stack: err.stack,
        json: JSON.stringify(err),
        inspect: util.inspect(err, { showHidden: true, depth: null }),
        console: printed.join('\n'),
        sentryRaw: sentry.raw,
        sentrySent: sentry.sent,
      };
      const secrets = [key, ...tokens, ...tokens.map(signatureOf)];
      for (const [place, text] of Object.entries(where)) {
        const leaks = secrets.filter((secret) => text.includes(secret));
        expect({ place, leaks }).toEqual({ place, leaks: [] });
        expect({ place, gcdc: /GCDC_/i.test(text), scheme: /(?:ApiKey|Bearer)\s/i.test(text) }).toEqual({ place, gcdc: false, scheme: false });
      }
    } finally {
      for (const spy of spies) spy.mockRestore();
      await garmin.close();
    }
  });
});
