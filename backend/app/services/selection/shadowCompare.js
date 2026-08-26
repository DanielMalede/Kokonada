'use strict';

// Scoring shadow-compare (Wave-4 W4-007, §0.4 S12). PURE — no I/O, no clock, no env read
// except through the explicitly-passed environment object.
//
// WHAT THIS IS FOR
// W4-007 replaced the candidate scorer. The argument for the new one is made in unit tests on
// constructed cases; what those cannot show is how far apart the two rankings land on a REAL
// pool, for a real user, with the feature coverage the corpus actually has. This module is the
// instrument that answers that: behind `SCORING_V2_SHADOW`, the pipeline scores every
// candidate BOTH ways and records the divergence. Telemetry only — the served playlist is the
// one the live scorer produced, untouched.
//
// WHY RANK CORRELATION *AND* TOP-K OVERLAP
// They fail in opposite directions and a cutover decision needs both. Spearman is a whole-pool
// statistic: it can stay high while the two scorings disagree completely about the handful of
// tracks that actually get served (reordering the tail is free). Top-k overlap is the opposite:
// it sees only the picks, so it reports total agreement the moment both scorings choose the
// same 20 tracks in any order, even if they rank the other 480 in reverse. Read together,
// "spearman 0.95 / overlap 0.4" is the interesting case — broad agreement, different playlist —
// and it is exactly the case a single number would hide.
//
// WHY THE MAGNITUDE TERMS
// Ranks discard scale. Two scorings can agree on every rank while one compresses the whole
// pool into a 0.02-wide band, which matters because MMR trades λ·total against similarity: a
// flattened total means diversity silently dominates relevance. `meanAbsDelta`/`maxAbsDelta`
// are the cheapest honest witnesses to that.
//
// ZERO-KNOWLEDGE (§0.2.2): everything here is a scoring statistic. No vitals, no track
// identity, no userId enters the emitted line — the key set is closed and pinned by test.

const { enabled: enableFlag } = require('../../utils/envFlag');

/**
 * S12's flag. Deliberately NOT `Boolean(env.X)` like the S11 kill-switches: those are DISABLE
 * flags, where any spelling erring toward "old behaviour" is safe. This is an ENABLE flag, and
 * `SCORING_V2_SHADOW=0` turning the diagnostic ON would be the W4-D05 failure in reverse.
 *
 * The spelling table moved to `utils/envFlag` in W4-014 so this flag and the two embedding-v2
 * flags cannot disagree about what "off" means; the behaviour here is unchanged.
 */
function shadowEnabled(env = process.env) {
  return enableFlag(env?.SCORING_V2_SHADOW);
}

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/**
 * Average ranks (ascending), ties sharing the mean of the ranks they span.
 *
 * Tie handling is the whole reason this is not three lines: scores tie constantly in this
 * pipeline (every featureless track carries the same prior, every unexposed track the same
 * zero penalty), and breaking those ties by input order would make the correlation depend on
 * the pool's arrival order rather than on the scoring.
 */
function averageRanks(values) {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => (a.v - b.v) || (a.i - b.i));
  const ranks = new Array(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].v === order[i].v) j++;
    const avg = (i + j) / 2 + 1; // 1-based, averaged over the tied span
    for (let t = i; t <= j; t++) ranks[order[t].i] = avg;
    i = j + 1;
  }
  return ranks;
}

/** Pearson correlation; null (never NaN) when it is undefined — n < 2 or a flat side. */
function pearson(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n; my /= n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    cov += dx * dy; vx += dx * dx; vy += dy * dy;
  }
  // A side with zero variance has no ranking to correlate. Reporting 0 would read as
  // "uncorrelated" — a claim about disagreement we cannot make from constant input.
  if (!(vx > 0) || !(vy > 0)) return null;
  const r = cov / Math.sqrt(vx * vy);
  return Number.isFinite(r) ? Math.min(1, Math.max(-1, r)) : null;
}

/** Keys of the top `k` by score, descending; ties broken by key so the set is deterministic. */
function topKeys(entries, scoreOf, k) {
  return [...entries]
    .sort((a, b) => (scoreOf(b) - scoreOf(a)) || String(a.key).localeCompare(String(b.key)))
    .slice(0, k)
    .map(e => String(e.key));
}

/**
 * Compare two scorings of the same candidate set.
 *
 * @param {Array<{key: string|number, served: number, shadow: number}>} entries
 *        `served` is the score that actually shipped; `shadow` is the counterfactual.
 * @param {{k?: number}} [opts] k = the playlist size the overlap is measured over.
 * @returns {{n, k, dropped, spearman, topKOverlap, topOneSame, meanAbsDelta, maxAbsDelta}}
 *          `spearman` is null when undefined. Every other field is always a finite number.
 */
function compare(entries = [], { k = 20 } = {}) {
  const rows = [];
  let dropped = 0;
  for (const e of Array.isArray(entries) ? entries : []) {
    // A non-finite score is a bug upstream, not a datum. Dropping the PAIR (rather than one
    // side) keeps the two rank vectors aligned, and the count is reported so a silently
    // shrinking sample can never be mistaken for a clean one.
    if (!e || !isNum(e.served) || !isNum(e.shadow)) { dropped++; continue; }
    rows.push(e);
  }

  const n = rows.length;
  const kEff = Math.max(0, Math.min(Number.isFinite(k) ? Math.trunc(k) : 0, n));
  if (n === 0) {
    return { n: 0, k: 0, dropped, spearman: null, topKOverlap: 0, topOneSame: false, meanAbsDelta: 0, maxAbsDelta: 0 };
  }

  const spearman = pearson(averageRanks(rows.map(r => r.served)), averageRanks(rows.map(r => r.shadow)));

  const servedTop = topKeys(rows, r => r.served, kEff);
  const shadowTop = new Set(topKeys(rows, r => r.shadow, kEff));
  const shared = servedTop.reduce((acc, key) => acc + (shadowTop.has(key) ? 1 : 0), 0);

  let sum = 0;
  let max = 0;
  for (const r of rows) {
    const d = Math.abs(r.served - r.shadow);
    sum += d;
    if (d > max) max = d;
  }

  return {
    n,
    k: kEff,
    dropped,
    spearman,
    topKOverlap: kEff > 0 ? shared / kEff : 0,
    topOneSame: kEff > 0 && servedTop[0] === topKeys(rows, r => r.shadow, 1)[0],
    meanAbsDelta: sum / n,
    maxAbsDelta: max,
  };
}

const r3 = (x) => Math.round(x * 1000) / 1000;
const r4 = (x) => Math.round(x * 10000) / 10000;

/**
 * The house single-line telemetry (§0.4 S15). `na` — not 0, not null — is how an undefined
 * correlation prints: a reader scanning a log for regressions must not read "we measured no
 * relationship" where the truth is "there was nothing to measure".
 */
function summarizeLine(stats, { served = 'v2', shadow = 'v1', ms = 0 } = {}) {
  const sp = stats.spearman == null ? 'na' : r3(stats.spearman);
  return `[selection.shadow] served=${served} shadow=${shadow} n=${stats.n} k=${stats.k} ` +
    `spearman=${sp} topK=${r3(stats.topKOverlap)} top1=${stats.topOneSame ? 1 : 0} ` +
    `meanAbsDelta=${r4(stats.meanAbsDelta)} maxAbsDelta=${r4(stats.maxAbsDelta)} ` +
    `dropped=${stats.dropped} ms=${ms}`;
}

module.exports = { compare, summarizeLine, shadowEnabled, averageRanks, pearson };
