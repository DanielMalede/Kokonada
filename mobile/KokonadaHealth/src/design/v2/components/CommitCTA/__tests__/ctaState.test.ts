import { contrastRatio } from '../../../color/contrast.ts';
import { mixSafe } from '../../../color/mixSafe.ts';
import { oklabToSrgb } from '../../../color/oklab.ts';
import { isRed, type RedBand } from '../../../color/redBand.ts';
import { progress, rampProgress } from '../../../field/crossfade.ts';
import { BASE, DIRECTIONS, type Face } from '../../../tokens/tokens.generated.ts';
import { hexLab, srgbHex } from '../../Bead/beadModel.ts';
import { CTA_NODES, ctaColours, ctaInitial, ctaReduce, ctaState, type CtaMachine, type CtaPaint, type CtaPlacement } from '../ctaState.ts';

// DEC-174's CTA, as a pure machine: it shows and changes its tint only at the field's admitted starts, from a
// placement live in the store; it hides at once when the store empties, and the hide latches; it is pressable
// and exposed only while the store holds a tap and it is shown (from the start of its show ramp) and not hiding.
// Its tint is DSN-018's: the latest admitted live placement's quadrant at the face's tier (core on dark, deep on
// light, with the onTint label), or the neutral fill below placement.neutralRadius (text.primary with the onInk
// label, as the never-red sweeps and the designer's board have it). The storms (E6) are in ctaStorms.test.ts.

const ABYSS = DIRECTIONS.abyss;
const DARK: CtaPaint = { id: 'abyss', face: 'dark' };
const LIGHT: CtaPaint = { id: 'abyss', face: 'light' };
const CHECK: RedBand = { hueFrom: BASE.neverRed.check.hueStart, hueTo: BASE.neverRed.check.hueEnd, chromaFloor: BASE.neverRed.check.chromaFloor };
const DESIGN: RedBand = { hueFrom: BASE.neverRed.design.hueStart, hueTo: BASE.neverRed.design.hueEnd, chromaFloor: BASE.neverRed.design.chromaFloor };
const SETTLE = BASE.motion.settle.duration;
const REDUCED = BASE.motion.fadeReduced.duration;
const RESPOND = BASE.motion.respond;
const tierOf = (face: Face) => (face === 'dark' ? 'core' : 'deep');
const srgb = (hex: string) => oklabToSrgb(hexLab(hex)).map((c) => Math.min(1, Math.max(0, c))) as unknown as readonly [number, number, number];

const J: CtaPlacement = { id: 0, x: 0.6, y: 0.6 };
const C: CtaPlacement = { id: 1, x: 0.6, y: -0.6 };
const R: CtaPlacement = { id: 2, x: -0.6, y: -0.6 };
const N: CtaPlacement = { id: 3, x: 0.05, y: 0.05 };

const store = (m: CtaMachine, taps: number, t: number, mode: 'settle' | 'reduced' = 'settle', paint = DARK) => ctaReduce(m, { kind: 'store', taps }, t, mode, paint);
const start = (m: CtaMachine, live: readonly CtaPlacement[], t: number, mode: 'settle' | 'reduced' = 'settle', paint = DARK) => ctaReduce(m, { kind: 'start', live }, t, mode, paint);
/** A CTA shown at t = 0 from one tap J, settled by `SETTLE`. */
const shownJ = () => start(store(ctaInitial(DARK, [], 0, 0), 1, 0), [J], 0);

