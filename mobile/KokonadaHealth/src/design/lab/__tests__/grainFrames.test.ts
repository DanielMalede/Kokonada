import { fieldStep, renderGeometry, renderScaleFor, type FrameParams } from '../../v2/field/fieldDriver';
import { heroLayout, PHONE } from '../../v2/field/fallbackScenes';
import { buildFieldFrame, fixedFieldBreath } from '../../v2/field/fieldFrame';
import { emptyLedger, type Ledger } from '../../v2/field/placementLedger';
import { ledgerConfigFor } from '../../v2/field/statics';
import { FIELD_UNIFORMS, packFrame } from '../../v2/field/uniforms';
import { BASE, DIRECTIONS } from '../../v2/tokens/tokens.generated';
import {
  GRAIN_FACTORS, GRAIN_INDICES, GRAIN_SPECS, grainBase, grainParams, grainProbeId, grainSpec, grainStrips, scaleGrain, stripWidth,
} from '../grain/grainFrames';
import { FIELD_STATICS } from '../fieldScenes';

// B8-4, the grain swatch (UI-092; the second critic's grain gate, v1b-B4-second-critic.md §3; the architect's B8 plan, F7
// ruled A: the owner judges the grain on the device, and no token changes before he does). Each scene draws the hero's
// rest field through the shipped path (fieldStep: ledger, fades, builder, pack), then the same packed frame three times,
// its grain amplitudes at ×1, ×0.71 and ×0.5 of the token, scaled at draw time. The frames differ only in grain.

const W = PHONE.width;
const H = PHONE.height;
const PX = PHONE.pxPerDp;
const OFFSET: Record<string, number> = {};
FIELD_UNIFORMS.reduce((at, u) => { OFFSET[u.name] = at; return at + u.floats; }, 0);

function setup(id: string, tMs = DIRECTIONS.abyss.field.stillTime) {
  const spec = grainSpec(id);
  const layout = heroLayout(spec.direction, W, H, 1);
  const geometry = renderGeometry(layout, PX, spec.renderScale);
  const ledger: Ledger = emptyLedger(ledgerConfigFor(spec.direction, spec.face, FIELD_STATICS, geometry));
  const params = grainParams(spec);
  return { spec, layout, geometry, ledger, params, step: grainBase(ledger, params, geometry, FIELD_STATICS, tMs) };
}

describe('the grain scenes: grain.abyss.<face>.<tier>, Abyss on both faces at the tiers full and low', () => {
  it('names exactly the four scenes, each carrying its facts', () => {
    expect(Object.keys(GRAIN_SPECS).sort()).toEqual(['grain.abyss.dark.full', 'grain.abyss.dark.low', 'grain.abyss.light.full', 'grain.abyss.light.low']);
    for (const [id, s] of Object.entries(GRAIN_SPECS)) {
      expect(s.id).toBe(id);
      expect(id).toBe(`grain.${s.direction}.${s.face}.${s.tier}`);
      expect([s.direction, s.hero]).toEqual(['abyss', 'rest']);
      expect(s.periodMs).toBe(BASE.field.clock.T);
    }
  });

  it("each tier's renderScale is field.tiers' own (full 0.5, low 0.33), the one FieldView takes for that tier", () => {
    expect(BASE.field.tiers.full.renderScale).not.toBe(BASE.field.tiers.low.renderScale);
    for (const face of ['dark', 'light']) {
      expect(grainSpec(`grain.abyss.${face}.full`).renderScale).toBe(BASE.field.tiers.full.renderScale);
      expect(grainSpec(`grain.abyss.${face}.low`).renderScale).toBe(BASE.field.tiers.low.renderScale);
      expect(grainSpec(`grain.abyss.${face}.low`).renderScale).toBe(renderScaleFor('low'));
      expect(grainSpec(`grain.abyss.${face}.full`).renderScale).toBe(renderScaleFor('full'));
    }
  });

  it('an id that is not a grain scene is an Error naming it', () => {
    expect(() => grainSpec('grain.abyss.dark.still')).toThrow('"grain.abyss.dark.still"');
    expect(() => grainSpec('toString')).toThrow('"toString"');
  });

  it("the frame's params are the dev preview's (stress 0, confidence 1, no genesis), at the scene's face and tier", () => {
    const s = grainSpec('grain.abyss.light.low');
    expect(grainParams(s)).toEqual({ direction: 'abyss', face: 'light', stress: 0, confidence: 1, genesis: false, tier: 'low' });
  });
});

