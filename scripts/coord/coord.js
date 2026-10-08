#!/usr/bin/env node
'use strict';

// The work-ledger coordinator: two partners, one repository, no overwrites.
//
// Before either partner starts a task, this checks the other partner's live work for collisions,
// claims a slot in WORK_LEDGER.md, marks the TASKS.md row as taken and opens a draft PR. The claim
// rides inside the task's own branch and PR; the ledger on `main` is history, and the LIVE picture
// is read from WORK_LEDGER.md as it stands on every branch on origin.
//
// It fails closed. Every command except --help fetches origin first, and if it cannot (no network,
// no remote, an unknown login) it exits 2 — "cannot verify" — instead of deciding on stale refs.
//
// Exit codes: 0 CLEAR · 3 WARN · 1 HALT/FAIL · 2 cannot verify. Usage: node coord.js --help.
// Node built-ins only, CommonJS; runs with plain `node` on Windows and Ubuntu.

const fs = require('fs');
const os = require('os');
const path = require('path');

const git = require('./lib/git');
const gh = require('./lib/gh');
const { validateDeclared, covers } = require('./lib/paths');
const L = require('./lib/ledger');
const T = require('./lib/tasks');
const C = require('./lib/collide');
const R = require('./lib/render');

const LOCK_STALE_MS = 10 * 60 * 1000;

// Every ref handed to git is a FULL refname. git resolves a short `origin/main` as a tag, then a
// local branch, before the remote-tracking ref, so a stray `git branch origin/main` (or a tag of
// that name, or of `origin/<b>`) would silently change every verdict.
const MAIN = 'refs/remotes/origin/main';
const remoteRef = (b) => `refs/remotes/origin/${b}`;

class Exit extends Error {
  constructor(exitCode, message) {
    super(message);
    this.exitCode = exitCode;
  }
}

const cannotVerify = (message) => new Exit(2, message);
const halt = (message) => new Exit(1, message);
// Credentials in a remote URL (https://user:token@host/...) never reach the output.
const redact = (text) => String(text === undefined || text === null ? '' : text).replace(/:\/\/[^/@\s]+@/g, '://***@');
const out = (text) => process.stdout.write(redact(text.endsWith('\n') ? text : `${text}\n`));
// COORD_TODAY pins the date a claim records (tests); otherwise today in UTC.
const today = () => (/^\d{4}-\d{2}-\d{2}$/.test(process.env.COORD_TODAY || '') ? process.env.COORD_TODAY : new Date().toISOString().slice(0, 10));
const oneLine = (s) => L.oneLine(s);
const list = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const memo = (fn) => {
  let done = false;
  let value;
  return () => {
    if (!done) { value = fn(); done = true; }
    return value;
  };
};

// ---- arguments ------------------------------------------------------------------------------

const VALUE_FLAGS = new Set(['paths', 'resources', 'task', 'merge', 'title', 'branch', 'dir', 'pr', 'author', 'mode']);
const BOOL_FLAGS = new Set(['json', 'dry-run', 'help']);

function parseArgs(argv) {
  const parsed = { cmd: null, flags: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h') { parsed.flags.help = true; continue; }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const name = eq > 0 ? arg.slice(2, eq) : arg.slice(2);
      if (BOOL_FLAGS.has(name)) { parsed.flags[name] = true; continue; }
      if (!VALUE_FLAGS.has(name)) throw new Exit(2, `unknown option --${name}\n\n${R.USAGE}`);
      const value = eq > 0 ? arg.slice(eq + 1) : argv[(i += 1)];
      if (value === undefined) throw new Exit(2, `--${name} needs a value`);
      parsed.flags[name] = value;
    } else if (!parsed.cmd) {
      parsed.cmd = arg;
    } else {
      throw new Exit(2, `unexpected argument "${arg}"\n\n${R.USAGE}`);
    }
  }
  return parsed;
}

function parseTask(value) {
  if (value === undefined) return { task: null, taskKind: null };
  const v = String(value).trim();
  if (/^own:[a-z0-9][a-z0-9-]*$/.test(v)) return { task: v, taskKind: 'own' };
  if (/^[A-Z][A-Z0-9]*-\d+$/.test(v)) return { task: v, taskKind: 'TASKS' };
  throw halt(`HALT — --task must be a TASKS id such as BE-120, or own:<slug> in lower case (got "${v}")`);
}

function declaredPaths(value) {
  const { paths, errors } = validateDeclared(list(value));
  if (errors.length) throw halt(`HALT — paths refused:\n${errors.map((e) => `  ${e}`).join('\n')}`);
  if (!paths.length) throw new Exit(2, '--paths is empty');
  return paths;
}

function declaredResources(value, rules) {
  const res = list(value);
  const unknown = res.filter((r) => !rules.resources.includes(r));
  if (unknown.length) throw halt(`HALT — unknown resource ${unknown.join(', ')}; ${L.LEDGER_PATH} lists ${rules.resources.join(', ')}`);
  return res;
}

// ---- context: identity, fetch, rules ----------------------------------------------------------

function repoRoot(cwd) {
  const top = git.topLevel(cwd);
  if (!top) throw cannotVerify('cannot verify: not inside a git repository');
  return top;
}

// COORD_LOGIN if set, else the login gh is signed in with. When both answer they must agree: a
// session that says it is one partner while gh acts as the other would claim in one name and open
// PRs in another.
function identify(root) {
  const fromEnv = (process.env.COORD_LOGIN || '').trim();
  const fromGh = gh.login(root);
  if (fromEnv) {
    if (fromGh && fromGh.toLowerCase() !== fromEnv.toLowerCase()) {
      throw cannotVerify(`cannot verify: COORD_LOGIN says @${fromEnv} but gh is signed in as @${fromGh}; unset COORD_LOGIN or sign gh in as @${fromEnv}`);
    }
    return { login: fromEnv, ghOk: Boolean(fromGh) };
  }
  if (!fromGh) throw cannotVerify('cannot verify: cannot tell who you are — set COORD_LOGIN, or sign in with `gh auth login`');
  return { login: fromGh, ghOk: true };
}

