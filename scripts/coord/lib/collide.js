'use strict';

// The collision engine. PURE: data in, data out; the clock is a parameter, and the expensive reads
// a caller may not need (a branch's diff, whether it is merged) are passed as thunks and called only
// when the decision actually needs them.
//
// It is the one place the rules of WORK_LEDGER.md become decisions, so `check`, `start`, `check
// --merge` and `ci` all call it and cannot drift apart. Every reason names the person, the branch,
// the slot, the files and the class — a collision a human cannot act on is just noise.

const path = require('path');
const { normalizePath, overlapClass, covers } = require('./paths');
const { personBySection, personByLogin, LEDGER_PATH, FREE, ledgerGuard } = require('./ledger');
const { TASKS_PATH, findOpenRow, branchesInStatus, addedIds, idNumber } = require('./tasks');
const { shortTicks } = require('./render');
const { ownerOnlyHits } = require('./ownerGrants');

const DAY = 86400;
const RECENT_DAYS = 14;
const STALE_DAYS = 5;
const RELEASE_DAYS = 10;

// Overlap on these two is ignored entirely: every task edits them, each in its own rows.
const IGNORED_SHARED = Object.freeze([TASKS_PATH, LEDGER_PATH]);

const CLASS_ORDER = ['freeze', 'owner-only', 'malformed', 'exact', 'glob', 'exclusive group', 'resource', 'task', 'shared', 'coupling', 'stale', 'owner unknown', 'merge', 'deploy', 'merge-order', 'needs-main'];

const TASK_ID_RE = /^[A-Z][A-Z0-9]*-\d+$/;

// The production freeze. A merge to main deploys, so while any live claim holds this resource no
// merge to main may happen: not his, and not mine from another branch (another session of mine
// holding it for a recount, a migration or an incident).
const FREEZE_RESOURCE = 'res:prod-deploy';

// The documented residual of the recency rule (printed once when it applies): a branch with no open
// PR, which this clone has never seen move or appear after its first fetch, is judged by its commit
// dates alone.
const RECENCY_NOTE = 'note: a branch this clone first saw in its initial fetch, with commits older than 14 days and no open PR, is not checked';

// Claim paths read from a ledger slot. A folder written with a trailing slash — or a Windows
// backslash, converted first — is a folder claim; a path that cannot be normalised is reported
// (`bad`), never silently dropped.
function claimPaths(list) {
  const paths = [];
  const bad = [];
  for (const raw of list || []) {
    const text = String(raw);
    try {
      const t = text.trim().replace(/\\/g, '/');
      const p = t.endsWith('/') ? `${normalizePath(t.replace(/\/+$/, ''))}/**` : normalizePath(t);
      if (!paths.some((q) => lower(q) === lower(p))) paths.push(p);
    } catch {
      bad.push(text);
    }
  }
  return { paths, bad };
}

const lower = (s) => String(s || '').toLowerCase();
const val = (x) => (typeof x === 'function' ? x() : x);
const uniq = (list) => {
  const seen = new Set();
  return list.filter((x) => (seen.has(lower(x)) ? false : (seen.add(lower(x)), true)));
};
const ticks = (list) => shortTicks(list);
const daysOld = (tipTime, now) => Math.max(0, Math.floor((now - tipTime) / DAY));

// Paths a git diff reports. Only POSIX-normalised, never filtered by the declaration rules: a file
// git says changed is part of the footprint whatever its name (`logo@1,5x.png` has a comma, which a
// declared path may not), or the collision it causes goes unseen.
function actualPaths(list) {
  const out = [];
  for (const raw of list || []) {
    let p = String(raw).replace(/\\/g, '/');
    while (p.startsWith('./')) p = p.slice(2);
    if (p && !out.some((q) => lower(q) === lower(p))) out.push(p);
  }
  return out;
}

function ageText(tipTime, now) {
  if (!Number.isFinite(Number(now)) || now === null || now === undefined) return 'age unknown';
  const days = daysOld(tipTime, now);
  if (days === 0) return 'less than a day old';
  return days === 1 ? '1 day old' : `${days} days old`;
}


// → { patterns, groups }: the paths plus every member of every exclusive row they touch, to a fixed
// point. "Claiming any path in a row claims the whole row", and a row member that also sits in a
// second row (nodeRuntimePin.test.js pins both the workflows and the Dockerfile) claims that row too.
function expandCoupled(patterns, groups) {
  const out = uniq(patterns || []);
  const hit = [];
  let grew = true;
  while (grew) {
    grew = false;
    for (const g of groups || []) {
      if (hit.includes(g.index)) continue;
      if (!g.patterns.some((gp) => out.some((p) => overlapClass(p, gp)))) continue;
      hit.push(g.index);
      grew = true;
      for (const gp of g.patterns) if (!out.some((p) => lower(p) === lower(gp))) out.push(gp);
    }
  }
  return { patterns: out, groups: hit };
}

function directGroups(patterns, groups) {
  return (groups || []).filter((g) => g.patterns.some((gp) => patterns.some((p) => overlapClass(p, gp)))).map((g) => g.index);
}

