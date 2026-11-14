// FieldFallback's model (T13; the designer's rulings Q1–Q5 of 2026-11-11, which amend r3 §2's DEC "fallback field
// clip" and addendum §2.5's field.fallback): what the fallback draws, as data, from FieldView's own props. No Skia here:
// fallbackDraw.ts draws a FallbackPlan, FieldFallback.tsx shows it, and the tests hold every number to the builder and
// the law. It runs on the JS thread, once per change of its inputs, and never throws on them (Q2).
//
//   region   by field.mask (Q1): the face (d < ringInner) when mask.face > 0, else the outside beyond the moat
//            (d > moatOuter) when mask.outside > 0, else none; never both. On Abyss the field shows only in the lens;
//   pose     the field's mean pose at s = 0 and c = null (Q5): the breath at its mean b = 0.5, no drift, no shimmer, no
//            warp, never genesis. Radius radiusScale × lobe.radius × (1 + ampRadius/2), the builder's still radius at
//            s = 0; centre the lobe-centre rule at zero drift (lobeAnchor); the newest tap that carries a lobe (any node
//            but neutral, or a neutral where neutralLobe > 0), else the rest state: one R0 gradient at the centroid of
//            the face's rest lobes;
//   stops    composite(the region's flat ground, the node colour at s = 0, weight × k) through kp: the law's own route
//            R4 (compositePixel) with no grain and no dither. k = K × P_none × (1 − ampPresence/2), the builder's still
//            kField at s 0 and c null, × the region's mask value. The ground is the region's flat token (the face's
//            plate.face, the outside's ground): no vignette, no lift. Every stop is opaque, and the last (weight 0) is
//            the region's ground itself. Each channel is its nearest byte, k/255, the byte the device's truncation
//            and CanvasKit's float both draw (RA-29);
//   clip     each device pixel decided at its centre by the law's step test: the face keeps it while d < ringInner·R
//            + 1 dp (the 1 dp under the opaque ring), the outside while d > moatOuter·R, and a zone removes it where
//            sd ≤ 0 (the law's quietFactor at presence 1 with no feather: rounded, a pixel on the grown boundary
//            removed). So the clip is whole device pixels: rectangles, one per run of equal rows;
//   presence hard (Q2): a zone escapes removal only while its presence is exactly 0; every rect in layout.quietRects is
//            read, with no clamp to QUIET_SLOTS, and a rect past the presence list counts as present. A rect that is
//            not finite or has a negative size cannot be removed, so the fallback then draws no field at all.

import { oklabToSrgb, type Oklab } from '../color/oklab.ts';
import { BASE, DIRECTIONS, type DirectionId, type Face } from '../tokens/tokens.generated.ts';
import type { FieldLayout, LayoutRect } from './fieldDriver.ts';
import { NODE_TIER, QUADRANT, lobeAnchor, nodeAt, placementRamp, type FieldStatics } from './fieldFrame.ts';
import { compositePixel, quietFactor, type FieldFrame, type PixelTerms, type QuietRect } from './fieldLaw.ts';
import type { Tap } from './placementLedger.ts';

export type FallbackRegion = 'face' | 'outside' | 'none';
/** An sRGB colour, each channel in [0, 1]. */
export type Rgb = readonly [number, number, number];
/** A clip rectangle in device px, whole pixels: x, y, width, height. */
export type ClipRect = readonly [number, number, number, number];

/** What the fallback draws its one gradient for: a placement's node, or the rest state (R0). */
export interface FallbackPose {
  readonly node: 'J' | 'C' | 'R' | 'I' | 'R0';
  readonly rest: boolean;
  /** The gradient's centre in plate units (R = 1, y up). */
  readonly centre: readonly [number, number];
  /** The node colour at s = 0 (steady). */
  readonly colour: Oklab;
}

