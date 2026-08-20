'use strict';

/**
 * Replay harness (W4-002): pushes a generated persona through the REAL ingest code.
 *
 * The point of a simulator is not to have a simulator — it is to run production code paths
 * against a body whose answers are known. So this harness deliberately drives:
 *
 *   · the socket stream lane via `registerBiometricHandler`'s own `biometric_push` listener,
 *     which means the REAL Art.9 consent gate, the REAL `wearable/adapter.normalize`, the
 *     REAL `isValidReading`, the REAL EWMA/debounce/band-trigger machinery — no stubs;
 *   · the watch lane via `handleBiometricReading(..., { immediate: true })`, exactly as
 *     `integrationsController.watchHrIngest` calls it (its route-level consent gate sits
 *     upstream of this seam and is exercised by that controller's own tests);
 *   · the batch lane via the REAL `healthStore.ingestBatch` → `metricStore.persistMetrics`
 *     → BiometricLog / MedicalProfile, against a real Mongo.
 *
 * What is NOT driven is the outbound generation boundary (Groq/Spotify/YouTube). That is a
 * network the harness cannot reach, and §1's "never a green mock for an integration
 * boundary" is about the seams under test — the caller mocks that side and the harness
 * counts what came out of the socket. Everything between the sensor and the trigger
 * decision is real.
 *
 * The socket double is a stateful fake with real semantics (§1): it records emissions and
 * dispatches registered listeners the way socket.io does, and it is torn down through the
 * handler's OWN `disconnect` listener — which is the one code path that clears the 60 s
 * debounce timer before dropping the state (W4-D06: `.delete()` alone leaves the timer
 * armed on the shared event loop). A harness that skipped that would re-open the exact
 * leak the previous session closed.
 *
 * S9 applies here too: no clock, no global RNG. Socket ids come from a module counter, so
 * two replays in one process are distinguishable AND reproducible.
 */

const {
  registerBiometricHandler,
  handleBiometricReading,
  _debounceMap,
} = require('../app/sockets/biometricHandler');
const { ingestBatch: realIngestBatch } = require('../app/services/wearable/healthStore');
const { mergeRejected, NO_REJECTS } = require('../app/services/wearable/insertAccounted');

const REPLAY_VERSION = 1;

let socketCounter = 0;

/** Drain pending microtasks. The handler fires `recalibrateForBand` without awaiting it, so
 *  a replay that did not drain would measure the state BEFORE the trigger resolved. Kept to
 *  microtasks only (no setImmediate) so it works unchanged under jest fake timers. */
async function flush(turns = 8) {
  for (let i = 0; i < turns; i++) await Promise.resolve();
}

/**
 * A socket double with real semantics.
 * `emitted` is the observable contract: acks, connection_errors, recalibration_pending /
 * _cancelled, live_assembling, playlist_ready.
 */
function createReplaySocket({ userId, id } = {}) {
  if (!userId) throw new TypeError('sim/replay: createReplaySocket needs a userId');
  const listeners = new Map();
  socketCounter += 1;
  const socket = {
    id: id || `sim-socket-${socketCounter}`,
    data: { user: { _id: userId } },
    emitted: [],
    emit(event, payload) { socket.emitted.push({ event, payload }); return true; },
    on(event, fn) { listeners.set(event, fn); },
    /** Dispatch as socket.io would. Returns the listener's result so async ones can be awaited. */
    _trigger(event, payload) {
      const fn = listeners.get(event);
      return fn ? fn(payload) : undefined;
    },
    _has(event) { return listeners.has(event); },
    _events(name) { return socket.emitted.filter((e) => e.event === name); },
    _counts() {
      const out = {};
      for (const e of socket.emitted) out[e.event] = (out[e.event] || 0) + 1;
      return out;
    },
  };
  return socket;
}

/** The per-socket state the handler keeps. Read-only convenience for assertions. */
function peekState(socket) { return _debounceMap.get(socket.id) || null; }

/**
 * Tear down through the handler's own disconnect listener when one is registered, and fall
 * back to the exported one-step reset otherwise. Never `_debounceMap.delete()` directly:
 * that is the footgun W4-D06 pinned shut.
 */
function closeReplaySocket(socket) {
  if (socket._has('disconnect')) socket._trigger('disconnect');
  else if (_debounceMap.has(socket.id)) {
    const { _resetDebounceState } = require('../app/sockets/biometricHandler');
    _resetDebounceState();
  }
}

