import { Easing } from 'react-native';
import { mixOklab, srgbToOklab, type Oklab } from '../../../color/oklab.ts';
import { isRed, type RedBand } from '../../../color/redBand.ts';
import { BASE, DIRECTIONS, type Face } from '../../../tokens/tokens.generated.ts';
import { alphaHex, BEAD_WHOLE, beadEntrance, beadExit, beadFill, beadHighlight, beadMotion, beadPaint, beadTwin, beadTwinPaint, greyHex, hexLab, readPoint, srgbHex } from '../beadModel.ts';
import { entranceColour, entranceOpacity, exitColour, exitDuration, exitOpacity } from '../beadTimeline.ts';

// The bead's pure model: what colour it is (DSN-017) and how it moves (motion.placement, the still tier's
// ramp). Where it sits is the plate's shared geometry (Plate/geometry.ts pointToLocal), which its own test
// holds to the field builder's bead centre; Bead.test.tsx holds the drawn bead to pointToLocal.

const ABYSS = DIRECTIONS.abyss;
const FACES: readonly Face[] = ['dark', 'light'];
const band = (b: { hueStart: number; hueEnd: number; chromaFloor: number }): RedBand => ({ hueFrom: b.hueStart, hueTo: b.hueEnd, chromaFloor: b.chromaFloor });
const CHECK = band(BASE.neverRed.check);
const DESIGN = band(BASE.neverRed.design);
const lab = (c: { readonly oklab: readonly number[] }): Oklab => ({ L: c.oklab[0], a: c.oklab[1], b: c.oklab[2] });
const tierOf = (face: Face) => (face === 'dark' ? 'core' : 'deep');
const close = (a: Oklab, b: Oklab, eps = 1e-12) => {
  expect(Math.abs(a.L - b.L)).toBeLessThanOrEqual(eps + 1e-10);
  expect(Math.abs(a.a - b.a)).toBeLessThanOrEqual(eps + 1e-10);
  expect(Math.abs(a.b - b.b)).toBeLessThanOrEqual(eps + 1e-10);
};

describe('readPoint: a tap as the field builder reads it, for its node and ramp', () => {
  it('keeps a point on the disc', () => {
    expect(readPoint({ x: 0.3, y: -0.4 })).toEqual({ x: 0.3, y: -0.4 });
    expect(readPoint({ x: 1, y: 0 })).toEqual({ x: 1, y: 0 });
  });
  it('moves a point outside the disc onto its rim, along its own ray', () => {
    const p = readPoint({ x: 3, y: 4 });
    expect(p.x).toBeCloseTo(0.6, 12);
    expect(p.y).toBeCloseTo(0.8, 12);
  });
  it('reads a non-finite coordinate as 0, each on its own (fieldFrame finite(…, 0))', () => {
    expect(readPoint({ x: NaN, y: 0.5 })).toEqual({ x: 0, y: 0.5 });
    expect(readPoint({ x: 0.25, y: Infinity })).toEqual({ x: 0.25, y: 0 });
    expect(readPoint({ x: -Infinity, y: NaN })).toEqual({ x: 0, y: 0 });
  });
});

