// The colour-path report (B8-8d; the architect's B8 plan at 199b138; B4 fork 2E, tests D1–D5; the designer's 3c
// amendments; TASKS UI-071).
//
//   node scripts/lab/reports/colourPath.mts --manifest <run>/manifest.json --out <report>.txt
//
// For each witness.abyss.<face> row of a capture run it rebuilds the witness layout (src/design/lab/witness/
// witnessLayout.ts, imported, never restated) from the row's own facts: the insets (READY's stage less its region probe,
// each rounded to whole px), the stage in dp (READY's stage rect in px over
// px per dp, the density over 160, as PixelRatio.get() reads it), and the font scale the app reported. It samples each
// patch's central 16 × 16 dp (the PNG pixels whose centres lie inside) and judges, on the medians per channel (D2):
//   · W1a (the runtime effect, flat), W2 (a Skia paint) and W3 (a React Native View): the token hex within ±1, and
//     within ±1 of each other;
//   · W1b (the production field): the median of (capture − the law's noise-free colour at each pixel's centre) within ±1;
//   · each planted patch (misreadAsP3, doubleEncode, skipEncode) the layout marks `separates`: more than
//     MODEL_SEPARATION_LSB from the hex, or the instrument is blind to that wrong path (D3, D5); a planted patch that does
//     not separate (identity-only, as the ground's misread) is listed and not judged;
//   · a true patch that fails and shows a separating model's bytes (within ±1) names that model as the diagnosis.
// Byte evidence counts only in the display's sRGB/Natural colour mode (the harness's rule; the designer's 3c amendment
// 6): a row whose display.colorMode is unknown or another mode (Vivid is ColorMode::NATIVE) is listed as eyes-on only,
// never judged and never evidence. A witness discrepancy is a STOP for the designer's ruling.
//
// Exit 0: every evidence row passes in a passed run. 1: a failed judgement, a blind instrument, no witness row, no
// witness row as evidence, or a failed run. 2: an input it cannot use (a field missing or malformed, named; a PNG that is
// not its row's; an existing report), and no report. The rows' own facts are read here through a typed reader built
// against scripts/lab/lib/manifest.mjs's schema.

import fs from 'node:fs';
import path from 'node:path';

import { EvidenceInputError, loadCapture, loadManifest, readCaptureRow, writeNewFile, type CaptureRow, type Rgba } from './lib/evidence.mts';
import { registerTsResolve } from './lib/tsResolve.mjs';

registerTsResolve();
const { witnessLayout } = await import('../../../src/design/lab/witness/witnessLayout.ts');
const { noiseFree, w1bFrame, witnessColours, witnessFace } = await import('../../../src/design/lab/witness/witnessFrames.ts');
const { MODEL_SEPARATION_LSB, WITNESS_MODELS, lsbDelta } = await import('../../../src/design/v2/color/displayP3.ts');
const { fieldPixel } = await import('../../../src/design/v2/field/fieldLaw.ts');

const REPORT = 'colourPath';
/** ±1 per channel on a patch's median (D2). Not this report's to widen. */
const TOLERANCE = 1;
const SRGB_MODE = /^ColorMode::SRGB\b/;
const TRUE_KINDS = ['W1a', 'W2', 'W3'] as const;
const WHY: Readonly<Record<string, string>> = {
  misreadAsP3: 'the display path reads the sRGB bytes as Display-P3',
  doubleEncode: 'the path encodes the bytes twice',
  skipEncode: 'the path skips the encode: linear light written as bytes',
};

type Bytes = readonly [number, number, number];
type Face = 'dark' | 'light';
interface Rect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

function args(argv: readonly string[]): { manifest: string; out: string } {
  const at = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const manifest = at('--manifest');
  const out = at('--out');
  if (!manifest || !out) throw new EvidenceInputError(`usage: node scripts/lab/reports/${REPORT}.mts --manifest <run>/manifest.json --out <report>.txt`);
  return { manifest: path.resolve(manifest), out: path.resolve(out) };
}

// ---------------------------------------------------------------------------------------- the row's facts

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

