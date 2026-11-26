// The band's evidence lane (law round 2, D6-2, the designer's ruling at UI-153; UI-160 to UI-165, D6 round 2).
//
//   node scripts/field/bandEvidence.mts                     run everything below for every direction and face
//   node scripts/field/bandEvidence.mts --plan              print what it would run, as one JSON line, and exit
//   node scripts/field/bandEvidence.mts --stamp             run, and after a PASS write bandEvidence.stamp.json
//   node scripts/field/bandEvidence.mts --seal <run file>   add the run file's name and sha256 to the stamp
//
// (2) the band's samples α (and β) ∈ {0.25, 0.5, 0.75} on the full 8-bit never-red grid (bandGridSweepFor);
// (4) the margin certificate over every cell of the full grid at 0, 0.25, 0.5, 0.75 and 1, five rows a band
// (UI-161), q8 over every composite cell (UI-163), each uncertified cell re-swept every 0.02 inside its own cell, the
// out-of-gamut count per row and band (UI-162) (certifyBand); and (iv) the β pair family of criterion G, with the
// band's mixed grounds α and β among its backgrounds, on its full grid (betaPairFamilyFor, UI-165). Too slow for CI's
// 15-minute sweeps budget, so by the ruling it runs here, never thinned. UI-160: it runs by hand at the V1 law freeze
// and again in every PR that changes an input that moves a sampled band colour (bandLawInputs.ts defines them); no
// schedule. Commit every input first, run with --stamp at that commit, --seal with the run file, then commit the stamp
// alone; the default jest run fails while the inputs no longer hash to the stamp's. It prints every number and exits
// 1 on any failure: a red pixel, a sweep over DEC-081's margin, a certificate row that does not walk one sample's
// cells, an uncertified cell not refined, a refined colour over the margin, or a β pair failure.

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sweepNeverRed } from '../../src/design/v2/color/blendSpace.ts';
import {
  BAND_CERT_SAMPLES,
  BAND_REFINE_STEP,
  BAND_SAMPLES,
  BAND_STEP,
  BETA_PAIR_GRIDS,
  CHECK_BAND,
  DESIGN_BAND,
  bandCertificateFailures,
  bandSpecFor,
  betaPairFamilyFor,
  certifyBand,
} from '../../src/design/v2/tokens/neverRedSweeps.ts';
import { EXTENSIONS } from '../../src/design/v2/tokens/tokens.extensions.generated.ts';
import { BASE, DIRECTIONS } from '../../src/design/v2/tokens/tokens.generated.ts';
import { BAND_LAW_INPUT_FILES, BAND_LAW_TOKEN_MODULES, STAMP_FILE, bandLawInputs, type BandEvidenceStamp } from './bandLawInputs.ts';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GRAPH = (EXTENSIONS.base['field.graph'] as unknown as { edges: Parameters<typeof bandSpecFor>[2] }).edges;
const DESIGN_LIMIT = DESIGN_BAND.chromaFloor - BASE.neverRed.margin;
const CHECK_LIMIT = CHECK_BAND.chromaFloor - BASE.neverRed.margin;
const directions = Object.keys(DIRECTIONS) as Array<keyof typeof DIRECTIONS>;
const cases = directions.flatMap((direction) =>
  (['dark', 'light'] as const).flatMap((face) => (['alpha', 'beta'] as const).map((edge) => ({ direction, face, edge }))),
);
const betaCases = directions.flatMap((direction) => (['dark', 'light'] as const).map((face) => ({ direction, face })));
const stampPath = path.join(APP, STAMP_FILE);

if (process.argv.includes('--plan')) {
  const spec = bandSpecFor(cases[0].direction, cases[0].face, GRAPH, cases[0].edge);
  console.log(
    JSON.stringify({
      cases,
      grid: spec.config.grid,
      samples: BAND_SAMPLES,
      certificateSamples: BAND_CERT_SAMPLES,
      q8Source: 'all cells',
      step: BAND_STEP,
      refineStep: BAND_REFINE_STEP,
      refine: true,
      betaPair: { cases: betaCases, resolution: 'full', bandSteps: BETA_PAIR_GRIDS.full.bandSteps },
      stamp: STAMP_FILE,
    }),
  );
  process.exit(0);
}