describe('beadFill (DSN-017) and its highlight', () => {
  it('inside placement.neutralRadius the bead is the face’s neutral bead, exactly', () => {
    for (const face of FACES) {
      expect(srgbHex(beadFill('abyss', face, { x: 0.05, y: 0.05 }))).toBe(ABYSS.color[face].bead.neutral.hex);
      expect(srgbHex(beadFill('abyss', face, { x: 0, y: 0 }))).toBe(ABYSS.color[face].bead.neutral.hex);
    }
  });

  it('from placement.rampEnd out it is the quadrant’s anchor at the face’s tier, by sign (x pleasant, y energy)', () => {
    const cases = [
      [{ x: 0.6, y: 0.6 }, 'joy'],
      [{ x: 0.6, y: -0.6 }, 'calm'],
      [{ x: -0.6, y: -0.6 }, 'reflective'],
      [{ x: -0.6, y: 0.6 }, 'intense'],
      [{ x: 1, y: 0 }, 'joy'],
      [{ x: 0, y: -1 }, 'calm'],
    ] as const;
    for (const face of FACES) {
      for (const [point, anchor] of cases) {
        close(beadFill('abyss', face, point), lab(BASE.emotion[anchor][tierOf(face)]));
      }
    }
  });

  it('between them the lightness runs from the neutral bead’s to the anchor’s and the chroma from 0, both with p', () => {
    for (const face of FACES) {
      const Ln = ABYSS.color[face].bead.neutral.oklab[0];
      const anchor = lab(BASE.emotion.calm[tierOf(face)]);
      for (const r of [0.2, 0.3, 0.375, 0.5, 0.59]) {
        const p = (r - BASE.placement.neutralRadius) / (BASE.placement.rampEnd - BASE.placement.neutralRadius);
        const fill = beadFill('abyss', face, { x: r * Math.SQRT1_2, y: -r * Math.SQRT1_2 });
        close(fill, { L: Ln + (anchor.L - Ln) * p, a: anchor.a * p * ABYSS.bead.chromaScale, b: anchor.b * p * ABYSS.bead.chromaScale });
      }
    }
  });

  it('is continuous across the neutral radius: just outside it the bead is the neutral bead', () => {
    for (const face of FACES) {
      const just = beadFill('abyss', face, { x: BASE.placement.neutralRadius + 1e-9, y: 0 });
      close(just, lab(ABYSS.color[face].bead.neutral), 1e-8);
    }
  });

  it('the highlight is the fill mixed toward white by bead.highlight.mix', () => {
    const fill = beadFill('abyss', 'dark', { x: 0.7, y: 0.1 });
    expect(beadHighlight('abyss', fill)).toEqual(mixOklab(fill, { L: 1, a: 0, b: 0 }, ABYSS.bead.highlight.mix));
  });
});

