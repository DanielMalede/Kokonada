'use strict';

// The Sentry SDK's express error handler auto-captures the request, which would
// otherwise ship the webhook's ?secret= (and any OAuth ?code=/?state=) to Sentry.
// scrubEvent is the beforeSend hook that strips query strings/URLs. (compliance C2)
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
