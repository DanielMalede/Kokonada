'use strict';

// OPS-151 · .githooks/pre-push — nobody pushes to main.
//
// A merge to `main` deploys the backend to production, and the repository has no branch protection
// to stop a direct push. This hook is the local backstop: git feeds it one line per ref being pushed
// ("<local ref> <local sha> <remote ref> <remote sha>"), and any line whose remote ref is
// refs/heads/main — an update or a delete (local sha all zeros) — refuses the whole push.
//
// The hook is POSIX sh, run here through the same `sh` git uses for hooks.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const HOOK = path.join(REPO_ROOT, '.githooks', 'pre-push');

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
  throw new Error('no POSIX sh found for the pre-push hook test');
}

const SH = findSh();
const ZERO = '0000000000000000000000000000000000000000';
const SHA = 'a'.repeat(40);
const OLD = 'b'.repeat(40);

function push(lines) {
  return spawnSync(SH, [HOOK, 'origin', 'https://github.com/example/repo.git'], {
    input: lines.map((l) => `${l}\n`).join(''),
    encoding: 'utf8',
    windowsHide: true,
  });
}

describe('OPS-151 · pre-push — refuses main', () => {
  test('the hook is committed with LF line endings, so sh can run it on every OS', () => {
    const text = fs.readFileSync(HOOK, 'utf8');
    expect(text.startsWith('#!/bin/sh\n')).toBe(true);
    expect(text.includes('\r')).toBe(false);
  });

  test('a push to refs/heads/main is refused with a one-line reason', () => {
    const res = push([`refs/heads/main ${SHA} refs/heads/main ${OLD}`]);
    expect(res.status).not.toBe(0);
    const out = `${res.stdout}${res.stderr}`.trim();
    expect(out.split('\n')).toHaveLength(1);
    expect(out).toMatch(/main/);
  });

  test('a delete of main (local sha all zeros) is refused', () => {
    expect(push([`(delete) ${ZERO} refs/heads/main ${OLD}`]).status).not.toBe(0);
  });

  test('pushing a task branch to main by refspec is still a push to main', () => {
    expect(push([`refs/heads/feat/x ${SHA} refs/heads/main ${OLD}`]).status).not.toBe(0);
  });

  test('a task branch passes', () => {
    const res = push([`refs/heads/feat/x ${SHA} refs/heads/feat/x ${ZERO}`]);
    expect(res.status).toBe(0);
  });

  test('several refs with one of them main: the whole push is refused, with one line', () => {
    const res = push([
      `refs/heads/feat/x ${SHA} refs/heads/feat/x ${OLD}`,
      `refs/heads/main ${SHA} refs/heads/main ${OLD}`,
      `refs/heads/feat/y ${SHA} refs/heads/feat/y ${OLD}`,
    ]);
    expect(res.status).not.toBe(0);
    expect(`${res.stdout}${res.stderr}`.trim().split('\n')).toHaveLength(1);
  });

  test('a branch merely NAMED like main is not main', () => {
    expect(push([`refs/heads/main-docs ${SHA} refs/heads/main-docs ${OLD}`]).status).toBe(0);
    expect(push([`refs/heads/feat/main ${SHA} refs/heads/feat/main ${OLD}`]).status).toBe(0);
  });

  test('an empty push (nothing on stdin) passes', () => {
    expect(push([]).status).toBe(0);
  });
});

describe('OPS-151 · pre-push — through git itself', () => {
  let tmp;
  let env;
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coord-prepush-'));
    const cfg = path.join(tmp, 'empty-gitconfig');
    fs.writeFileSync(cfg, '');
    env = { ...process.env, GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
    for (const k of Object.keys(env)) if (/^GIT_(DIR|WORK_TREE|INDEX_FILE)$/.test(k)) delete env[k];
  });
  afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  const git = (cwd, args) => spawnSync('git', args, { cwd, env, encoding: 'utf8', windowsHide: true });
  const ok = (cwd, args) => {
    const res = git(cwd, args);
    if (res.status !== 0) throw new Error(`git ${args.join(' ')}: ${res.stdout}${res.stderr}`);
    return res.stdout.trim();
  };

  test('the hook is committed executable (mode 100755), so git runs it on Linux and macOS', () => {
    const out = execFileSync('git', ['ls-files', '-s', '--', '.githooks/pre-push'], { cwd: REPO_ROOT, encoding: 'utf8' });
    expect(out).toMatch(/^100755 /);
  });

  test('a real `git push origin HEAD:main` is refused and origin main is unchanged; a task branch passes', () => {
    const bare = path.join(tmp, 'origin.git');
    const clone = path.join(tmp, 'clone');
    ok(tmp, ['-c', 'init.defaultBranch=main', 'init', '--bare', bare]);
    ok(tmp, ['clone', bare, clone]);
    ok(clone, ['config', 'user.name', 'T']);
    ok(clone, ['config', 'user.email', 't@example.com']);
    fs.writeFileSync(path.join(clone, 'a.txt'), 'a\n');
    ok(clone, ['add', '--', 'a.txt']);
    ok(clone, ['commit', '-m', 'one']);
    ok(clone, ['push', 'origin', 'HEAD:refs/heads/main']); // the seed push, before the hook is on
    const before = ok(bare, ['rev-parse', 'refs/heads/main']);
    fs.writeFileSync(path.join(clone, 'a.txt'), 'b\n');
    ok(clone, ['commit', '-am', 'two']);

    const hooks = ['-c', `core.hooksPath=${path.join(REPO_ROOT, '.githooks').replace(/\\/g, '/')}`];
    const refused = git(clone, [...hooks, 'push', 'origin', 'HEAD:main']);
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toMatch(/pre-push: refusing to push to main/);
    expect(ok(bare, ['rev-parse', 'refs/heads/main'])).toBe(before);

    const passed = git(clone, [...hooks, 'push', 'origin', 'HEAD:refs/heads/feat/x']);
    expect(passed.status).toBe(0);
    expect(ok(bare, ['rev-parse', 'refs/heads/feat/x'])).toBe(ok(clone, ['rev-parse', 'HEAD']));
  });
});