describe('beadPaint: the colours the views draw', () => {
  it('the fill and highlight are #RRGGBB of the 8-bit sRGB encode; the setting is the token; the shadow is the token at its alpha', () => {
    for (const face of FACES) {
      const point = { x: -0.4, y: 0.5 };
      const paint = beadPaint('abyss', face, point);
      expect(paint.fill).toBe(srgbHex(beadFill('abyss', face, point)));
      expect(paint.highlight).toBe(srgbHex(beadHighlight('abyss', beadFill('abyss', face, point))));
      expect(paint.setting).toBe(ABYSS.color[face].bead.setting.hex);
      expect(paint.shadow).toBe(alphaHex(ABYSS.color[face].bead.shadow.hex, ABYSS.color[face].bead.shadow.alpha));
      expect(paint.fill).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it('alphaHex appends the alpha as a byte, and refuses a colour that is not #RRGGBB or an alpha outside [0, 1]', () => {
    expect(alphaHex(ABYSS.color.dark.bead.shadow.hex, 0.6)).toBe(ABYSS.color.dark.bead.shadow.hex.toUpperCase() + '99');
    expect(alphaHex(ABYSS.color.dark.ground.hex, 1)).toBe(ABYSS.color.dark.ground.hex.toUpperCase() + 'FF');
    expect(alphaHex(ABYSS.color.dark.ground.hex, 0)).toBe(ABYSS.color.dark.ground.hex.toUpperCase() + '00');
    expect(() => alphaHex(ABYSS.color.dark.ground.hex.slice(0, 4), 0.5)).toThrow(RangeError);
    expect(() => alphaHex(ABYSS.color.dark.ground.hex, 1.5)).toThrow(RangeError);
    expect(() => alphaHex(ABYSS.color.dark.ground.hex, NaN)).toThrow(RangeError);
  });

  it('srgbHex encodes clamped and rounded, and hexLab reads a token’s hex back to OKLab', () => {
    expect(srgbHex({ L: 1, a: 0, b: 0 })).toBe('#' + 'FF'.repeat(3));
    expect(srgbHex({ L: 0, a: 0, b: 0 })).toBe('#' + '00'.repeat(3));
    expect(srgbHex({ L: 2, a: 0, b: 0 })).toBe('#' + 'FF'.repeat(3));
    close(hexLab(srgbHex(lab(BASE.emotion.joy.core))), srgbToOklab([0xe3 / 255, 0xb6 / 255, 0x67 / 255]), 1e-12);
  });

  // Never red (R4, DSN-013): the analytic fill against the design band, and the 8-bit pixel the view paints
  // against the check band, over a grid of the whole disc in both faces, for the fill and its highlight.
  it('never red: no fill or highlight, analytic or as painted, in either face', () => {
    let checked = 0;
    for (const face of FACES) {
      for (let i = -20; i <= 20; i++) {
        for (let j = -20; j <= 20; j++) {
          const point = { x: i / 20, y: j / 20 };
          if (Math.hypot(point.x, point.y) > 1) continue;
          const fill = beadFill('abyss', face, point);
          const highlight = beadHighlight('abyss', fill);
          const paint = beadPaint('abyss', face, point);
          expect(isRed(fill, DESIGN)).toBe(false);
          expect(isRed(highlight, DESIGN)).toBe(false);
          expect(isRed(hexLab(paint.fill), CHECK)).toBe(false);
          expect(isRed(hexLab(paint.highlight), CHECK)).toBe(false);
          checked++;
        }
      }
      expect(isRed(hexLab(beadPaint('abyss', face, { x: 0, y: 0 }).setting), CHECK)).toBe(false);
    }
    expect(checked).toBeGreaterThan(2000);
  });
});

describe('F1: the grey disc, the bead’s achromatic twin (below opacity 1 it is all that shows)', () => {
  it('the twin is the colour at its own OKLab L with chroma 0', () => {
    expect(beadTwin({ L: 0.71, a: 0.03, b: -0.08 })).toEqual({ L: 0.71, a: 0, b: 0 });
  });

  it('greyHex paints one 8-bit grey, the same byte on every channel, the byte srgbHex gives the achromatic colour', () => {
    for (let i = 0; i <= 100; i++) {
      const L = i / 100;
      const hex = greyHex(L);
      expect(hex).toMatch(/^#[0-9A-F]{6}$/);
      expect([hex.slice(1, 3), hex.slice(3, 5)]).toEqual([hex.slice(5, 7), hex.slice(5, 7)]);
      expect(hex.slice(3, 5)).toBe(srgbHex({ L, a: 0, b: 0 }).slice(3, 5));
    }
  });

  it('beadTwinPaint: the fill’s twin, and the highlight drawn from it (bead.highlight.mix toward white), in both faces', () => {
    for (const face of FACES) {
      for (const point of [{ x: -0.4, y: 0.5 }, { x: 0.6, y: 0.6 }, { x: 0.3, y: -0.2 }, { x: 0.02, y: 0 }]) {
        const twin = beadTwin(beadFill('abyss', face, point));
        const paint = beadTwinPaint('abyss', face, point);
        expect(paint.fill).toBe(greyHex(twin.L));
        expect(paint.highlight).toBe(greyHex(beadHighlight('abyss', twin).L));
        expect(beadHighlight('abyss', twin).L).toBeCloseTo(twin.L + ABYSS.bead.highlight.mix * (1 - twin.L), 12);
      }
    }
  });

  it('keeps the colour disc’s lightness: each grey reads back to its colour’s L within one 8-bit step, and has no chroma', () => {
    for (const face of FACES) {
      for (const point of [{ x: -0.6, y: 0.6 }, { x: 0.6, y: 0.6 }, { x: 0.6, y: -0.6 }, { x: -0.6, y: -0.6 }, { x: 0.3, y: 0.1 }]) {
        const colour = beadPaint('abyss', face, point);
        const grey = beadTwinPaint('abyss', face, point);
        for (const [c, g] of [[colour.fill, grey.fill], [colour.highlight, grey.highlight]]) {
          const read = hexLab(g);
          expect(Math.hypot(read.a, read.b)).toBeLessThan(1e-6);
          expect(Math.abs(read.L - hexLab(c).L)).toBeLessThan(0.01);
        }
      }
    }
  });
});

describe('the bead’s motion (F1: the opacity over motion.press, the colour over motion.respond; the scale per motion.placement)', () => {
  const settle = BASE.motion.settle;
  const ease = Easing.bezier(settle.easing[0], settle.easing[1], settle.easing[2], settle.easing[3]);
  const whole = { opacity: 1, colour: 1, scale: 1 };

  it('beadMotion names the scale’s entrance: the placement easing token’s duration and curve, from scaleFrom', () => {
    const m = beadMotion('abyss', 'full');
    expect(ABYSS.motion.placement.easing).toBe('motion.settle');
    expect(m).toEqual({ duration: settle.duration, easing: settle.easing, scaleFrom: ABYSS.motion.placement.scaleFrom, peak: 1, overshootScale: 1, linear: false });
  });

  it('enters with the timeline’s opacity and colour, the scale from scaleFrom to 1 on the placement curve', () => {
    const from = ABYSS.motion.placement.scaleFrom;
    expect(beadEntrance('abyss', 'full', 0)).toEqual({ opacity: 0, colour: 0, scale: from });
    expect(beadEntrance('abyss', 'full', settle.duration)).toEqual(whole);
    expect(beadEntrance('abyss', 'full', 10 * settle.duration)).toEqual(whole);
    expect(BEAD_WHOLE).toEqual(whole);
    for (const t of [30, 100, 150, 300, 450, 599]) {
      const look = beadEntrance('abyss', 'full', t);
      expect(look.opacity).toBe(entranceOpacity(t));
      expect(look.colour).toBe(entranceColour(t));
      expect(look.scale).toBeCloseTo(from + (1 - from) * ease(t / settle.duration), 12);
    }
  });

  it('never moves backwards, never leaves [scaleFrom, 1] or [0, 1], and carries no colour below opacity 1', () => {
    let last = beadEntrance('abyss', 'full', 0);
    for (let t = 1; t <= settle.duration; t++) {
      const look = beadEntrance('abyss', 'full', t);
      for (const k of ['opacity', 'colour', 'scale'] as const) {
        expect(look[k]).toBeGreaterThanOrEqual(last[k]);
        expect(look[k]).toBeLessThanOrEqual(1);
      }
      if (look.colour > 0) expect(look.opacity).toBe(1);
      last = look;
    }
  });

  it('battery saver (tier low) moves the bead exactly as tier full: only the field drops a tier', () => {
    for (const t of [0, 50, 200, 600]) expect(beadEntrance('abyss', 'low', t)).toEqual(beadEntrance('abyss', 'full', t));
    expect(beadMotion('abyss', 'low')).toEqual(beadMotion('abyss', 'full'));
  });

  it('reduced motion (tier still): one frame, opaque and in full colour, and no scale at any moment', () => {
    expect(beadMotion('abyss', 'still')).toEqual({ duration: 0, easing: null, scaleFrom: 1, peak: 1, overshootScale: 1, linear: true });
    for (const t of [0, 15, 75, 150, 1000]) expect(beadEntrance('abyss', 'still', t)).toEqual(whole);
  });

  // A planted direction whose placement eases on motion.pop: the overshoot appears, scaled to the token's
  // and by (1 − s), and the opacity never passes 1 (the board's formula, designer §C5).
  it('a planted pop easing overshoots the scale by (overshoot − 1)·(1 − s) at the curve’s peak; the opacity stays at most 1', () => {
    const pop = { scaleFrom: 0.6, overshoot: 1.12, easing: 'motion.pop' };
    const m = beadMotion('abyss', 'full', pop);
    expect(m.duration).toBe(BASE.motion.pop.duration);
    expect(m.peak).toBeGreaterThan(1);
    let maxScale = 0;
    for (let t = 0; t <= m.duration; t++) {
      const look = beadEntrance('abyss', 'full', t, 0, pop);
      expect(look.opacity).toBeLessThanOrEqual(1);
      maxScale = Math.max(maxScale, look.scale);
    }
    expect(maxScale).toBeGreaterThan(1.1);
    expect(maxScale).toBeLessThanOrEqual(1.12 + 1e-9);
    let calm = 0;
    for (let t = 0; t <= m.duration; t++) calm = Math.max(calm, beadEntrance('abyss', 'full', t, 1, pop).scale);
    expect(calm).toBeCloseTo(1, 12);
  });

  it('exits from where it is: the colour to 0 over press, then the opacity to 0 over respond, its scale held', () => {
    const opaque = { opacity: 1, colour: 0.7, scale: 0.9 };
    for (const t of [0, 40, 100, 250, exitDuration(1)]) {
      expect(beadExit('abyss', 'full', opaque, t)).toEqual({ opacity: exitOpacity(1, t), colour: exitColour(1, 0.7, t), scale: 0.9 });
    }
    expect(beadExit('abyss', 'full', opaque, exitDuration(1))).toEqual({ opacity: 0, colour: 0, scale: 0.9 });
    const caught = beadEntrance('abyss', 'full', 40);
    expect(caught.opacity).toBeLessThan(1);
    for (const t of [0, 100, 300]) expect(beadExit('abyss', 'low', caught, t)).toEqual({ opacity: exitOpacity(caught.opacity, t), colour: 0, scale: caught.scale });
  });

  it('under reduced motion the exit is one frame: gone at once, the scale held', () => {
    for (const t of [0, 10, 1000]) expect(beadExit('abyss', 'still', whole, t)).toEqual({ opacity: 0, colour: 0, scale: 1 });
  });
});
