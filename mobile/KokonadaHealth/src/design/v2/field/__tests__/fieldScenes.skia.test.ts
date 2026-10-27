jest.mock('../../tokens/tokens.generated.ts', () => require('../../__tests__/__fixtures__/fixtureTokens.ts').mockedTokensModule());
jest.mock('../../tokens/tokens.extensions.generated.ts', () => require('../../__tests__/__fixtures__/fixtureTokens.ts').mockedExtensionsModule());

import { Skia } from '@shopify/react-native-skia';
import { FIXTURE_IDS, actualTokens } from '../../__tests__/__fixtures__/fixtureTokens.ts';
import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { BASE, DIRECTIONS, type DirectionId, type Face } from '../../tokens/tokens.generated.ts';
import { regionOf, shadowFactor } from '../fieldLaw.ts';
import { DEFERRED, FIELD_SCENES, HEAVIEST, IDS, SEAM, STEP_MS, WHOLE, frameIn, noWaypoint, sceneCatalogue, sizeOf, stateFor, still, throughLedger } from '../fieldScenes.ts';
import { FIELD_SKSL } from '../fieldShader.ts';
import { stormDeps } from '../ledgerStorms.ts';
import { staticsFor } from '../statics.ts';

// The never-red scenes, the cheap structural checks (law round 2, item 8: the split). The frames, the
// per-scene agreement and the planted catch run in the CanvasKit sweeps project
// (fieldScenes.sweeps.skia.test.ts), where the check runs; the scene builders are shared
// (field/fieldScenes.ts). The test-only fixture directions (__tests__/__fixtures__/fixtureTokens.ts) are
// mocked in for the shadowed-grounds rows: they draw the plate shadows no shipped direction draws.

it('the fixture mock: the fixture ids exist, BASE and DIRECTIONS.abyss are the shipped objects', () => {
  expect(BASE).toBe(actualTokens().BASE);
  expect(DIRECTIONS.abyss).toBe(actualTokens().DIRECTIONS.abyss);
  for (const id of FIXTURE_IDS) expect(DIRECTIONS[id]).toBeDefined();
});

const deps = (id: DirectionId) => stormDeps(id, staticsFor(id, EXTENSIONS as never));
const { scenesOf, restTo, drawn } = sceneCatalogue(EXTENSIONS, deps);

describe('the never-red scenes the designer named, and the two the plan adds', () => {
  // Since the close-out, Abyss names only the seam; backlight, ringHalo, restToIntense and the deferred
  // ctaKeyline stay drawable or listed here, but no shipped direction names them (the designer rules
  // whether Abyss should). So the drawn kinds are exactly the named ones, and the replace dissolve.
  it('every token scene of every direction is drawn here or named as deferred, and exactly the named kinds are drawn', () => {
    const ids = IDS.flatMap((id) => scenesOf(id).map((scene) => scene.id));
    expect(ids.filter((s) => !FIELD_SCENES.includes(s) && !(s in DEFERRED))).toEqual([]);
    expect([...new Set(drawn.map((d) => d.scene))].sort()).toEqual([...new Set([...ids.filter((s) => FIELD_SCENES.includes(s)), 'replaceDissolve'])].sort());
    expect([...new Set(ids)].sort()).toEqual(['seam']);
    expect(restTo.map((b) => b.node)).toEqual(['I']);
  });

  it('restToIntense runs through the ledger along u and 1 − u²; the replace dissolve swaps the seam’s pair in one crossfade', () => {
    const rest = throughLedger(deps('abyss'), [], restTo.map((b) => ({ x: b.x, y: b.y })));
    expect(rest.map((s) => s.ms)).toEqual(Array.from({ length: 13 }, (_, k) => k * STEP_MS));
    const mid = rest[6].shown;
    expect(mid.placements).toHaveLength(1);
    expect(mid.restFade).toBeCloseTo(1 - mid.placements[0].fade ** 2, 12);
    expect([rest[0].shown.placements[0].fade, rest[12].shown.placements[0].fade, rest[12].shown.restFade]).toEqual([0, 1, 0]);
    const swap = throughLedger(deps('abyss'), [{ x: SEAM[0].x, y: SEAM[0].y }], [{ x: SEAM[1].x, y: SEAM[1].y }]);
    const half = swap[6].shown.placements;
    expect(half.map((p) => p.role)).toEqual(['leaving', 'live']);
    expect(half[0].fade).toBeCloseTo(1 - half[1].fade ** 2, 12);
  });

  it('the planted shader differs from the real one only in the waypoint, and compiles', () => {
    const planted = noWaypoint(FIELD_SKSL);
    expect(planted).not.toBe(FIELD_SKSL);
    expect(planted).toContain('bool isWaypoint(float a, float b) { return false; }');
    expect(Skia.RuntimeEffect.Make(planted)).toBeTruthy();
  });

  // The plate's shadows on the drawn pixels (designer 2.9): Abyss draws none, so the positive rows are
  // the fixture directions': fixture-outer's outer shadow below the plate on its light face only,
  // fixture-inner's inner shadows on the face on both faces.
  it.each([
    ['abyss', 'dark', false], ['abyss', 'light', false],
    ['fixture-outer', 'light', true], ['fixture-outer', 'dark', false], ['fixture-inner', 'dark', true], ['fixture-inner', 'light', true],
  ] as const)(
    '%s, %s face: shadowed grounds drawn: %s',
    (id, face, expected) => {
      const frame = frameIn(WHOLE, stateFor(id as DirectionId, face as Face, HEAVIEST, still(SEAM)), deps(id as DirectionId).statics);
      const [w, h] = sizeOf(WHOLE);
      let shadowed = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const qx = (x + 0.5 - frame.centrePx[0]) / frame.radiusPx;
          const qy = -(y + 0.5 - frame.centrePx[1]) / frame.radiusPx;
          if (Math.abs(shadowFactor(frame, regionOf(Math.hypot(qx, qy), frame), qx, qy) - 1) > 0.01) shadowed++;
        }
      }
      expect(shadowed > 10).toBe(expected);
    },
  );
});
