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
  function sdkShapedEvent(headers, data) {
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
          ...(data !== undefined ? { data } : {}),
        },
      },
    };
    return SentryNode.requestDataIntegration().processEvent(event, {}, client);
  }

  // B1 — the Http integration buffers every incoming body (@sentry/core http/server-subscription.js
  // patchRequestToCaptureBody, default 'medium' = 10 kB, no sendDefaultPii check) and RequestData
  // ALWAYS attaches it (requestdata.js `data: true`). Login, refresh and SSO bodies are credentials.
  it('strips the request body the SDK attaches (request.data)', () => {
    const body = '{"email":"a@b.c","password":"CANARY-PW","refreshToken":"CANARY-REFRESH"}';
    const shaped = sdkShapedEvent(BENIGN, body);
    expect(shaped.request.data).toBe(body); // precondition: the SDK really attaches it

    const out = scrubEvent(shaped);

    expect(out.request).not.toHaveProperty('data');
    expect(JSON.stringify(out.request)).not.toMatch(/CANARY/);
  });

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

  // Strict mode is what makes "fails closed" true. In a sloppy-mode module `delete` on a
  // non-configurable property returns false SILENTLY, so the event would ship with the body still
  // on it; in strict mode it throws, and the catch drops the event.
  it('fails closed on a property scrubbing cannot delete (non-configurable request.data)', () => {
    const event = { request: { url: 'https://x/y' } };
    Object.defineProperty(event.request, 'data', { value: '{"password":"CANARY-PW"}', enumerable: true, configurable: false });

    expect(scrubEvent(event)).toBeNull();
  });

  // The drop is logged, but only as the error's NAME — the message could quote the event.
  it('logs only the error name when it drops an event, never the event or the message', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const hostile = { request: { url: 'https://x/y?secret=CANARY' } };
      Object.defineProperty(hostile.request, 'headers', { enumerable: true, get() { throw new TypeError('CANARY-IN-MESSAGE'); } });

      expect(scrubEvent(hostile)).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]).toEqual(['[sentry] scrubEvent failed (TypeError); event dropped']);
    } finally {
      warn.mockRestore();
    }
  });

  // A credential scrubber must fail CLOSED: if scrubbing throws halfway, returning the event would
  // ship it half-scrubbed. beforeSend returning null drops the event instead.
  it('fails closed: an event that makes scrubbing throw is dropped (null), never sent half-scrubbed', () => {
    const hostile = { request: { url: 'https://x/y?secret=CANARY' } };
    Object.defineProperty(hostile.request, 'headers', { enumerable: true, get() { throw new Error('boom'); } });

    expect(scrubEvent(hostile)).toBeNull();
  });
});

