// The Design Lab's launch arguments (MB-085). The lab activity passes its intent extras through
// unchanged (`adb shell am start ... --es key value`); this parser is the one place they are
// checked. It is strict on purpose: a capture is only as trustworthy as the arguments it ran with,
// so an unknown key, an unknown id, a missing value or a value that is not a finite number is an
// error, never a default, and every problem is reported at once (the lab then sends an ERROR line
// and draws nothing).

export type ClockMode = 'fixed' | 'stepped' | 'realtime';
export const CLOCK_MODES: readonly ClockMode[] = ['fixed', 'stepped', 'realtime'];

export type LabParams = {
  /** The harness's id for this launch, echoed on every protocol line. */
  run: string;
  scene: string;
  clock: ClockMode;
  /** ms within the scene's period: the fixed instant, or the stepped clock's start. 0 for realtime. */
  t: number;
  /** ms per step of the stepped clock. 0 for the other clocks. */
  stepMs: number;
  /** Frames drawn on a settled layout before READY. */
  frames: number;
};

/** What the parser needs to know of each scene. */
export type SceneTiming = { periodMs: number };

export type ParseResult =
  | { ok: true; params: LabParams }
  | { ok: false; run: string | null; errors: string[] };

const KEYS: readonly string[] = ['run', 'scene', 'clock', 't', 'stepMs', 'frames'];
const RUN = /^[A-Za-z0-9._-]{1,64}$/;
// Plain decimal only: no exponent, no hex, no Infinity, no empty string.
const DECIMAL = /^-?\d+(\.\d+)?$/;
const FRAMES = /^\d{1,3}$/;
const DEFAULT_FRAMES = 3;
const MAX_FRAMES = 600;

/**
 * @param raw          the string extras the activity passed (`labArgs`)
 * @param nonStringKeys extras the activity dropped because they were not strings (`--ei`, `--ez`, ...)
 * @param scenes       the lab's scenes, by id
 */
export function parseLabArgs(
  raw: Record<string, unknown> | null | undefined,
  nonStringKeys: readonly string[],
  scenes: Readonly<Record<string, SceneTiming>>,
): ParseResult {
  const errors: string[] = [];
  const values: Record<string, string> = {};
  const wrongType = new Set<string>();
  const typeError = (key: string) => {
    wrongType.add(key);
    errors.push(`${key} must be a string extra (--es), not another type`);
  };

  for (const key of nonStringKeys) {
    if (KEYS.includes(key)) typeError(key);
    else errors.push(`unknown key "${key}"`);
  }
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (!KEYS.includes(key)) errors.push(`unknown key "${key}"`);
    else if (typeof value !== 'string') typeError(key);
    else values[key] = value;
  }
  const missing = (key: string) => values[key] === undefined && !wrongType.has(key);

  const run = values.run;
  if (missing('run')) errors.push('run is required');
  else if (run !== undefined && !RUN.test(run)) errors.push('run must be 1-64 characters of A-Z a-z 0-9 . _ -');

  const scene = values.scene;
  let timing: SceneTiming | undefined;
  if (missing('scene')) errors.push('scene is required');
  else if (scene !== undefined) {
    if (Object.prototype.hasOwnProperty.call(scenes, scene)) timing = scenes[scene];
    else errors.push(`scene "${scene}" is not a lab scene (${Object.keys(scenes).join(', ')})`);
  }

  const clockRaw = values.clock;
  let clock: ClockMode | undefined;
  if (missing('clock')) errors.push('clock is required');
  else if (clockRaw !== undefined) {
    if ((CLOCK_MODES as readonly string[]).includes(clockRaw)) clock = clockRaw as ClockMode;
    else errors.push(`clock must be one of ${CLOCK_MODES.join(', ')}`);
  }

  // undefined: absent · null: present but not a number · number: a finite decimal
  const decimal = (key: string): number | null | undefined => {
    const v = values[key];
    if (v === undefined) return wrongType.has(key) ? null : undefined;
    // A long enough digit string passes the pattern and still becomes Infinity.
    if (!DECIMAL.test(v) || !Number.isFinite(Number(v))) {
      errors.push(`${key} must be a finite decimal number (got "${v}")`);
      return null;
    }
    return Number(v);
  };
  const t = decimal('t');
  const stepMs = decimal('stepMs');

  if (clock === 'fixed') {
    if (t === undefined) errors.push('t is required for the fixed clock');
    if (stepMs !== undefined) errors.push('stepMs is only for the stepped clock');
  } else if (clock === 'stepped') {
    if (stepMs === undefined) errors.push('stepMs is required for the stepped clock');
    else if (typeof stepMs === 'number' && !(stepMs > 0)) errors.push('stepMs must be > 0');
    // A step of a whole period or more lands on the same instant every time: a sweep would prove nothing.
    else if (typeof stepMs === 'number' && timing && !(stepMs < timing.periodMs)) errors.push(`stepMs must be < ${timing.periodMs}`);
  } else if (clock === 'realtime') {
    if (t !== undefined) errors.push('t is not taken by the realtime clock');
    if (stepMs !== undefined) errors.push('stepMs is only for the stepped clock');
  }
  if (typeof t === 'number' && timing && clock !== 'realtime' && !(t >= 0 && t < timing.periodMs)) {
    errors.push(`t must be in [0, ${timing.periodMs})`);
  }

  let frames = DEFAULT_FRAMES;
  const framesRaw = values.frames;
  if (framesRaw !== undefined) {
    const n = Number(framesRaw);
    if (!FRAMES.test(framesRaw) || n < 1 || n > MAX_FRAMES) errors.push(`frames must be an integer from 1 to ${MAX_FRAMES}`);
    else frames = n;
  }

  if (errors.length > 0 || run === undefined || scene === undefined || clock === undefined) {
    return { ok: false, run: run !== undefined && RUN.test(run) ? run : null, errors };
  }
  return {
    ok: true,
    params: { run, scene, clock, t: typeof t === 'number' ? t : 0, stepMs: typeof stepMs === 'number' ? stepMs : 0, frames },
  };
}
