'use strict';

// DAN-055 F1 (the custodian's finding of 2026-10-04) and SEC-264-L3 (security-auditor on #264,
// 2026-10-18): a forward-only guard against personal identifiers in tracked files. It follows the
// attribution guard (wave4.attributionGuard.test.js): a pure sweep, self-tests that prove on every
// run that the detector still has teeth, and a sweep of the whole tracked tree, because "tracked"
// is what every clone, fork and backup of this repository carries.
//
// FOUR KINDS OF HIT.
//   name, email  the two partners' full names and the owner's email. A candidate (two words with
//                only whitespace between them; an email-shaped token) is normalized, lower-cased
//                with its whitespace collapsed, and matched by its SHA-256, so this file holds hashes
//                and never the identifiers: a guard that quoted what it forbids would be one more
//                copy of it. The hash is no secret (anyone who can guess a name can confirm it); it
//                keeps this file from being a hit of its own, and the sweep does not exempt it.
//   path         an absolute path into a user's home: X:\Users\<u> (USERS too), /x/Users/<u>,
//                //x/Users/<u>, /mnt/x/Users/<u>, /cygdrive/x/Users/<u>, /home/<u>, /Users/<u>, with
//                %3A, %5C and %2F decoded first (a file: URI, an encoded log line). The CI runner's
//                /home/runner is the platform's account.
//   objectid     a 24-hex Mongo ObjectId, in *.md files, the production scripts (J17: backend/scripts,
//                backend/app/scripts, scripts/atlas) and everything under docs/: code and tests carry
//                made-up ids by design, a document or a one-off script carries a real one by accident
//                (SEC-264-L3, SEC-268-4).
// NOT HITS: a GitHub login, its @ form (the coordinator writes "Malede (@DanielMalede)" into
// TASKS.md) and the GitHub noreply address are identity under CLAUDE.md; the first name alone is the
// repository's convention (DAN-055).
//
// EXEMPT, each list a closed literal that a test pins by equality, so widening one is a visible
// edit in review: the machinery's own paths inside the instruction layer, and the identity files,
// for names and emails only. Nothing else: a frozen record (docs/ARCHIVE.md line 14) is swept like
// any file, so a filing that brings a new hit fails in the PR that files it (SEC-268-1).
//
// EVERY TRACKED FILE OUTSIDE BINARY_EXT IS READ: UTF-8 with or without its mark, UTF-16 by its mark
// (what Windows PowerShell 5.1's `>` writes). A NUL byte without a mark is a UTF-16 file the sweep
// could not read or a binary with a wrong extension, and fails the sweep unless TEXT_WITH_NUL names
// the file (SEC-268-3).
//
// THE BASELINE COUNTS OCCURRENCES PER KEY, AND NO KEY NAMES A FILE. A key is the kind and the
// identifier's hash, or for a path the user and the first PATH_KEY_DEPTH segments after it. It never
// names the file a hit sits in: open PRs #264 and #265 move many of these files, and a path-keyed
// baseline would break whichever merges second. It counts instead of listing because a list of keys
// cannot see a new occurrence of a key that already occurs, and every name and email key already
// occurs outside the identity files (CLAUDE.md, .claude/agents/coordinator.md, TASKS.md and others):
// a list would have admitted the owner's full name in any new file, the two test fixtures this
// guard was written against included. More occurrences than the baseline fail. Fewer fail too for a
// name, an email or an ObjectId, because the room would admit the same identifier back (SEC-268-2);
// for a path they only warn until DAN-055 item (2) makes the ratchet exact, because #264 and #265
// move many path occurrences.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SELF = 'backend/tests/personalDataGuard.test.js';

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const identity = (normalized) => ({ length: normalized.length, sha256: sha256(normalized) });

// Kind one, as the SHA-256 of each normalized identifier and its length: the length lets the sweep
// skip the nine word pairs in ten that cannot match, and says less than the hash does. Computed once
// from WORK_LEDGER.md (its opening line names both partners, its People table the owner's address)
// and the git log's authors; a test below proves each still names someone in WORK_LEDGER.md. The
// partner's only address in the history is his noreply address, which is identity, so he has no
// email entry.
const IDENTITIES = Object.freeze({
  name: [
    { length: 13, sha256: '954729cbf881b8a75e26235ae3a65d8829bc17053969eb8d83537cf9761eb661' }, // the owner
    { length: 14, sha256: 'adfe8812c0f526031b95746f7d4fad52109a65b717c6f74dc49c4ec25f5d275e' }, // the partner
  ],
  email: [
    { length: 22, sha256: 'a22914b84d9b46fc39f42835c94ea2a9598167ec6cc3f1633cfca8e63e6c8743' }, // the owner
  ],
});

