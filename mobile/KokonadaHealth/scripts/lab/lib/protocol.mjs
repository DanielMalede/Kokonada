// The harness side of the Design Lab protocol (OPS-100). The lab side is
// src/design/lab/protocol.ts: lines `KOKONADA_LAB <READY|ERROR|IGNORED|RESULT> <json>` on logcat.
//
// The harness fails closed: it waits for THIS launch's READY (its run id and step), and anything
// else that concerns it (an ERROR, an IGNORED command, a lab line it cannot read, silence past the
// timeout) fails the run. A line from a previous launch carries another run id and is skipped.
// B8-5a: a RESULT line carries a bench's numbers (checkResult holds it to the plan's contract), and collectLab keeps a
// run's lab lines for the whole shot, so an ERROR the lab sends AFTER READY refuses the shot too (UI-225).

const LAB_LINE = /KOKONADA_LAB (READY|ERROR|IGNORED|RESULT) (.*)$/;

/** { kind, payload } for a lab line, { kind: 'MALFORMED', payload: null, text } for an unreadable one, else null. */
export function parseLabLine(text) {
  const m = LAB_LINE.exec(text);
  if (!m) return null;
  try {
    return { kind: m[1], payload: JSON.parse(m[2]) };
  } catch {
    const at = text.indexOf('KOKONADA_LAB');
    return { kind: 'MALFORMED', payload: null, text: text.slice(at) };
  }
}

/**
 * Resolves with the READY payload for `run` at step `seq`; rejects on anything that means it will
 * not come. `source.on(listener)` delivers logcat lines and returns an unsubscribe. An aborted
 * `signal` (Ctrl-C) rejects at once, so the caller's restore runs.
 * @param {{ source: { on(listener: (line: string) => void): () => unknown }, run: string, seq: number,
 *           timeoutMs: number, signal?: AbortSignal }} options
 * @returns {Promise<any>}
 */
