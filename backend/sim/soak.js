'use strict';

/**
 * Long-run soak harness (W4-002).
 *
 * Generates a 24h-equivalent day (or several) for every persona, summarises what the body
 * actually did, and — when a `replay` is injected — folds the result of pushing that body
 * through the real ingest stack into the same report.
 *
 * Two design decisions worth stating, because both are load-bearing for W4-015, which
 * extends this into the full-stack soak:
 *
 * 1. **The report summarises; it never accumulates.** A four-day soak across seven personas
 *    is ~4 million samples. If the report held them, the soak's own memory profile would
 *    swamp the memory question it exists to answer, and "no unbounded growth" would be
 *    untestable by construction. So `runSoak` returns histograms and counts only — the
 *    report is O(personas), which is pinned, not merely intended.
 *
 * 2. **The `RUN_SOAK` gate is on the CLI, not on the engine.** The mission keeps the soak
 *    out of the default CI budget, and what is expensive is the full-stack run: a real
 *    Mongo, real workers, hours of virtual time. A one-day DRY soak is cheap and is worth
 *    having in CI, so `runSoak()` is callable and `main()` is gated. Gating the engine
 *    would have meant either no soak coverage in CI at all, or a second near-duplicate
 *    code path — and a soak harness that CI never executes is one that quietly rots.
 *
 * The band histogram is keyed by the REAL `bandFromHeartRate`, not a local copy of the
 * 90/120 cuts. That is the same one-definition rule D11 and W4-D05 were about: a soak that
 * reported bands the serving path disagreed with would be worse than no soak.
 */

const { generate } = require('./generator');
const { getPersona, listPersonaIds, listHoldoutIds } = require('./personas');
const { bandFromHeartRate } = require('../app/services/moodDescriptors');

const SOAK_VERSION = 1;

const SOAK_DEFAULTS = Object.freeze({
  days: 1,                    // "24h-equivalent"
  sampleIntervalSec: 60,
  batchSampleIntervalSec: 300,
  artifacts: true,
});

function isSoakEnabled() { return process.env.RUN_SOAK === '1'; }

/** Read at CALL time, never captured at import: a module-level constant would freeze the
 *  answer at require() and make the gate untestable (and unsettable by a wrapper script). */
function requireSoakEnabled() {
  if (!isSoakEnabled()) {
    throw new Error('sim/soak: refusing to run — set RUN_SOAK=1 (the full soak is deliberately outside the default CI budget)');
  }
}

function tally(map, key) { map[key] = (map[key] || 0) + 1; }

function summarise(run) {
  const activityDwell = {};
  const bandDwell = {};
  let labelFlips = 0;
  let prevActivity = null;

  for (const s of run.truth.samples) {
    tally(activityDwell, s.activity);
    tally(bandDwell, bandFromHeartRate(s.hr) || 'invalid');
    if (prevActivity !== null && s.activity !== prevActivity) labelFlips += 1;
    prevActivity = s.activity;
  }

  const artifactCounts = {};
  for (const a of run.artifacts) tally(artifactCounts, a.kind);

  const episodeCounts = {};
  for (const e of run.truth.episodes) tally(episodeCounts, e.kind);

  return {
    personaId: run.meta.personaId,
    holdout: run.meta.holdout,
    seed: run.meta.seed,
    days: run.meta.days,
    samples: run.meta.sampleCount,
    socketEvents: run.socket.events.length,
    batches: run.healthStore.batches.length,
    batchRows: run.healthStore.batches.reduce((a, b) => a + b.length, 0),
    artifacts: run.artifacts.length,
    artifactCounts,
    episodes: run.truth.episodes.length,
    episodeCounts,
    activityDwell,
    bandDwell,
    labelFlips,
    generateMs: run.timings.ms,
  };
}

/**
 * @param {object}   opts
 * @param {number|string} opts.seed        required
 * @param {number|Date}   opts.startAt     required (S9 — the soak has no clock either)
 * @param {number}   [opts.days=1]
 * @param {string[]} [opts.personas]       defaults to every persona INCLUDING the holdouts
 * @param {function} [opts.replay]         async (run, personaId) => any; folded in per persona
 * @param {function} [opts.logger]         receives each single-line telemetry record
 * @returns {object|Promise<object>} the report — a promise iff `replay` was supplied
 */
