// The band grid's scheduled evidence lane (law round 2, D6-2, the designer's ruling at UI-153).
//
//   node scripts/field/bandEvidence.mts           run (2) and (4) for every direction, both faces, α and β
//   node scripts/field/bandEvidence.mts --plan    print what it would run, as one JSON line, and exit
//
// (2) the band's samples α (and β) ∈ {0.25, 0.5, 0.75} on the full 8-bit never-red grid (bandGridSweepFor), and
// (4) the margin certificate over every one of its cells, each failing cell re-swept locally every 0.02
// (certifyBand). 656 s locally in node and 754 s in jest's sandbox (c4fb628); beside the sweeps project's files,
// in CI's two-worker file-size order, that projects the sweeps job to 12.9-16.8 min, across its 15-minute budget,
// so by the ruling it runs here and never thinned; no CI job runs it yet (scripts/field/__tests__/
// bandEvidence.test.ts). It prints every number and exits 1 on any failure: a red pixel, a sweep over DEC-081's
// margin, a certificate that does not walk the sweep's cells, or a refined colour over the margin.

import { sweepNeverRed } from '../../src/design/v2/color/blendSpace.ts';
import { BAND_REFINE_STEP, BAND_SAMPLES, BAND_STEP, CHECK_BAND, DESIGN_BAND, bandSpecFor, certifyBand } from '../../src/design/v2/tokens/neverRedSweeps.ts';
import { EXTENSIONS } from '../../src/design/v2/tokens/tokens.extensions.generated.ts';
import { BASE, DIRECTIONS } from '../../src/design/v2/tokens/tokens.generated.ts';

const GRAPH = (EXTENSIONS.base['field.graph'] as unknown as { edges: Parameters<typeof bandSpecFor>[2] }).edges;
const DESIGN_LIMIT = DESIGN_BAND.chromaFloor - BASE.neverRed.margin;
const CHECK_LIMIT = CHECK_BAND.chromaFloor - BASE.neverRed.margin;
const cases = Object.keys(DIRECTIONS).flatMap((direction) =>
  (['dark', 'light'] as const).flatMap((face) => (['alpha', 'beta'] as const).map((edge) => ({ direction, face, edge }))),
);

if (process.argv.includes('--plan')) {
  const spec = bandSpecFor(cases[0].direction as never, cases[0].face, GRAPH, cases[0].edge);
  console.log(JSON.stringify({ cases, grid: spec.config.grid, samples: BAND_SAMPLES, step: BAND_STEP, refineStep: BAND_REFINE_STEP, refine: true }));
  process.exit(0);
}

const fmt = (x: number) => (Number.isFinite(x) ? x.toFixed(5) : String(x));
let failed = 0;
const fail = (what: string) => {
  failed++;
  console.log(`  FAIL ${what}`);
};
console.log(`limits: design ${fmt(DESIGN_LIMIT)} (band ${DESIGN_BAND.hueFrom}-${DESIGN_BAND.hueTo}), check ${fmt(CHECK_LIMIT)} (band ${CHECK_BAND.hueFrom}-${CHECK_BAND.hueTo})`);
const started = Date.now();
for (const { direction, face, edge } of cases) {
  const spec = bandSpecFor(direction as never, face, GRAPH, edge);
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
  console.log(`  (4) certificate: S ${fmt(cert.S)}, Δ ${cert.step}, S·Δ/2 ${fmt((cert.S * cert.step) / 2)}, q8 ${fmt(cert.q8)}, threshold ${fmt(cert.threshold)}; cells ${cert.cells}; min m ${fmt(w.m)} (${w.segment} at ${w.sample}, k ${w.k}, t ${w.t}, scales ${w.chromaScales.join('/')}, shimmer ${w.shimmerDeg.join('/')}); failing ${cert.failing}, out of gamut ${cert.outOfGamut}`);
  const r = cert.refined;
  console.log(`      refined ${r.cells} cells (${BAND_SAMPLES.map((s) => `${s}: ${r.values[s].length} values`).join(', ')}), ${r.distinct} distinct colours on 8-bit pixels; max check C ${fmt(r.maxCheck)}${r.worst ? ` (${r.worst.segment} at ${r.worst.value}, k ${r.worst.k}, t ${r.worst.t})` : ''}; over the margin ${r.overLimit}; ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (cert.cells !== report.pixelSamples) fail(`(4) walked ${cert.cells} cells, the sweep ${report.pixelSamples}`);
  if (r.cells !== cert.failing + cert.outOfGamut) fail(`(4) refined ${r.cells} of ${cert.failing + cert.outOfGamut} uncertified cells`);
  if (r.overLimit > 0 || r.maxCheck > CHECK_LIMIT) fail(`(4) refinement: ${r.overLimit} colours over the margin, max C ${fmt(r.maxCheck)}`);
}
console.log(`${failed === 0 ? 'PASS' : 'FAIL'}: ${failed} failures; ${((Date.now() - started) / 1000).toFixed(1)} s in all`);
process.exit(failed === 0 ? 0 : 1);
