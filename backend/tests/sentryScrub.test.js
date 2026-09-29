'use strict';

// The Sentry SDK's express error handler auto-captures the request, which would
// otherwise ship the webhook's ?secret= (and any OAuth ?code=/?state=) to Sentry.
// scrubEvent is the beforeSend hook that strips query strings/URLs. (compliance C2)
const SentryNode = require('@sentry/node');
const { scrubEvent } = require('../app/config/sentry');

describe('sentry beforeSend scrubber (compliance C2)', () => {
  it('strips the query string from request.url (drops ?secret=)', () => {
    const out = scrubEvent({
      request: { url: 'https://api.example.com/api/integrations/garmin/webhook?secret=SUPERSECRET&x=1' },
    });
    expect(out.request.url).toBe('https://api.example.com/api/integrations/garmin/webhook');
    expect(JSON.stringify(out)).not.toContain('SUPERSECRET');
  });

  it('removes request.query_string entirely', () => {
    const out = scrubEvent({ request: { url: 'https://x/y', query_string: 'secret=abc&code=xyz' } });
    expect(out.request.query_string).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain('abc');
    expect(JSON.stringify(out)).not.toContain('xyz');
  });

  it('is a no-op for events with no request (never throws)', () => {
    expect(scrubEvent({ message: 'boom' })).toEqual({ message: 'boom' });
    expect(scrubEvent(null)).toBeNull();
  });
});

