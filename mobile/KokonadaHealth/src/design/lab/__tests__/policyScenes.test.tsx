/// <reference types="node" />
import React from 'react';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { View } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

// B8-6 (the architect's B8 plan; the build plan's §7 S2 and S3): the policy-tier field scenes. A `field.abyss.<face>.<hero>.policy`
// scene draws the real FieldView at the tier the app's own motion policy (useMotionPolicy) gives for the device's state,
// never a tier written in its id: reduced motion (on Android, RN reads the transition animator scale, which the harness
// sets with every animator scale) gives the still, battery saver gives low, both give the still, neither gives full.
// The tier reaches FieldView through its own `tier` prop, as the app's root gives it; FieldView takes no new prop.
// READY carries the tier the scene observed (no tap coordinate, no emotion value), and only once the policy has answered:
// the policy's cautious still while a setting is unanswered is never sent as the scene's tier. A tier that changes after
// READY makes that READY false: an ERROR.
// End to end through the real LabRoot, FieldScene, FieldView and its builder; the reduced-motion setting is a stateful
// fake (a read that answers when the test says, and change events), battery saver is the activity's launch prop and its
// device events, as DesignLabActivity sends them. Only the UI thread and Skia are faked, as in LabShaderStatus.test.tsx.
const ui = { timestamp: 0 };
jest.mock('react-native-reanimated', () => {
  const { useEffect, useRef } = require('react');
  const registry = new Map<number, { fn: (info: unknown) => void; active: boolean }>();
  let nextId = 1;
  return {
    View: require('react-native').View,
    useAnimatedStyle: (fn: () => unknown) => fn(),
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
      ui.timestamp += dt;
      for (const entry of [...registry.values()]) if (entry.active) entry.fn({ timestamp: ui.timestamp, timeSincePreviousFrame: dt, timeSinceFirstFrame: 0 });
    },
  };
});
const reanimated = require('react-native-reanimated') as { __frame(dt: number): void };

jest.mock('@shopify/react-native-skia', () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => children ?? null;
  const inert: unknown = new Proxy(function stub() {}, { get: () => inert, apply: () => inert });
  return {
    Canvas: Stub, Image: () => null, Picture: () => null,
    FilterMode: { Nearest: 0, Linear: 1 }, MipmapMode: { None: 0, Nearest: 1, Linear: 2 },
    ClipOp: { Difference: 0, Intersect: 1 }, TileMode: { Clamp: 0, Repeat: 1, Mirror: 2, Decal: 3 },
    Skia: inert,
  };
});
jest.mock('../../v2/field/effect.ts', () => ({
  fieldEffect: () => ({ status: 'ready', effect: { name: 'effect' }, blueNoise: {}, blueNoiseShader: { name: 'noise' } }),
}));

import { renderFacts, surfaceRule, validatePlan } from '../../../../scripts/lab/capture.mjs';
import { renderScaleFor } from '../../v2/field/fieldDriver';
import { FieldView } from '../../v2/field/FieldView';
import { resolveMotionTier, type MotionTier } from '../../v2/motion/useMotionPolicy';
import { DIRECTIONS } from '../../v2/tokens/tokens.generated';
import { FIELD_FACES, FIELD_SCENES, HERO_SCENES } from '../fieldScenes';
import { LAB_EVENTS, LabRoot } from '../LabRoot';
import { parseLabArgs } from '../params';
import { SCENES } from '../scenes';
import { FieldScene, LabMotionPortsContext, SceneFactsContext, type SceneFacts } from '../scenes/FieldScene';
import type { MotionPorts } from '../../v2/motion/ports';
import { ProbeRegistry } from '../probe/Probe';
import { labMounts } from './__fixtures__/labMounts';

// Each test's tree is unmounted after it, so no setting-read deadline (UI-241) outlives the test (UI-261).
const mounts = labMounts();

const POLICY_IDS = FIELD_FACES.flatMap((face) => HERO_SCENES.map((hero) => `field.abyss.${face}.${hero}.policy`));

