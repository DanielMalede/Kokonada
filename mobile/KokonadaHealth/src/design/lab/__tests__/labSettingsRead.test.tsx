/// <reference types="node" />
import React from 'react';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { View } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
// SCENES reaches FieldView, whose fieldImage.tsx reads Skia's FilterMode on load (__fixtures__/skiaHeadless.ts).
jest.mock('@shopify/react-native-skia', () => require('./__fixtures__/skiaHeadless').skiaHeadless());
jest.mock('../../v2/field/effect.ts', () => ({ fieldEffect: () => ({ status: 'ready', effect: { name: 'effect' }, blueNoise: {}, blueNoiseShader: { name: 'noise' } }) }));
// The field clock is a recorder: whether LabRoot starts the real-time clock is the subject (LabRootMotion.test.tsx).
const mockClockCalls: Array<{ periodMs: number; active: boolean }> = [];
jest.mock('../../v2/clock/fieldClock', () => ({
  useRealtimeFieldClock: (periodMs: number, active: boolean) => {
    mockClockCalls.push({ periodMs, active });
    return { t: { value: 0 } };
  },
}));

// UI-241, the two findings of the first pass:
//   (1) LabRoot reads reduced motion to start the real-time clock, and swallowed a refused read: the clock never started,
//       READY still came, and a moving shot failed later as "0 frames", by no name. A refused read on a real-time launch
//       is now one ERROR naming the setting. A fixed or stepped launch does not use the clock, so a refusal is nothing
//       to it (a policy scene names it itself, policyScenes.test.tsx).
//   (2) A read that never settles held READY in silence until the harness's READY timeout. Every setting read the lab
//       makes (the clock's, and the motion policy's ports) now has a deadline, SETTING_READ_DEADLINE_MS, after which it
//       is refused with "no answer within … ms": the same named ERROR. The deadline is at most half of every plan's
//       readyTimeoutMs, so the ERROR reaches the harness while it is still waiting.
import { LabRoot } from '../LabRoot';
import { SETTING_READ_DEADLINE_MS } from '../settingRead';

/** The OS's reduced-motion setting: a read that answers or refuses when the test says, never by itself, and change events. */
function device() {
  const emitter = new EventEmitter();
  let answer!: (on: boolean) => void;
  let refuse!: (e: Error) => void;
  const read = new Promise<boolean>((r, j) => { answer = r; refuse = j; });
  read.catch(() => {});
  return {
    source: {
      current: () => read,
      subscribe: (fn: (on: boolean) => void) => { emitter.on('change', fn); return () => { emitter.off('change', fn); }; },
    },
    answer: (on: boolean) => act(async () => { answer(on); await read; }),
    refuse: (message: string) => act(async () => { refuse(new Error(message)); await read.catch(() => {}); }),
    change: (on: boolean) => act(async () => { emitter.emit('change', on); }),
  };
}

function mount(scene: string, clock: 'realtime' | 'fixed', rm: ReturnType<typeof device>) {
  const lines: string[] = [];
  const queue: Array<() => void> = [];
  const frames = { next: (cb: () => void) => { queue.push(cb); return () => { const i = queue.indexOf(cb); if (i >= 0) queue.splice(i, 1); }; } };
  jest.spyOn(View.prototype as never as { measureInWindow(cb: unknown): void }, 'measureInWindow')
    .mockImplementation((cb: unknown) => (cb as (...v: number[]) => void)(0, 0, 400, 800));
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <LabRoot
        labArgs={{ run: 'r', scene, clock, frames: '3', ...(clock === 'fixed' ? { t: '0' } : {}) }}
        nonStringKeys={[]}
        deps={{ emit: (l) => lines.push(l), frames, events: { addListener: () => ({ remove: () => {} }) }, reduceMotion: rm.source }}
      />,
    );
  });
  const of = (kind: string) => lines.filter((l) => l.startsWith(`KOKONADA_LAB ${kind} `)).map((l) => JSON.parse(l.slice(`KOKONADA_LAB ${kind} `.length)));
  /** Lay out every measured view, measure every probe and draw READY's frames. */
  const draw = () => {
    for (const v of tree.root.findAll((n) => typeof n.type !== 'string' && typeof n.props.testID === 'string' && n.props.testID.endsWith('scene.view') && typeof n.props.onLayout === 'function')) {
      act(() => v.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 800 } } }));
    }
    act(() => { for (const p of tree.root.findAll((n) => typeof n.type === 'string' && String(n.props.nativeID ?? '').startsWith('probe-'))) p.props.onLayout({ nativeEvent: { layout: {} } }); });
    for (let i = 0; i < 5; i += 1) act(() => { queue.splice(0).forEach((cb) => cb()); });
  };
  const wait = (ms: number) => act(async () => { jest.advanceTimersByTime(ms); await Promise.resolve(); });
  return { tree, of, draw, wait };
}

