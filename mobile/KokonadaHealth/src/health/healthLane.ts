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
}

export interface HealthLane {
  /** Re-check the gate. `allowStart` lets an open gate start the feed (boot, sign-in, a new
   *  wearable link); without it a re-check can only close a running feed (foreground).
   *  Resolves whether the gate is open. */
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

  async function closeFeed(forgetToken: boolean): Promise<void> {
    feedGen += 1;
    const running = session;
    session = null;
    if (running) await quietly(() => running.stop());
    await quietly(() => deps.clearFeed());
    if (forgetToken) await quietly(() => deps.clearWatchToken());
  }

  async function gateOpen(): Promise<boolean> {
    try {
      if ((await deps.hasWearableOptIn()) !== true) return false;
      const res = await deps.fetchConsentStatus();
      return res.ok && isCurrentGrant(res.data);
    } catch {
      return false;
    }
  }

  async function run(requestedIn: number, allowStart: boolean): Promise<boolean> {
    const voided = () => requestedIn !== stopEra;
    if (voided()) return false; // stopped before the work began: not even a consent read
    const open = await gateOpen();
    if (voided()) return false;

    if (!open) {
      if (session) await closeFeed(true);
      return false;
    }
    if (session || !allowStart) return true;

    const gen = feedGen;
    const current = () => gen === feedGen;
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