// The instruction layer names the owner's checkout, its review clone, the settings' tool paths and
// the hooks' test fixtures by absolute path; those prefixes are machinery there and hits anywhere else.
// A prefix is the user and up to PATH_KEY_DEPTH segments, lower-cased, matched segment by segment.
const MACHINERY_FILES = ['CLAUDE.md', 'AGENTS.md', '.claude/**', '.agents/**'];
const MACHINERY_PREFIXES = [
  'danie/.claude/projects',
  'danie/appdata/local',
  'danie/repo',
  'danie/videos/ai-music-app',
  'danie/videos/kokonada',
  'danie/videos/kokonada-review',
];
// Where an ObjectId is a hit besides *.md: J17's production scripts and the documents that are not markdown.
const OBJECT_ID_FILES = ['backend/scripts/**', 'backend/app/scripts/**', 'scripts/atlas/**', 'docs/**'];
// Where the partners' names and the owner's email are the data: the ledger's People table, and the
// coordinator that reads it and its tests. Names and emails only; a path in them is still a hit.
const IDENTITY_FILES = ['WORK_LEDGER.md', 'scripts/coord/**', 'backend/tests/coord.*.test.js'];

// The coordinator's glob syntax: `*` is one path segment, `**` any depth.
function globRegExp(glob) {
  const escape = (text) => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const source = glob
    .split('**')
    .map((part) => part.split('*').map(escape).join('[^/]*'))
    .join('.*');
  return new RegExp(`^${source}$`);
}
const MACHINERY_RES = MACHINERY_FILES.map(globRegExp);
const IDENTITY_RES = IDENTITY_FILES.map(globRegExp);
const OBJECT_ID_RES = OBJECT_ID_FILES.map(globRegExp);
const objectIdFile = (rel) => /\.md$/i.test(rel) || OBJECT_ID_RES.some((re) => re.test(rel));

// A word is a run of ASCII letters: both embedded names are ASCII, and a Latin name glued to Hebrew
// text still splits off as its own word, which a Unicode letter class would glue to the Hebrew (and
// the ASCII class scans the tree three times faster). An identity outside ASCII needs this widened.
const WORD = /[A-Za-z]+/g;
// The look-behind starts a match only where a local part starts; without it the engine retries at
// every character of every alphanumeric run.
const EMAIL = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const OBJECT_ID = /(?<![0-9A-Za-z])[0-9a-fA-F]{24}(?![0-9A-Za-z])/g;
// A segment ends at a separator, whitespace, a quote, a bracket or a character no Windows path holds.
const SEGMENT = String.raw`[^\\/\s'"\x60<>|*?:;,()[\]{}]`;
// Group 1 is set only for /home. The user must start with a letter, a digit or `_`, so a placeholder
// (`<you>`, `$USER`, `...`) is not a user; the look-behind keeps a URL's path or a word's tail out.
// A drive may sit behind a WSL or Cygwin mount, and its Users folder may be spelled in capitals.
const USERS = String.raw`(?:[Uu]sers|USERS)`;
const USER_PATH = new RegExp(
  String.raw`(?<![\p{L}\p{N}_.~%-])` +
    String.raw`(?:[A-Za-z]:[\\/]+${USERS}|(?:\/(?:mnt|cygdrive))?\/{1,2}[A-Za-z]\/+${USERS}|\/Users|\/(home))` +
    String.raw`[\\/]+([\p{L}\p{N}_]${SEGMENT}*)((?:[\\/]+${SEGMENT}+)*)`,
  'gu',
);
// The three percent-encodings a path can hide behind (a file: URI, an encoded log line), decoded
// before the path matcher runs. None of them is a line break, so the decoded text keeps every line
// number of the original.
const PERCENT_ENCODED = /%(3a|5c|2f)/gi;
const decodePercent = (text) => text.replace(PERCENT_ENCODED, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

// How many segments after the user a path key keeps. Two is the deepest prefix the reorganisation
// cannot change: the owner's checkout sits two folders under his home, so a reference that #264 or
// #265 rewrites to a moved file keeps its key, while a different folder under the same home (another
// project, AppData, a download) is a different key. The tests below pin both sides of that choice.
const PATH_KEY_DEPTH = 2;

const pathKey = (segments, depth = PATH_KEY_DEPTH) => `path:${segments.slice(0, depth + 1).join('/')}`;

function pathSegments(user, rest) {
  const segments = [];
  for (const raw of [user, ...rest.split(/[\\/]+/).slice(1)]) {
    const segment = raw.toLowerCase().replace(/\.+$/, '');
    if (!segment) break;
    segments.push(segment);
  }
  return segments;
}

function normalizeEmail(raw) {
  const lower = raw.toLowerCase();
  const at = lower.lastIndexOf('@');
  const domain = lower.slice(at + 1);
  if (domain !== 'gmail.com' && domain !== 'googlemail.com') return lower;
  // Gmail delivers every dotted spelling and every +tag of an address to the same mailbox.
  return `${lower.slice(0, at).split('+')[0].replace(/\./g, '')}@gmail.com`;
}

function lineFinder(text) {
  let starts = null;
  return (index) => {
    if (!starts) {
      starts = [0];
      for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
    }
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid] <= index) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
}

