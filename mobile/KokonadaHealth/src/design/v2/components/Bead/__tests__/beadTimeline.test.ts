/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';
import { Easing } from 'react-native';
import { BASE } from '../../../tokens/tokens.generated.ts';
import { beadOpacityAt, entranceColour, entranceOpacity, EXIT_MIN_MS, exitColour, exitDuration, exitHold, exitOpacity, exitPlayMs, PRESS_MS, RESPOND_MS } from '../beadTimeline.ts';

// F1 (P0, the designer's rulings of 2026-11-25): a bead is never translucent in colour over the field. Below opacity 1
// it is drawn achromatic; the colour lives on an inner disc that fades only while the bead is opaque. The timeline is
// the two opacities over time: the entrance takes the bead's opacity 0 to 1 over motion.press, then the colour disc
// 0 to 1 over motion.respond from the moment the opacity is 1; the exit takes the colour to 0 over motion.press, then
// the opacity to 0 over motion.respond. Its functions are worklets: hero A's rim words read a leaving bead's opacity
// on the UI thread (beadOpacityAt, ruling 2).

const PRESS = BASE.motion.press;
const RESPOND = BASE.motion.respond;
const curve = (e: readonly number[]) => Easing.bezier(e[0], e[1], e[2], e[3]);
const pressCurve = curve(PRESS.easing);
const respondCurve = curve(RESPOND.easing);
/** Every `step` ms from `from` to `to`, both included. */
const times = (from: number, to: number, step: number) => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => from + i * step);

describe('the entrance (F1): opacity over motion.press, then the colour over motion.respond', () => {
  it('reads the motion tokens: press for the opacity, respond for the colour', () => {
    expect(PRESS_MS).toBe(PRESS.duration);
    expect(RESPOND_MS).toBe(RESPOND.duration);
  });

  it('the opacity runs 0 to 1 on the press curve, and is exactly 1 from press.duration on', () => {
    expect(entranceOpacity(0)).toBe(0);
    for (const t of [5, 20, 50, 80, 99]) expect(entranceOpacity(t)).toBeCloseTo(pressCurve(t / PRESS.duration), 6);
    for (const t of [PRESS.duration, PRESS.duration + 1, 10_000]) expect(entranceOpacity(t)).toBe(1);
  });

  it('the colour is exactly 0 until the opacity is 1, then runs 0 to 1 on the respond curve, whole at press + respond', () => {
    for (const t of [0, 50, PRESS.duration]) expect(entranceColour(t)).toBe(0);
    for (const t of [10, 100, 175, 300, 349]) expect(entranceColour(PRESS.duration + t)).toBeCloseTo(respondCurve(t / RESPOND.duration), 6);
    expect(entranceColour(PRESS.duration + RESPOND.duration)).toBe(1);
    expect(entranceColour(10_000)).toBe(1);
  });

  it('never colour while translucent: at every 0.25 ms of the entrance, a colour above 0 has an opacity of exactly 1', () => {
    let coloured = 0;
    for (const t of times(0, PRESS.duration + RESPOND.duration + 10, 0.25)) {
      if (entranceColour(t) > 0) {
        coloured++;
        expect([t, entranceOpacity(t)]).toEqual([t, 1]);
      }
    }
    expect(coloured).toBeGreaterThan(1000);
  });

  it('a time that is not a number, or before the placement, is the entrance’s start', () => {
    expect([entranceOpacity(NaN), entranceColour(NaN), entranceOpacity(-40), entranceColour(-40)]).toEqual([0, 0, 0, 0]);
  });
});

