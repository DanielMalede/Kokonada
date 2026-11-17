/// <reference types="node" />
import { createHash } from 'crypto';
import { checkPins, checkRetireEntries, parseDecStatus, pinState, readDecStatus } from '../guards/retire';

// QA-118's reader and the RETIRE rule (DEC-091), on sources assembled in memory (D8 rule 2). The real
// pins are checked against the real tree in src/__contracts__/__tests__/pins.test.ts.

const q = (s: string) => String.fromCharCode(39) + s + String.fromCharCode(39);
const PINNED = 'expect(a).toBe(1);\n    expect(b).toBe(' + q('x') + ');';
const SRC = [
  'describe(' + q('tokens') + ', () => {',
  '  it(' + q('exact') + ', () => {',
  '    const a = 1;',
  '    ' + PINNED,
  '  });',
  '  it.skip(' + q('off') + ', () => {',
  '    ' + PINNED,
  '  });',
  '});',
].join('\n');
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const PIN = { id: 'P-exact', file: 'mobile/x/__tests__/t.test.ts', fullTitle: 'tokens exact', statements: 2, sha256: sha(PINNED), description: 'two pinned values', ref: 'QA-118' };
const decided = (dec: string) => (dec === 'DEC-091' ? 'DECIDED' : dec === 'DEC-039' ? 'OPEN' : null);
const RETIRE_OK = { kind: 'pin' as const, target: 'P-exact', dec: 'DEC-091', reason: 'retired for v2' };

describe('pinState (QA-118: a pin is a window of statements inside a named test, by SHA-256)', () => {
  it('holds on the real text, and on the same text with CRLF line ends', () => {
    expect(pinState(PIN, SRC)).toBe('held');
    expect(pinState(PIN, SRC.split('\n').join('\r\n'))).toBe('held');
  });

  it('still holds when a statement is added elsewhere in the test', () => {
    expect(pinState(PIN, SRC.replace('const a = 1;', 'const a = 1;\n    const extra = 2;'))).toBe('held');
  });

  it('reads a re-pointed expected value as changed', () => {
    expect(pinState(PIN, SRC.replace(q('x'), q('y')))).toBe('changed');
  });

  it('reads a deleted or renamed test as absent', () => {
    expect(pinState(PIN, SRC.replace(q('exact'), q('renamed')))).toBe('absent');
  });

  it('reads a skipped pinned test as skipped', () => {
    expect(pinState({ ...PIN, fullTitle: 'tokens off' }, SRC)).toBe('skipped');
  });
});

describe('the RETIRE rule (DEC-091: a retirement cites a DECIDED DEC)', () => {
  it('reads a DEC status from its front matter', () => {
    expect(parseDecStatus('---\nid: DEC-1\nstatus: DECIDED\n---\n- status: OPEN\n')).toBe('DECIDED');
    expect(parseDecStatus('---\nid: DEC-1\nstatus: OPEN\n---\n')).toBe('OPEN');
    expect(parseDecStatus('no front matter\nstatus: DECIDED\n')).toBeNull();
  });

  it('reads the real decision records', () => {
    expect(readDecStatus('DEC-091')).toBe('DECIDED');
    expect(readDecStatus('DEC-039')).toBe('OPEN');
    expect(readDecStatus('DEC-999')).toBeNull();
    expect(readDecStatus('DEC-91')).toBeNull();
    expect(readDecStatus('../DEC-091')).toBeNull();
  });

  it('accepts an entry citing a DECIDED DEC with a reason', () => {
    expect(checkRetireEntries([RETIRE_OK], decided)).toEqual([]);
  });

  it.each([
    ['a DEC that does not exist', { ...RETIRE_OK, dec: 'DEC-998' }, 'RETIRE pin P-exact: DEC-998 does not exist'],
    ['a DEC that is not DECIDED', { ...RETIRE_OK, dec: 'DEC-039' }, 'RETIRE pin P-exact: DEC-039 is OPEN, not DECIDED'],
    ['a malformed DEC id', { ...RETIRE_OK, dec: 'D12' }, 'RETIRE pin P-exact: D12 is not a DEC-nnn id'],
    ['no reason', { ...RETIRE_OK, reason: ' ' }, 'RETIRE pin P-exact: no reason'],
  ])('red on %s', (_label, entry, failure) => {
    expect(checkRetireEntries([entry], decided)).toEqual([failure]);
  });

  it('red on two entries for one target', () => {
    expect(checkRetireEntries([RETIRE_OK, RETIRE_OK], decided)).toEqual(['RETIRE pin P-exact: named twice']);
  });
});

