// The never-red report (B8-8b; the architect's B8 plan at 199b138, TASKS UI-071; QA-065).
//
//   node scripts/lab/reports/neverRed.mts --manifest <run>/manifest.json --out <report>.txt
//
// Every pixel of every capture in the run (the whole PNG: the app region) is tested by the v2 definition of red, used as
// it is: redBand.ts isRed over neverRedSweeps.ts CHECK_BAND (DEC-081's check band), through lib/evidence.mts
// isCheckBandRed. The band must hold 0 pixels: each pixel in it is listed with its colour (the first 1000 of a row, then
// a count), with the row's count and bounding box. No row is exempt: a scene that draws a planted off-law colour shows
// up here, and the designer rules on it.
//
// It prints the report and writes it to --out, which may not exist (a report never overwrites). Exit 0: no pixel in the
// band in a passed run; 1: a pixel in the band, a failed capture run, or no row to check; 2: an input it cannot use (a
// manifest field missing or malformed, named; a PNG that is not its row's; an output that exists; no --manifest or
// --out), and no report.

import fs from 'node:fs';
import path from 'node:path';

import { CHECK_BAND } from '../../../src/design/v2/tokens/neverRedSweeps.ts';
import { EvidenceInputError, isCheckBandRed, loadCapture, loadManifest, readCaptureRow, writeNewFile } from './lib/evidence.mts';

const REPORT = 'neverRed';
const LISTED = 1000;

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

async function main(): Promise<number> {
  const { manifest: manifestFile, out } = args(process.argv.slice(2));
  if (fs.existsSync(out)) throw new EvidenceInputError(`refusing to overwrite ${out}: a report never replaces an earlier one`);
  const manifest = loadManifest(manifestFile);
  const caps = manifest.rows.map((row) => readCaptureRow(row, REPORT));
  const images = await Promise.all(caps.map((cap) => loadCapture(manifest, cap)));

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
  caps.forEach((cap, n) => {
    const img = images[n];
    const found: Array<{ x: number; y: number; rgb: number[] }> = [];
    let count = 0;
    let box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const i = (y * img.width + x) * 4;
        if (!isCheckBandRed(img.rgba[i], img.rgba[i + 1], img.rgba[i + 2])) continue;
        count++;
        box = { x0: Math.min(box.x0, x), y0: Math.min(box.y0, y), x1: Math.max(box.x1, x), y1: Math.max(box.y1, y) };
        if (found.length < LISTED) found.push({ x, y, rgb: [img.rgba[i], img.rgba[i + 1], img.rgba[i + 2]] });
      }
    }
    const pixels = img.width * img.height;
    total += pixels;
    red += count;
    lines.push(`row ${cap.name} ${cap.scene}: ${pixels} px, in the check band: ${count}`);
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

  let verdict: string;
  if (caps.length === 0) verdict = 'FAIL: no row to check';
  else if (failing.length > 0) verdict = `FAIL: ${failing.length} of ${caps.length} rows have pixels in the check band (${failing.join(', ')}): ${red} px`;
  else if (runFailed) verdict = `FAIL: the capture run failed, so its ${caps.length} rows are not evidence`;
  else verdict = `PASS: ${caps.length} rows, ${total} px, none in the check band`;
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
