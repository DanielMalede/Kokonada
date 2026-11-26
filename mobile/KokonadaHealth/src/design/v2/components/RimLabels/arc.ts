// The rim words on the arc (DEC-036; V1 directions §1.5; DSN-027, DSN-028), pure: what RimLabels draws, as numbers.
//
//   · Shaped first, then laid, never reversed twice: a word's glyphs are laid in the order they are seen, left to right.
//     A Hebrew word is reversed once into that order. A word this cannot order truthfully (one that mixes directions,
//     carries combining marks, or is in a joining script) needs a shaper, so it is refused, never drawn at a guess.
//   · Each word is centred on its anchor (top, right, bottom, left) on the ring's centre line: its letters' cells
//     (advance × the font's ascent..descent) are centred on that line, so the word sits in the middle of the band.
//   · Concave: at the top, the right and the left the glyph tops point toward the rim and the word runs clockwise; the
//     bottom word is upright and runs counter-clockwise. Its tracking widens the gaps between its letters only.
//   · The knock-out (DSN-028; the designer's ruling 2): a letter whose cell comes within the bead radius +
//     plate.labelBand.knockoutGap of a bead's centre is near it. A letter near a live bead is out, not drawn, from the
//     frame the bead appears; one near leaving beads only is returning: it fades back in as they fade
//     (lettersOpacity); any other is kept. The bead sits where the field draws its halo (pointToLocal).
//
// All in the plate's own dp, x right and y down. Each glyph's place is an RSXform: its baseline origin (tx, ty) and its
// rotation (scos, ssin), as Skia lays a glyph run.

import { pointToLocal, type PlateGeometry, type PlatePoint } from '../Plate/geometry.ts';

export type RimPosition = 'top' | 'right' | 'bottom' | 'left';

/** Clockwise from the top: the order the words are laid and drawn in. */
export const RIM_POSITIONS: readonly RimPosition[] = ['top', 'right', 'bottom', 'left'];

/**
 * The order TalkBack reads the words in, in every locale (the designer's ruling 1, 2026-11-25): the energy axis, top
 * then bottom, then the pleasantness axis, right then left. RimLabels mounts their nodes in this order.
 */
export const RIM_READING_ORDER: readonly RimPosition[] = ['top', 'bottom', 'right', 'left'];

/** Hebrew letters and its presentation forms, the one right-to-left script a plain reversal orders truthfully. */
const HEBREW = /[א-תׯ-״יִ-ﭏ]/;
/** Characters a reversal would misorder inside a right-to-left word: Latin, Greek and Cyrillic letters, and digits. */
const LEFT_TO_RIGHT = /[0-9A-Za-zÀ-ÖØ-öø-ɏͰ-ϿЀ-ԯ]/;
/**
 * Combining marks: Latin's and Hebrew's points and accents. A mark needs a shaper to sit on its letter. Written as escapes,
 * so the source holds no Hebrew point of its own: fontLicence.test.ts reads any as copy the fonts must cover (CMP-122).
 */
const MARK = /[\u0300-\u036f\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7]/;
/** Joining scripts (Arabic): their letters change shape with their neighbours, which only a shaper does. */
const JOINING = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

/** A word's characters in the order they are seen, left to right. */
export function visualOrder(text: string): string {
  if (MARK.test(text)) throw new RangeError(`a rim word with combining marks needs a shaper: ${JSON.stringify(text)}`);
  if (JOINING.test(text)) throw new RangeError(`a rim word in a joining script needs a shaper: ${JSON.stringify(text)}`);
  const rtl = HEBREW.test(text);
  if (rtl && LEFT_TO_RIGHT.test(text)) throw new RangeError(`a rim word that mixes directions needs a shaper: ${JSON.stringify(text)}`);
  return rtl ? Array.from(text).reverse().join('') : text;
}

/** What the layout needs from the font, in dp: its size, and its ascent (negative, above the baseline) and descent. */
export interface RimFontMetrics {
  readonly size: number;
  readonly ascent: number;
  readonly descent: number;
}