export function waitForLab({ source, run, seq, timeoutMs, signal = undefined }) {
  return new Promise((resolve, reject) => {
    let done = false;
    let timer = null;
    let off = null;
    const interrupted = () => finish(reject, new Error(`interrupted while waiting for READY (run ${run}, step ${seq})`));
    const finish = (settle, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (off) off();
      if (signal) signal.removeEventListener('abort', interrupted);
      settle(value);
    };
    if (signal?.aborted) { interrupted(); return; }
    signal?.addEventListener('abort', interrupted);
    off = source.on((text) => {
      const line = parseLabLine(text);
      if (!line) return;
      if (line.kind === 'MALFORMED') {
        finish(reject, new Error(`cannot read a lab line (logcat truncates long lines): ${line.text.slice(0, 200)}`));
        return;
      }
      const p = line.payload ?? {};
      if (line.kind === 'ERROR') {
        if (p.run === run || p.run === null) finish(reject, new Error(`the lab refused run ${run}: ${(p.errors ?? []).join('; ')}`));
        return;
      }
      if (p.run !== run) return;
      if (line.kind === 'IGNORED') {
        if (p.seq === seq) finish(reject, new Error(`the lab ignored command ${seq}: ${p.reason}${p.detail ? ` (${p.detail})` : ''}`));
        return;
      }
      if (line.kind !== 'READY') return; // a RESULT is never READY
      if (p.seq === seq) finish(resolve, p);
      else if (p.seq > seq) finish(reject, new Error(`READY for seq ${p.seq} while expected ${seq}`));
    });
    timer = setTimeout(() => finish(reject, new Error(`no READY for run ${run} step ${seq} within ${timeoutMs} ms`)), timeoutMs);
  });
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const finiteAtLeast = (v, min) => typeof v === 'number' && Number.isFinite(v) && v >= min;
const RESULT_KEYS = ['run', 'seq', 'kind', 'scene', 'frames', 'displayHz', 'stepUs', 'renderUs', 'gpuProxyUs', 'clock'];
const RESULT_STATS = ['stepUs', 'renderUs', 'gpuProxyUs'];
const QUANTILES = ['p50', 'p95', 'max'];

/**
 * Problems with a RESULT, by the plan's contract: exactly its keys (no tap coordinate or anything else can ride on it),
 * this run, step and scene, kind "cost", the UI runtime's performance.now clock (never a Date fallback), and each time
 * as { p50, p95, max } in microseconds, finite, non-negative and in order.
 * @param {any} result
 * @param {{ run: string, seq: number, scene: string }} expected
 */
export function checkResult(result, { run, seq, scene }) {
  if (!isObject(result)) return ['RESULT must be an object'];
  const problems = [];
  for (const key of RESULT_KEYS) if (result[key] === undefined) problems.push(`${key} is required`);
  for (const key of Object.keys(result)) if (!RESULT_KEYS.includes(key)) problems.push(`${key} is not a RESULT field`);
  if (result.run !== undefined && result.run !== run) problems.push(`RESULT is for run ${result.run}, not ${run}`);
  if (result.seq !== undefined && result.seq !== seq) problems.push(`RESULT is for seq ${result.seq}, not ${seq}`);
  if (result.scene !== undefined && result.scene !== scene) problems.push(`RESULT is for scene ${result.scene}, not ${scene}`);
  if (result.kind !== undefined && result.kind !== 'cost') problems.push('kind must be "cost"');
  if (result.clock !== undefined && result.clock !== 'performance.now') problems.push('clock must be "performance.now"');
  if (result.frames !== undefined && !(Number.isInteger(result.frames) && result.frames >= 1)) problems.push('frames must be an integer >= 1');
  if (result.displayHz !== undefined && !(finiteAtLeast(result.displayHz, 0) && result.displayHz > 0)) problems.push('displayHz must be a finite number > 0');
  for (const key of RESULT_STATS) {
    const stats = result[key];
    if (stats === undefined) continue;
    if (!isObject(stats)) { problems.push(`${key} must be an object`); continue; }
    let complete = true;
    for (const q of QUANTILES) {
      if (stats[q] === undefined) { problems.push(`${key}.${q} is required`); complete = false; }
      else if (!finiteAtLeast(stats[q], 0)) { problems.push(`${key}.${q} must be a finite number >= 0`); complete = false; }
    }
    for (const q of Object.keys(stats)) if (!QUANTILES.includes(q)) problems.push(`${key}.${q} is not a RESULT field`);
    if (complete && !(stats.p50 <= stats.p95 && stats.p95 <= stats.max)) problems.push(`${key} must hold p50 <= p95 <= max`);
  }
  return problems;
}

/**
 * Every lab line of `run`, from before its launch to the end of its shot (UI-225). problems(): an ERROR for the run (or
 * one that names no run: the arguments were refused before the run id was read) and a lab line that cannot be read
 * (it could have been an ERROR), each a sentence, at any time, before READY or after it. results(): the run's RESULT
 * payloads; nextResult() waits for the next one not yet taken, and fails on an ERROR, the timeout or an interruption.
 * @param {{ source: { on(listener: (line: string) => void): () => unknown }, run: string }} options
 */
export function collectLab({ source, run }) {
  const problems = [];
  const results = [];
  let taken = 0;
  const waiters = new Set();
  const wake = () => { for (const w of [...waiters]) w(); };
  const off = source.on((text) => {
    const line = parseLabLine(text);
    if (!line) return;
    if (line.kind === 'MALFORMED') problems.push(`cannot read a lab line (logcat truncates long lines): ${line.text.slice(0, 200)}`);
    else if (line.kind === 'ERROR' && isObject(line.payload) && (line.payload.run === run || line.payload.run === null)) {
      problems.push(`the lab sent an ERROR for run ${run}: ${(Array.isArray(line.payload.errors) ? line.payload.errors : []).join('; ')}`);
    } else if (line.kind === 'RESULT' && isObject(line.payload) && line.payload.run === run) results.push(line.payload);
    else return;
    wake();
  });
  let stopped = false;
  return {
    problems: () => [...problems],
    results: () => [...results],
    /** @param {{ timeoutMs: number, signal?: AbortSignal }} options @returns {Promise<any>} */
    nextResult({ timeoutMs, signal = undefined }) {
      return new Promise((resolve, reject) => {
        let timer = null;
        const done = (settle, value) => {
          waiters.delete(check);
          clearTimeout(timer);
          if (signal) signal.removeEventListener('abort', interrupted);
          settle(value);
        };
        const interrupted = () => done(reject, new Error(`interrupted while waiting for RESULT (run ${run})`));
        const seen = problems.length;
        function check() {
          if (problems.length > seen) { done(reject, new Error(problems[problems.length - 1])); return; }
          if (results.length > taken) { taken += 1; done(resolve, results[taken - 1]); }
        }
        if (signal?.aborted) { interrupted(); return; }
        signal?.addEventListener('abort', interrupted);
        waiters.add(check);
        timer = setTimeout(() => done(reject, new Error(`no RESULT for run ${run} within ${timeoutMs} ms`)), timeoutMs);
        check();
      });
    },
    stop() { if (!stopped) { stopped = true; off(); } },
  };
}

/** How far READY's font scale may be from the one the harness set (round 2, resilience and architect). */
export const FONT_SCALE_TOLERANCE = 0.01;

/**
 * Problems with a READY: another build (sentinel), another step than the one sent (seq), another
 * scene, a probe the plan needs missing, a layout that is not RTL, a font scale that did not take.
 * @param {any} ready
 * @param {{ sentinel: string, scene: string, probes: string[], seq?: number, fontScale?: number }} expected
 */
export function checkReady(ready, { sentinel, scene, probes, seq = undefined, fontScale = undefined }) {
  const problems = [];
  if (seq !== undefined && ready.seq !== seq) problems.push(`READY is for seq ${ready.seq}, but the harness sent ${seq}`);
  // F-13: every device capture is right to left, and only the app can report its real direction.
  if (ready.isRTL !== true) problems.push(`READY says isRTL ${JSON.stringify(ready.isRTL)}: every capture must be laid out right to left (F-13)`);
  // The scale the app really used, against the one the harness set: a check that the setting took
  // effect, never a size. 1e-9 absorbs binary floating point at exactly 0.01.
  if (fontScale !== undefined && !(typeof ready.fontScale === 'number' && Math.abs(ready.fontScale - fontScale) <= FONT_SCALE_TOLERANCE + 1e-9)) {
    problems.push(`READY says font scale ${JSON.stringify(ready.fontScale)} but the harness set ${fontScale}: more than ${FONT_SCALE_TOLERANCE} apart, so the setting did not take effect`);
  }
  if (ready.sentinel !== sentinel) problems.push(`sentinel ${ready.sentinel} is not this build's ${sentinel}: the installed lab is another build`);
  if (ready.scene !== scene) problems.push(`scene ${ready.scene} is not the planned ${scene}`);
  for (const id of probes) if (!ready.probes || !(id in ready.probes)) problems.push(`probe ${id} is missing from READY`);
  return problems;
}

/**
 * Which probes can be sampled (QA-038). A probe that is partly outside the screen, partly under the
 * system bars, or has no size is EXCLUDED and reported, never sampled and never dropped silently.
 * A kept probe becomes the whole-pixel rect that covers it.
 */
export function classifyProbes(probes, screen, app) {
  const inside = {};
  const excluded = [];
  for (const [id, rect] of Object.entries(probes)) {
    const { x, y, width, height } = rect.px;
    let reason = null;
    if (!(width > 0 && height > 0)) reason = 'no size';
    else if (x < 0 || y < 0 || x + width > screen.width || y + height > screen.height) reason = 'partly outside the screen';
    else if (x < app.x || y < app.y || x + width > app.x + app.width || y + height > app.y + app.height) reason = 'partly under the system bars';
    if (reason) {
      excluded.push({ id, reason, px: { x, y, width, height } });
      continue;
    }
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    inside[id] = { x: x0, y: y0, width: Math.ceil(x + width) - x0, height: Math.ceil(y + height) - y0 };
  }
  return { inside, excluded };
}

// adb shell joins its arguments into one command line for the device's shell, so every word the
// harness sends must be one plain token. The lab's own parser is the second check.
const SAFE = /^[A-Za-z0-9._-]+$/;
const COMPONENT = /^[A-Za-z0-9._]+$/;
const safe = (value, what) => {
  const s = String(value);
  if (!SAFE.test(s)) throw new Error(`${what} "${s}" is not a plain token the device shell reads as one word`);
  return s;
};
const component = (app) => {
  if (!COMPONENT.test(app.package) || !COMPONENT.test(app.activity)) throw new Error('package and activity must be plain names for the device shell');
  return `${app.package}/${app.activity}`;
};

/** A fresh launch (-S stops the lab first, -W waits for it) with every argument as a string extra. */
export function launchArgs(app, run, args) {
  const extras = ['--es', 'run', safe(run, 'run')];
  for (const [key, value] of Object.entries(args)) extras.push('--es', safe(key, 'key'), safe(value, key));
  return ['shell', 'am', 'start', '-W', '-S', '-n', component(app), ...extras];
}

/** A numbered step for the running lab (singleTask: it arrives through onNewIntent). */
export function commandArgs(app, seq, steps = 1) {
  if (!Number.isInteger(seq) || seq < 1 || !Number.isInteger(steps) || steps < 1) throw new Error('seq and steps must be positive integers');
  return ['shell', 'am', 'start', '-n', component(app), '--es', 'seq', String(seq), '--es', 'cmd', 'step', '--es', 'steps', String(steps)];
}
