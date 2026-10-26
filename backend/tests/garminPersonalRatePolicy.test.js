'use strict';

// The Garmin personal lane's cadence (compliance C12, Update 2026-10-26): one request in flight, at
// least five seconds between requests, at most 150 requests in a UTC day. Garmin's Supplemental
// Terms §2 let it throttle or suspend a key without notice, so the cadence is a hard rule in code,
// not a convention a caller has to remember.
//
// The clock is a stateful fake with real behaviour: `sleep(ms)` moves time forward by ms, so every
// wait the policy takes shows up in the clock, and nothing in this file sleeps for real except the
// one test that proves the default wiring uses real time.

const {
  createRatePolicy,
  MIN_INTERVAL_MS,
  DAILY_REQUEST_CAP,
  DAILY_CAP_CODE,
} = require('../app/services/wearable/garminPersonal/ratePolicy');

function fakeClock(startIso) {
  let t = Date.parse(startIso);
  const sleeps = [];
  return {
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += Math.max(0, ms);
    },
    advance: (ms) => {
      t += ms;
    },
    sleeps,
  };
}

// A task that takes `ms` of clock time and yields to the event loop, so a policy that let two
// tasks overlap would have started the second one before the first had finished.
function timedTask(clock, ms, log, label) {
  return async () => {
    log.push({ label, event: 'start', at: clock.now() });
    await clock.sleep(ms);
    await new Promise((resolve) => setImmediate(resolve));
    log.push({ label, event: 'end', at: clock.now() });
    return label;
  };
}

describe('Garmin personal rate policy: the numbers are the compliance numbers', () => {
  it('defaults to 5 s between requests and 150 requests a UTC day', () => {
    expect(MIN_INTERVAL_MS).toBe(5000);
    expect(DAILY_REQUEST_CAP).toBe(150);
    expect(DAILY_CAP_CODE).toBe('garmin_personal_daily_cap');
  });
});

describe('Garmin personal rate policy: one request in flight, five seconds apart', () => {
  it('never runs two requests at once and starts each one 5 s or more after the previous one settled', async () => {
    const clock = fakeClock('2026-10-26T06:00:00.000Z');
    const policy = createRatePolicy({ now: clock.now, sleep: clock.sleep });
    const log = [];

    const results = await Promise.all([
      policy.schedule(timedTask(clock, 2000, log, 'a')),
      policy.schedule(timedTask(clock, 1000, log, 'b')),
      policy.schedule(timedTask(clock, 3000, log, 'c')),
    ]);

    expect(results).toEqual(['a', 'b', 'c']);
    // Strictly alternating start/end, in submission order: never two in flight.
    expect(log.map((e) => `${e.label}:${e.event}`)).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
    const at = (label, event) => log.find((e) => e.label === label && e.event === event).at;
    expect(at('b', 'start') - at('a', 'end')).toBeGreaterThanOrEqual(5000);
    expect(at('c', 'start') - at('b', 'end')).toBeGreaterThanOrEqual(5000);
  });

  it('sends the first request at once, with no wait before it', async () => {
    const clock = fakeClock('2026-10-26T06:00:00.000Z');
    const policy = createRatePolicy({ now: clock.now, sleep: clock.sleep });
    const startedAt = [];

    await policy.schedule(async () => startedAt.push(clock.now()));

    expect(startedAt).toEqual([Date.parse('2026-10-26T06:00:00.000Z')]);
    expect(clock.sleeps).toEqual([]);
  });

  it('spaces the next request after a request that failed, and the failure reaches the caller', async () => {
    const clock = fakeClock('2026-10-26T06:00:00.000Z');
    const policy = createRatePolicy({ now: clock.now, sleep: clock.sleep });
    const startedAt = [];

    await expect(policy.schedule(async () => {
      startedAt.push(clock.now());
      throw Object.assign(new Error('upstream'), { code: 'boom' });
    })).rejects.toMatchObject({ code: 'boom' });
    await policy.schedule(async () => startedAt.push(clock.now()));

    expect(startedAt[1] - startedAt[0]).toBeGreaterThanOrEqual(5000);
    expect(policy.snapshot().requestsToday).toBe(2);
  });
});

