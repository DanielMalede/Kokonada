// The never-red sweeps over the committed tokens, per direction and face (QA-065, DSN-013, DSN-019).
//
// Two kinds:
//   • fieldSweepFor: the blend graph composited over every local ground the field or a halo lands
//     on (blendSpace.ts).
//   • edgeFamiliesFor: every pair of colours that meet at an anti-aliased edge, a stroke, a shadow
//     tail or a gradient, blended in sRGB as Skia draws them (edgeSweep.ts). Each family reports its
//     exact largest in-band chroma in float (design band) and on 8-bit pixels (check band).
//
// tokens.rules.test.ts asserts DEC-081's margin on both; the evidence scripts print the same
// numbers. The graph's edges come from the extensions module, which only tests, scripts and the lab
// import, so the caller passes them in. Sweep-only: never imported by app code.

import { pivotComposite, type BlendGraph, type NeverRedSweep } from '../color/blendSpace.ts';
import { maxInBandOnPixelBlend, maxInBandOnSrgbBlend, type BlendMax, type Bytes } from '../color/edgeSweep.ts';
import { mixSafe } from '../color/mixSafe.ts';
import { mixOklab, type Oklab, type Srgb } from '../color/oklab.ts';
import { ditherReachable, type RedBand } from '../color/redBand.ts';
import { sweepOklabToSrgb } from '../color/sweepConvert.ts';
import { BASE, DIRECTIONS, type ColorValue, type DirectionId, type Face } from './tokens.generated.ts';

export interface GraphEdges {
  readonly straight: ReadonlyArray<readonly [string, string]>;
  readonly waypoint: ReadonlyArray<readonly [string, string]>;
  readonly restIntense: readonly [string, string];
}

const band = (b: { hueStart: number; hueEnd: number; chromaFloor: number }): RedBand => ({
  hueFrom: b.hueStart,
  hueTo: b.hueEnd,
  chromaFloor: b.chromaFloor,
});
export const DESIGN_BAND = band(BASE.neverRed.design);
export const CHECK_BAND = band(BASE.neverRed.check);

export const lab = (c: ColorValue): Oklab => ({ L: c.oklab[0], a: c.oklab[1], b: c.oklab[2] });
/** Dark faces carry the core tier of each emotion, light faces the deep tier (designer §1.1). */
export const tierFor = (face: Face) => (face === 'dark' ? 'core' : 'deep');
const QUADRANTS = ['joy', 'calm', 'reflective', 'intense'] as const;

/** The field's dither plus the larger grain: the L excursion an 8-bit field pixel can take. */
const amplitudeFor = (id: DirectionId) =>
  BASE.field.dither.amplitude + Math.max(DIRECTIONS[id].field.grain.ground, DIRECTIONS[id].field.grain.inside);
const haloPeak = (face: Face) => (face === 'dark' ? BASE.field.halo.peakDark : BASE.field.halo.peakLight);

export function fieldSweepFor(
  id: DirectionId,
  face: Face,
  graphEdges: GraphEdges,
  edges?: { straight: Array<[string, string]>; waypoint: Array<[string, string]> },
): NeverRedSweep {
  const d = DIRECTIONS[id];
  const colours = d.color[face];
  const tier = tierFor(face);
  const routed = d.field.graph.restIntenseRoute === 'waypoint';
  const graph: BlendGraph = {
    nodes: {
      J: lab(BASE.emotion.joy[tier]),
      C: lab(BASE.emotion.calm[tier]),
      R: lab(BASE.emotion.reflective[tier]),
      I: lab(BASE.emotion.intense[tier]),
      R0: lab(colours.field.restGlow),
    },
    straight: edges?.straight ?? [...graphEdges.straight, ...(routed ? [] : [graphEdges.restIntense])],
    waypoint: edges?.waypoint ?? [...graphEdges.waypoint, ...(routed ? [graphEdges.restIntense] : [])],
  };
  const grounds: Record<string, Oklab> = { face: lab(colours.plate.face), ring: lab(colours.plate.ring) };
  if (d.field.mask.outside > 0) grounds.ground = lab(colours.ground);
  return {
    graph,
    grounds,
    kMax: Math.max(d.field.cap[face], haloPeak(face)),
    kp: d.field.pivot,
    shimmerDeg: d.field.shimmer.deg,
    designBand: DESIGN_BAND,
    checkBand: CHECK_BAND,
    ditherAmplitude: amplitudeFor(id),
    grid: { kStep: 0.01, shimmerStepDeg: 1, pixelTStep: 0.1, pixelKStep: 0.1, chromaScales: [0.25, 0.5, 1] },
  };
}

// ---------------------------------------------------------------- edge families

