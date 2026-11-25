/// <reference types="node" />
import React from 'react';
import { PixelRatio, StyleSheet } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

// F10 G8-2a and G8-2b: the hero scene composes the v2 hero over the real FieldView, from synthetic data only. FieldView,
// its ledger and builder, the Plate, RimLabels, BeadLayer, PlateTouch, the Well and CommitCTA are the real ones; only the
// UI thread, the canvas and the field effect are faked, as in FieldScene.test.tsx: SharedValues persist, a frame callback
// is registered per identity, only active callbacks run, and each frame carries a rising timestamp. So a placement the
// touch layer reports reaches the real ledger, and the CTA shows only when the real FieldView admits a start.
const mockUi = { timestamp: 0 };
jest.mock('react-native-reanimated', () => {
  const { useEffect, useRef } = require('react');
  const registry = new Map<number, { fn: (info: unknown) => void; active: boolean }>();
  let nextId = 1;
  return {
    View: require('react-native').View,
    useAnimatedStyle: (fn: () => unknown) => fn(),
    withTiming: (to: unknown) => to,
    useSharedValue: (initial: unknown) => {
      const ref = useRef(null as null | { value: unknown });
      if (ref.current === null) ref.current = { value: initial };
      return ref.current;
    },
    useDerivedValue: (fn: () => unknown) => ({ get value() { return fn(); } }),
    runOnJS: (fn: (...args: unknown[]) => void) => (...args: unknown[]) => fn(...args),
    useFrameCallback: (fn: (info: unknown) => void, autostart = true) => {
      const ref = useRef(null as null | { isActive: boolean; callbackId: number; setActive: (a: boolean) => void });
      if (ref.current === null) {
        const handle = {
          isActive: autostart,
          callbackId: -1,
          setActive(a: boolean) {
            const entry = registry.get(handle.callbackId);
            if (entry) entry.active = a;
            handle.isActive = a;
          },
        };
        ref.current = handle;
      }
      useEffect(() => {
        const handle = ref.current!;
        const id = nextId;
        nextId += 1;
        registry.set(id, { fn, active: false });
        handle.callbackId = id;
        handle.setActive(handle.isActive);
        return () => { registry.delete(id); handle.callbackId = -1; };
      }, [fn, autostart]);
      return ref.current;
    },
    __frame: (dt: number) => {
      mockUi.timestamp += dt;
      for (const entry of [...registry.values()]) if (entry.active) entry.fn({ timestamp: mockUi.timestamp, timeSincePreviousFrame: dt, timeSinceFirstFrame: 0 });
    },
  };
});
const reanimated = require('react-native-reanimated') as { __frame(dt: number): void };
jest.mock('@shopify/react-native-skia', () => require('./__fixtures__/skiaHeadless').skiaHeadless());
jest.mock('../../v2/field/effect.ts', () => ({
  fieldEffect: () => ({ status: 'ready', effect: { name: 'effect' }, blueNoise: {}, blueNoiseShader: { name: 'noise' } }),
}));

import { screenToCircumplex } from '../../../experience/wheel/wheelGeometry';
import { BeadLayer } from '../../v2/components/Bead/BeadLayer';
import { CommitCTA } from '../../v2/components/CommitCTA/CommitCTA';
import { Plate } from '../../v2/components/Plate/Plate';
import { PlateTouch } from '../../v2/components/PlateTouch/PlateTouch';
import { RimLabels } from '../../v2/components/RimLabels/RimLabels';
import { Well } from '../../v2/components/Well/Well';
import { heroLayout } from '../../v2/field/fallbackScenes';
import { FieldView } from '../../v2/field/FieldView';
import type { MotionPorts } from '../../v2/motion/ports';
import { BASE } from '../../v2/tokens/tokens.generated';
import { heroTaps } from '../fieldScenes';
import type { LabParams } from '../params';
import { ProbeRegistry } from '../probe/Probe';
import { SCENES } from '../scenes';
import { LabMotionPortsContext, SceneFactsContext, type SceneFacts } from '../scenes/FieldScene';
import { HERO_COPY, HERO_FONTS, HERO_SCENE_PROBES, HeroScene, heroScene } from '../scenes/HeroScene';
import { ShaderReportContext, type ShaderReport } from '../shaderReport';
import { drawnFaces } from './__fixtures__/drawnFaces';
import { labMounts } from './__fixtures__/labMounts';

