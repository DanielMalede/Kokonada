/// <reference types="node" />
import React from 'react';
import { Platform, PixelRatio, StyleSheet } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

// F10 G8-2a and G8-2b: the hero scene composes the v2 hero over the real FieldView, from synthetic data only. FieldView,
// its ledger and builder, the Plate, PlateEntry, RimLabels, BeadLayer, PlateTouch, the Well and CommitCTA are the real
// ones, wired as a page wires them (ruling 2, ruling 9, F6, F8): one bead presence for the beads and the rim words, the
// list's button first on the plate, the CTA's machine bound as FieldView's onStart. Only the UI thread, the canvas and
// the field effect are faked, as in FieldScene.test.tsx: SharedValues persist, a frame callback is registered per
// identity, only active callbacks run, and each frame carries a rising timestamp. So a placement the touch layer reports
// reaches the real ledger, and the CTA shows only when the real FieldView admits a start.
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
import { PlateEntry } from '../../v2/components/PlateTouch/PlateEntry';
import { PlateTouch } from '../../v2/components/PlateTouch/PlateTouch';
import { RimLabels } from '../../v2/components/RimLabels/RimLabels';
import { Well } from '../../v2/components/Well/Well';
import { heroLayout } from '../../v2/field/fallbackScenes';
import { FieldView } from '../../v2/field/FieldView';
import type { MotionPorts } from '../../v2/motion/ports';
import { BASE } from '../../v2/tokens/tokens.generated';
import { fontFace } from '../../v2/typeface/faces';
import { heroTaps } from '../fieldScenes';
import type { LabParams } from '../params';
import { ProbeRegistry } from '../probe/Probe';
import { SCENES } from '../scenes';
import { LabMotionPortsContext, SceneFactsContext, type SceneFacts } from '../scenes/FieldScene';
import {
  HERO_CATALOGS, HERO_COPY, HERO_COPY_SPEC, HERO_FONTS, HERO_HE_CATALOG, HERO_KNOCK_TAPS, HERO_PAIR_TAPS, HERO_SCENE_PROBES, HERO_TIMED_POINT, HERO_TIMED_SCHEDULE, HeroScene, busyWait, heroInitial, heroScene, heroTimeline,
} from '../scenes/HeroScene';
import { plateGeometry, pointToLocal } from '../../v2/components/Plate/geometry';
import { DIRECTIONS } from '../../v2/tokens/tokens.generated';
import { checkCopy } from '../../v2/copy/CopyPort';
import { ShaderReportContext, type ShaderReport } from '../shaderReport';
import { drawnFaces } from './__fixtures__/drawnFaces';
import { labMounts } from './__fixtures__/labMounts';

// Each test's scene is unmounted after it, so no timer it armed outlives the test (UI-261).
const mounts = labMounts();

const W = 411;
const H = 914;
const clock = { t: { value: 0 } } as never;
const paramsOf = (scene: string, dials: Partial<LabParams> = {}): LabParams => ({ run: 'r', scene, clock: 'fixed', t: 0, stepMs: 0, frames: 3, ...dials });
/** A device setting that has answered `on` and never changes. */
const answered = (on: boolean) => ({ read: () => Promise.resolve(on), subscribe: () => () => {} });
const MOTION_ON: MotionPorts = { reduceMotion: answered(false), powerSave: answered(false) };
const REDUCED: MotionPorts = { reduceMotion: answered(true), powerSave: answered(false) };

