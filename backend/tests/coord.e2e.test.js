'use strict';

// OPS-152 · the coordinator end to end, on real git.
//
// A bare repository plays origin; two clones play the two partners. Everything runs through the
// real CLI (scripts/coord/coord.js) against real git — fetch, worktrees, commits, pushes, a squash
// merge onto main — inside a temp folder whose path contains a space, with the user's git config
// shut out. Only `gh` is replaced, by a small stateful fake that records every call and answers
// from a JSON file the way the real one answers from GitHub (PRs it created, their files, runs).
//
// The scenario is the one the two partners will actually live:
//   1. Bedrack claims the Project Explorer work, which includes the CI workflow.
//   2. Malede's check on the workflow HALTs, naming Bedrack's branch, the file and the exclusive row.
//   3. Malede claims two disjoint tasks → slots M01 and M02, the TASKS row marked.
//   4. Bedrack's PR squash-merges; Malede merges main into both branches without a conflict, and
//      the check from step 2 is now CLEAR.
//   5. A branch whose changes drift outside its declared paths fails `ci`.
//   6. Both partners take the same TASKS row → the second one stops.
//   7. An unclaimed branch touching the workflow still stops Malede's check.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const COORD = path.join(REPO_ROOT, 'scripts', 'coord', 'coord.js');
const SEED_LEDGER = fs.readFileSync(path.join(REPO_ROOT, 'WORK_LEDGER.md'), 'utf8');

jest.setTimeout(240000);

const LOGINS = { malede: 'DanielMalede', bedrack: 'DanielBedrack' };
const AUTHORS = {
  malede: ['Full Stack Developer', '102303436+DanielMalede@users.noreply.github.com'],
  bedrack: ['DanielBedrack', '111690772+DanielBedrack@users.noreply.github.com'],
};

const TASKS = `# TASKS — e2e

**Next free IDs:** \`BE-003\`

## Backend

- [ ] \`BE-001\` \`P1\` The first open row.
  - where: \`backend/app/services/alpha.js\` · done when: alpha works · added: 2026-10-01
- [ ] \`BE-002\` \`P1\` The second open row.
  - where: \`backend/app/services/beta.js\` · done when: beta works · added: 2026-10-01
`;

const FAKE_GH = `'use strict';
// A stateful stand-in for the GitHub CLI: it records every call and answers from a JSON file.
// The signed-in user is FAKE_GH_LOGIN (or state.login) and never COORD_LOGIN, so a mismatch between
// the two is testable. Two coordinators may call it at the same moment, so a read retries and a
// write swaps a whole file in. A test can schedule a one-shot git command on a call ("hooks"): that
// is how a partner's push is landed between a check and a push, as in a real race.
const fs = require('fs');
const { execFileSync } = require('child_process');
const statePath = process.env.FAKE_GH_STATE;
const nap = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function load() {
  for (let i = 0; ; i += 1) {
    try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (err) { if (i > 100) throw err; nap(20); }
  }
}
const state = load();
const args = process.argv.slice(2);
const me = process.env.FAKE_GH_LOGIN || state.login || null;
state.calls.push({ args, cwd: process.cwd(), login: me });
function save() {
  const tmp = statePath + '.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  for (let i = 0; ; i += 1) {
    try { fs.renameSync(tmp, statePath); return; } catch (err) { if (i > 100) throw err; nap(20); }
  }
}
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const out = (s) => { save(); process.stdout.write(s); process.exit(0); };
const fail = (s) => { save(); process.stderr.write(s); process.exit(1); };
const git = (a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const pick = (pr, fields) => Object.fromEntries(fields.split(',').map((f) => [f, pr[f]]));
const newestFirst = () => state.prs.slice().sort((a, b) => b.number - a.number);
// Like GitHub: an OPEN PR's files and head commit follow its branch; a merged or closed PR, or one
// whose branch is gone, keeps what it had.
function refresh(pr) {
  if (pr.state !== 'OPEN' && pr.files) return pr;
  try {
    const head = 'origin/' + pr.headRefName;
    const base = git(['merge-base', 'origin/main', head]);
    pr.files = git(['diff', '--name-only', '--no-renames', base, head]).split('\\n').filter(Boolean).map((p) => ({ path: p }));
    pr.headRefOid = git(['rev-parse', head]);
  } catch (err) {
    if (!pr.files) pr.files = [];
  }
  return pr;
}
function runHooks(on) {
  const due = (state.hooks || []).filter((h) => h.on === on);
  if (!due.length) return;
  state.hooks = (state.hooks || []).filter((h) => h.on !== on);
  save();
  for (const h of due) execFileSync('git', h.args, { cwd: h.cwd, encoding: 'utf8' });
}
if (state.broken) fail('gh: not logged in');
if (args[0] === '--version') out('gh version 0.0.0 (fake)\\n');
if (args[0] === 'api' && args[1] === 'user') { if (!me) fail('gh: not logged in'); out(me + '\\n'); }
if (args[0] === 'pr' && args[1] === 'create') {
  const number = state.next++;
  const pr = {
    number, title: flag('--title'), body: fs.readFileSync(flag('--body-file'), 'utf8'), headRefName: flag('--head'),
    baseRefName: flag('--base'), isDraft: args.includes('--draft'), state: 'OPEN', author: { login: me },
    url: 'https://github.example/pull/' + number,
  };
  refresh(pr);
  state.prs.push(pr);
  out(pr.url + '\\n');
}
if (args[0] === 'pr' && args[1] === 'view') {
  const sel = args[2] && !args[2].startsWith('-') ? args[2] : git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const pr = newestFirst().find((p) => String(p.number) === sel || p.headRefName === sel);
  if (!pr) fail('no pull requests found for ' + sel);
  const view = pick(refresh(pr), flag('--json') || 'number');
  if (view.files) view.files = view.files.slice(0, 100); // gh pr view --json files stops at 100
  out(JSON.stringify(view));
}
if (state.failPrList && args[0] === 'pr' && args[1] === 'list') fail('gh: pr list failed (fake)');
if (args[0] === 'pr' && args[1] === 'diff') {
  const pr = state.prs.find((p) => String(p.number) === args[2]);
  if (!pr) fail('no pull request ' + args[2]);
  out(refresh(pr).files.map((f) => f.path).join('\\n') + '\\n');
}
if (args[0] === 'pr' && args[1] === 'list') {
  runHooks('pr list');
  const st = (flag('--state') || 'open').toLowerCase();
  let list = newestFirst();
  if (flag('--head')) list = list.filter((p) => p.headRefName === flag('--head'));
  if (st !== 'all') list = list.filter((p) => p.state.toLowerCase() === st);
  out(JSON.stringify(list.map((p) => pick(refresh(p), flag('--json') || 'number'))));
}
if (args[0] === 'run' && args[1] === 'list') out(JSON.stringify(state.runs));
fail('fake gh: unsupported call: ' + args.join(' '));
`;

let root;
let origin;
let clones;
let env;
let ghState;
// The CLI's clock for `started:` dates is pinned, so a run across midnight cannot flake.
const TODAY = '2026-10-06';

