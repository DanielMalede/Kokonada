// The fieldCost bench (B8-3; the architect's B8 plan, F2 at A: "a lab bench that calls the EXPORTED fieldStep and
// renderFieldImage, cross-checked by gfxinfo on the real FieldScene. No probe in FieldView"; F3 at A: "GPU time is wall time
// with a GPU sync (readPixels) around K offscreen renders, calibrated by a heavy and an empty shader. Informational only").
//
// What it measures (resilience T5 r1 Q5), one frame callback at a time on the UI thread, on the scene's own frames:
//   · stepUs: one fieldStep, the whole per-frame work FieldView runs (the ledger, its fades, one build, one pack), timed
//     around the exported function itself, so what is timed is what the app runs;
//   · renderUs: one renderFieldImage of that frame at the tier's render size, with no sync: the UI thread's side of the draw;
//   · gpuProxyUs: after the step frames, K renders of the last frame and one 1 × 1 readPixels of the last image (which
//     waits for the GPU to finish them all), over K. The first such sample is a warm-up and is not recorded. Run with the
//     heavy and the empty calibration effects (heavyShader.ts) it says whether the proxy sees the GPU at all.
// Warm-up frames run the same work unrecorded (the first frames compile and allocate). Images are disposed outside every
// timed span. The idle scene feeds the scene's taps at seq 0; the storm feeds the 7 taps/s script (costStorm.ts) at the
// time since the bench's first frame. Every drawn frame is measured: the tier's frame cap (fpsCap) only decides how many
// frames the app draws, not what one costs.
//
// The clock is the UI runtime's performance.now and nothing else: without it the bench is an ERROR on its first frame and
// measures nothing. It never falls back to a wall clock, whose resolution and steps would read as cost.
//
// Every number is informational: DEC-082 (the cost budget) is open, so nothing here or in the RESULT judges a threshold.
// Everything the frame callback calls is a worklet; costBenchConfig runs on the JS thread.

import { AlphaType, ColorType, type SkImage, type SkRuntimeEffect, type SkShader } from '@shopify/react-native-skia';
import { fieldStep, renderGeometry, renderScaleFor, renderSize, type FrameParams } from '../../v2/field/fieldDriver';
import { fixedFieldBreath, type FieldGeometry, type FieldStatics } from '../../v2/field/fieldFrame';
import { renderFieldImage, type SurfaceSkia } from '../../v2/field/fieldImage';
import { emptyLedger, type Ledger, type LedgerInput } from '../../v2/field/placementLedger';
import { ledgerConfigFor } from '../../v2/field/statics';
import { FIELD_SCENES, FIELD_STATICS, fieldSceneLayout } from '../fieldScenes';
import type { CostResultBody } from './costResult';
import type { CostSceneSpec } from './costScenes';
import { stormInput } from './costStorm';
import { histogram, histRecord, histSummary, type Histogram } from './histogram';

export interface BenchCounts {
  /** Frames run unrecorded first. */
  readonly warmup: number;
  /** Step frames recorded. */
  readonly frames: number;
  /** GPU samples recorded, after one unrecorded. */
  readonly gpuSamples: number;
  /** Renders per GPU sample (K). */
  readonly gpuRenders: number;
}

/** 1200 recorded frames: 10 s at 120 Hz, 70 storm taps. */
export const COST_COUNTS: BenchCounts = { warmup: 60, frames: 1200, gpuSamples: 120, gpuRenders: 8 };

export interface BenchConfig {
  readonly scene: string;
  readonly params: FrameParams;
  readonly storm: boolean;
  /** The idle input: the scene's taps at seq 0. */
  readonly input: LedgerInput;
  readonly ledger: Ledger;
  readonly geometry: FieldGeometry;
  readonly size: { readonly width: number; readonly height: number };
  readonly statics: FieldStatics;
  readonly periodMs: number;
  readonly skia: SurfaceSkia;
  readonly effect: SkRuntimeEffect;
  readonly blueNoise: SkShader;
  readonly counts: BenchCounts;
}

