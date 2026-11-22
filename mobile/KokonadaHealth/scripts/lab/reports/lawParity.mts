// The law parity report (B8-8a; the architect's B8 plan at 199b138, TASKS UI-071).
//
//   node scripts/lab/reports/lawParity.mts --manifest <run>/manifest.json --out <report>.txt
//
// For a capture run (scripts/lab/capture.mjs), every row whose scene is
//   · field.* on the fixed clock: the capture's stage against the field's law twin in CanvasKit (lib/evidence.mts: fieldStep on the scene's
//     inputs, renderFieldImage, FieldImage's bilinear upscale at the density), ±1 per channel (UI-183);
//   · fallback.*: the capture's stage against FieldFallback's twin, ±1 per channel (UI-211): its picture in CanvasKit, but
//     within 1.5 px of the ring's two edges the ring by the device's coverage (lib/evidence.mts, UI-272), a model applied
//     only to a row recorded on the backend it was validated on, which the header names;
// with, for each, the full |Δ| histogram (every bin from 0 to the largest |Δ|: per pixel by its largest channel, and per
// channel), and every pixel over 1 listed by the region the law puts its centre in: the ring, a bead's halo, a quiet
// rect, the plate face, else the ground (first match, in that order). For every compared row (every field.* tier, UI-159,
// and every fallback.* row, UI-277) it writes ×8 crops of both ring edges, 16 × 16 px on the plate's horizontal through
// its centre, as one PNG of three panels: the capture, the twin and |Δ| × 32; a field row's edges are the frame the law
// drew, a fallback row's the ring its FieldFallback plan draws. Rows of other scenes, and field.* rows on another clock
// (no fixed frame time, so no twin), are named, not compared.
//
// Beside the verdict, measured and never judged (UI-274): each channel's signed Δ (capture − twin), its histogram (every
// bin from the lowest to the highest, 0 among them) and its mean, over the row and by the band of the twin's value of
// that channel (0–63, 64–127, 128–255), so a residue on one side shows (|Δ| cannot tell −1 from +1); and the largest
// 8-connected group of pixels over 1, with how many groups there are. The header names the commit the report was made at
// (and whether its tree held more) and the packages the twin is drawn with, beside the run's commit (lib/provenance.mjs).
//
// The stage is READY's, the app window (the harness holds it to the whole screen, UI-216), and the PNG is the app region
// the system bars leave: each row is compared where its stage lies in the PNG, and the pixels of the stage outside the
// PNG (under the bars), and of the PNG outside the stage, are counted and named, never compared.
//
// The tolerance is ±1 and this report never widens it: it lists every pixel over it, and the designer rules (B8 gaps:
// "a few 2-LSB pixels" on the emulator). It prints the report and writes it to --out, and the crops to <out>.crops/;
// neither may exist (a report never overwrites). Exit 0: every compared row within ±1 of its twin in a passed run;
// 1: a pixel over 1, a failed capture run, or nothing to compare; 2: an input it cannot use (a manifest field missing or
// malformed, named; a fallback row recorded on a backend the ring model was not validated on, named with the reason; a PNG
// that is not its row's; an output that exists; no --manifest or --out), and no report.
//
// Each distinct twin is rendered once and shared by every row whose twin it is (a shot's repeats; lib/twinShare.mjs),
// and when a run has two or more distinct field twins they are drawn on worker threads ahead of the walk
// (lib/twinWorkers.mts): a twin is nearly all of the time (UI-239). The report is the one each row gets alone
// (reportsLawParityShare.test.ts).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { quietFactor, pixelTerms, type FieldFrame, type QuietRect } from '../../../src/design/v2/field/fieldLaw.ts';
import { removedZones } from '../../../src/design/v2/field/fallbackModel.ts';
import { BASE } from '../../../src/design/v2/tokens/tokens.generated.ts';
import { encodePng } from '../lib/png.mjs';
import {
  EvidenceInputError,
  RING_MODEL,
  RING_MODEL_SCOPE,
  cropRgba,
  loadCapture,
  loadManifest,
  magnify,
  makeNewDir,
  readCaptureRow,
  readFallbackShot,
  readFieldShot,
  renderFallbackTwin,
  renderFieldTwin,
  writeNewFile,
  type FallbackShot,
  type FallbackTwin,
  type FieldShot,
  type FieldTwin,
  type Rect,
  type Rgba,
} from './lib/evidence.mts';
import { describeMadeAt, describeVersion, madeAt, packageVersion } from './lib/provenance.mjs';
import { shareTwins, twinKey } from './lib/twinShare.mjs';
import { fieldTwinWorkers, twinWorkerCount } from './lib/twinWorkers.mts';

