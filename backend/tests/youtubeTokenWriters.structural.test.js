'use strict';

// HX-3 T2 (DEC-122; compliance verdicts §1, NR-1) — the only code that can WRITE a YouTube token is
// the code the seal covers.
//
// Every YouTube Data API call needs a stored user token, so "no YouTube data can come to exist" (I2)
// holds exactly as long as nothing new can store one. Two writers exist, and both sit behind the seal:
//   • the OAuth callback (controllers/integrationsController.js youtubeCallback) — sealed by
//     YOUTUBE_CONNECT_ENABLED before it reads the code;
//   • the refresh (services/youtube.js getValidToken) — which needs a token that already exists.
// This suite makes that a CI fact rather than a reading of today's code, over every non-test `.js`
// file under backend/app and backend/scripts:
//   (a) `setToken('youtubeMusicToken'` (either quote, any spacing) appears exactly twice, once in
//       each of the two writers above;
//   (b) the first argument of every `setToken(` call is a plain string literal, so a computed field
//       name cannot reach the token by another spelling;
//   (c) every line that names `youtubeMusicToken` is in the allowlist below, by file and count, and
//       no line writes it any other way: no assignment, no `delete`, no object key (an update,
//       `$set`, `$unset`, `create`, `insert*` or `bulkWrite` body), no `.set('youtubeMusicToken')`.
// A new occurrence fails until someone reviews it and moves the allowlist in the same PR.
//
// Pure source scanning — no Mongo, no Redis, no network.

const fs = require('fs');
const path = require('path');

const BACKEND = path.join(__dirname, '..');
const SCAN_ROOTS = ['app', 'scripts'];

const TOKEN = 'youtubeMusicToken';

// (c) — every line that may name the field, by its EXACT trimmed text (resilience N2: a per-file count
// let a read be swapped for a write the forbidden list misses — a shorthand `{ youtubeMusicToken }`, a
// computed key, `Reflect.set` — with the count unchanged). A read, an exclusion projection, the
// schema, or a comment; the two writes are the ones (a) and (a2) pin. Any edit to one of these lines,
// or any new line, fails until it is reviewed and copied here.
const ALLOWED_LINES = {
  'app/controllers/integrationsController.js': [
    "// (`.select('-spotifyToken -youtubeMusicToken -wearableToken')`) so they never", // auth-strip comment
    "user.setToken('youtubeMusicToken', tokens);", // the sealed callback's write (a, a2)
    'const connected = !!req.user.youtubeMusicToken?.blob;', // youtubeStatus's presence read
  ],
  // the auth middleware's exclusion projection keeps the blob off req.user
  'app/middleware/auth.js': ["'-spotifyToken -youtubeMusicToken -wearableToken'"],
  // the schema field itself
  'app/models/User.js': ['youtubeMusicToken: { type: encryptedTokenSchema, default: null },'],
  // getToken reads (each skips YouTube when null)
  'app/scripts/classifyAndHydrate.js': ["youtubeToken = user?.getToken?.('youtubeMusicToken')?.accessToken ?? null;"],
  'app/services/musicProfileService.js': ["const youtubeToken = user.getToken?.('youtubeMusicToken')?.accessToken ?? null;"],
  // comment: credentials are excluded from the export
  'app/services/privacy/userDataExport.js': ['// (spotifyToken/youtubeMusicToken/wearableToken), device push-token secrets, the watchToken'],
  // getValidToken: the read and the refresh's write (a, a2)
  'app/services/youtube.js': [
    "const stored = user.getToken('youtubeMusicToken');",
    "user.setToken('youtubeMusicToken', refreshed);",
  ],
  // the socket auth's exclusion projection
  'app/sockets/index.js': ["'-spotifyToken -youtubeMusicToken -wearableToken'"],
  // the JSDoc shape and two presence reads
  'app/utils/providerSelect.js': [
    '*   youtubeMusicToken?: { blob?: string }|null,',
    'const hasYoutube = !!user.youtubeMusicToken?.blob;',
    "if (user.youtubeMusicToken?.blob) providers.push('youtube');",
  ],
  'app/workers/reclassify.worker.js': ["return user?.getToken?.('youtubeMusicToken')?.accessToken ?? null;"],
  'app/workers/youtubeRetention.worker.js': ['const connected = !!user?.youtubeMusicToken?.blob;'],
};

// The two writers (a) allows, named by the declaration that encloses each call.
const ALLOWED_WRITERS = [
  { file: 'app/controllers/integrationsController.js', enclosing: 'youtubeCallback' },
  { file: 'app/services/youtube.js', enclosing: 'getValidToken' },
];

// ── Scanning ──────────────────────────────────────────────────────────────────

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.js') && !/\.(test|spec)\.js$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** { 'app/x.js': source } for every non-test .js file under the scan roots. */
function scannedSources() {
  const sources = {};
  for (const root of SCAN_ROOTS) {
    for (const file of walk(path.join(BACKEND, root))) {
      sources[path.relative(BACKEND, file).split(path.sep).join('/')] = fs.readFileSync(file, 'utf8');
    }
  }
  return sources;
}

const lineOf = (src, index) => src.slice(0, index).split('\n').length;

