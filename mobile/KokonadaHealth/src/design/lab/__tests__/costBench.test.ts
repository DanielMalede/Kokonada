/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';

// B8-3, the fieldCost bench (the architect's B8 plan, fork F2 at A: "a lab bench that calls the EXPORTED fieldStep and
// renderFieldImage"; F3 at A: "GPU time is wall time with a GPU sync (readPixels) around K offscreen renders"). What it
// measures (resilience T5 r1 Q5): UI-thread time per frame of reconcile + fades + buildFieldFrame + packFrame (one
// fieldStep), as p50/p95/max; beside it the render's CPU-side time (one renderFieldImage, no sync) and the GPU proxy.
//
// The clock is the UI runtime's performance.now, and only that: an absent clock is an ERROR, never a Date fallback. Here it
// is a stateful fake that the real fieldStep and renderFieldImage advance by planted costs, wrapped around the exported
// functions themselves, so a timer that brackets the wrong call, or a bench that runs a local copy, reads the wrong
// numbers. Informational only: DEC-082 is open, so no cost number is held to any threshold here.

const clock = { ms: 0 };
const costs = { step: [] as number[], stepAt: 0, render: 1.5, gpuWait: 4 };
const calls = { step: [] as unknown[][], render: 0, reads: 0, disposed: 0, images: 0 };
const plant = { stepError: null as string | null, noSurface: false };

jest.mock('../../v2/field/fieldDriver', () => {
  const actual = jest.requireActual('../../v2/field/fieldDriver');
  return {
    ...actual,
    fieldStep: jest.fn((...args: unknown[]) => {
      calls.step.push(args);
      const out = actual.fieldStep(...args);
      clock.ms += (costs.step.length === 0 ? 0.25 : costs.step[costs.stepAt++ % costs.step.length]);
      return plant.stepError === null ? out : { ...out, uniforms: null, error: plant.stepError };
    }),
  };
});
jest.mock('../../v2/field/fieldImage', () => {
  const actual = jest.requireActual('../../v2/field/fieldImage');
  return {
    ...actual,
    renderFieldImage: jest.fn((...args: unknown[]) => {
      calls.render += 1;
      const out = actual.renderFieldImage(...args);
      clock.ms += costs.render;
      return out;
    }),
  };
});
// The headless stub, with the two enums the GPU sync's pixel names (Skia's own values).
jest.mock('@shopify/react-native-skia', () => ({ ...require('./__fixtures__/skiaHeadless').skiaHeadless(), ColorType: { RGBA_8888: 4 }, AlphaType: { Unpremul: 3 } }));

import { benchBody, benchFrame, benchStart, clockProblem, costBenchConfig, COST_COUNTS, type BenchConfig } from '../cost/costBench';
import { formatCostResult } from '../cost/costResult';
import { COST_SCENE_SPECS } from '../cost/costScenes';
import { stormInput } from '../cost/costStorm';
import { FIELD_STATICS } from '../fieldScenes';
import { MAX_LINE_BYTES } from '../protocol';

// A stateful fake of the part of Skia the render needs: a surface draws a paint, flushes and snapshots; an image reads
// pixels (the GPU sync, which waits gpuWait ms on the fake clock) and is disposed.
function fakeSkia() {
  return {
    Surface: {
      MakeOffscreen(width: number, height: number) {
        if (plant.noSurface) return null;
        const drawn: unknown[] = [];
        return {
          getCanvas: () => ({ drawPaint: (p: { shader: unknown }) => drawn.push(p.shader) }),
          flush() {},
          makeImageSnapshot() {
            calls.images += 1;
            return {
              width: () => width, height: () => height, drawn,
              readPixels() { calls.reads += 1; clock.ms += costs.gpuWait; return new Uint8Array(4); },
              dispose() { calls.disposed += 1; },
            };
          },
        };
      },
    },
    Paint() {
      return { shader: null as unknown, setDither() {}, setShader(s: unknown) { this.shader = s; } };
    },
  };
}
const effect = { makeShaderWithChildren: (u: number[], children: unknown[]) => ({ u, children }) };
const blueNoise = { name: 'noise' };
const COUNTS = { warmup: 2, frames: 10, gpuSamples: 3, gpuRenders: 4 };
const HZ = 120;

