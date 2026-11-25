import { BASE, DIRECTIONS } from '../../../tokens/tokens.generated.ts';
import { plateGeometry, pointToLocal } from '../../Plate/geometry.ts';
import { HAPTIC_GAP, hapticAllowed, hapticFor, stepCell, touchIntent, touchSurface } from '../plateTouchModel.ts';

// PlateTouch's pure model: the touch surface's size, what a touch means, which haptic it earns and when, and
// how the adjustable steps. Everything is in the plate box's dp (x right, y down), the coordinate space of
// the plate's shared geometry (Plate/geometry.ts).

const TOKENS = { base: BASE, direction: DIRECTIONS.abyss };
const PLATE = plateGeometry(TOKENS, 296, 1);
const SURFACE = touchSurface(TOKENS, PLATE);
const R = PLATE.radius;

describe('touchSurface: the plate grown until the latest bead’s target fits inside it', () => {
  it('the target is bead.hitTarget, at least target.min (QA-028); the margin is what a rim bead’s target reaches past the plate', () => {
    expect(SURFACE.hit).toBe(BASE.bead.hitTarget);
    expect(SURFACE.hit).toBeGreaterThanOrEqual(BASE.target.min);
    expect(SURFACE.margin).toBe(BASE.bead.hitTarget / 2 - PLATE.beadRadius);
    expect(SURFACE.size).toBe(PLATE.diameter + 2 * SURFACE.margin);
    expect(SURFACE.reach).toBe(R + SURFACE.margin);
  });

  it('a bead anywhere on the rim keeps its whole target inside the surface', () => {
    for (let k = 0; k < 360; k += 5) {
      const a = (k * Math.PI) / 180;
      const c = pointToLocal({ x: Math.cos(a), y: Math.sin(a) }, PLATE);
      for (const v of [c.x - SURFACE.hit / 2, c.x + SURFACE.hit / 2, c.y - SURFACE.hit / 2, c.y + SURFACE.hit / 2]) {
        expect(v).toBeGreaterThanOrEqual(-SURFACE.margin - 1e-9);
        expect(v).toBeLessThanOrEqual(PLATE.diameter + SURFACE.margin + 1e-9);
      }
    }
  });

  it('holds at every plate size the plate law allows, and at font scale 2.0 (the band does not move the beads)', () => {
    for (const d of [BASE.plate.minDiameter, BASE.plate.maxDiameter]) {
      for (const fontScale of [1, 2]) {
        const plate = plateGeometry(TOKENS, d, fontScale);
        const s = touchSurface(TOKENS, plate);
        expect(s.size).toBe(d + 2 * s.margin);
        expect(s.hit).toBe(BASE.bead.hitTarget);
      }
    }
  });
});

