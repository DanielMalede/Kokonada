'use strict';

/**
 * W4-013 (B7) · the CLOSED loop, end to end through real Mongo.
 *
 * Every piece of the learning loop is pinned individually — the gradient derivation, the step, the
 * atomic decay-then-step write, the trust region, the overlay's exact dormancy. None of those pins
 * can see a WIRING error: a sign flipped between two stages, a step written under the wrong key, a
 * decay applied twice, an overlay read from a table the gradient was not centred on. Each stage
 * would still pass its own test and the listener would simply never learn — silently, because a
 * learner that does nothing looks exactly like a learner with nothing to learn.
 *
 * So this suite runs the whole chain the way production runs it —
 *
 *     resolveWeights → overlay → gradientOf → stepFrom → applyUpdate → readWeights →
 *     effectiveDeltas → overlay → …
 *
 * — against a SYNTHETIC LISTENER with a preference the system does not know: they finish tracks
 * that fit the biosonic target and skip tracks that do not, regardless of how well the track
 * matches their taste history. The question is whether the loop discovers that.
 *
 * It is deliberately not a mocked chain. `applyUpdate` is an aggregation-pipeline write whose
 * decay and clamp run INSIDE Mongo, and a fake would be a second implementation of exactly the
 * arithmetic under test (the R1.5 "green mock at an integration boundary" rule).
 */

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { PersonalWeights } = require('../app/models/PersonalWeights');
const repo = require('../app/repositories/personalWeightsRepo');
const P = require('../app/agents/runtime/learning/personalization');
const { resolveWeights } = require('../app/services/selection/score');

jest.setTimeout(120000);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_wave4_converge' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(async () => {
  await PersonalWeights.deleteMany({});
});

const T0 = new Date('2026-08-21T09:00:00Z').valueOf();
const MINUTE = 60 * 1000;

/**
 * One served track, as the scorer reports it. The two dimensions are deliberately ANTI-CORRELATED
 * so the loop has to choose between them: a track this listener's history loves is a poor fit for
 * the target band, and vice versa. A pure re-allocation (`Σ w·∂ = 0`) can only move by trading.
 */
const trackFitting = { tasteAffinity: 0.2, featureDistance: 0.9, moodGenreFit: 0.5, provenRotation: 0.1, discoveryBonus: 0 };
const trackFamiliar = { tasteAffinity: 0.9, featureDistance: 0.2, moodGenreFit: 0.5, provenRotation: 0.1, discoveryBonus: 0 };

/** The listener: finishes what fits the target (+1), skips what does not (−1). */
const verdictOf = (terms) => (terms.featureDistance >= 0.5 ? 1 : -1);

/**
 * One play, all the way round: read the row, decay it forward, overlay it, score the gradient
 * against THE WEIGHTS THAT WOULD HAVE SERVED, step, write. Exactly the call sequence the pipeline,
 * `rewardDispatch` and `rewardIngest.worker` make between them — assembled here rather than
 * imported so a failure names the stage, not a socket.
 */
async function playOnce(userId, terms, globalTable, atMs) {
  const row = await repo.readWeights({ userId });
  const deltas = P.effectiveDeltas(row, { now: atMs });
  const inForce = P.overlay(globalTable, deltas);

  const gradient = P.gradientOf({ terms, weights: inForce });
  const step = P.stepFrom({ gradient, reward: verdictOf(terms) });
  if (!step) return { wrote: false, inForce };

  const wrote = await repo.applyUpdate({ userId, step, at: new Date(atMs) });
  return { wrote, inForce };
}

/** What the ranking would use for this listener right now. */
async function weightsNow(userId, globalTable, atMs) {
  const row = await repo.readWeights({ userId });
  return P.overlay(globalTable, P.effectiveDeltas(row, { now: atMs }));
}

