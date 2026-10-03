import { createCommandGate, createReadyGate, formatLine, LAB_TAG, parseCommand } from '../protocol';

// MB-085. The lab speaks to the capture harness in single logcat lines:
//   KOKONADA_LAB <KIND> <one-line JSON>
// READY means the frame on screen is the one the arguments asked for. It is sent only when every
// probe has been measured, the fonts are ready, and N frames have been drawn after that. Commands
// arrive numbered; one that arrives twice, out of order, or before the last one settled is ignored
// (with an IGNORED line), never applied, so a capture can never be of the wrong step.

describe('formatLine', () => {
  it('is the tag, the kind and one line of JSON', () => {
    expect(formatLine('READY', { run: 'r1', seq: 0 })).toBe(`${LAB_TAG} READY {"run":"r1","seq":0}`);
    expect(LAB_TAG).toBe('KOKONADA_LAB');
  });

  it('never emits a line break, whatever the strings hold', () => {
    expect(formatLine('ERROR', { errors: ['a\nb'] })).not.toMatch(/\n/);
  });

  it('refuses a number that is not finite rather than writing null for it', () => {
    expect(() => formatLine('READY', { t: NaN })).toThrow(/finite/);
    expect(() => formatLine('READY', { probes: { a: { px: { x: Infinity } } } })).toThrow(/finite/);
  });
});

describe('parseCommand', () => {
  it('reads a numbered step, one step by default', () => {
    expect(parseCommand({ seq: '1', cmd: 'step' })).toEqual({ ok: true, seq: 1, cmd: 'step', steps: 1 });
    expect(parseCommand({ seq: '7', cmd: 'step', steps: '4' })).toEqual({ ok: true, seq: 7, cmd: 'step', steps: 4 });
  });

  it.each([
    ['no seq', { cmd: 'step' }, 'malformed'],
    ['a seq that is not a positive integer', { seq: '1.5', cmd: 'step' }, 'malformed'],
    ['a zero seq', { seq: '0', cmd: 'step' }, 'malformed'],
    ['an unknown key', { seq: '1', cmd: 'step', t: '5' }, 'malformed'],
    ['a value that is not a string', { seq: 1, cmd: 'step' }, 'malformed'],
    ['a bad step count', { seq: '1', cmd: 'step', steps: '0' }, 'malformed'],
    ['an unknown command', { seq: '1', cmd: 'jump' }, 'unknown-command'],
  ])('refuses %s', (_label, raw, reason) => {
    const r = parseCommand(raw as Record<string, unknown>);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe(reason);
  });
});

describe('createCommandGate', () => {
  it('takes nothing before the launch has settled', () => {
    const gate = createCommandGate();
    expect(gate.offer(1)).toBe('busy');
  });

  it('takes 1, 2, 3 in order, each only after the one before has settled', () => {
    const gate = createCommandGate();
    gate.settle();
    expect(gate.offer(1)).toBe('accept');
    expect(gate.offer(2)).toBe('busy');
    gate.settle();
    expect(gate.offer(2)).toBe('accept');
    gate.settle();
    expect(gate.offer(3)).toBe('accept');
  });

  it('ignores a command that arrives twice, or out of order, and keeps its place', () => {
    const gate = createCommandGate();
    gate.settle();
    expect(gate.offer(1)).toBe('accept');
    gate.settle();
    expect(gate.offer(1)).toBe('duplicate');
    expect(gate.offer(3)).toBe('out-of-order');
    expect(gate.offer(2)).toBe('accept');
    expect(gate.last()).toBe(2);
  });
});

describe('createReadyGate', () => {
  const rect = (x: number) => ({ x, y: 1, width: 2, height: 3 });

  it('fires only once every probe is measured, the fonts are ready, and N frames have drawn after that', () => {
    const fired: unknown[] = [];
    const gate = createReadyGate({ probes: ['a', 'b'], frames: 2, onReady: (s) => fired.push(s) });
    gate.frame(); gate.frame(); gate.frame(); // frames before readiness do not count
    gate.measure('a', rect(1));
    gate.fontsReady();
    expect(gate.wantsFrame()).toBe(false); // b is still unmeasured
    gate.measure('b', rect(2));
    expect(gate.wantsFrame()).toBe(true);
    gate.frame();
    expect(fired).toHaveLength(0);
    gate.frame();
    expect(fired).toEqual([{ probes: { a: rect(1), b: rect(2) } }]);
    expect(gate.wantsFrame()).toBe(false);
    gate.frame();
    expect(fired).toHaveLength(1); // exactly once per arming
  });

  it('waits for the fonts, however many frames go by', () => {
    const fired: unknown[] = [];
    const gate = createReadyGate({ probes: ['a'], frames: 1, onReady: (s) => fired.push(s) });
    gate.measure('a', rect(1));
    for (let i = 0; i < 50; i += 1) gate.frame();
    expect(fired).toHaveLength(0);
    gate.fontsReady();
    gate.frame();
    expect(fired).toHaveLength(1);
  });

  it('re-arms for the next command: N fresh frames, the latest probe positions', () => {
    const fired: Array<{ probes: Record<string, unknown> }> = [];
    const gate = createReadyGate({ probes: ['a'], frames: 1, onReady: (s) => fired.push(s as { probes: Record<string, unknown> }) });
    gate.measure('a', rect(1));
    gate.fontsReady();
    gate.frame();
    gate.measure('a', rect(9));
    gate.rearm();
    expect(fired).toHaveLength(1);
    gate.frame();
    expect(fired[1].probes.a).toEqual(rect(9));
  });

  it('restarts the count when a probe moves while frames are counted: N frames of a STABLE layout', () => {
    const fired: unknown[] = [];
    const gate = createReadyGate({ probes: ['a'], frames: 2, onReady: (s) => fired.push(s) });
    gate.measure('a', rect(1));
    gate.fontsReady();
    gate.frame();
    gate.measure('a', rect(1)); // the same place again: not a move
    gate.frame();
    expect(fired).toHaveLength(1);
    gate.rearm();
    gate.frame();
    gate.measure('a', rect(5)); // moved mid-count
    gate.frame();
    expect(fired).toHaveLength(1);
    gate.frame();
    expect(fired).toHaveLength(2);
  });

  it('refuses a probe the scene did not declare: the registry and the scene disagree', () => {
    const gate = createReadyGate({ probes: ['a'], frames: 1, onReady: () => {} });
    expect(() => gate.measure('stray', rect(1))).toThrow(/stray/);
  });

  it('refuses an empty probe list and a frame count below 1', () => {
    expect(() => createReadyGate({ probes: [], frames: 1, onReady: () => {} })).toThrow(/probe/);
    expect(() => createReadyGate({ probes: ['a'], frames: 0, onReady: () => {} })).toThrow(/frames/);
  });
});