// Every hit in one text, before any exemption: [{ kind, key, line }], plus `segments` for a path.
function findHits(text, { objectIds = false, identities = IDENTITIES } = {}) {
  const lineOf = lineFinder(text);
  const hits = [];
  const matcher = (list) => ({ hashes: new Set(list.map((id) => id.sha256)), lengths: new Set(list.map((id) => id.length)) });
  const names = matcher(identities.name);
  const emails = matcher(identities.email);
  const matches = (set, candidate) => set.lengths.has(candidate.length) && set.hashes.has(sha256(candidate));

  const words = new RegExp(WORD.source, WORD.flags);
  const space = /\s+/y;
  let previous = null;
  let previousIndex = 0;
  let previousEnd = 0;
  for (let word = words.exec(text); word !== null; word = words.exec(text)) {
    if (previous !== null) {
      space.lastIndex = previousEnd;
      if (space.test(text) && space.lastIndex === word.index) {
        const candidate = `${previous} ${word[0]}`.toLowerCase();
        if (matches(names, candidate)) hits.push({ kind: 'name', key: `name:${sha256(candidate)}`, line: lineOf(previousIndex) });
      }
    }
    previous = word[0];
    previousIndex = word.index;
    previousEnd = word.index + word[0].length;
  }

  for (const match of text.includes('@') ? text.matchAll(EMAIL) : []) {
    const candidate = normalizeEmail(match[0]);
    if (matches(emails, candidate)) hits.push({ kind: 'email', key: `email:${sha256(candidate)}`, line: lineOf(match.index) });
  }

  // Every shape needs "Users", "users", "USERS" or "/home": a text with none of them cannot hold one.
  const decoded = text.includes('%') ? decodePercent(text) : text;
  const lineOfDecoded = decoded === text ? lineOf : lineFinder(decoded);
  for (const match of /[Uu]sers|USERS|\/home/.test(decoded) ? decoded.matchAll(USER_PATH) : []) {
    const [, home, user, rest] = match;
    if (home && user === 'runner') continue; // the CI runner's home, not a person's
    const segments = pathSegments(user, rest);
    hits.push({ kind: 'path', key: pathKey(segments), line: lineOfDecoded(match.index), segments });
  }

  if (objectIds) {
    for (const match of text.matchAll(OBJECT_ID)) {
      hits.push({ kind: 'objectid', key: `objectid:${sha256(match[0].toLowerCase())}`, line: lineOf(match.index) });
    }
  }
  return hits;
}

const underPrefix = (segments, prefix) => prefix.split('/').every((part, i) => segments[i] === part);

// The whole guard as a PURE function over [{ path, text }]: the hits that no exemption covers.
function sweep(files, { identities = IDENTITIES } = {}) {
  const hits = [];
  for (const { path: rel, text } of files) {
    const identityFile = IDENTITY_RES.some((re) => re.test(rel));
    const machineryFile = MACHINERY_RES.some((re) => re.test(rel));
    for (const hit of findHits(text, { objectIds: objectIdFile(rel), identities })) {
      if (identityFile && (hit.kind === 'name' || hit.kind === 'email')) continue;
      if (machineryFile && hit.kind === 'path' && MACHINERY_PREFIXES.some((p) => underPrefix(hit.segments, p))) continue;
      hits.push({ path: rel, line: hit.line, kind: hit.kind, key: hit.key });
    }
  }
  return hits;
}

const byKey = ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0);

function tally(hits) {
  const counts = {};
  for (const { key } of hits) counts[key] = (counts[key] || 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(byKey));
}

// The exact ratchet: every key above its count, with where it occurs, then every key below it.
function verdict(hits, baseline = BASELINE) {
  const counts = tally(hits);
  const allowed = (key) => (Object.hasOwn(baseline, key) ? baseline[key] : 0);
  const over = Object.entries(counts)
    .filter(([key, count]) => count > allowed(key))
    .map(([key, count]) => ({
      key,
      count,
      allowed: allowed(key),
      at: hits.filter((hit) => hit.key === key).map((hit) => `${hit.path}:${hit.line}`),
    }));
  const under = Object.entries(baseline)
    .filter(([key, limit]) => (counts[key] || 0) < limit)
    .map(([key, limit]) => ({ key, count: counts[key] || 0, allowed: limit }));
  return [...over, ...under];
}