function fetchOrStop(root) {
  if (git.isShallow(root)) {
    throw cannotVerify('cannot verify: this is a shallow clone, so merge-bases and branch diffs are incomplete — run `git fetch --unshallow` first');
  }
  const res = git.fetch(root);
  if (res.code !== 0) {
    const why = (res.stderr || res.stdout).trim().split('\n').filter(Boolean).pop() || `exit ${res.code}`;
    throw cannotVerify(`cannot verify: git fetch --prune origin failed (${redact(why)}); nothing is decided on stale refs`);
  }
}

// The rules (People, exclusive rows, shared, owner-only, resources) come from origin/main. Until the
// ledger itself has landed there, they come from this checkout, and every command says so — except
// `ci` (fromCheckout: false): the checkout it runs in IS the branch under test, whose own ledger
// would grade itself.
function loadRules(root, { fromCheckout = true } = {}) {
  const mainText = git.showFile(root, MAIN, L.LEDGER_PATH);
  if (mainText === null && !fromCheckout) {
    throw cannotVerify(`cannot verify: origin/main has no ${L.LEDGER_PATH}; ci takes its rules only from main, never from the branch it checks`);
  }
  const text = mainText !== null ? mainText : git.readWorktreeFile(root, L.LEDGER_PATH);
  if (text === null) throw cannotVerify(`cannot verify: no ${L.LEDGER_PATH} on origin/main or in this checkout`);
  const rules = L.parseLedger(text);
  if (rules.errors.length) {
    throw cannotVerify(`cannot verify: the ${L.LEDGER_PATH} header does not parse —\n${rules.errors.map((e) => `  ${e}`).join('\n')}`);
  }
  if (rules.people.length < 2) throw cannotVerify(`cannot verify: ${L.LEDGER_PATH} has no People table with both partners`);
  return {
    rules,
    mainLedger: mainText !== null ? rules : null,
    note: mainText !== null ? null : `note: origin/main has no ${L.LEDGER_PATH} yet; the rules were read from this checkout`,
  };
}

function personOf(rules, login) {
  const person = L.personByLogin(rules, login);
  if (!person) throw cannotVerify(`cannot verify: unknown login @${login} — it is not in the People table of ${L.LEDGER_PATH}`);
  return person;
}

function context(cwd, { identity = true, rulesFromCheckout = true } = {}) {
  const root = repoRoot(cwd);
  const who = identity ? identify(root) : null;
  fetchOrStop(root);
  const { rules, mainLedger, note } = loadRules(root, { fromCheckout: rulesFromCheckout });
  return {
    cwd,
    root,
    who,
    me: who ? personOf(rules, who.login) : null,
    rules,
    mainLedger,
    note,
    now: Math.floor(Date.now() / 1000),
  };
}

// ---- reading origin ---------------------------------------------------------------------------

// → { footprints, remoteNames, prs }: every other branch's live claims and unclaimed recent work.
// With `useGh`, one `gh pr list` lets a branch whose newest PR is merged or closed drop out; without
// it (status when gh is missing) a squash-merged branch drops out by content instead.
function gather(ctx, { useGh = true, requireGh = false } = {}) {
  const { root } = ctx;
  let prs = null;
  if (useGh) {
    const open = gh.prListOpen(root);
    const all = gh.prList(root);
    const usable = C.prListsUsable({ open, all, openLimit: gh.OPEN_LIMIT });
    if (requireGh && !usable.ok) {
      throw cannotVerify(`cannot verify: ${usable.reason} — without the PR lists, open work cannot be told from finished work`);
    }
    if (open || all) {
      const byNumber = new Map();
      for (const p of (all || []).concat(open || [])) byNumber.set(p.number, p);
      prs = [...byNumber.values()];
    }
  }
  const stats = {};
  const common = git.commonDir(root);
  const birth = memo(() => git.cloneBirth(common));
  const mainBlobs = memo(() => git.treeBlobs(root, MAIN));
  const mainRoots = memo(() => git.roots(root, MAIN));
  const remote = git.remoteBranches(root);
  const branches = remote.filter((b) => b.name !== 'main').map((b) => {
    const ref = remoteRef(b.name);
    // No merge-base: an orphan branch (no root in common with main) is all footprint; anything else
    // means the clone is missing history, and nothing is decided on it.
    const base = memo(() => {
      const mb = git.mergeBase(root, MAIN, ref);
      if (mb) return mb;
      if (git.roots(root, ref).some((r) => mainRoots().includes(r))) {
        throw cannotVerify(`cannot verify: origin/${b.name} shares history with origin/main but git finds no merge-base — the clone is incomplete; run \`git fetch --unshallow\``);
      }
      return null;
    });
    const headLedgerText = git.showFile(root, ref, L.LEDGER_PATH);
    const changed = memo(() => (base() ? git.diffNames(root, base(), ref) : git.treeFiles(root, ref)));
    return {
      name: b.name,
      sha: b.sha,
      tipTime: b.tipTime,
      seenTime: memo(() => git.reflogTime(common, b.name, birth())),
      author: b.author,
      committer: b.committer,
      headLedgerText,
      baseLedgerText: headLedgerText === null || !base() ? null : git.showFile(root, base(), L.LEDGER_PATH),
      changed,
      prDone: () => C.prDoneFor(prs, b.name, b.sha),
      prOpen: () => C.prOpenFor(prs, b.name),
      prAuthor: () => C.prAuthorFor(prs, b.name, b.sha),
      merged: memo(() => git.isAncestor(root, ref, MAIN)),
      contentMerged: memo(() => C.mergedByContent(changed(), git.treeBlobs(root, ref), mainBlobs())),
      firstLedgerTime: memo(() => (base() ? git.firstLedgerTime(root, base(), ref, L.LEDGER_PATH) : null)),
    };
  });
  return {
    footprints: C.deriveFootprints({ mainLedger: ctx.mainLedger, rules: ctx.rules, branches, now: ctx.now, stats }),
    remoteNames: new Set(remote.map((b) => b.name)),
    prs,
    stats,
  };
}