/** The name of the nearest `exports.<name> =` or `function <name>` declared at or before `index`. */
function enclosingDeclaration(src, index) {
  const before = src.slice(0, index);
  const decls = [...before.matchAll(/^\s*(?:exports\.(\w+)\s*=|(?:async\s+)?function\s+(\w+)\s*\()/gm)];
  const last = decls[decls.length - 1];
  return last ? (last[1] || last[2]) : null;
}

const WRITE_CALL = new RegExp(String.raw`setToken\s*(?:\?\.)?\s*\(\s*(['"\x60])${TOKEN}\1`, 'g');
const ANY_SETTOKEN = /\bsetToken\b/g;
// A call whose first argument is a plain string literal naming a field.
const LITERAL_CALL = /^setToken\s*(?:\?\.)?\s*\(\s*(['"])[A-Za-z_$][\w$]*\1\s*,/;
const SETTOKEN_DEFINITION = /^setToken\s*=\s*function\b/;

// (c) — the ways a line could write the field without `setToken`.
const FORBIDDEN_WRITES = [
  { kind: 'assignment', re: new RegExp(String.raw`\.${TOKEN}\s*(?:=(?!=)|\|\|=|&&=|\?\?=)`) },
  { kind: 'bracket assignment', re: new RegExp(String.raw`\[\s*(['"\x60])${TOKEN}\1\s*\]\s*(?:=(?!=)|\|\|=|&&=|\?\?=)`) },
  { kind: 'delete', re: new RegExp(String.raw`\bdelete\s+[\w$.\[\]'"\x60]*${TOKEN}`) },
  { kind: 'object key (update / $set / $unset / create / insert / bulkWrite body)', re: new RegExp(String.raw`(['"\x60]?)${TOKEN}(?:\.[\w$.]+)?\1\s*:(?!:)`) },
  { kind: 'call with the field as its first argument', re: new RegExp(String.raw`([\w$]+)\s*(?:\?\.)?\s*\(\s*(['"\x60])${TOKEN}(?:\.[\w$.]+)?\2`), allowFn: new Set(['getToken', 'setToken']) },
];
// The one line that legitimately has `youtubeMusicToken:` as a key: the schema field declaration.
const SCHEMA_LINE = { file: 'app/models/User.js', re: new RegExp(String.raw`^\s*${TOKEN}\s*:\s*\{\s*type:\s*encryptedTokenSchema\b`) };

function checkSources(sources) {
  const writers = [];
  const setTokenMisuse = [];
  const lineTexts = {};
  const forbidden = [];

  for (const [file, src] of Object.entries(sources)) {
    for (const m of src.matchAll(WRITE_CALL)) {
      writers.push({ file, line: lineOf(src, m.index), enclosing: enclosingDeclaration(src, m.index) });
    }
    for (const m of src.matchAll(ANY_SETTOKEN)) {
      const rest = src.slice(m.index);
      const isDefinition = file === 'app/models/User.js' && SETTOKEN_DEFINITION.test(rest);
      if (!isDefinition && !LITERAL_CALL.test(rest)) {
        setTokenMisuse.push({ file, line: lineOf(src, m.index), text: src.split('\n')[lineOf(src, m.index) - 1].trim() });
      }
    }
    src.split('\n').forEach((text, i) => {
      if (!text.includes(TOKEN)) return;
      (lineTexts[file] ||= []).push(text.trim());
      for (const { kind, re, allowFn } of FORBIDDEN_WRITES) {
        const hit = text.match(re);
        if (!hit) continue;
        if (allowFn && allowFn.has(hit[1])) continue;
        if (kind.startsWith('object key') && file === SCHEMA_LINE.file && SCHEMA_LINE.re.test(text)) continue;
        forbidden.push({ file, line: i + 1, kind, text: text.trim() });
      }
    });
  }
  return { writers, setTokenMisuse, lineTexts, forbidden };
}

// ── The AST layer (resilience N1) ─────────────────────────────────────────────
//
// Rule (a) above finds the two writes by text and names their owner by the nearest declaration
// ABOVE them, so a write moved into a helper declared below the callback (`const storeYt = …`) is
// still attributed to youtubeCallback, and an unsealed route that calls the helper never names the
// field. These rules parse the source instead (espree, the parser eslint uses):
//   (a2) each `setToken('youtubeMusicToken', …)` call's INNERMOST function is either
//        `exports.youtubeCallback`, after that function's top-level `if (!YOUTUBE_CONNECT_ENABLED) … return`,
//        or the top-level `function getValidToken` in services/youtube.js;
//   (d)  every new token needs `youtube.exchangeCode`, so the service's three connect entry points —
//        exchangeCode, getAuthUrl, generatePKCE — may be reached only from `exports.youtubeConnect` and
//        `exports.youtubeCallback`, after their seal guard. A youtube-service binding used any way
//        other than `binding.<name>` (aliased, passed on, computed) counts as an escape and fails too.

const espree = require('espree');

const YT_SERVICE = path.join(BACKEND, 'app/services/youtube.js');
const CONTROLLER = 'app/controllers/integrationsController.js';
const ENTRY_POINTS = new Set(['exchangeCode', 'getAuthUrl', 'generatePKCE']);
const SEAL_GUARDED = new Set(['youtubeConnect', 'youtubeCallback']);
const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

function parseSource(src) {
  return espree.parse(src, { ecmaVersion: 'latest', sourceType: 'script', range: true, loc: true, ecmaFeatures: { globalReturn: true } });
}

/** Visit every node with its ancestor chain (outermost first). */
function walkAst(node, visit, ancestors = []) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, ancestors);
  const next = [...ancestors, node];
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range' || key === 'parent') continue;
    const value = node[key];
    if (Array.isArray(value)) for (const child of value) walkAst(child, visit, next);
    else if (value && typeof value.type === 'string') walkAst(value, visit, next);
  }
}

const literalName = (n) => (n?.type === 'Literal' && typeof n.value === 'string' ? n.value
  : n?.type === 'TemplateLiteral' && n.expressions.length === 0 ? n.quasis[0].value.cooked : null);
const propertyName = (member) => (member.computed ? literalName(member.property) : member.property?.name ?? null);

/** How the innermost enclosing function is known: `exports.<x>`, a declared name, or a variable. */
function functionName(fn, parent) {
  if (fn.type === 'FunctionDeclaration') return fn.id?.name ?? null;
  if (parent?.type === 'AssignmentExpression' && parent.right === fn && parent.left.type === 'MemberExpression') {
    const obj = parent.left.object;
    const isExports = (obj.type === 'Identifier' && obj.name === 'exports')
      || (obj.type === 'MemberExpression' && obj.object.name === 'module' && propertyName(obj) === 'exports');
    if (isExports) return `exports.${propertyName(parent.left)}`;
  }
  if (parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier') return parent.id.name;
  if (parent?.type === 'Property') return propertyName({ computed: parent.computed, property: parent.key });
  return '<anonymous>';
}

function innermostFunction(ancestors) {
  for (let i = ancestors.length - 1; i >= 0; i -= 1) {
    if (FUNCTION_TYPES.has(ancestors[i].type)) return { fn: ancestors[i], parent: ancestors[i - 1], depth: i };
  }
  return null;
}

/** End offset of the function body's top-level `if (!YOUTUBE_CONNECT_ENABLED) { … return }`, or null. */
function sealGuardEnd(fn) {
  if (fn.body?.type !== 'BlockStatement') return null;
  for (const stmt of fn.body.body) {
    if (stmt.type !== 'IfStatement' || stmt.alternate) continue;
    const t = stmt.test;
    if (!(t.type === 'UnaryExpression' && t.operator === '!' && t.argument.type === 'Identifier' && t.argument.name === 'YOUTUBE_CONNECT_ENABLED')) continue;
    const c = stmt.consequent;
    const returns = c.type === 'ReturnStatement' || (c.type === 'BlockStatement' && c.body.at(-1)?.type === 'ReturnStatement');
    if (returns) return stmt.range[1];
  }
  return null;
}

/** Is `node` inside one of the named controller handlers, after that handler's seal guard? */
function sealedHandler(file, node, ancestors, names) {
  const inner = innermostFunction(ancestors);
  if (!inner || file !== CONTROLLER) return null;
  const name = functionName(inner.fn, inner.parent);
  if (!name?.startsWith('exports.') || !names.has(name.slice(8))) return null;
  // The function must be the right side of a TOP-LEVEL `exports.x = …`, not one nested in another.
  if (inner.depth !== 3 || ancestors[1].type !== 'ExpressionStatement') return null;
  const guardEnd = sealGuardEnd(inner.fn);
  return guardEnd !== null && node.range[0] > guardEnd ? name.slice(8) : null;
}

function isYoutubeServiceRequire(node, file) {
  if (node?.type !== 'CallExpression' || node.callee.type !== 'Identifier' || node.callee.name !== 'require') return false;
  const target = literalName(node.arguments[0]);
  if (!target || !target.startsWith('.')) return false;
  const resolved = path.resolve(path.dirname(path.join(BACKEND, file)), target);
  return resolved === YT_SERVICE || `${resolved}.js` === YT_SERVICE;
}

function checkAst(sources) {
  const writerFindings = [];   // (a2)
  const entryFindings = [];    // (d)
  const guardedWriters = [];
  const guardedEntries = [];
  for (const [file, src] of Object.entries(sources)) {
    // Every file is parsed: a text pre-filter would be one more thing a rename could slip past.
    const ast = parseSource(src);
    const isService = path.join(BACKEND, file) === YT_SERVICE;

    // Bindings of the youtube service in this file: `const <name> = require('…/youtube')`.
    const bindings = new Set();
    walkAst(ast, (node) => {
      if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && isYoutubeServiceRequire(node.init, file)) bindings.add(node.id.name);
    });

    walkAst(ast, (node, ancestors) => {
      const parent = ancestors[ancestors.length - 1];
      const at = { file, line: node.loc.start.line };

      // (d) every require names a literal path, so no module can be reached without being named.
      if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'require'
        && literalName(node.arguments[0]) === null) {
        entryFindings.push({ ...at, kind: 'require with a computed path', name: 'require' });
      }

      // (a2) the token writes.
      if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression'
        && propertyName(node.callee) === 'setToken' && literalName(node.arguments[0]) === TOKEN) {
        const inner = innermostFunction(ancestors);
        const viaRefresh = isService && inner?.fn.type === 'FunctionDeclaration' && inner.fn.id?.name === 'getValidToken' && inner.depth === 1;
        const viaCallback = sealedHandler(file, node, ancestors, new Set(['youtubeCallback']));
        if (viaRefresh || viaCallback) guardedWriters.push({ ...at, writer: viaRefresh ? 'getValidToken' : 'youtubeCallback' });
        else writerFindings.push({ ...at, owner: inner ? functionName(inner.fn, inner.parent) : '<module>' });
      }

      // (d) the connect entry points, reached through a binding, an inline require or a destructure.
      if (isService) {
        if (node.type === 'Identifier' && ENTRY_POINTS.has(node.name)) {
          const declares = parent?.type === 'FunctionDeclaration' && parent.id === node;
          const exported = parent?.type === 'Property' && ancestors.some((a) => a.type === 'AssignmentExpression' && a.left.type === 'MemberExpression' && a.left.object.name === 'module');
          if (!declares && !exported) entryFindings.push({ ...at, kind: 'used inside youtube.js', name: node.name });
        }
        return;
      }
      if (node.type === 'VariableDeclarator' && node.id.type === 'ObjectPattern' && isYoutubeServiceRequire(node.init, file)) {
        for (const p of node.id.properties) {
          const key = p.type === 'Property' ? propertyName({ computed: p.computed, property: p.key }) : null;
          if (key === null || ENTRY_POINTS.has(key)) entryFindings.push({ ...at, kind: 'destructured from the service', name: key ?? '...rest' });
        }
        return;
      }
      if (isYoutubeServiceRequire(node, file)) {
        const declared = parent?.type === 'VariableDeclarator' && parent.init === node;
        const member = parent?.type === 'MemberExpression' && parent.object === node;
        if (!declared && !member) entryFindings.push({ ...at, kind: 'service module escapes', name: 'require' });
        if (member) {
          const name = propertyName(parent);
          if (name === null) entryFindings.push({ ...at, kind: 'computed access on the service', name: '[?]' });
          else if (ENTRY_POINTS.has(name)) entryFindings.push({ ...at, kind: 'inline require of an entry point', name });
        }
        return;
      }
      if (node.type === 'Identifier' && bindings.has(node.name)) {
        if (parent?.type === 'VariableDeclarator' && parent.id === node) return; // the binding itself
        if (parent?.type === 'MemberExpression' && parent.property === node && !parent.computed) return; // x.youtube
        if (parent?.type === 'Property' && parent.key === node && !parent.shorthand) return; // { youtube: … }
        if (!(parent?.type === 'MemberExpression' && parent.object === node)) {
          entryFindings.push({ ...at, kind: 'service module escapes', name: node.name });
          return;
        }
        const name = propertyName(parent);
        if (name === null) { entryFindings.push({ ...at, kind: 'computed access on the service', name: '[?]' }); return; }
        if (!ENTRY_POINTS.has(name)) return;
        const handler = sealedHandler(file, parent, ancestors, SEAL_GUARDED);
        if (handler) guardedEntries.push({ ...at, name, handler });
        else entryFindings.push({ ...at, kind: 'entry point outside the sealed handlers', name });
      }
    });
  }
  return { writerFindings, entryFindings, guardedWriters, guardedEntries };
}

