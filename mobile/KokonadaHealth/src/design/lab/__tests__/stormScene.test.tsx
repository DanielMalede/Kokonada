import React from 'react';
import { StyleSheet, View } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { BASE, DIRECTIONS } from '../../v2/tokens/tokens.generated';
import { EXTENSIONS } from '../../v2/tokens/tokens.extensions.generated';
import { ProbeRegistry } from '../probe/Probe';
import type { LabParams } from '../params';

// B8-7 (the architect's B8 plan at 199b138; QA-068's S7, UI-190): a storm scene is the real FieldView, Abyss dark, whose
// taps change on a JS timer by the case's script (storm/stormScript.ts), and a small lab marker View in one corner whose
// colour changes in the same render as each change of the taps, so a recording measures latency in frames from the
// marker's change to the first changed field cell, with no clock alignment. The timer starts with the field (once the
// view is measured), so every case begins with IDLE_MS at rest. Only the UI thread and the canvas are faked, as in
// FieldScene.test.tsx; the JS timers are Jest's fake timers, which also drive performance.now.
const ui = { timestamp: 0 };
jest.mock('react-native-reanimated', () => {
  const { useEffect, useRef } = require('react');
  const registry = new Map<number, { fn: (info: unknown) => void; active: boolean }>();
  let nextId = 1;
  return {
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
    __active: () => [...registry.values()].filter((e) => e.active).length,
  };
});
const reanimated = require('react-native-reanimated') as { __frame(dt: number): void; __active(): number };

jest.mock('@shopify/react-native-skia', () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => children ?? null;
  return { Canvas: Stub, Image: () => null, Picture: () => null, FilterMode: { Nearest: 0, Linear: 1 }, MipmapMode: { None: 0, Nearest: 1, Linear: 2 }, Skia: {} };
});
jest.mock('../../v2/field/effect.ts', () => ({
  fieldEffect: () => ({ status: 'ready', effect: { name: 'effect' }, blueNoise: {}, blueNoiseShader: { name: 'noise' } }),
}));

import { FieldView } from '../../v2/field/FieldView';
import { FIELD_STATICS } from '../fieldScenes';
import { STORM_SCENES } from '../sceneGroups/storm';
import { SCENES } from '../scenes';
import { STORM_SCENE_PROBES, StormScene } from '../scenes/StormScene';
import { SceneFactsContext, type SceneFacts } from '../scenes/FieldScene';
import { LabRoot } from '../LabRoot';
import { STORM_MARKER_COLOURS, STORM_MARKER_DP, stormMarkerColour } from '../storm/stormMarker';
import { STORM_SCENE_SPECS, stormSceneSpec } from '../storm/stormScenes';
import { IDLE_MS, STORM_PERIOD_MS, stormScript } from '../storm/stormScript';

const W = 411;
const H = 914;
const IDS = ['storm.abyss.dark.first-full', 'storm.abyss.dark.first-still', 'storm.abyss.dark.toggle-still', 'storm.abyss.dark.idle-still'];
const CALM = (EXTENSIONS as unknown as { base: { $root: { hero: { scenes: Record<string, { placements: Array<{ x: number; y: number }> }> } } } })
  .base.$root.hero.scenes['one.calm'].placements.map((p) => ({ x: p.x, y: p.y }))[0];

const clock = { t: { value: 0 } } as never;
const paramsOf = (scene: string): LabParams => ({ run: 'r', scene, clock: 'realtime', t: 0, stepMs: 0, frames: 10 });
const mounted: ReactTestRenderer.ReactTestRenderer[] = [];
/** The scene's commits so far (React's Profiler): one per change, or the marker and the taps reach the screen apart. */
const commits = { n: 0 };
function mount(scene: string) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(
      <ProbeRegistry onMeasure={() => {}}>
        <React.Profiler id="storm" onRender={() => { commits.n += 1; }}>
          <StormScene clock={clock} t={null} params={paramsOf(scene)} />
        </React.Profiler>
      </ProbeRegistry>,
    );
  });
  mounted.push(r);
  return r;
}
beforeEach(() => {
  jest.useFakeTimers();
  ui.timestamp = 0;
});
afterEach(() => {
  for (const r of mounted.splice(0)) act(() => r.unmount());
  expect(reanimated.__active()).toBe(0);
  expect(jest.getTimerCount()).toBe(0);
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const probes = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root.findAll((n) => typeof n.type === 'string' && typeof n.props.nativeID === 'string' && n.props.nativeID.startsWith('probe-')).map((n) => n.props.nativeID);
const layoutAs = (r: ReactTestRenderer.ReactTestRenderer, width = W, height = H) =>
  act(() => r.root.find((n) => n.props.testID === 'storm-scene.view' && typeof n.type !== 'string').props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height } } }));
const fieldOf = (r: ReactTestRenderer.ReactTestRenderer) => r.root.findByType(FieldView).props;
const marker = (r: ReactTestRenderer.ReactTestRenderer) =>
  StyleSheet.flatten(r.root.find((n) => typeof n.type === 'string' && n.props.nativeID === 'probe-marker').props.style);
