'use strict';

// J2 (BE-084; Plan B T3, DT-3 E1) — who may write a queue's meta hash in Redis.
//
// The state-recompute event log is bounded at 100 entries by a value BullMQ keeps in the queue's meta
// hash (`opts.maxLenEvents`). Every BullMQ Queue built WITHOUT `skipMetasUpdate: true` rewrites that hash
// with its own options as soon as it connects, and a Queue built without `streams.events.maxLen` writes
// BullMQ's default, 10000. So one script or purge opening the queue the plain way would lift the bound,
// silently, until the app's producer next starts (proven on real Redis in
// stateVectorEvents.redis.test.js). The app's producer, `getQueue` in queues/queue.js, is therefore the
// one place that may build a Queue that writes the meta, and it must carry the bound; every other
// `new Queue(` in shipped code (app/, scripts/, sim/) passes `skipMetasUpdate: true`. Tests are not
// scanned: they build plain queues on purpose, to seed what the old code left.
//
// Pure source parsing, no Redis. The detector runs on synthetic sources first, so a guard that silently
// matches nothing fails instead of passing.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SHIPPED = ['app', 'scripts', 'sim'];
const PRODUCER = 'app/queues/queue.js';

const read = (file) => fs.readFileSync(file, 'utf8');
const rel = (file) => path.relative(ROOT, file).split(path.sep).join('/');

function sourceFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

// Comments mention `new Queue(` in prose; only code counts. (A `//` after a colon is a URL, not a comment.)
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** The text between the parenthesis at `open` and the one that closes it. */
function argumentsAt(src, open) {
  let depth = 1;
  let i = open + 1;
  while (depth > 0 && i < src.length) {
    if (src[i] === '(') depth += 1;
    else if (src[i] === ')') depth -= 1;
    i += 1;
  }
  return src.slice(open + 1, i - 1);
}

/** The span of the block that follows `function <name>(`, or null. */
function functionSpan(src, name) {
  const start = src.search(new RegExp(`function\\s+${name}\\s*\\(`));
  if (start < 0) return null;
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return [start, i + 1];
    }
  }
  return null;
}

/**
 * Every construction of BullMQ's Queue in one source: under its own name, a destructured alias
 * (`{ Queue: Q }`), or through the module object (`bullmq.Queue`, `require('bullmq').Queue`).
 */
function queueConstructions(src) {
  const code = stripComments(src);
  if (!/\bbullmq\b/.test(code)) return [];
  const names = new Set();
  for (const m of code.matchAll(/\{([^}]*)\}\s*=\s*require\(\s*['"]bullmq['"]\s*\)/g)) {
    for (const part of m[1].split(',')) {
      const [imported, local] = part.split(':').map((s) => s.trim());
      if (imported === 'Queue') names.add(local || imported);
    }
  }
  for (const m of code.matchAll(/([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"]bullmq['"]\s*\)\s*\.\s*Queue\b/g)) names.add(m[1]);
  const modules = [...code.matchAll(/([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"]bullmq['"]\s*\)\s*;/g)].map((m) => m[1]);
  const callee = [
    ...[...names].map((n) => n.replace(/\$/g, '\\$')),
    ...modules.map((m) => `${m.replace(/\$/g, '\\$')}\\s*\\.\\s*Queue`),
    'require\\(\\s*[\'"]bullmq[\'"]\\s*\\)\\s*\\.\\s*Queue\\s*\\)',
  ];
  const re = new RegExp(`\\bnew\\s+\\(?\\s*(?:${callee.join('|')})\\s*\\(`, 'g');
  return [...code.matchAll(re)].map((m) => ({
    at: m.index,
    args: argumentsAt(code, m.index + m[0].length - 1),
  }));
}

const skipsMeta = (args) => /\bskipMetasUpdate\s*:\s*true\b/.test(args);

/** All constructions in the shipped tree, each marked when it is the producer's own in getQueue. */
function shippedConstructions() {
  return SHIPPED.flatMap((dir) => sourceFiles(path.join(ROOT, dir))).flatMap((file) => {
    const src = read(file);
    const span = rel(file) === PRODUCER ? functionSpan(stripComments(src), 'getQueue') : null;
    return queueConstructions(src).map((c) => ({
      file: rel(file),
      args: c.args,
      producer: !!span && c.at >= span[0] && c.at < span[1],
    }));
  });
}

describe('the detector is not vacuous', () => {
  it('finds a plain construction, an alias, the module object and an inline require, and reads their options', () => {
    const plain = queueConstructions("const { Queue } = require('bullmq'); const q = new Queue('x', { connection });");
    const alias = queueConstructions("const { Worker, Queue: Q } = require('bullmq'); new Q('x', { connection, skipMetasUpdate: true });");
    const module = queueConstructions("const bullmq = require('bullmq'); new bullmq.Queue('x', { connection });");
    const inline = queueConstructions("require('bullmq'); const q = new (require('bullmq').Queue)('x', {});");
    const off = queueConstructions("const { Queue } = require('bullmq'); new Queue('x', { skipMetasUpdate: false });");
    const other = queueConstructions("const { QueueEvents } = require('bullmq'); new QueueEvents('x', { connection });");
    expect([plain, alias, module, inline, off].map((found) => found.length)).toEqual([1, 1, 1, 1, 1]);
    expect(other).toEqual([]);
    expect(skipsMeta(plain[0].args)).toBe(false);
    expect(skipsMeta(alias[0].args)).toBe(true);
    expect(skipsMeta(module[0].args)).toBe(false);
    expect(skipsMeta(off[0].args)).toBe(false);
  });

  it('finds the constructions in the shipped tree: the producer, the purge and the operator script', () => {
    const files = shippedConstructions().map((c) => c.file);
    expect(files).toEqual(expect.arrayContaining([PRODUCER, 'app/queues/userJobPurge.js', 'scripts/rewardJobs.js']));
  });
});

describe('only the app\'s producer may write a queue\'s meta hash', () => {
  it('getQueue in queues/queue.js is the one construction that writes it, and it carries the event-log bounds', () => {
    const producers = shippedConstructions().filter((c) => c.producer);
    expect(producers).toHaveLength(1);
    expect(skipsMeta(producers[0].args)).toBe(false);
    const code = stripComments(read(path.join(ROOT, PRODUCER)));
    const [from, to] = functionSpan(code, 'getQueue');
    expect(code.slice(from, to)).toMatch(/\bQUEUE_EVENTS_MAX_LEN\b|\bqueueOptions\(/);
  });

  it('every other new Queue( in app/, scripts/ and sim/ passes skipMetasUpdate: true', () => {
    const violations = shippedConstructions()
      .filter((c) => !c.producer && !skipsMeta(c.args))
      .map((c) => `${c.file}: new Queue(${c.args.replace(/\s+/g, ' ')})`);
    expect(violations).toEqual([]);
  });
});