/**
 * A bead as the rim words see it (the designer's ruling 2; Bead/'s presence makes them): its id, the key of its look in
 * the looks the beads' driver writes (RimLooks), where it sits, and whether it is leaving.
 */
export type RimBead = {
  readonly id: number;
  readonly point: PlatePoint;
  readonly leaving: boolean;
};

/**
 * A letter's state (the designer's ruling 2): kept, with no bead near it; out, near a live bead, so not drawn; or
 * returning, near leaving beads only, so drawn at the opacity they leave it (lettersOpacity).
 */
export type GlyphState = 'kept' | 'out' | 'returning';

/** One glyph's place: its index in the word's visual order, its advance, its RSXform, and its state. */
export interface PlacedGlyph {
  readonly index: number;
  readonly advance: number;
  readonly scos: number;
  readonly ssin: number;
  readonly tx: number;
  readonly ty: number;
  readonly state: GlyphState;
  /** A returning letter's leaving beads: their indices in the beads given, ascending. Empty for a kept or an out letter. */
  readonly follows: readonly number[];
}

export interface RimBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface RimWordLayout {
  readonly position: RimPosition;
  readonly glyphs: readonly PlacedGlyph[];
  /** The word's box in the plate's dp: every letter's cell, whatever its state, outset by the pad. */
  readonly bounds: RimBox;
}

export interface RimWordInput {
  readonly position: RimPosition;
  /** Each glyph's advance in dp, in visual order. */
  readonly advances: readonly number[];
  readonly font: RimFontMetrics;
  /** Added between letters, in dp: the bottom word's tracking, 0 elsewhere. */
  readonly tracking: number;
  readonly geometry: PlateGeometry;
  /** The beads on the plate, live and leaving. */
  readonly beads: readonly RimBead[];
  /** plate.labelBand.knockoutGap: how far beyond the bead's radius a letter is knocked out, in dp. */
  readonly knockoutGap: number;
  /** How far the word's box reaches beyond its cells, in dp: room for ink past a cell. */
  readonly pad: number;
}

const ANCHOR: Readonly<Record<RimPosition, number>> = { top: -Math.PI / 2, right: 0, bottom: Math.PI / 2, left: Math.PI };

export function layRimWord(input: RimWordInput): RimWordLayout {
  const { position, advances, font, tracking, geometry: g, beads, knockoutGap, pad } = input;
  if (![...advances, font.size, font.ascent, font.descent, tracking, knockoutGap, pad].every(Number.isFinite)) {
    throw new RangeError(`a rim word needs finite advances, metrics, tracking, knock-out gap and pad (the ${position} word)`);
  }
  // Clockwise with the tops toward the rim, or (the bottom word) counter-clockwise and upright.
  const dir = position === 'bottom' ? -1 : 1;
  // The baseline's radius that centres every cell on the ring's centre line.
  const middle = (font.ascent + font.descent) / 2;
  const baseline = g.ringMid + dir * middle;
  const total = advances.reduce((sum, a) => sum + a, 0) + tracking * Math.max(0, advances.length - 1);
  const start = ANCHOR[position] - (dir * total) / (2 * baseline);
  const reach = g.beadRadius + knockoutGap;
  const beadCentres = beads.map((b) => pointToLocal(b.point, g));

  let along = 0;
  const glyphs = advances.map((advance, index): PlacedGlyph => {
    const theta = start + (dir * (along + advance / 2)) / baseline;
    along += advance + tracking;
    const phi = theta + (dir * Math.PI) / 2;
    const scos = Math.cos(phi);
    const ssin = Math.sin(phi);
    const tx = g.centre[0] + baseline * Math.cos(theta) - (advance / 2) * scos;
    const ty = g.centre[1] + baseline * Math.sin(theta) - (advance / 2) * ssin;
    // The beads near the letter: the distance from each centre to the cell [0, advance] × [ascent, descent], in the
    // glyph's own frame, within reach.
    const near: number[] = [];
    beadCentres.forEach((c, k) => {
      const dx = c.x - tx;
      const dy = c.y - ty;
      const lx = dx * scos + dy * ssin;
      const ly = -dx * ssin + dy * scos;
      const ex = Math.max(-lx, 0, lx - advance);
      const ey = Math.max(font.ascent - ly, 0, ly - font.descent);
      if (Math.hypot(ex, ey) <= reach) near.push(k);
    });
    const state: GlyphState = near.length === 0 ? 'kept' : near.some((k) => !beads[k].leaving) ? 'out' : 'returning';
    return { index, advance, scos, ssin, tx, ty, state, follows: state === 'returning' ? near : [] };
  });

  return { position, glyphs, bounds: boundsOf(glyphs, font, pad, g, position) };
}

