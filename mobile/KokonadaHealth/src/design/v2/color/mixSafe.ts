// Route R2 (designer §1.2): mixSafe, for every UI colour transition (a CTA tint change, a bead's
// colour, a uniform tween).
//
// If the short arc between the two hues meets the band, the transition goes through the neutral
// at the lerped lightness: ab = from.ab·(1 − 2t) for t < 0.5, then to.ab·(2t − 1). Otherwise it is
// the straight OKLab mix. Either way it starts and ends exactly on its two colours.
//
// These functions will run on the UI thread, so Math.* stays inline and nothing here borrows the
// sweep modules' bound helpers (see workletSafe.test.ts).

import { mixOklab, type Oklab } from './oklab.ts';
import type { RedBand } from './redBand.ts';

/** Below this chroma the hue is powerless (CSS Color 4), so a colour has no arc. */
const ACHROMATIC_CHROMA = 0.000004;

const normalise = (deg: number) => ((deg % 360) + 360) % 360;

function hueOf(colour: Oklab): number {
  return Math.sqrt(colour.a * colour.a + colour.b * colour.b) <= ACHROMATIC_CHROMA
    ? NaN
    : normalise((Math.atan2(colour.b, colour.a) * 180) / Math.PI);
}

/** Does the short arc from `from` to `to` touch the band? An achromatic end has no arc. */
function shortArcMeetsBand(from: Oklab, to: Oklab, band: RedBand): boolean {
  const start = hueOf(from);
  const end = hueOf(to);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return false;
  }
  const delta = normalise(end - start + 180) - 180;
  const width = normalise(band.hueTo - band.hueFrom);
  const inBand = (h: number) => normalise(h - band.hueFrom) <= width;
  const onArc = (h: number) => (delta >= 0 ? normalise(h - start) : normalise(start - h)) <= Math.abs(delta);
  // A band and an arc, each shorter than a half turn, meet only if an end of one lies in the other.
  return inBand(start) || inBand(end) || onArc(band.hueFrom) || onArc(band.hueTo);
}

export function mixSafe(from: Oklab, to: Oklab, t: number, band: RedBand): Oklab {
  if (!(t >= 0 && t <= 1)) {
    throw new RangeError(`mix parameter must be in [0, 1], got ${t}`);
  }
  if (!shortArcMeetsBand(from, to, band)) {
    return mixOklab(from, to, t);
  }
  const L = from.L * (1 - t) + to.L * t;
  if (t < 0.5) {
    const k = 1 - 2 * t;
    return { L, a: from.a * k, b: from.b * k };
  }
  const k = 2 * t - 1;
  return { L, a: to.a * k, b: to.b * k };
}