interface WitnessRow {
  readonly cap: CaptureRow;
  readonly face: Face;
  /** READY's stage rect, in screen px. */
  readonly stage: Rect;
  readonly pxPerDp: number;
  readonly fontScale: number;
  readonly colorMode: string | null;
  readonly renderScale: number;
  /** The insets the scene laid out inside, in whole px: READY's stage less its region probe (witnessInsets.ts). */
  readonly insetsPx: { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number };
}

/** A witness row's facts (manifest.mjs's schema), or a refusal naming the field. */
function readWitnessRow(row: unknown): WitnessRow {
  const cap = readCaptureRow(row, REPORT);
  const r = row as Record<string, unknown>;
  const refuse = (field: string, why: string): never => {
    throw new EvidenceInputError(`${REPORT}: row ${cap.name}: the manifest field "${field}" ${why}`);
  };
  /** The value at a dotted path; the first missing step is refused. */
  const need = (dotted: string, nullable = false): unknown => {
    let at: unknown = r;
    const keys = dotted.split('.');
    for (let i = 0; i < keys.length; i++) {
      if (!isObject(at) || !(keys[i] in at) || (at[keys[i]] === null && !(nullable && i === keys.length - 1))) refuse(keys.slice(0, i + 1).join('.'), 'is missing');
      at = (at as Record<string, unknown>)[keys[i]];
    }
    return at;
  };
  let face: Face;
  try {
    face = witnessFace(cap.scene) as Face;
  } catch {
    return refuse('scene', `${JSON.stringify(cap.scene)} is not a witness scene`);
  }
  if (need('expect.face') !== face) refuse('expect.face', `is ${JSON.stringify(r.expect && (r.expect as Record<string, unknown>).face)}, not the scene's ${face}`);
  const stage: Record<string, number> = {};
  need('stage');
  for (const k of ['x', 'y', 'width', 'height']) {
    const v = need(`stage.${k}`);
    if (!finite(v)) refuse(`stage.${k}`, `must be a finite number, got ${JSON.stringify(v)}`);
    stage[k] = v as number;
  }
  if (!(stage.width > 0 && stage.height > 0)) refuse('stage', 'has no area');
  const density = need('device.density');
  if (!Number.isInteger(density) || (density as number) < 1) refuse('device.density', `must be a whole number of 1 or more (dpi), got ${JSON.stringify(density)}`);
  const fontScale = need('fontScale.app');
  if (!finite(fontScale) || !(fontScale > 0)) refuse('fontScale.app', `must be a finite number above 0, got ${JSON.stringify(fontScale)}`);
  const colorMode = need('display.colorMode', true);
  if (colorMode !== null && typeof colorMode !== 'string') refuse('display.colorMode', `must be a string or null, got ${JSON.stringify(colorMode)}`);
  const renderScale = need('renderScale');
  if (!finite(renderScale)) refuse('renderScale', `must be a finite number, got ${JSON.stringify(renderScale)}`);
  const s = stage as unknown as Rect;
  // The stage may run under the system bars (the lab window is edge to edge): the scene lays out inside READY's region
  // probe, the stage less its insets. The harness keeps it as probes.inside.region (whole px, clamped to the app region)
  // or, when it ran under a bar, as an excluded probe with its exact px; each inset is rounded to whole px.
  const excluded = isObject(r.probes) && Array.isArray(r.probes.excluded) ? (r.probes.excluded as Array<Record<string, unknown>>).find((e) => e.id === 'region') : undefined;
  const probe = (excluded?.px ?? (isObject(r.probes) && isObject(r.probes.inside) ? r.probes.inside.region : undefined)) as Record<string, unknown> | undefined;
  if (!isObject(probe) || !['x', 'y', 'width', 'height'].every((key) => finite(probe[key]))) refuse('probes.inside.region', 'is missing: the witness lays out inside READY’s region probe, so its insets cannot be read');
  const p = probe as unknown as Rect;
  const insetsPx = {
    top: Math.round(p.y - s.y), right: Math.round(s.x + s.width - (p.x + p.width)), bottom: Math.round(s.y + s.height - (p.y + p.height)), left: Math.round(p.x - s.x),
  };
  if (Object.values(insetsPx).some((v) => v < 0)) refuse('probes.inside.region', `${JSON.stringify(p)} is not inside the stage ${JSON.stringify(s)}`);
  return { cap, face, stage: s, pxPerDp: (density as number) / 160, fontScale: fontScale as number, colorMode: colorMode as string | null, renderScale: renderScale as number, insetsPx };
}