describe('the CTA’s colours (DSN-018, DSN-019)', () => {
  it('a quadrant’s tint is its anchor at the face’s tier with the onTint label; the neutral fill is text.primary with the onInk label', () => {
    const quadrants = { J: 'joy', C: 'calm', R: 'reflective', I: 'intense' } as const;
    for (const paint of [DARK, LIGHT]) {
      const c = ABYSS.color[paint.face];
      for (const [node, anchor] of Object.entries(quadrants)) {
        const colours = ctaColours(paint, node as keyof typeof quadrants);
        expect(colours.fillHex).toBe(BASE.emotion[anchor][tierOf(paint.face)].hex);
        expect(colours.label).toBe(c.text.onTint.hex);
      }
      expect(ctaColours(paint, 'neutral').fillHex).toBe(c.text.primary.hex);
      expect(ctaColours(paint, 'neutral').label).toBe(c.text.onInk.hex);
    }
    expect(CTA_NODES).toEqual(['J', 'C', 'R', 'I', 'neutral']);
  });

  it('the keyline is 0 in Abyss: its ground is inside the window, so the CTA has no keyline (DSN-019)', () => {
    expect(ABYSS.cta.keyline).toBe(0);
  });

  // Never red over every transition the CTA can make (route R2, mixSafe), and the label legible along each
  // (F10 watch item 7: white on light joy deep, about 4.7:1 by arithmetic; the device capture is the evidence).
  it('never red, and its label at least 4.5:1, on every settled tint and every mixSafe step between any two, both faces', () => {
    let checked = 0;
    let lowest = Infinity;
    for (const paint of [DARK, LIGHT]) {
      for (const from of CTA_NODES) {
        for (const to of CTA_NODES) {
          const a = ctaColours(paint, from);
          const b = ctaColours(paint, to);
          for (let i = 0; i <= 100; i++) {
            const lab = mixSafe(a.fill, b.fill, i / 100, DESIGN);
            const hex = srgbHex(lab);
            expect(isRed(lab, DESIGN)).toBe(false);
            expect(isRed(hexLab(hex), CHECK)).toBe(false);
            const ratio = contrastRatio(srgb(hex), srgb(b.label));
            lowest = Math.min(lowest, ratio);
            expect(ratio).toBeGreaterThanOrEqual(4.5);
            checked++;
          }
        }
      }
    }
    expect(checked).toBe(2 * 25 * 101);
    expect(lowest).toBeLessThan(5);
  });
});

describe('ctaState: hidden until an admitted start', () => {
  it('starts hidden: no opacity, no tint, not pressable, not exposed, nothing to animate', () => {
    expect(ctaState(ctaInitial(DARK, [], 0, 0), 0, DARK)).toEqual({ opacity: 0, tint: null, pressable: false, accessible: false, phase: 'hidden', animating: false });
  });

  it('a tap in the store shows nothing by itself: the show waits for the field’s admitted start', () => {
    const m = store(ctaInitial(DARK, [], 0, 0), 1, 10);
    for (const t of [10, 300, 5000]) expect(ctaState(m, t, DARK)).toMatchObject({ opacity: 0, pressable: false, accessible: false, phase: 'hidden' });
  });

  it('an admitted start whose target holds a live tap shows it on that crossfade’s ramp (incoming u), from 0', () => {
    const m = start(store(ctaInitial(DARK, [], 0, 0), 1, 0), [J], 100);
    for (const t of [100, 150, 250, 400, 699]) expect(ctaState(m, t, DARK).opacity).toBeCloseTo(progress('settle', t - 100), 12);
    expect(ctaState(m, 100 + SETTLE, DARK)).toMatchObject({ opacity: 1, phase: 'shown', animating: false });
    expect(ctaState(m, 300, DARK)).toMatchObject({ phase: 'showing', animating: true });
  });

  it('“shown” runs from the start of the show ramp: a CTA fading in may be pressed (the designer’s clause)', () => {
    const m = start(store(ctaInitial(DARK, [], 0, 0), 1, 0), [J], 100);
    const at = ctaState(m, 100, DARK);
    expect(at.opacity).toBe(0);
    expect(at).toMatchObject({ pressable: true, accessible: true, phase: 'showing' });
  });

  it('under reduced motion the show is motion.fadeReduced, linear', () => {
    const m = start(store(ctaInitial(DARK, [], 0, 0), 1, 0, 'reduced'), [J], 0, 'reduced');
    for (const t of [0, 30, 75, 120]) expect(ctaState(m, t, DARK).opacity).toBeCloseTo(t / REDUCED, 12);
    expect(ctaState(m, REDUCED, DARK).opacity).toBe(1);
  });

  it('a start whose target holds no live tap shows nothing and leaves the tint alone', () => {
    const m = start(store(ctaInitial(DARK, [], 0, 0), 1, 0), [], 100);
    expect(ctaState(m, 1000, DARK)).toMatchObject({ opacity: 0, tint: null, phase: 'hidden' });
  });
});

