import React from 'react';
import { EventEmitter } from 'events';
import { PixelRatio, Text, View } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { LabRoot, LAB_EVENTS } from '../LabRoot';
import { Probe } from '../probe/Probe';
import { LAB_SENTINEL } from '../sentinel';
import type { Scene } from '../scenes';

// MB-085. The lab runtime end to end, on stateful fakes with real semantics: a frame source that
// draws one frame per tick, an event emitter standing in for the activity's device events, and host
// views that measure where the probes are. What the capture harness relies on:
//   · a refused launch sends one ERROR line and draws nothing;
//   · READY only after every probe is measured, the fonts are ready, and N frames were drawn;
//   · READY carries the run, the step, the time, the observed power-save state, the probes in dp
//     and px, and the sentinel (the lab's runtime use of it);
//   · a numbered command is applied only in order and only once, and anything else is IGNORED.

type Rect = { x: number; y: number; w: number; h: number };
const RECTS: Record<string, Rect> = { 'probe-stage': { x: 0, y: 0, w: 400, h: 800 }, 'probe-mark': { x: 120, y: 320, w: 160, h: 160 } };

function setup(props: Record<string, unknown>, deps: Record<string, unknown> = {}) {
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
  // The jest preset's View never answers measureInWindow; answer as the device would, with where
  // each probe was laid out (the GenerateScreen.test.tsx idiom).
  jest.spyOn(View.prototype as never as { measureInWindow(cb: unknown): void }, 'measureInWindow')
    .mockImplementation(function (this: { props: { nativeID?: string } }, cb: unknown) {
      const r = RECTS[this.props.nativeID ?? ''] ?? { x: 1, y: 2, w: 3, h: 4 };
      (cb as (...v: number[]) => void)(r.x, r.y, r.w, r.h);
    });
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <LabRoot {...props} deps={{ emit: (l: string) => lines.push(l), frames, events, ...deps }} />,
    );
  });
  const probes = () => tree.root.findAll((n) => typeof n.type === 'string' && String(n.props.nativeID ?? '').startsWith('probe-'));
  const layout = (only?: string) => act(() => {
    for (const p of probes()) if (!only || p.props.nativeID === `probe-${only}`) p.props.onLayout({ nativeEvent: { layout: {} } });
  });
  const of = (kind: string) => lines.filter((l) => l.startsWith(`KOKONADA_LAB ${kind} `)).map((l) => JSON.parse(l.slice(`KOKONADA_LAB ${kind} `.length)));
  const command = (args: Record<string, unknown>, nonStringKeys: string[] = []) => act(() => { emitter.emit(LAB_EVENTS.command, { args, nonStringKeys }); });
  const tick = (n = 1) => act(() => frames.tick(n));
  return { tree, lines, of, layout, tick, command, emitter, frames };
}

afterEach(() => jest.restoreAllMocks());

const FIXED = { labArgs: { run: 'r1', scene: 'smoke', clock: 'fixed', t: '1500', frames: '2' }, nonStringKeys: [], powerSave: false };
const STEPPED = { labArgs: { run: 'r2', scene: 'smoke', clock: 'stepped', t: '0', stepMs: '250', frames: '2' }, nonStringKeys: [], powerSave: false };

describe('a refused launch', () => {
  it('sends one ERROR line with every problem, draws nothing, and never sends READY', () => {
    const h = setup({ labArgs: { run: 'r9', scene: 'nope', clock: 'fixed', t: 'x' }, nonStringKeys: ['frames'] });
    expect(h.of('ERROR')).toEqual([{ run: 'r9', errors: expect.arrayContaining([
      'frames must be a string extra (--es), not another type', expect.stringMatching(/scene "nope"/), expect.stringMatching(/^t must be a finite/),
    ]) }]);
    expect(h.of('ERROR')[0].errors).toHaveLength(3);
    expect(h.tree.toJSON()).toBeNull();
    h.tick(10);
    expect(h.of('READY')).toEqual([]);
  });

  it('a launch with no arguments at all is refused, not defaulted', () => {
    const h = setup({});
    expect(h.of('ERROR')).toEqual([{ run: null, errors: ['run is required', 'scene is required', 'clock is required'] }]);
  });
});