function git(cwd, args) {
  const res = spawnSync('git', args, { cwd, env, encoding: 'utf8', windowsHide: true });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}:\n${res.stdout}${res.stderr}`);
  return res.stdout;
}

function coord(actor, args, { cwd, extraEnv } = {}) {
  const res = spawnSync(process.execPath, [COORD, ...args], {
    cwd: cwd || clones[actor],
    env: { ...env, COORD_LOGIN: LOGINS[actor], FAKE_GH_LOGIN: LOGINS[actor], ...(extraEnv || {}) },
    encoding: 'utf8',
    windowsHide: true,
  });
  return { code: res.status, out: `${res.stdout}${res.stderr}`, stdout: res.stdout };
}

function coordAsync(actor, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [COORD, ...args], {
      cwd: clones[actor],
      env: { ...env, COORD_LOGIN: LOGINS[actor], FAKE_GH_LOGIN: LOGINS[actor] },
      windowsHide: true,
    });
    let text = '';
    child.stdout.on('data', (d) => { text += d; });
    child.stderr.on('data', (d) => { text += d; });
    child.on('close', (code) => resolve({ code, out: text }));
  });
}

const readGh = () => JSON.parse(fs.readFileSync(ghState, 'utf8'));
const writeGh = (patch) => fs.writeFileSync(ghState, JSON.stringify({ ...readGh(), ...patch }, null, 2));
const remoteBranches = () => git(origin, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']).split('\n').filter(Boolean);
const showOrigin = (ref, file) => git(clones.malede, ['show', `origin/${ref}:${file}`]);
const worktreeOf = (actor, branch) => path.join(clones[actor], `.worktree-${branch.replace(/\//g, '-')}`);

function write(dir, rel, text) {
  const p = path.join(dir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, 'utf8');
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'coord e2e '));
  expect(root).toMatch(/ /);
  const emptyConfig = path.join(root, 'empty gitconfig');
  fs.writeFileSync(emptyConfig, '');
  ghState = path.join(root, 'gh state.json');
  fs.writeFileSync(ghState, JSON.stringify({ next: 300, prs: [], runs: [{ status: 'completed' }], calls: [] }, null, 2));
  const fakeGh = path.join(root, 'fake gh.js');
  fs.writeFileSync(fakeGh, FAKE_GH);

  env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(GIT_|COORD_)/.test(k)) delete env[k];
  Object.assign(env, {
    GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    COORD_GH: fakeGh,
    FAKE_GH_STATE: ghState,
    COORD_TODAY: TODAY,
  });

  origin = path.join(root, 'origin.git');
  git(root, ['-c', 'init.defaultBranch=main', 'init', '--bare', origin]);

  const seed = path.join(root, 'seed');
  git(root, ['-c', 'init.defaultBranch=main', 'clone', origin, seed]);
  git(seed, ['config', 'user.name', AUTHORS.malede[0]]);
  git(seed, ['config', 'user.email', AUTHORS.malede[1]]);
  write(seed, '.gitignore', '.worktree-*/\n');
  write(seed, '.github/workflows/ci.yml', 'name: ci\non: [push]\njobs: {}\n');
  write(seed, 'backend/tests/ciWorkflowPermissions.test.js', "// reads .github/workflows/ci.yml and pins its permissions\nrequire('fs').readFileSync('ci.yml');\n");
  write(seed, 'backend/tests/secretScanGates.test.js', '// pins the secret scan gates\n');
  write(seed, 'backend/app/index.js', 'module.exports = {};\n');
  write(seed, 'TASKS.md', TASKS);
  write(seed, 'WORK_LEDGER.md', SEED_LEDGER);
  git(seed, ['add', '-A']);
  git(seed, ['commit', '-m', 'chore: seed']);
  git(seed, ['push', 'origin', 'HEAD:refs/heads/main']);

  clones = { seed };
  for (const actor of ['malede', 'bedrack']) {
    const dir = path.join(root, actor);
    git(root, ['clone', origin, dir]);
    git(dir, ['config', 'user.name', AUTHORS[actor][0]]);
    git(dir, ['config', 'user.email', AUTHORS[actor][1]]);
    clones[actor] = dir;
  }
});

afterAll(() => {
  if (!root) return;
  for (const actor of ['malede', 'bedrack']) {
    try { git(clones[actor], ['worktree', 'prune']); } catch { /* best effort */ }
  }
  fs.rmSync(root, { recursive: true, force: true });
});