/** The still's numbers the fallback shares with the builder (tier still, s 0, c null, genesis off). */
export interface FallbackStill {
  readonly ringInner: number;
  readonly moatOuter: number;
  /** The lobe radius r_L at the mean breath, in plate units. */
  readonly lobeRadius: number;
  /** K × P_none × (1 − ampPresence/2), before the region's mask value. */
  readonly k: number;
  readonly mask: { readonly outside: number; readonly face: number; readonly ring: number };
  readonly grounds: { readonly outside: Oklab; readonly face: Oklab; readonly ring: Oklab };
}

export interface FallbackField {
  /** The radial gradient's centre and radius, in device px. */
  readonly centre: readonly [number, number];
  readonly radius: number;
  readonly positions: readonly number[];
  readonly colours: readonly Rgb[];
  /** The clip, whole device pixels. Empty: no pixel keeps the field. */
  readonly clip: readonly ClipRect[];
}

/** Everything FieldFallback draws, in device px (Q3's order: ground, face, field, ring). */
export interface FallbackPlan {
  /** The canvas: the view in device px, rounded up. */
  readonly size: { readonly width: number; readonly height: number };
  readonly pxPerDp: number;
  readonly region: FallbackRegion;
  /** color.<face>.ground, over the whole canvas. */
  readonly ground: string;
  /** The face material: plate.face, a disc of radius ringInner·R + 1 dp. */
  readonly face: { readonly centre: readonly [number, number]; readonly radius: number; readonly colour: string };
  /** plate.ring, the annulus from ringInner·R to the rim R. */
  readonly ring: { readonly centre: readonly [number, number]; readonly inner: number; readonly outer: number; readonly colour: string };
  readonly pose: FallbackPose | null;
  /** The clipped gradient, or null when the fallback draws no field. */
  readonly field: FallbackField | null;
}

export interface FallbackInput {
  readonly direction: DirectionId;
  readonly face: Face;
  readonly statics: FieldStatics;
  /** The cold lane's taps, oldest first. */
  readonly taps: readonly Tap[];
  readonly layout: FieldLayout;
  /** Device px per dp. */
  readonly pxPerDp: number;
  /** Each quiet zone's presence, by slot, as given (never sanitised: Q2 reads it as it is). */
  readonly quietPresence?: readonly number[];
}

const lab = (c: { readonly oklab: readonly number[] }): Oklab => ({ L: c.oklab[0], a: c.oklab[1], b: c.oklab[2] });
const finite = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback);
const srgb = (c: Oklab): Rgb => {
  const [r, g, b] = oklabToSrgb(c);
  return [Math.min(1, Math.max(0, r)), Math.min(1, Math.max(0, g)), Math.min(1, Math.max(0, b))];
};

/** The one region the fallback draws the field in (Q1). */
export function fallbackRegion(id: DirectionId): FallbackRegion {
  const mask = DIRECTIONS[id].field.mask;
  if (mask.face > 0) return 'face';
  if (mask.outside > 0) return 'outside';
  return 'none';
}

/** K × P_none × (1 − ampPresence/2): the builder's kField at the still, s 0, c null, genesis off, written as it writes it. */
function stillK(id: DirectionId, face: Face): number {
  const d = DIRECTIONS[id];
  const ampP = d.field.breath.ampPresence;
  return d.field.K[face] * d.field.presence.none * (1 - ampP + ampP * 0.5);
}

/** The still's numbers for a layout in dp: ringInner and moatOuter by the builder's formulas, r_L at b = 0.5, k, mask, grounds. */
export function fallbackStill(id: DirectionId, face: Face, layout: Pick<FieldLayout, 'radius' | 'fontScale'>): FallbackStill {
  const d = DIRECTIONS[id];
  const c = d.color[face];
  const band = Math.max(BASE.plate.labelBand.min, BASE.plate.labelBand.min * finite(layout.fontScale, 1));
  return {
    ringInner: 1 - band / layout.radius,
    moatOuter: 1 + d.field.mask.moat / layout.radius,
    lobeRadius: d.field.lobe.radius * (1 + d.field.breath.ampRadius * 0.5),
    k: stillK(id, face),
    mask: d.field.mask,
    grounds: { outside: lab(c.ground), face: lab(c.plate.face), ring: lab(c.plate.ring) },
  };
}