const advance = (ms: number) => act(() => { jest.advanceTimersByTime(ms); });

describe('the storm scene group', () => {
  it('four Abyss dark scenes: the first tap in normal and reduced motion, the toggle storm and the idle tap reduced', () => {
    expect(Object.keys(STORM_SCENES)).toEqual(IDS);
    for (const id of IDS) {
      expect(STORM_SCENES[id]).toEqual({ periodMs: BASE.field.clock.T, probes: STORM_SCENE_PROBES, Component: StormScene });
      expect(SCENES[id]).toBe(STORM_SCENES[id]);
    }
    expect(STORM_SCENE_PROBES).toEqual(['stage', 'marker']);
    expect(IDS.map((id) => [STORM_SCENE_SPECS[id].script.case, STORM_SCENE_SPECS[id].tier])).toEqual([
      ['first', 'full'], ['first', 'still'], ['toggle', 'still'], ['idle', 'still'],
    ]);
  });

  it('every scene is Abyss dark, its script built on the hero scene one.calm\'s placement', () => {
    for (const id of IDS) {
      const s = STORM_SCENE_SPECS[id];
      expect([s.direction, s.face]).toEqual(['abyss', 'dark']);
      expect(s.script).toEqual(stormScript(s.script.case, CALM));
    }
  });

  it('an id that is not a storm scene is a programming error naming it', () => {
    expect(() => stormSceneSpec('storm.abyss.dark.nowhere')).toThrow(/"storm\.abyss\.dark\.nowhere" is not a lab storm scene/);
  });

  it('the marker: two Abyss dark colours, the ground and the hairline, alternating with the count of changes', () => {
    const dark = DIRECTIONS.abyss.color.dark;
    expect(STORM_MARKER_COLOURS).toEqual([dark.ground.hex, dark.line.hairline.hex]);
    expect([0, 1, 2, 3, 22, 23].map(stormMarkerColour)).toEqual([0, 1, 0, 1, 0, 1].map((k) => STORM_MARKER_COLOURS[k]));
    expect(STORM_MARKER_DP).toEqual({ left: 0, top: 72, size: 16 });
  });
});