// ── (e) whole-document writes to users (resilience N3) ────────────────────────
//
// A write that never names the field — a replaced or bulk-inserted user document, an aggregation
// `$merge`/`$out` into users, a raw driver write — is invisible to (a)–(c). None exists today in
// backend/app or backend/scripts; this keeps it so:
//   • the User model is never asked to replace or bulk-write (replaceOne, findOneAndReplace,
//     findByIdAndReplace, insertMany, bulkWrite), never handed its raw driver collection
//     (`User.collection`, `User.db`), and never escapes its binding (passed on, aliased, put in a
//     list) — so `insertManyAccounted(User, docs)` and the like are caught too;
//   • the model is never fetched by name (`mongoose.model('User')`) outside its own file;
//   • no write method is called on a raw driver collection at all (`x.collection(…)`, a model's
//     `.collection`, a variable holding one, or a helper returning one);
//   • no aggregation stage `$merge`/`$out` targets users, or a target that cannot be read statically.

const USER_MODEL = path.join(BACKEND, 'app/models/User.js');
const USER_FORBIDDEN_METHODS = new Set(['replaceOne', 'findOneAndReplace', 'findByIdAndReplace', 'insertMany', 'bulkWrite']);
const USER_RAW_HANDLES = new Set(['collection', 'db']);
const RAW_WRITE_METHODS = new Set([
  'insertOne', 'insertMany', 'replaceOne', 'findOneAndReplace', 'bulkWrite', 'updateOne', 'updateMany',
  'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'drop', 'rename',
]);

