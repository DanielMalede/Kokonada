/// <reference types="node" />
import * as path from 'path';
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import ts from 'typescript';
import type { MotionTier } from '../../../motion/useMotionPolicy.ts';
import type { PlatePoint } from '../../Plate/geometry.ts';
import { DirectionProvider } from '../../../tokens/DirectionProvider.tsx';
import type { BeadLooks } from '../beadDriver.ts';
import { entranceOpacity } from '../beadTimeline.ts';
import { useBeadPresence, type BeadPresenceHandle } from '../useBeadPresence.ts';

// Ruling 2, the Bead/ half (2026-11-25): one presence for the beads and the rim words. The page calls
// useBeadPresence(taps, tier) once and hands its beads and its looks to BeadLayer and to hero A's RimLabels, whose
// letters fade back as a leaving bead fades, both read from the looks the beads' driver writes (UI-320). The hook
// stamps each entrance and exit on the JS clock (performance.now(), which jest's fake timers drive here); the driver
// reports an exit that ended, and the presence drops that bead.

jest.mock('react-native-reanimated', () => require('./__fixtures__/uiThread').uiThreadMock());
const ui = (jest.requireMock('react-native-reanimated') as { __ui: import('./__fixtures__/uiThread.ts').UiThread }).__ui;

jest.useFakeTimers();
afterAll(() => jest.useRealTimers());

const A = { x: 0.6, y: 0.6 };
const B = { x: 0.6, y: -0.6 };
const C = { x: -0.6, y: -0.6 };
const SLOW = { timeScale: 8 };

function mount(taps: readonly PlatePoint[], tier: MotionTier = 'full') {
  const seen: BeadPresenceHandle[] = [];
  function Probe({ t, m }: { readonly t: readonly PlatePoint[]; readonly m: MotionTier }) {
    seen.push(useBeadPresence(t, m));
    return null;
  }
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(<DirectionProvider direction="abyss" face="dark"><Probe t={taps} m={tier} /></DirectionProvider>);
  });
  const update = (next: readonly PlatePoint[], nextTier: MotionTier = tier) => act(() => tree.update(<DirectionProvider direction="abyss" face="dark"><Probe t={next} m={nextTier} /></DirectionProvider>));
  const last = () => seen[seen.length - 1];
  const advance = (ms: number) => act(() => {
    jest.advanceTimersByTime(ms);
  });
  return { seen, update, last, advance };
}

describe('useBeadPresence', () => {
  it('shows the taps present at the mount whole, in order', () => {
    const { last } = mount([A, B]);
    expect(last().beads.map((b) => [b.point, b.leaving, b.placedAt, b.leftAt, b.startOpacity])).toEqual([
      [A, false, null, null, 1],
      [B, false, null, null, 1],
    ]);
  });

  it('stamps a placed tap’s entrance with the JS clock, in the render that shows it', () => {
    const { update, last, advance } = mount([A]);
    advance(250);
    const now = performance.now();
    update([A, B]);
    expect(last().beads[1]).toMatchObject({ point: B, leaving: false, placedAt: now, leftAt: null });
  });

  it('stamps leftAt when a bead starts leaving, with its opacity at that moment', () => {
    const { update, last, advance } = mount([]);
    update([A]);
    const placed = performance.now();
    advance(30);
    update([]);
    expect(last().beads).toEqual([{ id: 0, point: A, leaving: true, placedAt: placed, leftAt: placed + 30, startOpacity: entranceOpacity(30) }]);
  });

  it('drops a leaving bead when the driver reports its exit ended, and only that one; the looks are one value for the hook’s life', () => {
    const { update, last, seen } = mount([A, B]);
    update([A]);
    expect(last().beads.map((b) => [b.id, b.leaving])).toEqual([[0, false], [1, true]]);
    // Frames on the UI thread until the exit ends; JS hears of it, and the presence drops bead 1 alone.
    for (let t = 0; t <= 500; t += 10) {
      ui.frame(t);
      act(() => ui.flushJS());
    }
    expect(last().beads.map((b) => b.id)).toEqual([0]);
    expect(new Set(seen.map((s) => s.looks)).size).toBe(1);
  });

  it('hands the lab’s time scale to the driver: at 8 the exit ends eight times later', () => {
    const seen: BeadPresenceHandle[] = [];
    function Probe({ t }: { readonly t: readonly PlatePoint[] }) {
      seen.push(useBeadPresence(t, 'full', SLOW));
      return null;
    }
    const element = (t: readonly PlatePoint[]) => <DirectionProvider direction="abyss" face="dark"><Probe t={t} /></DirectionProvider>;
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(element([A]));
    });
    act(() => tree.update(element([])));
    const run = (from: number, to: number) => {
      for (let t = from; t <= to; t += 10) {
        ui.frame(t);
        act(() => ui.flushJS());
      }
    };
    run(0, 3000);
    expect(seen[seen.length - 1].beads.map((b) => b.id)).toEqual([0]);
    const looks: BeadLooks = seen[0].looks.value;
    expect(looks[0].opacity).toBeGreaterThan(0);
    run(3010, 3700);
    expect(seen[seen.length - 1].beads).toEqual([]);
    act(() => tree.unmount());
  });

  it('the same taps in a new array, or a re-render, keep the very same beads (a reader may memo on them)', () => {
    const { update, last } = mount([A, B]);
    const before = last().beads;
    update([{ ...A }, { ...B }]);
    expect(last().beads).toBe(before);
  });

  it('under reduced motion a placed tap is whole and a removed one is gone in the same render', () => {
    const { update, last } = mount([A], 'still');
    update([A, B], 'still');
    expect(last().beads.map((b) => [b.id, b.placedAt, b.leaving])).toEqual([[0, null, false], [1, null, false]]);
    update([A], 'still');
    expect(last().beads.map((b) => b.id)).toEqual([0]);
  });

  it('turning reduced motion on ends the exits that were running, in that render', () => {
    const { update, last } = mount([A, B, C]);
    update([C]);
    expect(last().beads.filter((b) => b.leaving)).toHaveLength(2);
    update([C], 'still');
    expect(last().beads.map((b) => [b.id, b.leaving])).toEqual([[2, false]]);
  });
});

