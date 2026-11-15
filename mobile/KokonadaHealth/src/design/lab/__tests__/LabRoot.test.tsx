import React from 'react';
import { EventEmitter } from 'events';
import { I18nManager, PixelRatio, Text, View } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { CostReportContext, type CostReport } from '../cost/costResult';
import { LabRoot, LAB_EVENTS } from '../LabRoot';
import { Probe } from '../probe/Probe';
import { LAB_SENTINEL } from '../sentinel';
import type { Scene } from '../scenes';
import { ShaderReportContext } from '../shaderReport';
// SCENES reaches FieldView, whose fieldImage.tsx reads Skia's FilterMode on load: the setup stub lacks it (__fixtures__/skiaHeadless.ts).
jest.mock('@shopify/react-native-skia', () => require('./__fixtures__/skiaHeadless').skiaHeadless());

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
    jest.replaceProperty(I18nManager, 'isRTL', true);
    jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(1.3);
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
      isRTL: true, fontScale: 1.3,
      probes: {
        stage: { dp: { x: 0, y: 0, width: 400, height: 800 }, px: { x: 0, y: 0, width: 400 * ratio, height: 800 * ratio } },
        mark: { dp: { x: 120, y: 320, width: 160, height: 160 }, px: { x: 120 * ratio, y: 320 * ratio, width: 160 * ratio, height: 160 * ratio } },
      },
      sentinel: LAB_SENTINEL,
      // The smoke scene draws no field, so it names no surface (UI-223: a field scene names its own).
      shaderStatus: null, shaderReason: null,
    }]);
    h.tick(10);
    expect(h.of('READY')).toHaveLength(1);
  });

  // The harness refuses a shot unless the app itself reports RTL (F-13) and the font scale it really
  // used (adb reads only the OS setting). So both are read when READY is sent, not at launch.
  it('reads the layout direction and the font scale live, when each READY is sent', () => {
    jest.replaceProperty(I18nManager, 'isRTL', false);
    const fontScale = jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(1);
    const h = setup(STEPPED);
    h.layout();
    h.tick(1);
    jest.replaceProperty(I18nManager, 'isRTL', true);
    fontScale.mockReturnValue(1.6);
    h.tick(1);
    expect(h.of('READY')[0]).toMatchObject({ seq: 0, isRTL: true, fontScale: 1.6 });
    fontScale.mockReturnValue(0.85);
    h.command({ seq: '1', cmd: 'step' });
    h.tick(2);
    expect(h.of('READY')[1]).toMatchObject({ seq: 1, isRTL: true, fontScale: 0.85 });
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

// UI-232 (RA-42): a shader compile error can be thousands of characters, and a READY over MAX_LINE_BYTES cannot be sent
// (logcat would truncate it): READY carries the reason cut to 300 characters, the last an ellipsis, and is still sent.
describe('a long surface reason (UI-232)', () => {
  const sceneReporting = (reason: string): Record<string, Scene> => {
    const Reporting = () => {
      const report = React.useContext(ShaderReportContext);
      React.useLayoutEffect(() => { report?.({ status: 'fallback', reason }); }, [report]);
      return <Probe id="stage"><Text>x</Text></Probe>;
    };
    return { smoke: { periodMs: 6000, probes: ['stage'], Component: Reporting } };
  };
  const readyReason = (reason: string) => {
    const h = setup(FIXED, { scenes: sceneReporting(reason) });
    h.layout();
    h.tick(2);
    expect(h.of('ERROR')).toEqual([]);
    expect(h.of('READY')).toHaveLength(1);
    return h.of('READY')[0].shaderReason as string;
  };
  // Each character distinct from its neighbours, so a cut at the wrong place shows.
  const text = (n: number) => Array.from({ length: n }, (_, i) => String.fromCharCode(97 + (i % 26))).join('');

  it('a 5000-character reason is cut to exactly 300, ending in an ellipsis; READY is sent and no ERROR', () => {
    const long = text(5000);
    const said = readyReason(long);
    expect(said).toHaveLength(300);
    expect(said.endsWith('…')).toBe(true);
    expect(said).toBe(`${long.slice(0, 299)}…`);
  });

  it('at the boundary: 300 characters are kept whole, 301 are cut to 300', () => {
    expect(readyReason(text(300))).toBe(text(300));
    expect(readyReason(text(301))).toBe(`${text(299)}…`);
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

// B8-3: a bench's RESULT reaches logcat only through LabRoot (a scene has no path to emit). The cost scene hands its
// body to CostReportContext; LabRoot adds the run and the seq, formats it through formatCostResult and emits it, never
// before the READY of its run: a body that arrives first is held and sent right after that READY, so it is never lost
// and never read by the harness as a run that had not settled. After an ERROR nothing is sent; a body that the
// contract refuses is one ERROR.
describe('a bench RESULT (B8-3)', () => {
  const COST = 'cost.abyss.dark.test';
  const COST_RUN = { labArgs: { run: 'r5', scene: COST, clock: 'fixed', t: '0', frames: '2' }, nonStringKeys: [], powerSave: false };
  const BODY = {
    kind: 'cost', scene: COST, frames: 120, displayHz: 60,
    stepUs: { p50: 10, p95: 20, max: 30 }, renderUs: { p50: 40, p95: 50, max: 60 }, gpuProxyUs: { p50: 70, p95: 80, max: 90 },
    clock: 'performance.now',
  } as const;
  const benchScene = () => {
    const sink: { current: CostReport | null } = { current: null };
    const Bench = () => {
      sink.current = React.useContext(CostReportContext);
      return <Probe id="stage"><Text>x</Text></Probe>;
    };
    const scenes: Record<string, Scene> = { [COST]: { periodMs: 6000, probes: ['stage'], Component: Bench } };
    return { sink, scenes };
  };
  const kinds = (lines: string[]) => lines.map((l) => l.split(' ')[1]);

  it('a body that arrives before READY is held, and sent once right after that READY, with the run and the seq', () => {
    const { sink, scenes } = benchScene();
    const h = setup(COST_RUN, { scenes });
    expect(sink.current).not.toBeNull();
    act(() => sink.current!.result(BODY));
    expect(h.lines).toEqual([]);
    h.layout();
    h.tick(1);
    expect(h.lines).toEqual([]);
    h.tick(1);
    expect(kinds(h.lines)).toEqual(['READY', 'RESULT']);
    expect(h.of('RESULT')).toEqual([{ run: 'r5', seq: 0, ...BODY }]);
    h.tick(10);
    expect(kinds(h.lines)).toEqual(['READY', 'RESULT']);
  });

  it('a body that arrives after READY is sent at once, once', () => {
    const { sink, scenes } = benchScene();
    const h = setup(COST_RUN, { scenes });
    h.layout();
    h.tick(2);
    expect(kinds(h.lines)).toEqual(['READY']);
    act(() => sink.current!.result(BODY));
    expect(kinds(h.lines)).toEqual(['READY', 'RESULT']);
    expect(h.of('RESULT')).toEqual([{ run: 'r5', seq: 0, ...BODY }]);
  });

  it('the bench\'s error is one ERROR, and nothing follows it: no READY, no RESULT', () => {
    const { sink, scenes } = benchScene();
    const h = setup(COST_RUN, { scenes });
    act(() => sink.current!.error('no offscreen surface'));
    act(() => sink.current!.result(BODY));
    h.layout();
    h.tick(10);
    act(() => sink.current!.result(BODY));
    expect(h.of('ERROR')).toEqual([{ run: 'r5', errors: ['no offscreen surface'] }]);
    expect(kinds(h.lines)).toEqual(['ERROR']);
  });

  it('a body held before READY is never sent once an ERROR came first', () => {
    const { sink, scenes } = benchScene();
    const h = setup(COST_RUN, { scenes });
    act(() => sink.current!.result(BODY));
    act(() => sink.current!.error('the effect cannot draw'));
    h.layout();
    h.tick(10);
    expect(kinds(h.lines)).toEqual(['ERROR']);
  });

  it('after READY, an ERROR ends the run: a later body is not sent', () => {
    const { sink, scenes } = benchScene();
    const h = setup(COST_RUN, { scenes });
    h.layout();
    h.tick(2);
    act(() => sink.current!.error('a builder throw'));
    act(() => sink.current!.result(BODY));
    expect(kinds(h.lines)).toEqual(['READY', 'ERROR']);
  });

  it.each([
    ['quantiles out of order', { ...BODY, stepUs: { p50: 30, p95: 20, max: 10 } }, /stepUs must have p50 <= p95 <= max/],
    ['a key the contract does not name (a tap would ride along)', { ...BODY, tapX: 12 }, /"tapX" is not a RESULT key/],
    ['a scene that is not a cost scene', { ...BODY, scene: 'field.abyss.dark.three.full' }, /is not a cost scene/],
  ])('a body the contract refuses (%s) is one ERROR, never a RESULT, and ends the run', (_label, body, why) => {
    const { sink, scenes } = benchScene();
    const h = setup(COST_RUN, { scenes });
    act(() => sink.current!.result(body as never));
    h.layout();
    h.tick(10);
    act(() => sink.current!.result(BODY));
    expect(kinds(h.lines)).toEqual(['ERROR']);
    expect(h.of('ERROR')).toEqual([{ run: 'r5', errors: [expect.stringMatching(why)] }]);
  });

  it('the run and the seq are the lab\'s: a body that names its own never sends the RESULT under another run or step', () => {
    const { sink, scenes } = benchScene();
    const h = setup(COST_RUN, { scenes });
    h.layout();
    h.tick(2);
    act(() => sink.current!.result({ ...BODY, run: 'other', seq: 7 } as never));
    expect(h.of('RESULT')).toEqual([{ run: 'r5', seq: 0, ...BODY }]);
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
