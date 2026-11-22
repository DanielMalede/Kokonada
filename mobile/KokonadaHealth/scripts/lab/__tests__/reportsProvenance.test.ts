/// <reference types="node" />
// UI-274: what a report says made it (scripts/lab/reports/lib/provenance.mjs). A report made again must say which code
// and which twin made it: the commit of the checkout the report ran from, with whether that tree held changes the commit
// does not (git status --porcelain, the lab stamp's test of a clean tree), and the version of each package the twin is
// drawn with, as the app's own require resolves it. Nothing here refuses: a fact it cannot read is unknown, with why.
// On real git, in checkouts this test makes, and on packages it plants beside a planted app.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describeMadeAt, describeVersion, madeAt, packageVersion } from '../reports/lib/provenance.mjs';

const APP = path.resolve(__dirname, '../../..');

/** git in a checkout this test owns: no hooks, no signing, a planted author. */
function git(dir: string, ...args: string[]): string {
  const r = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=lab', '-c', 'user.email=lab@example.invalid', ...args], { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${dir}: ${r.stderr}`);
  return r.stdout;
}

let root: string;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'provenance-'));
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

/** A checkout of one commit, with a subfolder (a report runs from mobile/KokonadaHealth, below the checkout's root). */
function checkout(name: string): { dir: string; sub: string; head: string } {
  const dir = path.join(root, name);
  const sub = path.join(dir, 'mobile', 'app');
  fs.mkdirSync(sub, { recursive: true });
  git(dir, 'init', '-q');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  fs.writeFileSync(path.join(sub, 'b.txt'), 'b\n');
  git(dir, 'add', 'a.txt', 'mobile/app/b.txt');
  git(dir, 'commit', '-q', '-m', 'one');
  return { dir, sub, head: git(dir, 'rev-parse', 'HEAD').trim() };
}

describe('madeAt: the commit a report is made at, and whether its tree holds more', () => {
  it('a clean checkout, read from a subfolder: its HEAD, and a clean tree', () => {
    const c = checkout('clean');
    expect(c.head).toMatch(/^[0-9a-f]{40}$/);
    expect(madeAt(c.sub)).toEqual({ commit: c.head, changes: 0 });
    expect(describeMadeAt(madeAt(c.sub))).toBe(`commit ${c.head}, a clean tree`);
  });

  it('a changed file above the subfolder and an untracked one: the same HEAD, and every path git lists', () => {
    const c = checkout('dirty');
    fs.appendFileSync(path.join(c.dir, 'a.txt'), 'more\n');
    fs.writeFileSync(path.join(c.sub, 'new.txt'), 'new\n');
    expect(madeAt(c.sub)).toEqual({ commit: c.head, changes: 2 });
    expect(describeMadeAt(madeAt(c.sub))).toBe(`commit ${c.head}, with uncommitted changes in 2 paths`);
    fs.rmSync(path.join(c.sub, 'new.txt'));
    expect(describeMadeAt(madeAt(c.sub))).toBe(`commit ${c.head}, with uncommitted changes in 1 path`);
  });

  it('a checkout whose index git cannot read: its HEAD, and the tree\'s state unknown, saying why on one line', () => {
    const c = checkout('torn');
    // Long enough for git to read a header from it: git says two lines ("error: bad signature …", "fatal: index file corrupt").
    fs.writeFileSync(path.join(c.dir, '.git', 'index'), 'planted text that is no index, long enough for git to read its header');
    const said = spawnSync('git', ['status', '--porcelain'], { cwd: c.dir, encoding: 'utf8' });
    expect({ status: said.status, lines: said.stderr.trim().split(/\r?\n/).length }).toEqual({ status: 128, lines: 2 });
    const m = madeAt(c.sub);
    expect(m).toEqual({ commit: c.head, changes: null, reason: expect.stringMatching(/^git status: error: .+; fatal: index file corrupt$/) });
    expect(describeMadeAt(m)).toBe(`commit ${c.head}, the tree's state unknown (${(m as { reason: string }).reason})`);
  });

  it('a folder in no checkout: the commit unknown, saying why', () => {
    const dir = path.join(root, 'loose');
    fs.mkdirSync(dir);
    // The guard: git itself finds no checkout here, so the answer below is the one a loose folder gets.
    expect(spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8' }).status).not.toBe(0);
    const m = madeAt(dir);
    expect(m).toEqual({ commit: null, reason: expect.stringMatching(/^git rev-parse HEAD: .*not a git repository/) });
    expect(describeMadeAt(m)).toBe(`commit unknown (${(m as { reason: string }).reason})`);
    expect(describeMadeAt(m)).not.toMatch(/[\r\n]/);
  });
});

describe('packageVersion: the version of a package as the app resolves it', () => {
  it('canvaskit-wasm and RN Skia: the versions in the package.json files under the app\'s node_modules', () => {
    for (const name of ['canvaskit-wasm', '@shopify/react-native-skia']) {
      const version = JSON.parse(fs.readFileSync(path.join(APP, 'node_modules', name, 'package.json'), 'utf8')).version;
      expect(version).toMatch(/^\d+\.\d+\.\d+/);
      expect(packageVersion(APP, name)).toEqual({ version });
      expect(describeVersion(name, packageVersion(APP, name))).toBe(`${name} ${version}`);
    }
  });

  it('a planted app: the version its own node_modules holds, not the one this app has', () => {
    const app = path.join(root, 'planted-app');
    fs.mkdirSync(path.join(app, 'node_modules', 'canvaskit-wasm'), { recursive: true });
    fs.writeFileSync(path.join(app, 'package.json'), '{"name":"planted"}');
    fs.writeFileSync(path.join(app, 'node_modules', 'canvaskit-wasm', 'package.json'), '{"name":"canvaskit-wasm","version":"9.8.7"}');
    expect(packageVersion(app, 'canvaskit-wasm')).toEqual({ version: '9.8.7' });
  });

  it('a package the app does not have, or one whose package.json names no version: unknown, saying why', () => {
    const missing = packageVersion(APP, 'no-such-package-ui274');
    expect(missing).toEqual({ version: null, reason: expect.stringContaining('no-such-package-ui274') });
    expect(describeVersion('no-such-package-ui274', missing)).toBe(`no-such-package-ui274 unknown (${(missing as { reason: string }).reason})`);
    expect(describeVersion('no-such-package-ui274', missing)).not.toMatch(/[\r\n]/);
    const app = path.join(root, 'unversioned-app');
    fs.mkdirSync(path.join(app, 'node_modules', 'bare'), { recursive: true });
    fs.writeFileSync(path.join(app, 'package.json'), '{"name":"planted"}');
    fs.writeFileSync(path.join(app, 'node_modules', 'bare', 'package.json'), '{"name":"bare"}');
    expect(packageVersion(app, 'bare')).toEqual({ version: null, reason: expect.stringMatching(/names no version$/) });
  });

  it('a package.json that is not JSON: unknown, saying why on one line, and nothing thrown', () => {
    // The resolver itself refuses it (node: "Invalid package config"; jest's: "Cannot find module"), naming the package.
    const app = path.join(root, 'malformed-app');
    fs.mkdirSync(path.join(app, 'node_modules', 'torn'), { recursive: true });
    fs.writeFileSync(path.join(app, 'package.json'), '{"name":"planted"}');
    fs.writeFileSync(path.join(app, 'node_modules', 'torn', 'package.json'), '{"name": "torn",\n"version": ');
    const v = packageVersion(app, 'torn');
    expect(v).toEqual({ version: null, reason: expect.stringContaining('torn') });
    expect(describeVersion('torn', v)).not.toMatch(/[\r\n]/);
  });
});
