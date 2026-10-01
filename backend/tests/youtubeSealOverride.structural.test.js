'use strict';

// HX-3 T2 (DEC-122, DEC-040; DT-B3) — nothing but a reviewed edit of config/youtubeSeal.js can change
// what the YouTube seal says.
//
// The seal is two frozen `false` literals (pinned by youtubeSeal.test.js). A seal can still be undone
// without touching that file: a second declaration that shadows a constant, a destructuring default,
// an env read under the same name, or a module mock. This suite rules each of those out:
//   1. no non-test file under backend/ (app, scripts, sim, jest, root config) declares, assigns,
//      renames or reads-from-env either constant; the only way any file obtains one is
//      `const { … } = require('…/config/youtubeSeal')`;
//   2. no non-test file mentions the module in code except that require;
//   3. among the tests, ONLY the two files that cover the dormant connect/callback path may replace
//      the module (DT-B3 option A), each exactly once, each with YOUTUBE_EGRESS_ENABLED still false and
//      a header saying the path is dormant. Production behaviour is pinned separately, with the real
//      module, in youtubeSeal.integration.test.js.
//
// Pure source scanning — no Mongo, no Redis, no network.

const fs = require('fs');
const path = require('path');

const BACKEND = path.join(__dirname, '..');
const TESTS = __dirname;
const SEAL_FILE = 'app/config/youtubeSeal.js';
const NAMES = '(?:YOUTUBE_CONNECT_ENABLED|YOUTUBE_EGRESS_ENABLED)';

// The two files whose dormant-path tests run against a fixture seal (DT-B3 option A). Deleted at D.
const DORMANT_FIXTURE_FILES = ['integrations.test.js', 'integrationsController.test.js'];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}
const rel = (file) => path.relative(BACKEND, file).split(path.sep).join('/');
const isTestPath = (r) => r.startsWith('tests/') || /\.(test|spec)\.js$/.test(r) || r.includes('/__tests__/');

function nonTestSources() {
  const out = {};
  for (const file of walk(BACKEND)) {
    const r = rel(file);
    if (!isTestPath(r)) out[r] = fs.readFileSync(file, 'utf8');
  }
  return out;
}
function testSources() {
  const out = {};
  for (const file of walk(TESTS)) out[path.basename(file)] = fs.readFileSync(file, 'utf8');
  return out;
}