export interface EdgeFamilyMax {
  readonly family: string;
  /** Float sRGB blends against the design band. */
  readonly design: BlendMax;
  /** 8-bit blends, every GPU rounding, against the check band. */
  readonly check: BlendMax & { readonly pixel?: Bytes };
}

const toBytes = (rgb: Srgb): Bytes =>
  rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255)) as unknown as Bytes;
const hexBytes = (c: ColorValue): Bytes => [1, 3, 5].map((i) => parseInt(c.hex.slice(i, i + 2), 16)) as unknown as Bytes;
const scale = (c: Oklab, p: number): Oklab => ({ L: c.L, a: c.a * p, b: c.b * p });
const rotate = (c: Oklab, deg: number): Oklab => {
  const r = (deg * Math.PI) / 180;
  return { L: c.L, a: c.a * Math.cos(r) - c.b * Math.sin(r), b: c.a * Math.sin(r) + c.b * Math.cos(r) };
};
const upTo = (limit: number, step: number) => {
  const n = Math.max(1, Math.ceil(limit / step - 1e-9));
  return Array.from({ length: n + 1 }, (_, i) => (i === n ? limit : (i * limit) / n));
};

/** An ink and how far it can cover: 1 for a solid edge, its alpha for a shadow. */
interface Ink {
  readonly colour: ColorValue;
  readonly coverage: number;
}

// Plain fields only: Node's type stripping (the evidence scripts load this module) has no
// parameter properties.
class Family {
  readonly family: string;
  design: BlendMax = { chroma: 0, hue: NaN, coverage: NaN };
  check: BlendMax & { pixel?: Bytes } = { chroma: 0, hue: NaN, coverage: NaN };
  private readonly seen = new Set<string>();

  constructor(family: string) {
    this.family = family;
  }

  float(bg: Srgb, ink: Srgb, coverage: number): void {
    const found = maxInBandOnSrgbBlend(bg, ink, DESIGN_BAND, coverage);
    if (found.chroma > this.design.chroma) this.design = found;
  }

