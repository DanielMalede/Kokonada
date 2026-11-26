import { EXTENSIONS } from '../../../tokens/tokens.extensions.generated.ts';
import { BASE, DIRECTIONS } from '../../../tokens/tokens.generated.ts';
import { plateGeometry, pointToLocal } from '../../Plate/geometry.ts';
import type { PlatePoint } from '../../Plate/geometry.ts';
import { RIM_POSITIONS, RIM_READING_ORDER, layRimWord, returningGroups, returningOpacity, visualOrder, type PlacedGlyph, type RimBead, type RimPosition } from '../arc.ts';

// The rim words on the arc (DEC-036; V1 directions §1.5; DSN-027, DSN-028): shaped first, then laid on the ring's centre
// line, concave: the glyph tops point toward the rim at the top, the right and the left, and the bottom word is upright.
// Letters within the bead radius + 5 dp of a live bead are knocked out; letters near leaving beads only return as they
// fade (the designer's ruling 2). Pure: the advances, the font's metrics and the bead's exit function come in.

const T = { base: BASE, direction: DIRECTIONS.abyss };
const G = plateGeometry(T, 296, 1);
const FONT = { size: 14, ascent: -13, descent: 3.5 };
const ADV = [8, 7, 9, 8, 6, 8];
const KNOCKOUT = BASE.plate.labelBand.knockoutGap;
const PAD = 4;
const lay = (position: RimPosition, over: Partial<Parameters<typeof layRimWord>[0]> = {}) =>
  layRimWord({ position, advances: ADV, font: FONT, tracking: 0, geometry: G, beads: [], knockoutGap: KNOCKOUT, pad: PAD, ...over });