function resolvesTo(node, file, target) {
  if (node?.type !== 'CallExpression' || node.callee.type !== 'Identifier' || node.callee.name !== 'require') return false;
  const spec = literalName(node.arguments[0]);
  if (!spec || !spec.startsWith('.')) return false;
  const resolved = path.resolve(path.dirname(path.join(BACKEND, file)), spec);
  return resolved === target || `${resolved}.js` === target;
}

/** Is `node` an expression that yields a raw driver collection? */
function isRawCollection(node, rawNames, rawHelpers) {
  if (!node) return false;
  if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && propertyName(node.callee) === 'collection') return true;
  if (node.type === 'MemberExpression' && !node.computed && node.property.name === 'collection') return true;
  if (node.type === 'Identifier' && rawNames.has(node.name)) return true;
  if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && rawHelpers.has(node.callee.name)) return true;
  return false;
}

function stageTargetsUsers(value) {
  const literal = literalName(value);
  if (literal !== null) return literal === 'users' ? 'users' : null;
  if (value?.type === 'ObjectExpression') {
    const into = value.properties.find((p) => p.type === 'Property' && propertyName({ computed: p.computed, property: p.key }) === 'into');
    if (!into) return 'unreadable';
    const intoLiteral = literalName(into.value);
    if (intoLiteral !== null) return intoLiteral === 'users' ? 'users' : null;
    if (into.value.type === 'ObjectExpression') {
      const coll = into.value.properties.find((p) => p.type === 'Property' && propertyName({ computed: p.computed, property: p.key }) === 'coll');
      const collLiteral = literalName(coll?.value);
      if (collLiteral !== null) return collLiteral === 'users' ? 'users' : null;
    }
  }
  return 'unreadable';
}

