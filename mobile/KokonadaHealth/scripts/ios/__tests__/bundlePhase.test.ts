/// <reference types="node" />
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

// MB-093 (N1, MF-4; QA-077 clause A1, iOS part; CMP-141). react-native-xcode.sh bundles $ENTRY_FILE
// whenever it is set, else index.ios.js if one exists, else index.js. The Xcode phase runs it
// through with-environment.sh, which first sources ios/.xcode.env and the gitignored
// ios/.xcode.env.local, so an export in that local file, an `xcodebuild ENTRY_FILE=...` argument or
// a build setting could put the Design Lab's index.lab.js into an archive bound for TestFlight.
//
// The phase now runs a repo wrapper, ios/scripts/bundle-react-native.sh, through the same
// with-environment.sh, so it sees exactly what react-native-xcode.sh would see. It refuses any
// ENTRY_FILE other than index.js, and an index.ios.js, and only then execs react-native-xcode.sh.
//
// Pinned two ways:
//   · the pbxproj phase itself, decoded from the project file;
//   · bash runs: that decoded phase script, run with the REAL with-environment.sh and the REAL
//     wrapper, over a fake react-native-xcode.sh that records whether it ran and with what entry;
//     and the wrapper run directly.
// This file sits outside ios/** so that editing a test never starts the macOS job; the wrapper
// sits inside it, so a change to the wrapper does.

const APP = path.resolve(__dirname, '../../..');
const IOS = path.join(APP, 'ios');
const PBXPROJ = path.join(IOS, 'KokonadaHealth.xcodeproj/project.pbxproj');
const WRAPPER_REL = 'ios/scripts/bundle-react-native.sh';
const WRAPPER = path.join(APP, WRAPPER_REL);
const WITH_ENVIRONMENT = path.join(APP, 'node_modules/react-native/scripts/xcode/with-environment.sh');
const PHASE_NAME = 'Bundle React Native code and images';

// ---- the project file ---------------------------------------------------------------------------

const pbx = fs.readFileSync(PBXPROJ, 'utf8');

/** Every object block in the project file: { id, comment, body }. */
const objects = [...pbx.matchAll(/^\t\t([0-9A-F]{24}) \/\* (.+?) \*\/ = \{\n([\s\S]*?)\n\t\t\};$/gm)]
  .map(([, id, comment, body]) => ({ id, comment, body }));

/** A pbxproj quoted string, unescaped. */
const unquote = (s: string) => s.replace(/\\(.)/g, (_m, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c));

const bundlePhases = objects.filter((o) => /\bisa = PBXShellScriptBuildPhase;/.test(o.body) && o.body.includes(`name = "${PHASE_NAME}";`));
const phaseScript = () => {
  const m = /\n\t\t\tshellScript = "((?:[^"\\]|\\.)*)";/.exec(bundlePhases[0].body);
  if (!m) throw new Error('the bundle phase has no shellScript');
  return unquote(m[1]);
};

const EXPECTED_PHASE = [
  'set -e',
  '',
  'WITH_ENVIRONMENT="$REACT_NATIVE_PATH/scripts/xcode/with-environment.sh"',
  '# MB-093: the wrapper runs after with-environment.sh has sourced ios/.xcode.env and ios/.xcode.env.local.',
  '# It refuses any entry but index.js (ENTRY_FILE, an index.ios.js), then hands over to React Native\'s bundling script.',
  'BUNDLE_REACT_NATIVE="$PROJECT_DIR/scripts/bundle-react-native.sh"',
  '',
  '/bin/sh -c "\\"$WITH_ENVIRONMENT\\" \\"$BUNDLE_REACT_NATIVE\\""',
  '',
].join('\n');

describe('the Xcode bundle phase (project.pbxproj)', () => {
  it('there is exactly one, and the KokonadaHealth target runs it', () => {
    expect(bundlePhases).toHaveLength(1);
    const target = objects.find((o) => o.comment === 'KokonadaHealth' && /\bisa = PBXNativeTarget;/.test(o.body));
    expect(target).toBeDefined();
    const phases = /buildPhases = \(([\s\S]*?)\);/.exec(target!.body)![1];
    expect(phases).toContain(`${bundlePhases[0].id} /* ${PHASE_NAME} */`);
  });

  it('runs the repo wrapper through with-environment.sh, exactly this script', () => {
    expect(phaseScript()).toBe(EXPECTED_PHASE);
  });

  it('never names react-native-xcode.sh itself, so nothing reaches the bundler around the wrapper', () => {
    expect(phaseScript()).not.toMatch(/react-native-xcode/);
    expect(pbx).not.toMatch(/react-native-xcode\.sh/);
  });

  it('the wrapper is committed executable, with LF line endings (with-environment.sh runs it as a program)', () => {
    const staged = execFileSync('git', ['ls-files', '--full-name', '-s', '--', WRAPPER_REL], { cwd: APP, encoding: 'utf8' }).trim();
    expect(staged).toMatch(/^100755 [0-9a-f]{40} 0\tmobile\/KokonadaHealth\/ios\/scripts\/bundle-react-native\.sh$/);
    const text = fs.readFileSync(WRAPPER, 'utf8');
    expect(text.startsWith('#!/bin/bash\n')).toBe(true);
    expect(text).not.toMatch(/\r/);
  });
});