/**
 * Drive a generated run's socket events through the real handler.
 *
 * @param {object}   opts
 * @param {object}   opts.run            a `generate()` result
 * @param {object}   opts.socket         from createReplaySocket
 * @param {'stream'|'watch'|'direct'} [opts.lane='stream']
 *        'stream' goes through the registered `biometric_push` listener (consent gate + the
 *        60 s debounce); 'watch' is the immediate mode the 5-minute watch route uses;
 *        'direct' is the same streaming machinery entered the way server-side pollers enter
 *        it — no consent listener, and therefore no database round-trip per reading, which
 *        is what makes it safe to drive under fake timers.
 * @param {boolean}  [opts.liveMode=false]  product default is Manual — Live is opt-in
 * @param {function} [opts.onAdvance]    async (ms) => void; supply jest's timer advance to
 *        make the debounce fire. Omitted = no virtual time passes and the streaming lane's
 *        pending recalibrations never mature (which the report states rather than hides).
 * @param {number}   [opts.maxEvents]    cap for smoke runs
 */
async function replaySocketLane(opts) {
  const { run, socket, lane = 'stream', liveMode = false, onAdvance = null, maxEvents = Infinity } = opts;
  if (!run || !socket) throw new TypeError('sim/replay: replaySocketLane needs { run, socket }');
  if (!['stream', 'watch', 'direct'].includes(lane)) {
    throw new RangeError(`sim/replay: lane must be 'stream', 'watch' or 'direct' (got ${lane})`);
  }

  registerBiometricHandler(socket);
  socket._trigger('live_mode', { enabled: liveMode });

  const events = run.socket.events.slice(0, Number.isFinite(maxEvents) ? maxEvents : undefined);
  let prevAtMs = events.length ? events[0].atMs : 0;
  let delivered = 0;

  for (const ev of events) {
    if (onAdvance && ev.atMs > prevAtMs) {
      await onAdvance(ev.atMs - prevAtMs);
      await flush();
    }
    prevAtMs = Math.max(prevAtMs, ev.atMs);

    if (lane === 'stream') {
      await socket._trigger('biometric_push', ev.payload);
    } else if (lane === 'direct') {
      handleBiometricReading(socket, ev.payload.source, ev.payload.raw);
    } else {
      handleBiometricReading(socket, ev.payload.source, ev.payload.raw, { immediate: true });
    }
    await flush();
    delivered += 1;
  }

  const counts = socket._counts();
  return {
    lane,
    liveMode,
    virtualTimeAdvanced: Boolean(onAdvance),
    delivered,
    acks: counts.biometric_ack || 0,
    rejected: counts.connection_error || 0,
    pendings: counts.recalibration_pending || 0,
    cancellations: counts.recalibration_cancelled || 0,
    coldServes: counts.live_assembling || 0,
    playlists: counts.playlist_ready || 0,
    state: peekState(socket),
  };
}

/**
 * Drive a generated run's health-store batches through the real ingest.
 *
 * Per-batch errors are CAUGHT and reported rather than thrown: a 2000-sample backfill chunk
 * that a single bad sample can abort is a real production question, and a harness that
 * exploded on it would hide the answer instead of measuring it.
 */
async function replayBatchLane(opts) {
  const { run, userId, ingestBatch = realIngestBatch } = opts || {};
  if (!run || !userId) throw new TypeError('sim/replay: replayBatchLane needs { run, userId }');

  const platform = run.healthStore.platform;
  let accepted = 0;
  let inserted = 0;
  let rejected = NO_REJECTS;
  const errors = [];

  for (let i = 0; i < run.healthStore.batches.length; i++) {
    const batch = run.healthStore.batches[i];
    try {
      const res = await ingestBatch(userId, platform, batch);
      accepted += res.accepted || 0;
      inserted += res.inserted || 0;
      // W4-D08: rows the DB refused. Aggregated, not dropped — a harness that reports only what
      // landed reproduces the exact defect it exists to measure.
      rejected = mergeRejected(rejected, res.rejected);
    } catch (e) {
      errors.push({ batchIndex: i, size: batch.length, message: e.message, name: e.name });
    }
  }

  return {
    platform,
    batches: run.healthStore.batches.length,
    submitted: run.healthStore.batches.reduce((a, b) => a + b.length, 0),
    accepted,
    inserted,
    rejected,
    errors,
  };
}

/** Both lanes for one persona run. */
async function replayRun(opts) {
  const { run, userId, socket, lane, liveMode, onAdvance, maxEvents, ingestBatch, skipSocket, skipBatch } = opts;
  const report = { v: REPLAY_VERSION, personaId: run.meta.personaId, seed: run.meta.seed };
  if (!skipSocket) {
    report.socket = await replaySocketLane({ run, socket, lane, liveMode, onAdvance, maxEvents });
  }
  if (!skipBatch) {
    report.batch = await replayBatchLane({ run, userId, ingestBatch });
  }
  return report;
}

module.exports = {
  REPLAY_VERSION,
  createReplaySocket,
  closeReplaySocket,
  peekState,
  replaySocketLane,
  replayBatchLane,
  replayRun,
  flush,
};
