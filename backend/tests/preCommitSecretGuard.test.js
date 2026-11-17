'use strict';

// OPS-002 · .githooks/pre-commit — the secret-commit guard.
//
// The Android release keystore and keystore.properties, which holds the store and key passwords,
// sit in one checkout, and this hook is the last local check before a copy of either is committed.
// It let these through:
//   · by name: it refused a path ending in .keystore, .jks or .p12 and none named for
//     keystore.properties, so the file itself, a .bak copy, Explorer's "- Copy", a copy whose path
//     was flattened into its name, and a keystore with any suffix all passed;
//   · by status: --diff-filter=ACM drops a rename (R) and a type change (T), so `git mv` of the
//     tracked example to keystore.properties, filled in, passed both checks;
//   · by content: the scan it runs without gitleaks had no password pattern, and saw no added line
//     at all on GNU grep (Git for Windows, Linux), whose basic syntax reads the `\+` of
//     `grep -av '^\+\+\+'` as "one or more" and so drops every line that begins with a plus sign;
//     a user's color.ui=always or diff.external (difftastic's setup) hid those lines as well;
//   · everywhere but Windows: it was tracked as 100644, and git runs a hook only if it is executable.
// The ignore rules come first: a copy under any of those names is ignored anywhere in the tree, so
// `git status` never offers it. The one tracked file of the kind, the example under
// mobile/native-snippets, holds CHANGE_ME placeholders; it is exempt by its exact path, and its
// lines are still scanned.
//
// Each case runs the real hook through `sh`, as git does, in a throwaway repository, with gitleaks
// kept off PATH so the scan the hook falls back to is the one that runs; one case puts a recording
// gitleaks on PATH to read what the hook hands it, and the last one commits through git itself.
// Every password and token is made at run time, so this file holds nothing secret-shaped for
// gitleaks, CI's scan or this hook to find.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const HOOK = path.join(REPO_ROOT, '.githooks', 'pre-commit');
const EXAMPLE = 'mobile/native-snippets/keystore.properties.example';
const EXAMPLE_TEXT = fs.readFileSync(path.join(REPO_ROOT, ...EXAMPLE.split('/')), 'utf8');

// Every case spawns git and sh several times; Windows makes that slow.
jest.setTimeout(60000);

// `sh` on PATH (Ubuntu, Git Bash) or the one Git for Windows ships next to git itself.
function findSh() {
  const probe = spawnSync('sh', ['-c', 'exit 0'], { windowsHide: true });
  if (!probe.error && probe.status === 0) return 'sh';
  const exec = spawnSync('git', ['--exec-path'], { encoding: 'utf8', windowsHide: true }).stdout.trim();
  let dir = path.resolve(exec);
  for (let i = 0; i < 5; i += 1) {
    for (const rel of [['bin', 'sh.exe'], ['usr', 'bin', 'sh.exe']]) {
      const candidate = path.join(dir, ...rel);
      if (fs.existsSync(candidate)) return candidate;
    }
    dir = path.dirname(dir);
  }
  throw new Error('no POSIX sh found for the pre-commit hook test');
}

const SH = findSh();

// Made at run time, so no file in the repository holds the value.
const madeUp = () => crypto.randomBytes(18).toString('base64url');
// The shape of a classic GitHub token, made the way ci.yml's self-test makes its own.
const madeUpGitHubShape = () => `ghp_${crypto.randomBytes(64).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 36)}`;
const assignment = (name, value) => `${name}=${value}\n`;

// Each name a signing password is given in keystore.properties (and the tracked example), in React
// Native's documented entry in android/gradle.properties, and in a shell variable. Each is joined to
// its value only at run time: a name followed by `=` and a value in this file is what the hook
// refuses.
const NAMES = {
  store: 'storePassword',
  alias: 'keyPassword',
  reactNative: 'MYAPP_UPLOAD_STORE_PASSWORD',
  shell: 'KEY_PASSWORD',
};

// A signing key or keystore.properties under the names a copy really gets: the file itself, a
// backup, Explorer's "- Copy", a path flattened into the name, a keystore with and without a suffix.
const SIGNING_FILES = [
  'android/keystore.properties',
  'keystore.properties.bak',
  'keystore - Copy.properties',
  'mobile_KokonadaHealth_android_keystore.properties',
  'x/kokonada-release.keystore',
  'x/kokonada-release.keystore.bak',
  'x/release.jks',
  'x/release.p12',
];

