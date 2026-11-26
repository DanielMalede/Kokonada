jest.mock('../../tokens/tokens.generated.ts', () => require('../../__tests__/__fixtures__/fixtureTokens.ts').mockedTokensModule());
jest.mock('../../tokens/tokens.extensions.generated.ts', () => require('../../__tests__/__fixtures__/fixtureTokens.ts').mockedExtensionsModule());

import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { DIRECTIONS, type DirectionId, type Face } from '../../tokens/tokens.generated.ts';
import { FIXTURE_INNER, FIXTURE_OUTER } from '../../__tests__/__fixtures__/fixtureTokens.ts';
import { fallbackPose, fallbackRegion, fallbackStops } from '../fallbackModel.ts';
import { PHONE, fallbackScenes, heroLayout, rampPlacements } from '../fallbackScenes.ts';
import type { Tap } from '../placementLedger.ts';
import { staticsFor } from '../statics.ts';

// RA-29 (UI-211): the fallback's stops are the bytes the device draws. On the device RN Skia reads each gradient colour
// (a Float32Array) into an 8-bit SkColor: JsiSkShaderFactory.h getColors -> JsiSkColor::fromValue, SkColorSetARGB(
// bfrPtr[i] * 255), a float product converted to U8CPU, that is truncated; then SkColor4f::FromColor. CanvasKit, in the
// skia tests, keeps the floats. So a stop drawn on the device is trunc(fround(fround(v) * 255)), and the tests' pixels
// hold on the device only when that equals round(v * 255), the byte CanvasKit draws at the stop. The flat surfaces take
// the same 8-bit route from their hex (Skia.Color, SkColor4f::FromColor, b × (1/255.0f) in float), so the tail stop,
// meant to be the region's ground exactly, must be that token's byte under the device's conversion too.

const f = Math.fround;
/** A stop component as the device draws it: a Float32Array element times 255 in float, truncated to a byte. */
const deviceByte = (v: number) => (f(v) > 1 ? -1 : Math.trunc(f(f(v) * 255)));
/** A flat token byte as the device draws it: Skia.Color's float (b × (1/255.0f)), then the same truncation. */
const flatByte = (b: number) => Math.trunc(f(f(b * f(1 / 255)) * 255));
const hexBytes = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

const FACES: readonly Face[] = ['dark', 'light'];
const EXT = EXTENSIONS as unknown as { base: { $root: { hero: { scenes: never } } }; abyss: { $root: { hardest: never } } };
const SCENE_TAPS: ReadonlyArray<readonly Tap[]> = [
  ...fallbackScenes(EXT.base.$root.hero.scenes, EXT.abyss.$root.hardest).map((s) => s.taps),
  ...rampPlacements().map(({ tap }) => [tap]),
  [{ x: 0.05, y: 0.05 }],
  [],
];

describe('RA-29: every fallback stop is the byte the device draws, on both paths', () => {
  const ids = (Object.keys(DIRECTIONS) as DirectionId[]).filter((id) => fallbackRegion(id) !== 'none');

  it('the cases: Abyss and both fixtures among the directions with a field region', () => {
    expect(ids).toEqual(expect.arrayContaining(['abyss', FIXTURE_INNER, FIXTURE_OUTER]));
  });

  it.each(ids.flatMap((id) => FACES.map((face) => [id, face] as const)))('%s %s: trunc(fround(fround(v)·255)) = round(v·255) for every stop; the tail stop is the region’s token byte', (id, face) => {
    const region = fallbackRegion(id) as 'face' | 'outside';
    const statics = staticsFor(id, EXTENSIONS as never);
    const radiusDp = heroLayout(id, PHONE.width, PHONE.height, 1).radius;
    const c = DIRECTIONS[id].color[face];
    const tail = hexBytes(region === 'face' ? c.plate.face.hex : c.ground.hex);
    let cases = 0;
    const bad: string[] = [];
    for (const taps of SCENE_TAPS) {
      const pose = fallbackPose(id, face, statics, taps, radiusDp);
      if (pose === null) continue;
      const { colours } = fallbackStops(id, face, region, statics, pose.colour);
      expect(colours.length).toBeGreaterThanOrEqual(2);
      colours.forEach((rgb, i) => {
        rgb.forEach((v, ch) => {
          cases++;
          if (deviceByte(v) !== Math.round(v * 255) && bad.length < 5) bad.push(`stop ${i} ch ${ch}: v ${v} device ${deviceByte(v)} round ${Math.round(v * 255)}`);
        });
      });
      const last = colours[colours.length - 1];
      expect(last.map(deviceByte)).toEqual(tail);
      expect(last.map((v) => Math.round(v * 255))).toEqual(tail);
      expect(tail.map(flatByte)).toEqual(tail);
    }
    expect(bad).toEqual([]);
    // Not vacuous: every scene's pose drawn, every stop's three channels checked.
    expect(cases).toBeGreaterThan(SCENE_TAPS.length * 3 * 2);
  });
});
