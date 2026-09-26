import type { ApiResult } from '../net/apiClient';
import type { ConsentStatus } from './consentApi';
import type { LiveHrSession } from './liveHr';

// H2 (DT-6) — the health lane: the ONE gate in front of the live-HR feed. The feed covers the
// whr_ mint (getWatchToken), the BLE scan (BleManager), the Health Connect REST fallback
// (readRecords) and warmStore.liveHr. Before this, bootstrap and sign-in started that chain for
// every signed-in user with no consent and no wearable check, and threw the session handle away,
// so nothing could ever stop it (not logout, not a consent withdrawal).
//
// The gate opens only when BOTH hold, read in this order:
//   1. the account's wearable opt-in (no network — so a mood-only user makes ZERO requests);
//   2. a FRESH server read of the Art.9 grant: granted && !staleVersion — the lasting form of the
//      consent sheet's ready | granted_ack (the sheet's own state is per-sheet and transient).
// Anything unknown — a throw, a 401, offline, a malformed payload — keeps it CLOSED.
//
// Guarantees: one evaluation at a time (callers share it, but a start request is never swallowed
// by a no-start evaluation); at most one running session; stop() voids every evaluation requested
// before it — even one whose work has not begun yet — and a session that resolves late is stopped
// at once; a gate found closed while running stops the feed, wipes the reading, then forgets the
// token (in that order); neither evaluate() nor stop() ever throws.
//
// A withdrawal ends the wearable opt-in (compliance B5): the first answer that says no grant is on
// file — the withdrawal made here, or on another phone — tells the binding to forget it, so a
// re-consent given elsewhere later never silently reopens this phone. A stale grant is not a
// withdrawal and an unknown answer is not an answer; neither touches the opt-in.
//
// Two more rules, both about what is left behind while the lane is IDLE:
//   • a DEFINITIVE closed answer (no opt-in, or the server saying the grant is not current) forgets
//     a cached credential, once per process. An unknown answer (offline, 401, a throw) does not:
//     that credential may still be valid. Without this a withdrawal made on another phone left a
//     dead whr_ cached here, and the next re-consent started the feed on it — 401 on every push.
//   • the user's durable live-HR switch (Disconnect, compliance B5/C2) keeps the FEED off without
//     changing the answer: evaluate() still reports whether Art.9 processing is open, because the
//     boot Health Connect sync keys off that, not off the live-HR preference. A switch that cannot
//     be read counts as off.

export const isCurrentGrant = (s: ConsentStatus | null | undefined): boolean =>
  !!s && s.granted === true && s.staleVersion === false;

export interface HealthLaneDeps {
  /** Did THIS account opt into the wearable path? Must not touch the network. */
  hasWearableOptIn(): Promise<boolean>;
  fetchConsentStatus(): Promise<ApiResult<ConsentStatus>>;
  /** Start the live feed; `isActive` turns false the moment the lane is stopped. */
  startFeed(isActive: () => boolean): Promise<LiveHrSession | null>;
  /** Wipe the live reading (warmStore.liveHr + source). */
  clearFeed(): void;
  clearWatchToken(): Promise<void>;
  /** The user switched live heart rate off (Disconnect) and has not linked a wearable since. */
  feedSwitchedOff?(): boolean;
  /** The server says no Art.9 grant is on file (a withdrawal, made on this phone or another): the
   *  account's wearable opt-in on this phone ends with it (compliance B5). */
  forgetWearableOptIn?(): void;
}

export interface HealthLane {
  /** Re-check the gate. `allowStart` lets an open gate start the feed (boot, sign-in, a new
   *  wearable link); without it a re-check can only close a running feed (foreground).
   *  Resolves whether the Art.9 gate is open (opt-in + current grant), even while the user's
   *  live-HR switch keeps the feed itself off. */
  evaluate(o?: { allowStart?: boolean }): Promise<boolean>;
  /** Stop the feed and wipe the reading; `forgetToken` also clears the cached whr_ token. */
  stop(o?: { forgetToken?: boolean }): Promise<void>;
  status(): 'idle' | 'running';
}

async function quietly(fn: () => unknown): Promise<void> {
  try { await fn(); } catch { /* teardown is best-effort: one failed step never blocks the rest */ }
}

