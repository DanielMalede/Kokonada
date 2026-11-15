/// <reference types="node" />
import { checkReady, checkResult, classifyProbes, collectLab, commandArgs, launchArgs, markArgs, parseLabLine, waitForLab } from '../lib/protocol.mjs';

// OPS-100. The harness side of the lab protocol (src/design/lab/protocol.ts is the lab side). The
// harness reads logcat, waits for THIS launch's READY, and fails closed on everything else: an
// ERROR, an IGNORED command, a line it cannot read, or silence past the timeout. A READY from a
// previous launch (another run id) is not this one, and is skipped.

const LINE = (kind: string, payload: unknown) => `10-04 12:00:00.000  1234  5678 I ReactNativeJS: KOKONADA_LAB ${kind} ${JSON.stringify(payload)}`;

function lines() {
  const listeners = new Set<(l: string) => void>();
  return {
    on(fn: (l: string) => void) { listeners.add(fn); return () => listeners.delete(fn); },
    push(l: string) { for (const fn of [...listeners]) fn(l); },
    count: () => listeners.size,
  };
}

describe('parseLabLine', () => {
  it('finds a lab line inside any logcat format, and nothing in other lines', () => {
    expect(parseLabLine(LINE('READY', { run: 'r', seq: 0 }))).toEqual({ kind: 'READY', payload: { run: 'r', seq: 0 } });
    expect(parseLabLine('KOKONADA_LAB ERROR {"run":null,"errors":["x"]}')).toEqual({ kind: 'ERROR', payload: { run: null, errors: ['x'] } });
    expect(parseLabLine('I ReactNativeJS: something else')).toBeNull();
  });

  it('reports a lab line it cannot read (logcat truncates long lines) instead of skipping it', () => {
    expect(parseLabLine('KOKONADA_LAB READY {"run":"r","pro')).toEqual({ kind: 'MALFORMED', payload: null, text: 'KOKONADA_LAB READY {"run":"r","pro' });
  });
});

describe('waitForLab', () => {
  it('resolves with the READY of this run and this step, skipping a stale run and an older step', async () => {
    const src = lines();
    const wait = waitForLab({ source: src, run: 'r2', seq: 1, timeoutMs: 1000 });
    src.push(LINE('READY', { run: 'r1', seq: 1 }));
    src.push(LINE('READY', { run: 'r2', seq: 0 }));
    src.push(LINE('READY', { run: 'r2', seq: 1, t: 250 }));
    await expect(wait).resolves.toEqual({ run: 'r2', seq: 1, t: 250 });
    expect(src.count()).toBe(0); // it stops listening
  });

  it('fails on an ERROR for this run', async () => {
    const src = lines();
    const wait = waitForLab({ source: src, run: 'r', seq: 0, timeoutMs: 1000 });
    src.push(LINE('ERROR', { run: 'r', errors: ['scene "x" is not a lab scene'] }));
    await expect(wait).rejects.toThrow(/refused.*scene "x"/);
    expect(src.count()).toBe(0);
  });

  it('fails on an ERROR that names no run (the arguments were refused before the run id was read)', async () => {
    const src = lines();
    const wait = waitForLab({ source: src, run: 'r', seq: 0, timeoutMs: 1000 });
    src.push(LINE('ERROR', { run: null, errors: ['run is required'] }));
    await expect(wait).rejects.toThrow(/run is required/);
  });

  it('fails when the command it waits for is IGNORED', async () => {
    const src = lines();
    const wait = waitForLab({ source: src, run: 'r', seq: 3, timeoutMs: 1000 });
    src.push(LINE('IGNORED', { run: 'r', seq: 3, reason: 'out-of-order' }));
    await expect(wait).rejects.toThrow(/ignored command 3: out-of-order/);
  });

  it('fails on a lab line it cannot read', async () => {
    const src = lines();
    const wait = waitForLab({ source: src, run: 'r', seq: 0, timeoutMs: 1000 });
    src.push('KOKONADA_LAB READY {"run":"r",');
    await expect(wait).rejects.toThrow(/cannot read/);
  });

  it('fails when no READY comes within the timeout, and stops listening', async () => {
    const src = lines();
    await expect(waitForLab({ source: src, run: 'r', seq: 0, timeoutMs: 30 })).rejects.toThrow(/no READY .* 30 ms/);
    expect(src.count()).toBe(0);
  });

  it('fails at once when interrupted (Ctrl-C), and stops listening, so the restore can run', async () => {
    const src = lines();
    const controller = new AbortController();
    const wait = waitForLab({ source: src, run: 'r', seq: 0, timeoutMs: 60000, signal: controller.signal });
    controller.abort();
    await expect(wait).rejects.toThrow(/interrupted/);
    expect(src.count()).toBe(0);
    const already = waitForLab({ source: src, run: 'r', seq: 0, timeoutMs: 60000, signal: controller.signal });
    await expect(already).rejects.toThrow(/interrupted/);
    expect(src.count()).toBe(0);
  });

  it('fails when READY skips past the step it waits for', async () => {
    const src = lines();
    const wait = waitForLab({ source: src, run: 'r', seq: 1, timeoutMs: 1000 });
    src.push(LINE('READY', { run: 'r', seq: 2 }));
    await expect(wait).rejects.toThrow(/seq 2.*expected 1/);
  });
});

