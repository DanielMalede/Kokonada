import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { ProbeRegistry } from '../probe/Probe';
import { SCENES } from '../scenes';

// MB-085. READY waits for every probe a scene DECLARES. A scene that renders fewer would stall
// READY forever, and one that renders more would be refused at runtime, so the declaration and
// the render must be the same list, scene by scene.

const sv = { t: { value: 0 } } as never;

describe('the lab scenes', () => {
  it('there is at least the smoke scene, with a positive finite period', () => {
    expect(Object.keys(SCENES)).toContain('smoke');
    for (const scene of Object.values(SCENES)) expect(Number.isFinite(scene.periodMs) && scene.periodMs > 0).toBe(true);
  });

  it.each(Object.keys(SCENES))('%s renders exactly the probes it declares, each once', (id) => {
    const scene = SCENES[id];
    const Scene = scene.Component;
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(
        <ProbeRegistry onMeasure={() => {}}>
          <Scene clock={sv} t={0} params={{ run: 'r', scene: id, clock: 'fixed', t: 0, stepMs: 0, frames: 1 }} />
        </ProbeRegistry>,
      );
    });
    const rendered = tree.root
      .findAll((n) => typeof n.type === 'string' && typeof n.props.nativeID === 'string' && n.props.nativeID.startsWith('probe-'))
      .map((n) => n.props.nativeID.slice('probe-'.length));
    expect([...rendered].sort()).toEqual([...scene.probes].sort());
    expect(new Set(scene.probes).size).toBe(scene.probes.length);
  });
});
