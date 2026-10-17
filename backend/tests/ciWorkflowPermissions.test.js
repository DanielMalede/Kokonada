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
//
// The coordination check (coordination.yml, OPS-153) has its own pins at the end of this file.
// The runner image of every job (OPS-191) is pinned between the two, through the same parser.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

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

// What a job's `runs-on` holds (OPS-191): { label } when it is one literal runner label, quoted or
// not, with or without a comment after it; otherwise { unreadable }, saying what is there instead.
function readRunsOn(lines, headerIdx) {
  const at = findDirectKey(lines, headerIdx, 'runs-on');
  if (at === undefined) return { unreadable: 'has no runs-on' };
  const raw = lines[at].replace(/^\s*runs-on:\s*/, '').replace(/\s+#.*$/, '').trim();
  const label = raw.replace(/^(['"])(.*)\1$/, '$2');
  if (/^[A-Za-z0-9][\w.-]*$/.test(label)) return { label };
  return {
    unreadable: raw
      ? `has runs-on: ${raw}, not one literal label`
      : 'has runs-on with no value on its line (a list, a group, or nothing), not one literal label',
  };
}

// A job's key directly under `jobs:`: the one shape this parser reads as a job.
const JOB_KEY = /^\s*[\w-]+:\s*(#.*)?$/;

function parseWorkflow(file, text) {
  const lines = text.split(/\r?\n/);

  const onIdx = findDirectKey(lines, -1, 'on');
  const onInline = onIdx === undefined ? '' : lines[onIdx].replace(/^\s*on:\s*/, '').trim();
  const triggers = onInline
    ? onInline.replace(/[[\]]/g, '').split(',').map((t) => t.trim()).filter(Boolean)
    : directChildIndices(lines, onIdx).map((i) => (lines[i].match(/^\s*([a-z_]+):/) || [])[1]).filter(Boolean);

  const jobsIdx = findDirectKey(lines, -1, 'jobs');
  const jobKeys = directChildIndices(lines, jobsIdx);
  const jobs = jobKeys
    .filter((i) => JOB_KEY.test(lines[i]))
    .map((i) => ({
      id: lines[i].trim().replace(/:.*$/, ''),
      permissions: readPermissions(lines, i),
      runsOn: readRunsOn(lines, i),
      checksOut: blockIndices(lines, i).some((j) => /uses:\s*actions\/checkout(@|\s|$)/.test(lines[j])),
      uses: blockIndices(lines, i)
        .map((j) => (lines[j].match(/uses:\s*(\S+)/) || [])[1])
        .filter(Boolean),
    }));
  // A line under `jobs:` that is not such a key (a quoted id, a job written inline) is a job no pin
  // in this file can see; the runner-image guard reports it rather than skipping it.
  const unreadJobs = jobKeys.filter((i) => !JOB_KEY.test(lines[i])).map((i) => lines[i].trim());

  return { file, triggers, permissions: readPermissions(lines, -1), jobs, unreadJobs };
}

const WORKFLOWS = fs.readdirSync(WORKFLOW_DIR)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => parseWorkflow(f, fs.readFileSync(path.join(WORKFLOW_DIR, f), 'utf8')));

describe('CI workflow GITHUB_TOKEN permissions (W4-D37)', () => {
  it('finds the real workflows and jobs — the guard is not passing vacuously', () => {
    expect(WORKFLOWS.map((w) => w.file).sort()).toEqual(['ci.yml', 'coordination.yml', 'secret-scan-history.yml']);

    const ci = WORKFLOWS.find((w) => w.file === 'ci.yml');
    expect(ci.triggers.sort()).toEqual(['pull_request', 'push']);
    expect(ci.jobs.map((j) => j.id).sort()).toEqual([
      'backend', 'ios-changes', 'mobile', 'mobile-android-compile',
      'mobile-ios-build', 'secret-scan',
    ]);
    // Every job checks out, so every job needs `contents` named in any override it declares.
    expect(ci.jobs.filter((j) => j.checksOut).map((j) => j.id).sort()).toEqual([
      'backend', 'ios-changes', 'mobile', 'mobile-android-compile',
      'mobile-ios-build', 'secret-scan',
    ]);

    // Every job that touches the PR API is caught by the PR-API rule. secret-scan and
    // mobile-android-compile are the two that went red in the 403 incident.
    // `mobile-ios-build` USED to be in this list, when it ran dorny/paths-filter itself. That
    // filter now lives in the cheap `ios-changes` job so the 10x macOS runner is gated by
    // `needs`+`if` and never allocated on a non-iOS PR — so the PR-API scope moved with it.
    // The macOS job no longer touches the PR API at all, which is why it drops out here.
    // `secret-scan` dropped out the same way: it runs the gitleaks CLI over a range taken from the
    // event payload (secretScanGates.test.js), not gitleaks-action, so it holds no PR scope.
    const prApiJobs = ci.jobs
      .filter((j) => j.uses.some((u) => PR_API_ACTIONS.some((a) => a.match.test(u))))
      .map((j) => j.id)
      .sort();
    expect(prApiJobs).toEqual(['ios-changes', 'mobile-android-compile']);
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

// ---- the runner image of every job (OPS-191) -----------------------------------------------------
//
// GitHub's notice on run 38036165461 (Coordination, 2026-10-10): "The ubuntu-latest label will
// migrate to Ubuntu 26 beginning October 19, 2026" (actions/runner-images#14748). A label that moves
// changes the image under every job that names it while no line of this repository changes: the
// failure mode of the 2026-08-20 incident above, where something outside every diff decided what CI
// did. So every Ubuntu job names its image, and moving to Ubuntu 26 is a reviewed change of
// UBUNTU_IMAGE and of the workflows, made once a run on ubuntu-26.04 is green. What is pinned:
//   · every job's `runs-on` is one literal label. A missing one, an expression (`${{ matrix.os }}`),
//     a list, a `group:` or an alias leaves the image to something this parser cannot read, so each
//     fails the guard instead of being skipped, and so does a line under `jobs:` the parser cannot read
//     as a job. A reusable-workflow call has no `runs-on` of its own: adding one means teaching this
//     guard to read the workflow it calls;
//   · a label that names Ubuntu is exactly UBUNTU_IMAGE: not ubuntu-latest, not another release, not
//     an -arm variant or another spelling;
//   · the Ubuntu jobs are found by name, so the guard cannot pass on none;
//   · mobile-ios-build, on macos-latest, is the one runner outside this pin, and it is named, so a new
//     one is a change to this file.

const UBUNTU_IMAGE = 'ubuntu-24.04';
const namesUbuntu = (runsOn) => Boolean(runsOn.label) && /ubuntu/i.test(runsOn.label);

// Every way the workflows break the pin, one line each.
function runnerFailures(workflows) {
  const failures = [];
  for (const wf of workflows) {
    for (const line of wf.unreadJobs) failures.push(`${wf.file}: cannot read a job from this line under jobs: ${line}`);
    for (const job of wf.jobs) {
      if (job.runsOn.unreadable) failures.push(`${wf.file} job "${job.id}" ${job.runsOn.unreadable}`);
      else if (namesUbuntu(job.runsOn) && job.runsOn.label !== UBUNTU_IMAGE) {
        failures.push(`${wf.file} job "${job.id}" runs on ${job.runsOn.label}, not ${UBUNTU_IMAGE}`);
      }
    }
  }
  return failures;
}

// Every job of the real workflows, as `<file> <job>`, beside what its runs-on holds.
const RUNNERS = WORKFLOWS.flatMap((wf) => wf.jobs.map((job) => ({ at: `${wf.file} ${job.id}`, runsOn: job.runsOn })));

// A workflow of the given lines under `jobs:`, through the same parser, for the shapes the real
// workflows do not hold today.
const probe = (jobLines) => parseWorkflow('probe.yml', ['on: push', 'jobs:', ...jobLines].join('\n'));

describe('CI runner images (OPS-191)', () => {
  it(`runs every Ubuntu job on ${UBUNTU_IMAGE}, and reads the runs-on of every job`, () => {
    expect(runnerFailures(WORKFLOWS)).toEqual([]);
  });

  it('finds the Ubuntu jobs it pins, so it cannot pass on none', () => {
    expect(RUNNERS.filter((r) => namesUbuntu(r.runsOn)).map((r) => r.at).sort()).toEqual([
      'ci.yml backend',
      'ci.yml ios-changes',
      'ci.yml mobile',
      'ci.yml mobile-android-compile',
      'ci.yml secret-scan',
      'coordination.yml coordination',
      'secret-scan-history.yml gitleaks-history',
    ]);
  });

  it('leaves one runner outside the pin: macos-latest, on mobile-ios-build', () => {
    expect(RUNNERS.filter((r) => !namesUbuntu(r.runsOn)).map((r) => `${r.at}: ${r.runsOn.label || r.runsOn.unreadable}`))
      .toEqual(['ci.yml mobile-ios-build: macos-latest']);
  });

  it.each([
    ['passes the pinned image', ['runs-on: ubuntu-24.04'], []],
    ['passes the pinned image quoted, with a comment', ["runs-on: 'ubuntu-24.04'  # pinned"], []],
    ['leaves a runner that is not Ubuntu to the pin above', ['runs-on: macos-latest'], []],
    ['fails ubuntu-latest', ['runs-on: ubuntu-latest'], ['probe.yml job "probe" runs on ubuntu-latest, not ubuntu-24.04']],
    ['fails the next release', ['runs-on: ubuntu-26.04'], ['probe.yml job "probe" runs on ubuntu-26.04, not ubuntu-24.04']],
    ['fails an -arm variant', ['runs-on: ubuntu-24.04-arm'], ['probe.yml job "probe" runs on ubuntu-24.04-arm, not ubuntu-24.04']],
    ['fails another spelling', ['runs-on: Ubuntu-24.04'], ['probe.yml job "probe" runs on Ubuntu-24.04, not ubuntu-24.04']],
    ['fails an expression', ['runs-on: ${{ matrix.os }}'], ['probe.yml job "probe" has runs-on: ${{ matrix.os }}, not one literal label']],
    ['fails a list', ['runs-on: [self-hosted, linux]'], ['probe.yml job "probe" has runs-on: [self-hosted, linux], not one literal label']],
    ['fails a list on the lines below', ['runs-on:', '  - ubuntu-24.04'], [
      'probe.yml job "probe" has runs-on with no value on its line (a list, a group, or nothing), not one literal label',
    ]],
    ['fails a runner group', ['runs-on:', '  group: large-runners'], [
      'probe.yml job "probe" has runs-on with no value on its line (a list, a group, or nothing), not one literal label',
    ]],
    ['fails an alias', ['runs-on: *runner'], ['probe.yml job "probe" has runs-on: *runner, not one literal label']],
    ['fails a job with no runs-on', ['steps: []'], ['probe.yml job "probe" has no runs-on']],
    ['fails a reusable-workflow call', ['uses: ./.github/workflows/build.yml'], ['probe.yml job "probe" has no runs-on']],
  ])('%s', (_case, body, failures) => {
    expect(runnerFailures([probe(['  probe:', ...body.map((l) => `    ${l}`)])])).toEqual(failures);
  });

  it.each([
    ['a quoted job id', ['  "build":', '    runs-on: ubuntu-latest'], 'probe.yml: cannot read a job from this line under jobs: "build":'],
    ['a job written inline', ['  build: { runs-on: ubuntu-latest }'],
      'probe.yml: cannot read a job from this line under jobs: build: { runs-on: ubuntu-latest }'],
  ])('fails %s, which the parser cannot read, instead of skipping it', (_case, jobLines, failure) => {
    expect(runnerFailures([probe(jobLines)])).toEqual([failure]);
  });
});

// ---- the coordination check: .github/workflows/coordination.yml (OPS-153) ----------------------
//
// Two partners push to one private repository on GitHub's free plan: no branch protection, no
// required check, and a merge to main deploys production. The work-ledger engine
// (scripts/coord/coord.js) knows who claimed which files; its `ci` mode is the server-side half,
// and this workflow runs it on every pull request to main. What is pinned, and why:
//   · only `pull_request` to main, on opened, reopened, synchronize and ready_for_review: the job
//     skips drafts, so a draft marked ready is checked at once, not on its next push;
//   · `contents: read` and `pull-requests: read` at the top: the coordinator reads PR state so a
//     branch whose exact tip was merged or closed is not mistaken for live work;
//   · the engine is origin/main's copy, extracted outside the checkout, so a PR that edits
//     scripts/coord cannot weaken the check it is judged by;
//   · the branch name and the PR author reach the script only through `env:`. A branch name can
//     hold `$(...)` and backticks, and an expression inside `run:` is pasted into the script
//     before bash parses it;
//   · exit 0 (CLEAR) and 3 (WARN) pass the job; 1 (FAIL) and 2 (cannot verify) fail it.
// The second block runs the workflow's own step scripts under bash, on real git, the way the
// runner does, so these pins hold as behaviour and not only as strings.

const COORDINATION = 'coordination.yml';

const unquote = (value) => value.replace(/^(['"])(.*)\1$/, '$2');
const keyOf = (line) => (line.match(/^\s*([\w-]+):/) || [])[1];
const inlineOf = (line) => line.replace(/^\s*[\w-]+:\s*/, '').replace(/\s+#.*$/, '').trim();
const commandsOf = (script) => script.split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'));

// `[a, b]`, or a block of `- a` lines, → ['a', 'b'].
function sequenceAt(lines, keyIdx) {
  const inline = inlineOf(lines[keyIdx]);
  if (inline) return inline.replace(/^\[|\]$/g, '').split(',').map((s) => unquote(s.trim())).filter(Boolean);
  return directChildIndices(lines, keyIdx).map((i) => unquote(lines[i].replace(/^\s*-\s*/, '').trim()));
}

function mappingOf(lines, headerIdx) {
  return Object.fromEntries(directChildIndices(lines, headerIdx).map((i) => [keyOf(lines[i]), unquote(inlineOf(lines[i]))]));
}

// A `run: |` script as the runner receives it: dedented, with its comments and blank lines.
function blockScalar(lines, keyIdx) {
  const keyIndent = indentOf(lines[keyIdx]);
  const body = [];
  for (let i = keyIdx + 1; i < lines.length; i += 1) {
    if (lines[i].trim() !== '' && indentOf(lines[i]) <= keyIndent) break;
    body.push(lines[i]);
  }
  while (body.length > 0 && body[body.length - 1].trim() === '') body.pop();
  const depth = Math.min(...body.filter((l) => l.trim() !== '').map(indentOf));
  return body.map((l) => l.slice(depth)).join('\n');
}

function parseStep(stepLines) {
  // `- key: value` becomes `  key: value`, so the step reads as an ordinary mapping.
  const lines = stepLines.map((l, i) => (i === 0 ? l.replace(/^(\s*)- /, '$1  ') : l));
  const step = {};
  for (const i of directChildIndices(lines, -1)) {
    const key = keyOf(lines[i]);
    const inline = inlineOf(lines[i]);
    if (key === 'with' || key === 'env') step[key] = mappingOf(lines, i);
    else if (inline === '|') step[key] = blockScalar(lines, i);
    else step[key] = unquote(inline);
  }
  return step;
}

// One job of a workflow with its steps parsed, plus the workflow's top-level keys and its
// pull_request filters.
function readJob(file, jobId) {
  const lines = fs.readFileSync(path.join(WORKFLOW_DIR, file), 'utf8').split(/\r?\n/);
  const at = (parent, key) => (parent === undefined ? undefined : findDirectKey(lines, parent, key));
  const prIdx = at(at(-1, 'on'), 'pull_request');
  const jobIdx = at(at(-1, 'jobs'), jobId);
  const stepsIdx = at(jobIdx, 'steps');
  const ifIdx = at(jobIdx, 'if');
  const starts = stepsIdx === undefined ? [] : directChildIndices(lines, stepsIdx);
  const end = starts.length ? blockIndices(lines, stepsIdx).pop() + 1 : 0;
  return {
    lines,
    workflowKeys: directChildIndices(lines, -1).map((i) => keyOf(lines[i])),
    pullRequest: prIdx === undefined ? null
      : Object.fromEntries(directChildIndices(lines, prIdx).map((i) => [keyOf(lines[i]), sequenceAt(lines, i)])),
    keys: jobIdx === undefined ? [] : directChildIndices(lines, jobIdx).map((i) => keyOf(lines[i])),
    if: ifIdx === undefined ? null : unquote(inlineOf(lines[ifIdx])),
    steps: starts.map((s, k) => parseStep(lines.slice(s, k + 1 < starts.length ? starts[k + 1] : end))),
  };
}

const coordinationWorkflow = WORKFLOWS.find((w) => w.file === COORDINATION);
const coordination = coordinationWorkflow ? readJob(COORDINATION, 'coordination') : null;
const coordinationSteps = coordination ? coordination.steps : [];
const stepNamed = (name) => coordinationSteps.find((s) => s.name === name && typeof s.run === 'string');
const fetchStep = stepNamed('Fetch every branch on origin');
const extractStep = stepNamed('Take the engine from origin/main');
const checkStep = stepNamed('Work ledger check');

// The fetch step, whole.
//   · No tag is kept, and none is fetched again. actions/checkout with fetch-depth 0 fetches every
//     tag, and git resolves `origin/main` as refs/tags/origin/main before refs/remotes/origin/main,
//     so anyone who can push a tag named origin/main, or origin/<branch>, would hand the check
//     another engine, other rules or another branch. tagOpt stops the engine's own fetch from
//     following such a tag back in.
//   · The checkout's fetch wrote every remote-tracking reflog at checkout time, and the engine reads a
//     branch's last movement from that reflog: kept, every unmerged branch would look as if it moved
//     a moment ago. Without them the engine judges recency by commit dates, as on any fresh clone.
const FETCH_COMMANDS = [
  'set -o pipefail',
  'git config remote.origin.tagOpt --no-tags',
  "git for-each-ref --format='delete %(refname)' refs/tags | git update-ref --stdin",
  "git fetch --prune origin '+refs/heads/*:refs/remotes/origin/*'",
  'rm -rf .git/logs/refs/remotes',
];
const ENGINE_FROM_MAIN = 'git archive refs/remotes/origin/main scripts/coord | tar -x -C "$RUNNER_TEMP/coord"';
const EXTRACT_COMMANDS = ['set -o pipefail', 'mkdir -p "$RUNNER_TEMP/coord"', ENGINE_FROM_MAIN];
const ENGINE_RUN = 'node "$RUNNER_TEMP/coord/scripts/coord/coord.js" ci --branch "$HEAD_REF" --author "$PR_AUTHOR" --mode warn || rc=$?';
// The check step, whole. The engine's output is fenced by a one-time token, so nothing it prints
// (a branch name, a title from the ledger) is read by the runner as a workflow command.
const CHECK_COMMANDS = [
  'rc=0',
  't=$(openssl rand -hex 16)',
  'echo "::stop-commands::$t"',
  ENGINE_RUN,
  'echo "::$t::"',
  'case "$rc" in',
  '0) ;;',
  '3) echo "::warning title=Coordination::the work ledger check reports a WARN; read the job summary" ;;',
  '*)',
  'echo "::error title=Coordination::the work ledger check exited $rc (1 FAIL, 2 cannot verify, any other: it did not finish); read the log above"',
  'echo "**Work ledger check: exit $rc** (1 FAIL, 2 cannot verify, any other: it did not finish). The reason is in the job log." >> "$GITHUB_STEP_SUMMARY"',
  'exit "$rc"',
  ';;',
  'esac',
];

describe('the coordination check (coordination.yml, OPS-153)', () => {
  it('finds the workflow, its one job and its five steps, so no pin below passes on nothing', () => {
    expect(coordinationWorkflow).toBeDefined();
    expect(coordinationSteps.map((s) => s.uses || s.name)).toEqual([
      'actions/checkout@v4',
      'Fetch every branch on origin',
      'actions/setup-node@v4',
      'Take the engine from origin/main',
      'Work ledger check',
    ]);
    expect([fetchStep, extractStep, checkStep].every(Boolean)).toBe(true);
  });

  it('runs only on pull requests to main: opened, reopened, pushed to, or marked ready', () => {
    expect(coordinationWorkflow.triggers).toEqual(['pull_request']);
    // A paths or branches-ignore filter would exempt whole pull requests from the check.
    expect(coordination.pullRequest).toEqual({
      branches: ['main'],
      types: ['opened', 'reopened', 'synchronize', 'ready_for_review'],
    });
  });

  it('holds only contents: read and pull-requests: read; no job grants itself more', () => {
    expect(coordinationWorkflow.permissions).toEqual({ contents: 'read', 'pull-requests': 'read' });
    expect(coordinationWorkflow.jobs.map((j) => j.id)).toEqual(['coordination']);
    for (const job of coordinationWorkflow.jobs) {
      expect(job.permissions).toBeNull();
      expect(grantedLevel(coordinationWorkflow.permissions, 'pull-requests')).toBe('read');
      expect(job.uses.filter((u) => PR_API_ACTIONS.some((a) => a.match.test(u)))).toEqual([]);
    }
  });

  it('passes the workflow token only to the coordinator step', () => {
    expect(checkStep.env).toEqual({
      HEAD_REF: '${{ github.head_ref }}',
      PR_AUTHOR: '${{ github.event.pull_request.user.login }}',
      GH_TOKEN: '${{ github.token }}',
    });
    expect(coordinationSteps.filter((step) => step !== checkStep).every((step) => !step.env?.GH_TOKEN)).toBe(true);
  });

  it('skips drafts and pull requests from forks', () => {
    expect(coordination.if).toBe(
      'github.event.pull_request.draft == false && github.event.pull_request.head.repo.full_name == github.repository',
    );
  });

  it('checks out the whole history, drops every tag and the checkout\'s reflogs, and fetches every branch', () => {
    expect(coordinationSteps[0].with).toEqual({ 'fetch-depth': '0' });
    expect(commandsOf(fetchStep.run)).toEqual(FETCH_COMMANDS);
  });

  it('uses the same checkout and setup-node pins, and the same Node version, as the backend job in ci.yml', () => {
    const backend = readJob('ci.yml', 'backend').steps;
    const setupNode = (steps) => steps.find((s) => /^actions\/setup-node@/.test(s.uses || ''));
    expect(setupNode(backend)).toBeDefined();
    expect(coordinationSteps[0].uses).toBe(backend[0].uses);
    expect(setupNode(coordinationSteps).uses).toBe(setupNode(backend).uses);
    expect(setupNode(coordinationSteps).with).toEqual({ 'node-version': setupNode(backend).with['node-version'] });
  });

  it("takes the engine from refs/remotes/origin/main, outside the checkout, and never names the PR's own copy", () => {
    expect(commandsOf(extractStep.run)).toEqual(EXTRACT_COMMANDS);
    expect(commandsOf(checkStep.run)).toEqual(CHECK_COMMANDS);
    // Any other mention of the engine outside a comment would be the checkout's copy, which the PR controls.
    expect(coordination.lines.filter((l) => /scripts\/coord/.test(l) && !/^\s*#/.test(l)).map((l) => l.trim()))
      .toEqual([ENGINE_FROM_MAIN, ENGINE_RUN]);
  });

  it('passes the branch name, PR author and token only through env, never as expressions inside a script', () => {
    expect(checkStep.env).toEqual({
      HEAD_REF: '${{ github.head_ref }}',
      PR_AUTHOR: '${{ github.event.pull_request.user.login }}',
      GH_TOKEN: '${{ github.token }}',
    });
    for (const step of coordinationSteps.filter((s) => typeof s.run === 'string')) expect(step.run).not.toMatch(/\$\{\{/);
    // Comment lines inside a `run: |` block are part of the script, and are covered just above.
    expect(coordination.lines.filter((l) => l.includes('${{') && !/^\s*#/.test(l)).map((l) => l.trim())).toEqual([
      'HEAD_REF: ${{ github.head_ref }}',
      'PR_AUTHOR: ${{ github.event.pull_request.user.login }}',
      'GH_TOKEN: ${{ github.token }}',
    ]);
  });

  it('holds nothing beside its pinned keys that could skip, soften or re-point the check', () => {
    // continue-on-error, shell, working-directory, defaults, env or concurrency would each let the job
    // go green on a check that failed, ran elsewhere, or was cancelled.
    expect(coordination.workflowKeys).toEqual(['name', 'on', 'permissions', 'jobs']);
    expect(coordination.keys).toEqual(['name', 'runs-on', 'if', 'timeout-minutes', 'steps']);
    expect(coordinationSteps.map((s) => Object.keys(s).sort())).toEqual([
      ['uses', 'with'], ['name', 'run'], ['uses', 'with'], ['name', 'run'], ['env', 'name', 'run'],
    ]);
  });
});

// ---- the same steps, run under bash on real git ---------------------------------------------------
//
// A bare repository plays origin, and each test gets a workspace in the shape actions/checkout@v4
// leaves on a pull request with fetch-depth 0: `git init`, one fetch of every branch and every tag,
// the head checked out detached. The workflow's own step scripts then run in it, in order, under bash.

// GitHub runs a `run:` script that names no shell as `bash -e {0}`. On Windows the bash that ships
// with git is used: a bare `bash` there can resolve to the WSL launcher, which cannot see these paths.
function bashPath() {
  if (process.platform !== 'win32') return 'bash';
  const execPath = spawnSync('git', ['--exec-path'], { encoding: 'utf8' }).stdout.trim();
  const gitRoot = path.resolve(execPath, '..', '..', '..');
  return [path.join(gitRoot, 'usr', 'bin', 'bash.exe'), path.join(gitRoot, 'bin', 'bash.exe')].find((p) => fs.existsSync(p)) || 'bash';
}

const BASH = bashPath();
const REPO_ROOT = path.join(__dirname, '..', '..');
const toPosix = (p) => p.replace(/\\/g, '/');

// A sandbox: a git environment with the user's config shut out, a bare origin, a seed repository
// that pushes to it, and the runner's shape around them.
function openSandbox(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${label} `));
  const emptyConfig = path.join(dir, 'empty gitconfig');
  fs.writeFileSync(emptyConfig, '');
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(GIT_|GITHUB_|RUNNER_|PROBE_)/.test(k)) delete env[k];
  Object.assign(env, {
    GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'Probe',
    GIT_AUTHOR_EMAIL: 'probe@example.com',
    GIT_COMMITTER_NAME: 'Probe',
    GIT_COMMITTER_EMAIL: 'probe@example.com',
  });
  let n = 0;
  const box = { dir };

  box.git = (cwd, args, extraEnv = {}) => {
    const res = spawnSync('git', args, { cwd, env: { ...env, ...extraEnv }, encoding: 'utf8', windowsHide: true });
    if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}:\n${res.stdout}${res.stderr}`);
    return res.stdout.trim();
  };

  box.write = (repo, rel, text) => {
    const p = path.join(repo, ...rel.split('/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text, 'utf8');
  };

  box.origin = path.join(dir, 'origin.git');
  box.git(dir, ['-c', 'init.defaultBranch=main', 'init', '--quiet', '--bare', box.origin]);
  box.seed = path.join(dir, 'seed');
  box.git(dir, ['-c', 'init.defaultBranch=main', 'init', '--quiet', box.seed]);
  box.git(box.seed, ['remote', 'add', 'origin', box.origin]);

  // A workspace as actions/checkout@v4 leaves it (git-source-provider: init, then one fetch of
  // `+refs/heads/*:refs/remotes/origin/*` and `+refs/tags/*:refs/tags/*`, then a detached checkout).
  box.workspace = (head) => {
    n += 1;
    const ws = path.join(dir, `workspace ${n}`);
    box.git(dir, ['init', '--quiet', ws]);
    box.git(ws, ['remote', 'add', 'origin', box.origin]);
    box.git(ws, ['-c', 'protocol.version=2', 'fetch', '--quiet', '--prune', '--no-recurse-submodules', 'origin',
      '+refs/heads/*:refs/remotes/origin/*', '+refs/tags/*:refs/tags/*']);
    box.git(ws, ['checkout', '--quiet', '--force', '--detach', `refs/remotes/origin/${head}`]);
    return ws;
  };

  // A fresh RUNNER_TEMP with an empty job summary, as each job starts with, around a workspace.
  box.runner = (ws) => {
    n += 1;
    const temp = path.join(dir, `runner temp ${n}`);
    fs.mkdirSync(temp);
    const summary = path.join(temp, 'step summary.md');
    fs.writeFileSync(summary, '');
    const log = path.join(temp, 'probe.jsonl');
    return {
      ws,
      temp,
      summary,
      log,
      env: { RUNNER_TEMP: toPosix(temp), GITHUB_STEP_SUMMARY: toPosix(summary), PROBE_LOG: toPosix(log) },
    };
  };

  // One of the workflow's `run:` scripts, run the way the runner runs it.
  box.runStep = (r, script, extraEnv = {}) => {
    n += 1;
    const file = path.join(dir, `step ${n}.sh`);
    fs.writeFileSync(file, `${script}\n`, 'utf8');
    const res = spawnSync(BASH, ['-e', toPosix(file)], {
      cwd: r.ws, env: { ...env, ...r.env, ...extraEnv }, encoding: 'utf8', windowsHide: true,
    });
    if (res.error) throw res.error;
    return { code: res.status, out: `${res.stdout}${res.stderr}`, stdout: res.stdout };
  };

  // The job's fetch and extract steps, which must both succeed.
  box.prepare = (r) => {
    for (const step of [fetchStep, extractStep]) {
      const res = box.runStep(r, step.run);
      if (res.code !== 0) throw new Error(`the step "${step.name}" failed:\n${res.out}`);
    }
    return r;
  };

  box.tags = (ws) => box.git(ws, ['for-each-ref', '--format=%(refname)', 'refs/tags']);
  box.extractedEngine = (r) => fs.readFileSync(path.join(r.temp, 'coord', 'scripts', 'coord', 'coord.js'), 'utf8');
  box.close = () => fs.rmSync(dir, { recursive: true, force: true });
  return box;
}

// ---- with a stand-in engine -------------------------------------------------------------------------
//
// main carries the engine; the PR branch rewrites it into one that always passes, which is what a PR
// wanting to weaken its own check would do. The stand-in records how it was called, prints what a test
// asks it to, and exits with the code a test asks for; the engine itself is tested in coord.*.test.js.

const HOSTILE_REF = 'feat/x$(touch${IFS}pwned)`touch${IFS}pwned2`;exit${IFS}0';
const engineSource = (who) => [
  "'use strict';",
  "const fs = require('fs');",
  `fs.appendFileSync(process.env.PROBE_LOG, JSON.stringify({ engine: '${who}', argv: process.argv.slice(2) }) + '\\n');`,
  "if (process.env.PROBE_SAY) process.stdout.write(process.env.PROBE_SAY + '\\n');",
  // main's engine answers with the exit code the test asks for; the PR's always passes.
  `process.exit(${who === 'main' ? 'Number(process.env.PROBE_EXIT)' : '0'});`,
  '',
].join('\n');

describe('coordination.yml step scripts, run under bash on real git (OPS-153)', () => {
  let box;
  let noEngine;
  let prEngine;

  const calls = (r) => (fs.existsSync(r.log)
    ? fs.readFileSync(r.log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : []);

  const check = (r, engineExit, extraEnv = {}) => box.runStep(r, checkStep.run, {
    HEAD_REF: HOSTILE_REF, PR_AUTHOR: 'DanielBedrack', PROBE_EXIT: String(engineExit), ...extraEnv,
  });

  const prepared = () => box.prepare(box.runner(box.workspace('feat/pr')));

  beforeAll(() => {
    box = openSandbox('coordination workflow');
    const { seed } = box;
    box.write(seed, 'README.md', 'probe\n');
    box.git(seed, ['add', '--', 'README.md']);
    box.git(seed, ['commit', '--quiet', '-m', 'base, before the engine landed']);
    noEngine = box.git(seed, ['rev-parse', 'HEAD']);
    box.write(seed, 'scripts/coord/coord.js', engineSource('main'));
    box.git(seed, ['add', '--', 'scripts/coord/coord.js']);
    box.git(seed, ['commit', '--quiet', '-m', 'the engine']);
    box.git(seed, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);
    box.git(seed, ['checkout', '--quiet', '-b', 'feat/pr']);
    box.write(seed, 'scripts/coord/coord.js', engineSource('pr'));
    box.git(seed, ['commit', '--quiet', '-am', 'a PR that rewrites the engine to always pass']);
    prEngine = box.git(seed, ['rev-parse', 'HEAD']);
    box.git(seed, ['push', '--quiet', 'origin', 'HEAD:refs/heads/feat/pr']);
  }, 60000);

  afterAll(() => {
    if (box) box.close();
  });

  it("runs origin/main's engine, not the copy the PR put in the checkout", () => {
    const ws = box.workspace('feat/pr');
    expect(fs.readFileSync(path.join(ws, 'scripts', 'coord', 'coord.js'), 'utf8')).toBe(engineSource('pr'));
    const r = box.prepare(box.runner(ws));
    expect(box.extractedEngine(r)).toBe(engineSource('main'));
    // main's engine says FAIL; the PR's copy would have passed.
    expect(check(r, 1).code).toBe(1);
    expect(calls(r).map((c) => c.engine)).toEqual(['main']);
  }, 60000);

  it('a tag named origin/main cannot hand the check another engine: every tag is dropped and none comes back', () => {
    // Anyone who can push can create this tag. It points at the PR's always-passing engine, and git
    // resolves `origin/main` to refs/tags/origin/main before refs/remotes/origin/main.
    box.git(box.dir, ['--git-dir', box.origin, 'tag', 'origin/main', prEngine]);
    try {
      const ws = box.workspace('feat/pr');
      // The runner's checkout fetched it with every other tag.
      expect(box.tags(ws)).toBe('refs/tags/origin/main');
      const r = box.prepare(box.runner(ws));
      expect(box.tags(ws)).toBe('');
      expect(box.extractedEngine(r)).toBe(engineSource('main'));
      expect(check(r, 1).code).toBe(1);
      expect(calls(r).map((c) => c.engine)).toEqual(['main']);
      // The engine fetches again on its own (scripts/coord/lib/git.js), and git follows a tag that
      // points into what it fetches unless the remote says otherwise.
      box.git(ws, ['fetch', '--prune', '--quiet', 'origin', '+refs/heads/*:refs/remotes/origin/*']);
      expect(box.tags(ws)).toBe('');
    } finally {
      box.git(box.dir, ['--git-dir', box.origin, 'tag', '--delete', 'origin/main']);
    }
  }, 60000);

  it('hands the engine the branch name and the author as single literal arguments, whatever they hold', () => {
    const r = prepared();
    expect(check(r, 0).code).toBe(0);
    expect(calls(r)).toEqual([
      { engine: 'main', argv: ['ci', '--branch', HOSTILE_REF, '--author', 'DanielBedrack', '--mode', 'warn'] },
    ]);
    expect(fs.readdirSync(r.ws).filter((f) => /pwned/.test(f))).toEqual([]);
    expect(fs.readdirSync(box.dir).filter((f) => /pwned/.test(f))).toEqual([]);
  }, 60000);

  it.each([
    [0, 0, 'CLEAR passes'],
    [3, 0, 'WARN passes, with a warning annotation'],
    [1, 1, 'FAIL fails the job'],
    [2, 2, 'cannot verify fails the job'],
    [4, 4, 'an exit code the engine never gives fails the job'],
    [127, 127, 'a missing program fails the job'],
    [137, 137, 'a killed engine fails the job'],
  ])('engine exit %i → step exit %i (%s)', (engineExit, stepExit) => {
    const r = prepared();
    const res = check(r, engineExit);
    expect(res.code).toBe(stepExit);
    expect(calls(r).map((c) => c.engine)).toEqual(['main']);
    expect(/::warning/.test(res.out)).toBe(engineExit === 3);
    expect(/::error/.test(res.out)).toBe(stepExit !== 0);
    // A failure is reported in the job summary too, where the engine's own report would be.
    expect(fs.readFileSync(r.summary, 'utf8').includes(`exit ${engineExit}`)).toBe(stepExit !== 0);
  }, 60000);

  it("fences the engine's output with a one-time token, so nothing it prints is read as a workflow command", () => {
    const FORGED = '::error title=forged::printed by the engine';
    const fenceOf = (stdout) => {
      const lines = stdout.split(/\r?\n/);
      const stop = lines.findIndex((l) => /^::stop-commands::[0-9a-f]{32}$/.test(l));
      const token = stop < 0 ? null : lines[stop].slice('::stop-commands::'.length);
      return { lines, stop, token, resume: token ? lines.indexOf(`::${token}::`) : -1 };
    };
    const clear = check(prepared(), 0, { PROBE_SAY: FORGED });
    expect(clear.code).toBe(0);
    const a = fenceOf(clear.stdout);
    const forged = a.lines.indexOf(FORGED);
    expect(a.stop).toBeGreaterThanOrEqual(0);
    expect(a.stop < forged && forged < a.resume).toBe(true);
    // The step's own annotation comes after the fence, where the runner reads commands again.
    const warn = check(prepared(), 3, { PROBE_SAY: FORGED });
    const b = fenceOf(warn.stdout);
    expect(b.lines.findIndex((l) => l.startsWith('::warning title=Coordination::'))).toBeGreaterThan(b.resume);
    // A new token every run, so the engine cannot know it and close the fence early.
    expect(b.token).not.toBe(a.token);
  }, 60000);

  it('fails, and runs nothing, when origin/main carries no engine', () => {
    const r = box.runner(box.workspace('feat/pr'));
    expect(box.runStep(r, fetchStep.run).code).toBe(0);
    box.git(r.ws, ['update-ref', 'refs/remotes/origin/main', noEngine]);
    expect(box.runStep(r, extractStep.run).code).not.toBe(0);
    expect(check(r, 0).code).not.toBe(0);
    expect(calls(r)).toEqual([]);
  }, 60000);
});

// ---- with the real engine: recency on the runner's checkout --------------------------------------
//
// origin/main carries the real engine (scripts/coord) and the real WORK_LEDGER.md. The pull request
// holds a claim on backend/x.js, written with the engine's own ledger writer. Two branches of the
// other partner change the same file without a claim: one committed yesterday, one 40 days ago and not
// moved since. The runner's checkout writes every remote-tracking reflog at checkout time, and the
// engine reads a branch's last movement from that reflog, so with them the 40-day branch would read
// as work in flight.

const LEDGER_LIB = require(path.join(REPO_ROOT, 'scripts', 'coord', 'lib', 'ledger.js'));
const AUTHORS = {
  malede: { GIT_AUTHOR_NAME: 'Full Stack Developer', GIT_AUTHOR_EMAIL: '102303436+DanielMalede@users.noreply.github.com' },
  bedrack: { GIT_AUTHOR_NAME: 'DanielBedrack', GIT_AUTHOR_EMAIL: '111690772+DanielBedrack@users.noreply.github.com' },
};

describe('coordination.yml with the real engine, on a checkout shaped like the runner\'s (OPS-153)', () => {
  let box;

  const daysAgo = (days) => {
    const at = `@${Math.floor(Date.now() / 1000) - days * 86400} +0000`;
    return { GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at };
  };

  // A branch of `who`, cut from main, committed `days` ago with `files` written, and pushed.
  function branch(name, who, days, files) {
    box.git(box.seed, ['checkout', '--quiet', '-b', name, 'main']);
    for (const [rel, text] of Object.entries(files)) box.write(box.seed, rel, text);
    box.git(box.seed, ['add', '--', ...Object.keys(files)]);
    box.git(box.seed, ['commit', '--quiet', '-m', name], { ...AUTHORS[who], ...daysAgo(days) });
    box.git(box.seed, ['push', '--quiet', 'origin', `HEAD:refs/heads/${name}`]);
  }

  beforeAll(() => {
    box = openSandbox('coordination engine');
    const { seed } = box;
    fs.writeFileSync(path.join(box.dir, 'fake gh.js'), [
      "'use strict';",
      "if (process.argv[2] === 'pr' && process.argv[3] === 'list') { process.stdout.write('[]'); process.exit(0); }",
      "process.stderr.write('unsupported fake gh call'); process.exit(1);",
      '',
    ].join('\n'));
    const ledger = fs.readFileSync(path.join(REPO_ROOT, 'WORK_LEDGER.md'), 'utf8');
    fs.cpSync(path.join(REPO_ROOT, 'scripts', 'coord'), path.join(seed, 'scripts', 'coord'), { recursive: true });
    box.write(seed, 'WORK_LEDGER.md', ledger);
    box.write(seed, 'backend/x.js', 'base\n');
    box.git(seed, ['add', '--', 'scripts/coord', 'WORK_LEDGER.md', 'backend/x.js']);
    box.git(seed, ['commit', '--quiet', '-m', 'main: the engine and the ledger'], AUTHORS.malede);
    box.git(seed, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);

    const free = LEDGER_LIB.parseLedger(ledger).slots.find((s) => s.section === 'M' && !s.claim);
    const claim = {
      task: 'own:recency-probe',
      taskKind: 'own',
      title: 'Recency on the runner',
      branch: 'feat/claimed',
      paths: ['backend/x.js'],
      resources: [],
      state: 'claimed',
      pr: null,
      started: '2026-10-06',
    };
    branch('feat/claimed', 'malede', 0, { 'WORK_LEDGER.md': LEDGER_LIB.setSlot(ledger, free.id, claim), 'backend/x.js': 'claimed\n' });
    branch('feat/fresh', 'bedrack', 1, { 'backend/x.js': 'fresh\n' });
    branch('feat/old', 'bedrack', 40, { 'backend/x.js': 'old\n' });
  }, 60000);

  afterAll(() => {
    if (box) box.close();
  });

  it('a branch untouched for 40 days is not work in flight on the runner; a branch from yesterday still is', () => {
    const ws = box.workspace('feat/claimed');
    // As on the runner, the checkout's fetch wrote a reflog for every remote branch just now.
    expect(fs.existsSync(path.join(ws, '.git', 'logs', 'refs', 'remotes', 'origin', 'feat', 'old'))).toBe(true);
    const r = box.prepare(box.runner(ws));
    const res = box.runStep(r, checkStep.run, {
      HEAD_REF: 'feat/claimed',
      PR_AUTHOR: 'DanielMalede',
      COORD_GH: path.join(box.dir, 'fake gh.js'),
    });
    expect(res.code).toBe(0);
    expect(res.out).toContain('ci feat/claimed by @DanielMalede: WARN');
    // The claim itself is sound: the only reasons are overlaps.
    expect(res.out).not.toMatch(/\[(unclaimed|ledger|drift|tasks-id|owner-only)\]/);
    // The control: the engine does report the other partner's recent branch on the same file.
    expect(res.out).toMatch(/WARN \[overlap\][^\n]*feat\/fresh/);
    expect(res.out).not.toContain('feat/old');
    const summary = fs.readFileSync(r.summary, 'utf8');
    expect(summary).toContain('feat/fresh');
    expect(summary).not.toContain('feat/old');
  }, 120000);
});
