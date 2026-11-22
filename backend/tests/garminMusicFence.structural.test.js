'use strict';

// BE-245 (DEC-047, ADR-0018) — the Garmin music fence, pinned on the code's structure.
//
// The integration suite proves the fence on real stores for the readers and lanes that exist today. These
// rules keep it true for the code that comes later, read with espree from the source, never executed:
//   R1  every generation reader of VitalSample in backend/app applies generationVitalQuery(), outside a short
//       allow-list of non-generation readers (erasure, export and the orphan sweeps; the store's own dedupe;
//       the Health Connect projection lane);
//   R2  garminIngest never reaches persistMetrics while the fence is closed: the closed-fence return comes
//       first, and the seam reaches no store any other way;
//   R3  no BiometricLog reader applies the fence: the phone's live heart rate is stored as source 'garmin'
//       (BE-031, DT-4 L1), so a BiometricLog fence would silence a lane the Garmin terms do not cover;
//   R4  garminIngest.js's import closure holds no sockets/ module, so a Garmin push cannot reach a live socket.
// Every rule is also run on a mutated copy of the source and must fail there: none of them is vacuous.

const fs = require('fs');
const path = require('path');
const espree = require('espree');

const APP_DIR = path.join(__dirname, '../app');
const rel = (file) => path.relative(APP_DIR, file).split(path.sep).join('/');
const abs = (relPath) => path.join(APP_DIR, relPath);
const INGEST = abs('services/wearable/garminIngest.js');
const BASELINES = abs('services/biosonic/baselines.js');
const DAILY = abs('workers/dailyAnalysis.worker.js');

function appFiles(dir = APP_DIR, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) appFiles(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const parse = (src) => espree.parse(src, { ecmaVersion: 'latest', sourceType: 'script', loc: true });

// Depth-first walk that hands each node its ancestors.
function walk(node, visit, ancestors = []) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, ancestors);
  const next = [...ancestors, node];
  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent') continue;
    if (Array.isArray(value)) value.forEach((v) => walk(v, visit, next));
    else if (value && typeof value.type === 'string') walk(value, visit, next);
  }
}

const isRequireOf = (node, pattern) => node?.type === 'CallExpression' && node.callee.type === 'Identifier'
  && node.callee.name === 'require' && node.arguments[0]?.type === 'Literal' && pattern.test(String(node.arguments[0].value));

// The local names a file binds a model to: `const VitalSample = require('../../models/VitalSample')`.
function modelBindings(ast, model) {
  const names = new Set();
  const pattern = new RegExp(`(^|/)models/${model}(\\.js)?$`);
  walk(ast, (node) => {
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && isRequireOf(node.init, pattern)) names.add(node.id.name);
  });
  return names;
}

const FENCE_CALLS = new Set(['generationVitalQuery', 'fencedSources', 'garminMayShapeMusic']);
const calleeName = (call) => {
  const c = call.callee;
  if (c.type === 'Identifier') return c.name;
  if (c.type === 'MemberExpression' && !c.computed && c.property.type === 'Identifier') return c.property.name;
  return null;
};
function containsCall(node, names) {
  let found = false;
  walk(node, (n) => { if (n.type === 'CallExpression' && names.has(calleeName(n))) found = true; });
  return found;
}
const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const enclosingFunction = (ancestors) => [...ancestors].reverse().find((a) => FUNCTION_TYPES.has(a.type)) ?? null;

const VITAL_READS = new Set(['find', 'findOne', 'findById', 'aggregate', 'countDocuments', 'estimatedDocumentCount', 'distinct', 'exists', 'watch']);

// Every place a file reads through the model `binding`: a read method called on it, the model handed to a
// helper (`_pageDecrypted(VitalSample, …)`), which reads through it, or the model put in a list a loop reads
// through (`for (const Model of [BiometricLog, VitalSample])`).
function modelUses(ast, bindings, { reads = null } = {}) {
  const uses = [];
  walk(ast, (node, ancestors) => {
    if (node.type === 'ArrayExpression' && node.elements.some((e) => e?.type === 'Identifier' && bindings.has(e.name))) {
      uses.push({ node, ancestors, line: node.loc?.start.line ?? node.start });
      return;
    }
    if (node.type !== 'CallExpression') return;
    const c = node.callee;
    const onModel = c.type === 'MemberExpression' && c.object.type === 'Identifier' && bindings.has(c.object.name)
      && !c.computed && (!reads || reads.has(c.property.name));
    const handedOn = node.arguments.some((a) => a.type === 'Identifier' && bindings.has(a.name));
    if (onModel || handedOn) uses.push({ node, ancestors, line: node.loc?.start.line ?? node.start });
  });
  return uses;
}

