// SCENES reaches FieldView, whose fieldImage.tsx reads Skia's FilterMode on load: the setup stub lacks it (__fixtures__/skiaHeadless.ts).
jest.mock('@shopify/react-native-skia', () => require('./__fixtures__/skiaHeadless').skiaHeadless());

import { FIELD_SCENES } from '../fieldScenes';
import { SCENE_GROUPS, SCENE_GROUP_FACES, SCENES, composeScenes, type Scene, type SceneGroupName } from '../scenes';

// B8-0 (the architect's B8 plan, "Contracts fixed now"). The B8 benches each own a scene group in its own file
// (sceneGroups/<group>.ts), so parallel packages never edit scenes.ts. Each group's ids carry the group's prefix
// (`<group>.abyss.<face>`), an id repeated anywhere in the catalogue is refused when it is built, and composing the
// groups changes no scene that existed before them.

const NOOP = (() => null) as unknown as Scene['Component'];
const scene = (): Scene => ({ periodMs: 1000, probes: ['stage'], Component: NOOP });
const empty = (): Record<SceneGroupName, Record<string, Scene>> => ({ witness: {}, grain: {}, cost: {}, storm: {}, fonts: {} });
const GROUPS = Object.keys(SCENE_GROUP_FACES) as SceneGroupName[];

// The catalogue's ids at 199b138, before any scene group: composing the groups keeps every one.
const KEYS_AT_199B138 = [
  'smoke',
  ...['dark', 'light'].flatMap((face) => ['rest', 'one.joy', 'three', 'one.intense'].flatMap((hero) => ['full', 'low', 'still']
    .map((tier) => `field.abyss.${face}.${hero}.${tier}`))),
  ...['dark', 'light'].flatMap((face) => ['rest', 'one.J', 'one.C', 'one.R', 'one.I', 'one.neutral', 'three', 'reach.top',
    'reach.bottom', 'one.J.top', 'one.C.right'].map((f) => `fallback.abyss.${face}.${f}`)),
];

describe('the lab scene groups (B8-0)', () => {
  it('names exactly the groups, each with its faces (storm is dark only): the four B8 benches and the F10 fonts scenes', () => {
    expect(SCENE_GROUP_FACES).toEqual({ witness: ['dark', 'light'], grain: ['dark', 'light'], cost: ['dark', 'light'], storm: ['dark'], fonts: ['dark', 'light'] });
    expect(Object.keys(SCENE_GROUPS).sort()).toEqual([...GROUPS].sort());
  });

  it.each(GROUPS)("every id in the %s group carries the group's prefix and a face of the group", (group) => {
    for (const id of Object.keys(SCENE_GROUPS[group])) {
      expect(SCENE_GROUP_FACES[group].some((face) => id === `${group}.abyss.${face}` || id.startsWith(`${group}.abyss.${face}.`))).toBe(true);
    }
  });

  it('every grouped scene is in SCENES, as the same object', () => {
    for (const group of GROUPS) for (const [id, s] of Object.entries(SCENE_GROUPS[group])) expect(SCENES[id]).toBe(s);
  });

  it('SCENES is the 199b138 catalogue plus the field catalogue plus the groups, nothing else', () => {
    const keys = Object.keys(SCENES);
    expect(new Set(keys).size).toBe(keys.length);
    for (const id of KEYS_AT_199B138) expect(keys).toContain(id);
    const expected = new Set(['smoke', ...Object.keys(FIELD_SCENES), ...GROUPS.flatMap((g) => Object.keys(SCENE_GROUPS[g]))]);
    expect([...keys].sort()).toEqual([...expected].sort());
    expect(KEYS_AT_199B138).toHaveLength(47);
  });

  it('composes planted groups in order, after the base', () => {
    const base = { smoke: scene() };
    const groups = { ...empty(), witness: { 'witness.abyss.dark': scene() }, storm: { 'storm.abyss.dark.burst': scene() } };
    const out = composeScenes(base, groups);
    expect(Object.keys(out)).toEqual(['smoke', 'witness.abyss.dark', 'storm.abyss.dark.burst']);
    expect(out['witness.abyss.dark']).toBe(groups.witness['witness.abyss.dark']);
  });

  it.each([
    ['another group\'s prefix', { ...empty(), grain: { 'cost.abyss.dark.rest.full': scene() } }],
    ['no direction segment', { ...empty(), witness: { 'witness.dark': scene() } }],
    ['a face the group does not have', { ...empty(), storm: { 'storm.abyss.light.burst': scene() } }],
    ['an unknown face', { ...empty(), cost: { 'cost.abyss.dusk.rest.full': scene() } }],
    ['a prefix run into the face', { ...empty(), witness: { 'witness.abyss.darker': scene() } }],
    ['a field id', { ...empty(), witness: { 'field.abyss.dark.rest.full': scene() } }],
  ])('refuses an id with %s, naming it and its group', (_why, groups) => {
    const [group, ids] = Object.entries(groups).find(([, g]) => Object.keys(g).length > 0)!;
    const id = Object.keys(ids)[0];
    expect(() => composeScenes({ smoke: scene() }, groups)).toThrow(new RegExp(`"${id.replace(/\./g, '\\.')}".*${group}`));
  });

  it('refuses an id repeated across two groups, or between the base and a group, before its prefix is judged', () => {
    const twice = { ...empty(), witness: { 'witness.abyss.dark': scene() }, grain: { 'witness.abyss.dark': scene() } };
    expect(() => composeScenes({}, twice)).toThrow(/"witness\.abyss\.dark" is defined twice/);
    expect(() => composeScenes({ 'witness.abyss.dark': scene() }, { ...empty(), witness: { 'witness.abyss.dark': scene() } }))
      .toThrow(/"witness\.abyss\.dark" is defined twice/);
  });
});
