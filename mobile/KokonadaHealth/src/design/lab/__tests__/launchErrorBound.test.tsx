import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { LabRoot } from '../LabRoot';
import { MAX_ECHO, parseLabArgs } from '../params';
import { Probe } from '../probe/Probe';
import { formatLine, MAX_LINE_BYTES } from '../protocol';
import type { Scene } from '../scenes';
// LabRoot's SCENES reaches FieldView, whose fieldImage.tsx reads Skia's FilterMode on load (__fixtures__/skiaHeadless.ts).
jest.mock('@shopify/react-native-skia', () => require('./__fixtures__/skiaHeadless').skiaHeadless());

// UI-241 (b): the launch's ERROR echoes what the launch sent (an unknown key, a value that is not a number), and those
// echoes were unclipped: one long extra made a line over the 4000 bytes logcat keeps, and formatLine threw inside
// LabRoot's ERROR effect (an uncaught throw, and no ERROR at all). Every echoed value is now cut to MAX_ECHO characters
// (whole code points, so no surrogate pair is split), and a launch whose errors still cannot make one line (many unknown
// keys) gets one short ERROR that says so, with the first error, instead of a throw.

const bytes = (s: string) => Buffer.byteLength(s, 'utf8');
const Stage = () => <Probe id="stage"><Text>x</Text></Probe>;
const SCENES: Record<string, Scene> = { smoke: { periodMs: 6000, probes: ['stage'], Component: Stage } };
const TIMINGS = { smoke: { periodMs: 6000 } };
const FIXED = { run: 'r1', scene: 'smoke', clock: 'fixed', t: '0' };

const errorsOf = (raw: Record<string, unknown>, nonString: string[] = []) => {
  const r = parseLabArgs(raw, nonString, TIMINGS);
  if (r.ok) throw new Error('expected a refusal');
  return r;
};
/** The echo inside the quotes of `<prefix>"<echo>"`. */
const echoOf = (message: string, prefix: string) => {
  expect(message.startsWith(`${prefix}"`)).toBe(true);
  return message.slice(prefix.length + 1, message.lastIndexOf('"'));
};

describe('every value the launch ERROR echoes is clipped to MAX_ECHO characters', () => {
  const LONG = 'q'.repeat(5000);

  it.each([
    ['an unknown key', () => errorsOf({ ...FIXED, [LONG]: '1' }), 'unknown key '],
    ['an unknown key passed as another type', () => errorsOf(FIXED, [LONG]), 'unknown key '],
    ['a time that is not a number', () => errorsOf({ ...FIXED, t: LONG }), 't must be a finite decimal number (got '],
    ['a step that is not a number', () => errorsOf({ run: 'r1', scene: 'smoke', clock: 'stepped', stepMs: LONG }), 'stepMs must be a finite decimal number (got '],
  ])('%s: cut, its start named, the line under the limit', (_label, refuse, prefix) => {
    const r = refuse();
    const message = r.errors.find((e) => e.startsWith(prefix));
    if (message === undefined) throw new Error(`no error starts with ${prefix}: ${r.errors.join(' | ')}`);
    const echo = echoOf(message, prefix);
    expect([...echo]).toHaveLength(MAX_ECHO);
    expect(echo).toBe(`${LONG.slice(0, MAX_ECHO - 1)}…`);
    expect(bytes(formatLine('ERROR', { run: r.run, errors: r.errors }))).toBeLessThan(MAX_LINE_BYTES);
  });

  it('a value exactly MAX_ECHO long is echoed whole, one longer is cut (the boundary)', () => {
    const at = 'a'.repeat(MAX_ECHO);
    expect(echoOf(errorsOf({ ...FIXED, t: at }).errors[0], 't must be a finite decimal number (got ')).toBe(at);
    const over = 'a'.repeat(MAX_ECHO + 1);
    expect(echoOf(errorsOf({ ...FIXED, t: over }).errors[0], 't must be a finite decimal number (got ')).toBe(`${'a'.repeat(MAX_ECHO - 1)}…`);
  });

  it('cuts by code points: a value of emoji is never split inside a surrogate pair', () => {
    const emoji = '\u{1F600}'.repeat(MAX_ECHO + 10);
    const echo = echoOf(errorsOf({ ...FIXED, t: emoji }).errors[0], 't must be a finite decimal number (got ');
    expect(echo).toBe(`${'\u{1F600}'.repeat(MAX_ECHO - 1)}…`);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(echo)).toBe(false);
  });

  it('the worst character for bytes (a control character, six bytes once escaped) still makes one line, for every echo at once', () => {
    const worst = '\u0001'.repeat(5000);
    const r = errorsOf({ run: 'r1', scene: worst, clock: 'fixed', t: worst, [worst]: '1' }, [`${worst}x`]);
    expect(r.errors).toHaveLength(4);
    expect(bytes(formatLine('ERROR', { run: r.run, errors: r.errors }))).toBeLessThan(MAX_LINE_BYTES);
  });

  it('a short value is echoed exactly as given', () => {
    expect(errorsOf({ ...FIXED, colour: 'red' }).errors).toEqual(['unknown key "colour"']);
    expect(errorsOf({ ...FIXED, t: 'NaN' }).errors).toEqual(['t must be a finite decimal number (got "NaN")']);
  });
});