// R1. The allow-list: readers that are not generation, each with its reason. Matched on the path relative to
// backend/app; an entry that no longer reads VitalSample fails the rule too, so the list cannot rot.
const VITAL_READ_ALLOW = [
  { match: /^services\/privacy\//, why: 'erasure, the data export and the orphan sweeps read every row, by design' },
  { match: /^services\/wearable\/metricStore\.js$/, why: 'the store\'s own dedupe read before a write' },
  { match: /^services\/wearable\/healthSampleProjection\.js$/, why: 'the Health Connect projection lane: writes and deletes its own rows' },
  { match: /^services\/wearable\/healthSampleReconciliation\.js$/, why: 'the Health Connect projection sweep: deletes orphaned rows' },
];

function vitalReaderViolations(overrides = {}, extraFiles = {}) {
  const files = [...new Set([...appFiles(), ...Object.keys(extraFiles)])];
  const readers = [];
  const violations = [];
  const allowedSeen = new Set();
  for (const file of files) {
    const src = extraFiles[file] ?? overrides[file] ?? fs.readFileSync(file, 'utf8');
    if (!src.includes('VitalSample')) continue;
    const ast = parse(src);
    const bindings = modelBindings(ast, 'VitalSample');
    if (!bindings.size) continue;
    const uses = modelUses(ast, bindings, { reads: VITAL_READS });
    if (!uses.length) continue;
    const allowed = VITAL_READ_ALLOW.find((a) => a.match.test(rel(file)));
    if (allowed) { allowedSeen.add(allowed); continue; }
    readers.push(rel(file));
    for (const use of uses) {
      const fn = enclosingFunction(use.ancestors);
      const scope = fn ?? ast;
      if (!containsCall(scope, new Set(['generationVitalQuery']))) violations.push(`${rel(file)}:${use.line}`);
    }
  }
  const staleAllow = VITAL_READ_ALLOW.filter((a) => !allowedSeen.has(a)).map((a) => String(a.match));
  return { readers, violations, staleAllow };
}

// R2. The seam's body: the closed-fence return comes before every statement that reaches persistMetrics, and
// the seam reaches no store any other way.
const STORE_REACH = /(^|\/)(models\/|healthStore|healthSample)/;
function ingestViolations(src = fs.readFileSync(INGEST, 'utf8')) {
  const ast = parse(src);
  const violations = [];
  let seam = null;
  walk(ast, (node) => {
    if (node.type === 'FunctionDeclaration' && node.id?.name === 'ingestSummaries') seam = node;
  });
  if (!seam) return ['no ingestSummaries function'];

  const isFenceGuard = (stmt) => stmt.type === 'IfStatement'
    && stmt.test.type === 'UnaryExpression' && stmt.test.operator === '!'
    && stmt.test.argument.type === 'CallExpression' && calleeName(stmt.test.argument) === 'garminMayShapeMusic'
    && (stmt.consequent.type === 'ReturnStatement'
      || (stmt.consequent.type === 'BlockStatement' && stmt.consequent.body.at(-1)?.type === 'ReturnStatement'));
  const body = seam.body.body;
  const guardAt = body.findIndex(isFenceGuard);
  if (guardAt < 0) violations.push('no closed-fence return (`if (!garminMayShapeMusic()) { …; return …; }`) in ingestSummaries');
  body.forEach((stmt, i) => {
    if (containsCall(stmt, new Set(['persistMetrics'])) && (guardAt < 0 || i < guardAt)) violations.push(`persistMetrics reached before the fence (statement ${i})`);
  });

  // persistMetrics is called nowhere else in the file, and nothing else in it writes a store.
  walk(ast, (node, ancestors) => {
    if (node.type === 'CallExpression' && calleeName(node) === 'persistMetrics' && !ancestors.includes(seam)) {
      violations.push(`persistMetrics called outside ingestSummaries (line ${node.loc?.start.line})`);
    }
    if (node.type === 'CallExpression' && ['persistVitalSamples', 'insertManyAccounted'].includes(calleeName(node))) {
      violations.push(`${calleeName(node)} called from the seam`);
    }
    if (isRequireOf(node, STORE_REACH)) violations.push(`the seam requires a store directly: ${node.arguments[0].value}`);
  });
  return violations;
}

// R3. No BiometricLog read carries the fence, in any file.
function biometricLogFenceViolations(overrides = {}) {
  const violations = [];
  for (const file of appFiles()) {
    const src = overrides[file] ?? fs.readFileSync(file, 'utf8');
    if (!src.includes('BiometricLog')) continue;
    const ast = parse(src);
    const bindings = modelBindings(ast, 'BiometricLog');
    if (!bindings.size) continue;
    for (const use of modelUses(ast, bindings)) {
      if (containsCall(use.node, FENCE_CALLS)) violations.push(`${rel(file)}:${use.line}`);
      // a query object built beforehand and passed by name: follow one level, inside the same function
      const fn = enclosingFunction(use.ancestors);
      for (const arg of use.node.arguments ?? use.node.elements ?? []) {
        if (arg.type !== 'Identifier' || !fn) continue;
        walk(fn, (n) => {
          if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.id.name === arg.name && n.init && containsCall(n.init, FENCE_CALLS)) {
            violations.push(`${rel(file)}:${use.line} (via ${arg.name})`);
          }
        });
      }
    }
  }
  return violations;
}

