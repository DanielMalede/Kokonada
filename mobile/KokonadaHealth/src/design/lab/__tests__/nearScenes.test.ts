/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { validatePlan } from '../../../../scripts/lab/capture.mjs';
import { EXTENSIONS } from '../../v2/tokens/tokens.extensions.generated';
import { BASE, DIRECTIONS } from '../../v2/tokens/tokens.generated';
import { FIELD_FACES, FIELD_SCENES, NEAR_SCENES, NEAR_TIER } from '../fieldScenes';
import { parseLabArgs } from '../params';
import { SCENES } from '../scenes';
// SCENES reaches FieldView, whose fieldImage.tsx reads Skia's FilterMode on load: the setup stub lacks it (__fixtures__/skiaHeadless.ts).
jest.mock('@shopify/react-native-skia', () => require('./__fixtures__/skiaHeadless').skiaHeadless());

// UI-210 (B8-9; the second critic's item 7, accepted by the architect's B4 re-rule): the near.* scenes, one bead just
// outside the neutral disc on each diagonal, (±0.141, ±0.141), r 0.2 and p 0.11 of the placement ramp, scribed into the
// hero $extensions as capture data, drawn by the lab on both Abyss faces (S1: the full tier, the fixed clock at t*), and
// shot by scripts/lab/capture-plans/v1-near.json, each shot's expect {direction, face, hero, tier} the catalogue's.

type Placement = { readonly node: string; readonly x: number; readonly y: number };
const HERO = (EXTENSIONS as unknown as { base: { $root: { hero: { scenes: Record<string, { placements?: readonly Placement[] }> } } } }).base.$root.hero.scenes;
const D = 0.141;
// The quadrant by sign (x ≥ 0 pleasant, y ≥ 0 more energy): J (+, +), C (+, −), R (−, −), I (−, +).
const RULED: Readonly<Record<string, Placement>> = {
  'near.joy': { node: 'J', x: D, y: D },
  'near.calm': { node: 'C', x: D, y: -D },
  'near.reflective': { node: 'R', x: -D, y: -D },
  'near.intense': { node: 'I', x: -D, y: D },
};
const NEAR_IN_TOKENS = Object.keys(HERO).filter((k) => k.startsWith('near.'));

const PLAN_PATH = path.resolve(__dirname, '../../../../scripts/lab/capture-plans/v1-near.json');
type Shot = {
  id: string; repeat: number; scene: string; args: Record<string, string>; probes: string[];
  device: { fontScale: number; night: string; animatorScale: number; powerSave: boolean };
  expect: { direction: string; face: string; hero: string; tier: string };
};
// Read only when it exists, so a missing plan fails by name below (validatePlan refuses an empty plan), never as a suite error.
const plan = (fs.existsSync(PLAN_PATH) ? JSON.parse(fs.readFileSync(PLAN_PATH, 'utf8')) : { id: '', shots: [] }) as { id: string; shots: Shot[] } & Record<string, unknown>;
const timings = Object.fromEntries(Object.entries(SCENES).map(([id, s]) => [id, { periodMs: s.periodMs }]));
const nearIds = Object.values(FIELD_SCENES).filter((s) => s.kind === 'field' && s.hero !== null && s.hero.startsWith('near.')).map((s) => s.id);

describe('the near.* scenes in the hero $extensions (capture data)', () => {
  it('are exactly the four the ruling names, each one bead at (±0.141, ±0.141) with its quadrant\'s node', () => {
    expect(NEAR_IN_TOKENS.sort()).toEqual(Object.keys(RULED).sort());
    for (const [id, bead] of Object.entries(RULED)) expect(HERO[id].placements).toEqual([bead]);
  });

  it('sit just outside the neutral disc: r 0.2, p 0.11 of the placement ramp (DSN-017 applied to the field)', () => {
    const { neutralRadius, rampEnd } = BASE.placement;
    expect(NEAR_IN_TOKENS).toHaveLength(4); // has cases
    for (const id of NEAR_IN_TOKENS) {
      const [{ x, y }] = HERO[id].placements!;
      const r = Math.hypot(x, y);
      expect(r).toBeGreaterThan(neutralRadius);
      expect(r).toBeCloseTo(0.2, 2);
      expect((r - neutralRadius) / (rampEnd - neutralRadius)).toBeCloseTo(0.11, 2);
    }
  });
});