const NOREPLY_RE = /^(?:\d+\+)?([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)@users\.noreply\.github\.com$/i;

// One `git author` value from the People table: `Name <email>` and a bare `x@y` match by email
// only; anything else matches the author name. So `Daniel <danielmalede@gmail.com>` maps that one
// email and never the first name "Daniel", which both partners share.
function authorKey(value) {
  const v = String(value || '').trim();
  const angle = /<([^<>\s]+@[^<>\s]+)>/.exec(v);
  if (angle) return { email: lower(angle[1]) };
  if (v.includes('@')) return { email: lower(v) };
  return { name: lower(v) };
}

// The person a commit author maps to: the GitHub noreply email names the login; failing that, the
// author's email or name equals one of the person's `git author` values.
function ownerOfAuthor(people, author) {
  const name = lower(author && author.name);
  const email = lower(author && author.email);
  const m = NOREPLY_RE.exec(email);
  if (m) {
    const byLogin = (people || []).find((p) => lower(p.login) === lower(m[1]));
    if (byLogin) return byLogin;
  }
  return (people || []).find((p) => p.gitAuthors.some((a) => {
    const key = authorKey(a);
    return key.email ? Boolean(email) && key.email === email : Boolean(name) && key.name === name;
  })) || null;
}

// GitHub's own committer identity on commits made in its web UI (squash merges, "Update branch").
const WEB_FLOW_EMAIL = 'noreply@github.com';

// The person a tip commit maps to: whoever COMMITTED it first — a cherry-picked or amended commit of
// the other partner carries his author but my committer — then its author. GitHub's web-flow
// committer says nothing about who did the work, so it is skipped.
function ownerOfCommit(people, { committer, author } = {}) {
  const byCommitter = committer && lower(committer.email) !== WEB_FLOW_EMAIL ? ownerOfAuthor(people, committer) : null;
  return byCommitter || ownerOfAuthor(people, author);
}

// The PR author is a GitHub-authenticated login; a commit identity is any string a machine was
// configured with. So the PR decides first.
function ownerOfBranch(rules, b) {
  return personByLogin(rules, val(b.prAuthor)) || ownerOfCommit(rules.people, b);
}

// Every file a branch changed (against its merge-base) already has the same blob on main — a
// squash merge leaves the branch un-merged by ancestry, but it carries nothing main does not have.
// `branchBlobs` / `mainBlobs`: { path: blob sha }; a path missing from one is deleted there.
function mergedByContent(files, branchBlobs, mainBlobs) {
  // No changed files proves nothing (an unreadable diff looks exactly like this): never "merged".
  if (!files || !files.length) return false;
  return files.every((f) => ((branchBlobs || {})[f] || null) === ((mainBlobs || {})[f] || null));
}

function newestPr(prs, branch) {
  return (prs || []).filter((p) => p.headRefName === branch).sort((x, y) => y.number - x.number)[0] || null;
}

// A merged or closed PR says the branch is done only for the commit the PR was about: a branch that
// moved on after its PR closed (new commits on a reused name) is live work again.
const isOpen = (pr) => /^OPEN$/i.test(String(pr.state));
const forHead = (prs, branch) => (prs || []).filter((p) => p.headRefName === branch).sort((x, y) => y.number - x.number);

function prDoneFor(prs, branch, tipSha) {
  if (prOpenFor(prs, branch)) return false;
  const pr = newestPr(prs, branch);
  return Boolean(pr && /^(MERGED|CLOSED)$/i.test(String(pr.state)) && pr.headRefOid && tipSha && pr.headRefOid === tipSha);
}

// ANY open PR for the head — not only the newest PR on that name.
function prOpenFor(prs, branch) {
  return forHead(prs, branch).some(isOpen);
}

// Who opened the PR that is about the work on the tip now: an open PR for the head, or one whose
// head commit IS the tip. A merged or closed PR about an older commit says nothing about who owns a
// reused name, so it is ignored and the commit identity decides.
function prAuthorFor(prs, branch, tipSha) {
  const list = forHead(prs, branch);
  const pr = list.find(isOpen) || (tipSha ? list.find((p) => p.headRefOid && p.headRefOid === tipSha) : null);
  return pr && pr.author && pr.author.login ? pr.author.login : null;
}

// Both PR lists came back, and neither is cut off at its limit. Otherwise a check cannot tell open
// work from finished work and must not decide.
function prListsUsable({ open, all, openLimit, allLimit }) {
  if (!open || !all) return { ok: false, reason: 'gh pr list failed' };
  if (open.length >= openLimit) return { ok: false, reason: `gh listed ${open.length} open PRs, its limit: the list may be truncated` };
  if (all.length >= allLimit) return { ok: false, reason: `gh listed ${all.length} PRs, its limit: the list may be truncated` };
  return { ok: true, reason: null };
}

const bodyText = (slot) => slot.body.join('\n');

// The live claims a branch carries: slots that differ from the merge-base's same slot, name this
// branch, and have not landed. Landed means main holds a byte-identical slot body — the NAME alone
// proves nothing, because a branch name can be reused for new work.
function liveClaimsOn({ branch, headLedger, baseLedger, mainLedger }) {
  if (!headLedger) return [];
  const base = new Map(baseLedger ? baseLedger.slots.map((s) => [s.id, bodyText(s)]) : []);
  const onMain = new Set(mainLedger ? mainLedger.slots.filter((s) => s.claim).map(bodyText) : []);
  return headLedger.slots.filter((s) => s.claim && s.claim.branch === branch && bodyText(s) !== base.get(s.id) && !onMain.has(bodyText(s)));
}

const META_LINE = /^- (task|title|branch|resources|state|started):/;
const backticked = (line) => [...String(line).matchAll(/`([^`]+)`/g)].map((m) => m[1]);

// What a claim that does not parse still says: `- task:` names the task, `- resources:` the
// resources, and the backticked tokens of every other line are its paths.
function claimTokens(lines) {
  const on = (re) => lines.filter((l) => re.test(l)).flatMap(backticked);
  return {
    task: on(/^- task:/)[0] || null,
    resources: on(/^- resources:/).filter((t) => t.startsWith('res:')),
    paths: lines.filter((l) => !META_LINE.test(l)).flatMap(backticked),
  };
}

// A slot this branch changed into something that does not parse. Never read as "no claim": its
// backticked tokens become the claim, so a hand-broken slot still collides.
function malformedClaimsOn({ headLedger, baseLedger }) {
  if (!headLedger) return [];
  const base = new Map(baseLedger ? baseLedger.slots.map((s) => [s.id, bodyText(s)]) : []);
  return headLedger.slots
    .filter((s) => s.malformed && bodyText(s) !== (baseLedger ? base.get(s.id) : FREE))
    .map((s) => ({ slot: s, ...claimTokens(s.body) }));
}

// N8 · A branch's ledger is read with MAIN's People table and section headings, so a branch that
// renames its own People row or a section heading cannot hide its slots. If, read that way, it lost
// a section heading its merge-base had, or a slot that both main and its merge-base have, it is
// malformed. A slot main added after the branch forked is not missing, and a branch that never
// changed its ledger is never judged here.
function structureProblems({ head, base, main }) {
  if (!head || !main) return [];
  if (base && head.lines.join('\n') === base.lines.join('\n')) return [];
  const problems = [];
  const titles = (l) => new Set(l.sectionTitles.map(lower));
  const had = titles(base || main);
  const has = titles(head);
  for (const p of main.people) {
    if (had.has(lower(p.name)) && !has.has(lower(p.name))) problems.push(`the section heading "## ${p.name}" is missing or renamed`);
  }
  const started = base ? new Set(base.rawSlotIds) : null;
  const read = new Set(head.slots.map((s) => s.id));
  const missing = main.slots.map((s) => s.id).filter((id) => (!started || started.has(id)) && !read.has(id));
  if (missing.length) {
    problems.push(missing.length === 1 ? `slot ${missing[0]} is not where main reads it` : `slots ${missing.join(', ')} are not where main reads them`);
  }
  return problems;
}

// The text between one heading and the next, keyed by its heading line.
function headingBlocks(lines) {
  const out = [{ heading: null, body: [] }];
  for (const l of lines) {
    if (/^#{1,6}\s/.test(l)) out.push({ heading: l.trim(), body: [] });
    else out[out.length - 1].body.push(l);
  }
  return out;
}

// The claim a structurally broken ledger still carries: the bullet lines under headings whose text
// differs from the merge-base's, read as a broken slot is read. When some of those blocks name this
// branch on a `- branch:` line, only they are its claim: a branch stacked on another unlanded branch
// also carries that branch's claim (M3). Its slot is the first such `### Xnn` block with a bullet.
function salvageLedger({ head, base, branch }) {
  const before = new Map(base ? headingBlocks(base.lines).map((b) => [b.heading, b.body.join('\n')]) : []);
  const changed = headingBlocks(head.lines).filter((b) => before.get(b.heading) !== b.body.join('\n'));
  const bullets = (b) => b.body.filter((l) => /^\s*- /.test(l)).map((l) => l.trim());
  const naming = changed.filter((b) => bullets(b).some((l) => l === `- branch: \`${branch}\``));
  const blocks = naming.length ? naming : changed;
  const slotBlock = blocks.find((b) => /^###\s+[A-Z]\d{2}$/.test(b.heading || '') && bullets(b).length);
  return { slot: slotBlock ? slotBlock.heading.replace(/^###\s+/, '') : null, ...claimTokens(blocks.flatMap(bullets)) };
}

// → footprints of every other branch on origin: live claims, and unclaimed branches that are recent
// and not merged. `branches[i].changed`, `.merged` and `.firstLedgerTime` may be thunks.
function deriveFootprints({ mainLedger, rules, branches, now, stats }) {
  const { parseLedger } = require('./ledger');
  // Every branch's ledger is read with main's People table (N8), never its own.
  const read = (text) => (text === null || text === undefined ? null : parseLedger(text, { people: rules.people }));
  const out = [];
  for (const b of branches || []) {
    if (b.name === 'main' || b.name === 'HEAD') continue;
    const head = read(b.headLedgerText);
    const base = read(b.baseLedgerText);
    const common = { branch: b.name, tipTime: b.tipTime, author: b.author || null, firstLedgerTime: b.firstLedgerTime };
    const problems = structureProblems({ head, base, main: mainLedger || rules });
    if (problems.length) {
      const s = salvageLedger({ head, base, branch: b.name });
      const cp = claimPaths(s.paths);
      out.push({
        ...common,
        kind: 'claim',
        malformed: true,
        malformedWhy: `its ledger does not parse as main's: ${problems.join('; ')}`,
        slot: s.slot,
        // the branch's owner (its PR, then its commit) decides; the slot letter only when neither tells
        person: ownerOfBranch(rules, b) || (s.slot && personBySection(rules, s.slot[0])) || null,
        task: s.task,
        title: null,
        state: null,
        pr: null,
        declared: cp.paths,
        dropped: cp.bad,
        actual: actualPaths(val(b.changed) || []),
        resources: s.resources,
      });
      continue;
    }
    const claims = liveClaimsOn({ branch: b.name, headLedger: head, baseLedger: base, mainLedger });
    const broken = malformedClaimsOn({ headLedger: head, baseLedger: base });
    for (const m of broken) {
      const cp = claimPaths(m.paths);
      out.push({
        ...common,
        kind: 'claim',
        malformed: true,
        slot: m.slot.id,
        person: personBySection(rules, m.slot.section),
        task: m.task,
        title: null,
        state: null,
        pr: null,
        declared: cp.paths,
        dropped: cp.bad,
        actual: actualPaths(val(b.changed) || []),
        resources: m.resources,
      });
    }
    if (broken.length) continue;
    // A finished exact tip is no longer live even when its branch still carries the claim it used
    // while the PR was open. A malformed claim remains visible so PR metadata cannot hide damage to
    // the coordination ledger.
    if (val(b.prDone) && claims.every((slot) => claimPaths(slot.claim.paths).bad.length === 0)) continue;
    if (claims.length) {
      const actual = actualPaths(val(b.changed) || []);
      for (const slot of claims) {
        const cp = claimPaths(slot.claim.paths);
        out.push({
          ...common,
          kind: 'claim',
          slot: slot.id,
          person: personBySection(rules, slot.section),
          task: slot.claim.task,
          taskKind: slot.claim.taskKind,
          title: slot.claim.title,
          state: slot.claim.state,
          pr: slot.claim.pr,
          malformed: cp.bad.length > 0,
          ...(cp.bad.length ? { malformedWhy: 'a path in its ledger slot does not parse' } : {}),
          declared: cp.paths,
          dropped: cp.bad,
          actual,
          resources: slot.claim.resources.slice(),
        });
      }
      continue;
    }
    // Recent: an OPEN PR keeps a branch whatever its commit dates; otherwise the newer of the tip's
    // commit date and the last time this clone saw the ref move (a revived branch with old dates).
    const seen = Math.max(Number(b.tipTime) || 0, Number(val(b.seenTime)) || 0);
    if (!val(b.prOpen) && !(now - seen <= RECENT_DAYS * DAY)) {
      const evidence = val(b.seenTime);
      if (stats && (evidence === null || evidence === undefined)) (stats.ageOnly = stats.ageOnly || []).push(b.name);
      continue;
    }
    // Done work, not work in flight: its newest PR is merged or closed for this very tip (when gh
    // answers), it is merged by ancestry, or everything it changed is already on main (a squash).
    if (val(b.prDone)) continue;
    if (val(b.merged)) continue;
    if (val(b.contentMerged)) continue;
    out.push({
      ...common,
      kind: 'unclaimed',
      slot: null,
      person: ownerOfBranch(rules, b),
      task: null,
      title: null,
      state: null,
      pr: null,
      declared: [],
      actual: actualPaths(val(b.changed) || []),
      resources: [],
    });
  }
  return out;
}

// The footprints that are mine on the branch I stand on: MY claim there, or an unmapped branch of
// that name. His footprint survives even when I have checked out his branch name locally.
function dropSelf(footprints, branch, me) {
  return (footprints || []).filter((f) => !(branch && f.branch === branch && f.person && f.person.section === me.section));
}

function sharedSets(rules) {
  const shared = (rules && rules.shared) || [];
  const all = new Set(shared.concat(IGNORED_SHARED).map(lower));
  const warn = shared.filter((s) => !IGNORED_SHARED.some((i) => lower(i) === lower(s)));
  return { all, warn };
}

// Every class two footprints meet on. One entry per class; HALT-level except `shared` (WARN).
function overlaps(a, b, rules) {
  const { all, warn } = sharedSets(rules);
  const touchA = uniq([...(a.declared || []), ...(a.actual || [])]);
  const touchB = uniq([...(b.declared || []), ...(b.actual || [])]);
  const rawA = touchA.filter((p) => !all.has(lower(p)));
  const rawB = touchB.filter((p) => !all.has(lower(p)));
  const out = [];

  const exact = [];
  const glob = [];
  for (const p of rawA) {
    for (const q of rawB) {
      const cls = overlapClass(p, q);
      if (cls === 'exact') exact.push(p);
      if (cls === 'glob') glob.push([p, q]);
    }
  }
  if (exact.length) out.push({ level: 'HALT', class: 'exact', files: uniq(exact) });
  if (glob.length) out.push({ level: 'HALT', class: 'glob', files: uniq(glob.flat()), pairs: glob });

  const groups = (rules && rules.exclusive) || [];
  const closureA = expandCoupled(rawA, groups).groups;
  const closureB = new Set(expandCoupled(rawB, groups).groups);
  const directB = new Set(directGroups(rawB, groups));
  const direct = directGroups(rawA, groups).filter((g) => directB.has(g));
  const shared = direct.length ? direct : closureA.filter((g) => closureB.has(g));
  if (shared.length) {
    const members = groups.filter((g) => shared.includes(g.index));
    const touching = (list) => list.filter((p) => members.some((g) => g.patterns.some((gp) => overlapClass(p, gp)))
      || expandCoupled([p], groups).groups.some((gi) => shared.includes(gi)));
    out.push({
      level: 'HALT',
      class: 'exclusive group',
      groups: members.map((g) => g.label),
      groupPatterns: members.flatMap((g) => g.patterns),
      viaSharedMember: direct.length === 0,
      mine: touching(rawA),
      theirs: touching(rawB),
      files: uniq([...touching(rawA), ...touching(rawB)]),
    });
  }

  const resB = new Set((b.resources || []).map(lower));
  const resources = (a.resources || []).filter((r) => resB.has(lower(r)));
  if (resources.length) out.push({ level: 'HALT', class: 'resource', files: [], resources });

  // Only a TASKS row can be "the same task"; two own:<slug> names say nothing about the same work.
  if (a.task && b.task && a.task === b.task && TASK_ID_RE.test(a.task)) out.push({ level: 'HALT', class: 'task', files: [], task: a.task });

  for (const s of warn) {
    if (touchA.some((p) => lower(p) === lower(s)) && touchB.some((p) => lower(p) === lower(s))) {
      out.push({ level: 'WARN', class: 'shared', files: [s] });
    }
  }
  return out;
}

function who(fp) {
  if (fp.person) return `${fp.person.name} (@${fp.person.login})`;
  const a = fp.author ? ` — author ${fp.author.name} <${fp.author.email}>` : '';
  return `owner unknown${a}`;
}

function where(fp, now) {
  if (fp.kind === 'claim') {
    return `live claim${fp.slot ? ` ${fp.slot}` : ''} on branch ${fp.branch}${fp.malformed ? ` (${fp.malformedWhy || 'its ledger slot does not parse'})` : ''}`;
  }
  return `unclaimed recent branch ${fp.branch} (${ageText(fp.tipTime, now)})`;
}

function describe(o, fp, now) {
  const head = `${who(fp)}: ${where(fp, now)}`;
  switch (o.class) {
    case 'exact': return `${head} touches ${ticks(o.files)}`;
    case 'glob': return `${head}: ${o.pairs.map(([p, q]) => `\`${p}\` meets \`${q}\``).join('; ')}`;
    case 'exclusive group': return `${head} holds exclusive group ${ticks(o.groups)}${o.viaSharedMember ? ' (coupled through a shared member)' : ''} — you: ${ticks(o.mine)}; his side: ${ticks(o.theirs)}`;
    case 'resource': return `${head} claims the same resource ${ticks(o.resources)}`;
    case 'task': return `${head} claims the same task ${o.task}`;
    case 'shared': return `${head} also edits the shared file ${ticks(o.files)} — edit only your own rows or section`;
    default: return head;
  }
}

function sortReasons(reasons) {
  return reasons
    .map((r, i) => ({ r, i }))
    .sort((x, y) => (CLASS_ORDER.indexOf(x.r.class) - CLASS_ORDER.indexOf(y.r.class)) || (x.i - y.i))
    .map((x) => x.r);
}

function verdictOf(reasons) {
  if (reasons.some((r) => r.level === 'HALT' || r.level === 'FAIL')) return reasons.some((r) => r.level === 'FAIL') ? 'FAIL' : 'HALT';
  if (reasons.some((r) => r.level === 'WARN')) return 'WARN';
  return 'CLEAR';
}

function exitCodeOf(verdict) {
  if (verdict === 'CLEAR') return 0;
  if (verdict === 'WARN') return 3;
  if (verdict === 'HALT' || verdict === 'FAIL') return 1;
  return 2;
}

const reason = (level, cls, fp, files, message) => ({
  level,
  class: cls,
  person: fp && fp.person ? fp.person.name : null,
  login: fp && fp.person ? fp.person.login : null,
  branch: fp ? fp.branch : null,
  slot: fp ? fp.slot : null,
  files,
  message,
});

// check: my declared work against every footprint on origin.
function assess({ rules, me, mine, footprints, mainTasks, testMentions, now }) {
  const reasons = [];
  const declared = mine.declared || [];
  // N10 · A branch a TASKS status line names holds the row only while it carries live work: a branch
  // whose work landed but which was never deleted has no footprint. (These footprints come after
  // dropSelf, which removes only my own on the branch I stand on — a branch the rule below skips
  // anyway — so this is the same set as before self-exclusion.)
  const live = new Set((footprints || []).map((f) => f.branch));

  if (!me.isOwner) {
    const hits = ownerOnlyHits({ rules, person: me, claim: mine, paths: declared, mainTasks });
    if (hits.length) reasons.push(reason('HALT', 'owner-only', null, hits, `${ticks(hits)} ${hits.length > 1 ? 'are' : 'is'} owner-only: only the owner changes ${ticks(rules.ownerOnly)}`));
  }

  if (mine.task && mine.taskKind === 'TASKS') {
    if (!me.isOwner && /^DAN-/.test(mine.task)) {
      reasons.push(reason('HALT', 'task', null, [], `${mine.task}: DAN- rows are the owner's alone`));
    }
    const row = findOpenRow(mainTasks || '', mine.task);
    if (!row) {
      reasons.push(reason('HALT', 'task', null, [], `${mine.task} is not an open "- [ ]" row in TASKS.md on origin/main`));
    } else {
      for (const br of branchesInStatus(row)) {
        if (br === 'main' || !live.has(br)) continue;
        // The branch I stand on is mine — unless his work lives under that name.
        const his = (footprints || []).some((f) => f.branch === br && f.person && f.person.section !== me.section);
        if (br === mine.branch && !his) continue;
        reasons.push(reason('HALT', 'task', { branch: br, slot: null }, [], `${mine.task}: its status line in TASKS.md names the live branch ${br}`));
      }
    }
  }

  const mineFp = { declared, actual: [], resources: mine.resources || [], task: mine.task || null };
  const unknownHits = [];
  for (const fp of footprints || []) {
    if (fp.person && fp.person.section === me.section) continue;
    if (fp.malformed) {
      const ask = fp.person ? 'ask him' : 'ask its owner';
      if (!(fp.declared || []).length) {
        // On the branch I stand on an unmapped one is most likely mine: a WARN there.
        const level = !fp.person && fp.branch === mine.branch ? 'WARN' : 'HALT';
        reasons.push(reason(level, 'malformed', fp, [], `${who(fp)}: ${where(fp, now)} names no path, so nothing can be checked against it — ${ask} to fix or release it`));
      } else {
        // A6 · partly broken: what it names still collides below, and what it dropped is said here.
        const dropped = fp.dropped || [];
        const lost = dropped.length
          ? `${ticks(dropped)} cannot be read as ${dropped.length === 1 ? 'a path and is' : 'paths and are'} not checked`
          : 'only its backticked paths are read as the claim';
        reasons.push({ ...reason('WARN', 'malformed', fp, [], `${who(fp)}: ${where(fp, now)} — ${lost}; ${ask} to fix it`), dropped });
      }
    }
    if (!fp.person) {
      // A branch whose author maps to nobody might be the partner's: fail closed (HALT on a
      // HALT-class overlap), folded into ONE line so it cannot drown the named collisions.
      const meets = overlaps(mineFp, fp, rules);
      if (meets.length) {
        // On the branch I stand on it is most likely mine: a WARN there, a HALT anywhere else.
        const level = meets.some((o) => o.level === 'HALT') && fp.branch !== mine.branch ? 'HALT' : 'WARN';
        unknownHits.push({ fp, level, files: uniq(meets.flatMap((o) => o.files)) });
      }
      continue;
    }
    const meets = overlaps(mineFp, fp, rules);
    for (const o of meets) {
      reasons.push(reason(o.level, o.class, fp, o.files, describe(o, fp, now)));
    }
    // A test of his that names my file. Tests a HALT on this branch already covers (its files, or
    // the members of an exclusive row it holds) say nothing new, and the rest is one line.
    const theirs = expandCoupled([...(fp.declared || []), ...(fp.actual || [])], rules.exclusive).patterns;
    const halted = meets.filter((o) => o.level === 'HALT').flatMap((o) => (o.files || []).concat(o.groupPatterns || []));
    const coupledFiles = [];
    const coupledTests = [];
    for (const [file, tests] of Object.entries(testMentions || {})) {
      for (const t of tests || []) {
        if (!covers(theirs, t) || covers(halted, t)) continue;
        if (!coupledFiles.includes(file)) coupledFiles.push(file);
        if (!coupledTests.includes(t)) coupledTests.push(t);
      }
    }
    if (coupledTests.length) {
      reasons.push(reason('WARN', 'coupling', fp, coupledFiles.concat(coupledTests), `${who(fp)}: ${where(fp, now)} touches ${ticks(coupledTests)}, which name${coupledTests.length === 1 ? 's' : ''} your ${shortTicks(coupledFiles.map((f) => path.posix.basename(f)))} — your change may break his test, or his yours`));
    }
    if (fp.kind === 'claim' && now - fp.tipTime > STALE_DAYS * DAY) {
      const days = daysOld(fp.tipTime, now);
      const ask = now - fp.tipTime >= RELEASE_DAYS * DAY ? ' — ask him to release it' : '';
      reasons.push(reason('WARN', 'stale', fp, [], `${who(fp)}: ${where(fp, now)} has had no commit for ${days} days${ask}`));
    }
  }

  for (const level of ['HALT', 'WARN']) {
    const hits = unknownHits.filter((h) => h.level === level);
    if (!hits.length) continue;
    const branches = hits.map((h) => h.fp.branch);
    const files = uniq(hits.flatMap((h) => h.files));
    reasons.push({
      ...reason(level, 'owner unknown', null, files, `${branches.length} unclaimed recent branch(es) whose author maps to nobody meet your paths: ${shortTicks(branches)} on ${ticks(files)} — add that author to the git author column of People in ${LEDGER_PATH}, or ask your partner whose work it is`),
      branches,
    });
  }

  const sorted = sortReasons(reasons);
  return { verdict: verdictOf(sorted), reasons: sorted };
}

// The live claims holding the production freeze, except those on `exceptBranch` (a PR's own head:
// the work that holds the freeze ends it by landing). Whoever owns them, mapped or not.
function freezeHolders(footprints, exceptBranch = null) {
  return (footprints || []).filter((f) => f.kind === 'claim' && f.branch !== exceptBranch
    && (f.resources || []).some((r) => lower(r) === FREEZE_RESOURCE));
}

// check --merge N
function mergeAdvice({ rules, me, pr, runs, footprints, mainTasks, now }) {
  const reasons = [];
  // Unlike every other collision, my own section is no exception here: a freeze is about
  // production, not about whose files meet.
  for (const fp of freezeHolders(footprints, pr.headRefName)) {
    reasons.push(reason('HALT', 'freeze', fp, [], `${who(fp)}: ${where(fp, now)}${fp.task ? ` for ${fp.task}` : ''} holds \`${FREEZE_RESOURCE}\` — production is frozen, and a merge to main deploys: PR #${pr.number} waits until that claim lands or its branch is deleted`));
  }
  if (lower(pr.author && pr.author.login) !== lower(me.login)) {
    reasons.push(reason('HALT', 'merge', null, [], `PR #${pr.number} is @${pr.author && pr.author.login}'s: merge only your own PRs`));
  }
  if ((runs || []).some((r) => r.status !== 'completed')) {
    reasons.push(reason('HALT', 'deploy', null, [], 'a push run on main has not completed: a deploy is in flight — wait'));
  }
  const files = actualPaths((pr.files || []).map((f) => f.path));
  const prFp = { declared: files, actual: [], resources: [], task: null };
  const headClaims = (footprints || []).filter((f) => f.branch === pr.headRefName && f.kind === 'claim');
  const mine = headClaims.find((f) => f.person && f.person.section === me.section);
  const grantClaim = headClaims.length === 1 && mine && !mine.malformed ? mine : null;
  const ownerHits = ownerOnlyHits({ rules, person: me, claim: grantClaim,
    paths: uniq(files.concat(headClaims.flatMap((f) => f.declared || []))), mainTasks });
  if (ownerHits.length) reasons.push(reason('HALT', 'owner-only', null, ownerHits,
    `${ticks(ownerHits)}: no exact owner grant for this task and path — the PR cannot merge`));
  const myFirst = mine ? val(mine.firstLedgerTime) : null;
  for (const fp of footprints || []) {
    if (fp.branch === pr.headRefName) {
      // A PR I opened whose head is HIS branch would merge his work: the author check alone passes it.
      if (fp.person && fp.person.section !== me.section) {
        reasons.push(reason('HALT', 'merge', fp, [], `${who(fp)}: PR #${pr.number}'s head ${pr.headRefName} carries ${fp.person.name}'s work (${where(fp, now)}) — merge only your own branches`));
      }
      continue;
    }
    if (fp.person && fp.person.section === me.section) continue;
    const meets = overlaps(prFp, fp, rules).filter((o) => o.level === 'HALT');
    if (!meets.length) continue;
    const hit = uniq(meets.flatMap((o) => o.files));
    // His live claim DECLARED these paths before mine (or at the same second): merging now puts my
    // change on top of the work he claimed first. That is his call as much as mine.
    if (fp.kind === 'claim' && fp.person) {
      const declaredMeets = overlaps(prFp, { declared: fp.declared, actual: [], resources: fp.resources, task: fp.task }, rules).filter((o) => o.level === 'HALT');
      const outcome = declaredMeets.length ? firstClaimWins(myFirst, val(fp.firstLedgerTime)) : 'mine';
      if (outcome !== 'mine') {
        const claimed = uniq(declaredMeets.flatMap((o) => o.files));
        reasons.push(reason('HALT', 'merge-order', fp, claimed, `${who(fp)}: ${where(fp, now)} ${outcome === 'tie' ? 'was claimed within ten minutes of yours (too close for two local clocks to order)' : 'was claimed first'} and holds ${ticks(claimed)}, which PR #${pr.number} changes — agree with him before merging (claimed first)`));
        continue;
      }
    }
    reasons.push(reason('WARN', 'needs-main', fp, hit, `${who(fp)}: ${where(fp, now)} meets PR #${pr.number} on ${ticks(hit)} — he will need main merged in after this lands`));
  }
  const sorted = sortReasons(reasons);
  return { verdict: verdictOf(sorted), reasons: sorted };
}

// Committer dates come from each partner's own clock. Two claims first committed this close
// together (seconds) cannot be ordered by them, so neither is "first".
const TIE_WINDOW = 10 * 60;

// The earlier first ledger commit wins. A tie is nobody's win: both sides stop and decide.
function firstClaimWins(mine, theirs) {
  const m = typeof mine === 'number' && Number.isFinite(mine) ? mine : null;
  const t = typeof theirs === 'number' && Number.isFinite(theirs) ? theirs : null;
  // An unknown time on either side decides nothing: both stop.
  if (m === null || t === null) return 'tie';
  if (Math.abs(m - t) <= TIE_WINDOW) return 'tie';
  return m < t ? 'mine' : 'theirs';
}

// ci --branch b --author login: the server-side gate on a pushed task branch.
function ciEvaluate({ rules, author, branch, headLedgerText, baseLedgerText, baseTasks, headTasks, mainTasks, footprints, mode, now }) {
  const reasons = [];
  const fail = (cls, files, message) => reasons.push({ level: 'FAIL', class: cls, files, message, branch });

  const own = (footprints || []).filter((f) => f.branch === branch);
  const claims = own.filter((f) => f.kind === 'claim' && f.person && f.person.section === author.section);
  if (!claims.length) fail('unclaimed', [], `unclaimed branch: ${branch} has no live claim in ${author.name}'s section of ${LEDGER_PATH}`);

  if (headLedgerText !== null && headLedgerText !== undefined) {
    for (const v of ledgerGuard({ baseText: baseLedgerText, headText: headLedgerText, branch, login: author.login })) {
      fail('ledger', [], `${LEDGER_PATH} ${v.kind}: ${v.message}`);
    }
  }

  for (const id of addedIds(baseTasks || '', headTasks || '')) {
    const n = idNumber(id);
    if (!author.isOwner) {
      const block = author.idBlock;
      if (!block || n === null || n < block.min || n > block.max) fail('tasks-id', [id], `${id}: ${author.name} adds TASKS ids only from his block ${block ? `${block.min}–${block.max}` : '(none declared)'}`);
    } else {
      const partner = (rules.people || []).find((p) => !p.isOwner && p.idBlock && n !== null && n >= p.idBlock.min && n <= p.idBlock.max);
      if (partner) fail('tasks-id', [id], `${id} is in ${partner.name}'s block ${partner.idBlock.min}–${partner.idBlock.max}; take the next id from the "Next free IDs" header`);
    }
  }

  const declared = uniq(claims.flatMap((c) => c.declared));
  const actual = uniq(own.flatMap((f) => f.actual || []));
  if (claims.length) {
    const cover = expandCoupled(declared, rules.exclusive).patterns.concat(rules.shared || [], IGNORED_SHARED);
    const drift = actual.filter((f) => !covers(cover, f));
    if (drift.length) fail('drift', drift, `changed but not claimed: ${ticks(drift)} — run rescope, or move the change to its own task`);
  }

  if (!author.isOwner) {
    const branchClaims = own.filter((f) => f.kind === 'claim');
    const grantClaim = branchClaims.length === 1 && claims.length === 1 && !claims[0].malformed ? claims[0] : null;
    const hits = ownerOnlyHits({ rules, person: author, claim: grantClaim,
      paths: uniq(declared.concat(actual)), mainTasks });
    if (hits.length) fail('owner-only', hits, `${ticks(hits)}: owner-only paths change only on the owner's branches`);
  }

  const mine = {
    declared,
    actual,
    resources: uniq(claims.flatMap((c) => c.resources || [])),
    task: claims.length ? claims[0].task : null,
  };
  const myFirst = claims.length ? val(claims[0].firstLedgerTime) : null;
  for (const fp of footprints || []) {
    if (fp.branch === branch) continue;
    if (fp.person && fp.person.section === author.section) continue;
    const meets = overlaps(mine, fp, rules).filter((o) => o.level === 'HALT');
    if (!meets.length) continue;
    const kinds = meets.map((o) => o.class).join(', ');
    const files = uniq(meets.flatMap((o) => o.files));
    if (fp.kind !== 'claim' || !fp.person) {
      reasons.push({ level: 'WARN', class: 'overlap', files, branch, message: `${who(fp)}: ${where(fp, now)} overlaps (${kinds}) on ${ticks(files)}` });
      continue;
    }
    const outcome = firstClaimWins(myFirst, val(fp.firstLedgerTime));
    if (outcome === 'mine') continue;
    const why = outcome === 'tie' ? 'both claims were first committed within ten minutes of each other, closer than two local clocks can order' : 'his claim was committed first';
    fail('overlap', files, `${who(fp)}: ${where(fp, now)} overlaps (${kinds}) on ${ticks(files)}, and ${why}`);
  }

  const out = mode === 'warn' ? reasons.map((r) => (r.level === 'FAIL' ? { ...r, level: 'WARN' } : r)) : reasons;
  return { verdict: verdictOf(out), reasons: out };
}

module.exports = {
  DAY,
  RECENT_DAYS,
  STALE_DAYS,
  RELEASE_DAYS,
  IGNORED_SHARED,
  expandCoupled,
  ownerOfAuthor,
  ownerOfCommit,
  liveClaimsOn,
  structureProblems,
  deriveFootprints,
  overlaps,
  assess,
  mergeAdvice,
  freezeHolders,
  FREEZE_RESOURCE,
  ciEvaluate,
  firstClaimWins,
  mergedByContent,
  authorKey,
  actualPaths,
  ageText,
  newestPr,
  prDoneFor,
  prOpenFor,
  prAuthorFor,
  prListsUsable,
  claimPaths,
  dropSelf,
  RECENCY_NOTE,
  TIE_WINDOW,
  TASK_ID_RE,
  verdictOf,
  exitCodeOf,
  daysOld,
};
