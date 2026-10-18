'use strict';

// The GitHub CLI adapter. `COORD_GH` names a JavaScript file to run in gh's place (tests and CI use
// a stateful fake); otherwise the real `gh` runs. Never through a shell. Every call returns null
// when gh is missing, signed out or fails, so the caller decides what "no answer" means: `status`
// degrades (no PR state); `ci`, `check`, `check --merge`, `start` and `rescope` cannot verify
// without it and exit 2 (`start` before it changes anything).

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

// Every PR list asks for these. isCrossRepository: a PR from another repository (a fork) can carry
// any branch name and any commit, so the engine counts only this repository's PRs. headRefOid: a
// merged or closed PR counts only for the commit it was about. author: a branch whose commit author
// maps to nobody is resolved through the login that opened its PR.
const PR_FIELDS = 'number,state,headRefName,headRefOid,isDraft,author,isCrossRepository';

// gh lists PRs newest first (CREATED_AT, descending), so a list cut at its limit has dropped only the
// oldest PRs, and their branches look live, never finished. So the list of every state may be cut:
// ALL_LIMIT is only how far back it looks for a merged or closed PR. The open list must be whole,
// since an open PR keeps a branch in view whatever its age; at its limit the engine lists each
// partner's open PRs on their own instead (prListOpenBy). Forks' PRs never count, but they fill these
// lists all the same: the engine judges the lengths before it drops them (collide.js prListsUsable).
// What the lists still miss: a merged or closed PR older than the newest 300 (the claim on a branch it
// finished is live again, OPS-224, and an unclaimed branch it finished is judged by content and dates
// instead); a branch whose only PR is a fork's (`status` says "PR: none found"); this repository's
// PRs, crowded out of both windows if PR creation is ever opened to everyone again; a PR reopened
// moments ago, which is not the newest, while search lags it in the fallback; and in the fallback, an
// open PR by anyone outside People.
const OPEN_LIMIT = 100;
const ALL_LIMIT = 300;

function prListOpen(cwd) {
  return json(['pr', 'list', '--state', 'open', '--limit', String(OPEN_LIMIT), '--json', PR_FIELDS], { cwd });
}

function prList(cwd) {
  return json(['pr', 'list', '--state', 'all', '--limit', String(ALL_LIMIT), '--json', PR_FIELDS], { cwd });
}

// A GitHub login: letters, digits and inner hyphens, 39 characters at most. Anything else is refused
// before gh runs, so a People cell cannot add a search qualifier (`x is:closed`) or a flag (`-x`).
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

// One person's OPEN PRs, or null. gh answers `--author` through GitHub's search, which can lag a PR
// opened moments ago; that PR is then the newest of all, so the other two lists still carry it.
function prListOpenBy(cwd, login) {
  if (!LOGIN_RE.test(String(login || ''))) return null;
  return json(['pr', 'list', '--state', 'open', '--author', login, '--limit', String(OPEN_LIMIT), '--json', PR_FIELDS], { cwd });
}

// The OPEN PR of this repository from branch <b> into main, or null: never a merged or closed one (a
// reused name must not pick up an old PR), and never a fork's (`--head <b>` also matches a fork's
// branch of that name). gh lists the newest first; this takes the newest such PR among 100.
function openPrFor(cwd, branch) {
  const list = json(['pr', 'list', '--head', branch, '--base', 'main', '--state', 'open', '--limit', '100', '--json', 'number,url,isCrossRepository'], { cwd });
  return (Array.isArray(list) && list.find((p) => p && p.isCrossRepository === false)) || null;
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

module.exports = { OPEN_LIMIT, ALL_LIMIT, run, login, prView, prList, prListOpen, prListOpenBy, openPrFor, prCreate, runList };