export function createHealthLane(deps: HealthLaneDeps): HealthLane {
  let session: LiveHrSession | null = null;
  // Bumped by every stop(). An evaluation remembers the era it was REQUESTED in (not the one its
  // deferred work starts in), so a stop() that lands in between still voids it.
  let stopEra = 0;
  // Bumped every time the feed is torn down (stop() or a gate found closed). A running or starting
  // feed from an older generation is dead: its late readings are dropped and a late start is stopped.
  let feedGen = 0;
  let inflight: { promise: Promise<boolean>; allowStart: boolean } | null = null;
  // Could a credential be cached right now that this lane has not already forgotten? True at
  // process start (an earlier process, or the pre-H2 boot, may have minted one) and whenever a
  // feed start may mint; false once it has been forgotten.
  let leftoverCredential = true;

  async function forgetCredential(): Promise<void> {
    leftoverCredential = false;
    await quietly(() => deps.clearWatchToken());
  }

  async function closeFeed(forgetToken: boolean): Promise<void> {
    feedGen += 1;
    const running = session;
    session = null;
    if (running) await quietly(() => running.stop());
    await quietly(() => deps.clearFeed());
    if (forgetToken) await forgetCredential();
  }

  // 'closed' is a definitive answer (no opt-in, or the server says the grant is not current), and
  // 'no-grant' the definitive answer that no grant is on file at all; 'unknown' is anything that
  // failed to answer (a throw, offline, 401, a refused read).
  async function gate(): Promise<'open' | 'closed' | 'no-grant' | 'unknown'> {
    try {
      if ((await deps.hasWearableOptIn()) !== true) return 'closed';
      const res = await deps.fetchConsentStatus();
      if (!res.ok) return 'unknown';
      if (isCurrentGrant(res.data)) return 'open';
      return res.data?.granted === false ? 'no-grant' : 'closed';
    } catch {
      return 'unknown';
    }
  }

  function switchedOff(): boolean {
    try {
      return deps.feedSwitchedOff?.() === true;
    } catch {
      return true; // unreadable: never silently undo a Disconnect
    }
  }

  async function run(requestedIn: number, allowStart: boolean): Promise<boolean> {
    const voided = () => requestedIn !== stopEra;
    if (voided()) return false; // stopped before the work began: not even a consent read
    const verdict = await gate();
    if (voided()) return false; // a voided answer may belong to the previous account: act on none of it

    if (verdict !== 'open') {
      if (verdict === 'no-grant') await quietly(() => deps.forgetWearableOptIn?.());
      if (session) await closeFeed(true);
      else if (verdict !== 'unknown' && leftoverCredential) await forgetCredential();
      return false;
    }
    if (switchedOff()) {
      if (session) await closeFeed(true);
      return true;
    }
    if (session || !allowStart) return true;

    const gen = feedGen;
    const current = () => gen === feedGen;
    leftoverCredential = true; // the start may mint one
    try {
      const started = await deps.startFeed(current);
      if (!current()) {
        if (started) await quietly(() => started.stop());
        return false;
      }
      session = started; // null when the feed could not start (e.g. the mint was refused)
    } catch {
      /* a failed start leaves the lane idle; the next trigger can retry */
    }
    return true;
  }

  function evaluate(o: { allowStart?: boolean } = {}): Promise<boolean> {
    const allowStart = o.allowStart === true;
    if (inflight && (inflight.allowStart || !allowStart)) return inflight.promise;

    const requestedIn = stopEra;
    // A start request arriving during a no-start evaluation runs right after it.
    const before = inflight ? inflight.promise : Promise.resolve(false);
    const entry = {
      allowStart,
      promise: before.then(() => run(requestedIn, allowStart)).catch(() => false),
    };
    inflight = entry;
    void entry.promise.then(() => { if (inflight === entry) inflight = null; });
    return entry.promise;
  }

  async function stop(o: { forgetToken?: boolean } = {}): Promise<void> {
    stopEra += 1;
    inflight = null; // the voided evaluation must not swallow the next one (e.g. the next sign-in)
    await closeFeed(o.forgetToken === true);
  }

  return { evaluate, stop, status: () => (session ? 'running' : 'idle') };
}
