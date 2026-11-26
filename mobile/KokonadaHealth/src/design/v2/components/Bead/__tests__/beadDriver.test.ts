/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';
import { lettersOpacity } from '../../RimLabels/arc.ts';
import { DIRECTIONS, type DirectionId } from '../../../tokens/tokens.generated.ts';
import { driverStep, entranceEnd, restLook, type BeadLooks, type BeadPlay, type BeadRuns, type DriverConfig } from '../beadDriver.ts';
import { beadMotion, entranceLook, exitLook } from '../beadModel.ts';
import { entranceColour, entranceOpacity, exitDuration, exitOpacity, playMs, PLAY_FLOOR_MS, PRESS_MS, RESPOND_MS } from '../beadTimeline.ts';

// UI-320 and UI-321 (the architect's ruling and the designer's rulings of 2026-11-26). One clock per bead on the UI
// thread: the bead's look and the rim letters that follow it are both read from it, so however late the first UI frame
// comes, the letters are exactly 1 − opacity ÷ start opacity, and exactly 0 while the bead is at its start opacity.
// A late motion is compressed onto motion.respond at the least, never skipped: the entrance's grey step is always seen.

const MOTION = beadMotion('abyss', 'full');
const CONFIG: DriverConfig = { motion: MOTION, timeScale: 1 };
const FRAME = 1000 / 60;
const ID = 7;
type Step = typeof driverStep;

/** A UI thread: the driver's state, stepped one frame at a time. */
function ui(step: Step = driverStep, config: DriverConfig = CONFIG) {
  let runs: BeadRuns = {};
  let looks: BeadLooks = {};
  const gone: number[] = [];
  return {
    frame(plays: readonly BeadPlay[], timestamp: number) {
      const out = step(plays, runs, looks, timestamp, config);
      runs = out.runs;
      looks = out.looks;
      gone.push(...out.gone);
      return out;
    },
    looks: () => looks,
    gone,
  };
}
/**
 * Mutants made by hand (the source-planted ones are in lab/__tests__/heroDriverMutants.test.tsx: v2 imports nothing from
 * outside v2). STAMPED starts a phase's clock at the JS stamp, `late` ms before its first UI frame, as 27107e1's letters
 * did; SKIPPING also plays it at 1:1 from there, as 27107e1's entrance did.
 */
const fromStamp = (compress: boolean): Step => (plays, runs, looks, timestamp, config) => {
  let state = { runs, looks };
  for (const p of plays) {
    const run = state.runs[p.id];
    if (run !== undefined && run.leaving === p.leaving) continue;
    const started = driverStep([compress ? p : { ...p, late: 0 }], state.runs, state.looks, timestamp - p.late, config);
    state = { runs: { ...state.runs, ...started.runs }, looks: { ...state.looks, ...started.looks } };
  }
  return driverStep(plays, state.runs, state.looks, timestamp, config);
};
const STAMPED = fromStamp(true);
const SKIPPING = fromStamp(false);
const entering = (late = 0, id = ID): BeadPlay => ({ id, leaving: false, entered: true, late });
const leaving = (late = 0, entered = false, id = ID): BeadPlay => ({ id, leaving: true, entered, late });

/** The frames of one exit: a bead that left at `leftAt`, its first UI frame `d` ms later, then a frame every `dt` to its end. */
function exitFrames(step: Step, d: number, from: 'whole' | number, dt = FRAME) {
  const thread = ui(step);
  const leftAt = 5000;
  let t = leftAt - 2000;
  if (from !== 'whole') {
    // Caught in its entrance, `from` ms in.
    thread.frame([entering()], t);
    t += from;
    thread.frame([entering()], t);
    expect(thread.looks()[ID].opacity).toBe(entranceOpacity(from));
  }
  const before = thread.looks()[ID] ?? restLook(false, MOTION);
  const frames: Array<{ t: number; opacity: number; colour: number; start: number; letters: number }> = [];
  for (t = leftAt + d; thread.gone.length === 0 && frames.length < 5000; t += dt) {
    thread.frame([leaving(d, from !== 'whole')], t);
    const look = thread.looks()[ID];
    frames.push({ t, opacity: look.opacity, colour: look.colour, start: look.start!, letters: lettersOpacity([ID], thread.looks()) });
  }
  return { frames, before, leftAt, first: leftAt + d };
}