// The scan the hook falls back to is what runs where gitleaks is not installed, as on the machine
// that holds the keystore; every PATH directory holding a gitleaks is dropped so that is the branch
// under test here too.
function withoutGitleaks(value) {
  const names = process.platform === 'win32' ? ['gitleaks', 'gitleaks.exe', 'gitleaks.cmd', 'gitleaks.bat'] : ['gitleaks'];
  return (value || '').split(path.delimiter)
    .filter((dir) => !names.some((name) => fs.existsSync(path.join(dir, name))))
    .join(path.delimiter);
}

let sandbox;
let env;
let pathKey;
let repoCount = 0;

beforeAll(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'pre-commit-guard-'));
  const emptyConfig = path.join(sandbox, 'empty-gitconfig');
  fs.writeFileSync(emptyConfig, '');
  env = { ...process.env };
  for (const k of Object.keys(env)) if (/^GIT_/.test(k)) delete env[k];
  Object.assign(env, {
    GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    // No user-wide ignore or attributes file: git reads $XDG_CONFIG_HOME/git/ignore by default.
    XDG_CONFIG_HOME: path.join(sandbox, 'no-xdg-config'),
    GIT_AUTHOR_NAME: 'Probe',
    GIT_AUTHOR_EMAIL: 'probe@example.com',
    GIT_COMMITTER_NAME: 'Probe',
    GIT_COMMITTER_EMAIL: 'probe@example.com',
  });
  pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  env[pathKey] = withoutGitleaks(env[pathKey]);
});

afterAll(() => {
  if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true });
});

function git(cwd, args, input) {
  const res = spawnSync('git', args, { cwd, env, input, encoding: 'utf8', windowsHide: true });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} exited ${res.status}:\n${res.stdout}${res.stderr}`);
  return res.stdout;
}

function newRepo() {
  repoCount += 1;
  const repo = path.join(sandbox, `repo-${repoCount}`);
  fs.mkdirSync(repo);
  git(repo, ['-c', 'init.defaultBranch=main', 'init', '--quiet']);
  return repo;
}

function write(repo, rel, text) {
  const file = path.join(repo, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function stage(repo, rel, text) {
  write(repo, rel, text);
  git(repo, ['add', '--', rel]);
}

const commit = (repo, message) => git(repo, ['commit', '--quiet', '-m', message]);
const nameStatus = (repo) => git(repo, ['diff', '--cached', '--name-status']).trim();

// The hook as git runs it: from the top of the work tree, through sh.
function runHook(repo, extraEnv = {}) {
  const res = spawnSync(SH, [HOOK], { cwd: repo, env: { ...env, ...extraEnv }, encoding: 'utf8', windowsHide: true });
  if (res.error) throw res.error;
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
}

// A repository whose one commit tracks the example exactly as this repository holds it.
function repoWithExample() {
  const repo = newRepo();
  stage(repo, EXAMPLE, EXAMPLE_TEXT);
  commit(repo, 'the example');
  return repo;
}

const filledIn = (text) => text.replace(/CHANGE_ME/g, () => madeUp());

// A path committed as a symbolic link, then staged as a regular file holding `text`: the type
// change (T) `git add` records on Linux and macOS when a link is replaced by the file it pointed
// at. Git for Windows keeps the link type on `git add` (core.symlinks=false), so the index entry is
// written directly; the hook reads only the index.
function typeChange(repo, rel, text) {
  const link = git(repo, ['hash-object', '-w', '--stdin'], 'elsewhere/keystore.properties').trim();
  git(repo, ['update-index', '--add', '--cacheinfo', `120000,${link},${rel}`]);
  commit(repo, 'a link');
  write(repo, rel, text);
  const blob = git(repo, ['hash-object', '-w', '--stdin'], text).trim();
  git(repo, ['update-index', '--cacheinfo', `100644,${blob},${rel}`]);
}

describe('OPS-002 · pre-commit — the hook file', () => {
  test('is POSIX sh with LF line endings, so `sh` runs it exactly as git does on every OS', () => {
    const text = fs.readFileSync(HOOK, 'utf8');
    expect(text.startsWith('#!/bin/sh\n')).toBe(true);
    expect(text.includes('\r')).toBe(false);
  });

  test('is committed executable (mode 100755): git skips a hook it cannot execute on Linux and macOS', () => {
    const out = execFileSync('git', ['ls-files', '-s', '--', '.githooks/pre-commit'], { cwd: REPO_ROOT, encoding: 'utf8' });
    expect(out).toMatch(/^100755 /);
  });
});

describe('OPS-002 · pre-commit — the sandbox', () => {
  test('keeps gitleaks off PATH, so the scan the hook falls back to is what runs, and still finds git', () => {
    const lookup = (cmd) => spawnSync(SH, ['-c', `command -v ${cmd}`], { env, encoding: 'utf8', windowsHide: true }).status;
    expect(lookup('gitleaks')).not.toBe(0);
    expect(lookup('git')).toBe(0);
  });

  test('starts from the example as the repository tracks it: two CHANGE_ME placeholders', () => {
    expect(EXAMPLE_TEXT.match(/CHANGE_ME/g)).toHaveLength(2);
  });
});

describe('OPS-002 · pre-commit — signing files by name', () => {
  test.each([
    ...SIGNING_FILES,
    'android/Keystore.Properties',
    // A second copy of the example is not the tracked example: the exemption is one exact path.
    'android/keystore.properties.example',
  ])('refuses %s, and names it', (rel) => {
    const repo = newRepo();
    stage(repo, rel, 'nothing secret in here\n');
    const res = runHook(repo);
    expect(res.status).toBe(1);
    expect(res.out).toContain(rel);
  });

  test.each([
    'notes.txt',
    'android/gradle.properties',
    'docs/keystore-rotation.md',
  ])('passes %s', (rel) => {
    const repo = newRepo();
    stage(repo, rel, 'nothing secret in here\n');
    expect(runHook(repo).status).toBe(0);
  });

  test('passes the tracked example, edited, with its placeholders kept', () => {
    const repo = repoWithExample();
    const edited = `${EXAMPLE_TEXT.replace(/=CHANGE_ME/g, ' = CHANGE_ME')}# a note for whoever copies this\n`;
    stage(repo, EXAMPLE, edited);
    expect(nameStatus(repo)).toBe(`M\t${EXAMPLE}`);
    // The placeholder lines are among the added lines the scan reads.
    expect(git(repo, ['diff', '--cached', '-U0']).match(/^\+.* = CHANGE_ME$/gm)).toHaveLength(2);
    expect(runHook(repo).status).toBe(0);
  });
});