describe('touchIntent: what a touch means', () => {
  const centre = { x: R, y: R };
  const latest = { x: 0.6, y: 0.6 };
  const older = { x: -0.6, y: -0.6 };
  const onLatest = pointToLocal(latest, PLATE);
  const onOlder = pointToLocal(older, PLATE);

  it('a touch that ends on the plate places at its end, wherever it began (a tap, or a drag to the spot)', () => {
    expect(touchIntent(centre, centre, PLATE, SURFACE, null)).toEqual({ kind: 'place', at: centre });
    const end = { x: R + 40, y: R - 70 };
    expect(touchIntent(centre, end, PLATE, SURFACE, null)).toEqual({ kind: 'place', at: end });
  });

  it('the plate reaches the surface’s inscribed circle (R plus the margin), and no further: a corner of the surface places nothing', () => {
    const edge = { x: R + SURFACE.reach, y: R };
    expect(touchIntent(edge, edge, PLATE, SURFACE, null).kind).toBe('place');
    const beyond = { x: R + SURFACE.reach + 0.01, y: R };
    expect(touchIntent(beyond, beyond, PLATE, SURFACE, null)).toEqual({ kind: 'none' });
    const corner = { x: -SURFACE.margin, y: -SURFACE.margin };
    expect(touchIntent(corner, corner, PLATE, SURFACE, null)).toEqual({ kind: 'none' });
  });

  it('a tap on the latest bead’s target (it begins and ends there) removes it: only the latest is removable (DSN-012)', () => {
    expect(touchIntent(onLatest, onLatest, PLATE, SURFACE, latest)).toEqual({ kind: 'remove' });
    const half = SURFACE.hit / 2;
    const corner = { x: onLatest.x + half, y: onLatest.y - half };
    expect(touchIntent(corner, corner, PLATE, SURFACE, latest)).toEqual({ kind: 'remove' });
    const outside = { x: onLatest.x + half + 0.01, y: onLatest.y };
    expect(touchIntent(outside, outside, PLATE, SURFACE, latest).kind).toBe('place');
    expect(touchIntent(onOlder, onOlder, PLATE, SURFACE, latest)).toEqual({ kind: 'place', at: onOlder });
  });

  it('a drag that leaves the latest bead places at its end; a drag onto it from elsewhere places there too', () => {
    const away = { x: R, y: R };
    expect(touchIntent(onLatest, away, PLATE, SURFACE, latest)).toEqual({ kind: 'place', at: away });
    expect(touchIntent(away, onLatest, PLATE, SURFACE, latest)).toEqual({ kind: 'place', at: onLatest });
  });

  it('the latest bead’s target counts even where it reaches past the plate’s inscribed circle', () => {
    const rim = { x: 1, y: 0 };
    const c = pointToLocal(rim, PLATE);
    const out = { x: c.x + SURFACE.hit / 2, y: c.y };
    expect(Math.hypot(out.x - R, out.y - R)).toBeGreaterThan(R);
    expect(touchIntent(out, out, PLATE, SURFACE, rim)).toEqual({ kind: 'remove' });
  });

  it('a non-finite touch means nothing (never a phantom placement)', () => {
    const bad = { x: NaN, y: R };
    expect(touchIntent(bad, bad, PLATE, SURFACE, null)).toEqual({ kind: 'none' });
    expect(touchIntent(centre, { x: R, y: Infinity }, PLATE, SURFACE, latest)).toEqual({ kind: 'none' });
  });
});

describe('the haptic a touch earns (L12; the Abyss tokens through the F8 port)', () => {
  it('place below three taps, replace at three (the oldest goes), remove for the latest; nothing for no intent', () => {
    expect(hapticFor({ kind: 'place', at: { x: 0, y: 0 } }, 0)).toBe('place');
    expect(hapticFor({ kind: 'place', at: { x: 0, y: 0 } }, 2)).toBe('place');
    expect(hapticFor({ kind: 'place', at: { x: 0, y: 0 } }, 3)).toBe('replace');
    expect(hapticFor({ kind: 'remove' }, 1)).toBe('remove');
    expect(hapticFor({ kind: 'none' }, 2)).toBeNull();
  });

  it('events stay haptics.minEventGap apart: a haptic inside the gap is dropped, never queued', () => {
    expect(HAPTIC_GAP).toBe(BASE.haptics.minEventGap);
    expect(hapticAllowed(null, 0)).toBe(true);
    expect(hapticAllowed(1000, 1000 + HAPTIC_GAP - 1)).toBe(false);
    expect(hapticAllowed(1000, 1000 + HAPTIC_GAP)).toBe(true);
    expect(hapticAllowed(1000, 900)).toBe(false);
  });
});

describe('stepCell: the adjustable’s cursor over the cells', () => {
  it('increments and decrements by one, and stops at either end (an adjustable never wraps)', () => {
    expect(stepCell(0, 1, 9)).toBe(1);
    expect(stepCell(8, 1, 9)).toBe(8);
    expect(stepCell(0, -1, 9)).toBe(0);
    expect(stepCell(4, -1, 9)).toBe(3);
  });

  it('reads a cursor that no longer fits the cells as the last cell, and an empty list as 0', () => {
    expect(stepCell(12, 0, 9)).toBe(8);
    expect(stepCell(3, 1, 0)).toBe(0);
  });
});