/** T1's law over an exit's frames: the problems found, none when it holds. */
function lawProblems(run: ReturnType<typeof exitFrames>, lettersAt = (f: { t: number; letters: number }) => f.letters): string[] {
  const problems: string[] = [];
  const a0 = run.before.opacity;
  run.frames.forEach((f, i) => {
    const letters = lettersAt(f);
    if (Math.abs(letters - (1 - f.opacity / a0)) > 1e-12) problems.push(`frame ${i}: letters ${letters} beside a bead at ${f.opacity} of ${a0}`);
    if (letters > 0 && f.colour !== 0) problems.push(`frame ${i}: letters ${letters} beside a bead in colour ${f.colour}`);
    if (f.opacity === a0 && letters !== 0) problems.push(`frame ${i}: letters ${letters} beside a bead at its start opacity`);
  });
  const [first] = run.frames;
  if (first.opacity !== a0 || first.colour !== run.before.colour) problems.push(`the first frame is not the bead as it was: ${JSON.stringify(first)}`);
  return problems;
}

describe('T1: the letters are the bead’s own look, however late its first UI frame comes', () => {
  it.each([0, 16, 100, 300, 1000])('an opaque bead whose first exit frame comes %p ms after leftAt: at every frame the letters are exactly 1 − opacity ÷ start, and above 0 only once the colour is 0', (d) => {
    const run = exitFrames(driverStep, d, 'whole');
    expect(lawProblems(run)).toEqual([]);
    // The whole timeline is seen, from the first UI frame: the hold in colour, the grey, then gone.
    expect(run.frames[0]).toMatchObject({ opacity: 1, colour: 1, letters: 0 });
    const play = playMs(exitDuration(1), d);
    run.frames.forEach((f, i) => {
      const clock = ((f.t - run.first) * exitDuration(1)) / play;
      if (clock < exitDuration(1)) expect([i, f.opacity]).toEqual([i, exitOpacity(1, clock)]);
    });
    expect(run.frames.filter((f) => f.opacity === 1 && f.colour === 0 && f.letters === 0).length + run.frames.filter((f) => f.opacity > 0 && f.opacity < 1).length).toBeGreaterThanOrEqual(6);
    const last = run.frames[run.frames.length - 1];
    expect(last).toMatchObject({ opacity: 0, colour: 0, letters: 1 });
    // It ends when it was due, or motion.respond after its first frame when that is later: compressed, never skipped.
    expect(last.t - run.first).toBeGreaterThanOrEqual(Math.max(exitDuration(1) - d, PLAY_FLOOR_MS));
    expect(last.t - run.first).toBeLessThan(Math.max(exitDuration(1) - d, PLAY_FLOOR_MS) + FRAME);
  });

  it.each([0, 16, 100, 300, 1000])('a bead caught translucent in its entrance, its first exit frame %p ms late: the same law from its own start opacity', (d) => {
    const run = exitFrames(driverStep, d, 40);
    expect(run.before.opacity).toBeGreaterThan(0);
    expect(run.before.opacity).toBeLessThan(1);
    expect(lawProblems(run)).toEqual([]);
    for (const f of run.frames) expect(f.colour).toBe(0);
  });

  it('the letters never run ahead: they do not go down, and are whole only in the frame the bead is gone', () => {
    for (const d of [0, 300]) {
      const { frames } = exitFrames(driverStep, d, 'whole', 4);
      for (let i = 1; i < frames.length; i++) expect(frames[i].letters).toBeGreaterThanOrEqual(frames[i - 1].letters);
      expect(frames.filter((f) => f.letters === 1).map((f) => f.opacity)).toEqual([0]);
    }
  });

  it('mutant: a driver whose exit clock starts at the JS stamp (leftAt), not at its first UI frame, fails the law for every late frame', () => {
    expect(lawProblems(exitFrames(STAMPED, 0, 'whole'))).toEqual([]);
    for (const d of [100, 300, 1000]) expect(lawProblems(exitFrames(STAMPED, d, 'whole')).join('\n')).toMatch(/the first frame is not the bead as it was/);
  });

  it('mutant: letters read from leftAt on the wall clock (27107e1) are whole beside an opaque bead once the first frame is late', () => {
    const wall = (run: ReturnType<typeof exitFrames>) => lawProblems(run, (f) => 1 - exitOpacity(1, f.t - run.leftAt));
    expect(wall(exitFrames(driverStep, 0, 'whole'))).toEqual([]);
    const late = wall(exitFrames(driverStep, 300, 'whole'));
    expect(late.length).toBeGreaterThan(0);
    expect(late[0]).toMatch(/^frame 0: letters 0\.9\d* beside a bead at 1 of 1$/);
  });

  it('a leaving bead with no entrance and no look yet starts whole; one placed with an entrance and never drawn leaves from nothing, gone in its first frame', () => {
    const whole = ui();
    whole.frame([leaving(0, false)], 100);
    expect(whole.looks()[ID]).toEqual({ opacity: 1, colour: 1, scale: 1, start: 1 });
    const never = ui();
    const out = never.frame([leaving(0, true)], 100);
    expect(never.looks()[ID]).toEqual({ opacity: 0, colour: 0, scale: MOTION.scaleFrom, start: 0 });
    expect([out.gone, out.moving]).toEqual([[ID], false]);
    // Its letters are back, never NaN (start opacity 0).
    expect(lettersOpacity([ID], never.looks())).toBe(1);
  });
});

