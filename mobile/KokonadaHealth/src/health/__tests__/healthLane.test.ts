// H2 — the health lane: the ONE gate in front of the live-HR feed (whr_ mint, BLE scan, the
// Health Connect REST fallback, warmStore.liveHr). It opens only when the account's wearable
// opt-in holds AND a FRESH server read says the Art.9 grant is current (granted && !staleVersion,
// the lasting form of the consent sheet's ready | granted_ack). Anything unknown fails closed.
//
// Real semantics under test: the lane drives the REAL startBiometrics + clearBiometricFeed over a
// REAL warm store, so "a late reading never lands" is asserted on the store Pulse reads. The
// outside world is stateful fakes: a consent server whose answer (and latency) a test controls, a
// live-HR "device" whose sessions record stop() and can emit readings after it, a token slot, and
// an ordered event log for teardown ordering.

import { createHealthLane, isCurrentGrant, type HealthLane } from '../healthLane';
import { startBiometrics, clearBiometricFeed } from '../biometricsWiring';
import { createWarmStore, type WarmStore } from '../../state/warm/warmStore';
import { createConsentFlow } from '../consentStore';
import type { ApiResult } from '../../net/apiClient';
import type { ConsentStatus } from '../consentApi';
import type { LiveHrSession } from '../liveHr';
import type { LiveHrCallbacks } from '../bleHeartRate';

const CURRENT: ConsentStatus = { granted: true, currentVersion: 1, staleVersion: false };

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

interface FakeSession extends LiveHrSession { emit(hr: number): void; stop: jest.Mock }

function makeWorld() {
  const log: string[] = [];
  const world = {
    optIn: true as boolean,
    optInThrows: false,
    consent: { ok: true, data: CURRENT } as ApiResult<ConsentStatus> | 'throw',
    consentHold: null as null | Promise<void>,
    startHold: null as null | Promise<void>,
    startFails: false,
    tokenSlot: 'whr_cached' as string | null,
    sessions: [] as FakeSession[],
    // The durable per-account live-HR switch (Disconnect). Off = the user switched live HR off.
    switchedOff: false,
    switchThrows: false,
  };

  const device = {
    start: jest.fn(async (cb: LiveHrCallbacks): Promise<LiveHrSession> => {
      log.push('device.start');
      if (world.startHold) await world.startHold;
      if (world.startFails) throw new Error('Watch token mint failed (403)');
      const s: FakeSession = {
        mode: 'ble',
        stop: jest.fn(() => { log.push('session.stop'); }),
        // Deliberately does NOT check its own stopped flag: a BLE monitor callback can already be
        // queued when stop() runs. Dropping it is the lane's isActive guard's job.
        emit: (hr: number) => cb.onHr?.(hr),
      };
      world.sessions.push(s);
      return s;
    }),
  };

  const warm: WarmStore = createWarmStore();
  const hasWearableOptIn = jest.fn(async () => {
    log.push('optIn');
    if (world.optInThrows) throw new Error('health connect binder died');
    return world.optIn;
  });
  const fetchConsentStatus = jest.fn(async (): Promise<ApiResult<ConsentStatus>> => {
    log.push('consent');
    if (world.consentHold) await world.consentHold;
    if (world.consent === 'throw') throw new Error('socket hang up');
    return world.consent;
  });
  const clearWatchToken = jest.fn(async () => { log.push('clearToken'); world.tokenSlot = null; });
  // The account's wearable link on this phone ends (compliance B5: a withdrawal clears the opt-in).
  const forgetWearableOptIn = jest.fn(() => { log.push('forgetOptIn'); world.optIn = false; });

  const lane: HealthLane = createHealthLane({
    hasWearableOptIn,
    fetchConsentStatus,
    startFeed: (isActive) => startBiometrics({ warm, isActive, start: device.start }),
    clearFeed: () => { log.push('clearFeed'); clearBiometricFeed(warm); },
    clearWatchToken,
    feedSwitchedOff: () => {
      if (world.switchThrows) throw new Error('keystore locked');
      return world.switchedOff;
    },
    forgetWearableOptIn,
  });

  return { world, lane, warm, log, device, hasWearableOptIn, fetchConsentStatus, clearWatchToken, forgetWearableOptIn };
}

