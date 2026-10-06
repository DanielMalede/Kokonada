'use strict';

// Structural guards for the secret-scan gates.
//
// THE IGNORE LIST (OPS-107). The weekly full-history scan (.github/workflows/secret-scan-history.yml)
// has been red on every scheduled run, from the first on 2026-07-20, on one false positive:
// gitleaks 8.24.3's `generic-api-key` rule matches a public 22-character Spotify track ID, a test
// fixture in the since-deleted web frontend (frontend/src/__tests__/SpotifyAttribution.test.tsx:33,
// commit 3459263). A scan that is always red cannot report a real leak.
//
// `.gitleaksignore` skips that one finding by its fingerprint, `commit:file:rule:line`, so it can
// match nothing else: not another commit, file, line or rule. Allow-listing by rule or by path
// would blind the scan to every future match of the same kind, so neither is used. The pin keeps
// the file to that one line: any new entry has to be a reviewed change to this test, never a
// quiet edit to the ignore file.
//
// THE PR AND PUSH GATE (ci.yml, job `secret-scan`). gitleaks-action built a PR's range from the
// PR's commit list, GET /pulls/:number/commits, and read only the first page of it: 30 commits.
// A longer PR was scanned in part and still reported "No leaks detected". Run 37199191703 (PR
// #216) logged the range `f0e997b^..b25dedb` and "30 commits scanned". The job now runs the
// gitleaks CLI over a range taken from the event itself, so nothing pages:
//   · pull_request: base.sha..head.sha, every commit of the PR;
//   · push: before..sha, every pushed commit; when `before` is all zeros (the push created the
//     branch) every commit reachable from sha is new, so all of them;
//   · any other event fails rather than scanning nothing.
// The binary is a pinned release whose SHA-256 is checked before anything in the archive runs.
// The pins hold the exact commands, because a scan step that quietly narrows still reports green.
//
// THE OTHER WAYS TO SKIP A FINDING. `.gitleaksignore` is not the only channel, and a PR is scanned
// with its own checkout, so whatever it adds there applies to its own scan. Checked against the
// 8.24.3 release binary:
//   · a `.gitleaks.toml` at the checkout root is loaded, and its allowlist hides a finding;
//   · next to one, a `.gitleaks.json` is the file actually applied (the debug log still names the
//     .toml), so its allowlist hides a finding too; a `.gitleaks.yaml` is not read;
//   · an inline `gitleaks:allow` comment hides its line, unless `--ignore-gitleaks-allow` is passed,
//     which the `git` subcommand accepts. The repository holds no such comment, in the tree or in
//     history, so the flag changes no current result.
// So no `.gitleaks.<ext>` config may exist, and the PR and push scan ignores inline markers.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const GITLEAKSIGNORE = path.join(REPO_ROOT, '.gitleaksignore');
const CI_WORKFLOW = path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml');

const OPS_107_FINGERPRINT =
  '3459263a3431e29accccf3d674774be43d1f608f:frontend/src/__tests__/SpotifyAttribution.test.tsx:generic-api-key:33';

const GITLEAKS_VERSION = '8.24.3';
// gitleaks_8.24.3_linux_x64.tar.gz, as listed in the release's gitleaks_8.24.3_checksums.txt.
// A new version changes both constants, here and in ci.yml, in the same commit.
const GITLEAKS_SHA256 = '9991e0b2903da4c8f6122b5c3186448b927a5da4deef1fe45271c3793f4ee29c';

const PR_RANGE = '${{ github.event.pull_request.base.sha }}..${{ github.event.pull_request.head.sha }}';
const PUSH_RANGE = '${{ github.event.before }}..${{ github.sha }}';

const INSTALL_COMMANDS = [
  'curl -sSfL -o "$RUNNER_TEMP/gitleaks.tar.gz" "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"',
  'echo "$GITLEAKS_SHA256  $RUNNER_TEMP/gitleaks.tar.gz" | sha256sum --check --strict -',
  'tar -xzf "$RUNNER_TEMP/gitleaks.tar.gz" -C "$RUNNER_TEMP" gitleaks',
  '"$RUNNER_TEMP/gitleaks" version',
];