const config = (id: string, counts = COUNTS): BenchConfig => costBenchConfig({
  spec: COST_SCENE_SPECS[id], width: 411, height: 914, pxPerDp: 2.625, fontScale: 1,
  skia: fakeSkia() as never, effect: effect as never, blueNoise: blueNoise as never, counts,
});
function run(c: BenchConfig, maxFrames = 10_000, t0 = 1000) {
  const s = benchStart(c);
  const stamps: number[] = [];
  for (let i = 0; i < maxFrames && s.phase !== 'done' && s.phase !== 'error'; i++) {
    const ts = t0 + (i * 1000) / HZ;
    stamps.push(ts);
    benchFrame(s, c, ts);
  }
  return { s, stamps };
}

const IDLE = 'cost.abyss.dark.three.full';
const STORM = 'cost.abyss.dark.three.full.storm';
const realPerformance = globalThis.performance;
let nowSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks(); // the wrapped exports keep their implementations; their calls start again per test
  clock.ms = 0;
  Object.assign(costs, { step: [], stepAt: 0, render: 1.5, gpuWait: 4 });
  Object.assign(calls, { step: [], render: 0, reads: 0, disposed: 0, images: 0 });
  Object.assign(plant, { stepError: null, noSurface: false });
  nowSpy = jest.spyOn(realPerformance, 'now').mockImplementation(() => clock.ms);
});
afterEach(() => {
  nowSpy.mockRestore();
  Object.defineProperty(globalThis, 'performance', { value: realPerformance, configurable: true, writable: true });
});

