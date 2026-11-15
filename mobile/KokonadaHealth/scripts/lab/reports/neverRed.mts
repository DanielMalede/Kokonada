// The never-red report (B8-8b; the architect's B8 plan at 199b138, TASKS UI-071; QA-065).
//
//   node scripts/lab/reports/neverRed.mts --manifest <run>/manifest.json --out <report>.txt
//
// Every judged pixel of every capture in the run (the PNG: the app region) is tested by the v2 definition of red, used as
// it is: redBand.ts isRed over neverRedSweeps.ts CHECK_BAND (DEC-081's check band), through lib/evidence.mts
// isCheckBandRed. The band must hold 0 pixels: each pixel in it is listed with its colour (the first 1000 of a row, then
// a count), with the row's count and bounding box.
//
// Every row kind is judged in full (field.*, fallback.*, grain.*, cost.*, storm.* and any other) but a witness.* row,
// which the designer's rule (b) judges at every pixel EXCEPT its planted patches (the P3-misread, double-encoded and
// skip-encode bytes, wrong on purpose, which may land in the band). Their rects are rebuilt from the row's own facts
// (the face, READY's stage, the device's density as Android's px per dp, the app's font scale) through witnessLayout
// (src/design/lab/witness/witnessLayout.ts, imported, never restated), each grown outward by 1 px for its anti-aliased
// edge. A planted rect is excluded only when its sample's median is its paint within ±1; otherwise it is judged in full
// and named, so a misplaced patch can never hide red. Each row prints "not judged: N planted patches, M px" with every
// rect listed. A witness row missing a fact the layout needs is an input error (exit 2). The window insets the witness
// scene will lay out around are not in the manifest yet; until they are, the stage is the window (UI-216).
//
// It prints the report and writes it to --out, which may not exist (a report never overwrites). Exit 0: no judged pixel
// in the band in a passed run; 1: a pixel in the band, a failed capture run, or no row to check; 2: an input it cannot
// use (a manifest field missing or malformed, named; a PNG that is not its row's; an output that exists; no --manifest
// or --out), and no report.

import fs from 'node:fs';
import path from 'node:path';

import { CHECK_BAND } from '../../../src/design/v2/tokens/neverRedSweeps.ts';
import { androidDensity, EvidenceInputError, isCheckBandRed, loadCapture, loadManifest, readCaptureRow, writeNewFile, type CaptureRow, type Rgba } from './lib/evidence.mts';
import { registerTsResolve } from './lib/tsResolve.mjs';

registerTsResolve();
const { witnessLayout } = await import('../../../src/design/lab/witness/witnessLayout.ts');
const { witnessFace } = await import('../../../src/design/lab/witness/witnessFrames.ts');
const { hexBytes } = await import('../../../src/design/v2/color/displayP3.ts');

const REPORT = 'neverRed';
const LISTED = 1000;
/** The witness scene's prefix: its planted patches are off-law on purpose (B8-2). */
const WITNESS = 'witness.';
/** The planted wrong paths (witnessFrames.ts PATCH_KINDS): the only patches ever excluded. */
const PLANTED = new Set(['misreadAsP3', 'doubleEncode', 'skipEncode']);
/** The anti-aliased edge a planted rect is grown by, outward, in px. */
const GROW_PX = 1;
/** How near its paint a planted patch's sample median must be to be excluded (per channel). */
const PAINT_TOLERANCE = 1;

function args(argv: readonly string[]): { manifest: string; out: string } {
  const at = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const manifest = at('--manifest');
  const out = at('--out');
  if (!manifest || !out) throw new EvidenceInputError('usage: node scripts/lab/reports/neverRed.mts --manifest <run>/manifest.json --out <report>.txt');
  return { manifest: path.resolve(manifest), out: path.resolve(out) };
}

// ---------------------------------------------------------------------------------------- a witness row's planted patches

