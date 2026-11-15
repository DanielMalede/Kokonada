/// <reference types="node" />
import * as path from 'path';
import { importClosure } from '../../../../scripts/lab/importGraph.mjs';
import { FIELD_SCENES } from '../fieldScenes';
import { parseLabArgs } from '../params';
import { SCENE_GROUP_FACES, SCENE_GROUPS, SCENES } from '../scenes';
import { FallbackScene } from '../scenes/FallbackScene';
import { FieldScene } from '../scenes/FieldScene';
// SCENES reaches FieldView, whose fieldImage.tsx reads Skia's FilterMode on load: the setup stub lacks it (__fixtures__/skiaHeadless.ts).
jest.mock('@shopify/react-native-skia', () => require('./__fixtures__/skiaHeadless').skiaHeadless());

// T14, S4: every field and fallback scene of the catalogue is a lab scene a launch can name, drawn by its own component,
// with its period and its one probe; the launch parser takes each id and holds its clocks within [0, T).

const timings = Object.fromEntries(Object.entries(SCENES).map(([id, s]) => [id, { periodMs: s.periodMs }]));
const IDS = Object.keys(FIELD_SCENES);

describe('the field scenes are registered in SCENES', () => {
  // The B8 groups (witness, grain, cost, storm) compose into SCENES under their own `<group>.abyss.` prefix
  // (sceneGroups.test.ts pins that composition); this test owns everything outside those prefixes. The prefixes come
  // from scenes.ts's own group table, never from a second list here.
  const GROUP_PREFIXES = Object.keys(SCENE_GROUP_FACES).map((group) => `${group}.abyss.`);
  const inGroup = (id: string) => GROUP_PREFIXES.some((p) => id.startsWith(p));

  it('every catalogue id, and the smoke scene still (outside the B8 groups)', () => {
    expect(IDS.length).toBeGreaterThan(0);
    expect(Object.keys(SCENES).filter((id) => !inGroup(id)).sort()).toEqual(['smoke', ...IDS].sort());
  });

  it('the prefix filter sets aside exactly the groups\' own scenes: nothing else hides behind a prefix', () => {
    const grouped = Object.values(SCENE_GROUPS).flatMap((g) => Object.keys(g));
    expect(Object.keys(SCENES).filter(inGroup).sort()).toEqual(grouped.sort());
    expect(IDS.filter(inGroup)).toEqual([]);
  });

  it.each(IDS)('%s: its component, its period and the stage probe', (id) => {
    const spec = FIELD_SCENES[id];
    const scene = SCENES[id];
    expect(scene.Component).toBe(spec.kind === 'field' ? FieldScene : FallbackScene);
    expect(scene.periodMs).toBe(spec.periodMs);
    expect(scene.probes).toEqual(['stage']);
  });
});

describe('what each scene component reaches (the import scan of the lab exclusion checks)', () => {
  const APP = path.resolve(__dirname, '../../../..');
  const closureOf = (file: string): string[] => importClosure(path.join(APP, file)).map((f: string) => path.relative(APP, f).split(path.sep).join('/'));

  it('FallbackScene reaches FieldFallback and never FieldView or FieldSurface: it mounts the fallback directly', () => {
    const closure = closureOf('src/design/lab/scenes/FallbackScene.tsx');
    expect(closure).toContain('src/design/v2/field/FieldFallback.tsx');
    expect(closure).not.toContain('src/design/v2/field/FieldView.tsx');
    expect(closure).not.toContain('src/design/v2/field/FieldSurface.tsx');
  });

  it('FieldScene reaches FieldView (the scan sees the edge it is asked about)', () => {
    expect(closureOf('src/design/lab/scenes/FieldScene.tsx')).toContain('src/design/v2/field/FieldView.tsx');
  });
});

describe('parseLabArgs takes every field scene and holds its clock within [0, T)', () => {
  it.each(IDS)('%s', (id) => {
    const T = FIELD_SCENES[id].periodMs;
    const fixed = (t: number) => parseLabArgs({ run: 'r1', scene: id, clock: 'fixed', t: String(t), frames: '10' }, [], timings);
    expect(fixed(0)).toEqual({ ok: true, params: { run: 'r1', scene: id, clock: 'fixed', t: 0, stepMs: 0, frames: 10 } });
    expect(fixed(T - 1).ok).toBe(true);
    expect(fixed(T)).toEqual({ ok: false, run: 'r1', errors: [`t must be in [0, ${T})`] });
    expect(parseLabArgs({ run: 'r1', scene: id, clock: 'stepped', t: '0', stepMs: String(T) }, [], timings)).toEqual({ ok: false, run: 'r1', errors: [`stepMs must be < ${T}`] });
    expect(parseLabArgs({ run: 'r1', scene: id, clock: 'realtime' }, [], timings).ok).toBe(true);
  });

  it('an id that is not a lab scene is refused', () => {
    const r = parseLabArgs({ run: 'r1', scene: 'field.abyss.dark.three.medium', clock: 'fixed', t: '0' }, [], timings);
    expect(r.ok).toBe(false);
  });
});
