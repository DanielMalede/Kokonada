/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { FilterMode, MipmapMode } from '@shopify/react-native-skia';
import { isSessionPlan, renderFacts, surfaceRule, validatePlan } from '../../../../scripts/lab/capture.mjs';
import { renderScaleFor } from '../../v2/field/fieldDriver';
import { FIELD_SAMPLING } from '../../v2/field/fieldImage';
import { resolveMotionTier } from '../../v2/motion/useMotionPolicy';
import { FIELD_DIRECTION, FIELD_FACES, FIELD_SCENES, FIELD_TIERS } from '../fieldScenes';
import { parseLabArgs } from '../params';
import { GRAIN_SPECS } from '../grain/grainFrames';
import { SCENES } from '../scenes';
import { STORM_SCENE_SPECS } from '../storm/stormScenes';
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
//   grain.<direction>.<face>.<tier>                               the hero frame it draws, and its tier (GRAIN_SPECS)
//   cost.<direction>.<face>.<hero>.<tier>[.storm|.heavy|.empty]
//   storm.<direction>.<face>.<case>-<tier>                        no hero; the case's tier (STORM_SCENE_SPECS, UI-241)
// A scene the catalogue cannot state facts for fails here, naming it: a plan cannot claim facts nobody pinned.
// A session plan (v1.json, B8-10) lists plans and has no shots of its own: scripts/lab/__tests__/captureSession.test.ts
// checks it, and that it names every plan here.

const PLANS_DIR = path.resolve(__dirname, '../../../../scripts/lab/capture-plans');
const PLAN_FILES = fs.readdirSync(PLANS_DIR).filter((f) => f.endsWith('.json'))
  .filter((f) => !isSessionPlan(JSON.parse(fs.readFileSync(path.join(PLANS_DIR, f), 'utf8')))).sort();
type Expect = { direction: string | null; face: string | null; hero: string | null; tier: string | null };
type Shot = {
  id: string; scene: string; args: Record<string, string>; probes: string[]; expect: Expect;
  device: { animatorScale: number; powerSave: boolean };
};

/** A shot's facts: the catalogue's, and for a policy scene (B8-6) the tier its device state implies under the policy
 *  (on Android RN's reduced motion is a transition animator scale of 0; the harness sets every scale to animatorScale). */
function shotFacts(shot: Shot): Expect {
  const facts = catalogueFacts(shot.scene);
  if (!FIELD_SCENES[shot.scene]?.policy) return facts;
  return { ...facts, tier: resolveMotionTier({ reduceMotion: shot.device.animatorScale === 0, powerSave: shot.device.powerSave }) };
}
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
  if (ok && group === 'grain' && rest.length === 1 && TIERS.includes(rest[0]) && Object.prototype.hasOwnProperty.call(GRAIN_SPECS, id)) {
    const g = GRAIN_SPECS[id];
    return { direction: g.direction, face: g.face, hero: g.hero, tier: g.tier };
  }
  if (ok && group === 'storm' && rest.length === 1 && Object.prototype.hasOwnProperty.call(STORM_SCENE_SPECS, id)) {
    return { direction, face, hero: null, tier: STORM_SCENE_SPECS[id].tier };
  }
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
    // A grain scene draws a hero frame (the rest scene's, grain/grainFrames.ts): its facts are the grain group's own (GRAIN_SPECS).
    ['grain.abyss.light.low', { direction: 'abyss', face: 'light', hero: GRAIN_SPECS['grain.abyss.light.low'].hero, tier: 'low' }],
    ['cost.abyss.dark.three.full', { direction: 'abyss', face: 'dark', hero: 'three', tier: 'full' }],
    ['cost.abyss.dark.one.intense.low.storm', { direction: 'abyss', face: 'dark', hero: 'one.intense', tier: 'low' }],
    ['cost.abyss.light.rest.full.heavy', { direction: 'abyss', face: 'light', hero: 'rest', tier: 'full' }],
    // A storm scene draws FieldView at its case's tier (storm/stormScenes.ts), and READY says it (UI-241).
    ['storm.abyss.dark.first-full', { direction: 'abyss', face: 'dark', hero: null, tier: 'full' }],
    ['storm.abyss.dark.toggle-still', { direction: 'abyss', face: 'dark', hero: null, tier: 'still' }],
  ])('%s', (id, facts) => {
    expect(catalogueFacts(id)).toEqual(facts);
  });

  it.each(['witness.abyss.dark.extra', 'grain.abyss.dark.medium', 'grain.abyss.dark', 'grain.abyss.dark.still', 'cost.abyss.dark.full', 'cost.abyss.dusk.three.full',
    'storm.abyss.dark', 'storm.abyss.dark.burst', 'storm.calm.dark.burst', 'near.abyss.dark.ne', 'field.abyss.dark.nowhere.full'])('states no facts for %s', (id) => {
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
    for (const shot of plan.shots) expect([shot.id, shot.expect]).toEqual([shot.id, shotFacts(shot)]);
  });
});

// Every field and fallback scene of the catalogue is shot on a fixed clock (a still, no proof) by SOME plan: v1-field.json
// holds the hero scenes and the fallback's, v1-near.json the near.* scenes (UI-210). One case per scene, so a scene no
// plan shoots fails by its own name.
const STILL_SCENES = new Set(PLAN_FILES.flatMap((f) => load(f).shots)
  .filter((s) => s.args.clock === 'fixed' && (s as { proof?: unknown }).proof === undefined).map((s) => s.scene));