/**
 * The pose (Q5): the newest tap that carries a lobe, at its lobe-centre rule with no drift and its node colour at s = 0;
 * else the rest state, one R0 gradient at the centroid of the face's rest lobes. Null only with no rest lobes either.
 */
export function fallbackPose(id: DirectionId, face: Face, statics: FieldStatics, taps: readonly Tap[], radiusDp: number): FallbackPose | null {
  const d = DIRECTIONS[id];
  const glow = lab(d.color[face].field.restGlow);
  const beadRadius = d.bead.diameter / 2 / radiusDp;
  for (let i = taps.length - 1; i >= 0; i--) {
    let x = finite(taps[i].x, 0);
    let y = finite(taps[i].y, 0);
    const r = Math.hypot(x, y);
    if (r > 1) {
      x /= r;
      y /= r;
    }
    const node = nodeAt(x, y);
    if (node === 'neutral' && !(d.field.lobe.neutralLobe > 0)) continue;
    const centre = lobeAnchor(taps[i].x, taps[i].y, beadRadius, d.field.lobe.centreAlpha, d.field.lobe.centreBeta);
    if (node === 'neutral') return { node: 'R0', rest: false, centre, colour: glow };
    // The builder's halo colour, DSN-017 on the field: L from the rest glow's to the anchor's with p, ab = p·chromaScale·anchor.
    const anchor = lab(BASE.emotion[QUADRANT[node]][NODE_TIER[face]]);
    const p = placementRamp(x, y);
    const scale = p * d.bead.chromaScale;
    return { node, rest: false, centre, colour: { L: glow.L + (anchor.L - glow.L) * p, a: anchor.a * scale, b: anchor.b * scale } };
  }
  const lobes = statics.restLobes[face];
  if (lobes.length === 0) return null;
  let sx = 0;
  let sy = 0;
  for (const [lx, ly] of lobes) {
    sx += finite(lx, 0);
    sy += finite(ly, 0);
  }
  return { node: 'R0', rest: true, centre: [sx / lobes.length, sy / lobes.length], colour: glow };
}

/**
 * A channel as the byte both Skias draw (RA-29): k/255, the nearest byte. RN Skia on the device reads a gradient colour
 * into an 8-bit SkColor by truncation (JsiSkColor::fromValue, SkColorSetARGB(v * 255) in float); it has no float route
 * for gradient colours. CanvasKit keeps the float. At k/255 the two agree for every k: trunc(fround(fround(k/255) × 255))
 * is k, and so is the rounding.
 */
const byte = (v: number) => Math.round(v * 255) / 255;

/** The stops: each composite(the region's flat ground, colour, weight × k × mask) through kp, as sRGB, opaque, each channel its byte. */
export function fallbackStops(id: DirectionId, face: Face, region: 'face' | 'outside', statics: FieldStatics, colour: Oklab): { positions: number[]; colours: Rgb[] } {
  const d = DIRECTIONS[id];
  const ground = lab(region === 'face' ? d.color[face].plate.face : d.color[face].ground);
  const k = stillK(id, face) * (region === 'face' ? d.field.mask.face : d.field.mask.outside);
  // compositePixel reads only kp, grain and dither of its frame, and ground, k and coverage of its terms: route R4 with
  // no grain and no dither. fieldLaw.ts stays byte for byte as the band evidence stamped it (UI-160), so the partial
  // objects are cast here rather than its signature widened.
  const noNoise = { kp: d.field.pivot, grain: { inside: 0, ground: 0 }, dither: 0 } as unknown as FieldFrame;
  const { position, weight } = statics.fallbackStops;
  const positions: number[] = [];
  const colours: Rgb[] = [];
  for (let i = 0; i < Math.min(position.length, weight.length); i++) {
    positions.push(position[i]);
    const [r, g, b] = srgb(compositePixel(noNoise, { ground, k: weight[i] * k, coverage: 0 } as unknown as PixelTerms, colour, 0, 0));
    colours.push([byte(r), byte(g), byte(b)]);
  }
  return { positions, colours };
}

