/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { FilterMode, MipmapMode } from '@shopify/react-native-skia';
import { renderFacts, surfaceRule, validatePlan } from '../../../../scripts/lab/capture.mjs';
import { renderScaleFor } from '../../v2/field/fieldDriver';
import { FIELD_SAMPLING } from '../../v2/field/fieldImage';
import { FIELD_DIRECTION, FIELD_FACES, FIELD_SCENES, FIELD_TIERS } from '../fieldScenes';
import { parseLabArgs } from '../params';
import { SCENES } from '../scenes';
import { WITNESS_SCENE_FACTS } from '../witness/witnessFrames';
// SCENES reaches FieldView, whose fieldImage.tsx reads Skia's FilterMode on load: the setup stub lacks it (__fixtures__/skiaHeadless.ts).
jest.mock('@shopify/react-native-skia', () => require('./__fixtures__/skiaHeadless').skiaHeadless());

// B8-5b (the architect's B8 plan, F4 and "Contracts fixed now"): every capture plan in scripts/lab/capture-plans/, whichever
// exist, is a valid plan whose every shot launches a lab scene with exactly that scene's probes, in arguments the lab
// parses, and whose `expect` {direction, face, hero, tier} is the catalogue's facts for that scene. A manifest row takes
// its scene facts from `expect` alone, never from a lab line, so this pin is what makes those facts true.
//
// The catalogue's facts: a scene of the field catalogue (fieldScenes.ts) states its own; the smoke scene draws no field
// and has none; a scene of a B8 group (witness, grain, cost, storm) states them in its id, by the plan's fixed grammar:
//   witness.<direction>.<face>                                    W1b's hero and tier (WITNESS_SCENE_FACTS)
//   grain.<direction>.<face>.<tier>                               no hero
//   cost.<direction>.<face>.<hero>.<tier>[.storm|.heavy|.empty]
//   storm.<direction>.<face>.<case>                               no hero, no tier
// A scene the catalogue cannot state facts for fails here, naming it: a plan cannot claim facts nobody pinned.

const PLANS_DIR = path.resolve(__dirname, '../../../../scripts/lab/capture-plans');
const PLAN_FILES = fs.readdirSync(PLANS_DIR).filter((f) => f.endsWith('.json')).sort();
type Expect = { direction: string | null; face: string | null; hero: string | null; tier: string | null };
type Shot = { id: string; scene: string; args: Record<string, string>; probes: string[]; expect: Expect };
const load = (file: string) => JSON.parse(fs.readFileSync(path.join(PLANS_DIR, file), 'utf8')) as { id: string; shots: Shot[] };
const timings = Object.fromEntries(Object.entries(SCENES).map(([id, s]) => [id, { periodMs: s.periodMs }]));

const NONE: Expect = { direction: null, face: null, hero: null, tier: null };
const FACES: readonly string[] = FIELD_FACES;
const TIERS: readonly string[] = FIELD_TIERS;
const COST_SUFFIXES = ['storm', 'heavy', 'empty'];

/** The catalogue's facts for a scene id; throws for a scene it cannot state facts for. */
function catalogueFacts(id: string): Expect {
  if (Object.prototype.hasOwnProperty.call(FIELD_SCENES, id)) {
    const s = FIELD_SCENES[id];
    return { direction: s.direction, face: s.face, hero: s.hero, tier: s.tier };
  }
  if (id === 'smoke') return NONE;
  const [group, direction, face, ...rest] = id.split('.');
  const ok = direction === FIELD_DIRECTION && FACES.includes(face);
  if (ok && group === 'witness' && rest.length === 0 && Object.prototype.hasOwnProperty.call(WITNESS_SCENE_FACTS, id)) {
    const w = WITNESS_SCENE_FACTS[id];
    return { direction: w.direction, face: w.face, hero: w.hero, tier: w.tier };
  }
  if (ok && group === 'grain' && rest.length === 1 && TIERS.includes(rest[0])) return { direction, face, hero: null, tier: rest[0] };
  if (ok && group === 'storm' && rest.length === 1) return { direction, face, hero: null, tier: null };
  if (ok && group === 'cost') {
    const body = COST_SUFFIXES.includes(rest[rest.length - 1]) ? rest.slice(0, -1) : rest;
    const tier = body[body.length - 1];
    if (body.length >= 2 && TIERS.includes(tier)) return { direction, face, hero: body.slice(0, -1).join('.'), tier };
  }
  throw new Error(`the catalogue states no facts for scene "${id}"`);
}