/** The OS's reduced-motion setting: a read that answers when the test says, and change events. */
function reduceMotionDevice() {
  const emitter = new EventEmitter();
  let answer!: (on: boolean) => void;
  let refuse!: (e: Error) => void;
  const read = new Promise<boolean>((r, j) => { answer = r; refuse = j; });
  read.catch(() => {}); // a refused read is the test's own doing; every consumer handles it
  return {
    source: {
      current: () => read,
      subscribe: (fn: (on: boolean) => void) => { emitter.on('change', fn); return () => { emitter.off('change', fn); }; },
    },
    answer: (on: boolean) => act(async () => { answer(on); await read; }),
    /** The platform refuses the read (on Android, a settings read that throws). */
    refuse: (message: string) => act(async () => { refuse(new Error(message)); await read.catch(() => {}); }),
    change: (on: boolean) => act(async () => { emitter.emit('change', on); }),
  };
}

function setup(scene: string, device: { powerSave: boolean }) {
  const lines: string[] = [];
  const emitter = new EventEmitter();
  const frames = {
    queue: [] as Array<() => void>,
    next(cb: () => void) { frames.queue.push(cb); return () => { frames.queue = frames.queue.filter((x) => x !== cb); }; },
    tick(n = 1) { for (let i = 0; i < n; i += 1) { const due = frames.queue; frames.queue = []; due.forEach((cb) => cb()); } },
  };
  const events = {
    addListener: (name: string, cb: (e: unknown) => void) => { emitter.on(name, cb); return { remove: () => emitter.off(name, cb) }; },
  };
  const rm = reduceMotionDevice();
  jest.spyOn(View.prototype as never as { measureInWindow(cb: unknown): void }, 'measureInWindow')
    .mockImplementation((cb: unknown) => (cb as (...v: number[]) => void)(0, 0, 411, 914));
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <LabRoot
        labArgs={{ run: 'r', scene, clock: 'fixed', t: '11000', frames: '3' }}
        nonStringKeys={[]}
        powerSave={device.powerSave}
        deps={{ emit: (l: string) => lines.push(l), frames, events, reduceMotion: rm.source }}
      />,
    );
  });
  mounts.track(tree);
  const of = (kind: string) => lines.filter((l) => l.startsWith(`KOKONADA_LAB ${kind} `)).map((l) => JSON.parse(l.slice(`KOKONADA_LAB ${kind} `.length)));
  const sizeScene = () => act(() => {
    tree.root.find((n) => n.props.testID === 'field-scene.view' && typeof n.type !== 'string').props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 411, height: 914 } } });
  });
  const measure = () => act(() => {
    for (const p of tree.root.findAll((n) => typeof n.type === 'string' && String(n.props.nativeID ?? '').startsWith('probe-'))) p.props.onLayout({ nativeEvent: { layout: {} } });
  });
  const uiFrames = (n: number) => { for (let i = 0; i < n; i++) act(() => reanimated.__frame(16)); };
  const tick = (n = 1) => act(() => frames.tick(n));
  const powerSave = (on: boolean) => act(async () => { emitter.emit(LAB_EVENTS.powerSave, { powerSave: on }); });
  const fieldTier = () => tree.root.findByType(FieldView).props.tier as MotionTier;
  /** The scene laid out, FieldView's first frame drawn, the probes measured and READY's frames ticked. */
  const draw = () => { sizeScene(); uiFrames(2); measure(); tick(3); };
  return { tree, of, draw, tick, uiFrames, powerSave, fieldTier, rm };
}

afterEach(() => jest.restoreAllMocks());

describe('the policy scenes: Abyss × {dark, light} × the hero scenes, the tier from the motion policy', () => {
  it('names one `.policy` scene per face and hero scene, a field scene with no tier of its own', () => {
    const policy = Object.values(FIELD_SCENES).filter((s) => s.id.endsWith('.policy'));
    expect(policy).toHaveLength(8); // has cases: 2 faces × 4 hero scenes
    expect(policy.map((s) => s.id).sort()).toEqual([...POLICY_IDS].sort());
    for (const s of policy) {
      const [, direction, face, ...rest] = s.id.split('.');
      const sibling = FIELD_SCENES[`field.${direction}.${face}.${rest.slice(0, -1).join('.')}.full`];
      expect([s.id, s.kind, s.direction, s.face, s.hero, s.tier, s.policy]).toEqual([s.id, 'field', direction, face, rest.slice(0, -1).join('.'), null, true]);
      // The same scene as its id-tier siblings in everything but where the tier comes from.
      expect(s.taps).toEqual(sibling.taps);
      expect(s.periodMs).toBe(sibling.periodMs);
      expect(s.layout(411, 914, 1)).toEqual(sibling.layout(411, 914, 1));
    }
    // Every other field scene takes its tier from its id.
    for (const s of Object.values(FIELD_SCENES).filter((x) => x.kind === 'field' && !x.id.endsWith('.policy'))) expect([s.id, s.policy]).toEqual([s.id, false]);
  });

  it('each is a lab scene drawn by FieldScene, held by the harness to the policy rule (the field shader)', () => {
    for (const id of POLICY_IDS) {
      expect([id, SCENES[id]?.Component]).toEqual([id, FieldScene]);
      expect([id, surfaceRule(id)]).toEqual([id, expect.objectContaining({ suffix: '.policy', status: 'ready' })]);
    }
  });
});

