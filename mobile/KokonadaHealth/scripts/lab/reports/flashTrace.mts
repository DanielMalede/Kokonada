// The flash trace report (B8-7; the architect's B8 plan at 199b138; resilience QA-068's S7 and TASKS UI-190).
//
//   node scripts/lab/reports/flashTrace.mts --frames <dir> --px-per-dp <n> --out <report>.txt [options]
//   node scripts/lab/reports/flashTrace.mts --mp4 <file> --ffmpeg <path> --size <w>x<h> --px-per-dp <n> --out <report>.txt
//
// A recording of a storm scene (src/design/lab/storm/), read as a sequence of frames with their timestamps:
//   · S7: per 24 × 24 dp cell, the cell's mean relative luminance over the frames, and its WCAG 2.3.1 general flashes
//     counted by src/design/v2/field/flashCount.ts's own definition (relY and worstFlashesPerSecond, imported and used as
//     they are, never restated). FAIL when any cell has more than 2 flashes in any 1 s window.
//   · UI-190: for each change of the storm marker (storm/stormMarker.ts), the frames and the ms from the marker's change
//     to the first frame where a field cell's mean differs from the last frame before it. Marker and taps change in one
//     commit (StormScene.tsx), so the latency is measured on one clock, the recording's, with no clock alignment.
//     Informational: the designer reads it (UI-190); the quiet before each change is printed beside it.
//   · The cells the marker covers are left out of both. A recording where the marker never changes is a FAIL: it is not
//     a storm recording, or the marker rect is wrong, and nothing it says can be trusted.
// Abyss dark only (package 3; S7 also names Basin dark, which is not built). The CTA and voice-line regions need the
// hero (B6) and are not read here.
//
// The input is pluggable:
//   --frames <dir>   a folder of PNG frames and frames.json, { "frames": [{ "file": "<name>.png", "tMs": <ms> }] }, in
//                    time order, every frame the same size: what the planted fixtures are and what any decoder writes.
//   --mp4 <file>     screenrecord's mp4, decoded by the ffmpeg at --ffmpeg (5.1 or later, for -fps_mode): every frame as
//                    decoded (passthrough, so a variable frame rate is kept), its time from showinfo's pts_time on
//                    stderr, its pixels as rgba on stdout at --size (the record proof's size). No ffmpeg is given, none
//                    is installed with the repository, and installing one is the owner's call: without --ffmpeg the
//                    route is refused, naming the tool.
// Frames come at their own times (screenrecord writes a frame only when the screen changes). The luminance traces are held
// to a grid of the smallest frame interval, each frame until the next, so no frame is dropped and flashCount reads a
// uniform trace, as its definition takes it.
//
// Options: --region x,y,w,h (frame px, default the whole frame: give the app region scaled to the recording to leave the
// system bars out), --marker x,y,w,h (frame px, default the marker's dp rect × --px-per-dp; READY's marker probe scaled to
// the recording is exact), --change-min <codes> (a field cell changed when a channel of its mean moved by at least this
// many 8-bit code values, default 1), --marker-min <codes> (the same for the marker, default 8; its two colours are about
// 20 apart).
//
// Exit 0: PASS. Exit 1: FAIL. Exit 2: an input it cannot use, named, and no report; it never overwrites a report.

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { STORM_MARKER_DP } from '../../../src/design/lab/storm/stormMarker.ts';
import { relY, worstFlashesPerSecond } from '../../../src/design/v2/field/flashCount.ts';
import { decodePng } from '../lib/png.mjs';

const REPORT = 'flashTrace';
/** S7: at most this many general flashes per cell in any 1 s window. */
const MOST_FLASHES = 2;
const CELL_DP = 24;
/** A latency counts in the summary when the field had been still this long before the marker changed. */
const QUIET_MS = 1000;