describe('the lab draws them: Abyss, both faces, the full tier (S1)', () => {
  it('the catalogue holds one field scene per near.* scene and face, at the full tier only, and no other near scene', () => {
    expect(NEAR_SCENES).toEqual(['near.joy', 'near.calm', 'near.reflective', 'near.intense']);
    expect([...NEAR_SCENES].sort()).toEqual([...NEAR_IN_TOKENS].sort());
    expect(NEAR_TIER).toBe('full');
    const expected = FIELD_FACES.flatMap((face) => NEAR_SCENES.map((scene) => `field.abyss.${face}.${scene}.full`));
    expect(expected).toHaveLength(8); // has cases: 4 scenes × 2 faces
    expect(nearIds.sort()).toEqual([...expected].sort());
    expect(Object.keys(FIELD_SCENES).filter((id) => id.includes('.near.')).sort()).toEqual([...expected].sort());
  });

  it('each scene\'s face, hero, tier and taps come from its id and the token, and the lab registers it as a field scene', () => {
    expect(nearIds).toHaveLength(8); // has cases
    for (const id of nearIds) {
      const s = FIELD_SCENES[id];
      const [, direction, face, ...rest] = id.split('.');
      expect([s.kind, s.direction, s.face, s.tier, s.hero]).toEqual(['field', direction, face, rest[rest.length - 1], rest.slice(0, -1).join('.')]);
      expect(s.taps).toEqual([{ x: RULED[s.hero!].x, y: RULED[s.hero!].y }]);
      expect(s.periodMs).toBe(BASE.field.clock.T);
      expect(SCENES[id]).toBeDefined();
    }
  });
});

describe('the near capture plan (scripts/lab/capture-plans/v1-near.json)', () => {
  it('is a valid plan for the harness (validatePlan), named v1-near', () => {
    expect(validatePlan(plan)).toEqual([]);
    expect(plan.id).toBe('v1-near');
  });

  it('shoots every near scene exactly once (twice over, by repeat), and nothing else', () => {
    expect(plan.shots).toHaveLength(8);
    expect(plan.shots.map((s) => s.scene).sort()).toEqual([...nearIds].sort());
    expect(new Set(plan.shots.map((s) => s.id)).size).toBe(plan.shots.length);
  });

  it('every shot\'s expect is its scene\'s {direction, face, hero, tier} in the catalogue, and only those four keys', () => {
    expect(plan.shots).toHaveLength(8); // has cases
    for (const shot of plan.shots) {
      const s = FIELD_SCENES[shot.scene];
      expect(shot.expect).toEqual({ direction: s.direction, face: s.face, hero: s.hero, tier: s.tier });
    }
  });

  it('S1: a fixed clock at t*, twice, the system night mode on its face, font scale 1, no reduced motion or power save', () => {
    expect(plan.shots).toHaveLength(8); // has cases
    for (const shot of plan.shots) {
      expect(shot.args.clock).toBe('fixed');
      expect(shot.args.t).toBe(String(DIRECTIONS.abyss.field.stillTime));
      expect(shot.repeat).toBe(2);
      expect(shot.device.night).toBe(FIELD_SCENES[shot.scene].face === 'dark' ? 'yes' : 'no');
      expect([shot.device.fontScale, shot.device.animatorScale, shot.device.powerSave]).toEqual([1, 1, false]);
    }
  });

  it('every shot launches its scene with exactly the probes it declares, in arguments the lab parses, READY after 10 frames or more', () => {
    expect(plan.shots).toHaveLength(8); // has cases
    for (const shot of plan.shots) {
      expect([...shot.probes].sort()).toEqual([...SCENES[shot.scene].probes].sort());
      const parsed = parseLabArgs({ ...shot.args, run: 'plan-check', scene: shot.scene }, [], timings);
      expect(parsed).toMatchObject({ ok: true });
      expect(parsed.ok && parsed.params.frames).toBeGreaterThanOrEqual(10);
    }
  });

  it('carries no key the harness does not read, but expect (the B8 contract)', () => {
    const PLAN_KEYS = ['id', 'app', 'readyTimeoutMs', 'settleMs', 'session', 'shots'];
    const SHOT_KEYS = ['id', 'repeat', 'scene', 'args', 'device', 'probes', 'expect'];
    expect(Object.keys(plan).filter((k) => !PLAN_KEYS.includes(k))).toEqual([]);
    expect(plan.shots).toHaveLength(8); // has cases
    for (const shot of plan.shots) expect(Object.keys(shot).sort()).toEqual([...SHOT_KEYS].sort());
  });
});
