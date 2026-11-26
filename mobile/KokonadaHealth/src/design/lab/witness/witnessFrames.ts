// The colour-path witness's frames (B8-2; the architect's B8 plan; B4 fork 2E; the designer's 3c amendments). Lab only.
//
// Per face, the witness colours are the four anchors at the face's tier (NODE_TIER: joy and intense flank the red band,
// so both are mandatory) and the face's ground, the largest surface, as a seam check. Each colour is drawn six ways:
//   · W1a  the field's runtime effect with every ground set to the colour, grain and dither 0 (and no vignette, centre
//          lift or shadow, which move the ground): the token hex is its expected value;
//   · W2   the token hex as a Skia paint;
//   · W3   the token hex as a React Native View;
//   · the planted wrong paths (displayP3.ts, B8-1): the bytes a P3 misread, a second encode or a skipped encode would
//          show, painted as Skia paints. A report must see each fail the witness, unless its model cannot move the colour
//          (D5's identity-only pairs), which the layout marks.
// W1b is the production field itself: the hero scene one.joy at the full tier, built as FieldView's own step builds it, at
// the hero's fixed time t* (field.stillTime). Its patch is compared, by the median of (render − the law's noise-free
// colour), with noiseFree(frame).
//
// Everything here is a pure function of the face (and the measured layout), so a report can rebuild every frame from the
// manifest. The W1b uniforms are the packed frame FieldSurface takes; the witness never mounts FieldView.

import { hexBytes, WITNESS_MODELS, type Bytes, type WitnessModel } from '../../v2/color/displayP3';
import type { Oklab } from '../../v2/color/oklab';
import { renderGeometry, renderScaleFor, stateFromLedger, type FieldLayout } from '../../v2/field/fieldDriver';
import { NODE_TIER, QUADRANT, buildFieldFrame, fixedFieldBreath, type FieldGeometry, type FieldState } from '../../v2/field/fieldFrame';
import { NODE, NODE_SLOTS, inertNode, inertShadow, type FieldFrame } from '../../v2/field/fieldLaw';
import { emptyLedger, fades, reconcile } from '../../v2/field/placementLedger';
import { ledgerConfigFor } from '../../v2/field/statics';
import { packFrame } from '../../v2/field/uniforms';
import type { MotionTier } from '../../v2/motion/useMotionPolicy';
import { BASE, DIRECTIONS, type DirectionId, type Face } from '../../v2/tokens/tokens.generated';
import { FIELD_FACES, FIELD_STATICS, sceneSpec } from '../fieldScenes';

export const WITNESS_DIRECTION: DirectionId = 'abyss';
/** W1b's hero scene and tier: joy, a mandatory anchor, at its own production frame. */
export const WITNESS_HERO = 'one.joy';
export const WITNESS_TIER: MotionTier = 'full';
/** W1b's time: the hero's fixed instant t*, the still's own time (field.stillTime). */
export const WITNESS_TIME_MS: number = DIRECTIONS[WITNESS_DIRECTION].field.stillTime;

export type WitnessColourName = 'joy' | 'calm' | 'reflective' | 'intense' | 'ground';
export interface WitnessColour {
  readonly name: WitnessColourName;
  readonly hex: string;
  readonly bytes: Bytes;
  readonly oklab: Oklab;
}

export type PatchKind = 'W1a' | 'W2' | 'W3' | WitnessModel;
export const PATCH_KINDS: readonly PatchKind[] = ['W1a', 'W2', 'W3', 'misreadAsP3', 'doubleEncode', 'skipEncode'];
const isPlanted = (kind: PatchKind): kind is WitnessModel => kind !== 'W1a' && kind !== 'W2' && kind !== 'W3';

const lab = (c: { readonly oklab: readonly number[] }): Oklab => ({ L: c.oklab[0], a: c.oklab[1], b: c.oklab[2] });
const colourOf = (name: WitnessColourName, token: { readonly hex: string; readonly oklab: readonly number[] }): WitnessColour =>
  ({ name, hex: token.hex, bytes: hexBytes(token.hex), oklab: lab(token) });

/** The face's witness colours: the four anchors at its tier, in node order (J, C, R, I), then its ground. */
export function witnessColours(face: Face): readonly WitnessColour[] {
  const anchors = Object.values(QUADRANT).map((emotion) => colourOf(emotion, BASE.emotion[emotion][NODE_TIER[face]]));
  return [...anchors, colourOf('ground', DIRECTIONS[WITNESS_DIRECTION].color[face].ground)];
}

/** The bytes a patch of the kind paints, or (W1a) is held to: the token's, or a planted model of them. */
export function patchBytes(kind: PatchKind, colour: WitnessColour): Bytes {
  return isPlanted(kind) ? WITNESS_MODELS[kind](colour.bytes) : colour.bytes;
}

