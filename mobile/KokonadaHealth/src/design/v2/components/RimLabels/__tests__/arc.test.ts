import { EXTENSIONS } from '../../../tokens/tokens.extensions.generated.ts';
import { BASE, DIRECTIONS } from '../../../tokens/tokens.generated.ts';
import { plateGeometry, pointToLocal } from '../../Plate/geometry.ts';
import { RIM_POSITIONS, layRimWord, visualOrder, type PlacedGlyph, type RimPosition } from '../arc.ts';

// The rim words on the arc (DEC-036; V1 directions §1.5; DSN-027, DSN-028): shaped first, then laid on the ring's centre
// line, concave: the glyph tops point toward the rim at the top, the right and the left, and the bottom word is upright.
// Letters within the bead radius + 5 dp of a bead are knocked out. Pure: the advances and the font's metrics come in.

const T = { base: BASE, direction: DIRECTIONS.abyss };
const G = plateGeometry(T, 296, 1);
const FONT = { size: 14, ascent: -13, descent: 3.5 };
const ADV = [8, 7, 9, 8, 6, 8];
const KNOCKOUT = BASE.plate.labelBand.knockoutGap;
const PAD = 4;
const lay = (position: RimPosition, over: Partial<Parameters<typeof layRimWord>[0]> = {}) =>
  layRimWord({ position, advances: ADV, font: FONT, tracking: 0, geometry: G, beads: [], knockoutGap: KNOCKOUT, pad: PAD, ...over });

/** A glyph's cell corners (advance × ascent..descent), where its transform puts them. */
const corners = (g: PlacedGlyph) =>
  [[0, FONT.ascent], [g.advance, FONT.ascent], [0, FONT.descent], [g.advance, FONT.descent]].map(([x, y]) => [g.scos * x - g.ssin * y + g.tx, g.ssin * x + g.scos * y + g.ty]);
/** A glyph's cell centre and its baseline middle. */
const cellCentre = (g: PlacedGlyph) => {
  const [x, y] = [g.advance / 2, (FONT.ascent + FONT.descent) / 2];
  return [g.scos * x - g.ssin * y + g.tx, g.ssin * x + g.scos * y + g.ty];
};
const baseMid = (g: PlacedGlyph) => [g.scos * (g.advance / 2) + g.tx, g.ssin * (g.advance / 2) + g.ty];
const fromCentre = ([x, y]: number[]) => Math.hypot(x - G.centre[0], y - G.centre[1]);
const angleOf = ([x, y]: number[]) => Math.atan2(y - G.centre[1], x - G.centre[0]);

describe('visualOrder: shaped first, then laid, never reversed twice', () => {
  it('keeps a left-to-right word as it is', () => {
    expect(visualOrder('More energy')).toBe('More energy');
  });

  it('lays a right-to-left word in the order it is seen, left to right', () => {
    expect(visualOrder('נעים')).toBe('םיענ');
    expect(visualOrder('לא נעים')).toBe('םיענ אל');
  });

  it('refuses a word that mixes directions, or carries combining marks: it needs a shaper, never a guess', () => {
    expect(() => visualOrder('נעים ok')).toThrow(RangeError);
    expect(() => visualOrder('נָעִים')).toThrow(RangeError);
    expect(() => visualOrder('café')).toThrow(RangeError);
    // A precomposed letter is one code point, not a mark: kept.
    expect(visualOrder('café')).toBe('café');
  });

  it('keeps a word with no letters as it is', () => {
    expect(visualOrder('')).toBe('');
    expect(visualOrder('— —')).toBe('— —');
  });
});