describe('Garmin personal rate policy: at most 150 requests a UTC day', () => {
  it('refuses the 151st request of a UTC day with garmin_personal_daily_cap and never runs it', async () => {
    const clock = fakeClock('2026-10-26T00:00:00.000Z');
    const policy = createRatePolicy({ now: clock.now, sleep: clock.sleep });
    let ran = 0;

    for (let i = 0; i < 150; i += 1) await policy.schedule(async () => { ran += 1; });
    expect(ran).toBe(150);
    expect(policy.snapshot().requestsToday).toBe(150);

    const refused = policy.schedule(async () => { ran += 1; });
    await expect(refused).rejects.toMatchObject({ code: 'garmin_personal_daily_cap', message: 'garmin_personal_daily_cap' });
    expect(ran).toBe(150);
    expect(policy.snapshot().requestsToday).toBe(150);
  });

  it('counts a request that failed: a failure is a request Garmin received', async () => {
    const clock = fakeClock('2026-10-26T00:00:00.000Z');
    const policy = createRatePolicy({ now: clock.now, sleep: clock.sleep, dailyCap: 2 });

    await expect(policy.schedule(async () => { throw new Error('first'); })).rejects.toThrow('first');
    await policy.schedule(async () => 'second');
    await expect(policy.schedule(async () => 'third')).rejects.toMatchObject({ code: 'garmin_personal_daily_cap' });
  });

  it('starts the count again at UTC midnight', async () => {
    const clock = fakeClock('2026-10-26T23:59:00.000Z');
    const policy = createRatePolicy({ now: clock.now, sleep: clock.sleep, dailyCap: 1 });

    await policy.schedule(async () => 'last of the 26th');
    await expect(policy.schedule(async () => 'over the cap')).rejects.toMatchObject({ code: 'garmin_personal_daily_cap' });

    clock.advance(60 * 1000); // 2026-10-27T00:00:05Z once the 5 s spacing is added
    await expect(policy.schedule(async () => 'first of the 27th')).resolves.toBe('first of the 27th');
    expect(policy.snapshot().requestsToday).toBe(1);
  });
});

describe('Garmin personal rate policy: deferUntil holds every later request (a backoff is global)', () => {
  it('waits until the deferred moment before the next request, whoever sends it', async () => {
    const clock = fakeClock('2026-10-26T06:00:00.000Z');
    const policy = createRatePolicy({ now: clock.now, sleep: clock.sleep });
    const startedAt = [];

    await policy.schedule(async () => startedAt.push(clock.now()));
    policy.deferUntil(clock.now() + 120000);
    await policy.schedule(async () => startedAt.push(clock.now()));

    expect(startedAt[1] - startedAt[0]).toBe(120000);
  });

  it('never pulls a deferral earlier', async () => {
    const clock = fakeClock('2026-10-26T06:00:00.000Z');
    const policy = createRatePolicy({ now: clock.now, sleep: clock.sleep });
    const startedAt = [];

    await policy.schedule(async () => startedAt.push(clock.now()));
    policy.deferUntil(clock.now() + 600000);
    policy.deferUntil(clock.now() + 60000);
    await policy.schedule(async () => startedAt.push(clock.now()));

    expect(startedAt[1] - startedAt[0]).toBe(600000);
  });
});

describe('Garmin personal rate policy: real time by default', () => {
  it('with no clock injected it waits on real time between requests', async () => {
    const policy = createRatePolicy({ minIntervalMs: 40 });
    const startedAt = [];

    await policy.schedule(async () => startedAt.push(Date.now()));
    await policy.schedule(async () => startedAt.push(Date.now()));

    expect(startedAt[1] - startedAt[0]).toBeGreaterThanOrEqual(39);
  });
});