describe('checkReady', () => {
  const ready = { run: 'r', seq: 0, scene: 'smoke', sentinel: 'S', isRTL: true, fontScale: 1, probes: { stage: {}, mark: {} } };

  it('passes the READY of the lab that was built', () => {
    expect(checkReady(ready, { sentinel: 'S', scene: 'smoke', probes: ['stage', 'mark'] })).toEqual([]);
  });

  it('fails a READY for another step than the one sent (READY.seq)', () => {
    expect(checkReady({ ...ready, seq: 1 }, { sentinel: 'S', scene: 'smoke', probes: [], seq: 0 }).join()).toMatch(/seq 1.*sent 0/);
    expect(checkReady(ready, { sentinel: 'S', scene: 'smoke', probes: [], seq: 0 })).toEqual([]);
  });

  it('fails a READY that is not right to left: every device capture is RTL (F-13), and only the app knows its direction', () => {
    expect(checkReady({ ...ready, isRTL: false }, { sentinel: 'S', scene: 'smoke', probes: [] }).join()).toMatch(/isRTL false.*right to left/);
    expect(checkReady({ ...ready, isRTL: undefined }, { sentinel: 'S', scene: 'smoke', probes: [] }).join()).toMatch(/isRTL undefined/);
  });

  it('fails a READY whose font scale is more than 0.01 from the scale the harness set (the setting did not take effect)', () => {
    const at = (fontScale: unknown) => checkReady({ ...ready, fontScale }, { sentinel: 'S', scene: 'smoke', probes: [], fontScale: 1.3 });
    expect(at(1.3)).toEqual([]);
    expect(at(1.31)).toEqual([]); // 0.01 away, which binary floating point makes a hair more
    expect(at(1.29)).toEqual([]);
    expect(at(1.32).join()).toMatch(/font scale 1\.32 .*1\.3\b/);
    expect(at(0.8).join()).toMatch(/font scale 0\.8 /);
    expect(at(undefined).join()).toMatch(/font scale undefined/);
    expect(at('1.3').join()).toMatch(/font scale "1\.3"/);
  });

  it('fails another build (sentinel), another scene, or a missing probe', () => {
    expect(checkReady({ ...ready, sentinel: 'OLD' }, { sentinel: 'S', scene: 'smoke', probes: [] }).join()).toMatch(/sentinel/);
    expect(checkReady(ready, { sentinel: 'S', scene: 'hero', probes: [] }).join()).toMatch(/scene/);
    expect(checkReady(ready, { sentinel: 'S', scene: 'smoke', probes: ['stage', 'plate'] }).join()).toMatch(/plate/);
  });
});