if (process.argv.includes('--seal')) {
  // UI-160: the run file the lane wrote under the runner: it must hold the stamp's commit, inputs and PASS line, and end in exit 0.
  const runFile = process.argv[process.argv.indexOf('--seal') + 1];
  if (!runFile || !fs.existsSync(runFile)) throw new Error(`--seal needs the run file, got ${runFile}`);
  const stamp = JSON.parse(fs.readFileSync(stampPath, 'utf8')) as Omit<BandEvidenceStamp, 'runFile'>;
  const bytes = fs.readFileSync(runFile);
  const lines = bytes.toString('utf8').split(/\r?\n/).filter((l) => l !== '');
  const needs = [`HEAD: ${stamp.commit}`, `inputs sha256 ${stamp.inputs.sha256}`, stamp.pass];
  for (const line of needs) if (!lines.includes(line)) throw new Error(`the run file has no line "${line}"`);
  if (lines[lines.length - 1] !== 'exit=0') throw new Error('the run file does not end in exit=0');
  if (bandLawInputs(APP).sha256 !== stamp.inputs.sha256) throw new Error('the inputs changed since the stamp');
  const sealed: BandEvidenceStamp = { ...stamp, runFile: { name: path.basename(runFile), sha256: crypto.createHash('sha256').update(bytes).digest('hex') } };
  fs.writeFileSync(stampPath, `${JSON.stringify(sealed, null, 2)}\n`);
  console.log(`sealed ${STAMP_FILE}: run file ${sealed.runFile.name} sha256 ${sealed.runFile.sha256}`);
  process.exit(0);
}

