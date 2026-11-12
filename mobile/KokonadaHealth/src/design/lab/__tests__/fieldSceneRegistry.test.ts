import { FIELD_SCENES } from '../fieldScenes';
import { parseLabArgs } from '../params';
import { SCENES } from '../scenes';
import { FallbackScene } from '../scenes/FallbackScene';
import { FieldScene } from '../scenes/FieldScene';

// T14, S4: every field and fallback scene of the catalogue is a lab scene a launch can name, drawn by its own component,
// with its period and its one probe; the launch parser takes each id and holds its clocks within [0, T).

const timings = Object.fromEntries(Object.entries(SCENES).map(([id, s]) => [id, { periodMs: s.periodMs }]));
const IDS = Object.keys(FIELD_SCENES);

describe('the field scenes are registered in SCENES', () => {
  it('every catalogue id, and the smoke scene still', () => {
    expect(IDS.length).toBeGreaterThan(0);
    expect(Object.keys(SCENES).sort()).toEqual(['smoke', ...IDS].sort());
  });

  it.each(IDS)('%s: its component, its period and the stage probe', (id) => {
    const spec = FIELD_SCENES[id];
    const scene = SCENES[id];
    expect(scene.Component).toBe(spec.kind === 'field' ? FieldScene : FallbackScene);
    expect(scene.periodMs).toBe(spec.periodMs);
    expect(scene.probes).toEqual(['stage']);
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
