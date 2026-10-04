/// <reference types="node" />
import { checkReady, classifyProbes, commandArgs, launchArgs, parseLabLine, waitForLab } from '../lib/protocol.mjs';

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
  const ready = { run: 'r', seq: 0, scene: 'smoke', sentinel: 'S', probes: { stage: {}, mark: {} } };

  it('passes the READY of the lab that was built', () => {
    expect(checkReady(ready, { sentinel: 'S', scene: 'smoke', probes: ['stage', 'mark'] })).toEqual([]);
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