describe('OPS-002 · pre-commit — renames and type changes bring content in too', () => {
  test('refuses `git mv` of the tracked example to keystore.properties, filled in', () => {
    const repo = repoWithExample();
    const target = 'mobile/KokonadaHealth/android/keystore.properties';
    fs.mkdirSync(path.join(repo, 'mobile', 'KokonadaHealth', 'android'), { recursive: true });
    git(repo, ['mv', '--', EXAMPLE, target]);
    stage(repo, target, filledIn(EXAMPLE_TEXT));
    // Git pairs it as a rename, the status --diff-filter=ACM dropped.
    const [status, from, to] = nameStatus(repo).split('\t');
    expect(status).toMatch(/^R\d+$/);
    expect([from, to]).toEqual([EXAMPLE, target]);
    const res = runHook(repo);
    expect(res.status).toBe(1);
    expect(res.out).toContain(target);
  });

  test('refuses a bare rename of the example to android/keystore.properties: the name check sees renames', () => {
    const repo = repoWithExample();
    fs.mkdirSync(path.join(repo, 'android'));
    git(repo, ['mv', '--', EXAMPLE, 'android/keystore.properties']);
    expect(nameStatus(repo)).toBe(`R100\t${EXAMPLE}\tandroid/keystore.properties`);
    const res = runHook(repo);
    expect(res.status).toBe(1);
    expect(res.out).toContain('android/keystore.properties');
  });

  test('refuses a renamed file that gains a signing password: the scan sees renames', () => {
    const repo = newRepo();
    const notes = Array.from({ length: 12 }, (_, i) => `line ${i + 1} of the release notes\n`).join('');
    stage(repo, 'docs/release-notes.txt', notes);
    commit(repo, 'notes');
    git(repo, ['mv', '--', 'docs/release-notes.txt', 'docs/release-notes-2.txt']);
    stage(repo, 'docs/release-notes-2.txt', `${notes}${assignment(NAMES.store, madeUp())}`);
    expect(nameStatus(repo).split('\t')[0]).toMatch(/^R\d+$/);
    const res = runHook(repo);
    expect(res.status).toBe(1);
    expect(res.out).toMatch(/signing password/);
  });

  test('refuses a link at android/keystore.properties replaced by the file itself (a type change)', () => {
    const repo = newRepo();
    typeChange(repo, 'android/keystore.properties', 'nothing secret in here\n');
    expect(nameStatus(repo)).toBe('T\tandroid/keystore.properties');
    const res = runHook(repo);
    expect(res.status).toBe(1);
    expect(res.out).toContain('android/keystore.properties');
  });

  test('refuses a link replaced by a file that holds a signing password: the scan sees type changes', () => {
    const repo = newRepo();
    typeChange(repo, 'config/signing.txt', assignment(NAMES.store, madeUp()));
    expect(nameStatus(repo)).toBe('T\tconfig/signing.txt');
    const res = runHook(repo);
    expect(res.status).toBe(1);
    expect(res.out).toMatch(/signing password/);
  });

  test('passes the deletion of a committed android/keystore.properties: removing a leaked file stays possible', () => {
    const repo = newRepo();
    stage(repo, 'android/keystore.properties', assignment(NAMES.store, madeUp()));
    commit(repo, 'a leak');
    git(repo, ['rm', '--quiet', '--', 'android/keystore.properties']);
    expect(nameStatus(repo)).toBe('D\tandroid/keystore.properties');
    expect(runHook(repo).status).toBe(0);
  });
});