describe('the exit (F1): the colour to 0 over motion.press, then the opacity to 0 over motion.respond, from where it is', () => {
  it('an opaque bead holds opacity 1 while its colour fades from its own level over press, then its opacity follows the respond curve down', () => {
    for (const c0 of [1, 0.6]) {
      expect(exitColour(1, c0, 0)).toBe(c0);
      for (const t of [10, 40, 90]) {
        expect(exitColour(1, c0, t)).toBeCloseTo(c0 * (1 - pressCurve(t / PRESS.duration)), 6);
        expect(exitOpacity(1, t)).toBe(1);
      }
      expect(exitColour(1, c0, PRESS.duration)).toBe(0);
    }
    for (const t of [20, 175, 340]) expect(exitOpacity(1, PRESS.duration + t)).toBeCloseTo(1 - respondCurve(t / RESPOND.duration), 6);
    expect(exitOpacity(1, PRESS.duration + RESPOND.duration)).toBe(0);
    expect(exitDuration(1)).toBe(PRESS.duration + RESPOND.duration);
    expect(exitHold(1)).toBe(PRESS.duration);
  });

  it('a translucent bead (caught in its entrance) carries no colour: its opacity fades at once, from where it is, over respond', () => {
    const from = entranceOpacity(40);
    expect(from).toBeGreaterThan(0);
    expect(from).toBeLessThan(1);
    expect(exitOpacity(from, 0)).toBe(from);
    for (const t of [10, 175, 340]) expect(exitOpacity(from, t)).toBeCloseTo(from * (1 - respondCurve(t / RESPOND.duration)), 6);
    expect(exitOpacity(from, RESPOND.duration)).toBe(0);
    for (const t of [0, 50, 200]) expect(exitColour(from, 0, t)).toBe(0);
    expect(exitDuration(from)).toBe(RESPOND.duration);
    expect(exitHold(from)).toBe(0);
  });

  it('never colour while translucent: from every 5 ms of the entrance, at every 0.5 ms of the exit', () => {
    let coloured = 0;
    for (const at of times(0, PRESS.duration + RESPOND.duration, 5)) {
      const o0 = entranceOpacity(at);
      const c0 = entranceColour(at);
      for (const t of times(0, exitDuration(o0) + 5, 0.5)) {
        if (exitColour(o0, c0, t) > 0) {
          coloured++;
          if (exitOpacity(o0, t) !== 1) expect([at, t, exitOpacity(o0, t)]).toEqual([at, t, 1]);
        }
      }
    }
    expect(coloured).toBeGreaterThan(5000);
  });

  it('a start opacity that is not a number is read as gone; one above 1 as whole', () => {
    expect([exitOpacity(NaN, 0), exitColour(NaN, 1, 0), exitHold(NaN)]).toEqual([0, 0, 0]);
    expect(exitOpacity(1.5, 10)).toBe(1);
  });
});

describe('a late exit still plays (the d5479dc capture: whole to gone within one 147 ms frame gap)', () => {
  it('EXIT_MIN_MS is motion.respond, the opacity step’s own length: the shortest an exit is ever played', () => {
    expect(EXIT_MIN_MS).toBe(RESPOND.duration);
  });

  it('on time, an exit plays its whole timeline', () => {
    expect(exitPlayMs(1, 0)).toBe(exitDuration(1));
    expect(exitPlayMs(0.4, 0)).toBe(exitDuration(0.4));
  });

  it('a little late, it plays over what is left of its timeline, so it still ends when it was due', () => {
    expect(exitPlayMs(1, 60)).toBe(exitDuration(1) - 60);
    expect(exitPlayMs(1, exitDuration(1) - EXIT_MIN_MS)).toBe(EXIT_MIN_MS);
  });

  it('later, or after the timeline was over, it plays over EXIT_MIN_MS: compressed, never skipped', () => {
    for (const late of [exitDuration(1) - EXIT_MIN_MS + 1, 300, exitDuration(1), 600, 10_000]) expect(exitPlayMs(1, late)).toBe(EXIT_MIN_MS);
    expect(exitPlayMs(0.4, 10_000)).toBe(EXIT_MIN_MS);
  });

  it('an unreadable or negative lateness is on time', () => {
    for (const late of [Number.NaN, -50, Number.NEGATIVE_INFINITY]) expect(exitPlayMs(1, late)).toBe(exitDuration(1));
    expect(exitPlayMs(1, Number.POSITIVE_INFINITY)).toBe(EXIT_MIN_MS);
  });
});

