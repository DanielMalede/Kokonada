'use strict';

// RA-2 (the resilience audit of #274 at d8428ec, S2). The client checked whether the lane was stopped
// (a 403, or a 401 that outlived its one re-exchange) or paused (three 429s in a row) when a request
// was QUEUED, not when the rate policy RELEASED it. With one request in flight and five seconds or
// more between requests, a call can wait behind another for seconds, or for hours behind a backoff,
// so a request already waiting when the lane stopped was still sent: after a 403, Garmin's suspension
// of the key, with the token that key bought. Garmin's Supplemental Terms §2 let it suspend a key
// without notice, and a lane that keeps calling after it was told to stop is how a key gets revoked.
//
// Each case runs two concurrent calls through the production client against the stateful fake
// Garmin on a fake clock, and counts what the fake actually received. The client's daily count must
// equal that number: a request refused at its turn was never sent, so it is never counted.

const { createGarminPersonalClient } = require('../app/services/wearable/garminPersonal/client');
const { startFakeGarmin } = require('./fixtures/garminPersonal/fakeGarminServer');
const { fakeClock } = require('./fixtures/garminPersonal/clock');
const { SENTINEL_KEY } = require('./fixtures/garminPersonal/sentinels');
const { blockRealConnections } = require('./fixtures/garminPersonal/blockEgress');

blockRealConnections();

const hrvPath = (date) => `/hrv-service/hrv/${date}`;

const servers = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((garmin) => garmin.close()));
});

async function setup() {
  const clock = fakeClock('2026-10-26T06:00:00.000Z');
  const garmin = await startFakeGarmin({ apiKey: SENTINEL_KEY, now: clock.now });
  servers.push(garmin);
  const client = createGarminPersonalClient({
    getApiKey: () => SENTINEL_KEY, httpsAgent: garmin.agent, now: clock.now, sleep: clock.sleep, random: () => 0.5, timeoutMs: 5000,
  });
  return { client, garmin };
}

const settle = (promise) => promise.then((value) => ({ value }), (error) => ({ error }));

describe('a stop or a pause holds every request already waiting in the queue (RA-2)', () => {
  it('a 403 on the first of two concurrent calls: both are garmin_personal_forbidden, and only one data request reaches Garmin', async () => {
    const { client, garmin } = await setup();
    garmin.script(hrvPath('2026-10-25'), { status: 403 });

    const [first, second] = await Promise.all([
      settle(client.get('hrv', { date: '2026-10-25' })),
      settle(client.get('hrv', { date: '2026-10-24' })),
    ]);

    expect(first.error).toMatchObject({ code: 'garmin_personal_forbidden', status: 403 });
    expect(second.error).toMatchObject({ code: 'garmin_personal_forbidden', status: 403 });
    expect(garmin.dataRequests().map((r) => r.path)).toEqual([hrvPath('2026-10-25')]);
    expect(client.status()).toEqual({ requestsToday: garmin.state.requests.length, paused: false, stopped: 'garmin_personal_forbidden' });
  });

  it('the third 429 in a row with a retry queued behind it: both are garmin_personal_paused, and only three data requests reach Garmin', async () => {
    const { client, garmin } = await setup();
    // A: 429, then 429 on its retry. B: 429. In the queue: A, B, A's retry (the third 429), B's retry.
    garmin.script(hrvPath('2026-10-25'), { status: 429 }, { status: 429 });
    garmin.script(hrvPath('2026-10-24'), { status: 429 });

    const [first, second] = await Promise.all([
      settle(client.get('hrv', { date: '2026-10-25' })),
      settle(client.get('hrv', { date: '2026-10-24' })),
    ]);

    expect(first.error).toMatchObject({ code: 'garmin_personal_paused', status: 429 });
    expect(second.error).toMatchObject({ code: 'garmin_personal_paused', status: 429 });
    expect(garmin.dataRequests().map((r) => r.path)).toEqual([hrvPath('2026-10-25'), hrvPath('2026-10-24'), hrvPath('2026-10-25')]);
    expect(client.status()).toEqual({ requestsToday: garmin.state.requests.length, paused: true, stopped: null });
  });

  it('a 401 that outlives its re-exchange stops a call that was waiting behind it', async () => {
    const { client, garmin } = await setup();
    // A: 401, then 401 again on the new token. B: 401 once, then it shares A's re-exchange and waits.
    garmin.script(hrvPath('2026-10-25'), { status: 401 }, { status: 401 });
    garmin.script(hrvPath('2026-10-24'), { status: 401 });

    const [first, second] = await Promise.all([
      settle(client.get('hrv', { date: '2026-10-25' })),
      settle(client.get('hrv', { date: '2026-10-24' })),
    ]);

    expect(first.error).toMatchObject({ code: 'garmin_personal_unauthorized', status: 401 });
    expect(second.error).toMatchObject({ code: 'garmin_personal_unauthorized', status: 401 });
    expect(garmin.tokenRequests()).toHaveLength(2);
    expect(garmin.dataRequests().map((r) => r.path)).toEqual([hrvPath('2026-10-25'), hrvPath('2026-10-24'), hrvPath('2026-10-25')]);
    expect(client.status()).toEqual({ requestsToday: garmin.state.requests.length, paused: false, stopped: 'garmin_personal_unauthorized' });
  });
});
