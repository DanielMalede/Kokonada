// The motion report (B8-8e; the architect's B8 plan at 199b138; TASKS UI-071).
//
//   node scripts/lab/reports/motion.mts --plan <capture plan>.json --manifest <run>/manifest.json --out <report>.txt
//
// A summary of a capture run, from the manifest's own numbers, against the plan that ran:
//   · QA-078: each shot the plan launches more than once has a determinism record whose hashes are all equal (the hashes
//     decide, never the record's own `equal`); every shot whose launches differ is listed with its hashes;
//   · QA-034/035: each zero-frames proof drew 0 frames in its window (the still tier, reduced motion);
//   · the draws-frames proofs, their positive controls, drew some;
//   · UI-171: each rate proof's frames per second (frames over seconds) lies inside the band its plan gives, ends
//     included (at low, the tier's cap; at full, no cap below the display's rate). RA-52: a low-tier proof whose display
//     ran at or below its band's ceiling (battery saver, Standard 60 Hz) cannot see the cap: it is "cap not observable",
//     neither PASS nor FAIL, and the run is INCONCLUSIVE for UI-171 unless another low-tier rate proof, taken where the
//     display ran above its band, passed;
//   · framestats is printed and never judged (informational). Other proof kinds (result, record) belong to other reports.
//
// Exit 3: INCONCLUSIVE (nothing failed, but UI-171's low-tier cap was never observable). Exit 1: a determinism record that differs or is missing, a zero-frames proof that drew, a control that did not, a rate
// outside its band, a proof the plan names that the manifest lacks, or a failed capture run. Exit 2: an input it cannot
// use (a field missing or malformed, named; a manifest of another plan; an existing report), and no report.

import fs from 'node:fs';

import { EvidenceInputError, writeNewFile } from './lib/evidence.mts';
import { fmt, loadRun, readDeterminism, readDisplay, readFrames, readProof, runArgs, type PlanShot, type Proof } from './lib/proofs.mts';

const REPORT = 'motion';
const SECTIONS: ReadonlyArray<{ kind: string; head: string }> = [
  { kind: 'zero-frames', head: 'QA-034/035 zero-frames: still tier and reduced motion draw nothing' },
  { kind: 'draws-frames', head: 'draws-frames: the positive control draws' },
  { kind: 'rate', head: 'UI-171 rate: frames per second inside the plan’s band' },
  { kind: 'framestats', head: 'framestats (informational, never judged)' },
];

