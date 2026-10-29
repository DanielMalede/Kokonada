// Planted twins of the field law (law round 2, D5b: TASKS UI-122 and UI-129; UI-125), for the tests that
// must watch each one fail. Test-only, like ledgerStorms.ts: never imported by app code, not a worklet
// module. Each twin is the law with one piece swapped back to what a change replaced, built on the law's
// own exported pieces (pixelTerms, slotColours, compositePixel), so it differs from the law in that piece
// alone:
//   · slotRankedSelect: selection with the slots ranked, not the nodes (L4 before D5b);
//   · perSlotColours: each slot's mark weight w from its own h_i, not its node's pooled H_n (UI-129);
//   · seamSelect: selection with the seam's pieces chosen (UI-125): the weights w linear (L5, as at
//     d0f47a8) or squared (L5′), the waypoint leg linear (2t, as at d0f47a8) or eased (s(2t)), and the
//     triple fade's β on r (L6′, UI-139) or on the linear ratio (E1 − E3)/E1 (L6, as at 6706149);
//   · twinPixel: the pixel with any of these swapped back.
// Every twin but seamSelect's own plants reads the law's seam (LAW_SEAM): since UI-125 the D5b twins are
// L5′ too, so each still differs from the law in its D5b piece alone (criterion F's meaning, kept).

import type { Oklab } from '../color/oklab.ts';
import { compositePixel, isWaypoint, nodeColour, pixelTerms, pooledNodes, rankNodes, slotColours, smoothstep, type FieldFrame, type PixelTerms } from './fieldLaw.ts';

/** The seam's pieces (UI-125, UI-139): the weights' power, the waypoint leg's ease and what β reads. */
export interface Seam {
  /** 'linear': w_k = E_k − E3 (L5, d0f47a8); 'squared': w_k = (E_k − E3)² (L5′, the law's). */
  readonly w: 'linear' | 'squared';
  /** 'linear': the leg C1→N12 by 2t (d0f47a8); 'eased': by s(2t), s(x) = 1 − (1 − x)² (the law's). */
  readonly leg: 'linear' | 'eased';
  /** 'ratio': β on (E1 − E3)/E1 (L6, 6706149); 'r' or absent: β on r (L6′, the law's). */
  readonly beta?: 'ratio' | 'r';
}
export const LAW_SEAM: Seam = { w: 'squared', leg: 'eased', beta: 'r' };

/** The pair of the two strongest, mixed by the seam's t: C1→C2 by t, or C1→N12 along the waypoint leg. */
export function seamPair(c1: Oklab, c2: Oklab, e1: number, e2: number, e3: number, waypoint: boolean, seam: Seam): Oklab {
  const d1 = e1 - e3;
  const d2 = e2 - e3;
  const w1 = seam.w === 'squared' ? d1 * d1 : d1;
  const w2 = seam.w === 'squared' ? d2 * d2 : d2;
  const t = w1 > 0 ? w2 / (w1 + w2) : 0;
  if (waypoint) {
    const x = 2 * t;
    const s = seam.leg === 'eased' ? 1 - (1 - x) * (1 - x) : x;
    const nL = (c1.L + c2.L) / 2;
    return { L: c1.L + (nL - c1.L) * s, a: c1.a * (1 - s), b: c1.b * (1 - s) };
  }
  return { L: c1.L + (c2.L - c1.L) * t, a: c1.a + (c2.a - c1.a) * t, b: c1.b + (c2.b - c1.b) * t };
}

/**
 * The pair faded to N̄ = (Σ e_i·L_i / Σ e_i over the slots, 0, 0) by β = smoothstep(0, θ, r), r = 3·√(d1² −
 * d1·d2 + d2²)/(E1 + E2 + E3) (L6′), written in the law's order; or, on `'ratio'`, by β = smoothstep(0, θ,
 * (E1 − E3)/E1) (L6).
 */
