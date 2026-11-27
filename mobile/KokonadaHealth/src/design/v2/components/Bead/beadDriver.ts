// The beads' one clock (UI-320, UI-321; the architect's ruling and the designer's rulings of 2026-11-26 and 2026-11-27).
// F1, as amended: every channel of a bead's look (opacity, colour disc, scale) is computed off the JS thread from one
// clock per bead and written in the same frame; what follows the bead (the returning rim letters) is computed off the
// JS thread from the bead's look of the frame before, so it may trail the bead by one frame and never leads it; no
// frame's look waits on JS.
//
//   · JS says who is on the plate and in which phase (a BeadPlay per bead in motion: useBeadClock.ts makes them from the
//     presence). It never says when: a bead's clock starts at the first UI frame that sees it in its phase (t0), never
//     at a JS stamp, so a motion that starts late starts whole, and the bead and the letters that follow it are late
//     by the same amount.
//   · A phase is one timeline played over one length: the entrance is the later of press + respond and the scale's own
//     token (600 ms in Abyss), the exit its hold and motion.respond. A motion JS dispatched late is compressed, the
//     whole timeline over what is left of it and never over less than motion.respond (playMs): never skipped, and the
//     scale on the same clock. Only time compresses, so F1 holds under every ratio.
//   · One atomic look: driverStep returns every bead's opacity, colour and scale together, and the frame callback
//     writes them in one assignment. A leaving bead's look carries `start`, its opacity when its exit began, and
//     `before`, its opacity in the frame before: the rim words read those two and nothing of the current frame
//     (RimLabels/arc.ts lettersOpacity), since the bead's view may reach the screen a frame after the words' surface.
//   · The driver runs one frame past a bead's end: in that frame `before` is 0, so its letters land whole on the UI
//     thread, and only then may the driver rest.
//   · No look yet means not drawn whole: a bead placed with an entrance is at opacity 0 until its first UI frame
//     (restLook); a leaving bead stays as it was.
//   · An exit reports once, in the frame the bead itself ends (`gone`). Nothing else leaves the UI thread.
//
// Every function here is a worklet, and none reads a clock: the frame's timestamp is its only time.

import { entranceLook, exitLook, type BeadLook, type BeadMotion } from './beadModel.ts';
import { exitDuration, playMs, PRESS_MS, RESPOND_MS } from './beadTimeline.ts';

/**
 * A bead's look as the driver writes it: with `start`, its opacity when its exit began (null while it enters or rests),
 * and `before`, its opacity in the exit's frame before this one (null in its first exit frame, and while it enters or
 * rests): what the letters that follow it read.
 */
export interface DrivenLook extends BeadLook {
  readonly start: number | null;
  readonly before: number | null;
}

/** Every look the driver holds, by bead id: the beads in motion, and those that entered and now rest. */
export type BeadLooks = Readonly<Record<number, DrivenLook>>;

/** What JS tells the driver of a bead: who, which phase, and how late JS was to say so. */
export interface BeadPlay {
  readonly id: number;
  readonly leaving: boolean;
  /** It was placed with an entrance: with no look yet it is not drawn. False: whole from its first frame. */
  readonly entered: boolean;
  /** How long after the presence's stamp JS dispatched this phase, in ms: the motion is compressed by it. */
  readonly late: number;
}

/** A phase as it runs on the UI thread. */
export interface BeadRun {
  readonly leaving: boolean;
  /** The timestamp of the first UI frame that saw the bead in this phase. */
  readonly t0: number;
  /** The timeline's length, and the ms it is played over. */
  readonly end: number;
  readonly play: number;
  /** An exit's start: the bead as it was drawn. */
  readonly from: BeadLook;
  readonly done: boolean;
  /** An exit's frame past its end has been written: its letters have landed. */
  readonly trailed: boolean;
}

export type BeadRuns = Readonly<Record<number, BeadRun>>;

