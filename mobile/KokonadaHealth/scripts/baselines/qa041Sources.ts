/// <reference types="node" />
// QA-041 proper (OPS-412 part A): the git and fs adapters of the CLI. They gather the facts the pure core
// (./qa041.ts) decides on: each results file's text, where each test file is by its real path, HEAD's SHA,
// parents and commit time, and the tree at TEST_FLOOR.sha. They read no environment variable: git is found
// on the PATH like any program, and a git that is missing, fails or hangs past its timeout is a reason the
// core reports (exit 2), never an absent SHA or a foreign one.
//
// Node strips this file's types (qa041.mjs imports it): Node builtins and explicit .ts paths only, no
// top-level __dirname, no typescript, no enum, and type imports written as `import type`.

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FloorTree, HeadFacts, Loaded, ResultsFile } from './qa041.ts';

/** How long one git command may run (a full mobile tree lists in well under a second). */
export const GIT_TIMEOUT_MS = 60_000;

/** git ran and exited with `status`, or it could not run to the end (missing, killed, timed out). */
export type GitRun = { status: number; stdout: string; stderr: string } | { error: string };
export type Git = (args: readonly string[], cwd: string) => GitRun;

const SHA40 = /^[0-9a-f]{40}$/;
const firstLine = (s: string): string => s.trim().split('\n')[0] ?? '';

export interface GitOptions {
  timeoutMs?: number;
  /** The child's environment; the CLI passes none, so git sees the one the CLI was started with. */
  env?: Readonly<Record<string, string>>;
}

/** One git command, with a timeout; its output is read as UTF-8. */
export function runGit(args: readonly string[], cwd: string, { timeoutMs = GIT_TIMEOUT_MS, env }: GitOptions = {}): GitRun {
  const what = `git ${args.join(' ')}`.slice(0, 160);
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true, ...(env ? { env } : {}) });
  if (r.error) {
    const code = (r.error as { code?: string }).code;
    if (code === 'ENOENT') return { error: `git is not on the PATH (${r.error.message})` };
    if (code === 'ETIMEDOUT') return { error: `${what}: timed out after ${timeoutMs} ms` };
    return { error: `${what}: could not run (${r.error.message})` };
  }
  if (r.status === null) return { error: `${what}: killed by ${r.signal ?? 'a signal'}` };
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

export const git: Git = (args, cwd) => runGit(args, cwd);

/** git's output when it exited 0, or why not. */
function ok(r: GitRun, what: string): { out: string } | { error: string } {
  if ('error' in r) return r;
  return r.status === 0 ? { out: r.stdout } : { error: `${what} exited ${r.status}: ${firstLine(r.stderr)}` };
}

/**
 * HEAD's SHA, its parents in order and its committer time, from the commit object itself: in a shallow
 * clone `rev-list --parents` drops a merge's parents (the graft), but the commit still records them.
 */
export function headFacts(repoDir: string, run: Git = git): Loaded<HeadFacts> {
  const head = ok(run(['rev-parse', '--verify', 'HEAD^{commit}'], repoDir), 'git rev-parse HEAD');
  if ('error' in head) return head;
  const sha = head.out.trim();
  if (!SHA40.test(sha)) return { error: `git rev-parse HEAD printed ${JSON.stringify(sha)}, not a 40-hex SHA` };
  const raw = ok(run(['cat-file', 'commit', sha], repoDir), `git cat-file commit ${sha}`);
  if ('error' in raw) return raw;
  const header = raw.out.split('\n\n')[0].split('\n');
  const parents = header.map((l) => /^parent ([0-9a-f]{40})$/.exec(l)).filter((m) => m !== null).map((m) => m[1]);
  const committer = header.map((l) => /^committer .* (\d+) [+-]\d{4}$/.exec(l)).find((m) => m !== null);
  if (!committer) return { error: `commit ${sha} has no committer time` };
  return { value: { sha, parents, commitTime: Number(committer[1]) } };
}

/**
 * The tree at `sha` under the app root: every blob's path relative to it (posix), once `sha` is known to be a
 * commit of this clone and an ancestor of HEAD. A shallow clone is reported, so the core can tell an absent
 * or unrelated SHA from one the clone's cut history hides.
 */
export function floorTree(appRoot: string, sha: string, run: Git = git): FloorTree {
  if (!SHA40.test(sha)) return { state: 'error', reason: `TEST_FLOOR.sha ${JSON.stringify(sha)} is not 40 lower-case hex characters` };
  const top = ok(run(['rev-parse', '--show-toplevel'], appRoot), 'git rev-parse --show-toplevel');
  if ('error' in top) return { state: 'error', reason: top.error };
  const prefix = ok(run(['rev-parse', '--show-prefix'], appRoot), 'git rev-parse --show-prefix');
  if ('error' in prefix) return { state: 'error', reason: prefix.error };
  const shallowRun = ok(run(['rev-parse', '--is-shallow-repository'], appRoot), 'git rev-parse --is-shallow-repository');
  if ('error' in shallowRun) return { state: 'error', reason: shallowRun.error };
  const shallow = shallowRun.out.trim() === 'true';
  const root = top.out.trim();
  const present = run(['cat-file', '-e', `${sha}^{commit}`], root);
  if ('error' in present) return { state: 'error', reason: present.error };
  if (present.status !== 0) return { state: 'absent', shallow };
  const ancestor = run(['merge-base', '--is-ancestor', sha, 'HEAD'], root);
  if ('error' in ancestor) return { state: 'error', reason: ancestor.error };
  if (ancestor.status === 1) return { state: 'notAncestor', shallow };
  if (ancestor.status !== 0) return { state: 'error', reason: `git merge-base --is-ancestor exited ${ancestor.status}: ${firstLine(ancestor.stderr)}` };
  const pre = prefix.out.trim();
  const listed = ok(run(['ls-tree', '-r', '-z', sha, '--', pre === '' ? '.' : pre], root), `git ls-tree ${sha}`);
  if ('error' in listed) return { state: 'error', reason: listed.error };
  const paths: string[] = [];
  for (const entry of listed.out.split('\0')) {
    if (entry === '') continue;
    const tab = entry.indexOf('\t');
    const meta = entry.slice(0, tab).split(' ');
    const file = entry.slice(tab + 1);
    if (tab < 0 || meta[1] !== 'blob' || !file.startsWith(pre)) continue;
    paths.push(file.slice(pre.length));
  }
  return { state: 'ok', paths };
}

/** Each --results file's text, by the path as given (relative to the working directory), or why it could not be read. */
export function readResultFiles(files: readonly string[]): ResultsFile[] {
  return files.map((file) => {
    try {
      return { file, text: fs.readFileSync(path.resolve(file), 'utf8') };
    } catch (e) {
      return { file, error: e instanceof Error ? e.message : String(e) };
    }
  });
}

/**
 * A test file's absolute name -> its path relative to the package root (posix), or null when it is not a
 * file under it. Real paths are compared, so a second name for one file (a link, a junction, another case on
 * Windows) is the same file, and a link out of the package is outside it.
 */
export function locator(pkgRoot: string): (name: string) => string | null {
  let root: string | null = null;
  try { root = fs.realpathSync.native(pkgRoot); } catch { root = null; }
  return (name) => {
    if (root === null || !path.isAbsolute(name)) return null;
    let real: string;
    try {
      real = fs.realpathSync.native(name);
      if (!fs.statSync(real).isFile()) return null;
    } catch {
      return null;
    }
    const rel = path.relative(root, real);
    if (rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
    return rel.split(path.sep).join('/');
  };
}