async function mount(scene: string, ports: MotionPorts = MOTION_ON, dials: Partial<LabParams> = {}) {
  const shader: ShaderReport[] = [];
  const facts: SceneFacts[] = [];
  let r!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    r = ReactTestRenderer.create(
      <ProbeRegistry onMeasure={() => {}}>
        <ShaderReportContext.Provider value={(x) => { shader.push(x); }}>
          <SceneFactsContext.Provider value={(x) => { facts.push(x); }}>
            <LabMotionPortsContext.Provider value={ports}>
              <HeroScene clock={clock} t={0} params={paramsOf(scene, dials)} />
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
/** Every hero id: the faces × the taps (three, empty, G8 round 2's knock, seam, timed, knocktimed and pairtimed) × the scripts, each plain and with the outline dial. */
const ALL_IDS = ['dark', 'light'].flatMap((face) => ['three', 'empty', 'knock', 'seam', 'timed', 'knocktimed', 'pairtimed'].flatMap((taps) => ['latin', 'hebrew'].flatMap((script) => [
  `hero.abyss.${face}.${taps}.${script}`, `hero.abyss.${face}.${taps}.${script}.outline`,
])));

beforeEach(() => {
  mockUi.timestamp = 0;
  jest.spyOn(PixelRatio, 'get').mockReturnValue(2.625);
  jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(1);
});
afterEach(() => jest.restoreAllMocks());

describe('the hero scenes', () => {
  it('are Abyss × {dark, light} × {three, empty, knock, seam, timed, knocktimed, pairtimed} × {latin, hebrew} × {plain, outline}: 56 HeroScenes, the stage and the plate their probes', () => {
    const hero = Object.keys(SCENES).filter((id) => id.startsWith('hero.')).sort();
    expect(hero).toHaveLength(56);
    expect(hero).toEqual([...ALL_IDS].sort());
    for (const id of ALL_IDS) {
      expect([id, SCENES[id].Component, SCENES[id].probes, SCENES[id].fonts]).toEqual([id, HeroScene, HERO_SCENE_PROBES, HERO_FONTS]);
      expect(SCENES[id].periodMs).toBe(BASE.field.clock.T);
      // The rim words are Skia text in the bundled faces: LabRoot mounts the typeface provider, and READY waits for it (F6).
      expect([id, SCENES[id].typefaces]).toEqual([id, true]);
    }
    expect(HERO_SCENE_PROBES).toEqual(['stage', 'plate']);
    expect(heroScene('hero.abyss.light.empty.hebrew')).toEqual({ face: 'light', taps: 'empty', script: 'hebrew', outline: false });
    expect(heroScene('hero.abyss.dark.knock.latin.outline')).toEqual({ face: 'dark', taps: 'knock', script: 'latin', outline: true });
    expect(() => heroScene('hero.abyss.dark.three.latin.outlines')).toThrow('is not a lab hero scene');
    expect(() => heroScene('hero.abyss.dusk.three.latin')).toThrow('"hero.abyss.dusk.three.latin" is not a lab hero scene');
  });

  it('declare the files the components set their text in on Android (fontFace): ui.body\'s for the hint, ui.cta\'s for the label', () => {
    expect([...HERO_FONTS].sort()).toEqual(['Heebo-Regular', 'Heebo-SemiBold']);
    for (const s of ['latin', 'hebrew'] as const) {
      expect(HERO_FONTS).toContain(fontFace(BASE.type.face.ui, BASE.type.ui.body[s].weight, 'android').fontFamily);
      expect(HERO_FONTS).toContain(fontFace(BASE.type.face.ui, BASE.type.ui.cta[s].weight, 'android').fontFamily);
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
    // The plate's layers in the designer's order (ruling 9): the list's button, the rim words, the beads, the touch layer.
    const layers = React.Children.toArray(h.props(Plate).children) as React.ReactElement[];
    expect(layers.map((l) => l.type)).toEqual([PlateEntry, RimLabels, BeadLayer, PlateTouch]);
    // One bead presence (ruling 2): the beads BeadLayer draws are the beads the rim words knock out, on the bead model's clock.
    const beads = h.props(BeadLayer).beads;
    expect(beads.map((b) => b.point)).toEqual(field.taps);
    expect(h.props(RimLabels)).toMatchObject({ diameter: 2 * layout.radius, fontScale: layout.fontScale });
    // One presence, one clock (UI-320): the rim words read the very looks the beads draw.
    expect(h.props(RimLabels).looks).toBe(h.props(BeadLayer).looks);
    expect(h.props(RimLabels).looks).toEqual({ value: {} });
    expect(h.props(RimLabels).beads).toBe(beads);
    expect(h.props(BeadLayer).plate.diameter).toBe(2 * layout.radius);
    expect(h.props(PlateTouch)).toMatchObject({ taps: field.taps, toPoint: screenToCircumplex, inert: false });
    expect(h.props(PlateTouch).plate).toBe(h.props(BeadLayer).plate);
    expect(h.props(PlateEntry).plate).toBe(h.props(BeadLayer).plate);
    expect(h.props(PlateEntry).inert).toBe(false);
    // PlateTouch hands focus back to the list's button through its handle (ruling 9).
    expect(typeof h.props(PlateTouch).entry.current?.focus).toBe('function');
    // The CTA's machine is bound as FieldView's onStart (F8), and keeps its identity across renders.
    const onStart = field.onStart;
    expect(typeof onStart).toBe('function');
    h.frames(2);
    expect(h.props(FieldView).onStart).toBe(onStart);
  });

  it.each(['latin', 'hebrew'] as const)('draws the %s copy the id names: the rim words and their doubles, the hint, the label, the list\'s button, the latest bead', async (script) => {
    const h = await mount(`hero.abyss.dark.empty.${script}`);
    h.layout();
    const copy = HERO_COPY[script];
    expect(h.props(RimLabels)).toMatchObject({ words: copy.words, a11y: copy.a11y, script });
    expect(h.props(PlateEntry)).toMatchObject({ label: copy.plateLabel, hint: copy.plateHint });
    expect(h.props(PlateTouch)).toMatchObject({ latestLabel: copy.latestLabel, removeLabel: copy.removeLabel });
  });

  // The hint and the label are keyed copy (B1 specs, the designer's revision of 2026-11-24): onboarding.plate.hint and
  // onboarding.continue, two N keys. In Latin they come through the copy port (useCopy under the scene's CopyProvider); the
  // port resolves in en alone until Hebrew joins it (D4-B), so the Hebrew scene reads the same keys from the lab's he table.
  it.each([
    ['latin', 'Tap the plate to place a point.', 'Continue'],
    ['hebrew', 'אפשר לגעת בלוח כדי לסמן נקודה.', 'המשך'],
  ] as const)('draws the %s hint and label from their keys, onboarding.plate.hint and onboarding.continue', async (script, hint, label) => {
    const h = await mount(`hero.abyss.light.empty.${script}`);
    h.layout();
    expect(h.props(Well)).toMatchObject({ hint, script });
    expect(h.props(CommitCTA).label).toBe(label);
  });

  it('holds its keyed copy as the port checks it: two N keys, en text for each, and he text for exactly the same keys', () => {
    expect(HERO_COPY_SPEC).toEqual({ 'onboarding.plate.hint': { class: 'N' }, 'onboarding.continue': { class: 'N' } });
    expect(checkCopy(HERO_COPY_SPEC, HERO_CATALOGS)).toEqual([]);
    expect(Object.keys(HERO_HE_CATALOG).sort()).toEqual(Object.keys(HERO_CATALOGS.en).sort());
    expect(Object.keys(HERO_COPY.latin)).not.toContain('hint');
    expect(Object.keys(HERO_COPY.hebrew)).not.toContain('cta');
  });

  it.each(IDS)('%s draws its text in exactly the faces it declares, once laid out, as Android draws them', async (id) => {
    jest.replaceProperty(Platform, 'OS', 'android');
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
    expect(h.props(BeadLayer).beads).toHaveLength(3);
    expect(h.props(Well).actionShown).toBe(true);
    expect(machine(h)).toMatchObject({ taps: 3, opacity: { kind: 'show' } });
    expect(cta(h).props.importantForAccessibility).toBe('auto');
  });

  it('empty: no bead, the hint in the action\'s place, the CTA out of touch and out of TalkBack', async () => {
    const h = await mount('hero.abyss.dark.empty.latin');
    h.layout();
    expect(h.props(BeadLayer).beads).toEqual([]);
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
    expect(h.props(BeadLayer).beads.map((b) => b.point)).toEqual(taps);
    expect(h.props(RimLabels).beads).toBe(h.props(BeadLayer).beads);
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
    // The oldest bead leaves (ruling 2): the presence keeps it, leaving, for its exit, under the three live ones.
    const beads = h.props(BeadLayer).beads;
    expect(beads.filter((x) => x.leaving).map((x) => x.point)).toEqual([heroTaps('three')[0]]);
    expect(beads.filter((x) => !x.leaving).map((x) => x.point)).toEqual([b, c, { x: -0.5, y: 0.5 }]);
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

  it('a commit, a haptic, the list\'s button and its focus change no tap and nothing the CTA shows', async () => {
    const h = await mount('hero.abyss.dark.three.latin');
    h.layout();
    const before = { taps: h.props(FieldView).taps, machine: machine(h) };
    act(() => h.props(CommitCTA).onCommit());
    act(() => h.props(PlateTouch).haptics.fire('place'));
    act(() => h.props(PlateEntry).onOpenList());
    act(() => h.props(PlateEntry).onFocusChange(true));
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
      // The beads take the tier through the scene's presence (useBeadPresence), not as a BeadLayer prop.
      expect([h.props(FieldView).tier, h.props(Well).tier, h.props(CommitCTA).tier]).toEqual([tier, tier, tier]);
    }
  });
});

// G8 round 2 (the designer's REVISE for evidence): scenes the captures need, all synthetic, all lab-only.
describe('the round-2 evidence scenes', () => {
  const layout = heroLayout('abyss', W, H, 1);
  const g = plateGeometry({ base: BASE, direction: DIRECTIONS.abyss } as never, 2 * layout.radius, 1);
  const reach = g.beadRadius + BASE.plate.labelBand.knockoutGap;
  /** The point on the ring's centre line where a word is anchored (arc.ts: top at -90 degrees, left at 180). */
  const anchor = (theta: number) => ({ x: g.centre[0] + g.ringMid * Math.cos(theta), y: g.centre[1] + g.ringMid * Math.sin(theta) });

  it('knock: a bead on the top word (More energy) and then one on the left word (Unpleasant), each within the knock-out reach of its anchor', () => {
    expect(heroInitial('knock').taps).toEqual(HERO_KNOCK_TAPS);
    const [top, left] = HERO_KNOCK_TAPS.map((p) => pointToLocal(p, g));
    expect(Math.hypot(top.x - anchor(-Math.PI / 2).x, top.y - anchor(-Math.PI / 2).y)).toBeLessThanOrEqual(reach);
    expect(Math.hypot(left.x - anchor(Math.PI).x, left.y - anchor(Math.PI).y)).toBeLessThanOrEqual(reach);
    expect(HERO_KNOCK_TAPS).toHaveLength(2);
  });

  it("seam: the token scene's two beads beside 12 o'clock, the intense one (left of 12) placed last, so it is the latest", () => {
    const seam = heroTaps('seam');
    expect(seam).toHaveLength(2);
    const taps = heroInitial('seam').taps;
    expect([...taps].sort((a, b) => a.x - b.x)).toEqual([...seam].sort((a, b) => a.x - b.x));
    expect(taps[taps.length - 1].x).toBeLessThan(0);
    expect(taps[0].x).toBeGreaterThan(0);
  });

  // The entrance with no tap (G8 round 2, entrance/: the tap stalls the emulator's screen longer than press + respond, so
  // the grey step and the colour after it were never seen): the scene places the bead on a timer from its stage's mount,
  // through the very callback a touch uses, and takes it away and places it again, so one recording holds several.
  it('timed: starts empty; on its schedule a bead enters at round 2’s entrance spot, leaves, and enters again, through the page’s own callbacks with no touch', async () => {
    jest.useFakeTimers();
    try {
      const h = await mount('hero.abyss.dark.timed.latin');
      h.layout();
      expect(heroInitial('timed').taps).toEqual([]);
      expect(h.props(BeadLayer).beads).toEqual([]);
      let at = 0;
      const until = (ms: number) => {
        act(() => {
          jest.advanceTimersByTime(ms - at);
        });
        at = ms;
      };
      const seen: string[] = [];
      for (const [ms, action] of HERO_TIMED_SCHEDULE) {
        until(ms - 1);
        const before = h.props(BeadLayer).beads.filter((b) => !b.leaving).length;
        until(ms);
        const live = h.props(BeadLayer).beads.filter((b) => !b.leaving);
        seen.push(`${ms} ${action} ${before}→${live.length}`);
        if (action === 'place') {
          expect(live).toHaveLength(1);
          expect(live[0].point).toEqual(HERO_TIMED_POINT);
          // An entrance, not a bead shown whole: it plays the grey step and then the colour.
          expect(live[0].placedAt).not.toBeNull();
        } else {
          expect(live).toHaveLength(0);
        }
      }
      expect(seen).toEqual(HERO_TIMED_SCHEDULE.map(([ms, action]) => `${ms} ${action} ${action === 'place' ? '0→1' : '1→0'}`));
      expect(HERO_TIMED_SCHEDULE.filter(([, a]) => a === 'place').length).toBeGreaterThanOrEqual(3);
      // The field, the touch layer and the beads read the same taps: the page's own state.
      expect(h.props(PlateTouch).taps).toEqual(h.props(FieldView).taps);
    } finally {
      jest.useRealTimers();
    }
  });

  it('timed: its bead is round 2’s entrance tap, (306, 1066) px on that device’s plate (centre (540, 1300), R 435 px), intense', () => {
    expect(HERO_TIMED_POINT.x).toBeCloseTo((306 - 540) / 435, 2);
    expect(HERO_TIMED_POINT.y).toBeCloseTo(-(1066 - 1300) / 435, 2);
  });

  // UI-320 and UI-321 (the architect's device protocol, 2026-11-26): removals and entrances with no touch, on a loop, so
  // one recording holds many; `stall` forces the lateness and `beadTimeScale` stretches the motion and the schedule with it.
  describe('the timed knock scenes and their dials', () => {
    const run = async (scene: string, dials: Partial<LabParams>, untilMs: number) => {
      const h = await mount(scene, MOTION_ON, dials);
      h.layout();
      const seen: string[] = [];
      let last = JSON.stringify(h.props(PlateTouch).taps);
      for (let ms = 0; ms < untilMs; ms += 50) {
        act(() => {
          jest.advanceTimersByTime(50);
        });
        const now = JSON.stringify(h.props(PlateTouch).taps);
        if (now !== last) seen.push(`${ms + 50} ${(h.props(PlateTouch).taps as readonly unknown[]).length}`);
        last = now;
      }
      return { h, seen };
    };

    it('knocktimed: on a loop, a bead on the top word enters and leaves, then one on the left word, alone on the plate each time', async () => {
      jest.useFakeTimers();
      try {
        const plan = heroTimeline('knocktimed', 1)!;
        expect(plan.steps.map(([, action, point]) => [action, point])).toEqual([['place', HERO_KNOCK_TAPS[0]], ['remove', HERO_KNOCK_TAPS[0]], ['place', HERO_KNOCK_TAPS[1]], ['remove', HERO_KNOCK_TAPS[1]]]);
        expect(plan.period).not.toBeNull();
        expect(heroInitial('knocktimed').taps).toEqual([]);
        const { seen } = await run('hero.abyss.dark.knocktimed.latin', {}, plan.start + 2 * plan.period! + 100);
        const want = [0, 1].flatMap((cycle) => plan.steps.map(([ms, action]) => `${plan.start + cycle * plan.period! + ms} ${action === 'place' ? 1 : 0}`));
        expect(seen.slice(0, want.length)).toEqual(want);
      } finally {
        jest.useRealTimers();
      }
    });

    it('each step waits out the motion before it at every time scale: an entrance and its stall before a removal, an exit and its stall before the next placement', () => {
      for (const taps of ['timed', 'knocktimed'] as const) {
        for (const scale of [1, 8, 16]) {
          const plan = heroTimeline(taps, scale)!;
          const gaps = plan.steps.slice(1).map(([ms], i) => ms - plan.steps[i][0]);
          if (plan.period !== null) gaps.push(plan.period - plan.steps[plan.steps.length - 1][0]);
          // motion.settle, the longest a bead's entrance runs, stretched, and room for the largest stall and a frame gap.
          for (const gap of gaps) expect([taps, scale, gap >= BASE.motion.settle.duration * scale + 500]).toEqual([taps, scale, true]);
        }
      }
      expect(heroTimeline('timed', 1)!.steps.map(([ms, action]) => [heroTimeline('timed', 1)!.start + ms, action])).toEqual(HERO_TIMED_SCHEDULE.map(([ms, action]) => [ms, action]));
      expect(heroTimeline('three', 1)).toBeNull();
    });

    it('pairtimed: two beads within one reach of the top word’s letters between them; one leaves beside the live other, then both leave, the second while the first is still going', () => {
      const [a, b] = HERO_PAIR_TAPS.map((p) => pointToLocal(p, g));
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(2 * reach);
      // Apart enough to tell them from each other on a capture: their discs do not touch.
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(2 * g.beadRadius);
      for (const c of [a, b]) expect(Math.abs(Math.hypot(c.x - g.centre[0], c.y - g.centre[1]) - g.ringMid)).toBeLessThan(1);
      for (const scale of [1, 8]) {
        const plan = heroTimeline('pairtimed', scale)!;
        expect(plan.steps.map(([, action, point]) => [action, point])).toEqual([
          ['place', HERO_PAIR_TAPS[0]], ['place', HERO_PAIR_TAPS[1]], ['remove', HERO_PAIR_TAPS[1]],
          ['place', HERO_PAIR_TAPS[1]], ['remove', HERO_PAIR_TAPS[1]], ['remove', HERO_PAIR_TAPS[0]],
        ]);
        // The last two removals overlap: the second starts inside the first one's exit (press + respond, stretched).
        const between = plan.steps[5][0] - plan.steps[4][0];
        expect(between).toBeGreaterThan(0);
        expect(between).toBeLessThan((BASE.motion.press.duration + BASE.motion.respond.duration) * scale * 0.5);
      }
    });

    it('beadTimeScale stretches the schedule: the same steps, further apart', () => {
      const one = heroTimeline('knocktimed', 1)!;
      const eight = heroTimeline('knocktimed', 8)!;
      expect(eight.steps.map(([, action]) => action)).toEqual(one.steps.map(([, action]) => action));
      expect(eight.period!).toBeGreaterThan(3 * one.period!);
    });

    it('beadTimeScale reaches the beads’ driver: a removal takes press + respond at 1, and that many times longer at the dial', async () => {
      const exit = BASE.motion.press.duration + BASE.motion.respond.duration;
      const framesUntilGone = async (dials: Partial<LabParams>) => {
        const h = await mount('hero.abyss.dark.three.latin', MOTION_ON, dials);
        h.layout();
        act(() => h.props(PlateTouch).onRemoveLatest());
        expect(h.props(BeadLayer).beads.filter((b) => b.leaving)).toHaveLength(1);
        let n = 0;
        while (h.props(BeadLayer).beads.some((b) => b.leaving) && n < 2000) {
          h.frames(1);
          n += 1;
        }
        return n;
      };
      // Fake timers hold the JS clock still, so no commit is late and nothing is compressed: the counts are exact.
      jest.useFakeTimers();
      try {
        const plain = await framesUntilGone({});
        const slow = await framesUntilGone({ beadTimeScale: 8 });
        // 16 ms a frame, the first one starting the clock.
        expect(plain).toBe(Math.ceil(exit / 16) + 1);
        expect(slow).toBe(Math.ceil((8 * exit) / 16) + 1);
      } finally {
        jest.useRealTimers();
      }
    });

    it('busyWait holds the JS thread until the clock has moved the ms asked, and not at all for 0 or less', () => {
      const clockOf = () => {
        const c = { now: 1000, reads: 0, read: () => { c.reads += 1; c.now += 7; return c.now; } };
        return c;
      };
      const waited = clockOf();
      busyWait(300, waited.read);
      expect(waited.now).toBeGreaterThanOrEqual(1007 + 300);
      expect(waited.now).toBeLessThan(1007 + 300 + 7);
      for (const ms of [0, -5, Number.NaN]) {
        const idle = clockOf();
        busyWait(ms, idle.read);
        expect([ms, idle.reads]).toEqual([ms, 0]);
      }
    });

    it('stall: every change of the taps holds the JS thread that long in its commit; the mount and a re-render with the same taps do not', async () => {
      // The timers are fake, so no motion the placement starts outlives the test; the clock the stall reads is the real one.
      jest.useFakeTimers({ doNotFake: ['performance'] });
      try {
        const h = await mount('hero.abyss.dark.empty.latin', MOTION_ON, { stall: 40 });
        const t0 = performance.now();
        h.layout();
        expect(performance.now() - t0).toBeLessThan(40);
        const t1 = performance.now();
        act(() => h.props(PlateTouch).onPlace({ x: 0.2, y: 0.2 }));
        expect(performance.now() - t1).toBeGreaterThanOrEqual(40);
        const t2 = performance.now();
        act(() => h.props(CommitCTA).onCommit());
        expect(performance.now() - t2).toBeLessThan(40);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  const outlines = (h: Awaited<ReturnType<typeof mount>>) => h.r.root.findAll((n) => typeof n.type !== 'string' && n.props.testID === 'hero.lab.outline');

  it("the outline dial draws the label band's inner and outer edges, ringInner and R, as 1 px strokes, hidden from TalkBack and from touch", async () => {
    const h = await mount('hero.abyss.dark.three.hebrew.outline');
    h.layout();
    const [canvas] = outlines(h);
    expect(canvas.props).toMatchObject({ pointerEvents: 'none', accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' });
    // Its two circles, the inner edge then the outer (Skia's Circle takes no testID: read the canvas's own children).
    const circles = React.Children.toArray(canvas.props.children) as React.ReactElement<Record<string, unknown>>[];
    const plate = h.props(BeadLayer).plate;
    expect(circles.map((c) => [c.props.cx, c.props.cy, c.props.r, c.props.style, c.props.strokeWidth])).toEqual([
      [plate.centre[0], plate.centre[1], plate.ringInner, 'stroke', 1 / 2.625],
      [plate.centre[0], plate.centre[1], plate.radius, 'stroke', 1 / 2.625],
    ]);
    // Over the words and under the beads.
    const layers = React.Children.toArray(h.props(Plate).children) as React.ReactElement[];
    expect(layers.map((l) => l.type)).toEqual([PlateEntry, RimLabels, expect.anything(), BeadLayer, PlateTouch]);
  });

  it('a plain id has no outline', async () => {
    const h = await mount('hero.abyss.dark.three.hebrew');
    h.layout();
    expect(outlines(h)).toEqual([]);
  });
});
