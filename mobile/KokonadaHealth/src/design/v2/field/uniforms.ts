// The field's uniform layout, and the packing of a FieldFrame into it: the contract between the
// builder (TypeScript) and the shader (fieldShader.ts). fieldShader.skia.test.ts pins this list to
// the compiled effect's own uniform names, sizes and slots.
//
// packFrame runs on the UI thread (FieldView derives the uniforms there), so every function here is
// a worklet (workletSafe.test.ts).
//
// The nodes are unrolled (uNode0 … uNode5, one per NODE_SLOTS): SkSL's strict ES2 rules forbid indexing a uniform array
// with a computed index, and separate uniforms keep each slot unambiguous.

import { NODE_SLOTS, QUIET_SLOTS, SHADOW_SLOTS, type FieldFrame } from './fieldLaw.ts';

export interface FieldUniform {
  readonly name: string;
  readonly floats: number;
}

const NODE_UNIFORMS = (k: number): FieldUniform[] => {
  'worklet';
  return [
    { name: `uNode${k}`, floats: 4 }, // centre.x, centre.y, radius, fade
    { name: `uNode${k}Bead`, floats: 4 }, // bead.x, bead.y, has a halo (0 or 1), node id
    { name: `uNode${k}Field`, floats: 3 }, // OKLab
    { name: `uNode${k}Halo`, floats: 3 }, // OKLab
  ];
};

export const FIELD_UNIFORMS: readonly FieldUniform[] = [
  { name: 'uGeom', floats: 4 }, // centre.x, centre.y (px), R (px), ring inner edge
  { name: 'uGeom2', floats: 4 }, // moat outer edge, moat feather, bead radius, halo radius
  { name: 'uMask', floats: 3 }, // outside, face, ring
  { name: 'uGroundOutside', floats: 3 },
  { name: 'uGroundFace', floats: 3 },
  { name: 'uGroundRing', floats: 3 },
  { name: 'uFace', floats: 2 }, // vignette, centre lift
  { name: 'uWeight', floats: 4 }, // kField, kMax, halo peak, kp
  { name: 'uWarp', floats: 4 }, // W(s), orbit, cos 2πt/T, sin 2πt/T
  { name: 'uOctaves', floats: 1 },
  { name: 'uShimmer', floats: 2 }, // cos φ, sin φ
  { name: 'uSelect', floats: 4 }, // λ, R0–I is a waypoint edge (0 or 1), κ the lobe's core, θ the triple fade
  { name: 'uNoise', floats: 3 }, // grain inside the face, grain elsewhere, dither
  // Quiet zones (designer r3 §1): each rect's centre and half-size in render px; unused slots are
  // inert through the count only.
  ...Array.from({ length: QUIET_SLOTS }, (_, k) => ({ name: `uQuiet${k}`, floats: 4 })),
  { name: 'uQuietParams', floats: 3 }, // grow (px), feather (px), count
  // Plate shadows (designer 2.9): offset (plate units, y up), blur (plate units), strength, mode.
  ...Array.from({ length: SHADOW_SLOTS }, (_, k) => ({ name: `uShadow${k}`, floats: 4 })),
  ...Array.from({ length: NODE_SLOTS }, (_, k) => NODE_UNIFORMS(k)).flat(),
];

export const FIELD_UNIFORM_FLOATS = FIELD_UNIFORMS.reduce((sum, u) => sum + u.floats, 0);

const finite = (v: number) => {
  'worklet';
  return Number.isFinite(v) ? v : 0;
};

/** The frame as the flat float list the effect takes, in FIELD_UNIFORMS order. A non-finite number packs as 0. */
export function packFrame(frame: FieldFrame): number[] {
  'worklet';
  if (frame.nodes.length !== NODE_SLOTS) {
    throw new RangeError(`a field frame has ${NODE_SLOTS} node slots, got ${frame.nodes.length}`);
  }
  if (frame.quiet.rects.length > QUIET_SLOTS) {
    throw new RangeError(`a field frame holds at most ${QUIET_SLOTS} quiet rects, got ${frame.quiet.rects.length}`);
  }
  if (frame.shadows.length !== SHADOW_SLOTS) {
    throw new RangeError(`a field frame has ${SHADOW_SLOTS} shadow slots, got ${frame.shadows.length}`);
  }
  const rects: number[] = [];
  for (let k = 0; k < QUIET_SLOTS; k++) {
    const r = frame.quiet.rects[k];
    if (r === undefined) rects.push(0, 0, 0, 0);
    else rects.push(r.cx, r.cy, r.hx, r.hy);
  }
  const lab = (c: { L: number; a: number; b: number }) => [c.L, c.a, c.b];
  const values = [
    frame.centrePx[0], frame.centrePx[1], frame.radiusPx, frame.ringInner,
    frame.moatOuter, frame.moatFeather, frame.beadRadius, frame.haloRadius,
    frame.mask.outside, frame.mask.face, frame.mask.ring,
    ...lab(frame.grounds.outside), ...lab(frame.grounds.face), ...lab(frame.grounds.ring),
    frame.vignette, frame.centreLift,
    frame.kField, frame.kMax, frame.haloPeak, frame.kp,
    frame.warp.amount, frame.warp.orbit, frame.warp.cos, frame.warp.sin,
    frame.warp.octaves,
    frame.shimmer.cos, frame.shimmer.sin,
    frame.lambda, frame.restIntenseWaypoint ? 1 : 0, frame.lobeCore, frame.tripleFade,
    frame.grain.inside, frame.grain.ground, frame.dither,
    ...rects,
    frame.quiet.grow, frame.quiet.feather, frame.quiet.rects.length,
    ...frame.shadows.flatMap((sh) => [sh.offset, sh.blur, sh.strength, sh.mode]),
    ...frame.nodes.flatMap((node) => [
      node.centre[0], node.centre[1], node.radius, node.fade,
      node.bead ? node.bead[0] : 0, node.bead ? node.bead[1] : 0, node.bead ? 1 : 0, node.id,
      ...lab(node.field),
      ...lab(node.halo),
    ]),
  ];
  return values.map(finite);
}