  pixels(bg: Bytes, ink: Bytes, coverage: number): void {
    const cap = Math.min(254, Math.max(1, Math.ceil(coverage * 255)));
    const key = `${bg.join(',')}>${ink.join(',')}@${cap}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    const found = maxInBandOnPixelBlend(bg, ink, CHECK_BAND, cap);
    if (found.chroma > this.check.chroma) this.check = found;
  }

  result(): EdgeFamilyMax {
    return { family: this.family, design: this.design, check: this.check };
  }
}

export function edgeFamiliesFor(id: DirectionId, face: Face): EdgeFamilyMax[] {
  const d = DIRECTIONS[id];
  const c = d.color[face];
  const tier = tierFor(face);
  const kp = d.field.pivot;
  const amplitude = amplitudeFor(id);
  const presences = [0.25, 0.5, 1].map((p) => p * d.bead.chromaScale);
  const shimmers = d.field.shimmer.deg > 0 ? [-d.field.shimmer.deg, 0, d.field.shimmer.deg] : [0];
  const anchors = QUADRANTS.map((q) => lab(BASE.emotion[q][tier]));
  const srgb = (x: Oklab) => sweepOklabToSrgb(x);

  // Surfaces lit by a halo (no shimmer: marks never shimmer) or by the field (which shimmers).
  const lit = (ground: Oklab, nodes: Oklab[], kMax: number, turns: number[], kStep: number): Oklab[] => {
    const out: Oklab[] = [];
    for (const node of nodes) {
      for (const p of presences) {
        for (const phi of turns) {
          for (const k of upTo(kMax, kStep)) out.push(pivotComposite(rotate(scale(node, p), phi), ground, k, kp));
        }
      }
    }
    return out;
  };
  // Grain and dither move a surface pixel on L only, by up to ±amplitude. Each lit surface is taken
  // at L − amplitude, L and L + amplitude ("grain at both extremes", designer §1.2 step 1), in float
  // and as its 8-bit pixel (a rounding tie either way).
  const shifted = (colours: Oklab[]): Oklab[] =>
    colours.flatMap((colour) => [-amplitude, 0, amplitude].map((delta) => ({ L: colour.L + delta, a: colour.a, b: colour.b })));
  const quantised = (colours: Oklab[]): Bytes[] => {
    const out = new Map<string, Bytes>();
    for (const colour of colours) {
      for (const p of ditherReachable(colour, 0)) {
        const bytes = toBytes(p);
        out.set(bytes.join(','), bytes);
      }
    }
    return [...out.values()];
  };
  const ring = lab(c.plate.ring);
  const faceGround = lab(c.plate.face);
  const fieldNodes = [...anchors, lab(c.field.restGlow)];
  const ringFloat = shifted(lit(ring, anchors, haloPeak(face), [0], 0.01));
  const ringBytes = quantised(shifted(lit(ring, anchors, haloPeak(face), [0], 0.05)));
  const faceFloat = shifted([
    ...lit(faceGround, anchors, haloPeak(face), [0], 0.01),
    ...(d.field.mask.face > 0 ? lit(faceGround, fieldNodes, d.field.cap[face], shimmers, 0.01) : []),
  ]);
  const faceBytes = quantised(
    shifted([
      ...lit(faceGround, anchors, haloPeak(face), [0], 0.05),
      ...(d.field.mask.face > 0 ? lit(faceGround, fieldNodes, d.field.cap[face], shimmers, 0.05) : []),
    ]),
  );

  const shadows: Ink[] = [{ colour: c.bead.shadow, coverage: c.bead.shadow.alpha }];
  const levels = ['none', 'e1', 'e2', 'raised', 'recessed'] as const;
  const elevation: Ink[] = levels.flatMap((level) => d.elevation[level][face].map((layer) => ({ colour: layer.color, coverage: layer.color.alpha })));

  const families: Family[] = [];
  const over = (name: string, bgFloat: Oklab[], bgBytes: Bytes[], inks: Ink[]) => {
    const family = new Family(name);
    for (const ink of inks) {
      const inkFloat = srgb(lab(ink.colour));
      const inkBytes = hexBytes(ink.colour);
      for (const bg of bgFloat) family.float(srgb(bg), inkFloat, ink.coverage);
      for (const bg of bgBytes) family.pixels(bg, inkBytes, ink.coverage);
    }
    families.push(family);
  };
  const solid = (colour: ColorValue): Ink => ({ colour, coverage: 1 });

  // The ring, lit by halos: the rim words, the rim stroke, the highlight line, settings, shadows.
  over('ring halo · text.primary', ringFloat, ringBytes, [solid(c.text.primary)]);
  over('ring halo · plate.rim.base', ringFloat, ringBytes, [solid(c.plate.rim.base)]);
  over('ring halo · plate.rim.lit', ringFloat, ringBytes, [solid(c.plate.rim.lit)]);
  over('ring halo · plate.ringHighlight', ringFloat, ringBytes, [solid(c.plate.ringHighlight)]);
  over('ring halo · bead.setting', ringFloat, ringBytes, [solid(c.bead.setting)]);
  over('ring halo · bead.shadow at α', ringFloat, ringBytes, shadows);
  if (elevation.length > 0) over('ring halo · elevation shadows at α', ringFloat, ringBytes, elevation);
  // The face, lit by halos and (where the mask lets it in) by the field.
  over('face lit · bead.setting', faceFloat, faceBytes, [solid(c.bead.setting)]);
  over('face lit · bead.shadow at α', faceFloat, faceBytes, shadows);
  if (elevation.length > 0) over('face lit · elevation shadows at α', faceFloat, faceBytes, elevation);

  // Beads: each fill against its setting ring, and its fill-to-highlight gradient.
  const white = { L: 1, a: 0, b: 0 };
  const fills = anchors.flatMap((node) => presences.map((p) => scale(node, p)));
  const pairsOf = (name: string, pairs: Array<[Oklab, Oklab]>) => {
    const family = new Family(name);
    for (const [a, b] of pairs) {
      family.float(srgb(a), srgb(b), 1);
      family.pixels(toBytes(srgb(a)), toBytes(srgb(b)), 1);
    }
    families.push(family);
  };
  pairsOf('bead fill · bead.setting', fills.map((f) => [f, lab(c.bead.setting)]));
  pairsOf('bead fill · highlight', fills.map((f) => [f, mixOklab(f, white, d.bead.highlight.mix)]));

  // The CTA: the four tints and the neutral fill, and every mixSafe step between any two of them.
  const ends = [...anchors, lab(c.text.primary)];
  const ctaFills: Oklab[] = [...ends];
  for (const from of ends) {
    for (const to of ends) {
      if (from === to) continue;
      for (let i = 1; i < 20; i++) ctaFills.push(mixSafe(from, to, i / 20, DESIGN_BAND));
    }
  }
  pairsOf('CTA fill · text.onTint', ctaFills.map((f) => [f, lab(c.text.onTint)]));
  pairsOf('CTA fill · text.onInk', ctaFills.map((f) => [f, lab(c.text.onInk)]));
  if (d.cta.keyline > 0) {
    const keyline = (f: Oklab): Oklab => ({ L: f.L, a: 0, b: 0 });
    pairsOf('CTA fill · keyline', ctaFills.map((f) => [f, keyline(f)]));
    pairsOf('CTA keyline · ground', ctaFills.map((f) => [keyline(f), lab(c.ground)]));
  } else {
    pairsOf('CTA fill · ground', ctaFills.map((f) => [f, lab(c.ground)]));
  }
  return families.map((family) => family.result());
}