// Hero A's RimBead and RimLooks (RimLabels/, ruling 2; UI-320), copied here and never imported: RimLabels takes the
// presence's beads as its `beads` and the presence's looks as its `looks`, a shared value of this type. If either drifts,
// this file stops compiling, and the program below (the project's own tsconfig, in-process: CI runs jest, not tsc) fails
// the test.
interface RimBead {
  readonly id: number;
  readonly point: PlatePoint;
  readonly leaving: boolean;
}
type RimLooks = { readonly value: Readonly<Record<number, { readonly opacity: number; readonly start: number | null }>> };

/** Never called: it only has to compile. */
export function rimBeadPin(handle: BeadPresenceHandle): readonly [readonly RimBead[], RimLooks] {
  return [handle.beads, handle.looks];
}

const THIS_FILE = path.resolve(__dirname, 'useBeadPresence.test.tsx');

/** The semantic diagnostics of this file under the project's tsconfig, its text replaced by `text` when given. */
function diagnosticsOf(text?: string): string[] {
  const configPath = path.resolve(__dirname, '../../../../../../tsconfig.json');
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: (d) => { throw new Error(String(d.messageText)); } });
  if (!parsed || parsed.options.strict !== true) throw new Error('the project tsconfig did not parse with strict on');
  const host = ts.createCompilerHost(parsed.options, true);
  const read = host.readFile.bind(host);
  const same = (f: string) => path.resolve(f).toLowerCase() === THIS_FILE.toLowerCase();
  host.readFile = (f) => (text !== undefined && same(f) ? text : read(f));
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (f, v, onError, fresh) => (text !== undefined && same(f) ? ts.createSourceFile(f, text, v, true) : getSourceFile(f, v, onError, fresh));
  const program = ts.createProgram({ rootNames: [THIS_FILE], options: parsed.options, host });
  const file = program.getSourceFiles().find((f) => same(f.fileName));
  if (!file) throw new Error('the program did not read this file');
  return program.getSemanticDiagnostics(file).map((d) => `${d.start === undefined ? '?' : file.getLineAndCharacterOfPosition(d.start).line + 1}: TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
}

describe('the presence fits hero A’s RimBead and its looks prop (compiled, not assumed)', () => {
  const source = ts.sys.readFile(THIS_FILE)!;
  /** The line of the pin's return in `text`, where a planted text's diagnostic must land. */
  const returnLineOf = (text: string) => text.slice(0, text.indexOf('return [handle.beads, handle.looks];')).split('\n').length;

  it('this file compiles clean under the project’s strict tsconfig', () => {
    expect(diagnosticsOf()).toEqual([]);
  }, 120_000);

  it('planted: a RimBead with a field the entries lack, or looks whose opacity is a string, does not compile', () => {
    const extraField = source.replace('readonly leaving: boolean;\n}', 'readonly leaving: boolean;\n  readonly ordinal: number;\n}');
    const stringClock = source.replace('{ readonly opacity: number; readonly start: number | null }>> };', '{ readonly opacity: string; readonly start: number | null }>> };');
    expect(extraField).not.toBe(source);
    expect(stringClock).not.toBe(source);
    for (const planted of [extraField, stringClock]) {
      const found = diagnosticsOf(planted);
      expect(found.filter((d) => d.startsWith(`${returnLineOf(planted)}:`)).length).toBeGreaterThan(0);
    }
  }, 120_000);
});
