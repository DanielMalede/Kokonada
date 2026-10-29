/// <reference types="node" />
import React from 'react';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import ReactTestRenderer, { act } from 'react-test-renderer';
import type { PowerSaveSource, ReduceMotionSource } from '../../v2/motion/ports';
import { useMotionPolicy, type MotionTier } from '../../v2/motion/useMotionPolicy';
import { createLabPowerSaveSource, useLabPowerSaveSource } from '../adapters/labPowerSaveSource';
import { LAB_EVENTS, LAB_PROPS, type LabEventSource } from '../LabRoot';

// MB-087's last part (F-9 A): battery saver in the lab comes from the activity, which reads
// PowerManager and passes the state at launch (LAB_PROPS.powerSave) and on every change (the
// LAB_EVENTS.powerSave device event). The adapter turns that into v2's PowerSaveSource. It must be
// created once per mount: a source rebuilt on every render is a new, unanswered source each time, and
// the policy would re-subscribe without end (resilience MEDIUM-4).
//
// The device is a real EventEmitter behind the same addListener/remove shape as DeviceEventEmitter.

function device() {
  const emitter = new EventEmitter();
  const events: LabEventSource = {
    addListener: (name, listener) => {
      emitter.on(name, listener);
      return { remove: () => emitter.off(name, listener) };
    },
  };
  return {
    events,
    send: (payload: unknown) => act(async () => { emitter.emit(LAB_EVENTS.powerSave, payload); }),
    listening: () => emitter.listenerCount(LAB_EVENTS.powerSave),
  };
}

const launch = (on: unknown) => ({ [LAB_PROPS.powerSave]: on });

describe('createLabPowerSaveSource: the activity’s battery-saver state as a PowerSaveSource', () => {
  it.each([[true, true], [false, false]])('reads the launch state: %p', async (on, expected) => {
    await expect(createLabPowerSaveSource(launch(on), device().events).read()).resolves.toBe(expected);
  });

  // LabRoot reports `powerSave === true` in READY; the policy must see the same value it reports.
  it.each([[undefined], [null], ['true'], [1]])('a launch value that is not a boolean reads as off, as READY reports it: %p', async (on) => {
    await expect(createLabPowerSaveSource(launch(on), device().events).read()).resolves.toBe(false);
  });

  it('hears each change, and then reads the latest', async () => {
    const d = device();
    const source = createLabPowerSaveSource(launch(false), d.events);
    const heard: boolean[] = [];
    const stop = source.subscribe((on) => heard.push(on));
    await d.send({ powerSave: true });
    await d.send({ powerSave: false });
    await d.send({ powerSave: true });
    expect(heard).toEqual([true, false, true]);
    await expect(source.read()).resolves.toBe(true);
    stop();
  });

  it('ignores an event that does not carry a boolean', async () => {
    const d = device();
    const source = createLabPowerSaveSource(launch(true), d.events);
    const heard: boolean[] = [];
    source.subscribe((on) => heard.push(on));
    for (const bad of [null, undefined, {}, { powerSave: 'false' }, { powerSave: 0 }]) await d.send(bad);
    expect(heard).toEqual([]);
    await expect(source.read()).resolves.toBe(true);
  });

  it('stops listening to the device when unsubscribed', () => {
    const d = device();
    const source = createLabPowerSaveSource(launch(false), d.events);
    const a = source.subscribe(() => {});
    const b = source.subscribe(() => {});
    expect(d.listening()).toBe(2);
    a();
    b();
    expect(d.listening()).toBe(0);
  });
});

describe('useLabPowerSaveSource: created once, so the policy answers (resilience MEDIUM-4)', () => {
  const reducedMotionOff: ReduceMotionSource = { read: () => Promise.resolve(false), subscribe: () => () => {} };

  function mount(on: boolean) {
    const d = device();
    const tiers: MotionTier[] = [];
    const sources: PowerSaveSource[] = [];
    function Session({ props }: { props: Record<string, unknown> }) {
      const powerSave = useLabPowerSaveSource(props, d.events);
      sources.push(powerSave);
      tiers.push(useMotionPolicy({ reduceMotion: reducedMotionOff, powerSave }));
      return null;
    }
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(<Session props={launch(on)} />);
    });
    return {
      d,
      tier: () => tiers[tiers.length - 1],
      sources,
      settle: () => act(async () => {}),
      // The launch props object is rebuilt by its parent on every render, with the same values.
      rerender: () => act(() => tree.update(<Session props={launch(on)} />)),
      unmount: () => act(() => tree.unmount()),
    };
  }

  it('battery saver off: the policy settles on full motion, and stays there across re-renders', async () => {
    const m = mount(false);
    await m.settle();
    expect(m.tier()).toBe('full');
    for (let i = 0; i < 5; i++) m.rerender();
    await m.settle();
    expect(m.tier()).toBe('full');
    expect(new Set(m.sources).size).toBe(1);
    expect(m.d.listening()).toBe(1);
  });

  it('follows the device: on gives the low tier, off gives full motion again', async () => {
    const m = mount(false);
    await m.settle();
    await m.d.send({ powerSave: true });
    expect(m.tier()).toBe('low');
    await m.d.send({ powerSave: false });
    expect(m.tier()).toBe('full');
  });

  it('launched with battery saver on, the policy answers low', async () => {
    const m = mount(true);
    await m.settle();
    expect(m.tier()).toBe('low');
  });

  it('leaves no listener behind on unmount', async () => {
    const m = mount(false);
    await m.settle();
    m.unmount();
    expect(m.d.listening()).toBe(0);
  });
});

describe('the adapter takes the names from LabRoot, and never spells them', () => {
  const ADAPTER = path.resolve(__dirname, '../adapters/labPowerSaveSource.ts');
  const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  /** String literals that spell a lab launch option or device event name. */
  const spelled = (source: string) =>
    [...strip(source).matchAll(/(['"`])([^'"`\n]*)\1/g)].map((m) => m[2]).filter((s) => [...Object.values(LAB_PROPS), ...Object.values(LAB_EVENTS)].includes(s as never));

  it('imports LAB_PROPS and LAB_EVENTS from LabRoot', () => {
    const source = strip(fs.readFileSync(ADAPTER, 'utf8'));
    expect(source).toMatch(/import\s*\{[^}]*\bLAB_EVENTS\b[^}]*\}\s*from\s*'\.\.\/LabRoot'/);
    expect(source).toMatch(/import\s*\{[^}]*\bLAB_PROPS\b[^}]*\}\s*from\s*'\.\.\/LabRoot'/);
  });

  it('spells no launch option or event name of its own', () => {
    expect(spelled(fs.readFileSync(ADAPTER, 'utf8'))).toEqual([]);
  });

  it('the check bites: a planted adapter that spells the event name is flagged', () => {
    const planted = ['events.addListener(', "'labPower", "Save', onEvent);"].join('');
    expect(spelled(planted)).toEqual([LAB_EVENTS.powerSave]);
  });
});