describe('healthLane.evaluate — the gate stays CLOSED unless opt-in AND a current grant', () => {
  it('no wearable opt-in (mood-only): closed, with ZERO network — consent is never even read', async () => {
    const w = makeWorld();
    w.world.optIn = false;
    await expect(w.lane.evaluate({ allowStart: true })).resolves.toBe(false);
    expect(w.fetchConsentStatus).not.toHaveBeenCalled();
    expect(w.device.start).not.toHaveBeenCalled();
    expect(w.lane.status()).toBe('idle');
  });

  it.each([
    ['no grant on file', { ok: true, data: { granted: false, currentVersion: 1, staleVersion: false } }],
    ['a stale grant', { ok: true, data: { granted: true, currentVersion: 2, staleVersion: true } }],
    ['signed out / 401', { ok: false, status: 401, error: 'unauthorized' }],
    ['offline', { ok: false, error: 'network error' }],
    ['a malformed payload (no staleVersion)', { ok: true, data: { granted: true, currentVersion: 1 } }],
    ['the consent read throws', 'throw'],
  ])('opted in but %s: closed, nothing starts', async (_label, consent) => {
    const w = makeWorld();
    w.world.consent = consent as ApiResult<ConsentStatus> | 'throw';
    await expect(w.lane.evaluate({ allowStart: true })).resolves.toBe(false);
    expect(w.device.start).not.toHaveBeenCalled();
    expect(w.lane.status()).toBe('idle');
  });

  it('the opt-in check throws: closed, consent never read, never throws', async () => {
    const w = makeWorld();
    w.world.optInThrows = true;
    await expect(w.lane.evaluate({ allowStart: true })).resolves.toBe(false);
    expect(w.fetchConsentStatus).not.toHaveBeenCalled();
    expect(w.device.start).not.toHaveBeenCalled();
  });

  it('gate open + allowStart: starts ONE feed, and its readings reach the warm store', async () => {
    const w = makeWorld();
    await expect(w.lane.evaluate({ allowStart: true })).resolves.toBe(true);
    expect(w.device.start).toHaveBeenCalledTimes(1);
    expect(w.lane.status()).toBe('running');
    w.world.sessions[0].emit(74);
    expect(w.warm.getState().liveHr).toBe(74);
    expect(w.warm.getState().biometricSource).toBe('ble');
  });

  it('gate open but allowStart:false (foreground): never starts a feed', async () => {
    const w = makeWorld();
    await expect(w.lane.evaluate({ allowStart: false })).resolves.toBe(true);
    await expect(w.lane.evaluate()).resolves.toBe(true);
    expect(w.device.start).not.toHaveBeenCalled();
    expect(w.lane.status()).toBe('idle');
  });

  it('evaluating while running never starts a second feed', async () => {
    const w = makeWorld();
    await w.lane.evaluate({ allowStart: true });
    await w.lane.evaluate({ allowStart: true });
    await w.lane.evaluate({ allowStart: false });
    expect(w.device.start).toHaveBeenCalledTimes(1);
  });

  it('concurrent evaluations share ONE consent read and start ONE feed', async () => {
    const w = makeWorld();
    const hold = deferred<void>();
    w.world.consentHold = hold.promise;
    const a = w.lane.evaluate({ allowStart: true });
    const b = w.lane.evaluate({ allowStart: true });
    hold.resolve();
    await expect(Promise.all([a, b])).resolves.toEqual([true, true]);
    expect(w.fetchConsentStatus).toHaveBeenCalledTimes(1);
    expect(w.device.start).toHaveBeenCalledTimes(1);
  });

  it('an allowStart:true call arriving during an allowStart:false evaluation still starts the feed', async () => {
    // The Health Connect sheet returning to the app fires the foreground re-check (allowStart:
    // false) at the same moment the connect flow reports the new link (allowStart: true). Sharing
    // the foreground evaluation would swallow the start.
    const w = makeWorld();
    const hold = deferred<void>();
    w.world.consentHold = hold.promise;
    const fg = w.lane.evaluate({ allowStart: false });
    const linked = w.lane.evaluate({ allowStart: true });
    hold.resolve();
    w.world.consentHold = null;
    await Promise.all([fg, linked]);
    expect(w.device.start).toHaveBeenCalledTimes(1);
    expect(w.lane.status()).toBe('running');
  });

  it('a failed feed start (e.g. the mint is refused) leaves the lane idle and never throws', async () => {
    const w = makeWorld();
    w.world.startFails = true;
    await expect(w.lane.evaluate({ allowStart: true })).resolves.toBe(true); // the gate itself was open
    expect(w.lane.status()).toBe('idle');
    w.world.startFails = false;
    await w.lane.evaluate({ allowStart: true }); // a later trigger can retry
    expect(w.lane.status()).toBe('running');
  });
});