describe('LabRoot sends a short ERROR when the launch errors cannot make one line', () => {
  const mount = (labArgs: Record<string, unknown>, nonStringKeys: string[] = []) => {
    const lines: string[] = [];
    act(() => {
      ReactTestRenderer.create(<LabRoot labArgs={labArgs} nonStringKeys={nonStringKeys} deps={{ emit: (l) => lines.push(l), scenes: SCENES }} />);
    });
    return lines;
  };
  const payloadOf = (line: string) => JSON.parse(line.slice('KOKONADA_LAB ERROR '.length)) as { run: string | null; errors: string[] };

  // 60 unknown keys of 100 characters: each echo is within MAX_ECHO, and together they pass 4000 bytes.
  const MANY_KEYS = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`k${String(i).padStart(2, '0')}${'x'.repeat(97)}`, '1']));

  it('the full line would be over the limit (the case is real)', () => {
    const r = errorsOf({ ...FIXED, ...MANY_KEYS });
    expect(() => formatLine('ERROR', { run: r.run, errors: r.errors })).toThrow(/over the 4000 bytes/);
  });

  it('one ERROR under the limit, with the run, how many errors there were, and the first of them', () => {
    const lines = mount({ ...FIXED, ...MANY_KEYS });
    expect(lines).toHaveLength(1);
    expect(lines[0].startsWith('KOKONADA_LAB ERROR ')).toBe(true);
    expect(bytes(lines[0])).toBeLessThan(MAX_LINE_BYTES);
    const payload = payloadOf(lines[0]);
    expect(payload.run).toBe('r1');
    expect(payload.errors).toHaveLength(1);
    expect(payload.errors[0]).toMatch(/^the launch was refused with 60 errors, too many for one line \(ERROR: the line is \d+ bytes, over the 4000 bytes logcat keeps\); the first: unknown key "k00x+"$/);
  });

  it('the same through the keys that are not strings, with no run', () => {
    const lines = mount({ scene: 'smoke', clock: 'fixed', t: '0' }, Object.keys(MANY_KEYS));
    expect(lines).toHaveLength(1);
    expect(bytes(lines[0])).toBeLessThan(MAX_LINE_BYTES);
    const payload = payloadOf(lines[0]);
    expect(payload.run).toBeNull();
    expect(payload.errors[0]).toMatch(/^the launch was refused with 61 errors, too many for one line/);
  });

  it('a launch whose errors fit is sent whole, as before', () => {
    const lines = mount({ ...FIXED, colour: 'red' });
    expect(lines.map(payloadOf)).toEqual([{ run: 'r1', errors: ['unknown key "colour"'] }]);
  });
});