describe('checkPins (QA-118: retired with a signed RETIRE entry, never re-pointed)', () => {
  const at = (src: string | null) => (f: string) => (f === PIN.file ? src : null);
  const deleted = SRC.replace(q('exact'), q('gone'));

  it('passes when every pin holds and nothing retires it', () => {
    expect(checkPins([PIN], at(SRC), [], decided)).toEqual([]);
  });

  it('red on a re-pointed value, with or without a RETIRE entry', () => {
    const repointed = SRC.replace(q('x'), q('y'));
    expect(checkPins([PIN], at(repointed), [], decided)).toEqual([
      'pin P-exact: the pinned assertion in mobile/x/__tests__/t.test.ts "tokens exact" changed (a v1 pin is retired with a RETIRE entry, never re-pointed)',
    ]);
    expect(checkPins([PIN], at(repointed), [RETIRE_OK], decided)).toContain(
      'pin P-exact: a RETIRE entry names it, but "tokens exact" is still in mobile/x/__tests__/t.test.ts',
    );
  });

  it('a deleted pinned test is red with no RETIRE entry and green with a valid one', () => {
    expect(checkPins([PIN], at(deleted), [], decided)).toEqual(['pin P-exact: "tokens exact" is gone from mobile/x/__tests__/t.test.ts with no RETIRE entry']);
    expect(checkPins([PIN], at(null), [], decided)).toEqual(['pin P-exact: "tokens exact" is gone from mobile/x/__tests__/t.test.ts with no RETIRE entry']);
    expect(checkPins([PIN], at(deleted), [RETIRE_OK], decided)).toEqual([]);
    expect(checkPins([PIN], at(null), [RETIRE_OK], decided)).toEqual([]);
  });

  it('a deletion whose RETIRE cites an OPEN or missing DEC is red', () => {
    expect(checkPins([PIN], at(deleted), [{ ...RETIRE_OK, dec: 'DEC-039' }], decided)).toEqual(['RETIRE pin P-exact: DEC-039 is OPEN, not DECIDED']);
    expect(checkPins([PIN], at(deleted), [{ ...RETIRE_OK, dec: 'DEC-998' }], decided)).toEqual(['RETIRE pin P-exact: DEC-998 does not exist']);
  });

  it('red on a RETIRE entry for a pin still in place', () => {
    expect(checkPins([PIN], at(SRC), [RETIRE_OK], decided)).toEqual(['pin P-exact: a RETIRE entry names it, but "tokens exact" is still in mobile/x/__tests__/t.test.ts']);
  });

  it('red on a skipped pinned test', () => {
    const skipped = SRC.replace('it(' + q('exact'), 'it.skip(' + q('exact'));
    expect(checkPins([PIN], at(skipped), [], decided)).toEqual(['pin P-exact: "tokens exact" in mobile/x/__tests__/t.test.ts is skipped (retire it with a RETIRE entry instead)']);
  });

  it('red on a RETIRE entry for a pin that is not listed, and on a duplicate pin id', () => {
    expect(checkPins([PIN], at(SRC), [{ ...RETIRE_OK, target: 'P-unknown' }], decided)).toEqual(['RETIRE pin P-unknown: no such pin']);
    expect(checkPins([PIN, PIN], at(SRC), [], decided)).toEqual(['pin P-exact: listed twice']);
  });

  it('ignores RETIRE entries of other kinds', () => {
    expect(checkPins([PIN], at(SRC), [{ kind: 'file', target: 'src/a.test.ts', dec: 'DEC-091', reason: 'r' }], decided)).toEqual([]);
  });
});
