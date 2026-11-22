// The Design Lab runtime (MB-085): the root component index.lab.js registers. It reads the launch
// arguments the lab activity passes as initial props, renders the named scene on the named clock,
// and speaks the protocol (protocol.ts) to the capture harness over logcat.
//
// The scene's facts (B8-6): a field scene says the motion tier FieldView draws at (SceneFactsContext), and READY carries
// it as `tier` (null for a scene that names none). A policy scene takes that tier from the app's motion policy on the
// device's settings, through the ports this root provides once (LabMotionPortsContext): reduced motion from the same
// source the real-time clock asks, battery saver from the activity's launch prop and events (labPowerSaveSource.ts).
// READY waits while the scene says its tier is not known yet, and a known tier that changes after READY is an ERROR. A
// scene that says a setting cannot be read (UI-241) is an ERROR at once, naming it: its tier would never be known.
// Every setting read the lab makes has a deadline (settingRead.ts): one that never settles is refused by time, so it is
// named in an ERROR too, never a READY held until the harness times out.
// READY also says which Skia backend draws the lab (UI-276, skiaBackend.ts): read once from react-native-skia when the
// session mounts, the same on every READY of the run; one that cannot be read is null with the reason, never an ERROR.
//
// Never part of the app: only index.lab.js reaches this file, and only the `lab` build type bundles
// index.lab.js (MB-084; scripts/lab/assertLabExcluded.mjs checks every release bundle for it).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, DeviceEventEmitter, I18nManager, PixelRatio } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { Skia } from '@shopify/react-native-skia';
import { useRealtimeFieldClock, type FieldClock } from '../v2/clock/fieldClock';
import type { MotionPorts } from '../v2/motion/ports';
import type { MotionTier } from '../v2/motion/useMotionPolicy';
import { useLabPowerSaveSource } from './adapters/labPowerSaveSource';
import { fixedClockTime } from './clock/fixedClock';
import { CostReportContext, formatCostResult, type CostReport } from './cost/costResult';
import { createSteppedClock, type SteppedClock } from './clock/steppedClock';
import { parseLabArgs, type LabParams, type SceneTiming } from './params';
import { ProbeRegistry } from './probe/Probe';
import type { ProbeRect } from './probe/geometry';
import { createCommandGate, createReadyGate, formatLine, parseCommand, type LineKind } from './protocol';
import { SCENES, type Scene } from './scenes';
import { createSettingReads } from './settingRead';
import { LabMotionPortsContext, SceneFactsContext, type SceneFacts } from './scenes/FieldScene';
import { LAB_SENTINEL } from './sentinel';
import { ShaderReportContext, type ShaderReport, type ShaderStatus } from './shaderReport';
import { readSkiaBackend, type BackendSkia } from './skiaBackend';

/** The launch options DesignLabActivity passes as initial props (nativeContract.test.ts pins them). */
export const LAB_PROPS = { args: 'labArgs', nonStringKeys: 'nonStringKeys', powerSave: 'powerSave' } as const;
/** The device events DesignLabActivity sends: a command from onNewIntent, and a power-save change. */
export const LAB_EVENTS = { command: 'labCommand', powerSave: 'labPowerSave' } as const;

/** One frame from now; returns a cancel. */
export type FrameSource = { next(callback: () => void): () => void };
export type LabEventSource = { addListener(name: string, listener: (event: unknown) => void): { remove(): void } };
/** The OS reduced-motion setting (on Android, RN reads TRANSITION_ANIMATION_SCALE). */
export type ReduceMotionSource = { current(): Promise<boolean>; subscribe(listener: (on: boolean) => void): () => void };
export type LabDeps = {
  emit(line: string): void;
  frames: FrameSource;
  events: LabEventSource;
  /** The scene's fonts are loaded (there are none yet; UI-069 adds them). */
  fontsReady: boolean;
  reduceMotion: ReduceMotionSource;
  scenes: Readonly<Record<string, Scene>>;
  /** The Skia whose backend READY names (UI-276): react-native-skia's own, or a test's. */
  skia: BackendSkia;
};

const animationFrames: FrameSource = {
  next(callback) {
    const id = requestAnimationFrame(() => callback());
    return () => cancelAnimationFrame(id);
  },
};

const accessibilityReduceMotion: ReduceMotionSource = {
  current: () => AccessibilityInfo.isReduceMotionEnabled(),
  subscribe: (listener) => {
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', listener);
    return () => sub.remove();
  },
};

const DEFAULT_DEPS: LabDeps = {
  emit: (line) => console.log(line),
  frames: animationFrames,
  events: DeviceEventEmitter as unknown as LabEventSource,
  fontsReady: true,
  reduceMotion: accessibilityReduceMotion,
  scenes: SCENES,
  skia: Skia,
};

type LabRootProps = {
  labArgs?: Record<string, unknown> | null;
  nonStringKeys?: readonly string[] | null;
  powerSave?: boolean;
  deps?: Partial<LabDeps>;
};

