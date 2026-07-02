'use strict';

const { selectPlaylist } = require('./pipeline');
const { translate } = require('../biosonic/translate');
const ledger = require('../ledger/serveLedger');
const { canonicalKey } = require('../identity/trackIdentity');

// Shadow-mode dual run: after the LEGACY pipeline has served (v1), run the new
// selector (v2) on the same context and log a comparison — overlap@20 plus the
// "prior-serve leak rate": how many v1-served tracks the durable ledger shows
// as already served before this generation (repeats v2 would have blocked).
//
// Strictly fire-and-forget: scheduled on setImmediate, every failure swallowed,
// the caller NEVER waits. Killswitch: SELECTION_SHADOW=false.

function run(ctx = {}) {
  if (process.env.SELECTION_SHADOW === 'false') return { scheduled: false };

  setImmediate(async () => {
    try {
      const servedKeys = (ctx.servedTracks || [])
        .map(t => t.canonicalKey ?? canonicalKey(t))
        .filter(Boolean);
      const now = ctx.now ?? Date.now();

      // v2 targets from the light biometric context (full profile inputs wire
      // into the serving path at the Phase-6 flip).
      const targets = translate({
        live: { heartRate: ctx.heartRate, activity: ctx.activity },
        hourOfDay: new Date(now).getHours(),
        moodKey: ctx.moodKey,
      });

      const t0 = Date.now();
      const { tracks, telemetry } = await selectPlaylist({
        userId: ctx.userId,
        musicProfile: ctx.musicProfile,
        moodKey: ctx.moodKey,
        provider: ctx.provider,
        aiParams: ctx.aiParams || {},
        targets,
        discoveryTracks: ctx.discoveryTracks || [],
        k: servedKeys.length || 50,
        now,
        // This generation's own serves must not count against v2 in the comparison.
        ignoreExclusions: new Set(servedKeys),
      });

      const top = (n, keys) => new Set(keys.slice(0, n));
      const v1Top20 = top(20, servedKeys);
      const v2Top20 = top(20, tracks.map(t => t.canonicalKey).filter(Boolean));
      let overlap = 0;
      for (const key of v2Top20) if (v1Top20.has(key)) overlap++;
      const overlapAt20 = v1Top20.size ? overlap / Math.min(20, v1Top20.size) : 0;

      // Exact leak metric from the durable ledger: a v1 track with any serve
      // strictly BEFORE this generation is a repeat the v2 windows would block.
      const exposure = await ledger.getExposure(ctx.userId, servedKeys, now);
      let leaked = 0;
      for (const key of servedKeys) {
        const serves = exposure.get(key) || [];
        if (serves.some(s => new Date(s.servedAt).getTime() < now - 5000)) leaked++;
      }
      const priorServeLeakRate = servedKeys.length ? leaked / servedKeys.length : 0;

      console.log('[selection.shadow]', JSON.stringify({
        userId: String(ctx.userId),
        moodKey: ctx.moodKey,
        overlapAt20: Math.round(overlapAt20 * 100) / 100,
        priorServeLeakRate: Math.round(priorServeLeakRate * 100) / 100,
        v2Count: tracks.length,
        relaxLevel: telemetry.relaxLevel,
        degraded: telemetry.degraded,
        shadowMs: Date.now() - t0,
        stageMs: telemetry.stageMs,
      }));
    } catch (e) {
      console.error('[selection.shadow] failed:', e.message);
    }
  });

  return { scheduled: true };
}

module.exports = { run };