/** A live bead at `point`, as Bead/'s presence gives it. */
const live = (point: PlatePoint): RimBead => ({ point, leaving: false, leftAt: null, playedAt: null, playMs: null, startOpacity: 1 });
/** A bead at `point` whose fade-out began at `leftAt`, from `startOpacity`. */
const leaving = (point: PlatePoint, leftAt: number | null, startOpacity = 1): RimBead => ({ point, leaving: true, leftAt, playedAt: leftAt, playMs: null, startOpacity });

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
  it('lays the four positions clockwise from the top: the drawing order', () => {
    expect(RIM_POSITIONS).toEqual(['top', 'right', 'bottom', 'left']);
  });

  it('TalkBack reads them top, bottom, right, left in every locale (the designer’s ruling 1): each position once', () => {
    expect(RIM_READING_ORDER).toEqual(['top', 'bottom', 'right', 'left']);
    expect([...RIM_READING_ORDER].sort()).toEqual([...RIM_POSITIONS].sort());
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
      const word = lay(position, { beads: [live({ x: 0, y: 0 }), leaving({ x: 0.1, y: 0 }, 0)] });
      expect(word.glyphs.every((g) => g.state === 'kept' && g.follows.length === 0)).toBe(true);
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
const REACH = G.beadRadius + KNOCKOUT;
/** Within reach by the oracle, or null on the boundary, where sampling cannot tell. */
const withinReach = (g: PlacedGlyph, point: PlatePoint) => {
  const c = pointToLocal(point, G);
  const d = sampledDistance(g, [c.x, c.y]);
  return Math.abs(d - REACH) > 0.2 ? d <= REACH : null;
};

describe('the knock-out (DSN-028): letters within the bead radius + 5 dp of a live bead go', () => {
  it.each([[{ x: 0, y: 1 }, 'top'], [{ x: 1, y: 0 }, 'right'], [{ x: 0, y: -1 }, 'bottom'], [{ x: -1, y: 0 }, 'left']] as const)(
    'a bead at %p knocks out letters of the %s word only, exactly those within reach',
    (bead, near) => {
      for (const position of RIM_POSITIONS) {
        const word = lay(position, { beads: [live(bead)] });
        expect(word.glyphs.some((g) => g.state === 'returning')).toBe(false);
        if (position !== near) {
          expect(word.glyphs.some((g) => g.state === 'out')).toBe(false);
          continue;
        }
        expect(word.glyphs.some((g) => g.state === 'out')).toBe(true);
        expect(word.glyphs.some((g) => g.state === 'kept')).toBe(true);
        for (const g of word.glyphs) {
          const within = withinReach(g, bead);
          if (within !== null) expect(g.state).toBe(within ? 'out' : 'kept');
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
        const hit = lay(position, { beads: [live({ x: h.x!, y: h.y! })] }).glyphs.some((g) => g.state === 'out');
        expect([h.id, position, hit]).toEqual([h.id, position, position === own]);
      }
    }
  });
});

describe('the three letter states (the designer’s ruling 2): kept, out near a live bead, returning near leaving beads only', () => {
  const TOP = { x: 0, y: 1 };
  // Two spots on the top word's arc, each reaching some of its letters, and some letters both: the oracle finds them.
  const LEFT_OF_TOP = { x: -0.06, y: 1 };
  const RIGHT_OF_TOP = { x: 0.06, y: 1 };

  it('a leaving bead’s letters are returning, following it; the others are kept', () => {
    const word = lay('top', { beads: [leaving(TOP, 1000)] });
    expect(word.glyphs.some((g) => g.state === 'returning')).toBe(true);
    expect(word.glyphs.some((g) => g.state === 'kept')).toBe(true);
    for (const g of word.glyphs) {
      expect(g.state).not.toBe('out');
      const within = withinReach(g, TOP);
      if (within !== null) expect([g.state, g.follows]).toEqual(within ? ['returning', [0]] : ['kept', []]);
    }
  });

  it('the same letters are out while the bead is live, and stay out while any live bead is near, whatever is leaving', () => {
    const asLive = lay('top', { beads: [live(TOP)] });
    const asLeaving = lay('top', { beads: [leaving(TOP, 1000)] });
    expect(asLive.glyphs.map((g) => g.state === 'out')).toEqual(asLeaving.glyphs.map((g) => g.state === 'returning'));
    const both = lay('top', { beads: [leaving(TOP, 1000), live(TOP)] });
    expect(both.glyphs.map((g) => g.state)).toEqual(asLive.glyphs.map((g) => g.state));
    expect(both.glyphs.every((g) => g.follows.length === 0)).toBe(true);
  });

  it('a returning letter follows exactly the leaving beads within its reach, in the order given', () => {
    const word = lay('top', { beads: [leaving(LEFT_OF_TOP, 1000), live({ x: 0, y: -1 }), leaving(RIGHT_OF_TOP, 1200)] });
    const follows = word.glyphs.map((g) => g.follows.join(','));
    expect(follows).toContain('0');
    expect(follows).toContain('2');
    expect(follows).toContain('0,2');
    for (const g of word.glyphs) {
      const a = withinReach(g, LEFT_OF_TOP);
      const b = withinReach(g, RIGHT_OF_TOP);
      if (a === null || b === null) continue;
      expect(g.follows).toEqual([...(a ? [0] : []), ...(b ? [2] : [])]);
      expect(g.state).toBe(a || b ? 'returning' : 'kept');
    }
  });

  it('returningGroups: the returning letters, grouped by the beads they follow, each group in the order laid', () => {
    const word = lay('top', { beads: [leaving(LEFT_OF_TOP, 1000), leaving(RIGHT_OF_TOP, 1200)] });
    const groups = returningGroups(word);
    expect(groups.map((g) => g.follows.join(',')).sort()).toEqual(['0', '0,1', '1']);
    for (const group of groups) {
      expect(group.glyphs.every((g) => g.state === 'returning' && g.follows.join(',') === group.follows.join(','))).toBe(true);
      expect(group.glyphs.map((g) => g.index)).toEqual([...group.glyphs.map((g) => g.index)].sort((x, y) => x - y));
    }
    expect(groups.flatMap((g) => g.glyphs).length).toBe(word.glyphs.filter((g) => g.state === 'returning').length);
    expect(returningGroups(lay('top', { beads: [live(TOP)] }))).toEqual([]);
    expect(returningGroups(lay('top'))).toEqual([]);
  });
});

describe('returningOpacity (the designer’s ruling 2): 1 − the bead’s opacity now ÷ its opacity when the fade-out began', () => {
  const FADE = BASE.motion.respond.duration;
  /** A stand-in for the bead model's exit (Bead/ exports the real one): linear from where it was to 0, as beadExit at 8077d2d. */
  function linearExit(b: RimBead, nowMs: number): number {
    'worklet';
    if (b.leftAt === null) return b.startOpacity;
    return b.startOpacity * (1 - Math.min(1, Math.max(0, (nowMs - b.leftAt) / FADE)));
  }

  it.each([1, 0.6])('at 0, 25, 50, 75 and 100%% of the fade-out the letters are at 0, 0.25, 0.5, 0.75 and 1 (from opacity %p)', (from) => {
    const bead = leaving({ x: 0, y: 1 }, 1000, from);
    const at = [0, 0.25, 0.5, 0.75, 1].map((f) => returningOpacity([bead], 1000 + f * FADE, linearExit));
    at.forEach((o, i) => expect(o).toBeCloseTo([0, 0.25, 0.5, 0.75, 1][i], 12));
  });

  it('holds the letters out for as long as the bead holds its opacity, then follows it (an exit that waits, as F1’s does)', () => {
    const HOLD = BASE.motion.press.duration;
    function holdThenFade(b: RimBead, nowMs: number): number {
      'worklet';
      const t = b.leftAt === null ? 0 : nowMs - b.leftAt;
      return b.startOpacity * (1 - Math.min(1, Math.max(0, (t - HOLD) / FADE)));
    }
    const bead = leaving({ x: 0, y: 1 }, 1000);
    expect([0, HOLD / 2, HOLD].map((t) => returningOpacity([bead], 1000 + t, holdThenFade))).toEqual([0, 0, 0]);
    expect(returningOpacity([bead], 1000 + HOLD + FADE / 2, holdThenFade)).toBeCloseTo(0.5, 12);
    expect(returningOpacity([bead], 1000 + HOLD + FADE, holdThenFade)).toBe(1);
  });

  it('near several leaving beads, a letter follows the one that fades last: back in full only when the last has gone', () => {
    const early = leaving({ x: 0, y: 1 }, 1000);
    const late = leaving({ x: 0, y: 1 }, 1000 + FADE / 2, 0.8);
    for (const now of [1000, 1000 + FADE / 4, 1000 + FADE / 2, 1000 + FADE, 1000 + (3 * FADE) / 2]) {
      const alone = returningOpacity([late], now, linearExit);
      expect(returningOpacity([early, late], now, linearExit)).toBeCloseTo(Math.min(returningOpacity([early], now, linearExit), alone), 12);
      expect(returningOpacity([late, early], now, linearExit)).toBeCloseTo(returningOpacity([early, late], now, linearExit), 12);
    }
    expect(returningOpacity([early, late], 1000 + FADE, linearExit)).toBeCloseTo(0.5, 12);
    expect(returningOpacity([early, late], 1000 + (3 * FADE) / 2, linearExit)).toBe(1);
  });

  it('under reduced motion (the bead goes in one frame) the letters are back in full in the frame its opacity is 0, never before', () => {
    function oneFrame(b: RimBead, nowMs: number): number {
      'worklet';
      return b.leftAt !== null && nowMs >= b.leftAt ? 0 : b.startOpacity;
    }
    const bead = leaving({ x: 0, y: 1 }, 1000);
    expect(returningOpacity([bead], 1000 - 16, oneFrame)).toBe(0);
    expect(returningOpacity([bead], 1000, oneFrame)).toBe(1);
  });

  it('a fade not yet stamped keeps the letters out; a bead that began invisible leaves them back; an opacity that is no number keeps them out', () => {
    const calls: number[] = [];
    const spy = (b: RimBead, nowMs: number) => {
      calls.push(nowMs);
      return linearExit(b, nowMs);
    };
    expect(returningOpacity([leaving({ x: 0, y: 1 }, null)], 5000, spy)).toBe(0);
    expect(calls).toEqual([]);
    expect(returningOpacity([leaving({ x: 0, y: 1 }, 1000, 0)], 1000, linearExit)).toBe(1);
    expect(returningOpacity([leaving({ x: 0, y: 1 }, 1000, Number.NaN)], 1000 + FADE, linearExit)).toBe(0);
    expect(returningOpacity([leaving({ x: 0, y: 1 }, 1000)], 1000 + FADE, () => Number.NaN)).toBe(0);
    // An opacity above where the fade began reads as the whole of it, never below 0.
    expect(returningOpacity([leaving({ x: 0, y: 1 }, 1000)], 1000, () => 2)).toBe(0);
    expect(returningOpacity([leaving({ x: 0, y: 1 }, 1000)], 1000, () => -1)).toBe(1);
  });

  it('is a worklet, as the frame callback that calls it on the UI thread must be, and captures nothing that is not one', () => {
    const fn = returningOpacity as unknown as { __workletHash?: number; __closure?: Record<string, unknown> };
    expect(typeof fn.__workletHash).toBe('number');
    const captured = Object.values(fn.__closure ?? {}).filter((v) => typeof v === 'function') as Array<{ __workletHash?: number }>;
    expect(captured.filter((f) => typeof f.__workletHash !== 'number')).toEqual([]);
  });
});
