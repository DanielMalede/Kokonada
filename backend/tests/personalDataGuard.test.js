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
//   path         an absolute path into a user's home: X:\Users\<u>, /x/Users/<u>, //x/Users/<u>,
//                /home/<u>, /Users/<u>. The CI runner's /home/runner is the platform's account.
//   objectid     a 24-hex Mongo ObjectId, in *.md files only: code and tests carry made-up ids by
//                design, a document carries a real one by accident (SEC-264-L3).
// NOT HITS: a GitHub login, its @ form (the coordinator writes "Malede (@DanielMalede)" into
// TASKS.md) and the GitHub noreply address are identity under CLAUDE.md; the first name alone is the
// repository's convention (DAN-055).
//
// EXEMPT, each list a closed literal that a test pins by equality, so widening one is a visible
// edit in review: the machinery's own paths inside the instruction layer; the frozen records that
// docs/ARCHIVE.md line 14 names (never edited, so a hit there could never be fixed); and the identity
// files, for names and emails only.
//
// THE BASELINE COUNTS OCCURRENCES PER KEY, AND NO KEY NAMES A FILE. A key is the kind and the
// identifier's hash, or for a path the user and the first PATH_KEY_DEPTH segments after it. It never
// names the file a hit sits in: open PRs #264 and #265 move many of these files, and a path-keyed
// baseline would break whichever merges second. It counts instead of listing because a list of keys
// cannot see a new occurrence of a key that already occurs, and every name and email key already
// occurs outside the identity files (CLAUDE.md, .claude/agents/coordinator.md, TASKS.md and others):
// a list would have admitted the owner's full name in any new file, the two test fixtures this
// guard was written against included. More occurrences than the baseline fail; fewer are reported
// and pass until a follow-up row makes the ratchet strict.

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
// Exactly as docs/ARCHIVE.md line 14 lists them on origin/main at 6a3faf7.
const FROZEN_RECORDS = [
  'docs/design-v2/decisions/**',
  'docs/design-v2/registry/**',
  'docs/plans/WAVE4_STATE.md',
  'docs/plans/WAVE4_ARCHIVE.md',
  'WEAKNESSES_AND_FAILURES.md',
];
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
const FROZEN_RES = FROZEN_RECORDS.map(globRegExp);
const IDENTITY_RES = IDENTITY_FILES.map(globRegExp);

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
const USER_PATH = new RegExp(
  String.raw`(?<![\p{L}\p{N}_.~%-])` +
    String.raw`(?:[A-Za-z]:[\\/]+[Uu]sers|\/{1,2}[A-Za-z]\/+[Uu]sers|\/Users|\/(home))` +
    String.raw`[\\/]+([\p{L}\p{N}_]${SEGMENT}*)((?:[\\/]+${SEGMENT}+)*)`,
  'gu',
);

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
function findHits(text, { markdown = false, identities = IDENTITIES } = {}) {
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

  // Every shape needs "Users", "users" or "/home": a text with none of them cannot hold one.
  for (const match of /[Uu]sers|\/home/.test(text) ? text.matchAll(USER_PATH) : []) {
    const [, home, user, rest] = match;
    if (home && user === 'runner') continue; // the CI runner's home, not a person's
    const segments = pathSegments(user, rest);
    hits.push({ kind: 'path', key: pathKey(segments), line: lineOf(match.index), segments });
  }

  if (markdown) {
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
    if (FROZEN_RES.some((re) => re.test(rel))) continue;
    const identityFile = IDENTITY_RES.some((re) => re.test(rel));
    const machineryFile = MACHINERY_RES.some((re) => re.test(rel));
    for (const hit of findHits(text, { markdown: /\.md$/i.test(rel), identities })) {
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

function compareToBaseline(hits, baseline = BASELINE) {
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
  return { counts, over, under };
}

const renderBaseline = (counts) =>
  `const BASELINE = Object.freeze({\n${Object.entries(counts)
    .sort(byKey)
    .map(([key, count]) => `  '${key}': ${count},`)
    .join('\n')}\n});`;

// Computed by renderBaseline(tally(sweep(trackedTextFiles()))) on 6a3faf7, once the two test fixtures
// that carried the owner's full name took a made-up one: every key that occurs, with how often. Raise
// a count only for an occurrence that has to stay, in the PR that adds it, where review sees it.
const BASELINE = Object.freeze({
  'email:a22914b84d9b46fc39f42835c94ea2a9598167ec6cc3f1633cfca8e63e6c8743': 3,
  'name:954729cbf881b8a75e26235ae3a65d8829bc17053969eb8d83537cf9761eb661': 4,
  'name:adfe8812c0f526031b95746f7d4fad52109a65b717c6f74dc49c4ec25f5d275e': 4,
  'objectid:0ec8c18069aede9a63cfff8860f26f0a674511ccad3f113c696e44b25443df5d': 1,
  'objectid:644dd4fe0c6a5cc140d93e6e41ad91a99b2737f82812f55215ce3df6e5ba4711': 1,
  'path:danie/.claude/plans': 1,
  'path:danie/.claude/projects': 3,
  'path:danie/.local/bin': 3,
  'path:danie/appdata/local': 1,
  'path:danie/desktop/hdrlog.js': 2,
  'path:danie/videos/ai-music-app': 2,
  'path:danie/videos/kokonada': 131,
  'path:danie/videos/kokonada-standalone.apk': 1,
  'path:me/repo': 1,
  'path:x.js': 2,
});

const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.icns', '.pdf', '.zip', '.gz', '.tgz', '.jar',
  '.aar', '.apk', '.aab', '.keystore', '.jks', '.ttf', '.otf', '.woff', '.woff2', '.mp3', '.mp4',
  '.wav', '.bin', '.so', '.dylib', '.dll', '.exe',
]);

function trackedTextFiles() {
  const listed = execFileSync('git', ['ls-files', '-z'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean);
  const files = [];
  for (const rel of listed) {
    if (BINARY_EXT.has(path.extname(rel).toLowerCase())) continue;
    let text;
    try {
      text = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    } catch {
      continue;
    }
    if (text.includes('\u0000')) continue; // binary without a known extension
    files.push({ path: rel, text });
  }
  return files;
}

// Built at run time: written out, each would be a hit in this very file, which the sweep does not
// exempt.
const PATHS = {
  windows: (...segments) => ['C:', 'Users', ...segments].join('\\'),
  windowsForward: (...segments) => ['C:', 'Users', ...segments].join('/'),
  jsonEscaped: (...segments) => ['C:', 'Users', ...segments].join('\\\\'),
  msys: (...segments) => ['', 'c', 'Users', ...segments].join('/'),
  msysDouble: (...segments) => ['/', 'c', 'Users', ...segments].join('/'),
  linux: (...segments) => ['', 'home', ...segments].join('/'),
  mac: (...segments) => ['', 'Users', ...segments].join('/'),
};

describe('DAN-055 F1 - personal-data guard (full names, emails, user paths, ObjectIds)', () => {
  // Made-up identities, so the self-tests below never need a real one.
  const SYNTHETIC = {
    name: [identity('ada quill')],
    email: [identity('ada.quill@example.org'), identity('adaquill@gmail.com')],
  };
  const kindsIn = (text, markdown = false) =>
    findHits(text, { markdown, identities: SYNTHETIC }).map((hit) => hit.kind);

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

    it('each of the five absolute user-path shapes, escaped and unescaped', () => {
      for (const make of Object.values(PATHS)) {
        expect(kindsIn('saved at `' + make('ada', 'Videos', 'x') + '`')).toEqual(['path']);
      }
    });

    it('a 24-hex ObjectId in a markdown file', () => {
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
      ]) {
        expect(findHits(text)).toEqual([]);
      }
    });

    it('an ObjectId is a markdown-only kind, and a commit SHA or a longer hex run is not one', () => {
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
      expect(FROZEN_RECORDS).toEqual([
        'docs/design-v2/decisions/**',
        'docs/design-v2/registry/**',
        'docs/plans/WAVE4_STATE.md',
        'docs/plans/WAVE4_ARCHIVE.md',
        'WEAKNESSES_AND_FAILURES.md',
      ]);
      expect(IDENTITY_FILES).toEqual(['WORK_LEDGER.md', 'scripts/coord/**', 'backend/tests/coord.*.test.js']);
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

    it('a frozen record is exempt for every kind; the file beside it is not', () => {
      const all = `Ada Quill, ada.quill@example.org, ${PATHS.windows('ada', 'x', 'y')}, 6523ab12cd34ef56ab78cd90`;
      for (const rel of [
        'docs/design-v2/decisions/DEC-999.md',
        'docs/design-v2/registry/QA-999.md',
        'docs/plans/WAVE4_STATE.md',
        'docs/plans/WAVE4_ARCHIVE.md',
        'WEAKNESSES_AND_FAILURES.md',
      ]) {
        expect(kindsAt(rel, all)).toEqual([]);
      }
      expect(kindsAt('docs/design-v2/DECISIONS.md', all).sort()).toEqual(['email', 'name', 'objectid', 'path']);
    });

    it('an identity file is exempt for names and emails, never for paths', () => {
      const text = `Ada Quill <ada.quill@example.org> ${PATHS.windows('ada', 'x')}`;
      for (const rel of ['WORK_LEDGER.md', 'scripts/coord/lib/collide.js', 'backend/tests/coord.collide.test.js']) {
        expect(kindsAt(rel, text)).toEqual(['path']);
      }
      expect(kindsAt('backend/tests/shadow.coord.fallback.test.js', text)).toEqual(['name', 'email', 'path']);
    });

    it('the frozen records are still the ones docs/ARCHIVE.md names (a stale exemption is a hole)', () => {
      const rules = fs
        .readFileSync(path.join(REPO_ROOT, 'docs', 'ARCHIVE.md'), 'utf8')
        .split(/\r?\n/)
        .find((line) => line.startsWith('Rules:'));
      expect(rules).toEqual(expect.any(String));
      for (const glob of FROZEN_RECORDS) expect(rules).toContain('`' + glob + '`');
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
      expect(compareToBaseline([hitAt('docs/a.md', KEY)], {}).over).toEqual([
        { key: KEY, count: 1, allowed: 0, at: ['docs/a.md:1'] },
      ]);
    });

    it('one more occurrence of a baselined key fails, in whichever file it lands', () => {
      const { over } = compareToBaseline([hitAt('docs/a.md', KEY), hitAt('backend/tests/new.test.js', KEY)], {
        [KEY]: 1,
      });
      expect(over).toEqual([{ key: KEY, count: 2, allowed: 1, at: ['docs/a.md:1', 'backend/tests/new.test.js:1'] }]);
    });

    it('a file that moves changes nothing', () => {
      const text = PATHS.windows('ada', 'Videos', 'Kokonada');
      const before = sweep([{ path: 'backend/docs/a.md', text }]);
      const after = sweep([{ path: 'docs/store/a.md', text }]);
      expect(tally(before)).toEqual({ [KEY]: 1 });
      expect(compareToBaseline(after, tally(before))).toMatchObject({ over: [], under: [] });
    });

    it('fewer occurrences than the baseline are reported, and pass until the ratchet is strict', () => {
      expect(compareToBaseline([], { [KEY]: 2 })).toMatchObject({
        over: [],
        under: [{ key: KEY, count: 0, allowed: 2 }],
      });
    });

    it('the computed baseline prints as the literal to review, sorted by key', () => {
      expect(renderBaseline({ [KEY]: 2, 'name:ab': 1 })).toBe(
        "const BASELINE = Object.freeze({\n  'name:ab': 1,\n  'path:ada/videos/kokonada': 2,\n});",
      );
    });
  });

  describe('the sweep over the tracked tree', () => {
    const files = trackedTextFiles();
    const hits = sweep(files);
    const textOf = (rel) => (files.find((file) => file.path === rel) || {}).text;

    it('actually read the repository (an empty corpus would be a false green)', () => {
      expect(files.length).toBeGreaterThan(500);
      for (const rel of ['CLAUDE.md', 'TASKS.md', 'WORK_LEDGER.md', SELF]) expect(textOf(rel)).toEqual(expect.any(String));
    });

    it('WORK_LEDGER.md, where they are identity, still carries every embedded hash (a stale hash is a hole)', () => {
      const found = findHits(textOf('WORK_LEDGER.md') || '', { markdown: true }).map((hit) => hit.key);
      for (const { sha256: digest } of IDENTITIES.name) expect(found).toContain(`name:${digest}`);
      for (const { sha256: digest } of IDENTITIES.email) expect(found).toContain(`email:${digest}`);
    });

    it('no tracked file adds a personal identifier beyond the baseline', () => {
      const { counts, over, under } = compareToBaseline(hits);
      if (under.length) {
        console.warn(`fewer occurrences than the baseline; lower these counts:\n${JSON.stringify(under, null, 2)}`);
      }
      if (over.length) console.log(`the computed baseline, for review:\n${renderBaseline(counts)}`);
      expect(over).toEqual([]);
    });
  });
});

module.exports = { sweep, findHits, tally, compareToBaseline, renderBaseline, trackedTextFiles, pathKey, BASELINE };
