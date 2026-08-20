'use strict';

/**
 * Seeded random-number source for the synthetic-human simulator (W4-002).
 *
 * Why a hand-rolled PRNG rather than Math.random: mission §0.4 S9 forbids any engine from
 * reaching for the global clock or the global RNG, because a replay that cannot be
 * reproduced cannot root-cause anything. Every stochastic decision in sim/ traces back to
 * one integer seed, so "persona=athlete seed=4242" is a complete, portable description of
 * a run — the same on Daniel's Windows box, in CI, and in a soak six weeks from now.
 *
 * Algorithm: sfc32 (Small Fast Counting, 32-bit), seeded through splitmix32. sfc32 passes
 * PractRand well past the sample counts a simulator needs, is branch-free, and — the
 * property that actually matters here — has a 128-bit state that we can re-derive from a
 * label, which is what makes `fork()` cheap and reproducible.
 *
 * `fork(label)` is the load-bearing design decision. The generator needs several
 * independent noise sources (circadian noise, episode placement, artifact injection,
 * stillness), and they must be independent in a specific sense: turning artifacts OFF must
 * not change a single clean heart-rate sample. If all of them drew from one stream, the
 * `artifacts: false` control run would silently be a DIFFERENT body, and every comparison
 * against it would be meaningless. Forking by label gives each concern its own stream,
 * derived deterministically from the parent seed WITHOUT consuming the parent.
 */

const TWO32 = 4294967296; // 2^32

// FNV-1a over UTF-16 code units — only used to turn a label/string seed into a 32-bit
// integer. Not a security hash; it just needs to be stable and well-spread.
function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// splitmix32 — a fast mixer used to expand one seed into sfc32's four state words.
// Seeding a counter-based generator with (seed, 0, 0, 0) leaves it correlated for the
// first outputs; expanding through splitmix removes that.
function splitmix32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    t ^= t >>> 15;
    return t >>> 0;
  };
}

function sfc32(a, b, c, d) {
  return function next() {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  };
}

function normalizeSeed(seed) {
  if (typeof seed === 'string') return hashString(seed);
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  throw new TypeError(`sim/rng: seed must be a finite number or a string (got ${typeof seed})`);
}

/**
 * @param {number|string} seed
 * @returns {{
 *   seed: number,
 *   uint32(): number,
 *   next(): number,
 *   unit(): number,
 *   range(lo: number, hi: number): number,
 *   int(nExclusive: number): number,
 *   pick(items: Array): any,
 *   gaussian(): number,
 *   studentT(df: number): number,
 *   bernoulli(p: number): boolean,
 *   fork(label: string): object,
 * }}
 */
function createRng(seed) {
  const s = normalizeSeed(seed);
  const mix = splitmix32(s);
  const raw = sfc32(mix(), mix(), mix(), mix());

  const rng = {
    seed: s,

    uint32() { return raw(); },

    /** Uniform on [0, 1). */
    next() { return raw() / TWO32; },

    /**
     * Uniform on (0, 1] — never zero, so `Math.log(unit())` is always finite.
     * S8 wants every log domain-guarded; guarding it at the SOURCE means Box–Muller and
     * every future exponential draw are safe by construction rather than by remembering.
     */
    unit() { return (raw() + 1) / TWO32; },

    range(lo, hi) { return lo + (hi - lo) * (raw() / TWO32); },

    int(nExclusive) {
      if (!(nExclusive > 0)) return 0;
      return Math.floor((raw() / TWO32) * nExclusive);
    },

    pick(items) { return items[rng.int(items.length)]; },

    bernoulli(p) { return raw() / TWO32 < p; },

    /**
     * Standard normal via Box–Muller. Both uniforms are drawn per call (the second
     * variate is discarded rather than cached): caching would couple the stream's
     * position to how many gaussians a caller happened to request earlier, which is
     * exactly the kind of hidden state that makes a "deterministic" replay drift.
     */
    gaussian() {
      const u1 = rng.unit();
      const u2 = rng.next();
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    },

    /**
     * Student-t with `df` degrees of freedom, STANDARDISED to unit variance.
     *
     * Standardisation matters: a persona declares `sigmaBpm`, and that number has to mean
     * the same spread whether the persona's noise family is OU-Gaussian or heavy-tailed.
     * Raw t has variance df/(df−2), so a raw-t holdout at sigmaBpm=4 would actually be
     * ~29% wider at df=5 than its Gaussian counterpart, and every "holdout is harder"
     * conclusion would be confounded with "holdout is just noisier".
     *
     * t = Z / sqrt(V/df) with V ~ chi-square(df), built as a sum of df squared normals
     * (df is small and integral here, so this is exact and needs no gamma sampler).
     */
    studentT(df) {
      const k = Math.trunc(df);
      if (!(k > 2)) {
        throw new RangeError(`sim/rng: studentT needs df > 2 for a finite variance (got ${df})`);
      }
      let v = 0;
      for (let i = 0; i < k; i++) {
        const z = rng.gaussian();
        v += z * z;
      }
      // v is a sum of k squared normals and is positive with probability 1; the floor is
      // the S8 belt-and-braces so a pathological draw can never produce Infinity.
      const denom = Math.sqrt(Math.max(v, 1e-12) / k);
      return (rng.gaussian() / denom) * Math.sqrt((k - 2) / k);
    },

    /**
     * A named, independent substream. Deterministic in (parent seed, label) and — the
     * point — it does NOT advance the parent, so adding a fork to the generator never
     * shifts the streams that already existed.
     */
    fork(label) {
      const m = splitmix32(s ^ hashString(String(label)));
      // Two mixing rounds before use: with a single round, seeds that differ in one bit
      // (which sibling labels routinely do after the XOR) start out visibly correlated.
      m(); m();
      return createRng(m());
    },
  };

  return rng;
}

module.exports = { createRng, hashString };