describe('healthLane — closing a running feed', () => {
  it('a re-check that finds the grant gone (foreground) stops the feed, clears the reading, then forgets the token', async () => {
    const w = makeWorld();
    await w.lane.evaluate({ allowStart: true });
    w.world.sessions[0].emit(80);
    w.world.consent = { ok: true, data: { granted: false, currentVersion: 1, staleVersion: false } };
    w.log.length = 0;

    await expect(w.lane.evaluate({ allowStart: false })).resolves.toBe(false);

    expect(w.world.sessions[0].stop).toHaveBeenCalledTimes(1);
    expect(w.warm.getState().liveHr).toBeNull();
    expect(w.warm.getState().biometricSource).toBe('none');
    expect(w.world.tokenSlot).toBeNull();
    expect(w.log.filter((e) => ['session.stop', 'clearFeed', 'clearToken'].includes(e)))
      .toEqual(['session.stop', 'clearFeed', 'clearToken']);
    expect(w.lane.status()).toBe('idle');
  });

  // Revised from 'a closed re-check while IDLE touches nothing': a credential can be cached while
  // the lane is idle — minted by a previous process, or by the pre-H2 boot that minted one for EVERY
  // signed-in user (compliance C5). Left there, a withdrawal made on ANOTHER phone kills it
  // server-side (the erasure nulls the hash) while this phone keeps it, and the next re-consent here
  // starts the feed on the dead credential: every push 401s, forever (getWatchToken never re-mints
  // over a cached token). So a DEFINITIVE closed answer forgets it — once per process, not on every
  // foreground — and still never touches the feed, which is not running.
  it('a DEFINITIVE closed answer while idle forgets a leftover credential once, and never wipes the feed', async () => {
    const w = makeWorld();
    w.world.optIn = false;
    await w.lane.evaluate({ allowStart: false });
    await w.lane.evaluate({ allowStart: false });
    await w.lane.evaluate({ allowStart: true });
    expect(w.clearWatchToken).toHaveBeenCalledTimes(1);
    expect(w.world.tokenSlot).toBeNull();
    expect(w.log).not.toContain('clearFeed');
  });

  it('withdrawn on another phone while this one was idle: the dead credential is gone before the re-consent start', async () => {
    const w = makeWorld();
    w.world.consent = { ok: true, data: { granted: false, currentVersion: 1, staleVersion: false } };
    await expect(w.lane.evaluate({ allowStart: true })).resolves.toBe(false);
    expect(w.world.tokenSlot).toBeNull(); // the real getWatchToken now mints a fresh one on the next start
    expect(w.device.start).not.toHaveBeenCalled();

    // The user re-consents here. Re-consenting runs through the consent wall and the Health Connect
    // sheet, whose grant is the explicit wearable link that re-establishes the opt-in (the no-grant
    // answer above ended it — compliance B5).
    w.world.consent = { ok: true, data: CURRENT };
    w.world.optIn = true;
    await expect(w.lane.evaluate({ allowStart: true })).resolves.toBe(true);
    expect(w.device.start).toHaveBeenCalledTimes(1);
  });

  it('an UNKNOWN answer while idle (offline) keeps the credential — it may still be valid', async () => {
    const w = makeWorld();
    w.world.consent = { ok: false, error: 'network error' };
    await w.lane.evaluate({ allowStart: true });
    expect(w.clearWatchToken).not.toHaveBeenCalled();
    expect(w.world.tokenSlot).toBe('whr_cached');
  });

  it('stop({ forgetToken }) stops the session BEFORE the token is cleared, and wipes the reading', async () => {
    const w = makeWorld();
    await w.lane.evaluate({ allowStart: true });
    w.world.sessions[0].emit(90);
    w.log.length = 0;
    await w.lane.stop({ forgetToken: true });
    expect(w.log).toEqual(['session.stop', 'clearFeed', 'clearToken']);
    expect(w.warm.getState().liveHr).toBeNull();
    expect(w.world.tokenSlot).toBeNull();
    expect(w.lane.status()).toBe('idle');
  });

  it('stop() without forgetToken keeps the token (logout clears it in its own teardown slot)', async () => {
    const w = makeWorld();
    await w.lane.evaluate({ allowStart: true });
    await w.lane.stop();
    expect(w.world.sessions[0].stop).toHaveBeenCalledTimes(1);
    expect(w.clearWatchToken).not.toHaveBeenCalled();
    expect(w.world.tokenSlot).toBe('whr_cached');
  });

  it('a reading that arrives AFTER stop() never lands in the warm store', async () => {
    const w = makeWorld();
    await w.lane.evaluate({ allowStart: true });
    await w.lane.stop();
    w.world.sessions[0].emit(111); // a BLE callback that was already queued
    expect(w.warm.getState().liveHr).toBeNull();
  });

  it('stop() while the feed is STARTING: the session is stopped the moment it resolves and never feeds', async () => {
    const w = makeWorld();
    const hold = deferred<void>();
    w.world.startHold = hold.promise;
    const booting = w.lane.evaluate({ allowStart: true });
    await new Promise((r) => setImmediate(r));
    expect(w.device.start).toHaveBeenCalledTimes(1);

    await w.lane.stop({ forgetToken: true });
    hold.resolve();
    await expect(booting).resolves.toBe(false);

    expect(w.world.sessions[0].stop).toHaveBeenCalledTimes(1);
    w.world.sessions[0].emit(99);
    expect(w.warm.getState().liveHr).toBeNull();
    expect(w.warm.getState().biometricSource).toBe('none');
    expect(w.lane.status()).toBe('idle');
  });

  it('the lane itself stops a late session, even from a feed that ignores isActive', async () => {
    // startBiometrics honours isActive, but the lane's guarantee must not lean on that: any
    // startFeed that hands back a session after a teardown gets that session stopped.
    const hold = deferred<void>();
    const late = { mode: 'rest-fallback' as const, stop: jest.fn() };
    const lane = createHealthLane({
      hasWearableOptIn: async () => true,
      fetchConsentStatus: async () => ({ ok: true, data: CURRENT }),
      startFeed: async () => { await hold.promise; return late; }, // deaf to isActive
      clearFeed: () => {},
      clearWatchToken: async () => {},
    });
    const booting = lane.evaluate({ allowStart: true });
    await new Promise((r) => setImmediate(r));
    await lane.stop();
    hold.resolve();
    await expect(booting).resolves.toBe(false);
    expect(late.stop).toHaveBeenCalledTimes(1);
    expect(lane.status()).toBe('idle');
  });

  it('stop() in the same tick as evaluate() (logout racing the boot check): discarded, no consent read, nothing starts', async () => {
    // The evaluation's work is deferred a microtask; a stop() landing before it runs must still
    // void it. Snapshotting "which stop era am I in" late (when the work starts) misses this stop.
    const w = makeWorld();
    const hold = deferred<void>();
    w.world.consentHold = hold.promise;
    const booting = w.lane.evaluate({ allowStart: true });
    await w.lane.stop();
    hold.resolve();
    await expect(booting).resolves.toBe(false);
    expect(w.fetchConsentStatus).not.toHaveBeenCalled();
    expect(w.device.start).not.toHaveBeenCalled();
  });

  it('stop() while the consent read is already in flight: its answer is ignored and nothing starts', async () => {
    const w = makeWorld();
    const hold = deferred<void>();
    w.world.consentHold = hold.promise;
    const booting = w.lane.evaluate({ allowStart: true });
    await new Promise((r) => setImmediate(r));
    expect(w.fetchConsentStatus).toHaveBeenCalledTimes(1); // the read really went out
    await w.lane.stop();
    hold.resolve();
    await expect(booting).resolves.toBe(false);
    expect(w.device.start).not.toHaveBeenCalled();
    expect(w.lane.status()).toBe('idle');
  });

  it('after stop(), a fresh evaluation (next sign-in) is NOT swallowed by the discarded one', async () => {
    const w = makeWorld();
    const hold = deferred<void>();
    w.world.consentHold = hold.promise;
    const stale = w.lane.evaluate({ allowStart: true });
    await w.lane.stop(); // logout while the boot evaluation hangs
    w.world.consentHold = null;
    await expect(w.lane.evaluate({ allowStart: true })).resolves.toBe(true); // account B signs in
    hold.resolve();
    await stale;
    expect(w.device.start).toHaveBeenCalledTimes(1);
    expect(w.lane.status()).toBe('running');
  });

  it('stop() is idempotent and never throws — even when the session, the wipe or the token step throws', async () => {
    const w = makeWorld();
    await w.lane.evaluate({ allowStart: true });
    w.world.sessions[0].stop.mockImplementation(() => { throw new Error('ble already gone'); });
    w.clearWatchToken.mockImplementationOnce(async () => { throw new Error('keystore busy'); });
    await expect(w.lane.stop({ forgetToken: true })).resolves.toBeUndefined();
    await expect(w.lane.stop({ forgetToken: true })).resolves.toBeUndefined();
    expect(w.world.sessions[0].stop).toHaveBeenCalledTimes(1);
    expect(w.warm.getState().biometricSource).toBe('none');
  });

  it('the lane is reusable: after a withdrawal stop, a re-consent re-opens it', async () => {
    const w = makeWorld();
    await w.lane.evaluate({ allowStart: true });
    await w.lane.stop({ forgetToken: true });
    await w.lane.evaluate({ allowStart: true });
    expect(w.device.start).toHaveBeenCalledTimes(2);
    expect(w.lane.status()).toBe('running');
  });
});