describe('classifyProbes (QA-038)', () => {
  const screen = { width: 100, height: 200 };
  const app = { x: 0, y: 10, width: 100, height: 180 };
  const px = (x: number, y: number, width: number, height: number) => ({ dp: { x, y, width, height }, px: { x, y, width, height } });

  it('keeps a probe fully inside the app region, as whole pixels covering it', () => {
    const r = classifyProbes({ mark: px(10.5, 20.25, 30, 40) }, screen, app);
    expect(r.inside).toEqual({ mark: { x: 10, y: 20, width: 31, height: 41 } });
    expect(r.excluded).toEqual([]);
  });

  it('excludes and reports a planted probe that lies partly outside the screen', () => {
    const r = classifyProbes({ mark: px(10, 20, 30, 40), planted: px(90, 50, 20, 20) }, screen, app);
    expect(Object.keys(r.inside)).toEqual(['mark']);
    expect(r.excluded).toEqual([{ id: 'planted', reason: 'partly outside the screen', px: { x: 90, y: 50, width: 20, height: 20 } }]);
  });

  it('excludes and reports a probe under the system bars, and one with no size', () => {
    const r = classifyProbes({ stage: px(0, 0, 100, 200), dot: px(5, 50, 0, 0) }, screen, app);
    expect(r.excluded.map((e: { id: string; reason: string }) => [e.id, e.reason])).toEqual([
      ['stage', 'partly under the system bars'],
      ['dot', 'no size'],
    ]);
  });
});

describe('the adb arguments the harness sends', () => {
  it('launches the lab activity fresh (-S), waiting for it (-W), with every argument as a string extra', () => {
    expect(launchArgs({ package: 'com.example.lab', activity: 'com.example.lab.A' }, 'r1', { scene: 'smoke', clock: 'fixed', t: '1500' }))
      .toEqual(['shell', 'am', 'start', '-W', '-S', '-n', 'com.example.lab/com.example.lab.A',
        '--es', 'run', 'r1', '--es', 'scene', 'smoke', '--es', 'clock', 'fixed', '--es', 't', '1500']);
  });

  it('sends a numbered step to the running activity, without restarting it', () => {
    expect(commandArgs({ package: 'p', activity: 'p.A' }, 2, 4))
      .toEqual(['shell', 'am', 'start', '-n', 'p/p.A', '--es', 'seq', '2', '--es', 'cmd', 'step', '--es', 'steps', '4']);
  });

  it('refuses any value the device shell could read as more than one word', () => {
    expect(() => launchArgs({ package: 'p', activity: 'p.A' }, 'r1', { scene: 'smoke; reboot' })).toThrow(/shell/);
    expect(() => launchArgs({ package: 'p', activity: 'p.A' }, 'r 1', {})).toThrow(/shell/);
  });
});

// B8-5a: the RESULT line (the plan's contract: `KOKONADA_LAB RESULT {"run","seq","kind":"cost","scene","frames","displayHz",
// "stepUs":{p50,p95,max},"renderUs":{…},"gpuProxyUs":{…},"clock":"performance.now"}`) and the lab lines that come AFTER
// READY (UI-225): a fallback that lands after READY sends an ERROR the harness used to miss, because waitForLab had resolved.
const STATS = { p50: 410, p95: 980, max: 2400 };
const RESULT = {
  run: 'r', seq: 0, kind: 'cost', scene: 'cost.abyss.dark.three.full', frames: 1200, displayHz: 120,
  stepUs: STATS, renderUs: { p50: 120, p95: 300, max: 900 }, gpuProxyUs: { p50: 2000, p95: 2600, max: 4100 }, clock: 'performance.now',
};

