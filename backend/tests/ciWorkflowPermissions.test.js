'use strict';

// Structural guard for `.github/workflows/*.yml` GITHUB_TOKEN scopes (W4-D37).
//
// WHY THIS EXISTS. On 2026-08-20 at 15:13 UTC three CI jobs went red on
// `Resource not accessible by integration` (HTTP 403) without a single line of this repo
// changing — the red run's tree is byte-identical to the last green one outside `backend/`
// and `docs/`. The failing calls were `GET /repos/:owner/:repo/pulls/:number/commits`
// (gitleaks-action) and `listFiles(pull_number)` (dorny/paths-filter). Neither workflow
// declared a `permissions:` block, so both inherited whatever the REPOSITORY's
// Settings → Actions → General → "Workflow permissions" default happened to be that day.
// A repo-settings toggle nobody can see in a diff silently disarmed the secret scan.
//
// The durable fix is to state the scopes in the workflow file, where they are reviewable and
// version-controlled. This guard keeps them stated:
//
//   1. every workflow declares an explicit top-level `permissions:` block;
//   2. every job that calls the pull-request REST API declares `pull-requests` access —
//      DERIVED from the actions the job actually runs, so a new paths-filter job tomorrow
//      is covered without editing this file;
//   3. any job that overrides `permissions` still names `contents`, because YAML's
//      `permissions:` is REPLACE-not-merge: naming any scope sets every unnamed scope to
//      `none`, which would break `actions/checkout` in that job;
//   4. no workflow hands out blanket write at the top level.
//
// The final test is an anti-false-green pin: a guard that silently parses nothing passes
// vacuously, so the parser must keep finding the real jobs by name.

const fs = require('fs');
const path = require('path');

const WORKFLOW_DIR = path.join(__dirname, '..', '..', '.github', 'workflows');

// Actions that reach for PR-scoped REST data. `need` is the minimum scope level:
//   read  — enumerating PR metadata
//   write — mutating the PR (a review comment)
// Verified against each action's source, not inferred from its README.
const PR_API_ACTIONS = [
  {
    match: /^gitleaks\/gitleaks-action(@|$)/,
    need: 'write',
    why: 'enumerates the PR commit range via pulls/:number/commits, and posts a review comment '
      + 'on a finding (src/gitleaks.js → octokit.rest.pulls.createReviewComment). With read '
      + 'only, a REAL LEAK surfaces as an opaque 403 instead of as the leak.',
  },
  {
    match: /^dorny\/paths-filter(@|$)/,
    need: 'read',
    why: 'resolves the changed-file set through listFiles(pull_number) on pull_request events',
  },
];

const SCOPE_RANK = { none: 0, read: 1, write: 2 };