const stamping = process.argv.includes('--stamp');
const git = (...args: string[]) => {
  const r = spawnSync('git', ['-C', APP, ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const inputs = bandLawInputs(APP);
const commit = git('rev-parse', 'HEAD');
// A stamp names the commit it ran at, so every input must be committed there.
const dirty = git('status', '--porcelain', '--', ...BAND_LAW_INPUT_FILES, ...BAND_LAW_TOKEN_MODULES, 'scripts/field/bandLawInputs.ts');
if (stamping && dirty !== '') throw new Error(`--stamp refuses: law inputs differ from ${commit}:\n${dirty}`);

const fmt = (x: number) => (Number.isFinite(x) ? x.toFixed(5) : String(x));
let failed = 0;
const fail = (what: string) => {
  failed++;
  console.log(`  FAIL ${what}`);
};
console.log(`commit ${commit}${dirty === '' ? '' : ' (inputs uncommitted)'}`);
console.log(`inputs sha256 ${inputs.sha256}`);
console.log(`limits: design ${fmt(DESIGN_LIMIT)} (band ${DESIGN_BAND.hueFrom}-${DESIGN_BAND.hueTo}), check ${fmt(CHECK_LIMIT)} (band ${CHECK_BAND.hueFrom}-${CHECK_BAND.hueTo})`);
const started = Date.now();
for (const { direction, face, edge } of cases) {
  const spec = bandSpecFor(direction, face, GRAPH, edge);
  console.log(`${direction} ${face} ${edge} (${spec.label} ${BAND_SAMPLES.join(', ')}): grid ${JSON.stringify(spec.config.grid)}`);
  let t0 = Date.now();
  const report = sweepNeverRed(spec.config);
  console.log(`  (2) full 8-bit grid: ${report.pixelSamples} pixel samples, ${report.floatChecks} float checks; failures ${report.failures.length}; max design C ${fmt(report.maxDesign.chroma)}, max check C ${fmt(report.maxCheck.chroma)}; ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (report.failures.length > 0) fail(`(2) ${report.failures.length} failures, first ${JSON.stringify(report.failures[0])}`);
  if (report.maxDesign.chroma > DESIGN_LIMIT) fail(`(2) design C ${fmt(report.maxDesign.chroma)} over the margin`);
  if (report.maxCheck.chroma > CHECK_LIMIT) fail(`(2) check C ${fmt(report.maxCheck.chroma)} over the margin`);
  t0 = Date.now();
  const cert = certifyBand(spec);
  const w = cert.worst;
  console.log(`  (4) certificate, five rows: S ${fmt(cert.S)}, Δ ${cert.step}, S·Δ/2 ${fmt((cert.S * cert.step) / 2)}, q8 ${fmt(cert.q8)} (source '${cert.q8Source}'; on the grounds alone ${fmt(cert.q8Grounds)}), threshold ${fmt(cert.threshold)}; cells ${cert.cells}; min m ${fmt(w.m)} (${w.segment} at ${w.sample}, k ${w.k}, t ${w.t}, scales ${w.chromaScales.join('/')}, shimmer ${w.shimmerDeg.join('/')}); failing ${cert.failing}, out of gamut ${cert.outOfGamut}`);
  // UI-161: five rows, the endpoints' half-cells too; each row walks one sample's cells of the full grid.
  for (const row of cert.rows) {
    const rw = row.worst;
    const r = row.refined;
    console.log(`      row ${row.sample}: cells ${row.cells}; min m ${fmt(rw.m)} (${rw.segment}, k ${rw.k}, t ${rw.t}, scales ${rw.chromaScales.join('/')}, shimmer ${rw.shimmerDeg.join('/')}); failing ${row.failing}, out of gamut ${row.outOfGamut}; refined ${r.cells} cells at ${r.values.length} values (${r.values[0]}-${r.values[r.values.length - 1]}), ${r.distinct} distinct colours; max check C ${fmt(r.maxCheck)}${r.worst ? ` (${r.worst.segment} at ${r.worst.value}, k ${r.worst.k}, t ${r.worst.t})` : ''}; over the margin ${r.overLimit}`);
    if (row.cells * BAND_SAMPLES.length !== report.pixelSamples) fail(`(4) row ${row.sample} walked ${row.cells} cells, one sample of the sweep ${report.pixelSamples / BAND_SAMPLES.length}`);
  }
  console.log(`      certificate ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  for (const line of bandCertificateFailures(cert)) fail(`(4) ${line}`);
}
// UI-165: the β pair family (iv) on its full grid, the band's α and β mixes among its backgrounds.
for (const { direction, face } of betaCases) {
  const t0 = Date.now();
  const r = betaPairFamilyFor(direction, face, GRAPH, 'full');
  const names = Object.keys(r.grounds);
  const band = names.filter((n) => n.startsWith('face·ring α') || n.startsWith('ring·outside β')).length;
  const hue = (x: number) => (Number.isNaN(x) ? '-' : x.toFixed(1));
  console.log(`${direction} ${face} (iv) β pair family, full grid: ${r.legs} edge legs × ${names.length} grounds (${band} of them the band's α and β mixes); N̄.L range [${r.lRange[0].toFixed(4)}, ${r.lRange[1].toFixed(4)}]`);
  console.log(`  float (exact hulls): failures ${r.float.failures.length}; worst in-band C ${fmt(r.float.worst.chroma)} at ${hue(r.float.worst.hue)} (${r.float.worst.where || 'nothing in band'})`);
  console.log(`  8-bit (sampled, ${r.pixel.composites} composites): failures ${r.pixel.failures}; worst in-band C ${fmt(r.pixel.worst.chroma)} at ${hue(r.pixel.worst.hue)} (${r.pixel.worst.where || 'nothing in band'}); ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (r.float.failures.length > 0) fail(`(iv) float: ${r.float.failures.slice(0, 2).join(' | ')}`);
  if (r.pixel.failures > 0) fail(`(iv) 8-bit: ${r.pixel.failures} failures, e.g. ${r.pixel.first.join(' | ')}`);
}
const last = `${failed === 0 ? 'PASS' : 'FAIL'}: ${failed} failures; ${((Date.now() - started) / 1000).toFixed(1)} s in all`;
console.log(last);
if (stamping && failed === 0) {
  // UI-160 (a): the inputs' SHA-256, the commit the lane ran at and its PASS line; --seal adds the run file.
  fs.writeFileSync(stampPath, `${JSON.stringify({ ruling: 'UI-160', inputs, commit, pass: last }, null, 2)}\n`);
  console.log(`stamped ${STAMP_FILE}`);
}
process.exit(failed === 0 ? 0 : 1);