export type BenchPhase = 'warmup' | 'steps' | 'gpu' | 'done' | 'error';

export interface BenchState {
  phase: BenchPhase;
  error: string | null;
  readonly scene: string;
  ledger: Ledger;
  input: LedgerInput;
  uniforms: number[] | null;
  startTs: number | null;
  firstTs: number;
  lastTs: number;
  warmed: number;
  recorded: number;
  gpuDone: number;
  readonly images: (SkImage | null)[];
  readonly step: Histogram;
  readonly render: Histogram;
  readonly gpu: Histogram;
}

/** Why the UI runtime's clock cannot be read, or null. */
export function clockProblem(): string | null {
  'worklet';
  const p = (globalThis as { performance?: { now?: unknown } | null }).performance;
  if (p === undefined || p === null || typeof p.now !== 'function') {
    return 'the UI runtime has no performance.now: the bench takes no other clock (never a Date fallback) and measured nothing';
  }
  return null;
}

function now(): number {
  'worklet';
  return (globalThis as unknown as { performance: { now(): number } }).performance.now();
}

const whole = (n: number, least: number) => Number.isInteger(n) && n >= least;

/** The bench's config on the JS thread: the field scene's layout at the device's pxPerDp and font scale, the tier's render size. */
export function costBenchConfig(a: {
  readonly spec: CostSceneSpec;
  readonly width: number;
  readonly height: number;
  readonly pxPerDp: number;
  readonly fontScale: number;
  readonly skia: SurfaceSkia;
  readonly effect: SkRuntimeEffect;
  readonly blueNoise: SkShader;
  readonly counts?: BenchCounts;
}): BenchConfig {
  const counts = a.counts ?? COST_COUNTS;
  if (!whole(counts.warmup, 0) || !whole(counts.frames, 2) || !whole(counts.gpuSamples, 1) || !whole(counts.gpuRenders, 1)) {
    throw new RangeError(`bench counts ${JSON.stringify(counts)}: warmup >= 0, frames >= 2, gpuSamples >= 1 and gpuRenders >= 1, whole`);
  }
  const { spec } = a;
  const field = FIELD_SCENES[`field.${spec.direction}.${spec.face}.${spec.hero}.${spec.tier}`];
  const layout = fieldSceneLayout(field, a.width, a.height, a.fontScale);
  const renderScale = renderScaleFor(spec.tier);
  const geometry = renderGeometry(layout, a.pxPerDp, renderScale);
  return {
    scene: spec.id,
    params: { direction: spec.direction, face: spec.face, stress: 0, confidence: 1, genesis: false, tier: spec.tier },
    storm: spec.variant === 'storm',
    input: { seq: 0, taps: spec.taps },
    ledger: emptyLedger(ledgerConfigFor(spec.direction, spec.face, FIELD_STATICS, geometry)),
    geometry,
    size: renderSize(layout, a.pxPerDp, renderScale),
    statics: FIELD_STATICS,
    periodMs: spec.periodMs,
    skia: a.skia,
    effect: a.effect,
    blueNoise: a.blueNoise,
    counts,
  };
}

export function benchStart(c: BenchConfig): BenchState {
  'worklet';
  const images: (SkImage | null)[] = [];
  for (let k = 0; k < c.counts.gpuRenders; k++) images.push(null);
  return {
    phase: c.counts.warmup > 0 ? 'warmup' : 'steps',
    error: null,
    scene: c.scene,
    ledger: c.ledger,
    input: c.storm ? stormInput(0) : c.input,
    uniforms: null,
    startTs: null,
    firstTs: 0,
    lastTs: 0,
    warmed: 0,
    recorded: 0,
    gpuDone: 0,
    images,
    step: histogram(),
    render: histogram(),
    gpu: histogram(),
  };
}

