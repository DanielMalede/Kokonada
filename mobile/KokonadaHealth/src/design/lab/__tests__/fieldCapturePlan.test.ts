/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { validatePlan } from '../../../../scripts/lab/capture.mjs';
import { DIRECTIONS } from '../../v2/tokens/tokens.generated';
import { FIELD_SCENES, NEAR_SCENES } from '../fieldScenes';
import { parseLabArgs } from '../params';
import { SCENES } from '../scenes';
// SCENES reaches FieldView, whose fieldImage.tsx reads Skia's FilterMode on load: the setup stub lacks it (__fixtures__/skiaHeadless.ts).
jest.mock('@shopify/react-native-skia', () => require('./__fixtures__/skiaHeadless').skiaHeadless());

// T14, S5: the capture plan for the field scenes (scripts/lab/capture-plans/v1-field.json), loaded through the harness's
// own plan validator, and every shot checked against the lab it will launch: its scene exists, its probes are the ones
// the scene declares, its arguments are a launch the lab's parser takes, and READY waits for at least 10 frames.

const PLAN_PATH = path.resolve(__dirname, '../../../../scripts/lab/capture-plans/v1-field.json');
type Shot = {
  id: string; repeat: number; scene: string; args: Record<string, string>; probes: string[];
  device: { fontScale: number; night: string; animatorScale: number; powerSave: boolean };
  proof?: { kind: string; seconds: number };
  expect: { direction: string | null; face: string | null; hero: string | null; tier: string | null };
};
const plan = JSON.parse(fs.readFileSync(PLAN_PATH, 'utf8')) as { id: string; shots: Shot[] };
const timings = Object.fromEntries(Object.entries(SCENES).map(([id, s]) => [id, { periodMs: s.periodMs }]));

describe('the v1 field capture plan', () => {
  it('is a valid plan for the harness (validatePlan)', () => {
    expect(validatePlan(plan)).toEqual([]);
    expect(plan.id).toBe('v1-field');
  });

  it('every shot launches a lab scene with exactly the probes it declares, in arguments the lab parses', () => {
    for (const shot of plan.shots) {
      expect(SCENES[shot.scene]).toBeDefined();
      expect([...shot.probes].sort()).toEqual([...SCENES[shot.scene].probes].sort());
      const parsed = parseLabArgs({ ...shot.args, run: 'plan-check', scene: shot.scene }, [], timings);
      expect(parsed).toMatchObject({ ok: true });
    }
  });

  it('READY waits for at least 10 frames on every shot', () => {
    for (const shot of plan.shots) {
      const parsed = parseLabArgs({ ...shot.args, run: 'plan-check', scene: shot.scene }, [], timings);
      expect(parsed.ok && parsed.params.frames).toBeGreaterThanOrEqual(10);
    }
  });

  // The near.* scenes are v1-near.json's (UI-210); that every scene is shot by some plan is capturePlans.test.ts's pin.
  it('covers every field scene but the near.* ones on a fixed clock, twice (determinism), with the system night mode on its face', () => {
    const fixed = plan.shots.filter((s) => s.args.clock === 'fixed' && s.proof === undefined);
    const near: readonly string[] = NEAR_SCENES;
    const fieldIds = Object.values(FIELD_SCENES).filter((s) => s.kind === 'field' && !near.includes(s.hero!) && !s.policy).map((s) => s.id);
    expect(fieldIds.length).toBeGreaterThan(0); // has cases
    expect(fieldIds.filter((id) => !fixed.some((s) => s.scene === id))).toEqual([]);
    for (const shot of fixed) {
      expect(shot.args.t).toBe(String(DIRECTIONS.abyss.field.stillTime)); // the hero's S1: a fixed clock at t*, the still's own time
      expect(shot.repeat).toBe(2);
      expect(shot.device.night).toBe(FIELD_SCENES[shot.scene].face === 'dark' ? 'yes' : 'no');
      expect([shot.device.fontScale, shot.device.animatorScale, shot.device.powerSave]).toEqual([1, 1, false]);
    }
  });

  // The hero scenes, and the two clip-edge scenes (UI-224: one.C.right and one.J.top, where RA-29 and RA-30 would show).
  it('draws the fallback scenes of the hero scenes and the clip-edge scenes, on both faces', () => {
    for (const face of ['dark', 'light']) {
      for (const scene of ['rest', 'one.J', 'three', 'one.I', 'one.C.right', 'one.J.top']) {
        expect(plan.shots.some((s) => s.scene === `fallback.abyss.${face}.${scene}`)).toBe(true);
      }
    }
  });

  it('the moving tier draws frames on a running clock, and the still tier under reduced motion draws none (a pair)', () => {
    const moving = plan.shots.filter((s) => s.proof?.kind === 'draws-frames');
    const still = plan.shots.filter((s) => s.proof?.kind === 'zero-frames');
    expect(moving.map((s) => [s.scene, s.args.clock, s.device.animatorScale])).toEqual([['field.abyss.dark.three.full', 'realtime', 1]]);
    expect(still.map((s) => [s.scene, s.args.clock, s.device.animatorScale])).toEqual([['field.abyss.dark.three.still', 'realtime', 0]]);
  });

  // UI-215: the harness itself now refuses a key it does not read, so a pixel check it would ignore cannot look like one.
  it('a key the harness does not read makes the plan invalid', () => {
    expect(validatePlan({ ...plan, pixelCheck: true }).join()).toMatch(/pixelCheck is not a plan key/);
    expect(validatePlan({ ...plan, shots: [{ ...plan.shots[0], notFlat: true }, ...plan.shots.slice(1)] }).join()).toMatch(/shots\[0\]\.notFlat is not a plan key/);
  });

  // F4: a row's scene facts are the shot's expect, so each is the field catalogue's own for its scene.
  it("every shot's expect is its scene's facts in the field catalogue", () => {
    for (const shot of plan.shots) {
      const spec = FIELD_SCENES[shot.scene];
      expect([shot.id, shot.expect]).toEqual([shot.id, { direction: spec.direction, face: spec.face, hero: spec.hero, tier: spec.tier }]);
    }
  });
});