const indentOf = (line) => line.match(/^ */)[0].length;
const isSkippable = (line) => /^\s*(#.*)?$/.test(line);

// Indices of every line BELOW `headerIdx` that is indented deeper than it — i.e. the whole
// nested block, descendants included. `headerIdx: -1` means the document root.
function blockIndices(lines, headerIdx) {
  const headerIndent = headerIdx < 0 ? -1 : indentOf(lines[headerIdx]);
  const out = [];
  for (let i = headerIdx + 1; i < lines.length; i += 1) {
    if (isSkippable(lines[i])) continue;
    if (indentOf(lines[i]) <= headerIndent) break;
    out.push(i);
  }
  return out;
}

// Only the DIRECT children of a block (the shallowest indent inside it). Keeps block scalars
// like paths-filter's `filters: |` payload from being read as mapping keys.
function directChildIndices(lines, headerIdx) {
  const inner = blockIndices(lines, headerIdx);
  if (inner.length === 0) return [];
  const childIndent = indentOf(lines[inner[0]]);
  return inner.filter((i) => indentOf(lines[i]) === childIndent);
}

function findDirectKey(lines, headerIdx, key) {
  const re = new RegExp(`^\\s*${key}:\\s*(.*)$`);
  return directChildIndices(lines, headerIdx).find((i) => re.test(lines[i]));
}

// → null when absent, { mode } for the inline shorthand (`permissions: read-all`),
// otherwise a { scope: level } map.
function readPermissions(lines, headerIdx) {
  const at = findDirectKey(lines, headerIdx, 'permissions');
  if (at === undefined) return null;
  const inline = lines[at].replace(/^\s*permissions:\s*/, '').replace(/\s*#.*$/, '').trim();
  if (inline) return { mode: inline };
  const scopes = {};
  for (const i of directChildIndices(lines, at)) {
    const m = lines[i].match(/^\s*([a-z-]+):\s*([a-z-]+)\s*(#.*)?$/);
    if (m) scopes[m[1]] = m[2];
  }
  return scopes;
}

function grantedLevel(perms, scope) {
  if (!perms) return 'none';
  if (perms.mode) return perms.mode === 'write-all' ? 'write' : (perms.mode === 'read-all' ? 'read' : 'none');
  return perms[scope] || 'none';
}

function parseWorkflow(file) {
  const lines = fs.readFileSync(path.join(WORKFLOW_DIR, file), 'utf8').split(/\r?\n/);

  const onIdx = findDirectKey(lines, -1, 'on');
  const onInline = onIdx === undefined ? '' : lines[onIdx].replace(/^\s*on:\s*/, '').trim();
  const triggers = onInline
    ? onInline.replace(/[[\]]/g, '').split(',').map((t) => t.trim()).filter(Boolean)
    : directChildIndices(lines, onIdx).map((i) => (lines[i].match(/^\s*([a-z_]+):/) || [])[1]).filter(Boolean);

  const jobsIdx = findDirectKey(lines, -1, 'jobs');
  const jobs = directChildIndices(lines, jobsIdx)
    .filter((i) => /^\s*[\w-]+:\s*(#.*)?$/.test(lines[i]))
    .map((i) => ({
      id: lines[i].trim().replace(/:.*$/, ''),
      permissions: readPermissions(lines, i),
      checksOut: blockIndices(lines, i).some((j) => /uses:\s*actions\/checkout(@|\s|$)/.test(lines[j])),
      uses: blockIndices(lines, i)
        .map((j) => (lines[j].match(/uses:\s*(\S+)/) || [])[1])
        .filter(Boolean),
    }));

  return { file, triggers, permissions: readPermissions(lines, -1), jobs };
}

const WORKFLOWS = fs.readdirSync(WORKFLOW_DIR)
  .filter((f) => /\.ya?ml$/.test(f))
  .map(parseWorkflow);

describe('CI workflow GITHUB_TOKEN permissions (W4-D37)', () => {
  it('finds the real workflows and jobs — the guard is not passing vacuously', () => {
    expect(WORKFLOWS.map((w) => w.file).sort()).toEqual(['ci.yml', 'secret-scan-history.yml']);

    const ci = WORKFLOWS.find((w) => w.file === 'ci.yml');
    expect(ci.triggers.sort()).toEqual(['pull_request', 'push']);
    expect(ci.jobs.map((j) => j.id).sort()).toEqual([
      'backend', 'deploy-frontend', 'frontend', 'ios-changes', 'mobile',
      'mobile-android-compile', 'mobile-ios-build', 'secret-scan',
    ]);
    // Every job checks out, so every job needs `contents` named in any override it declares.
    expect(ci.jobs.filter((j) => j.checksOut).map((j) => j.id).sort()).toEqual([
      'backend', 'deploy-frontend', 'frontend', 'ios-changes', 'mobile',
      'mobile-android-compile', 'mobile-ios-build', 'secret-scan',
    ]);

    // Every job that touches the PR API is caught by the PR-API rule. secret-scan and
    // mobile-android-compile are the two that went red in the 403 incident.
    // `mobile-ios-build` USED to be in this list, when it ran dorny/paths-filter itself. That
    // filter now lives in the cheap `ios-changes` job so the 10x macOS runner is gated by
    // `needs`+`if` and never allocated on a non-iOS PR — so the PR-API scope moved with it.
    // The macOS job no longer touches the PR API at all, which is why it drops out here.
    const prApiJobs = ci.jobs
      .filter((j) => j.uses.some((u) => PR_API_ACTIONS.some((a) => a.match.test(u))))
      .map((j) => j.id)
      .sort();
    expect(prApiJobs).toEqual(['ios-changes', 'mobile-android-compile', 'secret-scan']);
  });

  it.each(WORKFLOWS.map((w) => [w.file]))(
    '%s declares an explicit top-level permissions block',
    (file) => {
      const wf = WORKFLOWS.find((w) => w.file === file);
      // Without this, the effective scopes come from a repository SETTING that never appears
      // in a diff — the exact failure mode of the 2026-08-20 incident.
      expect(wf.permissions).not.toBeNull();
      expect(grantedLevel(wf.permissions, 'contents')).toBe('read');
    },
  );

  it('grants pull-requests to every job that calls the PR REST API', () => {
    const failures = [];
    for (const wf of WORKFLOWS) {
      // `schedule`/`workflow_dispatch`-only workflows have no PR context, so the same action
      // never makes the call there — do not over-grant on their behalf.
      if (!wf.triggers.includes('pull_request')) continue;
      for (const job of wf.jobs) {
        for (const action of PR_API_ACTIONS) {
          const used = job.uses.find((u) => action.match.test(u));
          if (!used) continue;
          const effective = job.permissions
            ? grantedLevel(job.permissions, 'pull-requests')
            : grantedLevel(wf.permissions, 'pull-requests');
          if (SCOPE_RANK[effective] < SCOPE_RANK[action.need]) {
            failures.push(
              `${wf.file} job "${job.id}" runs ${used} with pull-requests=${effective}, `
              + `needs ${action.need} — ${action.why}`,
            );
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('keeps contents named in every job-level permissions override that checks out', () => {
    const failures = [];
    for (const wf of WORKFLOWS) {
      for (const job of wf.jobs) {
        if (!job.permissions || job.permissions.mode || !job.checksOut) continue;
        // A job-level block REPLACES the workflow default outright; an override that forgets
        // `contents` leaves actions/checkout with `none` and fails on a private repo.
        if (SCOPE_RANK[grantedLevel(job.permissions, 'contents')] < SCOPE_RANK.read) {
          failures.push(`${wf.file} job "${job.id}" overrides permissions without naming contents`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('never hands out blanket write at the workflow level', () => {
    for (const wf of WORKFLOWS) {
      expect(wf.permissions && wf.permissions.mode).not.toBe('write-all');
      expect(grantedLevel(wf.permissions, 'contents')).not.toBe('write');
    }
  });
});