// Test files on main that name one of my declared files, so a change to the file can break them.
function testMentionsFor(ctx, declared) {
  const mentions = {};
  for (const p of declared) {
    if (p.includes('*')) continue;
    const hits = git.grepTests(ctx.root, MAIN, path.posix.basename(p))
      .filter((t) => !declared.some((d) => d.toLowerCase() === t.toLowerCase()));
    if (hits.length) mentions[p] = hits;
  }
  return mentions;
}

function runCheck(ctx, { declared, resources, task, taskKind, branch }) {
  const { footprints, remoteNames, stats } = gather(ctx, { requireGh: true });
  // My own footprint on the branch I stand on (or am claiming) is not a collision; his is, even when
  // I have checked his branch out under its own name.
  const relevant = C.dropSelf(footprints, branch, ctx.me);
  const others = relevant.filter((f) => !(f.person && f.person.section === ctx.me.section));
  const result = C.assess({
    rules: ctx.rules,
    me: ctx.me,
    mine: { declared, resources, task, taskKind, branch },
    footprints: relevant,
    mainTasks: git.showFile(ctx.root, MAIN, T.TASKS_PATH) || '',
    testMentions: others.length ? testMentionsFor(ctx, declared) : {},
    now: ctx.now,
  });
  return { result, footprints, remoteNames, others, stats };
}

// The recency residual, said once, only when a branch was actually judged on commit dates alone.
const recencyNotes = (stats) => (stats && stats.ageOnly && stats.ageOnly.length ? [C.RECENCY_NOTE] : []);

const otherName = (ctx) => (L.otherPerson(ctx.rules, ctx.me) || { name: 'the other partner' }).name;
const counts = (others) => ({ claims: others.filter((f) => f.kind === 'claim').length, unclaimed: others.filter((f) => f.kind !== 'claim').length });

// ---- check ------------------------------------------------------------------------------------

// Every file a PR changes, listed by git after the fetch: from its merge-base with main to its head,
// with renames as a delete plus an add, so a rename's SOURCE path counts (gh, like GitHub, names a
// rename by its new path only). Someone else's PR is refused whatever it changes, so its files are
// not needed; for mine, a head that is not on origin cannot be listed, and nothing is decided.
function prFiles(ctx, pr, number) {
  const author = String((pr.author && pr.author.login) || '').toLowerCase();
  if (author !== ctx.me.login.toLowerCase()) return [];
  const b = String(pr.headRefName || '');
  // L3 · a fork's branch of the same name is not this one; and the files listed must be the files of
  // the very commit GitHub would merge.
  if (pr.isCrossRepository === true) {
    throw cannotVerify(`cannot verify: PR #${number} comes from another repository (a fork): its head is not origin/${b}`);
  }
  if (!b || !git.refExists(ctx.root, remoteRef(b))) {
    throw cannotVerify(`cannot verify: PR #${number}'s head branch ${b || '(none)'} is not on origin after the fetch, so its files cannot be listed`);
  }
  const tip = git.revParse(ctx.root, remoteRef(b));
  if (!pr.headRefOid || pr.headRefOid !== tip) {
    const shown = pr.headRefOid ? String(pr.headRefOid).slice(0, 7) : 'no commit';
    throw cannotVerify(`cannot verify: GitHub shows ${shown} as PR #${number}'s head, but origin/${b} is at ${String(tip).slice(0, 7)} — wait until both name the same commit, then run it again`);
  }
  const base = git.mergeBase(ctx.root, MAIN, remoteRef(b));
  if (!base) throw cannotVerify(`cannot verify: origin/${b} has no merge-base with origin/main, so PR #${number}'s files cannot be listed`);
  return git.diffNames(ctx.root, base, remoteRef(b));
}

function cmdCheck(cwd, flags) {
  if (!flags.paths && !flags.merge) throw new Exit(2, `check needs --paths a,b,c (or --merge N)\n\n${R.USAGE}`);
  if (flags.merge && !/^\d+$/.test(flags.merge)) throw new Exit(2, '--merge needs a PR number');
  const ctx = context(cwd);
  const declared = flags.paths ? declaredPaths(flags.paths) : [];
  const resources = declaredResources(flags.resources, ctx.rules);
  const { task, taskKind } = parseTask(flags.task);
  const branch = git.currentBranch(ctx.root);

  let reasons = [];
  let footprints = null;
  let others = [];
  let stats = null;
  if (flags.paths) {
    const r = runCheck(ctx, { declared, resources, task, taskKind, branch });
    reasons = r.result.reasons;
    footprints = r.footprints;
    others = r.others;
    stats = r.stats;
  }
  if (flags.merge) {
    const pr = gh.prView(ctx.root, flags.merge, 'author,headRefName,headRefOid,isCrossRepository');
    if (!pr) throw cannotVerify(`cannot verify: gh could not read PR #${flags.merge}`);
    pr.files = prFiles(ctx, pr, flags.merge).map((p) => ({ path: p }));
    const runs = gh.runList(ctx.root);
    if (!runs) throw cannotVerify('cannot verify: gh could not list the push runs on main');
    if (!footprints) {
      const g = gather(ctx, { requireGh: true });
      footprints = g.footprints;
      stats = g.stats;
      others = footprints.filter((f) => !(f.person && f.person.section === ctx.me.section));
    }
    reasons = reasons.concat(C.mergeAdvice({ rules: ctx.rules, me: ctx.me, pr: { ...pr, number: Number(flags.merge) }, runs, footprints, now: ctx.now }).reasons);
  }

  // Until the ledger has landed on main, the rules came from this checkout: a CLEAR is not trusted.
  if (ctx.note && C.verdictOf(reasons) === 'CLEAR') {
    reasons.push({ level: 'WARN', class: 'rules', person: null, login: null, branch: null, slot: null, files: [], message: `${ctx.note.replace(/^note: /, '')} — a CLEAR is not trusted until it lands` });
  }
  const verdict = C.verdictOf(reasons);
  const code = C.exitCodeOf(verdict);
  if (flags.json) {
    out(JSON.stringify({ verdict, exitCode: code, login: ctx.me.login, note: ctx.note, notes: recencyNotes(stats), reasons }, null, 2));
  } else {
    out(R.renderCheck({ verdict, reasons }, { otherName: otherName(ctx), counted: counts(others) }));
    for (const n of recencyNotes(stats)) out(n);
    if (ctx.note) out(ctx.note);
  }
  return code;
}