const CATALOGUE_IDS = Object.values(FIELD_SCENES).filter((s) => s.kind === 'field' || s.kind === 'fallback').map((s) => s.id).sort();

describe('the plans together shoot every field and fallback scene of the catalogue on a fixed clock', () => {
  it('has cases: the catalogue lists field and fallback scenes, and the plans shoot stills', () => {
    expect(CATALOGUE_IDS.filter((id) => FIELD_SCENES[id].kind === 'field').length).toBeGreaterThan(0);
    expect(CATALOGUE_IDS.filter((id) => FIELD_SCENES[id].kind === 'fallback').length).toBeGreaterThan(0);
    expect(STILL_SCENES.size).toBeGreaterThan(0);
  });

  it.each(CATALOGUE_IDS)('%s is shot on a fixed clock by some plan', (id) => {
    expect([id, STILL_SCENES.has(id)]).toEqual([id, true]);
  });
});

// UI-171 (RA-48): the frame cap is measured on the device. For each moving tier (fpsCap > 0 in field.tiers) some plan holds a
// `rate` shot on a running clock at that tier, whose band holds the tier's fpsCap. The low tier's band must also lie below
// the midpoint between its cap and the display's rate (the full tier's cap, the panel's rate), so an uncapped field (about
// the display's rate, minus jitter) can never pass as capped. fpsCap comes from the tokens, never a literal.
describe('the plans together measure the frame cap of every moving tier (UI-171, RA-48)', () => {
  type RateShot = Shot & { proof?: { kind: string; band?: { min: number; max: number } } };
  const FIELD_TIERS_TOKENS = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../../../design-tokens/base.tokens.json'), 'utf8')).field.tiers;
  const capOf = (tier: string): number => FIELD_TIERS_TOKENS[tier].fpsCap.$value;
  const MOVING = FIELD_TIERS.filter((tier) => capOf(tier) > 0);
  const RATES = PLAN_FILES.flatMap((f) => load(f).shots as RateShot[]).filter((s) => s.proof?.kind === 'rate');

  it('has cases: two moving tiers, low capped below full', () => {
    expect([...MOVING].sort()).toEqual(['full', 'low']);
    expect(capOf('low')).toBeLessThan(capOf('full'));
  });

  it.each(MOVING)('a rate shot at %s on a running clock, its band holding the tier’s fpsCap', (tier) => {
    const shots = RATES.filter((s) => shotFacts(s).tier === tier && s.args.clock === 'realtime');
    expect([tier, shots.length > 0]).toEqual([tier, true]);
    for (const s of shots) expect([s.id, s.proof!.band!.min <= capOf(tier) && capOf(tier) <= s.proof!.band!.max]).toEqual([s.id, true]);
  });

  it('the low band cannot pass an uncapped field: it lies below the midpoint between low’s cap and the display’s rate', () => {
    const shots = RATES.filter((s) => shotFacts(s).tier === 'low');
    expect(shots.length).toBeGreaterThan(0);
    const limit = (capOf('low') + capOf('full')) / 2;
    for (const s of shots) expect([s.id, s.proof!.band!.max < limit]).toEqual([s.id, true]);
  });

  // RA-52: Android holds the display at 60 Hz in battery saver, so a low rate shot under battery saver passes whether or
  // not the tier caps its own rate. Each one needs a twin at the low tier with battery saver off and motion on (the
  // display at its full rate), on the same face and hero scene, so only the tier can hold the rate at its cap.
  it('every low rate shot under battery saver has a twin at low with battery saver off and motion on (RA-52)', () => {
    const saver = RATES.filter((s) => shotFacts(s).tier === 'low' && s.device.powerSave);
    expect(saver.length).toBeGreaterThan(0); // has cases
    for (const s of saver) {
      const facts = shotFacts(s);
      const twins = RATES.filter((t) => {
        const f = shotFacts(t);
        return f.tier === 'low' && f.face === facts.face && f.hero === facts.hero && !t.device.powerSave
          && t.device.animatorScale > 0 && t.args.clock === 'realtime';
      });
      expect([s.id, twins.map((t) => t.id).length > 0]).toEqual([s.id, true]);
    }
  });
});

describe('the plans and the harness, against the lab', () => {
  it('the plans this branch ships are there (a plan another package adds later is checked once it exists)', () => {
    expect(PLAN_FILES).toEqual(expect.arrayContaining(['smoke.json', 'v1-field.json']));
  });

  // F10 G8: the fonts scenes draw no field, as smoke does; nor do the F10 parts scenes (LF3).
  const FIELDLESS = (id: string) => id === 'smoke' || id.startsWith('fonts.') || id.startsWith('parts.');

  it('every lab scene has a surface rule: a field scene is the field shader\'s, a fallback scene the fallback\'s, smoke, the fonts and the parts scenes nobody\'s', () => {
    for (const id of Object.keys(SCENES)) {
      const rule = surfaceRule(id);
      expect([id, rule !== null]).toEqual([id, true]);
      const spec = FIELD_SCENES[id];
      const want = spec === undefined ? (FIELDLESS(id) ? undefined : 'ready') : spec.kind === 'field' ? 'ready' : 'fallback-scene';
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
