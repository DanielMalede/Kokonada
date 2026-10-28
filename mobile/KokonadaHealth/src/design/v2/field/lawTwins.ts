// Planted twins of the field law (law round 2, D5b: TASKS UI-122 and UI-129), for the tests that must
// watch each one fail. Test-only, like ledgerStorms.ts: never imported by app code, not a worklet module.
// Each twin is the law with one piece swapped back to what D5b replaced, built on the law's own exported
// pieces (pixelTerms, slotColours, compositePixel), so it differs from the law in that piece alone:
//   · slotRankedSelect: selection as it was at 42869fb: the slots ranked, not the nodes (L4 before D5b);
//   · perSlotColours: each slot's mark weight w from its own h_i, not its node's pooled H_n (UI-129);
//   · twinPixel: the pixel with either or both swapped back; both is the law at 42869fb.

import type { Oklab } from '../color/oklab.ts';
import { compositePixel, isWaypoint, nodeColour, pixelTerms, selectColour, slotColours, smoothstep, type FieldFrame, type PixelTerms } from './fieldLaw.ts';

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

/** selectColour as it was at 42869fb, line for line: the slots ranked, N̄ over the slots. */
export function slotRankedSelect(e: readonly number[], colours: readonly Oklab[], ids: readonly number[], restIntenseWaypoint: boolean, tripleFade: number): Oklab {
  const [i1, i2, e3] = rankSlots(e);
  const c1 = colours[i1];
  const c2 = colours[i2];
  const w1 = e[i1] - e3;
  const w2 = e[i2] - e3;
  const t = w1 > 0 ? w2 / (w1 + w2) : 0;
  let pair: Oklab;
  if (isWaypoint(ids[i1], ids[i2], restIntenseWaypoint)) {
    const s = 2 * t;
    const nL = (c1.L + c2.L) / 2;
    pair = { L: c1.L + (nL - c1.L) * s, a: c1.a * (1 - s), b: c1.b * (1 - s) };
  } else {
    pair = { L: c1.L + (c2.L - c1.L) * t, a: c1.a + (c2.a - c1.a) * t, b: c1.b + (c2.b - c1.b) * t };
  }
  const beta = smoothstep(0, tripleFade, w1 / e[i1]);
  let eSum = 0;
  let eL = 0;
  for (let i = 0; i < e.length; i++) {
    eSum += e[i];
    eL += e[i] * colours[i].L;
  }
  const neutralL = eL / eSum;
  return { L: pair.L * beta + neutralL * (1 - beta), a: beta * pair.a, b: beta * pair.b };
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
}

/** The pixel with the twin's pieces: { rank: 'nodes', w: 'node' } is fieldOklab, { 'slots', 'slot' } the law at 42869fb. */
export function twinPixel(frame: FieldFrame, x: number, y: number, twin: Twin): Oklab {
  const terms = pixelTerms(frame, x, y);
  let colour = terms.ground;
  if (Math.max(...terms.e) > 0) {
    const colours = twin.w === 'slot' ? perSlotColours(frame, terms) : slotColours(frame, terms);
    const ids = frame.nodes.map((node) => node.id);
    colour = (twin.rank === 'slots' ? slotRankedSelect : selectColour)(terms.e, colours, ids, frame.restIntenseWaypoint, frame.tripleFade);
  }
  return compositePixel(frame, terms, colour, x, y);
}
