import { pivotComposite } from '../../../color/blendSpace.ts';
import { contrastRatio } from '../../../color/contrast.ts';
import { maxInBandOnPixelBlend, maxInBandOnSrgbBlend, type Bytes } from '../../../color/edgeSweep.ts';
import type { Oklab, Srgb } from '../../../color/oklab.ts';
import { sweepOklabToSrgb } from '../../../color/sweepConvert.ts';
import { CHECK_BAND, DESIGN_BAND, lab, tierFor } from '../../../tokens/neverRedSweeps.ts';
import { BASE, DIRECTIONS, type Face } from '../../../tokens/tokens.generated.ts';

// The rim words' ink (hero.plate.word.* → text.primary, the token extensions' glyphCores) over the ground they sit on: the
// ring, field-free, lit only by the steady halos (DSN-030). The edge sweep's 'ring halo · text.primary' family holds it on
// its full grids; this pins the words' own case in a moment: never red on the blends a glyph's edge makes, and 4.5:1 at the
// brightest (dark) or darkest (light) halo. The contrast is an arithmetic prediction, never evidence: P10-P1 and P2-03
// measure the hardest placements on device pixels.

const FACES: readonly Face[] = ['dark', 'light'];
const toBytes = (rgb: Srgb): Bytes => rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255)) as unknown as Bytes;
const clamp = (rgb: Srgb) => rgb.map((c) => Math.min(1, Math.max(0, c))) as unknown as Srgb;

/** The ring lit by each anchor's halo, from none to its peak, at full presence. */
function litRing(face: Face): Oklab[] {
  const d = DIRECTIONS.abyss;
  const ring = lab(d.color[face].plate.ring);
  const peak = face === 'dark' ? BASE.field.halo.peakDark : BASE.field.halo.peakLight;
  const anchors = (['joy', 'calm', 'reflective', 'intense'] as const).map((q) => lab(BASE.emotion[q][tierFor(face)]));
  return [ring, ...anchors.flatMap((a) => Array.from({ length: 11 }, (_, i) => pivotComposite({ L: a.L, a: a.a * d.bead.chromaScale, b: a.b * d.bead.chromaScale }, ring, (peak * i) / 10, d.field.pivot)))];
}

/** The worst over every lit ground: the in-band chroma in float and on pixels, and the lowest contrast. */
function measure(face: Face, ink: Srgb) {
  let design = 0;
  let check = 0;
  let worst = Infinity;
  for (const g of litRing(face)) {
    const bg = sweepOklabToSrgb(g);
    design = Math.max(design, maxInBandOnSrgbBlend(bg, ink, DESIGN_BAND, 1).chroma);
    check = Math.max(check, maxInBandOnPixelBlend(toBytes(bg), toBytes(ink), CHECK_BAND, 254).chroma);
    worst = Math.min(worst, contrastRatio(clamp(ink), clamp(bg)));
  }
  return { design, check, worst };
}

it.each(FACES)('%s: text.primary over the halo-lit ring is never red on its edges, and reads at 4.5:1 or more', (face) => {
  const m = measure(face, sweepOklabToSrgb(lab(DIRECTIONS.abyss.color[face].text.primary)));
  expect(m.design).toBeLessThan(DESIGN_BAND.chromaFloor - BASE.neverRed.margin);
  expect(m.check).toBeLessThan(CHECK_BAND.chromaFloor - BASE.neverRed.margin);
  expect(m.worst).toBeGreaterThanOrEqual(4.5);
});

it('bites: a planted red ink breaks both bands, and an ink the colour of the ring fails the contrast', () => {
  const red = measure('dark', [200 / 255, 64 / 255, 72 / 255]);
  expect(red.design).toBeGreaterThanOrEqual(DESIGN_BAND.chromaFloor - BASE.neverRed.margin);
  expect(red.check).toBeGreaterThanOrEqual(CHECK_BAND.chromaFloor - BASE.neverRed.margin);
  expect(measure('dark', sweepOklabToSrgb(lab(DIRECTIONS.abyss.color.dark.plate.ring))).worst).toBeLessThan(4.5);
});
