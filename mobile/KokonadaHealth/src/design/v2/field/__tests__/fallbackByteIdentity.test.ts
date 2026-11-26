import type { Oklab } from '../../color/oklab.ts';
import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { DIRECTIONS, type DirectionId, type Face } from '../../tokens/tokens.generated.ts';
import { fallbackPose, fallbackRegion, fallbackStops } from '../fallbackModel.ts';
import { PHONE, heroLayout } from '../fallbackScenes.ts';
import { staticsFor } from '../statics.ts';

// UI-221 (RA-34): the RA-29 fix sends every fallback stop as k/255, the nearest byte, because on the device RN Skia reads a
// gradient colour into an 8-bit SkColor by truncation, trunc(fround(fround(v) × 255)), while CanvasKit keeps the float.
// The two agree only if that truncation gives k back for every byte k. fallbackStopBytes.test.ts checks the stops the T13
// scenes reach; a tap can reach any composite, so here the identity is pinned for all 256 bytes, and every stop of a dense
// sweep through fallbackStops (an Oklab grid, and a grid of taps over the disc through fallbackPose) on both Abyss faces is
// held to it. The shipped tokens, never the fixtures: these are the bytes the device draws.

const f = Math.fround;
/** A stop component as the device draws it: a Float32Array element times 255 in float, truncated to a byte. */
const deviceByte = (v: number) => Math.trunc(f(f(v) * 255));
const ABYSS = 'abyss' as DirectionId;
const FACES: readonly Face[] = ['dark', 'light'];
const statics = staticsFor(ABYSS, EXTENSIONS as never);
const region = fallbackRegion(ABYSS) as 'face' | 'outside';

/** Every stop channel of these colours on a face: [cases, the channels that break the identity (at most 5), the bytes seen]. */
function sweep(face: Face, colours: readonly Oklab[]) {
  let cases = 0;
  const bad: string[] = [];
  const seen = new Set<number>();
  for (const colour of colours) {
    const stops = fallbackStops(ABYSS, face, region, statics, colour);
    for (const rgb of stops.colours) {
      for (const v of rgb) {
        cases++;
        const k = Math.round(v * 255);
        seen.add(k);
        const ok = k >= 0 && k <= 255 && v === k / 255 && deviceByte(v) === k;
        if (!ok && bad.length < 5) bad.push(`L ${colour.L} a ${colour.a} b ${colour.b}: v ${v} device ${deviceByte(v)} round ${k}`);
      }
    }
  }
  return { cases, bad, seen };
}

describe('UI-221: the device reads back every byte the fallback sends (trunc(fround(fround(k/255)·255)) = k)', () => {
  it('for every byte k = 0..255', () => {
    const bad: number[] = [];
    let cases = 0;
    for (let k = 0; k <= 255; k++) {
      cases++;
      if (deviceByte(k / 255) !== k) bad.push(k);
    }
    expect(bad).toEqual([]);
    expect(cases).toBe(256);
  });

  it('the guard bites: a channel off its byte, or a float route that rounds down, is caught', () => {
    // A value just under a byte truncates to the byte below on the device: the reason the stops are sent as k/255.
    expect(deviceByte(f(100 / 255) - 1e-6)).toBe(99);
    expect(deviceByte(100 / 255)).toBe(100);
  });

  const L = Array.from({ length: 41 }, (_, i) => i / 40);
  const AB = Array.from({ length: 33 }, (_, i) => -0.4 + i * 0.025);
  const GRID: Oklab[] = L.flatMap((l) => AB.flatMap((a) => AB.map((b) => ({ L: l, a, b }))));

  it.each(FACES)('%s face: every stop of a dense Oklab sweep through fallbackStops is a byte the device reads back', (face) => {
    const { cases, bad, seen } = sweep(face, GRID);
    expect(bad).toEqual([]);
    // Not vacuous: every colour gave at least two stops, and the sweep reached half the bytes or more (the light face's
    // composites span fewer: 141 at this grid).
    expect(GRID.length).toBe(41 * 33 * 33);
    expect(cases).toBeGreaterThanOrEqual(GRID.length * 2 * 3);
    expect(seen.size).toBeGreaterThanOrEqual(128);
  });

  it.each(FACES)('%s face: every stop of every pose a tap on a dense grid over the disc reaches is a byte the device reads back', (face) => {
    const radiusDp = heroLayout(ABYSS, PHONE.width, PHONE.height, 1).radius;
    const colours: Oklab[] = [];
    for (let i = 0; i <= 60; i++) {
      for (let j = 0; j <= 60; j++) {
        const tap = { x: -1.05 + (2.1 * i) / 60, y: -1.05 + (2.1 * j) / 60 };
        const pose = fallbackPose(ABYSS, face, statics, [tap], radiusDp);
        if (pose !== null) colours.push(pose.colour);
      }
    }
    const rest = fallbackPose(ABYSS, face, statics, [], radiusDp);
    if (rest !== null) colours.push(rest.colour);
    const { cases, bad } = sweep(face, colours);
    expect(bad).toEqual([]);
    expect(colours.length).toBeGreaterThan(61 * 61 * 0.5);
    expect(cases).toBeGreaterThanOrEqual(colours.length * 2 * 3);
  });

  it('the cases: Abyss draws its fallback field on the face, on both faces', () => {
    expect(region).toBe('face');
    expect(Object.keys(DIRECTIONS)).toContain(ABYSS);
  });
});