describe('READY', () => {
  it('waits for every probe, then for N frames, then is sent exactly once with the whole state', () => {
    const h = setup(FIXED);
    h.tick(5);
    expect(h.of('READY')).toEqual([]);
    h.layout('mark');
    h.tick(5);
    expect(h.of('READY')).toEqual([]); // stage is still unmeasured
    h.layout('stage');
    h.tick(1);
    expect(h.of('READY')).toEqual([]); // 1 of 2 frames
    h.tick(1);
    const ratio = PixelRatio.get();
    expect(h.of('READY')).toEqual([{
      run: 'r1', seq: 0, scene: 'smoke', clock: 'fixed', t: 1500, powerSave: false, pixelRatio: ratio,
      probes: {
        stage: { dp: { x: 0, y: 0, width: 400, height: 800 }, px: { x: 0, y: 0, width: 400 * ratio, height: 800 * ratio } },
        mark: { dp: { x: 120, y: 320, width: 160, height: 160 }, px: { x: 120 * ratio, y: 320 * ratio, width: 160 * ratio, height: 160 * ratio } },
      },
      sentinel: LAB_SENTINEL,
    }]);
    h.tick(10);
    expect(h.of('READY')).toHaveLength(1);
  });

  it('carries the sentinel: the lab uses it at runtime, so it survives into the bundle', () => {
    const h = setup(FIXED);
    h.layout();
    h.tick(2);
    expect(h.lines.join('\n')).toContain(LAB_SENTINEL);
  });

  it('waits for the fonts, however many frames go by', () => {
    const h = setup(FIXED, { fontsReady: false });
    h.layout();
    h.tick(50);
    expect(h.of('READY')).toEqual([]);
  });

  it('reports the power-save state it observed, at launch and after a change event', () => {
    const h = setup({ ...STEPPED, powerSave: true });
    h.layout();
    h.tick(2);
    expect(h.of('READY')[0].powerSave).toBe(true);
    act(() => { h.emitter.emit(LAB_EVENTS.powerSave, { powerSave: false }); });
    h.command({ seq: '1', cmd: 'step' });
    h.tick(2);
    expect(h.of('READY')[1].powerSave).toBe(false);
  });

  it('a probe the scene did not declare is an ERROR, and READY never comes', () => {
    const Stray = () => <Probe id="stray"><Text>x</Text></Probe>;
    const scenes: Record<string, Scene> = { smoke: { periodMs: 6000, probes: ['other'], Component: Stray } };
    const h = setup(FIXED, { scenes });
    h.layout();
    h.tick(5);
    expect(h.of('ERROR')).toEqual([{ run: 'r1', errors: ['probe "stray" is not declared by the scene'] }]);
    expect(h.of('READY')).toEqual([]);
  });
});

describe('after an ERROR', () => {
  it('sends no READY, even when every declared probe is measured: a later READY must not read as success', () => {
    const Mixed = () => (
      <>
        <Probe id="declared"><Text>a</Text></Probe>
        <Probe id="stray"><Text>b</Text></Probe>
      </>
    );
    const scenes: Record<string, Scene> = { smoke: { periodMs: 6000, probes: ['declared'], Component: Mixed } };
    const strayFirst = setup(FIXED, { scenes });
    strayFirst.layout('stray');
    strayFirst.layout('declared');
    strayFirst.tick(10);
    expect(strayFirst.of('ERROR')).toHaveLength(1);
    expect(strayFirst.of('READY')).toEqual([]);
  });

  it('...including when a frame was already requested before the ERROR arrived', () => {
    const Mixed = () => (
      <>
        <Probe id="declared"><Text>a</Text></Probe>
        <Probe id="stray"><Text>b</Text></Probe>
      </>
    );
    const scenes: Record<string, Scene> = { smoke: { periodMs: 6000, probes: ['declared'], Component: Mixed } };
    const h = setup(FIXED, { scenes });
    h.layout('declared');
    expect(h.frames.queue).toHaveLength(1); // READY is already counting frames
    h.layout('stray');
    h.tick(10);
    expect(h.of('ERROR')).toHaveLength(1);
    expect(h.of('READY')).toEqual([]);
  });
});