describe('OPS-002 · pre-commit — the scan without gitleaks', () => {
  test('refuses a storePassword line whose value was made at run time', () => {
    const repo = newRepo();
    stage(repo, 'android/app/signing.txt', assignment(NAMES.store, madeUp()));
    const res = runHook(repo);
    expect(res.status).toBe(1);
    expect(res.out).toMatch(/signing password/);
  });

  test('refuses a keyPassword line with spaces around the equals sign', () => {
    const repo = newRepo();
    stage(repo, 'android/app/signing.txt', `${NAMES.alias} = ${madeUp()}\n`);
    const res = runHook(repo);
    expect(res.status).toBe(1);
    expect(res.out).toMatch(/signing password/);
  });

  test("refuses React Native's MYAPP_UPLOAD_STORE_PASSWORD in android/gradle.properties", () => {
    const repo = newRepo();
    stage(repo, 'android/gradle.properties', `org.gradle.jvmargs=-Xmx2048m\n${assignment(NAMES.reactNative, madeUp())}`);
    const res = runHook(repo);
    expect(res.status).toBe(1);
    expect(res.out).toMatch(/signing password/);
  });

  test('refuses one real value on a line that also holds a CHANGE_ME', () => {
    const repo = newRepo();
    stage(repo, 'scripts/sign.sh', `export ${NAMES.reactNative}=CHANGE_ME ${NAMES.shell}=${madeUp()}\n`);
    const res = runHook(repo);
    expect(res.status).toBe(1);
    expect(res.out).toMatch(/signing password/);
  });

  test('passes storePassword and keyPassword left at CHANGE_ME', () => {
    const repo = newRepo();
    stage(repo, 'android/app/signing.txt', `${assignment(NAMES.store, 'CHANGE_ME')}${assignment(NAMES.alias, 'CHANGE_ME')}`);
    expect(runHook(repo).status).toBe(0);
  });

  test('refuses the tracked example filled in where it stands: the exemption covers its name, not its lines', () => {
    const repo = repoWithExample();
    stage(repo, EXAMPLE, filledIn(EXAMPLE_TEXT));
    expect(nameStatus(repo)).toBe(`M\t${EXAMPLE}`);
    const res = runHook(repo);
    expect(res.status).toBe(1);
    expect(res.out).toMatch(/signing password/);
  });

  test('refuses a GitHub-token-shaped value: the scan reads the added lines on GNU grep too', () => {
    const repo = newRepo();
    stage(repo, 'config/runner.txt', `${madeUpGitHubShape()}\n`);
    const res = runHook(repo);
    expect(res.status).toBe(1);
    expect(res.out).toMatch(/possible secret\/token/);
  });

  test('still refuses with color.ui=always and an external diff tool set, which hide every + line', () => {
    const repo = newRepo();
    git(repo, ['config', 'color.ui', 'always']);
    git(repo, ['config', 'diff.external', 'echo']);
    stage(repo, 'android/app/signing.txt', assignment(NAMES.store, madeUp()));
    // Under that config a plain `git diff --cached` shows no line that begins with a plus sign.
    expect(git(repo, ['diff', '--cached']).split('\n').filter((l) => l.startsWith('+'))).toEqual([]);
    const res = runHook(repo);
    expect(res.status).toBe(1);
    expect(res.out).toMatch(/signing password/);
  });
});

