// SCENES reaches FieldView, whose fieldImage.tsx reads Skia's FilterMode on load: the setup stub lacks it (__fixtures__/skiaHeadless.ts).
jest.mock('@shopify/react-native-skia', () => require('./__fixtures__/skiaHeadless').skiaHeadless());

import { BASE } from '../../v2/tokens/tokens.generated';
import { COST_HERO, COST_SCENE_SPECS, costSceneSpec } from '../cost/costScenes';
import { FIELD_SCENES } from '../fieldScenes';
import { COST_SCENES } from '../sceneGroups/cost';
import { SCENES } from '../scenes';
import { CostScene } from '../scenes/CostScene';

// B8-3, the cost scene group (the architect's B8 plan, "Contracts fixed now": `cost.abyss.<face>.<scene>.<tier>[.storm|
// .heavy|.empty]`). The bench runs on the hero scene with the most placements, three, at the two moving tiers (the still
// draws no frames). Idle and the 7 taps/s storm on both faces; the calibration pair, heavy and empty, on the dark face
// only: they measure the instrument at the tier's render size, which no face changes.

const IDS = [
  ...['full', 'low'].flatMap((tier) => ['', '.storm', '.heavy', '.empty'].map((v) => `cost.abyss.dark.three.${tier}${v}`)),
  ...['full', 'low'].flatMap((tier) => ['', '.storm'].map((v) => `cost.abyss.light.three.${tier}${v}`)),
];

describe('the cost scene catalogue', () => {
  it('is exactly the twelve scenes', () => {
    expect(Object.keys(COST_SCENE_SPECS).sort()).toEqual([...IDS].sort());
    expect(COST_HERO).toBe('three');
  });

  it.each(IDS)('%s: its face, hero, tier and variant from its id; the field scene\'s taps; the field\'s period', (id) => {
    const [, direction, face, hero, tier, variant = 'idle'] = id.split('.');
    const spec = COST_SCENE_SPECS[id];
    const field = FIELD_SCENES[`field.${direction}.${face}.${hero}.${tier}`];
    expect(spec).toMatchObject({ id, direction, face, hero, tier, variant });
    expect(spec.taps).toEqual(field.taps);
    expect(spec.taps.length).toBe(3);
    expect(spec.layout).toBe(field.layout);
    expect(spec.periodMs).toBe(BASE.field.clock.T);
  });

  it('a launch\'s id that is not a cost scene is a programming error', () => {
    expect(() => costSceneSpec('field.abyss.dark.three.full')).toThrow(/not a lab cost scene/);
    expect(() => costSceneSpec('cost.abyss.light.three.full.heavy')).toThrow(/not a lab cost scene/);
    expect(costSceneSpec(IDS[0])).toBe(COST_SCENE_SPECS[IDS[0]]);
  });
});

describe('the cost group (sceneGroups/cost.ts) in SCENES', () => {
  it('holds every cost scene, drawn by CostScene, with the stage probe and the field\'s period', () => {
    expect(Object.keys(COST_SCENES).sort()).toEqual([...IDS].sort());
    for (const id of IDS) {
      expect(COST_SCENES[id].Component).toBe(CostScene);
      expect(COST_SCENES[id].probes).toEqual(['stage']);
      expect(COST_SCENES[id].periodMs).toBe(BASE.field.clock.T);
      expect(SCENES[id]).toBe(COST_SCENES[id]);
    }
  });
});