// ---- bash runs ------------------------------------------------------------------------------------

// A POSIX shell. On Windows, Git's own bash and sh: `bash` on PATH may be WSL's, which cannot read
// these paths.
const shell = (name: 'sh' | 'bash') => {
  if (process.platform !== 'win32') return name;
  const exec = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim();
  const bin = path.resolve(exec, '../../../usr/bin', `${name}.exe`);
  if (!fs.existsSync(bin)) throw new Error(`no ${name} beside git at ${bin}`);
  return bin;
};
const posix = (p: string) => p.split(path.sep).join('/');

const FAKE_BUNDLER = [
  '#!/bin/bash',
  '# A stand-in for react-native-xcode.sh: it records that it ran, the entry it was given and its arguments,',
  '# and exits with FAKE_EXIT (0 by default).',
  'printf \'ran ENTRY_FILE=[%s] args=[%s]\\n\' "${ENTRY_FILE-<unset>}" "$*" >> "$FAKE_LOG"',
  'exit "${FAKE_EXIT:-0}"',
  '',
].join('\n');

interface Sandbox { dir: string; rn: string; envDir: string; log: string }

function sandbox(): Sandbox {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-phase-'));
  const rn = path.join(dir, 'react-native');
  fs.mkdirSync(path.join(rn, 'scripts/xcode'), { recursive: true });
  // The real with-environment.sh, so the sourcing order under test is React Native's own.
  fs.copyFileSync(WITH_ENVIRONMENT, path.join(rn, 'scripts/xcode/with-environment.sh'));
  fs.chmodSync(path.join(rn, 'scripts/xcode/with-environment.sh'), 0o755);
  fs.writeFileSync(path.join(rn, 'scripts/react-native-xcode.sh'), FAKE_BUNDLER);
  fs.chmodSync(path.join(rn, 'scripts/react-native-xcode.sh'), 0o755);
  const envDir = path.join(dir, 'ios');
  fs.mkdirSync(envDir);
  // The real, versioned ios/.xcode.env.
  fs.copyFileSync(path.join(IOS, '.xcode.env'), path.join(envDir, '.xcode.env'));
  return { dir, rn, envDir, log: path.join(dir, 'bundler.log') };
}

const baseEnv = (s: Sandbox, extra: Record<string, string> = {}) => {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.ENTRY_FILE;
  delete env.PROJECT_ROOT;
  return {
    ...env,
    REACT_NATIVE_PATH: posix(s.rn),
    PODFILE_DIR: posix(s.envDir),
    PROJECT_DIR: posix(IOS),
    FAKE_LOG: posix(s.log),
    ...extra,
  };
};
const bundlerRuns = (s: Sandbox) => (fs.existsSync(s.log) ? fs.readFileSync(s.log, 'utf8').trim().split('\n') : []);

/** The decoded Xcode phase, run as Xcode runs it (shellPath /bin/sh). */
const runPhase = (s: Sandbox, extra: Record<string, string> = {}) =>
  spawnSync(shell('sh'), ['-c', phaseScript()], { env: baseEnv(s, extra), encoding: 'utf8' });

/** The wrapper alone, with arguments if any. */
const runWrapper = (s: Sandbox, extra: Record<string, string> = {}, args: string[] = []) =>
  spawnSync(shell('bash'), [posix(WRAPPER), ...args], { env: baseEnv(s, extra), encoding: 'utf8' });