describe('layRimWord: the word on the ring', () => {
  it('lays the four positions clockwise from the top: the designer’s element order', () => {
    expect(RIM_POSITIONS).toEqual(['top', 'right', 'bottom', 'left']);
  });

  it.each(RIM_POSITIONS)('%s: every letter is centred on the ring’s centre line, and stays inside the band', (position) => {
    const word = lay(position);
    expect(word.glyphs).toHaveLength(ADV.length);
    for (const g of word.glyphs) {
      expect(fromCentre(cellCentre(g))).toBeCloseTo(G.ringMid, 9);
      for (const c of corners(g)) {
        expect(fromCentre(c)).toBeGreaterThanOrEqual(G.ringInner);
        expect(fromCentre(c)).toBeLessThanOrEqual(G.radius);
      }
    }
  });

  const ANCHOR: Record<RimPosition, number> = { top: -Math.PI / 2, right: 0, bottom: Math.PI / 2, left: Math.PI };
  it.each(RIM_POSITIONS)('%s: the word is centred on its anchor', (position) => {
    const { glyphs } = lay(position);
    const first = angleOf(baseMid(glyphs[0]));
    const last = angleOf(baseMid(glyphs[glyphs.length - 1]));
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    const mid = wrap(first + wrap(last - first) / 2);
    expect(wrap(mid - ANCHOR[position])).toBeCloseTo(0, 9);
  });

  it('reads left to right at the top and the bottom, downward at the right, upward at the left', () => {
    const xs = (p: RimPosition) => lay(p).glyphs.map((g) => baseMid(g)[0]);
    const ys = (p: RimPosition) => lay(p).glyphs.map((g) => baseMid(g)[1]);
    const rising = (v: number[]) => v.every((x, i) => i === 0 || x > v[i - 1]);
    const falling = (v: number[]) => v.every((x, i) => i === 0 || x < v[i - 1]);
    expect(rising(xs('top'))).toBe(true);
    expect(rising(xs('bottom'))).toBe(true);
    expect(rising(ys('right'))).toBe(true);
    expect(falling(ys('left'))).toBe(true);
  });

  it('turns the glyph tops toward the rim at the top, the right and the left; the bottom word is upright (DEC-036)', () => {
    for (const position of RIM_POSITIONS) {
      for (const g of lay(position).glyphs) {
        const [px, py] = baseMid(g);
        const out = [(px - G.centre[0]) / fromCentre([px, py]), (py - G.centre[1]) / fromCentre([px, py])];
        const up = [g.ssin, -g.scos];
        const dot = up[0] * out[0] + up[1] * out[1];
        if (position === 'bottom') expect(dot).toBeLessThan(-0.99);
        else expect(dot).toBeGreaterThan(0.99);
      }
    }
  });

  it('spaces the letters by their advances along the baseline, and the bottom word’s tracking widens only its gaps', () => {
    const arcGap = (a: PlacedGlyph, b: PlacedGlyph) => {
      const r = fromCentre(baseMid(a));
      const d = Math.abs(Math.atan2(Math.sin(angleOf(baseMid(b)) - angleOf(baseMid(a))), Math.cos(angleOf(baseMid(b)) - angleOf(baseMid(a)))));
      return r * d;
    };
    for (const tracking of [0, 0.42]) {
      const { glyphs } = lay('bottom', { tracking });
      for (let i = 1; i < glyphs.length; i++) expect(arcGap(glyphs[i - 1], glyphs[i])).toBeCloseTo((ADV[i - 1] + ADV[i]) / 2 + tracking, 9);
    }
  });

  it('keeps every letter when no bead is near, and holds the word’s box: every cell, outset by the pad', () => {
    for (const position of RIM_POSITIONS) {
      const word = lay(position, { beads: [{ x: 0, y: 0 }] });
      expect(word.glyphs.every((g) => !g.knockedOut)).toBe(true);
      const all = word.glyphs.flatMap(corners);
      const b = word.bounds;
      expect(b.x).toBeCloseTo(Math.min(...all.map((c) => c[0])) - PAD, 9);
      expect(b.y).toBeCloseTo(Math.min(...all.map((c) => c[1])) - PAD, 9);
      expect(b.x + b.width).toBeCloseTo(Math.max(...all.map((c) => c[0])) + PAD, 9);
      expect(b.y + b.height).toBeCloseTo(Math.max(...all.map((c) => c[1])) + PAD, 9);
    }
  });

  it('refuses a word whose advances and positions are not finite: a word drawn at a guess would cross the field', () => {
    expect(() => lay('top', { advances: [8, NaN] })).toThrow(RangeError);
  });
});

describe('the knock-out (DSN-028): letters within the bead radius + 5 dp of a bead go', () => {
  /** The shortest distance from a point to a glyph's cell, by dense sampling of the cell: an oracle independent of the law. */
  function sampledDistance(g: PlacedGlyph, [bx, by]: number[]) {
    let best = Infinity;
    const N = 60;
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        const x = (g.advance * i) / N;
        const y = FONT.ascent + ((FONT.descent - FONT.ascent) * j) / N;
        best = Math.min(best, Math.hypot(g.scos * x - g.ssin * y + g.tx - bx, g.ssin * x + g.scos * y + g.ty - by));
      }
    }
    return best;
  }

  it.each([[{ x: 0, y: 1 }, 'top'], [{ x: 1, y: 0 }, 'right'], [{ x: 0, y: -1 }, 'bottom'], [{ x: -1, y: 0 }, 'left']] as const)(
    'a bead at %p knocks out letters of the %s word only, exactly those within reach',
    (bead, near) => {
      const reach = G.beadRadius + KNOCKOUT;
      const centre = pointToLocal(bead, G);
      for (const position of RIM_POSITIONS) {
        const word = lay(position, { beads: [bead] });
        if (position !== near) {
          expect(word.glyphs.some((g) => g.knockedOut)).toBe(false);
          continue;
        }
        expect(word.glyphs.some((g) => g.knockedOut)).toBe(true);
        expect(word.glyphs.some((g) => !g.knockedOut)).toBe(true);
        for (const g of word.glyphs) {
          const d = sampledDistance(g, [centre.x, centre.y]);
          if (Math.abs(d - reach) > 0.2) expect(g.knockedOut).toBe(d <= reach);
        }
      }
    },
  );

  // The designer's hardest placements (the direction file's `hardest`): a bead brightest under each word.
  const HARDEST = (EXTENSIONS as unknown as { abyss: { $root: { hardest: Array<{ id: string; x?: number; y?: number }> } } }).abyss.$root.hardest
    .filter((h) => h.id.startsWith('word.') && h.x !== undefined && h.y !== undefined);
  it('each hardest word placement knocks out letters of its own word, and of no other', () => {
    expect(HARDEST.length).toBeGreaterThanOrEqual(4);
    for (const h of HARDEST) {
      const own = h.id.slice('word.'.length) as RimPosition;
      for (const position of RIM_POSITIONS) {
        const hit = lay(position, { beads: [{ x: h.x!, y: h.y! }] }).glyphs.some((g) => g.knockedOut);
        expect([h.id, position, hit]).toEqual([h.id, position, position === own]);
      }
    }
  });
});