function main(): number {
  const a = runArgs(process.argv.slice(2), REPORT);
  if (fs.existsSync(a.out)) throw new EvidenceInputError(`refusing to overwrite ${a.out}: a report never replaces an earlier one`);
  const { plan, manifest } = loadRun(a.plan, a.manifest, REPORT);
  const proofs: Proof[] = manifest.proofs.map((e, i) => readProof(e, i, REPORT, plan));
  const records = manifest.determinism.map((e, i) => readDeterminism(e, i, REPORT));

  const lines: string[] = [
    `${REPORT} (B8-8e: QA-078, QA-034/035, UI-171), from the manifest's own numbers`,
    `plan: ${plan.id} ${plan.file} sha256 ${plan.sha256}`,
    `manifest: ${manifest.file} sha256 ${manifest.sha256}`,
    `run: outcome ${JSON.stringify(manifest.outcome)}, commit ${JSON.stringify(manifest.commit)}`,
  ];
  const runFailed = manifest.outcome !== 'passed';
  if (runFailed) lines.push(`the capture run failed: ${manifest.failure ?? `outcome ${JSON.stringify(manifest.outcome)}`}`);
  const problems: string[] = [];
  const counts: Record<string, number> = { determinism: 0, 'zero-frames': 0, 'draws-frames': 0, rate: 0 };
  // RA-52: the low-tier rate proofs whose display could not show the cap, and whether any low-tier proof that could passed.
  const unobservable: string[] = [];
  let lowObserved = false;

  // QA-078
  lines.push('QA-078 determinism: every launch of a shot draws the same pixels');
  const repeated = plan.shots.filter((s) => s.repeat > 1);
  if (repeated.length === 0) lines.push('  none planned');
  for (const s of repeated) {
    const rec = records.find((r) => r.shot === s.id);
    if (rec === undefined) {
      lines.push(`  ${s.id}: planned ${s.repeat} launches, no determinism record (FAIL)`);
      problems.push(`${s.id} determinism`);
      continue;
    }
    if (rec.hashes.every((h) => h === rec.hashes[0])) {
      lines.push(`  ${s.id}: ${rec.hashes.length} launches, equal (PASS)`);
      counts.determinism++;
    } else {
      lines.push(`  ${s.id}: ${rec.hashes.length} launches, DIFFER: ${rec.hashes.map((h) => h.slice(0, 12)).join(', ')} (FAIL)`);
      problems.push(`${s.id} determinism`);
    }
  }

  // The proofs, by kind, in the plan's order.
  const planned = plan.shots.filter((s): s is PlanShot & { proof: NonNullable<PlanShot['proof']> } => s.proof !== null);
  for (const { kind, head } of SECTIONS) {
    lines.push(head);
    const mine = planned.filter((s) => s.proof.kind === kind);
    if (mine.length === 0) lines.push('  none planned');
    for (const s of mine) {
      const proof = proofs.find((p) => p.shot === s.id && p.kind === kind);
      if (proof === undefined) {
        lines.push(`  ${s.id}: no ${kind} proof in the manifest (FAIL)`);
        problems.push(`${s.id} ${kind}`);
        continue;
      }
      if (kind === 'framestats') {
        const numbers = Object.entries(proof.raw).filter(([, v]) => typeof v === 'number').map(([k, v]) => `${k} ${fmt(v as number)}`);
        lines.push(`  ${s.id}: ${numbers.join(', ')} (informational)`);
        continue;
      }
      const { seconds, frames } = readFrames(proof, REPORT);
      let ok: boolean;
      let line = `  ${s.id}: ${frames} frames in ${fmt(seconds)} s`;
      if (kind === 'rate') {
        const band = s.proof.band!;
        const fps = frames / seconds;
        const hz = readDisplay(proof, REPORT).refreshHz;
        line += ` = ${fmt(fps)} fps, band ${fmt(band.min)} to ${fmt(band.max)}, display ${fmt(hz)} Hz`;
        if (s.tier === 'low' && band.max >= hz) {
          lines.push(`${line}: cap not observable (display at ${fmt(hz)} Hz)`);
          unobservable.push(`${s.id}: display at ${fmt(hz)} Hz`);
          continue;
        }
        ok = fps >= band.min && fps <= band.max;
        if (ok && s.tier === 'low') lowObserved = true;
      } else {
        ok = kind === 'zero-frames' ? frames === 0 : frames > 0;
      }
      lines.push(`${line} (${ok ? 'PASS' : 'FAIL'})`);
      if (ok) counts[kind]++;
      else problems.push(`${s.id} ${kind}`);
    }
  }
  const others = planned.filter((s) => !SECTIONS.some((x) => x.kind === s.proof.kind));
  if (others.length > 0) lines.push(`not read here (other reports' proofs): ${others.map((s) => `${s.id} (${s.proof.kind})`).join(', ')}`);

  let verdict: string;
  if (problems.length > 0) verdict = `FAIL: ${problems.length} problem${problems.length === 1 ? '' : 's'}: ${problems.join(', ')}`;
  else if (runFailed) verdict = 'FAIL: the capture run failed, so its proofs are not evidence';
  else if (unobservable.length > 0 && !lowObserved) verdict = `INCONCLUSIVE: UI-171’s low-tier cap was not observable (${unobservable.join(', ')}); no low-tier rate proof was taken above its band; nothing else failed`;
  else {
    const unseen = unobservable.length > 0 ? `; ${unobservable.length} low-tier rate proof${unobservable.length === 1 ? '' : 's'} not observable (${unobservable.join(', ')})` : '';
    verdict = `PASS: ${counts.determinism} determinism pairs equal, ${counts['zero-frames']} zero-frames, ${counts['draws-frames']} draws-frames, ${counts.rate} rate proofs; framestats informational${unseen}`;
  }
  lines.push(verdict);
  const text = `${lines.join('\n')}\n`;
  writeNewFile(a.out, text);
  process.stdout.write(text);
  return verdict.startsWith('PASS') ? 0 : verdict.startsWith('INCONCLUSIVE') ? 3 : 1;
}

// exitCode, never process.exit() (reportsCanvasKitExit.test.ts): the library this imports loads CanvasKit.
try {
  process.exitCode = main();
} catch (e) {
  process.stderr.write(`${REPORT}: ${e instanceof EvidenceInputError ? '' : 'could not run: '}${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 2;
}