const REPORT = 'lawParity';
/** The app's root: the checkout the report runs from, and where the twin's packages are resolved. */
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
/** What the twin is drawn with (lib/evidence.mts loadSkia): RN Skia's own web API over canvaskit-wasm. */
const TWIN_PACKAGES = ['canvaskit-wasm', '@shopify/react-native-skia'] as const;
/** ±1 per channel: the B8 tolerance (UI-183). Not this report's to widen. */
const TOLERANCE = 1;
const REGIONS = ['plate face', 'ring', 'halo', 'quiet rect', 'ground'] as const;
type Region = (typeof REGIONS)[number];
const CROP = 16;
const ZOOM = 8;
const GAP = 8;
const DELTA_GAIN = 32;
const CHANNELS = ['R', 'G', 'B'] as const;
/** The bands of the twin's value of a channel that the signed Δ is also kept by (UI-274). */
const BANDS = [[0, 63], [64, 127], [128, 255]] as const;
/** Each 8-bit value's band. */
const BAND_OF = Uint8Array.from({ length: 256 }, (_, v) => BANDS.findIndex(([lo, hi]) => v >= lo && v <= hi));
/** A channel's signed Δ runs from −255 to 255: one bin for each, at Δ + 255. */
const SPAN = 511;

function args(argv: readonly string[]): { manifest: string; out: string } {
  const at = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const manifest = at('--manifest');
  const out = at('--out');
  if (!manifest || !out) throw new EvidenceInputError('usage: node scripts/lab/reports/lawParity.mts --manifest <run>/manifest.json --out <report>.txt');
  return { manifest: path.resolve(manifest), out: path.resolve(out) };
}

// ---------------------------------------------------------------------------------------- regions

/** The field pixel's region, by the law at its centre in render px: ring, halo, quiet rect, plate face, else ground. */
function fieldRegion(twin: FieldTwin, x: number, y: number): Region {
  const xr = (x + 0.5) * twin.renderScale;
  const yr = (y + 0.5) * twin.renderScale;
  const frame: FieldFrame = twin.frame;
  const terms = pixelTerms(frame, xr, yr);
  if (terms.region === 'ring') return 'ring';
  if (terms.h.some((h) => h > 0)) return 'halo';
  if (quietFactor(frame, xr, yr) < 1) return 'quiet rect';
  if (terms.region === 'face') return 'plate face';
  return 'ground';
}

/** The fallback pixel's region, by its plan at its centre in device px: ring, a removed quiet zone, plate face, else ground. */
function fallbackRegioner(twin: FallbackTwin): (x: number, y: number) => Region {
  const { ring } = twin.plan;
  const zones: QuietRect[] = removedZones(twin.inputs.layout.quietRects, undefined, twin.inputs.pxPerDp) ?? [];
  const quiet = { quiet: { rects: zones, presence: zones.map(() => 1), grow: BASE.quiet.grow * twin.inputs.pxPerDp, feather: 0 } } as unknown as FieldFrame;
  return (x, y) => {
    const d = Math.hypot(x + 0.5 - ring.centre[0], y + 0.5 - ring.centre[1]);
    if (d >= ring.inner && d <= ring.outer) return 'ring';
    if (zones.length > 0 && quietFactor(quiet, x + 0.5, y + 0.5) === 0) return 'quiet rect';
    if (d < ring.inner) return 'plate face';
    return 'ground';
  };
}

// ---------------------------------------------------------------------------------------- one comparison

interface Over {
  readonly x: number;
  readonly y: number;
  readonly region: Region;
  readonly capture: readonly number[];
  readonly twin: readonly number[];
  readonly delta: readonly number[];
}
interface Compared {
  readonly pixels: number;
  /** The twin's pixels outside the capture (the stage under the system bars). */
  readonly stageOutside: number;
  /** The capture's pixels outside the twin (the app region beyond the stage). */
  readonly captureOutside: number;
  readonly max: number;
  readonly perPixel: number[];
  readonly perChannel: number[][];
  readonly over: Over[];
  /** The signed Δ (capture − twin) counted by channel, by the band of the twin's value of it, and by value: [(channel × bands + band) × SPAN + Δ + 255]. */
  readonly signed: Uint32Array;
}