// Each test's scene is unmounted after it, so no timer it armed outlives the test (UI-261).
const mounts = labMounts();

const W = 411;
const H = 914;
const clock = { t: { value: 0 } } as never;
const paramsOf = (scene: string): LabParams => ({ run: 'r', scene, clock: 'fixed', t: 0, stepMs: 0, frames: 3 });
/** A device setting that has answered `on` and never changes. */
const answered = (on: boolean) => ({ read: () => Promise.resolve(on), subscribe: () => () => {} });
const MOTION_ON: MotionPorts = { reduceMotion: answered(false), powerSave: answered(false) };
const REDUCED: MotionPorts = { reduceMotion: answered(true), powerSave: answered(false) };

async function mount(scene: string, ports: MotionPorts = MOTION_ON) {
  const shader: ShaderReport[] = [];
  const facts: SceneFacts[] = [];
  let r!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    r = ReactTestRenderer.create(
      <ProbeRegistry onMeasure={() => {}}>
        <ShaderReportContext.Provider value={(x) => { shader.push(x); }}>
          <SceneFactsContext.Provider value={(x) => { facts.push(x); }}>
            <LabMotionPortsContext.Provider value={ports}>
              <HeroScene clock={clock} t={0} params={paramsOf(scene)} />
            </LabMotionPortsContext.Provider>
          </SceneFactsContext.Provider>
        </ShaderReportContext.Provider>
      </ProbeRegistry>,
    );
  });
  mounts.track(r);
  const layout = () => act(() => {
    r.root.find((n) => n.props.testID === 'hero-scene.view' && typeof n.type !== 'string').props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: W, height: H } } });
  });
  const props = <P,>(type: React.ComponentType<P>) => r.root.findByType(type as never).props as P;
  const probes = () => r.root.findAll((n) => typeof n.type === 'string' && String(n.props.nativeID ?? '').startsWith('probe-'));
  const frames = (n: number) => { for (let i = 0; i < n; i++) act(() => reanimated.__frame(16)); };
  return { r, shader, facts, layout, props, probes, frames };
}

const IDS = ['dark', 'light'].flatMap((face) => ['three', 'empty'].flatMap((taps) => ['latin', 'hebrew'].map((script) => `hero.abyss.${face}.${taps}.${script}`)));

beforeEach(() => {
  mockUi.timestamp = 0;
  jest.spyOn(PixelRatio, 'get').mockReturnValue(2.625);
  jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(1);
});
afterEach(() => jest.restoreAllMocks());

describe('the hero scenes', () => {
  it('are Abyss × {dark, light} × {three, empty} × {latin, hebrew}: eight HeroScenes, the stage and the plate their probes', () => {
    const hero = Object.keys(SCENES).filter((id) => id.startsWith('hero.')).sort();
    expect(hero).toEqual([...IDS].sort());
    for (const id of IDS) {
      expect([id, SCENES[id].Component, SCENES[id].probes, SCENES[id].fonts]).toEqual([id, HeroScene, HERO_SCENE_PROBES, HERO_FONTS]);
      expect(SCENES[id].periodMs).toBe(BASE.field.clock.T);
    }
    expect(HERO_SCENE_PROBES).toEqual(['stage', 'plate']);
    expect(heroScene('hero.abyss.light.empty.hebrew')).toEqual({ face: 'light', taps: 'empty', script: 'hebrew' });
    expect(() => heroScene('hero.abyss.dusk.three.latin')).toThrow('"hero.abyss.dusk.three.latin" is not a lab hero scene');
  });

  it('declare the faces the components style their text in: the UI family at ui.body\'s weight (the hint) and ui.cta\'s (the label)', () => {
    expect([...HERO_FONTS].sort()).toEqual(['Heebo@400', 'Heebo@600']);
    for (const s of ['latin', 'hebrew'] as const) {
      expect(HERO_FONTS).toContain(`${BASE.type.face.ui}@${BASE.type.ui.body[s].weight}`);
      expect(HERO_FONTS).toContain(`${BASE.type.face.ui}@${BASE.type.ui.cta[s].weight}`);
    }
  });
});