// What the sweep does with each finding. A key above its count fails. A name, an email or an ObjectId
// below its count fails too: the room would admit the same identifier back. A path below its count
// only warns until DAN-055 item (2) makes the ratchet exact: #264 and #265 move many path occurrences.
function judge(findings) {
  const warnings = findings.filter((finding) => finding.count < finding.allowed && finding.key.startsWith('path:'));
  return { failures: findings.filter((finding) => !warnings.includes(finding)), warnings };
}

const renderBaseline = (counts) =>
  `const BASELINE = Object.freeze({\n${Object.entries(counts)
    .sort(byKey)
    .map(([key, count]) => `  '${key}': ${count},`)
    .join('\n')}\n});`;

// Computed by renderBaseline(tally(sweep(trackedTextFiles().files))) on 6a3faf7, once the two test
// fixtures that carried the owner's full name took a made-up one: every key that occurs, with how
// often. The frozen records add three path occurrences (docs/plans/WAVE4_STATE.md lines 77 and 372,
// WEAKNESSES_AND_FAILURES.md line 792) and no name, email or ObjectId. Raise a count only for an
// occurrence that has to stay, in the PR that adds it, where review sees it.
const BASELINE = Object.freeze({
  'email:a22914b84d9b46fc39f42835c94ea2a9598167ec6cc3f1633cfca8e63e6c8743': 3,
  'name:954729cbf881b8a75e26235ae3a65d8829bc17053969eb8d83537cf9761eb661': 4,
  'name:adfe8812c0f526031b95746f7d4fad52109a65b717c6f74dc49c4ec25f5d275e': 4,
  'objectid:0ec8c18069aede9a63cfff8860f26f0a674511ccad3f113c696e44b25443df5d': 1,
  'objectid:644dd4fe0c6a5cc140d93e6e41ad91a99b2737f82812f55215ce3df6e5ba4711': 1,
  'path:danie/.claude/plans': 1,
  'path:danie/.claude/projects': 3,
  'path:danie/.local/bin': 4,
  'path:danie/appdata/local': 1,
  'path:danie/desktop/hdrlog.js': 2,
  'path:danie/videos/ai-music-app': 2,
  'path:danie/videos/kokonada': 132,
  'path:danie/videos/kokonada-standalone.apk': 1,
  'path:danie/videos/kokonada.github.io': 1,
  'path:me/repo': 1,
  'path:x.js': 2,
});

// Never read, by extension: a closed literal a test pins. Every other tracked file is read as text.
const BINARY_EXT = [
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.icns', '.pdf', '.zip', '.gz', '.tgz', '.jar',
  '.aar', '.apk', '.aab', '.keystore', '.jks', '.ttf', '.otf', '.woff', '.woff2', '.mp3', '.mp4',
  '.wav', '.bin', '.so', '.dylib', '.dll', '.exe',
];
// Source files that hold a NUL character on purpose (a '\0'-joined key; a control-character
// fixture): read as UTF-8 and swept. Any other file with a NUL byte and no byte-order mark fails
// the sweep, because it is a UTF-16 file the sweep could not read or a binary with a wrong extension.
const TEXT_WITH_NUL = [
  'mobile/KokonadaHealth/scripts/lint/designSystemBaseline.mjs',
  'mobile/KokonadaHealth/src/__tests__/shadow.qa4.uiux.test.tsx',
];

// A file's bytes as text: UTF-8 with or without its mark, UTF-16 of either byte order by its mark
// (Windows PowerShell 5.1's `>` writes UTF-16LE with one), and null for a NUL byte without a mark.
function decodeText(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer.subarray(2));
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer.subarray(2));
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return buffer.subarray(3).toString('utf8');
  return buffer.includes(0) ? null : buffer.toString('utf8');
}

// The listed files as text: a BINARY_EXT file is not read; every other file is decoded, and one that
// is not text is listed under notText unless TEXT_WITH_NUL names it.
function readAsText(rels, read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel))) {
  const files = [];
  const notText = [];
  for (const rel of rels) {
    if (BINARY_EXT.includes(path.posix.extname(rel).toLowerCase())) continue;
    let buffer;
    try {
      buffer = read(rel);
    } catch {
      continue;
    }
    const text = decodeText(buffer) ?? (TEXT_WITH_NUL.includes(rel) ? buffer.toString('utf8') : null);
    if (text === null) notText.push(rel);
    else files.push({ path: rel, text });
  }
  return { files, notText };
}