// ---- start ------------------------------------------------------------------------------------

function acquireLock(dir) {
  const file = path.join(dir, 'coord.lock');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let fd;
    try {
      fd = fs.openSync(file, 'wx');
    } catch (err) {
      if (err.code !== 'EEXIST') throw cannotVerify(`cannot verify: cannot create the lock ${file} (${err.message})`);
      let age;
      try { age = Date.now() - fs.statSync(file).mtimeMs; } catch { continue; }
      if (age > LOCK_STALE_MS) {
        try { fs.unlinkSync(file); } catch { /* raced with another cleaner */ }
        continue;
      }
      throw cannotVerify(`cannot verify: another start is running (lock ${file}, ${Math.round(age / 1000)} s old); wait for it, or delete the lock if that run died`);
    }
    fs.writeSync(fd, `${process.pid} ${new Date().toISOString()}\n`);
    return {
      release() {
        try { fs.closeSync(fd); } catch { /* already closed */ }
        try { fs.unlinkSync(file); } catch { /* already gone */ }
      },
    };
  }
  throw cannotVerify(`cannot verify: cannot take the lock ${file}`);
}

// A squash merge takes the PR's title as main's commit subject, so the title is in main's
// `type: subject` form: the type from the branch prefix, the task at the end.
const TITLE_TYPES = { fix: 'fix', feat: 'feat', docs: 'docs', chore: 'chore', design: 'feat' };
function prTitle(branch, task, title) {
  const prefix = branch.includes('/') ? branch.slice(0, branch.indexOf('/')).toLowerCase() : '';
  return `${Object.hasOwn(TITLE_TYPES, prefix) ? TITLE_TYPES[prefix] : 'chore'}: ${title} (${task})`;
}

function prBody({ slotId, claim, declared }) {
  return [
    `Claims ledger slot ${slotId} in ${L.LEDGER_PATH} for ${claim.task}.`,
    '',
    ...L.renderSlotBody(claim),
    '',
    'Paths claimed:',
    ...declared.map((p) => `- \`${p}\``),
    '',
    'Claimed with scripts/coord/coord.js',
    '',
  ].join('\n');
}

// N7 · start, ship and rescope commit whole files. So they write only into a TASKS.md and a
// WORK_LEDGER.md that match HEAD: anything else in them would ride along in a [skip ci] commit
// that claims to hold only the coordinator's lines.
function refuseDirty(dir, who) {
  const dirty = [];
  for (const f of [T.TASKS_PATH, L.LEDGER_PATH]) {
    const res = git.run(dir, ['diff', '--quiet', 'HEAD', '--', f]);
    if (res.code === 1) dirty.push(f);
    else if (res.code !== 0) throw cannotVerify(`cannot verify: git diff of ${f} in ${dir} failed (${redact((res.stderr || res.stdout).trim())})`);
  }
  if (dirty.length) {
    throw halt(`HALT — ${dirty.join(' and ')} ${dirty.length === 1 ? 'has' : 'have'} uncommitted changes in ${dir}; ${who} commits only its own lines there, so commit or discard those changes first. Nothing was changed.`);
  }
}

function filesDifferingFromHead(dir, files) {
  const res = git.run(dir, ['diff', '--name-only', '-z', 'HEAD', '--', ...files]);
  return res.code === 0 ? res.stdout.split('\0').filter(Boolean) : files;
}

function commitFiles(dir, files, message) {
  const pending = filesDifferingFromHead(dir, files);
  if (!pending.length) return false;
  git.add(dir, pending);
  git.must(dir, ['commit', '--quiet', '-m', message, '--', ...pending]);
  return true;
}

function pushIfAhead(dir, branch, setUpstream, again) {
  if (git.revParse(dir, 'HEAD') === git.revParse(dir, remoteRef(branch))) return false;
  const res = git.push(dir, branch, { setUpstream });
  if (res.code !== 0) {
    throw cannotVerify(`cannot verify: git push of ${branch} failed (${redact((res.stderr || res.stdout).trim())}); the claim is committed on ${branch} locally — ${again}`);
  }
  return true;
}

// The write guard: a claim is written only when the ledger would read it back as the same claim.
function assertRoundTrip(claim) {
  if (!L.claimRoundTrips(claim)) {
    throw halt('HALT — this claim would not read back the same from the ledger (a title or path carries characters the format cannot hold); nothing was written');
  }
}