describe('what each timer brackets', () => {
  it('stepUs is one fieldStep, renderUs one renderFieldImage, gpuProxyUs K renders and one sync over K', () => {
    const { s } = run(config(IDLE));
    expect(s.phase).toBe('done');
    const body = benchBody(s);
    expect(body.stepUs).toEqual({ p50: 250, p95: 250, max: 250 });
    expect(body.renderUs).toEqual({ p50: 1500, p95: 1500, max: 1500 });
    expect(body.gpuProxyUs).toEqual({ p50: 2500, p95: 2500, max: 2500 }); // (4 × 1.5 ms + 4 ms) / 4
  });

  it('the step quantiles are the planted per-frame costs at their nearest rank (warm-up frames not recorded)', () => {
    // Two warm-up frames cost 9 ms each (never recorded), then the ten recorded frames 0.1 .. 1.0 ms.
    costs.step = [9, 9, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
    const body = benchBody(run(config(IDLE)).s);
    expect(body.stepUs).toEqual({ p50: 500, p95: 1000, max: 1000 });
  });

  it('frames is the recorded frame count, displayHz the rate of their timestamps, the clock performance.now', () => {
    const body = benchBody(run(config(IDLE)).s);
    expect(body).toMatchObject({ kind: 'cost', scene: IDLE, frames: COUNTS.frames, displayHz: HZ, clock: 'performance.now' });
  });

  it('the default counts: 60 warm-up frames, 1200 recorded (10 s at 120 Hz), 120 GPU samples of 8 renders', () => {
    expect(COST_COUNTS).toEqual({ warmup: 60, frames: 1200, gpuSamples: 120, gpuRenders: 8 });
  });
});

describe('the bench runs the exported functions (F2), and only them', () => {
  it('fieldStep once per warm-up and recorded frame; renderFieldImage once per such frame and K per GPU sample, the first sample a warm-up', () => {
    const { s } = run(config(IDLE));
    const { warmup, frames, gpuSamples, gpuRenders } = COUNTS;
    expect([s.step.n, s.render.n, s.gpu.n]).toEqual([frames, frames, gpuSamples]); // the warm-ups are run, never recorded
    expect(calls.step).toHaveLength(warmup + frames);
    expect(calls.render).toBe(warmup + frames + (gpuSamples + 1) * gpuRenders);
    expect(calls.reads).toBe(gpuSamples + 1);
    expect(calls.disposed).toBe(calls.images);
  });

  it('fieldStep takes the frame\'s timestamp, the scene\'s params, geometry and statics, and the ledger it returned last', () => {
    const c = config(IDLE);
    const { stamps } = run(c);
    expect(calls.step.map((a) => a[2])).toEqual(stamps.slice(0, calls.step.length));
    for (const a of calls.step) {
      expect(a[3]).toBe(c.params);
      expect(a[4]).toBe(c.geometry);
      expect(a[5]).toBe(FIELD_STATICS);
    }
    const step = jest.requireMock('../../v2/field/fieldDriver').fieldStep as jest.Mock;
    for (let i = 1; i < step.mock.calls.length; i++) expect(step.mock.calls[i][0]).toBe((step.mock.results[i - 1].value as { ledger: unknown }).ledger);
    expect(c.params).toEqual({ direction: 'abyss', face: 'dark', stress: 0, confidence: 1, genesis: false, tier: 'full' });
  });

  it('idle: every frame the scene\'s own taps at seq 0, one input object', () => {
    run(config(IDLE));
    const inputs = calls.step.map((a) => a[1]);
    expect(new Set(inputs).size).toBe(1);
    expect(inputs[0]).toEqual({ seq: 0, taps: COST_SCENE_SPECS[IDLE].taps });
  });

  it('storm: the storm script\'s input at the time since the bench\'s first frame, a new object only when seq moves', () => {
    const counts = { warmup: 2, frames: 300, gpuSamples: 1, gpuRenders: 1 };
    const { stamps } = run(config(STORM, counts));
    const inputs = calls.step.map((a) => a[1] as { seq: number });
    inputs.forEach((input, i) => expect(input).toEqual(stormInput(stamps[i] - stamps[0])));
    for (let i = 1; i < inputs.length; i++) expect(inputs[i] === inputs[i - 1]).toBe(inputs[i].seq === inputs[i - 1].seq);
    expect(inputs[inputs.length - 1].seq).toBeGreaterThanOrEqual(17); // 302 frames at 120 Hz: about 2.5 s, 17 changes
  });

  it('renders the step\'s own packed frame at the scene\'s render size, with the effect and the blue noise it was given', () => {
    const c = config(IDLE);
    const render = jest.requireMock('../../v2/field/fieldImage').renderFieldImage as jest.Mock;
    const step = jest.requireMock('../../v2/field/fieldDriver').fieldStep as jest.Mock;
    run(c);
    const last = render.mock.calls[render.mock.calls.length - 1];
    expect(last[0]).toBe(c.skia);
    expect(last[1]).toBe(effect);
    expect(last[2]).toBe(blueNoise);
    expect([last[4], last[5]]).toEqual([c.size.width, c.size.height]);
    const lastStep = step.mock.results[step.mock.results.length - 1].value as { uniforms: number[] };
    expect(last[3]).toEqual(lastStep.uniforms);
    for (const call of render.mock.calls) expect(call[3]).not.toBeNull();
  });

  // The source pin: a planted local copy of either function fails it (the plan: "a planted local copy fails the pin").
  const SOURCE = fs.readFileSync(path.resolve(__dirname, '../cost/costBench.ts'), 'utf8');
  const COPY_MARKS = [/\bbuildFieldFrame\b/, /\bpackFrame\b/, /\breconcile\b/, /\bfades\(/, /makeShaderWithChildren/, /MakeOffscreen/, /makeImageSnapshot/,
    /function\s+fieldStep\b/, /function\s+renderFieldImage\b/, /(const|let|var)\s+(fieldStep|renderFieldImage)\b/];
  const pinProblems = (source: string): string[] => {
    const problems: string[] = [];
    if (!/import\s*\{[^}]*\bfieldStep\b[^}]*\}\s*from\s*'\.\.\/\.\.\/v2\/field\/fieldDriver(\.ts)?'/.test(source)) problems.push('fieldStep is not imported from fieldDriver');
    if (!/import\s*\{[^}]*\brenderFieldImage\b[^}]*\}\s*from\s*'\.\.\/\.\.\/v2\/field\/fieldImage(\.tsx)?'/.test(source)) problems.push('renderFieldImage is not imported from fieldImage');
    for (const mark of COPY_MARKS) if (mark.test(source)) problems.push(`a local copy: ${mark}`);
    return problems;
  };
  it('costBench.ts imports fieldStep and renderFieldImage and holds no copy of what they do', () => {
    expect(pinProblems(SOURCE)).toEqual([]);
  });
  it.each([
    ['a local fieldStep', "import { renderFieldImage } from '../../v2/field/fieldImage';\nfunction fieldStep(l, i) { return packFrame(buildFieldFrame(reconcile(l, i))); }"],
    ['a local renderFieldImage', "import { fieldStep } from '../../v2/field/fieldDriver';\nconst renderFieldImage = (s) => s.Surface.MakeOffscreen(1, 1).makeImageSnapshot();"],
    ['the import kept, a copy beside it', "import { fieldStep } from '../../v2/field/fieldDriver';\nimport { renderFieldImage } from '../../v2/field/fieldImage';\nconst step = (s) => packFrame(s);"],
  ])('the planted control: %s fails the pin', (_name, planted) => {
    expect(pinProblems(planted).length).toBeGreaterThan(0);
  });
});

