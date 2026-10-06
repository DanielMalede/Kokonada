'use strict';

// The git adapter. Every call spawns git directly — no shell, so a path with a space or a quote is
// one argument and nothing else — with `core.quotepath=off` so non-ASCII names come back as UTF-8,
// `-z` wherever git lists paths, and `--` before every pathspec.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const MAX_BUFFER = 256 * 1024 * 1024;

function run(cwd, args, { input } = {}) {
  const res = spawnSync('git', ['-c', 'core.quotepath=off', ...args], {
    cwd,
    input,
    // Explicit: git sees the environment this program sees, even where a host (a test runner)
    // gives the program its own copy of process.env.
    env: process.env,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: MAX_BUFFER,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (res.error) return { code: 127, stdout: '', stderr: String(res.error.message || res.error) };
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function must(cwd, args, opts) {
  const res = run(cwd, args, opts);
  if (res.code !== 0) {
    const err = new Error(`git ${args.join(' ')} failed: ${(res.stderr || res.stdout).trim()}`);
    err.git = res;
    throw err;
  }
  return res.stdout;
}

const zsplit = (out) => out.split('\0').filter(Boolean);

function topLevel(cwd) {
  const res = run(cwd, ['rev-parse', '--show-toplevel']);
  return res.code === 0 ? path.resolve(res.stdout.trim()) : null;
}

function commonDir(cwd) {
  return path.resolve(cwd, must(cwd, ['rev-parse', '--git-common-dir']).trim());
}

// The main working tree: where `.worktree-*` folders are cut, whichever worktree we run from.
function mainRoot(cwd) {
  const common = commonDir(cwd);
  return path.basename(common) === '.git' ? path.dirname(common) : topLevel(cwd);
}

function currentBranch(cwd) {
  const res = run(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  return res.code === 0 ? res.stdout.trim() : null;
}

// Every branch on origin, whatever the clone's configured refspec says (a single-branch clone
// fetches only one), so no partner's branch can be missing from the picture.
function fetch(cwd) {
  return run(cwd, ['fetch', '--prune', '--quiet', 'origin', '+refs/heads/*:refs/remotes/origin/*']);
}

function isShallow(cwd) {
  return run(cwd, ['rev-parse', '--is-shallow-repository']).stdout.trim() === 'true';
}

// The root commits of a ref: two refs with no root in common share no history at all (an orphan).
function roots(cwd, ref) {
  return must(cwd, ['rev-list', '--max-parents=0', ref]).split('\n').map((l) => l.trim()).filter(Boolean);
}

// The last time this clone saw origin/<branch> move (the remote-tracking ref's reflog), in seconds.
function reflogTime(gitCommonDir, branch) {
  try {
    const file = path.join(gitCommonDir, 'logs', 'refs', 'remotes', 'origin', ...branch.split('/'));
    const last = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).pop() || '';
    const m = />\s(\d+)\s[+-]\d{4}\t/.exec(last);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

// → the file's text at a ref, or null when the ref or the file does not exist there.
function showFile(cwd, ref, rel) {
  if (!ref) return null;
  const res = run(cwd, ['show', `${ref}:${rel}`]);
  return res.code === 0 ? res.stdout : null;
}

// → [{ name, tipTime, author: { name, email }, sha }] for every branch on origin except HEAD.
function remoteBranches(cwd) {
  const out = must(cwd, [
    'for-each-ref',
    '--format=%(refname)%00%(committerdate:unix)%00%(authorname)%00%(authoremail)%00%(objectname)%00',
    'refs/remotes/origin/',
  ]);
  const fields = out.split('\0');
  const branches = [];
  for (let i = 0; i + 4 < fields.length; i += 5) {
    const refname = fields[i].replace(/^\s+/, '');
    const name = refname.replace(/^refs\/remotes\/origin\//, '');
    if (!refname || name === 'HEAD') continue;
    branches.push({
      name,
      tipTime: Number(fields[i + 1]),
      author: { name: fields[i + 2], email: fields[i + 3].replace(/^<|>$/g, '') },
      sha: fields[i + 4],
    });
  }
  return branches;
}

function mergeBase(cwd, a, b) {
  const res = run(cwd, ['merge-base', a, b]);
  return res.code === 0 ? res.stdout.trim() : null;
}

function isAncestor(cwd, ancestor, descendant) {
  return run(cwd, ['merge-base', '--is-ancestor', ancestor, descendant]).code === 0;
}

// Renames are listed as a delete plus an add, so both the old and the new path count as touched.
function diffNames(cwd, a, b) {
  return zsplit(must(cwd, ['diff', '--name-only', '--no-renames', '-z', a, b, '--']));
}

function firstLedgerTime(cwd, base, ref, ledgerPath) {
  const res = run(cwd, ['log', '--reverse', '--format=%ct', `${base}..${ref}`, '--', ledgerPath]);
  if (res.code !== 0) return null;
  const first = res.stdout.split('\n').find(Boolean);
  return first ? Number(first) : null;
}

// Test files on `ref` whose text contains `needle`.
function grepTests(cwd, ref, needle) {
  const res = run(cwd, ['grep', '-l', '-z', '-F', '-e', needle, ref, '--', 'backend/tests', 'mobile/KokonadaHealth/**/__tests__/**']);
  if (res.code !== 0) return [];
  return zsplit(res.stdout).map((p) => p.replace(new RegExp(`^${ref.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}:`), ''));
}

// → { path: blob sha } for every file in the tree at `ref`.
function treeBlobs(cwd, ref) {
  const blobs = {};
  for (const entry of zsplit(must(cwd, ['ls-tree', '-r', '-z', '--full-tree', ref]))) {
    const tab = entry.indexOf('\t');
    const [, type, sha] = entry.slice(0, tab).split(' ');
    if (type === 'blob') blobs[entry.slice(tab + 1)] = sha;
  }
  return blobs;
}

function treeFiles(cwd, ref) {
  return Object.keys(treeBlobs(cwd, ref));
}

function refExists(cwd, ref) {
  return run(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).code === 0;
}

function revParse(cwd, ref) {
  const res = run(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  return res.code === 0 ? res.stdout.trim() : null;
}

function validBranchName(cwd, name) {
  return run(cwd, ['check-ref-format', '--branch', name]).code === 0;
}

// → [{ path, branch }] (branch without refs/heads/, or null when detached).
function worktrees(cwd) {
  const out = must(cwd, ['worktree', 'list', '--porcelain']);
  const list = [];
  let cur = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      cur = { path: path.resolve(line.slice('worktree '.length)), branch: null };
      list.push(cur);
    } else if (cur && line.startsWith('branch ')) {
      cur.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    }
  }
  return list;
}

function worktreeAdd(cwd, dir, branch, start) {
  return must(cwd, ['worktree', 'add', '--no-track', '-b', branch, dir, start]);
}

function add(cwd, files) {
  return must(cwd, ['add', '--', ...files]);
}

function stagedFiles(cwd) {
  return zsplit(must(cwd, ['diff', '--cached', '--name-only', '-z', '--']));
}

function commit(cwd, message) {
  return must(cwd, ['commit', '--quiet', '-m', message]);
}

function push(cwd, branch, { setUpstream = false } = {}) {
  const args = ['push', '--quiet'];
  if (setUpstream) args.push('-u');
  args.push('origin', `${branch}:refs/heads/${branch}`);
  return run(cwd, args);
}

function readWorktreeFile(dir, rel) {
  try {
    return fs.readFileSync(path.join(dir, ...rel.split('/')), 'utf8');
  } catch {
    return null;
  }
}

function writeWorktreeFile(dir, rel, text) {
  fs.writeFileSync(path.join(dir, ...rel.split('/')), text, 'utf8');
}

module.exports = {
  run,
  must,
  topLevel,
  commonDir,
  mainRoot,
  currentBranch,
  fetch,
  isShallow,
  roots,
  reflogTime,
  treeFiles,
  showFile,
  remoteBranches,
  mergeBase,
  isAncestor,
  diffNames,
  firstLedgerTime,
  grepTests,
  treeBlobs,
  refExists,
  revParse,
  validBranchName,
  worktrees,
  worktreeAdd,
  add,
  stagedFiles,
  commit,
  push,
  readWorktreeFile,
  writeWorktreeFile,
};
