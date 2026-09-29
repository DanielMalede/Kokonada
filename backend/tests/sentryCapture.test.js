'use strict';

// The captureException wrapper is called from many previously-silent catch blocks, so
// its two guarantees matter: (1) a NO-OP that never throws when Sentry is unconfigured,
// and (2) forwarding the error + structured context when a DSN is set.

describe('captureException (Sentry wrapper)', () => {
  const ORIGINAL_DSN = process.env.SENTRY_DSN;

  afterEach(() => {
    if (ORIGINAL_DSN === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = ORIGINAL_DSN;
    jest.resetModules();
    jest.dontMock('@sentry/node');
  });

  it('is a no-op (never throws) when Sentry is not configured', () => {
    delete process.env.SENTRY_DSN;
    jest.resetModules();
    const { captureException } = require('../app/config/sentry');
    expect(() => captureException(new Error('boom'), { scope: 'test' })).not.toThrow();
  });

  it('forwards the error and extra context to Sentry once initialized', () => {
    jest.resetModules();
    const captured = jest.fn();
    jest.doMock('@sentry/node', () => ({
      init: jest.fn(),
      setupExpressErrorHandler: jest.fn(),
      httpIntegration: jest.fn(() => ({ name: 'Http' })),
      captureException: captured,
    }));
    process.env.SENTRY_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';

    const { initSentry, captureException } = require('../app/config/sentry');
    initSentry(null); // no Express app needed for this unit

    const err = new Error('provider down');
    captureException(err, { scope: 'llm', model: 'test-model' });

    expect(captured).toHaveBeenCalledWith(err, { extra: { scope: 'llm', model: 'test-model' } });
  });

  it('passes no options object when context is omitted', () => {
    jest.resetModules();
    const captured = jest.fn();
    jest.doMock('@sentry/node', () => ({
      init: jest.fn(),
      setupExpressErrorHandler: jest.fn(),
      httpIntegration: jest.fn(() => ({ name: 'Http' })),
      captureException: captured,
    }));
    process.env.SENTRY_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';

    const { initSentry, captureException } = require('../app/config/sentry');
    initSentry(null);

    const err = new Error('x');
    captureException(err);
    expect(captured).toHaveBeenCalledWith(err, undefined);
  });

  // Defence in depth. An AxiosError carries the outbound request: config.headers (a Spotify/YouTube
  // OAuth Bearer or the Groq key), config.data (the body) and the request/response objects. The SDK
  // does not serialize arbitrary error properties today, but extraErrorDataIntegration or a deeper
  // normalizeDepth would ship all of it. Sentry gets a copy without them; the caller's error is untouched.
  it('hands Sentry a copy of an AxiosError without config, request or response', () => {
    jest.resetModules();
    const captured = jest.fn();
    jest.doMock('@sentry/node', () => ({
      init: jest.fn(),
      setupExpressErrorHandler: jest.fn(),
      httpIntegration: jest.fn(() => ({ name: 'Http' })),
      captureException: captured,
    }));
    process.env.SENTRY_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';
    const { AxiosError } = require('axios');
    const util = require('util');

    const { initSentry, captureException } = require('../app/config/sentry');
    initSentry(null);

    const config = {
      url: 'https://api.spotify.com/v1/me/tracks',
      method: 'get',
      headers: { Authorization: 'Bearer CANARY-SPOTIFY-TOKEN' },
      data: '{"note":"CANARY-BODY"}',
    };
    const request = { _header: 'GET /v1/me/tracks HTTP/1.1\r\nAuthorization: Bearer CANARY-SPOTIFY-TOKEN\r\n\r\n' };
    const response = { status: 401, statusText: 'Unauthorized', headers: {}, config, data: { error: 'CANARY-RESPONSE' } };
    const err = new AxiosError('Request failed with status code 401', 'ERR_BAD_REQUEST', config, request, response);

    captureException(err, { scope: 'spotify' });

    const [sent, options] = captured.mock.calls[0];
    expect(sent).not.toBe(err);
    expect(sent).toBeInstanceOf(Error);
    expect(sent).not.toHaveProperty('config');
    expect(sent).not.toHaveProperty('request');
    expect(sent).not.toHaveProperty('response');
    expect(sent).toMatchObject({ name: 'AxiosError', message: 'Request failed with status code 401', code: 'ERR_BAD_REQUEST', status: 401 });
    expect(sent.stack).toBe(err.stack);
    expect(options).toEqual({ extra: { scope: 'spotify' } });
    expect(util.inspect(captured.mock.calls, { depth: 20, showHidden: true })).not.toMatch(/CANARY/);
    // The caller's error is not mutated — code after the capture may still read err.response.
    expect(err.response.status).toBe(401);
    expect(err.config.headers.Authorization).toBe('Bearer CANARY-SPOTIFY-TOKEN');
  });

  it('passes a non-axios error through unchanged (same object)', () => {
    jest.resetModules();
    const captured = jest.fn();
    jest.doMock('@sentry/node', () => ({
      init: jest.fn(),
      setupExpressErrorHandler: jest.fn(),
      httpIntegration: jest.fn(() => ({ name: 'Http' })),
      captureException: captured,
    }));
    process.env.SENTRY_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';

    const { initSentry, captureException } = require('../app/config/sentry');
    initSentry(null);

    const err = Object.assign(new Error('plain'), { config: { note: 'not axios' } });
    captureException(err);
    expect(captured.mock.calls[0][0]).toBe(err);
  });

  // M1 defence in depth. A non-Error value is serialized by the SDK into extra.__serialized__ to
  // depth 3 (@sentry/core eventbuilder) — for Engine.IO's {req, code, message, context} that is the
  // raw request: rawHeaders (cookies, Bearer), the URL with its sid. Sentry only ever gets an Error.
  it('wraps a non-Error value in an Error carrying only its message and code', () => {
    jest.resetModules();
    const captured = jest.fn();
    jest.doMock('@sentry/node', () => ({
      init: jest.fn(),
      setupExpressErrorHandler: jest.fn(),
      httpIntegration: jest.fn(() => ({ name: 'Http' })),
      captureException: captured,
    }));
    process.env.SENTRY_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';
    const util = require('util');

    const { initSentry, captureException } = require('../app/config/sentry');
    initSentry(null);

    const engineError = {
      req: {
        url: '/socket.io/?EIO=4&transport=polling&sid=CANARY-SID',
        rawHeaders: ['authorization', 'Bearer CANARY-JWT', 'cookie', 'io=CANARY-COOKIE'],
        headers: { authorization: 'Bearer CANARY-JWT' },
      },
      code: 1,
      message: 'Session ID unknown',
      context: { sid: 'CANARY-SID' },
    };
    captureException(engineError, { scope: 'socket.engine' });

    const [sent] = captured.mock.calls[0];
    expect(sent).toBeInstanceOf(Error);
    expect(sent).toMatchObject({ message: 'Session ID unknown', code: 1 });
    expect(sent).not.toHaveProperty('req');
    const all = util.inspect(captured.mock.calls, { depth: 20, showHidden: true });
    expect(all).not.toMatch(/CANARY|rawHeaders|sid=/);

    captureException('a plain string');
    expect(captured.mock.calls[1][0]).toBeInstanceOf(Error);
    expect(captured.mock.calls[1][0].message).toBe('a plain string');
  });
});