describe('the catalogue\'s facts, by the plan\'s grammar', () => {
  it.each([
    ['field.abyss.light.one.joy.low', { direction: 'abyss', face: 'light', hero: 'one.joy', tier: 'low' }],
    ['fallback.abyss.dark.one.C.right', { direction: 'abyss', face: 'dark', hero: null, tier: null }],
    ['smoke', NONE],
    // A witness scene draws W1b, a production hero frame at a tier: its facts are the witness group's own (WITNESS_SCENE_FACTS).
    ['witness.abyss.dark', { direction: 'abyss', face: 'dark', hero: WITNESS_SCENE_FACTS['witness.abyss.dark'].hero, tier: WITNESS_SCENE_FACTS['witness.abyss.dark'].tier }],
    ['witness.abyss.light', { direction: 'abyss', face: 'light', hero: WITNESS_SCENE_FACTS['witness.abyss.light'].hero, tier: WITNESS_SCENE_FACTS['witness.abyss.light'].tier }],
    ['grain.abyss.light.low', { direction: 'abyss', face: 'light', hero: null, tier: 'low' }],
    ['cost.abyss.dark.three.full', { direction: 'abyss', face: 'dark', hero: 'three', tier: 'full' }],
    ['cost.abyss.dark.one.intense.low.storm', { direction: 'abyss', face: 'dark', hero: 'one.intense', tier: 'low' }],
    ['cost.abyss.light.rest.full.heavy', { direction: 'abyss', face: 'light', hero: 'rest', tier: 'full' }],
    ['storm.abyss.dark.burst', { direction: 'abyss', face: 'dark', hero: null, tier: null }],
  ])('%s', (id, facts) => {
    expect(catalogueFacts(id)).toEqual(facts);
  });

  it.each(['witness.abyss.dark.extra', 'grain.abyss.dark.medium', 'grain.abyss.dark', 'cost.abyss.dark.full', 'cost.abyss.dusk.three.full',
    'storm.abyss.dark', 'storm.calm.dark.burst', 'near.abyss.dark.ne', 'field.abyss.dark.nowhere.full'])('states no facts for %s', (id) => {
    expect(() => catalogueFacts(id)).toThrow(new RegExp(`"${id.replace(/\./g, '\\.')}"`));
  });
});

describe.each(PLAN_FILES)('the capture plan %s', (file) => {
  const plan = load(file);

  it('is a valid plan for the harness (validatePlan), named as its file', () => {
    expect(validatePlan(plan)).toEqual([]);
    expect(`${plan.id}.json`).toBe(file);
  });

  it('every shot launches a lab scene with exactly the probes it declares, in arguments the lab parses', () => {
    for (const shot of plan.shots) {
      expect([shot.id, SCENES[shot.scene] !== undefined]).toEqual([shot.id, true]);
      expect([...shot.probes].sort()).toEqual([...SCENES[shot.scene].probes].sort());
      expect(parseLabArgs({ ...shot.args, run: 'plan-check', scene: shot.scene }, [], timings)).toMatchObject({ ok: true });
    }
  });

  it('every shot\'s expect is the catalogue\'s facts for its scene (F4)', () => {
    for (const shot of plan.shots) expect([shot.id, shot.expect]).toEqual([shot.id, catalogueFacts(shot.scene)]);
  });
});

describe('the plans and the harness, against the lab', () => {
  it('the plans this branch ships are there (a plan another package adds later is checked once it exists)', () => {
    expect(PLAN_FILES).toEqual(expect.arrayContaining(['smoke.json', 'v1-field.json']));
  });

  it('every lab scene has a surface rule: a field scene is the field shader\'s, a fallback scene the fallback\'s, smoke nobody\'s', () => {
    for (const id of Object.keys(SCENES)) {
      const rule = surfaceRule(id);
      expect([id, rule !== null]).toEqual([id, true]);
      const spec = FIELD_SCENES[id];
      const want = spec === undefined ? (id === 'smoke' ? undefined : 'ready') : spec.kind === 'field' ? 'ready' : 'fallback-scene';
      expect([id, rule?.status]).toEqual([id, want]);
    }
  });

  it('renderFacts is the driver\'s render scale for every tier and the field image\'s own sampling', () => {
    const tiers = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../../../design-tokens/base.tokens.json'), 'utf8')).field.tiers;
    const nameOf = (e: Record<string, number>, v: number) => Object.entries(e).find(([, x]) => x === v)?.[0].toLowerCase();
    const sampling = { filter: nameOf(FilterMode as unknown as Record<string, number>, FIELD_SAMPLING.filter), mipmap: nameOf(MipmapMode as unknown as Record<string, number>, FIELD_SAMPLING.mipmap) };
    for (const tier of FIELD_TIERS) expect([tier, renderFacts(tier, tiers)]).toEqual([tier, { renderScale: renderScaleFor(tier), sampling }]);
    expect(renderFacts(null, tiers)).toEqual({ renderScale: null, sampling: null });
  });
});