// Compliance B5 / C2: Disconnect must be DURABLE. The switch is the user's choice about the LIVE
// feed only — it does not change whether Art.9 processing is lawful, so evaluate() still reports the
// consent gate truthfully (the boot Health Connect sync keys off that answer, not off the switch).
describe('healthLane — the durable live-HR switch (Disconnect)', () => {
  it('switched off: the gate still reports open, but nothing starts — no feed, no mint', async () => {
    const w = makeWorld();
    w.world.switchedOff = true;
    await expect(w.lane.evaluate({ allowStart: true })).resolves.toBe(true);
    expect(w.device.start).not.toHaveBeenCalled();
    expect(w.lane.status()).toBe('idle');
  });

  it('switched off while a feed runs: the next re-check stops it, wipes the reading and forgets the credential', async () => {
    const w = makeWorld();
    await w.lane.evaluate({ allowStart: true });
    w.world.sessions[0].emit(82);
    w.world.switchedOff = true;
    w.log.length = 0;
    await w.lane.evaluate({ allowStart: false });
    expect(w.log.filter((e) => ['session.stop', 'clearFeed', 'clearToken'].includes(e)))
      .toEqual(['session.stop', 'clearFeed', 'clearToken']);
    expect(w.warm.getState().liveHr).toBeNull();
    expect(w.lane.status()).toBe('idle');
  });

  it('switched back on (an explicit wearable link): the next start-allowed evaluation starts the feed', async () => {
    const w = makeWorld();
    w.world.switchedOff = true;
    await w.lane.evaluate({ allowStart: true });
    w.world.switchedOff = false;
    await w.lane.evaluate({ allowStart: true });
    expect(w.device.start).toHaveBeenCalledTimes(1);
    expect(w.lane.status()).toBe('running');
  });

  it('a switch that cannot be read counts as OFF — a Disconnect is never silently undone', async () => {
    const w = makeWorld();
    w.world.switchThrows = true;
    await expect(w.lane.evaluate({ allowStart: true })).resolves.toBe(true);
    expect(w.device.start).not.toHaveBeenCalled();
  });

  it('a lane built without a switch behaves as switched ON (the dependency is optional)', async () => {
    const lane = createHealthLane({
      hasWearableOptIn: async () => true,
      fetchConsentStatus: async () => ({ ok: true, data: CURRENT }),
      startFeed: async () => ({ mode: 'rest-fallback' as const, stop: jest.fn() }),
      clearFeed: () => {},
      clearWatchToken: async () => {},
    });
    await lane.evaluate({ allowStart: true });
    expect(lane.status()).toBe('running');
  });
});