function runSoak(opts = {}) {
  const {
    seed, startAt, days = SOAK_DEFAULTS.days,
    sampleIntervalSec = SOAK_DEFAULTS.sampleIntervalSec,
    batchSampleIntervalSec = SOAK_DEFAULTS.batchSampleIntervalSec,
    artifacts = SOAK_DEFAULTS.artifacts,
    personas, replay, logger,
  } = opts;

  const ids = personas ?? [...listPersonaIds(), ...listHoldoutIds()];
  // Resolve every id BEFORE generating anything: a typo in a soak invocation that silently
  // dropped a persona would report a clean run over a smaller population than asked for.
  for (const id of ids) getPersona(id);

  const before = process.memoryUsage();
  const t0 = process.hrtime.bigint();

  const summaries = [];
  const pending = [];
  for (const id of ids) {
    const run = generate({
      persona: id, seed, startAt, days, sampleIntervalSec, batchSampleIntervalSec, artifacts, logger,
    });
    const summary = summarise(run);
    summaries.push(summary);
    if (typeof replay === 'function') {
      // The run is handed to the replay and then dropped on this tick — the summary is all
      // that survives into the report.
      pending.push(Promise.resolve(replay(run, id)).then((r) => { summary.replay = r; }));
    }
    if (logger) {
      logger(`[sim.soak] persona=${summary.personaId} holdout=${summary.holdout} days=${days} `
        + `samples=${summary.samples} episodes=${summary.episodes} artifacts=${summary.artifacts} `
        + `labelFlips=${summary.labelFlips} genMs=${summary.generateMs}`);
    }
  }

  const finish = () => {
    const after = process.memoryUsage();
    const report = {
      v: SOAK_VERSION,
      seed,
      days,
      sampleIntervalSec,
      personas: summaries,
      totals: {
        personas: summaries.length,
        samples: summaries.reduce((a, s) => a + s.samples, 0),
        socketEvents: summaries.reduce((a, s) => a + s.socketEvents, 0),
        batchRows: summaries.reduce((a, s) => a + s.batchRows, 0),
        artifacts: summaries.reduce((a, s) => a + s.artifacts, 0),
        episodes: summaries.reduce((a, s) => a + s.episodes, 0),
      },
      memory: {
        heapUsedBeforeBytes: before.heapUsed,
        heapUsedAfterBytes: after.heapUsed,
        heapUsedDeltaBytes: after.heapUsed - before.heapUsed,
        rssDeltaBytes: after.rss - before.rss,
      },
      timings: { ms: Math.round(Number(process.hrtime.bigint() - t0) / 1e4) / 100 },
    };
    if (logger) {
      logger(`[sim.soak] total personas=${report.totals.personas} samples=${report.totals.samples} `
        + `socketEvents=${report.totals.socketEvents} batchRows=${report.totals.batchRows} `
        + `artifacts=${report.totals.artifacts} heapDeltaKb=${Math.round(report.memory.heapUsedDeltaBytes / 1024)} `
        + `ms=${report.timings.ms}`);
    }
    return report;
  };

  return pending.length ? Promise.all(pending).then(finish) : finish();
}

// ── CLI ──────────────────────────────────────────────────────────────────────
// node sim/soak.js --days 1 --seed 4242   (requires RUN_SOAK=1)
/* istanbul ignore next */
function main(argv) {
  requireSoakEnabled();
  const arg = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
  };
  const startAtRaw = arg('startAt', null);
  if (!startAtRaw) {
    throw new Error('sim/soak: --startAt <epoch-ms|ISO> is required — the soak never reads the clock (S9)');
  }
  const startAt = /^\d+$/.test(startAtRaw) ? Number(startAtRaw) : new Date(startAtRaw).getTime();
  const report = runSoak({
    seed: arg('seed', 'soak'),
    startAt,
    days: Number(arg('days', SOAK_DEFAULTS.days)),
    sampleIntervalSec: Number(arg('interval', SOAK_DEFAULTS.sampleIntervalSec)),
    logger: (line) => console.log(line),
  });
  return report;
}

/* istanbul ignore next */
if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

module.exports = {
  SOAK_VERSION,
  SOAK_DEFAULTS,
  isSoakEnabled,
  requireSoakEnabled,
  summarise,
  runSoak,
  main,
};