// ---------------------------------------------------------------------------------------- sampling

const median = (v: number[]): number => {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const fmt = (x: number) => String(Math.round(x * 100) / 100);
const fmt3 = (x: number) => String(Math.round(x * 1000) / 1000);
const triple = (b: readonly number[]) => `(${b.map(fmt).join(', ')})`;
const delta = (a: readonly number[], b: readonly number[]) => Math.max(...[0, 1, 2].map((c) => Math.abs(a[c] - b[c])));

/** The PNG pixels whose centres lie in a stage rect in dp, with each centre's position on the stage in dp. */
function pixelsIn(w: WitnessRow, img: Rgba, rect: Rect): Array<{ i: number; dx: number; dy: number }> {
  const k = w.pxPerDp;
  const toDp = (px: number, regionAt: number, stageAt: number) => (px + regionAt + 0.5 - stageAt) / k;
  const out: Array<{ i: number; dx: number; dy: number }> = [];
  for (let y = 0; y < img.height; y++) {
    const dy = toDp(y, w.cap.region.y, w.stage.y);
    if (dy < rect.y || dy >= rect.y + rect.height) continue;
    for (let x = 0; x < img.width; x++) {
      const dx = toDp(x, w.cap.region.x, w.stage.x);
      if (dx >= rect.x && dx < rect.x + rect.width) out.push({ i: (y * img.width + x) * 4, dx, dy });
    }
  }
  if (out.length === 0) throw new EvidenceInputError(`${REPORT}: row ${w.cap.name}: no pixel of the PNG lies in the sample ${JSON.stringify(rect)} dp`);
  return out;
}

function sampleMedian(w: WitnessRow, img: Rgba, rect: Rect): number[] {
  const px = pixelsIn(w, img, rect);
  return [0, 1, 2].map((c) => median(px.map((p) => img.rgba[p.i + c])));
}

// ---------------------------------------------------------------------------------------- one evidence row

function judge(w: WitnessRow, img: Rgba): { lines: string[]; failed: number; blind: string[] } {
  const k = w.pxPerDp;
  const ip = w.insetsPx;
  const layout = witnessLayout(w.face, w.stage.width / k, w.stage.height / k, k, w.fontScale, { top: ip.top / k, right: ip.right / k, bottom: ip.bottom / k, left: ip.left / k });
  // Every sample square must lie in the app region, the pixels the capture kept; one outside it means the scene laid out
  // under a system bar, and its sample would be read from fewer pixels than it has.
  const app = w.cap.region;
  const eps = 1e-6;
  for (const [name, sample] of [...layout.patches.map((q) => [`${q.kind} ${q.colour}`, q.sample] as const), ['W1b', layout.w1b.sample] as const]) {
    const sx = w.stage.x + sample.x * k;
    const sy = w.stage.y + sample.y * k;
    if (sx < app.x - eps || sy < app.y - eps || sx + sample.width * k > app.x + app.width + eps || sy + sample.height * k > app.y + app.height + eps) {
      throw new EvidenceInputError(`${REPORT}: row ${w.cap.name}: the sample of ${name} at (${fmt(sx)}, ${fmt(sy)}) px, ${fmt(sample.width * k)} px square, lies outside the app region ${JSON.stringify(app)}: the scene laid out under a system bar`);
    }
  }
  if (w.renderScale !== layout.renderScale) {
    throw new EvidenceInputError(`${REPORT}: row ${w.cap.name}: the manifest field "renderScale" is ${w.renderScale}, not the witness's ${layout.renderScale}`);
  }
  const lines: string[] = [];
  const blind: string[] = [];
  let failed = 0;
  const colours = witnessColours(w.face);
  const medians = new Map<string, number[]>();

  for (const p of layout.patches) {
    const m = sampleMedian(w, img, p.sample);
    const token = p.token as Bytes;
    const hex = colours.find((c) => c.name === p.colour)!.hex;
    const d = delta(m, token);
    if ((TRUE_KINDS as readonly string[]).includes(p.kind)) {
      medians.set(`${p.kind} ${p.colour}`, m);
      const ok = d <= TOLERANCE;
      lines.push(`  ${p.kind} ${p.colour}: median ${triple(m)}, token ${hex}, |Δ| ${fmt(d)} (${ok ? 'PASS' : 'FAIL'})`);
      if (!ok) {
        failed++;
        const shown = (Object.keys(WITNESS_MODELS) as Array<keyof typeof WITNESS_MODELS>).filter((model) => {
          const bytes = WITNESS_MODELS[model](token);
          return lsbDelta(bytes, token) > MODEL_SEPARATION_LSB && delta(m, bytes) <= TOLERANCE;
        });
        lines.push(shown.length > 0
          ? shown.map((model) => `  diagnosis: ${p.kind} ${p.colour} shows ${model}'s bytes: ${WHY[model]}`).join('\n')
          : `  diagnosis: ${p.kind} ${p.colour} shows no planted model's bytes`);
      }
    } else if (p.separates) {
      const ok = d > MODEL_SEPARATION_LSB;
      lines.push(`  ${p.kind} ${p.colour}: median ${triple(m)}, token ${hex}, |Δ| from the token ${fmt(d)} ${ok ? `> ${MODEL_SEPARATION_LSB}: the wrong path is seen (PASS)` : `≤ ${MODEL_SEPARATION_LSB}: BLIND, the instrument cannot see this wrong path (FAIL)`}`);
      if (!ok) {
        failed++;
        blind.push(`${w.cap.name} ${p.kind} ${p.colour}`);
      }
    } else {
      lines.push(`  ${p.kind} ${p.colour}: identity-only (its model moves the token by ${lsbDelta(WITNESS_MODELS[p.kind as keyof typeof WITNESS_MODELS](token), token)} ≤ ${MODEL_SEPARATION_LSB}): not judged`);
    }
  }
  for (const c of colours) {
    const ms = TRUE_KINDS.map((k) => medians.get(`${k} ${c.name}`)!);
    let worst = 0;
    for (let a = 0; a < ms.length; a++) for (let b = a + 1; b < ms.length; b++) worst = Math.max(worst, delta(ms[a], ms[b]));
    const ok = worst <= TOLERANCE;
    lines.push(`  agree ${c.name}: W1a, W2 and W3 within ±${TOLERANCE} of each other (largest pairwise |Δ| ${fmt(worst)}) (${ok ? 'PASS' : 'FAIL'})`);
    if (!ok) failed++;
  }
  // W1b: the production field against the law's noise-free colour at each pixel's centre, in render px.
  const frame = noiseFree(w1bFrame(w.face, layout.field, w.pxPerDp, layout.renderScale).frame);
  const px = pixelsIn(w, img, layout.w1b.sample);
  const kr = k * layout.renderScale;
  const diffs: number[][] = [[], [], []];
  for (const p of px) {
    const law = fieldPixel(frame, p.dx * kr, p.dy * kr);
    for (let c = 0; c < 3; c++) diffs[c].push(img.rgba[p.i + c] - law[c]);
  }
  const md = diffs.map(median);
  const w1bOk = md.every((v) => Math.abs(v) <= TOLERANCE);
  lines.push(`  W1b: median of (capture − the law's noise-free colour) ${triple(md)} over ${px.length} px, within ±${TOLERANCE} (${w1bOk ? 'PASS' : 'FAIL'})`);
  if (!w1bOk) failed++;
  lines.push(failed === 0 ? '  PASS' : `  FAIL: ${failed} judgement${failed === 1 ? '' : 's'} failed`);
  return { lines, failed, blind };
}

// ---------------------------------------------------------------------------------------- the run

async function main(): Promise<number> {
  const a = args(process.argv.slice(2));
  if (fs.existsSync(a.out)) throw new EvidenceInputError(`refusing to overwrite ${a.out}: a report never replaces an earlier one`);
  const manifest = loadManifest(a.manifest);
  // Every row is read and every capture loaded before anything is written: an input error leaves no report.
  const witness: WitnessRow[] = [];
  const skipped: string[] = [];
  for (const row of manifest.rows) {
    const cap = readCaptureRow(row, REPORT);
    if (cap.scene.startsWith('witness.')) witness.push(readWitnessRow(row));
    else skipped.push(`not a witness row: ${cap.name} ${cap.scene}`);
  }
  const evidence = witness.filter((w) => w.colorMode !== null && SRGB_MODE.test(w.colorMode));
  const images = await Promise.all(evidence.map((w) => loadCapture(manifest, w.cap)));

  const lines: string[] = [
    `${REPORT} (B8-8d: the colour-path witness, D1–D5; B4 fork 2E; the designer's 3c)`,
    `manifest: ${manifest.file} sha256 ${manifest.sha256}`,
    `run: plan ${JSON.stringify(manifest.plan)}, outcome ${JSON.stringify(manifest.outcome)}, commit ${JSON.stringify(manifest.commit)}`,
    `tolerance: ±${TOLERANCE} per channel on each patch's median (D2); a planted patch must move its colour by more than MODEL_SEPARATION_LSB ${MODEL_SEPARATION_LSB} (D3, D5); a discrepancy is a STOP for the designer`,
  ];
  const runFailed = manifest.outcome !== 'passed';
  if (runFailed) lines.push(`the capture run failed: ${manifest.failure ?? `outcome ${JSON.stringify(manifest.outcome)}`}`);
  const failing: string[] = [];
  const blind: string[] = [];
  for (const w of witness) {
    const mode = w.colorMode ?? 'unknown';
    const n = evidence.indexOf(w);
    if (n < 0) {
      lines.push(`row ${w.cap.name} ${w.cap.scene}: display ${mode}: eyes-on only, not evidence (byte evidence needs the sRGB/Natural mode)`);
      continue;
    }
    lines.push(`row ${w.cap.name} ${w.cap.scene}: display ${mode}: byte evidence`);
    const ip = w.insetsPx;
    lines.push(`  layout: stage ${fmt(w.stage.width)} × ${fmt(w.stage.height)} px at ${fmt3(w.pxPerDp)} px per dp; insets from the region probe: top ${ip.top}, right ${ip.right}, bottom ${ip.bottom}, left ${ip.left} px`);
    const j = judge(w, images[n]);
    lines.push(...j.lines);
    if (j.failed > 0) failing.push(w.cap.name);
    blind.push(...j.blind);
  }
  lines.push(...skipped);

  let verdict: string;
  if (witness.length === 0) verdict = 'FAIL: no witness row';
  else if (evidence.length === 0) verdict = 'FAIL: no witness row is byte evidence (none in the sRGB/Natural display mode)';
  else if (failing.length > 0) verdict = `FAIL: ${failing.length} of ${evidence.length} evidence rows fail (${failing.join(', ')})${blind.length > 0 ? `; the instrument is blind to: ${blind.join(', ')}` : ''}`;
  else if (runFailed) verdict = 'FAIL: the capture run failed, so its rows are not evidence';
  else verdict = `PASS: ${evidence.length} witness rows of byte evidence; every true path shows its token and every separating wrong path is seen`;
  lines.push(verdict);
  const text = `${lines.join('\n')}\n`;
  writeNewFile(a.out, text);
  process.stdout.write(text);
  return verdict.startsWith('PASS') ? 0 : 1;
}

// exitCode, never process.exit() (reportsCanvasKitExit.test.ts): the library this imports loads CanvasKit.
main().then(
  (code) => {
    process.exitCode = code;
  },
  (e) => {
    process.stderr.write(`${REPORT}: ${e instanceof EvidenceInputError ? '' : 'could not run: '}${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 2;
  },
);