describe('the RESULT line', () => {
  it('is a lab line of its own kind', () => {
    expect(parseLabLine(LINE('RESULT', RESULT))).toEqual({ kind: 'RESULT', payload: RESULT });
    expect(parseLabLine('KOKONADA_LAB RESULT {"run":"r",')).toMatchObject({ kind: 'MALFORMED' });
  });

  it('never stands for READY, even for the same run and step', async () => {
    const src = lines();
    const wait = waitForLab({ source: src, run: 'r', seq: 0, timeoutMs: 1000 });
    src.push(LINE('RESULT', RESULT));
    src.push(LINE('READY', { run: 'r', seq: 0, t: 1 }));
    await expect(wait).resolves.toEqual({ run: 'r', seq: 0, t: 1 });
  });

  it('a valid RESULT for this run, step and scene has no problem', () => {
    expect(checkResult(RESULT, { run: 'r', seq: 0, scene: 'cost.abyss.dark.three.full' })).toEqual([]);
  });

  it.each([
    ['another run', { ...RESULT, run: 'old' }, /RESULT is for run old/],
    ['another step', { ...RESULT, seq: 1 }, /RESULT is for seq 1/],
    ['another scene', { ...RESULT, scene: 'cost.abyss.dark.rest.full' }, /RESULT is for scene cost\.abyss\.dark\.rest\.full/],
    ['a kind the harness does not read', { ...RESULT, kind: 'motion' }, /kind must be "cost"/],
    ['a clock other than performance.now (never a Date fallback)', { ...RESULT, clock: 'Date.now' }, /clock must be "performance\.now"/],
    ['no frames', { ...RESULT, frames: 0 }, /frames must be an integer >= 1/],
    ['a display rate that is not a rate', { ...RESULT, displayHz: -1 }, /displayHz must be a finite number > 0/],
    ['a missing statistic', { ...RESULT, renderUs: { p50: 1, p95: 2 } }, /renderUs\.max is required/],
    ['a negative time', { ...RESULT, stepUs: { ...STATS, p50: -1 } }, /stepUs\.p50 must be a finite number >= 0/],
    ['quantiles out of order', { ...RESULT, gpuProxyUs: { p50: 5, p95: 4, max: 9 } }, /gpuProxyUs must hold p50 <= p95 <= max/],
    ['a key the contract does not name (a tap coordinate)', { ...RESULT, taps: [[0.1, 0.2]] }, /taps is not a RESULT field/],
    ['a statistic with a key the contract does not name', { ...RESULT, stepUs: { ...STATS, mean: 3 } }, /stepUs\.mean is not a RESULT field/],
    ['a missing gpu proxy', (() => { const r: Record<string, unknown> = { ...RESULT }; delete r.gpuProxyUs; return r; })(), /gpuProxyUs is required/],
  ])('refuses a RESULT with %s', (_label, payload, why) => {
    expect(checkResult(payload, { run: 'r', seq: 0, scene: 'cost.abyss.dark.three.full' }).join('\n')).toMatch(why);
  });

  it('refuses a RESULT that is not an object', () => {
    expect(checkResult(null, { run: 'r', seq: 0, scene: 's' })).toEqual(['RESULT must be an object']);
    expect(checkResult([1], { run: 'r', seq: 0, scene: 's' })).toEqual(['RESULT must be an object']);
  });
});