// R4. Every file reachable from `entry` through relative require() calls, lazy ones included (the P15 walk of
// shadow.fullSystem.test.js). `overrides` replaces a file's source.
function relativeRequireClosure(entry, overrides = {}) {
  const seen = new Set();
  const queue = [entry];
  const resolve = (from, spec) => {
    const base = path.resolve(path.dirname(from), spec);
    return [base, `${base}.js`, path.join(base, 'index.js')].find((p) => p.endsWith('.js') && fs.existsSync(p));
  };
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const ast = parse(overrides[file] ?? fs.readFileSync(file, 'utf8'));
    walk(ast, (node) => {
      if (!isRequireOf(node, /^\./)) return;
      const target = resolve(file, node.arguments[0].value);
      if (target && !seen.has(target)) queue.push(target);
    });
  }
  seen.delete(entry);
  return [...seen].map(rel);
}
const socketModules = (overrides) => relativeRequireClosure(INGEST, overrides).filter((p) => p.startsWith('sockets/'));

const read = (file) => fs.readFileSync(file, 'utf8');
function mutate(file, from, to) {
  const src = read(file);
  expect(src).toContain(from); // the mutation really applies
  return { [file]: src.split(from).join(to) };
}

describe('R1 — every generation reader of VitalSample applies generationVitalQuery()', () => {
  it('holds on the shipped code, and it found today\'s two generation readers', () => {
    const { readers, violations, staleAllow } = vitalReaderViolations();
    expect(readers).toEqual(expect.arrayContaining(['services/biosonic/baselines.js', 'workers/dailyAnalysis.worker.js']));
    expect(violations).toEqual([]);
    expect(staleAllow).toEqual([]);
  });

  it('mutated: baselines without the filter fails', () => {
    const { violations } = vitalReaderViolations(mutate(BASELINES, 'generationVitalQuery()', '{}'));
    expect(violations.some((v) => v.startsWith('services/biosonic/baselines.js:'))).toBe(true);
  });

  it('mutated: the daily-analysis worker without the filter fails', () => {
    const { violations } = vitalReaderViolations(mutate(DAILY, 'generationVitalQuery()', '{}'));
    expect(violations.some((v) => v.startsWith('workers/dailyAnalysis.worker.js:'))).toBe(true);
  });

  it('mutated: a new reader that forgets the filter fails, whether it reads directly or hands the model on', () => {
    const planted = abs('services/biosonic/__plantedReader.js');
    const { violations } = vitalReaderViolations({}, {
      [planted]: [
        "const VitalSample = require('../../models/VitalSample');",
        'async function direct(userId) { return VitalSample.find({ userId }); }',
        'async function handedOn(userId) { return pageAll(VitalSample, userId); }',
        'async function pageAll(Model, userId) { return Model.find({ userId }); }',
        'module.exports = { direct, handedOn };',
      ].join('\n'),
    });
    expect(violations.filter((v) => v.startsWith('services/biosonic/__plantedReader.js:'))).toHaveLength(2);
  });

  it('mutated: an allow-list entry that no longer reads VitalSample is reported stale', () => {
    const metricStore = abs('services/wearable/metricStore.js');
    const src = read(metricStore).replace(/require\('\.\.\/\.\.\/models\/VitalSample'\)/, "require('../../models/Elsewhere')");
    expect(src).not.toEqual(read(metricStore));
    const { staleAllow } = vitalReaderViolations({ [metricStore]: src });
    expect(staleAllow).toEqual([String(/^services\/wearable\/metricStore\.js$/)]);
  });
});

