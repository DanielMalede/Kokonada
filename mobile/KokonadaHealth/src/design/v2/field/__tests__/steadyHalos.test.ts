import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { BASE, DIRECTIONS, type DirectionId, type Face } from '../../tokens/tokens.generated.ts';
import { buildFieldFrame, type FieldState, type Placement } from '../fieldFrame.ts';
import { NODE, fieldOklab, nodeColour, regionOf, type FieldFrame, type FieldNodeFrame } from '../fieldLaw.ts';
import { staticsFor } from '../statics.ts';

// Designer 2.1 (node colour, corrected), with the critic's clause (accepted):
//   a bead node's colour is mix(turned field colour, steady halo colour, w_i),
//   w_i = smoothstep(−0.05, 0, h_i − k_field); a rest lobe's colour is its turned field colour;
//   the topTwoSoft weight is e_i = extent(x)·f_i + λ·h_i;
//   the mix is written (1 − w_i)·turned + w_i·halo, so where w_i = 1 it is the halo bit for bit.
// So wherever extent(x) = 0 a pixel depends on the halos alone, and is identical across t, s, c,
// genesis, the breath and the shimmer: the user's mark stays still (DSN-030, §1.6).

const IDS = Object.keys(DIRECTIONS) as DirectionId[];
const FACES: Face[] = ['dark', 'light'];
const R_DP = BASE.plate.maxDiameter / 2;
const geometry = { centrePx: [200, 200] as [number, number], radiusPx: 150, pxPerDp: 150 / R_DP, fontScale: 1 };

type Bead = { node: string; x: number; y: number };
const roots = EXTENSIONS as unknown as Record<string, { $root: { neverRedScenes?: Array<{ id: string; beads?: Bead[] }>; hardest?: Array<{ id: string; face?: string; node?: string; x?: number; y?: number }> } }>;
const three = (EXTENSIONS.base.$root.hero.scenes.three.placements as readonly Bead[]).filter((b) => b.node === 'C' || b.node === 'R');

/** The ringHalo scene's bead I (−0.02, r_b): from the direction's never-red scene, or its word.top placement where a direction names none. */
function ringBead(id: DirectionId): Bead {
  const scene = roots[id].$root.neverRedScenes?.find((s) => s.id === 'ringHalo');
  if (scene?.beads) return scene.beads[0];
  const word = roots[id].$root.hardest?.find((h) => h.id === 'word.top' && h.node === 'I');
  if (!word || word.x === undefined || word.y === undefined) throw new Error(`${id}: no I bead at r_b`);
  return { node: 'I', x: word.x, y: word.y };
}

const SHIMMER_PEAK_MS = BASE.field.clock.T / (4 * BASE.field.clock.shimmer.harmonic);

/** Two moments of one scene that differ in everything a halo must not feel. */
function pair(id: DirectionId, face: Face): [FieldFrame, FieldFrame, readonly Placement[]] {
  const placements = [ringBead(id), ...three].map(({ x, y }) => ({ x, y, fade: 1 }));
  const base = { direction: id, face, placements, tier: 'full' as const, restFade: 0 };
  // A: no tension, no inference, the shimmer at its positive peak (+deg: calm's b has crossed zero).
  const a: FieldState = { ...base, stress: 0, confidence: null, genesis: false, tMs: SHIMMER_PEAK_MS, breathPhase: 0.1 };
  // B: full tension, full confidence, genesis, another clock and another breath.
  const b: FieldState = { ...base, stress: 1, confidence: 1, genesis: true, tMs: 37000, breathPhase: 0.7 };
  const statics = staticsFor(id, EXTENSIONS as never);
  return [buildFieldFrame(a, geometry, statics), buildFieldFrame(b, geometry, statics), placements];
}

