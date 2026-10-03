import { parseLabArgs } from '../params';

// MB-085. The lab is driven by launch arguments (string intent extras, `adb shell am start --es`),
// and a capture is only as trustworthy as the arguments it ran with. So the parser is strict: an
// unknown key, an unknown id, a missing value or a value that is not a finite number is an ERROR,
// never a default, and every problem is reported at once.

const SCENES = { smoke: { periodMs: 6000 } };
const parse = (raw: Record<string, unknown>, nonString: string[] = []) => parseLabArgs(raw, nonString, SCENES);
const ok = (raw: Record<string, unknown>) => {
  const r = parse(raw);
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.params;
};
const errorsOf = (raw: Record<string, unknown>, nonString: string[] = []) => {
  const r = parse(raw, nonString);
  return r.ok ? [] : r.errors;
};
const FIXED = { run: 'r-1', scene: 'smoke', clock: 'fixed', t: '1500' };

describe('parseLabArgs: what a valid launch becomes', () => {
  it('a fixed-clock launch, every value typed, frames defaulting to 3', () => {
    expect(ok(FIXED)).toEqual({ run: 'r-1', scene: 'smoke', clock: 'fixed', t: 1500, stepMs: 0, frames: 3 });
  });

  it('a stepped launch with a start time, a step and a frame count', () => {
    expect(ok({ run: 'r2', scene: 'smoke', clock: 'stepped', t: '0', stepMs: '250', frames: '5' }))
      .toEqual({ run: 'r2', scene: 'smoke', clock: 'stepped', t: 0, stepMs: 250, frames: 5 });
  });

  it('a stepped launch starts at 0 when no start time is given', () => {
    expect(ok({ run: 'r3', scene: 'smoke', clock: 'stepped', stepMs: '250' }).t).toBe(0);
  });

  it('a real-time launch, which takes no time and no step', () => {
    expect(ok({ run: 'r4', scene: 'smoke', clock: 'realtime' }))
      .toEqual({ run: 'r4', scene: 'smoke', clock: 'realtime', t: 0, stepMs: 0, frames: 3 });
  });
});

describe('parseLabArgs: what is refused, with the reason', () => {
  it.each([
    ['an unknown key', { ...FIXED, colour: 'red' }, /unknown key "colour"/],
    ['an unknown scene id', { ...FIXED, scene: 'hero2' }, /scene "hero2" is not a lab scene/],
    ['an unknown clock id', { ...FIXED, clock: 'wallclock' }, /clock must be one of fixed, stepped, realtime/],
    ['a missing run id', { scene: 'smoke', clock: 'fixed', t: '0' }, /run is required/],
    ['a run id that is not a plain token', { ...FIXED, run: 'r 1;rm' }, /run must be/],
    ['a missing scene', { run: 'r', clock: 'fixed', t: '0' }, /scene is required/],
    ['a missing clock', { run: 'r', scene: 'smoke', t: '0' }, /clock is required/],
    ['a fixed clock with no time', { run: 'r', scene: 'smoke', clock: 'fixed' }, /t is required/],
    ['a time that is not a number', { ...FIXED, t: 'NaN' }, /t must be a finite decimal number/],
    ['an infinite time', { ...FIXED, t: 'Infinity' }, /t must be a finite decimal number/],
    ['a time in exponent form', { ...FIXED, t: '1e3' }, /t must be a finite decimal number/],
    ['an empty time', { ...FIXED, t: '' }, /t must be a finite decimal number/],
    ['a negative time', { ...FIXED, t: '-1' }, /t must be in \[0, 6000\)/],
    ['a time at or past the scene period', { ...FIXED, t: '6000' }, /t must be in \[0, 6000\)/],
    ['a step on a fixed clock', { ...FIXED, stepMs: '250' }, /stepMs is only for the stepped clock/],
    ['a stepped clock with no step', { run: 'r', scene: 'smoke', clock: 'stepped' }, /stepMs is required/],
    ['a zero step', { run: 'r', scene: 'smoke', clock: 'stepped', stepMs: '0' }, /stepMs must be > 0/],
    ['a time on the real-time clock', { run: 'r', scene: 'smoke', clock: 'realtime', t: '10' }, /t is not taken by the realtime clock/],
    ['zero frames', { ...FIXED, frames: '0' }, /frames must be an integer from 1 to 600/],
    ['a fractional frame count', { ...FIXED, frames: '1.5' }, /frames must be an integer from 1 to 600/],
    ['too many frames', { ...FIXED, frames: '601' }, /frames must be an integer from 1 to 600/],
  ])('%s', (_label, raw, why) => {
    expect(errorsOf(raw).join('\n')).toMatch(why);
  });

  it('an extra that is not a string (adb --ei, --ez, --ef) is refused by name', () => {
    expect(errorsOf(FIXED, ['frames'])).toEqual(['frames must be a string extra (--es), not another type']);
  });

  it('a value that is not a string in the props themselves is refused', () => {
    expect(errorsOf({ ...FIXED, t: 1500 })).toEqual(['t must be a string extra (--es), not another type']);
  });

  it('reports every problem at once, not only the first', () => {
    expect(errorsOf({ scene: 'nope', clock: 'fixed', t: 'x', extra: '1' })).toHaveLength(4);
  });

  it('refuses a launch with no arguments at all (an empty launch is not the smoke default)', () => {
    expect(errorsOf({})).toEqual(['run is required', 'scene is required', 'clock is required']);
  });
});