export interface DriverConfig {
  /** The direction's entrance (beadMotion at tier full: the low tier plays the same). */
  readonly motion: BeadMotion;
  /** Every motion's length times this (the lab's dial; 1 in the app). */
  readonly timeScale: number;
}

export interface DriverFrame {
  readonly runs: BeadRuns;
  readonly looks: BeadLooks;
  /** The beads whose exit ended in this frame. */
  readonly gone: readonly number[];
  /** A bead is still entering or leaving, or left in this frame and its letters land in the next: false, and the driver may rest. */
  readonly moving: boolean;
}

/** The entrance's whole length: the later of the timeline's end (press + respond) and the scale's own token. */
export function entranceEnd(m: BeadMotion): number {
  'worklet';
  const timeline = PRESS_MS + RESPOND_MS;
  return m.duration > timeline ? m.duration : timeline;
}

/** A bead the driver has not drawn yet: out, at the entrance's first scale, when it has an entrance to play; else whole. */
export function restLook(entered: boolean, m: BeadMotion): BeadLook {
  'worklet';
  return entered ? { opacity: 0, colour: 0, scale: m.scaleFrom } : { opacity: 1, colour: 1, scale: 1 };
}

/**
 * One UI frame at `timestamp`: every play's look, from its own clock. A play the driver has not seen in its phase starts
 * its clock in this frame; an exit starts from the look the bead has. Runs and looks of beads no longer played are dropped.
 */
export function driverStep(plays: readonly BeadPlay[], runs: BeadRuns, looks: BeadLooks, timestamp: number, config: DriverConfig): DriverFrame {
  'worklet';
  const nextRuns: Record<number, BeadRun> = {};
  const nextLooks: Record<number, DrivenLook> = {};
  const gone: number[] = [];
  let moving = false;
  const stretch = config.timeScale >= 1 ? config.timeScale : 1;
  for (let i = 0; i < plays.length; i++) {
    const p = plays[i];
    let run: BeadRun | undefined = runs[p.id];
    if (run === undefined || run.leaving !== p.leaving) {
      if (p.leaving) {
        const seen = looks[p.id];
        const from = seen !== undefined ? { opacity: seen.opacity, colour: seen.colour, scale: seen.scale } : restLook(p.entered, config.motion);
        const end = exitDuration(from.opacity);
        run = { leaving: true, t0: timestamp, end, play: playMs(end, p.late) * stretch, from, done: false, trailed: false };
      } else {
        const end = entranceEnd(config.motion);
        run = { leaving: false, t0: timestamp, end, play: playMs(end, p.late) * stretch, from: restLook(true, config.motion), done: false, trailed: false };
      }
    }
    const clock = ((timestamp - run.t0) * run.end) / run.play;
    // A bead that leaves from nothing has nothing to play.
    const over = !(clock < run.end) || (run.leaving && !(run.from.opacity > 0));
    if (run.leaving) {
      const l = exitLook(run.from, over ? run.end : clock);
      // What the letters read: the bead as this exit drew it the frame before; in its first frame, nothing yet.
      const last = looks[p.id];
      const before = last !== undefined && last.start !== null ? last.opacity : null;
      nextLooks[p.id] = { opacity: over ? 0 : l.opacity, colour: over ? 0 : l.colour, scale: l.scale, start: run.from.opacity, before };
      if (over && !run.done) gone.push(p.id);
    } else {
      const l = entranceLook(config.motion, over ? run.end : clock);
      nextLooks[p.id] = { opacity: l.opacity, colour: l.colour, scale: l.scale, start: null, before: null };
    }
    // An exit that ended in an earlier frame has now written its frame past the end.
    const trailed = run.leaving && run.done;
    nextRuns[p.id] = (over && !run.done) || (trailed && !run.trailed)
      ? { leaving: run.leaving, t0: run.t0, end: run.end, play: run.play, from: run.from, done: true, trailed }
      : run;
    if (!over || (run.leaving && !run.done)) moving = true;
  }
  return { runs: nextRuns, looks: nextLooks, gone, moving };
}