describe('the clock: the UI runtime\'s performance.now, never a Date fallback', () => {
  const dateSpy = () => jest.spyOn(Date, 'now');

  it('present: no problem', () => {
    expect(clockProblem()).toBeNull();
  });

  it.each([
    ['performance absent', undefined],
    ['performance.now absent', {}],
    ['performance.now not a function', { now: 5 }],
  ])('%s: the bench is an ERROR on its first frame, records nothing and never reads Date', (_name, value) => {
    const date = dateSpy();
    Object.defineProperty(globalThis, 'performance', { value, configurable: true, writable: true });
    expect(clockProblem()).toMatch(/performance\.now/);
    const c = config(IDLE);
    const s = benchStart(c);
    benchFrame(s, c, 1000);
    expect(s.phase).toBe('error');
    expect(s.error).toMatch(/performance\.now/);
    expect(s.error).toMatch(/never a Date fallback/);
    expect(calls.step).toHaveLength(0);
    expect(() => benchBody(s)).toThrow();
    expect(date).not.toHaveBeenCalled();
    date.mockRestore();
  });

  it('no cost source reads Date (no Date.<x> and no Date() anywhere)', () => {
    const dir = path.resolve(__dirname, '../cost');
    for (const f of fs.readdirSync(dir)) expect(`${f}: ${/\bDate\s*(\.|\()/.test(fs.readFileSync(path.join(dir, f), 'utf8'))}`).toBe(`${f}: false`);
  });

  it('a clock that runs backwards is an ERROR, never a negative duration recorded', () => {
    costs.step = [-0.5];
    const { s } = run(config(IDLE));
    expect(s.phase).toBe('error');
    expect(s.error).toMatch(/RangeError/);
  });
});

describe('what stops the bench', () => {
  it('a builder throw (fieldStep\'s error) is an ERROR naming it', () => {
    plant.stepError = 'RangeError: planted';
    const { s } = run(config(IDLE));
    expect(s.phase).toBe('error');
    expect(s.error).toMatch(/RangeError: planted/);
  });

  it('no offscreen surface is an ERROR', () => {
    plant.noSurface = true;
    const { s } = run(config(IDLE));
    expect(s.phase).toBe('error');
    expect(s.error).toMatch(/offscreen/);
  });

  it('after done or an error, a frame changes nothing', () => {
    const c = config(IDLE);
    const { s } = run(c);
    const before = { ...calls, step: calls.step.length };
    benchFrame(s, c, 99_999);
    expect({ ...calls, step: calls.step.length }).toEqual(before);
    expect(s.phase).toBe('done');
  });

  it('a body before the bench is done is an Error', () => {
    const c = config(IDLE);
    const s = benchStart(c);
    benchFrame(s, c, 1000);
    expect(() => benchBody(s)).toThrow(/not done/);
  });
});

describe('the bench\'s RESULT', () => {
  it('formats as a finite RESULT line of at most 4000 bytes', () => {
    costs.step = [0.1, 0.33, 0.27, 2.9];
    const line = formatCostResult({ run: 'r'.repeat(64), seq: 0, ...benchBody(run(config(STORM)).s) });
    expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(MAX_LINE_BYTES);
    expect(line).not.toMatch(/null|NaN|Infinity/);
  });
});