describe('T3: F1 on the look worklets: the colour is exactly 0 below opacity 1, under every compression', () => {
  const LATES = [0, 100, 200, 250, 430, 2000];

  it('the entrance, at every 0.25 ms of its clock and at every ms of its play, for each lateness', () => {
    let coloured = 0;
    for (const late of LATES) {
      const play = playMs(entranceEnd(MOTION), late);
      const ratio = play / entranceEnd(MOTION);
      for (const dt of [0.25 * ratio, 1]) {
        const thread = ui();
        for (let t = 9000; t <= 9000 + play + 5; t += dt) {
          thread.frame([entering(late)], t);
          const look = thread.looks()[ID];
          if (look.colour > 0) {
            coloured++;
            if (look.opacity !== 1) expect([late, t, look]).toEqual([late, t, { ...look, opacity: 1 }]);
          }
        }
      }
    }
    expect(coloured).toBeGreaterThan(6000);
  });

  it('the exit, from every 25 ms of the entrance, at every 0.25 ms of its clock, for each lateness', () => {
    let coloured = 0;
    for (const late of [0, 300, 2000]) {
      for (let at = 0; at <= entranceEnd(MOTION); at += 25) {
        const thread = ui();
        thread.frame([entering()], 1000);
        thread.frame([entering()], 1000 + at);
        const end = exitDuration(thread.looks()[ID].opacity);
        const dt = (0.25 * playMs(end, late)) / end;
        for (let t = 2000; thread.gone.length === 0; t += dt) {
          thread.frame([leaving(late, true)], t);
          const look = thread.looks()[ID];
          if (look.colour > 0) {
            coloured++;
            if (look.opacity !== 1) expect([late, at, t, look]).toEqual([late, at, t, { ...look, opacity: 1 }]);
          }
        }
      }
    }
    expect(coloured).toBeGreaterThan(5000);
  });

  it('the look worklets are the timeline: entranceLook and exitLook give its opacity and colour at every clock', () => {
    for (let t = -10; t <= 700; t += 0.5) {
      const look = entranceLook(MOTION, t);
      expect([t, look.opacity, look.colour]).toEqual([t, entranceOpacity(t), entranceColour(t)]);
    }
    expect(exitLook({ opacity: 1, colour: 0.7, scale: 0.9 }, 50).scale).toBe(0.9);
  });

  it('mutant: a colour that starts 10 ms early is caught', () => {
    const early = (t: number) => ({ ...entranceLook(MOTION, t), colour: entranceColour(t + 10) });
    const breaches = (look: (t: number) => { opacity: number; colour: number }) => {
      let n = 0;
      for (let t = 0; t <= PRESS_MS + RESPOND_MS; t += 0.25) if (look(t).colour > 0 && look(t).opacity !== 1) n++;
      return n;
    };
    expect(breaches((t) => entranceLook(MOTION, t))).toBe(0);
    expect(breaches(early)).toBeGreaterThan(10);
  });
});

