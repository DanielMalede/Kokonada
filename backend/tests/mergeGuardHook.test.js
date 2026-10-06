'use strict';

// OPS-146 - the merge-guard trigger (`.claude/hooks/merge-guard-trigger.mjs`, DEC-143) tells every
// session to dispatch the `merge-guard` agent after a PR create, a push to an open PR and a merge.
// Its tests are `node --test`, outside every jest root, and no CI step ran them: a change that broke
// the hook turned nothing red, and the hook then went quiet without a sound.
//
// This file runs them inside the backend suite, so the `Backend — lint & test` job fails when they
// fail, with no workflow change. It asserts the exit code, zero failures in the TAP summary, and a
// floor on the passing count, so a test file that silently stops running its tests (or skips them)
// is red too. Raise MIN_PASS when tests are added.

const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
// `--test` arguments are globs, so the path is POSIX and relative to the repository root.
const HOOK_TESTS = '.claude/hooks/merge-guard-trigger.test.mjs';
const MIN_PASS = 151;

jest.setTimeout(60000);

describe('merge-guard trigger tests (OPS-146)', () => {
  it('node --test runs every hook test and none fails', () => {
    const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', HOOK_TESTS], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 60000,
    });
    expect(r.error).toBeUndefined();
    const out = r.stdout || '';
    const count = (name) => Number((new RegExp(`^# ${name} (\\d+)$`, 'm').exec(out) || [])[1]);
    const notOk = out.split('\n').filter((l) => /^\s*not ok /.test(l)).map((l) => l.trim());
    expect({ status: r.status, notOk, fail: count('fail') }).toEqual({ status: 0, notOk: [], fail: 0 });
    expect(count('pass')).toBeGreaterThanOrEqual(MIN_PASS);
  });
});