function cmdStart(cwd, flags) {
  for (const f of ['task', 'title', 'paths', 'branch']) if (!flags[f]) throw new Exit(2, `start needs --${f}\n\n${R.USAGE}`);
  const root = repoRoot(cwd);
  const who = identify(root);
  if (!who.ghOk) {
    throw cannotVerify('cannot verify: gh is not usable (missing or signed out) and start needs it for the draft PR — run `gh auth login`; nothing was changed');
  }
  // start commits the claim; without an identity that commit fails half-way, so check it first.
  for (const v of ['GIT_AUTHOR_IDENT', 'GIT_COMMITTER_IDENT']) {
    if (git.run(root, ['var', v]).code !== 0) {
      throw cannotVerify('cannot verify: git has no author/committer identity in this clone (user.name and user.email), so the claim could not be committed — set them and run start again; nothing was changed');
    }
  }
  fetchOrStop(root);
  const { rules, mainLedger, note } = loadRules(root);
  const ctx = { cwd, root, who, me: personOf(rules, who.login), rules, mainLedger, note, now: Math.floor(Date.now() / 1000) };
  const lock = acquireLock(git.commonDir(root));
  try {
    return startLocked(ctx, flags);
  } finally {
    lock.release();
  }
}

function startLocked(ctx, flags) {
  const { root, me, rules, mainLedger } = ctx;
  const b = String(flags.branch).trim();
  if (b === 'main' || b === 'HEAD' || !L.BRANCH_RE.test(b) || !git.validBranchName(root, b)) {
    throw halt(`HALT — ${JSON.stringify(b)} is not a branch name start can use (letters, digits, ".", "_", "-" and "/" only)`);
  }
  const { task, taskKind } = parseTask(flags.task);
  const title = oneLine(flags.title);
  if (!title) throw new Exit(2, '--title is empty');
  const declared = declaredPaths(flags.paths);
  const resources = declaredResources(flags.resources, rules);
  if (!mainLedger) throw cannotVerify(`cannot verify: origin/main has no ${L.LEDGER_PATH} yet — claims start once the ledger has landed on main`);

  // A name main's ledger still records belongs to landed work: it is never reused for new work.
  const recorded = mainLedger.slots.find((s) => s.claim && s.claim.branch === b);
  if (recorded) throw halt(`HALT — ${b} is recorded in slot ${recorded.id} of ${L.LEDGER_PATH} on main; a branch name is never reused — choose a new one`);

  // start writes only onto a branch it claimed. If the name exists anywhere — a worktree, a local
  // branch (gh pr checkout makes one), origin — it goes on only as a resume of MY claim naming <b>:
  // on origin when the branch is there (origin decides), else in the branch's own ledger (a claim a
  // failed push left behind). Otherwise nothing is touched, origin/<b> least of all.
  const wt = git.worktrees(root).find((w) => w.branch === b) || null;
  const onOrigin = git.refExists(root, remoteRef(b));
  const local = git.refExists(root, `refs/heads/${b}`);
  let slotId = null;
  let existing = null;
  if (wt || onOrigin || local) {
    let text = null;
    if (onOrigin) text = git.showFile(root, remoteRef(b), L.LEDGER_PATH);
    else text = wt ? git.readWorktreeFile(wt.path, L.LEDGER_PATH) : git.showFile(root, `refs/heads/${b}`, L.LEDGER_PATH);
    const slot = text ? L.parseLedger(text, { people: rules.people }).slots.find((s) => s.section === me.section && s.claim && s.claim.branch === b) : null;
    if (!slot) {
      const where = [wt ? `a worktree at ${wt.path}` : null, onOrigin ? 'on origin' : 'locally'].filter(Boolean).join(', ');
      const leftover = onOrigin ? '' : ` If it is left over from an interrupted start, remove it first (${wt ? `git worktree remove "${wt.path}", then ` : ''}git branch -D ${b}).`;
      throw halt(`HALT — branch ${b} already exists (${where}) and carries no claim of yours naming it in ${L.LEDGER_PATH}; start writes only onto a branch it claimed. Choose a new name.${leftover}`);
    }
    slotId = slot.id;
    existing = slot.claim;
    if (wt) refuseDirty(wt.path, 'a resumed start');
  }
  const already = () => [
    onOrigin ? `origin/${b} with your claim in ${slotId}` : `your claim in ${slotId} on the local branch ${b}, not yet on origin`,
    wt ? `the worktree ${wt.path}` : null,
  ].filter(Boolean).join(' and ');

  const { result, footprints, remoteNames, stats } = runCheck(ctx, { declared, resources, task, taskKind, branch: b });
  if (result.reasons.length) out(R.renderReasons(result.reasons));
  for (const n of recencyNotes(stats)) out(n);
  if (result.verdict === 'HALT') {
    throw halt(existing ? `HALT — this run changed nothing; what already exists: ${already()}` : 'HALT — nothing was changed: no branch, no worktree, no claim');
  }

  if (!slotId) {
    const busy = new Set(footprints.filter((f) => f.kind === 'claim' && f.person && f.person.section === me.section && f.branch !== b).map((f) => f.slot));
    slotId = L.pickSlot({ mainLedger, section: me.section, remoteBranches: remoteNames, busySlots: busy });
  }
  if (!slotId) throw halt(`HALT — all your slots are busy: every ${me.name} slot holds a live claim; ship or release one first`);

  // A relative --dir means "relative to the repository root", wherever start runs from.
  const top = git.mainRoot(root);
  const dir = wt ? wt.path : (flags.dir ? path.resolve(top, flags.dir) : path.join(top, `.worktree-${b.replace(/\//g, '-')}`));
  const claim = {
    task,
    taskKind,
    title,
    branch: b,
    paths: declared,
    resources,
    state: existing ? existing.state : 'claimed',
    pr: existing ? existing.pr : null,
    started: existing ? existing.started : today(),
  };
  assertRoundTrip(claim);
  if (flags['dry-run']) {
    out(`${result.verdict} — dry run: would ${existing ? 'resume' : 'claim'} ${slotId} for ${task} on ${existing ? '' : 'new '}branch ${b} in ${dir}; nothing was changed`);
    return C.exitCodeOf(result.verdict);
  }

  if (!wt) {
    if (fs.existsSync(dir)) throw halt(`HALT — ${dir} already exists; pass --dir <path>`);
    if (local) git.must(root, ['worktree', 'add', dir, b]);
    else if (onOrigin) git.must(root, ['worktree', 'add', '--no-track', '-b', b, dir, remoteRef(b)]);
    else git.worktreeAdd(root, dir, b, MAIN);
  }

  const ledgerText = git.readWorktreeFile(dir, L.LEDGER_PATH);
  if (ledgerText === null) throw cannotVerify(`cannot verify: no ${L.LEDGER_PATH} in ${dir}`);
  const nextLedger = L.setSlot(ledgerText, slotId, claim);
  if (nextLedger !== ledgerText) git.writeWorktreeFile(dir, L.LEDGER_PATH, nextLedger);
  const files = [L.LEDGER_PATH];
  if (taskKind === 'TASKS') {
    const tasksText = git.readWorktreeFile(dir, T.TASKS_PATH);
    const line = T.statusLine({ name: me.name, login: me.login, branch: b, since: claim.started, slot: slotId });
    let nextTasks;
    try {
      nextTasks = T.setStatusLine(tasksText || '', task, line);
    } catch (err) {
      throw halt(`HALT — ${err.message}`);
    }
    if (nextTasks !== tasksText) git.writeWorktreeFile(dir, T.TASKS_PATH, nextTasks);
    files.push(T.TASKS_PATH);
  }
  commitFiles(dir, files, `chore: claim ${task} [skip ci]`);
  pushIfAhead(dir, b, true, 'run the same start again to push it');

  // The race window: overlapping work that reached origin between my check and my push. My check
  // passed, so ANY HALT now is that race — no timestamp decides it. The script never deletes: it
  // says what exists and how to release mine, and the two partners decide.
  const pushed = `the claim is already pushed as origin/${b} in ${slotId}, with the worktree ${dir}; no PR was opened — run the same start again to re-check it and open the PR`;
  let again;
  try {
    fetchOrStop(root);
    again = gather(ctx, { requireGh: true });
  } catch (err) {
    // A4 · whatever stopped the re-check, the push already happened: say what exists.
    throw cannotVerify(`${err instanceof Exit ? err.message : `cannot verify: ${err.message}`}\nNothing was decided after the push: ${pushed}.`);
  }
  const recheck = C.assess({
    rules,
    me,
    mine: { declared, resources, task, taskKind, branch: b },
    footprints: C.dropSelf(again.footprints, b, me),
    mainTasks: git.showFile(root, MAIN, T.TASKS_PATH) || '',
    testMentions: {},
    now: ctx.now,
  });
  // N13 · the lock is per clone: two clones of mine (two sessions) can pick the same free slot.
  // Another live claim of mine, on another branch, in this slot is that race.
  const twins = again.footprints.filter((f) => f.kind === 'claim' && f.slot === slotId && f.branch !== b && f.person && f.person.section === me.section);
  const lost = recheck.reasons.filter((r) => r.level === 'HALT').concat(twins.map((t) => ({
    level: 'HALT', class: 'slot', message: `your own claim on branch ${t.branch} holds slot ${slotId} too — two of your clones took the same slot`,
  })));
  if (lost.length) {
    const ownOnly = lost.length === twins.length;
    out(R.renderReasons(lost));
    out([
      `HALT — a race: the ${ownOnly ? 'claim' : 'work'} above reached origin between your check and your push.`,
      `What exists now: your claim in ${slotId} is pushed as origin/${b}, with the worktree ${dir}; no PR was opened.`,
      `${ownOnly ? 'Decide which of your two claims goes on' : 'Decide together who goes on'}. To release this one, run (nothing is ever deleted automatically):`,
      `  git push origin --delete ${b}`,
      `  git worktree remove "${dir}"`,
      `  git branch -D ${b}`,
    ].join('\n'));
    throw halt('HALT — lost the race for this claim; no PR was opened');
  }

  let url;
  const open = gh.openPrFor(dir, b);
  if (open && open.url) {
    url = open.url;
  } else {
    const tmp = path.join(os.tmpdir(), `coord-pr-${process.pid}-${Date.now()}.md`);
    fs.writeFileSync(tmp, prBody({ slotId, claim, declared }), 'utf8');
    try {
      const created = gh.prCreate(dir, { base: 'main', head: b, title: prTitle(b, task, title), bodyFile: tmp });
      if (!created.url) throw cannotVerify(`cannot verify: gh pr create failed (${redact(created.error)}); the claim is pushed — run the same start again to open the PR`);
      url = created.url;
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  out([
    `${result.verdict} — ${existing ? 'resumed' : 'claimed'} ${slotId} for ${task}`,
    `  branch:   ${b}`,
    `  worktree: ${dir}`,
    `  draft PR: ${url}`,
  ].join('\n'));
  return C.exitCodeOf(result.verdict);
}

// ---- ship / rescope / release (inside the task worktree) ------------------------------------------

function ownSlotHere(ctx) {
  const b = git.currentBranch(ctx.root);
  if (!b) throw halt('HALT — not on a branch; run this inside the task worktree');
  const text = git.readWorktreeFile(ctx.root, L.LEDGER_PATH);
  if (text === null) throw halt(`HALT — no ${L.LEDGER_PATH} in this checkout`);
  const slot = L.parseLedger(text, { people: ctx.rules.people }).slots.find((s) => s.claim && s.claim.branch === b);
  if (!slot) throw halt(`HALT — no ledger slot names the branch ${b}`);
  if (slot.section !== ctx.me.section) {
    const owner = L.personBySection(ctx.rules, slot.section);
    throw halt(`HALT — slot ${slot.id} on ${b} is ${owner ? owner.name : 'the other partner'}'s, not yours`);
  }
  return { b, text, slot };
}

// ship and rescope change a claim that is on origin; they never re-create a branch that is gone
// (deleted, merged, never pushed) or whose claim has already landed.
function requireOnOrigin(ctx, b) {
  if (!git.refExists(ctx.root, remoteRef(b))) {
    throw halt(`HALT — ${b} does not exist on origin (deleted, merged or never pushed); ship and rescope never re-create a branch`);
  }
  if (ctx.mainLedger && ctx.mainLedger.slots.some((s) => s.claim && s.claim.branch === b)) {
    throw halt(`HALT — ${b} is recorded in ${L.LEDGER_PATH} on main: its claim has landed`);
  }
}

function driftOf(ctx, declared) {
  const base = git.mergeBase(ctx.root, MAIN, 'HEAD');
  const actual = base ? git.diffNames(ctx.root, base, 'HEAD') : [];
  const cover = C.expandCoupled(declared, ctx.rules.exclusive).patterns.concat(ctx.rules.shared, C.IGNORED_SHARED);
  return actual.filter((f) => !covers(cover, f));
}

function cmdShip(cwd, flags) {
  if (flags.pr && !/^\d+$/.test(flags.pr)) throw new Exit(2, '--pr needs a PR number');
  const ctx = context(cwd);
  const { b, text, slot } = ownSlotHere(ctx);
  requireOnOrigin(ctx, b);
  refuseDirty(ctx.root, 'ship');
  let n = flags.pr ? Number(flags.pr) : null;
  if (!n) {
    const pr = gh.openPrFor(ctx.root, b);
    if (!pr) throw cannotVerify(`cannot verify: no open PR found for ${b} — pass --pr N`);
    n = Number(pr.number);
  }
  const drift = driftOf(ctx, slot.claim.paths);
  const shipped = { ...slot.claim, state: 'in-review', pr: n };
  assertRoundTrip(shipped);
  const driftLines = drift.length ? [`  WARN [drift] changed but not claimed: ${drift.map((f) => `\`${f}\``).join(', ')} — rescope before the ci check fails`] : [];
  const verdict = drift.length ? 'WARN' : 'CLEAR';
  // L9 · a dry run says what ship would do, and writes, commits and pushes nothing
  if (flags['dry-run']) {
    out([`${verdict} — dry run: would mark ${slot.id} (${slot.claim.task}) in review as PR #${n}; nothing was changed`, ...driftLines].join('\n'));
    return drift.length ? 3 : 0;
  }
  const next = L.setSlot(text, slot.id, shipped);
  if (next !== text) git.writeWorktreeFile(ctx.root, L.LEDGER_PATH, next);
  commitFiles(ctx.root, [L.LEDGER_PATH], `chore: ${slot.claim.task} in review`);
  pushIfAhead(ctx.root, b, false, 'run ship again');
  out([`${verdict} — ${slot.id} (${slot.claim.task}) is in review as PR #${n}`, ...driftLines].join('\n'));
  return drift.length ? 3 : 0;
}