type Rect = { x: number; y: number; width: number; height: number };
interface Exclusion {
  /** Which PNG pixels are not judged (1), by index. */
  readonly mask: Uint8Array;
  readonly lines: string[];
  readonly patches: number;
  readonly pixels: number;
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const triple = (b: readonly number[]) => `(${b.map((x) => Math.round(x * 100) / 100).join(', ')})`;

/** The planted patches of a witness row, from its own facts, and which of its pixels they exclude. */
function witnessExclusion(row: unknown, cap: CaptureRow, img: Rgba): Exclusion {
  const r = row as Record<string, unknown>;
  const refuse = (field: string, why: string): never => {
    throw new EvidenceInputError(`${REPORT}: row ${cap.name}: the manifest field "${field}" ${why}`);
  };
  let face: string;
  try {
    face = witnessFace(cap.scene);
  } catch {
    return refuse('scene', `${JSON.stringify(cap.scene)} is not a witness scene, so its planted patches cannot be rebuilt`);
  }
  const expectFace = isObject(r.expect) ? r.expect.face : undefined;
  if (expectFace === null || expectFace === undefined) refuse('expect.face', 'is missing: the witness layout needs the face');
  if (expectFace !== face) refuse('expect.face', `is ${JSON.stringify(expectFace)}, not the scene's ${face}`);
  // readCaptureRow has held the row to the harness's schema: stage, device.density and fontScale.app are there and typed.
  const stage = r.stage as Rect;
  const k = androidDensity((r.device as { density: number }).density);
  const fontScale = (r.fontScale as { app: number }).app;
  let layout;
  try {
    layout = witnessLayout(face, stage.width / k, stage.height / k, k, fontScale);
  } catch (e) {
    return refuse('stage', `cannot hold the witness layout: ${(e as Error).message}`);
  }
  const ox = stage.x - cap.region.x;
  const oy = stage.y - cap.region.y;
  const mask = new Uint8Array(img.width * img.height);
  const lines: string[] = [];
  let patches = 0;
  for (const p of layout.patches) {
    if (!PLANTED.has(p.kind) || p.paint === null) continue;
    const paint = hexBytes(p.paint) as readonly number[];
    // The sample: the PNG pixels whose centres lie in it.
    const values: number[][] = [[], [], []];
    for (let y = 0; y < img.height; y++) {
      const dy = (y + 0.5 - oy) / k;
      if (dy < p.sample.y || dy >= p.sample.y + p.sample.height) continue;
      for (let x = 0; x < img.width; x++) {
        const dx = (x + 0.5 - ox) / k;
        if (dx < p.sample.x || dx >= p.sample.x + p.sample.width) continue;
        for (let c = 0; c < 3; c++) values[c].push(img.rgba[(y * img.width + x) * 4 + c]);
      }
    }
    const x0 = Math.max(0, Math.floor(ox + p.rect.x * k) - GROW_PX);
    const y0 = Math.max(0, Math.floor(oy + p.rect.y * k) - GROW_PX);
    const x1 = Math.min(img.width, Math.ceil(ox + (p.rect.x + p.rect.width) * k) + GROW_PX);
    const y1 = Math.min(img.height, Math.ceil(oy + (p.rect.y + p.rect.height) * k) + GROW_PX);
    const where = `${p.kind} ${p.colour} · px (${x0}, ${y0}) to (${x1 - 1}, ${y1 - 1})`;
    const m = values[0].length === 0 ? null : values.map(median);
    if (m === null || x1 <= x0 || y1 <= y0) {
      lines.push(`  judged in full · ${where}: no pixel of its sample is in the PNG`);
      continue;
    }
    if (!m.every((v, c) => Math.abs(v - paint[c]) <= PAINT_TOLERANCE)) {
      lines.push(`  judged in full · ${where}: its sample median ${triple(m)} is not its paint ${triple(paint)} within ±${PAINT_TOLERANCE}`);
      continue;
    }
    for (let y = y0; y < y1; y++) mask.fill(1, y * img.width + x0, y * img.width + x1);
    lines.push(`  excluded · ${where}, sample median ${triple(m)} = paint ${triple(paint)} within ±${PAINT_TOLERANCE}`);
    patches++;
  }
  let pixels = 0;
  for (const v of mask) pixels += v;
  return { mask, lines: [`  not judged: ${patches} planted patches, ${pixels} px`, ...lines], patches, pixels };
}

// ---------------------------------------------------------------------------------------- the run

async function main(): Promise<number> {
  const { manifest: manifestFile, out } = args(process.argv.slice(2));
  if (fs.existsSync(out)) throw new EvidenceInputError(`refusing to overwrite ${out}: a report never replaces an earlier one`);
  const manifest = loadManifest(manifestFile);
  const caps = manifest.rows.map((row) => readCaptureRow(row, REPORT));
  const images = await Promise.all(caps.map((cap) => loadCapture(manifest, cap)));
  // Every witness row's exclusions are rebuilt before anything is written: an input error leaves no report.
  const exclusions = caps.map((cap, n) => (cap.scene.startsWith(WITNESS) ? witnessExclusion(manifest.rows[n], cap, images[n]) : null));

  const lines: string[] = [
    `${REPORT} (B8-8b: QA-065 on device captures)`,
    `manifest: ${manifest.file} sha256 ${manifest.sha256}`,
    `run: plan ${JSON.stringify(manifest.plan)}, outcome ${JSON.stringify(manifest.outcome)}, commit ${JSON.stringify(manifest.commit)}`,
    `band: isRed over CHECK_BAND (hue ${CHECK_BAND.hueFrom} to ${CHECK_BAND.hueTo}°, chroma ≥ ${CHECK_BAND.chromaFloor}) of each 8-bit pixel through srgbToOklab: src/design/v2/color/redBand.ts, src/design/v2/tokens/neverRedSweeps.ts`,
  ];
  const runFailed = manifest.outcome !== 'passed';
  if (runFailed) lines.push(`the capture run failed: ${manifest.failure ?? `outcome ${JSON.stringify(manifest.outcome)}`}`);

  const failing: string[] = [];
  let total = 0;
  let red = 0;
  let notJudged = 0;
  caps.forEach((cap, n) => {
    const img = images[n];
    const ex = exclusions[n];
    const found: Array<{ x: number; y: number; rgb: number[] }> = [];
    let count = 0;
    let box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        if (ex !== null && ex.mask[y * img.width + x] === 1) continue;
        const i = (y * img.width + x) * 4;
        if (!isCheckBandRed(img.rgba[i], img.rgba[i + 1], img.rgba[i + 2])) continue;
        count++;
        box = { x0: Math.min(box.x0, x), y0: Math.min(box.y0, y), x1: Math.max(box.x1, x), y1: Math.max(box.y1, y) };
        if (found.length < LISTED) found.push({ x, y, rgb: [img.rgba[i], img.rgba[i + 1], img.rgba[i + 2]] });
      }
    }
    const pixels = img.width * img.height - (ex?.pixels ?? 0);
    total += pixels;
    red += count;
    notJudged += ex?.pixels ?? 0;
    lines.push(ex === null ? `row ${cap.name} ${cap.scene}: ${pixels} px, in the check band: ${count}` : `row ${cap.name} ${cap.scene}: ${pixels} px judged, in the check band: ${count}`);
    if (ex !== null) lines.push(...ex.lines);
    for (const f of found) lines.push(`  in band · (${f.x}, ${f.y}) (${f.rgb.join(', ')})`);
    if (count > found.length) lines.push(`  … and ${count - found.length} more in the band`);
    if (count > 0) {
      lines.push(`  bounding box: (${box.x0}, ${box.y0}) to (${box.x1}, ${box.y1})`);
      lines.push(`  FAIL: ${count} px in the check band`);
      failing.push(cap.name);
    } else {
      lines.push('  PASS');
    }
  });

  const unjudged = notJudged === 0 ? '' : `; ${notJudged} px of planted patches not judged (witness), listed above`;
  let verdict: string;
  if (caps.length === 0) verdict = 'FAIL: no row to check';
  else if (failing.length > 0) verdict = `FAIL: ${failing.length} of ${caps.length} rows have pixels in the check band (${failing.join(', ')}): ${red} px${unjudged}`;
  else if (runFailed) verdict = `FAIL: the capture run failed, so its ${caps.length} rows are not evidence${unjudged}`;
  else verdict = `PASS: ${caps.length} rows, ${total} px, none in the check band${unjudged}`;
  lines.push(verdict);
  const text = `${lines.join('\n')}\n`;
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
