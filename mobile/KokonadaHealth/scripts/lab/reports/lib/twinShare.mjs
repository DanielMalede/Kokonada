// One law twin per distinct input, shared across the rows that need it (UI-239).
//
// lawParity used to render a twin for every row, and a twin is nearly all of its time (about 44 s for a 1080 × 2400
// field twin at the full tier, CanvasKit's raster of the field shader). A twin is a pure function of its shot, so the
// rows of a run that would get the same twin (a shot's repeats, a scene captured twice) need only one render.
//
// The key is the shot itself, every field of it, less the capture's own identity: its row name, its PNG file and the
// PNG's sha256, none of which the twin is drawn from. It is built from the shot, never from a list of the twin's
// inputs, so a field a reader adds later is in the key without anyone remembering to add it: a key can only be too
// fine (a missed share), never too coarse (a row handed a twin that is not its own). The kind (field or fallback) is
// part of the key.
//
// A twin is held from its first use to its last and dropped then: a run holds only the twins still to be used.

/** The fields of a shot that name the capture, not its twin. */
const IDENTITY = new Set(['name', 'file', 'sha256']);

/**
 * A value with its object keys sorted (the order a reader wrote the fields in is not part of the key) and each
 * primitive tagged with its type, so no two values JSON would spell alike share a key: 1 and '1', -0 and 0, NaN and null.
 */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  }
  if (typeof value === 'number') return `number:${Object.is(value, -0) ? '-0' : String(value)}`;
  return `${value === null ? 'null' : typeof value}:${String(value)}`;
}

/**
 * The twin's identity: the kind and every field of the shot but its name, file and sha256.
 * @param {'field' | 'fallback'} kind
 * @param {Record<string, unknown>} shot
 * @returns {string}
 */
export function twinKey(kind, shot) {
  const inputs = Object.fromEntries(Object.entries(shot).filter(([k]) => !IDENTITY.has(k)));
  return JSON.stringify([kind, canonical(inputs)]);
}

/**
 * The twins of a run's rows, each rendered once and held until the last row that uses it. Rows are taken in order,
 * each once, as the report walks them. With `ahead` n, the next n distinct twins whose first row is not yet reached are
 * rendering already (a pool of workers draws them meanwhile); with none, a twin is rendered when its first row is asked
 * for. A twin rendered ahead that fails is no unhandled rejection: its row rejects, when it is reached.
 * @template J, T
 * @param {ReadonlyArray<J & { kind: 'field' | 'fallback'; shot: Record<string, unknown> }>} jobs
 * @param {(job: J) => Promise<T>} render
 * @param {{ ahead?: number }} [options]
 * @returns {{ twinAt(i: number): Promise<T>; held(): number }}
 */
export function shareTwins(jobs, render, { ahead = 0 } = {}) {
  const keys = jobs.map((j) => twinKey(j.kind, j.shot));
  const lastUse = new Map();
  keys.forEach((k, i) => lastUse.set(k, i));
  /** Each distinct twin's first row, in row order. */
  const firsts = [...new Map(keys.map((k, i) => [k, i]).reverse()).values()].sort((a, b) => a - b);
  const held = new Map();
  let started = 0;
  let next = 0;
  /** Starts every distinct twin up to `reached + ahead`, `reached` being how many first rows the walk has reached. */
  const startUpTo = (reached) => {
    for (; started < Math.min(firsts.length, reached + ahead); started++) {
      const i = firsts[started];
      const twin = render(jobs[i]);
      // Marked handled here; the row that needs it still sees the rejection.
      Promise.resolve(twin).catch(() => {});
      held.set(keys[i], twin);
    }
  };
  let reached = 0;
  startUpTo(0);
  return {
    twinAt: async (i) => {
      if (i !== next) throw new Error(`shareTwins: row ${i} asked for, but the rows are taken in order and row ${next} is next`);
      next += 1;
      if (firsts[reached] === i) reached += 1;
      startUpTo(reached);
      const key = keys[i];
      const twin = held.get(key);
      if (lastUse.get(key) === i) held.delete(key);
      return twin;
    },
    held: () => held.size,
  };
}
