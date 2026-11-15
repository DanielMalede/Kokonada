// The field cost report (B8-8e; the architect's B8 plan at 199b138, forks F2 and F3; TASKS UI-071).
//
//   node scripts/lab/reports/fieldCost.mts --plan <capture plan>.json --manifest <run>/manifest.json --out <report>.txt
//
// For each planned cost shot (scene cost.<direction>.<face>.<scene>.<tier>[.storm|.heavy|.empty]) it reads the RESULT
// line the lab's cost bench logged (B8-3: KOKONADA_LAB RESULT {run, seq, kind "cost", scene, frames, displayHz, stepUs,
// renderUs, gpuProxyUs, clock "performance.now"}), as the harness keeps it (the manifest's `results`, beside the shot's
// `result` proof; lib/proofs.mts readResults), and prints a table per
// scene and tier: the field, the storm, and the heavy and empty calibration shaders beside the field (F3), with the ratio
// heavy/field and empty/field of gpuProxyUs p50. Every number is informational: DEC-082 (the cost budget) is OPEN, so it
// asserts NO threshold on any cost.
//
// It fails (exit 1) only when the instrument itself cannot be trusted: a planned cost shot with no RESULT, a RESULT field
// missing or not finite (named), another clock than performance.now, another kind or scene than the shot's, or a broken
// calibration (heavy not above the field, or empty not below it, on gpuProxyUs p50, or a calibration row with no field
// row); and on a failed capture run or a plan with no cost shot. Exit 2: an input it cannot use (the plan or manifest
// malformed, a field named; a manifest of another plan; a cost scene id that does not parse; an existing report), and no
// report. It prints the report and writes it to --out, never over an existing file.

import fs from 'node:fs';

import { EvidenceInputError, writeNewFile } from './lib/evidence.mts';
import { fmt, judgeCostResult, loadRun, parseCostScene, readProof, readResults, runArgs, type CostResult, type Quantiles, type Variant } from './lib/proofs.mts';

const REPORT = 'fieldCost';
const LABEL = 'informational, DEC-082 OPEN';
const ORDER: readonly Variant[] = ['field', 'storm', 'heavy', 'empty'];

const q = (x: Quantiles) => `${fmt(x.p50)}/${fmt(x.p95)}/${fmt(x.max)}`;

