// The Design Lab runtime (MB-085): the root component index.lab.js registers. It reads the launch
// arguments the lab activity passes as initial props, renders the named scene on the named clock,
// and speaks the protocol (protocol.ts) to the capture harness over logcat.
//
// Never part of the app: only index.lab.js reaches this file, and only the `lab` build type bundles
// index.lab.js (MB-084; scripts/lab/assertLabExcluded.mjs checks every release bundle for it).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DeviceEventEmitter, PixelRatio } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { useRealtimeFieldClock, type FieldClock } from '../v2/clock/fieldClock';
import { fixedClockTime } from './clock/fixedClock';
import { createSteppedClock, type SteppedClock } from './clock/steppedClock';
import { parseLabArgs, type LabParams, type SceneTiming } from './params';
import { ProbeRegistry } from './probe/Probe';
import type { ProbeRect } from './probe/geometry';
import { createCommandGate, createReadyGate, formatLine, parseCommand, type LineKind } from './protocol';
import { SCENES, type Scene } from './scenes';
import { LAB_SENTINEL } from './sentinel';

/** The launch options DesignLabActivity passes as initial props (nativeContract.test.ts pins them). */
export const LAB_PROPS = { args: 'labArgs', nonStringKeys: 'nonStringKeys', powerSave: 'powerSave' } as const;
/** The device events DesignLabActivity sends: a command from onNewIntent, and a power-save change. */
export const LAB_EVENTS = { command: 'labCommand', powerSave: 'labPowerSave' } as const;

/** One frame from now; returns a cancel. */
export type FrameSource = { next(callback: () => void): () => void };
export type LabEventSource = { addListener(name: string, listener: (event: unknown) => void): { remove(): void } };
export type LabDeps = {
  emit(line: string): void;
  frames: FrameSource;
  events: LabEventSource;
  /** The scene's fonts are loaded (there are none yet; UI-069 adds them). */
  fontsReady: boolean;
  scenes: Readonly<Record<string, Scene>>;
};

const animationFrames: FrameSource = {
  next(callback) {
    const id = requestAnimationFrame(() => callback());
    return () => cancelAnimationFrame(id);
  },
};

const DEFAULT_DEPS: LabDeps = {
  emit: (line) => console.log(line),
  frames: animationFrames,
  events: DeviceEventEmitter as unknown as LabEventSource,
  fontsReady: true,
  scenes: SCENES,
};

type LabRootProps = {
  labArgs?: Record<string, unknown> | null;
  nonStringKeys?: readonly string[] | null;
  powerSave?: boolean;
  deps?: Partial<LabDeps>;
};

const timings = (scenes: Readonly<Record<string, Scene>>): Record<string, SceneTiming> =>
  Object.fromEntries(Object.entries(scenes).map(([id, s]) => [id, { periodMs: s.periodMs }]));

export function LabRoot({ labArgs, nonStringKeys, powerSave, deps: overrides }: LabRootProps) {
  // The props come from the launch and never change; the dependencies are fixed at mount.
  const [deps] = useState<LabDeps>(() => ({ ...DEFAULT_DEPS, ...overrides }));
  const parsed = useMemo(
    () => parseLabArgs(labArgs, nonStringKeys ?? [], timings(deps.scenes)),
    [labArgs, nonStringKeys, deps],
  );
  const reported = useRef(false);
  useEffect(() => {
    if (parsed.ok || reported.current) return;
    reported.current = true;
    deps.emit(formatLine('ERROR', { run: parsed.run, errors: parsed.errors }));
  }, [parsed, deps]);

  if (!parsed.ok) return null;
  return (
    <LabSession
      params={parsed.params}
      scene={deps.scenes[parsed.params.scene]}
      initialPowerSave={powerSave === true}
      deps={deps}
    />
  );
}

function startTime(params: LabParams, scene: Scene, stepped: SteppedClock | null): number | null {
  if (params.clock === 'fixed') return fixedClockTime(params.t, scene.periodMs);
  if (params.clock === 'stepped' && stepped) return stepped.now();
  return null;
}