/** The stage of the capture against the twin, pixel by pixel where both have one; (x, y) of each pixel over the tolerance are the PNG's. */
function compare(capture: Rgba, stage: Rect, twin: Rgba, regionAt: (x: number, y: number) => Region): Compared {
  const perPixel: number[] = [];
  const perChannel: number[][] = [[], [], []];
  const bump = (h: number[], v: number) => {
    while (h.length <= v) h.push(0);
    h[v]++;
  };
  const over: Over[] = [];
  const signed = new Uint32Array(CHANNELS.length * BANDS.length * SPAN);
  let max = 0;
  let pixels = 0;
  for (let y = 0; y < twin.height; y++) {
    for (let x = 0; x < twin.width; x++) {
      if (x + stage.x < 0 || y + stage.y < 0 || x + stage.x >= capture.width || y + stage.y >= capture.height) continue;
      pixels++;
      const t = (y * twin.width + x) * 4;
      const c = ((y + stage.y) * capture.width + (x + stage.x)) * 4;
      const delta = [0, 1, 2].map((ch) => Math.abs(capture.rgba[c + ch] - twin.rgba[t + ch]));
      const d = Math.max(...delta);
      delta.forEach((v, ch) => bump(perChannel[ch], v));
      bump(perPixel, d);
      for (let ch = 0; ch < CHANNELS.length; ch++) {
        const v = twin.rgba[t + ch];
        signed[(ch * BANDS.length + BAND_OF[v]) * SPAN + capture.rgba[c + ch] - v + 255]++;
      }
      if (d > max) max = d;
      if (d > TOLERANCE) {
        over.push({
          x: x + stage.x, y: y + stage.y, region: regionAt(x, y),
          capture: [0, 1, 2].map((ch) => capture.rgba[c + ch]), twin: [0, 1, 2].map((ch) => twin.rgba[t + ch]), delta,
        });
      }
    }
  }
  for (const h of [perPixel, ...perChannel]) while (h.length <= max) h.push(0);
  return { pixels, stageOutside: twin.width * twin.height - pixels, captureOutside: capture.width * capture.height - pixels, max, perPixel, perChannel, over, signed };
}

const histogram = (h: readonly number[]) => h.map((n, v) => `${v}: ${n}`).join(', ');