function main(): number {
  const a = runArgs(process.argv.slice(2), REPORT);
  if (fs.existsSync(a.out)) throw new EvidenceInputError(`refusing to overwrite ${a.out}: a report never replaces an earlier one`);
  const { plan, manifest } = loadRun(a.plan, a.manifest, REPORT);

  const planned = plan.shots.filter((s) => s.scene.startsWith('cost.')).map((s) => {
    const parsed = parseCostScene(s.scene);
    if (parsed === null) throw new EvidenceInputError(`${REPORT}: the plan's shot ${s.id}: the field "scene" ${JSON.stringify(s.scene)} is not cost.<direction>.<face>.<scene>.<tier>[.storm|.heavy|.empty]`);
    return { shot: s, ...parsed };
  });
  const results = readResults(manifest, manifest.proofs.map((entry, i) => readProof(entry, i, REPORT, plan)), REPORT);

  const lines: string[] = [
    `${REPORT} (B8-8e: the field's cost bench, forks F2 and F3): every number is ${LABEL}; no threshold is asserted`,
    `plan: ${plan.id} ${plan.file} sha256 ${plan.sha256}`,
    `manifest: ${manifest.file} sha256 ${manifest.sha256}`,
    `run: outcome ${JSON.stringify(manifest.outcome)}, commit ${JSON.stringify(manifest.commit)}`,
  ];
  const runFailed = manifest.outcome !== 'passed';
  if (runFailed) lines.push(`the capture run failed: ${manifest.failure ?? `outcome ${JSON.stringify(manifest.outcome)}`}`);

  const groups = new Map<string, typeof planned>();
  for (const p of planned) {
    const key = `${p.direction} ${p.face} ${p.scene} ${p.tier}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  let problems = 0;
  let read = 0;
  for (const [key, shots] of groups) {
    lines.push(key);
    const valid = new Map<Variant, CostResult>();
    const fails: string[] = [];
    for (const variant of ORDER) {
      for (const p of shots.filter((s) => s.variant === variant)) {
        if (!results.has(p.shot.id)) {
          fails.push(`${p.shot.id}: no RESULT line for the planned cost shot ${p.shot.scene}`);
          continue;
        }
        const judged = judgeCostResult(results.get(p.shot.id), p.shot.scene);
        if ('problem' in judged) {
          fails.push(`${p.shot.id}: ${judged.problem}`);
          continue;
        }
        read++;
        const r = judged.result;
        valid.set(variant, r);
        lines.push(`  ${variant}: frames ${fmt(r.frames)}, displayHz ${fmt(r.displayHz)}, stepUs ${q(r.stepUs)}, renderUs ${q(r.renderUs)}, gpuProxyUs ${q(r.gpuProxyUs)} (p50/p95/max µs; ${LABEL})`);
      }
    }
    const field = valid.get('field');
    const heavy = valid.get('heavy');
    const empty = valid.get('empty');
    const calibrationPlanned = shots.some((s) => s.variant === 'heavy' || s.variant === 'empty');
    if (!calibrationPlanned) {
      lines.push('  calibration: none planned for this scene and tier');
    } else if (heavy === undefined && empty === undefined) {
      lines.push('  calibration: no valid calibration RESULT');
    } else if (field === undefined) {
      fails.push(`${key}: the calibration has no field row to compare with`);
    } else {
      const f = field.gpuProxyUs.p50;
      const ratios: string[] = [];
      const verdicts: string[] = [];
      if (heavy !== undefined) {
        ratios.push(`heavy/field gpuProxyUs p50 ${fmt(heavy.gpuProxyUs.p50 / f)}`);
        const ok = heavy.gpuProxyUs.p50 > f;
        verdicts.push(`heavy above the field: ${ok ? 'yes' : 'NO'}`);
        if (!ok) fails.push(`${key}: the calibration is broken: heavy gpuProxyUs p50 ${fmt(heavy.gpuProxyUs.p50)} is not above the field’s ${fmt(f)}`);
      }
      if (empty !== undefined) {
        ratios.push(`empty/field ${fmt(empty.gpuProxyUs.p50 / f)}`);
        const ok = empty.gpuProxyUs.p50 < f;
        verdicts.push(`empty below it: ${ok ? 'yes' : 'NO'}`);
        if (!ok) fails.push(`${key}: the calibration is broken: empty gpuProxyUs p50 ${fmt(empty.gpuProxyUs.p50)} is not below the field’s ${fmt(f)}`);
      }
      lines.push(`  calibration: ${ratios.join(', ')} (${LABEL}); ${verdicts.join('; ')}`);
    }
    for (const f of fails) lines.push(`  FAIL: ${f}`);
    problems += fails.length;
  }

  let verdict: string;
  if (planned.length === 0) verdict = 'FAIL: no cost shot in the plan';
  else if (problems > 0) verdict = `FAIL: the cost instrument cannot be trusted (${problems} problem${problems === 1 ? '' : 's'}); no threshold was asserted`;
  else if (runFailed) verdict = 'FAIL: the capture run failed, so its RESULT lines are not evidence';
  else verdict = `PASS: ${read} RESULT lines, calibration sound; no threshold asserted on any cost (${LABEL})`;
  lines.push(verdict);
  const text = `${lines.join('\n')}\n`;
  writeNewFile(a.out, text);
  process.stdout.write(text);
  return verdict.startsWith('PASS') ? 0 : 1;
}

// exitCode, never process.exit() (reportsCanvasKitExit.test.ts): the library this imports loads CanvasKit.
try {
  process.exitCode = main();
} catch (e) {
  process.stderr.write(`${REPORT}: ${e instanceof EvidenceInputError ? '' : 'could not run: '}${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 2;
}
