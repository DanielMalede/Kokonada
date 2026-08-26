// Turns an ESLint run into the four things the gate decides on. Separated from the CLI so it can
// be driven by a test against a REAL ESLint instance over a fixture tree, rather than against
// hand-built rows — the gate is what audits everything else, so it does not get to be the one
// piece proven only by its author's mocks.

import fs from 'node:fs';
import path from 'node:path';
import {
  findRuleConfigComments, findUnjustifiedSuppressions, matchesGlob, missingFromLint, toPosix,
} from './designSystemBaseline.mjs';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

/** Every source file on disk under `dir`, as repo-relative posix keys. */
export function enumerateSources(dir, appRoot, out = { sources: [], foreign: [] }) {
  if (!fs.existsSync(dir)) { return out; }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { enumerateSources(full, appRoot, out); continue; }
    const key = toPosix(full, appRoot);
    if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) { out.sources.push(key); }
    else { out.foreign.push(key); }
  }
  return out;
}

/**
 * @param {{ lintFiles(targets: string[]): Promise<any[]> }} eslint
 * @param {string} appRoot absolute root the baseline keys are relative to
 * @param {{ rulePrefix?: string, sourceDir?: string, targets?: string[],
 *           enforced?: Record<string, string[]> }} [options]
 *   `sourceDir` is the directory that must be FULLY covered — every source file in it has to
 *   appear in the lint results, or it is unchecked rather than clean.
 *   `enforced` maps each rule that must be an ERROR under sourceDir to the globs where it is
 *   DELIBERATELY off. Anything else that reaches severity 0 was disarmed by config, not policy.
 */
export async function collectFindings(eslint, appRoot, {
  rulePrefix = 'kokonada/', sourceDir = 'src', targets = ['.'], enforced = {},
} = {}) {
  const results = await eslint.lintFiles(targets);

  const counts = {};
  const fatals = [];
  const suppressed = [];
  const configComments = [];
  const linted = [];

  for (const result of results) {
    const file = toPosix(result.filePath, appRoot);
    linted.push(file);

    for (const m of result.messages) {
      if (m.fatal) { fatals.push({ file, line: m.line, message: m.message }); }
    }

    const hits = result.messages.filter((m) => String(m.ruleId || '').startsWith(rulePrefix));
    if (hits.length) {
      const byRule = {};
      for (const m of hits) { byRule[m.ruleId] = (byRule[m.ruleId] || 0) + 1; }
      counts[file] = byRule;
    }

    // Findings a disable comment removed before the gate could ever see them.
    for (const m of result.suppressedMessages || []) {
      suppressed.push({ file, line: m.line, ruleId: m.ruleId, suppressions: m.suppressions });
    }

    // ...and findings a rule never produced, because a comment switched the rule off.
    // Only under sourceDir: that is where the rules are enabled, so a config comment anywhere
    // else cannot switch anything off — and the config and this script both DESCRIBE the attack
    // in prose, which a raw text scan would otherwise read as the attack itself.
    if (file.startsWith(sourceDir + '/')) {
      try {
        for (const c of findRuleConfigComments(fs.readFileSync(result.filePath, 'utf8'), rulePrefix)) {
          configComments.push({ file, line: c.line });
        }
      } catch {
        // Unreadable here means ESLint already read it; nothing useful to add.
      }
    }
  }

  // A file ESLint never visited reports zero and looks identical to a clean one.
  const onDisk = enumerateSources(path.join(appRoot, sourceDir), appRoot);

  // ...and so does a file whose rules were switched off by CONFIG rather than by a comment.
  // `root: true` only stops the search going UP; a nested .eslintrc.js inside src/ is closer to
  // the file and wins, silently taking a whole directory out of the gate. That file is itself a
  // .js file, so neither the extension check nor the comment scan sees it. Ask ESLint what it
  // would ACTUALLY apply, per file, and compare against the declared policy.
  const disarmed = [];
  if (typeof eslint.calculateConfigForFile === 'function') {
    for (const file of linted) {
      if (!file.startsWith(sourceDir + '/')) { continue; }
      let config;
      try { config = await eslint.calculateConfigForFile(path.join(appRoot, file)); }
      catch { continue; }
      for (const [rule, exemptGlobs] of Object.entries(enforced)) {
        if (exemptGlobs.some((glob) => matchesGlob(file, glob))) { continue; }
        if (severityOf((config.rules || {})[rule]) !== 2) { disarmed.push({ file, rule }); }
      }
    }
  }

  return {
    counts,
    fatals,
    unjustified: findUnjustifiedSuppressions(suppressed, rulePrefix),
    configComments,
    unlinted: missingFromLint(onDisk.sources, linted),
    foreign: onDisk.foreign,
    disarmed,
  };
}

/** ESLint severity as a number: entries can be `2`, `'error'`, `['error', opts]`, or absent. */
export function severityOf(entry) {
  if (entry === undefined || entry === null) { return 0; }
  const raw = Array.isArray(entry) ? entry[0] : entry;
  if (typeof raw === 'string') { return { off: 0, warn: 1, error: 2 }[raw] ?? 0; }
  return Number(raw) || 0;
}