describe('the strengths: the token ×1, ×0.71 and ×0.5, left to right', () => {
  it('are exactly the ruling\'s three, in order', () => {
    expect(GRAIN_FACTORS).toEqual([1, 0.71, 0.5]);
  });

  it('each strip has a probe named by its strength', () => {
    expect(GRAIN_FACTORS.map(grainProbeId)).toEqual(['grain.x1.00', 'grain.x0.71', 'grain.x0.50']);
  });

  it("the grain's two floats are uNoise's first two (inside the face, elsewhere), never the dither", () => {
    expect(GRAIN_INDICES).toEqual([OFFSET.uNoise, OFFSET.uNoise + 1]);
    const frame = buildFieldFrame(
      { direction: 'abyss', face: 'dark', placements: [], stress: 0, confidence: 1, genesis: false, tMs: 0, breathPhase: 0, tier: 'full', restFade: 1 },
      renderGeometry(heroLayout('abyss', W, H, 1), PX, 0.5), FIELD_STATICS,
    );
    const packed = packFrame({ ...frame, grain: { inside: 0.031, ground: 0.047 }, dither: 0.0029 });
    expect(GRAIN_INDICES.map((i) => packed[i])).toEqual([0.031, 0.047]);
    expect(packed[OFFSET.uNoise + 2]).toBe(0.0029);
  });
});

describe('scaleGrain: the packed frame with its grain scaled, and nothing else', () => {
  // A planted frame whose grain is not the token's: the scale must read the frame, never the token as a constant.
  const planted = Array.from({ length: FIELD_UNIFORMS.reduce((n, u) => n + u.floats, 0) }, (_, i) => 0.001 * (i + 1));
  planted[GRAIN_INDICES[0]] = 0.03;
  planted[GRAIN_INDICES[1]] = 0.05;

  it.each(GRAIN_FACTORS.map((k) => [k]))('×%s scales both grain floats of the frame it is given', (k) => {
    const out = scaleGrain(planted, k);
    expect(out[GRAIN_INDICES[0]]).toBeCloseTo(0.03 * k, 12);
    expect(out[GRAIN_INDICES[1]]).toBeCloseTo(0.05 * k, 12);
  });

  it('changes no other float, and never the frame it was given', () => {
    const copy = [...planted];
    const out = scaleGrain(planted, 0.5);
    expect(planted).toEqual(copy);
    expect(out).not.toBe(planted);
    expect(out).toHaveLength(planted.length);
    out.forEach((v, i) => { if (!GRAIN_INDICES.includes(i)) expect(v).toBe(planted[i]); });
  });

  it.each([[-0.5], [Number.NaN], [Number.POSITIVE_INFINITY]])('a factor of %s is a RangeError', (k) => {
    expect(() => scaleGrain(planted, k)).toThrow(RangeError);
  });

  it('a frame of the wrong length is a RangeError', () => {
    expect(() => scaleGrain(planted.slice(1), 1)).toThrow(RangeError);
  });

  it('grainStrips: the three strengths of one frame, in order; no frame gives three nothings', () => {
    const strips = grainStrips(planted);
    expect(strips).toHaveLength(3);
    strips.forEach((s, i) => expect(s).toEqual(scaleGrain(planted, GRAIN_FACTORS[i])));
    expect(grainStrips(null)).toEqual([null, null, null]);
  });
});

