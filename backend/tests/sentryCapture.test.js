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
      captureException: captured,
    }));
    process.env.SENTRY_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';

    const { initSentry, captureException } = require('../app/config/sentry');
    initSentry(null);

    const err = new Error('x');
    captureException(err);
    expect(captured).toHaveBeenCalledWith(err, undefined);
  });
});