describe('beadOpacityAt: a bead’s opacity from its presence entry (ruling 2, for the rim words on the UI thread)', () => {
  it('a live bead is whole: the knock-out of a live bead is total', () => {
    expect(beadOpacityAt({ leaving: false, leftAt: null, playedAt: null, startOpacity: 1 }, 123)).toBe(1);
  });

  it('a bead whose view started its exit on time follows the exit from its leftAt and its startOpacity', () => {
    const leftAt = 5000;
    for (const [start, t] of [[1, 0], [1, 60], [1, 220], [0.4, 0], [0.4, 120], [1, 900]] as const) {
      expect(beadOpacityAt({ leaving: true, leftAt, playedAt: leftAt, startOpacity: start }, leftAt + t)).toBe(exitOpacity(start, t));
    }
    expect(beadOpacityAt({ leaving: true, leftAt, playedAt: leftAt, startOpacity: 1 }, leftAt + exitDuration(1))).toBe(0);
  });

  it('until its view begins the exit (playedAt null) the bead is where it was: its start, however long after leftAt', () => {
    for (const t of [0, 100, 300, 10_000]) {
      expect(beadOpacityAt({ leaving: true, leftAt: 5000, playedAt: null, startOpacity: 1 }, 5000 + t)).toBe(1);
      expect(beadOpacityAt({ leaving: true, leftAt: 5000, playedAt: null, startOpacity: 0.4 }, 5000 + t)).toBe(0.4);
    }
  });

  it.each([60, 300, 10_000])('a view %p ms late plays the whole exit from playedAt over exitPlayMs: the bead’s own compressed time', (late) => {
    const leftAt = 5000;
    const playedAt = leftAt + late;
    for (const start of [1, 0.4]) {
      const playMs = exitPlayMs(start, late);
      const end = exitDuration(start);
      const b = { leaving: true, leftAt, playedAt, startOpacity: start };
      expect(beadOpacityAt(b, playedAt - 1)).toBe(start);
      for (const f of [0, 0.1, 0.25, 0.5, 0.75, 0.9]) expect(beadOpacityAt(b, playedAt + f * playMs)).toBeCloseTo(exitOpacity(start, f * end), 12);
      expect(beadOpacityAt(b, playedAt + playMs)).toBe(0);
    }
  });

  it('a clock that reads earlier than leftAt holds the start (never above it)', () => {
    expect(beadOpacityAt({ leaving: true, leftAt: 5000, playedAt: 5000, startOpacity: 0.7 }, 4990)).toBe(0.7);
  });
});

// The worklets plugin only lets a worklet call a worklet: a plain helper throws on the UI thread ("Tried to synchronously
// call a non-worklet function") and jest cannot see it. So every module-scope function here is a worklet, and every
// function it imports by value is a worklet in its own source (workletSafe.test.ts holds the module-scope Math rule).
const SOURCE = path.resolve(__dirname, '../beadTimeline.ts');

function moduleFunctions(source: string): Array<{ name: string; worklet: boolean }> {
  const file = ts.createSourceFile('m.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const opens = (body: ts.Node | undefined) =>
    body !== undefined && ts.isBlock(body) && body.statements.length > 0 && ts.isExpressionStatement(body.statements[0])
    && ts.isStringLiteral(body.statements[0].expression) && body.statements[0].expression.text === 'worklet';
  const out: Array<{ name: string; worklet: boolean }> = [];
  for (const s of file.statements) {
    if (ts.isFunctionDeclaration(s) && s.name) out.push({ name: s.name.text, worklet: opens(s.body) });
    if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
          out.push({ name: d.name.text, worklet: opens(d.initializer.body) });
        }
      }
    }
  }
  return out;
}

/** The names imported by value from relative modules, with their specifier. */
function valueImports(source: string): Array<{ spec: string; name: string }> {
  const file = ts.createSourceFile('m.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: Array<{ spec: string; name: string }> = [];
  for (const s of file.statements) {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier) || !s.importClause || s.importClause.isTypeOnly) continue;
    const bindings = s.importClause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) for (const e of bindings.elements) if (!e.isTypeOnly) out.push({ spec: s.moduleSpecifier.text, name: (e.propertyName ?? e.name).text });
  }
  return out;
}

describe('the timeline runs on the UI thread', () => {
  const source = fs.readFileSync(SOURCE, 'utf8');

  it('every function the module defines is a worklet', () => {
    const functions = moduleFunctions(source);
    expect(functions.map((f) => f.name)).toEqual(expect.arrayContaining(['beadOpacityAt', 'entranceOpacity', 'entranceColour', 'exitOpacity', 'exitColour', 'exitHold', 'exitDuration']));
    expect(functions.filter((f) => !f.worklet).map((f) => f.name)).toEqual([]);
  });

  it('every function it imports by value is a worklet in its own source', () => {
    const plain = valueImports(source).filter(({ spec, name }) => {
      const found = moduleFunctions(fs.readFileSync(path.resolve(path.dirname(SOURCE), spec), 'utf8')).find((f) => f.name === name);
      return found !== undefined && !found.worklet;
    });
    expect(valueImports(source).length).toBeGreaterThan(0);
    expect(plain).toEqual([]);
  });

  it('the scans bite on planted sources', () => {
    expect(moduleFunctions("export function f() { return 1; }\nexport const g = () => { 'worklet'; return 2; };").map((f) => [f.name, f.worklet])).toEqual([['f', false], ['g', true]]);
    expect(valueImports("import { a, type B } from './x.ts';\nimport type { C } from './y.ts';")).toEqual([{ spec: './x.ts', name: 'a' }]);
  });
});