describe('the phase, run with the real with-environment.sh and the real wrapper', () => {
  let s: Sandbox;
  beforeEach(() => { s = sandbox(); });
  afterEach(() => { fs.rmSync(s.dir, { recursive: true, force: true }); });

  it('with no ENTRY_FILE anywhere, hands over to react-native-xcode.sh once, with no entry and no argument', () => {
    const r = runPhase(s);
    expect(r.stderr).not.toMatch(/error:/);
    expect(r.status).toBe(0);
    expect(bundlerRuns(s)).toEqual(['ran ENTRY_FILE=[<unset>] args=[]']);
  });

  it('refuses ENTRY_FILE=index.lab.js exported in ios/.xcode.env.local, before anything is bundled', () => {
    fs.writeFileSync(path.join(s.envDir, '.xcode.env.local'), 'export ENTRY_FILE=index.lab.js\n');
    const r = runPhase(s);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/error: ENTRY_FILE is "index\.lab\.js"\. The iOS bundle phase builds index\.js only \(MB-093\)/);
    expect(bundlerRuns(s)).toEqual([]);
  });

  it('refuses it in the versioned ios/.xcode.env too', () => {
    fs.appendFileSync(path.join(s.envDir, '.xcode.env'), 'export ENTRY_FILE=index.lab.js\n');
    const r = runPhase(s);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/ENTRY_FILE is "index\.lab\.js"/);
    expect(bundlerRuns(s)).toEqual([]);
  });

  it('refuses it from the build environment (xcodebuild ENTRY_FILE=..., or a build setting)', () => {
    const r = runPhase(s, { ENTRY_FILE: 'index.lab.js' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/ENTRY_FILE is "index\.lab\.js"/);
    expect(bundlerRuns(s)).toEqual([]);
  });

  it('lets ENTRY_FILE=index.js through: that is the release entry', () => {
    const r = runPhase(s, { ENTRY_FILE: 'index.js' });
    expect(r.status).toBe(0);
    expect(bundlerRuns(s)).toEqual(['ran ENTRY_FILE=[index.js] args=[]']);
  });

  it('a bundling failure fails the phase, with the bundler\'s own exit code', () => {
    const r = runPhase(s, { FAKE_EXIT: '3' });
    expect(bundlerRuns(s)).toEqual(['ran ENTRY_FILE=[<unset>] args=[]']);
    expect(r.status).toBe(3);
  });

  it('lets an empty ENTRY_FILE through: react-native-xcode.sh treats it as unset and bundles index.js', () => {
    const r = runPhase(s, { ENTRY_FILE: '' });
    expect(r.status).toBe(0);
    expect(bundlerRuns(s)).toEqual(['ran ENTRY_FILE=[] args=[]']);
  });
});

describe('the wrapper, run directly', () => {
  let s: Sandbox;
  beforeEach(() => { s = sandbox(); });
  afterEach(() => { fs.rmSync(s.dir, { recursive: true, force: true }); });

  it.each(['index.lab.js', './index.js', 'index.js ', 'src/index.js', 'index.ios.js'])('refuses ENTRY_FILE=%p', (entry) => {
    const r = runWrapper(s, { ENTRY_FILE: entry });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`error: ENTRY_FILE is "${entry}".`);
    expect(bundlerRuns(s)).toEqual([]);
  });

  it('refuses an index.ios.js beside index.js, even an empty one', () => {
    const app = path.join(s.dir, 'app');
    fs.mkdirSync(path.join(app, 'ios'), { recursive: true });
    fs.writeFileSync(path.join(app, 'index.ios.js'), '');
    const r = runWrapper(s, { PROJECT_DIR: posix(path.join(app, 'ios')) });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/error: .*index\.ios\.js exists\. react-native-xcode\.sh would bundle it instead of index\.js/);
    expect(bundlerRuns(s)).toEqual([]);
  });

  it('looks for index.ios.js where react-native-xcode.sh will bundle from: PROJECT_ROOT when it is set', () => {
    const root = path.join(s.dir, 'elsewhere');
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, 'index.ios.js'), 'export {};\n');
    const r = runWrapper(s, { PROJECT_ROOT: posix(root) });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/index\.ios\.js exists/);
    expect(bundlerRuns(s)).toEqual([]);
  });

  it('refuses an argument: react-native-xcode.sh would read it as the entry file', () => {
    const r = runWrapper(s, {}, ['index.lab.js']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/error: the bundle phase takes no arguments/);
    expect(bundlerRuns(s)).toEqual([]);
  });

  it('refuses to run outside Xcode, where PROJECT_DIR is not set', () => {
    const r = runWrapper(s, { PROJECT_DIR: '' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/error: PROJECT_DIR is not set/);
    expect(bundlerRuns(s)).toEqual([]);
  });

  it('fails when react-native-xcode.sh is not where REACT_NATIVE_PATH points', () => {
    const r = runWrapper(s, { REACT_NATIVE_PATH: posix(path.join(s.dir, 'nowhere')) });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/error: no react-native-xcode\.sh at /);
  });

  it('with nothing to refuse, execs react-native-xcode.sh with no argument', () => {
    const r = runWrapper(s);
    expect(r.status).toBe(0);
    expect(bundlerRuns(s)).toEqual(['ran ENTRY_FILE=[<unset>] args=[]']);
  });
});
