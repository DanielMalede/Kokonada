'use strict';

// J1 T10 (DEC-125; the owner's ruling: ship only rewardJobs.js) — which scripts the production image
// carries. Pure source parsing: no Docker, no network.
//
// backend/scripts/ also holds mock and test-data generators (mock-biometrics.js, biometric-mock.js*)
// that must never reach production, and operator tools that run elsewhere. Exactly one script ships:
// scripts/rewardJobs.js, the counted one-off the owner runs with `railway ssh`. So:
//   (a) the Dockerfile copies nothing from scripts/ but that one file, and nothing that would carry the
//       folder with it (the whole build context, a root glob);
//   (b) everything that file requires resolves in the image: app/ modules (and theirs), Node built-ins
//       and `dependencies`. Never a devDependency (`npm ci --omit=dev`), never another script, never
//       a file outside app/;
//   (c) .dockerignore does not exclude it.
// Each rule is a function that the planted violations below prove can fail, then runs on the real files.

const fs = require('fs');
const path = require('path');
const { builtinModules } = require('module');

const BACKEND = path.join(__dirname, '..');
const APP_DIR = path.join(BACKEND, 'app');
const SCRIPTS_DIR = path.join(BACKEND, 'scripts');
const SHIPPED = 'scripts/rewardJobs.js';
const SHIPPED_PATH = path.join(BACKEND, SHIPPED);
const pkg = require('../package.json');

// ── (a) the Dockerfile ──────────────────────────────────────────────────────────────────────────

/** Instructions with continuations joined and comments dropped: [{ index, op, args }]. */
function instructions(dockerfile) {
  const joined = dockerfile.replace(/\\\r?\n/g, ' ');
  return joined.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    .map((line, index) => {
      const [op, ...rest] = line.split(/\s+/);
      return { index, op: op.toUpperCase(), line, rest };
    });
}

/** The sources and destination of a COPY/ADD (shell or JSON form), without its --flags. */
function copyParts(instr) {
  const body = instr.line.slice(instr.line.indexOf(instr.rest[0]));
  const tokens = body.trim().startsWith('[') ? JSON.parse(body.trim()) : instr.rest.filter((t) => !t.startsWith('--'));
  const flags = instr.rest.filter((t) => t.startsWith('--'));
  return { flags, sources: tokens.slice(0, -1), dest: tokens[tokens.length - 1] };
}