function checkUserDocumentWrites(sources) {
  const findings = [];
  const seen = { userBindingFiles: [], rawHelpers: [] };
  for (const [file, src] of Object.entries(sources)) {
    const ast = parseSource(src);
    const isUserModel = path.join(BACKEND, file) === USER_MODEL;
    const userNames = new Set();
    const rawNames = new Set();
    const rawHelpers = new Set();
    walkAst(ast, (node) => {
      if (node.type !== 'VariableDeclarator' || node.id.type !== 'Identifier') return;
      if (resolvesTo(node.init, file, USER_MODEL)) userNames.add(node.id.name);
      if (isRawCollection(node.init, rawNames, rawHelpers)) rawNames.add(node.id.name);
      const fn = node.init;
      if (fn && FUNCTION_TYPES.has(fn.type) && fn.body.type !== 'BlockStatement' && isRawCollection(fn.body, rawNames, rawHelpers)) rawHelpers.add(node.id.name);
    });
    if (userNames.size) seen.userBindingFiles.push(file);
    for (const h of rawHelpers) seen.rawHelpers.push(`${file}:${h}`);

    walkAst(ast, (node, ancestors) => {
      const parent = ancestors[ancestors.length - 1];
      const at = { file, line: node.loc.start.line };

      if (!isUserModel && node.type === 'CallExpression' && node.callee.type === 'MemberExpression'
        && propertyName(node.callee) === 'model' && node.arguments.length === 1 && literalName(node.arguments[0]) === 'User') {
        findings.push({ ...at, kind: 'User model fetched by name' });
      }
      if (node.type === 'VariableDeclarator' && node.id.type === 'ObjectPattern' && resolvesTo(node.init, file, USER_MODEL)) {
        findings.push({ ...at, kind: 'User model destructured' });
      }
      if (node.type === 'Identifier' && userNames.has(node.name)) {
        if (parent?.type === 'VariableDeclarator' && parent.id === node) return;
        if (parent?.type === 'MemberExpression' && parent.property === node && !parent.computed) return;
        if (parent?.type === 'Property' && parent.key === node && !parent.shorthand) return;
        if (parent?.type === 'NewExpression' && parent.callee === node) return;
        if (parent?.type === 'MemberExpression' && parent.object === node) {
          const name = propertyName(parent);
          if (name === null) findings.push({ ...at, kind: 'computed access on the User model' });
          else if (USER_FORBIDDEN_METHODS.has(name)) findings.push({ ...at, kind: `User.${name}` });
          else if (USER_RAW_HANDLES.has(name)) findings.push({ ...at, kind: `User.${name} (raw driver access)` });
          return;
        }
        findings.push({ ...at, kind: 'User model escapes its binding' });
      }
      if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression'
        && RAW_WRITE_METHODS.has(propertyName(node.callee)) && isRawCollection(node.callee.object, rawNames, rawHelpers)) {
        findings.push({ ...at, kind: `raw driver ${propertyName(node.callee)}` });
      }
      if (node.type === 'Property' && ['$merge', '$out'].includes(propertyName({ computed: node.computed, property: node.key }))) {
        const target = stageTargetsUsers(node.value);
        if (target) findings.push({ ...at, kind: `${propertyName({ computed: node.computed, property: node.key })} into ${target}` });
      }
    });
  }
  return { findings, ...seen };
}

// ── The pins ──────────────────────────────────────────────────────────────────