describe('a hero scene before and after its view has a size', () => {
  it('draws nothing but its probes until it has one: the stage, and the plate unplaced', async () => {
    const h = await mount('hero.abyss.dark.three.latin');
    expect(h.probes().map((n) => n.props.nativeID).sort()).toEqual(['probe-plate', 'probe-stage']);
    expect(h.r.root.findAllByType(FieldView)).toEqual([]);
    expect(h.r.root.findAllByType(Plate)).toEqual([]);
  });

  it('laid out, draws the real FieldView at heroLayout, and the plate on the field\'s ring: its centre, R and font scale', async () => {
    const h = await mount('hero.abyss.light.three.latin');
    h.layout();
    const layout = heroLayout('abyss', W, H, 1);
    const field = h.props(FieldView);
    expect(field).toMatchObject({ direction: 'abyss', face: 'light', scene: 'hero.abyss.light.three.latin', layout, pxPerDp: 2.625, tier: 'full', stress: 0, confidence: 1, genesis: false });
    expect(field.taps).toEqual(heroTaps('three'));
    expect(h.props(Plate)).toMatchObject({ diameter: 2 * layout.radius, fontScale: layout.fontScale });
    const plate = h.probes().find((n) => n.props.nativeID === 'probe-plate')!;
    expect(StyleSheet.flatten(plate.props.style)).toMatchObject({
      position: 'absolute', left: layout.centre[0] - layout.radius, top: layout.centre[1] - layout.radius, width: 2 * layout.radius, height: 2 * layout.radius,
    });
    // Every plate layer reads the same taps and the same plate.
    expect(h.props(RimLabels)).toMatchObject({ diameter: 2 * layout.radius, fontScale: layout.fontScale, beads: field.taps });
    expect(h.props(BeadLayer).taps).toBe(field.taps);
    expect(h.props(BeadLayer).plate.diameter).toBe(2 * layout.radius);
    expect(h.props(PlateTouch)).toMatchObject({ taps: field.taps, toPoint: screenToCircumplex, inert: false });
    expect(h.props(PlateTouch).plate).toBe(h.props(BeadLayer).plate);
  });

  it.each(['latin', 'hebrew'] as const)('draws the %s copy the id names: the rim words and their doubles, the hint, the label, the touch layer\'s labels', async (script) => {
    const h = await mount(`hero.abyss.dark.empty.${script}`);
    h.layout();
    const copy = HERO_COPY[script];
    expect(h.props(RimLabels)).toMatchObject({ words: copy.words, a11y: copy.a11y, script });
    expect(h.props(Well)).toMatchObject({ hint: copy.hint, script });
    expect(h.props(CommitCTA).label).toBe(copy.cta);
    expect(h.props(PlateTouch)).toMatchObject({ label: copy.plateLabel, hint: copy.plateHint, latestLabel: copy.latestLabel, removeLabel: copy.removeLabel, cells: copy.cells });
  });

  it.each(IDS)('%s draws its text in exactly the faces it declares, once laid out', async (id) => {
    const h = await mount(id);
    h.layout();
    expect(drawnFaces(h.r.root)).toEqual([...HERO_FONTS].sort());
  });
});