describe('ctaState: the tint, only at admitted starts', () => {
  it('the first show takes the latest admitted live placement’s tint at once, with no transition', () => {
    // The latest is the newest by the ledger's id, in whatever order the target lists them.
    const newest = { ...J, id: 7 };
    const m = start(store(ctaInitial(DARK, [], 0, 0), 2, 0), [newest, C], 0);
    const view = ctaState(m, 0, DARK);
    expect(view.tint).toMatchObject({ fill: ctaColours(DARK, 'J').fillHex, label: ctaColours(DARK, 'J').label, owner: 7 });
  });

  it('a later start with a new latest live placement changes it through mixSafe on that ramp, and lands on the token', () => {
    const later = start(store(shownJ(), 2, 1000), [J, R], 1000);
    const from = ctaColours(DARK, 'J').fill;
    const to = ctaColours(DARK, 'R').fill;
    for (const t of [1000, 1100, 1300, 1599]) {
      expect(ctaState(later, t, DARK).tint!.fill).toBe(srgbHex(mixSafe(from, to, progress('settle', t - 1000), DESIGN)));
    }
    expect(ctaState(later, 1000 + SETTLE, DARK).tint).toMatchObject({ fill: ctaColours(DARK, 'R').fillHex, owner: R.id });
    expect(ctaState(later, 1300, DARK).animating).toBe(true);
    expect(ctaState(later, 1000 + SETTLE, DARK).animating).toBe(false);
  });

  it('under reduced motion the tint changes linearly over motion.fadeReduced', () => {
    const shown = start(store(ctaInitial(DARK, [], 0, 0), 1, 0, 'reduced'), [J], 0, 'reduced');
    const later = start(store(shown, 2, 1000, 'reduced'), [J, C], 1000, 'reduced');
    const from = ctaColours(DARK, 'J').fill;
    const to = ctaColours(DARK, 'C').fill;
    expect(ctaState(later, 1075, DARK).tint!.fill).toBe(srgbHex(mixSafe(from, to, 0.5, DESIGN)));
    expect(ctaState(later, 1000 + REDUCED, DARK).tint!.fill).toBe(ctaColours(DARK, 'C').fillHex);
  });

  it('a store change never moves the tint: an undo keeps the tint until the next start takes the placement left', () => {
    const two = start(store(shownJ(), 2, 1000), [J, R], 1000);
    const undone = store(two, 1, 2000);
    expect(ctaState(undone, 2300, DARK).tint).toMatchObject({ fill: ctaColours(DARK, 'R').fillHex, owner: R.id });
    const taken = start(undone, [J], 2400);
    expect(ctaState(taken, 2400 + SETTLE, DARK).tint).toMatchObject({ fill: ctaColours(DARK, 'J').fillHex, owner: J.id });
  });

  it('the same tint again starts no transition', () => {
    const again = start(shownJ(), [{ id: 9, x: 0.7, y: 0.2 }], 1000);
    expect(ctaState(again, 1100, DARK)).toMatchObject({ animating: false });
    expect(ctaState(again, 1100, DARK).tint).toMatchObject({ fill: ctaColours(DARK, 'J').fillHex, owner: 9 });
  });

  it('a neutral placement tints it with the neutral fill', () => {
    const m = start(store(ctaInitial(DARK, [], 0, 0), 1, 0), [N], 0);
    expect(ctaState(m, SETTLE, DARK).tint).toMatchObject({ fill: ctaColours(DARK, 'neutral').fillHex, label: ctaColours(DARK, 'neutral').label });
  });

  it('a face change repaints at once in the new face: a tint never mixes across faces', () => {
    const later = start(store(shownJ(), 2, 1000), [J, R], 1000);
    expect(ctaState(later, 1300, LIGHT).tint!.fill).toBe(ctaColours(LIGHT, 'R').fillHex);
    expect(ctaState(shownJ(), SETTLE, LIGHT).tint!.fill).toBe(ctaColours(LIGHT, 'J').fillHex);
  });
});