describe('YouTube token writers — only the two sealed writers can store a youtubeMusicToken (HX-3 T2)', () => {
  const sources = scannedSources();
  const result = checkSources(sources);

  it('scans every non-test .js file under backend/app AND backend/scripts (the guard is not vacuous)', () => {
    const files = Object.keys(sources);
    expect(files.length).toBeGreaterThan(100);
    expect(files).toEqual(expect.arrayContaining([
      'app/controllers/integrationsController.js',
      'app/services/youtube.js',
      'app/models/User.js',
      'scripts/gdpr-delete.js',
    ]));
    expect(files.some((f) => /\.(test|spec)\.js$/.test(f))).toBe(false);
  });

  it('(a) setToken(\'youtubeMusicToken\' appears exactly twice: the sealed callback and the refresh', () => {
    expect(result.writers.map(({ file, enclosing }) => ({ file, enclosing }))).toEqual(ALLOWED_WRITERS);
  });

  it('(b) the first argument of every setToken( call is a plain string literal', () => {
    expect(result.setTokenMisuse).toEqual([]);
  });

  it('(c) every line naming youtubeMusicToken is allowlisted by file and EXACT text — a new or edited one fails until reviewed', () => {
    expect(result.lineTexts).toEqual(ALLOWED_LINES);
  });

  it('(c) no line writes youtubeMusicToken outside (a): no assignment, delete, update/create key or .set()', () => {
    expect(result.forbidden).toEqual([]);
  });

  // The rules above pass on a clean tree whether or not they can see anything. Each planted
  // violation below must be caught, so a regex that silently stopped matching fails here.
  describe('each rule catches what it is for (planted violations)', () => {
    const clean = {
      'app/models/User.js': [
        '  youtubeMusicToken: { type: encryptedTokenSchema, default: null },',
        'userSchema.methods.setToken = function (field, tokenObj) {',
      ].join('\n'),
    };
    const planted = (file, text) => checkSources({ ...clean, [file]: text });

    it('a clean schema + definition yields no finding', () => {
      const r = checkSources(clean);
      expect(r.writers).toEqual([]);
      expect(r.setTokenMisuse).toEqual([]);
      expect(r.forbidden).toEqual([]);
    });

    it.each([
      ['a third setToken writer', 'app/services/x.js', "  user.setToken( \"youtubeMusicToken\" , t);", 'writers'],
      ['a computed setToken field', 'app/services/x.js', '  user.setToken(field, t);', 'setTokenMisuse'],
      ['a template-literal setToken field', 'app/services/x.js', '  user.setToken(`youtube${suffix}`, t);', 'setTokenMisuse'],
      ['setToken taken by reference', 'app/services/x.js', '  const write = user.setToken;', 'setTokenMisuse'],
      ['setToken through .call', 'scripts/x.js', '  user.setToken.call(user, f, t);', 'setTokenMisuse'],
      ['a direct assignment', 'app/services/x.js', '  user.youtubeMusicToken = enc;', 'forbidden'],
      ['a nullish assignment', 'app/services/x.js', '  user.youtubeMusicToken ??= enc;', 'forbidden'],
      ['a bracket assignment', 'app/services/x.js', "  user['youtubeMusicToken'] = enc;", 'forbidden'],
      ['a delete', 'app/services/x.js', '  delete user.youtubeMusicToken;', 'forbidden'],
      ['an update body key', 'app/services/x.js', '  await User.updateOne({ _id }, { $set: { youtubeMusicToken: enc } });', 'forbidden'],
      ['a dotted $set path', 'app/services/x.js', "  await User.updateOne({ _id }, { $set: { 'youtubeMusicToken.blob': b } });", 'forbidden'],
      ['an $unset key', 'scripts/x.js', '  await User.updateMany({}, { $unset: { youtubeMusicToken: 1 } });', 'forbidden'],
      ['a create body', 'app/services/x.js', '  await User.create({ email, youtubeMusicToken: enc });', 'forbidden'],
      ['a mongoose .set()', 'app/services/x.js', "  user.set('youtubeMusicToken', enc);", 'forbidden'],
    ])('%s is caught', (_label, file, text, bucket) => {
      const r = planted(file, text);
      expect(r[bucket].length).toBeGreaterThan(0);
    });

    it('a planted extra line naming the field breaks the allowlist', () => {
      const r = planted('app/services/x.js', '  const linked = !!user.youtubeMusicToken?.blob;');
      expect(r.lineTexts['app/services/x.js']).toEqual(['const linked = !!user.youtubeMusicToken?.blob;']);
      expect(r.forbidden).toEqual([]); // a read is not a write — the allowlist is what makes it reviewed
    });

    // N2: an allowlisted line swapped for a write the forbidden list misses keeps the per-file count;
    // only the exact text tells them apart.
    it.each([
      ['a shorthand property', 'app/workers/youtubeRetention.worker.js', 'Object.assign(user, { youtubeMusicToken });'],
      ['a computed key', 'app/workers/youtubeRetention.worker.js', "await User.updateOne({ _id }, { $set: { ['youtubeMusicToken']: t } });"],
      ['Reflect.set', 'app/utils/providerSelect.js', "const hasYoutube = Reflect.set(user, 'youtubeMusicToken', t);"],
      ['Object.defineProperty', 'app/utils/providerSelect.js', "Object.defineProperty(user, 'youtubeMusicToken', { value: t });"],
    ])('%s swapped in for an allowlisted line, count unchanged, is caught', (_label, file, swapped) => {
      const real = fs.readFileSync(path.join(BACKEND, file), 'utf8');
      const target = ALLOWED_LINES[file].find((l) => l.startsWith('const '));
      const src = real.replace(target, swapped);
      expect(src).not.toBe(real);
      const r = checkSources({ [file]: src });
      expect(r.lineTexts[file]).toHaveLength(ALLOWED_LINES[file].length); // the old count rule would pass
      expect(r.forbidden).toEqual([]);                                      // and so would the forbidden list
      expect(r.lineTexts[file]).not.toEqual(ALLOWED_LINES[file]);           // the exact text does not
    });

    it('a getToken read is not a write', () => {
      const r = planted('app/services/x.js', "  const t = user.getToken('youtubeMusicToken');");
      expect(r.forbidden).toEqual([]);
      expect(r.setTokenMisuse).toEqual([]);
    });
  });
});

