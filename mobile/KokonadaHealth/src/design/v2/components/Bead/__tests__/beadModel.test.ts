import { Easing } from 'react-native';
import { mixOklab, srgbToOklab, type Oklab } from '../../../color/oklab.ts';
import { isRed, type RedBand } from '../../../color/redBand.ts';
import { buildFieldFrame, type FieldStatics } from '../../../field/fieldFrame.ts';
import { BASE, DIRECTIONS, type Face } from '../../../tokens/tokens.generated.ts';
import {
  alphaHex,
  beadCentre,
  beadEntrance,
  beadExit,
  beadFill,
  beadGeometry,
  beadHighlight,
  beadMotion,
  beadPaint,
  hexLab,
  readPoint,
  srgbHex,
} from '../beadModel.ts';

// The bead's pure model: where it sits, what colour it is (DSN-017), and how it moves (motion.placement,
// the still tier's ramp). The bead is drawn over the field, so it must sit exactly on its halo, which the
// field builder places (fieldFrame.ts): the position test reads the builder's own bead centre.

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

describe('readPoint: a tap as the field builder reads it', () => {
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

describe('beadGeometry and beadCentre: the bead on the plate, LTR, y down', () => {
  it('the plate radius is half the diameter; the bead radius and the wheel radius come from the tokens', () => {
    const g = beadGeometry('abyss', 296);
    expect(g.radius).toBe(148);
    expect(g.bead).toBe(ABYSS.bead.diameter / 2);
    expect(g.wheel).toBe(148 - ABYSS.bead.diameter / 2);
    expect(g.setting).toBe(ABYSS.bead.setting.width);
  });

  it('the centre point sits at the plate centre; the rim points sit one bead radius inside the plate edge', () => {
    const g = beadGeometry('abyss', 300);
    expect(beadCentre({ x: 0, y: 0 }, g)).toEqual({ x: 150, y: 150 });
    expect(beadCentre({ x: 1, y: 0 }, g)).toEqual({ x: 300 - ABYSS.bead.diameter / 2, y: 150 });
    expect(beadCentre({ x: 0, y: 1 }, g)).toEqual({ x: 150, y: ABYSS.bead.diameter / 2 });
    expect(beadCentre({ x: -1, y: 0 }, g)).toEqual({ x: ABYSS.bead.diameter / 2, y: 150 });
    expect(beadCentre({ x: 0, y: -1 }, g)).toEqual({ x: 150, y: 300 - ABYSS.bead.diameter / 2 });
  });

  // The field draws the halo around the bead centre it computes; a bead drawn anywhere else floats off its halo.
  it('equals the field builder’s own bead centre, for every tap and plate size', () => {
    const statics: FieldStatics = {
      restLobes: { dark: [], light: [] },
      drift: { harmonics: [[1, 1]], phases: [[0, 0]] },
      fallbackStops: { position: [0, 1], weight: [1, 0] },
    };
    const taps = [{ x: 0.566, y: 0.566 }, { x: -0.3, y: -0.8 }, { x: 0.05, y: 0.02 }, { x: 2, y: -2 }, { x: -1, y: 0 }];
    for (const diameter of [264, 296, 340]) {
      const g = beadGeometry('abyss', diameter);
      for (const tap of taps) {
        const frame = buildFieldFrame(
          { direction: 'abyss', face: 'dark', placements: [{ x: tap.x, y: tap.y, fade: 1 }], stress: 0, confidence: null, genesis: false, tMs: 0, breathPhase: 0, tier: 'still', restFade: 0 },
          { centrePx: [0, 0], radiusPx: diameter / 2, pxPerDp: 1, fontScale: 1 },
          statics,
        );
        const node = frame.nodes.find((n) => n.bead !== null)!;
        const R = diameter / 2;
        const c = beadCentre(tap, g);
        expect(c.x).toBeCloseTo(R + R * node.bead![0], 9);
        expect(c.y).toBeCloseTo(R - R * node.bead![1], 9);
      }
    }
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

describe('the bead’s motion (motion.placement; the still tier’s ramp)', () => {
  const settle = BASE.motion.settle;
  const ease = Easing.bezier(settle.easing[0], settle.easing[1], settle.easing[2], settle.easing[3]);

  it('beadMotion names the entrance: the placement easing token’s duration and curve, from scaleFrom', () => {
    const m = beadMotion('abyss', 'full');
    expect(ABYSS.motion.placement.easing).toBe('motion.settle');
    expect(m).toEqual({ duration: settle.duration, easing: settle.easing, scaleFrom: ABYSS.motion.placement.scaleFrom, peak: 1, overshootScale: 1, linear: false });
  });

  it('enters from scaleFrom and 0 to 1 and 1 over the token, on its curve: opacity e, scale scaleFrom + (1 − scaleFrom)·e', () => {
    const from = ABYSS.motion.placement.scaleFrom;
    expect(beadEntrance('abyss', 'full', 0)).toEqual({ opacity: 0, scale: from });
    expect(beadEntrance('abyss', 'full', settle.duration)).toEqual({ opacity: 1, scale: 1 });
    expect(beadEntrance('abyss', 'full', 10 * settle.duration)).toEqual({ opacity: 1, scale: 1 });
    for (const t of [30, 100, 150, 300, 450, 599]) {
      const e = ease(t / settle.duration);
      const look = beadEntrance('abyss', 'full', t);
      expect(look.opacity).toBeCloseTo(e, 12);
      expect(look.scale).toBeCloseTo(from + (1 - from) * e, 12);
    }
  });

  it('never moves backwards, and never leaves [scaleFrom, 1] or [0, 1] (settle does not overshoot)', () => {
    let last = beadEntrance('abyss', 'full', 0);
    for (let t = 1; t <= settle.duration; t++) {
      const look = beadEntrance('abyss', 'full', t);
      expect(look.opacity).toBeGreaterThanOrEqual(last.opacity);
      expect(look.scale).toBeGreaterThanOrEqual(last.scale);
      expect(look.opacity).toBeLessThanOrEqual(1);
      expect(look.scale).toBeLessThanOrEqual(1);
      last = look;
    }
  });

  it('battery saver (tier low) moves the bead exactly as tier full: only the field drops a tier', () => {
    for (const t of [0, 50, 200, 600]) expect(beadEntrance('abyss', 'low', t)).toEqual(beadEntrance('abyss', 'full', t));
    expect(beadMotion('abyss', 'low')).toEqual(beadMotion('abyss', 'full'));
  });

  it('reduced motion (tier still): a linear fade over motion.fadeReduced, and no scale at any moment', () => {
    const reduced = BASE.motion.fadeReduced.duration;
    expect(beadMotion('abyss', 'still')).toEqual({ duration: reduced, easing: null, scaleFrom: 1, peak: 1, overshootScale: 1, linear: true });
    for (const t of [0, 15, 75, 149, 150, 1000]) {
      const look = beadEntrance('abyss', 'still', t);
      expect(look.scale).toBe(1);
      expect(look.opacity).toBeCloseTo(Math.min(1, t / reduced), 12);
    }
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

  it('exits from where it is, linearly to 0 over the entrance’s duration, its scale held', () => {
    const from = { opacity: 0.7, scale: 0.9 };
    expect(beadExit('abyss', 'full', from, 0)).toEqual(from);
    expect(beadExit('abyss', 'full', from, settle.duration / 2)).toEqual({ opacity: 0.35, scale: 0.9 });
    expect(beadExit('abyss', 'full', from, settle.duration)).toEqual({ opacity: 0, scale: 0.9 });
    expect(beadExit('abyss', 'still', { opacity: 1, scale: 1 }, BASE.motion.fadeReduced.duration / 2)).toEqual({ opacity: 0.5, scale: 1 });
    expect(beadExit('abyss', 'still', { opacity: 1, scale: 1 }, 10_000)).toEqual({ opacity: 0, scale: 1 });
  });
});
