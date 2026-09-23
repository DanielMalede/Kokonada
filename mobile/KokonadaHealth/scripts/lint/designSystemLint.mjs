// The CI gate for the design system: values that bypass src/design/tokens.ts fail the build.
//
//   node scripts/lint/designSystemLint.mjs                     check against the baseline (CI)
//   node scripts/lint/designSystemLint.mjs --update            re-record after a cleanup
//   node scripts/lint/designSystemLint.mjs --update --allow-increase   record MORE debt (rare)
//
// It runs the SAME .eslintrc.js everyone else runs, then keeps only the kokonada/* findings.
// That matters: the gate is about off-system values, so unrelated pre-existing lint debt must
// not be what decides whether it passes — and equally, a dev cannot pass the gate by tuning a
// second config that only CI reads. `npm run lint` remains the full lint.
//
// SIX things fail the build, because there turned out to be six ways to score zero:
//   1. any file above its recorded per-rule count                      (the ratchet)
//   2. a design-system finding silenced without a written reason       (the escape hatch)
//   3. an inline `/* eslint kokonada/...: off */` config comment       (rule never runs)
//   4. a file ESLint could not parse                                   (zero by accident)
//   5. a source file ESLint never visited at all                     (zero by omission)
//   6. a rule switched off for a file by CONFIG, not by policy       (zero by disarmament)
// 2-6 all produce a clean-looking file, which is why none of them can be left to a lint
// rule — a rule cannot report on the thing that stopped it running.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { compareToBaseline, formatReport, toPosix } from './designSystemBaseline.mjs';
import { collectFindings } from './collect.mjs';

const require = createRequire(import.meta.url);
const { ESLint } = require('eslint');

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RULE_PREFIX = 'kokonada/';
const BASELINE = path.join(APP_ROOT, 'scripts/lint/design-system-baseline.json');
const UPDATE_COMMAND = 'npm run lint:design-system -- --update';

const rel = (abs) => toPosix(abs, APP_ROOT);

// The DECLARED policy, read out of eslint.design-system.js rather than restated here: which
// design-system rules must be errors under src/, and the globs where each is deliberately off.
// One source of truth — widening an exemption is then a visible edit to the policy file, which
// designSystemConfig.test.ts pins, instead of a silent disagreement between two lists.
function declaredPolicy() {
  const designSystem = require('../../eslint.design-system');
  const enforced = {};
  for (const override of designSystem.overrides || []) {
    for (const [rule, severity] of Object.entries(override.rules || {})) {
      if (!rule.startsWith(RULE_PREFIX)) { continue; }
      if (severity === 'off') { (enforced[rule] = enforced[rule] || []).push(...override.files); }
      else if (!enforced[rule]) { enforced[rule] = []; }
    }
  }
  return enforced;
}

function readBaseline() {
  if (!fs.existsSync(BASELINE)) { return {}; }
  return JSON.parse(fs.readFileSync(BASELINE, 'utf8')).files || {};
}

const totalOf = (counts) =>
  Object.values(counts).reduce((a, byRule) => a + Object.values(byRule).reduce((x, y) => x + y, 0), 0);

function writeBaseline(counts) {
  const files = {};
  for (const file of Object.keys(counts).sort()) {
    const byRule = {};
    for (const rule of Object.keys(counts[file]).sort()) { byRule[rule] = counts[file][rule]; }
    files[file] = byRule;
  }
  fs.writeFileSync(BASELINE, JSON.stringify({
    note: 'Pre-existing design-system violations, per file per rule. Only ever shrinks; the gate fails on any increase.',
    total: totalOf(counts),
    files,
  }, null, 2) + '\n');
}