/** A reason short enough that READY stays one logcat line (a shader compile error can be long). */
const MAX_REASON = 300;
const clip = (reason: string | null) => (reason === null || reason.length <= MAX_REASON ? reason : `${reason.slice(0, MAX_REASON - 1)}…`);

/**
 * The launch's ERROR (UI-241): every error, or, when together they cannot make one protocol line (formatLine throws: many
 * unknown keys, each already clipped by params.ts), one short error that says so, with how many there were and the first.
 * The first is bounded by params.ts (every echo clipped; the longest single error, the unknown-scene message, budgeted near
 * 3000 bytes), so this line fits. Never a throw: a launch the lab refuses always tells the harness why.
 */
function launchErrorLine(run: string | null, errors: readonly string[]): string {
  try {
    return formatLine('ERROR', { run, errors });
  } catch (e) {
    return formatLine('ERROR', { run, errors: [`the launch was refused with ${errors.length} errors, too many for one line (${(e as Error).message}); the first: ${errors[0] ?? ''}`] });
  }
}

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
    deps.emit(launchErrorLine(parsed.run, parsed.errors));
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
  // The real-time clock runs only once reduced motion is known to be off: a still shot then draws no
  // frame, and the same scene with motion allowed draws some (the harness's positive control). The read is made below,
  // once `fail` exists: a refused or unanswered read on a real-time launch is an ERROR (UI-241).
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  // Every setting read of this session, each with its deadline (settingRead.ts); cleared on unmount.
  const [reads] = useState(() => createSettingReads());
  useEffect(() => () => reads.clear(), [reads]);
  const realtime = useRealtimeFieldClock(scene.periodMs, params.clock === 'realtime' && reduceMotion === false);
  const clock: FieldClock = params.clock === 'realtime' ? realtime : { t: controlled };

  // The motion policy's ports, made once: the scene's policy hears the device as the realtime clock does (B8-6).
  const powerSaveSource = useLabPowerSaveSource({ [LAB_PROPS.powerSave]: initialPowerSave }, deps.events);
  const [motionPorts] = useState<MotionPorts>(() => ({
    reduceMotion: { read: () => reads.read(() => deps.reduceMotion.current()), subscribe: (onChange) => deps.reduceMotion.subscribe(onChange) },
    // Battery saver is the activity's launch prop and events (labPowerSaveSource.ts): its read answers at once, so it needs
    // no deadline.
    powerSave: powerSaveSource,
  }));

  // The Skia backend that draws this run (UI-276), read once as the session mounts: a build fact, never one that changes.
  const [skiaBackend] = useState(() => readSkiaBackend(deps.skia));

  // What READY reports is what was committed last.
  const latest = useRef({ seq: step.seq, t: step.t, powerSave });
  latest.current = { seq: step.seq, t: step.t, powerSave };
  // The surface the scene says drew it (UI-223), as it last reported, and the status the last READY sent (undefined
  // until one is sent).
  const shader = useRef<ShaderReport | null>(null);
  const shown = useRef<ShaderStatus | null | undefined>(undefined);
  // The scene's facts as it last reported them (null: it reports none), and the tier the last READY sent (undefined until
  // one is sent).
  const facts = useRef<SceneFacts | null>(null);
  const tierShown = useRef<MotionTier | null | undefined>(undefined);
  /** The scene cannot be described yet: its surface is pending, or it said its tier is not known. */
  const unsettled = useCallback(() => shader.current?.status === 'pending' || facts.current?.tier === null, []);
  // A READY that came due while the scene was pending (UI-233): held unsent, and its frames counted afresh once the scene
  // reports what drew it. A READY never says `pending`, so it never says `ready` before a field frame was drawn.
  const held = useRef(false);
  // A bench's RESULT lines (B8-3) that came before the run's first READY: held, already formatted, and sent right after
  // that READY. A RESULT is never sent before READY (the harness reads a run only once it settled), and holding it, not
  // failing, means a bench that finishes early is never lost. An ERROR drops them: nothing follows an ERROR.
  const heldResults = useRef<string[]>([]);

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
      if (unsettled()) {
        held.current = true;
        return;
      }
      const now = latest.current;
      // Formatted before anything is sent: a READY that cannot be written is an ERROR that ends the
      // run, and the command gate never settles, so no later command or READY can follow it.
      let line: string;
      try {
        line = formatLine('READY', {
          run: params.run, seq: now.seq, scene: params.scene, clock: params.clock, t: now.t,
          powerSave: now.powerSave, pixelRatio: PixelRatio.get(),
          // Read now, as the app lays out: the harness refuses a shot unless isRTL is true (F-13), and
          // compares fontScale with the scale it set, only to confirm the setting took effect.
          isRTL: I18nManager.isRTL, fontScale: PixelRatio.getFontScale(),
          probes, sentinel: LAB_SENTINEL,
          shaderStatus: shader.current?.status ?? null, shaderReason: clip(shader.current?.reason ?? null),
          tier: facts.current?.tier ?? null,
          skiaBackend,
        });
      } catch (e) {
        fail((e as Error).message);
        return;
      }
      deps.emit(line);
      shown.current = shader.current?.status ?? null;
      tierShown.current = facts.current?.tier ?? null;
      const results = heldResults.current;
      heldResults.current = [];
      for (const result of results) deps.emit(result);
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

  // The reduced-motion read that starts the real-time clock (UI-241). On a real-time launch a read the platform refuses,
  // or one that does not settle by the deadline, would leave the clock still for good while READY still came, and a
  // moving shot would fail later as "0 frames", by no name: it is one ERROR naming the setting instead. A refusal after a
  // change event answered the setting is ignored, as the motion policy ignores a late read. A fixed or stepped launch
  // does not use the clock, so a refusal is nothing to it.
  useEffect(() => {
    let live = true;
    let changed = false;
    reads.read(() => deps.reduceMotion.current()).then((on) => { if (live) setReduceMotion(on); }, (e: unknown) => {
      if (!live || changed || params.clock !== 'realtime') return;
      fail(`the real-time clock cannot start: the device's reduced-motion setting could not be read (${e instanceof Error ? e.message : String(e)})`);
    });
    const unsubscribe = deps.reduceMotion.subscribe((on) => { changed = true; setReduceMotion(on); });
    return () => { live = false; unsubscribe(); };
  }, [deps, reads, fail, params.clock]);

  // The bench's side of the lab (B8-3, cost/costResult.ts): the lab adds the run and the seq (its own, whatever the body
  // says), formats through formatCostResult, and sends the line once READY was sent, or holds it until then. A body the
  // contract refuses, or the bench's own error, is one ERROR; after an ERROR nothing is sent.
  // The seq rule (UI-241): a RESULT carries the seq on screen when the bench hands the body over (latest.current, what
  // was committed last), not the seq its first measured frame was drawn under; a held RESULT keeps the seq it was made
  // with. So a bench that spanned a command would be filed under the later step. No run can show that today: every cost
  // shot runs on the real-time clock (v1-cost.json), where every command is IGNORED (wrong-clock), so its seq is always 0.
  const costReport = useMemo<CostReport>(() => ({
    result(body) {
      if (failed.current) return;
      let line: string;
      try {
        line = formatCostResult({ ...body, run: params.run, seq: latest.current.seq });
      } catch (e) {
        fail((e as Error).message);
        return;
      }
      if (shown.current === undefined) heldResults.current.push(line);
      else deps.emit(line);
    },
    error(message) {
      fail(message);
    },
  }), [deps, fail, params.run]);

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

  // The held READY (UI-233, B8-6): the scene can now be described, so READY waits its frames from here.
  const release = useCallback(() => {
    if (!held.current || unsettled()) return;
    held.current = false;
    gate.rearm();
    pump();
  }, [gate, pump, unsettled]);

  // A surface that changes after READY was sent (a builder that throws on a later frame) makes that READY false: an
  // ERROR, so no capture of this run passes as the surface READY named.
  const reportShader = useCallback((report: ShaderReport) => {
    // A scene that can never be described (RA-55): an ERROR now, while the harness still waits for READY.
    if (report.error !== undefined) {
      fail(clip(report.error) as string);
      return;
    }
    shader.current = report;
    const said = shown.current;
    if (said !== undefined && said !== report.status) {
      fail(`the surface changed after READY: READY said ${said ?? 'none'}, now ${report.status}${report.reason === null ? '' : ` (${clip(report.reason)})`}`);
      return;
    }
    release();
  }, [fail, release]);

  // The tier the scene observed (B8-6). After READY a known tier that differs from READY's makes that READY false; a
  // passing "not known" (a setting heard before the policy caught up) is not a change.
  const reportFacts = useCallback((next: SceneFacts) => {
    facts.current = next;
    if (next.unreadable !== undefined) {
      fail(`the tier cannot be known: ${clip(next.unreadable)}`);
      return;
    }
    const said = tierShown.current;
    if (said !== undefined && next.tier !== null && next.tier !== said) {
      fail(`the tier changed after READY: READY said ${said ?? 'none'}, now ${next.tier}`);
      return;
    }
    release();
  }, [fail, release]);

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
      <ShaderReportContext.Provider value={reportShader}>
        <SceneFactsContext.Provider value={reportFacts}>
          <LabMotionPortsContext.Provider value={motionPorts}>
            <CostReportContext.Provider value={costReport}>
              <SceneComponent clock={clock} t={step.t} params={params} />
            </CostReportContext.Provider>
          </LabMotionPortsContext.Provider>
        </SceneFactsContext.Provider>
      </ShaderReportContext.Provider>
    </ProbeRegistry>
  );
}