const SCAN_COMMANDS = [
  'case "$GITHUB_EVENT_NAME" in',
  'pull_request) range="$PR_RANGE" ;;',
  'push)',
  'if [ "$PUSH_BEFORE" = 0000000000000000000000000000000000000000 ]; then range="$GITHUB_SHA"; else range="$PUSH_RANGE"; fi ;;',
  '*) echo "::error::secret-scan has no commit range for a $GITHUB_EVENT_NAME event"; exit 1 ;;',
  'esac',
  'commits=$(git rev-list --count "$range")',
  'echo "gitleaks scans $range: $commits commits"',
  '"$RUNNER_TEMP/gitleaks" git --log-opts="$range" --ignore-gitleaks-allow --redact --verbose --exit-code=1 --no-banner .',
];

// gitleaks reads its config from `<checkout>/.gitleaks.<ext>`. `.gitleaksignore` has no dot after
// "gitleaks", so it does not match.
const GITLEAKS_CONFIG = /^\.gitleaks\./;

// ---- a reader for the one job, in the same indentation-walking style as the other CI guards ----

const indentOf = (line) => line.match(/^ */)[0].length;
const isSkippable = (line) => /^\s*(#.*)?$/.test(line);
const unquote = (value) => value.replace(/^(['"])(.*)\1$/, '$2');

// Every line nested under `headerIdx`; -1 means the document root.
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

function mappingOf(lines, headerIdx) {
  return Object.fromEntries(directChildIndices(lines, headerIdx).map((i) => {
    const m = lines[i].match(/^\s*([\w-]+):\s*(.*?)\s*(#.*)?$/);
    return [m[1], unquote(m[2])];
  }));
}

// A `run: |` script as the runner receives it: dedented, blank lines kept, comments kept.
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
    const [, key, rest] = lines[i].match(/^\s*([\w-]+):\s*(.*)$/);
    const inline = rest.replace(/\s+#.*$/, '').trim();
    if (key === 'with' || key === 'env') step[key] = mappingOf(lines, i);
    else if (inline === '|') step[key] = blockScalar(lines, i);
    else step[key] = unquote(inline);
  }
  return step;
}

function secretScanJob() {
  const lines = fs.readFileSync(CI_WORKFLOW, 'utf8').split(/\r?\n/);
  const jobsIdx = findDirectKey(lines, -1, 'jobs');
  const jobIdx = directChildIndices(lines, jobsIdx).find((i) => /^\s*secret-scan:\s*(#.*)?$/.test(lines[i]));
  if (jobIdx === undefined) return null;

  const permissionsIdx = findDirectKey(lines, jobIdx, 'permissions');
  const stepsIdx = findDirectKey(lines, jobIdx, 'steps');
  const starts = stepsIdx === undefined ? [] : directChildIndices(lines, stepsIdx);
  const end = stepsIdx === undefined ? 0 : blockIndices(lines, stepsIdx).pop() + 1;
  const keyOf = (i) => lines[i].match(/^\s*([\w-]+):/)[1];
  const onIdx = findDirectKey(lines, -1, 'on');
  return {
    workflowKeys: directChildIndices(lines, -1).map(keyOf),
    triggers: Object.fromEntries(directChildIndices(lines, onIdx)
      .map((i) => [keyOf(i), directChildIndices(lines, i).map(keyOf)])),
    keys: directChildIndices(lines, jobIdx).map(keyOf),
    permissions: permissionsIdx === undefined ? null : mappingOf(lines, permissionsIdx),
    steps: starts.map((start, n) => parseStep(lines.slice(start, n + 1 < starts.length ? starts[n + 1] : end))),
  };
}

const commandsOf = (script) => script.split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'));

describe('.gitleaksignore (OPS-107)', () => {
  it('exists at the repository root, where gitleaks reads it', () => {
    expect(fs.existsSync(GITLEAKSIGNORE)).toBe(true);
  });

  it('holds only the one OPS-107 fingerprint, plus comment lines', () => {
    // gitleaks trims each line and skips blank ones and those starting with `#`; every other line
    // is an entry. Read the same way here, so what the pin counts is what gitleaks ignores.
    const entries = fs.readFileSync(GITLEAKSIGNORE, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'));
    expect(entries).toEqual([OPS_107_FINGERPRINT]);
  });
});

describe('the PR and push secret scan (ci.yml, job secret-scan)', () => {
  const job = secretScanJob();
  const stepRunning = (re) => (job ? job.steps.find((s) => typeof s.run === 'string' && re.test(s.run)) : undefined);
  const install = stepRunning(/sha256sum/);
  const scan = stepRunning(/gitleaks" git /);

  it('finds the real job and its checkout, install and scan steps, so no pin below passes on nothing', () => {
    expect(job).not.toBeNull();
    expect(job.steps.map((s) => s.uses || s.name)).toEqual(['actions/checkout@v4', 'Install gitleaks', 'gitleaks']);
    expect(install).toBeDefined();
    expect(scan).toBeDefined();
  });

  it('does not use gitleaks-action, whose PR scan reads only the first 30 commits of the PR', () => {
    expect(job.steps.map((s) => s.uses).filter((u) => /gitleaks/i.test(u || ''))).toEqual([]);
  });

  it('checks out the whole history, so both ends of every range are in the clone', () => {
    const checkout = job.steps.find((s) => /^actions\/checkout@/.test(s.uses || ''));
    expect(checkout.with['fetch-depth']).toBe('0');
  });

  it(`installs gitleaks ${GITLEAKS_VERSION} and checks the archive's SHA-256 before anything in it runs`, () => {
    expect(install.env).toEqual({ GITLEAKS_VERSION, GITLEAKS_SHA256 });
    expect(commandsOf(install.run)).toEqual(INSTALL_COMMANDS);
  });

  it('on a pull request, passes gitleaks the explicit base..head range: every commit of the PR', () => {
    expect(scan.env.PR_RANGE).toBe(PR_RANGE);
    expect(commandsOf(scan.run)).toContain('pull_request) range="$PR_RANGE" ;;');
  });

  it('on a push, passes before..sha, and everything reachable from sha when before is all zeros', () => {
    expect(scan.env.PUSH_RANGE).toBe(PUSH_RANGE);
    expect(scan.env.PUSH_BEFORE).toBe('${{ github.event.before }}');
    expect(commandsOf(scan.run)).toContain(
      'if [ "$PUSH_BEFORE" = 0000000000000000000000000000000000000000 ]; then range="$GITHUB_SHA"; else range="$PUSH_RANGE"; fi ;;',
    );
  });

  it('runs exactly these scan commands: any other event fails, and the range reaches gitleaks unnarrowed', () => {
    expect(commandsOf(scan.run)).toEqual(SCAN_COMMANDS);
    expect(Object.keys(scan.env).sort()).toEqual(['PR_RANGE', 'PUSH_BEFORE', 'PUSH_RANGE']);
  });

  it('holds contents: read and nothing else: the CLI makes no pull-request API call', () => {
    expect(job.permissions).toEqual({ contents: 'read' });
  });

  it('ignores inline gitleaks:allow markers, so a PR cannot exempt its own line', () => {
    const gitleaksCall = commandsOf(scan.run).find((c) => c.startsWith('"$RUNNER_TEMP/gitleaks" git '));
    expect(gitleaksCall.split(' ')).toContain('--ignore-gitleaks-allow');
  });

  it('holds nothing beside its pinned steps that could skip, soften, cancel or re-point the scan', () => {
    // Each list is the whole set allowed at its level. continue-on-error, if, shell,
    // working-directory, defaults, container, needs, env or concurrency would each let the check go
    // green on a scan that failed, was skipped or cancelled, or read another config: gitleaks takes
    // GITLEAKS_CONFIG and GITLEAKS_CONFIG_TOML from the environment before any file, and a working
    // directory moves where it reads .gitleaksignore.
    expect(job.keys).toEqual(['name', 'runs-on', 'permissions', 'steps']);
    expect(job.steps.map((s) => Object.keys(s).sort())).toEqual([
      ['uses', 'with'], ['env', 'name', 'run'], ['env', 'name', 'run'],
    ]);
    expect(Object.keys(job.steps[0].with)).toEqual(['fetch-depth']);
    expect(job.workflowKeys).toEqual(['name', 'on', 'permissions', 'jobs']);
    // A paths, paths-ignore, branches-ignore or types filter would exempt whole pushes or PR updates.
    expect(job.triggers).toEqual({ push: ['branches'], pull_request: ['branches'] });
  });
});

describe('no gitleaks config file can allow-list a finding', () => {
  it('no `.gitleaks.<ext>` file is tracked anywhere in the repository', () => {
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf8' })
      .split('\0').filter(Boolean);
    // The listing is the real tree, so an empty result below means something.
    expect(tracked).toEqual(expect.arrayContaining(['.gitleaksignore', '.github/workflows/ci.yml']));
    expect(tracked.filter((f) => GITLEAKS_CONFIG.test(path.posix.basename(f)))).toEqual([]);
  });

  it('none sits at the repository root either, tracked or not, where gitleaks would load it', () => {
    expect(fs.readdirSync(REPO_ROOT).filter((name) => GITLEAKS_CONFIG.test(name))).toEqual([]);
  });
});
