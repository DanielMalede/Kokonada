// The grain swatch's frames (B8-4; UI-092; the second critic's grain gate, v1b-B4-second-critic.md §3; the architect's B8
// plan, F7 ruled A: the owner judges the grain on the device, in one sitting, and no token changes before he does).
//
// A grain scene, `grain.abyss.<face>.<tier>`, draws the hero's rest field (no taps) as FieldView draws its first frame:
// fieldStep on a fresh ledger, the dev preview's params (stress 0, confidence 1, no genesis), the breath at the clock's
// time. That one packed frame is drawn three times, its two grain floats (uNoise's first two: inside the face, and
// elsewhere) at ×1, ×0.71 and ×0.5 of what the token put there. The scaling happens here, at draw time; the token stays as
// it is (Abyss ±0.012 / ±0.012). So the three frames differ only in grain, by construction: the same array, two floats
// scaled. ×0.71 is the RMS between them (1/√2), ×0.5 restores V0's peak (the critic's units correction).
//
// The tier's renderScale is field.tiers' own (full 0.5, low 0.33), the one FieldView takes for that tier.
//
// Imports carry their .ts extension, so a Node board script can render the same frames on CanvasKit (no Metro). Every
// function a frame is made with is a worklet: the scene derives the frames on the UI thread.

import { fieldStep, type FieldStep, type FrameParams } from '../../v2/field/fieldDriver.ts';
import { fixedFieldBreath, type FieldGeometry, type FieldStatics } from '../../v2/field/fieldFrame.ts';
import type { Ledger } from '../../v2/field/placementLedger.ts';
import { FIELD_UNIFORMS, FIELD_UNIFORM_FLOATS } from '../../v2/field/uniforms.ts';
import { BASE, type DirectionId, type Face } from '../../v2/tokens/tokens.generated.ts';

export const GRAIN_DIRECTION: DirectionId = 'abyss';
export const GRAIN_FACES: readonly Face[] = ['dark', 'light'];
export const GRAIN_TIERS = ['full', 'low'] as const;
export type GrainTier = (typeof GRAIN_TIERS)[number];
/** The hero scene the swatch draws: rest, the field with nothing placed (the lens edge under the vignette). */
export const GRAIN_HERO = 'rest';

/** The strengths, left to right: the token as it is, the RMS between, and V0's peak (the critic's three). */
export const GRAIN_FACTORS = [1, 0.71, 0.5] as const;

export interface GrainSceneSpec {
  readonly id: string;
  readonly direction: DirectionId;
  readonly face: Face;
  readonly hero: typeof GRAIN_HERO;
  readonly tier: GrainTier;
  /** field.tiers.<tier>.renderScale. */
  readonly renderScale: number;
  /** The field's master period: the lab's clocks run within [0, T). */
  readonly periodMs: number;
}

function specs(): Record<string, GrainSceneSpec> {
  const out: Record<string, GrainSceneSpec> = {};
  for (const face of GRAIN_FACES) {
    for (const tier of GRAIN_TIERS) {
      const id = `grain.${GRAIN_DIRECTION}.${face}.${tier}`;
      out[id] = { id, direction: GRAIN_DIRECTION, face, hero: GRAIN_HERO, tier, renderScale: BASE.field.tiers[tier].renderScale, periodMs: BASE.field.clock.T };
    }
  }
  return out;
}

export const GRAIN_SPECS: Readonly<Record<string, GrainSceneSpec>> = specs();

/** A launch's grain scene by id; any other id is a programming error. */
export function grainSpec(id: string): GrainSceneSpec {
  if (!Object.prototype.hasOwnProperty.call(GRAIN_SPECS, id)) throw new Error(`"${id}" is not a lab grain scene`);
  return GRAIN_SPECS[id];
}

/** The frame's params: the scene's face and tier, the dev preview's stress, confidence and genesis. */
export function grainParams(spec: GrainSceneSpec): FrameParams {
  return { direction: spec.direction, face: spec.face, stress: 0, confidence: 1, genesis: false, tier: spec.tier };
}

/** The probe of a strength's strip. */
export const grainProbeId = (factor: number): string => `grain.x${factor.toFixed(2)}`;

const NOISE = (() => {
  let at = 0;
  for (const u of FIELD_UNIFORMS) {
    if (u.name === 'uNoise') return at;
    at += u.floats;
  }
  throw new Error('the field uniforms have no uNoise');
})();
/** The grain's two floats in the packed frame: inside the face, and elsewhere (uNoise's third is the dither). */
export const GRAIN_INDICES: readonly [number, number] = [NOISE, NOISE + 1];

/** The packed frame with its grain scaled by `factor` (a new array): every other float as it was given. */
export function scaleGrain(uniforms: readonly number[], factor: number): number[] {
  'worklet';
  if (!(Number.isFinite(factor) && factor >= 0)) throw new RangeError(`a grain factor must be finite and 0 or more, got ${factor}`);
  if (uniforms.length !== FIELD_UNIFORM_FLOATS) throw new RangeError(`a packed field frame has ${FIELD_UNIFORM_FLOATS} floats, got ${uniforms.length}`);
  const out = uniforms.slice();
  out[GRAIN_INDICES[0]] = uniforms[GRAIN_INDICES[0]] * factor;
  out[GRAIN_INDICES[1]] = uniforms[GRAIN_INDICES[1]] * factor;
  return out;
}

/** One frame at each strength, in GRAIN_FACTORS' order; no frame is nothing at every strength. */
export function grainStrips(base: readonly number[] | null): Array<number[] | null> {
  'worklet';
  return GRAIN_FACTORS.map((k) => (base === null ? null : scaleGrain(base, k)));
}

/**
 * The base frame at the clock's time: FieldView's first frame of the rest scene, step for step (the empty ledger at seq 0
 * with no taps, the breath at the clock's time), so the ledger never moves and the frame is a function of t alone.
 */
export function grainBase(ledger: Ledger, params: FrameParams, geometry: FieldGeometry, statics: FieldStatics, tMs: number): FieldStep {
  'worklet';
  const phase = fixedFieldBreath(params.direction, params.stress, tMs).phase;
  return fieldStep(ledger, { seq: 0, taps: [] }, 0, params, geometry, statics, tMs, phase);
}

/** A strip's width in dp: a third of the view, in whole device pixels. */
export function stripWidth(width: number, pxPerDp: number): number {
  return Math.floor((width * pxPerDp) / 3 + 1e-6) / pxPerDp;
}