export class FlashInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlashInputError';
  }
}

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const fmt = (v: number) => {
  const s = String(Number(v.toFixed(3)));
  return s === '-0' ? '0' : s;
};
const rectText = (r: Rect) => `${r.x},${r.y} ${r.width}x${r.height}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------------------- the arguments

interface Args {
  readonly frames: string | null;
  readonly mp4: string | null;
  readonly ffmpeg: string | null;
  readonly size: { width: number; height: number } | null;
  readonly pxPerDp: number;
  readonly out: string;
  readonly region: Rect | null;
  readonly marker: Rect | null;
  readonly changeMin: number;
  readonly markerMin: number;
}

const OPTIONS = ['--frames', '--mp4', '--ffmpeg', '--size', '--px-per-dp', '--out', '--region', '--marker', '--change-min', '--marker-min'];

function parseRect(v: string, name: string): Rect {
  const p = v.split(',').map(Number);
  if (p.length !== 4 || !p.every((x) => Number.isInteger(x) && x >= 0) || p[2] === 0 || p[3] === 0) {
    throw new FlashInputError(`${REPORT}: ${name} must be x,y,width,height in whole frame px with an area, got ${JSON.stringify(v)}`);
  }
  return { x: p[0], y: p[1], width: p[2], height: p[3] };
}

function positive(v: string | undefined, name: string, fallback: number | null): number {
  if (v === undefined && fallback !== null) return fallback;
  const n = Number(v);
  if (v === undefined || !Number.isFinite(n) || !(n > 0)) throw new FlashInputError(`${REPORT}: ${name} must be a number above 0, got ${JSON.stringify(v ?? null)}`);
  return n;
}

function parseArgs(argv: readonly string[]): Args {
  const v: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    if (!OPTIONS.includes(k)) throw new FlashInputError(`${REPORT}: unknown option ${k}`);
    if (argv[i + 1] === undefined) throw new FlashInputError(`${REPORT}: ${k} needs a value`);
    v[k] = argv[i + 1];
  }
  if (v['--out'] === undefined) throw new FlashInputError(`${REPORT}: --out <report> is required`);
  if ((v['--frames'] === undefined) === (v['--mp4'] === undefined)) throw new FlashInputError(`${REPORT}: give --frames <dir> or --mp4 <file>, exactly one`);
  const pxPerDp = positive(v['--px-per-dp'], '--px-per-dp (frame px per dp)', null);
  let size: Args['size'] = null;
  if (v['--size'] !== undefined) {
    const m = /^(\d+)x(\d+)$/.exec(v['--size']);
    if (!m || Number(m[1]) === 0 || Number(m[2]) === 0) throw new FlashInputError(`${REPORT}: --size must be <width>x<height>, got ${JSON.stringify(v['--size'])}`);
    size = { width: Number(m[1]), height: Number(m[2]) };
  }
  return {
    frames: v['--frames'] ?? null,
    mp4: v['--mp4'] ?? null,
    ffmpeg: v['--ffmpeg'] ?? null,
    size,
    pxPerDp,
    out: v['--out'],
    region: v['--region'] === undefined ? null : parseRect(v['--region'], '--region'),
    marker: v['--marker'] === undefined ? null : parseRect(v['--marker'], '--marker'),
    changeMin: positive(v['--change-min'], '--change-min', 1),
    markerMin: positive(v['--marker-min'], '--marker-min', 8),
  };
}

// ---------------------------------------------------------------------------------------- the analysis

// flashCount's relY is linear in the three linearised channels, with each channel alone giving its own term exactly
// (the other two add 0), so a pixel's relY is LR[r] + LG[g] + LB[b], summed in relY's own order: the same number, read
// from the definition itself, at a table lookup a pixel.
const LR = Float64Array.from({ length: 256 }, (_, c) => relY([c, 0, 0]));
const LG = Float64Array.from({ length: 256 }, (_, c) => relY([0, c, 0]));
const LB = Float64Array.from({ length: 256 }, (_, c) => relY([0, 0, c]));

interface CellRef {
  readonly col: number;
  readonly row: number;
}

/** Per-frame statistics, frame by frame, so a long recording is never held in memory as pixels. */
class Analyzer {
  readonly cols: number;
  readonly rows: number;
  readonly cellPx: number;
  readonly region: Rect;
  readonly marker: Rect;
  readonly excluded: Uint8Array;
  private readonly cellOf: Int32Array;
  private readonly pixels: Float64Array;
  readonly y: Float64Array[] = [];
  readonly rgb: Float32Array[] = [];
  readonly markerRgb: Array<[number, number, number]> = [];

  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number, pxPerDp: number, region: Rect | null, marker: Rect | null) {
    this.width = width;
    this.height = height;
    this.region = region ?? { x: 0, y: 0, width, height };
    const r = this.region;
    if (r.x + r.width > width || r.y + r.height > height) throw new FlashInputError(`${REPORT}: --region ${rectText(r)} is not inside the ${width}x${height} px frame`);
    const mx = Math.floor(STORM_MARKER_DP.left * pxPerDp);
    const my = Math.floor(STORM_MARKER_DP.top * pxPerDp);
    this.marker = marker ?? {
      x: mx, y: my,
      width: Math.ceil((STORM_MARKER_DP.left + STORM_MARKER_DP.size) * pxPerDp) - mx,
      height: Math.ceil((STORM_MARKER_DP.top + STORM_MARKER_DP.size) * pxPerDp) - my,
    };
    const m = this.marker;
    if (m.x + m.width > width || m.y + m.height > height) throw new FlashInputError(`${REPORT}: the marker ${rectText(m)} is not inside the ${width}x${height} px frame`);
    this.cellPx = CELL_DP * pxPerDp;
    this.cols = Math.ceil(r.width / this.cellPx);
    this.rows = Math.ceil(r.height / this.cellPx);
    const n = this.cols * this.rows;
    this.excluded = new Uint8Array(n);
    this.cellOf = new Int32Array(r.width * r.height);
    this.pixels = new Float64Array(n);
    for (let y = 0; y < r.height; y++) {
      for (let x = 0; x < r.width; x++) {
        const c = Math.floor(y / this.cellPx) * this.cols + Math.floor(x / this.cellPx);
        this.cellOf[y * r.width + x] = c;
        this.pixels[c] += 1;
        const fx = r.x + x;
        const fy = r.y + y;
        if (fx >= m.x && fx < m.x + m.width && fy >= m.y && fy < m.y + m.height) this.excluded[c] = 1;
      }
    }
  }

  get cells(): number {
    return this.cols * this.rows;
  }

  add(rgba: Uint8Array, at: string): void {
    if (rgba.length !== this.width * this.height * 4) throw new FlashInputError(`${REPORT}: ${at} has ${rgba.length} bytes, not ${this.width}x${this.height} rgba`);
    const n = this.cells;
    const y = new Float64Array(n);
    const sum = new Float64Array(3 * n);
    const r = this.region;
    for (let py = 0; py < r.height; py++) {
      let i = ((r.y + py) * this.width + r.x) * 4;
      const row = py * r.width;
      for (let px = 0; px < r.width; px++, i += 4) {
        const c = this.cellOf[row + px];
        if (this.excluded[c] === 1) continue;
        y[c] += LR[rgba[i]] + LG[rgba[i + 1]] + LB[rgba[i + 2]];
        sum[3 * c] += rgba[i];
        sum[3 * c + 1] += rgba[i + 1];
        sum[3 * c + 2] += rgba[i + 2];
      }
    }
    const rgb = new Float32Array(3 * n);
    for (let c = 0; c < n; c++) {
      y[c] /= this.pixels[c];
      for (let k = 0; k < 3; k++) rgb[3 * c + k] = sum[3 * c + k] / this.pixels[c];
    }
    const m = this.marker;
    const ms: [number, number, number] = [0, 0, 0];
    for (let py = m.y; py < m.y + m.height; py++) {
      for (let px = m.x; px < m.x + m.width; px++) {
        const i = (py * this.width + px) * 4;
        ms[0] += rgba[i];
        ms[1] += rgba[i + 1];
        ms[2] += rgba[i + 2];
      }
    }
    const area = m.width * m.height;
    this.y.push(y);
    this.rgb.push(rgb);
    this.markerRgb.push([ms[0] / area, ms[1] / area, ms[2] / area]);
  }

  /** The first field cell, row by row, whose mean moved by at least `min` codes from frame a to frame b; or null. */
  changed(a: number, b: number, min: number): CellRef | null {
    const A = this.rgb[a];
    const B = this.rgb[b];
    for (let c = 0; c < this.cells; c++) {
      if (this.excluded[c] === 1) continue;
      for (let k = 0; k < 3; k++) {
        if (Math.abs(B[3 * c + k] - A[3 * c + k]) >= min) return { col: c % this.cols, row: Math.floor(c / this.cols) };
      }
    }
    return null;
  }
}

/** The frames' times held to a uniform grid of the smallest interval: for each grid point, the last frame at or before it. */
function holdGrid(times: readonly number[]): { step: number; index: number[] } {
  let step = Infinity;
  for (let i = 1; i < times.length; i++) step = Math.min(step, times[i] - times[i - 1]);
  const span = times[times.length - 1] - times[0];
  const points = Math.ceil(span / step - 1e-9) + 1;
  const index: number[] = [];
  const eps = step * 1e-6;
  for (let j = 0, f = 0; j < points; j++) {
    const g = times[0] + j * step + eps;
    while (f + 1 < times.length && times[f + 1] <= g) f++;
    index.push(f);
  }
  return { step, index };
}

function analyse(an: Analyzer, times: readonly number[], a: Args, source: string): { text: string; code: number } {
  if (times.length !== an.y.length) throw new FlashInputError(`${REPORT}: ${times.length} timestamps for ${an.y.length} frames`);
  const { step, index } = holdGrid(times);
  const lines: string[] = [
    `${REPORT} (B8-7: QA-068's S7 and UI-190), Abyss dark only; the CTA and voice-line regions need the hero (B6) and are not read`,
    `source: ${source}`,
    `frames: ${times.length}, ${fmt(times[0])} to ${fmt(times[times.length - 1])} ms; held to a ${fmt(step)} ms grid (each frame until the next, none dropped)`,
  ];
  const left = an.excluded.reduce((s, x) => s + x, 0);
  lines.push(`grid: ${CELL_DP} dp cells of ${fmt(an.cellPx)} px at ${fmt(a.pxPerDp)} px per dp over ${rectText(an.region)} px: ${an.cells} cells, ${left} under the marker left out`);

  const markerChanges: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const p = an.markerRgb[i - 1];
    const q = an.markerRgb[i];
    if (Math.max(Math.abs(q[0] - p[0]), Math.abs(q[1] - p[1]), Math.abs(q[2] - p[2])) >= a.markerMin) markerChanges.push(i);
  }
  lines.push(`marker: ${rectText(an.marker)} px, ${plural(markerChanges.length, 'change', 'changes')}`);

  // S7
  lines.push(`S7 flashes (WCAG 2.3.1 general flashes, by src/design/v2/field/flashCount.ts): at most ${MOST_FLASHES} per cell in any 1 s window`);
  let worst = -1;
  let worstAt: CellRef = { col: 0, row: 0 };
  const over: Array<{ cell: CellRef; n: number }> = [];
  for (let c = 0; c < an.cells; c++) {
    if (an.excluded[c] === 1) continue;
    const trace = index.map((f) => an.y[f][c]);
    const n = worstFlashesPerSecond(trace, step);
    const cell = { col: c % an.cols, row: Math.floor(c / an.cols) };
    if (n > worst) {
      worst = n;
      worstAt = cell;
    }
    if (n > MOST_FLASHES) over.push({ cell, n });
  }
  const dpOf = (cell: CellRef) => `${fmt(an.region.x / a.pxPerDp + cell.col * CELL_DP)},${fmt(an.region.y / a.pxPerDp + cell.row * CELL_DP)}`;
  lines.push(`  worst: ${worst} in cell ${worstAt.col},${worstAt.row} (dp ${dpOf(worstAt)} ${CELL_DP}x${CELL_DP})`);
  const listed = over.slice(0, 20).map((o) => `cell ${o.cell.col},${o.cell.row}: ${o.n}`);
  if (over.length > 20) listed.push(`+${over.length - 20} more`);
  lines.push(`  over ${MOST_FLASHES}: ${over.length === 0 ? 'none' : listed.join('; ')}`);

  // UI-190
  lines.push(`UI-190 latency: from each marker change to the first field cell whose mean moved by at least ${fmt(a.changeMin)} code value${a.changeMin === 1 ? '' : 's'}`);
  const moved: boolean[] = times.map((_, i) => i > 0 && an.changed(i - 1, i, a.changeMin) !== null);
  const quiet: Array<{ frames: number; ms: number }> = [];
  if (markerChanges.length === 0) lines.push('  no marker change: nothing to measure from');
  markerChanges.forEach((m, k) => {
    let q = m - 1;
    while (q > 0 && !moved[q]) q--;
    const still = times[m - 1] - times[q];
    const end = k + 1 < markerChanges.length ? markerChanges[k + 1] : times.length;
    let hit: { f: number; cell: CellRef } | null = null;
    for (let f = m; f < end && hit === null; f++) {
      const cell = an.changed(m - 1, f, a.changeMin);
      if (cell !== null) hit = { f, cell };
    }
    const head = `  change ${k + 1} at frame ${m} (${fmt(times[m])} ms), quiet ${fmt(still)} ms before: `;
    if (hit === null) {
      lines.push(`${head}no field change before ${k + 1 < markerChanges.length ? 'the next marker change' : 'the recording ends'}`);
      return;
    }
    const ms = times[hit.f] - times[m];
    lines.push(`${head}first field change at frame ${hit.f} (${fmt(times[hit.f])} ms), ${plural(hit.f - m, 'frame', 'frames')}, ${fmt(ms)} ms, cell ${hit.cell.col},${hit.cell.row}`);
    if (still >= QUIET_MS) quiet.push({ frames: hit.f - m, ms });
  });
  if (quiet.length === 0) lines.push(`  after at least ${QUIET_MS} ms quiet: none`);
  else {
    const fr = quiet.map((x) => x.frames);
    const ms = quiet.map((x) => x.ms);
    lines.push(`  after at least ${QUIET_MS} ms quiet: ${plural(quiet.length, 'change', 'changes')}, ${Math.min(...fr)} to ${Math.max(...fr)} frames, ${fmt(Math.min(...ms))} to ${fmt(Math.max(...ms))} ms`);
  }

  let verdict: string;
  if (over.length > 0) verdict = `FAIL: ${plural(over.length, 'cell', 'cells')} over ${MOST_FLASHES} flashes in a 1 s window (worst ${worst}, cell ${worstAt.col},${worstAt.row})`;
  else if (markerChanges.length === 0) verdict = 'FAIL: the marker never changed, so this is not a storm recording or the marker rect is wrong';
  else verdict = `PASS: every cell at most ${MOST_FLASHES} flashes in any 1 s window (worst ${worst}); ${plural(markerChanges.length, 'marker change', 'marker changes')} read`;
  lines.push(verdict);
  return { text: `${lines.join('\n')}\n`, code: verdict.startsWith('PASS') ? 0 : 1 };
}