describe('READY says the tier the motion policy gave FieldView, as the device reports its state (S2, S3)', () => {
  const SCENE = 'field.abyss.dark.three.policy';
  it.each<[string, boolean, boolean, MotionTier]>([
    ['animator scale 0 (reduced motion), battery saver off', true, false, 'still'],
    ['battery saver on, reduced motion off', false, true, 'low'],
    ['both', true, true, 'still'],
    ['neither', false, false, 'full'],
  ])('%s: %s', async (_state, reduced, saver, tier) => {
    expect(resolveMotionTier({ reduceMotion: reduced, powerSave: saver })).toBe(tier); // the policy's own table
    const h = setup(SCENE, { powerSave: saver });
    await h.rm.answer(reduced);
    h.draw();
    expect(h.fieldTier()).toBe(tier);
    expect(h.of('READY').map((r) => [r.tier, r.powerSave, r.shaderStatus])).toEqual([[tier, saver, 'ready']]);
    expect(h.of('ERROR')).toEqual([]);
  });

  it('the same scene on the other face and another hero scene', async () => {
    const h = setup('field.abyss.light.one.joy.policy', { powerSave: true });
    await h.rm.answer(false);
    h.draw();
    expect([h.fieldTier(), h.of('READY').map((r) => r.tier)]).toEqual(['low', ['low']]);
  });

  it('holds READY while reduced motion is unanswered: the policy\'s cautious still is never sent as the scene\'s tier', async () => {
    const h = setup(SCENE, { powerSave: false });
    h.draw();
    expect(h.fieldTier()).toBe('still'); // the policy's caution, drawn, but not the device's answer
    h.tick(20);
    expect(h.of('READY')).toEqual([]);
    await h.rm.answer(false);
    expect(h.fieldTier()).toBe('full');
    h.tick(2);
    expect(h.of('READY')).toEqual([]); // READY counts its frames afresh once the tier is known
    h.tick(1);
    expect(h.of('READY').map((r) => r.tier)).toEqual(['full']);
    expect(h.of('ERROR')).toEqual([]);
  });

  it('a change event answers too, and a late read after it is ignored, as the policy ignores it', async () => {
    const h = setup(SCENE, { powerSave: false });
    await h.rm.change(true);
    await h.rm.answer(false); // older than the event
    h.draw();
    expect([h.fieldTier(), h.of('READY').map((r) => r.tier)]).toEqual(['still', ['still']]);
  });

  it('battery saver turned on after READY changes the tier: an ERROR naming both, and no second READY', async () => {
    const h = setup(SCENE, { powerSave: false });
    await h.rm.answer(false);
    h.draw();
    expect(h.of('READY').map((r) => r.tier)).toEqual(['full']);
    await h.powerSave(true);
    expect(h.fieldTier()).toBe('low');
    h.tick(5);
    expect(h.of('ERROR')).toEqual([{ run: 'r', errors: [expect.stringMatching(/tier changed after READY.*full.*low/)] }]);
    expect(h.of('READY')).toHaveLength(1);
  });

  it('reduced motion turned on after READY: the same ERROR', async () => {
    const h = setup(SCENE, { powerSave: true });
    await h.rm.answer(false);
    h.draw();
    expect(h.of('READY').map((r) => r.tier)).toEqual(['low']);
    await h.rm.change(true);
    expect(h.of('ERROR')).toEqual([{ run: 'r', errors: [expect.stringMatching(/tier changed after READY.*low.*still/)] }]);
  });

  // UI-241 (a): a setting whose read is refused is never answered, so the policy keeps its cautious still for good and
  // the scene's tier is never known: READY was held in silence until the harness timed out. Now the scene says which
  // setting it could not read, and LabRoot sends one ERROR naming it, at once; nothing follows an ERROR.
  it('reduced motion that cannot be read: one ERROR naming the setting and the reason, at once, and never a READY', async () => {
    const h = setup(SCENE, { powerSave: false });
    h.draw();
    expect(h.of('ERROR')).toEqual([]);
    await h.rm.refuse('Settings.Global unavailable');
    expect(h.of('ERROR')).toEqual([{ run: 'r', errors: ['the tier cannot be known: the device\'s reduced-motion setting could not be read (Settings.Global unavailable)'] }]);
    h.tick(20);
    await h.rm.change(false); // a later answer cannot undo the ERROR: the harness already has it
    h.tick(20);
    expect(h.of('READY')).toEqual([]);
    expect(h.of('ERROR')).toHaveLength(1);
  });

  it('a refused read after a change event answered the setting is ignored, as the policy ignores it: READY, no ERROR', async () => {
    const h = setup(SCENE, { powerSave: false });
    await h.rm.change(false);
    await h.rm.refuse('late');
    h.draw();
    expect([h.fieldTier(), h.of('READY').map((r) => r.tier), h.of('ERROR')]).toEqual(['full', ['full'], []]);
  });

  it('an id-tier scene does not ask the policy, so a refused read is nothing to it: READY at its own tier', async () => {
    const h = setup('field.abyss.dark.three.low', { powerSave: false });
    await h.rm.refuse('unavailable');
    h.draw();
    expect([h.of('READY').map((r) => r.tier), h.of('ERROR')]).toEqual([['low'], []]);
  });

  it('an id-tier scene keeps the tier its id names, whatever the device says, and READY says it at once', () => {
    const h = setup('field.abyss.dark.three.low', { powerSave: false });
    h.draw(); // reduced motion never answers: an id scene does not ask the policy
    expect([h.fieldTier(), h.of('READY').map((r) => r.tier)]).toEqual(['low', ['low']]);
  });

  it('FieldView takes no new prop: the policy scene gives it the props the app\'s own root gives', async () => {
    const h = setup(SCENE, { powerSave: true });
    await h.rm.answer(false);
    h.draw();
    expect(Object.keys(h.tree.root.findByType(FieldView).props).sort()).toEqual(
      ['clock', 'confidence', 'direction', 'face', 'genesis', 'layout', 'pxPerDp', 'scene', 'statics', 'stress', 'taps', 'tier'],
    );
  });

  it('READY names the tier and nothing of the scene\'s inputs: no tap coordinate, no emotion value (T1)', async () => {
    const h = setup(SCENE, { powerSave: false });
    await h.rm.answer(true);
    h.draw();
    const [ready] = h.of('READY');
    // UI-276: skiaBackend is a build fact (react-native-skia's backend and how it was read), no input of the scene's.
    expect(Object.keys(ready).sort()).toEqual(['clock', 'fontScale', 'isRTL', 'pixelRatio', 'powerSave', 'probes', 'run', 'scene', 'sentinel', 'seq', 'shaderReason', 'shaderStatus', 'skiaBackend', 't', 'tier']);
    expect(Object.keys(ready.skiaBackend).sort()).toEqual(['backend', 'readBy', 'reason']);
    expect(JSON.stringify(ready)).not.toMatch(/taps|emotion|joy|intense|"x":-?0\.\d/);
  });
});

