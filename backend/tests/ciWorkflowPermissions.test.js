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

// ---- the coordination check: .github/workflows/coordination.yml (OPS-153) ----------------------
//
// Two partners push to one private repository on GitHub's free plan: no branch protection, no
// required check, and a merge to main deploys production. The work-ledger engine
// (scripts/coord/coord.js) knows who claimed which files; its `ci` mode is the server-side half,
// and this workflow runs it on every pull request to main. What is pinned, and why:
//   · only `pull_request` to main, on opened, reopened, synchronize and ready_for_review: the job
//     skips drafts, so a draft marked ready is checked at once, not on its next push;
//   · `contents: read` at the top and no job-level block: the check is git only, so it holds no
//     `pull-requests` scope and runs no action that calls the PR API;
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
const stepRunning = (re) => coordinationSteps.find((s) => typeof s.run === 'string' && re.test(s.run));
const fetchStep = stepRunning(/^git fetch /);
const extractStep = stepRunning(/git archive /);
const checkStep = stepRunning(/coord\.js" ci /);

const ENGINE_FROM_MAIN = 'git archive origin/main scripts/coord | tar -x -C "$RUNNER_TEMP/coord"';
const ENGINE_RUN = 'node "$RUNNER_TEMP/coord/scripts/coord/coord.js" ci --branch "$HEAD_REF" --author "$PR_AUTHOR" --mode warn || rc=$?';

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

  it('holds contents: read at the top and nothing else; no job grants itself more or calls the PR API', () => {
    expect(coordinationWorkflow.permissions).toEqual({ contents: 'read' });
    expect(coordinationWorkflow.jobs.map((j) => j.id)).toEqual(['coordination']);
    for (const job of coordinationWorkflow.jobs) {
      expect(job.permissions).toBeNull();
      expect(grantedLevel(coordinationWorkflow.permissions, 'pull-requests')).toBe('none');
      expect(job.uses.filter((u) => PR_API_ACTIONS.some((a) => a.match.test(u)))).toEqual([]);
    }
  });

  it('skips drafts and pull requests from forks', () => {
    expect(coordination.if).toBe(
      'github.event.pull_request.draft == false && github.event.pull_request.head.repo.full_name == github.repository',
    );
  });

  it('checks out the whole history, then fetches every branch on origin the way the engine reads them', () => {
    expect(coordinationSteps[0].with).toEqual({ 'fetch-depth': '0' });
    expect(fetchStep.run).toBe("git fetch --prune origin '+refs/heads/*:refs/remotes/origin/*'");
  });

  it('uses the same checkout and setup-node pins, and the same Node version, as the backend job in ci.yml', () => {
    const backend = readJob('ci.yml', 'backend').steps;
    const setupNode = (steps) => steps.find((s) => /^actions\/setup-node@/.test(s.uses || ''));
    expect(setupNode(backend)).toBeDefined();
    expect(coordinationSteps[0].uses).toBe(backend[0].uses);
    expect(setupNode(coordinationSteps).uses).toBe(setupNode(backend).uses);
    expect(setupNode(coordinationSteps).with).toEqual({ 'node-version': setupNode(backend).with['node-version'] });
  });

  it("takes the engine from origin/main, outside the checkout, and never names the PR's own copy", () => {
    expect(commandsOf(extractStep.run)).toContain(ENGINE_FROM_MAIN);
    expect(commandsOf(checkStep.run)).toContain(ENGINE_RUN);
    // Any other mention of the engine outside a comment would be the checkout's copy, which the PR controls.
    expect(coordination.lines.filter((l) => /scripts\/coord/.test(l) && !/^\s*#/.test(l)).map((l) => l.trim()))
      .toEqual([ENGINE_FROM_MAIN, ENGINE_RUN]);
  });

  it('passes the branch name and the PR author only through env, never as an expression inside a script', () => {
    expect(checkStep.env).toEqual({
      HEAD_REF: '${{ github.head_ref }}',
      PR_AUTHOR: '${{ github.event.pull_request.user.login }}',
    });
    for (const step of coordinationSteps.filter((s) => typeof s.run === 'string')) expect(step.run).not.toMatch(/\$\{\{/);
    // Comment lines inside a `run: |` block are part of the script, and are covered just above.
    expect(coordination.lines.filter((l) => l.includes('${{') && !/^\s*#/.test(l)).map((l) => l.trim())).toEqual([
      'HEAD_REF: ${{ github.head_ref }}',
      'PR_AUTHOR: ${{ github.event.pull_request.user.login }}',
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
// A bare repository plays origin. main carries the engine; the PR branch rewrites it into one that
// always passes, which is what a PR wanting to weaken its own check would do. The checkout is on
// the PR branch, as the runner's is. The engine is a stand-in that records how it was called and
// exits with the code a test asks for; the engine itself is tested in coord.*.test.js.

// GitHub runs a `run:` script that names no shell as `bash -e {0}`. On Windows the bash that ships
// with git is used: a bare `bash` there can resolve to the WSL launcher, which cannot see these paths.
function bashPath() {
  if (process.platform !== 'win32') return 'bash';
  const execPath = spawnSync('git', ['--exec-path'], { encoding: 'utf8' }).stdout.trim();
  const gitRoot = path.resolve(execPath, '..', '..', '..');
  return [path.join(gitRoot, 'usr', 'bin', 'bash.exe'), path.join(gitRoot, 'bin', 'bash.exe')].find((p) => fs.existsSync(p)) || 'bash';
}

const toPosix = (p) => p.replace(/\\/g, '/');
const HOSTILE_REF = 'feat/x$(touch${IFS}pwned)`touch${IFS}pwned2`;exit${IFS}0';
const engineSource = (who) => [
  "'use strict';",
  "const fs = require('fs');",
  `fs.appendFileSync(process.env.PROBE_LOG, JSON.stringify({ engine: '${who}', argv: process.argv.slice(2) }) + '\\n');`,
  // main's engine answers with the exit code the test asks for; the PR's always passes.
  `process.exit(${who === 'main' ? 'Number(process.env.PROBE_EXIT)' : '0'});`,
  '',
].join('\n');

describe('coordination.yml step scripts, run under bash on real git (OPS-153)', () => {
  const BASH = bashPath();
  let sandbox;
  let env;
  let checkout;
  let noEngine;
  let n = 0;

  function git(cwd, args) {
    const res = spawnSync('git', args, { cwd, env, encoding: 'utf8', windowsHide: true });
    if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}:\n${res.stdout}${res.stderr}`);
    return res.stdout.trim();
  }

  function write(dir, rel, text) {
    const p = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text, 'utf8');
  }

  function runStep(script, extraEnv = {}) {
    n += 1;
    const file = path.join(sandbox, `step ${n}.sh`);
    fs.writeFileSync(file, `${script}\n`, 'utf8');
    const res = spawnSync(BASH, ['-e', toPosix(file)], {
      cwd: checkout, env: { ...env, ...extraEnv }, encoding: 'utf8', windowsHide: true,
    });
    if (res.error) throw res.error;
    return { code: res.status, out: `${res.stdout}${res.stderr}` };
  }

  // A fresh RUNNER_TEMP, with an empty job summary, as each job starts with.
  function runner() {
    n += 1;
    const temp = path.join(sandbox, `runner temp ${n}`);
    fs.mkdirSync(temp);
    const summary = path.join(temp, 'step summary.md');
    fs.writeFileSync(summary, '');
    const log = path.join(temp, 'probe.jsonl');
    return {
      temp,
      summary,
      log,
      env: { RUNNER_TEMP: toPosix(temp), GITHUB_STEP_SUMMARY: toPosix(summary), PROBE_LOG: toPosix(log) },
    };
  }

  // The job's fetch and extract steps, run for real into a fresh runner.
  function extracted() {
    const r = runner();
    const fetched = runStep(fetchStep.run);
    if (fetched.code !== 0) throw new Error(`the fetch step failed:\n${fetched.out}`);
    const got = runStep(extractStep.run, r.env);
    if (got.code !== 0) throw new Error(`the extract step failed:\n${got.out}`);
    return r;
  }

  const calls = (r) => (fs.existsSync(r.log)
    ? fs.readFileSync(r.log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : []);

  const check = (r, engineExit) => runStep(checkStep.run, {
    ...r.env, HEAD_REF: HOSTILE_REF, PR_AUTHOR: 'DanielBedrack', PROBE_EXIT: String(engineExit),
  });

  beforeAll(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'coordination workflow '));
    const emptyConfig = path.join(sandbox, 'empty gitconfig');
    fs.writeFileSync(emptyConfig, '');
    env = { ...process.env };
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

    const origin = path.join(sandbox, 'origin.git');
    git(sandbox, ['-c', 'init.defaultBranch=main', 'init', '--quiet', '--bare', origin]);
    const seed = path.join(sandbox, 'seed');
    git(sandbox, ['-c', 'init.defaultBranch=main', 'init', '--quiet', seed]);
    git(seed, ['remote', 'add', 'origin', origin]);
    write(seed, 'README.md', 'probe\n');
    git(seed, ['add', '--', 'README.md']);
    git(seed, ['commit', '--quiet', '-m', 'base, before the engine landed']);
    noEngine = git(seed, ['rev-parse', 'HEAD']);
    write(seed, 'scripts/coord/coord.js', engineSource('main'));
    git(seed, ['add', '--', 'scripts/coord/coord.js']);
    git(seed, ['commit', '--quiet', '-m', 'the engine']);
    git(seed, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);
    git(seed, ['checkout', '--quiet', '-b', 'feat/pr']);
    write(seed, 'scripts/coord/coord.js', engineSource('pr'));
    git(seed, ['commit', '--quiet', '-am', 'a PR that rewrites the engine to always pass']);
    git(seed, ['push', '--quiet', 'origin', 'HEAD:refs/heads/feat/pr']);

    checkout = path.join(sandbox, 'checkout');
    git(sandbox, ['clone', '--quiet', '--branch', 'feat/pr', origin, checkout]);
  }, 60000);

  afterAll(() => {
    if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true });
  });

  it("runs origin/main's engine, not the copy the PR put in the checkout", () => {
    expect(fs.readFileSync(path.join(checkout, 'scripts', 'coord', 'coord.js'), 'utf8')).toBe(engineSource('pr'));
    const r = extracted();
    expect(fs.readFileSync(path.join(r.temp, 'coord', 'scripts', 'coord', 'coord.js'), 'utf8')).toBe(engineSource('main'));
    // main's engine says FAIL; the PR's copy would have passed.
    expect(check(r, 1).code).toBe(1);
    expect(calls(r).map((c) => c.engine)).toEqual(['main']);
  }, 60000);

  it('hands the engine the branch name and the author as single literal arguments, whatever they hold', () => {
    const r = extracted();
    expect(check(r, 0).code).toBe(0);
    expect(calls(r)).toEqual([
      { engine: 'main', argv: ['ci', '--branch', HOSTILE_REF, '--author', 'DanielBedrack', '--mode', 'warn'] },
    ]);
    expect(fs.readdirSync(checkout).filter((f) => /pwned/.test(f))).toEqual([]);
    expect(fs.readdirSync(sandbox).filter((f) => /pwned/.test(f))).toEqual([]);
  }, 60000);

  it.each([
    [0, 0, 'CLEAR passes'],
    [3, 0, 'WARN passes, with a warning annotation'],
    [1, 1, 'FAIL fails the job'],
    [2, 2, 'cannot verify fails the job'],
  ])('engine exit %i → step exit %i (%s)', (engineExit, stepExit) => {
    const r = extracted();
    const res = check(r, engineExit);
    expect(res.code).toBe(stepExit);
    expect(calls(r).map((c) => c.engine)).toEqual(['main']);
    expect(/::warning/.test(res.out)).toBe(engineExit === 3);
    expect(/::error/.test(res.out)).toBe(stepExit !== 0);
    // A failure is reported in the job summary too, where the engine's own report would be.
    expect(fs.readFileSync(r.summary, 'utf8').includes(`exit ${engineExit}`)).toBe(stepExit !== 0);
  }, 60000);

  it('fails, and runs nothing, when origin/main carries no engine', () => {
    const r = runner();
    expect(runStep(fetchStep.run).code).toBe(0);
    git(checkout, ['update-ref', 'refs/remotes/origin/main', noEngine]);
    try {
      expect(runStep(extractStep.run, r.env).code).not.toBe(0);
      expect(check(r, 0).code).not.toBe(0);
      expect(calls(r)).toEqual([]);
    } finally {
      expect(runStep(fetchStep.run).code).toBe(0);
    }
  }, 60000);
});