function cmdRescope(cwd, flags) {
  if (!flags.paths) throw new Exit(2, `rescope needs --paths a,b,c\n\n${R.USAGE}`);
  const ctx = context(cwd);
  const { b, text, slot } = ownSlotHere(ctx);
  requireOnOrigin(ctx, b);
  refuseDirty(ctx.root, 'rescope');
  const declared = declaredPaths(flags.paths);
  const { result, stats } = runCheck(ctx, {
    declared, resources: slot.claim.resources, task: slot.claim.task, taskKind: slot.claim.taskKind, branch: b,
  });
  if (result.reasons.length) out(R.renderReasons(result.reasons));
  for (const n of recencyNotes(stats)) out(n);
  if (result.verdict === 'HALT') throw halt('HALT — the new paths collide; the claim was not changed');
  const rescoped = { ...slot.claim, paths: declared };
  assertRoundTrip(rescoped);
  const listed = declared.map((p) => `\`${p}\``).join(', ');
  // L9 · a dry run says what rescope would do, and writes, commits and pushes nothing
  if (flags['dry-run']) {
    out(`${result.verdict} — dry run: would make ${slot.id} (${slot.claim.task}) claim ${listed}; nothing was changed`);
    return C.exitCodeOf(result.verdict);
  }
  const next = L.setSlot(text, slot.id, rescoped);
  if (next !== text) git.writeWorktreeFile(ctx.root, L.LEDGER_PATH, next);
  commitFiles(ctx.root, [L.LEDGER_PATH], `chore: rescope ${slot.claim.task}`);
  pushIfAhead(ctx.root, b, false, 'run rescope again');
  out(`${result.verdict} — ${slot.id} (${slot.claim.task}) now claims ${listed}`);
  return C.exitCodeOf(result.verdict);
}

