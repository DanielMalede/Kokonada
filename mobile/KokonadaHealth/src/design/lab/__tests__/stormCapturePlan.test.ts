/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { validatePlan } from '../../../../scripts/lab/capture.mjs';
import { STORM_SCENES } from '../sceneGroups/storm';
import { STORM_SCENE_SPECS } from '../storm/stormScenes';
// SCENES reaches FieldView, whose fieldImage.tsx reads Skia's FilterMode on load: the setup stub lacks it (__fixtures__/skiaHeadless.ts).
jest.mock('@shopify/react-native-skia', () => require('./__fixtures__/skiaHeadless').skiaHeadless());

// B8-7 (the architect's B8 plan at 199b138; QA-068's S7, UI-190): scripts/lab/capture-plans/v1-storm.json records every
// storm scene once with screenrecord (the `record` proof), Abyss dark on the real-time clock, the still cases under
// reduced motion (animator scale 0, as v1-field's reduced-motion shot) and the full case with motion on. Each recording is
// at least two of its script's cycles long, so it holds one whole cycle wherever screenrecord starts after READY. The
// size is half the S22+'s FHD+ screen, even on both sides as screenrecord needs. capturePlans.test.ts holds every plan to
// the harness and the catalogue (probes, args, expect); this pins what the storm plan itself must say.

const FILE = path.resolve(__dirname, '../../../../scripts/lab/capture-plans/v1-storm.json');
type Shot = {
  id: string; repeat: number; scene: string; args: Record<string, string>; probes: string[];
  device: { fontScale: number; night: string; animatorScale: number; powerSave: boolean };
  expect: Record<string, string | null>; proof: { kind: string; seconds: number; size: { width: number; height: number } };
};
const plan = JSON.parse(fs.readFileSync(FILE, 'utf8')) as { id: string; shots: Shot[] };

describe('the storm capture plan', () => {
  it('is a valid plan named v1-storm', () => {
    expect(validatePlan(plan)).toEqual([]);
    expect(plan.id).toBe('v1-storm');
  });

  it('one shot per storm scene, in the catalogue\'s order, each launched once', () => {
    expect(plan.shots.map((s) => s.scene)).toEqual(Object.keys(STORM_SCENES));
    expect(plan.shots.map((s) => s.repeat)).toEqual(plan.shots.map(() => 1));
    expect(new Set(plan.shots.map((s) => s.id)).size).toBe(plan.shots.length);
  });

  it.each(Object.keys(STORM_SCENE_SPECS))('%s: Abyss dark, real time, reduced motion exactly at the still tier', (scene) => {
    const shot = plan.shots.find((s) => s.scene === scene)!;
    const spec = STORM_SCENE_SPECS[scene];
    expect(shot.expect).toEqual({ direction: 'abyss', face: 'dark', hero: null, tier: spec.tier });
    expect(shot.args).toEqual({ clock: 'realtime', frames: '10' });
    expect(shot.device).toEqual({ fontScale: 1, night: 'yes', animatorScale: spec.tier === 'still' ? 0 : 1, powerSave: false });
    expect(shot.probes).toEqual(['stage', 'marker']);
  });

  it.each(Object.keys(STORM_SCENE_SPECS))('%s: a recording of at least two cycles, at half the FHD+ screen', (scene) => {
    const shot = plan.shots.find((s) => s.scene === scene)!;
    const { cycleMs } = STORM_SCENE_SPECS[scene].script;
    expect(shot.proof.kind).toBe('record');
    expect(shot.proof.seconds * 1000).toBeGreaterThanOrEqual(2 * cycleMs);
    expect(shot.proof.seconds * 1000).toBeLessThanOrEqual(2 * cycleMs + 4000);
    expect(shot.proof.size).toEqual({ width: 540, height: 1170 });
  });
});