/** Pixel centres where the field is absent (extent 0 by the direction's mask) and some halo is lit. */
function steadyPixels(frame: FieldFrame): Array<{ x: number; y: number; nearest: number }> {
  const out: Array<{ x: number; y: number; nearest: number }> = [];
  const beads = frame.nodes.filter((n) => n.bead !== null && n.fade > 0);
  const reach = Math.ceil(frame.haloRadius * frame.radiusPx) + 1;
  const seen = new Set<string>();
  for (const node of beads) {
    const cx = frame.centrePx[0] + node.bead![0] * frame.radiusPx;
    const cy = frame.centrePx[1] - node.bead![1] * frame.radiusPx;
    for (let py = Math.floor(cy) - reach; py <= Math.ceil(cy) + reach; py++) {
      for (let px = Math.floor(cx) - reach; px <= Math.ceil(cx) + reach; px++) {
        const key = `${px},${py}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const x = px + 0.5;
        const y = py + 0.5;
        const qx = (x - frame.centrePx[0]) / frame.radiusPx;
        const qy = -(y - frame.centrePx[1]) / frame.radiusPx;
        const d = Math.hypot(qx, qy);
        const region = regionOf(d, frame);
        const absent = region === 'moat' || (region === 'ring' && frame.mask.ring === 0) || (region === 'face' && frame.mask.face === 0);
        const distances = beads.map((n) => Math.hypot(qx - n.bead![0], qy - n.bead![1]));
        const lit = d <= 1 && Math.min(...distances) < frame.haloRadius;
        if (absent && lit) out.push({ x, y, nearest: beads[distances.indexOf(Math.min(...distances))].id });
      }
    }
  }
  return out;
}

describe('where the field is absent, a pixel depends on the halos alone (designer 2.1)', () => {
  it('the label ring is field-free in every direction (the premise)', () => {
    expect(IDS.map((id) => DIRECTIONS[id].field.mask.ring)).toEqual(IDS.map(() => 0));
  });

  it.each(IDS.flatMap((id) => FACES.map((face) => [id, face] as const)))(
    '%s, %s face: identical across s 0 and 1, two clocks, c none and 1, genesis and the breath',
    (id, face) => {
      const [a, b] = pair(id, face);
      const pixels = steadyPixels(a);
      expect(pixels.length).toBeGreaterThan(50);
      // Calm's halo is among them, and frame A turns the field by more than 2°.
      expect(pixels.filter((p) => p.nearest === NODE.C).length).toBeGreaterThan(0);
      expect(Math.abs(Math.atan2(a.shimmer.sin, a.shimmer.cos)) * (180 / Math.PI)).toBeGreaterThan(2);
      const differ = pixels.filter(({ x, y }) => {
        const pa = fieldOklab(a, x, y);
        const pb = fieldOklab(b, x, y);
        return !(Object.is(pa.L, pb.L) && Object.is(pa.a, pb.a) && Object.is(pa.b, pb.b));
      });
      expect(differ).toEqual([]);
      // Not vacuous: the frames really differ where the field is present.
      expect(a.kField).not.toBe(b.kField);
      expect(a.nodes[1].field).not.toEqual(b.nodes[1].field);
    },
  );
});

describe('the node colour is (1 − w)·turned + w·halo (the critic’s clause)', () => {
  const calm = (tier: 'core' | 'deep') => {
    const [L, a, b] = BASE.emotion.calm[tier].oklab;
    return { L, a, b };
  };
  const turnBy = (deg: number) => ({ cos: Math.cos((deg * Math.PI) / 180), sin: Math.sin((deg * Math.PI) / 180) });
  const bead = (halo: { L: number; a: number; b: number }, field = halo): FieldNodeFrame => ({ id: NODE.C, fade: 1, centre: [0, 0], radius: 0.5, field, halo, bead: [0, 0] });

  // Calm's b is about 0.004 and its a about −0.11, so a turn of more than 2° carries the field
  // colour's b across zero: there turned + (halo − turned)·1 is not the halo in float.
  it.each([
    ['core', 3],
    ['core', 6],
    ['deep', 3],
    ['deep', 6],
  ] as const)('calm %s turned by %s°: where the halo outweighs the field, the node is the halo bit for bit', (tier, deg) => {
    const halo = calm(tier);
    const field = halo; // at s 0 and p 1 the field colour is the halo's, before the turn (frame A above)
    const shimmer = turnBy(deg);
    const turned = { L: field.L, a: field.a * shimmer.cos - field.b * shimmer.sin, b: field.a * shimmer.sin + field.b * shimmer.cos };
    expect(Math.sign(turned.b)).not.toBe(Math.sign(halo.b)); // the case that tells the two forms apart
    const old = (k: 'L' | 'a' | 'b') => turned[k] + (halo[k] - turned[k]) * 1;
    expect(['L', 'a', 'b'].every((k) => Object.is(old(k as 'L'), halo[k as 'L']))).toBe(false); // the old form misses it
    const colour = nodeColour(bead(halo, field), 0.2, 0, shimmer);
    expect([Object.is(colour.L, halo.L), Object.is(colour.a, halo.a), Object.is(colour.b, halo.b)]).toEqual([true, true, true]);
  });

  it('the window: the halo takes over where h reaches k_field, never before (smoothstep(−0.05, 0, h − k_field))', () => {
    const halo = calm('core');
    const field = { L: 0.5, a: 0.02, b: 0.01 };
    const still = turnBy(0);
    expect(nodeColour(bead(halo, field), 0.3, 0.3, still)).toEqual(halo); // h = k_field: w = 1
    expect(nodeColour(bead(halo, field), 0.25, 0.3, still)).toEqual(field); // h = k_field − 0.05: w = 0
    const mid = nodeColour(bead(halo, field), 0.275, 0.3, still); // w = 0.5
    expect(mid.L).toBeCloseTo((field.L + halo.L) / 2, 12);
  });

  it('a rest lobe’s colour is its turned field colour, whatever the weights', () => {
    const glow = { L: 0.6, a: 0.01, b: 0.02 };
    const rest: FieldNodeFrame = { id: NODE.R0, fade: 1, centre: [0, 0], radius: 0.5, field: glow, halo: glow, bead: null };
    const shimmer = turnBy(6);
    expect(nodeColour(rest, 0.4, 0, shimmer)).toEqual({ L: glow.L, a: glow.a * shimmer.cos - glow.b * shimmer.sin, b: glow.a * shimmer.sin + glow.b * shimmer.cos });
  });
});