function cmdRelease(cwd) {
  const ctx = context(cwd);
  const { b, slot } = ownSlotHere(ctx);
  let n = slot.claim.pr;
  if (!n) {
    const pr = gh.openPrFor(ctx.root, b);
    n = pr ? pr.number : null;
  }
  const lines = [`To release ${slot.id} (${slot.claim.task}) on ${b}, run these yourself — nothing was run:`];
  lines.push(n ? `  gh pr close ${n} --delete-branch` : `  git push origin --delete ${b}`);
  if (path.resolve(ctx.root) !== path.resolve(git.mainRoot(ctx.root))) lines.push(`  git worktree remove "${ctx.root}"`);
  lines.push(`  git branch -D ${b}`);
  out(lines.join('\n'));
  return 0;
}

// ---- status -----------------------------------------------------------------------------------

function cmdStatus(cwd, flags) {
  const ctx = context(cwd, { identity: false });
  const { footprints, prs, stats } = gather(ctx);
  const prInfo = (b) => (prs ? C.newestPr(prs, b) : { unknown: true });
  const shared = ctx.rules.shared.concat(C.IGNORED_SHARED);
  const view = {
    people: ctx.rules.people.map((p) => ({ name: p.name, login: p.login, section: p.section, claims: [], unclaimed: [] })),
    unknown: [],
    freeze: C.freezeHolders(footprints).map((f) => ({
      person: f.person ? f.person.name : null, login: f.person ? f.person.login : null, slot: f.slot, branch: f.branch, task: f.task,
    })),
  };
  for (const fp of footprints) {
    const ageDays = C.daysOld(fp.tipTime, ctx.now);
    const age = C.ageText(fp.tipTime, ctx.now);
    const person = fp.person ? view.people.find((p) => p.section === fp.person.section) : null;
    if (fp.kind === 'claim' && person) {
      const cover = C.expandCoupled(fp.declared, ctx.rules.exclusive).patterns.concat(shared);
      person.claims.push({
        slot: fp.slot,
        task: fp.task,
        title: fp.title,
        branch: fp.branch,
        state: fp.state,
        malformed: Boolean(fp.malformed),
        pr: fp.pr,
        paths: fp.declared,
        resources: fp.resources,
        ageDays,
        age,
        drift: fp.actual.filter((f) => !covers(cover, f)),
        behindMain: !git.isAncestor(ctx.root, MAIN, remoteRef(fp.branch)),
        prInfo: prInfo(fp.branch),
      });
    } else if (person) {
      person.unclaimed.push({ branch: fp.branch, ageDays, age, files: fp.actual, prInfo: prInfo(fp.branch) });
    } else {
      view.unknown.push({ branch: fp.branch, author: fp.author ? `${fp.author.name} <${fp.author.email}>` : 'unknown', ageDays, age, files: fp.actual });
    }
  }
  // A claim salvaged from a broken ledger may have no slot (M2): it sorts after every slotted one.
  const slotKey = (c) => (c.slot ? `0${c.slot}` : '1');
  for (const p of view.people) p.claims.sort((x, y) => slotKey(x).localeCompare(slotKey(y)));
  if (flags.json) {
    out(JSON.stringify({ ...view, note: ctx.note, notes: recencyNotes(stats) }, null, 2));
  } else {
    out(R.renderStatus(view));
    for (const n of recencyNotes(stats)) out(n);
    if (ctx.note) out(ctx.note);
  }
  return 0;
}