describe('ctaState: the hide, at once, latched', () => {
  const hideOver = (t: number, mode: 'settle' | 'reduced') => (mode === 'reduced' ? rampProgress(t, REDUCED, null) : rampProgress(t, RESPOND.duration, RESPOND.easing));

  it('the store’s last tap removed: it hides at once from where it is, over motion.respond, and is never pressable while it hides', () => {
    const shown = shownJ();
    const hidden = store(shown, 0, 300);
    const from = ctaState(shown, 300, DARK).opacity;
    expect(from).toBeGreaterThan(0.5);
    expect(from).toBeLessThan(1);
    for (const t of [300, 350, 450, 600]) expect(ctaState(hidden, t, DARK).opacity).toBeCloseTo(from * (1 - hideOver(t - 300, 'settle')), 12);
    expect(ctaState(hidden, 320, DARK)).toMatchObject({ pressable: false, accessible: false, phase: 'hiding', animating: true });
    expect(ctaState(hidden, 300 + RESPOND.duration, DARK)).toMatchObject({ opacity: 0, phase: 'hidden', animating: false });
  });

  it('under reduced motion the hide is motion.fadeReduced, linear', () => {
    const shown = start(store(ctaInitial(DARK, [], 0, 0), 1, 0, 'reduced'), [J], 0, 'reduced');
    const hidden = store(shown, 0, 500, 'reduced');
    expect(ctaState(hidden, 575, DARK).opacity).toBeCloseTo(0.5, 12);
    expect(ctaState(hidden, 500 + REDUCED, DARK).opacity).toBe(0);
  });

  it('a hide latches: a new tap raises nothing until the next admitted start, which shows it from where it is', () => {
    const hidden = store(store(shownJ(), 0, 1000), 1, 1100);
    for (let t = 1000; t < 1500; t += 10) {
      expect(ctaState(hidden, t + 10, DARK).opacity).toBeLessThanOrEqual(ctaState(hidden, t, DARK).opacity);
      expect(ctaState(hidden, t, DARK).pressable).toBe(false);
    }
    const before = ctaState(hidden, 1150, DARK).opacity;
    const back = start(hidden, [{ id: 5, x: -0.6, y: -0.6 }], 1150);
    expect(ctaState(back, 1150, DARK).opacity).toBeCloseTo(before, 12);
    expect(ctaState(back, 1150 + SETTLE, DARK).opacity).toBe(1);
    expect(ctaState(back, 1150, DARK)).toMatchObject({ pressable: true, phase: 'showing' });
  });

  it('a hide needs a prior show: emptying a hidden CTA’s store changes nothing', () => {
    const m = store(store(ctaInitial(DARK, [], 0, 0), 1, 0), 0, 50);
    expect(ctaState(m, 60, DARK)).toMatchObject({ opacity: 0, phase: 'hidden', animating: false });
  });

  it('a store that still holds a tap after an undo keeps the CTA shown and pressable', () => {
    const two = start(store(shownJ(), 2, 1000), [J, R], 1000);
    const one = store(two, 1, 2000);
    expect(ctaState(one, 2100, DARK)).toMatchObject({ opacity: 1, pressable: true, phase: 'shown' });
  });
});

describe('ctaState: a mount with taps already shown', () => {
  it('the field shows a fresh mount’s taps at once (the ledger’s reset), so the CTA is shown at once, settled', () => {
    const m = ctaInitial(DARK, [C, { ...J, id: 4 }], 2, 0);
    expect(ctaState(m, 0, DARK)).toMatchObject({ opacity: 1, pressable: true, accessible: true, phase: 'shown', animating: false });
    expect(ctaState(m, 0, DARK).tint).toMatchObject({ fill: ctaColours(DARK, 'J').fillHex, owner: 4 });
  });

  it('with no tap in the store it stays hidden, whatever the field shows', () => {
    expect(ctaState(ctaInitial(DARK, [J], 0, 0), 0, DARK).phase).toBe('hidden');
  });
});
