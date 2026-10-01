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

// (c) — every line that may name the field, and why. A read, an exclusion projection, the schema,
// or a comment; the two writes are the ones (a) pins.
const ALLOWED_LINES = {
  // the auth-strip comment; youtubeCallback's sealed setToken; youtubeStatus's presence read
  'app/controllers/integrationsController.js': 3,
  // `.select('-spotifyToken -youtubeMusicToken -wearableToken')` keeps the blob off req.user
  'app/middleware/auth.js': 1,
  // the schema field itself
  'app/models/User.js': 1,
  // getToken read (skips YouTube when null)
  'app/scripts/classifyAndHydrate.js': 1,
  // getToken read in buildProfile (skips YouTube when null)
  'app/services/musicProfileService.js': 1,
  // comment: credentials are excluded from the export
  'app/services/privacy/userDataExport.js': 1,
  // getValidToken: the getToken read and the refresh's setToken
  'app/services/youtube.js': 2,
  // the socket auth's exclusion projection
  'app/sockets/index.js': 1,
  // the JSDoc shape and two presence reads
  'app/utils/providerSelect.js': 3,
  // getToken read (skips YouTube when null)
  'app/workers/reclassify.worker.js': 1,
  // presence read
  'app/workers/youtubeRetention.worker.js': 1,
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
  const lineCounts = {};
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
      lineCounts[file] = (lineCounts[file] || 0) + 1;
      for (const { kind, re, allowFn } of FORBIDDEN_WRITES) {
        const hit = text.match(re);
        if (!hit) continue;
        if (allowFn && allowFn.has(hit[1])) continue;
        if (kind.startsWith('object key') && file === SCHEMA_LINE.file && SCHEMA_LINE.re.test(text)) continue;
        forbidden.push({ file, line: i + 1, kind, text: text.trim() });
      }
    });
  }
  return { writers, setTokenMisuse, lineCounts, forbidden };
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

  it('(c) every line naming youtubeMusicToken is allowlisted by file and count — a new one fails until reviewed', () => {
    expect(result.lineCounts).toEqual(ALLOWED_LINES);
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

    it('a planted extra line naming the field breaks the allowlist count', () => {
      const r = planted('app/services/x.js', '  const linked = !!user.youtubeMusicToken?.blob;');
      expect(r.lineCounts['app/services/x.js']).toBe(1);
      expect(r.forbidden).toEqual([]); // a read is not a write — the count is what makes it reviewed
    });

    it('a getToken read is not a write', () => {
      const r = planted('app/services/x.js', "  const t = user.getToken('youtubeMusicToken');");
      expect(r.forbidden).toEqual([]);
      expect(r.setTokenMisuse).toEqual([]);
    });
  });
});