describe('the taps, the CTA and the hint (synthetic: every callback updates the scene alone)', () => {
  // A bead's entrance and exit run on the native driver, which the jest preset mocks with its own 16 ms end timer that
  // stopAnimation never clears (jest/mocks/NativeModules.js): fake timers keep that mock's timer out of the real clock, as
  // Bead.test.tsx does. The field's frames are this file's own UI thread, so they still run.
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });
  const machine = (h: Awaited<ReturnType<typeof mount>>) => h.props(CommitCTA).machine;
  const cta = (h: Awaited<ReturnType<typeof mount>>) => h.r.root.find((n) => typeof n.type === 'string' && n.props.testID === 'cta.root');

  it('three: three beads, the CTA shown and reachable at once, the hint giving way', async () => {
    const h = await mount('hero.abyss.dark.three.latin');
    h.layout();
    expect(h.props(BeadLayer).taps).toHaveLength(3);
    expect(h.props(Well).actionShown).toBe(true);
    expect(machine(h)).toMatchObject({ taps: 3, opacity: { kind: 'show' } });
    expect(cta(h).props.importantForAccessibility).toBe('auto');
  });

  it('empty: no bead, the hint in the action\'s place, the CTA out of touch and out of TalkBack', async () => {
    const h = await mount('hero.abyss.dark.empty.latin');
    h.layout();
    expect(h.props(BeadLayer).taps).toEqual([]);
    expect(h.props(Well).actionShown).toBe(false);
    expect(machine(h)).toMatchObject({ taps: 0, opacity: null });
    expect(cta(h).props.importantForAccessibility).toBe('no-hide-descendants');
    expect(cta(h).props.pointerEvents).toBe('none');
  });

  it('a placement joins the scene\'s taps: the beads, the field, the rim and the touch layer show it, the machine hears the count, and the CTA shows at the field\'s admitted start', async () => {
    const h = await mount('hero.abyss.dark.empty.latin');
    h.layout();
    h.frames(3);
    act(() => h.props(PlateTouch).onPlace({ x: 0.3, y: 0.3 }));
    const taps = h.props(FieldView).taps;
    expect(taps).toEqual([{ x: 0.3, y: 0.3 }]);
    expect(h.props(BeadLayer).taps).toBe(taps);
    expect(h.props(RimLabels).beads).toBe(taps);
    expect(h.props(PlateTouch).taps).toBe(taps);
    expect(machine(h)).toMatchObject({ taps: 1, opacity: null });
    expect(h.props(Well).actionShown).toBe(false);
    // The real ledger admits the change on the field's next frames: FieldView's onStart reaches the machine.
    h.frames(3);
    expect(machine(h).starts).toBeGreaterThanOrEqual(1);
    expect(machine(h).opacity).toMatchObject({ kind: 'show' });
    expect(h.props(Well).actionShown).toBe(true);
  });

  it('on a full plate a placement replaces the oldest (the cold lane\'s ring of three)', async () => {
    const h = await mount('hero.abyss.dark.three.latin');
    h.layout();
    const [, b, c] = heroTaps('three');
    act(() => h.props(PlateTouch).onPlace({ x: -0.5, y: 0.5 }));
    expect(h.props(FieldView).taps).toEqual([b, c, { x: -0.5, y: 0.5 }]);
    expect(machine(h).taps).toBe(3);
  });

  it('removing the latest takes it from the scene; removing the last hides the CTA and the hint comes back', async () => {
    const h = await mount('hero.abyss.dark.three.latin');
    h.layout();
    const [a, b] = heroTaps('three');
    act(() => h.props(PlateTouch).onRemoveLatest());
    expect(h.props(FieldView).taps).toEqual([a, b]);
    act(() => h.props(PlateTouch).onRemoveLatest());
    act(() => h.props(PlateTouch).onRemoveLatest());
    expect(h.props(FieldView).taps).toEqual([]);
    expect(machine(h)).toMatchObject({ taps: 0, opacity: { kind: 'hide' } });
    expect(h.props(Well).actionShown).toBe(false);
    act(() => h.props(PlateTouch).onRemoveLatest());
    expect(h.props(FieldView).taps).toEqual([]);
  });

  it('a commit and a haptic change no tap and nothing the CTA shows', async () => {
    const h = await mount('hero.abyss.dark.three.latin');
    h.layout();
    const before = { taps: h.props(FieldView).taps, machine: machine(h) };
    act(() => h.props(CommitCTA).onCommit());
    act(() => h.props(PlateTouch).haptics.fire('place'));
    expect(h.props(FieldView).taps).toBe(before.taps);
    expect(machine(h)).toBe(before.machine);
  });
});

describe('what it tells LabRoot', () => {
  it('pending until FieldView drew its first frame of the scene, then ready (UI-223, UI-233)', async () => {
    const h = await mount('hero.abyss.dark.three.latin');
    h.layout();
    expect(h.shader[h.shader.length - 1]).toEqual({ status: 'pending', reason: null });
    h.frames(2);
    expect(h.shader[h.shader.length - 1]).toEqual({ status: 'ready', reason: null });
  });

  it('the tier is the motion policy\'s on the device\'s settings, and every layer draws at it: full with motion on, still under reduced motion', async () => {
    const on = await mount('hero.abyss.dark.three.latin', MOTION_ON);
    on.layout();
    expect(on.facts[on.facts.length - 1]).toEqual({ tier: 'full' });
    const reduced = await mount('hero.abyss.dark.three.latin', REDUCED);
    reduced.layout();
    expect(reduced.facts[reduced.facts.length - 1]).toEqual({ tier: 'still' });
    for (const [h, tier] of [[on, 'full'], [reduced, 'still']] as const) {
      expect([h.props(FieldView).tier, h.props(BeadLayer).tier, h.props(Well).tier, h.props(CommitCTA).tier]).toEqual([tier, tier, tier, tier]);
    }
  });
});
