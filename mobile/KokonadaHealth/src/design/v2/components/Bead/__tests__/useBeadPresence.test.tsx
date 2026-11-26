/// <reference types="node" />
import * as path from 'path';
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import ts from 'typescript';
import type { MotionTier } from '../../../motion/useMotionPolicy.ts';
import type { PlatePoint } from '../../Plate/geometry.ts';
import { beadOpacityAt, entranceOpacity } from '../beadTimeline.ts';
import { useBeadPresence, type BeadPresenceHandle } from '../useBeadPresence.ts';

// Ruling 2, the Bead/ half (2026-11-25): one presence for the beads and the rim words. The page calls
// useBeadPresence(taps, tier) once and hands its beads to BeadLayer (with onGone, which drops a bead whose exit ended)
// and to hero A's RimLabels, whose letters fade back as a leaving bead fades (beadOpacityAt). The hook stamps each
// entrance and exit on the JS clock (performance.now(), which jest's fake timers drive here).

jest.useFakeTimers();
afterAll(() => jest.useRealTimers());

const A = { x: 0.6, y: 0.6 };
const B = { x: 0.6, y: -0.6 };
const C = { x: -0.6, y: -0.6 };

function mount(taps: readonly PlatePoint[], tier: MotionTier = 'full') {
  const seen: BeadPresenceHandle[] = [];
  function Probe({ t, m }: { readonly t: readonly PlatePoint[]; readonly m: MotionTier }) {
    seen.push(useBeadPresence(t, m));
    return null;
  }
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(<Probe t={taps} m={tier} />);
  });
  const update = (next: readonly PlatePoint[], nextTier: MotionTier = tier) => act(() => tree.update(<Probe t={next} m={nextTier} />));
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
    expect(last().beads).toEqual([{ id: 0, point: A, leaving: true, placedAt: placed, leftAt: placed + 30, playedAt: null, playMs: null, startOpacity: entranceOpacity(30) }]);
    expect(beadOpacityAt(last().beads[0], placed + 30)).toBe(entranceOpacity(30));
  });

  it('onExitStart stamps when the leaving bead’s clock started its exit and how long it plays, and keeps the hook’s identity across renders', () => {
    const { update, last, seen } = mount([A, B]);
    const leftAt = performance.now();
    update([A]);
    expect(last().beads[1]).toMatchObject({ leaving: true, leftAt, playedAt: null, playMs: null });
    act(() => last().onExitStart(1, leftAt + 250, 350));
    expect(last().beads[1]).toMatchObject({ leaving: true, leftAt, playedAt: leftAt + 250, playMs: 350 });
    expect(beadOpacityAt(last().beads[1], leftAt + 250)).toBe(1);
    expect(new Set(seen.map((h) => h.onExitStart)).size).toBe(1);
  });

  it('onGone drops a leaving bead, and only a leaving one, and keeps the hook’s identity across renders', () => {
    const { update, last, seen } = mount([A, B]);
    update([A]);
    const onGone = last().onGone;
    act(() => last().onGone(0));
    expect(last().beads.map((b) => b.id)).toEqual([0, 1]);
    act(() => last().onGone(1));
    expect(last().beads.map((b) => b.id)).toEqual([0]);
    expect(new Set(seen.map((s) => s.onGone)).size).toBe(1);
    expect(last().onGone).toBe(onGone);
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

// Hero A's RimBead (RimLabels/, ruling 2), copied here and never imported: RimLabels takes the presence's beads as its
// `beads` and beadOpacityAt as a prop of this type. If either drifts, this file stops compiling, and the program below
// (the project's own tsconfig, in-process: CI runs jest, not tsc) fails the test.
interface RimBead {
  readonly point: PlatePoint;
  readonly leaving: boolean;
  readonly leftAt: number | null;
  readonly playedAt: number | null;
  readonly playMs: number | null;
  readonly startOpacity: number;
}
type RimOpacityAt = (b: RimBead, nowMs: number) => number;

/** Never called: it only has to compile. */
export function rimBeadPin(handle: BeadPresenceHandle): readonly [readonly RimBead[], RimOpacityAt] {
  return [handle.beads, beadOpacityAt];
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

describe('the presence fits hero A’s RimBead and its beadOpacityAt prop (compiled, not assumed)', () => {
  const source = ts.sys.readFile(THIS_FILE)!;
  /** The line of the pin's return in `text`, where a planted text's diagnostic must land. */
  const returnLineOf = (text: string) => text.slice(0, text.indexOf('return [handle.beads, beadOpacityAt];')).split('\n').length;

  it('this file compiles clean under the project’s strict tsconfig', () => {
    expect(diagnosticsOf()).toEqual([]);
  }, 120_000);

  it('planted: a RimBead with a field the entries lack, or a prop that takes the clock as a string, does not compile', () => {
    const extraField = source.replace('readonly startOpacity: number;\n}', 'readonly startOpacity: number;\n  readonly ordinal: number;\n}');
    const stringClock = source.replace('type RimOpacityAt = (b: RimBead, nowMs: number) => number;', 'type RimOpacityAt = (b: RimBead, nowMs: string) => number;');
    expect(extraField).not.toBe(source);
    expect(stringClock).not.toBe(source);
    for (const planted of [extraField, stringClock]) {
      const found = diagnosticsOf(planted);
      expect(found.filter((d) => d.startsWith(`${returnLineOf(planted)}:`)).length).toBeGreaterThan(0);
    }
  }, 120_000);
});