describe('W4-013 · the loop actually learns what the listener is telling it', () => {
  const globalTable = () => resolveWeights({ targets: {} }).weights;

  test('a listener who rewards FIT and punishes FAMILIARITY ends with more weight on fit', async () => {
    const userId = new mongoose.Types.ObjectId();
    const table = globalTable();

    for (let i = 0; i < 40; i += 1) {
      // Alternating evidence, so the listener is not simply always rewarded: they finish the
      // well-fitting track and skip the merely familiar one. Both plays teach.
      await playOnce(userId, trackFitting, table, T0 + i * 2 * MINUTE);
      await playOnce(userId, trackFamiliar, table, T0 + (i * 2 + 1) * MINUTE);
    }

    const learned = await weightsNow(userId, table, T0 + 80 * MINUTE);
    expect(learned.feature / table.feature).toBeGreaterThan(1);
    expect(learned.taste / table.taste).toBeLessThan(1);
  });

  test('what it learned is a RE-ALLOCATION, not a louder scorer', async () => {
    // The invariant that makes the overlay safe: it can change what ranks first, it can never
    // change how much the scorer as a whole is allowed to say. If this drifts, the trust region
    // stops bounding anything a listener actually experiences.
    const userId = new mongoose.Types.ObjectId();
    const table = globalTable();
    for (let i = 0; i < 40; i += 1) {
      await playOnce(userId, trackFitting, table, T0 + i * 2 * MINUTE);
      await playOnce(userId, trackFamiliar, table, T0 + (i * 2 + 1) * MINUTE);
    }

    const learned = await weightsNow(userId, table, T0 + 80 * MINUTE);
    // The invariant is over the SCORING terms, not the personal four. `discovery` carries no δ of
    // its own but is deliberately part of the sum the centring is taken against — `overlay`'s
    // header calls it one of the terms the re-allocation is funded from — so the personal-four
    // subtotal is free to move and only the total is pinned. That total is §M.9's `Σ w_d = 1`,
    // which is what makes `total` comparable across tracks and the exposure penalty bite evenly.
    const sum = (w) => P.SCORING_TERMS.reduce((a, d) => a + w[d], 0);
    expect(sum(table)).toBeCloseTo(1, 9);
    expect(sum(learned)).toBeCloseTo(sum(table), 9);
    // …and the term the scorer never re-weights at all is untouched by the whole loop.
    expect(learned.exposure).toBe(table.exposure);
  });

  test('it never leaves the trust region, however long the listener keeps voting', async () => {
    // The windup pin, closed through the real write: the stored δ is clamped IN the pipeline, so
    // 300 consecutive agreements cannot walk the accumulator past the boundary and leave the
    // listener's first disagreement moving nothing.
    const userId = new mongoose.Types.ObjectId();
    const table = globalTable();
    for (let i = 0; i < 300; i += 1) {
      await playOnce(userId, trackFitting, table, T0 + i * MINUTE);
    }

    const learned = await weightsNow(userId, table, T0 + 300 * MINUTE);
    for (const d of P.SCORING_TERMS) {
      // A term switched OFF by configuration (mood mode gives `rotation` a weight of 0) has no
      // ratio to bound, and the meaningful pin is that learning cannot REVIVE it: the overlay is
      // a re-allocation of the weights the mode actually uses, not a way to re-enable one.
      if (table[d] === 0) { expect(learned[d]).toBe(0); continue; }
      const ratio = learned[d] / table[d];
      expect(ratio).toBeGreaterThanOrEqual(P.TRUST_REGION.lo - 1e-9);
      expect(ratio).toBeLessThanOrEqual(P.TRUST_REGION.hi + 1e-9);
    }
  });

  test('a listener who stops listening drifts back to the global table', async () => {
    // The shrink is a READ-TIME computation, so "no plays for a long time" and "a job that never
    // ran" are the same thing. Pinned end to end because the alternative — a stored value that
    // only a worker can decay — is exactly what W4-D44 caught starving users past the first 500.
    const userId = new mongoose.Types.ObjectId();
    const table = globalTable();
    for (let i = 0; i < 40; i += 1) {
      await playOnce(userId, trackFitting, table, T0 + i * MINUTE);
    }

    const fresh = await weightsNow(userId, table, T0 + 40 * MINUTE);
    const YEAR = 365 * 24 * 60 * MINUTE;
    const afterAYear = await weightsNow(userId, table, T0 + YEAR);

    expect(Math.abs(fresh.feature - table.feature)).toBeGreaterThan(1e-3);
    // The shrink is ASYMPTOTIC, and the honest pin says so rather than pretending it terminates.
    // A year is ~52 shrinks of 0.98 ≈ ×0.35: measurably weaker, still clearly personal. Anyone
    // reading `shrink-to-global` as "forgets within a season" is reading it wrong.
    expect(Math.abs(afterAYear.feature - table.feature)).toBeLessThan(Math.abs(fresh.feature - table.feature));
    expect(Math.abs(afterAYear.feature - table.feature)).toBeGreaterThan(1e-4);

    // Derived from the constants rather than hardcoded, so the pin follows the rate if it changes:
    // the time for the largest admissible δ to shrink under the negligible band. Past it, `overlay`
    // hands back the caller's OWN table by identity — not a near-copy that could flip two tied
    // tracks in the last few bits.
    const weeks = Math.log(P.NEGLIGIBLE_DELTA / P.DELTA_LIMIT) / Math.log(P.SHRINK_PER_WEEK);
    const forgotten = await weightsNow(userId, table, T0 + Math.ceil(weeks + 1) * P.SHRINK_WEEK_MS);
    expect(forgotten).toBe(table);
  });

  test('the loop is INERT for a listener the pipeline never captured a gradient for', async () => {
    // The dormancy invariant, closed: with the overlay flag off the pipeline emits no gradients,
    // every play reports `gradient: null`, `stepFrom` abstains, and no row is ever created. Not
    // "a row of zeros" — no row, so `readWeights` returns null and `overlay` is an identity.
    const userId = new mongoose.Types.ObjectId();
    const table = globalTable();

    for (let i = 0; i < 20; i += 1) {
      const step = P.stepFrom({ gradient: null, reward: verdictOf(trackFitting) });
      expect(step).toBeNull();
      expect(await repo.applyUpdate({ userId, step, at: new Date(T0 + i * MINUTE) })).toBe(false);
    }

    expect(await PersonalWeights.countDocuments({ userId })).toBe(0);
    expect(await weightsNow(userId, table, T0 + 20 * MINUTE)).toBe(table);
  });

  test('an indifferent listener teaches nothing, however many tracks they play', async () => {
    // The counter-case that makes the first test mean something: the same chain, driven by a
    // listener whose verdict carries no preference at all, must not manufacture one. Without this
    // a loop that drifted on its own arithmetic would still pass "the weights moved".
    const userId = new mongoose.Types.ObjectId();
    const table = globalTable();
    const flat = { tasteAffinity: 0.5, featureDistance: 0.5, moodGenreFit: 0.5, provenRotation: 0.5, discoveryBonus: 0 };

    for (let i = 0; i < 40; i += 1) {
      // +1 then −1 on identical evidence: the listener is inconsistent, which is what an
      // indifferent one looks like from here.
      await playOnce(userId, flat, table, T0 + i * 2 * MINUTE);
      const row = await repo.readWeights({ userId });
      const inForce = P.overlay(table, P.effectiveDeltas(row, { now: T0 + (i * 2 + 1) * MINUTE }));
      const step = P.stepFrom({ gradient: P.gradientOf({ terms: flat, weights: inForce }), reward: -1 });
      if (step) await repo.applyUpdate({ userId, step, at: new Date(T0 + (i * 2 + 1) * MINUTE) });
    }

    const learned = await weightsNow(userId, table, T0 + 80 * MINUTE);
    for (const d of P.PERSONAL_TERMS) expect(learned[d]).toBeCloseTo(table[d], 3);
  });
});
