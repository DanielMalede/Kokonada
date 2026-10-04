'use strict';

// J2 (BE-094; DT-13 FINAL §E) — who can reach the sweep of deleted accounts' data, and how.
//
// The sweep erases accounts' data, and only an armed marker lets the nightly run do it. So the ways in are
// pinned, over every non-test source in app/ and scripts/:
//   (a) a string literal containing `orphanSweep` appears only in orphanSweep.js and in the daily job's one
//       require line (a path spelled another way would still contain the word: requires are not parsed);
//   (b) that job destructures exactly one export and calls it only as `<name>()`, with no argument (never
//       forced, never told it is armed): the identifier appears exactly twice in the job;
//   (c) the identifiers `armOrphanSweep` and `sweepDeletedAccountOrphans` appear nowhere else, except as that
//       job's single entry point;
//   (d) the string literals `opsmarkers` and `orphan-sweep` appear only in orphanSweep.js.
// The private count tool, which arms and forces, lives outside the repository.
//
// Pure source scanning with espree tokens (comments are not tokens). The detectors run on planted sources
// first, so a guard that silently matches nothing fails instead of passing.

const fs = require('fs');
const path = require('path');
const espree = require('espree');

const ROOT = path.join(__dirname, '..');
const SWEEP = 'app/services/privacy/orphanSweep.js';
const WORKER = 'app/workers/sessionTrim.worker.js';
const IDENTIFIERS = ['armOrphanSweep', 'sweepDeletedAccountOrphans'];
const LITERALS = ['opsmarkers', 'orphan-sweep'];

function sourceFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}
const rel = (file) => path.relative(ROOT, file).split(path.sep).join('/');
const tokensOf = (code) => espree.tokenize(code.replace(/^#!.*/, ''), { ecmaVersion: 'latest', sourceType: 'script' });
const isLiteral = (t) => t.type === 'String' || t.type === 'Template';

/** Every guard's violations over a list of { file, code }; empty when all four hold. */
function violations(sources) {
  const out = [];
  const tokens = sources.map(({ file, code }) => ({ file, tokens: tokensOf(code) }));
  for (const { file, tokens: toks } of tokens) {
    if (file === SWEEP) continue;
    // (a)
    const named = toks.filter((t) => isLiteral(t) && t.value.includes('orphanSweep'));
    if (file !== WORKER && named.length) out.push(`(a) ${file} names orphanSweep in a string`);
    if (file === WORKER && named.length !== 1) out.push(`(a) ${WORKER} names orphanSweep in ${named.length} strings, not 1`);
    // (c)
    for (const id of IDENTIFIERS) {
      if (file !== WORKER && toks.some((t) => t.type === 'Identifier' && t.value === id)) out.push(`(c) ${file} uses ${id}`);
    }
    if (file === WORKER && toks.some((t) => t.type === 'Identifier' && t.value === 'armOrphanSweep')) out.push(`(c) ${WORKER} uses armOrphanSweep`);
    // (d)
    for (const literal of LITERALS) {
      if (toks.some((t) => isLiteral(t) && t.value.includes(literal))) out.push(`(d) ${file} has the literal ${literal}`);
    }
  }
  // (b)
  const worker = tokens.find((t) => t.file === WORKER);
  if (!worker) {
    out.push(`(b) ${WORKER} is missing`);
    return out;
  }
  const toks = worker.tokens;
  const at = toks.findIndex((t) => isLiteral(t) && t.value.includes('orphanSweep'));
  // `const { <name> } = require( '<…orphanSweep>' )`, read backwards from the path literal.
  const shape = at >= 7 && toks[at - 1].value === '(' && toks[at - 2].value === 'require' && toks[at - 3].value === '='
    && toks[at - 4].value === '}' && toks[at - 5].type === 'Identifier' && toks[at - 6].value === '{' && toks[at - 7].value === 'const';
  if (!shape) {
    out.push(`(b) ${WORKER} does not destructure exactly one export from the sweep`);
    return out;
  }
  const name = toks[at - 5].value;
  if (!IDENTIFIERS.includes(name)) out.push(`(b) ${WORKER} imports ${name}, not the sweep's entry point`);
  const uses = toks.map((t, i) => [t, i]).filter(([t]) => t.type === 'Identifier' && t.value === name);
  if (uses.length !== 2) out.push(`(b) ${name} appears ${uses.length} times in ${WORKER}, not 2`);
  for (const [, i] of uses.slice(1)) {
    if (!(toks[i + 1]?.value === '(' && toks[i + 2]?.value === ')')) out.push(`(b) ${name} is not called as ${name}()`);
  }
  return out;
}

const WORKER_OK = "const { sweepDeletedAccountOrphans } = require('../services/privacy/orphanSweep');\nconst steps = [() => sweepDeletedAccountOrphans()];";
const sweepSrc = { file: SWEEP, code: "const c = 'opsmarkers'; function armOrphanSweep() {} function sweepDeletedAccountOrphans() {}" };

describe('the detectors are not vacuous', () => {
  it('the clean shape passes', () => {
    expect(violations([sweepSrc, { file: WORKER, code: WORKER_OK }])).toEqual([]);
  });

  it.each([
    ['(a) a second module names the sweep\'s path', [{ file: 'app/x.js', code: "const s = require('./services/privacy/' + 'orphanSweep');" }], /\(a\) app\/x\.js/],
    ['(a) the worker names it twice', [{ file: WORKER, code: `${WORKER_OK}\nconst p = '../services/privacy/orphanSweep.js';` }], /\(a\) .*2 strings/],
    ['(b) a forced call', [{ file: WORKER, code: WORKER_OK.replace('sweepDeletedAccountOrphans()];', 'sweepDeletedAccountOrphans({ force: true })];') }], /\(b\) .*not called as/],
    ['(b) a second export', [{ file: WORKER, code: WORKER_OK.replace('{ sweepDeletedAccountOrphans }', '{ sweepDeletedAccountOrphans, armOrphanSweep }') }], /\(b\) .*exactly one export/],
    ['(b) a third use', [{ file: WORKER, code: `${WORKER_OK}\nconst again = sweepDeletedAccountOrphans;` }], /\(b\) .*3 times/],
    ['(c) another module arms', [{ file: 'scripts/arm.js', code: 'armOrphanSweep({});' }], /\(c\) scripts\/arm\.js uses armOrphanSweep/],
    ['(c) another module sweeps', [{ file: 'app/y.js', code: 'x.sweepDeletedAccountOrphans();' }], /\(c\) app\/y\.js uses sweepDeletedAccountOrphans/],
    ['(d) the marker collection named elsewhere', [{ file: 'app/z.js', code: "db.collection('opsmarkers');" }], /\(d\) app\/z\.js has the literal opsmarkers/],
    ['(d) the marker id named elsewhere', [{ file: 'scripts/w.js', code: 'const id = `orphan-sweep`;' }], /\(d\) scripts\/w\.js has the literal orphan-sweep/],
  ])('%s', (_why, planted, expected) => {
    const sources = [sweepSrc, { file: WORKER, code: WORKER_OK }].filter((s) => !planted.some((p) => p.file === s.file));
    const found = violations([...sources, ...planted]);
    expect(found.some((v) => expected.test(v))).toBe(true);
  });

  it('a comment is not a token: prose about the sweep is allowed', () => {
    expect(violations([sweepSrc, { file: WORKER, code: WORKER_OK }, { file: 'app/c.js', code: "// see orphanSweep.js, armOrphanSweep and 'opsmarkers'\nconst a = 1;" }])).toEqual([]);
  });
});

describe('the shipped tree', () => {
  const sources = ['app', 'scripts'].flatMap((dir) => sourceFiles(path.join(ROOT, dir)))
    .map((file) => ({ file: rel(file), code: fs.readFileSync(file, 'utf8') }));

  it('scans the sweep, the daily job and the rest of app/ and scripts/', () => {
    expect(sources.map((s) => s.file)).toEqual(expect.arrayContaining([SWEEP, WORKER, 'scripts/gdpr-delete.js']));
    expect(sources.length).toBeGreaterThan(100);
  });

  it('(a)–(d) hold', () => {
    expect(violations(sources)).toEqual([]);
  });

  it('the daily job\'s single entry point is the sweep, called with no argument', () => {
    const worker = sources.find((s) => s.file === WORKER).code;
    expect(worker).toContain("const { sweepDeletedAccountOrphans } = require('../services/privacy/orphanSweep');");
    expect(worker).toContain('await sweepDeletedAccountOrphans();');
  });
});