const norm = (p) => p.replace(/^\.\//, '').replace(/\/+$/, '');
// Whether a root-level glob (`*`, `s*`, `package*.json`) can match the folder name `scripts`.
const globCatches = (segment, name) => new RegExp(`^${segment.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`).test(name);

/** Every way the Dockerfile puts a script into the image, and every violation of rule (a). */
function scriptCopies(dockerfile) {
  const violations = [];
  const shipped = [];
  const all = instructions(dockerfile);
  for (const instr of all.filter((i) => i.op === 'COPY' || i.op === 'ADD')) {
    const { flags, sources, dest } = copyParts(instr);
    if (flags.some((f) => f.startsWith('--from'))) continue; // another build stage, not the context
    for (const raw of sources) {
      const src = norm(raw);
      const first = src.split('/')[0];
      if (src === '' || src === '.' || (/[*?[]/.test(first) && globCatches(first, 'scripts'))) {
        violations.push(`${instr.line}: copies the build context root, which carries scripts/`);
      } else if (first === 'scripts' && src !== SHIPPED) {
        violations.push(`${instr.line}: ships ${src}`);
      } else if (src === SHIPPED) {
        shipped.push({ index: instr.index, dest: norm(dest) });
      }
    }
  }
  const chown = all.find((i) => i.op === 'RUN' && /chown\b.*\/app/.test(i.line));
  return { violations, shipped, chownIndex: chown ? chown.index : -1 };
}

// ── (b) what rewardJobs.js requires ─────────────────────────────────────────────────────────────

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const packageName = (spec) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
const inside = (dir, file) => !path.relative(dir, file).startsWith('..') && !path.isAbsolute(path.relative(dir, file));

/**
 * Walks every string-literal require() from `entry` through the app/ modules it loads. `read` lets a
 * test plant a source for a path. Returns the violations of rule (b).
 */
function requireViolations(entry, { read = (f) => fs.readFileSync(f, 'utf8'), deps = pkg.dependencies, devDeps = pkg.devDependencies } = {}) {
  const violations = [];
  const seen = new Set([entry]);
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift();
    const from = path.relative(BACKEND, file).split(path.sep).join('/');
    for (const [, spec] of stripComments(read(file)).matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      if (spec.startsWith('.')) {
        let target;
        try {
          target = require.resolve(path.resolve(path.dirname(file), spec));
        } catch {
          violations.push(`${from}: ${spec} does not resolve`);
          continue;
        }
        if (inside(SCRIPTS_DIR, target)) violations.push(`${from}: ${spec} is another script`);
        else if (!inside(APP_DIR, target)) violations.push(`${from}: ${spec} is outside app/, which the image does not ship`);
        else if (!seen.has(target)) {
          seen.add(target);
          queue.push(target);
        }
      } else if (spec.startsWith('node:') || builtinModules.includes(spec)) {
        continue;
      } else if (deps[packageName(spec)]) {
        continue;
      } else if (devDeps[packageName(spec)]) {
        violations.push(`${from}: ${spec} is a devDependency (the image runs npm ci --omit=dev)`);
      } else {
        violations.push(`${from}: ${spec} is not a dependency`);
      }
    }
  }
  return violations;
}

// ── (c) .dockerignore ───────────────────────────────────────────────────────────────────────────

/** Docker's matching: `*` and `?` stay inside one path segment, `**` crosses them, a matched directory takes its contents. */
function ignoreRegex(pattern) {
  const p = pattern.replace(/^\/+/, '').replace(/\/+$/, '');
  let out = '';
  for (let i = 0; i < p.length; i += 1) {
    if (p.startsWith('**/', i)) { out += '(?:.*/)?'; i += 2; } else if (p.startsWith('**', i)) { out += '.*'; i += 1; } else if (p[i] === '*') out += '[^/]*';
    else if (p[i] === '?') out += '[^/]';
    else out += p[i].replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}(?:/.*)?$`);
}

/** Whether `rel` (relative to the build context) is excluded; the last matching line wins, `!` re-includes. */
function dockerignoreExcludes(dockerignore, rel) {
  let excluded = false;
  for (const line of dockerignore.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))) {
    const negated = line.startsWith('!');
    if (ignoreRegex(negated ? line.slice(1) : line).test(rel)) excluded = !negated;
  }
  return excluded;
}

const INTENDED = [
  'FROM node:24-slim', 'WORKDIR /app', 'COPY package*.json ./', 'RUN npm ci --omit=dev', 'COPY app/ ./app/',
  `COPY ${SHIPPED} ./${SHIPPED}`, 'RUN chown -R node:node /app', 'USER node',
].join('\n');

describe('the rules can fail (planted violations)', () => {
  it.each([
    ['the whole folder', 'COPY scripts/ ./scripts/'],
    ['the folder without a slash', 'COPY scripts ./scripts'],
    ['a mock generator', 'COPY scripts/mock-biometrics.js ./scripts/'],
    ['a glob over the folder', 'COPY scripts/*.js ./scripts/'],
    ['a glob that also catches the shipped one', 'COPY scripts/reward*.js ./scripts/'],
    ['ADD of a generator', 'ADD scripts/biometric-mock.js /tmp/'],
    ['with --chown', 'COPY --chown=node:node scripts/ ./scripts/'],
    ['the build context root', 'COPY . .'],
    ['the context root as ./', 'COPY ./ ./'],
    ['a root glob', 'COPY * ./'],
    ['a root glob that matches the folder name', 'COPY s* ./'],
    ['JSON form', 'COPY ["scripts/", "./scripts/"]'],
    ['a second source on a continued line', `COPY ${SHIPPED} \\\n    scripts/gdpr-delete.js ./scripts/`],
  ])('(a) %s fails', (_what, line) => {
    expect(scriptCopies(`${INTENDED}\n${line}`).violations).not.toEqual([]);
  });

  it('(a) the intended Dockerfile passes, and a missing or late copy is seen', () => {
    const ok = scriptCopies(INTENDED);
    expect(ok.violations).toEqual([]);
    expect(ok.shipped).toEqual([{ index: 5, dest: SHIPPED }]);
    expect(scriptCopies(INTENDED.replace(`COPY ${SHIPPED} ./${SHIPPED}\n`, '')).shipped).toEqual([]);
    const late = scriptCopies(`${INTENDED.replace(`COPY ${SHIPPED} ./${SHIPPED}\n`, '')}\nCOPY ${SHIPPED} ./${SHIPPED}`);
    expect(late.shipped[0].index).toBeGreaterThan(late.chownIndex);
  });

  it('(a) a root glob that cannot match scripts/ (the package files) passes', () => {
    expect(scriptCopies(`${INTENDED}\nCOPY package*.json tsconfig.json ./`).violations).toEqual([]);
  });

  it('(a) a COPY from another build stage is not the build context', () => {
    expect(scriptCopies(`${INTENDED}\nCOPY --from=build /out/scripts/ ./x/`).violations).toEqual([]);
  });

  it.each([
    ['a devDependency', "require('jest')", /devDependency/],
    ['a package not in package.json', "require('left-pad-j1-planted')", /not a dependency/],
    ['another script', "require('./gdpr-delete')", /another script/],
    ['a mock generator', "require('./mock-biometrics')", /another script/],
    ['a file outside app/', "require('../tests/helpers/realRedis')", /outside app\//],
    ['a path that does not exist', "require('../app/config/no-such-module')", /does not resolve/],
  ])('(b) requiring %s fails', (_what, call, reason) => {
    const planted = `'use strict';\nconst x = ${call};\nconst ok = require('../app/config/db');\n`;
    const read = (f) => (f === SHIPPED_PATH ? planted : fs.readFileSync(f, 'utf8'));
    const violations = requireViolations(SHIPPED_PATH, { read });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(reason);
  });

  it('(b) a devDependency reached through an app/ module fails too', () => {
    const DB = path.join(APP_DIR, 'config/db.js');
    const read = (f) => (f === DB ? "const s = require('supertest');" : fs.readFileSync(f, 'utf8'));
    expect(requireViolations(SHIPPED_PATH, { read })).toEqual(['app/config/db.js: supertest is a devDependency (the image runs npm ci --omit=dev)']);
  });

  it('(b) a require inside a comment is not code', () => {
    const read = (f) => (f === SHIPPED_PATH ? "// require('jest')\n/* require('./gdpr-delete') */\nrequire('ioredis');" : fs.readFileSync(f, 'utf8'));
    expect(requireViolations(SHIPPED_PATH, { read })).toEqual([]);
  });

  it.each([
    ['scripts/'], ['scripts'], ['scripts/*'], ['scripts/*.js'], ['**/rewardJobs.js'], ['scripts/reward*'], ['**'],
  ])('(c) .dockerignore line %p excludes it', (line) => {
    expect(dockerignoreExcludes(`node_modules/\n${line}\n`, SHIPPED)).toBe(true);
  });

  it.each([
    ['*.js'], ['rewardJobs.js'], ['tests/'], ['*.test.js'], ['scripts/mock-biometrics.js'], ['scripts/\n!scripts/rewardJobs.js'],
  ])('(c) .dockerignore line %p leaves it in', (line) => {
    expect(dockerignoreExcludes(`node_modules/\n${line}\n`, SHIPPED)).toBe(false);
  });
});

describe('the production image ships scripts/rewardJobs.js and no other script', () => {
  const dockerfile = fs.readFileSync(path.join(BACKEND, 'Dockerfile'), 'utf8');

  it('(a) the Dockerfile copies nothing from scripts/ but scripts/rewardJobs.js', () => {
    expect(scriptCopies(dockerfile).violations).toEqual([]);
  });

  it('(a) it copies it once, to /app/scripts/rewardJobs.js, before /app is handed to the node user', () => {
    const { shipped, chownIndex } = scriptCopies(dockerfile);
    expect(shipped).toHaveLength(1);
    expect(shipped[0].dest).toBe(SHIPPED);
    expect(dockerfile).toMatch(/^WORKDIR \/app$/m);
    expect(chownIndex).toBeGreaterThan(-1);
    expect(shipped[0].index).toBeLessThan(chownIndex);
  });

  it('(b) everything it requires resolves in the image: app/, built-ins and dependencies only', () => {
    expect(requireViolations(SHIPPED_PATH)).toEqual([]);
  });

  it('(b) the walk is not vacuous: it reaches app/ and the packages the script uses', () => {
    const reached = stripComments(fs.readFileSync(SHIPPED_PATH, 'utf8'));
    for (const spec of ['ioredis', 'mongoose', 'bullmq', '../app/config/db', '../app/queues/definitions']) {
      expect(reached).toContain(`require('${spec}')`);
    }
  });

  it('(c) .dockerignore does not exclude it', () => {
    expect(dockerignoreExcludes(fs.readFileSync(path.join(BACKEND, '.dockerignore'), 'utf8'), SHIPPED)).toBe(false);
  });

  it('the generators and the other scripts stay out (every other file in scripts/ is checked by name)', () => {
    const others = fs.readdirSync(SCRIPTS_DIR).filter((f) => `scripts/${f}` !== SHIPPED);
    expect(others).toEqual(expect.arrayContaining(['mock-biometrics.js', 'gdpr-delete.js']));
    for (const f of others) expect(dockerfile).not.toContain(`scripts/${f}`);
  });
});