describe('collectLab: every lab line of a run, after READY too (UI-225)', () => {
  it('holds an ERROR for this run that came after READY, and one that names no run', () => {
    const src = lines();
    const c = collectLab({ source: src, run: 'r' });
    src.push(LINE('READY', { run: 'r', seq: 0 }));
    expect(c.problems()).toEqual([]);
    src.push(LINE('ERROR', { run: 'r', errors: ['the surface changed after READY: READY said ready, now fallback'] }));
    src.push(LINE('ERROR', { run: null, errors: ['run is required'] }));
    expect(c.problems()).toEqual([
      'the lab sent an ERROR for run r: the surface changed after READY: READY said ready, now fallback',
      'the lab sent an ERROR for run r: run is required',
    ]);
  });

  it('ignores another run\'s lines, and a line that is not the lab\'s', () => {
    const src = lines();
    const c = collectLab({ source: src, run: 'r' });
    src.push(LINE('ERROR', { run: 'old', errors: ['x'] }));
    src.push(LINE('RESULT', { ...RESULT, run: 'old' }));
    src.push('I ReactNativeJS: hello');
    expect(c.problems()).toEqual([]);
    expect(c.results()).toEqual([]);
  });

  it('holds a lab line it cannot read as a problem: it could have been an ERROR', () => {
    const src = lines();
    const c = collectLab({ source: src, run: 'r' });
    src.push('KOKONADA_LAB ERROR {"run":"r","err');
    expect(c.problems()).toEqual(['cannot read a lab line (logcat truncates long lines): KOKONADA_LAB ERROR {"run":"r","err']);
  });

  it('keeps this run\'s RESULTs, before or after READY, and resolves the next one', async () => {
    const src = lines();
    const c = collectLab({ source: src, run: 'r' });
    src.push(LINE('RESULT', RESULT));
    expect(c.results()).toEqual([RESULT]);
    await expect(c.nextResult({ timeoutMs: 1000 })).resolves.toEqual(RESULT);
    const later = c.nextResult({ timeoutMs: 1000 });
    const second = { ...RESULT, frames: 99 };
    src.push(LINE('RESULT', second));
    await expect(later).resolves.toEqual(second);
  });

  it('a RESULT that does not come in time fails, and so does an interruption', async () => {
    const src = lines();
    const c = collectLab({ source: src, run: 'r' });
    await expect(c.nextResult({ timeoutMs: 20 })).rejects.toThrow(/no RESULT for run r within 20 ms/);
    const controller = new AbortController();
    const wait = c.nextResult({ timeoutMs: 60000, signal: controller.signal });
    controller.abort();
    await expect(wait).rejects.toThrow(/interrupted/);
  });

  it('an ERROR while it waits for a RESULT fails at once', async () => {
    const src = lines();
    const c = collectLab({ source: src, run: 'r' });
    const wait = c.nextResult({ timeoutMs: 60000 });
    src.push(LINE('ERROR', { run: 'r', errors: ['the UI runtime has no performance.now'] }));
    await expect(wait).rejects.toThrow(/ERROR for run r: the UI runtime has no performance\.now/);
  });

  // The harness's own marker (adb shell log -t ReactNativeJS KOKONADA_HARNESS MARK <token>) goes through the same buffer:
  // once it is back, every lab line logged before it has been delivered.
  it('a marker resolves once it is back, after the lines logged before it', async () => {
    const src = lines();
    const c = collectLab({ source: src, run: 'r' });
    const marked = c.marked('r-m1', { timeoutMs: 1000 });
    src.push(LINE('ERROR', { run: 'r', errors: ['late'] }));
    src.push('KOKONADA_HARNESS MARK r-other');
    src.push('KOKONADA_HARNESS MARK r-m1');
    await expect(marked).resolves.toBeUndefined();
    expect(c.problems()).toEqual(['the lab sent an ERROR for run r: late']);
  });

  it('a marker already back resolves at once; one that never comes fails, and so does an interruption', async () => {
    const src = lines();
    const c = collectLab({ source: src, run: 'r' });
    src.push('KOKONADA_HARNESS MARK early');
    await expect(c.marked('early', { timeoutMs: 1000 })).resolves.toBeUndefined();
    await expect(c.marked('lost', { timeoutMs: 20 })).rejects.toThrow(/the harness's logcat marker did not come back within 20 ms/);
    const controller = new AbortController();
    const wait = c.marked('never', { timeoutMs: 60000, signal: controller.signal });
    controller.abort();
    await expect(wait).rejects.toThrow(/interrupted/);
  });

  it('a marker is a whole token: a longer one does not stand for it', async () => {
    const src = lines();
    const c = collectLab({ source: src, run: 'r' });
    const marked = c.marked('m1', { timeoutMs: 30 });
    src.push('KOKONADA_HARNESS MARK m10');
    await expect(marked).rejects.toThrow(/did not come back/);
  });

  it('builds the marker command as plain words for the device shell', () => {
    expect(markArgs('f-1-abc')).toEqual(['log', '-t', 'ReactNativeJS', 'KOKONADA_HARNESS', 'MARK', 'f-1-abc']);
    expect(() => markArgs('f 1; reboot')).toThrow(/shell/);
  });

  it('stops listening', () => {
    const src = lines();
    const c = collectLab({ source: src, run: 'r' });
    expect(src.count()).toBe(1);
    c.stop();
    expect(src.count()).toBe(0);
    src.push(LINE('ERROR', { run: 'r', errors: ['late'] }));
    expect(c.problems()).toEqual([]);
  });
});