function fade(pair: Oklab, e: readonly number[], colours: readonly Oklab[], e1: number, e2: number, e3: number, tripleFade: number, on: Seam['beta']): Oklab {
  const d1 = e1 - e3;
  const d2 = e2 - e3;
  const beta = smoothstep(0, tripleFade, on === 'ratio' ? d1 / e1 : (3 * Math.sqrt(d1 * d1 - d1 * d2 + d2 * d2)) / (e1 + e2 + e3));
  let eSum = 0;
  let eL = 0;
  for (let i = 0; i < e.length; i++) {
    eSum += e[i];
    eL += e[i] * colours[i].L;
  }
  const neutralL = eL / eSum;
  return { L: pair.L * beta + neutralL * (1 - beta), a: beta * pair.a, b: beta * pair.b };
}

/** selectColour with the nodes ranked as the law ranks them and the seam's pieces chosen (UI-125's plants). */
export function seamSelect(e: readonly number[], colours: readonly Oklab[], ids: readonly number[], restIntenseWaypoint: boolean, tripleFade: number, seam: Seam): Oklab {
  const { E, C } = pooledNodes(e, colours, ids);
  const [i1, i2, e3] = rankNodes(E);
  const pair = seamPair(C[i1], C[i2], E[i1], E[i2], e3, isWaypoint(i1, i2, restIntenseWaypoint), seam);
  return fade(pair, e, colours, E[i1], E[i2], e3, tripleFade, seam.beta);
}

/** The slots' ranking (L4 before D5b): e1 ≥ e2 ≥ e3 over the six slots, ties to the lower slot. */
export function rankSlots(e: readonly number[]): [number, number, number] {
  let i1 = 0;
  for (let i = 1; i < e.length; i++) if (e[i] > e[i1]) i1 = i;
  let i2 = i1 === 0 ? 1 : 0;
  for (let i = 0; i < e.length; i++) if (i !== i1 && e[i] > e[i2]) i2 = i;
  let e3 = 0;
  for (let i = 0; i < e.length; i++) if (i !== i1 && i !== i2 && e[i] > e3) e3 = e[i];
  return [i1, i2, e3];
}

/** selectColour with the slots ranked (as at 42869fb), N̄ over the slots, and the seam (the law's by default). */
export function slotRankedSelect(e: readonly number[], colours: readonly Oklab[], ids: readonly number[], restIntenseWaypoint: boolean, tripleFade: number, seam: Seam = LAW_SEAM): Oklab {
  const [i1, i2, e3] = rankSlots(e);
  const pair = seamPair(colours[i1], colours[i2], e[i1], e[i2], e3, isWaypoint(ids[i1], ids[i2], restIntenseWaypoint), seam);
  return fade(pair, e, colours, e[i1], e[i2], e3, tripleFade, seam.beta);
}

/** UI-129's plant: each slot's w from its own h_i (as at 42869fb), not from its node's pooled H_n. */
export function perSlotColours(frame: FieldFrame, terms: PixelTerms): Oklab[] {
  return frame.nodes.map((node, i) => nodeColour(node, terms.h[i], terms.kField, frame.shimmer));
}

export interface Twin {
  /** 'slots': the 42869fb ranking; 'nodes': the law's. */
  readonly rank: 'slots' | 'nodes';
  /** 'slot': w from h_i (42869fb); 'node': w from H_n (the law's). */
  readonly w: 'slot' | 'node';
  /** The seam's pieces (UI-125); the law's when absent. */
  readonly seam?: Seam;
}

/** The pixel with the twin's pieces: { rank: 'nodes', w: 'node' } is fieldOklab, { 'slots', 'slot' } the law before D5b on the law's seam. */
export function twinPixel(frame: FieldFrame, x: number, y: number, twin: Twin): Oklab {
  const terms = pixelTerms(frame, x, y);
  let colour = terms.ground;
  if (Math.max(...terms.e) > 0) {
    const colours = twin.w === 'slot' ? perSlotColours(frame, terms) : slotColours(frame, terms);
    const ids = frame.nodes.map((node) => node.id);
    const seam = twin.seam ?? LAW_SEAM;
    colour = twin.rank === 'slots'
      ? slotRankedSelect(terms.e, colours, ids, frame.restIntenseWaypoint, frame.tripleFade, seam)
      : seamSelect(terms.e, colours, ids, frame.restIntenseWaypoint, frame.tripleFade, seam);
  }
  return compositePixel(frame, terms, colour, x, y);
}