// ---- ci ---------------------------------------------------------------------------------------

function cmdCi(cwd, flags) {
  if (!flags.branch || !flags.author) throw new Exit(2, `ci needs --branch <b> --author <login>\n\n${R.USAGE}`);
  const mode = flags.mode || 'fail';
  if (mode !== 'warn' && mode !== 'fail') throw new Exit(2, '--mode is warn or fail');
  const ctx = context(cwd, { identity: false, rulesFromCheckout: false });
  const author = personOf(ctx.rules, flags.author);
  const b = flags.branch;
  const ref = remoteRef(b);
  if (!git.refExists(ctx.root, ref)) throw cannotVerify(`cannot verify: origin/${b} does not exist after the fetch`);
  const base = git.mergeBase(ctx.root, MAIN, ref);
  const { footprints } = gather(ctx, { useGh: true, requireGh: true });
  const result = C.ciEvaluate({
    rules: ctx.rules,
    author,
    branch: b,
    headLedgerText: git.showFile(ctx.root, ref, L.LEDGER_PATH),
    baseLedgerText: base ? git.showFile(ctx.root, base, L.LEDGER_PATH) : null,
    baseTasks: (base && git.showFile(ctx.root, base, T.TASKS_PATH)) || '',
    headTasks: git.showFile(ctx.root, ref, T.TASKS_PATH) || '',
    footprints,
    mode,
    now: ctx.now,
  });
  out(R.renderCi(result, { branch: b, author: author.login }));
  if (ctx.note) out(ctx.note);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, R.ciMarkdown(result, { branch: b, author: author.login }), 'utf8');
    } catch { /* the summary is a convenience; the exit code is the gate */ }
  }
  return C.exitCodeOf(result.verdict);
}

// ---- main -------------------------------------------------------------------------------------

const COMMANDS = {
  check: cmdCheck,
  start: cmdStart,
  status: cmdStatus,
  ship: cmdShip,
  rescope: cmdRescope,
  release: cmdRelease,
  ci: cmdCi,
};

function main(argv, cwd) {
  const { cmd, flags } = parseArgs(argv);
  if (!cmd || flags.help || cmd === 'help') {
    process.stdout.write(R.USAGE);
    return 0;
  }
  const fn = COMMANDS[cmd];
  if (!fn) throw new Exit(2, `unknown command "${cmd}"\n\n${R.USAGE}`);
  return fn(cwd, flags);
}

// VALUE_FLAGS and BOOL_FLAGS: the merge-guard trigger reads coord.js's arguments the same way, and
// its tests compare its list with these.
module.exports = { main, parseArgs, Exit, redact, VALUE_FLAGS, BOOL_FLAGS };

if (require.main === module) {
  let code;
  try {
    code = main(process.argv.slice(2), process.cwd());
  } catch (err) {
    if (err instanceof Exit) {
      process.stderr.write(`${redact(err.message)}\n`);
      code = err.exitCode;
    } else {
      process.stderr.write(`cannot verify: ${redact(err && err.stack ? err.stack : err)}\n`);
      code = 2;
    }
  }
  process.exitCode = code;
}