describe('YouTube token writers, by syntax tree — the seal guards every write and every way in (resilience N1)', () => {
  const ast = checkAst(scannedSources());

  it('the controller takes YOUTUBE_CONNECT_ENABLED from the seal module (the guard below is the real seal)', () => {
    const src = fs.readFileSync(path.join(BACKEND, CONTROLLER), 'utf8');
    expect(src).toMatch(/^const \{ YOUTUBE_CONNECT_ENABLED \} = require\('\.\.\/config\/youtubeSeal'\);$/m);
  });

  it('(a2) both writes sit in an allowed writer: the refresh, and youtubeCallback after its seal return', () => {
    expect(ast.writerFindings).toEqual([]);
    expect(ast.guardedWriters.map(({ file, writer }) => ({ file, writer }))).toEqual([
      { file: CONTROLLER, writer: 'youtubeCallback' },
      { file: 'app/services/youtube.js', writer: 'getValidToken' },
    ]);
  });

  it('(d) exchangeCode, getAuthUrl and generatePKCE are reached only from youtubeConnect and youtubeCallback, after the seal', () => {
    expect(ast.entryFindings).toEqual([]);
    expect(ast.guardedEntries.map(({ name, handler }) => `${handler}:${name}`).sort()).toEqual([
      'youtubeCallback:exchangeCode', 'youtubeConnect:generatePKCE', 'youtubeConnect:getAuthUrl',
    ]);
  });

  describe('each AST rule catches what it is for (planted violations)', () => {
    // A minimal controller shaped like the real one: the seal require, both handlers, each guarded.
    const controller = (callbackBody, extra = '') => [
      "const youtube = require('../services/youtube');",
      "const { YOUTUBE_CONNECT_ENABLED } = require('../config/youtubeSeal');",
      'exports.youtubeConnect = (req, res) => {',
      "  if (!YOUTUBE_CONNECT_ENABLED) { return res.redirect('x'); }",
      '  const { codeVerifier, codeChallenge } = youtube.generatePKCE();',
      "  res.redirect(youtube.getAuthUrl('s', codeChallenge));",
      '};',
      'exports.youtubeCallback = async (req, res) => {',
      '  const target = 1;',
      "  if (!YOUTUBE_CONNECT_ENABLED) { return res.redirect('x'); }",
      ...callbackBody,
      '};',
      extra,
    ].join('\n');
    const SEALED_WRITE = ['  const tokens = await youtube.exchangeCode(req.query.code);', "  user.setToken('youtubeMusicToken', tokens);"];
    const run = (sources) => checkAst(sources);

    it('the shape of the real controller is clean', () => {
      const r = run({ [CONTROLLER]: controller(SEALED_WRITE) });
      expect(r.writerFindings).toEqual([]);
      expect(r.entryFindings).toEqual([]);
      expect(r.guardedWriters).toHaveLength(1);
      expect(r.guardedEntries).toHaveLength(3);
    });

    it('the review\'s helper: a write moved into `const storeYt = …` below the callback is caught', () => {
      const r = run({
        [CONTROLLER]: controller(
          ['  const tokens = await youtube.exchangeCode(req.query.code);', '  await storeYt(user, tokens);'],
          "const storeYt = async (u, t) => { u.setToken('youtubeMusicToken', t); await u.save(); };",
        ),
      });
      expect(r.writerFindings).toEqual([{ file: CONTROLLER, line: 14, owner: 'storeYt' }]);
    });

    it.each([
      ['a write BEFORE the seal return', ["  user.setToken('youtubeMusicToken', t);"], 'before'],
      ['a write in a nested function inside the callback', ["  const later = () => user.setToken('youtubeMusicToken', t);"], 'nested'],
    ])('%s is caught', (_label, body, where) => {
      const src = where === 'before'
        ? controller([]).replace("  const target = 1;", `  const target = 1;\n${body[0]}`)
        : controller(body);
      expect(run({ [CONTROLLER]: src }).writerFindings.length).toBe(1);
    });

    it('a callback with no seal guard at all: its write is caught', () => {
      const src = controller(SEALED_WRITE).replace("  if (!YOUTUBE_CONNECT_ENABLED) { return res.redirect('x'); }\n  const tokens", '  const tokens');
      expect(src).not.toMatch(/target = 1;\n {2}if/);
      const r = run({ [CONTROLLER]: src });
      expect(r.writerFindings.length).toBe(1);
      expect(r.entryFindings.map((f) => f.name)).toEqual(['exchangeCode']);
    });

    it('a guard that does not return (a log only) does not count as the seal', () => {
      const src = controller(SEALED_WRITE).replace("  if (!YOUTUBE_CONNECT_ENABLED) { return res.redirect('x'); }\n  const tokens", "  if (!YOUTUBE_CONNECT_ENABLED) { console.warn('x'); }\n  const tokens");
      expect(run({ [CONTROLLER]: src }).writerFindings.length).toBe(1);
    });

    it('a write in another exported handler is caught', () => {
      const r = run({ [CONTROLLER]: controller(SEALED_WRITE, "exports.youtubeImport = async (req, res) => { req.user.setToken('youtubeMusicToken', req.body); };") });
      expect(r.writerFindings).toEqual([{ file: CONTROLLER, line: 14, owner: 'exports.youtubeImport' }]);
    });

    it('a write in a script is caught', () => {
      const r = run({ 'scripts/x.js': "async function restore(u, t) { u.setToken('youtubeMusicToken', t); }" });
      expect(r.writerFindings).toEqual([{ file: 'scripts/x.js', line: 1, owner: 'restore' }]);
    });

    it.each([
      ['exchangeCode through a script\'s own binding', 'scripts/x.js', "const yt = require('../app/services/youtube');\nyt.exchangeCode('c');", 'entry point outside the sealed handlers'],
      ['an entry point destructured from the service', 'app/services/x.js', "const { exchangeCode } = require('./youtube');", 'destructured from the service'],
      ['the service aliased to another name', 'app/services/x.js', "const youtube = require('./youtube');\nconst y = youtube;\ny.exchangeCode('c');", 'service module escapes'],
      ['the service passed to a function', 'app/services/x.js', "const youtube = require('./youtube');\nrun(youtube);", 'service module escapes'],
      ['a computed member on the service', 'app/services/x.js', "const youtube = require('./youtube');\nyoutube['exchange' + 'Code']('c');", 'computed access on the service'],
      ['an inline require of an entry point', 'app/workers/x.js', "require('../services/youtube').getAuthUrl('s', 'c');", 'inline require of an entry point'],
      ['a require with a computed path', 'scripts/x.js', "const svc = require(path.join(__dirname, '../app/services', name));", 'require with a computed path'],
      ['getAuthUrl in an unsealed controller function', CONTROLLER, "const youtube = require('../services/youtube');\nexports.relink = (req, res) => res.redirect(youtube.getAuthUrl('s', 'c'));", 'entry point outside the sealed handlers'],
    ])('%s is caught', (_label, file, src, kind) => {
      expect(run({ [file]: src }).entryFindings.map((f) => f.kind)).toContain(kind);
    });

    it('an entry point used BEFORE the seal return in youtubeConnect is caught', () => {
      const src = controller(SEALED_WRITE).replace("  if (!YOUTUBE_CONNECT_ENABLED) { return res.redirect('x'); }\n  const { codeVerifier", "  youtube.generatePKCE();\n  if (!YOUTUBE_CONNECT_ENABLED) { return res.redirect('x'); }\n  const { codeVerifier");
      expect(run({ [CONTROLLER]: src }).entryFindings).toEqual([{ file: CONTROLLER, line: 4, kind: 'entry point outside the sealed handlers', name: 'generatePKCE' }]);
    });

    it('youtube.js calling its own exchangeCode from another function is caught', () => {
      const svc = [
        'async function exchangeCode(code) { return code; }',
        'async function relink(code) { return exchangeCode(code); }',
        'module.exports = { exchangeCode, relink };',
      ].join('\n');
      expect(run({ 'app/services/youtube.js': svc }).entryFindings).toEqual([{ file: 'app/services/youtube.js', line: 2, kind: 'used inside youtube.js', name: 'exchangeCode' }]);
    });
  });
});