/** One channel's signed Δ over some bands of the twin's value: the mean, the sum over the pixels, and every bin from the lowest Δ to the highest, 0 among them. */
function signedOver(c: Compared, ch: number, bands: readonly number[]): string {
  const count = (d: number) => bands.reduce((k, b) => k + c.signed[(ch * BANDS.length + b) * SPAN + d + 255], 0);
  let n = 0;
  let sum = 0;
  let lo = 0;
  let hi = 0;
  for (let d = -255; d <= 255; d++) {
    const k = count(d);
    if (k === 0) continue;
    n += k;
    sum += d * k;
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  if (n === 0) return 'no px';
  const bins: string[] = [];
  for (let d = lo; d <= hi; d++) bins.push(`${d}: ${count(d)}`);
  return `mean ${(sum / n).toFixed(6)}, Σ ${sum} over ${n} px; histogram ${bins.join(', ')}`;
}

interface Group {
  readonly size: number;
  /** Its bounding box, PNG px. */
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** The pixels over the tolerance in 8-connected groups: how many groups, and the largest (the first in reading order of its size). */
function overGroups(over: readonly Over[], width: number): { count: number; largest: Group | null } {
  const at = new Map<number, number>();
  over.forEach((o, i) => at.set(o.y * width + o.x, i));
  const seen = new Uint8Array(over.length);
  const stack: number[] = [];
  let count = 0;
  let largest: Group | null = null;
  for (let i = 0; i < over.length; i++) {
    if (seen[i]) continue;
    count++;
    seen[i] = 1;
    stack.push(i);
    const g = { size: 0, x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    while (stack.length > 0) {
      const { x, y } = over[stack.pop()!];
      g.size++;
      g.x0 = Math.min(g.x0, x);
      g.y0 = Math.min(g.y0, y);
      g.x1 = Math.max(g.x1, x);
      g.y1 = Math.max(g.y1, y);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          // A neighbour past either end of the row is no pixel: it would be read as the next row's first or the last row's last.
          if ((dx === 0 && dy === 0) || x + dx < 0 || x + dx >= width) continue;
          const j = at.get((y + dy) * width + x + dx);
          if (j !== undefined && !seen[j]) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
    if (largest === null || g.size > largest.size) largest = g;
  }
  return { count, largest };
}

// ---------------------------------------------------------------------------------------- the ×8 ring-edge crops

/** Three ×8 panels side by side, a grey gap between: the capture's crop, the twin's, and |Δ| × 32 in grey. */
function cropPanels(capture: Rgba, stage: Rect, twin: Rgba, at: { x: number; y: number }): Rgba {
  const cap = cropRgba(capture, { x: at.x + stage.x, y: at.y + stage.y, width: CROP, height: CROP });
  const tw = cropRgba(twin, { x: at.x, y: at.y, width: CROP, height: CROP });
  const diff = new Uint8Array(CROP * CROP * 4);
  for (let i = 0; i < CROP * CROP; i++) {
    const d = Math.max(...[0, 1, 2].map((ch) => Math.abs(cap.rgba[i * 4 + ch] - tw.rgba[i * 4 + ch])));
    const g = Math.min(255, d * DELTA_GAIN);
    diff.set([g, g, g, 255], i * 4);
  }
  const panels = [cap, tw, { width: CROP, height: CROP, rgba: diff }].map((p) => magnify(p, ZOOM));
  const side = CROP * ZOOM;
  const width = 3 * side + 2 * GAP;
  const rgba = new Uint8Array(width * side * 4);
  for (let i = 0; i < width * side; i++) rgba.set([128, 128, 128, 255], i * 4);
  panels.forEach((p, n) => {
    for (let y = 0; y < side; y++) rgba.set(p.rgba.subarray(y * side * 4, (y + 1) * side * 4), (y * width + n * (side + GAP)) * 4);
  });
  return { width, height: side, rgba };
}

/** The crop's top left on the stage: 16 × 16 px centred on the edge at x on the plate's horizontal, inside both the stage and the capture. */
function cropAt(twin: Rgba, capture: Rgba, stage: Rect, edgeX: number, centreY: number): { x: number; y: number } {
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(lo, v), hi);
  return {
    x: clamp(Math.round(edgeX) - CROP / 2, Math.max(0, -stage.x), Math.min(twin.width, capture.width - stage.x) - CROP),
    y: clamp(Math.round(centreY) - CROP / 2, Math.max(0, -stage.y), Math.min(twin.height, capture.height - stage.y) - CROP),
  };
}

// ---------------------------------------------------------------------------------------- the run

type Job =
  | { kind: 'field'; shot: FieldShot }
  | { kind: 'fallback'; shot: FallbackShot };

/**
 * The ring's two edges on the plate's horizontal through its centre, in stage px: a field row's from the frame the law
 * drew (UI-159), a fallback row's from the ring its FieldFallback plan draws (UI-277).
 */
function ringEdges(job: Job, twin: FieldTwin | FallbackTwin): { y: number; edges: ReadonlyArray<readonly ['ring-inner' | 'ring-outer', number]> } {
  if (job.kind === 'field') {
    const t = twin as FieldTwin;
    const k = t.inputs.pxPerDp;
    const cx = t.inputs.layout.centre[0] * k;
    const R = t.inputs.layout.radius * k;
    return { y: t.inputs.layout.centre[1] * k, edges: [['ring-inner', cx + t.frame.ringInner * R], ['ring-outer', cx + R]] };
  }
  const { ring } = (twin as FallbackTwin).plan;
  return { y: ring.centre[1], edges: [['ring-inner', ring.centre[0] + ring.inner], ['ring-outer', ring.centre[0] + ring.outer]] };
}

async function main(): Promise<number> {
  const { manifest: manifestFile, out } = args(process.argv.slice(2));
  const cropsDir = `${out.replace(/\.txt$/, '')}.crops`;
  // Nothing is written over: both outputs must be new, checked before any work.
  for (const p of [out, cropsDir]) {
    if (fs.existsSync(p)) throw new EvidenceInputError(`refusing to overwrite ${p}: a report never replaces an earlier one`);
  }
  // What made this report, read as it starts, when its code was loaded (UI-274).
  const madeBy = `report: ${describeMadeAt(madeAt(APP))}; the twin: ${TWIN_PACKAGES.map((p) => describeVersion(p, packageVersion(APP, p))).join(', ')}`;
  const manifest = loadManifest(manifestFile);

  // Every row is read and every capture loaded before anything is written: an input error leaves no report.
  const jobs: Job[] = [];
  const skipped: string[] = [];
  for (const row of manifest.rows) {
    const cap = readCaptureRow(row, REPORT);
    // readCaptureRow has held the row to the harness's schema: its clock is { mode, t, seq }.
    const clock = (row as { clock: { mode: string } }).clock.mode;
    if (cap.scene.startsWith('field.') && clock !== 'fixed') skipped.push(`not compared: ${cap.name} ${cap.scene} (clock ${clock}: no fixed frame time, so no twin)`);
    else if (cap.scene.startsWith('field.')) jobs.push({ kind: 'field', shot: readFieldShot(row, REPORT) });
    else if (cap.scene.startsWith('fallback.')) jobs.push({ kind: 'fallback', shot: readFallbackShot(row, REPORT) });
    else skipped.push(`not compared: ${cap.name} ${cap.scene} (not a field.* or fallback.* scene)`);
  }
  const captures = await Promise.all(jobs.map((j) => loadCapture(manifest, j.shot)));

  const lines: string[] = [
    `${REPORT} (B8-8a: UI-183 field parity, UI-159 ring-edge crops, UI-211 fallback parity)`,
    `manifest: ${manifest.file} sha256 ${manifest.sha256}`,
    `run: plan ${JSON.stringify(manifest.plan)}, outcome ${JSON.stringify(manifest.outcome)}, commit ${JSON.stringify(manifest.commit)}`,
    madeBy,
    // The twin's one modelled layer, and the rows it may be applied to (UI-272): the library's own words.
    RING_MODEL,
    RING_MODEL_SCOPE,
    `tolerance: ±${TOLERANCE} per channel against the law twin in CanvasKit; this report never widens it: it lists every pixel over it, and the designer rules`,
    `measured, not judged (UI-274): the signed Δ (capture − twin) of each channel, overall and by the twin's value of the channel (${BANDS.map(([lo, hi]) => `${lo}–${hi}`).join(', ')}), and the largest 8-connected group of pixels over ${TOLERANCE}`,
  ];
  const runFailed = manifest.outcome !== 'passed';
  if (runFailed) lines.push(`the capture run failed: ${manifest.failure ?? `outcome ${JSON.stringify(manifest.outcome)}`}`);

  const crops: Array<{ file: string; image: Rgba }> = [];
  const failing: string[] = [];
  let fields = 0;
  let fallbacks = 0;
  // One twin per distinct input, shared across the rows that need it and dropped after the last; the distinct field
  // twins drawn on workers ahead of the walk when there are two or more (UI-239).
  const workerCount = twinWorkerCount(new Set(jobs.filter((j) => j.kind === 'field').map((j) => twinKey(j.kind, j.shot))).size);
  const workers = workerCount > 0 ? fieldTwinWorkers(workerCount) : null;
  const drawField = workers ? (shot: FieldShot) => workers.render(shot) : renderFieldTwin;
  const twins = shareTwins(jobs, (job: Job): Promise<FieldTwin | FallbackTwin> => (job.kind === 'field' ? drawField(job.shot) : renderFallbackTwin(job.shot)), { ahead: 2 * workerCount });
  try {
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      const capture = captures[i];
      const twin = await twins.twinAt(i);
      const regionAt = job.kind === 'field' ? (x: number, y: number) => fieldRegion(twin as FieldTwin, x, y) : fallbackRegioner(twin as FallbackTwin);
      const c = compare(capture, job.shot.stage, twin, regionAt);
      if (job.kind === 'field') fields++;
      else fallbacks++;
      lines.push(`row ${job.shot.name} ${job.shot.scene}: ${job.kind === 'field' ? 'field twin' : 'FieldFallback twin'}, ${c.pixels} px compared, max |Δ| ${c.max}, over ${TOLERANCE}: ${c.over.length}`);
      lines.push(`  |Δ| histogram (largest channel per pixel): ${histogram(c.perPixel)}`);
      ['R', 'G', 'B'].forEach((ch, n) => lines.push(`  |Δ| histogram ${ch}: ${histogram(c.perChannel[n])}`));
      CHANNELS.forEach((ch, n) => {
        lines.push(`  signed Δ ${ch} (capture − twin): ${signedOver(c, n, BANDS.map((_, b) => b))}`);
        BANDS.forEach(([lo, hi], b) => lines.push(`  signed Δ ${ch} where the twin's ${ch} is ${lo}–${hi}: ${signedOver(c, n, [b])}`));
      });
      lines.push(`  over ${TOLERANCE} by region: ${REGIONS.map((r) => `${r} ${c.over.filter((o) => o.region === r).length}`).join(', ')}`);
      const groups = overGroups(c.over, capture.width);
      const g = groups.largest;
      lines.push(g === null
        ? `  largest 8-connected group over ${TOLERANCE}: 0 px (no pixel over ${TOLERANCE})`
        : `  largest 8-connected group over ${TOLERANCE}: ${g.size} px in (${g.x0}, ${g.y0})–(${g.x1}, ${g.y1}), of ${groups.count} group${groups.count === 1 ? '' : 's'}`);
      lines.push(`  not compared: ${c.stageOutside} px of the stage outside the app region (under the system bars), ${c.captureOutside} px of the app region outside the stage`);
      for (const r of REGIONS) {
        for (const o of c.over.filter((v) => v.region === r)) {
          lines.push(`  over ${TOLERANCE} · ${o.region} · (${o.x}, ${o.y}) capture (${o.capture.join(', ')}) twin (${o.twin.join(', ')}) |Δ| (${o.delta.join(', ')})`);
        }
      }
      const ring = ringEdges(job, twin);
      for (const [edge, x] of ring.edges) {
        const at = cropAt(twin, capture, job.shot.stage, x, ring.y);
        const file = `${job.shot.name}.${edge}.x${ZOOM}.png`;
        crops.push({ file, image: cropPanels(capture, job.shot.stage, twin, at) });
        lines.push(`  crop ${edge} ×${ZOOM}: ${file}, ${CROP} × ${CROP} px at (${at.x + job.shot.stage.x}, ${at.y + job.shot.stage.y}), panels: capture | twin | |Δ| × ${DELTA_GAIN}`);
      }
      if (c.over.length > 0) {
        failing.push(job.shot.name);
        lines.push(`  FAIL: ${c.over.length} px over ±${TOLERANCE}`);
      } else {
        lines.push('  PASS');
      }
    }
  } finally {
    await workers?.close();
  }
  lines.push(...skipped);

  let verdict: string;
  if (jobs.length === 0) verdict = 'FAIL: no field.* or fallback.* row to compare';
  else if (failing.length > 0) verdict = `FAIL: ${failing.length} of ${jobs.length} rows have pixels over ±${TOLERANCE} (${failing.join(', ')}); the designer rules`;
  else if (runFailed) verdict = `FAIL: the capture run failed, so its ${jobs.length} rows are not evidence`;
  else verdict = `PASS: ${jobs.length} rows within ±${TOLERANCE} of their twins (${fields} field, ${fallbacks} fallback)${skipped.length > 0 ? `; ${skipped.length} row${skipped.length === 1 ? '' : 's'} not compared, named above` : ''}`;
  lines.push(verdict);
  const text = `${lines.join('\n')}\n`;

  if (crops.length > 0) {
    makeNewDir(cropsDir);
    for (const c of crops) writeNewFile(path.join(cropsDir, c.file), await encodePng(c.image));
  }
  writeNewFile(out, text);
  process.stdout.write(text);
  return verdict.startsWith('PASS') ? 0 : 1;
}

main().then(
  (code) => {
    // exitCode, never process.exit(): exiting while CanvasKit's WebAssembly still has background work trips a libuv
    // assertion on Windows (libuv src/win/async.c, "!(handle->flags & UV_HANDLE_CLOSING)", exit 127 or 0xC0000409).
    process.exitCode = code;
  },
  (e) => {
    process.stderr.write(`${REPORT}: ${e instanceof EvidenceInputError ? '' : 'could not run: '}${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 2;
  },
);