// `sendDefaultPii: false` does NOT keep request headers or cookies out of events. In @sentry/core
// 10.58.0, integrations/requestdata.js attaches `normalizedRequest.headers` whenever
// `dataCollection.httpHeaders.request !== false` — and sendDefaultPii:false resolves it to
// `{ deny: [...] }`, not false — and parses `cookie` into `request.cookies` on the same rule. Its
// deny list (forwarded, -ip, remote-, via, -user) is applied to span attributes only. So every event
// captured inside an HTTP request carried `authorization: Bearer <app JWT>` (middleware/auth.js)
// or the watch `whr_` token, plus the webhook credentials the app accepts.
describe('sentry scrubber — request credentials (headers and cookies)', () => {
  const CREDENTIALS = {
    authorization: 'Bearer CANARY-APP-JWT',
    'proxy-authorization': 'Basic CANARY-PROXY',
    cookie: 'sid=CANARY-COOKIE; theme=dark',
    'x-api-key': 'CANARY-API-KEY',
    'x-garmin-webhook-secret': 'CANARY-GARMIN-SECRET', // integrationsController Garmin webhook
    'x-suunto-signature': 'CANARY-SUUNTO-SIG',         // integrationsController Suunto webhook
  };
  const BENIGN = { host: 'api.kokonada.app', 'user-agent': 'okhttp/4.12', 'content-type': 'application/json' };

  // The event exactly as the SDK shapes it: the real RequestData integration, run by the production
  // client class configured the way app/config/sentry.js configures it (sendDefaultPii: false).
  function sdkShapedEvent(headers) {
    const client = new SentryNode.NodeClient({
      integrations: [],
      transport: () => ({ send: async () => ({}), flush: async () => true }),
      stackParser: SentryNode.defaultStackParser,
      sendDefaultPii: false,
    });
    const event = {
      exception: { values: [{ type: 'Error', value: 'boom' }] },
      sdkProcessingMetadata: {
        normalizedRequest: {
          method: 'POST',
          url: 'https://api.kokonada.app/api/integrations/hydrate-library?state=CANARY-STATE',
          query_string: 'state=CANARY-STATE',
          headers,
        },
      },
    };
    return SentryNode.requestDataIntegration().processEvent(event, {}, client);
  }

  it('(precondition) the SDK really attaches the credentials under sendDefaultPii:false', () => {
    const event = sdkShapedEvent({ ...BENIGN, ...CREDENTIALS });
    expect(event.request.headers.authorization).toBe('Bearer CANARY-APP-JWT');
    expect(event.request.cookies).toEqual({ sid: 'CANARY-COOKIE', theme: 'dark' });
  });

  it('strips every credential header and the parsed cookies, keeps the rest of the request', () => {
    const out = scrubEvent(sdkShapedEvent({ ...BENIGN, ...CREDENTIALS }));

    expect(out.request.headers).toEqual(BENIGN);
    expect(out.request).not.toHaveProperty('cookies');
    expect(out.request.url).toBe('https://api.kokonada.app/api/integrations/hydrate-library');
    expect(out.request.method).toBe('POST');
    // event.request is what is transmitted. (sdkProcessingMetadata still holds the SDK's in-process
    // copy of the request; createEventEnvelope deletes it before sending — pinned end to end below.)
    expect(JSON.stringify(out.request)).not.toMatch(/CANARY/);
  });

  // End to end through the SDK's own pipeline: the production client class, the RequestData
  // integration, our beforeSend, and the envelope the transport would put on the wire.
  it('no credential reaches the envelope the transport sends', async () => {
    const sent = [];
    const client = new SentryNode.NodeClient({
      dsn: 'https://public@o0.ingest.sentry.io/0',
      integrations: [SentryNode.requestDataIntegration()],
      transport: () => ({ send: async (envelope) => { sent.push(envelope); return {}; }, flush: async () => true }),
      stackParser: SentryNode.defaultStackParser,
      sendDefaultPii: false,
      beforeSend: scrubEvent,
    });
    try {
      client.init();
      const scope = new SentryNode.Scope();
      scope.setClient(client);
      scope.setSDKProcessingMetadata({
        normalizedRequest: {
          method: 'POST',
          url: 'https://api.kokonada.app/api/integrations/hydrate-library?state=CANARY-STATE',
          query_string: 'state=CANARY-STATE',
          headers: { ...BENIGN, ...CREDENTIALS },
        },
      });

      client.captureException(new Error('boom'), {}, scope);
      await client.flush(2000);

      expect(sent).toHaveLength(1);
      const wire = JSON.stringify(sent);
      expect(wire).toContain('okhttp/4.12'); // the request really was attached…
      expect(wire).not.toMatch(/CANARY/);    // …without a single credential
    } finally {
      await client.close(100);
    }
  });

  it('matches header names case-insensitively', () => {
    const out = scrubEvent({
      request: {
        url: 'https://x/y',
        headers: { Authorization: 'Bearer CANARY-A', COOKIE: 'sid=CANARY-B', 'X-Api-Key': 'CANARY-C', 'X-Garmin-Webhook-Secret': 'CANARY-D', Accept: 'application/json' },
      },
    });

    expect(out.request.headers).toEqual({ Accept: 'application/json' });
  });

  it('never throws on a request with no headers object', () => {
    expect(() => scrubEvent({ request: { url: 'https://x/y', headers: null } })).not.toThrow();
    expect(() => scrubEvent({ request: { url: 'https://x/y' } })).not.toThrow();
  });
});

// beforeSend runs for ERROR events only; transaction events go through beforeSendTransaction
// (@sentry/core client.js processBeforeSend), and RequestData's processEvent attaches the same
// headers to them. Production samples 10% of requests as transactions, so both hooks must scrub.
describe('initSentry wires the scrubber for both error and transaction events', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('@sentry/node');
    delete process.env.SENTRY_DSN;
  });

  it('passes scrubEvent as beforeSend AND beforeSendTransaction', () => {
    jest.resetModules();
    const init = jest.fn();
    jest.doMock('@sentry/node', () => ({ init, setupExpressErrorHandler: jest.fn(), captureException: jest.fn() }));
    process.env.SENTRY_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';

    const sentry = require('../app/config/sentry');
    sentry.initSentry(null);

    const options = init.mock.calls[0][0];
    expect(options.sendDefaultPii).toBe(false);
    expect(options.beforeSend).toBe(sentry.scrubEvent);
    expect(options.beforeSendTransaction).toBe(sentry.scrubEvent);
  });
});