describe('no whole-document write can reach the users collection (resilience N3)', () => {
  const real = checkUserDocumentWrites(scannedSources());

  it('(e) there is none in backend/app or backend/scripts: no replace or bulk write on User, no raw users collection, no raw driver write, no $merge/$out into users', () => {
    expect(real.findings).toEqual([]);
  });

  it('(e) sees what it guards (the rule is not vacuous): the User bindings and the raw-collection helpers in the scripts', () => {
    expect(real.userBindingFiles.length).toBeGreaterThan(10);
    expect(real.userBindingFiles).toEqual(expect.arrayContaining([CONTROLLER, 'app/middleware/auth.js', 'scripts/gdpr-delete.js']));
    expect(real.rawHelpers).toEqual(expect.arrayContaining(['scripts/hx1SurvivorCount.js:col', 'scripts/sessionHealthCount.js:col']));
  });

  describe('each part of (e) catches what it is for (planted violations)', () => {
    const HEAD = [
      "const mongoose = require('mongoose');",
      "const User = require('../app/models/User');",
      "const { insertManyAccounted } = require('../app/services/wearable/insertAccounted');",
      'const db = mongoose.connection.db;',
    ].join('\n');
    const kinds = (body) => checkUserDocumentWrites({ 'scripts/x.js': `${HEAD}\n${body}` }).findings.map((f) => f.kind);

    it('field-level and read-only uses are clean', () => {
      expect(kinds([
        'async function ok(id, docs) {',
        '  await User.findById(id);',
        "  await User.updateOne({ _id: id }, { $set: { musicProvider: 'spotify' } });",
        "  const u = new User({ email: 'a@b.c' }); await u.save();",
        "  await db.collection('users').countDocuments({});",
        "  await User.aggregate([{ $match: {} }, { $merge: { into: 'reports' } }]);",
        '}',
      ].join('\n'))).toEqual([]);
    });

    it.each([
      ['User.replaceOne with a copied document', 'User.replaceOne({ _id: old._id }, old);', 'User.replaceOne'],
      ['User.findOneAndReplace', 'User.findOneAndReplace({ _id: id }, doc);', 'User.findOneAndReplace'],
      ['User.insertMany from a backup', 'User.insertMany(backup);', 'User.insertMany'],
      ['User.bulkWrite', 'User.bulkWrite([{ insertOne: { document: doc } }]);', 'User.bulkWrite'],
      ['the raw collection off the model', 'User.collection.insertOne(doc);', 'User.collection (raw driver access)'],
      ['the model handed to a bulk helper', 'insertManyAccounted(User, docs);', 'User model escapes its binding'],
      ['the model aliased', 'const U = User; U.insertMany(docs);', 'User model escapes its binding'],
      ['a computed method on the model', "User['replace' + 'One']({ _id }, doc);", 'computed access on the User model'],
      ['the model fetched by name', "mongoose.model('User').insertMany(docs);", 'User model fetched by name'],
      ['a raw users write', "db.collection('users').replaceOne({ _id }, doc);", 'raw driver replaceOne'],
      ['a raw write through a variable', "const users = db.collection('users'); users.insertMany(docs);", 'raw driver insertMany'],
      ['a raw write through a helper', "const col = (name) => db.collection(name); col('users').updateMany({}, { $set: s });", 'raw driver updateMany'],
      ['$merge into users', "User.aggregate([{ $merge: 'users' }]);", '$merge into users'],
      ['$merge { into: users }', "Other.aggregate([{ $merge: { into: 'users', whenMatched: 'replace' } }]);", '$merge into users'],
      ['$out to users', "Other.aggregate([{ $out: 'users' }]);", '$out into users'],
      ['$merge to an unreadable target', 'Other.aggregate([{ $merge: { into: target } }]);', '$merge into unreadable'],
    ])('%s is caught', (_label, body, kind) => {
      expect(kinds(body)).toContain(kind);
    });
  });
});
