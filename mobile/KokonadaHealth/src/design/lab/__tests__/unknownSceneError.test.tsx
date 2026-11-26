import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { LabRoot } from '../LabRoot';
import { parseLabArgs } from '../params';
import { Probe } from '../probe/Probe';
import { formatLine, MAX_LINE_BYTES } from '../protocol';
import type { Scene } from '../scenes';
// LabRoot's SCENES reaches FieldView, whose fieldImage.tsx reads Skia's FilterMode on load (__fixtures__/skiaHeadless.ts).
jest.mock('@shopify/react-native-skia', () => require('./__fixtures__/skiaHeadless').skiaHeadless());

// B8: the unknown-scene ERROR once listed every scene id. With the B8 groups the catalogue nears formatLine's 4000-byte
// limit, past which formatLine throws inside LabRoot's ERROR effect (an uncaught throw, and no ERROR line at all). So the
// message names the unknown scene, how many scenes are known and their families, within a byte budget, never every id.

const bytes = (s: string) => Buffer.byteLength(s, 'utf8');
const Stage = () => <Probe id="stage"><Text>x</Text></Probe>;
const planted = (n: number, id: (i: number) => string): Record<string, Scene> => Object.fromEntries(
  Array.from({ length: n }, (_, i) => [id(i), { periodMs: 6000, probes: ['stage'], Component: Stage }]),
);
// 500 ids in a handful of families, each id about as long as the real ones.
const FAMILIES = ['field', 'fallback', 'cost', 'witness', 'grain', 'storm'];
const MANY = planted(500, (i) => `${FAMILIES[i % FAMILIES.length]}.abyss.dark.planted.scene.${String(i).padStart(3, '0')}.full`);
// 500 ids, every one its own family: the worst case for a list of families.
const STRANGERS = planted(500, (i) => `stranger${String(i).padStart(3, '0')}xxxxxxxxxxxxxxxxxxxx.abyss.dark.full`);
const timings = (scenes: Record<string, Scene>) => Object.fromEntries(Object.entries(scenes).map(([id, s]) => [id, { periodMs: s.periodMs }]));

const sceneError = (scene: string, scenes: Record<string, Scene>) => {
  const r = parseLabArgs({ run: 'r1', scene, clock: 'fixed', t: '0' }, [], timings(scenes));
  if (r.ok) throw new Error('expected a refusal');
  const errors = r.errors.filter((e) => e.startsWith('scene '));
  expect(errors).toHaveLength(1);
  return { message: errors[0], line: formatLine('ERROR', { run: r.run, errors: r.errors }) };
};

describe('the unknown-scene ERROR is bounded (B8)', () => {
  it('500 scenes in a few families: the line stays under the limit, names the id, the count and the families', () => {
    const { message, line } = sceneError('field.abyss.dark.nope', MANY);
    expect(bytes(line)).toBeLessThan(MAX_LINE_BYTES);
    expect(message).toMatch(/^scene "field\.abyss\.dark\.nope" is not a lab scene/);
    expect(message).toContain('500 known');
    for (const f of FAMILIES) expect(message).toContain(`${f}.*`);
    expect(message).not.toContain('planted.scene');
  });

  it('500 scenes, each its own family: still under the limit, with the id and the count, and the rest counted', () => {
    const { message, line } = sceneError('nope', STRANGERS);
    expect(bytes(line)).toBeLessThan(MAX_LINE_BYTES);
    expect(message).toMatch(/^scene "nope" is not a lab scene/);
    expect(message).toContain('500 known');
    expect(message).toMatch(/\+\d+ more/);
  });

  it('a scene id far too long to send is cut, its start still named', () => {
    const long = `field.abyss.${'q'.repeat(5000)}`;
    const { message, line } = sceneError(long, MANY);
    expect(bytes(line)).toBeLessThan(MAX_LINE_BYTES);
    expect(message.startsWith(`scene "${long.slice(0, 60)}`)).toBe(true);
    expect(message).toContain('…');
  });

  it('the families of the real catalogue are named, smoke by its own id', () => {
    const { message } = sceneError('nope', planted(3, (i) => ['smoke', 'field.abyss.dark.a', 'fallback.abyss.dark.b'][i]));
    expect(message).toBe('scene "nope" is not a lab scene (3 known: smoke, field.*, fallback.*)');
  });

  it('end to end: LabRoot with 500 scenes sends one ERROR line under the limit that names the unknown scene', () => {
    const lines: string[] = [];
    let tree!: ReactTestRenderer.ReactTestRenderer;
    for (const scenes of [MANY, STRANGERS]) {
      lines.length = 0;
      act(() => {
        tree = ReactTestRenderer.create(
          <LabRoot labArgs={{ run: 'r1', scene: 'field.abyss.dark.nope', clock: 'fixed', t: '0' }} nonStringKeys={[]} deps={{ emit: (l) => lines.push(l), scenes }} />,
        );
      });
      expect(lines).toHaveLength(1);
      expect(lines[0].startsWith('KOKONADA_LAB ERROR ')).toBe(true);
      expect(bytes(lines[0])).toBeLessThan(MAX_LINE_BYTES);
      const payload = JSON.parse(lines[0].slice('KOKONADA_LAB ERROR '.length));
      expect(payload).toEqual({ run: 'r1', errors: [expect.stringMatching(/^scene "field\.abyss\.dark\.nope" is not a lab scene \(500 known: /)] });
      expect(tree.toJSON()).toBeNull();
      act(() => tree.unmount());
    }
  });
});