// The capture plan for the policy scenes: each shot sets the device state, and its `expect.tier` is the tier that state
// implies under the policy's own table, so the harness can hold READY's observed tier to it and its render facts follow.
describe('the policy capture plan (scripts/lab/capture-plans/v1-policy.json)', () => {
  type Shot = {
    id: string; repeat: number; scene: string; args: Record<string, string>; probes: string[];
    device: { fontScale: number; night: string; animatorScale: number; powerSave: boolean };
    expect: { direction: string | null; face: string | null; hero: string | null; tier: string | null };
    proof?: { kind: string; seconds: number };
  };
  const PLAN_PATH = path.resolve(__dirname, '../../../../scripts/lab/capture-plans/v1-policy.json');
  let plan!: { id: string; shots: Shot[] };
  // The plan's policy shots, and its one other shot: RA-52's twin of the low rate shot under battery saver, on the explicit
  // low scene with battery saver off, so the display runs at its full rate and only the tier can cap the rate.
  const TWIN = { scene: 'field.abyss.dark.three.low', powerSave: false };
  let policyPlan!: { id: string; shots: Shot[] };
  beforeAll(() => {
    plan = JSON.parse(fs.readFileSync(PLAN_PATH, 'utf8'));
    policyPlan = { ...plan, shots: plan.shots.filter((s) => POLICY_IDS.includes(s.scene)) };
  });
  const timings = Object.fromEntries(Object.entries(SCENES).map(([id, s]) => [id, { periodMs: s.periodMs }]));
  /** On Android RN's reduced motion is a transition animator scale of 0; the harness sets every scale to animatorScale. */
  const implied = (d: Shot['device']) => resolveMotionTier({ reduceMotion: d.animatorScale === 0, powerSave: d.powerSave });
  const tiers = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../../../design-tokens/base.tokens.json'), 'utf8')).field.tiers;

  it('is a valid plan for the harness, named as its file, and every shot launches a policy scene the lab parses', () => {
    expect(validatePlan(plan)).toEqual([]);
    expect(plan.id).toBe('v1-policy');
    expect(policyPlan.shots.length).toBeGreaterThan(0);
    for (const shot of policyPlan.shots) {
      expect([shot.id, POLICY_IDS.includes(shot.scene)]).toEqual([shot.id, true]);
      expect([...shot.probes].sort()).toEqual([...SCENES[shot.scene].probes].sort());
      const parsed = parseLabArgs({ ...shot.args, run: 'plan-check', scene: shot.scene }, [], timings);
      expect([shot.id, parsed.ok && parsed.params.frames >= 10]).toEqual([shot.id, true]);
    }
  });

  it('holds one shot that is not a policy scene: RA-52\'s low rate twin, battery saver off, motion on, a running clock', () => {
    const others = plan.shots.filter((s) => !POLICY_IDS.includes(s.scene));
    expect(others.map((s) => [s.scene, s.device.powerSave, s.device.animatorScale > 0, s.args.clock, s.proof?.kind, s.expect.tier]))
      .toEqual([[TWIN.scene, TWIN.powerSave, true, 'realtime', 'rate', 'low']]);
  });

  it('every shot\'s expect is its scene\'s facts, with the tier its device state implies under the policy', () => {
    for (const shot of policyPlan.shots) {
      const s = FIELD_SCENES[shot.scene];
      expect([shot.id, shot.expect]).toEqual([shot.id, { direction: s.direction, face: s.face, hero: s.hero, tier: implied(shot.device) }]);
      // The render facts the harness writes follow the implied tier: low reads the low tier, still and full the full.
      expect([shot.id, renderFacts(shot.expect.tier, tiers).renderScale]).toEqual([shot.id, renderScaleFor(implied(shot.device))]);
    }
  });

  it('sets each of the four device states on each face, on the fixed clock at t*, twice, in the face\'s night mode', () => {
    const stills = policyPlan.shots.filter((s) => s.proof === undefined);
    for (const face of FIELD_FACES) {
      const states = stills.filter((s) => s.scene === `field.abyss.${face}.three.policy`).map((s) => [s.device.animatorScale === 0, s.device.powerSave]);
      expect(states.map((x) => JSON.stringify(x)).sort()).toEqual([[false, false], [false, true], [true, false], [true, true]].map((x) => JSON.stringify(x)).sort());
    }
    expect(new Set(stills.map((s) => implied(s.device)))).toEqual(new Set(['full', 'low', 'still']));
    for (const shot of stills) {
      expect([shot.id, shot.args.clock, shot.args.t, shot.repeat, shot.device.fontScale]).toEqual([shot.id, 'fixed', String(DIRECTIONS.abyss.field.stillTime), 2, 1]);
      expect([shot.id, shot.device.night]).toEqual([shot.id, FIELD_SCENES[shot.scene].face === 'dark' ? 'yes' : 'no']);
      expect([shot.id, [0, 1]]).toEqual([shot.id, expect.arrayContaining([shot.device.animatorScale])]);
    }
    expect(new Set(plan.shots.map((s) => s.id)).size).toBe(plan.shots.length);
  });

  // The catalogue rule (capturePlans.test.ts): every field scene is shot as a still by some plan. The other hero scenes
  // are shot once per face under battery saver, the state whose tier (low) the id-tier stills cannot stand in for here.
  it('shoots every policy scene as a still, the other hero scenes under battery saver', () => {
    const stills = policyPlan.shots.filter((s) => s.proof === undefined && s.args.clock === 'fixed');
    for (const id of POLICY_IDS) expect([id, stills.some((s) => s.scene === id)]).toEqual([id, true]);
    for (const s of stills.filter((x) => !x.scene.endsWith('.three.policy'))) {
      expect([s.id, s.device.animatorScale, s.device.powerSave, s.expect.tier]).toEqual([s.id, 1, true, 'low']);
    }
  });

  it('proves motion through the policy on a running clock: the still draws none, low and full draw some (QA-034, QA-035)', () => {
    const proofs = policyPlan.shots.filter((s) => s.proof !== undefined);
    const byTier = (tier: string) => proofs.filter((s) => implied(s.device) === tier).map((s) => [s.args.clock, s.proof!.kind]);
    expect(byTier('still')).toEqual([['realtime', 'zero-frames'], ['realtime', 'zero-frames']]); // reduced motion, alone and with battery saver
    expect(byTier('low')).toEqual([['realtime', 'draws-frames'], ['realtime', 'rate']]);
    expect(byTier('full')).toEqual([['realtime', 'draws-frames'], ['realtime', 'rate']]); // the positive control, then the cap (UI-171)
  });
});