const isComment = (line) => /^\s*(\/\/|\/?\*)/.test(line);
const SEAL_REQUIRE = /^\s*const\s*\{\s*(?:YOUTUBE_CONNECT_ENABLED|YOUTUBE_EGRESS_ENABLED)(?:\s*,\s*(?:YOUTUBE_CONNECT_ENABLED|YOUTUBE_EGRESS_ENABLED))?\s*,?\s*\}\s*=\s*require\(\s*(['"])(?:\.\.?\/)+config\/youtubeSeal\1\s*\)\s*;?\s*(\/\/.*)?$/;

const RULES = [
  { kind: 'assignment to a seal constant', re: new RegExp(String.raw`\b${NAMES}\s*(?:=(?!=)|\+\+|--|\|\|=|&&=|\?\?=)`) },
  { kind: 'a second declaration of a seal constant', re: new RegExp(String.raw`\b(?:const|let|var|function|class)\s+${NAMES}\b`) },
  { kind: 'a seal constant as an object key or a destructuring rename', re: new RegExp(String.raw`\b${NAMES}\s*:(?!:)`) },
  { kind: 'a YouTube *_ENABLED switch read from the environment', re: /process\s*\.\s*env\s*(?:\.\s*|\[\s*['"`])YOUTUBE_\w*ENABLED/ },
];

/** Findings for a { file: source } map of NON-test files. */
function checkNonTest(sources) {
  const findings = [];
  for (const [file, src] of Object.entries(sources)) {
    if (file === SEAL_FILE) continue;
    src.split('\n').forEach((text, i) => {
      const where = { file, line: i + 1, text: text.trim() };
      const mentionsModule = /youtubeSeal/.test(text);
      if (mentionsModule && !isComment(text) && !SEAL_REQUIRE.test(text)) {
        findings.push({ ...where, kind: 'the seal module used other than by `const { … } = require(…)`' });
      }
      if (isComment(text) || SEAL_REQUIRE.test(text)) return;
      for (const { kind, re } of RULES) if (re.test(text)) findings.push({ ...where, kind });
    });
  }
  return findings;
}

const MOCK_CALL = /\bjest\s*\.\s*(?:mock|doMock|setMock|unstable_mockModule|replaceProperty|spyOn)\s*\(\s*(?:['"`][^'"`]*youtubeSeal['"`]|[\w$.]*\bseal\b)/i;

/** Which test files replace the seal module, with what. */
function sealMocksIn(tests) {
  const found = [];
  for (const [file, src] of Object.entries(tests)) {
    for (const m of src.matchAll(new RegExp(MOCK_CALL.source, 'gi'))) {
      const call = src.slice(m.index, src.indexOf(');', m.index) + 2);
      found.push({ file, call });
    }
  }
  return found;
}

describe('the YouTube seal cannot be overridden outside config/youtubeSeal.js (HX-3 T2, DT-B3)', () => {
  const nonTest = nonTestSources();
  const tests = testSources();

  it('scans every non-test .js file under backend/ (app, scripts, sim, jest, root config)', () => {
    const files = Object.keys(nonTest);
    expect(files).toEqual(expect.arrayContaining([SEAL_FILE, 'app/index.js', 'scripts/gdpr-delete.js', 'jest/globalSetup.js', 'eslint.config.js']));
    expect(files.some(isTestPath)).toBe(false);
  });

  it('1–2. no non-test file declares, assigns, renames, env-reads or otherwise reaches around the seal', () => {
    expect(checkNonTest(nonTest)).toEqual([]);
  });

  it('3. only the two dormant connect/callback suites replace the module — once each, egress still false', () => {
    const mocks = sealMocksIn(tests);
    expect(mocks.map((m) => m.file).sort()).toEqual([...DORMANT_FIXTURE_FILES].sort());
    for (const { call } of mocks) {
      expect(call).toMatch(/jest\.mock\(\s*'\.\.\/app\/config\/youtubeSeal'/);
      expect(call).toMatch(/YOUTUBE_EGRESS_ENABLED:\s*false/);
      expect(call).not.toMatch(/YOUTUBE_EGRESS_ENABLED:\s*true/);
    }
  });

  it('3. each dormant fixture file says the path is dormant, pinned for real elsewhere, and deleted at D', () => {
    for (const file of DORMANT_FIXTURE_FILES) {
      const src = tests[file];
      expect(src).toMatch(/DORMANT/);
      expect(src).toContain('youtubeSeal.integration.test.js');
      expect(src).toMatch(/deleted at D/);
    }
  });

  describe('each rule catches what it is for (planted violations)', () => {
    const planted = (text) => checkNonTest({ 'app/services/x.js': text });
    // Built by concatenation so this file's own source never contains a mock call that rule 3 would count.
    const J = 'jest';

    it('the sanctioned require and a plain read are clean', () => {
      expect(planted("const { YOUTUBE_EGRESS_ENABLED } = require('../config/youtubeSeal');")).toEqual([]);
      expect(planted("const { YOUTUBE_CONNECT_ENABLED, YOUTUBE_EGRESS_ENABLED } = require('../../config/youtubeSeal');")).toEqual([]);
      expect(planted('  if (!YOUTUBE_EGRESS_ENABLED && isYoutubeContent(t)) { missed++; continue; }')).toEqual([]);
      expect(planted("  const allow = YOUTUBE_EGRESS_ENABLED ? new Set(['youtube_music']) : new Set();")).toEqual([]);
      expect(planted('// youtubeSeal is the one place these live')).toEqual([]);
    });

    it.each([
      ['a shadowing declaration', 'const YOUTUBE_EGRESS_ENABLED = true;'],
      ['a let declaration', 'let YOUTUBE_CONNECT_ENABLED = process.env.X === "1";'],
      ['a reassignment', '  YOUTUBE_CONNECT_ENABLED = true;'],
      ['a destructuring default', "const { YOUTUBE_EGRESS_ENABLED = true } = require('./other');"],
      ['a destructuring rename', "let { YOUTUBE_EGRESS_ENABLED: egress } = require('../config/youtubeSeal');"],
      ['a let require of the seal', "let { YOUTUBE_EGRESS_ENABLED } = require('../config/youtubeSeal');"],
      ['the whole module taken as an object', "const seal = require('../config/youtubeSeal');"],
      ['a require.cache override', "require.cache[require.resolve('../config/youtubeSeal')].exports = { YOUTUBE_CONNECT_ENABLED: true };"],
      ['a mock in non-test code', `${J}.mock('../app/config/youtubeSeal', () => ({ YOUTUBE_CONNECT_ENABLED: true }));`],
      ['an env lever', "const on = process.env.YOUTUBE_CONNECT_ENABLED === 'true';"],
      ['a bracket env lever', "const on = process.env['YOUTUBE_SPOTIFY_TRANSLATION_ENABLED'];"],
      ['an object carrying the key', 'module.exports = { YOUTUBE_EGRESS_ENABLED: true };'],
    ])('%s is caught', (_label, text) => {
      expect(planted(text).length).toBeGreaterThan(0);
    });

    it('a third test file mocking the seal is seen', () => {
      const mocks = sealMocksIn({
        'other.test.js': `${J}.mock('../app/config/youtubeSeal', () => ({ YOUTUBE_CONNECT_ENABLED: true, YOUTUBE_EGRESS_ENABLED: true }));`,
      });
      expect(mocks.map((m) => m.file)).toEqual(['other.test.js']);
    });
  });
});