describe('OPS-002 · pre-commit — with gitleaks installed', () => {
  test('hands gitleaks the plain staged diff, whatever the color and external-diff settings', () => {
    const bin = path.join(sandbox, 'recording-gitleaks');
    fs.mkdirSync(bin);
    // A stand-in that keeps what it is given and reports nothing, so the test reads what the hook sends.
    fs.writeFileSync(path.join(bin, 'gitleaks'), '#!/bin/sh\ncat > "$GITLEAKS_INPUT"\nexit 0\n', { mode: 0o755 });
    const input = path.join(sandbox, 'gitleaks-input.txt');
    const repo = newRepo();
    git(repo, ['config', 'color.ui', 'always']);
    git(repo, ['config', 'diff.external', 'echo']);
    stage(repo, 'notes.txt', 'a line the scan must see\n');
    const res = runHook(repo, { [pathKey]: `${bin}${path.delimiter}${env[pathKey]}`, GITLEAKS_INPUT: input });
    expect(res.status).toBe(0);
    // The stand-in ran, so the hook took its gitleaks branch.
    expect(fs.existsSync(input)).toBe(true);
    expect(fs.readFileSync(input, 'utf8')).toMatch(/^\+a line the scan must see$/m);
  });
});

describe('OPS-002 · the ignore rules, as the repository tracks them', () => {
  let repo;
  let copied;

  beforeAll(() => {
    // Every tracked .gitignore, copied to the same place in a sandbox, where no index, info/exclude
    // or user-wide ignore file can add a rule of its own.
    repo = newRepo();
    copied = execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf8' })
      .split('\0')
      .filter((rel) => rel === '.gitignore' || rel.endsWith('/.gitignore'));
    for (const rel of copied) write(repo, rel, fs.readFileSync(path.join(REPO_ROOT, ...rel.split('/')), 'utf8'));
  });

  // → the paths `git check-ignore` reports ignored.
  function ignored(paths) {
    const res = spawnSync('git', ['check-ignore', '--no-index', '--stdin', '-z'], {
      cwd: repo, env, input: `${paths.join('\0')}\0`, encoding: 'utf8', windowsHide: true,
    });
    if (res.error) throw res.error;
    if (res.status !== 0 && res.status !== 1) throw new Error(`git check-ignore exited ${res.status}: ${res.stderr}`);
    return res.stdout.split('\0').filter(Boolean).sort();
  }

  // Each name at the top of the tree, inside the app, beside the release keystore, and in two
  // folders that have nothing to do with signing.
  const PLACES = ['', 'mobile/KokonadaHealth/android/', 'mobile/KokonadaHealth/android/app/', 'backend/', 'docs/runbooks/'];
  const everywhere = [...new Set([
    ...SIGNING_FILES,
    ...PLACES.flatMap((dir) => SIGNING_FILES.map((rel) => `${dir}${path.posix.basename(rel)}`)),
  ])].sort();

  test('reads the real root and mobile .gitignore files', () => {
    expect(copied).toEqual(expect.arrayContaining(['.gitignore', 'mobile/KokonadaHealth/.gitignore']));
  });

  test('ignores every copy of a signing key or keystore.properties, anywhere in the tree', () => {
    // Where the release keystore and keystore.properties really live is among them.
    expect(everywhere).toEqual(expect.arrayContaining([
      'mobile/KokonadaHealth/android/keystore.properties',
      'mobile/KokonadaHealth/android/app/kokonada-release.keystore',
    ]));
    expect(ignored(everywhere)).toEqual(everywhere);
  });

  test('does not ignore the tracked example or an ordinary file that merely names a keystore', () => {
    expect(ignored([EXAMPLE, 'mobile/KokonadaHealth/android/gradle.properties', 'docs/keystore-rotation.md'])).toEqual([]);
  });
});

describe('OPS-002 · pre-commit — through git itself', () => {
  test('a real commit of android/keystore.properties is refused and HEAD stays; an ordinary commit passes', () => {
    const repo = newRepo();
    stage(repo, 'notes.txt', 'first\n');
    commit(repo, 'seed');
    const before = git(repo, ['rev-parse', 'HEAD']).trim();
    const hooks = ['-c', `core.hooksPath=${path.join(REPO_ROOT, '.githooks').replace(/\\/g, '/')}`];
    const commitThroughHooks = (message) => spawnSync('git', [...hooks, 'commit', '--quiet', '-m', message], {
      cwd: repo, env, encoding: 'utf8', windowsHide: true,
    });

    stage(repo, 'android/keystore.properties', 'nothing secret in here\n');
    const refused = commitThroughHooks('the keys');
    expect(refused.status).not.toBe(0);
    expect(`${refused.stdout}${refused.stderr}`).toContain('android/keystore.properties');
    expect(git(repo, ['rev-parse', 'HEAD']).trim()).toBe(before);

    git(repo, ['rm', '--cached', '--quiet', '--', 'android/keystore.properties']);
    stage(repo, 'notes.txt', 'second\n');
    const passed = commitThroughHooks('notes');
    expect(passed.status).toBe(0);
    expect(git(repo, ['rev-parse', 'HEAD~1']).trim()).toBe(before);
  });
});