// ---------------------------------------------------------------------------------------- input 1: PNG frames

const sha256 = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

async function readFrameDir(dir: string, a: Args): Promise<{ an: Analyzer; times: number[]; source: string }> {
  const listFile = path.join(dir, 'frames.json');
  if (!fs.existsSync(listFile)) throw new FlashInputError(`${REPORT}: no frames.json in ${dir}`);
  const raw = fs.readFileSync(listFile);
  let list: unknown;
  try {
    list = JSON.parse(raw.toString('utf8'));
  } catch (e) {
    throw new FlashInputError(`${REPORT}: frames.json is not JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const frames = (list as { frames?: unknown }).frames;
  if (!Array.isArray(frames) || frames.length < 2) throw new FlashInputError(`${REPORT}: frames.json must hold { "frames": [...] } with at least 2 frames`);
  const times: number[] = [];
  // One hash over the list and every frame in its order: the list alone names only file names and times.
  const hash = crypto.createHash('sha256').update(raw);
  let an: Analyzer | null = null;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i] as { file?: unknown; tMs?: unknown };
    if (typeof f?.file !== 'string' || f.file !== path.basename(f.file) || !f.file.endsWith('.png')) {
      throw new FlashInputError(`${REPORT}: frames[${i}].file ${JSON.stringify(f?.file ?? null)} must be a .png file name beside frames.json`);
    }
    if (typeof f.tMs !== 'number' || !Number.isFinite(f.tMs)) throw new FlashInputError(`${REPORT}: frames[${i}].tMs must be a finite number of ms`);
    if (i > 0 && !(f.tMs > times[i - 1])) throw new FlashInputError(`${REPORT}: frames[${i}].tMs ${f.tMs} must rise: frames[${i - 1}].tMs is ${times[i - 1]}`);
    times.push(f.tMs);
    const file = path.join(dir, f.file);
    if (!fs.existsSync(file)) throw new FlashInputError(`${REPORT}: frames[${i}] (${f.file}) is not in ${dir}`);
    let png: { width: number; height: number; rgba: Uint8Array };
    try {
      const bytes = fs.readFileSync(file);
      hash.update(bytes);
      png = await decodePng(bytes);
    } catch (e) {
      throw new FlashInputError(`${REPORT}: frames[${i}] (${f.file}): ${e instanceof Error ? e.message : String(e)}`);
    }
    if (an === null) an = new Analyzer(png.width, png.height, a.pxPerDp, a.region, a.marker);
    else if (png.width !== an.width || png.height !== an.height) {
      throw new FlashInputError(`${REPORT}: frames[${i}] (${f.file}) is ${png.width}x${png.height} px, frames[0] is ${an.width}x${an.height} px`);
    }
    an.add(png.rgba, `frames[${i}] (${f.file})`);
  }
  return { an: an!, times, source: `frames ${dir} (frames.json and its ${frames.length} PNGs, sha256 ${hash.digest('hex')})` };
}

// ---------------------------------------------------------------------------------------- input 2: screenrecord's mp4

/** ffmpeg's arguments: every decoded frame (no rate conversion), showinfo for its time, rgba frames on stdout. */
export function ffmpegArgs(mp4: string): string[] {
  return ['-hide_banner', '-nostdin', '-loglevel', 'info', '-i', mp4, '-map', '0:v:0', '-fps_mode', 'passthrough',
    '-vf', 'showinfo', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'];
}

const SHOWINFO = /\[Parsed_showinfo_\d+ @ [^\]]+\]\s+n:\s*(\d+)\s+pts:\s*-?\d+\s+pts_time:\s*(-?\d+(?:\.\d+)?)\s.*?\bs:(\d+)x(\d+)/;

/** showinfo's per-frame lines from ffmpeg's stderr: index, time in ms (to 1e-6 ms) and size. Other lines are ignored. */
export function parseShowinfo(text: string): Array<{ n: number; tMs: number; width: number; height: number }> {
  const out: Array<{ n: number; tMs: number; width: number; height: number }> = [];
  for (const line of text.split(/\r?\n/)) {
    const m = SHOWINFO.exec(line);
    if (m) out.push({ n: Number(m[1]), tMs: Math.round(Number(m[2]) * 1e9) / 1e6, width: Number(m[3]), height: Number(m[4]) });
  }
  return out;
}

/** Whole rgba frames out of a byte stream that arrives in chunks of any size. */
export class RawFrameSplitter {
  private pending: Buffer = Buffer.alloc(0);
  private total = 0;
  readonly frameBytes: number;
  readonly width: number;
  readonly height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.frameBytes = width * height * 4;
  }
  push(chunk: Buffer): Buffer[] {
    this.total += chunk.length;
    this.pending = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk]);
    const frames: Buffer[] = [];
    while (this.pending.length >= this.frameBytes) {
      frames.push(Buffer.from(this.pending.subarray(0, this.frameBytes)));
      this.pending = this.pending.subarray(this.frameBytes);
    }
    return frames;
  }
  end(): void {
    if (this.pending.length !== 0) throw new FlashInputError(`${REPORT}: ${this.total} bytes is not a whole number of ${this.width}x${this.height} rgba frames`);
  }
}

/** The frames of a whole stdout, for the adapter's tests. */
export function splitRawFrames(chunks: readonly Buffer[], width: number, height: number): Buffer[] {
  const s = new RawFrameSplitter(width, height);
  const frames = chunks.flatMap((c) => s.push(Buffer.from(c)));
  s.end();
  return frames;
}

function checkMp4Args(a: Args): { mp4: string; ffmpeg: string; size: { width: number; height: number } } {
  if (a.ffmpeg === null) {
    throw new FlashInputError(`${REPORT}: --mp4 needs --ffmpeg <path>: no ffmpeg was given, and none is installed with this repository; `
      + 'installing one waits for the owner\'s approval, so decode the mp4 to a --frames folder elsewhere or wait for it');
  }
  if (!fs.existsSync(a.ffmpeg)) throw new FlashInputError(`${REPORT}: ffmpeg not found at ${a.ffmpeg}`);
  if (a.size === null) throw new FlashInputError(`${REPORT}: --mp4 needs --size <width>x<height>: the record proof's size (the manifest's records[].size)`);
  if (!fs.existsSync(a.mp4!)) throw new FlashInputError(`${REPORT}: no mp4 at ${a.mp4}`);
  return { mp4: a.mp4!, ffmpeg: a.ffmpeg, size: a.size };
}

async function readMp4(a: Args): Promise<{ an: Analyzer; times: number[]; source: string }> {
  const { mp4, ffmpeg, size } = checkMp4Args(a);
  const an = new Analyzer(size.width, size.height, a.pxPerDp, a.region, a.marker);
  const split = new RawFrameSplitter(size.width, size.height);
  let stderr = '';
  let count = 0;
  const code = await new Promise<number | null>((resolve, reject) => {
    const p = spawn(ffmpeg, ffmpegArgs(mp4), { stdio: ['ignore', 'pipe', 'pipe'] });
    p.on('error', (e) => reject(new FlashInputError(`${REPORT}: ffmpeg at ${ffmpeg} could not start: ${e.message}`)));
    p.stderr.setEncoding('utf8');
    p.stderr.on('data', (d: string) => { stderr += d; });
    p.stdout.on('data', (d: Buffer) => {
      try {
        for (const f of split.push(d)) an.add(new Uint8Array(f.buffer, f.byteOffset, f.byteLength), `mp4 frame ${count++}`);
      } catch (e) {
        p.kill();
        reject(e);
      }
    });
    p.on('close', (c) => resolve(c));
  });
  if (code !== 0) throw new FlashInputError(`${REPORT}: ffmpeg exited ${code}: ${stderr.trim().split(/\r?\n/).slice(-3).join(' | ')}`);
  split.end();
  const info = parseShowinfo(stderr);
  if (info.length !== count) throw new FlashInputError(`${REPORT}: ffmpeg gave ${count} frames and ${info.length} showinfo lines`);
  info.forEach((x, i) => {
    if (x.n !== i) throw new FlashInputError(`${REPORT}: showinfo line ${i} is frame n ${x.n}`);
    if (x.width !== size.width || x.height !== size.height) throw new FlashInputError(`${REPORT}: frame ${i} is ${x.width}x${x.height}, not --size ${size.width}x${size.height}`);
    if (i > 0 && !(x.tMs > info[i - 1].tMs)) throw new FlashInputError(`${REPORT}: frame ${i}'s time ${x.tMs} ms must rise: frame ${i - 1}'s is ${info[i - 1].tMs} ms`);
  });
  if (count < 2) throw new FlashInputError(`${REPORT}: the mp4 holds ${count} frame${count === 1 ? '' : 's'}, at least 2 are needed`);
  return { an, times: info.map((x) => x.tMs), source: `mp4 ${mp4} (sha256 ${sha256(fs.readFileSync(mp4))}) through ${ffmpeg}` };
}

// ---------------------------------------------------------------------------------------- the run

async function main(): Promise<number> {
  const a = parseArgs(process.argv.slice(2));
  if (fs.existsSync(a.out)) throw new FlashInputError(`${REPORT}: refusing to overwrite ${a.out}: a report never replaces an earlier one`);
  const input = a.frames !== null ? await readFrameDir(a.frames, a) : await readMp4(a);
  const { text, code } = analyse(input.an, input.times, a, input.source);
  fs.writeFileSync(a.out, text, { flag: 'wx' });
  process.stdout.write(text);
  return code;
}

// exitCode, never process.exit() (reportsCanvasKitExit.test.ts): png.mjs loads CanvasKit. Imported (the adapter's tests),
// it runs nothing.
const invoked = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main().then((code) => {
    process.exitCode = code;
  }, (e: unknown) => {
    process.stderr.write(`${e instanceof FlashInputError ? '' : `${REPORT}: could not run: `}${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 2;
  });
}