function stepFrame(s: BenchState, c: BenchConfig, ts: number, startTs: number): void {
  'worklet';
  const elapsed = ts - startTs;
  if (c.storm) {
    const next = stormInput(elapsed);
    if (next.seq !== s.input.seq) s.input = next;
  }
  const tMs = ((elapsed % c.periodMs) + c.periodMs) % c.periodMs;
  const breath = fixedFieldBreath(c.params.direction, c.params.stress, tMs).phase;
  const t0 = now();
  const step = fieldStep(s.ledger, s.input, ts, c.params, c.geometry, c.statics, tMs, breath);
  const t1 = now();
  if (step.uniforms === null) throw new Error(`the field step failed: ${step.error ?? 'no frame'}`);
  s.ledger = step.ledger;
  s.uniforms = step.uniforms;
  const t2 = now();
  const image = renderFieldImage(c.skia, c.effect, c.blueNoise, step.uniforms, c.size.width, c.size.height);
  const t3 = now();
  if (image === null) throw new Error('no offscreen surface could be made for the render');
  image.dispose();
  if (s.phase === 'warmup') {
    s.warmed += 1;
    if (s.warmed >= c.counts.warmup) s.phase = 'steps';
    return;
  }
  histRecord(s.step, (t1 - t0) * 1000);
  histRecord(s.render, (t3 - t2) * 1000);
  if (s.recorded === 0) s.firstTs = ts;
  s.lastTs = ts;
  s.recorded += 1;
  if (s.recorded >= c.counts.frames) s.phase = 'gpu';
}

function gpuSample(s: BenchState, c: BenchConfig): void {
  'worklet';
  const uniforms = s.uniforms;
  if (uniforms === null) throw new Error('no frame to render for the GPU proxy');
  const k = c.counts.gpuRenders;
  // The sync's one pixel, read when a sample runs (Skia's enums are not there in a headless load).
  const pixel = { width: 1, height: 1, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul };
  const t0 = now();
  for (let i = 0; i < k; i++) {
    const image = renderFieldImage(c.skia, c.effect, c.blueNoise, uniforms, c.size.width, c.size.height);
    if (image === null) throw new Error('no offscreen surface could be made for the GPU proxy');
    s.images[i] = image;
  }
  (s.images[k - 1] as SkImage).readPixels(0, 0, pixel);
  const t1 = now();
  for (let i = 0; i < k; i++) {
    s.images[i]?.dispose();
    s.images[i] = null;
  }
  if (s.gpuDone > 0) histRecord(s.gpu, ((t1 - t0) * 1000) / k);
  s.gpuDone += 1;
  if (s.gpuDone > c.counts.gpuSamples) s.phase = 'done';
}

/** One frame of the bench, at the frame callback's timestamp (ms). Changes nothing once it is done or has failed. */
export function benchFrame(s: BenchState, c: BenchConfig, timestampMs: number): void {
  'worklet';
  if (s.phase === 'done' || s.phase === 'error') return;
  try {
    if (s.startTs === null) {
      const problem = clockProblem();
      if (problem !== null) {
        s.phase = 'error';
        s.error = problem;
        return;
      }
      s.startTs = timestampMs;
    }
    if (s.phase === 'gpu') gpuSample(s, c);
    else stepFrame(s, c, timestampMs, s.startTs);
  } catch (e) {
    s.phase = 'error';
    s.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
}

/** The measurement, once the bench is done. */
export function benchBody(s: BenchState): CostResultBody {
  'worklet';
  if (s.phase !== 'done') throw new Error(`the bench is not done (${s.phase}${s.error === null ? '' : `: ${s.error}`})`);
  const span = s.lastTs - s.firstTs;
  if (!(span > 0)) throw new Error('the recorded frames span no time: no frame rate');
  return {
    kind: 'cost',
    scene: s.scene,
    frames: s.recorded,
    // The rate the bench achieved over its recorded frames, not the panel's (UI-241; costResult.ts keeps the name).
    displayHz: Math.round((((s.recorded - 1) * 1000) / span) * 10) / 10,
    stepUs: histSummary(s.step),
    renderUs: histSummary(s.render),
    gpuProxyUs: histSummary(s.gpu),
    clock: 'performance.now',
  };
}
