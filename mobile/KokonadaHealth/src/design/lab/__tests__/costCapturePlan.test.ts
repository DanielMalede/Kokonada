/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { validatePlan } from '../../../../scripts/lab/capture.mjs';
import { COST_SCENE_SPECS } from '../cost/costScenes';
import { parseLabArgs } from '../params';
import { SCENES } from '../scenes';
// SCENES reaches FieldView, whose fieldImage.tsx reads Skia's FilterMode on load: the setup stub lacks it (__fixtures__/skiaHeadless.ts).
jest.mock('@shopify/react-native-skia', () => require('./__fixtures__/skiaHeadless').skiaHeadless());

// B8-3, the cost capture plan (scripts/lab/capture-plans/v1-cost.json), loaded through the harness's own validator and
// checked against the lab it launches. Every shot carries `expect: {direction, face, hero, tier}`, equal to the
// catalogue's facts for its scene (the architect's B8 plan, F4 at A: the manifest's scene facts come from the shot's
// `expect`, pinned to the catalogue; no tap coordinates or emotion values on any lab line). The plan names no proof
// kind: the harness's `result` proof (B8-5b) is not in validatePlan yet, so collecting the RESULT line is the harness's.

const PLAN_PATH = path.resolve(__dirname, '../../../../scripts/lab/capture-plans/v1-cost.json');
type Shot = {
  id: string; repeat: number; scene: string; args: Record<string, string>; probes: string[];
  device: { fontScale: number; night: string; animatorScale: number; powerSave: boolean };
  expect: { direction: string; face: string; hero: string | null; tier: string | null };
};
const raw = fs.readFileSync(PLAN_PATH, 'utf8');
const plan = JSON.parse(raw) as { id: string; shots: Shot[] };
const timings = Object.fromEntries(Object.entries(SCENES).map(([id, s]) => [id, { periodMs: s.periodMs }]));

describe('the v1 cost capture plan', () => {
  it('is a valid plan for the harness (validatePlan)', () => {
    expect(validatePlan(plan)).toEqual([]);
    expect(plan.id).toBe('v1-cost');
  });

  it('has one shot for every cost scene, once', () => {
    expect(plan.shots.map((s) => s.scene).sort()).toEqual(Object.keys(COST_SCENE_SPECS).sort());
  });

  it('every shot\'s expect is exactly its scene\'s catalogue facts {direction, face, hero, tier}', () => {
    for (const shot of plan.shots) {
      const spec = COST_SCENE_SPECS[shot.scene];
      expect(Object.keys(shot.expect).sort()).toEqual(['direction', 'face', 'hero', 'tier']);
      expect(shot.expect).toEqual({ direction: spec.direction, face: spec.face, hero: spec.hero, tier: spec.tier });
    }
  });

  it('every shot launches its scene with exactly its probes, on the real-time clock, in arguments the lab parses', () => {
    for (const shot of plan.shots) {
      expect([...shot.probes].sort()).toEqual([...SCENES[shot.scene].probes].sort());
      const parsed = parseLabArgs({ ...shot.args, run: 'plan-check', scene: shot.scene }, [], timings);
      expect(parsed).toMatchObject({ ok: true, params: { clock: 'realtime' } });
    }
  });

  it('the system night mode is the scene\'s face, motion allowed, no power save, font scale 1, one repeat', () => {
    for (const shot of plan.shots) {
      expect(shot.device).toEqual({ fontScale: 1, night: COST_SCENE_SPECS[shot.scene].face === 'dark' ? 'yes' : 'no', animatorScale: 1, powerSave: false });
      expect(shot.repeat).toBe(1);
    }
  });

  it('carries no key the harness does not read but expect, and no tap coordinates or emotion values anywhere', () => {
    const PLAN_KEYS = ['id', 'app', 'readyTimeoutMs', 'settleMs', 'session', 'shots'];
    const SHOT_KEYS = ['id', 'repeat', 'scene', 'args', 'device', 'probes', 'expect'];
    expect(Object.keys(plan).filter((k) => !PLAN_KEYS.includes(k))).toEqual([]);
    for (const shot of plan.shots) expect(Object.keys(shot).filter((k) => !SHOT_KEYS.includes(k))).toEqual([]);
    expect(raw).not.toMatch(/"(x|y|taps?|tapX|tapY|valence|arousal|emotion|stress)"\s*:/);
  });
});
