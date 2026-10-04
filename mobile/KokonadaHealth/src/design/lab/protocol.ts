// The Design Lab protocol (MB-085): how the lab tells the capture harness what is on screen.
//
// Lines go to logcat (tag ReactNativeJS) as:  KOKONADA_LAB <KIND> <one-line JSON>
//   READY    the frame on screen is the one the arguments (and the last command) asked for:
//            every probe is measured, the fonts are ready, and N frames were drawn on a stable layout
//   ERROR    the launch arguments were refused; the lab draws nothing
//   IGNORED  a command was not applied (malformed, unknown, a duplicate, out of order, or early)
//
// Commands arrive as intent extras on the running activity (onNewIntent), numbered from 1:
//   seq=<n> cmd=step [steps=<k>]
// A command is applied only when it is the next number AND the previous one has settled (its READY
// was sent). Anything else is ignored with a reason, so a capture can never be of the wrong step;
// the harness times out and fails instead.

export const LAB_TAG = 'KOKONADA_LAB';
export type LineKind = 'READY' | 'ERROR' | 'IGNORED';

/** Logcat truncates a line at about 4 KB, so a longer one could not be read back whole. */
export const MAX_LINE_BYTES = 4000;

// UTF-8 length without Buffer or TextEncoder, which the lab's Hermes runtime may not have.
function utf8Bytes(s: string): number {
  let bytes = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/**
 * One protocol line. Throws on a number that is not finite (JSON would silently write null), and
 * on a line over MAX_LINE_BYTES (logcat would truncate it).
 */
export function formatLine(kind: LineKind, payload: unknown): string {
  const json = JSON.stringify(payload, (key, value) => {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error(`${kind}: ${key || 'the payload'} is not a finite number`);
    }
    return value;
  });
  const line = `${LAB_TAG} ${kind} ${json}`;
  const bytes = utf8Bytes(line);
  if (bytes > MAX_LINE_BYTES) throw new Error(`${kind}: the line is ${bytes} bytes, over the ${MAX_LINE_BYTES} bytes logcat keeps`);
  return line;
}

// ---- commands -----------------------------------------------------------------------------

export type IgnoredReason = 'malformed' | 'unknown-command' | 'duplicate' | 'out-of-order' | 'busy';
export type Command =
  | { ok: true; seq: number; cmd: 'step'; steps: number }
  | { ok: false; reason: 'malformed' | 'unknown-command'; detail: string; seq: number | null };

const COMMAND_KEYS: readonly string[] = ['seq', 'cmd', 'steps'];
const POSITIVE_INT = /^[1-9]\d{0,8}$/;

/** A command from the activity's intent extras, checked as strictly as the launch arguments. */
export function parseCommand(raw: Record<string, unknown>): Command {
  const seqRaw = raw.seq;
  const seq = typeof seqRaw === 'string' && POSITIVE_INT.test(seqRaw) ? Number(seqRaw) : null;
  const refuse = (reason: 'malformed' | 'unknown-command', detail: string): Command => ({ ok: false, reason, detail, seq });

  for (const [key, value] of Object.entries(raw)) {
    if (!COMMAND_KEYS.includes(key)) return refuse('malformed', `unknown key "${key}"`);
    if (typeof value !== 'string') return refuse('malformed', `${key} must be a string extra (--es)`);
  }
  if (seq === null) return refuse('malformed', 'seq must be a positive integer');
  if (raw.cmd === undefined) return refuse('malformed', 'cmd is required');
  if (raw.cmd !== 'step') return refuse('unknown-command', `cmd "${String(raw.cmd)}" is not a lab command`);
  let steps = 1;
  if (raw.steps !== undefined) {
    if (!POSITIVE_INT.test(raw.steps as string)) return refuse('malformed', 'steps must be a positive integer');
    steps = Number(raw.steps);
  }
  return { ok: true, seq, cmd: 'step', steps };
}

export type Offer = 'accept' | 'duplicate' | 'out-of-order' | 'busy';

/** Admits commands strictly in order, one at a time. `settle()` marks the last one's READY as sent. */
export function createCommandGate() {
  let last = 0;
  let settled = false;
  return {
    offer(seq: number): Offer {
      if (seq <= last) return 'duplicate';
      if (seq > last + 1) return 'out-of-order';
      if (!settled) return 'busy';
      last = seq;
      settled = false;
      return 'accept';
    },
    settle() { settled = true; },
    last: () => last,
  };
}

// ---- READY --------------------------------------------------------------------------------

type ReadyGateOptions<R> = {
  /** The probe ids the scene declares; READY waits for every one. */
  probes: readonly string[];
  /** Frames to draw on a stable layout, after the probes and the fonts, before READY. */
  frames: number;
  onReady(snapshot: { probes: Record<string, R> }): void;
};

const sameRect = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Decides when READY may be sent: once per arming, after every declared probe is measured, the
 * fonts are ready, and `frames` frames were drawn with no probe moving. `rearm()` asks for the next
 * READY (after a command) with N fresh frames.
 */
export function createReadyGate<R>({ probes, frames, onReady }: ReadyGateOptions<R>) {
  if (probes.length === 0) throw new Error('a scene must declare at least one probe');
  if (!Number.isInteger(frames) || frames < 1) throw new Error(`frames must be an integer >= 1 (got ${frames})`);
  const declared = new Set(probes);
  const measured = new Map<string, R>();
  let fonts = false;
  let counted = 0;
  let fired = false;
  const prepared = () => fonts && measured.size === declared.size;

  return {
    measure(id: string, rect: R) {
      if (!declared.has(id)) throw new Error(`probe "${id}" is not declared by the scene`);
      if (measured.has(id) && !sameRect(measured.get(id), rect)) counted = 0; // moved: not settled yet
      measured.set(id, rect);
    },
    fontsReady() { fonts = true; },
    wantsFrame: () => !fired && prepared(),
    frame() {
      if (fired || !prepared()) return;
      counted += 1;
      if (counted < frames) return;
      fired = true;
      onReady({ probes: Object.fromEntries(probes.map((id) => [id, measured.get(id) as R])) });
    },
    rearm() {
      fired = false;
      counted = 0;
    },
  };
}
