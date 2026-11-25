import { rampProgress } from '../../../field/crossfade.ts';
import type { MotionTier } from '../../../motion/useMotionPolicy.ts';
import { BASE } from '../../../tokens/tokens.generated.ts';
import { actionFade, hintEasing, hintFade } from '../wellMotion.ts';

// The Well's one motion (LEDGER §3 L9 and §7; DEC-174): its hint holds the action's place, so it crossfades against the
// action in place. It gives way on the action's show ramp (motion.settle, the CTA's show) and comes back on its hide
// (motion.respond, the CTA's hide), each from wherever it is. Reduced motion (the still tier) takes motion.fadeReduced,
// linear, both ways. Battery saver drops only the field's tier: UI motion is unchanged (LEDGER §7).

const M = BASE.motion;

describe('hintFade', () => {
  it.each(['full', 'low'] as const)('%s tier: the hint gives way over motion.settle as the action shows', (tier) => {
    expect(hintFade(M, false, tier)).toEqual({ opacity: 0, duration: M.settle.duration, easing: M.settle.easing });
  });

  it.each(['full', 'low'] as const)('%s tier: the hint returns over motion.respond as the action hides', (tier) => {
    expect(hintFade(M, true, tier)).toEqual({ opacity: 1, duration: M.respond.duration, easing: M.respond.easing });
  });

  it.each([false, true])('still tier (reduced motion): one linear motion.fadeReduced either way (hint visible %p)', (visible) => {
    expect(hintFade(M, visible, 'still')).toEqual({ opacity: visible ? 1 : 0, duration: M.fadeReduced.duration, easing: M.fadeReduced.easing });
  });

  it('never outlasts 150 ms under reduced motion (LEDGER §7)', () => {
    expect(hintFade(M, true, 'still').duration).toBeLessThanOrEqual(150);
  });

  it.each([false, true])('the commit host is the default, unchanged (hint visible %p)', (visible) => {
    for (const tier of ['full', 'low', 'still'] as MotionTier[]) expect(hintFade(M, visible, tier, 'commit')).toEqual(hintFade(M, visible, tier));
  });
});

// The designer's F3: a Well that hosts a Button crossfades the Button against the hint itself, over motion.respond both
// ways (a Button draws no show or hide of its own), and motion.fadeReduced, linear, at the still tier. Each turn is held
// for well.hold (QA-068), so a turn must end inside it: two turns never overlap.
describe('the button host (F3): the hint and the Button crossfade', () => {
  it.each(['full', 'low'] as const)('%s tier: both over motion.respond, both ways', (tier) => {
    for (const visible of [false, true]) {
      expect(hintFade(M, visible, tier, 'button')).toEqual({ opacity: visible ? 1 : 0, duration: M.respond.duration, easing: M.respond.easing });
      expect(actionFade(M, visible, tier)).toEqual({ opacity: visible ? 1 : 0, duration: M.respond.duration, easing: M.respond.easing });
    }
  });

  it.each([false, true])('still tier (reduced motion): one linear motion.fadeReduced, both ways, for both (shown %p)', (shown) => {
    expect(hintFade(M, !shown, 'still', 'button')).toEqual({ opacity: shown ? 0 : 1, duration: M.fadeReduced.duration, easing: M.fadeReduced.easing });
    expect(actionFade(M, shown, 'still')).toEqual({ opacity: shown ? 1 : 0, duration: M.fadeReduced.duration, easing: M.fadeReduced.easing });
  });

  it('every turn ends inside well.hold, in every tier, so two turns never overlap', () => {
    for (const tier of ['full', 'low', 'still'] as MotionTier[]) {
      for (const shown of [false, true]) {
        expect(hintFade(M, !shown, tier, 'button').duration).toBeLessThanOrEqual(BASE.well.hold);
        expect(actionFade(M, shown, tier).duration).toBeLessThanOrEqual(BASE.well.hold);
      }
    }
  });
});

describe('hintEasing: the token’s cubic-bezier, as a worklet the timing animation samples', () => {
  it.each([['settle', M.settle.easing], ['respond', M.respond.easing], ['fadeReduced', M.fadeReduced.easing]] as const)('%s: the field’s own ramp at every sample, 0 at the start and 1 at the end', (_name, easing) => {
    const f = hintEasing(easing);
    expect(f(0)).toBe(0);
    expect(f(1)).toBe(1);
    for (let i = 1; i < 20; i++) expect(f(i / 20)).toBeCloseTo(rampProgress(i, 20, easing), 12);
  });

  it('fadeReduced is linear', () => {
    const f = hintEasing(M.fadeReduced.easing);
    for (let i = 0; i <= 10; i++) expect(f(i / 10)).toBeCloseTo(i / 10, 9);
  });
});