/** Bytes as `#RRGGBB`, upper case, as the tokens write it. */
export function bytesHex(bytes: Bytes): string {
  // eslint-disable-next-line kokonada/no-color-literals -- the witness's own bytes as a paint: a token's hex or a planted model of it, never a hand-typed colour
  return `#${bytes.map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

export const witnessSceneId = (face: Face): string => `witness.${WITNESS_DIRECTION}.${face}`;

/** The face a witness scene id names; anything else is a programming error. */
export function witnessFace(id: string): Face {
  const face = FIELD_FACES.find((f) => witnessSceneId(f) === id);
  if (face === undefined) throw new Error(`"${id}" is not a witness scene`);
  return face;
}

/** A witness scene's facts, for the capture plan's `expect` (the architect's B8 plan, F4): W1b's frame. */
export interface WitnessSceneFacts {
  readonly id: string;
  readonly direction: DirectionId;
  readonly face: Face;
  readonly hero: string;
  readonly tier: MotionTier;
}
export const WITNESS_SCENE_FACTS: Readonly<Record<string, WitnessSceneFacts>> = Object.fromEntries(FIELD_FACES.map((face) => [
  witnessSceneId(face), { id: witnessSceneId(face), direction: WITNESS_DIRECTION, face, hero: WITNESS_HERO, tier: WITNESS_TIER },
]));

const PARAMS = (face: Face) => ({ direction: WITNESS_DIRECTION, face, stress: 0, confidence: 1, genesis: false, tier: WITNESS_TIER });

/**
 * W1a's frame over a render target of the given size: the face's frame with no placement, every ground the colour, one
 * lobe of the colour over it (as the shader's own anchor test draws it), and nothing that moves a ground: no grain,
 * dither, vignette, centre lift, shadow or quiet zone. Every pixel is the colour.
 */
export function w1aFrame(face: Face, colour: WitnessColour, size: { readonly width: number; readonly height: number }): FieldFrame {
  const geometry: FieldGeometry = { centrePx: [size.width / 2, size.height / 2], radiusPx: Math.max(size.width, size.height), pxPerDp: 1, fontScale: 1, quietRects: [] };
  const state: FieldState = { ...PARAMS(face), placements: [], restFade: 1, tMs: WITNESS_TIME_MS, breathPhase: 0 };
  const base = buildFieldFrame(state, geometry, FIELD_STATICS);
  const c = colour.oklab;
  return {
    ...base,
    grounds: { outside: c, face: c, ring: c },
    vignette: 0,
    centreLift: 0,
    grain: { inside: 0, ground: 0 },
    dither: 0,
    shimmer: { cos: 1, sin: 0 },
    shadows: [inertShadow(), inertShadow()],
    quiet: { ...base.quiet, rects: [], presence: [] },
    nodes: [{ id: NODE.J, fade: 1, centre: [0, 0], radius: 0.95, field: c, halo: c, bead: null }, ...Array.from({ length: NODE_SLOTS - 1 }, inertNode)],
  };
}

export interface W1bFrame {
  readonly frame: FieldFrame;
  /** The frame packed as FieldSurface takes it: fieldStep's own uniforms for the scene. */
  readonly uniforms: number[];
  readonly geometry: FieldGeometry;
  readonly renderScale: number;
}

/** W1b's frame on a measured layout: the hero scene one.joy, its first input shown at once, built and packed once. */
export function w1bFrame(face: Face, layout: FieldLayout, pxPerDp: number, renderScale: number = renderScaleFor(WITNESS_TIER)): W1bFrame {
  const spec = sceneSpec(`field.${WITNESS_DIRECTION}.${face}.${WITNESS_HERO}.${WITNESS_TIER}`, 'field');
  const geometry = renderGeometry(layout, pxPerDp, renderScale);
  const ledger = reconcile(emptyLedger(ledgerConfigFor(WITNESS_DIRECTION, face, FIELD_STATICS, geometry)), { seq: 0, taps: spec.taps }, 0, 'settle');
  const state = stateFromLedger(fades(ledger), PARAMS(face), WITNESS_TIME_MS, fixedFieldBreath(WITNESS_DIRECTION, 0, WITNESS_TIME_MS).phase);
  const frame = buildFieldFrame(state, geometry, FIELD_STATICS);
  return { frame, uniforms: packFrame(frame), geometry, renderScale };
}

/** The frame with no grain and no dither: the law's noise-free colour, W1b's reference. */
export function noiseFree(frame: FieldFrame): FieldFrame {
  return { ...frame, grain: { inside: 0, ground: 0 }, dither: 0 };
}