describe('the base frame is the shipped path: the hero rest scene, FieldView\'s first frame (fieldStep on a fresh ledger)', () => {
  it.each(Object.keys(GRAIN_SPECS))('%s: the frame fieldStep packs, no error', (id) => {
    const { spec, geometry, ledger, step } = setup(id);
    expect(step.error).toBeNull();
    const tMs = DIRECTIONS.abyss.field.stillTime;
    const params: FrameParams = { direction: 'abyss', face: spec.face, stress: 0, confidence: 1, genesis: false, tier: spec.tier };
    const shipped = fieldStep(ledger, { seq: 0, taps: [] }, 0, params, geometry, FIELD_STATICS, tMs, fixedFieldBreath('abyss', 0, tMs).phase);
    expect(step.uniforms).toEqual(shipped.uniforms);
  });

  it("the token's grain reaches the frame unchanged (no token change: Abyss ±0.012 / ±0.012 until the owner rules)", () => {
    expect(DIRECTIONS.abyss.field.grain).toEqual({ inside: 0.012, ground: 0.012 });
    const { step } = setup('grain.abyss.dark.full');
    expect(GRAIN_INDICES.map((i) => step.uniforms![i])).toEqual([0.012, 0.012]);
  });

  it('the base follows the clock: two times give two frames', () => {
    const a = setup('grain.abyss.dark.full', 1000).step.uniforms!;
    const b = setup('grain.abyss.dark.full', 9000).step.uniforms!;
    expect(a).not.toEqual(b);
  });

  it.each(Object.keys(GRAIN_SPECS))('%s: the three strips differ from one another only in the two grain floats, by the factors', (id) => {
    const { step } = setup(id);
    const strips = grainStrips(step.uniforms);
    const base = step.uniforms!;
    for (const [i, s] of strips.entries()) {
      expect(s).toHaveLength(base.length);
      const changed = s!.map((v, j) => (v === base[j] ? -1 : j)).filter((j) => j >= 0);
      expect(changed).toEqual(GRAIN_FACTORS[i] === 1 ? [] : GRAIN_INDICES);
      for (const g of GRAIN_INDICES) expect(s![g]).toBeCloseTo(base[g] * GRAIN_FACTORS[i], 12);
    }
  });

  it('the tier reaches the frame: low draws fewer warp octaves than full (the frame is the tier\'s)', () => {
    const full = setup('grain.abyss.dark.full').step.uniforms!;
    const low = setup('grain.abyss.dark.low').step.uniforms!;
    expect(full[OFFSET.uOctaves]).toBe(BASE.field.tiers.full.octaves);
    expect(low[OFFSET.uOctaves]).toBe(BASE.field.tiers.low.octaves);
  });

  it('the face reaches the frame: the ground is the face\'s', () => {
    const dark = setup('grain.abyss.dark.full').step.uniforms!;
    const light = setup('grain.abyss.light.full').step.uniforms!;
    const ground = (u: number[]) => u.slice(OFFSET.uGroundOutside, OFFSET.uGroundOutside + 3);
    expect(ground(dark)).toEqual([...DIRECTIONS.abyss.color.dark.ground.oklab]);
    expect(ground(light)).toEqual([...DIRECTIONS.abyss.color.light.ground.oklab]);
  });
});

describe('stripWidth: a third of the view, in whole device pixels', () => {
  it.each([[PHONE.width, PHONE.pxPerDp], [384, 2.8125], [411, 2.625], [360, 3], [393.7, 2.75]])('%s dp at %s px/dp', (w, px) => {
    const s = stripWidth(w, px);
    expect(Number.isInteger(Math.round(s * px * 1e6) / 1e6)).toBe(true);
    expect(3 * s).toBeLessThanOrEqual(w + 1e-9);
    expect(w - 3 * s).toBeLessThan(3 / px);
  });

  it('the board phone: 1080 px is three strips of 360 px', () => {
    expect(stripWidth(PHONE.width, PHONE.pxPerDp) * PHONE.pxPerDp).toBeCloseTo(360, 9);
  });
});