function LabSession({ params, scene, initialPowerSave, deps }: {
  params: LabParams;
  scene: Scene;
  initialPowerSave: boolean;
  deps: LabDeps;
}) {
  const [powerSave, setPowerSave] = useState(initialPowerSave);
  const [stepped] = useState<SteppedClock | null>(() => (params.clock === 'stepped'
    ? createSteppedClock({ t0: params.t, stepMs: params.stepMs, periodMs: scene.periodMs })
    : null));
  // The command that produced what is on screen (0: the launch) and the time it set.
  const [step, setStep] = useState(() => ({ seq: 0, t: startTime(params, scene, stepped) }));

  // The clock the scene draws with. Fixed and stepped write their exact time into a SharedValue;
  // the real-time clock runs only on the realtime launch.
  const controlled = useSharedValue(step.t ?? 0);
  useEffect(() => {
    if (step.t !== null) controlled.value = step.t;
  }, [controlled, step.t]);
  const realtime = useRealtimeFieldClock(scene.periodMs, params.clock === 'realtime');
  const clock: FieldClock = params.clock === 'realtime' ? realtime : { t: controlled };

  // What READY reports is what was committed last.
  const latest = useRef({ seq: step.seq, t: step.t, powerSave });
  latest.current = { seq: step.seq, t: step.t, powerSave };

  const say = useCallback((kind: LineKind, payload: unknown) => {
    let line: string;
    try {
      line = formatLine(kind, payload);
    } catch (e) {
      line = formatLine('ERROR', { run: params.run, errors: [(e as Error).message] });
    }
    deps.emit(line);
  }, [deps, params.run]);

  const [commands] = useState(createCommandGate);
  const [gate] = useState(() => createReadyGate<ProbeRect>({
    probes: scene.probes,
    frames: params.frames,
    onReady: ({ probes }) => {
      const now = latest.current;
      // Formatted before anything is sent: a READY that cannot be written is an ERROR that ends the
      // run, and the command gate never settles, so no later command or READY can follow it.
      let line: string;
      try {
        line = formatLine('READY', {
          run: params.run, seq: now.seq, scene: params.scene, clock: params.clock, t: now.t,
          powerSave: now.powerSave, pixelRatio: PixelRatio.get(), probes, sentinel: LAB_SENTINEL,
        });
      } catch (e) {
        fail((e as Error).message);
        return;
      }
      deps.emit(line);
      commands.settle();
    },
  }));

  // After an ERROR the lab sends nothing else: the harness must not mistake a later READY for success.
  const failed = useRef(false);
  const fail = useCallback((message: string) => {
    if (failed.current) return;
    failed.current = true;
    say('ERROR', { run: params.run, errors: [message] });
  }, [say, params.run]);

  // Frames are requested one at a time, only while READY is waiting for them. A frame that lands
  // after an ERROR, or after unmount, counts for nothing and asks for no other.
  const alive = useRef(true);
  const pending = useRef<null | (() => void)>(null);
  const pump = useCallback(() => {
    if (!alive.current || pending.current !== null || !gate.wantsFrame()) return;
    pending.current = deps.frames.next(() => {
      pending.current = null;
      if (!alive.current || failed.current) return;
      gate.frame();
      pump();
    });
  }, [deps, gate]);

  const onMeasure = useCallback((id: string, rect: ProbeRect) => {
    try {
      gate.measure(id, rect);
    } catch (e) {
      fail((e as Error).message);
      return;
    }
    pump();
  }, [gate, fail, pump]);

  useEffect(() => {
    if (!deps.fontsReady) return;
    gate.fontsReady();
    pump();
  }, [deps, gate, pump]);

  // A command's READY counts only frames drawn after the new time was committed.
  useEffect(() => {
    if (step.seq === 0) return;
    gate.rearm();
    pump();
  }, [step.seq, gate, pump]);

  useEffect(() => {
    const sub = deps.events.addListener(LAB_EVENTS.command, (event) => {
      const e = (event ?? {}) as { args?: unknown; nonStringKeys?: unknown };
      const args = e.args !== null && typeof e.args === 'object' ? (e.args as Record<string, unknown>) : {};
      const nonString = Array.isArray(e.nonStringKeys) ? (e.nonStringKeys as string[]) : [];
      const cmd = parseCommand(args);
      if (nonString.length > 0) {
        say('IGNORED', { run: params.run, seq: cmd.seq, reason: 'malformed', detail: `${nonString.join(', ')}: not string extras (--es)` });
        return;
      }
      if (!cmd.ok) {
        say('IGNORED', { run: params.run, seq: cmd.seq, reason: cmd.reason, detail: cmd.detail });
        return;
      }
      if (stepped === null) {
        say('IGNORED', { run: params.run, seq: cmd.seq, reason: 'wrong-clock' });
        return;
      }
      const verdict = commands.offer(cmd.seq);
      if (verdict !== 'accept') {
        say('IGNORED', { run: params.run, seq: cmd.seq, reason: verdict });
        return;
      }
      setStep({ seq: cmd.seq, t: stepped.advance(cmd.steps) });
    });
    return () => sub.remove();
  }, [deps, say, params.run, stepped, commands]);

  useEffect(() => {
    const sub = deps.events.addListener(LAB_EVENTS.powerSave, (event) => {
      const value = (event as { powerSave?: unknown } | null)?.powerSave;
      if (typeof value === 'boolean') setPowerSave(value);
    });
    return () => sub.remove();
  }, [deps]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      pending.current?.();
      pending.current = null;
    };
  }, []);

  const SceneComponent = scene.Component;
  return (
    <ProbeRegistry onMeasure={onMeasure}>
      <SceneComponent clock={clock} t={step.t} params={params} />
    </ProbeRegistry>
  );
}