// B2 — the server span's attributes (node-core httpServerSpansIntegration: http.url, http.target
// WITH the query, http.client_ip from X-Forwarded-For; net.peer.ip on response) land in
// contexts.trace.data of every sampled transaction, and outgoing client spans / breadcrumbs carry
// url.full and http.query. The Garmin push's permanent credential is `?secret=`.
describe('sentry scrubber — query strings and client addresses in spans and breadcrumbs', () => {
  const SERVER_SPAN_DATA = () => ({
    'http.method': 'POST',
    'http.url': 'https://api.kokonada.app/api/integrations/garmin/webhook?secret=CANARY-SECRET',
    'http.target': '/api/integrations/garmin/webhook?secret=CANARY-SECRET',
    'url.full': 'https://api.kokonada.app/api/integrations/garmin/webhook?secret=CANARY-SECRET#frag',
    'http.query': 'secret=CANARY-SECRET',
    'url.query': 'secret=CANARY-SECRET',
    'http.client_ip': '203.0.113.77',
    'net.peer.ip': '203.0.113.77',
    'net.host.ip': '10.0.0.5',
    'http.status_code': 200,
  });

  it('cuts the query off url attributes and deletes query and client-address attributes, keeping the rest', () => {
    const out = scrubEvent({
      type: 'transaction',
      contexts: { trace: { op: 'http.server', data: SERVER_SPAN_DATA() } },
      spans: [{ op: 'http.client', data: { 'url.full': 'https://api.spotify.com/v1/search?q=CANARY-ARTIST', 'http.query': '?q=CANARY-ARTIST', 'http.method': 'GET' } }, { op: 'db' }],
    });

    expect(out.contexts.trace.data).toEqual({
      'http.method': 'POST',
      'http.url': 'https://api.kokonada.app/api/integrations/garmin/webhook',
      'http.target': '/api/integrations/garmin/webhook',
      'url.full': 'https://api.kokonada.app/api/integrations/garmin/webhook',
      'net.host.ip': '10.0.0.5',
      'http.status_code': 200,
    });
    expect(out.spans[0].data).toEqual({ 'url.full': 'https://api.spotify.com/v1/search', 'http.method': 'GET' });
    expect(out.spans[1]).toEqual({ op: 'db' });
  });

  // Found by the closing-evidence run: the SDK copies request headers into span attributes as
  // `http.request.header.<name>` and cookies as `http.request.header.cookie.<cookie-name>`, masking
  // only names on its sensitive-snippet list. `sid` is masked; a cookie named `io` shipped raw, and
  // `x-suunto-signature` ("signature" is not a snippet) ships raw too.
  it('deletes credential header attributes — every cookie, authorization, the webhook headers — from span data', () => {
    const out = scrubEvent({
      type: 'transaction',
      contexts: {
        trace: {
          data: {
            'http.request.header.cookie.io': 'CANARY-IO-COOKIE',
            'http.request.header.cookie.sid': '[Filtered]',
            'http.request.header.authorization': '[Filtered]',
            'http.request.header.proxy_authorization': 'CANARY-PROXY',
            'http.request.header.x_suunto_signature': 'CANARY-SUUNTO-SIG',
            'http.request.header.x_garmin_webhook_secret': '[Filtered]',
            'http.request.header.x_api_key': '[Filtered]',
            'http.response.header.set_cookie.session': 'CANARY-SET-COOKIE',
            'http.request.header.user_agent': 'okhttp/4.12',
            'http.request.header.content_type': 'application/json',
          },
        },
      },
    });

    expect(out.contexts.trace.data).toEqual({
      'http.request.header.user_agent': 'okhttp/4.12',
      'http.request.header.content_type': 'application/json',
    });
  });

  it('cuts the query off outgoing-request breadcrumbs (http.query, url)', () => {
    const out = scrubEvent({
      breadcrumbs: [
        { category: 'http', data: { url: 'https://api.spotify.com/v1/search?q=CANARY-ARTIST', 'http.query': '?q=CANARY-ARTIST', status_code: 200 } },
        { category: 'console', message: 'hello' },
      ],
    });

    expect(out.breadcrumbs[0].data).toEqual({ url: 'https://api.spotify.com/v1/search', status_code: 200 });
    expect(out.breadcrumbs[1]).toEqual({ category: 'console', message: 'hello' });
  });

  // A real transaction event through the production client class: RequestData attaches the
  // request (URL, query, body), beforeSendTransaction runs, and the envelope is what would ship.
  it('a transaction with a query secret, a client IP and a body reaches the envelope with none of them', async () => {
    const sent = [];
    const client = new SentryNode.NodeClient({
      dsn: 'https://public@o0.ingest.sentry.io/0',
      integrations: [SentryNode.requestDataIntegration()],
      transport: () => ({ send: async (envelope) => { sent.push(envelope); return {}; }, flush: async () => true }),
      stackParser: SentryNode.defaultStackParser,
      sendDefaultPii: false,
      beforeSend: scrubEvent,
      beforeSendTransaction: scrubEvent,
    });
    try {
      client.init();
      const scope = new SentryNode.Scope();
      scope.setClient(client);
      scope.setSDKProcessingMetadata({
        normalizedRequest: {
          method: 'POST',
          url: 'https://api.kokonada.app/api/integrations/garmin/webhook?secret=CANARY-SECRET',
          query_string: 'secret=CANARY-SECRET',
          headers: { host: 'api.kokonada.app', 'x-forwarded-for': '203.0.113.77' },
          data: '{"dailies":[],"note":"CANARY-BODY"}',
        },
        ipAddress: '203.0.113.77',
      });
      const now = Date.now() / 1000;
      client.captureEvent({
        type: 'transaction',
        transaction: 'POST /api/integrations/garmin/webhook',
        start_timestamp: now - 0.05,
        timestamp: now,
        contexts: { trace: { trace_id: '0123456789abcdef0123456789abcdef', span_id: '0123456789abcdef', op: 'http.server', data: SERVER_SPAN_DATA() } },
        spans: [],
      }, {}, scope);
      await client.flush(2000);

      expect(sent).toHaveLength(1);
      const wire = JSON.stringify(sent);
      expect(wire).toContain('"type":"transaction"');
      expect(wire).toContain('/api/integrations/garmin/webhook'); // the transaction really shipped…
      expect(wire).not.toMatch(/CANARY/);                        // …without the secret or the body
      expect(wire).not.toContain('203.0.113.77');                 // …or the client address
    } finally {
      await client.close(100);
    }
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

  const mockSdk = (init, httpIntegration) => jest.doMock('@sentry/node', () => ({
    init, httpIntegration, setupExpressErrorHandler: jest.fn(), captureException: jest.fn(),
  }));

  it('passes scrubEvent as beforeSend AND beforeSendTransaction', () => {
    jest.resetModules();
    const init = jest.fn();
    mockSdk(init, jest.fn(() => ({ name: 'Http' })));
    process.env.SENTRY_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';

    const sentry = require('../app/config/sentry');
    sentry.initSentry(null);

    const options = init.mock.calls[0][0];
    expect(options.sendDefaultPii).toBe(false);
    expect(options.beforeSend).toBe(sentry.scrubEvent);
    expect(options.beforeSendTransaction).toBe(sentry.scrubEvent);
  });

  // B1 at the source: `maxIncomingRequestBodySize: 'none'` → @sentry/node integrations/http.js:21
  // maps it to the server integration's maxRequestBodySize → @sentry/core
  // integrations/http/server-subscription.js:54 skips patchRequestToCaptureBody when it is 'none'.
  // Passing an `Http` instance in `integrations` REPLACES the default one (core integration.js
  // filterDuplicates: a user instance wins over the default of the same name).
  it('replaces the default Http integration with one that never buffers incoming bodies', () => {
    jest.resetModules();
    const init = jest.fn();
    const httpIntegration = jest.fn((options) => ({ name: 'Http', options }));
    mockSdk(init, httpIntegration);
    process.env.SENTRY_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';

    require('../app/config/sentry').initSentry(null);

    expect(httpIntegration).toHaveBeenCalledWith({ maxIncomingRequestBodySize: 'none' });
    expect(init.mock.calls[0][0].integrations).toEqual([{ name: 'Http', options: { maxIncomingRequestBodySize: 'none' } }]);
  });
});

// Console breadcrumbs. The default Console integration turns every console line into a breadcrumb.
// The app logs personal signals (biometricHandler: the last emotion tap and HR-derived tempo
// targets; user ids in biometricHandler and integrationsController). Socket packets run outside any
// request scope, so those breadcrumbs pile up on the shared isolation scope, and every incoming
// request CLONES it (@sentry/core integrations/http/server-subscription.js:43) — one user's lines
// ride on other users' events. beforeBreadcrumb drops the whole `console` category.
describe('console lines never become breadcrumbs', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('@sentry/node');
    delete process.env.SENTRY_DSN;
  });

  it('initSentry wires dropConsoleBreadcrumb as beforeBreadcrumb', () => {
    jest.resetModules();
    const init = jest.fn();
    jest.doMock('@sentry/node', () => ({
      init, httpIntegration: jest.fn(() => ({ name: 'Http' })), setupExpressErrorHandler: jest.fn(), captureException: jest.fn(),
    }));
    process.env.SENTRY_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';

    const sentry = require('../app/config/sentry');
    sentry.initSentry(null);

    expect(typeof sentry.dropConsoleBreadcrumb).toBe('function');
    expect(init.mock.calls[0][0].beforeBreadcrumb).toBe(sentry.dropConsoleBreadcrumb);
  });

  it('dropConsoleBreadcrumb drops console breadcrumbs and keeps every other kind', () => {
    const { dropConsoleBreadcrumb } = require('../app/config/sentry');
    const http = { category: 'http', data: { url: 'https://api.spotify.com/v1/me' } };

    expect(dropConsoleBreadcrumb({ category: 'console', level: 'log', message: 'user=u1' })).toBeNull();
    expect(dropConsoleBreadcrumb(http)).toBe(http);
  });

  // The real client and the real Console integration: a console line, then a captured error. The
  // control run (no hook) proves the SDK really attaches the line; the second run proves the line
  // really went through the SDK and REACHED the app's hook, which dropped it. One console spy spans
  // both runs: the SDK instruments console once per process, wrapping whatever console.log is at
  // that moment — restoring the spy between runs would silently unhook it and make run 2 vacuous.
  it('with the real client and Console integration, a logged line never reaches an event', async () => {
    const appHook = require('../app/config/sentry').dropConsoleBreadcrumb;
    expect(typeof appHook).toBe('function');
    const run = async (beforeBreadcrumb) => {
      const sent = [];
      const client = new SentryNode.NodeClient({
        dsn: 'https://public@o0.ingest.sentry.io/0',
        integrations: [SentryNode.consoleIntegration()],
        transport: () => ({ send: async (envelope) => { sent.push(envelope); return {}; }, flush: async () => true }),
        stackParser: SentryNode.defaultStackParser,
        sendDefaultPii: false,
        beforeBreadcrumb,
      });
      try {
        SentryNode.getIsolationScope().clearBreadcrumbs();
        SentryNode.getCurrentScope().clearBreadcrumbs();
        SentryNode.getCurrentScope().setClient(client);
        client.init();
        console.log('[gen] CANARY-CONSOLE-LINE user=CANARY-USER taps=[{"x":0.4,"y":-0.2}]');
        SentryNode.captureException(new Error('boom'));
        await client.flush(2000);
      } finally {
        await client.close(100);
        SentryNode.getCurrentScope().setClient(undefined);
      }
      return JSON.stringify(sent);
    };

    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const control = await run(undefined);
      expect(control).toContain('"category":"console"');
      expect(control).toContain('CANARY-CONSOLE-LINE');

      const reachedHook = [];
      const withAppHook = await run((breadcrumb, hint) => { reachedHook.push(breadcrumb.category); return appHook(breadcrumb, hint); });
      expect(reachedHook).toContain('console');                 // the line really went through the SDK…
      expect(withAppHook).toContain('boom');                     // …the error event itself shipped…
      expect(withAppHook).not.toContain('"category":"console"');
      expect(withAppHook).not.toMatch(/CANARY/);                 // …with no console line on it
    } finally {
      log.mockRestore();
    }
  });
});
