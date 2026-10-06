'use strict';

// The GitHub CLI adapter. `COORD_GH` names a JavaScript file to run in gh's place (tests and CI use
// a stateful fake); otherwise the real `gh` runs. Never through a shell. Every call returns null
// when gh is missing, signed out or fails, so the caller decides what "no answer" means: `status`
// degrades (no PR state), `start` refuses before it changes anything.

const { spawnSync } = require('child_process');

const MAX_BUFFER = 64 * 1024 * 1024;

function run(args, { cwd } = {}) {
  const fake = process.env.COORD_GH;
  const bin = fake ? process.execPath : 'gh';
  const argv = fake ? [fake, ...args] : args;
  // env is explicit for the same reason as in git.js: gh sees the environment this program sees.
  const res = spawnSync(bin, argv, { cwd, env: process.env, encoding: 'utf8', windowsHide: true, maxBuffer: MAX_BUFFER });
  if (res.error) return { code: 127, stdout: '', stderr: String(res.error.message || res.error) };
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function json(args, opts) {
  const res = run(args, opts);
  if (res.code !== 0) return null;
  try {
    return JSON.parse(res.stdout);
  } catch {
    return null;
  }
}

function login(cwd) {
  const res = run(['api', 'user', '--jq', '.login'], { cwd });
  const value = res.code === 0 ? res.stdout.trim() : '';
  return value || null;
}

function prView(cwd, selector, fields) {
  return json(['pr', 'view', String(selector), '--json', fields], { cwd });
}

// The OPEN PRs, on their own call: an open PR keeps a branch in view whatever its age, so this list
// must be whole. If it comes back exactly at its limit it may be cut, and callers stop.
const OPEN_LIMIT = 100;

function prListOpen(cwd) {
  return json(['pr', 'list', '--state', 'open', '--limit', String(OPEN_LIMIT), '--json', 'number,state,headRefName,headRefOid,isDraft,author'], { cwd });
}

// Every state, for merged/closed detection only. Cut at 300: a branch whose PR falls off the end
// is judged by the content-merge rule instead, which is safe.
// headRefOid: a merged or closed PR counts only for the commit it was about. author: a branch whose
// commit author maps to nobody is resolved through the login that opened its PR.
function prList(cwd) {
  return json(['pr', 'list', '--state', 'all', '--limit', '300', '--json', 'number,state,headRefName,headRefOid,isDraft,author'], { cwd });
}

// The OPEN PR for a branch, or null. Never a merged or closed one: a reused name must not pick up
// an old PR.
function openPrFor(cwd, branch) {
  const list = json(['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number,url', '--limit', '5'], { cwd });
  return list && list.length ? list[0] : null;
}

// Every file a PR changes. `gh pr view --json files` stops at 100 files; `gh pr diff --name-only`
// lists them all.
function prFiles(cwd, number) {
  const res = run(['pr', 'diff', String(number), '--name-only'], { cwd });
  if (res.code !== 0) return null;
  return res.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
}

function prCreate(cwd, { base, head, title, bodyFile }) {
  const res = run(['pr', 'create', '--draft', '--base', base, '--head', head, '--title', title, '--body-file', bodyFile], { cwd });
  if (res.code !== 0) return { url: null, error: (res.stderr || res.stdout).trim() };
  const url = res.stdout.split('\n').map((l) => l.trim()).filter(Boolean).pop() || null;
  return { url, error: null };
}

function runList(cwd) {
  return json(['run', 'list', '--branch', 'main', '--event', 'push', '--json', 'status', '--limit', '5'], { cwd });
}

module.exports = { OPEN_LIMIT, run, login, prView, prList, prListOpen, openPrFor, prFiles, prCreate, runList };