/** The deadline timers LabRoot set, and whether each was cleared (spied after jest.useFakeTimers). */
function deadlineTimers() {
  const set = jest.spyOn(global, 'setTimeout');
  const clear = jest.spyOn(global, 'clearTimeout');
  return () => {
    const ids = set.mock.calls.map((c, i) => [c[1], set.mock.results[i].value] as const).filter(([ms]) => ms === SETTING_READ_DEADLINE_MS).map(([, id]) => id);
    const cleared = new Set(clear.mock.calls.map((c) => c[0]));
    return { set: ids.length, pending: ids.filter((id) => !cleared.has(id)).length };
  };
}
const lastActive = () => mockClockCalls[mockClockCalls.length - 1].active;
const NAMED = (why: string) => `the real-time clock cannot start: the device's reduced-motion setting could not be read (${why})`;

beforeEach(() => { mockClockCalls.length = 0; });
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('(1) a refused reduced-motion read on a real-time launch is one named ERROR', () => {
  it('the ERROR names the setting and the reason, the clock never starts, and no READY follows', async () => {
    const rm = device();
    const h = mount('smoke', 'realtime', rm);
    await rm.refuse('Settings.Global unavailable');
    h.draw();
    expect(h.of('ERROR')).toEqual([{ run: 'r', errors: [NAMED('Settings.Global unavailable')] }]);
    expect(h.of('READY')).toEqual([]);
    expect(lastActive()).toBe(false);
  });

  it('a refusal after a change event answered the setting is ignored: the clock runs and READY comes', async () => {
    const rm = device();
    const h = mount('smoke', 'realtime', rm);
    await rm.change(false);
    await rm.refuse('late');
    h.draw();
    expect([h.of('ERROR'), h.of('READY').length, lastActive()]).toEqual([[], 1, true]);
  });

  it('a fixed launch does not use the clock: a refusal is nothing to it', async () => {
    const rm = device();
    const h = mount('smoke', 'fixed', rm);
    await rm.refuse('unavailable');
    h.draw();
    expect([h.of('ERROR'), h.of('READY').length]).toEqual([[], 1]);
  });
});

describe('(2) a setting read that never settles is refused at SETTING_READ_DEADLINE_MS, by name', () => {
  beforeEach(() => { jest.useFakeTimers(); });

  it('the deadline is at most half of every capture plan\'s readyTimeoutMs, and well above a settings read', () => {
    const dir = path.resolve(__dirname, '../../../../scripts/lab/capture-plans');
    const plans = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as { readyTimeoutMs?: number })
      .filter((p) => p.readyTimeoutMs !== undefined);
    expect(plans.length).toBeGreaterThan(0);
    for (const p of plans) expect(2 * SETTING_READ_DEADLINE_MS).toBeLessThanOrEqual(p.readyTimeoutMs as number);
    expect(SETTING_READ_DEADLINE_MS).toBeGreaterThanOrEqual(5000);
  });

  it('a real-time launch: nothing before the deadline, the named ERROR at it', async () => {
    const rm = device();
    const h = mount('smoke', 'realtime', rm);
    h.draw();
    await h.wait(SETTING_READ_DEADLINE_MS - 1);
    expect(h.of('ERROR')).toEqual([]);
    await h.wait(1);
    expect(h.of('ERROR')).toEqual([{ run: 'r', errors: [NAMED(`no answer within ${SETTING_READ_DEADLINE_MS} ms`)] }]);
    await rm.answer(false); // too late: the harness already has the ERROR
    expect(h.of('ERROR')).toHaveLength(1);
  });

  it('a read that answers in time: no ERROR long after, the clock runs, and no deadline timer is left', async () => {
    const timers = deadlineTimers();
    const rm = device();
    const h = mount('smoke', 'realtime', rm);
    await rm.answer(false);
    expect(timers()).toEqual({ set: 1, pending: 0 });
    await h.wait(5 * SETTING_READ_DEADLINE_MS);
    h.draw();
    expect([h.of('ERROR'), h.of('READY').length, lastActive()]).toEqual([[], 1, true]);
  });

  it('a policy scene on a fixed clock: the policy\'s read never settles, so the scene names the setting at the deadline', async () => {
    const rm = device();
    const h = mount('field.abyss.dark.three.policy', 'fixed', rm);
    h.draw();
    expect(h.of('READY')).toEqual([]);
    await h.wait(SETTING_READ_DEADLINE_MS);
    expect(h.of('ERROR')).toEqual([{ run: 'r', errors: [`the tier cannot be known: the device's reduced-motion setting could not be read (no answer within ${SETTING_READ_DEADLINE_MS} ms)`] }]);
  });

  it('an id-tier scene on a fixed clock asks nothing that matters: no ERROR after the deadline', async () => {
    const rm = device();
    const h = mount('smoke', 'fixed', rm);
    h.draw();
    await h.wait(2 * SETTING_READ_DEADLINE_MS);
    expect([h.of('ERROR'), h.of('READY').length]).toEqual([[], 1]);
  });

  it('unmounting clears every pending deadline', () => {
    const timers = deadlineTimers();
    const rm = device();
    const h = mount('field.abyss.dark.three.policy', 'realtime', rm);
    expect(timers().pending).toBeGreaterThanOrEqual(2); // the clock's read and the policy's
    act(() => h.tree.unmount());
    expect(timers().pending).toBe(0);
  });
});
