// What made a report (UI-274): the commit of the checkout a report runs from, with whether its tree holds changes that
// commit does not, and the version of each package the twin is drawn with, as the app's own require resolves it. A report
// prints them beside the run's commit, so a report made again says which code and which CanvasKit made it. Nothing here
// refuses: a fact it cannot read is unknown, and says why on one line. Held by scripts/lab/__tests__/reportsProvenance.test.ts.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/** The non-empty lines of what a command or an error said. */
const lines = (text) => String(text).split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');

/** Why a git command failed, on one line: all it said (git's error, then its fatal), else how it ended. */
const failed = (r) => lines(r.error ? r.error.message : r.stderr).join('; ') || `exit ${r.status}`;

/**
 * The commit `dir` is checked out at, and how many paths `git status --porcelain` lists there: the lab stamp's test of a
 * clean tree (lib/stamp.mjs), so 0 is a clean tree. Read without optional locks: a report never writes the index.
 * @param {string} dir
 * @returns {{ commit: string, changes: number } | { commit: string, changes: null, reason: string } | { commit: null, reason: string }}
 */
export function madeAt(dir) {
  const git = (args) => spawnSync('git', ['--no-optional-locks', ...args], { cwd: dir, encoding: 'utf8' });
  const head = git(['rev-parse', '--verify', 'HEAD']);
  if (head.status !== 0) return { commit: null, reason: `git rev-parse HEAD: ${failed(head)}` };
  const commit = head.stdout.trim();
  const status = git(['status', '--porcelain']);
  if (status.status !== 0) return { commit, changes: null, reason: `git status: ${failed(status)}` };
  return { commit, changes: status.stdout.split(/\r?\n/).filter((l) => l !== '').length };
}

/**
 * madeAt's answer as a report's header says it.
 * @param {ReturnType<typeof madeAt>} m
 * @returns {string}
 */
export function describeMadeAt(m) {
  if (m.commit === null) return `commit unknown (${m.reason})`;
  if (m.changes === null) return `commit ${m.commit}, the tree's state unknown (${m.reason})`;
  if (m.changes === 0) return `commit ${m.commit}, a clean tree`;
  return `commit ${m.commit}, with uncommitted changes in ${m.changes} path${m.changes === 1 ? '' : 's'}`;
}

/**
 * The version in the package.json of `name` as a require from `appRoot` resolves it: the package the app, and so the
 * twin, loads. A package.json that is not JSON is refused by the resolver itself, so it is unknown too.
 * @param {string} appRoot
 * @param {string} name
 * @returns {{ version: string } | { version: null, reason: string }}
 */
export function packageVersion(appRoot, name) {
  let file;
  try {
    file = createRequire(path.join(appRoot, 'package.json')).resolve(`${name}/package.json`);
  } catch (e) {
    // The resolver's first line names the package; the rest is its require stack.
    return { version: null, reason: lines(e instanceof Error ? e.message : e)[0] ?? '' };
  }
  const { version } = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (typeof version !== 'string' || version === '') return { version: null, reason: `${file} names no version` };
  return { version };
}

/**
 * packageVersion's answer as a report's header says it.
 * @param {string} name
 * @param {ReturnType<typeof packageVersion>} v
 * @returns {string}
 */
export function describeVersion(name, v) {
  return v.version === null ? `${name} unknown (${v.reason})` : `${name} ${v.version}`;
}
