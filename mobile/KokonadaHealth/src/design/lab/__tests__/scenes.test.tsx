import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { unknownFaces, type LabFaceId } from '../fonts';
import { Probe, ProbeRegistry } from '../probe/Probe';
import { SCENES, type Scene } from '../scenes';
import { LabMotionPortsContext } from '../scenes/FieldScene';
import { drawnFaces } from './__fixtures__/drawnFaces';
// SCENES reaches FieldView, whose fieldImage.tsx reads Skia's FilterMode on load: the setup stub lacks it (__fixtures__/skiaHeadless.ts).
jest.mock('@shopify/react-native-skia', () => require('./__fixtures__/skiaHeadless').skiaHeadless());

// MB-085. READY waits for every probe a scene DECLARES. A scene that renders fewer would stall
// READY forever, and one that renders more would be refused at runtime, so the declaration and
// the render must be the same list, scene by scene.

const sv = { t: { value: 0 } } as never;
// A policy scene (B8-6) takes its tier from the device's settings, which LabRoot provides: here they never answer.
const unanswered = { read: () => new Promise<boolean>(() => {}), subscribe: () => () => {} };
const PORTS = { reduceMotion: unanswered, powerSave: unanswered };

describe('the lab scenes', () => {
  it('there is at least the smoke scene, with a positive finite period', () => {
    expect(Object.keys(SCENES)).toContain('smoke');
    for (const scene of Object.values(SCENES)) expect(Number.isFinite(scene.periodMs) && scene.periodMs > 0).toBe(true);
  });

  it('the smoke scene moves with the field clock, as a pure function of t (still on a fixed clock, moving on a running one)', () => {
    const opacityAt = (t: number) => {
      let tree!: ReactTestRenderer.ReactTestRenderer;
      act(() => {
        tree = ReactTestRenderer.create(
          <ProbeRegistry onMeasure={() => {}}>
            <SCENES.smoke.Component clock={{ t: { value: t } } as never} t={t} params={{ run: 'r', scene: 'smoke', clock: 'fixed', t, stepMs: 0, frames: 1 }} />
          </ProbeRegistry>,
        );
      });
      const pulse = tree.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'smoke-pulse')[0];
      return [pulse.props.style].flat().reduce((o: number | undefined, s: { opacity?: number } | undefined) => s?.opacity ?? o, undefined);
    };
    expect(opacityAt(0)).toBeCloseTo(0.6, 10);
    expect(opacityAt(1500)).toBeCloseTo(1, 10); // a quarter of the 6 s period
    expect(opacityAt(4500)).toBeCloseTo(0.2, 10);
  });

  it.each(Object.keys(SCENES))('%s renders exactly the probes it declares, each once', (id) => {
    const scene = SCENES[id];
    const Scene = scene.Component;
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(
        <ProbeRegistry onMeasure={() => {}}>
          <LabMotionPortsContext.Provider value={PORTS}>
            <Scene clock={sv} t={0} params={{ run: 'r', scene: id, clock: 'fixed', t: 0, stepMs: 0, frames: 1 }} />
          </LabMotionPortsContext.Provider>
        </ProbeRegistry>,
      );
    });
    const rendered = tree.root
      .findAll((n) => typeof n.type === 'string' && typeof n.props.nativeID === 'string' && n.props.nativeID.startsWith('probe-'))
      .map((n) => n.props.nativeID.slice('probe-'.length));
    expect([...rendered].sort()).toEqual([...scene.probes].sort());
    expect(new Set(scene.probes).size).toBe(scene.probes.length);
  });

  // UI-072. READY waits only for the faces a scene DECLARES (LabRoot measures each one), so a scene that draws text in a
  // face it does not declare could send READY over Android's fallback face. The faces it draws and the faces it declares
  // must agree, scene by scene; a face no scene may use (one the lab does not have) is caught the same way. Text styled as
  // a family at a weight is that token face (F10 G8, __fixtures__/drawnFaces.ts). A scene that draws its text only once
  // its view has a size (the hero) draws none here: its own test lays it out and holds it to the same check.
  const drawnFamilies = (Scene: Scene['Component'], id: string) => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(
        <ProbeRegistry onMeasure={() => {}}>
          <LabMotionPortsContext.Provider value={PORTS}>
            <Scene clock={sv} t={0} params={{ run: 'r', scene: id, clock: 'fixed', t: 0, stepMs: 0, frames: 1 }} />
          </LabMotionPortsContext.Provider>
        </ProbeRegistry>,
      );
    });
    const faces = drawnFaces(tree.root);
    act(() => tree.unmount());
    return faces;
  };

  it.each(Object.keys(SCENES))('%s declares every face it draws text in, and only lab faces', (id) => {
    const scene = SCENES[id];
    const drawn = drawnFamilies(scene.Component, id);
    const declared = new Set<string>(scene.fonts ?? []);
    expect(drawn.filter((f) => !declared.has(f))).toEqual([]);
    expect(unknownFaces(scene.fonts ?? [])).toEqual([]);
  });

  it('the check sees text styled as the token family at a weight as that token face (F10 G8: as the v2 components style it)', () => {
    const Planted = () => <Probe id="stage"><Text style={[{ fontFamily: 'Heebo', fontWeight: '600' }]}>המשך</Text><Text style={{ fontFamily: 'Heebo-Medium' }}>כותרת</Text></Probe>;
    expect(drawnFamilies(Planted, 'planted')).toEqual(['Heebo-Medium', 'Heebo@600']);
  });

  it('the check sees a face drawn but not declared (a check that finds nothing must fail, not pass)', () => {
    const Planted = () => <Probe id="stage"><Text style={[{ fontFamily: 'Heebo-Medium' }]}>כותרת</Text></Probe>;
    const drawn = drawnFamilies(Planted, 'planted');
    expect(drawn).toEqual(['Heebo-Medium']);
    const declared: readonly LabFaceId[] = ['Heebo-Regular'];
    expect(drawn.filter((f) => !declared.includes(f as LabFaceId))).toEqual(['Heebo-Medium']);
  });
});
