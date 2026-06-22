'use strict';

process.env.FRONTEND_URL = 'https://app.kokonada.com';

const csrfOriginGuard = require('../app/middleware/csrf');

function run(method, headers = {}) {
  const req = { method, headers };
  const res = {
    statusCode: null,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  const next = jest.fn();
  csrfOriginGuard(req, res, next);
  return { res, next };
}

describe('csrfOriginGuard (audit F6)', () => {
  it('allows safe methods regardless of Origin', () => {
    const { next } = run('GET', { origin: 'https://evil.example' });
    expect(next).toHaveBeenCalled();
  });

  it('allows unsafe methods from the trusted frontend Origin', () => {
    const { next } = run('POST', { origin: 'https://app.kokonada.com' });
    expect(next).toHaveBeenCalled();
  });

  it('tolerates a trailing slash on the Origin', () => {
    const { next } = run('DELETE', { origin: 'https://app.kokonada.com/' });
    expect(next).toHaveBeenCalled();
  });

  it('blocks unsafe methods from a foreign Origin', () => {
    const { res, next } = run('POST', { origin: 'https://evil.example' });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('allows requests with no Origin (native mobile Bearer / webhook HMAC)', () => {
    const { next } = run('POST', {});
    expect(next).toHaveBeenCalled();
  });
});
