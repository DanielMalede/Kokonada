'use strict';

// Resilience review of #268 at 493dc4f (RA-1 to RA-4): the personal-data guard at boundaries its own
// suite does not pin. Every case is RED at 493dc4f. Every path is built at run time, as the guard's
// own self-tests build theirs, so this file is never a hit of the sweep it tests.

const path = require('path');

// The guard is itself a test file. Required as it is, it would register its suite here a second time
// and sweep the tree again (its only process spawn, `git ls-files`, sits inside that suite). Only its
// pure functions are needed, so its top-level describe() is a no-op while it loads.
function loadGuard() {
  const realDescribe = global.describe;
  global.describe = () => {};
  try {
    return require(path.join(__dirname, 'personalDataGuard.test.js'));
  } finally {
    global.describe = realDescribe;
  }
}

const guard = loadGuard();
const home = (...segments) => ['C:', 'Users', 'ada', ...segments].join('\\');
const kinds = (hits) => hits.map((hit) => hit.kind).sort();

describe('shadow - personal-data guard boundaries (#268 RA-1 to RA-4)', () => {
  describe('RA-1 - the ratchet is exact', () => {
    const key = 'path:ada/videos/kokonada';
    const hit = { path: 'docs/a.md', line: 1, kind: 'path', key };

    it('fewer occurrences than the baseline fail, as more do', () => {
      expect(typeof guard.verdict).toBe('function');
      expect(guard.verdict([hit, hit], { [key]: 2 })).toEqual([]);
      expect(guard.verdict([hit], { [key]: 2 })).toEqual([{ key, count: 1, allowed: 2 }]);
      expect(guard.verdict([hit, hit, hit], { [key]: 2 })).toEqual([
        { key, count: 3, allowed: 2, at: ['docs/a.md:1', 'docs/a.md:1', 'docs/a.md:1'] },
      ]);
    });

    it('the embedded identities are a closed list, pinned like the exemption lists', () => {
      expect(guard.IDENTITIES).toEqual({
        name: [expect.any(Object), expect.any(Object)],
        email: [expect.any(Object)],
      });
    });
  });

  describe('RA-2 - a frozen record is an existing file, not a folder that grows', () => {
    it('a new decision or registry entry is swept for every kind', () => {
      const text = `account \`6523ab12cd34ef56ab78cd90\` captured at \`${home('x', 'y')}\``;
      for (const rel of ['docs/design-v2/decisions/DEC-999.md', 'docs/design-v2/registry/QA-999.md']) {
        expect(kinds(guard.sweep([{ path: rel, text }]))).toEqual(['objectid', 'path']);
      }
    });
  });

  describe('RA-3 - every spelling of a Windows home is a user path', () => {
    it('the WSL and Cygwin mounts and an upper-case USERS give the same key as the drive form', () => {
      const expected = guard.findHits(home('x'))[0].key;
      for (const text of [
        ['', 'mnt', 'c', 'Users', 'ada', 'x'].join('/'),
        ['', 'cygdrive', 'c', 'Users', 'ada', 'x'].join('/'),
        ['C:', 'USERS', 'ada', 'x'].join('\\'),
      ]) {
        const hits = guard.findHits(`at ${text}`);
        expect(kinds(hits)).toEqual(['path']);
        expect(hits[0].key).toBe(expected);
      }
    });
  });

  describe('RA-4 - UTF-16 text is text', () => {
    it('a UTF-16 file with a byte-order mark is decoded, and a real binary stays skipped', () => {
      expect(typeof guard.decodeText).toBe('function');
      const text = `log ${home('x')}`;
      const little = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
      const big = Buffer.from(little).swap16();
      expect(guard.decodeText(little)).toBe(text);
      expect(guard.decodeText(big)).toBe(text);
      expect(guard.decodeText(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]))).toBeNull();
    });
  });
});