/** Letters of one word returning together: they follow the same leaving beads. */
export interface ReturningGroup {
  readonly follows: readonly number[];
  readonly glyphs: readonly PlacedGlyph[];
}

/** A word's returning letters, grouped by the leaving beads they follow, each group in the order its letters are laid. */
export function returningGroups(layout: RimWordLayout): ReturningGroup[] {
  const groups = new Map<string, { follows: readonly number[]; glyphs: PlacedGlyph[] }>();
  for (const glyph of layout.glyphs) {
    if (glyph.state !== 'returning') continue;
    const key = glyph.follows.join(',');
    const group = groups.get(key);
    if (group) group.glyphs.push(glyph);
    else groups.set(key, { follows: glyph.follows, glyphs: [glyph] });
  }
  return [...groups.values()];
}

/** What the letters read of a bead's look (Bead/beadDriver.ts DrivenLook): its opacity now, and its opacity when its exit began. */
export interface RimLook {
  readonly opacity: number;
  /** Null while the bead enters or rests: it has no exit yet. */
  readonly start: number | null;
}

/** The looks the beads' driver writes each frame, by bead id. */
export type RimLooks = Readonly<Record<number, RimLook>>;

/** The shared value RimLabels reads them from, on either thread: it never writes it. */
export interface RimLooksValue {
  readonly value: RimLooks;
}

/**
 * The letters' law (the designer's rulings of 2026-11-26, UI-320): the opacity of letters returning as the leaving beads
 * they follow fade, read from those beads' own looks: one less the largest share of its start opacity any of them still
 * has, opacity ÷ start, held to [0, 1]. So it is exactly 0 while a bead is at its start opacity (the exit's hold), and
 * near several beads it follows the one that fades last. A bead with no look yet, or whose look has no start yet, has
 * all of its share: the letters stay out. One that began invisible (start 0 or less) has none: the letters are 1, never
 * NaN. A start or an opacity that is not a number keeps the letters out, as a bead that may still be there.
 */
export function lettersOpacity(ids: readonly number[], looks: RimLooks): number {
  'worklet';
  let share = 0;
  for (let i = 0; i < ids.length; i++) {
    const look = looks[ids[i]];
    let s = 1;
    if (look !== undefined && look.start !== null && Number.isFinite(look.start)) {
      if (look.start <= 0) s = 0;
      else if (Number.isFinite(look.opacity)) s = Math.min(1, Math.max(0, look.opacity / look.start));
    }
    if (s > share) share = s;
  }
  return 1 - share;
}

/** Every cell's corners, where each glyph's transform puts them, boxed and outset by the pad. A word with no glyph is a point on the centre line. */
function boundsOf(glyphs: readonly PlacedGlyph[], font: RimFontMetrics, pad: number, g: PlateGeometry, position: RimPosition): RimBox {
  if (glyphs.length === 0) {
    const x = g.centre[0] + g.ringMid * Math.cos(ANCHOR[position]);
    const y = g.centre[1] + g.ringMid * Math.sin(ANCHOR[position]);
    return { x, y, width: 0, height: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const glyph of glyphs) {
    for (const [x, y] of [[0, font.ascent], [glyph.advance, font.ascent], [0, font.descent], [glyph.advance, font.descent]]) {
      const px = glyph.scos * x - glyph.ssin * y + glyph.tx;
      const py = glyph.ssin * x + glyph.scos * y + glyph.ty;
      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    }
  }
  return { x: minX - pad, y: minY - pad, width: maxX - minX + 2 * pad, height: maxY - minY + 2 * pad };
}