/**
 * The zones the fallback removes (Q2), in device px as the builder's geometry converts them: every rect whose presence is
 * not exactly 0, a rect past the presence list counting as present, with no clamp. Null when a rect is malformed.
 */
export function removedZones(rects: readonly LayoutRect[] | undefined, presence: readonly number[] | undefined, pxPerDp: number): QuietRect[] | null {
  const all = rects ?? [];
  const out: QuietRect[] = [];
  for (let i = 0; i < all.length; i++) {
    const r = all[i];
    const ok = Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.width) && Number.isFinite(r.height) && r.width >= 0 && r.height >= 0;
    if (!ok) return null;
    if (presence !== undefined && i < presence.length && presence[i] === 0) continue;
    out.push({ cx: (r.x + r.width / 2) * pxPerDp, cy: (r.y + r.height / 2) * pxPerDp, hx: (r.width / 2) * pxPerDp, hy: (r.height / 2) * pxPerDp });
  }
  return out;
}

type Span = readonly [number, number];

/**
 * The pixels of a row whose centres a convex shape holds, [lo, hi): from the estimate [lo0, hi0), every boundary pixel
 * decided by `inside` itself, so the result is the predicate's to the pixel.
 */
function interval(lo0: number, hi0: number, width: number, inside: (x: number) => boolean): Span {
  if (!(Number.isFinite(lo0) && Number.isFinite(hi0))) return [0, 0];
  let lo = Math.min(width, Math.max(0, lo0));
  let hi = Math.min(width, Math.max(lo, hi0));
  while (lo > 0 && inside(lo - 1)) lo--;
  while (lo < hi && !inside(lo)) lo++;
  while (hi < width && inside(hi)) hi++;
  while (hi > lo && !inside(hi - 1)) hi--;
  return [lo, hi];
}

/** A row's spans in the region: the face's disc (d < bound), or everything beyond the moat's (d > bound). */
function regionSpans(region: 'face' | 'outside', y: number, width: number, centre: readonly [number, number], bound: number): Span[] {
  const dy = y + 0.5 - centre[1];
  const dist = (x: number) => {
    const dx = x + 0.5 - centre[0];
    return Math.sqrt(dx * dx + dy * dy);
  };
  const half = Math.sqrt(Math.max(0, bound * bound - dy * dy));
  const lo0 = Math.ceil(centre[0] - half - 0.5);
  const hi0 = Math.floor(centre[0] + half - 0.5) + 1;
  if (region === 'face') {
    if (!(Math.abs(dy) < bound)) return [];
    const [lo, hi] = interval(lo0, hi0, width, (x) => dist(x) < bound);
    return hi > lo ? [[lo, hi]] : [];
  }
  if (!(Math.abs(dy) <= bound)) return [[0, width]];
  const [lo, hi] = interval(lo0, hi0, width, (x) => !(dist(x) > bound));
  const out: Span[] = [];
  if (lo > 0) out.push([0, lo]);
  if (hi < width) out.push([Math.max(hi, lo), width]);
  return out;
}

/** The pixels of a row a grown zone removes, by the law's quietFactor at presence 1 with no feather (sd ≤ 0). */
function zoneSpan(zone: QuietRect, frame: FieldFrame, y: number, width: number): Span | null {
  const py = y + 0.5;
  const grow = frame.quiet.grow;
  const qy = Math.abs(py - zone.cy) - zone.hy;
  if (!(qy <= grow)) return null;
  const half = qy <= 0 ? grow : Math.sqrt(grow * grow - qy * qy);
  const [lo, hi] = interval(Math.ceil(zone.cx - zone.hx - half - 0.5), Math.floor(zone.cx + zone.hx + half - 0.5) + 1, width, (x) => quietFactor(frame, x + 0.5, py) === 0);
  return hi > lo ? [lo, hi] : null;
}