describe('a READY that cannot be written (SF-2)', () => {
  it('is an ERROR that ends the run: one ERROR, the next command ignored as busy, and no READY ever', () => {
    const ratio = jest.spyOn(PixelRatio, 'get').mockReturnValue(2);
    const h = setup(STEPPED);
    h.layout();
    ratio.mockReturnValue(NaN); // READY's pixelRatio is not finite, so the line cannot be formatted
    h.tick(2);
    expect(h.of('ERROR')).toHaveLength(1);
    expect(h.of('ERROR')[0].errors[0]).toMatch(/not a finite number/);
    h.command({ seq: '1', cmd: 'step' });
    h.tick(4);
    expect(h.of('IGNORED')).toEqual([{ run: 'r2', seq: 1, reason: 'busy' }]);
    expect(h.of('ERROR')).toHaveLength(1);
    expect(h.of('READY')).toEqual([]);
  });
});

describe('commands', () => {
  const settled = () => {
    const h = setup(STEPPED);
    h.layout();
    h.tick(2);
    expect(h.of('READY')).toHaveLength(1);
    return h;
  };

  it('a step advances the stepped clock by the closed form and sends READY with its seq after N frames', () => {
    const h = settled();
    h.command({ seq: '1', cmd: 'step' });
    expect(h.of('READY')).toHaveLength(1);
    h.tick(2);
    expect(h.of('READY')[1]).toMatchObject({ run: 'r2', seq: 1, t: 250 });
    h.command({ seq: '2', cmd: 'step', steps: '4' });
    h.tick(2);
    expect(h.of('READY')[2]).toMatchObject({ seq: 2, t: 1250 });
  });

  it('a command that arrives twice, out of order, or before the last one settled is ignored, never applied', () => {
    const h = settled();
    h.command({ seq: '1', cmd: 'step' });
    h.command({ seq: '2', cmd: 'step' }); // the step before it has not settled
    h.tick(2);
    h.command({ seq: '1', cmd: 'step' }); // again
    h.command({ seq: '3', cmd: 'step' }); // skips 2
    h.tick(4);
    expect(h.of('IGNORED')).toEqual([
      { run: 'r2', seq: 2, reason: 'busy' },
      { run: 'r2', seq: 1, reason: 'duplicate' },
      { run: 'r2', seq: 3, reason: 'out-of-order' },
    ]);
    expect(h.of('READY').map((r) => [r.seq, r.t])).toEqual([[0, 0], [1, 250]]);
  });

  it('a malformed or unknown command is ignored with its reason', () => {
    const h = settled();
    h.command({ seq: 'one', cmd: 'step' });
    h.command({ seq: '1', cmd: 'jump' });
    h.command({ seq: '1', cmd: 'step' }, ['steps']);
    expect(h.of('IGNORED').map((i) => i.reason)).toEqual(['malformed', 'unknown-command', 'malformed']);
    h.tick(4);
    expect(h.of('READY')).toHaveLength(1);
  });

  it('a step on a clock that is not stepped is ignored and does not use up the number', () => {
    const h = setup(FIXED);
    h.layout();
    h.tick(2);
    h.command({ seq: '1', cmd: 'step' });
    h.tick(4);
    expect(h.of('IGNORED')).toEqual([{ run: 'r1', seq: 1, reason: 'wrong-clock' }]);
    expect(h.of('READY')).toHaveLength(1);
  });
});

describe('the lab entry', () => {
  it('index.lab.js registers LabRoot as the lab component, and nothing else', () => {
    const registered: Array<[string, unknown]> = [];
    let Root: unknown;
    // One isolated module registry for all three: the entry, the AppRegistry it calls, and LabRoot.
    jest.isolateModules(() => {
      const { AppRegistry } = require('react-native');
      jest.spyOn(AppRegistry, 'registerComponent').mockImplementation((name: unknown, factory: unknown) => {
        registered.push([name as string, (factory as () => unknown)()]);
        return name as string;
      });
      require('../../../../index.lab.js');
      Root = require('../LabRoot').LabRoot;
    });
    expect(typeof Root).toBe('function');
    expect(registered).toEqual([['KokonadaLab', Root]]);
  });
});

describe('teardown', () => {
  it('removes every listener and cancels the pending frame when the lab unmounts', () => {
    const h = setup(STEPPED);
    h.layout();
    expect(h.emitter.listenerCount(LAB_EVENTS.command)).toBe(1);
    expect(h.emitter.listenerCount(LAB_EVENTS.powerSave)).toBe(1);
    expect(h.frames.queue.length).toBe(1);
    act(() => h.tree.unmount());
    expect(h.emitter.listenerCount(LAB_EVENTS.command)).toBe(0);
    expect(h.emitter.listenerCount(LAB_EVENTS.powerSave)).toBe(0);
    expect(h.frames.queue.length).toBe(0);
  });
});