describe('a storm scene before and after layout', () => {
  it('before layout: both probes, the marker at rest, no FieldView and no timer', () => {
    const r = mount(IDS[2]);
    expect(probes(r).sort()).toEqual(['probe-marker', 'probe-stage']);
    expect(r.root.findAllByType(FieldView)).toHaveLength(0);
    expect(marker(r)).toMatchObject({
      position: 'absolute', left: STORM_MARKER_DP.left, top: STORM_MARKER_DP.top, width: STORM_MARKER_DP.size, height: STORM_MARKER_DP.size,
      backgroundColor: STORM_MARKER_COLOURS[0],
    });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('after layout: the real FieldView, keyed by the scene, Abyss dark at the case\'s tier, at rest, on the lab\'s clock', () => {
    const r = mount(IDS[1]);
    layoutAs(r);
    const p = fieldOf(r);
    expect(p.scene).toBe(IDS[1]);
    expect(p.clock).toBe(clock);
    expect([p.direction, p.face, p.tier]).toEqual(['abyss', 'dark', 'still']);
    expect(p.statics).toBe(FIELD_STATICS);
    expect(p.taps).toEqual([]);
    expect([p.stress, p.confidence, p.genesis]).toEqual([0, 1, false]);
  });

  it('the script starts with the field: time before layout does not count', () => {
    const r = mount(IDS[0]);
    advance(5000);
    layoutAs(r);
    advance(IDLE_MS - 1);
    expect(fieldOf(r).taps).toEqual([]);
    advance(1);
    expect(fieldOf(r).taps).toEqual([CALM]);
  });
});

describe('the taps and the marker change together, on the script\'s ticks', () => {
  it.each(IDS)('%s: two whole cycles, every change: the taps are the script\'s and the marker the count\'s, in one render', (id) => {
    const r = mount(id);
    layoutAs(r);
    const s = STORM_SCENE_SPECS[id].script;
    const ticks = [...s.changes.map((c) => c.atMs), ...s.changes.map((c) => s.cycleMs + c.atMs)];
    let at = 0;
    let renders = 0;
    let count = 0;
    for (const tick of ticks) {
      advance(tick - at - 1);
      // Just before the tick: the previous change still stands, on both.
      expect([fieldOf(r).taps, marker(r).backgroundColor]).toEqual([count === 0 ? s.initial : s.changes[(count - 1) % s.changes.length].taps, stormMarkerColour(count)]);
      const before = fieldOf(r).taps;
      const was = commits.n;
      advance(1);
      count += 1;
      at = tick;
      const p = fieldOf(r);
      expect(p.taps).toBe(s.changes[(count - 1) % s.changes.length].taps);
      expect(p.taps).not.toBe(before);
      expect(marker(r).backgroundColor).toBe(stormMarkerColour(count));
      // One commit carried both: the marker never trails the taps by a render.
      expect([tick, commits.n - was]).toEqual([tick, 1]);
      renders += 1;
    }
    expect(renders).toBe(2 * s.changes.length);
  });

  it('the toggle storm: 21 changes 143 ms apart flip the marker 21 times', () => {
    const r = mount(IDS[2]);
    layoutAs(r);
    advance(IDLE_MS - 1);
    const colours: string[] = [];
    for (let i = 0; i < 21; i++) {
      advance(i === 0 ? 1 : STORM_PERIOD_MS);
      colours.push(marker(r).backgroundColor as string);
    }
    expect(colours).toEqual(Array.from({ length: 21 }, (_, i) => stormMarkerColour(i + 1)));
  });

  it('a late timer catches up from the elapsed time, never from a count of its own', () => {
    const real = performance.now.bind(performance);
    let stall = 0;
    jest.spyOn(performance, 'now').mockImplementation(() => real() + stall);
    const r = mount(IDS[2]);
    layoutAs(r);
    advance(IDLE_MS);
    expect(marker(r).backgroundColor).toBe(stormMarkerColour(1));
    // The JS thread stalls for 1143 ms inside the storm: the next look sees every change since, as the script says.
    stall = 1143;
    advance(STORM_PERIOD_MS);
    const s = STORM_SCENE_SPECS[IDS[2]].script;
    const n = s.changes.filter((c) => c.atMs <= IDLE_MS + STORM_PERIOD_MS + stall).length;
    expect(n).toBe(9);
    expect(marker(r).backgroundColor).toBe(stormMarkerColour(n));
    expect(fieldOf(r).taps).toBe(s.changes[n - 1].taps);
  });

  it('unmounting stops the timer', () => {
    const r = mount(IDS[3]);
    layoutAs(r);
    expect(jest.getTimerCount()).toBe(1);
    act(() => r.unmount());
    mounted.splice(0);
    expect(jest.getTimerCount()).toBe(0);
  });
});

// UI-241 (c): a storm scene draws FieldView at its case's tier, so it says that tier as its scene facts, as the policy
// scenes do, and READY carries it: the storm plan's expect.tier is that tier, and the harness holds READY to it.
describe('a storm scene says its case\'s tier, and READY carries it', () => {
  it.each(IDS)('%s: the scene facts are the spec\'s tier, from the first render', (id) => {
    const facts: SceneFacts[] = [];
    act(() => {
      mounted.push(ReactTestRenderer.create(
        <SceneFactsContext.Provider value={(f) => facts.push(f)}>
          <ProbeRegistry onMeasure={() => {}}>
            <StormScene clock={clock} t={null} params={paramsOf(id)} />
          </ProbeRegistry>
        </SceneFactsContext.Provider>,
      ));
    });
    expect(facts).toEqual([{ tier: STORM_SCENE_SPECS[id].tier }]);
  });

  it.each(IDS)('%s: end to end through LabRoot, READY says the tier', (id) => {
    const lines: string[] = [];
    const queue: Array<() => void> = [];
    const frames = { next: (cb: () => void) => { queue.push(cb); return () => { const i = queue.indexOf(cb); if (i >= 0) queue.splice(i, 1); }; } };
    const tick = (n: number) => { for (let i = 0; i < n; i += 1) act(() => { queue.splice(0).forEach((cb) => cb()); }); };
    jest.spyOn(View.prototype as never as { measureInWindow(cb: unknown): void }, 'measureInWindow')
      .mockImplementation((cb: unknown) => (cb as (...v: number[]) => void)(0, 0, W, H));
    let r!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      r = ReactTestRenderer.create(
        <LabRoot
          labArgs={{ run: 'r', scene: id, clock: 'realtime', frames: '3' }}
          nonStringKeys={[]}
          deps={{ emit: (l) => lines.push(l), frames, events: { addListener: () => ({ remove: () => {} }) }, reduceMotion: { current: () => Promise.resolve(STORM_SCENE_SPECS[id].tier === 'still'), subscribe: () => () => {} } }}
        />,
      );
    });
    mounted.push(r);
    layoutAs(r);
    act(() => reanimated.__frame(16)); // FieldView's first drawn frame
    act(() => { for (const p of r.root.findAll((n) => typeof n.type === 'string' && String(n.props.nativeID ?? '').startsWith('probe-'))) p.props.onLayout({ nativeEvent: { layout: {} } }); });
    tick(3);
    const ready = lines.filter((l) => l.startsWith('KOKONADA_LAB READY ')).map((l) => JSON.parse(l.slice('KOKONADA_LAB READY '.length)));
    expect(lines.filter((l) => l.startsWith('KOKONADA_LAB ERROR '))).toEqual([]);
    expect(ready.map((x) => [x.scene, x.tier, x.shaderStatus])).toEqual([[id, STORM_SCENE_SPECS[id].tier, 'ready']]);
  });
});