function subtract(spans: readonly Span[], cut: Span): Span[] {
  const out: Span[] = [];
  for (const [lo, hi] of spans) {
    if (cut[1] <= lo || cut[0] >= hi) {
      out.push([lo, hi]);
      continue;
    }
    if (cut[0] > lo) out.push([lo, cut[0]]);
    if (cut[1] < hi) out.push([cut[1], hi]);
  }
  return out;
}

const sameSpans = (a: readonly Span[], b: readonly Span[]) => a.length === b.length && a.every((s, i) => s[0] === b[i][0] && s[1] === b[i][1]);

/** The clip (the amended DEC): every device pixel decided at its centre, as whole-pixel rectangles, one per run of equal rows. */
function fallbackClip(region: 'face' | 'outside', size: { readonly width: number; readonly height: number }, centre: readonly [number, number], bound: number, zones: readonly QuietRect[], grow: number): ClipRect[] {
  // quietFactor reads only frame.quiet (fieldLaw.ts, stamped as is: UI-160), so each zone's frame is that alone.
  const frames = zones.map((zone) => ({ zone, frame: { quiet: { rects: [zone], presence: [1], grow, feather: 0 } } as unknown as FieldFrame }));
  const rects: ClipRect[] = [];
  let open: Span[] = [];
  let openedAt = 0;
  const close = (y: number) => {
    for (const [lo, hi] of open) rects.push([lo, openedAt, hi - lo, y - openedAt]);
  };
  for (let y = 0; y < size.height; y++) {
    let spans = regionSpans(region, y, size.width, centre, bound);
    for (const { zone, frame } of frames) {
      if (spans.length === 0) break;
      const cut = zoneSpan(zone, frame, y, size.width);
      if (cut !== null) spans = subtract(spans, cut);
    }
    if (!sameSpans(spans, open)) {
      close(y);
      open = spans;
      openedAt = y;
    }
  }
  close(size.height);
  return rects;
}

/** Everything FieldFallback draws, from FieldView's props. */
export function fallbackPlan(input: FallbackInput): FallbackPlan {
  const { direction, face, statics, taps, layout, pxPerDp: k } = input;
  const colours = DIRECTIONS[direction].color[face];
  const still = fallbackStill(direction, face, layout);
  const R = layout.radius * k;
  const centre: readonly [number, number] = [layout.centre[0] * k, layout.centre[1] * k];
  const size = { width: Math.max(1, Math.ceil(layout.width * k)), height: Math.max(1, Math.ceil(layout.height * k)) };
  const faceBound = still.ringInner * R + k;
  const region = fallbackRegion(direction);
  const pose = fallbackPose(direction, face, statics, taps, layout.radius);
  const field = (): FallbackField | null => {
    if (region === 'none' || pose === null) return null;
    const zones = removedZones(layout.quietRects, input.quietPresence, k);
    if (zones === null) return null;
    const radius = BASE.field.fallback.radiusScale * still.lobeRadius * R;
    if (!(radius > 0)) return null;
    const stops = fallbackStops(direction, face, region, statics, pose.colour);
    const bound = region === 'face' ? faceBound : still.moatOuter * R;
    return {
      centre: [centre[0] + pose.centre[0] * R, centre[1] - pose.centre[1] * R],
      radius,
      positions: stops.positions,
      colours: stops.colours,
      clip: fallbackClip(region, size, centre, bound, zones, BASE.quiet.grow * k),
    };
  };
  return {
    size,
    pxPerDp: k,
    region,
    ground: colours.ground.hex,
    face: { centre, radius: faceBound, colour: colours.plate.face.hex },
    ring: { centre, inner: still.ringInner * R, outer: R, colour: colours.plate.ring.hex },
    pose,
    field: field(),
  };
}