// UI-241 (a), the other setting: in the lab battery saver is the activity's launch prop and events, which always answer,
// so its refusal is reached through the scene's own ports, as LabRoot provides them.
describe('a policy scene whose battery-saver setting cannot be read says so (UI-241 a)', () => {
  const PARAMS = { run: 'r', scene: 'field.abyss.dark.three.policy', clock: 'fixed' as const, t: 11000, stepMs: 0, frames: 3 };
  const mountWith = async (ports: MotionPorts) => {
    const facts: SceneFacts[] = [];
    await act(async () => {
      mounts.track(ReactTestRenderer.create(
        <LabMotionPortsContext.Provider value={ports}>
          <SceneFactsContext.Provider value={(f) => facts.push(f)}>
            <ProbeRegistry onMeasure={() => {}}>
              <FieldScene clock={{ t: { value: 11000 } } as never} t={11000} params={PARAMS} />
            </ProbeRegistry>
          </SceneFactsContext.Provider>
        </LabMotionPortsContext.Provider>,
      ));
    });
    return facts;
  };
  const answers = (value: boolean) => ({ read: () => Promise.resolve(value), subscribe: () => () => {} });
  const refuses = (message: string) => ({ read: () => Promise.reject(new Error(message)), subscribe: () => () => {} });

  it('battery saver refused: the tier is not known, and the scene names the setting and the reason', async () => {
    const facts = await mountWith({ reduceMotion: answers(false), powerSave: refuses('PowerManager unavailable') });
    expect(facts[facts.length - 1]).toEqual({ tier: null, unreadable: 'the device\'s battery-saver setting could not be read (PowerManager unavailable)' });
  });

  it('both refused, one after the other: the first refusal is the one named, and it stays named', async () => {
    let refuseSaver!: (e: Error) => void;
    const saverRead = new Promise<boolean>((_, j) => { refuseSaver = j; });
    saverRead.catch(() => {});
    const facts = await mountWith({ reduceMotion: refuses('a'), powerSave: { read: () => saverRead, subscribe: () => () => {} } });
    await act(async () => { refuseSaver(new Error('b')); await saverRead.catch(() => {}); });
    const named = facts.filter((f) => f.unreadable !== undefined).map((f) => f.unreadable);
    expect(new Set(named)).toEqual(new Set(["the device's reduced-motion setting could not be read (a)"]));
    expect(facts[facts.length - 1]).toEqual({ tier: null, unreadable: "the device's reduced-motion setting could not be read (a)" });
  });

  it('both answered: no setting is named', async () => {
    const facts = await mountWith({ reduceMotion: answers(false), powerSave: answers(true) });
    expect(facts.every((f) => f.unreadable === undefined)).toBe(true);
    expect(facts[facts.length - 1]).toEqual({ tier: 'low' });
  });
});