describe('R2 — garminIngest never reaches persistMetrics while the fence is closed', () => {
  it('holds on the shipped seam', () => {
    expect(ingestViolations()).toEqual([]);
  });

  it('mutated: the closed-fence return removed fails', () => {
    const src = read(INGEST).replace(/if \(!garminMayShapeMusic\(\)\) \{[\s\S]*?\n {2}\}\n/, '');
    expect(src).not.toEqual(read(INGEST));
    expect(ingestViolations(src)).toEqual(expect.arrayContaining([expect.stringContaining('no closed-fence return')]));
  });

  it('mutated: the guard inverted fails', () => {
    const [[, src]] = Object.entries(mutate(INGEST, 'if (!garminMayShapeMusic())', 'if (garminMayShapeMusic())'));
    expect(ingestViolations(src).length).toBeGreaterThan(0);
  });

  it('mutated: a guard that logs but does not return fails', () => {
    const src = read(INGEST).replace(/(if \(!garminMayShapeMusic\(\)\) \{[\s\S]*?)\n\s+return fencedDrop\(gated\.length\);/, '$1');
    expect(src).not.toEqual(read(INGEST));
    expect(ingestViolations(src).length).toBeGreaterThan(0);
  });

  it('mutated: persistMetrics reached before the guard, or from another function, or a store required directly, fails', () => {
    const before = read(INGEST).replace('  const metrics = [];', '  await persistMetrics(userId, []);\n  const metrics = [];');
    expect(ingestViolations(before)).toEqual(expect.arrayContaining([expect.stringContaining('before the fence')]));
    const elsewhere = `${read(INGEST)}\nasync function backdoor(u, m) { return persistMetrics(u, m); }\n`;
    expect(ingestViolations(elsewhere)).toEqual(expect.arrayContaining([expect.stringContaining('outside ingestSummaries')]));
    const direct = `${read(INGEST)}\nconst VitalSample = require('../../models/VitalSample');\n`;
    expect(ingestViolations(direct)).toEqual(expect.arrayContaining([expect.stringContaining('requires a store directly')]));
  });
});

describe('R3 — no BiometricLog reader applies the fence (the phone lane is labelled garmin too, BE-031)', () => {
  it('holds on the shipped code', () => {
    expect(biometricLogFenceViolations()).toEqual([]);
  });

  it('mutated: the fence added to baselines\' BiometricLog page fails', () => {
    const src = read(BASELINES).replace(/_pageDecrypted\(BiometricLog, userId, since, \(doc\) => \{([\s\S]*?)\n {2}\}\);/, '_pageDecrypted(BiometricLog, userId, since, (doc) => {$1\n  }, generationVitalQuery());');
    expect(src).not.toEqual(read(BASELINES));
    expect(biometricLogFenceViolations({ [BASELINES]: src }).some((v) => v.startsWith('services/biosonic/baselines.js:'))).toBe(true);
  });

  it('mutated: a BiometricLog query built with the fence and passed by name fails', () => {
    const planted = abs('services/biosonic/baselines.js');
    const src = `${read(planted)}\nasync function _planted(userId) { const q = { userId, ...generationVitalQuery() }; return BiometricLog.find(q); }\n`;
    expect(biometricLogFenceViolations({ [planted]: src }).some((v) => v.includes('via q'))).toBe(true);
  });
});

describe('R4 — garminIngest.js\'s import closure holds no sockets/ module', () => {
  it('holds on the shipped code, and the walk is not vacuous (it reaches the store and the fence)', () => {
    const closure = relativeRequireClosure(INGEST);
    expect(closure).toEqual(expect.arrayContaining(['services/wearable/metricStore.js', 'services/wearable/garminMusicFence.js', 'models/BiometricLog.js']));
    expect(socketModules()).toEqual([]);
  });

  it('mutated: a socket module required from the seam, or lazily from a module it reaches, fails', () => {
    expect(socketModules({ [INGEST]: `${read(INGEST)}\nconst { getIo } = require('../../sockets');\n` })).toEqual(expect.arrayContaining(['sockets/index.js']));
    const metricStore = abs('services/wearable/metricStore.js');
    const lazy = `${read(metricStore)}\nfunction later() { return require('../../sockets/biometricHandler'); }\n`;
    expect(socketModules({ [metricStore]: lazy })).toEqual(expect.arrayContaining(['sockets/biometricHandler.js']));
  });
});