describe('UI-321: a late entrance is compressed, never skipped (the designer’s ruling: COMPRESS)', () => {
  /** An entrance dispatched `late` ms after its placement: its looks at 60 Hz from its first UI frame. */
  const entrance = (late: number, step: Step = driverStep) => {
    const thread = ui(step);
    const t0 = 20_000;
    const frames: Array<{ ms: number; opacity: number; colour: number; scale: number }> = [];
    for (let k = 0; k < 80; k++) {
      thread.frame([entering(late)], t0 + k * FRAME);
      frames.push({ ms: k * FRAME, ...thread.looks()[ID] });
    }
    return frames;
  };

  it.each([0, 200, 430, 2000])('%p ms late: never whole in its first frame, translucent grey for at least 50 ms, then opaque under half its colour for a frame or more', (late) => {
    const frames = entrance(late);
    expect(frames[0]).toMatchObject({ opacity: 0, colour: 0, scale: MOTION.scaleFrom });
    const grey = frames.filter((f) => f.opacity > 0 && f.opacity < 1);
    for (const f of grey) expect(f.colour).toBe(0);
    // Frames 1 to n are translucent: the step is on screen from the first frame (opacity 0) to the first opaque one.
    const firstOpaque = frames.findIndex((f) => f.opacity === 1);
    expect(frames[firstOpaque].ms).toBeGreaterThanOrEqual(50);
    expect(grey.length).toBeGreaterThanOrEqual(3);
    expect(frames.filter((f) => f.opacity === 1 && f.colour < 0.5).length).toBeGreaterThanOrEqual(1);
  });

  it.each([0, 200, 430, 2000])('%p ms late: it ends when it was due, or motion.respond after its first frame when that is later, the scale on the same clock', (late) => {
    const frames = entrance(late);
    const end = entranceEnd(MOTION);
    const play = Math.max(end - late, PLAY_FLOOR_MS);
    const whole = frames.findIndex((f) => f.opacity === 1 && f.colour === 1 && f.scale === 1);
    expect(frames[whole].ms).toBeGreaterThanOrEqual(play);
    expect(frames[whole].ms).toBeLessThan(play + FRAME);
    // One clock: each frame is the model's look at the compressed clock, all three channels.
    for (const f of frames) {
      const want = entranceLook(MOTION, Math.min(end, (f.ms * end) / play));
      for (const [got, wanted] of [[f.opacity, want.opacity], [f.colour, want.colour], [f.scale, want.scale]]) expect(Math.abs(got - wanted)).toBeLessThan(1e-9);
    }
  });

  it('playMs: on time a motion plays its own length; late, what is left of it; never under the floor, and never over its own length', () => {
    expect(PLAY_FLOOR_MS).toBe(RESPOND_MS);
    expect([playMs(600, 0), playMs(600, 100), playMs(600, 250), playMs(600, 251), playMs(600, 430), playMs(600, 1e9)]).toEqual([600, 500, 350, 350, 350, 350]);
    expect([playMs(450, 0), playMs(450, 60), playMs(450, 300), playMs(350, 0), playMs(350, 5000)]).toEqual([450, 390, 350, 350, 350]);
    for (const late of [Number.NaN, -50, Number.NEGATIVE_INFINITY]) expect(playMs(600, late)).toBe(600);
    expect(playMs(600, Number.POSITIVE_INFINITY)).toBe(350);
    // A motion shorter than the floor is never stretched to it.
    expect(playMs(200, 1000)).toBe(200);
    expect(playMs(600, 500, 100)).toBe(100);
  });

  it('mutant: an entrance that starts where it is (27107e1: the clock at its lateness) shows no grey at 430 ms late', () => {
    const frames = entrance(430, SKIPPING);
    expect(frames[0].opacity).toBe(1);
    expect(frames.filter((f) => f.opacity > 0 && f.opacity < 1)).toEqual([]);
  });

  it('the time scale dial stretches every motion and nothing else: the same looks, that many times slower', () => {
    const slow = ui(driverStep, { motion: MOTION, timeScale: 8 });
    const plain = ui();
    for (let ms = 0; ms <= 700; ms += 10) {
      plain.frame([entering(100)], 1000 + ms);
      slow.frame([entering(100)], 1000 + 8 * ms);
      expect([ms, slow.looks()[ID]]).toEqual([ms, plain.looks()[ID]]);
    }
  });
});