function printTable(counts) {
  const rows = Object.entries(counts)
    .map(([file, byRule]) => [file, Object.values(byRule).reduce((a, b) => a + b, 0)])
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!rows.length) {
    console.log('  (no design-system violations)');
    return;
  }
  const width = rows.reduce((w, [file]) => Math.max(w, file.length), 0);
  for (const [file, n] of rows) { console.log(`  ${file.padEnd(width)}  ${String(n).padStart(4)}`); }
  const byRule = {};
  for (const map of Object.values(counts)) {
    for (const [rule, n] of Object.entries(map)) { byRule[rule] = (byRule[rule] || 0) + n; }
  }
  console.log(`  ${'-'.repeat(width + 6)}`);
  console.log(`  ${String(rows.length).padStart(width)} files  ${String(totalOf(counts)).padStart(4)} violations`);
  for (const [rule, n] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${rule}: ${n}`);
  }
}

/** Anything that makes the run's numbers untrustworthy. Reported before the ratchet, because a
 *  count you cannot trust must not be compared to a baseline — or written into one. */
function reportIntegrity({ fatals, unjustified, configComments, unlinted, foreign, disarmed }) {
  let bad = false;

  if (fatals.length) {
    bad = true;
    console.error('ESLint could not parse these files, so their violation count is meaningless:');
    for (const x of fatals) { console.error(`  ${x.file}:${x.line}  ${x.message}`); }
    console.error('');
  }

  if (configComments.length) {
    bad = true;
    console.error('A design-system rule was switched OFF by an inline ESLint config comment:');
    for (const x of configComments) { console.error(`  ${x.file}:${x.line}`); }
    console.error('');
    console.error('That comment stops the rule running at all, so the file reports zero and looks');
    console.error('clean. It is not an escape hatch and is never accepted. If a value genuinely');
    console.error('cannot come from a token, disable the one line WITH a reason instead:');
    console.error('  // eslint-disable-next-line kokonada/no-color-literals -- <why>');
    console.error('');
  }

  if (unjustified.length) {
    bad = true;
    console.error('A design-system rule was disabled with no written reason:');
    for (const x of unjustified) { console.error(`  ${x.file}:${x.line}  ${x.ruleId}`); }
    console.error('');
    console.error('The escape hatch needs a reason on the same line:');
    console.error('  // eslint-disable-next-line kokonada/no-color-literals -- <why the token system cannot express this>');
    console.error('A bare `/* eslint-disable */` also silences these rules, and is never accepted.');
    console.error('');
  }

  if (unlinted.length) {
    bad = true;
    console.error('ESLint never visited these source files, so they are unchecked, not clean:');
    for (const x of unlinted) { console.error(`  ${x}`); }
    console.error('');
    console.error('Usually .eslintignore, `ignorePatterns`, or a directory ESLint skips by default.');
    console.error('');
  }

  if (foreign.length) {
    bad = true;
    console.error('Unexpected file types under src/ — no lint rule covers these:');
    for (const x of foreign) { console.error(`  ${x}`); }
    console.error('');
  }

  if (disarmed && disarmed.length) {
    bad = true;
    console.error('A design-system rule is NOT an error for these files, and policy says it should be:');
    for (const x of disarmed) { console.error(`  ${x.file}  ${x.rule}`); }
    console.error('');
    console.error('Almost always a nested .eslintrc under src/ — `root: true` only stops the search');
    console.error('going UP, so a closer config wins and takes a whole directory out of the gate.');
    console.error('The exemptions are declared in eslint.design-system.js and nowhere else.');
    console.error('');
  }

  return bad;
}

const found = await collectFindings(new ESLint({ cwd: APP_ROOT }), APP_ROOT, {
  rulePrefix: RULE_PREFIX,
  enforced: declaredPolicy(),
});
const updating = process.argv.includes('--update');

if (reportIntegrity(found)) { process.exit(1); }

const comparison = compareToBaseline(found.counts, readBaseline());

if (updating) {
  // The gate's own remedy line used to be `--update`, which meant the fix for a regression was to
  // record it. Recording MORE debt is now a deliberate, separately-spelled act.
  if (comparison.regressions.length && !process.argv.includes('--allow-increase')) {
    console.error('Refusing to re-record: this run has NEW violations, and --update would bake them in.');
    for (const r of comparison.regressions) {
      console.error(`  ${r.file}  ${r.rule}  ${r.baseline} -> ${r.actual}`);
    }
    console.error('');
    console.error('Fix them, or if the increase is genuinely intended (a rule got stricter),');
    console.error('say so explicitly:  npm run lint:design-system -- --update --allow-increase');
    process.exit(1);
  }
  writeBaseline(found.counts);
  console.log(`Baseline written to ${rel(BASELINE)}:`);
  printTable(found.counts);
  process.exit(0);
}

console.log('Design-system violations by file:');
printTable(found.counts);
console.log('');
for (const line of formatReport(comparison, UPDATE_COMMAND)) { console.log(line); }
process.exit(comparison.ok ? 0 : 1);