describe('OPS-152 · coordinator end to end', () => {
  test('--help prints the usage and needs no git at all', () => {
    const res = coord('malede', ['--help'], { cwd: root });
    expect(res.code).toBe(0);
    expect(res.out).toMatch(/usage/i);
    for (const cmd of ['check', 'start', 'status', 'ship', 'rescope', 'release', 'ci']) expect(res.out).toMatch(new RegExp(`\\b${cmd}\\b`));
  });

  test('an unknown login cannot verify anything → exit 2', () => {
    // gh and COORD_LOGIN agree, so the only thing wrong is the login itself
    const res = coord('malede', ['check', '--paths', 'a/b/c.js'], { extraEnv: { COORD_LOGIN: 'SomeoneElse', FAKE_GH_LOGIN: 'SomeoneElse' } });
    expect(res.code).toBe(2);
    expect(res.out).toMatch(/@SomeoneElse/);
    expect(res.out).toMatch(/not in the People table/);
  });

  test('N18 · credentials in a remote URL never reach the output', () => {
    const { redact } = require(COORD);
    expect(redact("fatal: unable to access 'https://user:s3cret@github.com/x.git/'")).toBe("fatal: unable to access 'https://***@github.com/x.git/'");
    const leaky = path.join(root, 'leaky');
    git(root, ['clone', origin, leaky]);
    git(leaky, ['remote', 'set-url', 'origin', 'https://user:s3cret@127.0.0.1:9/nope.git']);
    const res = coord('malede', ['check', '--paths', 'a/b/c.js'], { cwd: leaky });
    expect(res.code).toBe(2);
    expect(res.out).not.toMatch(/s3cret/);
  });

  test('a fetch that fails means "cannot verify" → exit 2, never a decision on stale refs', () => {
    const broken = path.join(root, 'broken');
    git(root, ['clone', origin, broken]);
    git(broken, ['remote', 'set-url', 'origin', path.join(root, 'no such origin.git')]);
    const res = coord('malede', ['check', '--paths', 'a/b/c.js'], { cwd: broken });
    expect(res.code).toBe(2);
    expect(res.out).toMatch(/fetch/i);
  });

  test('a path too broad to claim is refused → exit 1', () => {
    const res = coord('malede', ['check', '--paths', 'backend/**']);
    expect(res.code).toBe(1);
    expect(res.out).toMatch(/too broad/);

    // N2: a branch name outside the plain character set is refused before anything happens
    for (const bad of ['feat/a b', 'feat/a`b', 'feat/a,b', 'feat/a b']) {
      const st = coord('malede', ['start', '--task', 'own:x', '--title', 'x', '--paths', 'docs/x/y.md', '--branch', bad]);
      expect({ bad, code: st.code }).toEqual({ bad, code: 1 });
      expect(st.out).toMatch(/not a branch name start can use/);
    }
    expect(remoteBranches()).toEqual(['main']);
  });

  test('start with gh unusable stops before any side effect → exit 2', () => {
    writeGh({ broken: true });
    try {
      const res = coord('bedrack', ['start', '--task', 'own:nothing', '--title', 'x', '--paths', 'docs/x/y.md', '--branch', 'feat/never']);
      expect(res.code).toBe(2);
      expect(res.out).toMatch(/gh/);
    } finally {
      writeGh({ broken: false });
    }
    expect(remoteBranches()).toEqual(['main']);
    expect(fs.existsSync(worktreeOf('bedrack', 'feat/never'))).toBe(false);
  });

  test('N3 · gh pr list failing means "cannot verify" for check and start → exit 2, nothing changed', () => {
    writeGh({ failPrList: true });
    try {
      const chk = coord('malede', ['check', '--paths', 'a/b/c.js']);
      expect(chk.code).toBe(2);
      expect(chk.out).toMatch(/pr list/);
      const st = coord('bedrack', ['start', '--task', 'own:nolist', '--title', 'x', '--paths', 'docs/x/y.md', '--branch', 'feat/nolist']);
      expect(st.code).toBe(2);
    } finally {
      writeGh({ failPrList: false });
    }
    expect(remoteBranches()).toEqual(['main']);
  });

  test('COORD_LOGIN and the signed-in gh user disagree → exit 2, naming both', () => {
    const res = coord('malede', ['check', '--paths', 'a/b/c.js'], { extraEnv: { FAKE_GH_LOGIN: 'DanielBedrack' } });
    expect(res.code).toBe(2);
    expect(res.out).toMatch(/DanielMalede/);
    expect(res.out).toMatch(/DanielBedrack/);
  });

  test('a shallow clone cannot see every branch\'s history → exit 2', () => {
    const shallow = path.join(root, 'shallow');
    const url = process.platform === 'win32' ? `file:///${origin.replace(/\\/g, '/')}` : `file://${origin}`;
    git(root, ['clone', '--depth', '1', url, shallow]);
    const res = coord('malede', ['check', '--paths', 'a/b/c.js'], { cwd: shallow });
    expect(res.code).toBe(2);
    expect(res.out).toMatch(/shallow/);
  });

  test('a start that holds the lock stops another start → exit 2, nothing changed', () => {
    const lock = path.join(clones.bedrack, '.git', 'coord.lock');
    fs.writeFileSync(lock, 'held by a running start');
    try {
      const res = coord('bedrack', ['start', '--task', 'own:locked', '--title', 'x', '--paths', 'docs/x/y.md', '--branch', 'feat/locked']);
      expect(res.code).toBe(2);
      expect(res.out).toMatch(/another start is running/);
    } finally {
      fs.rmSync(lock, { force: true });
    }
    expect(remoteBranches()).toEqual(['main']);
  });

  test('1 · Bedrack claims the Project Explorer work → CLEAR, slot B01, pushed, draft PR', () => {
    // a lock left by a run that died 20 minutes ago is stale: taken over, and released at the end
    const lock = path.join(clones.bedrack, '.git', 'coord.lock');
    fs.writeFileSync(lock, 'left by a dead run');
    const old = new Date(Date.now() - 20 * 60 * 1000);
    fs.utimesSync(lock, old, old);
    const res = coord('bedrack', [
      'start', '--task', 'own:project-explorer-ci', '--title', 'Restore the private Project Explorer with CI',
      '--paths', 'project-explorer/app.js,.github/workflows/ci.yml,backend/tests/ciWorkflowPermissions.test.js,AGENTS.md',
      '--branch', 'feat/project-explorer-ci',
    ]);
    expect(res.out).toMatch(/B01/);
    expect(res.code).toBe(0);
    expect(remoteBranches()).toContain('feat/project-explorer-ci');

    git(clones.malede, ['fetch', 'origin']);
    const ledger = showOrigin('feat/project-explorer-ci', 'WORK_LEDGER.md');
    expect(ledger).toMatch(/### B01\n- task: `own:project-explorer-ci` \(own\)\n- title: Restore the private Project Explorer with CI\n- branch: `feat\/project-explorer-ci`\n/);
    expect(ledger).toMatch(new RegExp(`- state: claimed\\n- started: ${TODAY}\\n`));

    const subject = git(clones.malede, ['log', '-1', '--format=%B', 'origin/feat/project-explorer-ci']);
    expect(subject).toBe('chore: claim own:project-explorer-ci [skip ci]\n\n');
    const changed = git(clones.malede, ['diff', '--name-only', 'origin/main', 'origin/feat/project-explorer-ci']).trim();
    expect(changed).toBe('WORK_LEDGER.md');

    const pr = readGh().prs.find((p) => p.headRefName === 'feat/project-explorer-ci');
    expect(pr).toMatchObject({ isDraft: true, baseRefName: 'main', title: 'own:project-explorer-ci: Restore the private Project Explorer with CI', author: { login: 'DanielBedrack' } });
    expect(pr.body).toMatch(/Claimed with scripts\/coord\/coord\.js/);
    expect(pr.body).toMatch(/B01/);
    expect(pr.body).not.toMatch(/claude|anthropic|generated with|co-authored|\bAI\b/i);
    expect(res.out).toMatch(/https:\/\/github\.example\/pull\/\d+/);
    expect(fs.existsSync(worktreeOf('bedrack', 'feat/project-explorer-ci'))).toBe(true);
    expect(fs.existsSync(lock)).toBe(false);

    // he then does the work: the workflow changes on his branch
    const wt = worktreeOf('bedrack', 'feat/project-explorer-ci');
    write(wt, '.github/workflows/ci.yml', 'name: ci\non: [push, pull_request]\njobs: {}\n');
    git(wt, ['commit', '-am', 'feat: project explorer job']);
    git(wt, ['push', 'origin', 'HEAD']);
  });

  test('1b · re-running the same start resumes instead of claiming twice', () => {
    const before = readGh().prs.length;
    const res = coord('bedrack', [
      'start', '--task', 'own:project-explorer-ci', '--title', 'Restore the private Project Explorer with CI',
      '--paths', 'project-explorer/app.js,.github/workflows/ci.yml,backend/tests/ciWorkflowPermissions.test.js,AGENTS.md',
      '--branch', 'feat/project-explorer-ci',
    ]);
    expect(res.code).toBe(0);
    expect(res.out).toMatch(/B01/);
    expect(readGh().prs.length).toBe(before);
    git(clones.malede, ['fetch', 'origin']);
    const ledgerCommits = git(clones.malede, ['log', '--format=%s', 'origin/main..origin/feat/project-explorer-ci', '--', 'WORK_LEDGER.md']).trim().split('\n');
    expect(ledgerCommits).toEqual(['chore: claim own:project-explorer-ci [skip ci]']);
  });

  test('1c · ci on his claimed branch passes', () => {
    const res = coord('bedrack', ['ci', '--branch', 'feat/project-explorer-ci', '--author', 'DanielBedrack']);
    expect(res.out).toMatch(/CLEAR/);
    expect(res.code).toBe(0);
  });

  test('2 · Malede\'s check on the workflow HALTs, naming his branch, the file and the exclusive row', () => {
    const res = coord('malede', ['check', '--paths', '.github/workflows/ci.yml,backend/tests/secretScanGates.test.js']);
    expect(res.code).toBe(1);
    expect(res.out).toMatch(/HALT/);
    expect(res.out).toMatch(/Bedrack/);
    expect(res.out).toMatch(/feat\/project-explorer-ci/);
    expect(res.out).toMatch(/B01/);
    expect(res.out).toMatch(/\.github\/workflows\/ci\.yml/);
    expect(res.out).toMatch(/exclusive group/);

    const json = JSON.parse(coord('malede', ['check', '--paths', '.github/workflows/ci.yml', '--json']).stdout);
    expect(json.verdict).toBe('HALT');
    expect(json.reasons.map((r) => r.class)).toEqual(expect.arrayContaining(['exact', 'exclusive group']));
  });

  test('3 · Malede claims two disjoint tasks → M01 (the landed seed slot is reused) and M02', () => {
    const a = coord('malede', ['start', '--task', 'BE-001', '--title', 'Alpha works', '--paths', 'backend/app/services/alpha.js', '--branch', 'fix/be001-alpha']);
    expect(a.out).toMatch(/M01/);
    expect(a.code).toBe(0);
    const b = coord('malede', ['start', '--task', 'own:docs-notes', '--title', 'Notes on the coordinator', '--paths', 'docs/notes/coord.md', '--branch', 'docs/notes']);
    expect(b.out).toMatch(/M02/);
    expect(b.code).toBe(0);

    git(clones.malede, ['fetch', 'origin']);
    const tasks = showOrigin('fix/be001-alpha', 'TASKS.md');
    const lines = tasks.split('\n');
    const row = lines.findIndex((l) => l.startsWith('- [ ] `BE-001`'));
    expect(lines[row + 1]).toBe(`  - status: taken by Malede (@DanielMalede) on branch \`fix/be001-alpha\` since ${TODAY}, ledger slot M01`);
    expect(lines[row + 2]).toMatch(/^ {2}- where:/);
    expect(git(clones.malede, ['diff', '--name-only', 'origin/main', 'origin/fix/be001-alpha']).trim().split('\n').sort()).toEqual(['TASKS.md', 'WORK_LEDGER.md']);
    expect(git(clones.malede, ['diff', '--name-only', 'origin/main', 'origin/docs/notes']).trim()).toBe('WORK_LEDGER.md');
    expect(showOrigin('docs/notes', 'WORK_LEDGER.md')).toMatch(/### M02\n- task: `own:docs-notes` \(own\)/);
  });

  test('3b · --dry-run names the slot it would take and changes nothing', () => {
    const res = coord('malede', ['start', '--task', 'own:dry', '--title', 'Dry', '--paths', 'docs/dry/run.md', '--branch', 'docs/dry', '--dry-run']);
    expect(res.code).toBe(0);
    expect(res.out).toMatch(/M03/);
    expect(remoteBranches()).not.toContain('docs/dry');
    expect(git(clones.malede, ['branch', '--list', 'docs/dry']).trim()).toBe('');
  });

  test('4 · his PR squash-merges; main merges into both of Malede\'s branches cleanly; the check is now CLEAR', () => {
    const seed = clones.seed;
    git(seed, ['fetch', 'origin']);
    git(seed, ['checkout', '-B', 'main', 'origin/main']);
    git(seed, ['merge', '--squash', 'origin/feat/project-explorer-ci']);
    git(seed, ['commit', '-m', 'feat: restore the private Project Explorer with CI (#300)']);
    git(seed, ['push', 'origin', 'main']);
    git(seed, ['push', 'origin', '--delete', 'feat/project-explorer-ci']);
    const gh = readGh();
    gh.prs.find((p) => p.headRefName === 'feat/project-explorer-ci').state = 'MERGED';
    fs.writeFileSync(ghState, JSON.stringify(gh, null, 2));

    for (const branch of ['fix/be001-alpha', 'docs/notes']) {
      const wt = worktreeOf('malede', branch);
      git(wt, ['fetch', 'origin']);
      const res = spawnSync('git', ['merge', '--no-edit', 'origin/main'], { cwd: wt, env, encoding: 'utf8' });
      expect({ branch, code: res.status, out: res.stdout + res.stderr }).toMatchObject({ code: 0 });
      const ledger = fs.readFileSync(path.join(wt, 'WORK_LEDGER.md'), 'utf8');
      expect(ledger).toMatch(/### B01\n- task: `own:project-explorer-ci`/);
      git(wt, ['push', 'origin', 'HEAD']);
    }

    const res = coord('malede', ['check', '--paths', '.github/workflows/ci.yml,backend/tests/secretScanGates.test.js']);
    expect(res.out).toMatch(/CLEAR/);
    expect(res.code).toBe(0);

    // his own claims survived the merge of main: both still live, still his
    const status = coord('malede', ['status']);
    expect(status.code).toBe(0);
    expect(status.out).toMatch(/fix\/be001-alpha/);
    expect(status.out).toMatch(/docs\/notes/);
  });

  test('4b · ship marks the slot in review; rescope replaces the paths; release only prints', () => {
    const notes = worktreeOf('malede', 'docs/notes');
    const ship = coord('malede', ['ship'], { cwd: notes });
    expect(ship.code).toBe(0);
    const pr = readGh().prs.find((p) => p.headRefName === 'docs/notes');
    git(clones.malede, ['fetch', 'origin']);
    expect(showOrigin('docs/notes', 'WORK_LEDGER.md')).toMatch(new RegExp(`### M02\\n(?:.*\\n){5}- state: in-review · PR #${pr.number}\\n`));
    expect(git(clones.malede, ['log', '-1', '--format=%s', 'origin/docs/notes']).trim()).toBe('chore: own:docs-notes in review');

    const alpha = worktreeOf('malede', 'fix/be001-alpha');
    const rescope = coord('malede', ['rescope', '--paths', 'backend/app/services/alpha.js,backend/app/services/alpha2.js'], { cwd: alpha });
    expect(rescope.code).toBe(0);
    git(clones.malede, ['fetch', 'origin']);
    expect(showOrigin('fix/be001-alpha', 'WORK_LEDGER.md')).toMatch(/- paths: `backend\/app\/services\/alpha\.js`, `backend\/app\/services\/alpha2\.js`\n/);
    expect(git(clones.malede, ['log', '-1', '--format=%s', 'origin/fix/be001-alpha']).trim()).toBe('chore: rescope BE-001');

    const release = coord('malede', ['release'], { cwd: notes });
    expect(release.code).toBe(0);
    expect(release.out).toMatch(new RegExp(`gh pr close ${pr.number} --delete-branch`));
    expect(release.out).toMatch(/git worktree remove/);
    expect(remoteBranches()).toContain('docs/notes');

    // the partner cannot release Malede's branch
    const foreign = path.join(root, 'bedrack-on-notes');
    git(clones.bedrack, ['fetch', 'origin']);
    git(clones.bedrack, ['worktree', 'add', '-b', 'docs/notes', foreign, 'origin/docs/notes']);
    const refused = coord('bedrack', ['release'], { cwd: foreign });
    expect(refused.code).toBe(1);
    expect(refused.out).toMatch(/not yours|Malede/);
  });

  test('4c · check --merge: only your own PR, never during a deploy, and a heads-up for him', () => {
    const mine = readGh().prs.find((p) => p.headRefName === 'docs/notes');
    expect(coord('malede', ['check', '--merge', String(mine.number)]).code).toBe(0);

    writeGh({ runs: [{ status: 'completed' }, { status: 'in_progress' }] });
    const busy = coord('malede', ['check', '--merge', String(mine.number)]);
    writeGh({ runs: [{ status: 'completed' }] });
    expect(busy.code).toBe(1);
    expect(busy.out).toMatch(/a deploy is in flight — wait/);

    const his = readGh().prs.find((p) => p.headRefName === 'feat/project-explorer-ci');
    const notMine = coord('malede', ['check', '--merge', String(his.number)]);
    expect(notMine.code).toBe(1);
    expect(notMine.out).toMatch(/merge only your own PRs/);
  });

  test('5 · a branch that declares project-explorer/src/** but changes backend/app/index.js fails ci (drift)', () => {
    const res = coord('bedrack', ['start', '--task', 'own:pe-src', '--title', 'Explorer sources', '--paths', 'project-explorer/src/**', '--branch', 'feat/pe-src']);
    expect(res.code).toBe(0);
    expect(res.out).toMatch(/B01/); // his landed slot is reusable now that its branch is gone
    const wt = worktreeOf('bedrack', 'feat/pe-src');
    write(wt, 'project-explorer/src/app.js', 'export {};\n');
    write(wt, 'backend/app/index.js', 'module.exports = { changed: true };\n');
    git(wt, ['add', '-A']);
    git(wt, ['commit', '-m', 'feat: explorer sources']);
    git(wt, ['push', 'origin', 'HEAD']);

    const ci = coord('bedrack', ['ci', '--branch', 'feat/pe-src', '--author', 'DanielBedrack']);
    expect(ci.code).toBe(1);
    expect(ci.out).toMatch(/drift/);
    expect(ci.out).toMatch(/backend\/app\/index\.js/);

    const warnOnly = coord('bedrack', ['ci', '--branch', 'feat/pe-src', '--author', 'DanielBedrack', '--mode', 'warn']);
    expect(warnOnly.code).toBe(3);

    // and his own branch's claim is clean for Malede's branches too
    expect(coord('malede', ['ci', '--branch', 'fix/be001-alpha', '--author', 'DanielMalede']).code).toBe(0);

    // a branch name main's ledger still records is never reused for new work
    const reuse = coord('bedrack', ['start', '--task', 'own:again', '--title', 'Again', '--paths', 'docs/again/x.md', '--branch', 'feat/project-explorer-ci']);
    expect(reuse.code).toBe(1);
    expect(reuse.out).toMatch(/recorded/);
    expect(remoteBranches()).not.toContain('feat/project-explorer-ci');
  });

  test('6 · both partners take the same TASKS row → the second one stops, with no side effects', () => {
    const first = coord('bedrack', ['start', '--task', 'BE-002', '--title', 'Beta works', '--paths', 'backend/app/services/beta.js', '--branch', 'fix/be002-beta']);
    expect(first.code).toBe(0);
    expect(first.out).toMatch(/B02/);

    const second = coord('malede', ['start', '--task', 'BE-002', '--title', 'Beta again', '--paths', 'backend/app/services/gamma.js', '--branch', 'fix/be002-gamma']);
    expect(second.code).toBe(1);
    expect(second.out).toMatch(/BE-002/);
    expect(second.out).toMatch(/fix\/be002-beta/);
    expect(remoteBranches()).not.toContain('fix/be002-gamma');
    expect(git(clones.malede, ['branch', '--list', 'fix/be002-gamma']).trim()).toBe('');
    expect(fs.existsSync(worktreeOf('malede', 'fix/be002-gamma'))).toBe(false);
  });

  test('6b · start never claims onto his branch — by name, or from a local checkout of it', () => {
    const tip = git(origin, ['rev-parse', 'refs/heads/fix/be002-beta']).trim();
    const args = ['start', '--task', 'own:onto', '--title', 'Onto', '--paths', 'docs/onto/x.md', '--branch', 'fix/be002-beta'];
    const byName = coord('malede', args);
    expect(byName.code).toBe(1);
    expect(byName.out).toMatch(/no claim of yours/);

    const m = clones.malede;
    git(m, ['fetch', 'origin']);
    git(m, ['checkout', '-B', 'fix/be002-beta', 'origin/fix/be002-beta']); // as `gh pr checkout` does
    const fromCheckout = coord('malede', args);
    git(m, ['checkout', '--detach']);
    expect(fromCheckout.code).toBe(1);
    expect(git(origin, ['rev-parse', 'refs/heads/fix/be002-beta']).trim()).toBe(tip);
  });

  test('7 · an UNCLAIMED recent branch touching the workflow still stops Malede, named as unclaimed', () => {
    const b = clones.bedrack;
    git(b, ['fetch', 'origin']);
    git(b, ['checkout', '-b', 'feat/sneaky', 'origin/main']);
    write(b, '.github/workflows/ci.yml', 'name: ci\non: [push]\njobs: { sneaky: {} }\n');
    git(b, ['add', '--', '.github/workflows/ci.yml']);
    git(b, ['commit', '-m', 'ci: a quick tweak']);
    git(b, ['push', 'origin', 'feat/sneaky']);

    // Malede's own unclaimed branch on the same file, committed under his local identity
    const m = clones.malede;
    git(m, ['fetch', 'origin']);
    git(m, ['checkout', '-b', 'fix/own-tweak', 'origin/main']);
    write(m, '.github/workflows/ci.yml', 'name: ci\non: [push]\njobs: { own: {} }\n');
    git(m, ['add', '--', '.github/workflows/ci.yml']);
    git(m, ['-c', 'user.name=Daniel', '-c', 'user.email=danielmalede@gmail.com', 'commit', '-m', 'ci: own tweak']);
    git(m, ['push', 'origin', 'fix/own-tweak']);
    git(m, ['checkout', '--detach']);

    const res = coord('malede', ['check', '--paths', '.github/workflows/ci.yml']);
    expect(res.code).toBe(1);
    expect(res.out).toMatch(/feat\/sneaky/);
    expect(res.out).toMatch(/unclaimed/);
    expect(res.out).toMatch(/Bedrack/);
    expect(res.out).not.toMatch(/fix\/own-tweak/); // his own branch is never his collision
    expect(res.out).not.toMatch(/owner unknown/);

    const his = coord('bedrack', ['check', '--paths', '.github/workflows/ci.yml']);
    expect(his.code).toBe(1);
    expect(his.out).toMatch(/Malede \(@DanielMalede\): unclaimed recent branch fix\/own-tweak/);
    expect(his.out).not.toMatch(/feat\/sneaky/);

    const status = coord('malede', ['status']);
    expect(status.code).toBe(0);
    expect(status.out).toMatch(/Malede/);
    expect(status.out).toMatch(/Bedrack/);
    expect(status.out).toMatch(/feat\/sneaky/);
    expect(status.out).toMatch(/feat\/pe-src/);
    // drift is visible in status too
    expect(status.out).toMatch(/backend\/app\/index\.js/);
  });

  test('7b · his work stays visible from a local checkout of his branch; unmapped and old-dated branches still stop me', () => {
    const m = clones.malede;
    git(m, ['fetch', 'origin']);
    git(m, ['checkout', '-B', 'feat/sneaky', 'origin/feat/sneaky']); // as `gh pr checkout` does
    const fromHis = coord('malede', ['check', '--paths', '.github/workflows/ci.yml']);
    git(m, ['checkout', '--detach']);
    expect(fromHis.code).toBe(1);
    expect(fromHis.out).toMatch(/Bedrack \(@DanielBedrack\): unclaimed recent branch feat\/sneaky/);

    const b = clones.bedrack;
    git(b, ['fetch', 'origin']);
    git(b, ['checkout', '-B', 'feat/odd', 'origin/main']);
    write(b, 'AGENTS.md', '# agents\n');
    git(b, ['add', '--', 'AGENTS.md']);
    git(b, ['-c', 'user.name=Build Bot', '-c', 'user.email=bot@example.com', 'commit', '-m', 'docs: agents']);
    git(b, ['push', 'origin', 'feat/odd']);
    git(b, ['checkout', '-B', 'feat/old-dates', 'origin/main']);
    write(b, 'docs/old/x.md', 'old\n');
    git(b, ['add', '--', 'docs/old/x.md']);
    const old = new Date(Date.now() - 40 * 86400000).toISOString();
    const commit = spawnSync('git', ['commit', '-m', 'docs: old'], { cwd: b, env: { ...env, GIT_AUTHOR_DATE: old, GIT_COMMITTER_DATE: old }, encoding: 'utf8' });
    expect(commit.status).toBe(0);
    git(b, ['push', 'origin', 'feat/old-dates']);
    git(b, ['checkout', '--detach']);

    // an author nobody can map: fail closed
    const unknown = coord('malede', ['check', '--paths', 'AGENTS.md']);
    expect(unknown.code).toBe(1);
    expect(unknown.out).toMatch(/owner unknown/);
    expect(unknown.out).toMatch(/feat\/odd/);
    expect(unknown.out).toMatch(/WORK_LEDGER\.md/);

    // once gh shows his open PR for it, the PR author names him
    const state = readGh();
    state.prs.push({ number: 450, title: 'agents', body: '', headRefName: 'feat/odd', baseRefName: 'main', isDraft: false, state: 'OPEN', author: { login: 'DanielBedrack' }, url: 'https://github.example/pull/450' });
    fs.writeFileSync(ghState, JSON.stringify(state, null, 2));
    const named = coord('malede', ['check', '--paths', 'AGENTS.md']);
    expect(named.code).toBe(1);
    expect(named.out).toMatch(/Bedrack \(@DanielBedrack\): unclaimed recent branch feat\/odd/);
    expect(named.out).not.toMatch(/owner unknown/);

    // commits dated 40 days ago, pushed today: still recent work
    const oldDated = coord('malede', ['check', '--paths', 'docs/old/x.md']);
    expect(oldDated.code).toBe(1);
    expect(oldDated.out).toMatch(/feat\/old-dates/);
  });

  test('8 · check --merge on a PR whose files meet his live work → WARN that he will need main merged in', () => {
    const alpha = worktreeOf('malede', 'fix/be001-alpha');
    write(alpha, 'backend/app/index.js', 'module.exports = { alpha: true };\n');
    git(alpha, ['commit', '-am', 'fix: alpha wiring']);
    git(alpha, ['push', 'origin', 'HEAD']);
    const pr = readGh().prs.find((p) => p.headRefName === 'fix/be001-alpha');

    const res = coord('malede', ['check', '--merge', String(pr.number)]);
    expect(res.code).toBe(3);
    expect(res.out).toMatch(/feat\/pe-src/);
    expect(res.out).toMatch(/backend\/app\/index\.js/);
    expect(res.out).toMatch(/he will need main merged in after this lands/);
  });

  test('9 · two overlapping claims (a race): on real commit times the earlier claim wins in ci, the later fails', () => {
    // Malede's claim of beta.js lands AFTER Bedrack's (step 6), as if both had passed check at once.
    const { setSlot } = require(path.join(REPO_ROOT, 'scripts', 'coord', 'lib', 'ledger.js'));
    const dir = path.join(root, 'malede race');
    git(clones.malede, ['fetch', 'origin']);
    git(clones.malede, ['worktree', 'add', '--no-track', '-b', 'fix/race', dir, 'origin/main']);
    const ledgerPath = path.join(dir, 'WORK_LEDGER.md');
    fs.writeFileSync(ledgerPath, setSlot(fs.readFileSync(ledgerPath, 'utf8'), 'M03', {
      task: 'own:race', taskKind: 'own', title: 'Raced claim', branch: 'fix/race', paths: ['backend/app/services/beta.js'],
      resources: [], state: 'claimed', pr: null, started: TODAY,
    }));
    git(dir, ['add', '--', 'WORK_LEDGER.md']);
    const later = new Date(Date.now() + 120000).toISOString();
    const res = spawnSync('git', ['commit', '-m', 'chore: claim own:race [skip ci]'], {
      cwd: dir, env: { ...env, GIT_COMMITTER_DATE: later, GIT_AUTHOR_DATE: later }, encoding: 'utf8',
    });
    expect(res.status).toBe(0);
    git(dir, ['push', 'origin', 'fix/race:refs/heads/fix/race']);

    const loser = coord('malede', ['ci', '--branch', 'fix/race', '--author', 'DanielMalede']);
    expect(loser.code).toBe(1);
    expect(loser.out).toMatch(/overlap/);
    expect(loser.out).toMatch(/fix\/be002-beta/);
    expect(loser.out).toMatch(/committed first/);

    const winner = coord('bedrack', ['ci', '--branch', 'fix/be002-beta', '--author', 'DanielBedrack']);
    expect(winner.out).toMatch(/CLEAR/);
    expect(winner.code).toBe(0);

    // and each side's check sees the other: Bedrack's check on beta.js now names Malede's claim
    const seen = coord('bedrack', ['check', '--paths', 'backend/app/services/beta.js']);
    expect(seen.code).toBe(1);
    expect(seen.out).toMatch(/Malede/);
    expect(seen.out).toMatch(/fix\/race/);
  });

  test('10 · finished work drops out: a squash-merged branch left on origin, and a branch whose PR is closed', () => {
    const b = clones.bedrack;
    git(b, ['fetch', 'origin']);
    for (const [branch, file] of [['feat/tiny', 'docs/tiny/a.md'], ['feat/dropped', 'docs/dropped/a.md']]) {
      git(b, ['checkout', '-B', branch, 'origin/main']);
      write(b, file, `${branch}\n`);
      git(b, ['add', '--', file]);
      git(b, ['commit', '-m', `docs: ${branch}`]);
      git(b, ['push', 'origin', branch]);
    }
    git(b, ['checkout', '--detach']);
    const halted = coord('malede', ['check', '--paths', 'docs/tiny/a.md,docs/dropped/a.md']);
    expect(halted.code).toBe(1);
    expect(halted.out).toMatch(/feat\/tiny/);
    expect(halted.out).toMatch(/feat\/dropped/);

    // feat/tiny squash-merges and its branch is NOT deleted; feat/dropped's PR is closed unmerged
    const seed = clones.seed;
    git(seed, ['fetch', 'origin']);
    git(seed, ['checkout', '-B', 'main', 'origin/main']);
    git(seed, ['merge', '--squash', 'origin/feat/tiny']);
    git(seed, ['commit', '-m', 'docs: tiny (#400)']);
    git(seed, ['push', 'origin', 'main']);
    const state = readGh();
    state.prs.push({
      number: 401, title: 'dropped', body: '', headRefName: 'feat/dropped', baseRefName: 'main', isDraft: false, state: 'CLOSED',
      author: { login: 'DanielBedrack' }, url: 'https://github.example/pull/401', files: [{ path: 'docs/dropped/a.md' }],
      headRefOid: git(seed, ['rev-parse', 'origin/feat/dropped']).trim(),
    });
    fs.writeFileSync(ghState, JSON.stringify(state, null, 2));

    const clear = coord('malede', ['check', '--paths', 'docs/tiny/a.md,docs/dropped/a.md']);
    expect(clear.out).toMatch(/CLEAR/);
    expect(clear.code).toBe(0);
    expect(remoteBranches()).toEqual(expect.arrayContaining(['feat/tiny', 'feat/dropped']));

    // status leaves both out too
    expect(coord('malede', ['status']).out).not.toMatch(/feat\/tiny|feat\/dropped/);

    // a rename counts as BOTH paths: the old name is still touched
    git(b, ['fetch', 'origin']);
    git(b, ['checkout', '-B', 'feat/rename', 'origin/main']);
    git(b, ['mv', 'docs/tiny/a.md', 'docs/tiny/b.md']);
    git(b, ['commit', '-m', 'docs: rename']);
    git(b, ['push', 'origin', 'feat/rename']);
    git(b, ['checkout', '--detach']);
    const renamed = coord('malede', ['check', '--paths', 'docs/tiny/a.md']);
    expect(renamed.code).toBe(1);
    expect(renamed.out).toMatch(/feat\/rename/);
  });

  test('11 · a real race: his claim lands between my check and my push → HALT after the push, saying what exists; no PR', () => {
    const { setSlot } = require(path.join(REPO_ROOT, 'scripts', 'coord', 'lib', 'ledger.js'));
    const b = clones.bedrack;
    git(b, ['fetch', 'origin']);
    const dir = path.join(root, 'bedrack race');
    git(b, ['worktree', 'add', '--no-track', '-b', 'feat/race-b', dir, 'origin/main']);
    const ledgerPath = path.join(dir, 'WORK_LEDGER.md');
    fs.writeFileSync(ledgerPath, setSlot(fs.readFileSync(ledgerPath, 'utf8'), 'B03', {
      task: 'own:race-b', taskKind: 'own', title: 'His side of the race', branch: 'feat/race-b', paths: ['docs/race/x.md'],
      resources: [], state: 'claimed', pr: null, started: TODAY,
    }));
    git(dir, ['add', '--', 'WORK_LEDGER.md']);
    git(dir, ['commit', '-m', 'chore: claim own:race-b [skip ci]']);
    // his push lands the moment my start reads the PR list, i.e. after my fetch and before my push
    writeGh({ hooks: [{ on: 'pr list', cwd: dir, args: ['push', 'origin', 'feat/race-b:refs/heads/feat/race-b'] }] });

    const prsBefore = readGh().prs.length;
    const args = ['start', '--task', 'own:race-m', '--title', 'My side of the race', '--paths', 'docs/race/x.md', '--branch', 'docs/race-m'];
    const res = coord('malede', args);
    expect(res.code).toBe(1);
    expect(res.out).toMatch(/feat\/race-b/);
    expect(res.out).toMatch(/pushed/);
    expect(res.out).toMatch(/no PR was opened/);
    expect(res.out).toMatch(/git push origin --delete docs\/race-m/);
    expect(readGh().prs.length).toBe(prsBefore);
    expect(remoteBranches()).toEqual(expect.arrayContaining(['feat/race-b', 'docs/race-m'])); // nothing deleted for me

    // re-running the same start resumes onto MY pushed claim, stops at the check, and says what exists
    const again = coord('malede', args);
    expect(again.code).toBe(1);
    expect(again.out).not.toMatch(/nothing was changed/);
    expect(again.out).toMatch(/already exists/);
    expect(again.out).toMatch(/docs\/race-m/);
  });

  test('12 · two partners starting overlapping work at the same moment never both get CLEAR', async () => {
    const args = (who) => ['start', '--task', `own:par-${who}`, '--title', 'Parallel', '--paths', 'docs/par/x.md', '--branch', `docs/par-${who}`];
    const [m, b] = await Promise.all([coordAsync('malede', args('m')), coordAsync('bedrack', args('b'))]);
    expect({ m: m.code, b: b.code, out: m.code === 0 && b.code === 0 ? `${m.out}\n${b.out}` : '' }).toMatchObject({ out: '' });
    for (const r of [m, b]) expect([0, 1]).toContain(r.code);
  });

  test('13 · a relative --dir is resolved against the repository root, even when run from a subdirectory', () => {
    const res = coord('malede', ['start', '--task', 'own:subdir', '--title', 'From backend', '--paths', 'docs/subdir/x.md', '--branch', 'docs/subdir', '--dir', '.worktree-from-backend'], { cwd: path.join(clones.malede, 'backend') });
    expect(res.code).toBe(0);
    expect(fs.existsSync(path.join(clones.malede, '.worktree-from-backend', 'WORK_LEDGER.md'))).toBe(true);
    expect(fs.existsSync(path.join(clones.malede, 'backend', '.worktree-from-backend'))).toBe(false);
  });

  test('14 · N6 · --merge HALTs when my PR changes what his EARLIER live claim declared; WARNs when mine came first', () => {
    const later = path.join(clones.malede, '.worktree-from-backend'); // docs/subdir, claimed in step 13, after his B02 (step 6)
    write(later, 'backend/app/services/beta.js', 'module.exports = { beta: 1 };\n');
    git(later, ['add', '--', 'backend/app/services/beta.js']);
    git(later, ['commit', '-m', 'fix: beta tweak']);
    git(later, ['push', 'origin', 'HEAD']);
    const subdirPr = readGh().prs.find((p) => p.headRefName === 'docs/subdir');
    const halted = coord('malede', ['check', '--merge', String(subdirPr.number)]);
    expect(halted.code).toBe(1);
    expect(halted.out).toMatch(/merge-order/);
    expect(halted.out).toMatch(/fix\/be002-beta/);

    const alpha = worktreeOf('malede', 'fix/be001-alpha'); // claimed in step 3, before his B02
    write(alpha, 'backend/app/services/beta.js', 'module.exports = { beta: 2 };\n');
    git(alpha, ['add', '--', 'backend/app/services/beta.js']);
    git(alpha, ['commit', '-m', 'fix: beta from alpha']);
    git(alpha, ['push', 'origin', 'HEAD']);
    const alphaPr = readGh().prs.find((p) => p.headRefName === 'fix/be001-alpha');
    const warned = coord('malede', ['check', '--merge', String(alphaPr.number)]);
    expect(warned.code).toBe(3);
    expect(warned.out).toMatch(/needs-main/);
    expect(warned.out).not.toMatch(/merge-order/);
  });

  test('15 · N1 · a reused name whose old merged PR is Malede\'s belongs to whoever pushes to it now', () => {
    const state = readGh();
    state.prs.push({
      number: 480, title: 'old', body: '', headRefName: 'docs/reused', baseRefName: 'main', isDraft: false, state: 'MERGED',
      author: { login: 'DanielMalede' }, url: 'https://github.example/pull/480', files: [{ path: 'docs/old.md' }], headRefOid: '0'.repeat(40),
    });
    fs.writeFileSync(ghState, JSON.stringify(state, null, 2));
    const b = clones.bedrack;
    git(b, ['fetch', 'origin']);
    git(b, ['checkout', '-B', 'docs/reused', 'origin/main']);
    write(b, 'backend/app/services/alpha.js', 'module.exports = { his: true };\n');
    git(b, ['add', '--', 'backend/app/services/alpha.js']);
    git(b, ['commit', '-m', 'fix: alpha from him']);
    git(b, ['push', 'origin', 'docs/reused']);
    git(b, ['checkout', '--detach']);
    const res = coord('malede', ['check', '--paths', 'backend/app/services/alpha.js']);
    expect(res.code).toBe(1);
    expect(res.out).toMatch(/Bedrack \(@DanielBedrack\): unclaimed recent branch docs\/reused/);
  });

  test('16 · H3 · a single-branch clone still sees his branch; a missing merge-base cannot verify; N4 · a fresh clone says when recency rests on commit dates', () => {
    const single = path.join(root, 'single');
    git(root, ['clone', '--single-branch', '--branch', 'main', origin, single]);
    const res = coord('malede', ['check', '--paths', '.github/workflows/ci.yml'], { cwd: single });
    expect(res.code).toBe(1);
    expect(res.out).toMatch(/feat\/sneaky/);

    // in-process, with git.mergeBase forced to "no merge-base" on branches that share history
    const gitLib = require(path.join(REPO_ROOT, 'scripts', 'coord', 'lib', 'git.js'));
    const { main } = require(COORD);
    const savedEnv = { ...process.env };
    const spy = jest.spyOn(gitLib, 'mergeBase').mockReturnValue(null);
    const quiet = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    Object.assign(process.env, env, { COORD_LOGIN: 'DanielMalede', FAKE_GH_LOGIN: 'DanielMalede' });
    let thrown = null;
    try {
      main(['check', '--paths', '.github/workflows/ci.yml'], clones.malede);
    } catch (err) {
      thrown = err;
    } finally {
      spy.mockRestore();
      quiet.mockRestore();
      for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
      Object.assign(process.env, savedEnv);
    }
    expect(thrown && thrown.exitCode).toBe(2);
    expect(thrown.message).toMatch(/merge-base/);

    // a plain fresh clone has no reflog for origin's branches: feat/old-dates (40-day-old commits,
    // no open PR) cannot be seen there, and the output says so — the documented residual
    const fresh = path.join(root, 'fresh');
    git(root, ['clone', origin, fresh]);
    const noted = coord('malede', ['check', '--paths', 'docs/old/x.md'], { cwd: fresh });
    expect(noted.out).toMatch(/recency from commit dates only; a revived branch with old-dated commits and no open PR cannot be seen on a fresh clone/);
    expect(noted.out).not.toMatch(/feat\/old-dates/);
  });

  test('17 · M10 · a name whose only PR is CLOSED gets a NEW draft PR; L5 · --merge sees the 101st file of a PR', () => {
    const state = readGh();
    state.prs.push({
      number: 490, title: 'old closed', body: '', headRefName: 'docs/closed-name', baseRefName: 'main', isDraft: true, state: 'CLOSED',
      author: { login: 'DanielMalede' }, url: 'https://github.example/pull/490', files: [], headRefOid: '1'.repeat(40),
    });
    fs.writeFileSync(ghState, JSON.stringify(state, null, 2));
    const before = readGh().prs.length;
    const res = coord('malede', ['start', '--task', 'own:closed-name', '--title', 'Reusing a closed name', '--paths', 'docs/many/**', '--branch', 'docs/closed-name']);
    expect(res.code).toBe(0);
    expect(readGh().prs.length).toBe(before + 1);
    const fresh = readGh().prs.find((p) => p.headRefName === 'docs/closed-name' && p.state === 'OPEN');
    expect(fresh).toBeTruthy();
    expect(res.out).toContain(fresh.url);

    const wt = worktreeOf('malede', 'docs/closed-name');
    for (let i = 0; i < 100; i += 1) write(wt, `docs/many/f${String(i).padStart(3, '0')}.md`, `${i}\n`);
    write(wt, 'project-explorer/src/zz.js', 'export {};\n');
    git(wt, ['add', '-A']);
    git(wt, ['commit', '-m', 'docs: many files']);
    git(wt, ['push', 'origin', 'HEAD']);
    // the fake, like gh, cuts `pr view --json files` at 100: a 100-file view never reaches zz.js
    const viewed = spawnSync(process.execPath, [path.join(root, 'fake gh.js'), 'pr', 'view', String(fresh.number), '--json', 'files'], { cwd: wt, env, encoding: 'utf8' });
    expect(JSON.parse(viewed.stdout).files.map((f) => f.path)).not.toContain('project-explorer/src/zz.js');
    const merge = coord('malede', ['check', '--merge', String(fresh.number)]);
    expect(merge.out).toMatch(/project-explorer\/src\/zz\.js/);
    expect(merge.out).toMatch(/feat\/pe-src/);
  });

  test('18 · N5 · no git identity stops start before any side effect; a failed push leaves a claim the rerun completes', () => {
    const noident = path.join(root, 'no ident');
    git(root, ['clone', origin, noident]);
    const strict = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'user.useConfigOnly', GIT_CONFIG_VALUE_0: 'true' };
    const args = ['start', '--task', 'own:ident', '--title', 'Needs an identity', '--paths', 'docs/ident/x.md', '--branch', 'docs/ident'];
    const first = coord('malede', args, { cwd: noident, extraEnv: strict });
    expect(first.code).toBe(2);
    expect(first.out).toMatch(/identity/);
    expect(first.out).not.toMatch(/\n\s+at /); // a message, not a stack trace
    expect(remoteBranches()).not.toContain('docs/ident');
    expect(git(noident, ['branch', '--list', 'docs/ident']).trim()).toBe('');
    git(noident, ['config', 'user.name', AUTHORS.malede[0]]);
    git(noident, ['config', 'user.email', AUTHORS.malede[1]]);
    const second = coord('malede', args, { cwd: noident, extraEnv: strict });
    expect(second.code).toBe(0);
    expect(remoteBranches()).toContain('docs/ident');

    // the push fails (a pre-push hook refuses it): the claim stays committed locally, and running
    // the same start again pushes it and opens the PR
    const hooks = path.join(root, 'failing hooks');
    fs.mkdirSync(hooks, { recursive: true });
    fs.writeFileSync(path.join(hooks, 'pre-push'), '#!/bin/sh\nexit 1\n');
    fs.chmodSync(path.join(hooks, 'pre-push'), 0o755);
    git(clones.malede, ['config', 'core.hooksPath', hooks.replace(/\\/g, '/')]);
    const pargs = ['start', '--task', 'own:pushfail', '--title', 'Push fails once', '--paths', 'docs/pushfail/x.md', '--branch', 'docs/pushfail'];
    let failed;
    try {
      failed = coord('malede', pargs);
    } finally {
      git(clones.malede, ['config', '--unset', 'core.hooksPath']);
    }
    expect(failed.code).toBe(2);
    expect(failed.out).toMatch(/run the same start again/);
    expect(failed.out).not.toMatch(/git push -u/);
    expect(remoteBranches()).not.toContain('docs/pushfail');
    const rerun = coord('malede', pargs);
    expect(rerun.out).toMatch(/resumed/);
    expect(rerun.code).toBe(0);
    expect(remoteBranches()).toContain('docs/pushfail');
    expect(readGh().prs.some((p) => p.headRefName === 'docs/pushfail' && p.state === 'OPEN')).toBe(true);
  });

  test('19 · N11 · ship and rescope never re-create a branch that is gone from origin', () => {
    const notes = worktreeOf('malede', 'docs/notes');
    git(notes, ['push', 'origin', '--delete', 'docs/notes']);
    const pr = readGh().prs.find((p) => p.headRefName === 'docs/notes');
    const ship = coord('malede', ['ship', '--pr', String(pr.number)], { cwd: notes });
    expect(ship.code).toBe(1);
    expect(ship.out).toMatch(/does not exist on origin/);
    const rescope = coord('malede', ['rescope', '--paths', 'docs/notes/other.md'], { cwd: notes });
    expect(rescope.code).toBe(1);
    expect(remoteBranches()).not.toContain('docs/notes');
  });
});

describe('OPS-152 · coordinator before the ledger is on main', () => {
  test('a would-be CLEAR is a WARN carrying the note; a header row that does not parse cannot verify', () => {
    const bare = path.join(root, 'pre ledger.git');
    const dir = path.join(root, 'pre ledger');
    git(root, ['-c', 'init.defaultBranch=main', 'init', '--bare', bare]);
    git(root, ['clone', bare, dir]);
    git(dir, ['config', 'user.name', AUTHORS.malede[0]]);
    git(dir, ['config', 'user.email', AUTHORS.malede[1]]);
    write(dir, 'README.md', 'x\n');
    git(dir, ['add', '--', 'README.md']);
    git(dir, ['commit', '-m', 'chore: seed']);
    git(dir, ['push', 'origin', 'HEAD:refs/heads/main']);
    write(dir, 'WORK_LEDGER.md', SEED_LEDGER); // untracked: the rules can only come from this checkout

    const warn = coord('malede', ['check', '--paths', 'docs/a/b.md'], { cwd: dir });
    expect(warn.code).toBe(3);
    expect(warn.out).toMatch(/origin\/main has no WORK_LEDGER\.md/);

    write(dir, 'WORK_LEDGER.md', SEED_LEDGER.replace('| `AGENTS.md` | |', '| `AGENTS.md` | |\n| `../bad.md` | |'));
    const broken = coord('malede', ['check', '--paths', 'docs/a/b.md'], { cwd: dir });
    expect(broken.code).toBe(2);
    expect(broken.out).toMatch(/bad\.md/);
  });
});