// The designer's token test: at the floor, the grey step must still be three frames at 60 Hz, in every direction, so a
// token change cannot shrink it silently; and the opaque bead must stay under half its colour for a frame.
describe('the floor leaves the grey step on screen, in every direction’s tokens', () => {
  const ids = Object.keys(DIRECTIONS) as DirectionId[];
  const greyAtFloor = (floor: number, press: number, end: number) => (floor * press) / end;

  it.each(ids)('%s: floor × press ÷ end is at least 3 frames at 60 Hz, and the colour stays under 0.5 for one more', (id) => {
    const end = entranceEnd(beadMotion(id, 'full'));
    expect(end).toBeGreaterThanOrEqual(PRESS_MS + RESPOND_MS);
    expect(greyAtFloor(PLAY_FLOOR_MS, PRESS_MS, end)).toBeGreaterThanOrEqual(3 * FRAME);
    let underHalf = 0;
    for (let t = PRESS_MS; entranceColour(t) < 0.5; t += 0.05) underHalf = t - PRESS_MS;
    expect((underHalf * PLAY_FLOOR_MS) / end).toBeGreaterThanOrEqual(FRAME);
  });

  it('Abyss at the floor: 58 ms of grey (350 × 100 ÷ 600)', () => {
    expect(greyAtFloor(PLAY_FLOOR_MS, PRESS_MS, entranceEnd(MOTION))).toBeCloseTo(58.33, 2);
  });

  it('mutant: a floor of half motion.respond fails it', () => {
    expect(greyAtFloor(PLAY_FLOOR_MS / 2, PRESS_MS, entranceEnd(MOTION))).toBeLessThan(3 * FRAME);
    // And the driver plays what the test reads: an entrance late past its end is on screen for the floor, no less.
    expect(playMs(entranceEnd(MOTION), 10_000)).toBe(PLAY_FLOOR_MS);
  });

  it('a planted direction whose scale runs 1200 ms fails it: the grey would be 29 ms', () => {
    expect(greyAtFloor(PLAY_FLOOR_MS, PRESS_MS, entranceEnd({ ...MOTION, duration: 1200 }))).toBeLessThan(3 * FRAME);
  });
});