// Compliance B5 (review H2-C1): a withdrawal ends the account's wearable opt-in on this phone —
// wherever it was made. The phone that withdraws clears it itself; every other phone of the account
// learns it from the first consent answer that says "no grant on file", and ends its opt-in then,
// so a re-consent given elsewhere later never silently reopens it. Only that DEFINITIVE answer
// counts: a stale grant (a new consent version) is not a withdrawal, and an unknown answer is not
// an answer at all.
describe('healthLane — a no-grant answer ends the opt-in (compliance B5)', () => {
  it('the server says no grant is on file: the opt-in ends, and a later current grant finds the gate shut', async () => {
    const w = makeWorld();
    w.world.consent = { ok: true, data: { granted: false, currentVersion: 1, staleVersion: false } };
    await expect(w.lane.evaluate({ allowStart: true })).resolves.toBe(false);
    expect(w.forgetWearableOptIn).toHaveBeenCalledTimes(1);

    w.world.consent = { ok: true, data: CURRENT };
    await expect(w.lane.evaluate({ allowStart: true })).resolves.toBe(false);
    expect(w.fetchConsentStatus).toHaveBeenCalledTimes(1); // shut before any consent read
    expect(w.device.start).not.toHaveBeenCalled();
  });

  it('while running: the feed stops and the opt-in ends', async () => {
    const w = makeWorld();
    await w.lane.evaluate({ allowStart: true });
    w.world.consent = { ok: true, data: { granted: false, currentVersion: 1, staleVersion: false } };
    await expect(w.lane.evaluate({ allowStart: false })).resolves.toBe(false);
    expect(w.world.sessions[0].stop).toHaveBeenCalledTimes(1);
    expect(w.forgetWearableOptIn).toHaveBeenCalledTimes(1);
    expect(w.lane.status()).toBe('idle');
  });

  it.each([
    ['a stale grant (a new consent version, not a withdrawal)', { ok: true, data: { granted: true, currentVersion: 2, staleVersion: true } }],
    ['a malformed payload', { ok: true, data: { granted: true, currentVersion: 1 } }],
    ['a malformed payload with no granted field', { ok: true, data: { currentVersion: 1, staleVersion: false } }],
    ['signed out / 401', { ok: false, status: 401, error: 'unauthorized' }],
    ['offline', { ok: false, error: 'network error' }],
    ['the consent read throws', 'throw'],
  ])('%s: the gate stays shut, the opt-in stands', async (_label, consent) => {
    const w = makeWorld();
    w.world.consent = consent as ApiResult<ConsentStatus> | 'throw';
    await expect(w.lane.evaluate({ allowStart: true })).resolves.toBe(false);
    expect(w.forgetWearableOptIn).not.toHaveBeenCalled();
  });

  it('no opt-in: nothing to end, and consent is never read', async () => {
    const w = makeWorld();
    w.world.optIn = false;
    await w.lane.evaluate({ allowStart: true });
    expect(w.forgetWearableOptIn).not.toHaveBeenCalled();
  });

  it('a no-grant answer that lands AFTER a stop() (logout, the next account signing in) ends nobody\'s opt-in', async () => {
    // The answer belonged to the evaluation stop() voided; the switch reads whoever is signed in
    // NOW, so acting on it would end the NEXT account's opt-in with the previous account's answer.
    const w = makeWorld();
    const hold = deferred<void>();
    w.world.consentHold = hold.promise;
    w.world.consent = { ok: true, data: { granted: false, currentVersion: 1, staleVersion: false } };
    const stale = w.lane.evaluate({ allowStart: true });
    await new Promise((r) => setImmediate(r));
    expect(w.fetchConsentStatus).toHaveBeenCalledTimes(1);
    await w.lane.stop();
    hold.resolve();
    await expect(stale).resolves.toBe(false);
    expect(w.forgetWearableOptIn).not.toHaveBeenCalled();
  });

  it('a throwing opt-in wipe never breaks the evaluation', async () => {
    const w = makeWorld();
    w.forgetWearableOptIn.mockImplementation(() => { throw new Error('keystore busy'); });
    w.world.consent = { ok: true, data: { granted: false, currentVersion: 1, staleVersion: false } };
    await expect(w.lane.evaluate({ allowStart: true })).resolves.toBe(false);
  });
});

describe('isCurrentGrant — parity with the consent sheet', () => {
  it('is true exactly when the REAL consent flow would be `ready` for the same status', () => {
    for (const granted of [true, false]) {
      for (const staleVersion of [true, false]) {
        const s: ConsentStatus = { granted, currentVersion: 1, staleVersion };
        const flow = createConsentFlow({ fetchStatus: jest.fn(), grant: jest.fn() });
        flow.getState().hydrate(s);
        expect({ s, current: isCurrentGrant(s) }).toEqual({ s, current: flow.getState().flow === 'ready' });
      }
    }
  });
});
