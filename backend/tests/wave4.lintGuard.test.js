'use strict';

// W4-D11 — `lint clean` has been in the Definition of Done since session 1 and has never been a
// control: this repo had no eslint config, no eslint dependency and no `lint` script, so every
// session that reported the line satisfied was reporting on nothing.
//
// The interval that produced this task also produced the exact defect the missing rule catches.
// W4-D08 added `insertManyAccounted(...)` to `suunto.js` without the `require`, and it survived a
// green 172-suite run, a resilience-minded author and an open PR — because every test touching that
// module `jest.mock`s it. A single `no-undef` pass over `backend/app` finds it in about a second.
//
// WHY A TEST AND NOT JUST AN npm SCRIPT. A script only runs when somebody remembers, and the whole
// point of the class is that nobody did. This run's precedent is consistent — W4-D01's marker,
// W4-D02's state-guard and W4-D06's open-handle guard all run inside the suite that already gates
// every task — so the linter runs there too.
//
// WHY A CHILD PROCESS AND NOT THE ESLint API. ESLint's programmatic API resolves its config and
// globs through dynamic `import()`, which throws inside jest's CJS VM ("A dynamic import callback
// was invoked without --experimental-vm-modules"). Rather than turn on experimental module flags
// for all 170+ suites, this drives the real CLI — the same binary `npm run lint` invokes — so the
// gate and the script cannot drift apart.
//
// SCOPE, deliberately narrow (the W4-D11 DoD). The gate is zero ERRORS over the PRODUCTION surface,
// `backend/app` + `backend/sim`. `no-unused-vars` is a warning everywhere, so pre-existing style
// debt in untouched files cannot fail a build and this task does not become a repo-wide rewrite.
// Warning counts are recorded in STATE rather than fixed here.

const path = require('path');
const { execFileSync } = require('child_process');

jest.setTimeout(120000);

const ROOT        = path.resolve(__dirname, '..');
const ESLINT_BIN  = path.join(ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js');
// The gated production surface. Tests, jest hooks and backend/scripts are linted by `npm run lint`
// but are not gated here: they carry test globals and their own pre-existing debt.
const PRODUCTION_DIRS = ['app', 'sim'];

// eslint exits 1 when it reports an error — that is a finding, not a tool failure, and the JSON
// report is still on stdout. Anything else (missing binary, bad config) must still blow up loudly.
function runEslint(args) {
  try {
    return execFileSync(process.execPath, [ESLINT_BIN, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    if (typeof err.stdout === 'string' && err.stdout.trim()) return err.stdout;
    throw err;
  }
}

let results;
beforeAll(() => {
  results = JSON.parse(runEslint([...PRODUCTION_DIRS, '-f', 'json']));
});

const rel = (f) => path.relative(ROOT, f);
const messages = (predicate) =>
  results.flatMap(r => r.messages.filter(predicate).map(m => `${rel(r.filePath)}:${m.line} [${m.ruleId}] ${m.message}`));

const printConfigFor = (relPath) =>
  JSON.parse(runEslint(['--print-config', path.join(ROOT, relPath)]));

const levelOf = (rules, name) => (Array.isArray(rules[name]) ? rules[name][0] : rules[name]);

describe('W4-D11 — the linter actually looks at something', () => {
  it('lints the whole production surface, not an empty glob', () => {
    // A guard that silently matches zero files is precisely the false-green this wave keeps
    // finding. 100 is a floor, not a count: app + sim held 147 files when this was written.
    expect(results.length).toBeGreaterThan(100);
  });

  it('covers both production directories', () => {
    const dirs = new Set(results.map(r => rel(r.filePath).split(path.sep)[0]));
    for (const d of PRODUCTION_DIRS) expect(dirs).toContain(d);
  });

  it('parses every file it linted — a parse error would silently skip a file', () => {
    expect(messages(m => m.fatal)).toEqual([]);
  });
});

describe('W4-D11 — the rules that matter are switched ON', () => {
  // Guarding the guard: a config edit that dropped `no-undef` would leave every assertion below
  // trivially green. The rule's presence is asserted, never assumed.
  it('has no-undef enabled at error level on production code', () => {
    const { rules } = printConfigFor(path.join('app', 'services', 'wearable', 'suunto.js'));
    expect(['error', 2]).toContain(levelOf(rules, 'no-undef'));
  });

  it('has no-unused-vars at warning level, so pre-existing debt cannot fail a build', () => {
    const { rules } = printConfigFor(path.join('app', 'services', 'wearable', 'suunto.js'));
    expect(['warn', 1]).toContain(levelOf(rules, 'no-unused-vars'));
  });

  it('applies the same rules to the sim tree, not only to app', () => {
    const { rules } = printConfigFor(path.join('sim', 'generator.js'));
    expect(['error', 2]).toContain(levelOf(rules, 'no-undef'));
  });

  it('knows the node globals, so `process`/`require`/`Buffer` are not reported as undefined', () => {
    const noise = messages(
      m => m.ruleId === 'no-undef' &&
        /'(process|require|module|exports|Buffer|console|__dirname|setTimeout|setInterval)'/.test(m.message),
    );
    expect(noise).toEqual([]);
  });
});

describe('W4-D11 — the production surface is clean', () => {
  it('THE W4-D08 CLASS: reports zero undefined identifiers in backend/app and backend/sim', () => {
    // The failure message IS the finding — a future session gets file:line, not a bare count.
    expect(messages(m => m.ruleId === 'no-undef' && m.severity === 2)).toEqual([]);
  });

  it('reports zero errors of any error-level rule at all', () => {
    expect(messages(m => m.severity === 2)).toEqual([]);
  });

  it('and the aggregate error count agrees, so a filtered-out message cannot hide one', () => {
    expect(results.reduce((sum, r) => sum + r.errorCount, 0)).toBe(0);
  });
});
