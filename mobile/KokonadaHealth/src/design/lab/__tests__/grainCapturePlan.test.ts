/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { validatePlan } from '../../../../scripts/lab/capture.mjs';
import { DIRECTIONS } from '../../v2/tokens/tokens.generated';
import { GRAIN_SPECS } from '../grain/grainFrames';
import { parseLabArgs } from '../params';
import { GRAIN_SCENES } from '../sceneGroups/grain';
import { SCENES } from '../scenes';
import { GRAIN_SCENE_PROBES, GrainScene } from '../scenes/GrainScene';
// SCENES reaches FieldView, whose fieldImage.tsx reads Skia's FilterMode on load: the setup stub lacks it (__fixtures__/skiaHeadless.ts).
jest.mock('@shopify/react-native-skia', () => require('./__fixtures__/skiaHeadless').skiaHeadless());

// B8-4: the grain group in the catalogue (sceneGroups/grain.ts, composed by scenes.ts), and its capture plan
// (scripts/lab/capture-plans/v1-grain.json), every shot's `expect` the catalogue's facts (the B8 plan, F4).

const PLAN_PATH = path.resolve(__dirname, '../../../../scripts/lab/capture-plans/v1-grain.json');
type Shot = {
  id: string; repeat: number; scene: string; args: Record<string, string>; probes: string[];
  device: { fontScale: number; night: string; animatorScale: number; powerSave: boolean };
  expect: { direction: string; face: string; hero: string; tier: string };
};
const plan = JSON.parse(fs.readFileSync(PLAN_PATH, 'utf8')) as { id: string; shots: Shot[] };
const timings = Object.fromEntries(Object.entries(SCENES).map(([id, s]) => [id, { periodMs: s.periodMs }]));

describe('the grain scene group', () => {
  it('is the four grain scenes, each the grain scene on the field\'s period with its probes, all in SCENES', () => {
    expect(Object.keys(GRAIN_SCENES).sort()).toEqual(Object.keys(GRAIN_SPECS).sort());
    for (const [id, s] of Object.entries(GRAIN_SCENES)) {
      expect(s.Component).toBe(GrainScene);
      expect(s.periodMs).toBe(GRAIN_SPECS[id].periodMs);
      expect(s.probes).toEqual(GRAIN_SCENE_PROBES);
      expect(SCENES[id]).toBe(s);
    }
  });
});

describe('the v1 grain capture plan', () => {
  it('is a valid plan for the harness (validatePlan)', () => {
    expect(validatePlan(plan)).toEqual([]);
    expect(plan.id).toBe('v1-grain');
  });

  it('shoots every grain scene twice (determinism) on a fixed clock at t*, the system night mode on its face', () => {
    expect([...new Set(plan.shots.map((s) => s.scene))].sort()).toEqual(Object.keys(GRAIN_SPECS).sort());
    for (const shot of plan.shots) {
      expect(shot.args.clock).toBe('fixed');
      expect(shot.args.t).toBe(String(DIRECTIONS.abyss.field.stillTime));
      expect(shot.repeat).toBe(2);
      expect(shot.device.night).toBe(GRAIN_SPECS[shot.scene].face === 'dark' ? 'yes' : 'no');
      expect([shot.device.fontScale, shot.device.animatorScale, shot.device.powerSave]).toEqual([1, 1, false]);
    }
  });

  it('every shot launches its scene with exactly the probes it declares, in arguments the lab parses, READY after 10 frames', () => {
    for (const shot of plan.shots) {
      expect([...shot.probes].sort()).toEqual([...SCENES[shot.scene].probes].sort());
      const parsed = parseLabArgs({ ...shot.args, run: 'plan-check', scene: shot.scene }, [], timings);
      expect(parsed).toMatchObject({ ok: true });
      expect(parsed.ok && parsed.params.frames).toBeGreaterThanOrEqual(10);
    }
  });

  it("every shot's expect is its scene's facts from the catalogue (F4: never tap coordinates)", () => {
    for (const shot of plan.shots) {
      const s = GRAIN_SPECS[shot.scene];
      expect(shot.expect).toEqual({ direction: s.direction, face: s.face, hero: s.hero, tier: s.tier });
    }
  });

  it('carries no key the harness does not read, besides expect', () => {
    const PLAN_KEYS = ['id', 'app', 'readyTimeoutMs', 'settleMs', 'session', 'shots'];
    const SHOT_KEYS = ['id', 'repeat', 'scene', 'args', 'device', 'probes', 'expect'];
    expect(Object.keys(plan).filter((k) => !PLAN_KEYS.includes(k))).toEqual([]);
    for (const shot of plan.shots) expect(Object.keys(shot).filter((k) => !SHOT_KEYS.includes(k))).toEqual([]);
  });
});