describe('the driver’s bookkeeping', () => {
  it('reports an exit once, in the frame it ends, and never an entrance', () => {
    const thread = ui();
    for (let t = 0; t <= 2000; t += FRAME) thread.frame([entering()], t);
    expect(thread.gone).toEqual([]);
    const seen: number[][] = [];
    for (let t = 3000; t <= 4000; t += 10) seen.push([...thread.frame([leaving(0, true)], t).gone]);
    expect(seen.filter((g) => g.length > 0)).toEqual([[ID]]);
    expect(seen.findIndex((g) => g.length > 0)).toBe(exitDuration(1) / 10);
  });

  it('says whether anything still moves: true through a motion, false from the frame it ends', () => {
    const thread = ui();
    const moving: boolean[] = [];
    for (let k = 0; k <= 80; k++) moving.push(thread.frame([entering()], k * 10).moving);
    expect(moving.lastIndexOf(true)).toBe(entranceEnd(MOTION) / 10 - 1);
    expect(thread.frame([], 5000)).toEqual({ runs: {}, looks: {}, gone: [], moving: false });
  });

  it('each bead has its own clock: one that starts later is not carried by one already running', () => {
    const thread = ui();
    thread.frame([leaving(0, false, 1)], 1000);
    thread.frame([leaving(0, false, 1), leaving(0, false, 2)], 1200);
    expect(thread.looks()[1].opacity).toBe(exitOpacity(1, 200));
    expect(thread.looks()[2].opacity).toBe(1);
    // Letters near both follow the one that fades last; near the first alone, the first.
    expect(lettersOpacity([1, 2], thread.looks())).toBe(0);
    expect(lettersOpacity([1], thread.looks())).toBe(1 - exitOpacity(1, 200));
  });

  it('drops the run and the look of a bead JS no longer plays', () => {
    const thread = ui();
    thread.frame([leaving(0, false, 1), entering(0, 2)], 1000);
    thread.frame([entering(0, 2)], 1016);
    expect(Object.keys(thread.looks())).toEqual(['2']);
  });

  it('a time scale under 1, or not a number, is 1: the dial only stretches', () => {
    for (const timeScale of [0.5, 0, Number.NaN]) {
      const thread = ui(driverStep, { motion: MOTION, timeScale });
      thread.frame([leaving()], 0);
      thread.frame([leaving()], 100);
      expect(thread.looks()[ID].opacity).toBe(exitOpacity(1, 100));
    }
  });
});

// The worklets plugin only lets a worklet call a worklet (beadTimeline.test.ts has the reasoning): every function the
// driver defines is one, and so is every function it imports by value.
describe('the driver runs on the UI thread', () => {
  const SOURCE = path.resolve(__dirname, '../beadDriver.ts');
  const functionsOf = (file: string) => {
    const tree = ts.createSourceFile('m.ts', fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const out: Array<{ name: string; worklet: boolean }> = [];
    for (const s of tree.statements) {
      if (!ts.isFunctionDeclaration(s) || !s.name) continue;
      const first = s.body?.statements[0];
      out.push({ name: s.name.text, worklet: first !== undefined && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === 'worklet' });
    }
    return { tree, out };
  };

  it('every function it defines is a worklet, and it reads no clock of its own', () => {
    const { out } = functionsOf(SOURCE);
    expect(out.map((f) => f.name)).toEqual(['entranceEnd', 'restLook', 'driverStep']);
    expect(out.filter((f) => !f.worklet)).toEqual([]);
    expect(fs.readFileSync(SOURCE, 'utf8')).not.toMatch(/performance\.now|Date\.now|leftAt\b.*-|placedAt\b.*-/);
  });

  it('every function it imports by value is a worklet in its own source', () => {
    const { tree } = functionsOf(SOURCE);
    const plain: string[] = [];
    let imported = 0;
    for (const s of tree.statements) {
      if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier) || !s.importClause?.namedBindings || !ts.isNamedImports(s.importClause.namedBindings)) continue;
      const theirs = functionsOf(path.resolve(path.dirname(SOURCE), s.moduleSpecifier.text)).out;
      for (const e of s.importClause.namedBindings.elements) {
        if (e.isTypeOnly) continue;
        const found = theirs.find((f) => f.name === (e.propertyName ?? e.name).text);
        if (found) imported++;
        if (found && !found.worklet) plain.push(found.name);
      }
    }
    expect(imported).toBeGreaterThanOrEqual(4);
    expect(plain).toEqual([]);
  });
});
