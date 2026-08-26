'use strict';

const MorningState = require('../models/MorningState');

/**
 * W4-D68 · THE ONE READER OF A LISTENER'S NIGHT HISTORY.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────────────────────
 *
 * §M.6's sleep-debt accumulator is the dominant evidence in `affectEngine.fatigueAxis`
 * (`FATIGUE_WEIGHTS.debt` = 0.6), and it is gated on a non-empty `sleep.history`. Until this
 * commit exactly ONE place in the tree could build one — `dailyAnalysis.worker._priorNights`,
 * privately, for its own nightly consolidation. The two lanes that actually decide what a
 * listener HEARS (`targetsBuilder.buildTargets`) and what their stored state says
 * (`stateVector.worker`) each passed `{ lastNight }` and nothing else, so in production the
 * accumulator never ran and `fatigue` was a single HRV trend carrying 40% of its designed mass.
 *
 * The fix is a read, not a collection: W4-012 already persists one `MorningState` per user per
 * local day with that day's `night` on it, expressly so "the sleep-debt accumulator has real
 * multi-night history to consume" (that model's own header). What was missing was anyone
 * consuming it outside the worker that wrote it.
 *
 * ── WHY A REPOSITORY AND NOT A SECOND COPY OF THE QUERY ─────────────────────────────────────
 *
 * Three call sites now need the same nights, and the query has two properties that are easy to
 * get subtly wrong and impossible to notice afterwards: the rows come back NEWEST-first from
 * Mongo but §M.6 consumes them OLDEST-first (a reversed history is a plausible wrong number, not
 * an exception), and `before` must be STRICT so the nightly lane can append today's night itself
 * without double-counting it. This wave has already paid twice for the same shape of mistake —
 * W4-010's dual-algorithm drift and W4-D42's third ranking algorithm — so the read lives once.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────────────────────────────
 *
 * It does not fold in `MedicalProfile.lastNightSleep`. That field is a single overwritten scalar
 * set, and deciding whether it is a night the nightly job has ALREADY consolidated is a dated
 * bucket comparison that `dailyAnalysis.worker` already owns and gets right. Duplicating that
 * judgement on the serving lane would be a second answer to "which nights count", which is the
 * exact failure mode above. Consequence, stated plainly: a listener whose nights have never been
 * consolidated has no history here, `sleepDebtFrom` returns `nights: 0`, the debt part abstains,
 * and the axis behaves precisely as it did before this commit. Absent evidence, not zero debt.
 *
 * It also does not decrypt anything by hand. `night.{deep,light,rem}` are `encryptedNumber`
 * paths, so the model's getters return plaintext minutes to a caller in scope and the values are
 * ciphertext at rest — asserted through the driver in the integration suite (R9), not assumed.
 *
 * ── THE PROJECTION MUST CARRY `userId`, AND THAT IS NOT COSMETIC (R9) ───────────────────────
 *
 * `encryptedField._ownerAad` derives the AAD from the OWNER DOCUMENT's `userId`. A projection of
 * `night` alone hands the getter a subdocument whose owner has no `userId`, so the AAD-bound
 * decrypt is skipped and only the unbound fallback is tried. For an AAD-BOUND row that fallback
 * fails authentication: every stage reads back `null`, after logging `[crypto-alarm] ...
 * owner=unknown` per field — a SECURITY alarm raised by an ordinary read.
 *
 * The code replaced here (`dailyAnalysis.worker._priorNights`) selected `'night'`. Measured on
 * mongodb-memory-server rather than reasoned about, and the measurement carries a caveat worth
 * writing down because it is the difference between a live bug and a latent one:
 *
 *   · a row written through a DOCUMENT (`.create()` / `.save()`) is encrypted AAD-BOUND, and
 *     `select('night')` then yields `{deep: null, light: null, rem: null}` + 3 crypto alarms;
 *   · a row written by `findOneAndUpdate($set)` — which is how `dailyAnalysis.worker` and every
 *     other production writer of this collection writes it — runs the setter with a QUERY as
 *     `this`, so `_ownerAad` is null and the value is encrypted UNBOUND. The unbound fallback
 *     then succeeds, which is why `select('night')` has worked in production and why
 *     `dailyAnalysis.worker.test.js`'s two-night continuity case has always been green.
 *
 * So this is a LATENT defect, not a live one: it detonates the first time any night is written
 * through a document — a backfill, a migration, a repair script, or a future `.save()`. Narrowing
 * the projection is not worth that, and `select('userId night')` costs one ObjectId per row. The
 * integration suite pins both halves (the values AND the absence of an alarm) against real Mongo
 * with `.create()`, i.e. against the bound case, so it cannot silently narrow again.
 */

/** Prior nights read back for sleep-debt continuity. §M.6's decay makes older nights immaterial. */
const HISTORY_NIGHTS = 14;

/** A caller asking for more than a fortnight is a bug, not an instruction. */
const MAX_HISTORY_NIGHTS = 60;

/**
 * This listener's consolidated nights, OLDEST-FIRST, in the `{deep, light, rem}` shape
 * `chronobiology.sleepDebt` weighs. Rows with no night are dropped rather than passed through as
 * nulls — the accumulator's own `weightedNight` would ignore them, but a null in the array
 * inflates nothing while looking like it should.
 *
 * @param {*} userId
 * @param {{before?: Date, limit?: number}} [opts] `before` is EXCLUSIVE.
 */
async function readNightHistory(userId, { before = null, limit = HISTORY_NIGHTS } = {}) {
  if (userId == null) return [];

  const n = Number.isFinite(limit) && limit > 0
    ? Math.min(Math.floor(limit), MAX_HISTORY_NIGHTS)
    : HISTORY_NIGHTS;

  const query = { userId };
  if (before instanceof Date && !Number.isNaN(before.getTime())) query.date = { $lt: before };

  // `userId` is in the projection because the AAD needs it, not because the caller does.
  const rows = await MorningState.find(query).sort({ date: -1 }).limit(n).select('userId night');

  return rows
    .reverse()
    .map((r) => r.night)
    .filter(Boolean)
    .map((night) => ({ deep: night.deep, light: night.light, rem: night.rem }));
}

module.exports = { readNightHistory, HISTORY_NIGHTS, MAX_HISTORY_NIGHTS };
