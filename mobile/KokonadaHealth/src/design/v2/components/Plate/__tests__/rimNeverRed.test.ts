import { pivotComposite } from '../../../color/blendSpace.ts';
import { maxInBandOnPixelBlend, maxInBandOnSrgbBlend, type Bytes } from '../../../color/edgeSweep.ts';
import type { Oklab, Srgb } from '../../../color/oklab.ts';
import { hueInBand } from '../../../color/redBand.ts';
import { sweepOklabToSrgb, sweepSrgbToOklab } from '../../../color/sweepConvert.ts';
import { CHECK_BAND, DESIGN_BAND, lab, plateShadowGrounds, ringOuterGrounds, tierFor } from '../../../tokens/neverRedSweeps.ts';
import { BASE, DIRECTIONS, type DirectionId, type Face } from '../../../tokens/tokens.generated.ts';
import { plateGeometry } from '../geometry.ts';
import { rimPlan, type RimPlan } from '../rim.ts';

// Never red (DSN-013, QA-065) on the rim keyline as Skia draws it. The edge sweep (neverRedSweeps.ts) already holds the
// gradient's two end colours, plate.rim.base and plate.rim.lit, over the halo-lit ring on its own grids. What it cannot
// see is what the plate adds: every colour between the two on the lit gradient (Skia interpolates it in sRGB), and the
// keyline's outer fringe over the moat. Each such ink is swept here against every ground the keyline meets, with the
// sweep's own blend checks: float sRGB blends against the design band, 8-bit blends (every GPU rounding of the blend)
// against the check band, both inside DEC-081's margin.
//
// The grids are coarse, for the default run: the halo weight every 0.05 in float and every 0.1 on pixels (the edge
// sweep's own coarse byte step), the gradient every 1/8. The full-resolution sweeps project cannot hold this file: its
// CI filter does not watch src/design/v2/components/ (ci.yml, sweeps-changes), and jestProjects.test.ts pins that it
// watches every file a sweep imports. That is a row for the owner's instruction layer, not this lane.

const IDS = Object.keys(DIRECTIONS) as DirectionId[];
const FACES: readonly Face[] = ['dark', 'light'];
const DESIGN_LIMIT = DESIGN_BAND.chromaFloor - BASE.neverRed.margin;
const CHECK_LIMIT = CHECK_BAND.chromaFloor - BASE.neverRed.margin;
const GRID = { float: { kStep: 0.05, presences: [0.25, 0.5, 1] }, bytes: { kStep: 0.1, presences: [0.5, 1] }, steps: 8 } as const;

const toBytes = (rgb: Srgb): Bytes => rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255)) as unknown as Bytes;
const scale = (c: Oklab, p: number): Oklab => ({ L: c.L, a: c.a * p, b: c.b * p });
const upTo = (limit: number, step: number) => Array.from({ length: Math.ceil(limit / step - 1e-9) + 1 }, (_, i) => Math.min(limit, i * step));

/** The grounds the keyline meets: the moat (the ground, and any ground an outer shadow reaches), the ring and its outer band, those inside the rim lit by every halo. */
function groundsOf(id: DirectionId, face: Face, grid: { readonly kStep: number; readonly presences: readonly number[] }): Oklab[] {
  const d = DIRECTIONS[id];
  const c = d.color[face];
  const ring = lab(c.plate.ring);
  const band = Object.values(ringOuterGrounds(id, face, 'coarse'));
  const peak = face === 'dark' ? BASE.field.halo.peakDark : BASE.field.halo.peakLight;
  const anchors = (['joy', 'calm', 'reflective', 'intense'] as const).map((q) => lab(BASE.emotion[q][tierFor(face)]));
  const lit = [ring, ...band].flatMap((ground) => anchors.flatMap((node) => grid.presences.flatMap((p) => upTo(peak, grid.kStep).map((k) => pivotComposite(scale(node, p * d.bead.chromaScale), ground, k, d.field.pivot)))));
  return [...Object.values(plateShadowGrounds(id, face).ground), ring, ...band, ...lit];
}

/** The gradient's colour `s` of the way down, as Skia interpolates it: in gamma-encoded sRGB, 0..255. */
const along = (plan: Pick<RimPlan, 'gradient'>, s: number) => [0, 1, 2].map((ch) => plan.gradient.top[ch] + (plan.gradient.bottom[ch] - plan.gradient.top[ch]) * s);

/** The largest in-band chroma over every ink and ground, in float and on pixels, and how many blends were seen. */
function sweep(id: DirectionId, face: Face, plan: Pick<RimPlan, 'gradient'>) {
  const steps = Array.from({ length: GRID.steps + 1 }, (_, i) => i / GRID.steps);
  let design = 0;
  let check = 0;
  let blends = 0;
  // Float: every ground, every step of the gradient.
  for (const g of groundsOf(id, face, GRID.float)) {
    const bg = sweepOklabToSrgb(g);
    for (const s of steps) {
      design = Math.max(design, maxInBandOnSrgbBlend(bg, along(plan, s).map((v) => v / 255) as unknown as Srgb, DESIGN_BAND, 1).chroma);
      blends += 1;
    }
  }
  // 8-bit: every distinct ground pixel against every gradient pixel.
  const grounds = new Map(groundsOf(id, face, GRID.bytes).map((g) => toBytes(sweepOklabToSrgb(g))).map((b) => [b.join(','), b]));
  const inks = new Map(steps.map((s) => along(plan, s).map(Math.round) as unknown as Bytes).map((b) => [b.join(','), b]));
  for (const bg of grounds.values()) {
    for (const ink of inks.values()) {
      check = Math.max(check, maxInBandOnPixelBlend(bg, ink, CHECK_BAND, 254).chroma);
      blends += 1;
    }
  }
  // The keyline's opaque core: each gradient pixel itself, every channel rounded either way.
  for (const s of steps) {
    const v = along(plan, s);
    for (let m = 0; m < 8; m++) {
      const px = v.map((x, ch) => (Math.floor(m / 2 ** ch) % 2 === 1 ? Math.ceil(x) : Math.floor(x)) / 255) as unknown as Srgb;
      const o = sweepSrgbToOklab(px);
      const hue = (((Math.atan2(o.b, o.a) * 180) / Math.PI) % 360 + 360) % 360;
      if (hueInBand(hue, CHECK_BAND)) check = Math.max(check, Math.hypot(o.a, o.b));
    }
  }
  return { design, check, blends };
}

describe.each(IDS)('%s: the rim keyline is never red', (id) => {
  it.each(FACES)('%s: every colour of the lit gradient, over every ground it meets, keeps both bands’ margin', (face) => {
    const t = { base: BASE, direction: DIRECTIONS[id], color: DIRECTIONS[id].color[face] };
    const result = sweep(id, face, rimPlan(t, plateGeometry(t, 296, 1)));
    expect(result.blends).toBeGreaterThan(5000);
    expect(result.design).toBeLessThan(DESIGN_LIMIT);
    expect(result.check).toBeLessThan(CHECK_LIMIT);
  });
});

it('bites: a gradient planted with a red top breaks the margin of both bands', () => {
  const t = { base: BASE, direction: DIRECTIONS.abyss, color: DIRECTIONS.abyss.color.dark };
  const plan = rimPlan(t, plateGeometry(t, 296, 1));
  const result = sweep('abyss', 'dark', { gradient: { ...plan.gradient, top: [200, 64, 72] } });
  expect(result.design).toBeGreaterThanOrEqual(DESIGN_LIMIT);
  expect(result.check).toBeGreaterThanOrEqual(CHECK_LIMIT);
});