function trackedTextFiles() {
  const listed = execFileSync('git', ['ls-files', '-z'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean);
  return readAsText(listed);
}

// Built at run time: written out, each would be a hit in this very file, which the sweep does not
// exempt.
const PATHS = {
  windows: (...segments) => ['C:', 'Users', ...segments].join('\\'),
  windowsForward: (...segments) => ['C:', 'Users', ...segments].join('/'),
  windowsUpper: (...segments) => ['C:', 'USERS', ...segments].join('\\'),
  jsonEscaped: (...segments) => ['C:', 'Users', ...segments].join('\\\\'),
  percentEncoded: (...segments) => encodeURIComponent(['C:', 'Users', ...segments].join('\\')),
  fileUri: (...segments) => 'file:///' + ['c%3A', 'Users', ...segments].join('/'),
  msys: (...segments) => ['', 'c', 'Users', ...segments].join('/'),
  msysDouble: (...segments) => ['/', 'c', 'Users', ...segments].join('/'),
  wsl: (...segments) => ['', 'mnt', 'c', 'Users', ...segments].join('/'),
  cygwin: (...segments) => ['', 'cygdrive', 'c', 'Users', ...segments].join('/'),
  linux: (...segments) => ['', 'home', ...segments].join('/'),
  mac: (...segments) => ['', 'Users', ...segments].join('/'),
};

describe('DAN-055 F1 - personal-data guard (full names, emails, user paths, ObjectIds)', () => {
  // Made-up identities, so the self-tests below never need a real one.
  const SYNTHETIC = {
    name: [identity('ada quill')],
    email: [identity('ada.quill@example.org'), identity('adaquill@gmail.com')],
  };
  const kindsIn = (text, objectIds = false) =>
    findHits(text, { objectIds, identities: SYNTHETIC }).map((hit) => hit.kind);

  describe('detector self-test - each kind is found', () => {
    it('a full name, in any case and across any run of whitespace, a line break included', () => {
      expect(kindsIn('Primary contact: Ada Quill')).toEqual(['name']);
      expect(kindsIn('ADA \t QUILL')).toEqual(['name']);
      expect(kindsIn('signed by Ada\n   Quill, the owner')).toEqual(['name']);
    });

    it('a full name glued to Hebrew text on either side', () => {
      expect(kindsIn('שלוםAda Quillתודה')).toEqual(['name']);
    });

    it('an email in any case, and every spelling Gmail delivers to the same mailbox', () => {
      expect(kindsIn('mail Ada.Quill@Example.ORG today')).toEqual(['email']);
      expect(kindsIn('<a.da.quill+kokonada@GoogleMail.com>')).toEqual(['email']);
    });

    it('each absolute user-path shape: a drive in any case, msys, WSL and Cygwin mounts, escaped, encoded, Linux, mac', () => {
      expect(Object.keys(PATHS)).toHaveLength(12);
      for (const make of Object.values(PATHS)) {
        expect(kindsIn('saved at `' + make('ada', 'Videos', 'x') + '`')).toEqual(['path']);
      }
    });

    it('a 24-hex ObjectId, where ids are swept', () => {
      expect(kindsIn('account `6523ab12cd34ef56ab78cd90` has missing=0', true)).toEqual(['objectid']);
    });

    it('the line of each hit', () => {
      expect(findHits('one\ntwo Ada Quill\nthree', { identities: SYNTHETIC }).map((hit) => hit.line)).toEqual([2]);
    });
  });

  describe('detector self-test - identity and look-alikes are NOT hits', () => {
    it('a GitHub login, its @ form and the coordinator status line are identity (CLAUDE.md)', () => {
      expect(findHits('`DanielMalede` and @DanielBedrack')).toEqual([]);
      expect(
        findHits('  - status: taken by Malede (@DanielMalede) on branch `test/pii-guard` since 2026-10-20, ledger slot M06'),
      ).toEqual([]);
    });

    it('the GitHub noreply addresses are identity, never hits', () => {
      expect(
        findHits('102303436+DanielMalede@users.noreply.github.com, 111690772+DanielBedrack@users.noreply.github.com'),
      ).toEqual([]);
    });

    it('the first name alone, or a login-shaped spelling of the full name, is not a full-name hit', () => {
      for (const text of ['Ada', 'AdaQuill', '@AdaQuill', 'Ada-Quill', 'Ada_Quill', 'Quill (@AdaQuill)']) {
        expect(kindsIn(text)).toEqual([]);
      }
    });

    it('the CI runner home, placeholders, API routes and URL paths are not user paths', () => {
      for (const text of [
        'cd /home/runner/work/Kokonada/Kokonada',
        'Node reads `/c/Users/...` as a path',
        'C:\\Users\\<you>\\repo',
        '/home/$USER/.npmrc',
        'POST /users/{user_id}/playlists',
        'GET /users/me/playlists',
        'GET https://api.spotify.com/v1/users/abc/playlists',
        'https://example.com/Users/ada',
        'https://example.com/mnt/c/Users/ada',
      ]) {
        expect(findHits(text)).toEqual([]);
      }
    });

    it('an ObjectId outside the files it is swept in, a commit SHA or a longer hex run is not a hit', () => {
      expect(kindsIn('const id = "6523ab12cd34ef56ab78cd90";')).toEqual([]);
      expect(kindsIn('commit 0b42679ad4b6f63bbdd27742ad85efad1d7f940b', true)).toEqual([]);
      expect(kindsIn('6523ab12cd34ef56ab78cd90a', true)).toEqual([]);
    });

    it('this file holds hashes, never the identifiers: swept unexempted, it has no hit of its own', () => {
      expect(sweep([{ path: SELF, text: fs.readFileSync(__filename, 'utf8') }])).toEqual([]);
    });
  });

  describe('exemptions are closed literals, each honoured and no wider', () => {
    const kindsAt = (rel, text) => sweep([{ path: rel, text }], { identities: SYNTHETIC }).map((hit) => hit.kind);
    const checkout = PATHS.msys('danie', 'Videos', 'Kokonada');

    it('the lists are exactly these (growing one is a visible edit here, in review)', () => {
      expect(MACHINERY_FILES).toEqual(['CLAUDE.md', 'AGENTS.md', '.claude/**', '.agents/**']);
      expect(MACHINERY_PREFIXES).toEqual([
        'danie/.claude/projects',
        'danie/appdata/local',
        'danie/repo',
        'danie/videos/ai-music-app',
        'danie/videos/kokonada',
        'danie/videos/kokonada-review',
      ]);
      expect(IDENTITY_FILES).toEqual(['WORK_LEDGER.md', 'scripts/coord/**', 'backend/tests/coord.*.test.js']);
      expect(OBJECT_ID_FILES).toEqual(['backend/scripts/**', 'backend/app/scripts/**', 'scripts/atlas/**', 'docs/**']);
      expect(BINARY_EXT).toEqual([
        '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.icns', '.pdf', '.zip', '.gz', '.tgz', '.jar',
        '.aar', '.apk', '.aab', '.keystore', '.jks', '.ttf', '.otf', '.woff', '.woff2', '.mp3', '.mp4',
        '.wav', '.bin', '.so', '.dylib', '.dll', '.exe',
      ]);
      expect(TEXT_WITH_NUL).toEqual([
        'mobile/KokonadaHealth/scripts/lint/designSystemBaseline.mjs',
        'mobile/KokonadaHealth/src/__tests__/shadow.qa4.uiux.test.tsx',
      ]);
    });

    it('a machinery prefix is exempt inside the instruction layer and nowhere else', () => {
      for (const rel of ['CLAUDE.md', 'AGENTS.md', '.claude/settings.json', '.agents/skills/coordinate/SKILL.md']) {
        expect(kindsAt(rel, checkout)).toEqual([]);
      }
      for (const rel of ['docs/ORCHESTRATOR_FABLE.md', 'TASKS.md', 'docs/CLAUDE.md', 'backend/tests/x.test.js']) {
        expect(kindsAt(rel, checkout)).toEqual(['path']);
      }
    });

    it('inside the instruction layer, any other user path is a hit, and so is a name', () => {
      expect(kindsAt('CLAUDE.md', PATHS.windows('danie', 'Documents', 'keys'))).toEqual(['path']);
      expect(kindsAt('.claude/settings.json', PATHS.mac('ada', 'dev'))).toEqual(['path']);
      expect(kindsAt('CLAUDE.md', 'Ada Quill')).toEqual(['name']);
    });

    it('a frozen record (docs/ARCHIVE.md line 14) is swept like any file, for every kind, a new file under its folders included', () => {
      const all = `Ada Quill, ada.quill@example.org, ${PATHS.windows('ada', 'x', 'y')}, 6523ab12cd34ef56ab78cd90`;
      for (const rel of [
        'docs/design-v2/decisions/DEC-999.md',
        'docs/design-v2/registry/QA-999.md',
        'docs/plans/WAVE4_STATE.md',
        'docs/plans/WAVE4_ARCHIVE.md',
        'WEAKNESSES_AND_FAILURES.md',
        'docs/design-v2/DECISIONS.md',
      ]) {
        expect(kindsAt(rel, all).sort()).toEqual(['email', 'name', 'objectid', 'path']);
      }
    });

    it('an identity file is exempt for names and emails, never for paths', () => {
      const text = `Ada Quill <ada.quill@example.org> ${PATHS.windows('ada', 'x')}`;
      for (const rel of ['WORK_LEDGER.md', 'scripts/coord/lib/collide.js', 'backend/tests/coord.collide.test.js']) {
        expect(kindsAt(rel, text)).toEqual(['path']);
      }
      expect(kindsAt('backend/tests/shadow.coord.fallback.test.js', text)).toEqual(['name', 'email', 'path']);
    });

    it('an ObjectId is a hit in *.md, in the production scripts (J17) and under docs/, and nowhere else', () => {
      const id = 'account 6523ab12cd34ef56ab78cd90';
      for (const rel of [
        'TASKS.md',
        'docs/x.md',
        'backend/scripts/x.js',
        'backend/app/scripts/x.js',
        'scripts/atlas/x.mjs',
        'docs/audits/x/findings.json',
        'docs/canvas/x.html',
      ]) {
        expect(kindsAt(rel, id)).toEqual(['objectid']);
      }
      for (const rel of [
        'backend/tests/x.test.js',
        'backend/app/models/x.js',
        'mobile/KokonadaHealth/ios/KokonadaHealth.xcodeproj/project.pbxproj',
        'scripts/coord/x.js',
        'backend/scripts.md.js',
      ]) {
        expect(kindsAt(rel, id)).toEqual([]);
      }
    });
  });

  describe('the path key keeps two segments after the user (a tested decision)', () => {
    const keyOf = (text, depth) => pathKey(findHits(text)[0].segments, depth);

    it('is two', () => {
      expect(PATH_KEY_DEPTH).toBe(2);
    });

    it('every spelling of one folder is one key', () => {
      const keys = Object.values(PATHS).map((make) => keyOf(make('ada', 'Videos', 'Kokonada', 'docs', 'x.md')));
      keys.push(keyOf(PATHS.windows('Ada', 'VIDEOS', 'Kokonada.')));
      keys.push(keyOf(['c:', 'users', 'ada', 'videos', 'kokonada'].join('\\')));
      expect([...new Set(keys)]).toEqual(['path:ada/videos/kokonada']);
    });

    it('a reference the reorganisation rewrites keeps its key; at depth three it would be a new key', () => {
      const before = PATHS.windows('ada', 'Videos', 'Kokonada', 'KOKONADA_ARCHITECTURE_MASTER.md');
      const after = PATHS.windows('ada', 'Videos', 'Kokonada', 'docs', 'architecture', 'architecture-master.md');
      expect(keyOf(before)).toBe(keyOf(after));
      expect(keyOf(before, 3)).not.toBe(keyOf(after, 3));
    });

    it('another folder under the same home is another key; at depth one it would not be', () => {
      const ours = PATHS.windows('ada', 'Videos', 'Kokonada');
      const other = PATHS.windows('ada', 'Videos', 'kokonada.github.io');
      expect(keyOf(ours)).not.toBe(keyOf(other));
      expect(keyOf(ours, 1)).toBe(keyOf(other, 1));
    });
  });

  describe('the baseline counts occurrences per key, and no key names a file', () => {
    const KEY = 'path:ada/videos/kokonada';
    const hitAt = (rel, key) => ({ path: rel, line: 1, kind: key.split(':')[0], key });

    it('a key the baseline does not hold fails, naming where it occurs', () => {
      expect(verdict([hitAt('docs/a.md', KEY)], {})).toEqual([{ key: KEY, count: 1, allowed: 0, at: ['docs/a.md:1'] }]);
    });

    it('one more occurrence of a baselined key fails, in whichever file it lands', () => {
      const findings = verdict([hitAt('docs/a.md', KEY), hitAt('backend/tests/new.test.js', KEY)], { [KEY]: 1 });
      expect(findings).toEqual([{ key: KEY, count: 2, allowed: 1, at: ['docs/a.md:1', 'backend/tests/new.test.js:1'] }]);
      expect(judge(findings)).toEqual({ failures: findings, warnings: [] });
    });

    it('a file that moves changes nothing', () => {
      const text = PATHS.windows('ada', 'Videos', 'Kokonada');
      const before = sweep([{ path: 'backend/docs/a.md', text }]);
      const after = sweep([{ path: 'docs/store/a.md', text }]);
      expect(tally(before)).toEqual({ [KEY]: 1 });
      expect(verdict(after, tally(before))).toEqual([]);
    });

    it('fewer occurrences than the baseline fail for a name, an email or an ObjectId, and warn for a path (DAN-055 item (2))', () => {
      const keys = ['name:ab', 'email:cd', 'objectid:ef', KEY];
      const findings = verdict([], Object.fromEntries(keys.map((key) => [key, 1])));
      expect(findings).toEqual(keys.map((key) => ({ key, count: 0, allowed: 1 })));
      expect(judge(findings)).toEqual({
        failures: findings.slice(0, 3),
        warnings: [{ key: KEY, count: 0, allowed: 1 }],
      });
    });

    it('the computed baseline prints as the literal to review, sorted by key', () => {
      expect(renderBaseline({ [KEY]: 2, 'name:ab': 1 })).toBe(
        "const BASELINE = Object.freeze({\n  'name:ab': 1,\n  'path:ada/videos/kokonada': 2,\n});",
      );
    });
  });

  describe('every tracked file is read as text, whatever its encoding', () => {
    const text = `log ${PATHS.windows('ada', 'x')}`;
    const utf8 = Buffer.from(text, 'utf8');
    const little = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);

    it('UTF-8 with or without its mark, and UTF-16 of either byte order by its mark', () => {
      expect(decodeText(utf8)).toBe(text);
      expect(decodeText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8]))).toBe(text);
      expect(decodeText(little)).toBe(text);
      expect(decodeText(Buffer.from(little).swap16())).toBe(text);
    });

    it('a NUL byte without a mark is not text', () => {
      expect(decodeText(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]))).toBeNull();
      expect(decodeText(Buffer.concat([utf8, Buffer.from([0x00])]))).toBeNull();
    });

    it('a listed binary extension is never read; a NUL in any other file is reported, unless TEXT_WITH_NUL names the file', () => {
      const blobs = {
        'a.txt': Buffer.from([0x41, 0x00]),
        'b.md': utf8,
        'c.log': Buffer.from(little).swap16(),
        [TEXT_WITH_NUL[1]]: Buffer.from([0x41, 0x00, 0x42]),
      };
      const read = jest.fn((rel) => blobs[rel]);
      const { files, notText } = readAsText(['x.png', 'a.txt', 'b.md', 'c.log', TEXT_WITH_NUL[1]], read);
      expect(read).not.toHaveBeenCalledWith('x.png');
      expect(notText).toEqual(['a.txt']);
      expect(files).toEqual([
        { path: 'b.md', text },
        { path: 'c.log', text },
        { path: TEXT_WITH_NUL[1], text: 'A\u0000B' },
      ]);
    });
  });

  describe('the sweep over the tracked tree', () => {
    const { files, notText } = trackedTextFiles();
    const hits = sweep(files);
    const textOf = (rel) => (files.find((file) => file.path === rel) || {}).text;

    it('actually read the repository (an empty corpus would be a false green)', () => {
      expect(files.length).toBeGreaterThan(500);
      for (const rel of ['CLAUDE.md', 'TASKS.md', 'WORK_LEDGER.md', SELF]) expect(textOf(rel)).toEqual(expect.any(String));
    });

    it('WORK_LEDGER.md, where they are identity, still carries every embedded hash (a stale hash is a hole)', () => {
      const found = findHits(textOf('WORK_LEDGER.md') || '', { objectIds: true }).map((hit) => hit.key);
      for (const { sha256: digest } of IDENTITIES.name) expect(found).toContain(`name:${digest}`);
      for (const { sha256: digest } of IDENTITIES.email) expect(found).toContain(`email:${digest}`);
    });

    it('every file with a text extension is text (a NUL byte there is a UTF-16 file without its mark, or a binary with a wrong extension)', () => {
      expect(notText).toEqual([]);
    });

    it('no tracked file adds a personal identifier beyond the baseline, or has left room for one', () => {
      const { failures, warnings } = judge(verdict(hits));
      if (warnings.length) {
        console.warn(`path keys below the baseline (a shortfall only warns until DAN-055 item (2)); lower these counts:\n${JSON.stringify(warnings, null, 2)}`);
      }
      if (failures.length) console.log(`the computed baseline, for review:\n${renderBaseline(tally(hits))}`);
      expect(failures).toEqual([]);
    });
  });
});

module.exports = {
  sweep,
  findHits,
  tally,
  verdict,
  judge,
  renderBaseline,
  decodeText,
  readAsText,
  trackedTextFiles,
  pathKey,
  IDENTITIES,
  BASELINE,
  BINARY_EXT,
  TEXT_WITH_NUL,
  OBJECT_ID_FILES,
};
